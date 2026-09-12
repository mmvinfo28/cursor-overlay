$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path $PSScriptRoot -Parent
$logRoot = Join-Path $PSScriptRoot 'runtime'
New-Item -ItemType Directory -Force -Path $logRoot | Out-Null
$pidFile = Join-Path $logRoot 'worker.pid'
if (Test-Path -LiteralPath $pidFile) {
    $existingPid = [int](Get-Content -LiteralPath $pidFile)
    $existing = Get-CimInstance Win32_Process -Filter "ProcessId = $existingPid"
    if ($existing -and $existing.CommandLine -like '*backend/workers/qwen.mjs*') {
        Write-Output "Qwen worker is already running (PID $existingPid)."
        exit 0
    }
}
$nodePath = (Get-Command node).Source
$workerProcess = Start-Process -FilePath $nodePath -ArgumentList '--env-file=backend/.env.worker.local', 'backend/workers/qwen.mjs' -WorkingDirectory $taskRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logRoot 'worker.log') -RedirectStandardError (Join-Path $logRoot 'worker-error.log') -PassThru
$workerProcess.Id | Set-Content -LiteralPath $pidFile
Write-Output "Qwen worker started (PID $($workerProcess.Id))."
