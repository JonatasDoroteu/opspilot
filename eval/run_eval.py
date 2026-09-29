import argparse
import asyncio
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app.config import settings
from app.services.triage import TriageError, triage_incident

CASES_PATH = Path(__file__).with_name("cases.json")
RESULTS_DIR = Path(__file__).with_name("resultados")
VALID_CATEGORIES = {"database", "deploy", "network", "other"}
VALID_SEVERITIES = {"low", "medium", "high", "critical"}


def load_cases() -> list[dict[str, Any]]:
    with CASES_PATH.open(encoding="utf-8") as cases_file:
        cases = json.load(cases_file)
    if not isinstance(cases, list):
        raise ValueError("eval/cases.json precisa conter uma lista de casos.")

    for index, case in enumerate(cases, start=1):
        if case.get("expected_category") not in VALID_CATEGORIES:
            raise ValueError(f"Caso {index}: expected_category ausente ou inválida.")
        if case.get("expected_severity") not in VALID_SEVERITIES:
            raise ValueError(f"Caso {index}: expected_severity ausente ou inválida.")
        if not case.get("title"):
            raise ValueError(f"Caso {index}: title ausente.")
    return cases


def safe_error_message(error: Exception) -> str:
    message = str(error)
    api_key = settings.gemini_api_key
    if api_key:
        message = message.replace(api_key, "[redacted]")
    return message


def is_rate_limited(error: Exception) -> bool:
    if getattr(error, "code", None) == 429:
        return True
    return isinstance(error, TriageError) and "HTTP 429" in str(error)


async def evaluate_cases(
    cases: list[dict[str, Any]], start_index: int, sleep_seconds: float
) -> list[dict[str, Any]]:
    results = []
    for index, case in enumerate(cases):
        case_number = start_index + index + 1
        result: dict[str, Any] = {
            "id": case.get("id", f"case-{index + 1}"),
            "case_number": case_number,
            "title": case["title"],
            "expected": {
                "category": case["expected_category"],
                "severity": case["expected_severity"],
            },
            "obtained": None,
            "reason": None,
            "error": None,
        }
        try:
            triage = await triage_incident(case["title"], case.get("description"))
            result["obtained"] = {
                "category": triage.category,
                "severity": triage.severity,
            }
            result["reason"] = triage.reason
            result["category_correct"] = (
                triage.category == case["expected_category"]
            )
            result["severity_correct"] = (
                triage.severity == case["expected_severity"]
            )
            result["status"] = "evaluated"
        except Exception as error:
            rate_limited = is_rate_limited(error)
            result["status"] = "rate_limited" if rate_limited else "error"
            result["error"] = {
                "type": type(error).__name__,
                "message": safe_error_message(error),
            }
        results.append(result)
        print(f"[{case_number}] {case['title']}: {result['status']}")
        if result["status"] == "rate_limited":
            print(
                f"\033[1;31m429 após retries; eval interrompido no caso "
                f"{case_number} ({result['id']}): {case['title']}\033[0m"
            )
            break
        if index < len(cases) - 1:
            await asyncio.sleep(sleep_seconds)
    return results


def accuracy(correct: int, evaluated: int) -> str:
    if not evaluated:
        return "n/a (0 triagens válidas)"
    percentage = correct / evaluated * 100
    return f"{correct}/{evaluated} ({percentage:.1f}%)"


