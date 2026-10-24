import asyncio
from collections.abc import AsyncIterator

from app.config import CONTRACTS_DIR

EPISODE_FIXTURE = CONTRACTS_DIR / "fixtures" / "episode-stream.ndjson"
REPLAY_INTERVAL_S = 0.3


async def load_episode_fixture() -> list[str]:
    text = await asyncio.to_thread(EPISODE_FIXTURE.read_text, encoding="utf-8")
    return [line for line in text.split("\n") if line.strip()]


async def replay(lines: list[str]) -> AsyncIterator[str]:
    for number, line in enumerate(lines):
        if number:
            await asyncio.sleep(REPLAY_INTERVAL_S)
        yield line + "\n"
