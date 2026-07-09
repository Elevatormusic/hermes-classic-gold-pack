# Removes the Classic Gold re-apply watcher — both the Scheduled Task and the
# Startup-folder fallback, whichever register-watcher.ps1 installed.
#   powershell -ExecutionPolicy Bypass -File advanced\watcher\unregister-watcher.ps1
$taskName = 'HermesClassicGold-ReapplyWatcher'
$removed = $false

try {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction Stop
  Write-Host "Removed scheduled task '$taskName'."
  $removed = $true
} catch {
  # no task (or it needs elevation to remove) — fall through to the Startup check
}

$vbs = Join-Path ([Environment]::GetFolderPath('Startup')) 'HermesClassicGold-ReapplyWatcher.vbs'
if (Test-Path $vbs) {
  Remove-Item $vbs -Force
  Write-Host "Removed Startup logon check: $vbs"
  $removed = $true
}

if (-not $removed) { Write-Host "Nothing to remove (watcher not installed)." }
