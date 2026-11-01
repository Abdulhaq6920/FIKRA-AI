# Adding a Document Parser

To support a new file format (e.g., CSV, XLSX, PPTX):

## Step 1: Add the extension to config

Edit `backend/.env`:

```env
ALLOWED_EXTENSIONS=pdf,docx,md,html,txt,csv
```

## Step 2: Add an extraction function

Edit `app/services/ingestion_service.py`:

```python
def _extract_csv(data: bytes) -> ExtractionResult:
    """Extract text from CSV files."""
    import csv
    import io

    result = ExtractionResult()
    try:
        text = data.decode("utf-8", errors="replace")
        reader = csv.reader(io.StringIO(text))
        rows = list(reader)
        # Convert rows to a readable text format
        lines = ["\t".join(row) for row in rows]
        full_text = "\n".join(lines)
        result.pages.append(ExtractedPage(page_number=1, text=_normalize_text(full_text)))
        result.page_count = 1
        result.word_count = len(full_text.split())
    except Exception as exc:
        result.warnings.append(f"CSV extraction error: {type(exc).__name__}")
    return result
```

## Step 3: Register it in the dispatcher

In `app/services/ingestion_service.py`, add to `extract_text()`:

```python
def extract_text(file_bytes: bytes, extension: str) -> ExtractionResult:
    ext = extension.lower().lstrip(".")
    if ext == "pdf":
        return _extract_pdf(file_bytes)
    elif ext == "docx":
        return _extract_docx(file_bytes)
    elif ext in ("md", "markdown"):
        return _extract_markdown(file_bytes)
    elif ext in ("html", "htm"):
        return _extract_html(file_bytes)
    elif ext == "txt":
        return _extract_txt(file_bytes)
    elif ext == "csv":                          # ← add this
        return _extract_csv(file_bytes)
    else:
        return ExtractionResult(warnings=[f"Unsupported file type: {ext}"])
```

## Step 4: Install any new dependency

```powershell
cd backend
uv pip install python-csv  # or whatever library is needed
```

Add it to `pyproject.toml` dependencies list.

## Step 5: Write a test

```python
# tests/unit/test_ingestion.py
class TestCSVExtraction:
    def test_csv_extraction(self):
        content = b"name,age\nAlice,30\nBob,25"
        result = extract_text(content, "csv")
        assert result.page_count == 1
        assert "Alice" in result.pages[0].text
```

That's it. The chunking and embedding pipeline works on any text returned by the extractor — no further changes needed.
