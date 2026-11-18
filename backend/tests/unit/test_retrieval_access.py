"""
Authorization and fusion unit tests that need no database.

What these tests block:

* Privilege persistence — ``get_current_user_and_org`` must authorize on the
  ``organization_memberships`` row, not on the JWT ``role`` claim. A demoted org
  admin whose access token still says ``org_admin`` must be refused by
  ``require_org_admin`` on the very next request. Reading the claim instead was
  a 30-minute fail-open window on user creation, role assignment, password
  reset of other members, access-request approval and restricted-document
  download.
* Cross-tenant membership — a token for organization A must not authenticate
  against organization B; the membership lookup is scoped to the claimed org
  and a missing/inactive row is a 403, never a fallback.
* Fusion aliasing — ``_reciprocal_rank_fusion`` must not mutate the passage
  objects shared with the vector/keyword result lists, otherwise scores depend
  on call order and a fused passage can carry a stale score into reranking.

Both stubs are plain objects: no engine, no session, no PostgreSQL.
"""

from __future__ import annotations

import uuid

import pytest
from starlette.requests import Request

from app.api.dependencies import get_current_user_and_org, require_org_admin
from app.core.exceptions import AuthenticationError, PermissionDeniedError
from app.db.models.user import OrganizationMembership, OrgRole, User, UserStatus
from app.services.retrieval_service import RetrievedPassage, _reciprocal_rank_fusion


# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------
def _request() -> Request:
    """Minimal ASGI request: the dependency only writes to ``request.state``."""
    return Request({"type": "http", "method": "GET", "path": "/", "headers": []})


def _user(*, status: UserStatus = UserStatus.ACTIVE, is_platform_admin: bool = False) -> User:
    return User(
        id=uuid.uuid4(),
        email="member@example.com",
        email_normalized="member@example.com",
        hashed_password="x",
        full_name="Member",
        status=status,
        is_platform_admin=is_platform_admin,
    )


def _membership(
    *,
    user_id: uuid.UUID,
    organization_id: uuid.UUID,
    role: OrgRole,
    is_active: bool = True,
) -> OrganizationMembership:
    return OrganizationMembership(
        id=uuid.uuid4(),
        user_id=user_id,
        organization_id=organization_id,
        role=role,
        is_active=is_active,
    )


class _StubSession:
    """Returns a fixed user and membership, ignoring the query predicates."""

    def __init__(
        self,
        *,
        user: User | None,
        membership: OrganizationMembership | None,
    ) -> None:
        self._user = user
        self._membership = membership
        self.scalar_calls = 0

    async def get(self, model: type, pk: object) -> User | None:
        return self._user

    async def scalar(self, statement: object) -> OrganizationMembership | None:
        self.scalar_calls += 1
        return self._membership


def _passage(chunk_id: uuid.UUID | None = None, score: float = 0.5) -> RetrievedPassage:
    return RetrievedPassage(
        chunk_id=chunk_id or uuid.uuid4(),
        document_id=uuid.uuid4(),
        document_title="Doc",
        content="text",
        page_number=1,
        section_heading=None,
        score=score,
        retrieval_method="vector",
        similarity=score,
    )


