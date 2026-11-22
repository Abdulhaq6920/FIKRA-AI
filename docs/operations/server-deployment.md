# FIKRA AI — Production Server Deployment Guide

Run this on **your own server** (VPS, dedicated box, or on-prem VM).  
This deploys the full stack locally with Docker Compose + Nginx reverse proxy + Let's Encrypt SSL.

---

## 1. Server requirements

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| OS | Ubuntu 22.04 LTS / Debian 12 | Ubuntu 24.04 LTS |
| CPU | 2 vCPU | 4 vCPU |
| RAM | 4 GB | 8 GB |
| Disk | 50 GB SSD | 100 GB SSD |
| Network | Public IPv4 + port 80/443 open | Domain name pointing to the IP |

> Each API replica loads the embedding model + reranker (~1.5–2 GB RAM). Do not run on <4 GB.

---

## 2. Prepare the server (run once)

```bash
# Update system
sudo apt-get update && sudo apt-get upgrade -y

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER
newgrp docker

# Install Docker Compose plugin (v2)
sudo apt-get install -y docker-compose-plugin

# Install Nginx + Certbot (SSL)
sudo apt-get install -y nginx certbot python3-certbot-nginx

# Clone the repo
git clone <your-repo-url> ~/fikra-ai
cd ~/fikra-ai
```

> Log out and back in after `usermod -aG docker` so you can run `docker` without `sudo`.

---

## 3. Create the production `.env`

Copy the example and fill in real values:

```bash
cp backend/.env.example backend/.env
nano backend/.env
```

**Minimum production values to change:**

```ini
# ---------- Application ----------
APP_ENV=production
DEBUG=false
SECRET_KEY=<run: openssl rand -hex 64>
JWT_SECRET_KEY=<run: openssl rand -hex 64>

# ---------- Database (this server's Postgres container) ----------
DATABASE_URL=postgresql+asyncpg://postgres:CHANGE_ME@fikra_postgres:5432/rag-prod
DATABASE_SSL=false

# ---------- Redis (this server's Redis container) ----------
REDIS_URL=redis://fikra_redis:6379/0
CELERY_BROKER_URL=redis://fikra_redis:6379/2
CELERY_RESULT_BACKEND=redis://fikra_redis:6379/3

# ---------- Qdrant (this server's Qdrant container) ----------
QDRANT_URL=http://fikra_qdrant:6333
QDRANT_API_KEY=
QDRANT_COLLECTION=fikra-ai

# ---------- LLM (Groq) ----------
GROQ_API_KEY=<your_groq_api_key>
LLM_PROVIDER=groq

# ---------- CORS (your real domain) ----------
ALLOWED_ORIGINS=["https://your-domain.com"]

# ---------- Storage (local disk on this server) ----------
STORAGE_BACKEND=local
BLOB_ACCESS=private
UPLOAD_DIR=/app/uploads

# ---------- Embeddings ----------
EMBEDDING_MODEL=BAAI/bge-small-en-v1.5
EMBEDDING_DIMENSIONS=384
RERANKER_ENABLED=true
```

Generate secrets:

```bash
openssl rand -hex 64   # SECRET_KEY
openssl rand -hex 64   # JWT_SECRET_KEY
```

Set your domain in `ALLOWED_ORIGINS` as valid JSON (quotes must survive):
`ALLOWED_ORIGINS=["https://your-domain.com"]`

---

## 4. Create the production Docker Compose override

Create `docker-compose.override.yml` so production uses local services and binds host ports:

```yaml
# docker-compose.override.yml
name: fikra

services:
  postgres:
    image: postgres:16
    container_name: fikra_postgres
    environment:
      POSTGRES_DB: ${POSTGRES_DB:-rag-prod}
      POSTGRES_USER: ${POSTGRES_USER:-postgres}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-CHANGE_ME}
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
    command: redis-server --appendonly yes
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
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
      start_period: 90s
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
```

---

## 5. Build and start the stack

```bash
cd ~/fikra-ai

# Pull base images
docker compose pull

# Build backend + frontend images
docker compose build

# Start everything
docker compose up -d

# Check status
docker compose ps
```

Expected output — all containers `Up (healthy)`:

```
NAME               IMAGE                         STATUS
fikra_postgres     postgres:16                   Up (healthy)
fikra_qdrant       qdrant/qdrant:latest          Up
fikra_redis        redis:7-alpine                Up (healthy)
fikra_backend      fikra-backend                 Up (healthy)
fikra_worker       fikra-worker                  Up
fikra_frontend     fikra-frontend                Up
```

