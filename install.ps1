# TrimToken installer (Windows)
$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "TrimToken Installer" -ForegroundColor Cyan
Write-Host "===================" -ForegroundColor Cyan
Write-Host ""

# 1. Node
try {
    $nodeVersion = node --version
    Write-Host "[OK] Node detectado: $nodeVersion"
} catch {
    Write-Host "[X] Node.js nao encontrado. Instale em https://nodejs.org" -ForegroundColor Red
    exit 1
}

$here = $PSScriptRoot
$installDir = "$env:USERPROFILE\.trimtoken"

# 2. Build no diretorio do projeto
if ($here -and (Test-Path "$here\package.json")) {
    Write-Host "[..] Instalando dependencias e compilando..."
    Push-Location $here
    npm install --silent
    npm run build --silent
    Pop-Location
    if (-not (Test-Path "$here\dist\index.js")) {
        Write-Host "[X] Build falhou (dist\index.js nao gerado)." -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "[X] Rode este script de dentro da pasta do projeto." -ForegroundColor Red
    exit 1
}

# 3. Copia para o diretorio de instalacao
New-Item -ItemType Directory -Force -Path $installDir | Out-Null
Copy-Item -Recurse -Force "$here\dist" "$installDir\dist"
Copy-Item -Force "$here\package.json" "$installDir\package.json"
if (-not (Test-Path "$installDir\config.yaml")) {
    Copy-Item -Force "$here\config.yaml" "$installDir\config.yaml"
}
Write-Host "[OK] Instalado em: $installDir"

# 4. Dependencias de producao no diretorio de instalacao
Push-Location $installDir
npm install --omit=dev --silent
Pop-Location

# 5. Comando trimtoken
$startScript = "@echo off`r`nnode `"$installDir\dist\index.js`" %*"
Set-Content -Path "$installDir\trimtoken.cmd" -Value $startScript -Encoding ASCII

# 6. PATH (usuario)
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -notlike "*$installDir*") {
    [Environment]::SetEnvironmentVariable("Path", "$userPath;$installDir", "User")
    Write-Host "[OK] Adicionado ao PATH (reabra o terminal)"
}

Write-Host ""
Write-Host "Pronto! Proximos passos:" -ForegroundColor Green
Write-Host ""
Write-Host "  1. Inicie o proxy:" -ForegroundColor Yellow
Write-Host "       trimtoken"
Write-Host ""
Write-Host "  2. Em outro terminal, aponte o Claude Code:" -ForegroundColor Yellow
Write-Host "       `$env:ANTHROPIC_BASE_URL='http://localhost:8019'"
Write-Host ""
Write-Host "  3. Use o Claude Code normalmente. Economia em:" -ForegroundColor Yellow
Write-Host "       http://localhost:8019/dashboard"
Write-Host ""