def print_summary(
    results: list[dict[str, Any]], selected_count: int
) -> dict[str, Any]:
    evaluated = [result for result in results if result["status"] == "evaluated"]
    failures = [
        result for result in results if result["status"] in {"error", "rate_limited"}
    ]
    rate_limited = next(
        (result for result in results if result["status"] == "rate_limited"), None
    )
    wrong = [
        result
        for result in evaluated
        if not result["category_correct"] or not result["severity_correct"]
    ]
    category_correct = sum(result["category_correct"] for result in evaluated)
    severity_correct = sum(result["severity_correct"] for result in evaluated)

    print("\nResumo")
    partial = bool(failures) or len(results) < selected_count
    if partial:
        print(
            f"\033[1;31mPARCIAL: {len(evaluated)} de {selected_count} avaliados\033[0m"
        )
    else:
        print(f"\033[1m{len(evaluated)} de {selected_count} avaliados\033[0m")
    if rate_limited:
        print(
            f"\033[1;31mParou no caso {rate_limited['case_number']} "
            f"({rate_limited['id']}): {rate_limited['title']}\033[0m"
        )
    print("Métricas somente sobre triagens válidas; casos com erro ficam fora:")
    print(f"Categoria: {accuracy(category_correct, len(evaluated))}")
    print(f"Severidade: {accuracy(severity_correct, len(evaluated))}")

    print("\nCasos errados")
    if not wrong and not failures:
        print("Nenhum.")
    for result in wrong:
        expected = result["expected"]
        obtained = result["obtained"]
        print(f"- {result['title']}")
        print(
            f"  Esperado: category={expected['category']}, "
            f"severity={expected['severity']}"
        )
        print(
            f"  Obtido: category={obtained['category']}, "
            f"severity={obtained['severity']}"
        )
        print(f"  Motivo: {result['reason']}")

    if failures:
        print("\nCasos com erro")
        for result in failures:
            error = result["error"]
            print(f"- {result['title']}: {error['type']}: {error['message']}")

    return {
        "evaluated": len(evaluated),
        "attempted": len(results),
        "selected": selected_count,
        "failed": len(failures),
        "stopped_at": rate_limited,
        "category_accuracy": {
            "correct": category_correct,
            "evaluated": len(evaluated),
            "percentage": category_correct / len(evaluated) * 100
            if evaluated
            else None,
        },
        "severity_accuracy": {
            "correct": severity_correct,
            "evaluated": len(evaluated),
            "percentage": severity_correct / len(evaluated) * 100
            if evaluated
            else None,
        },
        "wrong_cases": wrong,
        "failed_cases": failures,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Avalia a triagem Gemini nos casos rotulados.")
    parser.add_argument(
        "--start",
        type=int,
        default=0,
        help="Índice inicial baseado em zero (padrão: 0).",
    )
    parser.add_argument(
        "--limit",
        type=int,
        help="Número máximo de casos a avaliar a partir de --start.",
    )
    parser.add_argument(
        "--sleep",
        type=float,
        default=5,
        help="Pausa em segundos entre chamadas (padrão: 5).",
    )
    args = parser.parse_args()
    if args.start < 0:
        parser.error("--start não pode ser negativo.")
    if args.limit is not None and args.limit < 1:
        parser.error("--limit precisa ser pelo menos 1.")
    if args.sleep < 0:
        parser.error("--sleep não pode ser negativo.")
    return args


async def main() -> int:
    args = parse_args()
    try:
        all_cases = load_cases()
    except (OSError, json.JSONDecodeError, ValueError) as error:
        print(f"Erro ao carregar casos: {error}", file=sys.stderr)
        return 2

    selected_cases = all_cases[args.start :]
    if args.limit is not None:
        selected_cases = selected_cases[: args.limit]
    if not selected_cases:
        print("Nenhum caso selecionado; confira --start e --limit.", file=sys.stderr)
        return 2

    results = await evaluate_cases(selected_cases, args.start, args.sleep)
    summary = print_summary(results, len(selected_cases))
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    output_path = RESULTS_DIR / f"triage_eval_{timestamp}.json"
    output_path.write_text(
        json.dumps(
            {
                "timestamp_utc": timestamp,
                "start": args.start,
                "limit": args.limit,
                "sleep_seconds": args.sleep,
                "total_cases": len(all_cases),
                "summary": summary,
                "results": results,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"\nResultado salvo em: {output_path.relative_to(PROJECT_ROOT)}")
    return 1 if summary["failed"] else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))