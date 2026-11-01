# Security Checklist

Use this checklist before deploying to production or after major changes.

## Authentication

- [ ] `JWT_SECRET_KEY` is set to a random 64-byte hex value (not the example)
- [ ] `SECRET_KEY` is set to a random 64-byte hex value
- [ ] `GROQ_API_KEY` is set and not committed to version control
- [ ] Passwords are hashed with Argon2id (verified in `core/security.py`)
- [ ] Access tokens are short-lived (≤ 30 minutes)
- [ ] Refresh tokens are stored as SHA-256 hashes in the database
- [ ] Login endpoint uses generic error messages (no account enumeration)
- [ ] Password reset uses generic response regardless of email existence
- [ ] Tokens are stored in HttpOnly cookies (not localStorage)
- [ ] Cookies have `Secure=true` in production
- [ ] Cookies have `SameSite=Strict`

## Authorization

- [ ] Every protected endpoint uses a `Depends()` from `api/dependencies.py`
- [ ] Tenant context comes from JWT claims, not request body/headers
- [ ] All database queries include `organization_id` filter
- [ ] Background jobs re-verify `organization_id` against the database
- [ ] Resource-level ownership checks are in place (user owns conversation)
- [ ] Platform admin operations are behind `require_platform_admin`

## Input validation

- [ ] File size limit enforced (`MAX_UPLOAD_SIZE_BYTES`)
- [ ] File extension allowlist enforced
- [ ] MIME type detected with python-magic (not trusted from Content-Type)
- [ ] Storage paths are generated server-side (no user input in path)
- [ ] Path traversal check in `LocalStorageBackend._resolve()`
- [ ] SQL uses parameterized queries (SQLAlchemy ORM — no raw string interpolation)
- [ ] FTS uses `plainto_tsquery` (not raw tsquery from user input)
- [ ] Request body size limits set in FastAPI

## Secrets and logging

- [ ] `.env` is in `.gitignore`
- [ ] No API keys, passwords, or tokens in log output
- [ ] No raw stack traces exposed in API error responses
- [ ] `password_reset_token` is never included in API responses
- [ ] `hashed_password` is never included in API responses

## Network

- [ ] CORS `ALLOWED_ORIGINS` restricted to known frontend origins
- [ ] HTTPS enforced in production (HSTS header set)
- [ ] `X-Content-Type-Options: nosniff` header set
- [ ] `X-Frame-Options: DENY` header set
- [ ] `Content-Security-Policy` header set
- [ ] OpenAPI docs disabled in production (`docs_url=None`)

## Document processing

- [ ] Uploaded files are not served as application routes
- [ ] File downloads require authentication (`/documents/{id}/download`)
- [ ] OCR/extraction errors are caught; raw exceptions not exposed to users
- [ ] Document content treated as untrusted in RAG system prompt

## Prompt injection defence

- [ ] System prompt instructs model to ignore document-embedded instructions
- [ ] Document content is passed as passive context, not as instructions
- [ ] Citations are constructed from server-side `source_map`, not model output
- [ ] Model cannot access Groq API key or internal configuration

## Infrastructure

- [ ] Database password is not `fikrapass` in production
- [ ] Redis is not exposed to the public internet
- [ ] Docker volumes use named volumes (not bind mounts in production)
- [ ] Container runs as non-root user (uid 1000 in Dockerfile)

## Dependency security

- [ ] Run `pip-audit` or `safety check` on Python dependencies
- [ ] Run `npm audit` on frontend dependencies
- [ ] Pin dependency versions in `pyproject.toml` and `package.json`

## Audit

- [ ] `AuditLog` records are written for user management operations
- [ ] `AuditLog` records are written for admin operations
- [ ] Audit logs are not deletable by ordinary users
