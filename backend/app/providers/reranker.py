"""
Cross-encoder reranker (local inference, lazily loaded).

Lazy import means the app starts and tests run even without
sentence-transformers installed. The reranker is only loaded when
RERANKER_ENABLED=true and the first retrieval request arrives.
"""

from __future__ import annotations

import threading
from typing import TYPE_CHECKING

from app.core.config import settings
from app.core.logging import get_logger

if TYPE_CHECKING:
    from sentence_transformers import CrossEncoder

logger = get_logger(__name__)

_reranker_lock = threading.Lock()
_reranker_instance: "CrossEncoder | None" = None


def _get_reranker() -> "CrossEncoder":
    global _reranker_instance
    if _reranker_instance is None:
        with _reranker_lock:
            if _reranker_instance is None:
                try:
                    from sentence_transformers import CrossEncoder  # noqa: PLC0415
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
    pairs = [(query, p) for p in passages]
    scores: list[float] = reranker.predict(pairs).tolist()

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
