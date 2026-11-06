import os
import uuid
from pathlib import Path

import librosa
import numpy as np

from .schemas import MAX_NOTES, STRINGED, Note, Settings

SINGLE_LINE = ("bass", "melody", "violin")
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
                if abs(pitch - pp) in (12, 19, 24):
                    # Simultaneous octave/twelfth: an overtone or bleed of the
                    # other note. The model's stronger detection is the real one.
                    better = velocity > pv
                if better:
                    line[-1] = (ps, max(pe, end), pitch, max(pv, velocity))
                continue
            if sounding and pitch == pp and start - ps < 0.09:
                line[-1] = (ps, max(pe, end), pp, max(pv, velocity))
                continue
            if sounding and abs(pitch - pp) == 12 and start - ps < 0.12:
                continue
            if keep == "highest" and pitch < pp and end <= pe + 0.03:
                # Skyline: a lower note that starts and ends under a held
                # melody note is accompaniment or bleed, not the melody.
                continue
            if pe > start:
                line[-1] = (ps, start, pp, pv)
        line.append((start, end, pitch, velocity))
    return line


BOW_DIP_DB = float(os.environ.get("BOW_DIP_DB", "2.0"))


def bow_changes(y, sr, hop=256, prominence=None):
    """Times (s) of short level dips: bow changes or re-articulations."""
    from scipy.signal import find_peaks

    level = librosa.amplitude_to_db(
        np.maximum(librosa.feature.rms(y=y, frame_length=512, hop_length=hop)[0], 1e-5)
    )
    dips, _ = find_peaks(-level, prominence=prominence or BOW_DIP_DB, wlen=24)
    return dips * hop / sr


def merge_unarticulated(events, y, sr):
    """Join same-pitch neighbours with no bow change between them.

    Neural models re-trigger sustained notes on vibrato; a real repeated note
    on a bowed or sung line has a level dip where the new note starts.
    """
    dips = bow_changes(y, sr)
    merged = []
    for event in events:
        if merged:
            ps, pe, pp, pv = merged[-1]
            if (
                event[2] == pp
                and event[0] - pe < 0.12
                and not (len(dips) and np.min(np.abs(dips - event[0])) < 0.08)
            ):
                merged[-1] = (ps, max(pe, event[1]), pp, max(pv, event[3]))
                continue
        merged.append(event)
    return merged


def fold_slides(events, gap=0.02):
    """Fold slide remnants into the note they lead to.

    Brief notes (<100 ms) pitched between their neighbours and directly
    followed by the next note are transitions of a slide or shift.
    """
    events = list(events)
    line = []
    for k, event in enumerate(events):
        following = events[k + 1] if k + 1 < len(events) else None
        if following and event[1] - event[0] < 0.1 and following[0] - event[1] < gap:
            previous = line[-1][2] if line else event[2]
            if min(previous, following[2]) <= event[2] <= max(previous, following[2]):
                events[k + 1] = (event[0], *following[1:])
                continue
        line.append(event)
    return line


def drop_outliers(events, radius=8):
    """Remove quiet notes far from the line's local register (bleed, overtones).

    A note goes only when it is both much quieter than its neighbours and more
    than a fifth from their median pitch, so genuine leaps are kept.
    """
    kept = []
    for k, event in enumerate(events):
        around = events[max(0, k - radius) : k] + events[k + 1 : k + 1 + radius]
        if len(around) >= 4:
            level = float(np.median([e[3] for e in around]))
            centre = float(np.median([e[2] for e in around]))
            if event[3] < 0.75 * level and abs(event[2] - centre) > 7:
                continue
        kept.append(event)
    return kept


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
    if settings.mode in SINGLE_LINE:
        # One note per beat position: keep the strongest, longest candidate.
        best = {}
        for n in notes:
            current = best.get(n.onset)
            if current is None or (n.duration * n.velocity) > (
                current.duration * current.velocity
            ):
                best[n.onset] = n
        notes = sorted(best.values(), key=lambda n: n.onset)
        # A single line: a note ends when the next one starts.
        for current, following in zip(notes, notes[1:]):
            if following.onset > current.onset:
                current.duration = min(
                    current.duration, following.onset - current.onset
                )
    return notes


# Krumhansl-Kessler key profiles (major, minor), tonic first.
MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
NAMES = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]


