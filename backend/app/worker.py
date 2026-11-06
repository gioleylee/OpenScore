"""Executed in a disposable child process so cancellation actually stops inference."""

import json
import os
import sys
import traceback
from pathlib import Path


def run(directory):
    directory = Path(directory)
    os.environ.setdefault("OMP_NUM_THREADS", "1")
    os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")
    os.environ.setdefault("MKL_NUM_THREADS", "1")
    os.environ.setdefault("TF_NUM_INTRAOP_THREADS", "1")
    os.environ.setdefault("TF_NUM_INTEROP_THREADS", "1")
    os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")

    def stage(message):
        tmp = directory / "stage.tmp"
        tmp.write_text(message)
        tmp.replace(directory / "stage.txt")

    try:
        from .audio import decode
        from .schemas import STRINGED, Score, Settings
        from .tablature import optimize
        from .transcription import key_signature, transcribe

        settings = Settings.model_validate_json(
            (directory / "settings.json").read_text()
        )
        max_duration = float(os.environ.get("MAX_DURATION", "480"))
        source = directory / "source.json"
        if source.exists():
            from .sources import download

            stage("Downloading audio from YouTube")
            title = download(
                json.loads(source.read_text())["url"],
                directory,
                max_duration,
                int(os.environ.get("MAX_UPLOAD_MB", "50")) * 1024 * 1024,
            )
            (directory / "title.txt").write_text(title)
        stage("Decoding and validating audio")
        y, sr, metadata = decode(
            directory / "upload",
            directory / "audio.wav",
            max_duration,
            settings.start,
            settings.end,
        )
        mix = y
        if settings.separate != "none":
            import soundfile as sf

            from .separation import isolate

            stage(f"Isolating the {settings.separate} part from the mix (Demucs)")
            y = isolate(y, sr, settings.separate)
            detection_audio = directory / "stem.wav"
            sf.write(detection_audio, y, sr)
        else:
            detection_audio = directory / "audio.wav"
        notes, tempo, warnings = transcribe(
            detection_audio, y, sr, settings, stage, rhythm=mix
        )
        if settings.mode in STRINGED:
            stage("Optimizing playable tablature")
            warnings.extend(optimize(notes, settings))
        if settings.separate != "none":
            warnings.append(
                f"Notes were detected on an AI-isolated {settings.separate} stem. Bleed from other instruments can add stray notes. The comparison player plays the original mix."
            )
        if settings.mode == "piano":
            warnings.append(
                "Piano staves are split at middle C for readability, not inferred hand assignments."
            )
        score = Score(
            title=(directory / "title.txt").read_text(),
            tempo=tempo,
            key=key_signature(notes, warnings),
            settings=settings,
            notes=notes,
            warnings=warnings,
        )
        (directory / "result.json").write_text(
            json.dumps({"score": score.model_dump(), "audio": metadata})
        )
        # The original compressed upload is no longer needed. Segment WAV expires with job.
        (directory / "upload").unlink(missing_ok=True)
        (directory / "stem.wav").unlink(missing_ok=True)
        stage("Ready")
        return 0
    except Exception as exc:
        traceback.print_exc()
        # Only expected validation errors are exposed to visitors.
        message = (
            str(exc)
            if isinstance(exc, ValueError)
            else "Processing failed. Check server logs and model installation."
        )
        (directory / "error.txt").write_text(message[:1000])
        return 1


if __name__ == "__main__":
    sys.exit(run(sys.argv[1]))
