# One frontend: website, PWA and Android

The React/TypeScript application in `frontend/src` is shared. Capacitor 8.6 packages the compiled static frontend in a native Android shell. No second Android UI or inference model is maintained. Android minimum SDK is 24 (Android 7); an up-to-date Android System WebView is required. Target/compile SDK is 36 and Java source level is 21.

**Actual offline AI transcription is not implemented or tested on Android.** New audio needs a reachable Python transcription server. Previously saved scores can be opened, engraved, edited, exported and played with the synth without that server. The website remains functional without native plugins; every Android-only call is guarded by `Capacitor.isNativePlatform()`.

## Build a debug APK

Install Node 24, JDK 21 and Android Studio 2025.2.1+ or Android command-line tools. Use the SDK manager to install **Android SDK Platform 36**, **Build Tools 35.0.0**, and **Platform Tools**. Review and accept the required Android SDK licenses. Set `JAVA_HOME` to JDK 21 and `ANDROID_HOME` to your SDK directory. Java 8 is insufficient.

From the repository root:

```sh
cd frontend
npm ci --ignore-scripts
npm run android:debug
```

The command builds the shared frontend with relative asset paths, synchronizes Capacitor plugins/assets, runs Gradle and copies the resulting installable APK to:

```text
artifacts/openscore-ai-debug.apk
```

The native Android project is already committed under `frontend/android`; do not run `cap add android` again. `npm run android:open` opens that project in Android Studio. `npm run android:sync` rebuilds/copies web assets after changes. `npm run build` separately creates the website/PWA and its service worker. Android embeds its assets and does not register a PWA service worker.

On the initial build machine, the JDK/SDK were unavailable system-wide, so verified official tool downloads were placed in ignored `.tools/android-build`. They are not distributed with the repository. For this workspace specifically, PowerShell can use them:

```powershell
$env:JAVA_HOME = (Get-ChildItem .tools/android-build/jdk -Directory | Select-Object -First 1).FullName
$env:ANDROID_HOME = "$PWD/.tools/android-build/sdk"
$env:GRADLE_USER_HOME = "$PWD/.tools/gradle"
cd frontend
npm run android:debug
```

## Connect the app to inference

The APK intentionally works as an offline score library before a server is configured. To transcribe, open **Connection settings** and enter a trusted **HTTPS server origin**, for example `https://api.your-domain.example`. Do not enter your website's URL if its `/api` routes are not backed by the inference server.

Alternatively, set public build variable `VITE_API_URL` when building the APK. GitHub Actions reads repository variable `PUBLIC_API_URL`. These values are public, never credentials. Android `localhost` refers to the phone, not your development PC. The app does not permit cleartext HTTP or mixed content. Use an HTTPS endpoint with a valid certificate; no certificate-validation bypass is supplied.

Backend CORS must include the Capacitor origin **`https://localhost`**, alongside the actual website origin. For example:

```dotenv
CORS_ORIGINS=https://scores.example.com,https://localhost
```

CORS is not authentication. Other apps can also use that origin; retain the backend queue, upload, duration, timeout and ingress controls. Only upload recordings to a server you trust.

## Install, share and update

1. Transfer the APK to your phone, open it, and allow installation from that file manager/browser when Android asks. Keep Play Protect enabled. No Play Store account is required for sideloading.
2. With USB debugging enabled, the alternative is `adb install -r artifacts/openscore-ai-debug.apk`.
3. Use **browse files** to open Android's system document picker. It imports supported audio through WebView's file chooser. Broad storage, microphone and contacts permissions are not requested. Receiving `ACTION_SEND` audio from another app's Share menu is not implemented; use the picker.
4. **MIDI**, **MusicXML**, **PDF** and **ASCII tab** use Android's Create Document dialog. Choose Downloads or another document provider. **Share file** uses the native share sheet through temporary FileProvider URIs.
5. Save a score with **Save offline**. Use **Backup score** to save portable JSON; **Import score backup** restores it on another installation/device. Original audio is not included.

Release APKs signed with the **same application ID and signing key** can update in place. Increase `ANDROID_VERSION_CODE` for published updates. An update preserves app-private library data; uninstalling or clearing app storage deletes it. Keep portable backups. Debug keys vary across computers and CI runners, so debug APKs are for testing, not a durable update channel. Switching from debug signing to your release key normally requires uninstalling first; export backups before doing so.

## Release signing

Create your own signing key using JDK `keytool`; it prompts for passwords rather than putting them in shell arguments:

```sh
keytool -genkeypair -v -keystore /SECURE/PATH/openscore-release.jks -alias openscore -keyalg RSA -keysize 3072 -validity 10000
```

Back up the keystore securely. Losing it prevents installing compatible updates. Never commit keystores, signing property files or passwords. Git ignores `*.jks`, `*.keystore` and `keystore.properties`. Gradle reads signing values only from these environment variables:

```text
ANDROID_KEYSTORE_FILE       absolute path to keystore
ANDROID_KEYSTORE_PASSWORD   keystore password
ANDROID_KEY_ALIAS          openscore (or your chosen alias)
ANDROID_KEY_PASSWORD       private-key password
ANDROID_VERSION_CODE       monotonically increasing positive integer
ANDROID_VERSION_NAME       user-visible version, e.g. 0.2.0
```

