# =====================================================================
# FIKRA AI — Makefile (Linux / macOS)
#
# Common development & production commands.
# =====================================================================

.PHONY: help setup dev prod up down logs clean test lint format migrate seed

# Default target
help: ## Show this help message
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

# ---------------------------------------------------------------------
# Setup (first time)
# ---------------------------------------------------------------------

setup: ## First-time setup: copy env, install deps, run migrations
	@echo "==> Copying backend/.env.example to backend/.env"
	cp -n backend/.env.example backend/.env
	@echo "==> Please edit backend/.env and add your GROQ_API_KEY"
	@echo "==> Setup complete. Run 'make dev' to start."

# ---------------------------------------------------------------------
# Development
# ---------------------------------------------------------------------

dev: ## Start dev stack (postgres + redis + backend + frontend)
	docker compose up -d postgres redis
	@echo "==> Backend:  cd backend && uv run uvicorn app.main:app --reload --port 8000"
	@echo "==> Worker:   cd backend && uv run celery -A app.workers.celery_app worker --loglevel=info -Q default,ingestion"
	@echo "==> Frontend: cd frontend && npm.cmd install --legacy-peer-deps && npm.cmd run dev"

up: ## Start all services (Docker Compose)
	docker compose up -d

down: ## Stop all services
	docker compose down

logs: ## Follow backend logs
	docker compose logs -f backend

logs-worker: ## Follow worker logs
	docker compose logs -f worker

# ---------------------------------------------------------------------
# Production (local server)
# ---------------------------------------------------------------------

prod-build: ## Build production images
	docker compose -f docker-compose.prod.yml build

prod-up: ## Start production stack
	docker compose -f docker-compose.prod.yml up -d

prod-down: ## Stop production stack
	docker compose -f docker-compose.prod.yml down

# ---------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------

migrate: ## Run database migrations
	cd backend && uv run alembic upgrade head

seed: ## Seed initial organization + admin user
	cd backend && uv run python scripts/create_initial_org.py

# ---------------------------------------------------------------------
# Quality
# ---------------------------------------------------------------------

test: ## Run backend unit tests
	cd backend && uv run pytest tests/unit tests/tenant_isolation -q

lint: ## Lint backend
	cd backend && uv run ruff check app/

format: ## Format backend code
	cd backend && uv run ruff format app/

type-check: ## Type-check backend
	cd backend && uv run mypy app/

frontend-type-check: ## Type-check frontend
	cd frontend && npx tsc --noEmit

clean: ## Remove containers and volumes (DESTRUCTIVE)
	docker compose down -v

# =====================================================================
