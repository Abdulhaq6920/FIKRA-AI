"""
Document ingestion service.

Coordinates: extraction → normalization → chunking → embedding → indexing.

Called by Celery workers, not directly by API endpoints.
Each stage is independently testable and can be retried.

Security:
- File content is treated as untrusted input throughout.
- Extraction errors are caught, categorized, and stored — never exposed raw.
- Prompt injection in document content does not affect system prompts
  because content is inserted as passive context, not as instructions.
"""

from __future__ import annotations

import hashlib
import io
import re
from dataclasses import dataclass, field
from typing import Any

from app.core.logging import get_logger
from app.providers.embeddings import embed_documents

logger = get_logger(__name__)

# Chunk size is measured with the embedding model's tokenizer, not characters.
_MAX_CHUNK_TOKENS = 400
_CHUNK_OVERLAP_TOKENS = 50


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------


@dataclass
class TableData:
    """Structured table retained so the chunker can repeat headers per batch."""

    title: str
    rows: list[list[str]]


@dataclass
class ExtractedPage:
    page_number: int
    text: str
    section_heading: str | None = None
    tables: list[TableData] = field(default_factory=list)


@dataclass
class ExtractionResult:
    pages: list[ExtractedPage] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    page_count: int = 0
    word_count: int = 0
    language: str | None = None
    # Broad content category selected by the extractor. Drives the chunking
    # strategy (spreadsheet rows, heading-aware prose, slide-aware decks...).
    kind: str = "text"


@dataclass
class DocumentChunkData:
    content: str
    chunk_index: int
    page_number: int | None
    section_heading: str | None
    start_char: int
    end_char: int
    token_count: int
    content_hash: str
    embedding: list[float] | None = None


# ---------------------------------------------------------------------------
# Text extraction
# ---------------------------------------------------------------------------


def extract_text(file_bytes: bytes, extension: str) -> ExtractionResult:
    """
    Extract text from a document.

    Dispatches to the appropriate extractor based on file extension.
    Returns an ExtractionResult with per-page text, structured tables, and
    warnings. `ExtractionResult.kind` tells the chunker which strategy to use.
    """
    ext = extension.lower().lstrip(".")

    if ext == "pdf":
        result = _extract_pdf(file_bytes)
    elif ext == "docx":
        result = _extract_docx(file_bytes)
    elif ext in ("xlsx", "xls", "ods", "csv", "tsv"):
        result = _extract_spreadsheet(file_bytes, ext)
    elif ext in ("pptx", "odp"):
        result = _extract_presentation(file_bytes, ext)
    elif ext == "odt":
        result = _extract_odf_text(file_bytes, ext)
    elif ext in ("md", "markdown"):
        result = _extract_markdown(file_bytes)
    elif ext in ("html", "htm"):
        result = _extract_html(file_bytes)
    elif ext in ("txt", "rtf"):
        result = _extract_txt(file_bytes)
    elif ext in ("png", "jpg", "jpeg", "webp", "bmp", "tif", "tiff"):
        result = _extract_image(file_bytes, ext)
    else:
        result = ExtractionResult(kind="text", warnings=[f"Unsupported file type: {ext}"])

    return result


def _extract_pdf(data: bytes) -> ExtractionResult:
    import fitz  # PyMuPDF

    result = ExtractionResult(kind="pdf")
    try:
        doc = fitz.open(stream=data, filetype="pdf")
        result.page_count = doc.page_count

        for page_num in range(doc.page_count):
            page = doc[page_num]
            text = page.get_text("text")
            tables = _extract_pdf_tables(page)

            # If the page has very little text, attempt OCR
            if len(text.strip()) < 50:
                ocr_text = _ocr_page(page)
                if ocr_text:
                    text = ocr_text
                    result.warnings.append(
                        f"Page {page_num + 1}: used OCR (low text content detected)"
                    )

            if text.strip() or tables:
                result.pages.append(
                    ExtractedPage(
                        page_number=page_num + 1,
                        text=_normalize_text(text),
                        tables=tables,
                    )
                )

        doc.close()
    except Exception as exc:
        logger.warning("pdf_extraction_error", error=str(exc)[:200])
        result.warnings.append(f"PDF extraction error: {type(exc).__name__}")

    result.word_count = sum(len(p.text.split()) for p in result.pages)
    return result


