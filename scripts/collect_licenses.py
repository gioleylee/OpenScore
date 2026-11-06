"""Capture installed dependency notices for the release environment, without vendoring code."""

import hashlib
import importlib.metadata as md
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def collect():
    entries, notices = [], []
    for dist in sorted(md.distributions(), key=lambda d: d.metadata.get("Name", "")):
        name = dist.metadata.get("Name", "unknown")
        license_id = (
            dist.metadata.get("License-Expression")
            or dist.metadata.get("License")
            or "See upstream"
        )
        license_id = license_id[:200]
        license_files = [
            f
            for f in (dist.files or [])
            if ".dist-info/" in str(f)
            and any(p in f.name.lower() for p in ("license", "copying", "notice"))
        ]
        texts = []
        for f in license_files:
            path = dist.locate_file(f)
            if path.is_file() and path.stat().st_size < 1_000_000:
                texts.append(path.read_text(encoding="utf-8", errors="replace"))
        entries.append(
            {
                "ecosystem": "python",
                "name": name,
                "version": dist.version,
                "license": license_id,
                "notice_files": len(texts),
            }
        )
        notices.append(
            f"\n{'=' * 72}\n{name} {dist.version}\nLicense: {license_id}\n"
            + "\n".join(texts)
        )
        if name.lower() == "basic-pitch":
            directory = ROOT / "docs/licenses"
            directory.mkdir(parents=True, exist_ok=True)
            if texts:
                (directory / "basic-pitch-LICENSE.txt").write_text(
                    texts[0], encoding="utf-8"
                )
            model = Path(
                dist.locate_file("basic_pitch/saved_models/icassp_2022/nmp.tflite")
            )
            entries.append(
                {
                    "ecosystem": "model",
                    "name": "Spotify Basic Pitch ICASSP 2022 TFLite",
                    "sha256": hashlib.sha256(model.read_bytes()).hexdigest(),
                    "license": "Apache-2.0",
                }
            )
    lock = json.loads((ROOT / "frontend/package-lock.json").read_text())
    for location, item in lock.get("packages", {}).items():
        if not location:
            continue
        name = item.get("name") or location.split("node_modules/")[-1]
        texts = []
        folder = ROOT / "frontend" / location
        if folder.exists():
            for path in folder.iterdir():
                if path.is_file() and path.name.lower().startswith(
                    ("license", "notice", "copying")
                ):
                    texts.append(path.read_text(encoding="utf-8", errors="replace"))
        entries.append(
            {
                "ecosystem": "npm",
                "name": name,
                "version": item.get("version"),
                "license": item.get("license", "See upstream"),
                "notice_files": len(texts),
                "optional": item.get("optional", False),
            }
        )
        if texts:
            notices.append(
                f"\n{'=' * 72}\n{name} {item.get('version')}\n" + "\n".join(texts)
            )
    (ROOT / "docs/license-inventory.json").write_text(
        json.dumps(entries, indent=2), encoding="utf-8"
    )
    (ROOT / "docs/THIRD_PARTY_LICENSES.txt").write_text(
        "Installed dependency notices; regenerate for your target release.\n"
        + "\n".join(notices),
        encoding="utf-8",
    )
    public = ROOT / "frontend/public"
    public.mkdir(exist_ok=True)
    (public / "third-party-notices.txt").write_text(
        (ROOT / "LICENSE").read_text(encoding="utf-8")
        + "\nNative Android runtime: AndroidX (The Android Open Source Project contributors) and Kotlin (JetBrains contributors) are Apache-2.0 licensed. Capacitor and official plugins are MIT licensed. Android SDK/JDK/Gradle build tools are not bundled in the APK. See docs/ANDROID.md and upstream dependency notices.\n"
        + (ROOT / "docs/THIRD_PARTY_LICENSES.txt").read_text(encoding="utf-8"),
        encoding="utf-8",
    )
    print(
        f"Recorded {len(entries)} dependency/platform entries and their available notices"
    )


if __name__ == "__main__":
    collect()
