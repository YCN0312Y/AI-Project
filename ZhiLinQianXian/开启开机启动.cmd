@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\manage-autostart.ps1"
if errorlevel 1 (
  echo Failed to enable autostart.
  pause
  exit /b 1
)
echo Open http://localhost:8136/ after Windows sign-in.
pause
