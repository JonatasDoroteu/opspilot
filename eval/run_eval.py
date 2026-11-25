import argparse
import asyncio
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app.config import settings
from app.services.triage import triage_incident

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


async def evaluate_cases(
    cases: list[dict[str, Any]],
    start_index: int,
    sleep_seconds: float,
    save_progress: Callable[[list[dict[str, Any]]], None],
    case_numbers: list[int] | None = None,
    initial_attempts: list[int] | None = None,
) -> list[dict[str, Any]]:
    results = []
    for index, case in enumerate(cases):
        case_number = (
            case_numbers[index] if case_numbers is not None else start_index + index + 1
        )
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
            "attempts": (
                initial_attempts[index] if initial_attempts is not None else 0
            ),
        }

        def record_attempt() -> None:
            result["attempts"] += 1

        try:
            triage = await triage_incident(
                case["title"], case.get("description"), on_attempt=record_attempt
            )
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
            result["status"] = "error"
            result["error"] = {
                "type": type(error).__name__,
                "message": safe_error_message(error),
            }
        results.append(result)
        save_progress(results)
        print(f"[{case_number}] {case['title']}: {result['status']}")
        if index < len(cases) - 1:
            await asyncio.sleep(sleep_seconds)
    return results


def accuracy(correct: int, evaluated: int) -> str:
    if not evaluated:
        return "n/a (0 triagens válidas)"
    percentage = correct / evaluated * 100
    return f"{correct}/{evaluated} ({percentage:.1f}%)"


def save_results(
    output_path: Path,
    metadata: dict[str, Any],
    results: list[dict[str, Any]],
    summary: dict[str, Any] | None = None,
) -> None:
    output_path.write_text(
        json.dumps(
            {**metadata, "summary": summary, "results": results},
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )


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
        help="Pausa em segundos entre casos (padrão: 5; retomada usa o valor anterior).",
    )
    parser.add_argument(
        "--resume-from",
        type=Path,
        help="Retoma os casos com erro a partir de um JSON anterior.",
    )
    parser.add_argument(
        "--assume-previous-model",
        help="Modelo do JSON anterior caso ele não tenha o campo model.",
    )
    args = parser.parse_args()
    if args.start < 0:
        parser.error("--start não pode ser negativo.")
    if args.limit is not None and args.limit < 1:
        parser.error("--limit precisa ser pelo menos 1.")
    if args.sleep is not None and args.sleep < 0:
        parser.error("--sleep não pode ser negativo.")
    if args.assume_previous_model and not args.resume_from:
        parser.error("--assume-previous-model requer --resume-from.")
    return args


