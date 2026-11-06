@echo off
rem Double-click to run OpenScore AI on this PC and open it in your browser.
rem First run installs everything it needs (several GB, 5-15 minutes).
setlocal
cd /d "%~dp0"
set "PY=.venv\Scripts\python.exe"
set "PORT=8000"

if not exist "%PY%" (
  echo [1/3] Creating the Python 3.11 environment...
  where uv >nul 2>nul && (
    uv venv --python 3.11 .venv || goto :fail
    uv pip install --python "%PY%" -r backend\requirements-ai.txt -r backend\requirements-online.txt || goto :fail
    uv pip install --python "%PY%" --index-url https://download.pytorch.org/whl/cpu --extra-index-url https://pypi.org/simple -r backend\requirements-separation.txt || goto :fail
  ) || (
    py -3.11 -m venv .venv || goto :nopython
    "%PY%" -m pip install -r backend\requirements-ai.txt -r backend\requirements-online.txt || goto :fail
    "%PY%" -m pip install --index-url https://download.pytorch.org/whl/cpu --extra-index-url https://pypi.org/simple -r backend\requirements-separation.txt || goto :fail
  )
)

if not exist "frontend\dist\index.html" (
  echo [2/3] Building the website...
  where npm >nul 2>nul || goto :nonode
  pushd frontend
  call npm ci --ignore-scripts || (popd & goto :fail)
  call npm run build || (popd & goto :fail)
  popd
)

where node >nul 2>nul || where deno >nul 2>nul || echo WARNING: Node.js or Deno not found. YouTube links and song search need one of them.

echo [3/3] Starting OpenScore AI at http://127.0.0.1:%PORT%
echo Keep this window open while you use the website. Close it to stop.
start "" /b powershell -NoProfile -WindowStyle Hidden -Command "for($i=0;$i -lt 180;$i++){try{Invoke-WebRequest http://127.0.0.1:%PORT%/api/health -UseBasicParsing -TimeoutSec 2 | Out-Null; Start-Process http://127.0.0.1:%PORT%; break}catch{Start-Sleep 1}}"
cd backend
"..\%PY%" -m uvicorn app.main:app --host 127.0.0.1 --port %PORT%
goto :eof

:nopython
echo Python 3.11 was not found. Install it from https://www.python.org/downloads/ or install uv, then run this again.
pause
exit /b 1
:nonode
echo Node.js was not found. Install the LTS version from https://nodejs.org, then run this again.
pause
exit /b 1
:fail
echo Setup failed. Scroll up for the error, fix it, then run this again.
pause
exit /b 1
