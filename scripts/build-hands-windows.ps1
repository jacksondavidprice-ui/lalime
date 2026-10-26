# Build Hands.exe on a Windows machine with .NET 8 SDK.
# Usage (PowerShell):
#   pwsh scripts/build-hands-windows.ps1

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$proj = Join-Path $root "hands/windows/Hands/Hands.csproj"
$out = Join-Path $root "hands/windows/Hands/bin/Release/net8.0-windows"

Write-Host "Building Hands.exe..."
dotnet restore $proj
if ($LASTEXITCODE -ne 0) { throw "Hands dependency restore failed (exit $LASTEXITCODE)." }
dotnet build $proj "-t:Rebuild" -c Release -r win-x64 --self-contained true
if ($LASTEXITCODE -ne 0) { throw "Hands rebuild failed (exit $LASTEXITCODE)." }
dotnet publish $proj -c Release -r win-x64 --self-contained true --no-build -o $out
if ($LASTEXITCODE -ne 0) { throw "Hands publish failed (exit $LASTEXITCODE)." }

$exe = Join-Path $out "Hands.exe"
if (-not (Test-Path $exe)) { throw "Hands.exe was not produced at $exe" }
Write-Host "OK: $exe"
Write-Host "Lalime uses Hands.exe by default on Windows (no LALIME_HANDS env var needed)."
Write-Host "Packaged builds load it from resources/hands via electron-builder extraResources."
