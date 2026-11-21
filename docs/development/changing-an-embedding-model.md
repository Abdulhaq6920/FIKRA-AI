# Changing an Embedding Model

When you switch to a different embedding model, existing vectors become incompatible.
All documents must be re-embedded and the Qdrant collection rebuilt.

## When to change

- You need multilingual support (switch from `bge-small-en` to `bge-m3`)
- You found a better benchmark model
- You need different dimensions for storage/cost reasons

## Steps

### 1. Update configuration

Edit `backend/.env`:

```env
EMBEDDING_MODEL=BAAI/bge-m3
EMBEDDING_DIMENSIONS=1024
```

**Critical**: `EMBEDDING_DIMENSIONS` must match the model's actual output size.
BGE-small-en = 384, BGE-m3 = 1024, all-MiniLM-L6-v2 = 384.

No Alembic migration is needed — PostgreSQL does not store vectors anymore.

### 2. Recreate the Qdrant collection

The collection's vector size is fixed at creation time. Delete it so application
startup recreates it with the new dimension:

```powershell
cd backend
..\.venv\Scripts\python.exe -c "import asyncio; from app.providers.vector_store import drop_collection; asyncio.run(drop_collection())"
```

(Or use the Qdrant Cloud console / `qdrant-client` directly.)

Restart the API and the Celery worker: both call `ensure_collection()` at
startup, which recreates the collection and its `organization_id` /
`document_id` payload indexes.

### 3. Mark all documents for reindexing

```sql
UPDATE documents
SET status = 'reindexing'
WHERE is_active = true AND status = 'ready';
```

Or reindex each document through the admin API:

```
POST /api/v1/documents/{id}/reindex
```

### 4. Run the Celery worker

The worker re-embeds every chunk and replaces the old Qdrant points for each
document (the point ID is the chunk UUID).

### 5. Verify

Check that `documents.embedding_model` and `embedding_model_version` reflect the new model:

```sql
SELECT DISTINCT embedding_model, embedding_model_version
FROM documents WHERE is_active = true;
```

All documents should show the new model name and version hash.

## Warnings

- **Never mix vectors from different models** in the same collection. Cosine
  distance between incompatible vectors produces meaningless results.
- Deleting the collection removes every tenant's vectors; reindex before serving
  chat traffic again.
- Re-embedding takes ~1 second per ~10 chunks on CPU. For 10,000 documents with
  50 chunks each, budget ~14 hours on a single CPU worker.
