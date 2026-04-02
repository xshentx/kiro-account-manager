$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path '.').Path
$workflow = Join-Path $repoRoot '.github/workflows/release.yml'
$packageJson = Join-Path $repoRoot 'package.json'
$errors = @()

$workflowText = Get-Content -LiteralPath $workflow -Raw -Encoding UTF8
$packageText = Get-Content -LiteralPath $packageJson -Raw -Encoding UTF8
$package = $packageText | ConvertFrom-Json

if ($workflowText -match 'rm -rf node_modules package-lock.json') {
  $errors += 'release workflow deletes package-lock.json before install'
}

if ($workflowText -notmatch '\bnpm ci\b') {
  $errors += 'release workflow does not use npm ci'
}

if ($workflowText -match 'uses:\s*dtolnay/rust-toolchain@stable') {
  $errors += 'release workflow uses floating rust-toolchain@stable'
}

$usesLines = [regex]::Matches($workflowText, 'uses:\s*([^\r\n]+)') | ForEach-Object { $_.Groups[1].Value.Trim() }
$unpinned = $usesLines | Where-Object { $_ -notmatch '@[0-9a-fA-F]{40}$' }
if ($unpinned) {
  $errors += ('release workflow has unpinned actions: ' + ($unpinned -join ', '))
}

if (-not $package.scripts.'build:release') {
  $errors += 'package.json missing build:release script'
} else {
  $buildReleaseScript = $package.scripts.'build:release'
  if ($buildReleaseScript -match 'scripts/build-release\.ps1') {
    $localBuildScript = Join-Path $repoRoot 'scripts/build-release.ps1'
    if (-not (Test-Path -LiteralPath $localBuildScript)) {
      $errors += 'package.json build:release script points to missing scripts/build-release.ps1'
    }
  }
}

if ($errors.Count -gt 0) {
  $errors | ForEach-Object { Write-Host "FAIL: $_" }
  exit 1
}

Write-Host 'release pipeline checks passed'
