"""Local Ollama chat provider using Ollama's native HTTP API."""

from __future__ import annotations

import asyncio
import json
import time
from collections.abc import AsyncGenerator, Sequence
from typing import Any

import httpx
from langchain_core.messages import BaseMessage

from app.core.config import settings
from app.core.exceptions import ProviderUnavailableError
from app.core.logging import get_logger
from app.providers.llm import ChatMessage, GenerationResult, UsageMetadata

logger = get_logger(__name__)
_ollama_semaphore = asyncio.Semaphore(settings.ollama_max_concurrent_requests)


def _serialize_messages(
    messages: Sequence[ChatMessage | BaseMessage],
    system_prompt: str | None,
) -> list[dict[str, str]]:
    result: list[dict[str, str]] = []
    if system_prompt:
        result.append({"role": "system", "content": system_prompt})
    for message in messages:
        if isinstance(message, BaseMessage):
            role = {"human": "user", "ai": "assistant"}.get(message.type, message.type)
            content = message.content
        else:
            role = message.role
            content = message.content
        result.append({"role": role, "content": str(content)})
    return result


class OllamaClient:
    """Ollama implementation of the shared chat model interface."""

    def __init__(self) -> None:
        self._base_url = str(settings.ollama_base_url).rstrip("/")
        self._model = settings.ollama_model
        self._timeout = settings.ollama_timeout_seconds

    def _payload(
        self,
        messages: Sequence[ChatMessage | BaseMessage],
        *,
        model: str | None,
        max_tokens: int | None,
        temperature: float | None,
        system_prompt: str | None,
        stream: bool,
    ) -> dict[str, Any]:
        options: dict[str, int | float] = {
            "num_predict": max_tokens or settings.ollama_max_tokens,
            "temperature": (
                temperature if temperature is not None else settings.ollama_temperature
            ),
        }
        return {
            "model": model or self._model,
            "messages": _serialize_messages(messages, system_prompt),
            "stream": stream,
            "options": options,
        }

    async def generate(
        self,
        messages: Sequence[ChatMessage | BaseMessage],
        *,
        model: str | None = None,
        max_tokens: int | None = None,
        temperature: float | None = None,
        system_prompt: str | None = None,
    ) -> GenerationResult:
        payload = self._payload(
            messages,
            model=model,
            max_tokens=max_tokens,
            temperature=temperature,
            system_prompt=system_prompt,
            stream=False,
        )
        started = time.perf_counter()
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                async with _ollama_semaphore:
                    response = await client.post(f"{self._base_url}/api/chat", json=payload)
            response.raise_for_status()
            body = response.json()
        except httpx.HTTPStatusError as exc:
            logger.error("ollama_http_error", status=exc.response.status_code)
            raise ProviderUnavailableError() from exc
        except httpx.RequestError as exc:
            logger.warning("ollama_connection_error", error=type(exc).__name__)
            raise ProviderUnavailableError() from exc
        except ValueError as exc:
            logger.error("ollama_invalid_response")
            raise ProviderUnavailableError() from exc

        if not isinstance(body, dict):
            logger.error("ollama_invalid_response")
            raise ProviderUnavailableError()
        if body.get("error"):
            logger.error("ollama_request_error", error=str(body["error"])[:300])
            raise ProviderUnavailableError()
        message = body.get("message")
        if not isinstance(message, dict) or not isinstance(message.get("content"), str):
            logger.error("ollama_invalid_response")
            raise ProviderUnavailableError()

        input_tokens = _token_count(body.get("prompt_eval_count"))
        output_tokens = _token_count(body.get("eval_count"))
        result = GenerationResult(
            content=message["content"],
            finish_reason=str(body.get("done_reason") or "stop"),
            usage=UsageMetadata(
                model=str(body.get("model") or payload["model"]),
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                total_tokens=input_tokens + output_tokens,
                latency_ms=int((time.perf_counter() - started) * 1000),
            ),
        )
        logger.info(
            "ollama_generate",
            model=result.usage.model,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            latency_ms=result.usage.latency_ms,
            finish_reason=result.finish_reason,
        )
        return result

    async def generate_stream(
        self,
        messages: list[ChatMessage | BaseMessage],
        *,
        model: str | None = None,
        max_tokens: int | None = None,
        temperature: float | None = None,
        system_prompt: str | None = None,
    ) -> AsyncGenerator[str, None]:
        payload = self._payload(
            messages,
            model=model,
            max_tokens=max_tokens,
            temperature=temperature,
            system_prompt=system_prompt,
            stream=True,
        )
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                async with _ollama_semaphore:
                    async with client.stream(
                        "POST", f"{self._base_url}/api/chat", json=payload
                    ) as response:
                        response.raise_for_status()
                        async for line in response.aiter_lines():
                            if not line:
                                continue
                            try:
                                body = json.loads(line)
                            except json.JSONDecodeError as exc:
                                logger.error("ollama_invalid_stream_response")
                                raise ProviderUnavailableError() from exc
                            if not isinstance(body, dict):
                                logger.error("ollama_invalid_stream_response")
                                raise ProviderUnavailableError()
                            if body.get("error"):
                                logger.error("ollama_request_error", error=str(body["error"])[:300])
                                raise ProviderUnavailableError()
                            message = body.get("message")
                            if isinstance(message, dict) and message.get("content"):
                                yield str(message["content"])
        except httpx.HTTPStatusError as exc:
            logger.error("ollama_http_error", status=exc.response.status_code)
            raise ProviderUnavailableError() from exc
        except httpx.RequestError as exc:
            logger.warning("ollama_connection_error", error=type(exc).__name__)
            raise ProviderUnavailableError() from exc

    async def health_check(self) -> bool:
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                response = await client.get(f"{self._base_url}/api/tags")
            response.raise_for_status()
        except httpx.HTTPError as exc:
            logger.warning("ollama_health_check_failed", error=type(exc).__name__)
            return False
        return True


def _token_count(value: Any) -> int:
    return value if isinstance(value, int) and value >= 0 else 0
