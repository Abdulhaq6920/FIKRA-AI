"""Shared language-model request and response types."""

from __future__ import annotations

from collections.abc import AsyncGenerator, Sequence
from dataclasses import dataclass
from typing import Protocol

from langchain_core.messages import BaseMessage


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
    role: str
    content: str


class LLMClient(Protocol):
    """Interface implemented by supported chat model providers."""

    async def generate(
        self,
        messages: Sequence[ChatMessage | BaseMessage],
        *,
        model: str | None = None,
        max_tokens: int | None = None,
        temperature: float | None = None,
        system_prompt: str | None = None,
    ) -> GenerationResult: ...

    def generate_stream(
        self,
        messages: Sequence[ChatMessage | BaseMessage],
        *,
        model: str | None = None,
        max_tokens: int | None = None,
        temperature: float | None = None,
        system_prompt: str | None = None,
    ) -> AsyncGenerator[str, None]: ...

    async def health_check(self) -> bool: ...
