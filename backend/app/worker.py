"""Executed in a disposable child process so cancellation actually stops inference."""
import json
import os
import sys
import traceback
from pathlib import Path


def run(directory):
    directory = Path(directory)
    os.environ.setdefault("OMP_NUM_THREADS", "1")
    os.environ.setdefault("TF_NUM_INTRAOP_THREADS", "1")
    os.environ.setdefault("TF_NUM_INTEROP_THREADS", "1")
    os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")

    def stage(message):
        tmp = directory / "stage.tmp"
        tmp.write_text(message)
        tmp.replace(directory / "stage.txt")

    try:
        from .audio import decode
        from .schemas import Score, Settings
        from .tablature import optimize
        from .transcription import transcribe
        settings = Settings.model_validate_json((directory / "settings.json").read_text())
        stage("Decoding and validating audio")
        y, sr, metadata = decode(directory / "upload", directory / "audio.wav",
                                 float(os.environ.get("MAX_DURATION", "120")), settings.start, settings.end)
        notes, tempo, warnings = transcribe(directory / "audio.wav", y, sr, settings, stage)
        if settings.mode in ("guitar", "bass"):
            stage("Optimizing playable tablature")
            warnings.extend(optimize(notes, settings))
        if settings.mode == "piano":
            warnings.append("Piano staves are split at middle C for readability, not inferred hand assignments.")
        score = Score(title=(directory / "title.txt").read_text(), tempo=tempo,
                      settings=settings, notes=notes, warnings=warnings)
        (directory / "result.json").write_text(json.dumps({"score": score.model_dump(), "audio": metadata}))
        # The original compressed upload is no longer needed. Segment WAV expires with job.
        (directory / "upload").unlink(missing_ok=True)
        stage("Ready")
        return 0
    except Exception as exc:
        traceback.print_exc()
        # Only expected validation errors are exposed to visitors.
        message = str(exc) if isinstance(exc, ValueError) else "Processing failed. Check server logs and model installation."
        (directory / "error.txt").write_text(message[:1000])
        return 1


if __name__ == "__main__":
    sys.exit(run(sys.argv[1]))
