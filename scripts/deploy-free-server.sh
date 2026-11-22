#!/usr/bin/env bash
# =====================================================================
# FIKRA AI — Production Server Deployment (100% Free Stack)
#
# Stack (all free, all local, one free API key):
#   PostgreSQL 16   — relational data + full-text search
#   Redis 7         — Celery broker + rate-limit cache
#   Qdrant          — vector store for document embeddings
#   Groq            — free cloud LLM (llama-3.1-8b-instant primary,
#                     openai/gpt-oss-20b fallback on token exhaustion)
#   BGE-small       — local embedding model (~130 MB) — no API key
#   FastAPI backend + Celery worker + Next.js frontend
#   Nginx reverse proxy + Let's Encrypt SSL (free certificates)
#
# Run on your server:
#   chmod +x scripts/deploy-free-server.sh
#   sudo ./scripts/deploy-free-server.sh your-domain.com your-groq-api-key
# =====================================================================

set -euo pipefail

DOMAIN="${1:-}"
GROQ_API_KEY="${2:-}"
if [ -z "$DOMAIN" ]; then
  echo "Usage: $0 <your-domain.com> <your-groq-api-key>"
  echo "Example: $0 fikra.mycompany.com gsk_xxxxxxxxxxxx"
  echo ""
  echo "Get a free Groq API key at: https://console.groq.com"
  exit 1
fi

if [ -z "$GROQ_API_KEY" ]; then
  echo "ERROR: GROQ_API_KEY is required as the second argument."
  echo "Get a free key at https://console.groq.com"
  exit 1
fi

EMAIL="${3:-admin@$DOMAIN}"
SERVER_IP=$(curl -s ifconfig.me 2>/dev/null || echo "unknown")

echo "============================================================"
echo "  FIKRA AI — Free Production Server Deploy"
echo "  Domain:     $DOMAIN"
echo "  Email:      $EMAIL"
echo "  IP:         $SERVER_IP"
echo "  LLM:        Groq (llama-3.1-8b-instant + fallback)"
echo "  Embeddings: BGE-small (local, ~130 MB)"
echo "============================================================"

APP_DIR="/opt/fikra-ai"

# ------------------------------------------------------------------
# Step 1 — Install Docker
# ------------------------------------------------------------------
echo ""
echo "[1/10] Installing Docker..."
if ! command -v docker &> /dev/null; then
  apt-get update -y
  apt-get install -y ca-certificates curl gnupg lsb-release
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
    $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
    tee /etc/apt/sources.list.d/docker.list > /dev/null
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  usermod -aG docker "${SUDO_USER:-${USER}}"
  newgrp docker || true
else
  echo "    Docker already installed."
fi

# ------------------------------------------------------------------
# Step 2 — Install Nginx + Certbot
# ------------------------------------------------------------------
echo ""
echo "[2/10] Installing Nginx + Certbot..."
if ! command -v nginx &> /dev/null; then
  apt-get install -y nginx certbot python3-certbot-nginx
else
  echo "    Nginx already installed."
fi

# ------------------------------------------------------------------
# Step 3 — Ensure repository is present
# ------------------------------------------------------------------
echo ""
echo "[3/10] Checking repository at $APP_DIR..."
if [ -d "$APP_DIR" ]; then
  echo "    Repository already present."
  cd "$APP_DIR"
  git pull --ff-only || echo "    Warning: could not fast-forward; proceeding with existing tree."
else
  echo "    Repository NOT found at $APP_DIR."
  echo "    Please copy your FIKRA AI repo to this server first:"
  echo "      git clone <your-repo-url> $APP_DIR"
  echo "    Then re-run this script."
  exit 1
fi
cd "$APP_DIR"

# ------------------------------------------------------------------
# Step 4 — Generate production .env files (100% free)
# ------------------------------------------------------------------
echo ""
echo "[4/10] Generating production .env files..."

SECRET_KEY=$(openssl rand -hex 64)
JWT_SECRET_KEY=$(openssl rand -hex 64)
# Fernet key: URL-safe base64 of 32 bytes. Prefer python3 (cryptography);
# fall back to openssl with a URL-safe translation.
DATA_ENCRYPTION_KEY=$(python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())" 2>/dev/null || openssl rand -base64 32 | tr '+/' '-_')
POSTGRES_PASSWORD=$(openssl rand -hex 24)
REDIS_PASSWORD=$(openssl rand -hex 24)

