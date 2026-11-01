# Project Structure

## Top-level layout

```
RAG/
├── backend/          Python FastAPI backend
├── frontend/         Next.js 14 frontend
├── docs/             Architecture and development documentation
├── docker/           Docker support files
├── scripts/          One-off operational scripts
└── docker-compose.yml  Local development stack
```

---

## Backend structure

```
backend/
├── app/
│   ├── main.py               Application entry point; creates FastAPI app, registers middleware
│   ├── core/
│   │   ├── config.py         Pydantic Settings — all configuration, validated at startup
│   │   ├── security.py       Password hashing (Argon2id), JWT creation/verification
│   │   ├── exceptions.py     All application exceptions with HTTP status codes
│   │   ├── logging.py        Structlog configuration — JSON structured logs
│   │   └── middleware.py     CorrelationID, RequestLogging, SecurityHeaders, error handler
│   ├── api/
│   │   ├── router.py         Mounts all versioned routers at /api/v1
│   │   ├── dependencies.py   FastAPI Depends() — auth, authorization, tenant resolution
│   │   └── v1/
│   │       ├── auth.py       POST /login, /register, /logout, /refresh, password-reset
│   │       ├── chat.py       Conversations, messages, /ask, /ask/stream, /feedback
│   │       ├── documents.py  Upload, list, get, delete, reindex, download
│   │       └── health.py     /live and /ready health checks
│   ├── db/
│   │   ├── base.py           DeclarativeBase, UUIDMixin, TimestampMixin, SoftDeleteMixin
│   │   ├── session.py        Async engine, session factory, get_db() dependency
│   │   └── models/
│   │       ├── organization.py  Organization model
│   │       ├── user.py          User, OrganizationMembership, RefreshSession
│   │       ├── document.py      Document, DocumentChunk (with pgvector), ProcessingJob
│   │       ├── conversation.py  Conversation, Message, ConversationSummary, Feedback
│   │       └── audit.py         AuditLog, UsageRecord
│   ├── schemas/
│   │   ├── auth.py           Login, Register, Token, User Pydantic schemas
│   │   ├── chat.py           Conversation, Message, ChatRequest/Response, Citation
│   │   └── document.py       Document, ProcessingJob schemas
│   ├── services/
│   │   ├── auth_service.py   Registration, login, refresh, password reset
│   │   ├── ingestion_service.py  Text extraction, chunking, embedding coordination
│   │   ├── retrieval_service.py  Hybrid retrieval (vector + FTS + RRF + reranking)
│   │   └── rag_service.py    Full RAG pipeline: retrieval → prompt → Groq → citations
│   ├── providers/
│   │   ├── groq_client.py    Groq SDK wrapper — the ONLY Groq import in the codebase
│   │   ├── embeddings.py     sentence-transformers BGE embedding model
│   │   └── reranker.py       CrossEncoder BGE reranker model
│   ├── workers/
│   │   ├── celery_app.py     Celery app configuration, queues, retry policy
│   │   └── document_tasks.py ingest_document task: extract → chunk → embed → index
│   └── storage/
│       ├── interface.py      Abstract StorageBackend base class
│       └── local_storage.py  Disk-based storage (swap for S3 by replacing this file)
├── alembic/
│   ├── env.py                Alembic async migration environment
│   └── versions/
│       └── 0001_initial_schema.py  Complete initial schema with all tables and indexes
├── tests/
│   ├── conftest.py           Shared fixtures (test DB, HTTP client)
│   ├── unit/
│   │   ├── test_security.py  Password hashing, JWT creation/verification
│   │   ├── test_ingestion.py Text normalization, chunking, extraction
│   │   └── test_retrieval.py RRF fusion, citation extraction
│   └── tenant_isolation/
│       └── test_isolation.py Security tests for cross-tenant data access
├── pyproject.toml            Dependencies, Ruff, mypy, pytest config
├── alembic.ini               Alembic settings
└── Dockerfile                Multi-stage container build
```

---

## Frontend structure

```
frontend/
├── src/
│   ├── app/
│   │   ├── layout.tsx            Root layout — AuthProvider, fonts, global CSS
│   │   ├── page.tsx              Root page — redirects to /login
│   │   ├── globals.css           Tailwind directives, scrollbar, focus, reduced-motion
│   │   ├── (public)/             Unauthenticated pages (no layout wrapping)
│   │   │   ├── login/page.tsx    Animated login with Framer Motion orbs
│   │   │   ├── register/page.tsx Registration form
│   │   │   └── forgot-password/  Password recovery
│   │   └── (protected)/          Auth-guarded pages (wrapped in AppShell)
│   │       ├── layout.tsx        Checks auth; redirects to /login if unauthenticated
│   │       ├── chat/page.tsx     Main chat interface with streaming + citations
│   │       ├── documents/page.tsx Document management with upload zone
│   │       ├── admin/page.tsx    Admin dashboard
│   │       └── settings/page.tsx User settings
│   ├── components/
│   │   └── layout/
│   │       └── AppShell.tsx      Collapsible sidebar + mobile overlay navigation
│   ├── features/
│   │   └── auth/
│   │       └── AuthContext.tsx   React context for user state + login/logout actions
│   ├── lib/
│   │   ├── api/
│   │   │   ├── client.ts         Fetch wrapper with 401 refresh, cookie credentials
│   │   │   ├── auth.ts           Typed auth API methods
│   │   │   ├── chat.ts           Typed chat API methods (including streaming)
│   │   │   └── documents.ts      Typed document API methods
│   │   ├── validation/
│   │   │   └── schemas.ts        Zod schemas for all forms
│   │   └── utils/
│   │       ├── cn.ts             clsx + twMerge helper
│   │       └── format.ts         formatBytes, relativeTime, truncate
│   └── types/
│       └── index.ts              TypeScript types mirroring backend schemas
├── package.json
├── tsconfig.json
├── tailwind.config.ts
├── next.config.ts               API proxy to backend, security headers
└── Dockerfile
```

---

## Data flow summary

```
User types question
  → Next.js sends POST /api/v1/chat/ask (credentials: include)
    → FastAPI validates JWT cookie → extracts user_id, org_id
      → RAGService.answer(question, conv_id, user_id, org_id)
        → RetrievalService.retrieve(query, org_id)
          → pgvector search (WHERE org_id=?)
          → FTS search (WHERE org_id=?)
          → RRF fusion → reranking
        → Build prompt with [Source N] blocks
        → GroqClient.generate(messages)
        → Extract citations from source_map (server-side)
      → Persist messages + UsageRecord
    → Return ChatResponse
  → Next.js renders Markdown + CitationsPanel
```
