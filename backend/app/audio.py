import json
import subprocess
from pathlib import Path

import imageio_ffmpeg
import numpy as np
import soundfile as sf

EXTENSIONS = {".mp3", ".wav", ".flac", ".m4a", ".ogg"}


def decode(source: Path, output: Path, max_duration: float, start=0.0, end=None):
    """Decode only local files; cap output and reject overlong media, not silently truncate."""
    command = [
        imageio_ffmpeg.get_ffmpeg_exe(),
        "-nostdin",
        "-v",
        "error",
        "-protocol_whitelist",
        "file,pipe",
        "-format_whitelist",
        "wav,mp3,flac,mov,ogg,matroska,webm",
        "-threads",
        "1",
        "-i",
        str(source),
        "-map",
        "0:a:0",
        "-vn",
        "-ac",
        "1",
        "-ar",
        "22050",
        "-t",
        str(max_duration + 1),
        "-f",
        "wav",
        "-y",
        str(output),
    ]
    try:
        subprocess.run(command, capture_output=True, check=True, timeout=120)
        y, sr = sf.read(output, dtype="float32")
    except (subprocess.SubprocessError, RuntimeError) as exc:
        raise ValueError(
            "Audio could not be decoded. Upload a valid audio recording."
        ) from exc
    duration = len(y) / sr
    if duration > max_duration:
        raise ValueError(
            f"Recording exceeds {max_duration:g} seconds. Trim it before uploading."
        )
    if duration < 0.1 or not np.isfinite(y).all():
        raise ValueError("Audio is empty, too short, or invalid")
    if start >= duration or (end is not None and end > duration + 0.05):
        raise ValueError("Selected segment is outside the recording")
    end = min(end or duration, duration)
    y = y[int(start * sr) : int(end * sr)]
    if len(y) < sr * 0.1 or np.max(np.abs(y)) < 1e-5:
        raise ValueError("Selected audio is too short or silent")
    # Limit excessive peaks and lift quiet recordings by at most 10x.
    peak = float(np.max(np.abs(y)))
    y = y * min(10.0, 0.95 / peak)
    sf.write(output, y, sr)
    chunks = np.array_split(y, min(600, len(y)))
    peaks = [round(float(np.max(np.abs(chunk))), 4) for chunk in chunks]
    metadata = {
        "duration": duration,
        "segment_duration": len(y) / sr,
        "segment_start": start,
        "waveform": peaks,
    }
    output.with_suffix(".json").write_text(json.dumps(metadata))
    return y, sr, metadata
