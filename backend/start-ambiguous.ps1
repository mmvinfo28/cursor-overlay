$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$logRoot = Join-Path $PSScriptRoot 'runtime'
New-Item -ItemType Directory -Force -Path $logRoot | Out-Null
$envFile = Join-Path $PSScriptRoot '.env.ambiguous.local'
if (-not (Test-Path -LiteralPath $envFile)) { Write-Error "Missing backend/.env.ambiguous.local (copy .env.ambiguous.example)"; exit 1 }
$nodePath = (Get-Command node).Source
$p = Start-Process -FilePath $nodePath -ArgumentList '--env-file=backend/.env.ambiguous.local', 'backend/ambiguous.mjs' -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logRoot 'ambiguous.log') -RedirectStandardError (Join-Path $logRoot 'ambiguous-error.log') -PassThru
$p.Id | Set-Content -LiteralPath (Join-Path $logRoot 'ambiguous.pid')
Write-Output "Ambiguous coworker started (PID $($p.Id)). Log: backend/runtime/ambiguous.log"
