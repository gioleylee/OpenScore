import io
import asyncio
import json
import subprocess
import sys
import time
import xml.etree.ElementTree as ET

import mido
import pytest
import soundfile as sf
from fastapi.testclient import TestClient
from music21 import converter
from pydantic import ValidationError

from app.audio import decode
from app.main import app
from app.schemas import Note, Score, Settings
from app.tablature import candidates, optimize
from app.transcription import clean_quantize, transcribe
from app.notation import midi_bytes, musicxml
from scripts.generate_examples import fixture


def n(pitch, onset=0, duration=1):
    return Note(id=f"{pitch}-{onset}", pitch=pitch, onset=onset, duration=duration)


def test_audio_validation(tmp_path):
    source, output = tmp_path / "in.wav", tmp_path / "out.wav"
    y, sr = fixture([[69]])
    sf.write(source, y, sr)
    data, rate, metadata = decode(source, output, 5, 0.1, 0.5)
    assert rate == 22050 and len(data) == 8820
    assert metadata["segment_start"] == 0.1
    with pytest.raises(ValueError, match="exceeds"):
        decode(source, output, 0.2)
    source.write_text("not music")
    with pytest.raises(ValueError, match="decoded"):
        decode(source, output, 5)


def test_quantization_filters_and_preserves_pitch():
    notes = clean_quantize(
        [
            (0.01, 0.5, 60, 90),
            (0.02, 0.45, 60, 80),
            (0.1, 0.11, 99, 40),
            (0.51, 1, 62, 70),
        ],
        120,
        Settings(),
    )
    assert [(n.pitch, n.onset, n.duration) for n in notes] == [(60, 0, 1), (62, 1, 1)]


def test_tab_tuning_capo_and_chords():
    config = Settings(mode="guitar", capo=2)
    assert (6, 0) in candidates(42, config)
    assert not candidates(20, config)
    config.tuning[0] = 38  # Drop D
    assert (6, 0) in candidates(40, config)
    notes = [n(p) for p in [52, 55, 59, 64]]
    optimize(notes, config)
    assert len({x.string for x in notes}) == 4
    for x in notes:
        assert x.pitch == config.tuning[-x.string] + config.capo + x.fret
    frets = [x.fret for x in notes if x.fret]
    assert max(frets) - min(frets) <= 4


def test_sustained_strings_and_unplayable_are_honest():
    config = Settings(mode="bass", tuning=[28, 33, 38, 43], min_fret=0, max_fret=4)
    notes = [n(28, 0, 4), n(29, 1), n(120, 2)]
    warnings = optimize(notes, config)
    assert notes[0].string == 4
    assert notes[1].string is None and notes[2].string is None
    assert any("2 notes" in w for w in warnings)


def test_exports_roundtrip_rests_ties_and_polyphony():
    score = Score(
        title="A & B <test>",
        tempo=96,
        settings=Settings(mode="piano", engine="basic_pitch"),
        notes=[n(48, 0, 5), n(60, 1, 0.5), n(64, 1, 2), n(67, 5.5, 0.5)],
    )
    midi = mido.MidiFile(file=io.BytesIO(midi_bytes(score)))
    assert len([m for m in midi.tracks[0] if m.type == "note_on"]) == 4
    assert midi.length == pytest.approx(6 * 60 / 96)
    xml = musicxml(score)
    parsed = ET.fromstring(xml)
    assert len(parsed.findall("part")) == 2
    assert parsed.findall(".//rest") and parsed.findall(".//tie")
    roundtrip = converter.parseData(xml.decode(), format="musicxml")
    assert {p.midi for p in roundtrip.pitches} == {48, 60, 64, 67}
    assert roundtrip.highestTime >= 6


def test_tab_musicxml_technical_elements():
    score = Score(
        title="Tab",
        tempo=120,
        settings=Settings(mode="guitar"),
        notes=[n(64), n(67, 1)],
    )
    optimize(score.notes, score.settings)
    xml = ET.fromstring(musicxml(score, "tab"))
    assert xml.find(".//clef/sign").text == "TAB"
    assert len(xml.findall(".//staff-tuning")) == 6
    assert xml.findall(".//technical/string") and xml.findall(".//technical/fret")


