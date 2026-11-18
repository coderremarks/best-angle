@echo off
rem Double-click to start Best Angle. Close this window to stop it.
cd /d "%~dp0"
python start.py %*
if errorlevel 1 (
  echo.
  echo Could not start. Is Python installed? Get it from the Microsoft Store or python.org.
  pause
)
