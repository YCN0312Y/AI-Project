@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if not errorlevel 1 (
  start "" "http://127.0.0.1:8148/"
  node "%~dp0serve.cjs" 8148
) else (
  start "" "%~dp0index.html"
)
