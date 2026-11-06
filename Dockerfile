FROM python:3.11-slim-bookworm AS backend
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 DATA_DIR=/data/jobs \
    OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 TF_NUM_INTRAOP_THREADS=1 TF_NUM_INTEROP_THREADS=1 \
    NUMBA_CACHE_DIR=/tmp/numba MPLCONFIGDIR=/tmp/matplotlib \
    IMAGEIO_FFMPEG_EXE=/usr/bin/ffmpeg TORCH_HOME=/app/models XDG_CACHE_HOME=/tmp/cache
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg libsndfile1 libgomp1 \
    && rm -rf /var/lib/apt/lists/*
# JavaScript runtime used by yt-dlp to answer YouTube challenges.
COPY --from=denoland/deno:bin-2.5.6 /deno /usr/local/bin/deno
WORKDIR /app
COPY backend/requirements*.txt ./
RUN pip install --no-cache-dir -r requirements-ai.txt -r requirements-online.txt \
    && pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu \
       --extra-index-url https://pypi.org/simple -r requirements-separation.txt
# Bake the Demucs weights into the image; the runtime filesystem is read-only.
RUN python -c "from demucs.pretrained import get_model; get_model('htdemucs_6s')"
COPY backend/app ./app
RUN useradd --create-home app && mkdir -p /data/jobs && chown -R app:app /data
USER app
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--no-proxy-headers", "--limit-concurrency", "24"]

FROM node:24-bookworm-slim AS frontend-build
# JavaScript runtime used by yt-dlp to answer YouTube challenges.
COPY --from=denoland/deno:bin-2.5.6 /deno /usr/local/bin/deno
WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci --ignore-scripts
COPY frontend/ ./
ARG VITE_API_URL=""
ARG VITE_APP_NAME="OpenScore AI"
ENV VITE_API_URL=$VITE_API_URL VITE_APP_NAME=$VITE_APP_NAME
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.28-alpine AS frontend
COPY --from=frontend-build /app/dist /usr/share/nginx/html
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
