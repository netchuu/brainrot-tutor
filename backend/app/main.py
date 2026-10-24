import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.episodes import router as episodes_router
from app.api.health import router as health_router
from app.api.quiz import router as quiz_router
from app.api.tutor import router as tutor_router
from app.config import get_settings
from app.errors import AppError
from app.schemas.contract import ErrorBody, ErrorResponse

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)


def error_response(status_code: int, body: ErrorBody, headers: dict[str, str] | None = None) -> JSONResponse:
    content = ErrorResponse(error=body).model_dump(mode="json")
    return JSONResponse(status_code=status_code, content=content, headers=headers)


def cors_headers(request: Request) -> dict[str, str]:
    origin = request.headers.get("origin")
    if origin is not None and origin in get_settings().allowed_origins:
        return {"Access-Control-Allow-Origin": origin, "Vary": "Origin"}
    return {}


async def handle_app_error(request: Request, exc: AppError) -> JSONResponse:
    return error_response(exc.status_code, exc.to_body())


async def handle_validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
    errors = exc.errors()
    if any(error["type"] == "string_too_long" and tuple(error["loc"]) == ("body", "source_text") for error in errors):
        message = "source_text is longer than 60000 characters"
        return error_response(413, ErrorBody(code="too_long", message=message, retryable=False))
    # The message names the field and rule only, never the input; an unexpected key is client input, so it is dropped.
    first = errors[0]
    loc = first["loc"][:-1] if first["type"] == "extra_forbidden" else first["loc"]
    location = ".".join(str(part) for part in loc)
    return error_response(422, ErrorBody(code="bad_input", message=f"{location}: {first['msg']}", retryable=False))


async def handle_unexpected_error(request: Request, exc: Exception) -> JSONResponse:
    logger.error("unhandled %s on %s %s", type(exc).__name__, request.method, request.url.path)
    body = ErrorBody(code="internal", message="Internal server error", retryable=False)
    # ServerErrorMiddleware sits outside CORSMiddleware, so a 500 must carry the CORS header itself.
    return error_response(500, body, cors_headers(request))


def create_app() -> FastAPI:
    settings = get_settings()
    application = FastAPI(title="Brainrot Tutor API")
    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
    )
    application.exception_handler(AppError)(handle_app_error)
    application.exception_handler(RequestValidationError)(handle_validation_error)
    # The contract requires the ErrorResponse shape on every 5xx; Starlette still re-raises and logs the traceback.
    application.exception_handler(Exception)(handle_unexpected_error)
    application.include_router(health_router)
    application.include_router(episodes_router)
    application.include_router(quiz_router)
    application.include_router(tutor_router)
    return application


app = create_app()
