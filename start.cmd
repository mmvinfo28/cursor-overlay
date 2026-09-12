@echo off
setlocal
set "DIR=%~dp0"
set "DIR=%DIR:~0,-1%"
start "" /D "%DIR%" "%DIR%\node_modules\electron\dist\electron.exe" "%DIR%"
endlocal