async def main() -> int:
    args = parse_args()
    try:
        all_cases = load_cases()
    except (OSError, json.JSONDecodeError, ValueError) as error:
        print(f"Erro ao carregar casos: {error}", file=sys.stderr)
        return 2

    model = settings.gemini_model
    if not model:
        print("Erro: GEMINI_MODEL não configurado.", file=sys.stderr)
        return 2

    all_cases_by_id = {
        case.get("id", f"case-{index + 1}"): (index + 1, case)
        for index, case in enumerate(all_cases)
    }
    if args.resume_from:
        try:
            previous = json.loads(args.resume_from.read_text(encoding="utf-8"))
            if not isinstance(previous, dict):
                raise ValueError("o JSON anterior precisa conter um objeto na raiz.")
            previous_results = previous["results"]
        except (OSError, json.JSONDecodeError, KeyError, TypeError, ValueError) as error:
            print(f"Erro ao carregar resultados para retomada: {error}", file=sys.stderr)
            return 2
        if not isinstance(previous_results, list):
            print("Erro: o campo results do JSON anterior precisa ser uma lista.", file=sys.stderr)
            return 2
        previous_model = previous.get("model") or args.assume_previous_model
        if not previous_model:
            print(
                "Erro: o JSON anterior não tem model; informe "
                "--assume-previous-model <nome>.",
                file=sys.stderr,
            )
            return 2
        if previous_model != model:
            print(
                f"Erro: modelo incompatível (anterior: {previous_model}; atual: {model}).",
                file=sys.stderr,
            )
            return 2

        results = []
        retry_cases = []
        retry_case_numbers = []
        retry_initial_attempts = []
        seen_case_ids = set()
        for previous_result in previous_results:
            if not isinstance(previous_result, dict):
                print("Erro: item inválido na lista results do JSON anterior.", file=sys.stderr)
                return 2
            case_id = previous_result.get("id")
            if case_id not in all_cases_by_id:
                print(f"Erro: caso desconhecido no JSON anterior: {case_id}.", file=sys.stderr)
                return 2
            if case_id in seen_case_ids:
                print(f"Erro: caso duplicado no JSON anterior: {case_id}.", file=sys.stderr)
                return 2
            seen_case_ids.add(case_id)
            result = dict(previous_result)
            result.setdefault("attempts", None)
            results.append(result)
            if result.get("status") == "error":
                case_number, case = all_cases_by_id[case_id]
                previous_attempts = result.get("attempts")
                if previous_attempts is not None and (
                    isinstance(previous_attempts, bool)
                    or not isinstance(previous_attempts, int)
                    or previous_attempts < 0
                ):
                    print(
                        f"Erro: attempts inválido para o caso {case_id}.",
                        file=sys.stderr,
                    )
                    return 2
                retry_cases.append(case)
                retry_case_numbers.append(case_number)
                retry_initial_attempts.append(previous_attempts or 0)

        sleep_seconds = (
            args.sleep
            if args.sleep is not None
            else float(previous.get("sleep_seconds", 5))
        )
        metadata = {
            key: previous.get(key)
            for key in ("start", "limit", "total_cases")
        }
        metadata.update(
            {
                "timestamp_utc": datetime.now(timezone.utc).strftime(
                    "%Y%m%dT%H%M%S%fZ"
                ),
                "sleep_seconds": sleep_seconds,
                "model": model,
            }
        )
    else:
        selected_cases = all_cases[args.start :]
        if args.limit is not None:
            selected_cases = selected_cases[: args.limit]
        if not selected_cases:
            print("Nenhum caso selecionado; confira --start e --limit.", file=sys.stderr)
            return 2
        retry_cases = selected_cases
        retry_case_numbers = list(
            range(args.start + 1, args.start + len(selected_cases) + 1)
        )
        sleep_seconds = args.sleep if args.sleep is not None else 5
        results = []
        metadata = {
            "start": args.start,
            "limit": args.limit,
            "total_cases": len(all_cases),
            "sleep_seconds": sleep_seconds,
            "model": model,
        }

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    metadata["timestamp_utc"] = timestamp
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    output_path = RESULTS_DIR / f"triage_eval_{timestamp}.json"
    suffix = 1
    while output_path.exists():
        timestamp = (
            datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
            + f"-{suffix}"
        )
        metadata["timestamp_utc"] = timestamp
        output_path = RESULTS_DIR / f"triage_eval_{timestamp}.json"
        suffix += 1

    if args.resume_from:
        result_positions = {result["id"]: index for index, result in enumerate(results)}

        def save_merged_progress(current_results: list[dict[str, Any]]) -> None:
            for current_result in current_results:
                results[result_positions[current_result["id"]]] = current_result
            save_results(output_path, metadata, results)

        save_results(output_path, metadata, results)
        await evaluate_cases(
            retry_cases,
            0,
            sleep_seconds,
            save_merged_progress,
            case_numbers=retry_case_numbers,
            initial_attempts=retry_initial_attempts,
        )
        print(f"Casos retomados: {len(retry_cases)}")
    else:
        results = await evaluate_cases(
            retry_cases,
            args.start,
            sleep_seconds,
            lambda current_results: save_results(
                output_path, metadata, current_results
            ),
            case_numbers=retry_case_numbers,
        )

    summary = print_summary(results, len(results) if args.resume_from else len(retry_cases))
    save_results(output_path, metadata, results, summary)
    if args.resume_from:
        print(f"Casos que continuam em erro: {summary['failed']}")
    try:
        display_path = output_path.relative_to(PROJECT_ROOT)
    except ValueError:
        display_path = output_path
    print(f"\nResultado salvo em: {display_path}")
    return 1 if summary["failed"] else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))