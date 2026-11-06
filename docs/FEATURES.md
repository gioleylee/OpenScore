# Feature status

## Implemented

- Three audio sources: file upload, single-video YouTube links (strictly limited to YouTube hosts, so the server can't be used to fetch arbitrary URLs), and song-name search that returns candidates for you to pick from. Downloads run in the cancellable worker with duration and size limits.
- Optional Demucs `htdemucs_6s` instrument isolation (vocals, guitar, bass, piano, other) before note detection, for full-band songs.
- Instruments: melody (voice, flute, sax, trumpet, clarinet, cello, ...), piano, guitar, bass, ukulele (re-entrant GCEA tabs) and violin.
- Violin: G-D-A-E strings, fingerings that stay in first position unless a shift is needed, finger numbers (0 = open) on the staff, 4-line violin tab. Solo recordings use pYIN; violin isolated from a song uses Basic Pitch reduced to the top line.
- Expressive playing: notes stay whole through vibrato and slides, repeated notes split at bow changes (level dips), and recordings not tuned to A = 440 Hz are corrected for both engines.
- Key signature estimated from the notes (Krumhansl-Kessler profiles); flat keys are spelled with flats.
- Song tempo and beat phase from a comb filter over the whole mix; bar lines placed on the strongest beat.
- Actual MP3/WAV/FLAC/M4A/OGG decode, drag/drop, metadata, browser audio preview and sampled waveform.
- Configurable whole-file byte/duration limits, segment selection, mono/resample/peak limiting, safe temporary directories.
- Lightweight monophonic pYIN and optional Basic Pitch polyphony with bundled local weights.
- Manual/estimated tempo, selected meter, grid quantization, short-event and duplicate filtering.
- MIDI and MusicXML with rests, measure boundaries, independent voices and ties.
- Treble/bass piano split; six-string guitar/four-string bass, alternate tunings, capo, fret regions, beam search and sustained-string constraints.
- Responsive dark/light UI, actual stages, cancellation and error feedback.
- OSMD staff/tab/both views, zoom, measure labels, playback cursor; piano-roll active-note highlighting.
- Add/delete/pitch/onset/duration/velocity/fingering edits, tempo/key/meter correction, undo/redo.
- Web Audio synth, seek, speed, looping, metronome; independent original-audio comparison.
- Local edited MIDI/MusicXML/ASCII/PDF downloads, including offline generation and Android document-save/native share adapters.
- Installable PWA with scoped app-shell caching and opt-in updates; Capacitor Android project and APK build/release workflow.
- Offline library (web IndexedDB; Android private revision files + Preferences index), recovery drafts and portable JSON backup/import.
- Shared TypeScript engraving and fingering, touch pinch zoom, pause-on-interruption and pending server-job recovery.
- Rate limiting, queue/concurrency/timeout/retention bounds, deletion, CORS allowlist, Docker memory/CPU controls.
- Generated CC0 examples, backend tests, frontend type/build checks, browser E2E definition and GitHub Actions.

## Limitations and future work

- One instrument part per transcription. Demucs separates broad stems; it cannot split two guitars or name a specific synth. No hidden guessed tracks, fake confidences or fake completion.
- Violin isolation uses Demucs' generic 'other' stem (no dedicated violin model), so synth pads or strings in the backing can leak in. Double stops are reduced to the top note. Fingerings are first-position suggestions, not bowing or a teacher's edition.
- Song search uses YouTube results; picking a cover or live version gives that version's notes. The app does not look up published sheet music or tabs.
- yt-dlp must be kept current. YouTube may block datacenter IPs, so a home server or your own PC works more reliably than cloud hosts.
- Isolated melody tracking is not main-lead extraction from a full mix; Basic Pitch is not a dedicated piano/guitar model.
- No MuScriptor weights, noise suppression, trained fingering classifier, pitch-bend/slide/vibrato inference, or variable-tempo map.
- Quantization assumes segment start is beat zero. Silence/pickups may shift the notated beat; correct onset/tempo manually.
- Same-pitch rearticulations without pitch change or a sufficient unvoiced gap can merge in pYIN.
- Piano part split is a heuristic; no hand detection, pedal analysis or full grand-staff engraving.
- Fingering heuristics approximate playability. Wide/stretching chords may be unassigned even if a skilled player could play them; manual choices can conflict with neighboring notes.
- Oscillator playback is intentionally simple. Original audio is independent; no pitch-preserving time stretch or waveform/synth lock.
- Staff cursor marks a beat position; active notes are highlighted in the piano roll. Combined staff/tab is two panels, not interleaved systems.
- ASCII tab includes beat onsets but is not a full rhythmic engraving. Local MusicXML uses simple sharp-based chromatic spelling and tied binary rhythm fragments; use MuseScore for detailed engraving/enharmonic cleanup. PDF uses the local engraver with pagination.
- No Guitar Pro export. Offline library stores notes/metadata, not original audio. Browser storage may be evicted; JSON backups are portable. Android storage is removed on uninstall.
- CPU-only deployment provided, no GPU image or static in-browser model fallback yet. Basic Pitch TypeScript is a potential future static-host path, not implemented here.
- One API process; no cross-replica queue/rate coordination. IP limits are not authenticated per-person limits; shared networks share quotas.

## Validation record

Native development used Windows, Python 3.11.15, TensorFlow 2.15.0, Basic Pitch 0.4.0 (TFLite), librosa 0.11.0, Node 24.18.0, OSMD 1.9.9. See repository tests and CI for exact assertions. Generated tones demonstrate plumbing/detection, not measured accuracy on real-world music. No claims of song-level accuracy or throughput benchmarks are made.

The final backend regression run passed all 19 tests, including owned-directory cleanup protection. TypeScript checks, production build and Ruff checks passed. Manual browser QA verified mobile and desktop views, real upload → staff/tab rendering, pitch edits, fingering recalculation, undo/redo, add/delete, synth play/pause and a downloaded MIDI containing the edited pitch. Two automated Playwright E2E tests were authored and successfully enumerated; their browser execution is configured in CI and was not run locally. Docker was not available for local image validation. The production build warns about the large OSMD chunk, which is loaded only when results need engraving.

Android/PWA extension: nine frontend unit tests passed, including the Android storage adapter with mocked native I/O. A signed debug APK was generated with JDK 21, SDK 36, Gradle 8.14.3 and Capacitor 8.6.0, and verified with `apksigner`. Manual PWA testing stopped both servers, reloaded from its service worker, reopened IndexedDB scores, edited/remapped notes, played synth and downloaded all four export formats. MIDI/MusicXML were parsed back; the generated two-page PDF was rendered for visual QA. Android hardware runtime and production-key signing remain unverified; no device was connected. Browser E2E was extended for offline editing/export.
