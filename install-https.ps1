# ClaudeSave - HTTPS Interception Mode Installer
#
# AVISO: este modo modifica configuracoes do sistema:
#   1. Adiciona "127.0.0.1 api.anthropic.com" ao hosts file
#   2. Instala um Root CA local no trust store do Windows
#   3. Habilita https_mode no config do ClaudeSave
#
# Isso afeta TODOS os apps que falam com api.anthropic.com nesta maquina.
# Use uninstall-https.ps1 para reverter.

#Requires -RunAsAdministrator
$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "ClaudeSave - HTTPS Mode Setup" -ForegroundColor Cyan
Write-Host "=============================" -ForegroundColor Cyan
Write-Host ""

$installDir = "$env:USERPROFILE\.claudesave"
$certsDir   = "$installDir\certs"
$projectDir = Split-Path -Parent $PSCommandPath

# 1. Verifica build
if (-not (Test-Path "$projectDir\dist\index.js")) {
    Write-Host "[X] Build nao encontrado. Rode npm run build primeiro." -ForegroundColor Red
    exit 1
}
Write-Host "[OK] Build OK"

# 2. Gera certs (chama o modulo TS uma vez)
Write-Host "[..] Gerando certificados (uma vez)..."
Push-Location $projectDir
$null = node -e "require('./dist/certs').ensureCerts('api.anthropic.com'); console.log('OK')"
Pop-Location
if (-not (Test-Path "$certsDir\ca.crt")) {
    Write-Host "[X] Falha ao gerar certs" -ForegroundColor Red
    exit 1
}
Write-Host "[OK] Certs em $certsDir"

# 3. Instala Root CA no trust store do Windows
Write-Host "[..] Instalando Root CA no trust store..."
$caCert = Get-PfxCertificate -FilePath "$certsDir\ca.crt"
$store = New-Object System.Security.Cryptography.X509Certificates.X509Store(
    [System.Security.Cryptography.X509Certificates.StoreName]::Root,
    [System.Security.Cryptography.X509Certificates.StoreLocation]::LocalMachine
)
$store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
$store.Add($caCert)
$store.Close()
Write-Host "[OK] CA instalada (thumbprint: $($caCert.Thumbprint))"

# 4. Backup do hosts file
$hostsFile = "$env:SystemRoot\System32\drivers\etc\hosts"
$backupFile = "$hostsFile.claudesave-backup"
if (-not (Test-Path $backupFile)) {
    Copy-Item $hostsFile $backupFile
    Write-Host "[OK] Backup do hosts em $backupFile"
}

# 5. Adiciona entrada no hosts file
$hostsContent = Get-Content $hostsFile -Raw
$marker = "# === ClaudeSave HTTPS interception ==="
if ($hostsContent -notmatch [regex]::Escape($marker)) {
    $newEntry = "`r`n$marker`r`n127.0.0.1 api.anthropic.com`r`n# === end ClaudeSave ===`r`n"
    Add-Content -Path $hostsFile -Value $newEntry -Encoding ASCII
    Write-Host "[OK] hosts file atualizado"
} else {
    Write-Host "[OK] hosts file ja tem entrada (skip)"
}

# 6. Habilita https_mode no config.yaml
$configFile = "$projectDir\config.yaml"
if (Test-Path $configFile) {
    $cfg = Get-Content $configFile -Raw
    $cfg = $cfg -replace 'https_mode:\s*\r?\n\s*enabled:\s*false', "https_mode:`r`n  enabled: true"
    Set-Content -Path $configFile -Value $cfg -Encoding UTF8
    Write-Host "[OK] https_mode habilitado em config.yaml"
}

# 7. Mata processo node antigo (pra usar a nova config)
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

# 8. Inicia ClaudeSave com HTTPS
Write-Host "[..] Iniciando ClaudeSave em modo HTTPS..."
$vbsFile = "$projectDir\claudesave-silent.vbs"
if (Test-Path $vbsFile) {
    Start-Process wscript -ArgumentList "`"$vbsFile`"" -WindowStyle Hidden
    Start-Sleep -Seconds 3
}

# 9. Verifica
try {
    $h = Invoke-RestMethod -Uri "http://localhost:8019/health" -TimeoutSec 3
    Write-Host ""
    Write-Host "Pronto! ClaudeSave rodando em modo HTTPS." -ForegroundColor Green
    Write-Host ""
    Write-Host "Agora abra o Claude Desktop App e use normalmente." -ForegroundColor Yellow
    Write-Host "Dashboard: http://localhost:8019/dashboard"
    Write-Host ""
    Write-Host "Para reverter tudo: uninstall-https.ps1" -ForegroundColor Gray
} catch {
    Write-Host "[!] Proxy nao respondeu. Verifique o log:" -ForegroundColor Yellow
    $logPath = "$projectDir\claudesave.log"
    Write-Host "    Get-Content $logPath -Tail 20"
}