def test_pyin_on_generated_melody(tmp_path):
    y, sr = fixture([[60], [64], [67]], seconds=0.65)
    path = tmp_path / "melody.wav"
    sf.write(path, y, sr)
    notes, tempo, _ = transcribe(path, y, sr, Settings(tempo=120), lambda _: None)
    assert [x.pitch for x in notes] == [60, 64, 67]
    assert tempo == 120


@pytest.mark.ai
def test_basic_pitch_real_model(tmp_path):
    import importlib.util

    if importlib.util.find_spec("basic_pitch") is None:
        pytest.skip("Install requirements-ai.txt to exercise model weights")
    y, sr = fixture([[60, 64]], seconds=1)
    path = tmp_path / "upload"
    sf.write(path, y, sr, format="WAV")
    (tmp_path / "settings.json").write_text(
        Settings(
            mode="piano", engine="basic_pitch", tempo=120, sensitivity=0.2
        ).model_dump_json()
    )
    (tmp_path / "title.txt").write_text("Chord")
    # Match production: TensorFlow stays out of the API/test event-loop process.
    process = subprocess.run(
        [sys.executable, "-m", "app.worker", str(tmp_path)],
        capture_output=True,
        timeout=90,
    )
    assert process.returncode == 0, process.stderr.decode(errors="replace")
    result = json.loads((tmp_path / "result.json").read_text())
    assert {60, 64}.issubset({n["pitch"] for n in result["score"]["notes"]})


def test_invalid_inputs():
    for kwargs in [
        {"start": 2, "end": 1},
        {"min_fret": 20, "max_fret": 10},
        {"tuning": [90, 40, 50, 60]},
        {"mode": "piano"},
    ]:
        with pytest.raises(ValidationError):
            Settings(**kwargs)
    with pytest.raises(ValidationError):
        n(128)
    with pytest.raises(ValidationError):
        Score(
            tempo=120,
            settings=Settings(),
            notes=[n(60).model_copy(update={"string": 1, "fret": 0})],
        )


def test_upload_job_export_and_cleanup():
    y, sr = fixture([[69]], seconds=0.6)
    out = io.BytesIO()
    sf.write(out, y, sr, format="WAV")
    with TestClient(app) as client:
        response = client.post(
            "/api/jobs",
            files={"file": ("../test.wav", out.getvalue(), "audio/wav")},
            data={"settings": Settings(tempo=120).model_dump_json()},
        )
        assert response.status_code == 202, response.text
        identifier = response.json()["id"]
        for _ in range(180):
            status = client.get(f"/api/jobs/{identifier}").json()
            if status["state"] in ("done", "failed"):
                break
            time.sleep(0.5)
        assert status["state"] == "done", status
        result = client.get(f"/api/jobs/{identifier}/result").json()
        assert result["score"]["notes"][0]["pitch"] == 69
        for format in ("midi", "musicxml"):
            exported = client.post(f"/api/render/{format}", json=result["score"])
            assert exported.status_code == 200, exported.text
            if format == "musicxml":
                assert ET.fromstring(exported.content).tag == "score-partwise"
            else:
                assert mido.MidiFile(file=io.BytesIO(exported.content)).length > 0
        from app.main import manager

        directory = manager.jobs[identifier].directory
        assert not (directory / "upload").exists()
        assert client.delete(f"/api/jobs/{identifier}").status_code == 204
        assert not directory.exists()
        assert client.get(f"/api/jobs/{identifier}").status_code == 404


def test_non_latin_title_survives_the_pipeline():
    # Job files must be UTF-8 on every platform. With the platform default
    # (cp1252 on Windows) a title like this could not even be saved.
    title = "夜に駆ける – étude \U0001f3b5"
    y, sr = fixture([[69]], seconds=0.6)
    out = io.BytesIO()
    sf.write(out, y, sr, format="WAV")
    with TestClient(app) as client:
        response = client.post(
            "/api/jobs",
            files={"file": (f"{title}.wav", out.getvalue(), "audio/wav")},
            data={"settings": Settings(tempo=120).model_dump_json()},
        )
        assert response.status_code == 202, response.text
        identifier = response.json()["id"]
        for _ in range(180):
            status = client.get(f"/api/jobs/{identifier}").json()
            if status["state"] in ("done", "failed"):
                break
            time.sleep(0.5)
        assert status["state"] == "done", status
        result = client.get(f"/api/jobs/{identifier}/result").json()
        assert result["score"]["title"] == title


