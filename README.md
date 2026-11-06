# OpenScore AI

Get sheet music and tabs for the instrument you play, from almost any song. Upload an audio file, paste a YouTube link, or just type the song's name. OpenScore AI finds the audio, can isolate your instrument from the full band, detects the notes, and gives you editable sheet music and guitar/bass/ukulele tablature that you can play back, practice with, and export as MIDI, MusicXML, PDF or ASCII tab. You don't need an account, a paid API, or to train a model.

**Inputs:** an audio file (MP3/WAV/FLAC/M4A/OGG), a YouTube link, or a song name (search, then pick the right video).

**Outputs:** standard notation for melody instruments (voice, violin, flute, sax, trumpet, ...), a two-staff piano score, or guitar, bass and ukulele tabs with playable fingerings.

**How it works:** [yt-dlp](https://github.com/yt-dlp/yt-dlp) fetches audio from YouTube. [Demucs](https://github.com/facebookresearch/demucs) (`htdemucs_6s`) optionally isolates vocals, guitar, bass, piano or other instruments from the mix. [Basic Pitch](https://github.com/spotify/basic-pitch) (polyphonic) or pYIN (single line) detects the notes. A beam-search fingering optimizer then writes playable tabs.

**On accuracy:** automatic transcription gives you a strong first draft, not a perfect publisher's score. Results are best for clear recordings and for parts that stand out in the mix. Dense arrangements, heavy distortion, and instruments that Demucs can't separate (for example, two guitars) need more editing. Use the built-in editor to fix notes, rhythms and fingerings. See [feature status](docs/FEATURES.md).

**Copyright:** only transcribe audio you have the right to use. Downloading from YouTube may be restricted by YouTube's Terms of Service in your country. Use the feature for personal practice, and set `ENABLE_ONLINE_SOURCES=0` on any public deployment where you can't take on that responsibility.

**Website + Android:** one shared React/TypeScript frontend now builds an installable PWA and a Capacitor Android APK. Saved scores support offline viewing, editing, fingering, synth practice and exports. New transcriptions, YouTube links and song search need the Python server (point the app at it under **Connection settings**); offline Android AI inference is not implemented. See [Android build, installation, signing and releases](docs/ANDROID.md).

```sh
cd frontend
npm ci --ignore-scripts
npm run android:debug
```

Android builds require JDK 21 and Android SDK 36. The installable debug APK is copied to `artifacts/openscore-ai-debug.apk`. A debug APK was built and signature-verified locally; no Android device was connected for runtime QA. `.github/workflows/android.yml` also produces APK artifacts and signed GitHub Releases after you configure signing secrets and push an `android-v*` tag.

## Quick start with Docker

Install Docker Desktop (Windows/macOS) or Docker Engine + Compose (Linux), then run from this directory:

```sh
docker compose up --build
```

Open **http://localhost:8080**. Both servers, Basic Pitch, yt-dlp (with the Deno runtime) and the Demucs weights are included in the build. The first build downloads several hundred MB of Python packages. Allow about 4 GB available host RAM and several GB of disk for image layers. CPU inference is the default. `docker compose down` stops everything; audio is held in a bounded temporary filesystem, not a persistent volume.

Docker configuration is supplied but was not executed in the initial Windows development environment (Docker was unavailable). Native Python inference, exports and frontend build were tested. CI checks Linux compatibility.

## Native development

Use **Python 3.11** and **Node 22.12+ or 24 LTS**. Python 3.13 is not supported by Basic Pitch 0.4.0. You do not need a system FFmpeg: `imageio-ffmpeg` installs a platform binary. Docker uses the distribution FFmpeg instead.

Windows PowerShell:

```powershell
python3.11 -m venv .venv
.venv\Scripts\python.exe -m pip install -r backend/requirements-ai.txt
cd backend
..\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

If your Python 3.11 launcher is `py`, use `py -3.11 -m venv .venv`. If you use uv: `uv venv --python 3.11 .venv`, then `uv pip install --python .venv/Scripts/python.exe -r backend/requirements-ai.txt`.

macOS/Linux:

```sh
python3.11 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements-ai.txt
cd backend
../.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

In a second terminal, from the repository root:

```sh
cd frontend
npm ci --ignore-scripts
npm run dev
```

Open **http://127.0.0.1:5173**. Vite proxies `/api` to port 8000. The `--ignore-scripts` option skips unused headless OpenGL native builds; the browser SVG renderer needs none of them. Vite uses its platform-specific esbuild package.

**YouTube links, song search and instrument isolation** need two optional dependency sets. Node.js 20+ or Deno must be on `PATH` for yt-dlp:

```sh
uv pip install --python .venv/Scripts/python.exe -r backend/requirements-online.txt
uv pip install --python .venv/Scripts/python.exe --index-url https://download.pytorch.org/whl/cpu --extra-index-url https://pypi.org/simple -r backend/requirements-separation.txt
```

YouTube changes often. If downloads fail with HTTP 403, update yt-dlp: `pip install -U "yt-dlp[default]"`. The first isolation run downloads the ~80 MB Demucs weights.

For a smaller melody-only installation, install `backend/requirements.txt` instead. pYIN performs actual monophonic pitch detection without neural weights. Piano polyphony requires the AI requirements; the UI disables Basic Pitch if it is absent. No inference is simulated.

### First transcription

1. Choose a source. **Upload file:** use `examples/melody.wav` or your own audio. **YouTube link:** paste a video URL. **Search song:** type the title and artist, then pick a result. Optionally enter start/end seconds to transcribe one section. For online songs, **Isolate instrument from a full mix** defaults to the part that matches your instrument.
2. Choose **Guitar**, pYIN, and optionally set tempo to 120 in fine-tune settings. Use Basic Pitch for chords; use pYIN for an isolated line.
3. Click **Transcribe recording**. Progress shows actual stages without fabricated percentages.
4. Switch between sheet music, tablature and both. Use the piano roll to select notes and edit pitch, onset, duration, velocity, or string/fret. Undo/redo keeps up to 50 edits.
5. Export MIDI, MusicXML, ASCII tab or a generated **PDF** for the current staff/tab view. Combined view exports separate staff and tab pages. Android saves through the system document chooser; **Share file** opens the native share sheet. For publication-quality engraving of long/complex scores, open MusicXML in MuseScore Studio.
6. Choose **Save offline** to keep the score on this device. Use the library to reopen it without a server. **Backup score** exports portable JSON, and **Import score backup** restores it. Original recordings are not stored in the offline library.

The note timeline uses quarter-note beats relative to the selected segment. A tempo correction changes performance speed; it does not re-detect notes or infer a pickup. Original audio comparison is a separate player, not time-stretched or locked to the synth. The synth has independent seek, speed, loop, metronome and highlighting.

### Tuning and capo

Enter low-to-high **sounding MIDI pitches**: guitar `40,45,50,55,59,64`; drop D `38,45,50,55,59,64`; four-string bass `28,33,38,43`. Capo is added to every open-string pitch; frets are relative to the capo. Fingering search considers neighboring notes, chord stretches and sustained-string occupancy. Unplayable events remain in staff/MIDI with warnings and unassigned tab markers. Manual fingerings can still be physically difficult; review them.

## Configuration

See [.env.example](.env.example). Compose reads a root `.env`; native Uvicorn requires these variables to be set in your shell. Defaults: 50 MB, 480 seconds (8 minutes) **for the entire upload or video**, 12 retained jobs, one inference worker, 1800-second timeout, 1-hour expiration. `ENABLE_ONLINE_SOURCES=0` turns off YouTube links and search. `ENABLE_SEPARATION=0` turns off Demucs. On CPU, isolating a 4-minute song takes roughly 1–4 minutes depending on the machine. Segment selection limits inference to a passage but does not bypass the whole-upload duration limit. HTTP docs: **http://127.0.0.1:8000/docs**.

Frontend build configuration belongs in `frontend/.env.local`:

```dotenv
VITE_APP_NAME=Your Project Name
VITE_API_URL=https://api.example.com
VITE_BASE_PATH=/
```

For local development, leave `VITE_API_URL` empty. Change `APP_NAME` on the backend and `VITE_APP_NAME` on the frontend to rename the app. Also update the HTML title, package metadata and documentation before release. This working name is not affiliated with MuseScore's OpenScore project.

## Tests and build

From the root (use `.venv/bin/python` on macOS/Linux):

```powershell
.venv\Scripts\python.exe scripts/generate_examples.py
.venv\Scripts\python.exe -m ruff check backend scripts
cd backend
..\.venv\Scripts\python.exe -m pytest -q
cd ..\frontend
npm run lint
npm test
npm run build
```

`pytest -m 'not ai'` skips the real neural model test. Without the optional AI package it is automatically skipped. Fixtures are generated sine tones released as CC0; the mixed-pitches sample is a synthetic mixture, not a benchmark of real instrument identification. Tests parse MusicXML back through music21 and MIDI through mido, exercise pitch detection, alternate tunings, sustained-string constraints, invalid files, actual upload jobs and cleanup.

Browser E2E is configured with Playwright. With the Python environment activated, run in `frontend`: `npx playwright install chromium`, then `npm run test:e2e`. Stop the frontend dev server first: the suite builds/starts its own production PWA on port 5173 so service-worker caching can be tested. It tests real upload → score rendering → edit → download, then offline reload/edit/PDF export and mobile layout. CI installs Chromium and runs it on Linux. Manual browser QA also exercised these flows with both servers stopped.

## Deployment and operations

Read [deployment](docs/DEPLOYMENT.md), [architecture/API](docs/ARCHITECTURE.md), [security](docs/SECURITY.md), and [dependency decisions/licenses](docs/THIRD_PARTY.md).

GitHub Pages can serve the frontend only. It cannot run Python inference. No free public compute is promised. An always-on CPU server or your own machine supplies the backend. Source separation and GPU deployment are future work.

## Source

The code is at https://github.com/gioleylee/OpenScore. `.env`, `.venv`, `.tools`, uploads, build output and `node_modules` are ignored. CI runs on pushes and pull requests. Run the live YouTube check with `pytest -m network`.

## License and privacy

Project source: [MIT](LICENSE). Dependency licenses and model-weight provenance are documented separately. Basic Pitch's bundled model is used under upstream Apache-2.0; its license notice is retained. FFmpeg licensing depends on the binary (the installed Windows bundle is GPL-3.0-or-later); redistribution of binaries/images has additional notice/source obligations. See [third-party notes](docs/THIRD_PARTY.md) before distributing executable bundles.

Upload only recordings you have rights or permission to process, and respect copyright when sharing scores. Audio is processed on the configured backend and deleted on cancellation, explicit deletion, expiration, or server restart. No analytics, accounts, paid APIs, or permanent audio library. Recovery drafts and explicitly saved note-event scores persist on this device (IndexedDB on web; private Filesystem/Preferences on Android). Clear/remove library entries or app data to delete them; keep JSON backups before uninstalling or clearing browser storage.
