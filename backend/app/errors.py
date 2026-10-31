from typing import Dict, Optional

import structlog
from fastapi import Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

logger = structlog.get_logger()


class AppException(Exception):
    def __init__(
        self,
        message: str,
        code: str = "BAD_REQUEST",
        status_code: int = status.HTTP_400_BAD_REQUEST,
        fields: Optional[Dict[str, str]] = None,
    ):
        super().__init__(message)
        self.message = message
        self.code = code
        self.status_code = status_code
        self.fields = fields or {}


class NotFoundError(AppException):
    def __init__(self, message: str = "Resource not found", fields: Optional[Dict[str, str]] = None):
        super().__init__(
            message=message,
            code="NOT_FOUND",
            status_code=status.HTTP_404_NOT_FOUND,
            fields=fields,
        )


class ConflictError(AppException):
    def __init__(self, message: str, code: str = "CONFLICT", fields: Optional[Dict[str, str]] = None):
        super().__init__(
            message=message,
            code=code,
            status_code=status.HTTP_409_CONFLICT,
            fields=fields,
        )


class IllegalTransitionError(ConflictError):
    def __init__(self, message: str):
        super().__init__(message=message, code="ILLEGAL_TRANSITION")


class UnauthorizedError(AppException):
    def __init__(self, message: str = "Authentication required"):
        super().__init__(
            message=message,
            code="UNAUTHORIZED",
            status_code=status.HTTP_401_UNAUTHORIZED,
        )


class ForbiddenError(AppException):
    def __init__(self, message: str = "Permission denied"):
        super().__init__(
            message=message,
            code="FORBIDDEN",
            status_code=status.HTTP_403_FORBIDDEN,
        )


HTTP_422 = getattr(status, "HTTP_422_UNPROCESSABLE_CONTENT", 422)


class ValidationError(AppException):
    def __init__(self, message: str = "Validation failed", fields: Optional[Dict[str, str]] = None):
        super().__init__(
            message=message,
            code="VALIDATION_ERROR",
            status_code=HTTP_422,
            fields=fields,
        )


async def app_exception_handler(request: Request, exc: AppException) -> JSONResponse:
    request_id = getattr(request.state, "request_id", "")
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "code": exc.code,
            "message": exc.message,
            "fields": exc.fields,
            "request_id": request_id,
        },
    )


async def validation_exception_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    request_id = getattr(request.state, "request_id", "")
    fields: Dict[str, str] = {}
    for err in exc.errors():
        loc = ".".join(str(x) for x in err.get("loc", []) if x != "body")
        msg = err.get("msg", "Invalid value")
        fields[loc or "non_field"] = msg

    return JSONResponse(
        status_code=HTTP_422,
        content={
            "code": "VALIDATION_ERROR",
            "message": "Input validation failed",
            "fields": fields,
            "request_id": request_id,
        },
    )


async def generic_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    request_id = getattr(request.state, "request_id", "")
    logger.exception("unhandled_server_error", exc_info=exc, request_id=request_id)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "code": "INTERNAL_SERVER_ERROR",
            "message": "An unexpected server error occurred",
            "fields": {},
            "request_id": request_id,
        },
    )
