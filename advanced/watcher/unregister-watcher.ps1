# Removes the Classic Gold re-apply watcher scheduled task.
#   powershell -ExecutionPolicy Bypass -File advanced\watcher\unregister-watcher.ps1
$taskName = 'HermesClassicGold-ReapplyWatcher'
try {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction Stop
  Write-Host "Removed scheduled task '$taskName'."
} catch {
  Write-Host "No task named '$taskName' found (nothing to remove)."
}
