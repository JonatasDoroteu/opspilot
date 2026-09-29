import json
import uuid
from types import SimpleNamespace

import httpx
import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.database import Base, get_db
from app.main import app
from app.models import Incident, Runbook
from app.routers import incidents
from app.services.triage import TriageError, TriageResult
from mcp_server import server as mcp_server

TEST_API_KEY = "test-api-key"


class FakeWebhookClient:
    calls = 0

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, traceback):
        return False

    async def post(self, *args, **kwargs):
        type(self).calls += 1
        raise httpx.ConnectError("webhook indisponivel")


@pytest_asyncio.fixture
async def db_session():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as session:
        yield session

    await engine.dispose()


@pytest_asyncio.fixture
async def client(db_session, monkeypatch):
    async def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    monkeypatch.setattr(incidents.settings, "api_key", TEST_API_KEY)
    monkeypatch.setattr(incidents.settings, "n8n_webhook_url", "https://webhook.test")
    FakeWebhookClient.calls = 0
    monkeypatch.setattr(
        incidents,
        "httpx",
        SimpleNamespace(AsyncClient=FakeWebhookClient, HTTPError=httpx.HTTPError),
    )

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as test_client:
        yield test_client

    app.dependency_overrides.clear()


@pytest.fixture
def mcp_transport(monkeypatch):
    def configure(handler):
        transport = httpx.MockTransport(handler)
        monkeypatch.setattr(mcp_server, "API_URL", "http://api.test")
        monkeypatch.setattr(mcp_server, "API_KEY", TEST_API_KEY)
        monkeypatch.setattr(
            mcp_server,
            "httpx",
            SimpleNamespace(AsyncClient=lambda: httpx.AsyncClient(transport=transport)),
        )

    return configure


@pytest.mark.asyncio
async def test_create_incident_returns_created_incident(client, monkeypatch):
    response = await client.post(
        "/incidents",
        headers={"x-api-key": TEST_API_KEY},
        json={"title": "API indisponivel", "severity": "high", "category": "network"},
    )
    assert response.status_code == 200
    assert response.json()["title"] == "API indisponivel"
    assert response.json()["status"] == "open"
    assert FakeWebhookClient.calls == 1

    monkeypatch.setattr(incidents.settings, "n8n_webhook_url", "")
    response = await client.post(
        "/incidents",
        headers={"x-api-key": TEST_API_KEY},
        json={"title": "Webhook opcional", "severity": "low", "category": "other"},
    )
    assert response.status_code == 200
    assert FakeWebhookClient.calls == 1


@pytest.mark.asyncio
async def test_created_incident_appears_in_list_after_webhook_failure(client):
    response = await client.post(
        "/incidents",
        headers={"x-api-key": TEST_API_KEY},
        json={"title": "Persistencia confirmada", "severity": "high", "category": "database"},
    )
    assert response.status_code == 200

    incidents_response = await client.get("/incidents")
    assert incidents_response.status_code == 200
    assert any(
        incident["id"] == response.json()["id"]
        for incident in incidents_response.json()
    )


@pytest.mark.asyncio
async def test_create_incident_rejects_malformed_payload(client):
    unauthorized = await client.post(
        "/incidents",
        headers={"x-api-key": "invalid"},
        json={"title": "Sem chave", "severity": "high", "category": "network"},
    )
    assert unauthorized.status_code == 401

    response = await client.post(
        "/incidents", headers={"x-api-key": TEST_API_KEY}, json={"severity": "high"}
    )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_triage_incident_returns_suggestion_without_creating_incident(
    client, monkeypatch
):
    async def fake_triage(title, description):
        assert title == "Banco lento"
        assert description == "Pool de conexões esgotado"
        return TriageResult(
            category="database",
            severity="high",
            reason="O pool de conexões está esgotado.",
        )

    monkeypatch.setattr(incidents.settings, "gemini_api_key", "mock-gemini-key")
    monkeypatch.setattr(incidents, "triage_incident", fake_triage)

    response = await client.post(
        "/incidents/triage",
        headers={"x-api-key": TEST_API_KEY},
        json={"title": "Banco lento", "description": "Pool de conexões esgotado"},
    )

    assert response.status_code == 200
    assert response.json() == {
        "category": "database",
        "severity": "high",
        "reason": "O pool de conexões está esgotado.",
    }
    incidents_response = await client.get("/incidents")
    assert incidents_response.json() == []