# Root .env — Docker Compose reads this automatically for variable substitution
cat > .env <<EOF
# FIKRA AI — Production (100% Free Stack)
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
REDIS_PASSWORD=$REDIS_PASSWORD
DATABASE_URL=postgresql+asyncpg://postgres:${POSTGRES_PASSWORD}@fikra_postgres:5432/rag-prod
REDIS_URL=redis://:${REDIS_PASSWORD}@fikra_redis:6379/0
CELERY_BROKER_URL=redis://:${REDIS_PASSWORD}@fikra_redis:6379/2
CELERY_RESULT_BACKEND=redis://:${REDIS_PASSWORD}@fikra_redis:6379/3
EOF

# Backend .env — full application config
cat > backend/.env <<EOF
# ============================================================
# FIKRA AI — Production (100% Free Stack)
# ============================================================

APP_ENV=production
DEBUG=false

SECRET_KEY=$SECRET_KEY
JWT_SECRET_KEY=$JWT_SECRET_KEY
ACCESS_TOKEN_EXPIRE_MINUTES=30
REFRESH_TOKEN_EXPIRE_DAYS=7

# ---------- Data-at-rest encryption (Fernet) ----------
DATA_ENCRYPTION_KEY=$DATA_ENCRYPTION_KEY

# ---------- LLM (Groq — free cloud API) ----------
# Primary: llama-3.1-8b-instant (~14,400 tokens/min free tier)
# Fallback: openai/gpt-oss-20b (used automatically if primary hits token limit)
LLM_PROVIDER=groq
GROQ_API_KEY=$GROQ_API_KEY
GROQ_PRIMARY_MODEL=llama-3.1-8b-instant
GROQ_FALLBACK_MODEL=openai/gpt-oss-20b
GROQ_MAX_TOKENS=2048
GROQ_TEMPERATURE=0.2
GROQ_TIMEOUT_SECONDS=60
GROQ_MAX_CONCURRENT_REQUESTS=10

# ---------- Database (local PostgreSQL) ----------
DATABASE_URL=postgresql+asyncpg://postgres:${POSTGRES_PASSWORD}@fikra_postgres:5432/rag-prod
DATABASE_SSL=false
DATABASE_POOL_SIZE=5
DATABASE_MAX_OVERFLOW=5
DATABASE_POOL_TIMEOUT=30

# ---------- Redis (local) ----------
REDIS_URL=redis://:${REDIS_PASSWORD}@fikra_redis:6379/0
REDIS_CACHE_DB=1
CELERY_BROKER_URL=redis://:${REDIS_PASSWORD}@fikra_redis:6379/2
CELERY_RESULT_BACKEND=redis://:${REDIS_PASSWORD}@fikra_redis:6379/3

# ---------- Vector store (local Qdrant) ----------
QDRANT_URL=http://fikra_qdrant:6333
QDRANT_API_KEY=
QDRANT_COLLECTION=fikra-ai
QDRANT_TIMEOUT=30

# ---------- CORS (your real domain) ----------
ALLOWED_ORIGINS=["https://$DOMAIN"]

# ---------- Storage (local disk) ----------
STORAGE_BACKEND=local
BLOB_ACCESS=private
UPLOAD_DIR=/app/uploads
MAX_UPLOAD_SIZE_MB=50
ALLOWED_EXTENSIONS=pdf,docx,odt,pptx,odp,xlsx,xls,ods,csv,tsv,md,markdown,html,htm,txt,rtf,png,jpg,jpeg,webp,bmp,tif,tiff

# ---------- Embeddings (local BGE-small — completely free, ~130 MB) ----------
EMBEDDING_MODEL=BAAI/bge-small-en-v1.5
EMBEDDING_DIMENSIONS=384
EMBEDDING_BATCH_SIZE=32
RERANKER_MODEL=BAAI/bge-reranker-base
RERANKER_ENABLED=true

# ---------- Retrieval ----------
RETRIEVAL_TOP_K=20
RERANKER_TOP_N=5
MIN_RELEVANCE_SCORE=0.3
RAG_RETRIEVAL_CANDIDATES=12

# ---------- Upload / Documents ----------
MAX_UPLOAD_SIZE_MB=50
ALLOWED_EXTENSIONS=pdf,docx,odt,pptx,odp,xlsx,xls,ods,csv,tsv,md,markdown,html,htm,txt,rtf,png,jpg,jpeg,webp,bmp,tif,tiff
UPLOAD_DIR=./uploads