---

## 6. Run database migrations + seed initial org

```bash
# Migrations
docker compose exec backend alembic upgrade head

# Seed Demo Organization + admin user
docker compose exec backend python scripts/create_initial_org.py
```

Output:
```
Created organization: Demo Organization  (id: 00000000-0000-0000-0000-000000000001)
Created admin user: admin@fikra.ai
  Password: Admin1234!
```

> Change the admin password after first login.

---

## 7. Verify the backend is healthy

```bash
# From the server
curl -s http://127.0.0.1:8000/api/v1/health/live
# → {"status":"ok","app":"FIKRA AI"}

curl -s http://127.0.0.1:8000/api/v1/health/ready
# → checks DB, Redis, Qdrant, embedding model
```

> `/health/ready` may take 60–90 s on first start while the ~130 MB embedding model downloads and loads. Wait until it returns 200.

---

## 8. Nginx reverse proxy + SSL (Let's Encrypt)

Replace `your-domain.com` with your real domain everywhere.

```bash
sudo nano /etc/nginx/sites-available/fikra-ai
```

```nginx
server {
    listen 80;
    server_name your-domain.com www.your-domain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com www.your-domain.com;

    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    # Security headers
    add_header X-Content-Type-Options nosniff;
    add_header X-Frame-Options DENY;
    add_header Referrer-Policy strict-origin-when-cross-origin;

    # Frontend
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
    }

    # Backend API
    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }

    # Blob upload token (Next.js route)
    location /api/blob/token {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

# Enable site
sudo ln -s /etc/nginx/sites-available/fikra-ai /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx

# Get SSL certificate
sudo certbot --nginx -d your-domain.com -d www.your-domain.com --email you@example.com --agree-tos --non-interactive

# Auto-renewal
echo "0 0,12 * * * root certbot renew --quiet --nginx" | sudo tee /etc/cron.d/certbot
```

> Make sure your domain's DNS A record points to this server's public IP, and ports 80/443 are open in your firewall/security group.

---

## 9. Auto-start on server reboot

Docker Compose containers already use `restart: unless-stopped`.  
To start the stack automatically on boot, add a systemd service:

```bash
sudo nano /etc/systemd/system/fikra-ai.service
```

```ini
[Unit]
Description=FIKRA AI production stack
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/home/your-username/fikra-ai
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose down
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable fikra-ai.service
sudo systemctl start fikra-ai.service
```

---

## 10. Daily operations

| Task | Command |
|------|---------|
| View logs | `docker compose logs -f --tail=100` |
| Backend logs only | `docker compose logs -f backend` |
| Worker logs only | `docker compose logs -f worker` |
| Restart backend | `docker compose restart backend` |
| Stop everything | `docker compose down` |
| Start everything | `docker compose up -d` |
| Update & redeploy | `git pull && docker compose build && docker compose up -d` |
| Backup Postgres | `docker exec fikra_postgres pg_dumpall -c -U postgres > backup_$(date +%F).sql` |
| Backup uploads | `tar czf uploads_backup_$(date +%F).tar.gz -C /var/lib/docker/volumes/fikra_uploads_data/_data .` |

---

## 11. Default admin login

After seeding:
- **URL:** https://your-domain.com/login
- **Email:** `admin@fikra.ai`
- **Password:** `Admin1234!` (change immediately)

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `/health/ready` 503 | Wait for embedding model download (first boot). Check `docker compose logs backend`. |
| Embedding model fails | Ensure `HF_HUB_OFFLINE` is NOT set, or pre-download model locally. |
| Login button disabled | Run `docker compose exec backend python scripts/create_initial_org.py` to seed the org. |
| 502 Bad Gateway | Backend not healthy yet. Wait 60–90 s, then `docker compose restart backend`. |
| Uploads fail | Check `STORAGE_BACKEND=local` and `uploads_data` volume permissions. |

---

## 12. What to do next

1. Pick your domain and point DNS to this server's IP.
2. Run the steps above.
3. Test: login → upload a PDF → ask a question → verify answer + citations.
4. Set up regular backups (Postgres + uploads volume).
5. (Optional) Add monitoring: Prometheus + Grafana stack (`docker-compose.monitoring.yml` is already in the repo).

---

**Do you want me to generate any of these files directly into your repo now** (e.g., the `docker-compose.override.yml`, Nginx config, or a `deploy-server.sh` script), or do you want to copy them manually from above?