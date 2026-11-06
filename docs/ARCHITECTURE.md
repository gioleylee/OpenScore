# Architecture and API

React + TypeScript + Vite is a static frontend. Next.js SSR adds no useful behavior to this privacy-focused workbench. Handwritten CSS provides responsive dark/light themes; no Tailwind or Tone.js runtime is necessary. OSMD engraves server-generated MusicXML as SVG. Web Audio schedules a simple triangle oscillator synth against its audio clock, with a short lookahead and re-anchoring when speed/tempo/loop changes. No sample library or soundfont needs redistribution.

FastAPI owns one in-memory job manager. A semaphore bounds active inference, and each job runs in a disposable Python child process. CPU threads are constrained. Stage files report actual worker activity. Timeout and cancellation terminate the worker; outputs are never substituted by demo notes. FFmpeg conversion is independently bounded to 45 seconds. On cancellation during FFmpeg decoding, its child can finish its bounded decode before exiting; container PID/memory/CPU limits provide the outer boundary.

Pipeline:

```text
bounded multipart upload → random private directory → restricted FFmpeg decode
→ mono 22050 Hz, peak limiting, selected segment → beat estimate or manual BPM
→ pYIN or bundled Basic Pitch TFLite → minimum-duration/duplicate filtering
→ beat quantization → tab beam search if requested → editable Score JSON
→ stateless MusicXML / MIDI / ASCII exports → OSMD + Web Audio playback
```

The `Score` schema in `backend/app/schemas.py` and matching TypeScript contract remain the source of truth. Pitch is sounding MIDI pitch, onset/duration are quarter-note beats, velocity is 1–127, string numbering is high-to-low (1 = highest string), and fret is capo-relative. The shared frontend generates notation, MIDI, PDF and ASCII directly from the current edited score using `localExports.ts`; it does not need the backend to engrave or practice a saved score. Existing stateless server export endpoints remain available to API clients. Key is manually selected, never a fabricated detector confidence.

`transcription.py` is replaceable independently from `notation.py` and `tablature.py`. pYIN confidence is used only as a gating probability; the UI does not claim calibrated note confidence. Basic Pitch amplitudes and pYIN RMS-derived velocities are estimates, not original performance dynamics. Quantization does not infer expressive techniques, swing, pickups or rubato maps.

Tablature uses a width-48 beam over onset groups. It enumerates candidate string/fret assignments, prevents duplicate strings within chords and string collisions with sustaining notes, limits fretted span to four frets and distinct stopped frets to four, and penalizes position shifts, span and high frets. Barres are approximated by shared frets. A costly unassigned option preserves impossible notes and emits warnings. Hand anatomy, individual fingers, muting and original player choices are not inferred. Manual string/fret changes must preserve sounding pitch and selected fret limits.

Both the optional music21 server exporter and local TypeScript exporter insert rests, measures and ties, and allocate overlapping events to at most 16 independent voices per part. The local exporter preserves tick durations and splits binary fragments with ties, using simple sharp-based chromatic spelling. Piano is split at C4 into upper/lower parts with treble/bass clefs; this is a readability rule, not inferred hands or a fully engraved grand staff. Guitar notation uses concert pitch in treble clef. Tab MusicXML uses technical string/fret elements and tuning details; combined view is two panels. Unassigned tab notes get `?`. PDF uses local OSMD A4 engraving plus jsPDF/svg2pdf; combined exports staff and tab pages separately. MuseScore remains useful for publication-quality cleanup.

## Shared web/Android runtime

`platform.ts` guards native APIs: web downloads/Web Share versus Android Create Document and cache-backed Share. `storage.ts` uses IndexedDB transactions on web, Filesystem revision JSON plus a serialized Preferences index on Android. Recovery drafts flush on pause/visibility changes; synth pauses for interruptions. `engine.ts` defines the interchangeable transcription lifecycle interface; only the server provider is implemented. PWA assets are versioned/pre-cached by `scripts/build-pwa.mjs`, with no API/audio caching and user-approved activation. Capacitor embeds the same build without a service worker. Details and honest device-validation limits are in `ANDROID.md`.

## HTTP contract

OpenAPI at `/openapi.json`, interactive docs at `/docs`. Pydantic validates and bounds payloads; matching frontend types are in `frontend/src/types.ts`.

| Method | Endpoint | Behavior |
|---|---|---|
| GET | `/api/health` | Limits and optional Basic Pitch package availability |
| POST | `/api/jobs` | Multipart `file` plus JSON-string `settings`; returns 202 `{id,state}` |
| GET | `/api/jobs/{id}` | queued/running/done/failed, actual stage, error, TTL |
| GET | `/api/jobs/{id}/result` | Completed `{score,audio}`; 409 until ready |
| GET | `/api/jobs/{id}/audio` | Decoded selected-segment WAV; only when done |
| DELETE | `/api/jobs/{id}` | Cancel running/queued job and delete files; 204 |
| POST | `/api/render/midi` | Full edited Score JSON → MIDI bytes |
| POST | `/api/render/musicxml?view=staff\|tab` | Edited Score → MusicXML |
| POST | `/api/render/txt` | Edited fretted Score → ASCII tab with onset labels |
| POST | `/api/fingering` | Edited Score → Score with optimized fingerings |

Job IDs are unguessable bearer capabilities. Do not log or share result URLs. No database; restarting invalidates jobs. Run exactly one Uvicorn process per isolated data directory. Replicas or durable queues require an external coordinated store/queue and are deliberately outside this implementation.
