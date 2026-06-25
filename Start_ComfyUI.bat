@echo off
setlocal

set "COMFY_ROOT=C:\Users\mpick\My_AI_Tools\Comfyui\ComfyUI"
set "COMFY_VENV=C:\Users\mpick\My_AI_Tools\Comfyui\venv"
set "COMFY_URL=http://127.0.0.1:8188/"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$port = Get-NetTCPConnection -LocalPort 8188 -State Listen -ErrorAction SilentlyContinue; $proc = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match 'main\.py' -and $_.CommandLine -match 'ComfyUI|--auto-launch|python' }; if ($port -or $proc) { Start-Process '%COMFY_URL%'; exit 10 }"

if "%ERRORLEVEL%"=="10" (
  echo ComfyUI is already running. Opened %COMFY_URL%
  exit /b 0
)

cd /d "%COMFY_ROOT%" || (
  echo Could not find ComfyUI folder: %COMFY_ROOT%
  pause
  exit /b 1
)

call "%COMFY_VENV%\Scripts\activate.bat" || (
  echo Could not activate venv: %COMFY_VENV%
  pause
  exit /b 1
)

python main.py --auto-launch
