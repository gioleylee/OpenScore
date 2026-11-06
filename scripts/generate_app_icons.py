"""Generate original code-drawn waveform icons; no third-party artwork."""

from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parents[1]
public = root / "frontend/public"
public.mkdir(exist_ok=True)
for size in (192, 512):
    image = Image.new("RGB", (size, size), "#111512")
    draw = ImageDraw.Draw(image)
    pad = size * 0.17
    draw.rounded_rectangle(
        (pad, pad, size - pad, size - pad), radius=size * 0.17, fill="#c2f18b"
    )
    for index, length in enumerate((0.16, 0.28, 0.42, 0.22, 0.34)):
        x = size * (0.31 + index * 0.095)
        draw.rounded_rectangle(
            (
                x - size * 0.021,
                size * (0.5 - length / 2),
                x + size * 0.021,
                size * (0.5 + length / 2),
            ),
            radius=size * 0.02,
            fill="#192811",
        )
    image.save(public / f"icon-{size}.png")
print("Generated PWA icons")
android = root / "frontend/android/app/src/main/res"
if android.exists():
    icon = Image.open(public / "icon-512.png")
    for density, size in (
        ("mdpi", 48),
        ("hdpi", 72),
        ("xhdpi", 96),
        ("xxhdpi", 144),
        ("xxxhdpi", 192),
    ):
        folder = android / f"mipmap-{density}"
        folder.mkdir(exist_ok=True)
        for name in ("ic_launcher.png", "ic_launcher_round.png"):
            icon.resize((size, size), Image.Resampling.LANCZOS).save(folder / name)
        foreground = round(size * 108 / 48)
        icon.resize((foreground, foreground), Image.Resampling.LANCZOS).save(
            folder / "ic_launcher_foreground.png"
        )
    print("Generated matching Android launcher icons")
