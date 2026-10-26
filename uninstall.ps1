# Restore the original Orca shortcuts saved by install.ps1. Your files in ~/.orca/themer are kept.
$backup = Join-Path $PSScriptRoot 'backup'
$manifestFile = Join-Path $backup 'manifest.json'
if (-not (Test-Path $manifestFile)) { Write-Host 'nothing to restore'; return }
# A launcher still running re-points shortcuts after Orca closes; this marker tells it not to.
New-Item -ItemType File -Force (Join-Path $backup 'uninstalled') | Out-Null
(Get-Content $manifestFile -Raw | ConvertFrom-Json).PSObject.Properties | ForEach-Object {
  Copy-Item (Join-Path $backup $_.Name) $_.Value -Force
  Write-Host "restored $($_.Value)"
}
Write-Host 'Orca opens without the kit from the next start. Delete ~/.orca/themer to remove your themes too.'
