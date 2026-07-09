# Installs a background check that, at logon (and hourly if possible), notifies
# you when a Hermes update reverted the Classic Gold pack. Read-only - it never
# rebuilds or kills Hermes. Run from a NORMAL (non-admin) PowerShell:
#
#   powershell -ExecutionPolicy Bypass -File advanced\watcher\register-watcher.ps1
#
# It prefers a Scheduled Task (logon + hourly). If Windows requires elevation for
# that on your machine (Register-ScheduledTask -> 0x80070005 Access denied), it
# falls back to an admin-free Startup-folder logon check automatically - so this
# never needs an admin prompt. For the hourly check too, re-run from an elevated
# PowerShell. Remove either with unregister-watcher.ps1.

$ErrorActionPreference = 'Stop'
$taskName = 'HermesClassicGold-ReapplyWatcher'
$script = Join-Path $PSScriptRoot 'watch-reapply.mjs'

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { Write-Error 'node not found on PATH. Install Node.js first.'; exit 1 }
if (-not (Test-Path $script)) { Write-Error "watch-reapply.mjs not found at $script"; exit 1 }

# 1) Preferred: a Scheduled Task (logon + hourly). No admin on many machines, but
#    some Windows configs reject a root-path task write unless elevated.
$scheduled = $false
try {
  $action = New-ScheduledTaskAction -Execute $node -Argument "`"$script`""
  $triggers = @(
    (New-ScheduledTaskTrigger -AtLogOn),
    (New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Hours 1))
  )
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
  $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $triggers -Settings $settings -Principal $principal -Force -ErrorAction Stop | Out-Null
  $scheduled = $true
  Write-Host "Registered scheduled task '$taskName' (logon + hourly)."
} catch {
  Write-Warning "Scheduled Task needs elevation on this machine ($($_.Exception.Message.Trim()))."
  Write-Host 'Falling back to an admin-free logon check via the Startup folder...'
}

# 2) Fallback (never needs admin): a hidden launcher in the Startup folder, which
#    runs the check at each sign-in. VBS with windowStyle 0 = no console flash.
if (-not $scheduled) {
  $startup = [Environment]::GetFolderPath('Startup')
  $vbs = Join-Path $startup 'HermesClassicGold-ReapplyWatcher.vbs'
  $body = @"
Dim q : q = Chr(34)
CreateObject("WScript.Shell").Run q & "$node" & q & " " & q & "$script" & q, 0, False
"@
  Set-Content -Path $vbs -Value $body -Encoding ASCII
  Write-Host "Installed logon check: $vbs"
  Write-Host '  (runs at each sign-in; no admin, no Task Scheduler. For an hourly check too,'
  Write-Host '   re-run this script from an elevated PowerShell.)'
}
