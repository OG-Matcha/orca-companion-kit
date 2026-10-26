# Point Orca's shortcuts (desktop, Start menu, taskbar) at the Orca Companion Kit launcher.
# Orca's updater rewrites them to Orca.exe, so install.ps1 runs this once and the launcher runs it on every
# start and after Orca exits. Originals are backed up once, for uninstall.ps1.
param([string]$Repo = (Split-Path $PSScriptRoot -Parent))
$ErrorActionPreference = 'Stop'
$vbs = Join-Path $Repo 'Orca Companion.vbs'
$backup = Join-Path $Repo 'backup'
$orcaExe = Join-Path $env:LOCALAPPDATA 'Programs\orca\Orca.exe'
if (Test-Path (Join-Path $backup 'uninstalled')) { return } # uninstall.ps1 asked us to stop
New-Item -ItemType Directory -Force $backup | Out-Null

$manifestFile = Join-Path $backup 'manifest.json'
$manifest = @{}
if (Test-Path $manifestFile) { (Get-Content $manifestFile -Raw | ConvertFrom-Json).PSObject.Properties | ForEach-Object { $manifest[$_.Name] = $_.Value } }
$shell = New-Object -ComObject WScript.Shell
$places = @(
  [Environment]::GetFolderPath('Desktop'),
  "$env:APPDATA\Microsoft\Windows\Start Menu\Programs",
  "$env:APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar"
)
foreach ($place in $places) {
  Get-ChildItem $place -Filter 'Orca.lnk' -ErrorAction SilentlyContinue | ForEach-Object {
    $link = $shell.CreateShortcut($_.FullName)
    if ($link.TargetPath -notmatch 'orca\\Orca\.exe$') { return }
    $safeName = ([BitConverter]::ToString([Security.Cryptography.SHA1]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($_.FullName))) -replace '-', '').Substring(0, 12) + '.lnk'
    if (-not $manifest.ContainsKey($safeName)) {
      Copy-Item $_.FullName (Join-Path $backup $safeName) -Force
      $manifest[$safeName] = $_.FullName
    }
    $link.TargetPath = "$env:WINDIR\System32\wscript.exe"
    $link.Arguments = "`"$vbs`""
    $link.WorkingDirectory = $Repo
    $link.IconLocation = "$orcaExe,0"
    $link.Description = 'Orca (with Orca Companion Kit)'
    $link.Save()
    Write-Output "retargeted $($_.FullName)"
  }
}
# Written only when a new original was backed up, so a routine check never touches the file
# (two launchers writing it at once failed with "file in use").
$json = $manifest | ConvertTo-Json
if (-not (Test-Path $manifestFile) -or (Get-Content $manifestFile -Raw).Trim() -ne $json.Trim()) { $json | Set-Content $manifestFile -Encoding utf8 }
