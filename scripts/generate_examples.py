"""CC0 synthetic fixtures, no third-party music or recordings."""

from pathlib import Path

import numpy as np
import soundfile as sf


def fixture(groups, seconds=0.5, sr=22050):
    chunks = [np.zeros(int(0.15 * sr))]
    for pitches in groups:
        t = np.arange(int(seconds * sr)) / sr
        envelope = np.minimum(t / 0.012, 1) * np.minimum((seconds - t) / 0.04, 1)
        y = sum(np.sin(2 * np.pi * 440 * 2 ** ((p - 69) / 12) * t) for p in pitches)
        chunks.append(y * envelope * 0.6 / max(1, len(pitches)))
        chunks.append(np.zeros(int(0.08 * sr)))
    return np.concatenate(chunks).astype(np.float32), sr


if __name__ == "__main__":
    output = Path(__file__).resolve().parents[1] / "examples"
    output.mkdir(exist_ok=True)
    cases = {
        "sustained_a4": [[69]],
        "melody": [[60], [62], [64], [67], [64], [62], [60]],
        "two_note_chord": [[60, 64]],
        "guitar_scale": [[40], [42], [44], [45], [47], [49], [51], [52]],
        "bass_riff": [[28], [28], [35], [33], [31], [28]],
        "piano_chords": [[48, 60, 64, 67], [53, 60, 65, 69], [55, 59, 62, 67]],
        "mixed_pitches": [[36, 60, 64], [38, 62, 65], [43, 67, 71]],
    }
    for name, groups in cases.items():
        y, sr = fixture(groups)
        sf.write(output / f"{name}.wav", y, sr)
    print(f"Generated {len(cases)} CC0 example recordings in {output}")
