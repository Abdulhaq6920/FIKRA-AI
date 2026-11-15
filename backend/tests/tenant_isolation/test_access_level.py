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
* Cross-tenant access — both retrieval branches must keep
  ``document_chunks.organization_id`` and ``documents.organization_id`` in the
  WHERE clause (not a post-filter).
* A NULL ``embedding`` must be excluded from the vector branch and skipped in
  the row loop; ``1 - NULL`` is NULL, and ``float(None)`` used to raise a 500
  for every user of the tenant.

No database is required: the statement is captured from a stub session and
compiled with the PostgreSQL dialect.
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy.dialects import postgresql

from app.services.retrieval_service import _keyword_search, _vector_search

_ORG_ID = uuid.uuid4()
_QUERY_VECTOR = [0.01] * 384
_DIALECT = postgresql.dialect()


class _EmptyResult:
    """Stand-in for ``CursorResult``: no rows, nothing to fetch."""

    def all(self) -> list[Any]:
        return []


class _Row:
    """Minimal row for the vector-search mapping loop."""

    def __init__(self, score: float | None) -> None:
        self.id = uuid.uuid4()
        self.document_id = uuid.uuid4()
        self.title = "Doc"
        self.content = "chunk text"
        self.page_number = 1
        self.section_heading = None
        self.score = score


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


async def _vector_statement(include_restricted: bool) -> Any:
    db = _CapturingSession()
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

    async def test_vector_search_filters_restricted_for_members(self) -> None:
        statement = await _vector_statement(include_restricted=False)
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

    async def test_vector_search_allows_restricted_for_admins(self) -> None:
        sql = _compiled(await _vector_statement(include_restricted=True))
        assert "access_level" not in sql

    async def test_keyword_search_allows_restricted_for_admins(self) -> None:
        sql = _compiled(await _keyword_statement(include_restricted=True))
        assert "access_level" not in sql


class TestTenantPredicateIsInTheQuery:
    """The org filter must be part of the WHERE clause in both branches."""

    async def test_vector_search_is_tenant_scoped(self) -> None:
        sql = _compiled(await _vector_statement(include_restricted=False))
        assert "document_chunks.organization_id" in sql
        assert "documents.organization_id" in sql

    async def test_keyword_search_is_tenant_scoped(self) -> None:
        sql = _compiled(await _keyword_statement(include_restricted=False))
        assert "document_chunks.organization_id" in sql
        assert "documents.organization_id" in sql


class TestNullEmbeddingCannotCrashChat:
    async def test_vector_search_excludes_null_embeddings(self) -> None:
        sql = _compiled(await _vector_statement(include_restricted=False))
        assert "embedding IS NOT NULL" in sql

    async def test_vector_search_skips_rows_with_null_score(self) -> None:
        db = _CapturingSession(rows=[_Row(score=None), _Row(score=0.42)])
        passages = await _vector_search(
            query_vector=_QUERY_VECTOR,
            organization_id=_ORG_ID,
            db=db,  # type: ignore[arg-type]
            limit=5,
            include_restricted=False,
        )
        assert [p.score for p in passages] == [0.42]
