import asyncio
import importlib.util
import json
import logging
import os
import time
import threading
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field, ValidationError

from . import separation, sources
from .audio import EXTENSIONS
from .jobs import TTL, Manager
from .notation import midi_bytes, musicxml
from .schemas import STRINGED, Score, Settings
from .tablature import ascii_tab, optimize

manager = Manager()
MAX_BYTES = int(os.environ.get("MAX_UPLOAD_MB", "50")) * 1024 * 1024
rate = {}
export_slots = threading.BoundedSemaphore(2)


def export_slot():
    if not export_slots.acquire(blocking=False):
        raise HTTPException(429, "Score processing is busy. Try again shortly.")
    try:
        yield
    finally:
        export_slots.release()


@asynccontextmanager
async def lifespan(app):
    manager.remove_orphans()
    cleanup = asyncio.create_task(manager.cleanup())
    yield
    cleanup.cancel()
    await asyncio.gather(cleanup, return_exceptions=True)
    await manager.close()


app = FastAPI(
    title=os.environ.get("APP_NAME", "OpenScore AI"), version="0.1.0", lifespan=lifespan
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get(
        "CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173,https://localhost"
    ).split(","),
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Content-Type"],
    expose_headers=["Content-Disposition"],
)


class BodyLimit:
    """Count actual streamed bytes, including multipart, before parsing completes."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        count = 0
        limit = MAX_BYTES + 1_000_000 if scope["path"] == "/api/jobs" else 4_000_000

        async def bounded_receive():
            nonlocal count
            message = await receive()
            if message["type"] == "http.request":
                count += len(message.get("body", b""))
                if count > limit:
                    raise HTTPException(413, "Request body exceeds limit")
            return message

        await self.app(scope, bounded_receive, send)


app.add_middleware(BodyLimit)


@app.middleware("http")
async def limits(request: Request, call_next):
    # Proxy forwarded IP headers are deliberately ignored. Configure uvicorn trusted proxy IPs explicitly.
    if request.method == "POST":
        try:
            content_length = int(request.headers.get("content-length", "0") or 0)
        except ValueError:
            return Response("Invalid content length", status_code=400)
        if content_length > (
            MAX_BYTES + 1_000_000 if request.url.path == "/api/jobs" else 4_000_000
        ):
            return Response("Request too large", status_code=413)
        now = time.monotonic()
        for key in list(rate):
            rate[key] = [t for t in rate[key] if now - t < 60]
            if not rate[key]:
                del rate[key]
        ip = request.client.host if request.client else "unknown"
        bucket = (
            "upload"
            if request.url.path in ("/api/jobs", "/api/jobs/online")
            else "search"
            if request.url.path == "/api/search"
            else "edit"
        )
        limit = {"upload": 8, "search": 20, "edit": 60}[bucket]
        key = (ip, bucket)
        history = rate.setdefault(key, [])
        if len(history) >= limit:
            return Response(
                "Rate limit reached; try again in one minute", status_code=429
            )
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
    return {
        "status": "ok",
        "basic_pitch": importlib.util.find_spec("basic_pitch") is not None,
        "online_sources": sources.available(),
        "separation": separation.available(),
        "max_upload_mb": MAX_BYTES // 1024**2,
        "max_duration": float(os.environ.get("MAX_DURATION", "480")),
    }


@app.post("/api/jobs", status_code=202)
async def upload(
    request: Request, file: UploadFile = File(...), settings: str = Form(...)
):
    try:
        config = Settings.model_validate_json(settings)
    except ValidationError as exc:
        raise HTTPException(422, str(exc)) from exc
    if config.separate != "none" and not separation.available():
        raise HTTPException(422, "Instrument isolation is not installed on this server")
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
        (job.directory / "title.txt").write_text(
            "".join(c for c in title if c.isprintable()) or "Untitled"
        )
        manager.submit(job)
    except BaseException:
        await manager.delete(job)
        raise
    finally:
        await file.close()
    return {"id": job.id, "state": job.state}


class SearchRequest(BaseModel):
    query: str = Field(min_length=2, max_length=150)


class OnlineJob(BaseModel):
    url: str = Field(min_length=5, max_length=500)
    settings: Settings


def require_online():
    if not sources.available():
        raise HTTPException(
            503,
            "YouTube links and song search are disabled on this server. Install yt-dlp or upload a file.",
        )


@app.post("/api/search")
def search(body: SearchRequest):
    require_online()
    try:
        return {"results": sources.search(body.query)}
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    except Exception as exc:
        logging.exception("Search failed")
        raise HTTPException(502, "Song search is unavailable right now.") from exc


@app.post("/api/jobs/online", status_code=202)
async def online(request: Request, body: OnlineJob):
    require_online()
    try:
        url = sources.canonical(sources.video_id(body.url))
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    if body.settings.separate != "none" and not separation.available():
        raise HTTPException(422, "Instrument isolation is not installed on this server")
    try:
        job = manager.create(request.client.host if request.client else "unknown")
    except ValueError as exc:
        raise HTTPException(429, str(exc)) from exc
    (job.directory / "source.json").write_text(json.dumps({"url": url}))
    (job.directory / "settings.json").write_text(body.settings.model_dump_json())
    (job.directory / "title.txt").write_text("YouTube audio")
    manager.submit(job)
    return {"id": job.id, "state": job.state}


@app.get("/api/jobs/{identifier}")
def status(identifier: str):
    job = get_job(identifier)
    stage_file = job.directory / "stage.txt"
    return {
        "id": job.id,
        "state": job.state,
        "stage": stage_file.read_text()
        if stage_file.exists()
        else job.state.capitalize(),
        "error": job.error,
        "expires_in": max(0, int(TTL - (time.time() - (job.finished or job.created)))),
    }


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


@app.post("/api/render/{format}", dependencies=[Depends(export_slot)])
def render(format: str, score: Score, view: str = "staff"):
    # Stateless exports: the exact edited score is always submitted by the client.
    try:
        if format == "midi":
            return Response(
                midi_bytes(score),
                media_type="audio/midi",
                headers={"Content-Disposition": 'attachment; filename="score.mid"'},
            )
        if format == "musicxml":
            return Response(
                musicxml(score, view),
                media_type="application/vnd.recordare.musicxml+xml",
            )
        if format == "txt" and score.settings.mode in STRINGED:
            return Response(ascii_tab(score), media_type="text/plain")
    except Exception as exc:
        logging.exception("Export failed")
        raise HTTPException(
            422, "Score could not be engraved. Check note durations and timings."
        ) from exc
    raise HTTPException(400, "Unsupported export format")


@app.post("/api/fingering", dependencies=[Depends(export_slot)])
def fingering(score: Score):
    warnings = optimize(score.notes, score.settings)
    score.warnings = [
        w for w in score.warnings if "fingering" not in w and "fret-span" not in w
    ] + warnings
    return score


# Serve the built website from the same server when it is available, so one
# command gives a complete app at http://127.0.0.1:8000 (see start scripts).
SITE = Path(
    os.environ.get(
        "FRONTEND_DIST", Path(__file__).resolve().parents[2] / "frontend" / "dist"
    )
)
if (SITE / "index.html").is_file():
    from fastapi.staticfiles import StaticFiles

    app.mount("/", StaticFiles(directory=SITE, html=True), name="site")
