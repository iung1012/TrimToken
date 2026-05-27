# ClaudeSave - Desinstala HTTPS Interception Mode
# Reverte tudo o que install-https.ps1 fez.

#Requires -RunAsAdministrator
$ErrorActionPreference = "Continue"

Write-Host ""
Write-Host "ClaudeSave - HTTPS Mode Uninstall" -ForegroundColor Cyan
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
    $content = Get-Content $hostsFile
    $newContent = $content | Where-Object { $_ -notmatch "anthropic" -and $_ -notmatch "ClaudeSave" }
    Set-Content -Path $hostsFile -Value $newContent -Encoding ASCII -Force
    Write-Host "[OK] hosts file limpo"
}

# 3. Remove Root CA do trust store (por thumbprint ou subject)
try {
    $store = New-Object System.Security.Cryptography.X509Certificates.X509Store(
        [System.Security.Cryptography.X509Certificates.StoreName]::Root,
        [System.Security.Cryptography.X509Certificates.StoreLocation]::LocalMachine
    )
    $store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)

    # Tenta remover pelo arquivo de cert
    if (Test-Path "$certsDir\ca.crt") {
        $caCert = Get-PfxCertificate -FilePath "$certsDir\ca.crt"
        $found = $store.Certificates | Where-Object { $_.Thumbprint -eq $caCert.Thumbprint }
        if ($found) { $store.Remove($found); Write-Host "[OK] Root CA removida (por thumbprint)" }
    }

    # Fallback: remove por subject
    $bySubject = $store.Certificates | Where-Object { $_.Subject -match "ClaudeSave|TrimToken" }
    foreach ($c in $bySubject) {
        $store.Remove($c)
        Write-Host "[OK] Root CA removida (por subject: $($c.Subject))"
    }

    $store.Close()
} catch {
    Write-Host "[!] Erro ao remover CA: $($_.Exception.Message)" -ForegroundColor Yellow
}

# 4. Desabilita https_mode no config
$configFile = "$projectDir\config.yaml"
if (Test-Path $configFile) {
    $cfg = Get-Content $configFile -Raw
    $cfg = $cfg -replace 'https_mode:\s*\r?\n\s*enabled:\s*true', "https_mode:`r`n  enabled: false"
    Set-Content -Path $configFile -Value $cfg -Encoding UTF8
    Write-Host "[OK] https_mode desabilitado em config.yaml"
}

# 5. Limpa DNS
ipconfig /flushdns | Out-Null
Write-Host "[OK] Cache DNS limpo"

# 6. Remove certs gerados
if (Test-Path $certsDir) {
    Remove-Item -Recurse -Force $certsDir -ErrorAction SilentlyContinue
    Write-Host "[OK] Certificados removidos de $certsDir"
}

Write-Host ""
Write-Host "Desinstalacao completa. Claude Desktop App voltou ao normal." -ForegroundColor Green
Write-Host ""