def _extract_pdf_tables(page: Any) -> list[TableData]:
    """Extract PDF tables as structured rows (rendered by the table chunker)."""
    tables: list[TableData] = []
    try:
        found = page.find_tables().tables
        for index, table in enumerate(found, start=1):
            rows = [
                [" ".join(str(cell or "").split()) for cell in row]
                for row in table.extract()
                if row
            ]
            if rows:
                tables.append(TableData(title=f"Table {index}", rows=rows))
    except Exception as exc:
        logger.debug("pdf_table_extraction_failed", error=str(exc)[:100])
    return tables


def _ocr_page(page: Any) -> str:
    """Run Tesseract OCR on a PDF page rendered as an image."""
    try:
        from PIL import Image

        pix = page.get_pixmap(dpi=150)
        img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
        return _ocr_image(img)
    except Exception as exc:
        logger.debug("ocr_failed", error=str(exc)[:100])
        return ""


def _ocr_image(image: Any) -> str:
    """Use RapidOCR first, with Tesseract retained as an installed-runtime fallback."""
    try:
        import numpy as np
        from rapidocr_onnxruntime import RapidOCR

        result, _elapsed = RapidOCR()(np.array(image.convert("RGB")))
        if result:
            return "\n".join(item[1] for item in result if len(item) > 1 and item[1]).strip()
    except Exception as exc:
        logger.debug("rapidocr_failed", error=str(exc)[:100])

    try:
        import pytesseract

        return pytesseract.image_to_string(image)
    except Exception as exc:
        logger.debug("tesseract_ocr_failed", error=str(exc)[:100])
        return ""


def _extract_image(data: bytes, extension: str) -> ExtractionResult:
    """OCR standalone image uploads into one retrievable document page."""
    result = ExtractionResult(page_count=1, kind="image")
    try:
        from PIL import Image, ImageOps

        with Image.open(io.BytesIO(data)) as image:
            # Respect phone-camera orientation metadata and improve contrast before OCR.
            normalized = ImageOps.exif_transpose(image)
            text = _ocr_image(normalized)
        if text.strip():
            result.pages.append(ExtractedPage(page_number=1, text=_normalize_text(text)))
            result.word_count = len(text.split())
        else:
            result.warnings.append("OCR could not detect readable text in this image")
    except Exception as exc:
        logger.warning("image_ocr_error", extension=extension, error=str(exc)[:200])
        result.warnings.append(f"Image OCR error: {type(exc).__name__}")
    return result


def _extract_docx(data: bytes) -> ExtractionResult:
    result = ExtractionResult(kind="docx")
    try:
        import docx

        document = docx.Document(io.BytesIO(data))
        result.pages = _docx_sections(document)
        result.page_count = 1
        result.word_count = sum(len(page.text.split()) for page in result.pages) + sum(
            len(cell.split())
            for page in result.pages
            for table in page.tables
            for row in table.rows
            for cell in row
        )
        if not result.pages:
            result.warnings.append("No readable text found in DOCX file")
    except ModuleNotFoundError:
        # python-docx is the preferred parser.  Keep ingestion available in
        # local installations where optional parser wheels have not been
        # installed by extracting paragraph text from the OOXML document.
        try:
            from xml.etree import ElementTree
            from zipfile import ZipFile

            with ZipFile(io.BytesIO(data)) as archive:
                document_xml = archive.read("word/document.xml")
            root = ElementTree.fromstring(document_xml)
            namespace = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
            paragraphs = []
            for paragraph in root.findall(".//w:p", namespace):
                text = "".join(
                    node.text or "" for node in paragraph.findall(".//w:t", namespace)
                ).strip()
                if text:
                    paragraphs.append(text)

            full_text = "\n\n".join(paragraphs)
            result.pages.append(ExtractedPage(page_number=1, text=_normalize_text(full_text)))
            result.page_count = 1
            result.word_count = len(full_text.split())
            result.warnings.append("Used the built-in DOCX parser")
        except Exception as fallback_exc:
            logger.warning("docx_extraction_error", error=str(fallback_exc)[:200])
            result.warnings.append(f"DOCX extraction error: {type(fallback_exc).__name__}")
    except Exception as exc:
        logger.warning("docx_extraction_error", error=str(exc)[:200])
        result.warnings.append(f"DOCX extraction error: {type(exc).__name__}")
    return result