def estimate_key(notes):
    """Return (fifths, name, confidence) from duration-weighted pitch classes."""
    histogram = np.zeros(12)
    for n in notes:
        histogram[n.pitch % 12] += n.duration
    if len(notes) < 8 or histogram.sum() == 0:
        return 0, "C major", 0.0
    best = (-2.0, 0, "major")
    for tonic in range(12):
        for name, profile in (("major", MAJOR), ("minor", MINOR)):
            r = float(np.corrcoef(histogram, np.roll(profile, tonic))[0, 1])
            if r > best[0]:
                best = (r, tonic, name)
    r, tonic, quality = best
    major_tonic = tonic if quality == "major" else (tonic + 3) % 12
    fifths = (major_tonic * 7 + 6) % 12 - 6  # -6..5: prefer flats for Gb/Eb minor
    sharps = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
    label = (sharps if fifths > 0 else NAMES)[tonic]
    return int(fifths), f"{label} {quality}", r


def circular_offset(midi):
    """Overall deviation (semitones, -0.5..0.5) of pitches from equal temperament."""
    angle = 2 * np.pi * (midi - np.round(midi))
    return float(np.angle(np.mean(np.exp(1j * angle))) / (2 * np.pi))


def tuning_offset(y, sr, limits=None, seconds=30.0):
    """Recording's tuning offset, measured with pYIN on its loudest passage.

    Robust to vibrato and bright timbres, which bias spectral-peak estimators.
    """
    hop = 512
    length = int(seconds * sr)
    if len(y) > length:
        energy = np.convolve(y.astype(np.float64) ** 2, np.ones(hop), "valid")[::hop]
        window = length // hop
        totals = np.convolve(energy, np.ones(window), "valid")
        start = int(np.argmax(totals)) * hop
        y = y[start : start + length]
    low, high = limits or (36, 96)
    f0, voiced, probability = librosa.pyin(
        y,
        sr=sr,
        fmin=librosa.midi_to_hz(max(24, low - 1)),
        fmax=librosa.midi_to_hz(min(108, high + 1)),
        frame_length=2048,
        hop_length=hop,
    )
    good = voiced & np.isfinite(f0) & (probability > 0.5)
    if good.sum() < 20:
        return 0.0
    return circular_offset(librosa.hz_to_midi(f0[good]))


def pyin_events(y, sr, settings: Settings, limits=None):
    """Monophonic notes from pYIN, robust to vibrato, slides and detuning.

    Frame pitches are corrected by the recording's overall tuning offset, then
    a note only changes when a new pitch stays more than 0.6 semitone from the
    current note for ~60 ms, so vibrato and short slide transitions stay in one
    note. Re-bowed repeated notes split where the level jumps at an onset.
    """
    hop = 256
    low, high = limits or (28, 96)
    f0, voiced, probability = librosa.pyin(
        y,
        sr=sr,
        fmin=librosa.midi_to_hz(max(24, low - 1)),
        fmax=librosa.midi_to_hz(min(108, high + 1)),
        frame_length=2048,
        hop_length=hop,
    )
    rms = librosa.feature.rms(y=y, frame_length=2048, hop_length=hop)[0][: len(f0)]
    valid = (
        voiced
        & np.isfinite(f0)
        & (probability >= settings.sensitivity)
        & (rms > max(0.003, float(rms.max()) * 0.035))
    )
    midi = librosa.hz_to_midi(np.where(valid, f0, 440.0))
    offset = 0.0
    if valid.sum() > 20:
        offset = circular_offset(midi[valid])
        midi = midi - offset
    # Short median smoothing removes single-frame octave/glitch errors.
    smooth = midi.copy()
    for i in np.flatnonzero(valid):
        window = midi[max(0, i - 2) : i + 3][valid[max(0, i - 2) : i + 3]]
        smooth[i] = np.median(window)
    # Bow changes and re-articulations show up as short dips in level.
    from scipy.signal import find_peaks

    # A short window keeps 30-50 ms bow-change dips visible.
    short = librosa.feature.rms(y=y, frame_length=512, hop_length=hop)[0]
    level = librosa.amplitude_to_db(np.maximum(short[: len(f0)], 1e-5))
    dips, _ = find_peaks(-level, prominence=5, wlen=24)
    reattacks = set(int(d) for d in dips)
    hold = 5  # frames (~58 ms) a new pitch must persist
    events, start, center, frames = [], None, 0.0, []

    def close(end):
        if start is not None and frames:
            pitch = int(np.round(np.median(frames)))
            level = float(np.mean(rms[start:end])) / max(float(rms.max()), 1e-6)
            if low <= pitch <= high:
                events.append(
                    (
                        start * hop / sr,
                        end * hop / sr,
                        pitch,
                        int(np.clip(level * 110, 20, 120)),
                    )
                )

    i, n = 0, len(midi)
    leave = None  # first frame of the current drift away from the note
    gap, sustain = None, 0.0  # loud low-confidence gap (a fast slide), if any
    while i < n:
        if not valid[i]:
            if start is not None:
                sustain = float(np.mean(rms[max(start, i - 6) : i]))
                close(i)
                gap = i
            if gap is not None and (rms[i] < sustain * 0.5 or i - gap > 12):
                gap = None  # real silence or a long gap: not a slide
            start, frames, leave = None, [], None
            i += 1
            continue
        if start is None:
            start, center, frames = i, round(float(smooth[i])), [float(midi[i])]
            if gap is not None:
                # The note began during the slide that pYIN could not track.
                frames = [float(center)] * (i - gap) + frames
                start = gap
            gap, leave = None, None
            i += 1
            continue
        drift = abs(smooth[i] - center)
        leave = (leave if leave is not None else i) if drift > 0.3 else None
        if drift > 0.6:
            run = i
            target = round(float(smooth[i]))
            while (
                run < n
                and valid[run]
                and round(float(smooth[run])) == target
                and run - i < hold
            ):
                run += 1
            if run - i >= hold:
                # A real pitch change: the new note starts where the slide began.
                split = leave if leave is not None and leave > start + 2 else i
                frames = frames[: split - start]
                close(split)
                start, center, frames, leave = split, target, [], None
                frames.extend(float(target) for _ in range(i - split))
            else:
                # Vibrato or slide transition: keep the current note.
                frames.append(float(center))
                i += 1
                continue
        elif i in reattacks and i - start >= hold:
            close(i)
            start, frames, leave = i, [], None
        frames.append(float(midi[i]) if abs(midi[i] - center) <= 0.6 else float(center))
        i += 1
    close(n)
    line = fold_slides(events)
    return line, offset


