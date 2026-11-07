"""Unit tests for bounded RAG prompt construction."""

from __future__ import annotations

import uuid
from types import SimpleNamespace

from app.db.models.conversation import MessageRole
from app.services.rag_service import (
    _build_context,
    _build_history,
    _count_tokens,
)
from app.services.retrieval_service import RetrievedPassage


def _make_passage(index: int, content: str | None = None) -> RetrievedPassage:
    return RetrievedPassage(
        chunk_id=uuid.uuid4(),
        document_id=uuid.uuid4(),
        document_title=f"Document {index}",
        content=content or f"Content from document {index}.",
        page_number=index,
        section_heading=None,
        score=0.9,
        retrieval_method="vector",
        similarity=0.9,
    )


class TestBuildContext:
    def test_caps_passages_and_keeps_source_numbers_contiguous(self) -> None:
        passages = [_make_passage(i) for i in range(1, 11)]

        context, source_map = _build_context(
            passages, max_passages=3, chars_per_passage=200
        )

        assert list(source_map) == [1, 2, 3]
        assert source_map[1] is passages[0]
        assert "[Source 3]" in context
        assert "[Source 4]" not in context

    def test_clips_long_passages(self) -> None:
        passage = _make_passage(1, content="word " * 400)

        context, source_map = _build_context(
            [passage], max_passages=1, chars_per_passage=50
        )

        assert source_map[1] is passage
        assert len(context) < 300
        assert "…" in context

    def test_empty_passages(self) -> None:
        context, source_map = _build_context([])
        assert source_map == {}
        assert "No relevant document excerpts" in context


class TestBuildHistory:
    def test_drops_leading_assistant_message(self) -> None:
        messages = [
            SimpleNamespace(role=MessageRole.ASSISTANT, content="Earlier answer"),
            SimpleNamespace(role=MessageRole.USER, content="Earlier question"),
            SimpleNamespace(role=MessageRole.ASSISTANT, content="Latest answer"),
        ]

        history = _build_history(messages, max_messages=10, max_tokens=1000)

        assert len(history) == 2
        assert history[0].content == "Earlier question"
        assert history[1].content == "Latest answer"

    def test_drops_oldest_turns_to_fit_budget(self) -> None:
        messages = [
            SimpleNamespace(role=MessageRole.USER, content="First question " * 20),
            SimpleNamespace(role=MessageRole.ASSISTANT, content="First answer " * 20),
            SimpleNamespace(role=MessageRole.USER, content="Second question"),
            SimpleNamespace(role=MessageRole.ASSISTANT, content="Second answer"),
        ]

        history = _build_history(messages, max_messages=10, max_tokens=20)

        assert [message.content for message in history] == [
            "Second question",
            "Second answer",
        ]

    def test_clips_single_over_budget_message(self) -> None:
        messages = [
            SimpleNamespace(role=MessageRole.USER, content="Question"),
            SimpleNamespace(role=MessageRole.ASSISTANT, content="word " * 500),
        ]

        history = _build_history(messages, max_messages=10, max_tokens=100)

        assert len(history) == 2
        assert history[0].content == "Question"
        assert _count_tokens(str(history[1].content)) <= 60
        assert str(history[1].content).endswith("…")

    def test_zero_budget_returns_no_history(self) -> None:
        messages = [SimpleNamespace(role=MessageRole.USER, content="Question")]

        assert _build_history(messages, max_messages=10, max_tokens=0) == []
