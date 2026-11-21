#!/usr/bin/env bash
# FIKRA AI — remote-side deploy step.
#
# Piped to `bash -s` over SSH by .github/workflows/cd.yml, so it never needs to
# exist on the host. All configuration arrives as environment variables.
# The host only stores .env (secrets) and .deploy-tag (last good image tag).
set -euo pipefail

: "${DEPLOY_PATH:?DEPLOY_PATH is required}"
: "${IMAGE_TAG:?IMAGE_TAG is required}"
: "${REGISTRY:?REGISTRY is required}"
: "${REPOSITORY:?REPOSITORY is required}"
: "${REGISTRY_USER:?REGISTRY_USER is required}"
: "${REGISTRY_TOKEN:?REGISTRY_TOKEN is required}"

DEPLOY_PATH="${DEPLOY_PATH%/}"
COMPOSE_FILE="$DEPLOY_PATH/docker-compose.prod.yml"
STATE_FILE="$DEPLOY_PATH/.deploy-tag"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:8000/api/v1/health/ready}"
FRONTEND_URL="${FRONTEND_URL:-http://127.0.0.1:3000/}"

export REGISTRY REPOSITORY IMAGE_TAG

cd "$DEPLOY_PATH"

log() {
  printf '\n==> %s\n' "$*"
}

PREVIOUS_TAG=""
if [[ -f "$STATE_FILE" ]]; then
  PREVIOUS_TAG="$(tr -d '\r\n ' < "$STATE_FILE")"
fi

wait_for_url() {
  local url="$1" name="$2" attempt
  for attempt in $(seq 1 60); do
    if curl -fsS --max-time 5 "$url" >/dev/null 2>&1; then
      log "$name is ready"
      return 0
    fi
    sleep 5
  done
  echo "$name did not become ready at $url" >&2
  return 1
}

deploy() {
  log "Authenticating with $REGISTRY"
  printf '%s' "$REGISTRY_TOKEN" \
    | docker login "$REGISTRY" --username "$REGISTRY_USER" --password-stdin || return 1

  log "Pulling images tagged $IMAGE_TAG"
  docker compose -f "$COMPOSE_FILE" pull backend worker frontend || return 1

  log "Applying migrations (one-shot job)"
  docker compose -f "$COMPOSE_FILE" run --rm migrate || return 1

  log "Rolling out backend, worker and frontend"
  docker compose -f "$COMPOSE_FILE" up -d --remove-orphans backend worker frontend || return 1

  wait_for_url "$HEALTH_URL" "backend readiness" || return 1
  wait_for_url "$FRONTEND_URL" "frontend" || return 1
}

rollback() {
  if [[ -z "$PREVIOUS_TAG" || "$PREVIOUS_TAG" == "$IMAGE_TAG" ]]; then
    echo "No earlier tag recorded; automatic rollback is not possible." >&2
    return 1
  fi
  log "Rolling back to $PREVIOUS_TAG"
  export IMAGE_TAG="$PREVIOUS_TAG"
  # The previous image may have been pruned from the host; make sure it exists.
  docker compose -f "$COMPOSE_FILE" pull backend worker frontend || true
  if docker compose -f "$COMPOSE_FILE" up -d --remove-orphans backend worker frontend; then
    printf '%s\n' "$PREVIOUS_TAG" > "$STATE_FILE"
  else
    echo "Rollback failed — manual intervention required." >&2
  fi
}

if deploy; then
  printf '%s\n' "$IMAGE_TAG" > "$STATE_FILE"
  log "Deployed $IMAGE_TAG"
else
  log "Deployment failed"
  rollback || true
  exit 1
fi