@pytest.mark.asyncio
async def test_triage_incident_requires_api_key(client, monkeypatch):
    async def unexpected_triage(*args):
        pytest.fail("triage_incident não deveria ser chamada sem autenticação")

    monkeypatch.setattr(incidents, "triage_incident", unexpected_triage)

    response = await client.post("/incidents/triage", json={"title": "Sem chave"})

    assert response.status_code == 422

    response = await client.post(
        "/incidents/triage",
        headers={"x-api-key": "invalid"},
        json={"title": "Chave inválida"},
    )

    assert response.status_code == 401


@pytest.mark.asyncio
async def test_triage_incident_returns_503_without_gemini_api_key(
    client, monkeypatch
):
    async def unexpected_triage(*args):
        pytest.fail("triage_incident não deveria ser chamada sem GEMINI_API_KEY")

    monkeypatch.setattr(incidents.settings, "gemini_api_key", "")
    monkeypatch.setattr(incidents, "triage_incident", unexpected_triage)

    response = await client.post(
        "/incidents/triage",
        headers={"x-api-key": TEST_API_KEY},
        json={"title": "Banco lento"},
    )

    assert response.status_code == 503
    assert "GEMINI_API_KEY" in response.json()["detail"]


@pytest.mark.asyncio
async def test_triage_incident_translates_triage_error_to_502(client, monkeypatch):
    async def failed_triage(*args):
        raise TriageError("Gemini indisponível")

    monkeypatch.setattr(incidents.settings, "gemini_api_key", "mock-gemini-key")
    monkeypatch.setattr(incidents, "triage_incident", failed_triage)

    response = await client.post(
        "/incidents/triage",
        headers={"x-api-key": TEST_API_KEY},
        json={"title": "Banco lento"},
    )

    assert response.status_code == 502
    assert "Gemini indisponível" in response.json()["detail"]


@pytest.mark.asyncio
async def test_list_incidents_returns_incidents(client, db_session):
    db_session.add(Incident(title="Banco lento", category="database"))
    await db_session.commit()
    response = await client.get("/incidents")
    assert response.status_code == 200
    assert len(response.json()) == 1
    assert response.json()[0]["title"] == "Banco lento"

    detail = await client.get(f"/incidents/{response.json()[0]['id']}")
    assert detail.status_code == 200
    assert detail.json()["title"] == "Banco lento"


@pytest.mark.asyncio
async def test_list_incidents_filters_by_status(client, db_session):
    db_session.add_all(
        [Incident(title="Aberto", status="open"), Incident(title="Resolvido", status="resolved")]
    )
    await db_session.commit()
    response = await client.get("/incidents?status=resolved")
    assert response.status_code == 200
    assert [item["title"] for item in response.json()] == ["Resolvido"]


@pytest.mark.asyncio
async def test_resolve_incident_updates_status(client, db_session):
    incident = Incident(title="Falha no deploy")
    db_session.add(incident)
    await db_session.commit()
    response = await client.post(
        f"/incidents/{incident.id}/resolve", headers={"x-api-key": TEST_API_KEY}
    )
    assert response.status_code == 200
    assert response.json()["status"] == "resolved"
    assert response.json()["resolved_at"] is not None


