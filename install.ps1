# ClaudeSave installer for Windows
# Usage: irm claudesave.io/install.ps1 | iex

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "ClaudeSave Installer" -ForegroundColor Cyan
Write-Host "====================" -ForegroundColor Cyan
Write-Host ""

# 1. Check Node
try {
    $nodeVersion = node --version 2>$null
    Write-Host "[OK] Node detected: $nodeVersion"
} catch {
    Write-Host "[X] Node.js not found. Install from https://nodejs.org" -ForegroundColor Red
    exit 1
}

# 2. Create install directory
$installDir = "$env:USERPROFILE\.claudesave"
New-Item -ItemType Directory -Force -Path $installDir | Out-Null
Write-Host "[OK] Install dir: $installDir"

# 3. Install via npm (or copy local build)
$here = $PSScriptRoot
if ($here -and (Test-Path "$here\package.json")) {
    Write-Host "[..] Installing from local build..."
    Copy-Item -Recurse -Force "$here\dist" "$installDir\dist"
    Copy-Item -Force "$here\package.json" "$installDir\package.json"
    Copy-Item -Force "$here\config.yaml" "$installDir\config.yaml" -ErrorAction SilentlyContinue
    Push-Location $installDir
    npm install --omit=dev --silent
    Pop-Location
} else {
    Write-Host "[..] Installing from npm registry..."
    npm install -g claudesave --silent
}

# 4. Create startup script
$startScript = @"
@echo off
node "$installDir\dist\index.js" %*
"@
Set-Content -Path "$installDir\claudesave.cmd" -Value $startScript

# 5. Add to PATH (current user)
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -notlike "*$installDir*") {
    [Environment]::SetEnvironmentVariable("Path", "$userPath;$installDir", "User")
    Write-Host "[OK] Added to PATH (restart terminal to take effect)"
}

Write-Host ""
Write-Host "Done! Next steps:" -ForegroundColor Green
Write-Host ""
Write-Host "  1. Start the proxy:" -ForegroundColor Yellow
Write-Host "       claudesave"
Write-Host ""
Write-Host "  2. Set the env var (in new terminal):" -ForegroundColor Yellow
Write-Host "       `$env:ANTHROPIC_BASE_URL='http://localhost:8019'"
Write-Host ""
Write-Host "  3. Use Claude Code normally. See savings at:" -ForegroundColor Yellow
Write-Host "       http://localhost:8019/dashboard"
Write-Host ""
