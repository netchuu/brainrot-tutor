import logging
from collections.abc import Awaitable, Callable
from typing import Any

import httpx
from google import genai
from google.genai import errors as genai_errors
from google.genai import types as genai_types
from groq import APIConnectionError, APIStatusError, AsyncGroq
from pydantic import BaseModel, ValidationError

from app.config import get_settings
from app.errors import (
    LlmUnavailableError,
    ProviderNotConfiguredError,
    ProviderRateLimitedError,
    ProviderUnavailableError,
    RateLimitedError,
)

logger = logging.getLogger(__name__)

LLM_TIMEOUT_S = 30
ProviderCall = Callable[[str, str, dict[str, Any]], Awaitable[str]]


async def call_gemini(system: str, prompt: str, schema: dict[str, Any]) -> str:
    settings = get_settings()
    if settings.gemini_api_key is None:
        raise ProviderNotConfiguredError("GEMINI_API_KEY is not set")
    config = genai_types.GenerateContentConfig(
        system_instruction=system,
        response_mime_type="application/json",
        response_json_schema=schema,
        thinking_config=genai_types.ThinkingConfig(thinking_level=genai_types.ThinkingLevel.MINIMAL),
    )
    try:
        # An explicit httpx client stops the SDK from switching to aiohttp, which edge-tts installs.
        async with httpx.AsyncClient(timeout=LLM_TIMEOUT_S) as http:
            http_options = genai_types.HttpOptions(timeout=LLM_TIMEOUT_S * 1000, httpx_async_client=http)
            client = genai.Client(api_key=settings.gemini_api_key.get_secret_value(), http_options=http_options)
            response = await client.aio.models.generate_content(
                model=settings.gemini_model, contents=prompt, config=config
            )
    except genai_errors.APIError as exc:
        if exc.code == 429:
            raise ProviderRateLimitedError("Gemini answered 429") from exc
        raise ProviderUnavailableError(f"Gemini answered {exc.code}") from exc
    except httpx.TransportError as exc:
        raise ProviderUnavailableError(f"Gemini request failed: {type(exc).__name__}") from exc
    if not response.text:
        raise ProviderUnavailableError("Gemini returned no text")
    return response.text


async def call_groq(system: str, prompt: str, schema: dict[str, Any]) -> str:
    settings = get_settings()
    if settings.groq_api_key is None:
        raise ProviderNotConfiguredError("GROQ_API_KEY is not set")
    try:
        async with AsyncGroq(
            api_key=settings.groq_api_key.get_secret_value(), timeout=LLM_TIMEOUT_S, max_retries=0
        ) as client:
            completion = await client.chat.completions.create(
                model=settings.groq_model,
                messages=[{"role": "system", "content": system}, {"role": "user", "content": prompt}],
                response_format={
                    "type": "json_schema",
                    "json_schema": {"name": schema.get("title", "response"), "schema": schema, "strict": True},
                },
            )
    except APIStatusError as exc:
        if exc.status_code == 429:
            raise ProviderRateLimitedError("Groq answered 429") from exc
        raise ProviderUnavailableError(f"Groq answered {exc.status_code}") from exc
    except APIConnectionError as exc:
        raise ProviderUnavailableError(f"Groq request failed: {type(exc).__name__}") from exc
    content = completion.choices[0].message.content if completion.choices else None
    if not content:
        raise ProviderUnavailableError("Groq returned no content")
    return content


PROVIDERS: tuple[tuple[str, ProviderCall], ...] = (("gemini", call_gemini), ("groq", call_groq))


def describe_errors(exc: ValidationError) -> str:
    return "\n".join(
        f"- {'.'.join(str(part) for part in error['loc']) or 'root'}: {error['msg']}"
        for error in exc.errors(include_input=False)
    )


async def generate_with[T: BaseModel](call: ProviderCall, system: str, prompt: str, model: type[T]) -> T:
    schema = model.model_json_schema()
    text = await call(system, prompt, schema)
    try:
        return model.model_validate_json(text)
    except ValidationError as exc:
        problems = describe_errors(exc)
    logger.warning("%s output failed validation, asking once to repair it", model.__name__)
    repair = (
        f"{prompt}\n\nYour previous answer was:\n{text}\n\n"
        f"It failed validation:\n{problems}\nReturn the corrected JSON only."
    )
    text = await call(system, repair, schema)
    try:
        return model.model_validate_json(text)
    except ValidationError as exc:
        raise ProviderUnavailableError(f"invalid {model.__name__} after one repair") from exc


async def generate_json[T: BaseModel](system: str, prompt: str, model: type[T]) -> T:
    outcomes: list[str] = []
    for name, call in PROVIDERS:
        try:
            return await generate_with(call, system, prompt, model)
        except ProviderRateLimitedError:
            outcomes.append("rate_limited")
            logger.warning("%s is rate limited, trying the next provider", name)
        except ProviderNotConfiguredError as exc:
            outcomes.append("not_configured")
            logger.warning("%s skipped: %s", name, exc)
        except ProviderUnavailableError as exc:
            outcomes.append("unavailable")
            logger.warning("%s unavailable: %s", name, exc)
    if "rate_limited" in outcomes and "unavailable" not in outcomes:
        raise RateLimitedError("The AI providers are busy right now. Try again in a minute.")
    raise LlmUnavailableError("The AI providers are unavailable right now. Try again.")
