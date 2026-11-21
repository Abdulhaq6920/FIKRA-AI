"""
Access-level (restricted document) isolation tests for hybrid retrieval.

What these tests block:

* Privilege escalation inside a tenant — a normal member
  (``include_restricted=False``, set by ``chat.py``) must never receive chunks
  of a document whose ``access_level`` is ``restricted``. Before the fix the
  predicate was written as ``access_condition or true()``; SQLAlchemy makes
  ``bool(BinaryExpression)`` False, so the predicate was always dropped and
  restricted text reached the prompt, ``Citation.excerpt`` and
  ``messages.citations``. Asserting on the *compiled* statement catches that
  class of bug because the SQL text is what the database actually runs.
* Cross-tenant access — the Qdrant payload filter must carry the tenant ID and
  both retrieval branches must keep ``document_chunks.organization_id`` and
  ``documents.organization_id`` in the relational WHERE clause (not a
  post-filter).
* Stale Qdrant points whose chunk no longer exists must not crash chat.

No database or Qdrant server is required: the Qdrant call is stubbed and the
relational statement is captured from a stub session and compiled with the
PostgreSQL dialect.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from sqlalchemy.dialects import postgresql

from app.providers import vector_store
from app.providers.vector_store import VectorHit, build_tenant_filter
from app.services.retrieval_service import _keyword_search, _vector_search

_ORG_ID = uuid.uuid4()
_QUERY_VECTOR = [0.01] * 384
_DIALECT = postgresql.dialect()
_CHUNK_IDS = [uuid.uuid4() for _ in range(3)]


class _EmptyResult:
    """Stand-in for ``CursorResult``: no rows, nothing to fetch."""

    def all(self) -> list[Any]:
        return []


class _Row:
    """Minimal row for the vector-search mapping loop."""

    def __init__(self, chunk_id: uuid.UUID) -> None:
        self.id = chunk_id
        self.document_id = uuid.uuid4()
        self.title = "Doc"
        self.content = "chunk text"
        self.page_number = 1
        self.section_heading = None


class _RowsResult:
    def __init__(self, rows: list[_Row]) -> None:
        self._rows = rows

    def all(self) -> list[_Row]:
        return self._rows


class _CapturingSession:
    """Minimal AsyncSession stand-in that records the executed statement."""

    def __init__(self, rows: list[_Row] | None = None) -> None:
        self.statements: list[Any] = []
        self._rows = rows or []

    async def execute(self, statement: Any) -> _EmptyResult | _RowsResult:
        self.statements.append(statement)
        if self._rows:
            return _RowsResult(self._rows)
        return _EmptyResult()


def _compiled(statement: Any) -> str:
    return str(statement.compile(dialect=_DIALECT))


def _conjuncts(statement: Any) -> list[str]:
    """Return each top-level WHERE term, compiled and normalised."""
    clause = statement.whereclause
    parts = list(getattr(clause, "clauses", [clause]))
    return [str(part.compile(dialect=_DIALECT)).strip().lower() for part in parts]


def _assert_no_bare_true(statement: Any) -> None:
    """
    A bare ``true`` conjunct means the scope filter was optimised away.

    ``true()`` renders as the literal ``true`` under the PostgreSQL dialect, so
    the check is made per conjunct rather than by substring on the whole query.
    """
    assert "true" not in _conjuncts(statement), (
        "a bare `true` WHERE term means an access predicate was dropped"
    )


def _fake_search(
    hits: list[tuple[uuid.UUID, float]],
) -> Any:
    """Stub Qdrant: return the given (chunk ID, score) pairs."""

    async def _inner(
        _query_vector: list[float],
        _organization_id: uuid.UUID,
        _limit: int,
    ) -> list[VectorHit]:
        return [VectorHit(chunk_id=chunk_id, score=score) for chunk_id, score in hits]

    return _inner


async def _vector_statement(
    monkeypatch: pytest.MonkeyPatch,
    include_restricted: bool,
    hits: list[tuple[uuid.UUID, float]] | None = None,
    rows: list[_Row] | None = None,
) -> Any:
    db = _CapturingSession(rows=rows if rows is not None else [_Row(cid) for cid in _CHUNK_IDS])
    stub_hits = hits if hits is not None else [
        (cid, 0.9 - i) for i, cid in enumerate(_CHUNK_IDS)
    ]
    monkeypatch.setattr(vector_store, "search_vectors", _fake_search(stub_hits))
    await _vector_search(
        query_vector=_QUERY_VECTOR,
        organization_id=_ORG_ID,
        db=db,  # type: ignore[arg-type]
        limit=5,
        include_restricted=include_restricted,
    )
    assert len(db.statements) == 1
    return db.statements[0]


async def _keyword_statement(include_restricted: bool) -> Any:
    db = _CapturingSession()
    await _keyword_search(
        query="restricted roadmap",
        organization_id=_ORG_ID,
        db=db,  # type: ignore[arg-type]
        limit=5,
        include_restricted=include_restricted,
    )
    assert len(db.statements) == 1
    return db.statements[0]


class TestRestrictedDocumentsAreFiltered:
    """A member must never retrieve a restricted document's chunks."""

    async def test_vector_search_filters_restricted_for_members(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        statement = await _vector_statement(monkeypatch, include_restricted=False)
        sql = _compiled(statement)
        assert "access_level" in sql, "restricted documents would leak into vector results"
        # The PostgreSQL dialect renders true() as `true`; this keeps the
        # original assertion from the audit finding honest and explicit.
        assert "true()" not in sql
        _assert_no_bare_true(statement)

    async def test_keyword_search_filters_restricted_for_members(self) -> None:
        statement = await _keyword_statement(include_restricted=False)
        sql = _compiled(statement)
        assert "access_level" in sql, "restricted documents would leak into keyword results"
        assert "true()" not in sql
        _assert_no_bare_true(statement)

    async def test_vector_search_allows_restricted_for_admins(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        sql = _compiled(await _vector_statement(monkeypatch, include_restricted=True))
        assert "access_level" not in sql

    async def test_keyword_search_allows_restricted_for_admins(self) -> None:
        sql = _compiled(await _keyword_statement(include_restricted=True))
        assert "access_level" not in sql


class TestTenantPredicateIsInTheQuery:
    """The org filter must be part of both the Qdrant and SQL queries."""

    async def test_vector_search_is_tenant_scoped(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        sql = _compiled(await _vector_statement(monkeypatch, include_restricted=False))
        assert "document_chunks.organization_id" in sql
        assert "documents.organization_id" in sql

    async def test_keyword_search_is_tenant_scoped(self) -> None:
        sql = _compiled(await _keyword_statement(include_restricted=False))
        assert "document_chunks.organization_id" in sql
        assert "documents.organization_id" in sql

    def test_qdrant_filter_carries_the_tenant_id(self) -> None:
        tenant_filter = build_tenant_filter(_ORG_ID)
        assert tenant_filter.must is not None
        tenant_condition = tenant_filter.must[0]
        assert tenant_condition.key == "organization_id"
        assert tenant_condition.match is not None
        assert tenant_condition.match.value == str(_ORG_ID)


class TestVectorHitResolution:
    """Qdrant hits are resolved safely against relational rows."""

    async def test_stale_qdrant_ids_are_skipped(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        unknown = uuid.uuid4()
        db = _CapturingSession(rows=[_Row(_CHUNK_IDS[0])])
        monkeypatch.setattr(vector_store, "search_vectors", _fake_search([(unknown, 0.9)]))
        passages = await _vector_search(
            query_vector=_QUERY_VECTOR,
            organization_id=_ORG_ID,
            db=db,  # type: ignore[arg-type]
            limit=5,
        )
        assert passages == []

    async def test_qdrant_ranking_is_preserved(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # SQLAlchemy returns rows in insertion order; Qdrant ranks them 3, 1, 2.
        rows = [_Row(cid) for cid in _CHUNK_IDS]
        hits = [(_CHUNK_IDS[2], 0.95), (_CHUNK_IDS[0], 0.8), (_CHUNK_IDS[1], 0.6)]
        db = _CapturingSession(rows=rows)
        monkeypatch.setattr(vector_store, "search_vectors", _fake_search(hits))
        passages = await _vector_search(
            query_vector=_QUERY_VECTOR,
            organization_id=_ORG_ID,
            db=db,  # type: ignore[arg-type]
            limit=5,
        )
        assert [p.chunk_id for p in passages] == [_CHUNK_IDS[2], _CHUNK_IDS[0], _CHUNK_IDS[1]]
        assert [p.similarity for p in passages] == [0.95, 0.8, 0.6]