def _docx_sections(document: Any) -> list[ExtractedPage]:
    """Group DOCX paragraphs under their heading hierarchy and keep tables structured."""
    pages: list[ExtractedPage] = []
    heading_stack: list[tuple[int, str]] = []
    heading: str | None = None
    lines: list[str] = []

    def flush() -> None:
        nonlocal lines, heading
        text = _join_section_lines(lines, heading)
        if text:
            pages.append(
                ExtractedPage(
                    page_number=1,
                    text=text,
                    section_heading=_clip_heading(heading),
                )
            )
        lines = []

    for para in document.paragraphs:
        style_name = getattr(para.style, "name", "") or ""
        text = para.text.strip()
        if style_name.startswith("Heading"):
            level = _heading_level(style_name)
            flush()
            heading_text = text or f"Heading {level}"
            while heading_stack and heading_stack[-1][0] >= level:
                heading_stack.pop()
            heading_stack.append((level, heading_text))
            heading = " > ".join(part for _, part in heading_stack)
            # Repeat the heading inside the content so standalone chunks keep context.
            lines = [heading_text]
            continue
        if text:
            lines.append(text)

    flush()

    for index, table in enumerate(document.tables, start=1):
        rows = [[cell.text.strip() for cell in row.cells] for row in table.rows if row.cells]
        if rows:
            pages.append(
                ExtractedPage(
                    page_number=1,
                    text="",
                    section_heading="Tables",
                    tables=[TableData(title=f"Table {index}", rows=rows)],
                )
            )

    return pages


def _heading_level(style_name: str) -> int:
    match = re.search(r"(\d+)", style_name)
    return int(match.group(1)) if match else 1


def _join_section_lines(lines: list[str], heading: str | None) -> str:
    """Keep a section heading attached to its first body block.

    A blank line between the heading and the first paragraph lets the recursive
    splitter emit a heading-only chunk when the body is large. A single newline
    keeps them together without changing the visible text.
    """
    if not lines:
        return ""
    body = "\n\n".join(lines)
    if len(lines) > 1 and heading:
        heading_title = heading.split(" > ")[-1].strip()
        if lines[0].strip() == heading_title:
            body = f"{lines[0].strip()}\n" + "\n\n".join(lines[1:])
    return _normalize_text(body)


def _clip_heading(value: str | None) -> str | None:
    """Keep heading paths compatible with the 512-character database column."""
    if not value:
        return None
    clipped = " ".join(value.split())[:500].strip()
    return clipped or None


def _extract_spreadsheet(data: bytes, extension: str) -> ExtractionResult:
    """Convert every non-empty sheet/table into Markdown for semantic retrieval."""
    result = ExtractionResult(kind="spreadsheet")
    try:
        import pandas as pd

        source = io.BytesIO(data)
        if extension in ("csv", "tsv"):
            frame = pd.read_csv(source, sep="\t" if extension == "tsv" else ",", dtype=str).fillna(
                ""
            )
            sheets = [("Sheet 1", frame)]
        else:
            workbook = pd.ExcelFile(source)
            sheets = [
                (sheet_name, pd.read_excel(workbook, sheet_name=sheet_name, dtype=str).fillna(""))
                for sheet_name in workbook.sheet_names
            ]

        for page_number, (sheet_name, frame) in enumerate(sheets, start=1):
            rows = [list(map(str, frame.columns.tolist()))] + frame.astype(str).values.tolist()
            table_text = _table_to_markdown(rows)
            if table_text:
                content = f"Spreadsheet sheet: {sheet_name}\n\n{table_text}"
                result.pages.append(
                    ExtractedPage(
                        page_number=page_number,
                        text=_normalize_text(content),
                        section_heading=_clip_heading(sheet_name),
                        tables=[TableData(title=sheet_name, rows=rows)],
                    )
                )

        result.page_count = len(result.pages)
        result.word_count = sum(len(page.text.split()) for page in result.pages)
        if not result.pages:
            result.warnings.append("No readable cells found in spreadsheet")
    except Exception as exc:
        logger.warning("spreadsheet_extraction_error", extension=extension, error=str(exc)[:200])
        result.warnings.append(f"Spreadsheet extraction error: {type(exc).__name__}")
    return result


