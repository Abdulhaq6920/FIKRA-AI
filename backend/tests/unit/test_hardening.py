"""
Hardening middleware and production-config guard tests.

What these tests block:

* A 50MB upload being fully read into the process before it is rejected. The
  size check must run off the declared ``Content-Length`` so an oversized body
  costs the server nothing. Before the middleware existed, the limit was
  enforced while streaming inside the upload handler, i.e. after the body had
  already been accepted.
* Cross-site request forgery on cookie-authenticated mutations. The API
  authenticates browsers with an HttpOnly ``access_token`` cookie, which a
  browser attaches to requests originating from *any* site. A POST from
  ``https://evil.example`` carrying the user's cookie must be refused, while a
  legitimate origin, a Bearer-only client, and a non-browser client (no
  ``Origin``) must keep working.
* A production deployment booting with ``DEBUG=true``, a placeholder/short JWT
  secret, or a wildcard CORS origin — each of which silently removes a security
  property the design depends on.

No database, no network: a throwaway FastAPI app with only the middleware under
test is used, so these run in the fast unit suite.
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.core.hardening import CSRFOriginMiddleware, RequestSizeLimitMiddleware


def _app() -> FastAPI:
    app = FastAPI()

    @app.post("/mutate")
    async def mutate() -> dict[str, bool]:
        return {"ok": True}

    @app.get("/read")
    async def read() -> dict[str, bool]:
        return {"ok": True}

    return app


def _client_with_size_limit(max_bytes: int) -> TestClient:
    app = _app()
    app.add_middleware(RequestSizeLimitMiddleware, max_bytes=max_bytes)
    return TestClient(app)


def _client_with_csrf() -> TestClient:
    app = _app()
    app.add_middleware(CSRFOriginMiddleware)
    return TestClient(app)


class TestRequestSizeLimit:
    def test_declared_body_over_limit_is_rejected_before_reading(self) -> None:
        client = _client_with_size_limit(max_bytes=10)
        response = client.post("/mutate", content=b"x" * 64)
        assert response.status_code == 413
        body = response.json()["error"]
        assert body["code"] == "PAYLOAD_TOO_LARGE"
        assert "request_id" in body

    def test_body_within_limit_passes(self) -> None:
        client = _client_with_size_limit(max_bytes=1024)
        response = client.post("/mutate", content=b"x" * 64)
        assert response.status_code == 200

    def test_unlimited_methods_without_body_pass(self) -> None:
        client = _client_with_size_limit(max_bytes=1)
        assert client.get("/read").status_code == 200


class TestCSRFOrigin:
    def test_foreign_origin_with_auth_cookie_is_rejected(self) -> None:
        client = _client_with_csrf()
        client.cookies.set("access_token", "session")
        response = client.post("/mutate", headers={"Origin": "https://evil.example"})
        assert response.status_code == 403
        body = response.json()["error"]
        assert body["code"] == "CSRF_ORIGIN_REJECTED"
        assert "request_id" in body

    def test_allowed_origin_with_auth_cookie_passes(self) -> None:
        client = _client_with_csrf()
        client.cookies.set("access_token", "session")
        response = client.post("/mutate", headers={"Origin": "http://localhost:3000"})
        assert response.status_code == 200

    def test_referer_is_used_when_origin_is_absent(self) -> None:
        client = _client_with_csrf()
        client.cookies.set("access_token", "session")
        response = client.post(
            "/mutate",
            headers={"Referer": "https://evil.example/attack.html"},
        )
        assert response.status_code == 403

    def test_non_browser_client_without_origin_passes(self) -> None:
        client = _client_with_csrf()
        client.cookies.set("access_token", "session")
        assert client.post("/mutate").status_code == 200

    def test_bearer_only_client_is_exempt(self) -> None:
        client = _client_with_csrf()
        response = client.post(
            "/mutate",
            headers={
                "Origin": "https://evil.example",
                "Authorization": "Bearer token",
            },
        )
        assert response.status_code == 200

    def test_safe_method_is_never_blocked(self) -> None:
        client = _client_with_csrf()
        client.cookies.set("access_token", "session")
        response = client.get("/read", headers={"Origin": "https://evil.example"})
        assert response.status_code == 200

    def test_origin_comparison_ignores_path_and_case(self) -> None:
        client = _client_with_csrf()
        client.cookies.set("access_token", "session")
        response = client.post(
            "/mutate",
            headers={"Origin": "HTTP://LOCALHOST:3000"},
        )
        assert response.status_code == 200


class TestProductionConfigGuard:
    """A production boot must fail fast on unsafe configuration."""

    def _base(self, **overrides: object) -> dict[str, object]:
        values: dict[str, object] = {
            "app_env": "production",
            "debug": False,
            "llm_provider": "ollama",
            "database_url": "postgresql+asyncpg://u:p@localhost:5432/fikra",
            "jwt_secret_key": "a" * 48,
            "allowed_origins": ["https://app.fikra.ai"],
        }
        values.update(overrides)
        return values

    def test_safe_production_config_boots(self) -> None:
        settings = Settings(**self._base())  # type: ignore[arg-type]
        assert settings.is_production

    def test_debug_is_refused(self) -> None:
        with pytest.raises(ValueError, match="debug"):
            Settings(**self._base(debug=True))  # type: ignore[arg-type]

    def test_wildcard_origin_is_refused(self) -> None:
        with pytest.raises(ValueError, match="allowed_origins"):
            Settings(**self._base(allowed_origins=["*"]))  # type: ignore[arg-type]

    def test_short_or_placeholder_jwt_secret_is_refused(self) -> None:
        with pytest.raises(ValueError, match="jwt_secret_key"):
            Settings(**self._base(jwt_secret_key="short"))  # type: ignore[arg-type]
        with pytest.raises(ValueError, match="jwt_secret_key"):
            Settings(**self._base(jwt_secret_key="CHANGE_ME_" + "a" * 40))  # type: ignore[arg-type]

    def test_placeholder_database_url_is_refused(self) -> None:
        with pytest.raises(ValueError, match="database_url"):
            Settings(
                **self._base(database_url="postgresql+asyncpg://u:CHANGE_ME@h/db")  # type: ignore[arg-type]
            )