# ---------- Workers ----------
WORKER_CONCURRENCY=2

# ---------- Token budgets ----------
MAX_INPUT_TOKENS=6000
MAX_OUTPUT_TOKENS=2048
MAX_CONTEXT_MESSAGES=20
SUMMARIZE_AFTER_MESSAGES=30
RAG_CONTEXT_MAX_PASSAGES=5
RAG_CONTEXT_CHARS_PER_PASSAGE=600
RAG_HISTORY_MAX_MESSAGES=6
RAG_HISTORY_MAX_TOKENS=600
RAG_PROMPT_MAX_TOKENS=2200
RAG_ANSWER_MAX_TOKENS=1024

# ---------- Rate limits ----------
RATE_LIMIT_ENABLED=true
RATE_LIMIT_LOGIN=10/minute
RATE_LIMIT_CHAT=30/minute
RATE_LIMIT_UPLOAD=5/minute
RATE_LIMIT_PASSWORD_RESET=5/hour

# ---------- Public sign-up ----------
PUBLIC_SIGNUP_ORG_IDS=00000000-0000-0000-0000-000000000001

# ---------- Logging ----------
LOG_LEVEL=INFO
LOG_FORMAT=json
LOG_TO_FILE=true
LOG_DIR=/app/logs
LOG_FILE=app.logs
LOG_FILE_MAX_BYTES=20971520
LOG_FILE_BACKUP_COUNT=10

# ---------- Email (optional, leave blank) ----------
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
EMAIL_FROM=noreply@$DOMAIN
EOF

# Frontend env
cat > frontend/.env.local <<EOF
NEXT_PUBLIC_APP_NAME="FIKRA AI"
NEXT_PUBLIC_UPLOAD_MODE=local
BACKEND_URL=http://backend:8000
EOF

echo "    .env files generated (secrets randomized, Groq key configured)."

# ------------------------------------------------------------------
# Step 5 — Docker Compose override for production
# ------------------------------------------------------------------
echo ""
echo "[5/10] Writing docker-compose.override.yml..."

cat > docker-compose.override.yml <<'OVERRIDE'
# FIKRA AI — Production override (all services local, no cloud costs except Groq API)
name: fikra

services:
  postgres:
    image: postgres:16
    container_name: fikra_postgres
    environment:
      POSTGRES_DB: rag-prod
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d rag-prod"]
      interval: 5s
      timeout: 5s
      retries: 10
    restart: unless-stopped

  qdrant:
    image: qdrant/qdrant:latest
    container_name: fikra_qdrant
    volumes:
      - qdrant_data:/qdrant/storage
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    container_name: fikra_redis
    command: redis-server --appendonly yes --requirepass ${REDIS_PASSWORD}
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "${REDIS_PASSWORD}", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5
    restart: unless-stopped

  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    container_name: fikra_backend
    env_file: ./backend/.env
    environment:
      DATABASE_URL: ${DATABASE_URL}
      REDIS_URL: ${REDIS_URL}
      CELERY_BROKER_URL: ${CELERY_BROKER_URL}
      CELERY_RESULT_BACKEND: ${CELERY_RESULT_BACKEND}
      LOG_DIR: /app/logs
      LOG_FILE: backend.log
    volumes:
      - uploads_data:/app/uploads
      - logs_data:/app/logs
    ports:
      - "127.0.0.1:8000:8000"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "curl", "-f", "http://127.0.0.1:8000/api/v1/health/live"]
      interval: 10s
      timeout: 5s
      retries: 10
      start_period: 120s
    restart: unless-stopped

  worker:
    build:
      context: ./backend
      dockerfile: Dockerfile
    container_name: fikra_worker
    env_file: ./backend/.env
    environment:
      DATABASE_URL: ${DATABASE_URL}
      REDIS_URL: ${REDIS_URL}
      CELERY_BROKER_URL: ${CELERY_BROKER_URL}
      CELERY_RESULT_BACKEND: ${CELERY_RESULT_BACKEND}
      LOG_DIR: /app/logs
      LOG_FILE: celery.log
    volumes:
      - uploads_data:/app/uploads
      - logs_data:/app/logs
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    restart: unless-stopped

  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
    container_name: fikra_frontend
    env_file: frontend/.env.local
    environment:
      NEXT_PUBLIC_APP_NAME: "FIKRA AI"
      BACKEND_URL: http://backend:8000
    ports:
      - "127.0.0.1:3000:3000"
    depends_on:
      backend:
        condition: service_healthy
    restart: unless-stopped

