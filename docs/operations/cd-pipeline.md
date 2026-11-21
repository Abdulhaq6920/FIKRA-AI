# FIKRA AI — Continuous Deployment Pipeline

**Added:** 2026-11-21 · **Related:** O-3 (production image build/rollback path) in the
[Release Checklist](release-checklist.md). This implements the pipeline; the remote deploy and
rollback rehearsal still need to be executed on a Docker host before O-3 can be marked closed.

CI builds and tests every commit but never ships it. This pipeline takes the commit that reached
`main`, builds the three production images, pushes them to GitHub Container Registry (GHCR), and
rolls them out to a Linux host over SSH with a one-shot migration step, health gates and automatic
image rollback.

---

## 1. Flow

```mermaid
flowchart LR
    A[push to main] --> B[CI gates commit<br/>ci.yml]
    B --> C[cd.yml / publish<br/>build + push to GHCR]
    C --> D[cd.yml / deploy<br/>SSH to production host]
    D --> E[login + pull images]
    E --> F[alembic upgrade head<br/>one-shot job]
    F --> G[up -d backend worker frontend]
    G --> H[wait /health/ready + /]
    H -->|ok| I[write .deploy-tag]
    H -->|fail| J[redeploy previous tag]
```

Key properties:

- **Immutable tags.** Every image is tagged with the full commit SHA. `latest` is also updated for
  convenience, but the deploy never uses it.
- **Config is versioned.** `docker-compose.prod.yml` is copied from the repo on every deploy, so the
  host cannot drift from the code being released.
- **Migrations before traffic.** `docker compose run --rm migrate` must exit 0 before any app
  container is started.
- **Health-gated.** The deploy finishes only after `/api/v1/health/ready` and the frontend root both
  answer 200 (up to 5 minutes each, to allow model warm-up).
- **Automatic image rollback.** On any failure, the previous SHA in `.deploy-tag` is redeployed.
- **No parallel deploys.** `concurrency: cd-production` with `cancel-in-progress: false`.

---

## 2. Files

| File | Purpose |
|---|---|
| `.github/workflows/cd.yml` | Triggers, image build/push, SSH rollout |
| `docker-compose.prod.yml` | Production-only stack (no bind mounts, no `--reload`, no published DB ports) |
| `deploy/deploy.sh` | Remote rollout, health checks, rollback. Piped over SSH; not stored on the host. |
| `frontend/Dockerfile` | Accepts `BACKEND_URL` as a build arg; runs as non-root in production |

> Why `BACKEND_URL` is a build arg: Next.js serialises `rewrites()` into
> `.next/routes-manifest.json` at build time. Setting it only at container runtime has no effect on
> the `/api/*` proxy, so CD passes `BACKEND_URL=http://backend:8000` while building the image.

---

## 3. Host prerequisites

1. Ubuntu 22.04+ (or similar) with **Docker Engine 24+** and the **Compose v2** plugin
   (`docker compose version`), plus `curl` and `openssh-server`.
2. A dedicated deploy user with key-only SSH access. If the user is in the `docker` group, remember
   that this is effectively root — restrict who has the key.
3. Outbound HTTPS to `ghcr.io` (image pull) and inbound access to port `3000` from your reverse proxy
   or users. Port `8000` is published on `127.0.0.1` only; terminate TLS at a reverse proxy.
4. A deploy directory, e.g. `/opt/fikra`, owned by the deploy user. It will hold the compose file,
   `.env` and `.deploy-tag`.

### SSH key and fingerprint

On the machine where you generate the key (NOT the server):

```bash
ssh-keygen -t ed25519 -f ~/.ssh/fikra_cd -C "github-actions-cd"
# Add ~/.ssh/fikra_cd.pub to ~deploy/.ssh/authorized_keys on the host, then:
ssh-keygen -lf ~/.ssh/fikra_cd.pub
# 256 SHA256:AbCdEf... fikra_cd (ED25519)   <-- store the SHA256:... value
```

Generate the known-hosts entry with `ssh-keyscan -H "$DEPLOY_HOST"` on a trusted network and store
its output as the `SSH_KNOWN_HOSTS` secret. The private key goes in `SSH_PRIVATE_KEY`. See the table
in §4 for details.

---

## 4. GitHub configuration

Create an Environment named **`production`** (`Settings → Environments → New environment`). Put the
following in it:

| Kind | Name | Example | Notes |
|---|---|---|---|
| Variable | `DEPLOY_HOST` | `fikra.example.com` | SSH hostname or IP |
| Variable | `DEPLOY_USER` | `deploy` | SSH user |
| Variable | `DEPLOY_PATH` | `/opt/fikra` | Must already exist |
| Variable | `APP_URL` | `https://fikra.example.com` | Shown on the Actions environment page |
| Variable | `HEALTH_URL` | `http://127.0.0.1:8000/api/v1/health/ready` | Optional; default shown |
| Variable | `FRONTEND_URL` | `http://127.0.0.1:3000/` | Optional; default shown |
| Secret | `SSH_PRIVATE_KEY` | `-----BEGIN OPENSSH PRIVATE KEY-----…` | Contents of `~/.ssh/fikra_cd` |
| Secret | `SSH_KNOWN_HOSTS` | `fikra.example.com ssh-ed25519 AAAA…` | Output of `ssh-keyscan -H $DEPLOY_HOST` |

