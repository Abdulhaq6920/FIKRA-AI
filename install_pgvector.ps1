# Run as Administrator to install pgvector into PostgreSQL 18
$src = "c:\Users\Lenovo\Desktop\RAG\pgvector-pg18"
$pgLib = "C:\Program Files\PostgreSQL\18\lib"
$pgShare = "C:\Program Files\PostgreSQL\18\share\extension"
$pgInclude = "C:\Program Files\PostgreSQL\18\include\server\extension"

# Copy vector.dll
Copy-Item "$src\lib\vector.dll" "$pgLib\vector.dll" -Force
Write-Host "Copied vector.dll"

# Copy extension SQL and control files
Copy-Item "$src\share\extension\*" "$pgShare\" -Force
Write-Host "Copied extension files"

# Copy header files
if (!(Test-Path "$pgInclude\vector")) { New-Item -ItemType Directory -Path "$pgInclude\vector" -Force | Out-Null }
Copy-Item "$src\include\server\extension\vector\*" "$pgInclude\vector\" -Force
Write-Host "Copied header files"

# Verify
$ok = $true
if (Test-Path "$pgLib\vector.dll") { Write-Host "vector.dll: OK" } else { Write-Host "vector.dll: MISSING"; $ok = $false }
if (Test-Path "$pgShare\vector.control") { Write-Host "vector.control: OK" } else { Write-Host "vector.control: MISSING"; $ok = $false }
if (Test-Path "$pgShare\vector--0.8.7.sql") { Write-Host "vector--0.8.7.sql: OK" } else { Write-Host "vector--0.8.7.sql: MISSING"; $ok = $false }

# Restart PostgreSQL
Restart-Service -Name "postgresql-x64-18" -Force
Start-Sleep -Seconds 3
$svc = Get-Service -Name "postgresql-x64-18"
Write-Host "PostgreSQL status: $($svc.Status)"

if ($ok -and $svc.Status -eq "Running") {
    Write-Host "`n*** pgvector installed successfully ***"
} else {
    Write-Host "`n*** Installation may have issues - check messages above ***"
}
Start-Sleep -Seconds 3