@pytest.mark.asyncio
async def test_resolve_missing_incident_returns_404(client):
    response = await client.post(
        f"/incidents/{uuid.uuid4()}/resolve", headers={"x-api-key": TEST_API_KEY}
    )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_runbook_search_returns_matching_category(client, db_session):
    db_session.add(
        Runbook(
            category="database",
            title="Banco lento",
            steps="Checar locks",
            severity="high",
        )
    )
    await db_session.commit()

    response = await client.get("/runbooks/database")

    assert response.status_code == 200
    assert response.json()["category"] == "database"
    assert response.json()["steps"] == "Checar locks"
    assert response.json()["severity"] == "high"


@pytest.mark.asyncio
async def test_runbook_search_returns_404_for_missing_category(client):
    response = await client.get("/runbooks/not-a-category")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_mcp_list_incidents_returns_api_body(mcp_transport):
    def handler(request):
        assert request.url.path == "/incidents"
        assert request.headers["x-api-key"] == TEST_API_KEY
        return httpx.Response(200, json=[{"id": "1", "status": "open"}])

    mcp_transport(handler)
    result = await mcp_server.list_incidents()
    assert json.loads(result) == [{"id": "1", "status": "open"}]


@pytest.mark.asyncio
async def test_mcp_list_incidents_with_status_filter(mcp_transport):
    def handler(request):
        assert request.url.params["status"] == "resolved"
        return httpx.Response(200, json=[])

    mcp_transport(handler)
    result = await mcp_server.list_incidents("resolved")
    assert result == "[]"


@pytest.mark.asyncio
async def test_mcp_create_incident_sends_payload(mcp_transport):
    def handler(request):
        assert request.method == "POST"
        assert json.loads(request.content) == {
            "title": "Fila travada",
            "severity": "high",
            "category": "database",
        }
        return httpx.Response(200, json={"id": "1"})

    mcp_transport(handler)
    result = await mcp_server.create_incident("Fila travada", "high", "database")
    assert json.loads(result) == {"id": "1"}


@pytest.mark.asyncio
async def test_mcp_create_incident_returns_validation_error(mcp_transport):
    def handler(request):
        return httpx.Response(422, json={"detail": "payload invalido"})

    mcp_transport(handler)
    result = await mcp_server.create_incident("")
    assert json.loads(result)["detail"] == "payload invalido"


@pytest.mark.asyncio
async def test_mcp_resolve_incident_returns_api_body(mcp_transport):
    incident_id = str(uuid.uuid4())

    def handler(request):
        assert request.method == "POST"
        assert request.url.path == f"/incidents/{incident_id}/resolve"
        return httpx.Response(200, json={"status": "resolved"})

    mcp_transport(handler)
    result = await mcp_server.resolve_incident(incident_id)
    assert json.loads(result)["status"] == "resolved"


@pytest.mark.asyncio
async def test_mcp_resolve_missing_incident_returns_404_body(mcp_transport):
    def handler(request):
        return httpx.Response(404, json={"detail": "Incidente nao encontrado"})

    mcp_transport(handler)
    result = await mcp_server.resolve_incident("missing")
    assert json.loads(result)["detail"] == "Incidente nao encontrado"


@pytest.mark.asyncio
async def test_mcp_get_runbook_for_incident_returns_runbook(mcp_transport):
    incident_id = str(uuid.uuid4())

    def handler(request):
        if request.url.path == "/incidents":
            return httpx.Response(200, json=[{"id": incident_id, "category": "database"}])
        assert request.url.path == "/runbooks/database"
        return httpx.Response(
            200,
            json={"title": "Banco lento", "steps": "Checar locks", "severity": "high"},
        )

    mcp_transport(handler)
    result = await mcp_server.get_runbook_for_incident(incident_id)
    assert result == "Runbook: Banco lento (severidade: high)\n\nChecar locks"


@pytest.mark.asyncio
async def test_mcp_get_runbook_for_missing_incident_returns_edge_message(mcp_transport):
    def handler(request):
        return httpx.Response(200, json=[])

    mcp_transport(handler)
    result = await mcp_server.get_runbook_for_incident("missing")
    assert result == "Incidente missing não encontrado."
