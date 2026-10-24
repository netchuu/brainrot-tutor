import json
import re
import sys
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator, FormatChecker
from jsonschema.exceptions import best_match

ROOT = Path(__file__).resolve().parents[1]
SCHEMA = json.loads((ROOT / "schemas" / "contract.schema.json").read_text(encoding="utf-8"))
FIXTURES = ROOT / "fixtures"


def validator(definition: str) -> Draft202012Validator:
    return Draft202012Validator({"$ref": f"#/$defs/{definition}", "$defs": SCHEMA["$defs"]}, format_checker=FormatChecker())


def normalize(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def read_ndjson(path: Path) -> list[Any]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def check(errors: list[str], definition: str, name: str, value: Any) -> None:
    error = best_match(validator(definition).iter_errors(value))
    if error is not None:
        errors.append(f"{name}: {'/'.join(map(str, error.absolute_path)) or '<root>'}: {error.message[:200]}")


def check_stream_order(errors: list[str], events: list[dict[str, Any]]) -> None:
    types = [e["type"] for e in events]
    if types[0] != "plan" or types[-1] not in ("done", "error"):
        errors.append("episode stream: must start with plan and end with done or error")
        return
    outline = events[0]["episodes"]
    expected: list[tuple[str, int, int]] = []
    for episode in outline:
        expected += [("scene", episode["index"], i) for i in range(episode["scene_count"])]
        expected.append(("episode_done", episode["index"], -1))
    actual = [(e["type"], e["episode"], e.get("index", -1)) for e in events[1:-1]]
    if actual != expected:
        errors.append("episode stream: scene/episode_done order does not match the plan outline")


def check_grounding(errors: list[str], source: str, events: list[dict[str, Any]], quiz: dict[str, Any], tutor: list[dict[str, Any]]) -> None:
    scenes = [e["scene"] for e in events if e["type"] == "scene"]
    quotes = [(s["id"], s["source_quote"]) for s in scenes]
    quotes += [(q["id"], q["source_quote"]) for q in quiz["questions"]]
    quotes += [("tutor", q) for e in tutor if e["type"] == "done" for q in e["source_quotes"]]
    for owner, quote in quotes:
        if quote is not None and normalize(quote) not in source:
            errors.append(f"{owner}: source_quote not found in source.txt")
    for scene in scenes:
        if scene["highlight"] is not None and scene["highlight"] not in scene["text"]:
            errors.append(f"{scene['id']}: highlight not in text")
    scene_ids = {s["id"] for s in scenes}
    for question in quiz["questions"]:
        if question["scene_id"] is not None and question["scene_id"] not in scene_ids:
            errors.append(f"{question['id']}: scene_id {question['scene_id']} not in the episode stream")


def main() -> int:
    Draft202012Validator.check_schema(SCHEMA)
    errors: list[str] = []
    events = read_ndjson(FIXTURES / "episode-stream.ndjson")
    for n, event in enumerate(events, start=1):
        check(errors, "StreamEvent", f"episode-stream.ndjson line {n}", event)
    quiz = json.loads((FIXTURES / "quiz.json").read_text(encoding="utf-8"))
    check(errors, "QuizResponse", "quiz.json", quiz)
    tutor = read_ndjson(FIXTURES / "tutor-stream.ndjson")
    for n, event in enumerate(tutor, start=1):
        check(errors, "TutorEvent", f"tutor-stream.ndjson line {n}", event)
    if not errors:
        check_stream_order(errors, events)
        check_grounding(errors, normalize((FIXTURES / "source.txt").read_text(encoding="utf-8")), events, quiz, tutor)
    for error in errors:
        print(error, file=sys.stderr)
    scenes = sum(1 for e in events if e["type"] == "scene")
    print(f"{'FAIL' if errors else 'OK'}: {len(events)} stream events ({scenes} scenes), {len(quiz['questions'])} quiz questions, {len(tutor)} tutor events, {len(errors)} errors")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
