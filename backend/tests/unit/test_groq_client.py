"""Unit tests for Groq retry and fallback behaviour.

These tests never touch the network: the LangChain runnable is replaced with a
small fake so the provider wrapper's retry policy can be exercised directly.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import groq
import httpx
import pytest

from app.core.exceptions import ProviderRateLimitError
from app.providers import groq_client as groq_module
from app.providers.groq_client import ChatMessage, GroqClient

PRIMARY = "primary-model"
FALLBACK = "fallback-model"


def _rate_limit_error() -> groq.RateLimitError:
    request = httpx.Request("POST", "https://api.groq.com/openai/v1/chat/completions")
    return groq.RateLimitError(
        "rate limited",
        response=httpx.Response(429, request=request),
        body=None,
    )


class _FakeRunnable:
    """Minimal stand-in for a LangChain chat runnable."""

    def __init__(
        self,
        handler: Any,
        calls: list[str],
        *,
        stream: bool,
    ) -> None:
        self._handler = handler
        self._calls = calls
        self._stream = stream
        self.model: str | None = None

    def bind(self, **kwargs: Any) -> _FakeRunnable:
        self.model = kwargs.get("model")
        return self

    async def astream(self, _messages: list[Any]) -> Any:
        assert self.model is not None
        self._calls.append(self.model)
        for piece in self._handler(self.model):
            if isinstance(piece, BaseException):
                raise piece
            yield SimpleNamespace(content=piece)

    async def ainvoke(self, _messages: list[Any]) -> SimpleNamespace:
        assert self.model is not None
        self._calls.append(self.model)
        result = self._handler(self.model)
        if isinstance(result, BaseException):
            raise result
        return SimpleNamespace(
            content=result,
            usage_metadata={"input_tokens": 10, "output_tokens": 5, "total_tokens": 15},
            response_metadata={"finish_reason": "stop", "model_name": self.model},
        )


def _make_client(handler: Any, calls: list[str], *, stream: bool) -> GroqClient:
    client = GroqClient.__new__(GroqClient)
    client._llm = _FakeRunnable(handler, calls, stream=stream)  # type: ignore[assignment]
    client._primary_model = PRIMARY
    client._fallback_model = FALLBACK
    return client


@pytest.fixture(autouse=True)
def _no_sleep(monkeypatch: pytest.MonkeyPatch) -> list[float]:
    delays: list[float] = []

    async def fake_sleep(seconds: float) -> None:
        delays.append(seconds)

    monkeypatch.setattr(groq_module.asyncio, "sleep", fake_sleep)
    return delays


async def _collect(client: GroqClient) -> str:
    pieces: list[str] = []
    async for piece in client.generate_stream(messages=[ChatMessage(role="user", content="hello")]):
        pieces.append(piece)
    return "".join(pieces)


class TestGenerateStreamFallback:
    async def test_falls_back_immediately_without_sleeping(self, _no_sleep: list[float]) -> None:
        calls: list[str] = []

        def handler(model: str) -> list[Any]:
            if model == PRIMARY:
                return [_rate_limit_error()]
            return ["hello", " world"]

        client = _make_client(handler, calls, stream=True)

        assert await _collect(client) == "hello world"
        assert calls == [PRIMARY, FALLBACK]
        assert _no_sleep == []

    async def test_retries_both_models_then_raises(self, _no_sleep: list[float]) -> None:
        calls: list[str] = []

        def handler(_model: str) -> list[Any]:
            return [_rate_limit_error()]

        client = _make_client(handler, calls, stream=True)

        with pytest.raises(ProviderRateLimitError):
            await _collect(client)

        rounds = groq_module._MAX_RETRY_ROUNDS
        assert calls == [PRIMARY, FALLBACK] * rounds
        # One backoff between each round, none after the final failure.
        assert len(_no_sleep) == rounds - 1

    async def test_never_replays_a_partial_stream(self, _no_sleep: list[float]) -> None:
        calls: list[str] = []

        def handler(_model: str) -> list[Any]:
            return ["partial ", _rate_limit_error()]

        client = _make_client(handler, calls, stream=True)

        with pytest.raises(ProviderRateLimitError):
            await _collect(client)

        assert calls == [PRIMARY]
        assert _no_sleep == []


class TestGenerateFallback:
    async def test_generate_uses_fallback_model(self, _no_sleep: list[float]) -> None:
        calls: list[str] = []

        def handler(model: str) -> Any:
            if model == PRIMARY:
                return _rate_limit_error()
            return "fallback answer"

        client = _make_client(handler, calls, stream=False)
        result = await client.generate(messages=[ChatMessage(role="user", content="hello")])

        assert result.content == "fallback answer"
        assert result.usage.model == FALLBACK
        assert calls == [PRIMARY, FALLBACK]
        assert _no_sleep == []
