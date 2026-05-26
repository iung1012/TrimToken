# ClaudeSave — Desinstala HTTPS Interception Mode
# Reverte tudo o que install-https.ps1 fez.

#Requires -RunAsAdministrator
$ErrorActionPreference = "Continue"

Write-Host ""
Write-Host "ClaudeSave — HTTPS Mode Uninstall" -ForegroundColor Cyan
Write-Host "==================================" -ForegroundColor Cyan
Write-Host ""

$projectDir = Split-Path -Parent $PSCommandPath
$certsDir   = "$env:USERPROFILE\.claudesave\certs"

# 1. Para processo node
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Write-Host "[OK] Processo node parado"

# 2. Remove entrada do hosts file
$hostsFile = "$env:SystemRoot\System32\drivers\etc\hosts"
if (Test-Path $hostsFile) {
    $content = Get-Content $hostsFile -Raw
    $cleaned = $content -replace "(?ms)\s*# === ClaudeSave HTTPS interception ===.*?# === end ClaudeSave ===\s*", "`r`n"
    Set-Content -Path $hostsFile -Value $cleaned -Encoding ASCII -NoNewline
    Write-Host "[OK] hosts file limpo"
}

# 3. Remove Root CA do trust store
if (Test-Path "$certsDir\ca.crt") {
    try {
        $caCert = Get-PfxCertificate -FilePath "$certsDir\ca.crt"
        $store = New-Object System.Security.Cryptography.X509Certificates.X509Store(
            [System.Security.Cryptography.X509Certificates.StoreName]::Root,
            [System.Security.Cryptography.X509Certificates.StoreLocation]::LocalMachine
        )
        $store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
        $found = $store.Certificates | Where-Object { $_.Thumbprint -eq $caCert.Thumbprint }
        if ($found) {
            $store.Remove($found)
            Write-Host "[OK] Root CA removida do trust store"
        }
        $store.Close()
    } catch {
        Write-Host "[!] Erro ao remover CA: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

# 4. Desabilita https_mode no config
$configFile = "$projectDir\config.yaml"
if (Test-Path $configFile) {
    $cfg = Get-Content $configFile -Raw
    $cfg = $cfg -replace 'https_mode:\s*\r?\n\s*enabled:\s*true', "https_mode:`r`n  enabled: false"
    Set-Content -Path $configFile -Value $cfg -Encoding UTF8
    Write-Host "[OK] https_mode desabilitado em config.yaml"
}

# 5. (Opcional) remover certs gerados
Write-Host ""
$resp = Read-Host "Remover certificados gerados em $certsDir? (s/N)"
if ($resp -eq "s" -or $resp -eq "S") {
    Remove-Item -Recurse -Force $certsDir -ErrorAction SilentlyContinue
    Write-Host "[OK] Certs removidos"
}

Write-Host ""
Write-Host "Desinstalacao completa. Claude Desktop App voltou ao normal." -ForegroundColor Green
Write-Host ""
