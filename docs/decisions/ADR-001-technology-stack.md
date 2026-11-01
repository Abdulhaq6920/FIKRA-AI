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

### Database: PostgreSQL + pgvector

**Why pgvector**: Stores vectors and relational data in the same database. No separate vector database service to operate. Supports ACID transactions, so document + chunk insertion is atomic. IVFFlat index scales to millions of vectors. Alternative considered: Qdrant (external service, operational complexity).

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
- pgvector IVFFlat requires `VACUUM ANALYZE` after large insertions to update index statistics.
