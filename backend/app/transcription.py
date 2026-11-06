import uuid
from pathlib import Path

import librosa
import numpy as np

from .schemas import MAX_NOTES, Note, Settings

# Below this length a whole-song comb search has too few beats to be reliable.
COMB_MIN_SECONDS = 16.0


def estimate_grid(y, sr, tempo=None, low=76.0, high=184.0):
    """Return (tempo, first beat time) for a steady-tempo recording.

    A comb filter over the whole onset envelope scores every tempo in 0.05 BPM
    steps at every phase. Long, steady songs give a far more precise tempo and
    beat phase than frame-local beat tracking, which drifts on busy mixes.
    The search range keeps results in conventional notation tempos.
    """
    hop = 128
    env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop)
    env = np.maximum(env - np.median(env), 0)
    fps = sr / hop
    n = len(env)
    best = (-1.0, tempo or 120.0, 0.0)
    for bpm in [tempo] if tempo else np.arange(low, high, 0.05):
        period = 60.0 * fps / bpm
        if n < period * 4:
            continue
        beats = np.arange(0, n - period, period)
        phases = np.arange(0, period, 1.0)
        scores = env[(beats[None, :] + phases[:, None]).astype(int)].mean(1)
        k = int(np.argmax(scores))
        if scores[k] > best[0]:
            best = (float(scores[k]), float(bpm), float(phases[k] / fps))
    return round(best[1], 1), best[2]


def monophonic(events, keep="lowest"):
    """Reduce polyphonic detections to one line (bass or melody).

    Removes re-triggers of the same pitch and octave ghosts, which neural
    models commonly report on isolated bass, then trims overlaps.
    """
    line = []
    for start, end, pitch, velocity in sorted(events, key=lambda e: (e[0], e[2])):
        if line:
            ps, pe, pp, pv = line[-1]
            sounding = pe > start - 0.02
            if start - ps < 0.05:
                better = pitch < pp if keep == "lowest" else pitch > pp
                if better:
                    line[-1] = (ps, max(pe, end), pitch, max(pv, velocity))
                continue
            if sounding and pitch == pp and start - ps < 0.09:
                line[-1] = (ps, max(pe, end), pp, max(pv, velocity))
                continue
            if sounding and abs(pitch - pp) == 12 and start - ps < 0.12:
                continue
            if pe > start:
                line[-1] = (ps, start, pp, pv)
        line.append((start, end, pitch, velocity))
    return line


def clean_quantize(events, tempo, settings: Settings, offset=0.0, align_bars=False):
    """Convert measured seconds to beat events. No generated/fill-in pitches.

    offset is the time of a beat. With align_bars, the bar line is placed on the
    beat (of the meter) that carries the most note weight, and beat zero moves
    back by whole bars so no note starts before it.
    """
    spb = 60 / tempo
    beats_per_bar = settings.numerator * 4 / settings.denominator
    kept = [e for e in events if e[1] - e[0] >= settings.min_duration]
    if align_bars and kept:
        weight = np.zeros(int(round(beats_per_bar)) or 1)
        for start, end, _, velocity in kept:
            position = (start - offset) / spb
            nearest = round(position)
            if abs(position - nearest) < 0.15:
                weight[nearest % len(weight)] += velocity * min(end - start, 1.0)
        offset += int(np.argmax(weight)) * spb
        first = min(e[0] for e in kept)
        bar = beats_per_bar * spb
        offset -= (
            np.ceil(max(0.0, offset - first + spb * settings.grid / 2) / bar) * bar
        )
    result = {}
    for start, end, pitch, velocity in kept:
        onset = max(0, round((start - offset) / spb / settings.grid) * settings.grid)
        duration = max(
            settings.grid,
            round((end - start) / spb / settings.grid) * settings.grid,
        )
        k = (int(pitch), onset)
        note = Note(
            id=uuid.uuid4().hex,
            pitch=int(pitch),
            onset=onset,
            duration=duration,
            velocity=max(1, min(127, int(velocity))),
        )
        if k not in result or duration > result[k].duration:
            result[k] = note
    notes = sorted(result.values(), key=lambda n: (n.onset, n.pitch))
    # Repeated pitches cannot sustain through their next attack in MIDI.
    for i, n in enumerate(notes):
        following = next((x for x in notes[i + 1 :] if x.pitch == n.pitch), None)
        if following:
            n.duration = min(n.duration, following.onset - n.onset)
    if settings.mode in ("bass", "melody"):
        # A single line: a note ends when the next one starts.
        for current, following in zip(notes, notes[1:]):
            if following.onset > current.onset:
                current.duration = min(
                    current.duration, following.onset - current.onset
                )
    return notes


def pitch_range(settings: Settings):
    """Playable MIDI range for fretted modes; None for unrestricted modes."""
    if settings.mode in ("guitar", "bass", "ukulele"):
        low = min(settings.tuning) + settings.capo + settings.min_fret
        high = max(settings.tuning) + settings.capo + settings.max_fret
        return low, high
    return None


