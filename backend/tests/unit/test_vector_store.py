"""Unit tests for the Qdrant vector-store provider (no network required)."""

from __future__ import annotations

import uuid
from types import SimpleNamespace
from typing import Any

import pytest

from app.providers import vector_store
from app.providers.vector_store import VectorPoint

_ORG_ID = uuid.uuid4()
_DOC_ID = uuid.uuid4()
_CHUNK_ID = uuid.uuid4()


class _StubClient:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, Any]]] = []

    async def collection_exists(self, _name: str) -> bool:
        return True

    async def upsert(self, **kwargs: Any) -> None:
        self.calls.append(("upsert", kwargs))

    async def delete(self, **kwargs: Any) -> None:
        self.calls.append(("delete", kwargs))

    async def query_points(self, **kwargs: Any) -> Any:
        self.calls.append(("query", kwargs))
        return SimpleNamespace(points=[])


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> _StubClient:
    stub = _StubClient()
    monkeypatch.setattr(vector_store, "get_qdrant_client", lambda: stub)
    return stub


async def test_upsert_stores_tenant_id_on_every_point(client: _StubClient) -> None:
    await vector_store.upsert_points(
        [
            VectorPoint(
                chunk_id=_CHUNK_ID,
                document_id=_DOC_ID,
                organization_id=_ORG_ID,
                embedding=[0.1] * 384,
            )
        ]
    )
    kind, kwargs = client.calls[0]
    assert kind == "upsert"
    point = kwargs["points"][0]
    assert str(point.id) == str(_CHUNK_ID)
    assert point.payload["organization_id"] == str(_ORG_ID)
    assert point.payload["document_id"] == str(_DOC_ID)


async def test_delete_is_scoped_to_tenant_and_document(client: _StubClient) -> None:
    await vector_store.delete_document_points(_DOC_ID, _ORG_ID)
    kind, kwargs = client.calls[0]
    assert kind == "delete"
    conditions = kwargs["points_selector"].must
    keys = [condition.key for condition in conditions]
    assert keys == ["organization_id", "document_id"]
    assert conditions[0].match.value == str(_ORG_ID)
    assert conditions[1].match.any == [str(_DOC_ID)]


async def test_search_passes_tenant_filter_to_qdrant(client: _StubClient) -> None:
    hits = await vector_store.search_vectors([0.1] * 384, _ORG_ID, 5)
    assert hits == []
    kind, kwargs = client.calls[0]
    assert kind == "query"
    condition = kwargs["query_filter"].must[0]
    assert condition.key == "organization_id"
    assert condition.match.value == str(_ORG_ID)
