import uuid
from pathlib import Path

import librosa
import numpy as np

from .schemas import MAX_NOTES, Note, Settings


def clean_quantize(events, tempo, settings: Settings):
    """Convert measured seconds to beat events. No generated/fill-in pitches."""
    result = {}
    for start, end, pitch, velocity in events:
        if end - start < settings.min_duration:
            continue
        onset = max(0, round(start * tempo / 60 / settings.grid) * settings.grid)
        duration = max(
            settings.grid,
            round((end - start) * tempo / 60 / settings.grid) * settings.grid,
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
    return notes


def transcribe(path, y, sr, settings: Settings, stage):
    stage("Estimating beat grid")
    tempo = settings.tempo
    warnings = [
        "Automatic transcription needs review, especially for mixed recordings.",
        "Key defaults to C / A minor. Set the key manually; no reliable key inference is claimed.",
        "Beat zero is the segment start. Pickup notes and beat alignment may need editing.",
    ]
    if tempo is None:
        estimate, beats = librosa.beat.beat_track(y=y, sr=sr)
        tempo = round(float(np.asarray(estimate).ravel()[0]), 1)
        if not 30 <= tempo <= 300 or len(beats) < 2:
            tempo = 120.0
            warnings.append(
                "Too few beats to estimate tempo; 120 BPM is an editable default."
            )
        else:
            warnings.append("Tempo is a beat-tracker estimate; confirm it by ear.")
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
        _, _, detected = predict(
            str(path),
            model_path,
            onset_threshold=settings.sensitivity,
            frame_threshold=settings.sensitivity,
            minimum_note_length=settings.min_duration * 1000,
            multiple_pitch_bends=False,
        )
        events = [(a, b, p, round(v * 127)) for a, b, p, v, _ in detected]
        if settings.mode == "melody":
            warnings.append(
                "Basic Pitch detects polyphonic notes, not a main melody. Use pYIN for isolated monophonic lines."
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
            "pYIN follows one pitch at a time. It does not isolate the lead from a full band or detect chords."
        )
    stage("Cleaning notes and quantizing rhythms")
    notes = clean_quantize(events, tempo, settings)
    if not notes:
        raise ValueError(
            "No stable notes detected. Try an isolated instrument, lower the detection threshold, or choose Basic Pitch for chords."
        )
    if len(notes) > MAX_NOTES:
        raise ValueError("Too many notes detected; choose a shorter segment")
    return notes, tempo, warnings