def _extract_presentation(data: bytes, extension: str) -> ExtractionResult:
    """Extract slide text and native tables from PowerPoint presentations."""
    result = ExtractionResult(kind="presentation")
    if extension == "odp":
        return _extract_odf_text(data, extension)
    try:
        from pptx import Presentation

        presentation = Presentation(io.BytesIO(data))
        for number, slide in enumerate(presentation.slides, start=1):
            pieces: list[str] = []
            for shape in slide.shapes:
                if getattr(shape, "has_text_frame", False) and shape.text.strip():
                    pieces.append(shape.text.strip())
                if getattr(shape, "has_table", False):
                    table = shape.table
                    table_text = _table_to_markdown(
                        [[cell.text.strip() for cell in row.cells] for row in table.rows]
                    )
                    if table_text:
                        pieces.append(table_text)
            if pieces:
                result.pages.append(
                    ExtractedPage(page_number=number, text=_normalize_text("\n\n".join(pieces)))
                )
        result.page_count = len(presentation.slides)
        result.word_count = sum(len(page.text.split()) for page in result.pages)
    except Exception as exc:
        logger.warning("presentation_extraction_error", extension=extension, error=str(exc)[:200])
        result.warnings.append(f"Presentation extraction error: {type(exc).__name__}")
    return result


def _extract_odf_text(data: bytes, extension: str) -> ExtractionResult:
    """Read OpenDocument text/presentation files through odfpy."""
    result = ExtractionResult(page_count=1, kind="odf")
    try:
        from odf import text as odf_text
        from odf.opendocument import load

        document = load(io.BytesIO(data))
        paragraphs = document.getElementsByType(odf_text.P)
        plain = "\n\n".join(
            "".join(node.data for node in paragraph.childNodes if hasattr(node, "data")).strip()
            for paragraph in paragraphs
        )
        plain = _normalize_text(plain)
        if plain:
            result.pages.append(ExtractedPage(page_number=1, text=plain))
            result.word_count = len(plain.split())
        else:
            result.warnings.append("No readable text found in OpenDocument file")
    except Exception as exc:
        logger.warning("odf_extraction_error", extension=extension, error=str(exc)[:200])
        result.warnings.append(f"OpenDocument extraction error: {type(exc).__name__}")
    return result


def _extract_markdown(data: bytes) -> ExtractionResult:
    """Extract Markdown as heading-aware sections, preserving tables."""
    import markdown as md
    from bs4 import BeautifulSoup

    result = ExtractionResult(kind="markdown")
    try:
        text = data.decode("utf-8", errors="replace")
        sections = _markdown_sections(text)
        for heading, body in sections:
            html = md.markdown(body) if body else ""
            soup = BeautifulSoup(html, "lxml")
            tables = [_html_table_to_markdown(table) for table in soup.find_all("table")]
            for table in soup.find_all("table"):
                table.decompose()
            plain = soup.get_text(separator="\n")
            table_text = "\n\n".join(table for table in tables if table)
            if table_text:
                plain = f"{plain}\n\n{table_text}"
            normalized = _normalize_text(plain)
            if normalized:
                result.pages.append(
                    ExtractedPage(
                        page_number=1,
                        text=normalized,
                        section_heading=_clip_heading(heading),
                    )
                )
        result.page_count = 1
        result.word_count = sum(len(page.text.split()) for page in result.pages)
    except Exception as exc:
        result.warnings.append(f"Markdown extraction error: {type(exc).__name__}")
    return result


def _markdown_sections(text: str) -> list[tuple[str | None, str]]:
    """Split Markdown at ATX headings, ignoring headings inside code fences."""
    sections: list[tuple[str | None, str]] = []
    heading_stack: list[tuple[int, str]] = []
    current: list[str] = []
    current_heading: str | None = None
    in_fence = False

    def flush() -> None:
        nonlocal current
        body = "\n".join(current).strip()
        if body:
            sections.append((current_heading, body))
        current = []

    for line in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        if line.strip().startswith("```"):
            in_fence = not in_fence
        match = None if in_fence else re.match(r"^(#{1,6})\s+(.+?)\s*#*\s*$", line)
        if match:
            flush()
            level = len(match.group(1))
            title = match.group(2).strip()
            while heading_stack and heading_stack[-1][0] >= level:
                heading_stack.pop()
            heading_stack.append((level, title))
            current_heading = " > ".join(part for _, part in heading_stack)
            current = [title]
        else:
            current.append(line)

    flush()
    if not sections:
        sections.append((None, text))
    return sections


