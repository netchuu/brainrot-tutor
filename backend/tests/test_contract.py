import copy
import json
from typing import Any, get_args

import pytest
from pydantic import BaseModel, TypeAdapter, ValidationError

from app.schemas import contract
from tests.conftest import FIXTURES_DIR
from validate import SCHEMA, read_ndjson, validator

CONSTRAINT_KEYS = (
    "minLength",
    "maxLength",
    "minimum",
    "maximum",
    "minItems",
    "maxItems",
    "pattern",
    "const",
    "default",
    "format",
)
INLINE_OBJECTS = {("QuizRequest", "episode"): "QuizEpisode", ("ErrorResponse", "error"): "ErrorBody"}
ENUM_ALIASES = {
    "Language": contract.Language,
    "TemplateId": contract.TemplateId,
    "Speaker": contract.Speaker,
    "Reaction": contract.Reaction,
    "Sfx": contract.Sfx,
    "ErrorCode": contract.ErrorCode,
}
UNIONS = {"StreamEvent": contract.StreamEvent, "Question": contract.Question, "TutorEvent": contract.TutorEvent}


def contract_defs() -> dict[str, Any]:
    defs: dict[str, Any] = copy.deepcopy(SCHEMA["$defs"])
    for (owner, field), name in INLINE_OBJECTS.items():
        defs[name] = defs[owner]["properties"][field]
        defs[owner]["properties"][field] = {"$ref": f"#/$defs/{name}"}
    return defs


DEFS = contract_defs()
ENUM_DEFS = {name: definition["enum"] for name, definition in DEFS.items() if set(definition) == {"enum"}}
OBJECT_DEFS = sorted(name for name, definition in DEFS.items() if definition.get("type") == "object")


def facts(node: object) -> set[tuple[str, str]]:
    found: set[tuple[str, str]] = set()
    if isinstance(node, list):
        for item in node:
            found |= facts(item)
        return found
    if not isinstance(node, dict):
        return found
    for key in CONSTRAINT_KEYS:
        if key in node:
            found.add((key, json.dumps(node[key], sort_keys=True)))
    if "$ref" in node:
        name = node["$ref"].rsplit("/", 1)[-1]
        if name in ENUM_DEFS:
            found.add(("enum", json.dumps(sorted(ENUM_DEFS[name]))))
        elif name in UNIONS:
            found |= facts(DEFS[name]["oneOf"])
        else:
            found.add(("ref", name))
    if "enum" in node and "const" not in node:
        found.add(("enum", json.dumps(sorted(value for value in node["enum"] if value is not None))))
        if None in node["enum"]:
            found.add(("type", "null"))
    types = node.get("type", [])
    for kind in [types] if isinstance(types, str) else types:
        if kind == "null" or not ("enum" in node or "const" in node):
            found.add(("type", kind))
    for key in ("items", "anyOf", "oneOf", "allOf"):
        if key in node:
            found |= facts(node[key])
    return found


def round_trip(adapter: TypeAdapter[Any], definition: str, raw: object) -> None:
    dumped = adapter.dump_python(adapter.validate_python(raw), mode="json")
    assert dumped == raw
    validator(definition).validate(dumped)


@pytest.mark.parametrize("line", read_ndjson(FIXTURES_DIR / "episode-stream.ndjson"), ids=lambda event: event["type"])
def test_episode_stream_fixture_round_trips(line: dict[str, Any]) -> None:
    round_trip(TypeAdapter(contract.StreamEvent), "StreamEvent", line)


def test_quiz_fixture_round_trips() -> None:
    quiz = json.loads((FIXTURES_DIR / "quiz.json").read_text(encoding="utf-8"))
    round_trip(TypeAdapter(contract.QuizResponse), "QuizResponse", quiz)


@pytest.mark.parametrize("line", read_ndjson(FIXTURES_DIR / "tutor-stream.ndjson"), ids=lambda event: event["type"])
def test_tutor_stream_fixture_round_trips(line: dict[str, Any]) -> None:
    round_trip(TypeAdapter(contract.TutorEvent), "TutorEvent", line)


@pytest.mark.parametrize("name", OBJECT_DEFS)
def test_model_mirrors_schema_definition(name: str) -> None:
    definition = DEFS[name]
    model: type[BaseModel] = getattr(contract, name)
    generated = model.model_json_schema()

    assert generated.get("additionalProperties") is False
    assert set(generated["properties"]) == set(definition["properties"])
    assert set(generated.get("required", [])) == set(definition["required"])
    for field, node in definition["properties"].items():
        assert facts(generated["properties"][field]) == facts(node), f"{name}.{field}"


@pytest.mark.parametrize("name", sorted(ENUM_ALIASES))
def test_enum_alias_matches_schema(name: str) -> None:
    assert sorted(get_args(ENUM_ALIASES[name])) == sorted(ENUM_DEFS[name])


@pytest.mark.parametrize("name", sorted(UNIONS))
def test_union_members_match_schema(name: str) -> None:
    generated = TypeAdapter(UNIONS[name]).json_schema()
    expected = {ref["$ref"].rsplit("/", 1)[-1] for ref in DEFS[name]["oneOf"]}

    assert {ref["$ref"].rsplit("/", 1)[-1] for ref in generated["oneOf"]} == expected


def test_scene_rejects_extra_field_and_long_text() -> None:
    scene = read_ndjson(FIXTURES_DIR / "episode-stream.ndjson")[1]["scene"]

    with pytest.raises(ValidationError):
        contract.Scene.model_validate({**scene, "unexpected": True})
    with pytest.raises(ValidationError):
        contract.Scene.model_validate({**scene, "text": "x" * 221})


def test_picture_url_must_be_absolute_uri() -> None:
    contract.Picture(query="engine", url="https://images.pexels.com/photos/1/a.jpeg?h=650&w=940", credit="Photo")

    with pytest.raises(ValidationError):
        contract.Picture(query="engine", url="not a uri", credit="Photo")
