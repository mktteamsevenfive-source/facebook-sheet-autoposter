$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot

function Test-CommandExists($name) {
    return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

Write-Host "== Facebook Sheet Autoposter setup ==" -ForegroundColor Cyan

if (-not (Test-CommandExists 'node')) {
    throw "Node.js not found. Install Node.js 20+ from https://nodejs.org/ first."
}
$nodeVersion = (node --version) -replace '^v', ''
$majorVersion = [int]($nodeVersion.Split('.')[0])
if ($majorVersion -lt 20) {
    throw "Node.js $nodeVersion found, but 20+ is required."
}
Write-Host "Node.js $nodeVersion OK"

Set-Location -LiteralPath $projectRoot

Write-Host "`nInstalling npm dependencies..."
npm install
if ($LASTEXITCODE -ne 0) { throw "npm install failed." }

foreach ($dir in @('secrets', 'data', 'logs')) {
    $path = Join-Path $projectRoot $dir
    if (-not (Test-Path -LiteralPath $path)) {
        New-Item -ItemType Directory -Path $path -Force | Out-Null
        Write-Host "Created $dir\"
    }
}

$envPath = Join-Path $projectRoot '.env'
$envExamplePath = Join-Path $projectRoot '.env.example'
if (-not (Test-Path -LiteralPath $envPath)) {
    Copy-Item -LiteralPath $envExamplePath -Destination $envPath
    Write-Host "Created .env from .env.example (PUBLISH_ENABLED=false by default)"
} else {
    Write-Host ".env already exists, left untouched"
}

$accountsPath = Join-Path $projectRoot 'accounts.json'
$accountsExamplePath = Join-Path $projectRoot 'accounts.example.json'
if (-not (Test-Path -LiteralPath $accountsPath)) {
    Copy-Item -LiteralPath $accountsExamplePath -Destination $accountsPath
    Write-Host "Created accounts.json from accounts.example.json - edit it for this machine's Facebook accounts"
} else {
    Write-Host "accounts.json already exists, left untouched"
}

Write-Host "`n== Setup finished. Remaining steps (must be done by hand on this machine): ==" -ForegroundColor Cyan
Write-Host "1. Put your Google OAuth client file at secrets\google-oauth-client.json"
Write-Host "2. Run: npm run login:google"
Write-Host "3. Edit accounts.json to match this machine's Facebook accounts"
Write-Host '4. Run: npm run login:facebook -- "<Facebook display name>" for each account'
Write-Host "5. Run: npm test"
Write-Host "6. Run: npm run dry-run"
Write-Host "7. Only after reviewing dry-run output, set PUBLISH_ENABLED=true in .env"
Write-Host "8. Run: powershell -ExecutionPolicy Bypass -File .\scripts\install-task.ps1"