def _extract_html(data: bytes) -> ExtractionResult:
    from bs4 import BeautifulSoup

    result = ExtractionResult(kind="html")
    try:
        soup = BeautifulSoup(data, "lxml")
        for tag in soup(["script", "style", "nav", "footer"]):
            tag.decompose()

        sections = _html_sections(soup)
        for heading, body in sections:
            normalized = _normalize_text(body)
            if normalized:
                result.pages.append(
                    ExtractedPage(
                        page_number=1,
                        text=normalized,
                        section_heading=_clip_heading(heading),
                    )
                )
        result.page_count = 1
        result.word_count = sum(len(page.text.split()) for page in result.pages)
    except Exception as exc:
        result.warnings.append(f"HTML extraction error: {type(exc).__name__}")
    return result


def _html_sections(soup: Any) -> list[tuple[str | None, str]]:
    """Walk an HTML document in order and split it at headings."""
    sections: list[tuple[str | None, str]] = []
    heading_stack: list[tuple[int, str]] = []
    current: list[str] = []
    current_heading: str | None = None

    def flush() -> None:
        nonlocal current
        body = _join_section_lines(current, current_heading)
        if body:
            sections.append((current_heading, body))
        current = []

    for node in soup.find_all(["h1", "h2", "h3", "h4", "h5", "h6", "p", "li", "table"]):
        if node.find_parent("table") is not None:
            continue
        if node.name == "li" and node.find("p") is not None:
            continue
        if node.name == "table":
            rendered = _html_table_to_markdown(node)
            if rendered:
                current.append(rendered)
            continue
        if node.name.startswith("h") and len(node.name) == 2 and node.name[1].isdigit():
            flush()
            level = int(node.name[1])
            title = node.get_text(" ", strip=True)
            if not title:
                continue
            while heading_stack and heading_stack[-1][0] >= level:
                heading_stack.pop()
            heading_stack.append((level, title))
            current_heading = " > ".join(part for _, part in heading_stack)
            current = [title]
            continue
        text = node.get_text(" ", strip=True)
        if text:
            current.append(text)

    flush()
    if not sections:
        sections.append((None, soup.get_text(separator="\n")))
    return sections


def _html_table_to_markdown(table: Any) -> str:
    rows = []
    for row in table.find_all("tr"):
        cells = [cell.get_text(" ", strip=True) for cell in row.find_all(["th", "td"])]
        if cells:
            rows.append(cells)
    return _table_to_markdown(rows)


def _table_to_markdown(rows: list[list[Any]]) -> str:
    """Render irregular extracted tables into a stable, readable Markdown table."""
    non_empty = [[" ".join(str(cell or "").split()) for cell in row] for row in rows if row]
    if not non_empty:
        return ""

    width = max(len(row) for row in non_empty)
    normalized = [row + [""] * (width - len(row)) for row in non_empty]
    escaped = [[cell.replace("|", "\\|").replace("\n", " ") for cell in row] for row in normalized]
    header = escaped[0]
    separator = ["---"] * width
    body = escaped[1:]
    return "\n".join(
        [f"| {' | '.join(header)} |", f"| {' | '.join(separator)} |"]
        + [f"| {' | '.join(row)} |" for row in body]
    )


def _extract_txt(data: bytes) -> ExtractionResult:
    result = ExtractionResult(kind="text")
    try:
        text = data.decode("utf-8", errors="replace")
        result.pages.append(ExtractedPage(page_number=1, text=_normalize_text(text)))
        result.page_count = 1
        result.word_count = len(text.split())
    except Exception as exc:
        result.warnings.append(f"Text extraction error: {type(exc).__name__}")
    return result


def _normalize_text(text: str) -> str:
    """
    Normalize extracted text without destroying meaning.

    - Collapse runs of whitespace within lines
    - Collapse runs of blank lines to at most two
    - Strip leading/trailing whitespace
    """
    # Normalize line endings
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    # Collapse horizontal whitespace within lines
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in text.split("\n")]
    # Collapse multiple blank lines
    normalized = re.sub(r"\n{3,}", "\n\n", "\n".join(lines))
    return normalized.strip()


# ---------------------------------------------------------------------------
# Chunking
# ---------------------------------------------------------------------------


