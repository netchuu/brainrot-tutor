import asyncio
import json

import httpx
import pytest
import respx
from pydantic import BaseModel, ConfigDict, Field

from app.clients import llm
from app.clients.llm import generate_json
from app.config import get_settings
from app.errors import LlmUnavailableError, RateLimitedError

GEMINI_KEY = "test-gemini-key"
GROQ_KEY = "test-groq-key"
GEMINI_ROUTE = {"host": "generativelanguage.googleapis.com", "path__regex": r":generateContent$"}
GROQ_ROUTE = {"host": "api.groq.com", "path": "/openai/v1/chat/completions"}


class Answer(BaseModel):
    model_config = ConfigDict(extra="forbid")
    word: str = Field(min_length=3)


def gemini_reply(text: str) -> httpx.Response:
    return httpx.Response(
        200, json={"candidates": [{"content": {"role": "model", "parts": [{"text": text}]}, "finishReason": "STOP"}]}
    )


def groq_reply(text: str) -> httpx.Response:
    return httpx.Response(
        200,
        json={
            "id": "chatcmpl-test",
            "object": "chat.completion",
            "created": 0,
            "model": "openai/gpt-oss-120b",
            "choices": [{"index": 0, "message": {"role": "assistant", "content": text}, "finish_reason": "stop"}],
        },
    )


def api_error(status: int) -> httpx.Response:
    return httpx.Response(status, json={"error": {"code": status, "message": "test failure", "status": "TEST"}})


