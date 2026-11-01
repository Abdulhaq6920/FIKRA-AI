FROM python:3.11-slim AS base

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

# ── Dependency layer (cached unless pyproject.toml changes) ──────────────
COPY pyproject.toml .
RUN uv venv .venv && \
    uv pip install --python .venv/bin/python -e ".[dev]"

ENV PATH="/app/.venv/bin:$PATH"

# ── Application code ─────────────────────────────────────────────────────
COPY . .

# Non-root user for security
RUN useradd -m -u 1000 appuser && \
    chown -R appuser:appuser /app
USER appuser

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
