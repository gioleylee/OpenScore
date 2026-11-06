# Deployment

## A. Local / self-hosted

`docker compose up --build` serves http://localhost:8080, proxies `/api`, and uses local Basic Pitch weights. There is no cloud inference or runtime model download. CPU inference works. Start with 2 vCPU and at least 4 GB available host RAM; the backend container is limited to 3 GB and two CPU cores, with one inference worker. These are starting allocations, not measured performance guarantees. First-run librosa/Numba compilation can increase latency. Tune file/duration limits using your actual hardware before sharing it.

Native setup is in the README. Native mode has application-level bounds but no container RAM/CPU limits; public operators should use cgroups/containers/systemd restrictions. macOS Apple Silicon native TensorFlow versions may differ from this tested Windows/Linux x86 stack; use the CPU Linux Docker image if dependency resolution fails. GPU setup is not provided or tested; a future GPU image needs compatible CUDA/TensorFlow/container runtime and independent validation.

Compose listens on loopback by default. To share publicly, put a TLS reverse proxy in front of port 8080 and route only that proxy to the app. Set `CORS_ORIGINS=https://your-domain.example`, rebuild frontend branding if needed, and configure request/rate/connection limits at ingress. Keep the backend private. The provided Nginx proxy imposes 26 MB requests; if you raise `MAX_UPLOAD_MB`, update its `client_max_body_size` accordingly.

Docker uses RAM-backed `/data` (512 MB) and `/tmp` (256 MB), a read-only backend root filesystem and one API process. Limits for CPU/memory/PIDs are in Compose. A full queue returns an honest 429; expiry frees retained slots. Avoid persistent audio volumes and external caches/backups of uploads.

Default proxy behavior shares an IP quota among visitors behind the frontend proxy. For true per-client public IP limits, add rate limiting at your trusted ingress (recommended), or explicitly trust only your reverse proxy's IP range in Uvicorn and strip incoming forwarded headers there. Do not set forwarded allow-IPs to `*` on an exposed backend. CORS alone is not access control or abuse protection.

## B. Static frontend + separate backend

1. Deploy the backend Docker stage to a Linux CPU server: `docker build --target backend -t openscore-backend .`. Run one instance with container memory/CPU/PID limits and bounded tmpfs, as in Compose. Route it through HTTPS ingress. Do not run several Uvicorn workers against one directory.
2. Set backend `CORS_ORIGINS` to the exact HTTPS frontend origin. A GitHub project URL's origin is `https://USERNAME.github.io`, without the repository path.
3. In `frontend/.env.production`, set `VITE_API_URL=https://api.example.com`, `VITE_APP_NAME=Your Name`, and `VITE_BASE_PATH=/` (or `/REPOSITORY/` for GitHub Pages).
4. In `frontend`, run `npm ci --ignore-scripts && npm run build`. Publish **frontend/dist** to GitHub Pages, Cloudflare Pages or Vercel static hosting. Configure their build root as `frontend`, command `npm run build`, output `dist`; supply build variables in their dashboard. These public build variables contain no secrets.
5. Check `/api/health`, then upload a CC0 fixture through the deployed frontend and confirm MusicXML/MIDI downloads and cancellation. A successful static deployment by itself does not verify inference.

GitHub Pages and Cloudflare Workers do **not** run this Python/TensorFlow backend. Cloudflare Workers' memory/runtime model is unsuitable for this service. This repository is prepared for local and separately hosted deployment; no provider account, public backend, domain, or production deployment is created automatically.

### Costs and free-tier restrictions

Static frontend hosting may fit providers' free quotas. Sustained shared CPU inference needs compute, RAM and bandwidth. There is no guaranteed, always-on, free public backend. The lowest-cost architecture is your existing computer plus a private network or securely configured HTTPS ingress; a small always-on CPU VPS is the simpler public option. Expect a paid monthly server once you need predictable availability. Choose enough RAM for the full stack, not just the small model-weight file.

No provider-specific dollar prices or free-tier promises are embedded here: quotas, eligibility, regional availability and policies change. Confirm the chosen provider's current pricing and sleep/egress/storage policies at signup. Sleeping services introduce cold starts, may terminate queued jobs and may not have enough RAM; short-lived serverless HTTP functions are a poor inference-worker fit. Idle sleep is tolerable only if the UI receives an honest error and users can retry. Local use stays free apart from hardware/electricity.

Anonymous internet hosting can incur bandwidth/compute abuse even without paid model APIs. Keep the default short uploads, one inference worker, small retained-job budget and ingress quotas. IP limits do not defeat distributed abuse. For friends, use upstream network access controls rather than adding application accounts.

### Operations

- Liveness/configuration: `/api/health`. It reports installed Basic Pitch package availability, not a full model self-test; transcribe a small fixture as a deployment smoke test.
- Check job `worker.log` inside the private job directory for failures, without publishing tokens/audio/paths to users. Job files and logs expire together.
- Restart invalidates all jobs; edits in an open page remain available for stateless exports but original audio disappears.
- One data directory per API instance. Horizontal scaling needs a coordinated queue/store, shared rate limits and job routing; do not use round-robin replicas with this in-memory architecture.
- Container/image redistribution must preserve dependency notices and FFmpeg source/license obligations. The project MIT license does not replace those licenses.

## Browser-only alternative

[Spotify Basic Pitch TypeScript](https://github.com/spotify/basic-pitch-ts) demonstrates a possible client-inference route. It could avoid backend operating costs, but decoding, mobile memory/latency, local model assets and device benchmarks need a separate implementation. **No browser/on-device AI transcription fallback is implemented.** New audio requires the Python backend. Saved-score viewing, editing, synth practice, fingering and exports run locally and work offline through the installable PWA or Android app. See [Android/PWA guide](ANDROID.md) for packaging, CORS and signed releases.