# ---------------------------------------------------------------------------
# The membership row is the authorization source of truth
# ---------------------------------------------------------------------------
class TestRoleComesFromTheDatabase:
    async def test_membership_role_overrides_the_token_claim(self) -> None:
        user = _user()
        org_id = uuid.uuid4()
        # Token claims a role the database does not back.
        payload = {"sub": str(user.id), "org": str(org_id), "role": "member"}
        membership = _membership(user_id=user.id, organization_id=org_id, role=OrgRole.ORG_ADMIN)

        _returned_user, returned_org, role = await get_current_user_and_org(
            request=_request(),
            payload=payload,
            db=_StubSession(user=user, membership=membership),  # type: ignore[arg-type]
        )

        assert returned_org == org_id
        assert role == OrgRole.ORG_ADMIN.value
        assert role != payload["role"], "the JWT role claim must never be returned"

    async def test_demoted_admin_with_stale_admin_claim_is_refused(self) -> None:
        user = _user()
        org_id = uuid.uuid4()
        # The access token was minted while the user was an admin.
        payload = {"sub": str(user.id), "org": str(org_id), "role": "org_admin"}
        membership = _membership(user_id=user.id, organization_id=org_id, role=OrgRole.MEMBER)

        ctx = await get_current_user_and_org(
            request=_request(),
            payload=payload,
            db=_StubSession(user=user, membership=membership),  # type: ignore[arg-type]
        )

        with pytest.raises(PermissionDeniedError):
            await require_org_admin(ctx=ctx)

    async def test_active_admin_membership_is_authorized(self) -> None:
        user = _user()
        org_id = uuid.uuid4()
        payload = {"sub": str(user.id), "org": str(org_id), "role": "member"}
        membership = _membership(user_id=user.id, organization_id=org_id, role=OrgRole.ORG_ADMIN)

        ctx = await get_current_user_and_org(
            request=_request(),
            payload=payload,
            db=_StubSession(user=user, membership=membership),  # type: ignore[arg-type]
        )
        assert await require_org_admin(ctx=ctx) is ctx

    async def test_missing_membership_is_forbidden(self) -> None:
        """No membership row for the claimed org => 403, never a fallback role."""
        user = _user()
        payload = {"sub": str(user.id), "org": str(uuid.uuid4()), "role": "org_admin"}

        with pytest.raises(PermissionDeniedError):
            await get_current_user_and_org(
                request=_request(),
                payload=payload,
                db=_StubSession(user=user, membership=None),  # type: ignore[arg-type]
            )

    async def test_inactive_user_is_rejected_before_any_authorization(self) -> None:
        user = _user(status=UserStatus.DISABLED)
        org_id = uuid.uuid4()
        payload = {"sub": str(user.id), "org": str(org_id), "role": "org_admin"}
        membership = _membership(user_id=user.id, organization_id=org_id, role=OrgRole.ORG_ADMIN)
        db = _StubSession(user=user, membership=membership)

        with pytest.raises(AuthenticationError):
            await get_current_user_and_org(request=_request(), payload=payload, db=db)  # type: ignore[arg-type]
        assert db.scalar_calls == 0


# ---------------------------------------------------------------------------
# RRF fusion must be side-effect free
# ---------------------------------------------------------------------------
class TestFusionHasNoSideEffects:
    def test_inputs_are_not_mutated(self) -> None:
        shared = _passage(score=0.9)
        vector = [shared, _passage(score=0.8)]
        keyword = [_passage(score=0.7), shared]

        snapshot = [(p.chunk_id, p.score, p.retrieval_method, p.similarity) for p in vector]
        snapshot += [(p.chunk_id, p.score, p.retrieval_method, p.similarity) for p in keyword]

        fused = _reciprocal_rank_fusion([vector, keyword], k=60)

        after = [(p.chunk_id, p.score, p.retrieval_method, p.similarity) for p in vector]
        after += [(p.chunk_id, p.score, p.retrieval_method, p.similarity) for p in keyword]
        assert after == snapshot, "fusion mutated a passage shared with its input lists"

        inputs = [*vector, *keyword]
        assert all(all(f is not p for p in inputs) for f in fused), (
            "fused passages must be copies, not aliases of the input objects"
        )

    def test_rrf_scores_are_unchanged(self) -> None:
        first = _passage(score=0.9)
        second = _passage(score=0.8)
        fused = _reciprocal_rank_fusion([[first, second], [second, first]], k=60)
        scores = {p.chunk_id: p.score for p in fused}
        # rank 1 in one list + rank 2 in the other
        expected = 1.0 / 61 + 1.0 / 62
        assert scores[first.chunk_id] == pytest.approx(expected)
        assert scores[second.chunk_id] == pytest.approx(expected)

    def test_order_is_deterministic_across_list_order(self) -> None:
        a = _passage(score=0.9)
        b = _passage(score=0.8)
        c = _passage(score=0.7)
        forward = [p.chunk_id for p in _reciprocal_rank_fusion([[a, b, c], [b, c]], k=60)]
        backward = [p.chunk_id for p in _reciprocal_rank_fusion([[b, c], [a, b, c]], k=60)]
        assert forward == backward
