$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$keyPath = Join-Path $repoRoot '.tauri-updater-key'
$passwordPath = Join-Path $repoRoot '.tauri-updater-password'
$bundleDir = Join-Path $repoRoot 'src-tauri\target\release\bundle\msi'

if (-not (Test-Path -LiteralPath $keyPath)) {
  throw "Missing signing key file: $keyPath"
}

if (-not (Test-Path -LiteralPath $passwordPath)) {
  throw "Missing signing password file: $passwordPath"
}

Push-Location $repoRoot
try {
  $env:TAURI_SIGNING_PRIVATE_KEY = Get-Content -LiteralPath $keyPath -Raw
  $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = (Get-Content -LiteralPath $passwordPath -Raw).Trim()

  npm run tauri build

  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }

  $artifacts = @()
  if (Test-Path -LiteralPath $bundleDir) {
    $artifacts = Get-ChildItem -LiteralPath $bundleDir -File |
      Where-Object { $_.Extension -in '.msi', '.sig' } |
      Sort-Object Name
  }

  if ($artifacts.Count -eq 0) {
    throw "Build finished but no MSI artifacts were found in $bundleDir"
  }

  Write-Host ''
  Write-Host 'Artifacts:'
  foreach ($artifact in $artifacts) {
    Write-Host " - $($artifact.FullName)"
  }
}
finally {
  Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY -ErrorAction SilentlyContinue
  Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD -ErrorAction SilentlyContinue
  Pop-Location
}
