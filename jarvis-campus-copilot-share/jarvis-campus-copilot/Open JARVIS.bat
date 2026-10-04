@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -Command "try { Invoke-WebRequest -Uri 'http://127.0.0.1:8765/api/status' -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }"
if errorlevel 1 (
  start "JARVIS local server" /min cmd /k "node server.mjs"
  for /l %%n in (1,1,10) do (
    timeout /t 1 /nobreak >nul
    powershell -NoProfile -Command "try { Invoke-WebRequest -Uri 'http://127.0.0.1:8765/api/status' -TimeoutSec 1 | Out-Null; exit 0 } catch { exit 1 }"
    if not errorlevel 1 goto open_site
  )
  echo JARVIS did not start. Check that Node.js is installed and try again.
  pause
  exit /b 1
)
:open_site
start "" "http://127.0.0.1:8765/"
