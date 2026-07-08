# Registers a Scheduled Task that checks — at logon and hourly — whether a Hermes
# update reverted the Classic Gold pack, and pops a notification if so. Read-only;
# it never rebuilds or kills Hermes. Run from an ordinary (non-admin) PowerShell:
#
#   powershell -ExecutionPolicy Bypass -File advanced\watcher\register-watcher.ps1
#
# Remove it later with unregister-watcher.ps1.

$ErrorActionPreference = 'Stop'
$taskName = 'HermesClassicGold-ReapplyWatcher'
$script = Join-Path $PSScriptRoot 'watch-reapply.mjs'

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { Write-Error 'node not found on PATH. Install Node.js first.'; exit 1 }
if (-not (Test-Path $script)) { Write-Error "watch-reapply.mjs not found at $script"; exit 1 }

$action = New-ScheduledTaskAction -Execute $node -Argument "`"$script`""
$triggers = @(
  (New-ScheduledTaskTrigger -AtLogOn),
  (New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Hours 1))
)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $triggers -Settings $settings -Principal $principal -Force | Out-Null
Write-Host "Registered scheduled task '$taskName' (logon + hourly). Remove with unregister-watcher.ps1."