def transcribe(path, y, sr, settings: Settings, stage, rhythm=None):
    """Detect notes in y. rhythm is the full mix used for tempo when y is a stem."""
    stage("Estimating tempo and beat grid")
    rhythm = y if rhythm is None else rhythm
    tempo = settings.tempo
    offset, aligned = 0.0, False
    warnings = [
        "Automatic transcription needs review, especially for mixed recordings.",
        "Key defaults to C / A minor. Set the key manually; no reliable key inference is claimed.",
    ]
    if len(rhythm) / sr >= COMB_MIN_SECONDS:
        tempo, offset = estimate_grid(rhythm, sr, tempo)
        aligned = True
        warnings.append(
            "Bar lines follow the strongest detected beat. If the first bar looks shifted, move notes or adjust the segment start."
        )
    else:
        warnings.append(
            "Beat zero is the segment start. Pickup notes and beat alignment may need editing."
        )
    if tempo is None:
        estimate, beats = librosa.beat.beat_track(y=rhythm, sr=sr)
        tempo = float(np.asarray(estimate).ravel()[0])
        if not 30 <= tempo <= 300 or len(beats) < 2:
            tempo = 120.0
            warnings.append(
                "Too few beats to estimate tempo; 120 BPM is an editable default."
            )
        else:
            tempo = round(tempo, 1)
    if settings.tempo is None:
        warnings.append(f"Tempo {tempo:g} BPM was estimated; confirm it by ear.")
    limits = pitch_range(settings)
    if settings.engine == "basic_pitch":
        stage("Running Basic Pitch polyphonic model")
        try:
            import basic_pitch
            from basic_pitch.inference import predict
        except ImportError as exc:
            raise ValueError(
                "Basic Pitch is not installed. Install backend/requirements-ai.txt using Python 3.11, or select Melody / pYIN."
            ) from exc
        # TFLite avoids Keras SavedModel deserialization incompatibilities and
        # ships in the same upstream wheel; TensorFlow supplies its CPU runtime.
        model_path = (
            Path(basic_pitch.__file__).parent / "saved_models/icassp_2022/nmp.tflite"
        )
        bounds = {}
        if limits:
            # Half a semitone of margin keeps slightly flat/sharp notes.
            bounds = {
                "minimum_frequency": float(librosa.midi_to_hz(limits[0] - 0.5)),
                "maximum_frequency": float(librosa.midi_to_hz(limits[1] + 0.5)),
            }
        _, _, detected = predict(
            str(path),
            model_path,
            # Upstream defaults keep note starts stricter than sustains (0.5/0.3).
            onset_threshold=min(0.9, settings.sensitivity + 0.2),
            frame_threshold=settings.sensitivity,
            minimum_note_length=settings.min_duration * 1000,
            multiple_pitch_bends=False,
            **bounds,
        )
        events = [(a, b, p, round(v * 127)) for a, b, p, v, _ in detected]
        if settings.mode == "bass":
            events = monophonic(events, "lowest")
        elif settings.mode == "melody":
            events = monophonic(events, "highest")
            warnings.append(
                "Basic Pitch output was reduced to its highest line. Use pYIN for a clean solo recording."
            )
    else:
        stage("Tracking monophonic pitch with pYIN")
        hop = 256
        f0, voiced, probability = librosa.pyin(
            y,
            sr=sr,
            fmin=librosa.midi_to_hz(28),
            fmax=librosa.midi_to_hz(96),
            frame_length=2048,
            hop_length=hop,
        )
        rms = librosa.feature.rms(y=y, frame_length=2048, hop_length=hop)[0]
        pitches = np.where(
            np.isfinite(f0), np.rint(librosa.hz_to_midi(np.nan_to_num(f0, nan=440))), -1
        ).astype(int)
        valid = (
            voiced
            & (probability >= settings.sensitivity)
            & (rms > max(0.003, float(rms.max()) * 0.035))
        )
        pitches[~valid] = -1
        events, active, first = [], -1, 0
        for i in range(len(pitches) + 1):
            pitch = int(pitches[i]) if i < len(pitches) else -1
            if pitch != active:
                if active >= 0:
                    velocity = int(
                        np.clip(
                            np.mean(rms[first:i]) / max(rms.max(), 1e-6) * 110, 20, 120
                        )
                    )
                    events.append(
                        (
                            first * hop / sr,
                            min(i * hop / sr, len(y) / sr),
                            active,
                            velocity,
                        )
                    )
                active, first = pitch, i
        warnings.append(
            "pYIN follows one pitch at a time and can miss quick repeated notes. Basic Pitch is usually more complete for bass and band recordings."
        )
    stage("Cleaning notes and quantizing rhythms")
    notes = clean_quantize(events, tempo, settings, offset, aligned)
    if not notes:
        raise ValueError(
            "No stable notes detected. Try an isolated instrument, lower the detection threshold, or choose Basic Pitch for chords."
        )
    if len(notes) > MAX_NOTES:
        raise ValueError("Too many notes detected; choose a shorter segment")
    return notes, tempo, warnings
