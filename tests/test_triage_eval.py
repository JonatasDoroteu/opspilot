import asyncio
import json
import sys
from types import SimpleNamespace

import pytest
from google.genai.errors import APIError

from app.services import triage
from eval import run_eval


class FakeModels:
    def __init__(self, outcomes):
        self.outcomes = outcomes
        self.calls = 0

    async def generate_content(self, **kwargs):
        outcome = self.outcomes[min(self.calls, len(self.outcomes) - 1)]
        self.calls += 1
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


class FakeGeminiClient:
    def __init__(self, outcomes):
        self.models = FakeModels(outcomes)
        self.aio = self

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc_value, traceback):
        return False


def api_error(status_code):
    return APIError(
        status_code,
        {"error": {"code": status_code, "message": "temporary test error"}},
    )


def mock_gemini(monkeypatch, outcomes):
    client = FakeGeminiClient(outcomes)
    monkeypatch.setattr(triage.settings, "gemini_api_key", "test-key")
    monkeypatch.setattr(triage.settings, "gemini_model", "gemini-3.5-flash-lite")
    monkeypatch.setattr(triage.genai, "Client", lambda **kwargs: client)
    return client


def capture_delays(monkeypatch):
    delays = []

    async def fake_sleep(delay):
        delays.append(delay)

    monkeypatch.setattr(triage.asyncio, "sleep", fake_sleep)
    return delays


@pytest.mark.asyncio
async def test_triage_retries_503_then_succeeds(monkeypatch):
    client = mock_gemini(
        monkeypatch,
        [
            api_error(503),
            SimpleNamespace(
                text='{"category":"database","severity":"high","reason":"test"}'
            ),
        ],
    )
    delays = capture_delays(monkeypatch)
    attempts = []
    monkeypatch.setattr(triage.random, "uniform", lambda start, end: 0)

    result = await triage.triage_incident(
        "test incident", on_attempt=lambda: attempts.append(1)
    )

    assert result.category == "database"
    assert client.models.calls == 2
    assert len(attempts) == 2
    assert delays == [1]


@pytest.mark.asyncio
async def test_triage_stops_after_six_503_attempts(monkeypatch):
    client = mock_gemini(monkeypatch, [api_error(503)])
    delays = capture_delays(monkeypatch)
    attempts = []
    monkeypatch.setattr(triage.random, "uniform", lambda start, end: 0)

    with pytest.raises(triage.TriageError, match="HTTP 503"):
        await triage.triage_incident(
            "test incident", on_attempt=lambda: attempts.append(1)
        )

    assert client.models.calls == 6
    assert len(attempts) == 6
    assert delays == [1, 2, 4, 8, 16]


@pytest.mark.asyncio
async def test_triage_does_not_retry_400(monkeypatch):
    client = mock_gemini(monkeypatch, [api_error(400)])
    delays = capture_delays(monkeypatch)
    attempts = []

    with pytest.raises(triage.TriageError, match="HTTP 400"):
        await triage.triage_incident(
            "test incident", on_attempt=lambda: attempts.append(1)
        )

    assert client.models.calls == 1
    assert len(attempts) == 1
    assert delays == []


@pytest.mark.asyncio
async def test_triage_honors_429_retry_delay(monkeypatch):
    throttled = APIError(
        429,
        {
            "error": {
                "details": [
                    {
                        "@type": "type.googleapis.com/google.rpc.RetryInfo",
                        "retryDelay": "7.5s",
                    }
                ]
            }
        },
    )
    client = mock_gemini(
        monkeypatch,
        [
            throttled,
            SimpleNamespace(
                text='{"category":"database","severity":"high","reason":"test"}'
            ),
        ],
    )
    delays = capture_delays(monkeypatch)

    await triage.triage_incident("test incident")

    assert client.models.calls == 2
    assert delays == [7.5]


@pytest.mark.asyncio
async def test_triage_does_not_retry_malformed_response(monkeypatch):
    client = mock_gemini(monkeypatch, [SimpleNamespace(text="{invalid json")])
    delays = capture_delays(monkeypatch)

    with pytest.raises(triage.TriageError, match="triagem inválida"):
        await triage.triage_incident("test incident")

    assert client.models.calls == 1
    assert delays == []


def make_case(case_id, category, severity):
    return {
        "id": case_id,
        "title": f"Incident {case_id}",
        "description": "Test description",
        "expected_category": category,
        "expected_severity": severity,
    }


@pytest.mark.asyncio
async def test_evaluation_continues_after_a_case_fails(monkeypatch):
    calls = []

    async def fake_triage(title, description=None, on_attempt=None):
        on_attempt()
        calls.append(title)
        if title == "first":
            raise triage.TriageError("temporary failure")
        return SimpleNamespace(category="deploy", severity="high", reason="ok")

    monkeypatch.setattr(run_eval, "triage_incident", fake_triage)
    results = await run_eval.evaluate_cases(
        [
            make_case("case-01", "database", "critical") | {"title": "first"},
            make_case("case-02", "deploy", "high") | {"title": "second"},
        ],
        0,
        0,
        lambda progress: None,
    )

    assert calls == ["first", "second"]
    assert [result["status"] for result in results] == ["error", "evaluated"]
    assert [result["attempts"] for result in results] == [1, 1]


