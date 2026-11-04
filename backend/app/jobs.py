import asyncio
import os
import secrets
import shutil
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(os.environ.get("DATA_DIR", "data/jobs")).resolve()
MAX_JOBS = int(os.environ.get("MAX_JOBS", "12"))
TTL = int(os.environ.get("JOB_TTL", "3600"))
TIMEOUT = int(os.environ.get("JOB_TIMEOUT", "600"))


@dataclass
class Job:
    id: str
    directory: Path
    owner: str
    state: str = "uploading"
    created: float = field(default_factory=time.time)
    finished: float | None = None
    process: asyncio.subprocess.Process | None = None
    task: asyncio.Task | None = None
    error: str | None = None


class Manager:
    def __init__(self):
        self.jobs: dict[str, Job] = {}
        self.semaphore = asyncio.Semaphore(int(os.environ.get("MAX_CONCURRENT_JOBS", "1")))

    def create(self, owner):
        if len(self.jobs) >= MAX_JOBS:
            raise ValueError("Server queue/storage is full. Try again after existing jobs expire.")
        if sum(j.owner == owner and j.state in ("uploading", "queued", "running") for j in self.jobs.values()) >= 2:
            raise ValueError("You already have two active jobs")
        ROOT.mkdir(parents=True, exist_ok=True)
        identifier = secrets.token_urlsafe(32)
        directory = ROOT / identifier
        directory.mkdir()
        job = Job(identifier, directory, owner)
        self.jobs[identifier] = job
        return job

    def submit(self, job):
        job.state = "queued"
        job.task = asyncio.create_task(self.execute(job))

    async def execute(self, job):
        try:
            async with self.semaphore:
                job.state = "running"
                with (job.directory / "worker.log").open("wb") as log:
                    job.process = await asyncio.create_subprocess_exec(
                        sys.executable, "-m", "app.worker", str(job.directory), stdout=log, stderr=log)
                    try:
                        await asyncio.wait_for(job.process.wait(), TIMEOUT)
                    except asyncio.TimeoutError:
                        job.process.kill()
                        await job.process.wait()
                        job.error = "Processing exceeded the time limit. Try a shorter segment."
                error_file = job.directory / "error.txt"
                if error_file.exists():
                    job.error = error_file.read_text()
                job.state = "failed" if job.error or job.process.returncode != 0 else "done"
                if job.state == "failed":
                    job.error = job.error or "Worker exited unexpectedly; check server logs"
                    for name in ("upload", "audio.wav"):
                        (job.directory / name).unlink(missing_ok=True)
                job.finished = time.time()
        except asyncio.CancelledError:
            if job.process and job.process.returncode is None:
                job.process.kill()
                await job.process.wait()
            job.state = "cancelled"
            job.finished = time.time()
            raise
        except Exception:
            job.state, job.error, job.finished = "failed", "Could not start processing worker", time.time()

    async def delete(self, job):
        if job.task and not job.task.done():
            job.task.cancel()
            await asyncio.gather(job.task, return_exceptions=True)
        shutil.rmtree(job.directory, ignore_errors=True)
        self.jobs.pop(job.id, None)

    async def cleanup(self):
        while True:
            for job in list(self.jobs.values()):
                if time.time() - (job.finished or job.created) > TTL:
                    await self.delete(job)
            await asyncio.sleep(30)

    async def close(self):
        for job in list(self.jobs.values()):
            await self.delete(job)

    def remove_orphans(self):
        # Single API process owns this directory. Never share it across replicas.
        ROOT.mkdir(parents=True, exist_ok=True)
        for path in ROOT.iterdir():
            if path.is_dir():
                shutil.rmtree(path, ignore_errors=True)
