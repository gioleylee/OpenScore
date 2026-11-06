#!/usr/bin/env sh
# Run OpenScore AI on this computer (macOS/Linux) and open it in the browser.
# First run installs everything it needs (several GB, 5-15 minutes).
set -e
cd "$(dirname "$0")"
PY=.venv/bin/python
PORT=${PORT:-8000}

if [ ! -x "$PY" ]; then
  echo "[1/3] Creating the Python 3.11 environment..."
  if command -v uv >/dev/null 2>&1; then
    uv venv --python 3.11 .venv
    INSTALL="uv pip install --python $PY"
  else
    python3.11 -m venv .venv
    INSTALL="$PY -m pip install"
  fi
  $INSTALL -r backend/requirements-ai.txt -r backend/requirements-online.txt
  $INSTALL --index-url https://download.pytorch.org/whl/cpu \
    --extra-index-url https://pypi.org/simple -r backend/requirements-separation.txt
fi

if [ ! -f frontend/dist/index.html ]; then
  echo "[2/3] Building the website..."
  (cd frontend && npm ci --ignore-scripts && npm run build)
fi

command -v node >/dev/null 2>&1 || command -v deno >/dev/null 2>&1 ||
  echo "WARNING: Node.js or Deno not found. YouTube links and song search need one of them."

URL="http://127.0.0.1:$PORT"
echo "[3/3] Starting OpenScore AI at $URL (press Ctrl+C to stop)"
(
  for _ in $(seq 1 180); do
    if curl -fs "$URL/api/health" >/dev/null 2>&1; then
      (command -v open >/dev/null && open "$URL") || xdg-open "$URL" >/dev/null 2>&1 || true
      break
    fi
    sleep 1
  done
) &
cd backend
exec "../$PY" -m uvicorn app.main:app --host 127.0.0.1 --port "$PORT"