def chunk_text(
    extraction: ExtractionResult,
    *,
    max_tokens: int = _MAX_CHUNK_TOKENS,
    overlap_tokens: int = _CHUNK_OVERLAP_TOKENS,
) -> list[DocumentChunkData]:
    """
    Split an extraction using the strategy that fits its content type.

    - Spreadsheets / PDF tables: row batches with the header repeated in every
      chunk, so a retrieved row still carries its column names.
    - DOCX / Markdown / HTML / ODF: heading-aware sections, merged when tiny,
      then token-aware splitting inside a section.
    - PDF / slides / images / plain text: page- or slide-aware recursive
      splitting, preserving paragraph, line, sentence, and word boundaries.

    All strategies keep chunks within `max_tokens` and are linear in input size.
    """
    import tiktoken

    tokenizer = tiktoken.get_encoding("cl100k_base")
    effective_overlap = max(0, min(overlap_tokens, max_tokens - 1))

    kind = extraction.kind
    pages = extraction.pages
    if kind in {"docx", "markdown", "html", "odf"}:
        pages = _merge_small_pages(pages, tokenizer, max_tokens)

    chunks: list[DocumentChunkData] = []
    offset = 0

    for page in pages:
        # Spreadsheet page.text is a rendering of the same rows we chunk below;
        # chunking both would duplicate every cell in the index.
        if page.tables and kind != "spreadsheet" and page.text.strip():
            offset = _append_text_chunks(
                chunks,
                page,
                tokenizer,
                offset,
                max_tokens=max_tokens,
                overlap_tokens=effective_overlap,
            )
        elif page.text.strip() and not page.tables:
            offset = _append_text_chunks(
                chunks,
                page,
                tokenizer,
                offset,
                max_tokens=max_tokens,
                overlap_tokens=effective_overlap,
            )

        for table in page.tables:
            offset = _append_table_chunks(
                chunks,
                table,
                page_number=page.page_number,
                section_heading=page.section_heading,
                kind=kind,
                max_tokens=max_tokens,
                tokenizer=tokenizer,
                offset=offset,
            )

    return chunks


def _append_text_chunks(
    chunks: list[DocumentChunkData],
    page: ExtractedPage,
    tokenizer: Any,
    offset: int,
    *,
    max_tokens: int,
    overlap_tokens: int,
) -> int:
    """Split prose within one section and keep its heading on every chunk.

    Repeating the section title makes each chunk independently meaningful when
    retrieved on its own, while the tokenizer budget shrinks by the header size
    so the final chunk still respects `max_tokens`. A section with no body (an
    orphan heading) yields no chunk because its text carries no answer.
    """
    from langchain_text_splitters import RecursiveCharacterTextSplitter

    heading_title = _heading_title(page.section_heading)
    body = page.text.strip()
    if heading_title and body.startswith(heading_title):
        body = body[len(heading_title) :].lstrip(" \n\t:-")

    header = f"{heading_title}\n\n" if heading_title else ""
    header_tokens = len(tokenizer.encode(header)) if header else 0
    if header_tokens >= max_tokens - 4:
        header = ""
        header_tokens = 0

    body_budget = max(1, max_tokens - header_tokens)
    effective_overlap = max(0, min(overlap_tokens, body_budget - 1))
    splitter = RecursiveCharacterTextSplitter.from_tiktoken_encoder(
        encoding_name="cl100k_base",
        chunk_size=body_budget,
        chunk_overlap=effective_overlap,
        separators=["\n\n", "\n", ". ", " ", ""],
        keep_separator=True,
        add_start_index=True,
    )

    documents = splitter.create_documents([body]) if body else []
    for document in documents:
        content = _strip_leading_separators(document.page_content)
        if not content:
            continue
        if header and not content.startswith(heading_title):
            content = f"{header}{content}"
        start = offset + int(document.metadata.get("start_index", 0))
        chunks.append(
            DocumentChunkData(
                content=content,
                chunk_index=len(chunks),
                page_number=page.page_number,
                section_heading=_clip_heading(page.section_heading),
                start_char=start,
                end_char=start + len(content),
                token_count=len(tokenizer.encode(content)),
                content_hash=_content_hash(content),
            )
        )
    return offset + len(page.text) + 2


def _heading_title(section_heading: str | None) -> str:
    if not section_heading:
        return ""
    return section_heading.split(" > ")[-1].strip()


def _strip_leading_separators(value: str) -> str:
    """Remove punctuation left in front of a chunk by overlap slicing."""
    content = value.strip()
    while content and content[0] in ".;,:-":
        content = content[1:].lstrip()
    return content


