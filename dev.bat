@echo off
rem Windows launcher for dev.py: double-click it, or run dev.bat from a terminal
setlocal
cd /d "%~dp0"
chcp 65001 >nul
where py >nul 2>nul
if %errorlevel%==0 (
  py -3 dev.py %*
  goto end
)
where python >nul 2>nul
if %errorlevel%==0 (
  python dev.py %*
  goto end
)
where uv >nul 2>nul
if %errorlevel%==0 (
  uv run --no-project --python 3.11 python dev.py %*
  goto end
)
echo Serve Python 3.9+ (o uv): https://www.python.org/downloads/
:end
pause
