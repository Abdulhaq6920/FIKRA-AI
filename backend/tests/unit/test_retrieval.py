"""Unit tests for RRF fusion and citation extraction."""

from __future__ import annotations

import uuid

import pytest

from app.services.retrieval_service import RetrievedPassage, _reciprocal_rank_fusion
from app.services.rag_service import Citation, _extract_citations, _build_context


def _make_passage(i: int, score: float = 0.5) -> RetrievedPassage:
    return RetrievedPassage(
        chunk_id=uuid.uuid4(),
        document_id=uuid.uuid4(),
        document_title=f"Document {i}",
        content=f"Content from document {i}.",
        page_number=i,
        section_heading=None,
        score=score,
        retrieval_method="vector",
    )


class TestRRF:
    def test_rrf_single_list(self):
        passages = [_make_passage(i) for i in range(5)]
        result = _reciprocal_rank_fusion([passages])
        assert len(result) == 5

    def test_rrf_two_lists_same_order(self):
        passages = [_make_passage(i) for i in range(3)]
        result = _reciprocal_rank_fusion([passages, passages])
        # Order should be unchanged since both lists agree
        ids = [r.chunk_id for r in result]
        assert ids == [p.chunk_id for p in passages]

    def test_rrf_boosts_passage_in_both_lists(self):
        p1 = _make_passage(1)
        p2 = _make_passage(2)
        p3 = _make_passage(3)
        # p1 is #1 in list A, p3 is #1 in list B
        list_a = [p1, p2, p3]
        list_b = [p3, p2, p1]
        result = _reciprocal_rank_fusion([list_a, list_b])
        # p2 appears #2 in both lists:  1/(60+2) + 1/(60+2) = 2/62 ≈ 0.03226
        # p1: rank 1 in A, rank 3 in B: 1/61 + 1/63 ≈ 0.03246  ← highest
        # p3: rank 3 in A, rank 1 in B: 1/63 + 1/61 ≈ 0.03246  ← same as p1
        # p2 has the LOWEST score (0.03226 < 0.03246).
        # The test verifies p1 and p3 both outscore p2.
        p2_score = next(r.score for r in result if r.chunk_id == p2.chunk_id)
        p1_score = next(r.score for r in result if r.chunk_id == p1.chunk_id)
        p3_score = next(r.score for r in result if r.chunk_id == p3.chunk_id)
        assert p1_score > p2_score, "p1 (rank-1 in A) should outscore p2 (rank-2 in both)"
        assert p3_score > p2_score, "p3 (rank-1 in B) should outscore p2 (rank-2 in both)"

    def test_rrf_empty_lists(self):
        assert _reciprocal_rank_fusion([[], []]) == []

    def test_rrf_deduplicates(self):
        p = _make_passage(1)
        result = _reciprocal_rank_fusion([[p], [p]])
        assert len(result) == 1


class TestCitationExtraction:
    def _make_source_map(self) -> dict[int, RetrievedPassage]:
        return {
            1: _make_passage(1),
            2: _make_passage(2),
            3: _make_passage(3),
        }

    def test_extracts_cited_sources(self):
        answer = "According to [Source 1] and [Source 2], the answer is X."
        source_map = self._make_source_map()
        citations = _extract_citations(answer, source_map)
        assert len(citations) == 2
        assert citations[0].source_number == 1
        assert citations[1].source_number == 2

    def test_ignores_uncited_sources(self):
        answer = "The answer is Y. [Source 1]"
        source_map = self._make_source_map()
        citations = _extract_citations(answer, source_map)
        assert len(citations) == 1

    def test_ignores_nonexistent_source_numbers(self):
        """Model cited [Source 99] which doesn't exist in the source map."""
        answer = "See [Source 99] for details."
        source_map = self._make_source_map()
        citations = _extract_citations(answer, source_map)
        assert len(citations) == 0

    def test_no_citations(self):
        answer = "I cannot find relevant information."
        citations = _extract_citations(answer, {})
        assert citations == []

    def test_citation_contains_server_side_metadata(self):
        """Citations must use server-side data, not model-generated data."""
        answer = "As stated in [Source 1]."
        p = _make_passage(42)
        source_map = {1: p}
        citations = _extract_citations(answer, source_map)
        assert citations[0].document_id == str(p.document_id)
        assert citations[0].document_title == p.document_title
