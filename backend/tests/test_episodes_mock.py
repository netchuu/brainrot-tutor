import asyncio
import json
import socket
import time
from pathlib import Path
from typing import Any

import httpx
import pytest
import uvicorn

from app.config import get_settings
from app.main import create_app
from app.services import fixture_replay
from tests.conftest import FIXTURES_DIR, SOURCE_TEXT
from validate import check_stream_order, read_ndjson, validator

STREAM_URL = "/api/episodes/stream"
FIXTURE_EVENTS = read_ndjson(FIXTURES_DIR / "episode-stream.ndjson")


def request_body(source_text: str = SOURCE_TEXT) -> dict[str, Any]:
    return {"source_text": source_text, "language": "ru", "episode_count": 3, "template": None}


@pytest.fixture
def no_replay_delay(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(fixture_replay, "REPLAY_INTERVAL_S", 0)


@pytest.mark.usefixtures("no_replay_delay")
async def test_mock_stream_replays_fixture_as_valid_ndjson(client: httpx.AsyncClient) -> None:
    response = await client.post(STREAM_URL, params={"mock": "1"}, json=request_body())

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/x-ndjson"
    assert response.text.endswith("\n")
    events = [json.loads(line) for line in response.text.splitlines()]
    assert events == FIXTURE_EVENTS
    for event in events:
        validator("StreamEvent").validate(event)
    errors: list[str] = []
    check_stream_order(errors, events)
    assert errors == []


async def test_replay_waits_between_events() -> None:
    lines = ['{"type": "plan"}', '{"type": "scene"}', '{"type": "scene"}']
    stamps: list[float] = []

    async for _ in fixture_replay.replay(lines):
        stamps.append(time.perf_counter())

    assert stamps[1] - stamps[0] >= 0.29
    assert stamps[2] - stamps[1] >= 0.29


async def test_short_source_is_bad_input(client: httpx.AsyncClient) -> None:
    response = await client.post(STREAM_URL, params={"mock": "1"}, json=request_body("коротко"))

    assert response.status_code == 422
    validator("ErrorResponse").validate(response.json())
    assert response.json()["error"]["code"] == "bad_input"
    assert "коротко" not in response.json()["error"]["message"]


async def test_source_over_limit_is_too_long(client: httpx.AsyncClient) -> None:
    response = await client.post(STREAM_URL, params={"mock": "1"}, json=request_body("я" * 60_001))

    assert response.status_code == 413
    validator("ErrorResponse").validate(response.json())
    assert response.json()["error"] == {
        "code": "too_long",
        "message": "source_text is longer than 60000 characters",
        "retryable": False,
    }


async def test_source_over_configured_limit_is_too_long(
    client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("MAX_SOURCE_CHARS", "1000")
    get_settings.cache_clear()

    response = await client.post(STREAM_URL, params={"mock": "1"}, json=request_body("я" * 1001))

    assert response.status_code == 413
    assert response.json()["error"]["code"] == "too_long"


async def test_missing_fixture_is_internal_error_with_cors(
    client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(fixture_replay, "EPISODE_FIXTURE", Path("/nonexistent/episode-stream.ndjson"))

    response = await client.post(
        STREAM_URL, params={"mock": "1"}, json=request_body(), headers={"Origin": "https://brainrot.example"}
    )

    assert response.status_code == 500
    validator("ErrorResponse").validate(response.json())
    assert response.json()["error"]["code"] == "internal"
    assert response.headers["access-control-allow-origin"] == "https://brainrot.example"


async def test_unexpected_key_is_not_echoed(client: httpx.AsyncClient) -> None:
    body = {**request_body(), SOURCE_TEXT[:50]: "oops"}

    response = await client.post(STREAM_URL, params={"mock": "1"}, json=body)

    assert response.status_code == 422
    assert response.json()["error"]["message"] == "body: Extra inputs are not permitted"


async def test_episode_count_must_be_an_integer(client: httpx.AsyncClient) -> None:
    response = await client.post(STREAM_URL, params={"mock": "1"}, json={**request_body(), "episode_count": True})

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "bad_input"


async def test_stream_flushes_each_line_over_a_real_socket(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(fixture_replay, "REPLAY_INTERVAL_S", 0.2)
    listener = socket.create_server(("127.0.0.1", 0))
    port = listener.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(create_app(), log_level="warning", timeout_graceful_shutdown=1))
    serving = asyncio.create_task(server.serve(sockets=[listener]))
    stamps: list[float] = []
    started = time.perf_counter()
    try:
        async with (
            httpx.AsyncClient(base_url=f"http://127.0.0.1:{port}") as http,
            http.stream("POST", STREAM_URL, params={"mock": "1"}, json=request_body()) as response,
        ):
            async for _ in response.aiter_lines():
                stamps.append(time.perf_counter())
                if len(stamps) == 3:
                    break
    finally:
        server.should_exit = True
        await serving

    assert stamps[0] - started < 0.15
    assert stamps[1] - stamps[0] >= 0.18
    assert stamps[2] - stamps[1] >= 0.18
