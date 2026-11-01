# ADR-004: Authentication Design

**Status**: Accepted  
**Date**: 2026-01-01

## Decision: JWT in HttpOnly cookies + Argon2id + refresh token rotation

## Password hashing: Argon2id

Argon2id won the Password Hashing Competition (2015). It is memory-hard (resistant to GPU/ASIC cracking), side-channel resistant, and the current OWASP recommendation.

Parameters chosen: 64MB memory, 3 iterations, 4 parallelism. This makes each hash take ~100ms on a modern CPU — acceptable for login, prohibitive for offline brute force.

Alternative rejected: bcrypt (CPU-only, not memory-hard; OWASP recommends Argon2 for new systems).

## Token storage: HttpOnly cookies, not localStorage

| Storage | XSS risk | CSRF risk |
|---------|---------|---------|
| localStorage | **High** (JS can read) | None |
| HttpOnly cookie | None (JS cannot read) | Mitigated with SameSite=Strict |
| SessionStorage | **High** | None |

HttpOnly + SameSite=Strict cookies are the OWASP-recommended approach for browser applications. The access token is set as a cookie; the frontend never handles the raw token value.

## Refresh token: opaque random string, server-side hash

Refresh tokens are 64-byte cryptographically random strings (not JWTs). They are:
- Stored as SHA-256 hashes in `refresh_sessions`
- Never logged
- Rotated on each use (old token revoked, new token issued)
- Scoped to `/api/v1/auth` path to limit exposure

Server-side storage enables instant revocation (e.g., on logout or compromise).

## Generic login errors

The login endpoint returns the same `AUTHENTICATION_FAILED` error whether the email doesn't exist or the password is wrong. This prevents account enumeration attacks. Password reset does the same.

## Consequences

- CSRF protection: SameSite=Strict means the cookie isn't sent on cross-origin requests. Adequate for same-origin API calls from the frontend.
- Mobile/API clients: Can use the `Authorization: Bearer` header instead of cookies. The dependency in `dependencies.py` checks both.
- Refresh token storage: The `refresh_sessions` table grows over time. Add a scheduled cleanup job to delete expired sessions.