volumes:
  postgres_data:
  qdrant_data:
  redis_data:
  uploads_data:
  logs_data:
OVERRIDE

echo "    docker-compose.override.yml written."

# ------------------------------------------------------------------
# Step 6 — Pull images and build
# ------------------------------------------------------------------
echo ""
echo "[6/10] Pulling images and building (may take 10–30 minutes)..."
docker compose pull || true
docker compose build --no-cache

# ------------------------------------------------------------------
# Step 7 — Start the stack
# ------------------------------------------------------------------
echo ""
echo "[7/10] Starting FIKRA AI stack..."
docker compose up -d

echo "Waiting for services to become healthy..."
sleep 30
docker compose ps

# ------------------------------------------------------------------
# Step 8 — Run migrations + seed initial org
# ------------------------------------------------------------------
echo ""
echo "[8/10] Running database migrations and seeding initial organization..."
docker compose exec -T backend alembic upgrade head || true
docker compose exec -T backend python scripts/create_initial_org.py || true

# ------------------------------------------------------------------
# Step 9 — Warm up embedding model (BGE-small, ~130 MB)
# ------------------------------------------------------------------
echo ""
echo "[9/10] Pre-loading embedding model BGE-small (~130 MB download)..."
docker compose exec -T backend python -c "from app.providers.embeddings import _get_model; _get_model(); print('Embedding model ready')" || \
  echo "    Embedding model will load on first request."

# ------------------------------------------------------------------
# Step 10 — Nginx + SSL
# ------------------------------------------------------------------
echo ""
echo "[10/10] Configuring Nginx + Let's Encrypt SSL for $DOMAIN..."

cat > /etc/nginx/sites-available/fikra-ai <<NGINX
server {
    listen 80;
    server_name $DOMAIN www.$DOMAIN;
    return 301 https://\$server_name\$request_uri;
}

server {
    listen 443 ssl http2;
    server_name $DOMAIN www.$DOMAIN;

    ssl_certificate /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    add_header X-Content-Type-Options nosniff;
    add_header X-Frame-Options DENY;
    add_header Referrer-Policy strict-origin-when-cross-origin;

    client_max_body_size 50M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}
NGINX

ln -sf /etc/nginx/sites-available/fikra-ai /etc/nginx/sites-enabled/fikra-ai
rm -f /etc/nginx/sites-enabled/default
nginx -t

# Obtain SSL certificate (may fail if DNS not yet pointing here — that's OK)
certbot --nginx -d "$DOMAIN" -d "www.$DOMAIN" --email "$EMAIL" --agree-tos --non-interactive --redirect || \
  echo "    SSL cert issuance will retry automatically; ensure DNS for $DOMAIN points to $SERVER_IP"

systemctl reload nginx
systemctl enable nginx

# Auto-renewal cron
echo "0 0,12 * * * root certbot renew --quiet --nginx" | tee /etc/cron.d/certbot

# ------------------------------------------------------------------
# Done
# ------------------------------------------------------------------
echo ""
echo "============================================================"
echo "  FIKRA AI deploy complete!"
echo "============================================================"
echo ""
echo "  Frontend:  https://$DOMAIN"
echo "  Login:     https://$DOMAIN/login"
echo "  Email:     admin@fikra.ai"
echo "  Password:  Admin1234!   <-- change after first login"
echo ""
echo "  Manage stack:"
echo "    cd /opt/fikra-ai"
echo "    docker compose ps"
echo "    docker compose logs -f backend"
echo "    docker compose logs -f worker"
echo ""
echo "  Groq fallback behavior:"
echo "    - Primary model:  llama-3.1-8b-instant"
echo "    - Fallback model: openai/gpt-oss-20b (auto-used if primary"
echo "      hits token/rate limit, with exponential backoff)"
echo ""
echo "  Notes:"
echo "    - All infrastructure runs locally — no server costs."
echo "    - Groq free tier: ~14,400 tokens/minute on primary model."
echo "    - If tokens exhaust, the app automatically falls back and retries."
echo "    - Embedding model (BGE-small) downloads on first request (~130 MB)."
echo "    - Change the admin password immediately after first login."
echo ""
echo "  If SSL failed: ensure DNS A record for $DOMAIN points to $SERVER_IP,"
echo "  then run: certbot --nginx -d $DOMAIN -d www.$DOMAIN"
echo "============================================================"