def pitch_range(settings: Settings):
    """Playable MIDI range for fretted modes; None for unrestricted modes."""
    if settings.mode in STRINGED:
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
        # Basic Pitch assumes A = 440 Hz. Resample detuned recordings so notes
        # land on the right semitone, then scale times back.
        detune = tuning_offset(y, sr, limits)
        ratio = 1.0
        if abs(detune) >= 0.1:
            import soundfile as sf

            ratio = 2 ** (detune / 12)
            tuned = Path(path).with_name("tuned.wav")
            sf.write(
                tuned, librosa.resample(y, orig_sr=sr, target_sr=round(sr * ratio)), sr
            )
            path = tuned
            warnings.append(
                f"The recording is tuned {detune * 100:+.0f} cents from A = 440 Hz; notes were corrected to the nearest pitch."
            )
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
        if ratio != 1.0:
            Path(path).unlink(missing_ok=True)
        events = [
            (a / ratio, b / ratio, p, round(v * 127)) for a, b, p, v, _ in detected
        ]
        if settings.mode == "bass":
            events = monophonic(events, "lowest")
        elif settings.mode in ("melody", "violin"):
            line = fold_slides(monophonic(events, "highest"), gap=0.06)
            events = drop_outliers(merge_unarticulated(line, y, sr))
            warnings.append(
                "Basic Pitch output was reduced to its highest line. Use pYIN for a clean solo recording."
            )
    else:
        stage("Tracking monophonic pitch with pYIN")
        events, detune = pyin_events(y, sr, settings, limits)
        if abs(detune) >= 0.1:
            warnings.append(
                f"The recording is tuned {detune * 100:+.0f} cents from A = 440 Hz; notes were corrected to the nearest pitch."
            )
        warnings.append(
            "pYIN follows one pitch at a time. Vibrato and slides are kept within a note; double stops and chords need Basic Pitch."
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


def key_signature(notes, warnings):
    """Estimate the key signature; keep C when the evidence is weak."""
    fifths, name, confidence = estimate_key(notes)
    if confidence < 0.6:
        warnings.append(
            "Key signature left at C: the key was unclear. Set it manually."
        )
        return 0
    warnings.append(
        f"Key signature {name} was estimated from the notes; change it if needed."
    )
    return fifths
