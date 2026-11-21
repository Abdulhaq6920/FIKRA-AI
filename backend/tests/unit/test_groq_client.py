"""Unit tests for Groq retry and fallback behaviour.

These tests never touch the network: the Groq SDK client is replaced with a
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


class _FakeDelta:
    def __init__(self, content: Any) -> None:
        self.content = content


class _FakeChatStreamChunk:
    def __init__(self, delta_content: Any) -> None:
        self.choices = [SimpleNamespace(delta=_FakeDelta(delta_content))]


class _FakeAsyncStream:
    """Async iterator over streaming chunks."""

    def __init__(self, pieces: list[Any]) -> None:
        self._pieces = list(pieces)

    def __aiter__(self) -> _FakeAsyncStream:
        return self

    async def __anext__(self) -> Any:
        if not self._pieces:
            raise StopAsyncIteration
        piece = self._pieces.pop(0)
        if isinstance(piece, BaseException):
            raise piece
        return _FakeChatStreamChunk(piece)


class _FakeCompletionResponse:
    def __init__(self, content: str, model: str) -> None:
        self.choices = [
            SimpleNamespace(
                message=SimpleNamespace(content=content),
                finish_reason="stop",
            )
        ]
        self.model = model
        self.usage = SimpleNamespace(
            prompt_tokens=10,
            completion_tokens=5,
            total_tokens=15,
        )


class _FakeCompletions:
    """Minimal stand-in for AsyncGroq's chat.completions client."""

    def __init__(self, handler: Any, calls: list[str]) -> None:
        self._handler = handler
        self._calls = calls

    async def create(self, **kwargs: Any) -> Any:
        model = kwargs.get("model")
        assert model is not None
        self._calls.append(model)
        result = self._handler(model)
        if kwargs.get("stream"):
            return _FakeAsyncStream(list(result))
        if isinstance(result, BaseException):
            raise result
        if isinstance(result, str):
            return _FakeCompletionResponse(result, model)
        raise AssertionError(f"unexpected handler result: {type(result)}")


class _FakeChat:
    def __init__(self, completions: _FakeCompletions) -> None:
        self.completions = completions


class _FakeGroqClient:
    """Minimal stand-in for AsyncGroq."""

    def __init__(self, handler: Any, calls: list[str]) -> None:
        self.chat = _FakeChat(_FakeCompletions(handler, calls))


def _make_client(handler: Any, calls: list[str], *, stream: bool) -> GroqClient:
    client = GroqClient.__new__(GroqClient)
    client._client = _FakeGroqClient(handler, calls)  # type: ignore[assignment]
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
