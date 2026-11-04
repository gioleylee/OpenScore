import asyncio
import importlib.util
import json
import logging
import os
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from pydantic import ValidationError

from .audio import EXTENSIONS
from .jobs import Manager
from .notation import midi_bytes, musicxml
from .schemas import Score, Settings
from .tablature import ascii_tab, optimize

manager = Manager()
MAX_BYTES = int(os.environ.get("MAX_UPLOAD_MB", "25")) * 1024 * 1024
rate = {}


@asynccontextmanager
async def lifespan(app):
    manager.remove_orphans()
    cleanup = asyncio.create_task(manager.cleanup())
    yield
    cleanup.cancel()
    await asyncio.gather(cleanup, return_exceptions=True)
    await manager.close()


app = FastAPI(title=os.environ.get("APP_NAME", "OpenScore AI"), version="0.1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=os.environ.get("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(","),
                   allow_methods=["GET", "POST", "DELETE"], allow_headers=["Content-Type"], expose_headers=["Content-Disposition"])


@app.middleware("http")
async def limits(request: Request, call_next):
    # Proxy forwarded IP headers are deliberately ignored. Configure uvicorn trusted proxy IPs explicitly.
    if request.method == "POST":
        if int(request.headers.get("content-length", "0") or 0) > MAX_BYTES + 1_000_000:
            return Response("Request too large", status_code=413)
        now = time.monotonic()
        for key in list(rate):
            rate[key] = [t for t in rate[key] if now - t < 60]
            if not rate[key]:
                del rate[key]
        ip = request.client.host if request.client else "unknown"
        limit = 8 if request.url.path == "/api/jobs" else 60
        key = (ip, "upload" if request.url.path == "/api/jobs" else "edit")
        history = rate.setdefault(key, [])
        if len(history) >= limit:
            return Response("Rate limit reached; try again in one minute", status_code=429)
        history.append(now)
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Cache-Control"] = "no-store"
    return response


def get_job(identifier):
    job = manager.jobs.get(identifier)
    if not job:
        raise HTTPException(404, "Job not found or expired")
    return job


@app.get("/api/health")
def health():
    return {"status": "ok", "basic_pitch": importlib.util.find_spec("basic_pitch") is not None,
            "max_upload_mb": MAX_BYTES // 1024**2, "max_duration": float(os.environ.get("MAX_DURATION", "120"))}


@app.post("/api/jobs", status_code=202)
async def upload(request: Request, file: UploadFile = File(...), settings: str = Form(...)):
    try:
        config = Settings.model_validate_json(settings)
    except ValidationError as exc:
        raise HTTPException(422, str(exc)) from exc
    if Path(file.filename or "").suffix.lower() not in EXTENSIONS:
        raise HTTPException(415, "Use MP3, WAV, FLAC, M4A or OGG")
    try:
        job = manager.create(request.client.host if request.client else "unknown")
    except ValueError as exc:
        raise HTTPException(429, str(exc)) from exc
    try:
        count = 0
        with (job.directory / "upload").open("wb") as out:
            while chunk := await file.read(1024 * 256):
                count += len(chunk)
                if count > MAX_BYTES:
                    raise HTTPException(413, "Audio file exceeds upload limit")
                out.write(chunk)
        if not count:
            raise HTTPException(422, "Audio file is empty")
        (job.directory / "settings.json").write_text(config.model_dump_json())
        # Display title only. User filenames never become filesystem paths.
        title = Path((file.filename or "Untitled").replace("\\", "/")).stem[:100]
        (job.directory / "title.txt").write_text("".join(c for c in title if c.isprintable()) or "Untitled")
        manager.submit(job)
    except BaseException:
        await manager.delete(job)
        raise
    finally:
        await file.close()
    return {"id": job.id, "state": job.state}


@app.get("/api/jobs/{identifier}")
def status(identifier: str):
    job = get_job(identifier)
    stage_file = job.directory / "stage.txt"
    return {"id": job.id, "state": job.state,
            "stage": stage_file.read_text() if stage_file.exists() else job.state.capitalize(),
            "error": job.error, "expires_in": max(0, int(3600 - (time.time() - (job.finished or job.created))))}


@app.get("/api/jobs/{identifier}/result")
def result(identifier: str):
    job = get_job(identifier)
    if job.state != "done":
        raise HTTPException(409, "Job has no completed result")
    return json.loads((job.directory / "result.json").read_text())


@app.get("/api/jobs/{identifier}/audio")
def audio(identifier: str):
    job = get_job(identifier)
    if job.state != "done":
        raise HTTPException(409, "Audio is not ready")
    return FileResponse(job.directory / "audio.wav", media_type="audio/wav")


@app.delete("/api/jobs/{identifier}", status_code=204)
async def delete(identifier: str):
    await manager.delete(get_job(identifier))
    return Response(status_code=204)


@app.post("/api/render/{format}")
def render(format: str, score: Score, view: str = "staff"):
    # Stateless exports: the exact edited score is always submitted by the client.
    try:
        if format == "midi":
            return Response(midi_bytes(score), media_type="audio/midi", headers={"Content-Disposition": 'attachment; filename="score.mid"'})
        if format == "musicxml":
            return Response(musicxml(score, view), media_type="application/vnd.recordare.musicxml+xml")
        if format == "txt" and score.settings.mode in ("guitar", "bass"):
            return Response(ascii_tab(score), media_type="text/plain")
    except Exception as exc:
        logging.exception("Export failed")
        raise HTTPException(422, "Score could not be engraved. Check note durations and timings.") from exc
    raise HTTPException(400, "Unsupported export format")


@app.post("/api/fingering")
def fingering(score: Score):
    warnings = optimize(score.notes, score.settings)
    score.warnings = [w for w in score.warnings if "fingering" not in w and "fret-span" not in w] + warnings
    return score
