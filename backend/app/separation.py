"""Optional source separation with Demucs (htdemucs_6s).

Isolating one stem from a full mix before pitch detection is what makes
transcribing a specific instrument from a complete song practical. The model
weights (~80 MB, MIT) are downloaded by Demucs on first use and cached.
"""

import importlib.util
import os

import numpy as np

STEMS = ("vocals", "bass", "guitar", "piano", "other")
MODEL = os.environ.get("DEMUCS_MODEL", "htdemucs_6s")


def available():
    return (
        os.environ.get("ENABLE_SEPARATION", "1") != "0"
        and importlib.util.find_spec("demucs") is not None
    )


def isolate(y: np.ndarray, sr: int, stem: str) -> np.ndarray:
    if stem not in STEMS:
        raise ValueError("Unknown stem")
    if not available():
        raise ValueError(
            "Instrument isolation is not installed on this server. Install backend/requirements-separation.txt or turn isolation off."
        )
    import librosa
    import torch
    from demucs.apply import apply_model
    from demucs.pretrained import get_model

    torch.set_num_threads(max(1, int(os.environ.get("SEPARATION_THREADS", "2"))))
    model = get_model(MODEL)
    model.eval()
    if stem not in model.sources:
        raise ValueError(f"The separation model has no '{stem}' stem")
    audio = librosa.resample(y, orig_sr=sr, target_sr=model.samplerate)
    wav = torch.from_numpy(np.stack([audio, audio])).float()
    reference = wav.mean(0)
    mean, std = reference.mean(), reference.std() + 1e-8
    wav = (wav - mean) / std
    with torch.no_grad():
        sources = apply_model(
            model, wav[None], device="cpu", split=True, overlap=0.25, progress=False
        )[0]
    sources = sources * std + mean
    isolated = sources[model.sources.index(stem)].mean(0).numpy()
    isolated = librosa.resample(isolated, orig_sr=model.samplerate, target_sr=sr)
    isolated = isolated[: len(y)]
    peak = float(np.max(np.abs(isolated))) if len(isolated) else 0.0
    if peak < 1e-4:
        raise ValueError(
            f"No audible {stem} was found in this recording. Choose another instrument stem or turn isolation off."
        )
    return (isolated * (0.95 / peak)).astype(np.float32)
