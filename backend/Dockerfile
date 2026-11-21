FROM python:3.12-slim AS base

# Install uv for fast dependency management
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

WORKDIR /app

# System dependencies for document processing
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    poppler-utils \
    libmagic1 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# ── Dependency layer ──────────────────────────────────────────────────────
# Only runtime dependencies are installed. Tests and developer tools are run
# by CI outside the image, so pytest/mypy/ruff never ship to production.
# `app/` is copied here because setuptools needs the package to build the
# editable install; the full source is copied again in the runtime stage.
FROM base AS deps
COPY pyproject.toml ./
COPY app ./app
RUN uv venv /opt/venv && \
    uv pip install --python /opt/venv/bin/python torch==2.3.1 --index-url https://download.pytorch.org/whl/cpu && \
    uv pip install --python /opt/venv/bin/python -e .

# ── Runtime image ─────────────────────────────────────────────────────────
FROM base AS runtime

ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

COPY --from=deps /opt/venv /opt/venv
COPY . .

# Non-root user for security
RUN useradd -m -u 1000 appuser && \
    chown -R appuser:appuser /app
USER appuser

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
