from functools import cache
from pathlib import Path
from typing import Annotated

from pydantic import BeforeValidator, Field, SecretStr
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[1]
CONTRACTS_DIR = BACKEND_DIR.parent / "contracts"
PROMPTS_DIR = BACKEND_DIR / "app" / "prompts"


def split_comma(value: object) -> object:
    if isinstance(value, str):
        return [item.strip() for item in value.split(",") if item.strip()]
    return value


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BACKEND_DIR / ".env", env_file_encoding="utf-8", env_ignore_empty=True, extra="ignore"
    )

    gemini_api_key: SecretStr | None = None
    gemini_model: str = "gemini-3.5-flash-lite"
    groq_api_key: SecretStr | None = None
    groq_model: str = "openai/gpt-oss-120b"
    pexels_api_key: SecretStr | None = None
    allowed_origins: Annotated[list[str], NoDecode, BeforeValidator(split_comma)] = []
    max_source_chars: int = Field(default=60_000, gt=0)


@cache
def get_settings() -> Settings:
    return Settings()
