from app.schemas.contract import ErrorBody, ErrorCode


class AppError(Exception):
    code: ErrorCode = "internal"
    status_code: int = 500
    retryable: bool = False

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message

    def to_body(self) -> ErrorBody:
        return ErrorBody(code=self.code, message=self.message, retryable=self.retryable)


class SourceTooLongError(AppError):
    code: ErrorCode = "too_long"
    status_code = 413


class RateLimitedError(AppError):
    code: ErrorCode = "rate_limited"
    status_code = 429
    retryable = True


class LlmUnavailableError(AppError):
    code: ErrorCode = "llm_unavailable"
    status_code = 503
    retryable = True


class ProviderRateLimitedError(Exception):
    pass


class ProviderUnavailableError(Exception):
    pass


class ProviderNotConfiguredError(Exception):
    pass


class VoiceError(Exception):
    pass


class PictureError(Exception):
    pass
