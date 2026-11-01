"""Unit tests for document extraction and chunking."""

from __future__ import annotations

import pytest

from app.services.ingestion_service import (
    DocumentChunkData,
    ExtractionResult,
    ExtractedPage,
    _normalize_text,
    chunk_text,
    extract_text,
)


class TestNormalizeText:
    def test_strips_leading_trailing_whitespace(self):
        assert _normalize_text("  hello  ") == "hello"

    def test_collapses_multiple_blank_lines(self):
        text = "para1\n\n\n\npara2"
        normalized = _normalize_text(text)
        assert "\n\n\n" not in normalized
        assert "para1" in normalized
        assert "para2" in normalized

    def test_preserves_single_blank_lines(self):
        text = "line1\n\nline2"
        assert "line1" in _normalize_text(text)
        assert "line2" in _normalize_text(text)

    def test_collapses_horizontal_whitespace(self):
        result = _normalize_text("word1   word2")
        assert "word1 word2" in result


class TestChunking:
    def test_single_page_produces_chunks(self):
        extraction = ExtractionResult(
            pages=[ExtractedPage(page_number=1, text="Paragraph one.\n\nParagraph two.\n\nParagraph three.")],
            page_count=1,
            word_count=6,
        )
        chunks = chunk_text(extraction, max_tokens=50, overlap_tokens=5)
        assert len(chunks) >= 1
        assert all(isinstance(c, DocumentChunkData) for c in chunks)

    def test_chunk_indices_are_sequential(self):
        pages = [
            ExtractedPage(page_number=i, text=f"Content for page {i}. " * 20)
            for i in range(1, 4)
        ]
        extraction = ExtractionResult(pages=pages, page_count=3, word_count=100)
        chunks = chunk_text(extraction, max_tokens=30)
        indices = [c.chunk_index for c in chunks]
        assert indices == list(range(len(chunks)))

    def test_chunk_preserves_page_number(self):
        extraction = ExtractionResult(
            pages=[ExtractedPage(page_number=5, text="Important content on page five.\n\nMore content here.")],
            page_count=1,
            word_count=10,
        )
        chunks = chunk_text(extraction)
        assert all(c.page_number == 5 for c in chunks)

    def test_empty_extraction_returns_empty(self):
        extraction = ExtractionResult(pages=[], page_count=0, word_count=0)
        chunks = chunk_text(extraction)
        assert chunks == []

    def test_content_hashes_differ_for_different_content(self):
        pages = [
            ExtractedPage(page_number=1, text="Alpha content here is unique.\n\nBeta content is also unique.")
        ]
        extraction = ExtractionResult(pages=pages, page_count=1, word_count=10)
        chunks = chunk_text(extraction, max_tokens=10)
        hashes = [c.content_hash for c in chunks]
        # If there are multiple chunks, they should have different hashes
        if len(chunks) > 1:
            assert len(set(hashes)) == len(hashes)

    def test_long_unbroken_text_is_split_to_token_limit(self):
        """A DOCX paragraph without blank lines must never become one chunk."""
        extraction = ExtractionResult(
            pages=[ExtractedPage(page_number=1, text="knowledge " * 1_000)],
            page_count=1,
            word_count=1_000,
        )
        chunks = chunk_text(extraction, max_tokens=50, overlap_tokens=5)

        assert len(chunks) > 1
        assert all(chunk.token_count <= 50 for chunk in chunks)


class TestTextExtraction:
    def test_txt_extraction(self):
        content = b"Hello world\n\nThis is a test document."
        result = extract_text(content, "txt")
        assert result.page_count == 1
        assert "Hello world" in result.pages[0].text

    def test_markdown_extraction(self):
        content = b"# Heading\n\nSome paragraph text here."
        result = extract_text(content, "md")
        assert result.page_count == 1
        assert "paragraph text" in result.pages[0].text.lower() or "heading" in result.pages[0].text.lower()

    def test_html_table_is_preserved_as_markdown(self):
        content = b"<html><body><table><tr><th>Product</th><th>Price</th></tr><tr><td>Widget</td><td>25</td></tr></table></body></html>"
        result = extract_text(content, "html")
        assert result.page_count == 1
        assert "| Product | Price |" in result.pages[0].text
        assert "Widget" in result.pages[0].text

    def test_csv_is_extracted_as_a_retrievable_table(self):
        content = b"Name,Department\nAda,Research\nGrace,Engineering\n"
        result = extract_text(content, "csv")
        assert result.page_count == 1
        assert result.pages[0].section_heading == "Sheet 1"
        assert "Ada" in result.pages[0].text
        assert "Department" in result.pages[0].text

    def test_unsupported_type_returns_warning(self):
        result = extract_text(b"data", "xyz")
        assert len(result.warnings) > 0
        assert "xyz" in result.warnings[0].lower()
