"""
Cross-encoder reranker (local inference, lazily loaded).

Lazy import means the app starts and tests run even without
sentence-transformers installed. The reranker is only loaded when
RERANKER_ENABLED=true and the first retrieval request arrives.
"""

from __future__ import annotations

import threading
from typing import TYPE_CHECKING, Any, cast

from app.core.config import settings
from app.core.logging import get_logger

if TYPE_CHECKING:
    from sentence_transformers import CrossEncoder

logger = get_logger(__name__)

_reranker_lock = threading.Lock()
_reranker_instance: CrossEncoder | None = None


def _get_reranker() -> CrossEncoder:
    global _reranker_instance
    if _reranker_instance is None:
        with _reranker_lock:
            if _reranker_instance is None:
                try:
                    from sentence_transformers import CrossEncoder
                except ImportError as exc:
                    raise RuntimeError(
                        "sentence-transformers is not installed. "
                        "Run: uv pip install sentence-transformers"
                    ) from exc

                logger.info("loading_reranker_model", model=settings.reranker_model)
                _reranker_instance = CrossEncoder(
                    settings.reranker_model,
                    device="cpu",
                    max_length=512,
                )
                logger.info("reranker_model_loaded", model=settings.reranker_model)
    return _reranker_instance


def preload_reranker() -> None:
    """Load the cross-encoder ahead of the first request.

    The model is a few hundred MB and takes seconds to load. Doing that inside
    the first ``/chat/ask`` added that cost to a user's latency (measured: +3.3 s
    on the first answer). Startup is the right place for it, and it is skipped
    entirely when reranking is disabled.
    """
    if settings.reranker_enabled:
        _get_reranker()


def rerank(
    query: str,
    passages: list[str],
    *,
    top_n: int | None = None,
) -> list[tuple[int, float]]:
    """
    Score and rerank passages against a query using the cross-encoder.

    Returns (original_index, score) tuples sorted descending by score.
    Falls back to original order when RERANKER_ENABLED=false.
    """
    if not settings.reranker_enabled or not passages:
        return [(i, 0.0) for i in range(len(passages))]

    reranker = _get_reranker()
    # The cross-encoder API takes a list of [query, passage] pairs, not tuples.
    raw_scores = reranker.predict([[query, p] for p in passages])
    scores: list[float] = [float(score) for score in cast("Any", raw_scores)]

    ranked = sorted(enumerate(scores), key=lambda x: x[1], reverse=True)
    if top_n is not None:
        ranked = ranked[:top_n]

    logger.debug(
        "reranking_complete",
        candidates=len(passages),
        top_n=top_n,
        top_score=ranked[0][1] if ranked else None,
    )
    return ranked
