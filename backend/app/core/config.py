"""
Central typed configuration using Pydantic Settings.

All configuration is loaded from environment variables (or a .env file).
The application validates all settings at startup and fails fast on missing
or invalid values — no silent misconfigurations in production.
"""

from __future__ import annotations

import secrets
from functools import lru_cache
from typing import Literal

from pydantic import AnyHttpUrl, Field, PostgresDsn, RedisDsn, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ------------------------------------------------------------------
    # Application
    # ------------------------------------------------------------------
    app_name: str = Field(default="FIKRA AI")
    app_env: Literal["development", "staging", "production"] = Field(default="development")
    debug: bool = Field(default=False)
    secret_key: str = Field(default_factory=lambda: secrets.token_hex(64))

    # ------------------------------------------------------------------
    # Groq LLM
    # ------------------------------------------------------------------
    groq_api_key: str = Field(default="")
    groq_primary_model: str = Field(default="llama-3.1-8b-instant")
    groq_fallback_model: str | None = Field(default="openai/gpt-oss-20b")
    groq_max_tokens: int = Field(default=2048, ge=256, le=8192)
    groq_temperature: float = Field(default=0.2, ge=0.0, le=2.0)
    groq_timeout_seconds: int = Field(default=60, ge=5)
    groq_max_concurrent_requests: int = Field(default=10, ge=1)
    # Approximate token pricing used for analytics cost estimates (USD per
    # million tokens). Defaults suit the small Groq models used by this app;
    # override them in .env when you switch providers or models.
    groq_input_cost_per_million_usd: float = Field(default=0.10, ge=0.0)
    groq_output_cost_per_million_usd: float = Field(default=0.50, ge=0.0)

    # ------------------------------------------------------------------
    # Database
    # ------------------------------------------------------------------
    database_url: str = Field(default="postgresql+asyncpg://postgres:root@localhost:5432/rag-prod")
    # Cloud deployments (Neon free = max 10 connections): set pool_size=5, max_overflow=5
    # Local development: pool_size=20, max_overflow=40 are fine
    database_pool_size: int = Field(default=5, ge=1)
    database_max_overflow: int = Field(default=5, ge=0)
    database_pool_timeout: int = Field(default=30, ge=5)
    # Set DATABASE_SSL=true when connecting to Neon or any cloud Postgres
    database_ssl: bool = Field(default=False)

    # ------------------------------------------------------------------
    # Redis
    # ------------------------------------------------------------------
    redis_url: str = Field(default="redis://localhost:6379/0")
    redis_cache_db: int = Field(default=1, ge=0)

    # ------------------------------------------------------------------
    # JWT / Auth
    # ------------------------------------------------------------------
    jwt_secret_key: str = Field(default_factory=lambda: secrets.token_hex(64))
    jwt_algorithm: str = Field(default="HS256")
    access_token_expire_minutes: int = Field(default=30, ge=5)
    refresh_token_expire_days: int = Field(default=7, ge=1)

    # ------------------------------------------------------------------
    # CORS
    # ------------------------------------------------------------------
    allowed_origins: list[str] = Field(default=["http://localhost:3000"])

    @field_validator("allowed_origins", mode="before")
    @classmethod
    def parse_origins(cls, v: str | list[str]) -> list[str]:
        if isinstance(v, str):
            v = v.strip()
            if v.startswith("["):
                import json
                return json.loads(v)
            return [o.strip() for o in v.split(",") if o.strip()]
        return v

    # ------------------------------------------------------------------
    # Embeddings & Reranking
    # ------------------------------------------------------------------
    embedding_model: str = Field(default="BAAI/bge-small-en-v1.5")
    embedding_dimensions: int = Field(default=384, ge=64)
    embedding_batch_size: int = Field(default=32, ge=1)
    reranker_model: str = Field(default="BAAI/bge-reranker-base")
    reranker_enabled: bool = Field(default=True)

    # ------------------------------------------------------------------
    # Retrieval
    # ------------------------------------------------------------------
    retrieval_top_k: int = Field(default=20, ge=1, le=100)
    reranker_top_n: int = Field(default=5, ge=1, le=20)
    min_relevance_score: float = Field(default=0.3, ge=0.0, le=1.0)
    # Candidate pool passed to fusion/reranking before the prompt is built.
    rag_retrieval_candidates: int = Field(default=12, ge=1, le=100)

    # ------------------------------------------------------------------
    # Upload / Documents
    # ------------------------------------------------------------------
    max_upload_size_mb: int = Field(default=50, ge=1)
    # Text, office, spreadsheet, presentation, HTML, and OCR-capable image formats.
    # Keep this allow-list explicit: uploads are untrusted input.
    allowed_extensions: list[str] = Field(
        default=[
            "pdf", "docx", "odt", "pptx", "odp", "xlsx", "xls", "ods", "csv", "tsv",
            "md", "markdown", "html", "htm", "txt", "rtf",
            "png", "jpg", "jpeg", "webp", "bmp", "tif", "tiff",
        ]
    )
    upload_dir: str = Field(default="./uploads")

    @field_validator("allowed_extensions", mode="before")
    @classmethod
    def parse_extensions(cls, v: str | list[str]) -> list[str]:
        if isinstance(v, str):
            v = v.strip()
            if v.startswith("["):
                import json
                return [e.strip().lower() for e in json.loads(v)]
            return [e.strip().lower() for e in v.split(",") if e.strip()]
        return v

    @property
    def max_upload_size_bytes(self) -> int:
        return self.max_upload_size_mb * 1024 * 1024

    # ------------------------------------------------------------------
    # Celery Workers
    # ------------------------------------------------------------------
    worker_concurrency: int = Field(default=4, ge=1)
    celery_broker_url: str = Field(default="redis://localhost:6379/2")
    celery_result_backend: str = Field(default="redis://localhost:6379/3")

    # ------------------------------------------------------------------
    # Token budgets
    # ------------------------------------------------------------------
    max_input_tokens: int = Field(default=6000, ge=512)
    max_output_tokens: int = Field(default=2048, ge=256)
    max_context_messages: int = Field(default=20, ge=2)
    summarize_after_messages: int = Field(default=30, ge=10)
    # RAG prompt budget. Groq's free tier enforces a low tokens-per-minute
    # limit, so keeping each request small is what allows several consecutive
    # questions without a 429. These are deliberately independent of the
    # retrieval knobs above: retrieve a wide candidate pool, send a small,
    # high-signal prompt.
    rag_context_max_passages: int = Field(default=5, ge=1, le=20)
    rag_context_chars_per_passage: int = Field(default=600, ge=200, le=4000)
    rag_history_max_messages: int = Field(default=6, ge=0, le=50)
    rag_history_max_tokens: int = Field(default=600, ge=0, le=8000)
    rag_prompt_max_tokens: int = Field(default=2200, ge=1000, le=30000)
    # Chat answers are concise; reserving fewer output tokens keeps the
    # provider's tokens-per-minute accounting low enough for rapid follow-ups.
    rag_answer_max_tokens: int = Field(default=1024, ge=256, le=8192)

    # ------------------------------------------------------------------
    # Rate limits
    # ------------------------------------------------------------------
    rate_limit_login: str = Field(default="10/minute")
    rate_limit_chat: str = Field(default="30/minute")
    rate_limit_upload: str = Field(default="5/minute")

    # ------------------------------------------------------------------
    # Logging
    # ------------------------------------------------------------------
    log_level: str = Field(default="INFO")
    log_format: Literal["json", "console"] = Field(default="json")

    # ------------------------------------------------------------------
    # Email (optional)
    # ------------------------------------------------------------------
    smtp_host: str | None = Field(default=None)
    smtp_port: int = Field(default=587)
    smtp_user: str | None = Field(default=None)
    smtp_password: str | None = Field(default=None)
    email_from: str = Field(default="noreply@fikra.ai")

    # ------------------------------------------------------------------
    # Derived helpers
    # ------------------------------------------------------------------
    @property
    def is_production(self) -> bool:
        return self.app_env == "production"

    @property
    def email_enabled(self) -> bool:
        return bool(self.smtp_host and self.smtp_user)

    @model_validator(mode="after")
    def validate_production_secrets(self) -> "Settings":
        """In production, reject placeholder/default secrets."""
        if self.is_production:
            if self.jwt_secret_key.startswith("CHANGE_ME"):
                raise ValueError("jwt_secret_key must be set to a real secret in production")
            if not self.groq_api_key or self.groq_api_key.startswith("gsk_CHANGE"):
                raise ValueError("groq_api_key must be set in production")
        return self


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return a cached Settings singleton. Called once at import time."""
    return Settings()


# Module-level convenience alias used throughout the application.
settings = get_settings()
