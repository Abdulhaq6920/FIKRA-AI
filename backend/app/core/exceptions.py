"""
Centralized application exceptions.

Every exception here maps to a specific HTTP status code.
Handlers in middleware.py translate these into safe JSON responses
that never expose stack traces or internal details to clients.
"""

from __future__ import annotations

from http import HTTPStatus


class AppError(Exception):
    """Base class for all application exceptions."""

    status_code: int = HTTPStatus.INTERNAL_SERVER_ERROR
    error_code: str = "INTERNAL_ERROR"
    message: str = "An unexpected error occurred."

    def __init__(self, message: str | None = None, **context: object) -> None:
        self.message = message or self.__class__.message
        self.context = context
        super().__init__(self.message)


# ------------------------------------------------------------------
# 400 Bad Request
# ------------------------------------------------------------------
class ValidationError(AppError):
    status_code = 400
    error_code = "VALIDATION_ERROR"
    message = "Request validation failed."


class InvalidFileType(AppError):
    status_code = 400
    error_code = "INVALID_FILE_TYPE"
    message = "The uploaded file type is not supported."


class FileTooLarge(AppError):
    status_code = 400
    error_code = "FILE_TOO_LARGE"
    message = "The uploaded file exceeds the maximum allowed size."


# ------------------------------------------------------------------
# 401 Unauthorized
# ------------------------------------------------------------------
class AuthenticationError(AppError):
    status_code = 401
    error_code = "AUTHENTICATION_FAILED"
    message = "Authentication failed."


class TokenExpiredError(AppError):
    status_code = 401
    error_code = "TOKEN_EXPIRED"
    message = "Your session has expired. Please log in again."


class InvalidTokenError(AppError):
    status_code = 401
    error_code = "INVALID_TOKEN"
    message = "Invalid authentication token."


# ------------------------------------------------------------------
# 403 Forbidden
# ------------------------------------------------------------------
class PermissionDeniedError(AppError):
    status_code = 403
    error_code = "PERMISSION_DENIED"
    message = "You do not have permission to perform this action."


class TenantMismatchError(AppError):
    status_code = 403
    error_code = "TENANT_MISMATCH"
    message = "Access to this resource is not permitted."


# ------------------------------------------------------------------
# 404 Not Found
# ------------------------------------------------------------------
class NotFoundError(AppError):
    status_code = 404
    error_code = "NOT_FOUND"
    message = "The requested resource was not found."


class DocumentNotFoundError(NotFoundError):
    error_code = "DOCUMENT_NOT_FOUND"
    message = "Document not found."


class ConversationNotFoundError(NotFoundError):
    error_code = "CONVERSATION_NOT_FOUND"
    message = "Conversation not found."


class UserNotFoundError(NotFoundError):
    error_code = "USER_NOT_FOUND"
    message = "User not found."


class OrganizationNotFoundError(NotFoundError):
    error_code = "ORGANIZATION_NOT_FOUND"
    message = "Organization not found."


# ------------------------------------------------------------------
# 409 Conflict
# ------------------------------------------------------------------
class ConflictError(AppError):
    status_code = 409
    error_code = "CONFLICT"
    message = "A conflict occurred with the current state of the resource."


class EmailAlreadyExistsError(ConflictError):
    error_code = "EMAIL_ALREADY_EXISTS"
    message = "An account with this email address already exists."


# ------------------------------------------------------------------
# 422 Unprocessable
# ------------------------------------------------------------------
class DocumentProcessingError(AppError):
    status_code = 422
    error_code = "DOCUMENT_PROCESSING_ERROR"
    message = "Document processing failed."


# ------------------------------------------------------------------
# 429 Too Many Requests
# ------------------------------------------------------------------
class RateLimitExceededError(AppError):
    status_code = 429
    error_code = "RATE_LIMIT_EXCEEDED"
    message = "Too many requests. Please try again later."


# ------------------------------------------------------------------
# 503 Service Unavailable
# ------------------------------------------------------------------
class ProviderUnavailableError(AppError):
    status_code = 503
    error_code = "PROVIDER_UNAVAILABLE"
    message = "The AI provider is temporarily unavailable. Please try again."


class ProviderRateLimitError(AppError):
    status_code = 503
    error_code = "PROVIDER_RATE_LIMITED"
    message = "The AI provider rate limit was reached. Please try again shortly."
