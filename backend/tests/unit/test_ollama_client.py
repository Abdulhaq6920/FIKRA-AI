"""Unit tests for Ollama request construction and response handling."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Any, ClassVar

import pytest
from langchain_core.messages import AIMessage, HumanMessage

from app.api import dependencies
from app.core.exceptions import ProviderUnavailableError
from app.providers import ollama_client as ollama_module
from app.providers.llm import ChatMessage
from app.providers.ollama_client import OllamaClient


class _FakeResponse:
    status_code = 200

    def __init__(self, body: dict[str, Any], lines: list[str] | None = None) -> None:
        self._body = body
        self._lines = lines or []

    def raise_for_status(self) -> None:
        return

    def json(self) -> dict[str, Any]:
        return self._body

    async def aiter_lines(self) -> AsyncIterator[str]:
        for line in self._lines:
            yield line


class _FakeStreamContext:
    def __init__(self, response: _FakeResponse) -> None:
        self._response = response

    async def __aenter__(self) -> _FakeResponse:
        return self._response

    async def __aexit__(self, *_args: Any) -> None:
        return


class _FakeAsyncClient:
    response: ClassVar[_FakeResponse] = _FakeResponse({})
    calls: ClassVar[list[tuple[str, dict[str, Any]]]] = []

    def __init__(self, **_kwargs: Any) -> None:
        pass

    async def __aenter__(self) -> _FakeAsyncClient:
        return self

    async def __aexit__(self, *_args: Any) -> None:
        return

    async def post(self, url: str, *, json: dict[str, Any]) -> _FakeResponse:
        self.calls.append((url, json))
        return self.response

    def stream(self, _method: str, url: str, *, json: dict[str, Any]) -> _FakeStreamContext:
        self.calls.append((url, json))
        return _FakeStreamContext(self.response)


@pytest.fixture(autouse=True)
def _fake_httpx(monkeypatch: pytest.MonkeyPatch) -> None:
    _FakeAsyncClient.calls = []
    monkeypatch.setattr(ollama_module.httpx, "AsyncClient", _FakeAsyncClient)


async def test_generate_sends_ollama_native_request_and_usage() -> None:
    _FakeAsyncClient.response = _FakeResponse(
        {
            "model": "deepseek-r1:8b",
            "message": {"content": "Answer"},
            "prompt_eval_count": 12,
            "eval_count": 7,
            "done_reason": "stop",
        }
    )
    client = OllamaClient()

    result = await client.generate(
        [HumanMessage(content="Question"), AIMessage(content="Earlier answer")],
        system_prompt="Be concise.",
        max_tokens=128,
        temperature=0.1,
    )

    url, payload = _FakeAsyncClient.calls[0]
    assert url.endswith("/api/chat")
    assert payload["model"] == "deepseek-r1:8b"
    assert payload["stream"] is False
    assert payload["options"] == {"num_predict": 128, "temperature": 0.1}
    assert payload["messages"] == [
        {"role": "system", "content": "Be concise."},
        {"role": "user", "content": "Question"},
        {"role": "assistant", "content": "Earlier answer"},
    ]
    assert result.content == "Answer"
    assert result.usage.input_tokens == 12
    assert result.usage.output_tokens == 7
    assert result.usage.total_tokens == 19


async def test_generate_stream_yields_ollama_message_content() -> None:
    _FakeAsyncClient.response = _FakeResponse(
        {},
        [
            json.dumps({"message": {"content": "Hello "}, "done": False}),
            json.dumps({"message": {"content": "there"}, "done": False}),
            json.dumps({"message": {}, "done": True}),
        ],
    )
    client = OllamaClient()
    chunks = [
        chunk async for chunk in client.generate_stream([ChatMessage(role="user", content="hello")])
    ]

    assert chunks == ["Hello ", "there"]
    assert _FakeAsyncClient.calls[0][1]["stream"] is True


async def test_generate_rejects_malformed_ollama_response() -> None:
    _FakeAsyncClient.response = _FakeResponse({"message": {"role": "assistant"}})

    with pytest.raises(ProviderUnavailableError):
        await OllamaClient().generate([ChatMessage(role="user", content="hello")])


def test_provider_dependency_selects_ollama(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(dependencies.settings, "llm_provider", "ollama")
    monkeypatch.setattr(dependencies, "_ollama_client", None)
    monkeypatch.setattr(
        dependencies,
        "get_groq_client",
        lambda: pytest.fail("Groq client should not be selected"),
    )

    assert isinstance(dependencies.get_llm_client(), OllamaClient)
