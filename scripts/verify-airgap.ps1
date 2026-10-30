# Vedara Zero-Telemetry CI Verification Wrapper (Windows PowerShell)
$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "Running Vedara Zero-Telemetry Air-Gap Verification..." -ForegroundColor Cyan
node "$ScriptDir\verify-airgap.mjs"
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}
