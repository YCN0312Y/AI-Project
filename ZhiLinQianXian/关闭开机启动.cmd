@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\manage-autostart.ps1" -Disable
if errorlevel 1 (
  echo Failed to disable autostart.
  pause
  exit /b 1
)
pause
