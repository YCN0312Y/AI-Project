@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Remove-FilenameText.ps1" -Folder "%~dp0."
endlocal
