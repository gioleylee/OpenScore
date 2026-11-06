import json
import sys
import types

import numpy as np
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app import separation, sources
from app.main import app
from app.schemas import Settings
from app.tablature import optimize
from app.schemas import Note


@pytest.mark.parametrize(
    "url",
    [
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "youtube.com/watch?v=dQw4w9WgXcQ&t=42s",
        "https://youtu.be/dQw4w9WgXcQ?si=abc",
        "https://m.youtube.com/shorts/dQw4w9WgXcQ",
        "https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=RDAMVM",
        "dQw4w9WgXcQ",
    ],
)
def test_youtube_links_are_normalized(url):
    assert sources.video_id(url) == "dQw4w9WgXcQ"


@pytest.mark.parametrize(
    "url",
    [
        "https://evil.example/watch?v=dQw4w9WgXcQ",
        "file:///etc/passwd",
        "http://127.0.0.1:8000/api/health",
        "https://www.youtube.com/playlist?list=PL123",
        "https://www.youtube.com/@channel",
        "https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ",
    ],
)
def test_non_video_links_are_rejected(url):
    with pytest.raises(ValueError):
        sources.video_id(url)


def test_online_job_rejects_foreign_hosts_and_respects_disable(monkeypatch):
    with TestClient(app) as client:
        body = {
            "url": "https://example.com/song.mp3",
            "settings": Settings().model_dump(),
        }
        if sources.available():
            assert client.post("/api/jobs/online", json=body).status_code == 422
        monkeypatch.setenv("ENABLE_ONLINE_SOURCES", "0")
        assert client.get("/api/health").json()["online_sources"] is False
        body["url"] = "https://youtu.be/dQw4w9WgXcQ"
        assert client.post("/api/jobs/online", json=body).status_code == 503
        assert client.post("/api/search", json={"query": "song"}).status_code == 503


def test_download_uses_fake_ytdlp_and_enforces_duration(tmp_path, monkeypatch):
    calls = []

    class FakeYDL:
        def __init__(self, options):
            self.options = options

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def extract_info(self, url, download=False):
            calls.append(url)
            return {"title": "Song\x00 Title", "duration": 200}

        def download(self, urls):
            (tmp_path / "download.m4a").write_bytes(b"audio")

    fake = types.ModuleType("yt_dlp")
    fake.YoutubeDL = FakeYDL
    fake.utils = types.SimpleNamespace(
        DownloadError=type("DownloadError", (Exception,), {})
    )
    monkeypatch.setitem(sys.modules, "yt_dlp", fake)
    title = sources.download("https://youtu.be/dQw4w9WgXcQ", tmp_path, 300, 10**7)
    assert title == "Song Title"
    assert (tmp_path / "upload").read_bytes() == b"audio"
    assert calls == ["https://www.youtube.com/watch?v=dQw4w9WgXcQ"]
    with pytest.raises(ValueError, match="minutes"):
        sources.download("dQw4w9WgXcQ", tmp_path, 60, 10**7)


def test_ukulele_reentrant_tuning_tab():
    settings = Settings(mode="ukulele", instrument="Ukulele", tuning=[67, 60, 64, 69])
    with pytest.raises(ValidationError):
        Settings(mode="ukulele", tuning=[40, 45, 50, 55, 59, 64])
    with pytest.raises(ValidationError):
        Settings(mode="guitar", tuning=[64, 59, 55, 50, 45, 40])
    # C major chord: open C (string 3), open E (2), open G (4), C on A string fret 3.
    notes = [Note(id=str(p), pitch=p, onset=0, duration=1) for p in (60, 64, 67, 72)]
    optimize(notes, settings)
    assert all(n.string is not None for n in notes)
    assert len({n.string for n in notes}) == 4


def test_separation_setting_requires_installed_model(monkeypatch):
    monkeypatch.setenv("ENABLE_SEPARATION", "0")
    with TestClient(app) as client:
        response = client.post(
            "/api/jobs",
            files={"file": ("x.wav", b"invalid")},
            data={"settings": Settings(separate="vocals").model_dump_json()},
        )
        assert response.status_code == 422
        assert client.get("/api/health").json()["separation"] is False


@pytest.mark.separation
def test_demucs_isolates_bass_from_mix():
    if not separation.available():
        pytest.skip("Demucs not installed")
    sr = 22050
    t = np.arange(sr * 4) / sr
    bass = 0.5 * np.sin(2 * np.pi * 55 * t)
    lead = 0.5 * np.sign(np.sin(2 * np.pi * 880 * t)) * 0.3
    isolated = separation.isolate((bass + lead).astype(np.float32), sr, "bass")
    spectrum = np.abs(np.fft.rfft(isolated))
    freqs = np.fft.rfftfreq(len(isolated), 1 / sr)
    low = spectrum[(freqs > 40) & (freqs < 70)].sum()
    high = spectrum[(freqs > 800) & (freqs < 1000)].sum()
    assert low > high


@pytest.mark.network
def test_real_youtube_search():
    results = sources.search("twinkle twinkle little star piano")
    assert results and all(len(r["id"]) == 11 for r in results)
    assert json.dumps(results)
