# ADR-002: Multi-Tenancy Model

**Status**: Accepted  
**Date**: 2026-01-01

## Context

The system must serve multiple independent organizations from a single deployment, with complete data isolation.

## Decision: Shared database, row-level tenant filtering

All organizations share the same PostgreSQL database and schema. Every tenant-owned table has an `organization_id` column. Every query includes a `WHERE organization_id = :org_id` clause derived from the authenticated JWT.

## Alternatives considered

| Approach | Rejected reason |
|----------|----------------|
| Separate database per tenant | Operational complexity; schema migrations must run N times |
| Separate schema per tenant | PostgreSQL schema proliferation; harder to query across orgs for platform metrics |
| Separate table per tenant | Not supported well by SQLAlchemy; migration nightmare |

## Enforcement layers

1. **JWT claim** — `org_id` in the access token, signed by the server
2. **Dependency injection** — `get_current_user_and_org()` in every protected route
3. **Query filters** — `organization_id = ?` in every relevant SELECT/UPDATE/DELETE
4. **Denormalized org_id on chunks** — vector search filters on `document_chunks.organization_id` without joining `documents`
5. **Background job verification** — Celery tasks re-query `WHERE id=? AND organization_id=?`
6. **Citation validation** — citations built from server-side source_map, not model output
7. **Storage path namespacing** — `{org_id}/{doc_id}/` prevents path collision

## Future: Row-Level Security

PostgreSQL RLS is the recommended next defense-in-depth layer:

```sql
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON documents
  USING (organization_id = current_setting('app.current_org_id')::uuid);
```

This would make cross-tenant access impossible even if application code forgets the filter. Not yet implemented.

## Consequences

- Every DB query needs an `organization_id` filter — enforced by code review
- Platform admins need special handling (bypass org filter with auditing)
- pgvector IVFFlat index is shared across all tenants — tenant filter applied after ANN candidate selection
