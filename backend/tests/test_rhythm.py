import numpy as np

from app.schemas import Settings
from app.transcription import clean_quantize, estimate_grid, monophonic


def click_track(bpm, first_beat, seconds=24.0, sr=22050, accent_every=4):
    y = np.zeros(int(seconds * sr), dtype=np.float32)
    period = 60 / bpm
    t = np.arange(int(0.03 * sr)) / sr
    for i, start in enumerate(np.arange(first_beat, seconds - 0.05, period)):
        burst = np.sin(2 * np.pi * 1000 * t) * np.exp(-t * 120)
        gain = 1.0 if i % accent_every == 0 else 0.5
        s = int(start * sr)
        y[s : s + len(burst)] += gain * burst[: len(y) - s]
    return y, sr


def test_comb_grid_finds_precise_tempo_and_phase():
    y, sr = click_track(140, 0.37)
    tempo, phase = estimate_grid(y, sr)
    assert abs(tempo - 140) <= 0.2
    period = 60 / 140
    assert min(abs(phase - 0.37) % period, period - abs(phase - 0.37) % period) < 0.02


def test_fixed_tempo_still_finds_phase():
    y, sr = click_track(100, 0.2)
    tempo, phase = estimate_grid(y, sr, tempo=100)
    assert tempo == 100
    assert abs(phase - 0.2) < 0.02


def test_bar_alignment_puts_strong_notes_on_downbeat():
    spb = 60 / 120
    # Riff whose heavy root lands on the third detected beat of every bar.
    events = []
    for bar in range(4):
        root = 0.25 + (bar * 4 + 2) * spb
        events.append((root, root + spb * 1.5, 33, 120))
        events.append((root + spb * 2, root + spb * 2.4, 40, 50))
    notes = clean_quantize(
        events, 120, Settings(mode="bass", tuning=[28, 33, 38, 43]), 0.25, True
    )
    roots = [n.onset for n in notes if n.pitch == 33]
    assert all(onset % 4 == 0 for onset in roots)
    assert min(n.onset for n in notes) >= 0


def test_monophonic_removes_retriggers_octave_ghosts_and_overlaps():
    line = monophonic(
        [
            (0.00, 0.40, 45, 100),
            (0.07, 0.40, 45, 60),  # re-trigger of the sounding note
            (0.08, 0.30, 57, 50),  # octave ghost
            (0.01, 0.30, 52, 40),  # simultaneous higher pitch
            (0.30, 0.60, 47, 90),  # real next note truncates the first
        ]
    )
    assert [(s, e, p) for s, e, p, _ in line] == [(0.0, 0.3, 45), (0.3, 0.6, 47)]