def _merge_small_pages(
    pages: list[ExtractedPage],
    tokenizer: Any,
    max_tokens: int,
) -> list[ExtractedPage]:
    """Carry orphan heading-only sections into the section that follows them.

    Body sections are never merged, so their heading metadata stays precise
    for citations even when they are short.
    """
    merged: list[ExtractedPage] = []
    buffered: ExtractedPage | None = None
    buffered_tokens = 0
    merge_budget = max(60, int(max_tokens * 0.5))

    def flush_buffer() -> None:
        nonlocal buffered, buffered_tokens
        if buffered is not None:
            merged.append(buffered)
            buffered = None
            buffered_tokens = 0

    for page in pages:
        if page.tables:
            flush_buffer()
            merged.append(page)
            continue

        tokens = len(tokenizer.encode(page.text)) if page.text else 0
        if buffered is None:
            buffered = page
            buffered_tokens = tokens
            continue

        can_merge = _is_heading_only(buffered) and (buffered_tokens + tokens) <= merge_budget

        if can_merge:
            buffered = ExtractedPage(
                page_number=page.page_number,
                text=f"{buffered.text}\n\n{page.text}".strip(),
                section_heading=page.section_heading or buffered.section_heading,
            )
            buffered_tokens += tokens
        else:
            merged.append(buffered)
            buffered = page
            buffered_tokens = tokens

    flush_buffer()
    return merged


def _is_heading_only(page: ExtractedPage) -> bool:
    if not page.text.strip():
        return True
    if not page.section_heading:
        return False
    heading_title = page.section_heading.split(" > ")[-1].strip()
    return page.text.strip() == heading_title


def _append_table_chunks(
    chunks: list[DocumentChunkData],
    table: TableData,
    *,
    page_number: int,
    section_heading: str | None,
    kind: str,
    max_tokens: int,
    tokenizer: Any,
    offset: int,
) -> int:
    """Batch table rows, repeating the header row in every emitted chunk."""
    rows = [
        [_clean_cell(cell) for cell in row]
        for row in table.rows
        if any(str(cell or "").strip() for cell in row)
    ]
    if not rows:
        return offset

    width = max(len(row) for row in rows)
    rows = [row + [""] * (width - len(row)) for row in rows]
    header, data = rows[0], rows[1:]
    label = "Sheet" if kind == "spreadsheet" else "Table"
    title = _clip_heading(table.title) or label
    prefix = f"{label}: {title}"
    if kind == "pdf" and page_number:
        prefix = f"{prefix} (page {page_number})"

    header_block = _render_markdown_table([header], include_separator=True)
    base_tokens = len(tokenizer.encode(f"{prefix}\n\n{header_block}"))

    if base_tokens >= max_tokens:
        # Extremely wide header: honour the token budget rather than emitting
        # an oversized chunk. Header repetition is impossible here.
        fallback = _render_markdown_table(rows, include_separator=True)
        return _append_plain_text(
            chunks,
            f"{prefix}\n\n{fallback}",
            page_number=page_number,
            section_heading=section_heading or title,
            max_tokens=max_tokens,
            tokenizer=tokenizer,
            offset=offset,
        )

    if not data:
        return _append_table_chunk(
            chunks,
            prefix,
            header_block,
            [],
            0,
            0,
            page_number,
            section_heading or title,
            tokenizer,
            offset,
        )

    batch_lines: list[str] = []
    batch_tokens = base_tokens
    batch_start = 0
    total = len(data)

    for index, row in enumerate(data):
        line = _render_markdown_row(row)
        line_tokens = len(tokenizer.encode(line)) + 1

        if line_tokens > max_tokens - base_tokens:
            if batch_lines:
                offset = _append_table_chunk(
                    chunks,
                    prefix,
                    header_block,
                    batch_lines,
                    batch_start,
                    batch_start + len(batch_lines) - 1,
                    page_number,
                    section_heading or title,
                    tokenizer,
                    offset,
                    total,
                )
                batch_lines = []
                batch_tokens = base_tokens
            offset = _append_wide_row(
                chunks,
                prefix,
                header_block,
                row,
                index,
                total,
                page_number,
                section_heading or title,
                max_tokens,
                tokenizer,
                offset,
            )
            batch_start = index + 1
            continue

        if batch_lines and batch_tokens + line_tokens > max_tokens:
            offset = _append_table_chunk(
                chunks,
                prefix,
                header_block,
                batch_lines,
                batch_start,
                batch_start + len(batch_lines) - 1,
                page_number,
                section_heading or title,
                tokenizer,
                offset,
                total,
            )
            batch_start = index
            batch_lines = [line]
            batch_tokens = base_tokens + line_tokens
        else:
            batch_lines.append(line)
            batch_tokens += line_tokens

    if batch_lines:
        offset = _append_table_chunk(
            chunks,
            prefix,
            header_block,
            batch_lines,
            batch_start,
            batch_start + len(batch_lines) - 1,
            page_number,
            section_heading or title,
            tokenizer,
            offset,
            total,
        )
    return offset


