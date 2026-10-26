# Build Lalime Windows NSIS installer on a Windows machine.
# Prerequisites: Node 22+, npm, .NET 8 SDK (for Hands), and a display-less CI is fine.
#
#   pwsh scripts/build-hands-windows.ps1
#   pwsh scripts/build-windows-installer.ps1
#
# Output: release/Lalime-Setup-*.exe

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host "npm ci..."
npm ci
if ($LASTEXITCODE -ne 0) { throw "Dependency installation failed (exit $LASTEXITCODE)." }

Write-Host "Building app + Hands (npm run build builds Hands.exe on Windows)..."
npm run build
if ($LASTEXITCODE -ne 0) { throw "Application build failed (exit $LASTEXITCODE)." }

if (-not (Test-Path "hands/windows/Hands/bin/Release/net8.0-windows/Hands.exe")) {
  Write-Host "Hands.exe missing after build; running dedicated Hands script..."
  & "$PSScriptRoot/build-hands-windows.ps1"
}

Write-Host "Packaging NSIS installer (extraResources includes Hands.exe)..."
npx electron-builder --win nsis --x64 --publish never
if ($LASTEXITCODE -ne 0) { throw "Installer packaging failed (exit $LASTEXITCODE)." }

Write-Host "Done. Check the release/ folder for Lalime-Setup-*.exe"
Get-ChildItem release -Filter "*.exe" | Format-Table Name, Length
