import re

import numpy as np
import pytest
from pydantic import ValidationError

from app.notation import musicxml, violin_finger
from app.schemas import Note, Score, Settings
from app.tablature import optimize
from app.transcription import estimate_key, transcribe

VIOLIN = dict(mode="violin", instrument="Violin", tuning=[55, 62, 69, 76], max_fret=12)
# Twinkle Twinkle in A major, quarter notes at 100 BPM; 0 = rest-free half note.
TWINKLE = [69, 69, 76, 76, 78, 78, 76, 76, 74, 74, 73, 73, 71, 71, 69, 69]


def bowed(pitches, beat=0.6, sr=22050, detune_cents=30, vibrato_cents=45):
    """Sawtooth-like bowed tone: vibrato, glides between notes, bow-change dips."""
    total = int(len(pitches) * beat * sr)
    t = np.arange(total) / sr
    index = np.minimum((t / beat).astype(int), len(pitches) - 1)
    target = np.array(pitches, dtype=float)[index]
    glide = int(0.08 * sr)
    curve = target.copy()
    for k in range(1, len(pitches)):
        s = int(k * beat * sr)
        if pitches[k] != pitches[k - 1]:
            curve[s : s + glide] = np.linspace(pitches[k - 1], pitches[k], glide)
    curve += detune_cents / 100 + vibrato_cents / 100 * np.sin(
        2 * np.pi * 6 * t
    ) * np.minimum((t % beat) / 0.15, 1)
    phase = 2 * np.pi * np.cumsum(440 * 2 ** ((curve - 69) / 12)) / sr
    y = sum(np.sin(h * phase) / h for h in range(1, 9))
    position = t % beat
    envelope = np.clip(position / 0.03, 0.3, 1) * np.where(
        position > beat - 0.04, 0.3, 1
    )
    return (0.3 * y * envelope).astype(np.float32), sr


def test_vibrato_slides_and_detuning_give_clean_notes(tmp_path):
    y, sr = bowed(TWINKLE)
    notes, tempo, warnings = transcribe(
        tmp_path / "x.wav", y, sr, Settings(**VIOLIN, tempo=100), lambda _: None
    )
    assert [n.pitch for n in notes] == TWINKLE
    assert [n.onset for n in notes] == list(range(len(TWINKLE)))
    measured = [
        int(m) for w in warnings for m in re.findall(r"tuned ([+-]\d+) cents", w)
    ]
    assert measured and abs(measured[0] - 30) <= 5


def test_key_detection_for_violin_keys():
    def notes(pitches):
        return [
            Note(id=str(i), pitch=p, onset=i, duration=1) for i, p in enumerate(pitches)
        ]

    assert estimate_key(notes(TWINKLE * 2))[:2] == (3, "A major")
    d_minor = [62, 64, 65, 67, 69, 70, 73, 74, 69, 65, 62, 69, 74, 70, 69, 62]
    assert estimate_key(notes(d_minor))[0] == -1


def test_violin_fingering_stays_in_first_position():
    settings = Settings(**VIOLIN)
    notes = [
        Note(id=str(i), pitch=p, onset=i, duration=1) for i, p in enumerate(TWINKLE)
    ]
    optimize(notes, settings)
    # Standard first-position fingering: A open, E open, F# 1, D 3 on A, C# 2, B 1.
    fingers = [violin_finger(n.fret) for n in notes]
    assert fingers == [0, 0, 0, 0, 1, 1, 0, 0, 3, 3, 2, 2, 1, 1, 0, 0]
    assert [n.string for n in notes][:4] == [2, 2, 1, 1]
    score = Score(tempo=100, key=3, settings=settings, notes=notes)
    xml = musicxml(score).decode()
    assert re.search(r"<fingering[^>]*>3</fingering>", xml)
    assert "<string>" not in xml
    assert b"<staff-lines>4</staff-lines>" in musicxml(score, "tab")


def test_violin_high_positions_and_validation():
    assert [violin_finger(s) for s in (0, 1, 2, 4, 5, 7, 8, 9, 12)] == [
        0,
        1,
        1,
        2,
        3,
        4,
        3,
        3,
        3,
    ]
    with pytest.raises(ValidationError):
        Settings(mode="violin", tuning=[40, 45, 50, 55, 59, 64])
