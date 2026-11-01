"""
Embedding provider using LangChain's Hugging Face integration.

The SentenceTransformer model is loaded lazily on first use so that:
- The application can start without sentence-transformers installed
- Unit tests that don't exercise embeddings don't need the full ML stack
- Docker image layers can be split between app code and ML weights

Set EMBEDDING_MODEL in .env to switch models.
After changing models, reindex all documents (see docs/development/changing-an-embedding-model.md).
"""

from __future__ import annotations

import hashlib
import threading
from typing import TYPE_CHECKING

from app.core.config import settings
from app.core.logging import get_logger

if TYPE_CHECKING:
    from langchain_huggingface import HuggingFaceEmbeddings

logger = get_logger(__name__)

_model_lock = threading.Lock()
_model_instance: "HuggingFaceEmbeddings | None" = None


def _get_model() -> "HuggingFaceEmbeddings":
    """Load LangChain's embedding adapter once and reuse it for retrieval."""
    global _model_instance
    if _model_instance is None:
        with _model_lock:
            if _model_instance is None:
                try:
                    from langchain_huggingface import HuggingFaceEmbeddings  # noqa: PLC0415
                except ImportError as exc:
                    raise RuntimeError(
                        "langchain-huggingface is not installed. "
                        "Run: uv pip install langchain-huggingface"
                    ) from exc

                logger.info("loading_embedding_model", model=settings.embedding_model)
                _model_instance = HuggingFaceEmbeddings(
                    model_name=settings.embedding_model,
                    model_kwargs={"device": "cpu"},
                    encode_kwargs={"normalize_embeddings": True},
                    show_progress=False,
                )
                logger.info("embedding_model_loaded", model=settings.embedding_model)
    return _model_instance


def get_model_version() -> str:
    """Return a stable version identifier for the current embedding model."""
    return hashlib.sha256(settings.embedding_model.encode()).hexdigest()[:16]


def embed_documents(texts: list[str]) -> list[list[float]]:
    """
    Embed a list of document passage texts (no query prefix).

    Returns normalized float vectors ready for pgvector cosine search.
    """
    if not texts:
        return []

    model = _get_model()
    vectors = model.embed_documents(texts)

    logger.debug("documents_embedded", count=len(texts))
    return vectors


def embed_query(query: str) -> list[float]:
    """
    Embed a user query with the BGE retrieval prefix.

    BAAI/bge-small-en-v1.5 was instruction-tuned with this prefix for queries.
    Do NOT use this prefix for document passages — only for queries.
    """
    model = _get_model()
    prefixed = f"Represent this sentence for searching relevant passages: {query}"
    return model.embed_query(prefixed)


def validate_dimensions(vector: list[float]) -> None:
    """Raise ValueError if vector has unexpected dimensions."""
    if len(vector) != settings.embedding_dimensions:
        raise ValueError(
            f"Embedding dimension mismatch: expected {settings.embedding_dimensions}, "
            f"got {len(vector)}. Check EMBEDDING_MODEL and EMBEDDING_DIMENSIONS in .env."
        )