def test_bad_upload_and_cancel():
    with TestClient(app) as client:
        settings = {"settings": Settings().model_dump_json()}
        assert (
            client.post(
                "/api/jobs", files={"file": ("x.exe", b"x")}, data=settings
            ).status_code
            == 415
        )
        response = client.post(
            "/api/jobs", files={"file": ("x.wav", b"invalid")}, data=settings
        )
        identifier = response.json()["id"]
        assert client.delete(f"/api/jobs/{identifier}").status_code == 204
        assert client.get(f"/api/jobs/{identifier}").status_code == 404


@pytest.mark.parametrize("extension", ["mp3", "flac", "m4a", "ogg"])
def test_compressed_audio_formats(tmp_path, extension):
    import imageio_ffmpeg

    source, encoded, output = (
        tmp_path / "source.wav",
        tmp_path / f"encoded.{extension}",
        tmp_path / "decoded.wav",
    )
    y, sr = fixture([[69]])
    sf.write(source, y, sr)
    subprocess.run(
        [
            imageio_ffmpeg.get_ffmpeg_exe(),
            "-v",
            "error",
            "-i",
            str(source),
            str(encoded),
        ],
        check=True,
        timeout=30,
    )
    decoded, sample_rate, _ = decode(encoded, output, 5)
    assert sample_rate == 22050 and len(decoded) > 10000


def test_playlist_rejected(tmp_path):
    source = tmp_path / "fake.wav"
    source.write_text("#EXTM3U\nhttp://127.0.0.1/private.wav\n")
    with pytest.raises(ValueError, match="decoded"):
        decode(source, tmp_path / "decoded.wav", 5)


def test_queue_timeout_expiry_and_capacity(monkeypatch):
    from app import jobs

    async def exercise():
        manager = jobs.Manager()
        monkeypatch.setattr(jobs, "MAX_JOBS", 2)
        first = manager.create("one")
        second = manager.create("two")
        with pytest.raises(ValueError, match="full"):
            manager.create("three")
        # Cancel a genuinely queued task before it can acquire the semaphore.
        await manager.semaphore.acquire()
        manager.submit(first)
        await asyncio.sleep(0)
        assert first.state == "queued"
        await manager.delete(first)
        assert first.id not in manager.jobs and not first.directory.exists()
        manager.semaphore.release()
        monkeypatch.setattr(jobs, "TIMEOUT", 0.01)
        await manager.execute(second)
        assert second.state == "failed" and "time limit" in second.error
        monkeypatch.setattr(jobs, "TTL", -1)
        cleaner = asyncio.create_task(manager.cleanup())
        await asyncio.sleep(0.05)
        cleaner.cancel()
        await asyncio.gather(cleaner, return_exceptions=True)
        assert not manager.jobs and not second.directory.exists()

    asyncio.run(exercise())


def test_http_body_limits_and_rate_limit(monkeypatch):
    from app import main

    with TestClient(app) as client:
        monkeypatch.setattr(main, "MAX_BYTES", 10)
        response = client.post(
            "/api/jobs",
            files={"file": ("x.wav", b"x" * 11)},
            data={"settings": Settings().model_dump_json()},
        )
        assert response.status_code == 413
        response = client.post(
            "/api/render/midi",
            content=(b"x" * 1_100_000 for _ in range(4)),
            headers={"Content-Type": "application/json"},
        )
        assert response.status_code == 413
        main.rate.clear()
        for _ in range(8):
            assert (
                client.post(
                    "/api/jobs",
                    files={"file": ("x.exe", b"x")},
                    data={"settings": Settings().model_dump_json()},
                ).status_code
                == 415
            )
        assert (
            client.post(
                "/api/jobs",
                files={"file": ("x.exe", b"x")},
                data={"settings": Settings().model_dump_json()},
            ).status_code
            == 429
        )


def test_startup_cleanup_only_removes_owned_directories():
    from app import jobs

    jobs.ROOT.mkdir()
    unrelated = jobs.ROOT / "keep-me"
    unrelated.mkdir()
    (unrelated / "notes.txt").write_text("Unrelated data")
    manager = jobs.Manager()
    job = manager.create("one")
    manager.remove_orphans()
    assert unrelated.exists() and not job.directory.exists()
