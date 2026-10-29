@echo off
"C:\Users\Administrator\.local\bin\python3.11.exe" -c "import pygame, numpy" 2>nul
if errorlevel 1 (
    echo Installing pygame and numpy...
    "C:\Users\Administrator\.local\bin\python3.11.exe" -m pip install pygame numpy --break-system-packages
    if errorlevel 1 goto :end
)
"C:\Users\Administrator\.local\bin\python3.11.exe" "%~dp0main.py"
:end
pause