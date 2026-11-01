# Glossary

| Term | Definition |
|------|-----------|
| **RAG** | Retrieval-Augmented Generation. An AI pattern where relevant documents are fetched and provided as context before the LLM generates an answer. |
| **Tenant** | An organization. Every resource belongs to exactly one tenant. |
| **Tenant isolation** | The guarantee that one tenant cannot access another tenant's data. |
| **pgvector** | A PostgreSQL extension that adds a `vector` column type for similarity search. |
| **IVFFlat** | An approximate nearest neighbor index algorithm used by pgvector for fast vector search at scale. |
| **Bi-encoder** | An embedding model that encodes query and passage separately into vectors. Fast but less precise. |
| **Cross-encoder** | A model that jointly encodes a query-passage pair. Slower but more accurate than bi-encoders. Used for reranking. |
| **RRF** | Reciprocal Rank Fusion. Merges multiple ranked lists by scoring each item as `Σ 1/(k + rank)`. |b
| **Chunk** | A bounded text segment extracted from a document, with a vector embedding for retrieval. |
| **Embedding** | A numeric vector representation of text that captures semantic meaning. |
| **Groq** | A hosted LLM inference provider using custom LPU hardware for low-latency generation. |
| **JWT** | JSON Web Token. A signed token carrying claims (user ID, org ID, role, expiry). |
| **Argon2id** | The current OWASP-recommended password hashing algorithm. Memory-hard and side-channel resistant. |
| **HttpOnly cookie** | A browser cookie that JavaScript cannot read, preventing XSS-based token theft. |
| **SameSite=Strict** | A cookie attribute preventing the cookie from being sent on cross-site requests (CSS protection). |
| **Celery** | A Python distributed task queue used for background document ingestion. |
| **Redis** | An in-memory data store used as the Celery broker and application cache. |
| **HuggingFace** | A platform hosting open ML models including the BGE embedding and reranker models. |
| **BGE** | BAAI General Embedding — a family of open-source embedding models. |
| **Prompt injection** | An attack where malicious instructions embedded in document content attempt to override the system prompt. |
| **Groundedness** | The degree to which an LLM answer is supported by the retrieved evidence rather than hallucinated. |
| **Abstention** | The system's ability to say "I cannot answer from the available documents" instead of fabricating a response. |
| **Citation** | A structured reference to a source document, validated server-side from retrieval metadata. |
| **Token budget** | A configurable limit on the number of tokens sent to or received from the LLM, controlling cost. |
| **Soft delete** | Marking a record inactive (`is_active=false`) instead of physically deleting it from the database. |
| **Alembic** | A database migration tool for SQLAlchemy that manages schema changes over time. |
