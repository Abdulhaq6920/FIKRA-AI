# =====================================================================
# FIKRA AI — Windows Setup (PowerShell)
#
# Run in PowerShell from the repository root:
#   .\setup.ps1
#
# Prerequisites (install manually first):
#   - Docker Desktop 4.x+
#   - Python 3.12 (via uv or python.org)
#   - Node.js 20 LTS
# =====================================================================

$ErrorActionPreference = "Stop"

Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  FIKRA AI — Windows Setup" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan

# ------------------------------------------------------------------
# 1. Copy .env.example to .env
# ------------------------------------------------------------------
Write-Host "`n[1/6] Copying backend/.env.example to backend/.env..." -ForegroundColor Yellow
$envExample = Join-Path $PSScriptRoot "backend/.env.example"
$envFile    = Join-Path $PSScriptRoot "backend/.env"

if (-not (Test-Path $envFile)) {
    Copy-Item $envExample $envFile
    Write-Host "    Created backend/.env — edit it and add your GROQ_API_KEY" -ForegroundColor Green
} else {
    Write-Host "    backend/.env already exists, skipping." -ForegroundColor Yellow
}

# Add DATA_ENCRYPTION_KEY if missing (Fernet key for data-at-rest encryption)
$envContent = Get-Content $envFile -Raw
if ($envContent -notmatch 'DATA_ENCRYPTION_KEY=.+') {
    $key = & $venvPython -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
    Add-Content $envFile "`n# Data-at-rest encryption (auto-generated)`nDATA_ENCRYPTION_KEY=$key"
    Write-Host "    Generated DATA_ENCRYPTION_KEY" -ForegroundColor Green
}

Write-Host "    IMPORTANT: Edit backend/.env and set:" -ForegroundColor Yellow
Write-Host "      GROQ_API_KEY=your_groq_api_key   (free at https://console.groq.com)" -ForegroundColor Yellow
Write-Host "      SECRET_KEY=<64 hex chars>" -ForegroundColor Yellow
Write-Host "      JWT_SECRET_KEY=<64 hex chars>" -ForegroundColor Yellow

# ------------------------------------------------------------------
# 2. Check Python venv
# ------------------------------------------------------------------
Write-Host "`n[2/6] Checking Python virtual environment..." -ForegroundColor Yellow
$venvPython = Join-Path $PSScriptRoot ".venv/Scripts/python.exe"

if (-not (Test-Path $venvPython)) {
    Write-Host "    Virtual environment not found at .venv/" -ForegroundColor Yellow
    Write-Host "    Creating with uv..." -ForegroundColor Yellow
    & uv venv --python 3.12 .venv
    Write-Host "    Virtual environment created." -ForegroundColor Green
} else {
    Write-Host "    Virtual environment exists." -ForegroundColor Green
}

# ------------------------------------------------------------------
# 3. Install backend dependencies
# ------------------------------------------------------------------
Write-Host "`n[3/6] Installing backend dependencies..." -ForegroundColor Yellow
& $venvPython -m pip install --upgrade pip
& $venvPython -m pip install -e "backend/.[dev]"
Write-Host "    Backend dependencies installed." -ForegroundColor Green

# ------------------------------------------------------------------
# 4. Run migrations
# ------------------------------------------------------------------
Write-Host "`n[4/6] Running database migrations..." -ForegroundColor Yellow
& $venvPython -m alembic upgrade head
Write-Host "    Migrations complete." -ForegroundColor Green

# ------------------------------------------------------------------
# 5. Seed initial organization
# ------------------------------------------------------------------
Write-Host "`n[5/6] Seeding initial organization + admin user..." -ForegroundColor Yellow
& $venvPython scripts/create_initial_org.py
Write-Host "    Seeding complete." -ForegroundColor Green

# ------------------------------------------------------------------
# 6. Start infrastructure
# ------------------------------------------------------------------
Write-Host "`n[6/6] Starting PostgreSQL + Redis..." -ForegroundColor Yellow
& docker compose up -d postgres redis
Write-Host "    Infrastructure started." -ForegroundColor Green

# ------------------------------------------------------------------
# Done
# ------------------------------------------------------------------
Write-Host "`n================================================" -ForegroundColor Cyan
Write-Host "  Setup complete!" -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "  1. Edit backend/.env and add your GROQ_API_KEY" -ForegroundColor Yellow
Write-Host "  2. Start the backend:" -ForegroundColor Yellow
Write-Host "     .\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000" -ForegroundColor Yellow
Write-Host "  3. Start the worker (new terminal):" -ForegroundColor Yellow
Write-Host "     .\.venv\Scripts\python.exe -m celery -A app.workers.celery_app worker --loglevel=info -Q default,ingestion" -ForegroundColor Yellow
Write-Host "  4. Start the frontend:" -ForegroundColor Yellow
Write-Host "     cd frontend" -ForegroundColor Yellow
Write-Host "     npm.cmd install --legacy-peer-deps" -ForegroundColor Yellow
Write-Host "     npm.cmd run dev" -ForegroundColor Yellow
Write-Host ""
Write-Host "  Open http://localhost:3000" -ForegroundColor Yellow
Write-Host "  Login: admin@fikra.ai / Admin1234! (change immediately)" -ForegroundColor Yellow
Write-Host ""
