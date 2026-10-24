from collections.abc import AsyncIterator, Iterator

import httpx
import pytest

from app.config import CONTRACTS_DIR, Settings, get_settings
from app.main import create_app

FIXTURES_DIR = CONTRACTS_DIR / "fixtures"
SOURCE_TEXT = (FIXTURES_DIR / "source.txt").read_text(encoding="utf-8")
CONFIG_ENV = (
    "GEMINI_API_KEY",
    "GEMINI_MODEL",
    "GROQ_API_KEY",
    "GROQ_MODEL",
    "PEXELS_API_KEY",
    "ALLOWED_ORIGINS",
    "MAX_SOURCE_CHARS",
    "VOICE_RU",
    "VOICE_EN",
)
TEST_ORIGINS = "http://localhost:5173,https://brainrot.example"


@pytest.fixture(autouse=True)
def isolated_settings(request: pytest.FixtureRequest, monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    if request.node.get_closest_marker("live") is None:
        monkeypatch.setitem(Settings.model_config, "env_file", None)
        for name in CONFIG_ENV:
            monkeypatch.delenv(name, raising=False)
        monkeypatch.setenv("ALLOWED_ORIGINS", TEST_ORIGINS)
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture
async def client() -> AsyncIterator[httpx.AsyncClient]:
    transport = httpx.ASGITransport(app=create_app(), raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as http:
        yield http
