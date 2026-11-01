# Tenant Isolation — FIKRA AI

## Why this matters

FIKRA AI serves multiple independent organizations from a single database. A data leakage bug could expose one organization's confidential documents to another. This document explains every layer of defense.

---

## Isolation layers

### 1. JWT claims carry tenant identity

Every access token contains:
```json
{ "sub": "<user_id>", "org": "<organization_id>", "role": "member" }
```

The `org` claim is set by the server at login time. It cannot be changed by the client. Every protected API request extracts tenant identity from this claim — never from a query parameter, request header, or request body field.

### 2. Database-level tenant filters

Every query against a tenant-owned table includes `WHERE organization_id = :org_id`. This is enforced in:

- `retrieval_service.py`: `_vector_search()` and `_keyword_search()` both filter by `organization_id`.
- `chat.py`: Conversation ownership check: `WHERE id=? AND user_id=? AND organization_id=?`
- `documents.py`: `_get_doc_or_404()` filters by both `id` and `organization_id`.
- `rag_service.py`: `_load_conversation()` checks both `user_id` and `organization_id`.

### 3. Defense-in-depth: Document table has org_id on chunks too

`document_chunks` stores its own `organization_id` column (denormalized). This means a vector search can filter by tenant directly on the chunks table without needing a JOIN to `documents`. Both tables are filtered.

### 4. Background jobs re-verify tenant

When a Celery task executes, it receives `document_id` and `organization_id` as arguments. The first thing the task does is query:

```python
SELECT * FROM documents WHERE id=? AND organization_id=?
```

If an attacker somehow queued a job with a mismatched `organization_id`, the query returns `None` and the task raises `ValueError`. It does not process the document.

### 5. Citation construction uses server-side data only

The LLM receives numbered context blocks `[Source 1]`, `[Source 2]`, etc. The citation objects are built from the `source_map` — a Python dictionary built from database query results for the authenticated organization. The model cannot inject a reference to an unauthorized document by generating `[Source 99]`, because 99 is not in the source map.

### 6. Storage path namespacing

Uploaded files are stored at `{org_id}/{doc_id}/{uuid}.{ext}`. There is no way to construct a path that crosses organization boundaries. Path traversal is prevented in `LocalStorageBackend._resolve()` by checking that the resolved path starts with the configured base directory.

### 7. Redis key namespacing

(To be implemented in Phase 9.) All Redis keys should use `{org_id}:` as a prefix.

---

## What the tests verify

See `tests/tenant_isolation/test_isolation.py`:

1. `test_citation_extraction_uses_only_provided_source_map` — a model-generated `[Source 2]` with no authorized source is silently dropped.
2. `test_chunk_ids_from_different_orgs_cannot_be_fused_into_unauthorized_result` — an empty source map produces no citations.
3. `test_rrf_does_not_mix_org_passages` — RRF fusion logic itself is deterministic and doesn't invent passages.

Full integration tests (requiring PostgreSQL) should verify:
- User A cannot GET `/api/v1/documents/{org_b_doc_id}` — returns 404.
- User A cannot GET `/api/v1/chat/conversations/{org_b_conv_id}/messages` — returns 404.
- Vector search for org A does not return chunks owned by org B.

---

## Known limitations

- PostgreSQL Row-Level Security (RLS) is not yet enabled. It is the recommended next defense-in-depth layer. Add a policy: `CREATE POLICY tenant_isolation ON documents USING (organization_id = current_setting('app.current_org_id')::uuid)`.
- The current implementation does not implement document-level ACLs within an organization (access_level = 'restricted' is a placeholder). All org members see all org documents.
