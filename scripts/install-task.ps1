param(
    [string]$TaskName = 'FacebookGoogleSheetAutoposter',
    [int]$IntervalMinutes = 20
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$dataDirectory = Join-Path $projectRoot 'data'
$runnerPath = Join-Path $PSScriptRoot 'run-task.ps1'
$nodePath = (Get-Command node -ErrorAction Stop).Source

New-Item -ItemType Directory -Path $dataDirectory -Force | Out-Null
@{ nodePath = $nodePath } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $dataDirectory 'task-config.json') -Encoding UTF8

$action = New-ScheduledTaskAction `
    -Execute 'powershell.exe' `
    -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$runnerPath`"" `
    -WorkingDirectory $projectRoot
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
    -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes) `
    -RepetitionDuration (New-TimeSpan -Days 3650)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
    -Description "Checks Google Sheet every $IntervalMinutes minutes and publishes at most one approved Facebook Group post." -Force | Out-Null

Write-Host "Scheduled task installed: $TaskName (every $IntervalMinutes minutes)"
Write-Host 'It runs only in the signed-in Windows user session because Facebook uses a visible Chrome profile.'

