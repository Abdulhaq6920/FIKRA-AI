"""
Groq LLM provider integration.

This module is the ONLY place in the application that talks to Groq.
Everything Groq-specific — request format, response parsing, streaming,
error mapping — lives here and nowhere else.

The API key is loaded from settings and never logged or exposed.

Error handling:
- Rate limit (429)  → ProviderRateLimitError (retried by caller with backoff)
- Timeout           → ProviderUnavailableError
- 5xx              → ProviderUnavailableError
- 4xx (bad request) → not retried
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import AsyncGenerator
from dataclasses import dataclass

import groq
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from langchain_groq import ChatGroq

from app.core.config import settings
from app.core.exceptions import (
    AppError,
    ProviderRateLimitError,
    ProviderUnavailableError,
)
from app.core.logging import get_logger

logger = get_logger(__name__)

# Semaphore to bound concurrent Groq requests
_groq_semaphore = asyncio.Semaphore(settings.groq_max_concurrent_requests)

# Retry policy for transient provider failures. Each round tries the primary
# model and then the fallback model before waiting: Groq applies limits per
# model, so the fallback often answers immediately when the primary is
# throttled. Later rounds back off to let the primary token bucket refill.
_MAX_RETRY_ROUNDS = 3
_RETRY_BASE_SECONDS = 2.0
_RETRY_MAX_SECONDS = 10.0


def _model_chain(primary: str, fallback: str | None) -> list[str]:
    """Primary model first, then the configured fallback (if different)."""
    models = [primary]
    if fallback and fallback != primary:
        models.append(fallback)
    return models


def _retry_delay(exc: BaseException, attempt: int) -> float:
    """Honor Retry-After when present, otherwise use capped exponential backoff."""
    response = getattr(exc, "response", None)
    headers = getattr(response, "headers", None)
    retry_after = None
    if headers is not None:
        try:
            retry_after = headers.get("retry-after")
        except (AttributeError, TypeError):
            retry_after = None
    if retry_after:
        try:
            return min(max(float(retry_after), 0.5), _RETRY_MAX_SECONDS)
        except (TypeError, ValueError):
            pass
    return min(_RETRY_BASE_SECONDS * (2**attempt), _RETRY_MAX_SECONDS)


@dataclass
class UsageMetadata:
    model: str
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0
    latency_ms: int = 0
    error_category: str | None = None


@dataclass
class GenerationResult:
    content: str
    usage: UsageMetadata
    finish_reason: str = "stop"


@dataclass
class ChatMessage:
    role: str   # "user" | "assistant" | "system"
    content: str


def _is_retryable(exc: BaseException) -> bool:
    """Return True only for transient errors that should be retried."""
    if isinstance(exc, groq.RateLimitError):
        return True
    if isinstance(exc, groq.APIConnectionError | groq.APITimeoutError):
        return True
    if isinstance(exc, groq.APIStatusError) and exc.status_code >= 500:
        return True
    return False


def _map_groq_error(exc: Exception) -> AppError:
    """Map a Groq SDK exception to an application exception."""
    if isinstance(exc, groq.RateLimitError):
        logger.warning("groq_rate_limit", model=settings.groq_primary_model)
        return ProviderRateLimitError()
    if isinstance(exc, groq.APIConnectionError | groq.APITimeoutError):
        logger.warning("groq_connection_error", error=str(exc))
        return ProviderUnavailableError()
    if isinstance(exc, groq.APIStatusError):
        body_str = str(exc.body)[:300] if exc.body else ""
        logger.error("groq_api_error", status=exc.status_code, body=body_str)
        if exc.status_code == 400:
            # Bad request — likely invalid model or bad input
            return ProviderUnavailableError(
                f"Provider rejected the request (HTTP 400). "
                f"This often means the model ID is invalid or decommissioned. "
                f"Check GROQ_PRIMARY_MODEL in .env. Detail: {body_str[:200]}"
            )
        return ProviderUnavailableError(f"Provider error: {exc.status_code}")
    logger.exception("groq_unexpected_error", exc_info=exc)
    return ProviderUnavailableError()


class GroqClient:
    """
    Thin, focused wrapper around the Groq Python SDK.

    Responsibilities:
    - Build and send chat completion requests
    - Stream responses
    - Handle retries with exponential back-off
    - Track and return usage metadata
    - Never expose the API key or auth headers

    Does NOT know about tenants, conversations, or RAG context.
    Those concerns belong in the chat/rag services.
    """

    def __init__(self) -> None:
        if not settings.groq_api_key:
            raise RuntimeError(
                "GROQ_API_KEY is not configured. "
                "Set it in .env before starting the application."
            )
        # LangChain owns provider invocation and message interoperability;
        # this wrapper retains the application's error and usage contracts.
        self._llm = ChatGroq(
            model=settings.groq_primary_model,
            api_key=settings.groq_api_key,
            timeout=settings.groq_timeout_seconds,
            max_retries=0,
            temperature=settings.groq_temperature,
            max_tokens=settings.groq_max_tokens,
        )
        self._primary_model = settings.groq_primary_model
        self._fallback_model = settings.groq_fallback_model

    async def generate(
        self,
        messages: list[ChatMessage | BaseMessage],
        *,
        model: str | None = None,
        max_tokens: int | None = None,
        temperature: float | None = None,
        system_prompt: str | None = None,
    ) -> GenerationResult:
        """
        Generate a chat completion (non-streaming).

        Retries transient failures with backoff, then tries the fallback model.

        Args:
            messages:      Conversation history (recent messages only).
            model:         Override the primary model.
            max_tokens:    Token budget for the response.
            temperature:   Sampling temperature (lower = more deterministic).
            system_prompt: System instruction prepended to the message list.

        Returns:
            GenerationResult with content and usage metadata.
        """
        target_model = model or self._primary_model
        all_messages = self._build_messages(messages, system_prompt)
        models = _model_chain(target_model, self._fallback_model)
        last_error: AppError | None = None
        last_retry_exc: BaseException | None = None

        for round_index in range(_MAX_RETRY_ROUNDS):
            retryable_failure = False
            for candidate in models:
                if candidate != target_model:
                    logger.info("groq_fallback_attempt", model=candidate)
                llm = self._llm.bind(
                    model=candidate,
                    max_tokens=max_tokens or settings.groq_max_tokens,
                    temperature=(
                        temperature
                        if temperature is not None
                        else settings.groq_temperature
                    ),
                )
                start = time.perf_counter()
                try:
                    async with _groq_semaphore:
                        response = await llm.ainvoke(all_messages)
                except Exception as exc:
                    last_error = _map_groq_error(exc)
                    if _is_retryable(exc):
                        retryable_failure = True
                        last_retry_exc = exc
                    continue

                latency_ms = int((time.perf_counter() - start) * 1000)
                usage = response.usage_metadata or {}
                result = GenerationResult(
                    content=str(response.content or ""),
                    finish_reason=response.response_metadata.get("finish_reason", "stop"),
                    usage=UsageMetadata(
                        model=response.response_metadata.get("model_name", candidate),
                        input_tokens=usage.get("input_tokens", 0),
                        output_tokens=usage.get("output_tokens", 0),
                        total_tokens=usage.get("total_tokens", 0),
                        latency_ms=latency_ms,
                    ),
                )
                logger.info(
                    "groq_generate",
                    model=candidate,
                    input_tokens=result.usage.input_tokens,
                    output_tokens=result.usage.output_tokens,
                    latency_ms=latency_ms,
                    finish_reason=result.finish_reason,
                )
                return result

            if not retryable_failure or last_retry_exc is None:
                break
            if round_index + 1 < _MAX_RETRY_ROUNDS:
                delay = _retry_delay(last_retry_exc, round_index)
                logger.warning(
                    "groq_generate_retry",
                    models=models,
                    round=round_index + 1,
                    delay_seconds=delay,
                    error=type(last_retry_exc).__name__,
                )
                await asyncio.sleep(delay)

        raise last_error or ProviderUnavailableError()

    async def generate_stream(
        self,
        messages: list[ChatMessage | BaseMessage],
        *,
        model: str | None = None,
        max_tokens: int | None = None,
        temperature: float | None = None,
        system_prompt: str | None = None,
    ) -> AsyncGenerator[str, None]:
        """
        Generate a streaming chat completion.

        Yields text delta chunks as they arrive from Groq. Transient failures
        before the first token are retried, then the fallback model is tried.
        Once tokens have been yielded we never retry, to avoid duplicating a
        partial answer.
        """
        target_model = model or self._primary_model
        all_messages = self._build_messages(messages, system_prompt)
        models = _model_chain(target_model, self._fallback_model)
        last_error: AppError | None = None
        last_retry_exc: BaseException | None = None

        for round_index in range(_MAX_RETRY_ROUNDS):
            retryable_failure = False
            for candidate in models:
                if candidate != target_model:
                    logger.info("groq_fallback_attempt", model=candidate)
                llm = self._llm.bind(
                    model=candidate,
                    max_tokens=max_tokens or settings.groq_max_tokens,
                    temperature=(
                        temperature
                        if temperature is not None
                        else settings.groq_temperature
                    ),
                )
                yielded = False
                try:
                    async with _groq_semaphore:
                        async for chunk in llm.astream(all_messages):
                            delta = chunk.content
                            if delta:
                                yielded = True
                                yield str(delta)
                    return
                except Exception as exc:
                    last_error = _map_groq_error(exc)
                    if yielded:
                        # Never replay a partial answer.
                        raise last_error from exc
                    if _is_retryable(exc):
                        retryable_failure = True
                        last_retry_exc = exc
                    continue

            if not retryable_failure or last_retry_exc is None:
                break
            if round_index + 1 < _MAX_RETRY_ROUNDS:
                delay = _retry_delay(last_retry_exc, round_index)
                logger.warning(
                    "groq_stream_retry",
                    models=models,
                    round=round_index + 1,
                    delay_seconds=delay,
                    error=type(last_retry_exc).__name__,
                )
                await asyncio.sleep(delay)

        raise last_error or ProviderUnavailableError()

    async def health_check(self) -> bool:
        """
        Verify that the Groq API is reachable with a minimal request.

        Returns True if healthy, False otherwise.
        Does NOT raise — callers check the return value.
        """
        try:
            result = await self.generate(
                messages=[ChatMessage(role="user", content="ping")],
                max_tokens=5,
                system_prompt="Reply with 'ok'.",
            )
            return bool(result.content)
        except Exception as exc:
            logger.warning("groq_health_check_failed", error=str(exc))
            return False

    @staticmethod
    def _build_messages(
        messages: list[ChatMessage | BaseMessage],
        system_prompt: str | None,
    ) -> list[BaseMessage]:
        """
        Build the message list in the format expected by the Groq API.

        The system prompt always comes first if provided.
        Document content is treated as context in the user/system messages —
        never trusted as instructions to the model.
        """
        result: list[BaseMessage] = []
        if system_prompt:
            result.append(SystemMessage(content=system_prompt))
        for msg in messages:
            if isinstance(msg, BaseMessage):
                result.append(msg)
            elif msg.role == "system":
                result.append(SystemMessage(content=msg.content))
            elif msg.role == "assistant":
                result.append(AIMessage(content=msg.content))
            else:
                result.append(HumanMessage(content=msg.content))
        return result


# Module-level singleton — initialized once at import time
_groq_client: GroqClient | None = None


def get_groq_client() -> GroqClient:
    """Return the application-level GroqClient singleton."""
    global _groq_client
    if _groq_client is None:
        _groq_client = GroqClient()
    return _groq_client
