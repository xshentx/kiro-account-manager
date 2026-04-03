$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$keyPath = Join-Path $repoRoot '.tauri-updater-key'
$passwordPath = Join-Path $repoRoot '.tauri-updater-password'
$bundleDir = Join-Path $repoRoot 'src-tauri\target\release\bundle\msi'
$packageJsonPath = Join-Path $repoRoot 'package.json'

function Get-MsiRows {
  param(
    [Parameter(Mandatory = $true)]
    [string]$MsiPath,
    [Parameter(Mandatory = $true)]
    [string]$Sql
  )

  $installer = New-Object -ComObject WindowsInstaller.Installer
  $database = $installer.OpenDatabase($MsiPath, 0)
  $view = $database.OpenView($Sql)
  $view.Execute()

  $rows = @()
  while ($record = $view.Fetch()) {
    $values = @()
    for ($i = 1; $i -le $record.FieldCount(); $i++) {
      $values += $record.StringData($i)
    }
    $rows += [pscustomobject]@{
      Fields = [string[]]$values
    }
  }

  return @($rows)
}

function Test-Flag {
  param(
    [Parameter(Mandatory = $true)]
    [int]$Value,
    [Parameter(Mandatory = $true)]
    [int]$Flag
  )

  return (($Value -band $Flag) -eq $Flag)
}

function Assert-MsiUpgradeMetadata {
  param(
    [Parameter(Mandatory = $true)]
    [string]$MsiPath,
    [Parameter(Mandatory = $true)]
    [string]$ExpectedVersion
  )

  $propertySql = "SELECT ``Property``, ``Value`` FROM ``Property`` WHERE ``Property``='ProductVersion' OR ``Property``='UpgradeCode'"
  $propertyRows = Get-MsiRows -MsiPath $MsiPath -Sql $propertySql

  $properties = @{}
  foreach ($row in $propertyRows) {
    if (-not $row -or -not $row.Fields) {
      continue
    }
    $fields = $row.Fields
    $properties[$fields[0]] = $fields[1]
  }

  if (-not $properties.ProductVersion) {
    throw "MSI missing ProductVersion property: $MsiPath"
  }

  if ($properties.ProductVersion -ne $ExpectedVersion) {
    throw "MSI ProductVersion $($properties.ProductVersion) does not match package.json version $ExpectedVersion"
  }

  if (-not $properties.UpgradeCode) {
    throw "MSI missing UpgradeCode property: $MsiPath"
  }

  $upgradeSql = 'SELECT `UpgradeCode`, `VersionMin`, `VersionMax`, `Attributes`, `ActionProperty` FROM `Upgrade`'
  $upgradeRows = Get-MsiRows -MsiPath $MsiPath -Sql $upgradeSql

  $sameVersionRow = $null
  foreach ($row in $upgradeRows) {
    if (-not $row -or -not $row.Fields) {
      continue
    }
    $fields = $row.Fields
    $attributes = 0
    [void][int]::TryParse($fields[3], [ref]$attributes)
    if (
      $fields[0] -eq $properties.UpgradeCode -and
      $fields[2] -eq $ExpectedVersion -and
      $fields[4] -eq 'WIX_UPGRADE_DETECTED' -and
      (Test-Flag -Value $attributes -Flag 512)
    ) {
      $sameVersionRow = [pscustomobject]@{
        UpgradeCode    = $fields[0]
        VersionMin     = $fields[1]
        VersionMax     = $fields[2]
        Attributes     = $attributes
        ActionProperty = $fields[4]
      }
      break
    }
  }

  if (-not $sameVersionRow) {
    throw "MSI missing same-version upgrade detection row (expected VersionMax=$ExpectedVersion with inclusive max flag)."
  }

  Write-Host ''
  Write-Host 'Validated MSI upgrade metadata:'
  Write-Host " - ProductVersion: $($properties.ProductVersion)"
  Write-Host " - UpgradeCode: $($properties.UpgradeCode)"
  Write-Host " - Same-version upgrade row: VersionMax=$($sameVersionRow.VersionMax), Attributes=$($sameVersionRow.Attributes), ActionProperty=$($sameVersionRow.ActionProperty)"
}

if (-not (Test-Path -LiteralPath $keyPath)) {
  throw "Missing signing key file: $keyPath"
}

if (-not (Test-Path -LiteralPath $passwordPath)) {
  throw "Missing signing password file: $passwordPath"
}

Push-Location $repoRoot
try {
  $package = Get-Content -LiteralPath $packageJsonPath -Raw | ConvertFrom-Json
  $expectedVersion = [string]$package.version

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

  $msiArtifact = $artifacts | Where-Object Extension -eq '.msi' | Select-Object -First 1
  if (-not $msiArtifact) {
    throw "Build finished but no MSI package was found in $bundleDir"
  }

  Assert-MsiUpgradeMetadata -MsiPath $msiArtifact.FullName -ExpectedVersion $expectedVersion

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
