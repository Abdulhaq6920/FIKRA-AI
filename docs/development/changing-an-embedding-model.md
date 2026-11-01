# Changing an Embedding Model

When you switch to a different embedding model, existing vectors become incompatible.
All documents must be re-embedded.

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

### 2. Update the Alembic migration

The `document_chunks.embedding` column is typed as `Vector(384)`.
You need a migration to change the dimension:

```powershell
cd backend
alembic revision -m "change_embedding_dimensions_to_1024"
```

Edit the generated migration:

```python
def upgrade():
    op.execute("DROP INDEX IF EXISTS ix_chunks_embedding_ivfflat")
    op.alter_column(
        "document_chunks",
        "embedding",
        type_=Vector(1024),
        existing_nullable=True,
    )
    op.execute("""
        CREATE INDEX ix_chunks_embedding_ivfflat
        ON document_chunks USING ivfflat (embedding vector_cosine_ops)
        WITH (lists = 100)
    """)

def downgrade():
    # reverse the above
    ...
```

### 3. Run the migration

```powershell
alembic upgrade head
```

### 4. Mark all documents for reindexing

```sql
UPDATE documents
SET status = 'reindexing'
WHERE is_active = true AND status = 'ready';
```

Or use the admin API to reindex each document:
```
POST /api/v1/documents/{id}/reindex
```

### 5. Re-run the Celery worker

The worker will pick up reindexing tasks and re-embed all chunks with the new model.

### 6. Verify

Check that `documents.embedding_model` and `embedding_model_version` reflect the new model.

```sql
SELECT DISTINCT embedding_model, embedding_model_version
FROM documents WHERE is_active = true;
```

All documents should show the new model name and version hash.

## Warnings

- **Never mix vectors from different models** in the same index. Cosine distance between incompatible vectors produces meaningless results.
- The IVFFlat index must be dropped before the column type changes (PostgreSQL constraint).
- Re-embedding takes ~1 second per ~10 chunks on CPU. For 10,000 documents with 50 chunks each, budget ~14 hours on a single CPU worker.
