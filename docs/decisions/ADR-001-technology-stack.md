# ADR-001: Technology Stack

**Status**: Accepted  
**Date**: 2026-01-01

## Context

We need to build a production-grade multi-tenant RAG chatbot. The stack must support:
- Async I/O for concurrent API requests
- Native ML ecosystem for local embeddings and reranking
- Strong type safety to catch bugs early
- A single deployable unit (modular monolith, not microservices)

## Decisions

### Backend: Python + FastAPI

**Why FastAPI**: ASGI-native async framework with automatic OpenAPI generation, Pydantic v2 integration, and a large ML ecosystem. Alternative considered: Django (sync-first, heavier).

### Database: PostgreSQL + Qdrant

**Why Qdrant**: Purpose-built vector search with server-side payload filtering, so tenant isolation is enforced before ANN candidate selection. Supports a managed cloud tier as well as self-hosting. PostgreSQL keeps relational rows and full-text search. Alternative considered: pgvector (kept vectors in Postgres but coupled index tuning and drift to the relational schema).

### Embeddings: BAAI/bge-small-en-v1.5

**Why BGE**: Strong English retrieval benchmark scores (MTEB). 384 dimensions (small storage, fast search). Apache 2.0 license. Runs on CPU without GPU. The BGE query prefix convention improves retrieval accuracy.

**Limitations**: English-optimized. For multilingual use, evaluate `BAAI/bge-m3` (1024 dims, multilingual).

### LLM: Groq (llama3-8b-8192)

**Why Groq**: Ultra-low latency inference via custom LPU hardware. `llama3-8b-8192` is fast, instruction-following, and free-tier friendly. See ADR-005 for model selection rationale.

### Frontend: Next.js 14 + App Router

**Why Next.js**: SSR + client components in one framework. File-based routing. First-class TypeScript. Large ecosystem (shadcn/ui, Framer Motion). Alternative considered: Remix (smaller ecosystem).

### Authentication: JWT + Argon2id + HttpOnly cookies

**Why HttpOnly cookies**: Tokens are inaccessible to JavaScript, preventing XSS theft. SameSite=Strict prevents CSRF. Alternative considered: localStorage (rejected — XSS-vulnerable).

### Queue: Celery + Redis

**Why Celery**: Mature Python task queue with retry policies, timeouts, and monitoring (Flower). Redis as broker is simple and already in the stack for caching.

## Consequences

- Workers share the application codebase — model loading happens at worker startup.
- Changing the embedding model requires reindexing all documents.
- Reindexing writes to both PostgreSQL and Qdrant; both stores must stay in sync for retrieval to resolve passages.