@pytest.mark.asyncio
async def test_resume_attempt_count_accumulates(monkeypatch):
    async def fake_triage(title, description=None, on_attempt=None):
        on_attempt()
        return SimpleNamespace(category="database", severity="critical", reason="ok")

    monkeypatch.setattr(run_eval, "triage_incident", fake_triage)
    results = await run_eval.evaluate_cases(
        [make_case("case-01", "database", "critical")],
        0,
        0,
        lambda progress: None,
        initial_attempts=[6],
    )

    assert results[0]["attempts"] == 7


def test_resume_preserves_evaluated_results_and_recalculates_summary(
    tmp_path, monkeypatch, capsys
):
    cases = [
        make_case("case-01", "database", "critical"),
        make_case("case-02", "deploy", "high"),
    ]
    previous_evaluated = {
        "id": "case-01",
        "case_number": 1,
        "title": "Incident case-01",
        "expected": {"category": "database", "severity": "critical"},
        "obtained": {"category": "database", "severity": "low"},
        "reason": "previous result",
        "error": None,
        "category_correct": True,
        "severity_correct": False,
        "status": "evaluated",
    }
    previous = {
        "timestamp_utc": "20261125T000000Z",
        "start": 0,
        "limit": 2,
        "sleep_seconds": 0,
        "total_cases": 2,
        "results": [
            previous_evaluated,
            {
                "id": "case-02",
                "case_number": 2,
                "title": "Incident case-02",
                "expected": {"category": "deploy", "severity": "high"},
                "obtained": None,
                "reason": None,
                "error": {"type": "TriageError", "message": "HTTP 503"},
                "status": "error",
            },
        ],
    }
    cases_path = tmp_path / "cases.json"
    previous_path = tmp_path / "previous.json"
    output_dir = tmp_path / "resultados"
    cases_path.write_text(json.dumps(cases), encoding="utf-8")
    previous_path.write_text(json.dumps(previous), encoding="utf-8")
    previous_contents = previous_path.read_bytes()
    monkeypatch.setattr(run_eval, "CASES_PATH", cases_path)
    monkeypatch.setattr(run_eval, "RESULTS_DIR", output_dir)
    monkeypatch.setattr(run_eval.settings, "gemini_model", "gemini-3.5-flash-lite")

    async def fake_triage(title, description=None, on_attempt=None):
        on_attempt()
        return SimpleNamespace(
            category="deploy", severity="high", reason="recovered"
        )

    monkeypatch.setattr(run_eval, "triage_incident", fake_triage)
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "run_eval.py",
            "--resume-from",
            str(previous_path),
            "--assume-previous-model",
            "gemini-3.5-flash-lite",
        ],
    )

    assert asyncio.run(run_eval.main()) == 0
    output = json.loads(next(output_dir.glob("triage_eval_*.json")).read_text())

    assert output["model"] == "gemini-3.5-flash-lite"
    assert previous_path.read_bytes() == previous_contents
    assert output["results"][0] == {**previous_evaluated, "attempts": None}
    assert output["results"][1]["status"] == "evaluated"
    assert output["results"][1]["attempts"] == 1
    assert output["summary"]["evaluated"] == 2
    assert output["summary"]["attempted"] == 2
    assert output["summary"]["selected"] == 2
    assert output["summary"]["failed"] == 0
    assert output["summary"]["category_accuracy"] == {
        "correct": 2,
        "evaluated": 2,
        "percentage": 100.0,
    }
    assert output["summary"]["severity_accuracy"] == {
        "correct": 1,
        "evaluated": 2,
        "percentage": 50.0,
    }
    assert output["summary"]["wrong_cases"] == [output["results"][0]]
    assert output["summary"]["failed_cases"] == []
    assert "Casos retomados: 1" in capsys.readouterr().out


def test_resume_rejects_a_different_model(tmp_path, monkeypatch, capsys):
    previous_path = tmp_path / "previous.json"
    previous_path.write_text(
        json.dumps(
            {
                "model": "gemini-3.8-flash",
                "results": [],
                "sleep_seconds": 0,
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(run_eval, "CASES_PATH", tmp_path / "cases.json")
    (tmp_path / "cases.json").write_text("[]", encoding="utf-8")
    monkeypatch.setattr(run_eval, "RESULTS_DIR", tmp_path / "resultados")
    monkeypatch.setattr(run_eval.settings, "gemini_model", "gemini-3.5-flash-lite")
    monkeypatch.setattr(
        sys, "argv", ["run_eval.py", "--resume-from", str(previous_path)]
    )

    assert asyncio.run(run_eval.main()) == 2
    assert "modelo incompatível" in capsys.readouterr().err
    assert not (tmp_path / "resultados").exists()
