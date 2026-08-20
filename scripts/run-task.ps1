$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$taskConfigPath = Join-Path $projectRoot 'data\task-config.json'
$logDirectory = Join-Path $projectRoot 'logs'
$logPath = Join-Path $logDirectory 'scheduled-task.log'

if (-not (Test-Path -LiteralPath $taskConfigPath)) {
    throw "Task configuration not found: $taskConfigPath. Run scripts\install-task.ps1 first."
}

$taskConfig = Get-Content -LiteralPath $taskConfigPath -Raw | ConvertFrom-Json
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
Set-Location -LiteralPath $projectRoot
& $taskConfig.nodePath (Join-Path $projectRoot 'src\run.js') *>> $logPath
exit $LASTEXITCODE