After setting them securely in your environment, run `npm run android:release` in `frontend`. The output is `artifacts/openscore-ai-release.apk`. Release builds fail clearly when credentials are absent; they do not silently use a debug key. For verification use `apksigner verify --verbose APK_PATH` from the installed SDK build tools.

## GitHub Actions and downloadable releases

`.github/workflows/android.yml` builds debug APK artifacts on main pushes, relevant pull requests, or manual dispatch. Download them from the workflow run's **Artifacts** section. That download generally requires GitHub access; use a public GitHub Release for a friend-friendly direct download.

Add four repository **Actions secrets** under Settings → Secrets and variables → Actions:

| Secret | Value |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | Base64 encoding of your keystore bytes, without line wrapping |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore password |
| `ANDROID_KEY_ALIAS` | Signing alias |
| `ANDROID_KEY_PASSWORD` | Private-key password |

Optional repository variable: `PUBLIC_API_URL=https://api.example.com`. The workflow passes signing secrets only to the release job, decodes the key into runner temporary storage, verifies the signature, then deletes the temporary key in an `always()` cleanup step. Fork pull requests never receive signing credentials. Restrict tag/release permissions to trusted maintainers; protect repository Actions settings and signing secrets.

Push a release tag after tests pass:

```sh
git tag android-v0.2.0
git push origin android-v0.2.0
```

The tag job builds the signed release APK, verifies it, computes SHA-256 and creates or updates a GitHub Release containing the APK and `SHA256SUMS.txt`. Share the resulting repository **Releases** URL or direct APK asset URL. This repository does not create a GitHub remote, invent a release URL, upload your key, or publish a release until you configure and push it.

## Website / installable PWA

Deploy `frontend/dist` built with `npm run build` over HTTPS. The public website works in a normal browser. Supporting browsers offer an Install button/menu. iOS/browser-specific installation menus vary. First load must finish caching before offline use; **App cached** indicates the app shell is installed.

The generated service worker precaches the app's own static JS/CSS/icons/manifest/license notices only. It never caches uploads, API responses or original audio. IndexedDB stores score JSON independently. Each active worker serves its matching cached HTML; two previous asset caches are retained for already-open pages. New workers wait for **Save session & update app**, avoiding a forced reload during editing. Keep `sw.js` on a revalidated/no-cache policy at your host; Nginx and Cloudflare Pages header configurations are included. Service workers require HTTPS or localhost and are disabled in the development server. Browser storage can be evicted; a persistence request is made when saving, but backup JSON is the reliable portable copy.

For GitHub Pages, build with `VITE_BASE_PATH=/REPOSITORY/`. The manifest and service worker use relative/scoped paths. A PWA is not a free offline inference engine; transcription still needs the separate backend in `DEPLOYMENT.md`.

## Storage, interruption and engine boundaries

- Web: versioned IndexedDB transactions store score and lightweight waveform/segment metadata.
- Android: Filesystem `Directory.Data` stores complete revision files; a small Preferences index is committed afterwards. Revision writes and index changes are serialized. Old successful revisions are removed. Saved data is app-private and Android backup is disabled; uninstall deletes it.
- A debounced recovery draft saves recent edits. App pause/visibility changes request an immediate flush and pause audio. Returning to the app does not autoplay; press Play to resume. Force termination before an asynchronous write completes may lose the last unsaved fraction of a second; explicit Save/Backup remains available.
- Pending inference IDs are stored with their server origin. On reopening, choose **Resume pending transcription** to query the existing job; uploads are never automatically duplicated. Forgetting its link does not cancel the server job; server timeout/retention still applies.
- Two-finger pinch changes score zoom; one-finger scroll navigates. Buttons remain available for precise/accessible zoom. Engraving is debounced while zooming.
- `TranscriptionEngine` in `src/engine.ts` isolates health, submit, status, result, cancel and audio URL behavior. The only implemented provider is `ServerTranscriptionEngine` with `offlineInference=false`. Local score export/fingering modules do not claim to infer audio.

## Validation and remaining device QA

A debug APK was generated locally with JDK 21/SDK 36 and its APK signature verified. Nine frontend unit tests cover IndexedDB recovery/concurrency, the Android revision/index adapter with mocked native I/O, invalid backups, local MIDI/XML, fingering, inference failure and service-worker isolation. All 19 backend tests also pass. Production PWA manual QA reloaded with both servers stopped, opened a saved score, edited C4→C♯4, remapped tab, played synth and downloaded MIDI, MusicXML, text tab and a two-page PDF. MIDI/XML were parsed back and the PDF was rendered for visual inspection.

No Android phone/emulator was connected during implementation. Native document picking/save/share, interruptions, pinch gestures and storage across real device updates still require hardware/emulator QA; compilation is not proof of those runtime behaviors. Automated browser E2E tests are provided for CI. Release signing awaits your own credentials. Offline AI transcription, GPU/on-device models and Play Store publication are not implemented.

Upstream references: [Capacitor environment](https://capacitorjs.com/docs/getting-started/environment-setup), [Filesystem](https://capacitorjs.com/docs/apis/filesystem), [Share](https://capacitorjs.com/docs/apis/share), [App lifecycle](https://capacitorjs.com/docs/apis/app), [Android app signing](https://developer.android.com/studio/publish/app-signing).
