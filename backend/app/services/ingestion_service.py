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
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from app.core.config import settings
from app.core.logging import get_logger
from app.providers.embeddings import embed_documents, get_model_version

logger = get_logger(__name__)

# Chunk size is measured with the embedding model's tokenizer, not characters.
_MAX_CHUNK_TOKENS = 400
_CHUNK_OVERLAP_TOKENS = 50


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

@dataclass
class ExtractedPage:
    page_number: int
    text: str
    section_heading: str | None = None


@dataclass
class ExtractionResult:
    pages: list[ExtractedPage] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    page_count: int = 0
    word_count: int = 0
    language: str | None = None


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
    Returns an ExtractionResult with per-page text and warnings.
    """
    ext = extension.lower().lstrip(".")

    if ext == "pdf":
        return _extract_pdf(file_bytes)
    elif ext == "docx":
        return _extract_docx(file_bytes)
    elif ext in ("xlsx", "xls", "ods", "csv", "tsv"):
        return _extract_spreadsheet(file_bytes, ext)
    elif ext in ("pptx", "odp"):
        return _extract_presentation(file_bytes, ext)
    elif ext == "odt":
        return _extract_odf_text(file_bytes, ext)
    elif ext in ("md", "markdown"):
        return _extract_markdown(file_bytes)
    elif ext in ("html", "htm"):
        return _extract_html(file_bytes)
    elif ext in ("txt", "rtf"):
        return _extract_txt(file_bytes)
    elif ext in ("png", "jpg", "jpeg", "webp", "bmp", "tif", "tiff"):
        return _extract_image(file_bytes, ext)
    else:
        return ExtractionResult(warnings=[f"Unsupported file type: {ext}"])


def _extract_pdf(data: bytes) -> ExtractionResult:
    import fitz  # PyMuPDF

    result = ExtractionResult()
    try:
        doc = fitz.open(stream=data, filetype="pdf")
        result.page_count = doc.page_count

        for page_num in range(doc.page_count):
            page = doc[page_num]
            text = page.get_text("text")

            table_text = _extract_pdf_tables(page)
            if table_text:
                text = f"{text}\n\n{table_text}" if text else table_text

            # If the page has very little text, attempt OCR
            if len(text.strip()) < 50:
                ocr_text = _ocr_page(page)
                if ocr_text:
                    text = ocr_text
                    result.warnings.append(
                        f"Page {page_num + 1}: used OCR (low text content detected)"
                    )

            if text.strip():
                result.pages.append(
                    ExtractedPage(
                        page_number=page_num + 1,
                        text=_normalize_text(text),
                    )
                )

        doc.close()
    except Exception as exc:
        logger.warning("pdf_extraction_error", error=str(exc)[:200])
        result.warnings.append(f"PDF extraction error: {type(exc).__name__}")

    result.word_count = sum(len(p.text.split()) for p in result.pages)
    return result


def _extract_pdf_tables(page: Any) -> str:
    """Extract PDF tables as Markdown so their row/column relationships survive retrieval."""
    try:
        tables = page.find_tables().tables
        rendered = [_table_to_markdown(table.extract()) for table in tables]
        return "\n\n".join(table for table in rendered if table)
    except Exception as exc:
        logger.debug("pdf_table_extraction_failed", error=str(exc)[:100])
        return ""


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
    result = ExtractionResult(page_count=1)
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
    result = ExtractionResult()
    try:
        import docx

        document = docx.Document(io.BytesIO(data))
        current_heading = None
        all_text: list[str] = []

        for para in document.paragraphs:
            if para.style.name.startswith("Heading"):
                current_heading = para.text.strip()
            if para.text.strip():
                all_text.append(para.text.strip())

        for table_index, table in enumerate(document.tables, start=1):
            table_text = _table_to_markdown(
                [[cell.text.strip() for cell in row.cells] for row in table.rows]
            )
            if table_text:
                all_text.append(f"Table {table_index}:\n{table_text}")

        full_text = "\n\n".join(all_text)
        result.pages.append(
            ExtractedPage(page_number=1, text=_normalize_text(full_text), section_heading=None)
        )
        result.page_count = 1
        result.word_count = len(full_text.split())
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
                text = "".join(node.text or "" for node in paragraph.findall(".//w:t", namespace)).strip()
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


def _extract_spreadsheet(data: bytes, extension: str) -> ExtractionResult:
    """Convert every non-empty sheet/table into Markdown for semantic retrieval."""
    result = ExtractionResult()
    try:
        import pandas as pd

        source = io.BytesIO(data)
        if extension in ("csv", "tsv"):
            frame = pd.read_csv(source, sep="\t" if extension == "tsv" else ",", dtype=str).fillna("")
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
                result.pages.append(ExtractedPage(page_number=page_number, text=_normalize_text(content), section_heading=sheet_name))

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
    result = ExtractionResult()
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
                result.pages.append(ExtractedPage(page_number=number, text=_normalize_text("\n\n".join(pieces))))
        result.page_count = len(presentation.slides)
        result.word_count = sum(len(page.text.split()) for page in result.pages)
    except Exception as exc:
        logger.warning("presentation_extraction_error", extension=extension, error=str(exc)[:200])
        result.warnings.append(f"Presentation extraction error: {type(exc).__name__}")
    return result


def _extract_odf_text(data: bytes, extension: str) -> ExtractionResult:
    """Read OpenDocument text/presentation files through odfpy."""
    result = ExtractionResult(page_count=1)
    try:
        from odf import text as odf_text
        from odf.opendocument import load

        document = load(io.BytesIO(data))
        paragraphs = document.getElementsByType(odf_text.P)
        plain = "\n\n".join("".join(node.data for node in paragraph.childNodes if hasattr(node, "data")).strip() for paragraph in paragraphs)
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
    """Extract plain text from Markdown, stripping formatting."""
    import markdown as md
    from bs4 import BeautifulSoup

    result = ExtractionResult()
    try:
        text = data.decode("utf-8", errors="replace")
        html = md.markdown(text)
        soup = BeautifulSoup(html, "lxml")
        plain = soup.get_text(separator="\n")
        result.pages.append(
            ExtractedPage(page_number=1, text=_normalize_text(plain))
        )
        result.page_count = 1
        result.word_count = len(plain.split())
    except Exception as exc:
        result.warnings.append(f"Markdown extraction error: {type(exc).__name__}")
    return result


def _extract_html(data: bytes) -> ExtractionResult:
    from bs4 import BeautifulSoup

    result = ExtractionResult()
    try:
        soup = BeautifulSoup(data, "lxml")
        tables = [_html_table_to_markdown(table) for table in soup.find_all("table")]
        # Remove non-content elements and tables after preserving their structure.
        for tag in soup(["script", "style", "nav", "footer"]):
            tag.decompose()
        for table in soup.find_all("table"):
            table.decompose()
        plain = soup.get_text(separator="\n")
        table_text = "\n\n".join(table for table in tables if table)
        if table_text:
            plain = f"{plain}\n\nTables:\n{table_text}"
        result.pages.append(
            ExtractedPage(page_number=1, text=_normalize_text(plain))
        )
        result.page_count = 1
        result.word_count = len(plain.split())
    except Exception as exc:
        result.warnings.append(f"HTML extraction error: {type(exc).__name__}")
    return result


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
    result = ExtractionResult()
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
    Split extracted pages with LangChain's token-aware recursive splitter.

    The splitter preserves paragraphs where possible, then falls back through
    line, sentence, word, and character boundaries.  An oversized paragraph
    is therefore always split instead of becoming one oversized database row.
    """
    from langchain_text_splitters import RecursiveCharacterTextSplitter
    import tiktoken

    # Callers may use a small test or preview chunk size. LangChain requires
    # the overlap to be smaller than the chunk size.
    effective_overlap = min(overlap_tokens, max_tokens - 1)
    splitter = RecursiveCharacterTextSplitter.from_tiktoken_encoder(
        encoding_name="cl100k_base",
        chunk_size=max_tokens,
        chunk_overlap=effective_overlap,
        separators=["\n\n", "\n", ". ", " ", ""],
        keep_separator=True,
        add_start_index=True,
    )
    tokenizer = tiktoken.get_encoding("cl100k_base")
    chunks: list[DocumentChunkData] = []

    for page in extraction.pages:
        documents = splitter.create_documents(
            [page.text],
            metadatas=[
                {
                    "page_number": page.page_number,
                    "section_heading": page.section_heading,
                }
            ],
        )
        for document in documents:
            content = document.page_content
            start = int(document.metadata.get("start_index", 0))
            end = start + len(content)
            chunks.append(
                DocumentChunkData(
                    content=content,
                    chunk_index=len(chunks),
                    page_number=document.metadata["page_number"],
                    section_heading=document.metadata["section_heading"],
                    start_char=start,
                    end_char=end,
                    token_count=len(tokenizer.encode(content)),
                    content_hash=_content_hash(content),
                )
            )

    return chunks


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