def _append_table_chunk(
    chunks: list[DocumentChunkData],
    prefix: str,
    header_block: str,
    lines: list[str],
    first_row: int,
    last_row: int,
    page_number: int,
    heading: str | None,
    tokenizer: Any,
    offset: int,
    total_rows: int | None = None,
) -> int:
    range_label = ""
    if total_rows is not None:
        range_label = f" (rows {first_row + 1}-{last_row + 1} of {total_rows})"
    content = f"{prefix}{range_label}\n\n{header_block}"
    if lines:
        content = f"{content}\n" + "\n".join(lines)
    chunks.append(
        DocumentChunkData(
            content=content,
            chunk_index=len(chunks),
            page_number=page_number,
            section_heading=_clip_heading(heading),
            start_char=offset,
            end_char=offset + len(content),
            token_count=len(tokenizer.encode(content)),
            content_hash=_content_hash(content),
        )
    )
    return offset + len(content) + 2


def _append_wide_row(
    chunks: list[DocumentChunkData],
    prefix: str,
    header_block: str,
    row: list[str],
    row_index: int,
    total_rows: int,
    page_number: int,
    heading: str | None,
    max_tokens: int,
    tokenizer: Any,
    offset: int,
) -> int:
    """Split a single oversized row while keeping the table header attached."""
    from langchain_text_splitters import RecursiveCharacterTextSplitter

    line = _render_markdown_row(row)
    room = max(40, max_tokens - len(tokenizer.encode(f"{prefix}\n\n{header_block}")))
    splitter = RecursiveCharacterTextSplitter.from_tiktoken_encoder(
        encoding_name="cl100k_base",
        chunk_size=room,
        chunk_overlap=0,
        separators=[" | ", "; ", ", ", " ", ""],
        keep_separator=True,
    )
    pieces = splitter.split_text(line) or [line]
    for piece in pieces:
        offset = _append_table_chunk(
            chunks,
            prefix,
            header_block,
            [piece],
            row_index,
            row_index,
            page_number,
            heading,
            tokenizer,
            offset,
            total_rows,
        )
    return offset


def _append_plain_text(
    chunks: list[DocumentChunkData],
    text: str,
    *,
    page_number: int,
    section_heading: str | None,
    max_tokens: int,
    tokenizer: Any,
    offset: int,
) -> int:
    from langchain_text_splitters import RecursiveCharacterTextSplitter

    splitter = RecursiveCharacterTextSplitter.from_tiktoken_encoder(
        encoding_name="cl100k_base",
        chunk_size=max_tokens,
        chunk_overlap=0,
        separators=["\n\n", "\n", ". ", " ", ""],
        keep_separator=True,
    )
    for piece in splitter.split_text(text):
        content = piece.strip()
        if not content:
            continue
        chunks.append(
            DocumentChunkData(
                content=content,
                chunk_index=len(chunks),
                page_number=page_number,
                section_heading=_clip_heading(section_heading),
                start_char=offset,
                end_char=offset + len(content),
                token_count=len(tokenizer.encode(content)),
                content_hash=_content_hash(content),
            )
        )
        offset += len(content) + 2
    return offset


def _render_markdown_row(row: list[str]) -> str:
    return "| " + " | ".join(row) + " |"


def _render_markdown_table(rows: list[list[str]], *, include_separator: bool = False) -> str:
    if not rows:
        return ""
    width = max(len(row) for row in rows)
    normalized = [row + [""] * (width - len(row)) for row in rows]
    lines = [_render_markdown_row(row) for row in normalized]
    if include_separator:
        lines.insert(1, "| " + " | ".join(["---"] * width) + " |")
    return "\n".join(lines)


def _clean_cell(value: Any) -> str:
    return " ".join(str(value or "").replace("|", "\\|").split())


def embed_chunks(chunks: list[DocumentChunkData]) -> list[DocumentChunkData]:
    """
    Compute embeddings for all chunks in batches.

    Updates each chunk's .embedding field in-place and returns the list.
    """
    texts = [c.content for c in chunks]
    embeddings = embed_documents(texts)
    for chunk, embedding in zip(chunks, embeddings, strict=True):
        chunk.embedding = embedding
    return chunks


def _content_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:32]