@pytest.fixture
def llm_keys(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GEMINI_API_KEY", GEMINI_KEY)
    monkeypatch.setenv("GROQ_API_KEY", GROQ_KEY)
    get_settings.cache_clear()


@pytest.mark.usefixtures("llm_keys")
async def test_gemini_answer_is_used(respx_mock: respx.MockRouter) -> None:
    gemini = respx_mock.post(**GEMINI_ROUTE).mock(return_value=gemini_reply('{"word": "мозг"}'))
    groq = respx_mock.post(**GROQ_ROUTE)

    answer = await generate_json("system rules", "the prompt", Answer)

    assert answer == Answer(word="мозг")
    assert not groq.called
    request = gemini.calls.last.request
    body = json.loads(request.content)
    assert request.headers["x-goog-api-key"] == GEMINI_KEY
    assert "gemini-3.5-flash-lite:generateContent" in request.url.path
    assert body["generationConfig"]["responseMimeType"] == "application/json"
    assert body["generationConfig"]["responseJsonSchema"]["properties"]["word"]["type"] == "string"
    assert body["systemInstruction"]["parts"][0]["text"] == "system rules"


@pytest.mark.usefixtures("llm_keys")
async def test_invalid_gemini_answer_is_repaired_once(respx_mock: respx.MockRouter) -> None:
    gemini = respx_mock.post(**GEMINI_ROUTE).mock(
        side_effect=[gemini_reply('{"word": "no"}'), gemini_reply('{"word": "карта"}')]
    )

    answer = await generate_json("system", "prompt", Answer)

    assert answer == Answer(word="карта")
    assert gemini.call_count == 2
    repair_prompt = json.loads(gemini.calls.last.request.content)["contents"][0]["parts"][0]["text"]
    assert "failed validation" in repair_prompt
    assert "word: String should have at least 3 characters" in repair_prompt


@pytest.mark.usefixtures("llm_keys")
async def test_gemini_invalid_twice_falls_back_to_groq(respx_mock: respx.MockRouter) -> None:
    gemini = respx_mock.post(**GEMINI_ROUTE).mock(return_value=gemini_reply("not json"))
    groq = respx_mock.post(**GROQ_ROUTE).mock(return_value=groq_reply('{"word": "датчик"}'))

    answer = await generate_json("system", "prompt", Answer)

    assert answer == Answer(word="датчик")
    assert gemini.call_count == 2
    request = groq.calls.last.request
    body = json.loads(request.content)
    assert request.headers["authorization"] == f"Bearer {GROQ_KEY}"
    assert body["model"] == "openai/gpt-oss-120b"
    assert body["response_format"]["type"] == "json_schema"
    assert body["response_format"]["json_schema"]["strict"] is True
    assert body["response_format"]["json_schema"]["name"] == "Answer"
    assert body["messages"][0] == {"role": "system", "content": "system"}
    assert "minLength" not in json.dumps(body["response_format"]["json_schema"]["schema"])


@pytest.mark.usefixtures("llm_keys")
async def test_gemini_rate_limit_falls_back_to_groq(respx_mock: respx.MockRouter) -> None:
    gemini = respx_mock.post(**GEMINI_ROUTE).mock(return_value=api_error(429))
    respx_mock.post(**GROQ_ROUTE).mock(return_value=groq_reply('{"word": "турбо"}'))

    answer = await generate_json("system", "prompt", Answer)

    assert answer == Answer(word="турбо")
    assert gemini.call_count == 1


@pytest.mark.usefixtures("llm_keys")
async def test_gemini_timeout_falls_back_to_groq(respx_mock: respx.MockRouter) -> None:
    respx_mock.post(**GEMINI_ROUTE).mock(side_effect=httpx.ReadTimeout("slow"))
    respx_mock.post(**GROQ_ROUTE).mock(return_value=groq_reply('{"word": "наддув"}'))

    assert await generate_json("system", "prompt", Answer) == Answer(word="наддув")


@pytest.mark.usefixtures("llm_keys")
async def test_both_rate_limited_is_rate_limited(respx_mock: respx.MockRouter) -> None:
    respx_mock.post(**GEMINI_ROUTE).mock(return_value=api_error(429))
    groq = respx_mock.post(**GROQ_ROUTE).mock(return_value=api_error(429))

    with pytest.raises(RateLimitedError):
        await generate_json("system", "prompt", Answer)
    assert groq.call_count == 1


@pytest.mark.usefixtures("llm_keys")
async def test_both_down_is_llm_unavailable(respx_mock: respx.MockRouter, caplog: pytest.LogCaptureFixture) -> None:
    respx_mock.post(**GEMINI_ROUTE).mock(return_value=api_error(500))
    respx_mock.post(**GROQ_ROUTE).mock(return_value=api_error(503))

    with pytest.raises(LlmUnavailableError):
        await generate_json("system", "secret source text", Answer)
    assert GEMINI_KEY not in caplog.text
    assert GROQ_KEY not in caplog.text
    assert "secret source text" not in caplog.text


async def test_missing_keys_is_llm_unavailable_without_requests(respx_mock: respx.MockRouter) -> None:
    gemini = respx_mock.post(**GEMINI_ROUTE)
    groq = respx_mock.post(**GROQ_ROUTE)

    with pytest.raises(LlmUnavailableError):
        await generate_json("system", "prompt", Answer)
    assert not gemini.called
    assert not groq.called


async def test_rate_limit_with_other_provider_unset_is_rate_limited(
    respx_mock: respx.MockRouter, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("GROQ_API_KEY", GROQ_KEY)
    get_settings.cache_clear()
    respx_mock.post(**GROQ_ROUTE).mock(return_value=api_error(429))

    with pytest.raises(RateLimitedError):
        await generate_json("system", "prompt", Answer)


@pytest.mark.usefixtures("llm_keys")
async def test_slow_gemini_hits_wall_clock_limit_and_falls_back(
    respx_mock: respx.MockRouter, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def slow(request: httpx.Request) -> httpx.Response:
        await asyncio.sleep(1)
        return gemini_reply('{"word": "поздно"}')

    monkeypatch.setattr(llm, "LLM_TIMEOUT_S", 0.05)
    respx_mock.post(**GEMINI_ROUTE).mock(side_effect=slow)
    respx_mock.post(**GROQ_ROUTE).mock(return_value=groq_reply('{"word": "вовремя"}'))

    assert await generate_json("system", "prompt", Answer) == Answer(word="вовремя")


def test_groq_schema_keeps_structure_and_drops_limits() -> None:
    schema = {
        "type": "object",
        "properties": {
            "pattern": {"type": "string", "minLength": 1},
            "items": {"type": "array", "minItems": 3},
            "score": {"type": "number", "minimum": 0, "maximum": 1, "exclusiveMaximum": 2},
        },
        "required": ["pattern", "items", "score"],
        "anyOf": [{"maxLength": 4, "type": "string"}],
    }

    assert llm.without_limits(schema) == {
        "type": "object",
        "properties": {"pattern": {"type": "string"}, "items": {"type": "array"}, "score": {"type": "number"}},
        "required": ["pattern", "items", "score"],
        "anyOf": [{"type": "string"}],
    }
