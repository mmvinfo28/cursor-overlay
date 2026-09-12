@echo off
setlocal
set "DIR=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$d='%DIR%'; $exe=Join-Path $d 'node_modules\electron\dist\electron.exe'; $procs=Get-CimInstance Win32_Process | Where-Object { $c=$_.CommandLine; ($_.ExecutablePath -eq $exe) -or ($c -and (($c -like ('*'+$d+'keyhelper.ps1*')) -or ($c -like ('*'+$d+'shifthelper.ps1*')) -or ($c -like ('*'+$d+'uiahelper.ps1*')))) }; $n=0; foreach($p in $procs){ try { Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop; $n++ } catch {} }; Write-Host ('stopped ' + $n + ' process(es)')"
endlocal