`BACKEND_URL` is read from repository variables (fallback `http://backend:8000`). Set it at
`Settings → Secrets and variables → Actions → Variables` only if the API is not reachable at that
Docker service name during the build.

The workflow uses the built-in `GITHUB_TOKEN` with `packages: write`, so **no registry PAT is
needed**. The token is passed to the host only for the duration of `docker login`; it expires when
the job ends. A later manual `docker pull` on the host needs a new login — that is intentional.
Consider a read-only PAT in `REGISTRY_TOKEN` if you need persistent pulls on the host.

**Branch protection:** require the `backend`, `frontend`, `docker` and `frontend-e2e` checks from
`ci.yml` before merging to `main`. This is what guarantees CD only ships tested commits.

---

## 5. Host `.env`

Create `/opt/fikra/.env` with mode `0600`. It is never copied into an image or committed.

```dotenv
# Database — use the compose service name as host, not localhost
POSTGRES_DB=fikra
POSTGRES_USER=fikra
POSTGRES_PASSWORD=<strong-password>
DATABASE_URL=postgresql+asyncpg://fikra:<strong-password>@postgres:5432/fikra

# Broker / cache
REDIS_URL=redis://redis:6379/0
CELERY_BROKER_URL=redis://redis:6379/2
CELERY_RESULT_BACKEND=redis://redis:6379/3

# Application (production guards are enforced at import)
APP_ENV=production
DEBUG=false
SECRET_KEY=<openssl rand -hex 32>
JWT_SECRET_KEY=<different openssl rand -hex 32>
ALLOWED_ORIGINS=https://fikra.example.com

# Provider + vector store
GROQ_API_KEY=<key>
QDRANT_URL=https://<cluster>.<region>.aws.cloud.qdrant.io
QDRANT_API_KEY=<key>
QDRANT_COLLECTION=fikra-ai

# Optional: self-hosted Qdrant instead of Qdrant Cloud
# COMPOSE_PROFILES=local-qdrant
# QDRANT_URL=http://qdrant:6333
```

Notes:

- `APP_ENV=production` and `DEBUG=false` are also forced by the compose file; production config
  validation rejects weak JWT secrets and wildcard `ALLOWED_ORIGINS` at startup.
- URL-encode special characters in passwords used inside `DATABASE_URL`.
- The current dev `docker-compose.yml` has hard-coded credentials. Do **not** reuse its values.

---

## 6. Deploying

Push to `main`, or run the workflow manually (`Actions → CD → Run workflow`) and optionally supply a
commit SHA in `ref`. The manual path is also how you redeploy a known-good revision.

Watch `Actions → CD → deploy` for the step labels `Pulling images`, `Applying migrations`,
`Rolling out`, `backend readiness`, `frontend`.

Verify on the host:

```bash
cd /opt/fikra
cat .deploy-tag                                  # SHA of the running release
docker compose -f docker-compose.prod.yml ps
curl -fsS http://127.0.0.1:8000/api/v1/health/ready
curl -fsS http://127.0.0.1:3000/ >/dev/null && echo frontend-ok
docker compose -f docker-compose.prod.yml logs --tail=100 backend
```

---

## 7. Rollback

### Automatic

If any deploy step fails, `deploy/deploy.sh` redeploys the SHA stored in `.deploy-tag` and the job
fails loudly. Check the `Roll out` step output for `Rolling back to <sha>`.

### Manual

Run `CD → Run workflow` with `ref` set to the last known-good commit SHA. That commit is checked
out, its compose file is copied, and images are tagged with that SHA, so the rollback is a real
redeploy rather than a tag shuffle.

> **Migrations are not downgraded automatically.** A one-shot `alembic upgrade head` always moves
> forward. If a release includes a destructive migration, follow the expand/contract rule (one
> release of backwards compatibility) and use the migration runbook in
> [production-readiness-plan.md](production-readiness-plan.md) for a data rollback. Rolling back
> images across a destructive migration is not safe.

---

## 8. Security notes

- No secrets are stored in the repository or baked into images. The host `.env` is the only source.
- The SSH private key and known-hosts entry come from a GitHub Environment, so you can require
  reviewers before anyone can deploy.
- Database, Redis (and optional local Qdrant) ports are not published to the host network.
- The frontend image runs as the unprivileged `node` user.
- `REGISTRY_TOKEN` appears briefly in the remote process list during `docker login`; it is a
  short-lived `GITHUB_TOKEN`. Use a scoped read-only PAT if that is unacceptable.
- The CD workflow has only `contents: read` and `packages: write`.

---

## 9. Remaining work

- Prometheus/Grafana alerting (O-2) is still open; health probes are wired but nothing alerts on
  them.
- Load test at 3× peak (O-4) is still open — deploy readiness is not capacity readiness.
- The backend image still installs dev dependencies (plan WS-9). Moving to a runtime-only image is a
  separate change.
- If the deployment spans more than one host, uploaded files must move to object storage (plan
  §6.4); the named `uploads_data` volume is single-host only.
