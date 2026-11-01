# Authentication Flow — FIKRA AI

## Login sequence

```mermaid
sequenceDiagram
    participant B as Browser
    participant FE as Next.js
    participant API as FastAPI /auth/login
    participant DB as PostgreSQL

    B->>FE: Submit login form (email, password, org_id)
    FE->>API: POST /api/v1/auth/login {email, password, organization_id}
    API->>DB: SELECT user JOIN membership WHERE email=? AND org_id=?
    DB-->>API: user + membership row (or NULL)

    alt User not found or wrong password
        API-->>FE: 401 {code: AUTHENTICATION_FAILED, message: "Invalid credentials."}
        FE-->>B: Show generic error (no account enumeration)
    end

    API->>API: verify_password(plain, argon2_hash)
    API->>API: create_access_token(user_id, org_id, role) → JWT
    API->>API: create_refresh_token() → random 64-byte token
    API->>DB: INSERT refresh_sessions (token_hash=sha256(token))
    API-->>FE: 200 TokenResponse + Set-Cookie: access_token (HttpOnly) + Set-Cookie: refresh_token (HttpOnly, path=/api/v1/auth)
    FE->>API: GET /api/v1/auth/me  (cookie sent automatically)
    API-->>FE: UserPublic {id, email, full_name, role}
    FE-->>B: Redirect to /chat or /admin
```

## Token lifecycle

| Token | Type | Storage | Expiry | Revocation |
|-------|------|---------|--------|------------|
| Access token | Signed JWT | HttpOnly cookie | 30 min (config) | Stateless; wait for expiry |
| Refresh token | Random opaque string | HttpOnly cookie (path=/api/v1/auth) | 7 days (config) | Server-side: `refresh_sessions.is_revoked=true` |

## Security properties

- **No localStorage**: Both tokens are HttpOnly cookies. JavaScript cannot read them. XSS cannot steal them.
- **SameSite=Strict**: CSRF protection. Cookies are not sent on cross-site requests.
- **Argon2id**: Memory-hard password hashing (64MB, 3 iterations, 4 parallelism). Resistant to GPU cracking.
- **Constant-time comparison**: `passlib.verify()` uses a constant-time algorithm.
- **Generic errors**: Login and password-reset responses never reveal whether an email exists.
- **Refresh token rotation**: Each refresh issues a new token and revokes the old one.
- **Password rehashing**: If a stored hash uses outdated parameters, it is transparently re-hashed on next login.

## Password reset flow

```mermaid
sequenceDiagram
    participant U as User
    participant API as FastAPI
    participant DB as PostgreSQL
    participant Email as Email Service

    U->>API: POST /auth/password-reset/initiate {email}
    API->>DB: SELECT user WHERE email=?
    alt User found
        API->>API: create_password_reset_token(user_id) → JWT (30 min)
        API->>DB: UPDATE users SET password_reset_token=sha256(jwt)
        API->>Email: Send reset link with token
    end
    API-->>U: 204 (always, even if email not found)

    U->>API: POST /auth/password-reset/complete {token, new_password}
    API->>API: decode_token(token, type="password_reset")
    API->>DB: SELECT user WHERE id=sub AND password_reset_token=sha256(token)
    API->>API: hash_password(new_password) with Argon2id
    API->>DB: UPDATE users SET hashed_password=?, password_reset_token=NULL
    API-->>U: 204 success
```
