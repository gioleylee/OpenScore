import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  AudioLines,
  ArrowRight,
  Upload,
  FileAudio,
  Settings2,
  Check,
  Music2,
  Guitar,
  SlidersHorizontal,
  Download,
  Sun,
  Moon,
  ChevronRight,
  ShieldCheck,
  X,
  LoaderCircle,
  ArrowLeft,
  Printer,
  ZoomIn,
  ZoomOut,
  RefreshCw,
  Link2,
  Search,
} from "lucide-react";
import { download } from "./api";
import { transcriptionEngine, type SearchResult } from "./engine";
import {
  backendUrl,
  deliverFile,
  isNative,
  readPreference,
  writePreference,
} from "./platform";
import { App as NativeApp } from "@capacitor/app";
import {
  saveTranscription,
  persistPermission,
  type SavedTranscription,
} from "./storage";
import { localFingering } from "./localFingering";
import { Library } from "./Library";
import { Connection } from "./Connection";
import { PwaControls } from "./PwaControls";
import { NotationGestures } from "./NotationGestures";
import { Licenses } from "./Licenses";
import { RendererBoundary } from "./RendererBoundary";
import { defaults, FRETTED, pitchName } from "./types";
import type { Mode, Result, Score, Settings, Stem } from "./types";
const ScoreView = lazy(() =>
  import("./ScoreView").then((module) => ({ default: module.ScoreView })),
);
import { Playback } from "./Playback";
import { Editor } from "./Editor";

const NAME = import.meta.env.VITE_APP_NAME || "OpenScore AI";
const modes: { id: Mode; name: string; description: string }[] = [
  { id: "melody", name: "Melody", description: "One clear musical line" },
  { id: "piano", name: "Piano", description: "Notes, chords & two staves" },
  { id: "guitar", name: "Guitar", description: "Standard notation & tabs" },
  { id: "bass", name: "Bass", description: "Low-end lines & 4-string tabs" },
  { id: "ukulele", name: "Ukulele", description: "GCEA notation & tabs" },
];
const presets: Record<
  Mode,
  { instrument: string; tuning: number[]; stem: Stem }
> = {
  melody: {
    instrument: "Voice",
    tuning: [40, 45, 50, 55, 59, 64],
    stem: "vocals",
  },
  piano: {
    instrument: "Piano",
    tuning: [40, 45, 50, 55, 59, 64],
    stem: "piano",
  },
  guitar: {
    instrument: "Guitar",
    tuning: [40, 45, 50, 55, 59, 64],
    stem: "guitar",
  },
  bass: { instrument: "Bass", tuning: [28, 33, 38, 43], stem: "bass" },
  ukulele: { instrument: "Ukulele", tuning: [67, 60, 64, 69], stem: "guitar" },
};
const melodyInstruments = [
  "Voice",
  "Violin",
  "Flute",
  "Saxophone",
  "Trumpet",
  "Clarinet",
  "Cello",
  "Recorder",
  "Harmonica",
  "Other",
];
const stems: { id: Stem; name: string }[] = [
  { id: "none", name: "Off · recording is already one instrument" },
  { id: "vocals", name: "Vocals / sung melody" },
  { id: "guitar", name: "Guitar" },
  { id: "bass", name: "Bass" },
  { id: "piano", name: "Piano / keys" },
  { id: "other", name: "Other (strings, winds, synths)" },
];
const formatTime = (s: number | null | undefined) =>
  s == null
    ? ""
    : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

function Waveform({ peaks }: { peaks: number[] }) {
  return (
    <svg
      className="waveform"
      viewBox="0 0 600 70"
      preserveAspectRatio="none"
      role="img"
      aria-label="Audio amplitude waveform"
    >
      {peaks.map((p, i) => (
        <line
          key={i}
          x1={(i / peaks.length) * 600}
          x2={(i / peaks.length) * 600}
          y1={35 - p * 32}
          y2={35 + p * 32}
          stroke="currentColor"
          strokeWidth={1.5}
        />
      ))}
    </svg>
  );
}

export default function App() {
  const [dark, setDark] = useState(true),
    [settings, setSettings] = useState<Settings>(defaults),
    [file, setFile] = useState<File | null>(null),
    [url, setUrl] = useState(""),
    [peaks, setPeaks] = useState<number[]>([]),
    [duration, setDuration] = useState<number | null>(null),
    [drag, setDrag] = useState(false),
    [source, setSource] = useState<"file" | "link" | "search">("file"),
    [link, setLink] = useState(""),
    [query, setQuery] = useState(""),
    [searching, setSearching] = useState(false),
    [results, setResults] = useState<SearchResult[]>([]),
    [picked, setPicked] = useState<SearchResult | null>(null);
  const [health, setHealth] = useState<{
      basic_pitch: boolean;
      max_duration: number;
      max_upload_mb: number;
      online_sources?: boolean;
      separation?: boolean;
    } | null>(null),
    [error, setError] = useState(""),
    [job, setJob] = useState<string | null>(null),
    [state, setState] = useState("idle"),
    [stage, setStage] = useState(""),
    [result, setResult] = useState<Result | null>(null),
    [score, setScore] = useState<Score | null>(null),
    [past, setPast] = useState<Score[]>([]),
    [future, setFuture] = useState<Score[]>([]),
    [beat, setBeat] = useState(0),
    [view, setView] = useState("staff"),
    [zoom, setZoom] = useState(0.9),
    [exporting, setExporting] = useState(false),
    [editTab, setEditTab] = useState(false);
  const [connectionVersion, setConnectionVersion] = useState(0),
    [savedId, setSavedId] = useState<string | null>(null),
    [saveStatus, setSaveStatus] = useState(""),
    [shareFormat, setShareFormat] = useState("midi"),
    [pendingResume, setPendingResume] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null),
    fileVersion = useRef(0);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }, [dark]);
  useEffect(() => {
    transcriptionEngine
      .health()
      .then(setHealth)
      .catch(() => setHealth(null));
  }, [connectionVersion]);
  const saveDraft = useCallback(async () => {
    if (!score || !result) return;
    await saveTranscription({
      version: 1,
      id: "draft",
      savedAt: new Date().toISOString(),
      score,
      audio: result.audio,
    });
    setSaveStatus("Session saved on this device");
  }, [score, result]);
  useEffect(() => {
    if (!score || !result) return;
    const timer = setTimeout(() => {
      void saveDraft().catch((e) =>
        setError(`Session could not be saved: ${String(e)}`),
      );
    }, 500);
    return () => clearTimeout(timer);
  }, [saveDraft, score, result]);
  useEffect(() => {
    const pause = () => {
      if (document.hidden) {
        void saveDraft().catch((e) => setError(String(e)));
        document.querySelectorAll("audio").forEach((audio) => audio.pause());
      }
    };
    document.addEventListener("visibilitychange", pause);
    let disposed = false;
    let remove: (() => Promise<void>) | undefined;
    if (isNative)
      void NativeApp.addListener("appStateChange", ({ isActive }) => {
        if (!isActive) {
          void saveDraft().catch((e) => setError(String(e)));
          window.dispatchEvent(new Event("openscore-pause"));
          document.querySelectorAll("audio").forEach((audio) => audio.pause());
        } else setConnectionVersion((v) => v + 1);
      }).then((listener) => {
        if (disposed) void listener.remove();
        else remove = () => listener.remove();
      });
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", pause);
      void remove?.();
    };
  }, [saveDraft]);
  useEffect(() => {
    const online = () => setConnectionVersion((v) => v + 1);
    window.addEventListener("online", online);
    return () => window.removeEventListener("online", online);
  }, []);
  useEffect(() => {
    void readPreference("openscore.pending")
      .then((value) => {
        if (!value) return;
        const pending = JSON.parse(value);
        if (pending.origin === backendUrl() && typeof pending.id === "string")
          setPendingResume(pending.id);
      })
      .catch((e) => setError(String(e)));
  }, []);
  function openSaved(item: SavedTranscription) {
    setScore(item.score);
    setResult({ score: item.score, audio: item.audio });
    setJob(null);
    setSavedId(item.id === "draft" ? null : item.id);
    setState("done");
    setPast([]);
    setFuture([]);
    setBeat(0);
    setError("");
  }
  async function saveToLibrary() {
    if (!score || !result) return;
    try {
      const id = savedId || crypto.randomUUID();
      await saveTranscription({
        version: 1,
        id,
        savedAt: new Date().toISOString(),
        score,
        audio: result.audio,
      });
      setSavedId(id);
      await persistPermission();
      setSaveStatus("Saved in your offline library");
      window.dispatchEvent(new Event("openscore-library"));
    } catch (e) {
      setError(String(e));
    }
  }
  useEffect(() => {
    if (!file) {
      setUrl("");
      return;
    }
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  const change = useCallback((next: Score) => {
    setScore((previous) => {
      if (previous) setPast((p) => [...p.slice(-49), previous]);
      return next;
    });
    setFuture([]);
  }, []);
  const onBeat = useCallback((b: number) => setBeat(b), []);
  const config = (patch: Partial<Settings>) =>
    setSettings((s) => ({ ...s, ...patch }));
  function mode(id: Mode) {
    const preset = presets[id];
    config({
      mode: id,
      instrument: preset.instrument,
      // Chords need the polyphonic model; single lines track best with pYIN.
      engine:
        id === "piano" ||
        ((id === "guitar" || id === "ukulele") && health?.basic_pitch)
          ? "basic_pitch"
          : "pyin",
      tuning: preset.tuning,
      separate: settings.separate === "none" ? "none" : preset.stem,
    });
  }
  function chooseSource(next: "file" | "link" | "search") {
    setSource(next);
    setError("");
    config({
      start: 0,
      end: null,
      // YouTube songs are full mixes; isolate the chosen instrument by default.
      separate:
        next !== "file" && health?.separation
          ? presets[settings.mode].stem
          : "none",
    });
  }
  async function runSearch() {
    if (query.trim().length < 2) return;
    setSearching(true);
    setError("");
    setPicked(null);
    try {
      const found = await transcriptionEngine.search(query.trim());
      setResults(found);
      if (!found.length)
        setError("No songs found. Try adding the artist name.");
    } catch (e) {
      setError(String(e));
    } finally {
      setSearching(false);
    }
  }
  async function selectFile(f: File) {
    const version = ++fileVersion.current;
    setError("");
    setFile(f);
    setDuration(null);
    setPeaks([]);
    config({ start: 0, end: null });
    if (f.size > (health?.max_upload_mb || 25) * 1024 ** 2) {
      setError("File is too large. Trim or compress the recording first.");
      return;
    }
    const audio = new AudioContext();
    try {
      const buffer = await audio.decodeAudioData(await f.arrayBuffer());
      if (version !== fileVersion.current) return;
      setDuration(buffer.duration);
      const data = buffer.getChannelData(0),
        values: number[] = [];
      for (let i = 0; i < 300; i++) {
        const first = Math.floor((i * data.length) / 300),
          last = Math.floor(((i + 1) * data.length) / 300);
        let max = 0;
        for (
          let j = first;
          j < last;
          j += Math.max(1, Math.floor((last - first) / 800))
        )
          max = Math.max(max, Math.abs(data[j]));
        values.push(max);
      }
      setPeaks(values);
    } catch {
      /* FFmpeg on the server is authoritative; browser codec support varies. */
    } finally {
      await audio.close();
    }
  }
  useEffect(() => {
    if (!job || !["queued", "running"].includes(state)) return;
    let stopped = false;
    let polling = false;
    const poll = async () => {
      if (polling) return;
      polling = true;
      try {
        const j = await transcriptionEngine.status(job);
        if (stopped) return;
        setStage(j.stage);
        if (j.state === "done") {
          const r: Result = await transcriptionEngine.result(job);
          if (stopped) return;
          setResult(r);
          setScore(r.score);
          setPast([]);
          setFuture([]);
          setState("done");
          setPendingResume(null);
          setError("");
          void writePreference("openscore.pending", null).catch((e) =>
            setError(String(e)),
          );
        } else if (j.state === "failed") {
          setError(j.error || "Processing failed");
          setState("failed");
          void writePreference("openscore.pending", null);
        } else setState(j.state);
      } catch (e) {
        if (!stopped) {
          setError(String(e));
          setStage("Connection interrupted. Reconnecting to the existing job…");
          if (
            String(e).includes("not found") ||
            String(e).includes("expired")
          ) {
            setState("failed");
            void writePreference("openscore.pending", null);
          }
        }
      } finally {
        polling = false;
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 1500);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [job, state]);
  const onlineUrl = source === "link" ? link.trim() : picked?.url || "";
  const ready = source === "file" ? !!file : !!onlineUrl;
  async function submit() {
    if (!ready) return;
    setError("");
    setState("uploading");
    setPendingResume(null);
    try {
      const r =
        source === "file" && file
          ? await transcriptionEngine.submit(file, settings)
          : await transcriptionEngine.submitLink(onlineUrl, settings);
      setJob(r.id);
      await writePreference(
        "openscore.pending",
        JSON.stringify({ id: r.id, origin: backendUrl() }),
      );
      setStage("Waiting for a worker");
      setState("queued");
    } catch (e) {
      setError(String(e));
      setState("failed");
    }
  }
  async function reset() {
    if (job) {
      try {
        await transcriptionEngine.cancel(job);
      } catch (e) {
        setError(String(e));
        return;
      }
    }
    setJob(null);
    setResult(null);
    setScore(null);
    setState("idle");
    setBeat(0);
    setSavedId(null);
    setPendingResume(null);
    setSaveStatus("");
    await writePreference("openscore.pending", null);
  }
  async function exportFile(format: string) {
    if (!score) return;
    setExporting(true);
    setError("");
    try {
      await download(
        score,
        format,
        format === "pdf" ? view : view === "combined" ? "staff" : view,
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setExporting(false);
    }
  }
  async function remap() {
    if (!score) return;
    setError("");
    try {
      change(localFingering(score));
    } catch (e) {
      setError(String(e));
    }
  }
  const processing = ["uploading", "queued", "running"].includes(state),
    isFretted = score && FRETTED.includes(score.settings.mode);
  return (
    <>
      <header className="app-header">
        <a className="brand" href={import.meta.env.BASE_URL}>
          <span className="brand-icon">
            <AudioLines size={22} />
          </span>
          {NAME}
          <span className="beta">BETA</span>
        </a>
        <div className="header-right">
          <span className="local-label">
            <span className={health ? "status-dot" : "status-dot offline"} />
            {health
              ? "Transcription server connected"
              : "Offline / server unavailable"}
          </span>
          <a
            href="https://github.com/spotify/basic-pitch"
            target="_blank"
            rel="noreferrer"
            className="text-link"
          >
            Powered by open source <ChevronRight size={14} />
          </a>
          <button
            className="icon-button"
            onClick={() => setDark(!dark)}
            aria-label="Toggle color theme"
          >
            {dark ? <Sun size={19} /> : <Moon size={19} />}
          </button>
        </div>
      </header>
      {!isNative && <PwaControls beforeUpdate={saveDraft} onError={setError} />}
      <main className={score ? "workspace" : "home"}>
        {error && (
          <div className="error-banner no-print" role="alert">
            <span>{error}</span>
            <button aria-label="Dismiss error" onClick={() => setError("")}>
              <X size={17} />
            </button>
          </div>
        )}
        {!score && !processing && (
          <>
            <Connection
              changed={() => setConnectionVersion((v) => v + 1)}
              onError={setError}
            />
            <Library open={openSaved} onError={setError} />
            {pendingResume && (
              <div className="pending-job">
                <p>
                  A previous transcription may still be running on your server.
                </p>
                <button
                  onClick={() => {
                    setJob(pendingResume);
                    setState("queued");
                    setStage("Reconnecting to the existing job");
                  }}
                >
                  Resume pending transcription
                </button>
                <button
                  onClick={() => {
                    setPendingResume(null);
                    void writePreference("openscore.pending", null);
                  }}
                >
                  Forget job link
                </button>
              </div>
            )}
            <div className="intro">
              <div className="pill">
                <span /> FROM RECORDING TO REHEARSAL
              </div>
              <h1>
                Your music.
                <br />
                <em>On your terms.</em>
              </h1>
              <p>
                Turn a recording into sheet music you can play.
                <br />
                Transcribe, fine-tune, and make it your own.
              </p>
            </div>
            <div className="workflow-label">
              <span className="step-count">01</span>
              <strong>Bring your sound</strong>
              <span className="workflow-line" />
              <span className="step-count muted">02</span>
              <span className="muted">Make it playable</span>
            </div>
            <div className="setup-grid">
              <section className="panel upload-panel">
                <div className="panel-title">
                  <FileAudio size={18} />
                  <h2>Your recording</h2>
                  <span className="tag">AUDIO INPUT</span>
                </div>
                <div
                  className="source-tabs"
                  role="tablist"
                  aria-label="Audio source"
                >
                  {(
                    [
                      ["file", "Upload file", Upload],
                      ["link", "YouTube link", Link2],
                      ["search", "Search song", Search],
                    ] as const
                  ).map(([id, label, Icon]) => (
                    <button
                      key={id}
                      role="tab"
                      aria-selected={source === id}
                      className={source === id ? "selected" : ""}
                      onClick={() => chooseSource(id)}
                    >
                      <Icon size={15} /> {label}
                    </button>
                  ))}
                </div>
                {source !== "file" && health && !health.online_sources && (
                  <p className="field-help">
                    This server has YouTube links and song search turned off.
                    Upload a file instead.
                  </p>
                )}
                {source === "link" && (
                  <div className="online-source">
                    <label>
                      YouTube video link
                      <input
                        type="url"
                        inputMode="url"
                        placeholder="https://www.youtube.com/watch?v=..."
                        value={link}
                        onChange={(e) => setLink(e.target.value)}
                      />
                    </label>
                    <small>
                      Paste a single video. Playlists and channels are not
                      supported.
                    </small>
                  </div>
                )}
                {source === "search" && (
                  <div className="online-source">
                    <form
                      className="search-row"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void runSearch();
                      }}
                    >
                      <input
                        type="search"
                        placeholder="Song title and artist"
                        aria-label="Song name"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                      <button
                        className="primary"
                        disabled={searching || query.trim().length < 2}
                      >
                        {searching ? (
                          <LoaderCircle size={16} className="spin" />
                        ) : (
                          <Search size={16} />
                        )}{" "}
                        Search
                      </button>
                    </form>
                    {results.length > 0 && (
                      <ul className="search-results">
                        {results.map((r) => {
                          const tooLong =
                            !!health &&
                            !!r.duration &&
                            r.duration > health.max_duration;
                          return (
                            <li key={r.id}>
                              <button
                                className={
                                  picked?.id === r.id ? "selected" : ""
                                }
                                disabled={tooLong}
                                onClick={() => setPicked(r)}
                              >
                                <img
                                  src={r.thumbnail}
                                  alt=""
                                  loading="lazy"
                                  referrerPolicy="no-referrer"
                                />
                                <span>
                                  <strong>{r.title}</strong>
                                  <small>
                                    {r.channel}
                                    {r.duration
                                      ? ` · ${formatTime(r.duration)}`
                                      : ""}
                                    {tooLong
                                      ? " · too long for this server"
                                      : ""}
                                  </small>
                                </span>
                                {picked?.id === r.id && <Check size={16} />}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                )}
                {source !== "file" && (
                  <div className="segment-fields">
                    <label>
                      Start (seconds)
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={settings.start}
                        onChange={(e) => config({ start: +e.target.value })}
                      />
                    </label>
                    <label>
                      End (seconds)
                      <input
                        type="number"
                        min={0}
                        step={1}
                        placeholder="Whole song"
                        value={settings.end ?? ""}
                        onChange={(e) =>
                          config({
                            end: e.target.value ? +e.target.value : null,
                          })
                        }
                      />
                    </label>
                  </div>
                )}
                {source === "file" && (
                  <>
                    <div
                      className={`dropzone ${drag ? "dragging" : ""} ${file ? "has-file" : ""}`}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setDrag(true);
                      }}
                      onDragLeave={() => setDrag(false)}
                      onDrop={(e) => {
                        e.preventDefault();
                        setDrag(false);
                        if (e.dataTransfer.files[0])
                          void selectFile(e.dataTransfer.files[0]);
                      }}
                    >
                      <input
                        ref={input}
                        type="file"
                        accept="audio/*,.mp3,.wav,.flac,.m4a,.ogg"
                        onChange={(e) => {
                          if (e.target.files?.[0])
                            void selectFile(e.target.files[0]);
                        }}
                        hidden
                      />
                      {file ? (
                        <>
                          <span className="upload-icon">
                            <FileAudio size={30} />
                          </span>
                          <h3>{file.name}</h3>
                          <p>
                            {(file.size / 1024 / 1024).toFixed(2)} MB{" "}
                            {duration !== null &&
                              ` · ${duration.toFixed(1)} seconds`}
                          </p>
                          <button onClick={() => input.current?.click()}>
                            Choose a different file
                          </button>
                        </>
                      ) : (
                        <>
                          <span className="upload-icon">
                            <Upload size={30} />
                          </span>
                          <h3>Drop your track here</h3>
                          <p>
                            or{" "}
                            <button
                              className="inline-link"
                              onClick={() => input.current?.click()}
                            >
                              browse files
                            </button>{" "}
                            from your device
                          </p>
                          <div className="format-list">
                            {["MP3", "WAV", "FLAC", "M4A", "OGG"].map((f) => (
                              <span key={f}>{f}</span>
                            ))}
                          </div>
                        </>
                      )}
                      <small>
                        Up to {health?.max_upload_mb || 50} MB ·{" "}
                        {formatTime(health?.max_duration || 480)} minutes
                      </small>
                    </div>
                    {file && (
                      <div className="audio-preview">
                        {peaks.length > 0 && <Waveform peaks={peaks} />}
                        <audio
                          controls
                          src={url || undefined}
                          onLoadedMetadata={(e) =>
                            setDuration(e.currentTarget.duration)
                          }
                        />
                        <div className="segment-fields">
                          <label>
                            Start (seconds)
                            <input
                              type="number"
                              min={0}
                              step={0.1}
                              value={settings.start}
                              onChange={(e) =>
                                config({ start: +e.target.value })
                              }
                            />
                          </label>
                          <label>
                            End (seconds)
                            <input
                              type="number"
                              min={0}
                              step={0.1}
                              placeholder="Full recording"
                              value={settings.end ?? ""}
                              onChange={(e) =>
                                config({
                                  end: e.target.value ? +e.target.value : null,
                                })
                              }
                            />
                          </label>
                        </div>
                      </div>
                    )}
                  </>
                )}
                <div className="tip">
                  <Music2 size={18} />
                  <p>
                    <strong>A little clarity goes a long way.</strong>
                    <br />
                    Full songs work best with instrument isolation turned on.
                    Solo, clean recordings give the most accurate notes.
                  </p>
                </div>
                <div className="privacy">
                  <ShieldCheck size={15} /> Temporary processing. No accounts.
                  No paid AI APIs.
                </div>
              </section>
              <section className="panel settings-panel">
                <div className="panel-title">
                  <SlidersHorizontal size={18} />
                  <h2>Make it playable</h2>
                  <span className="tag">OUTPUT</span>
                </div>
                <label className="field-label">Transcription mode</label>
                <div className="mode-grid">
                  {modes.map((m) => (
                    <button
                      key={m.id}
                      className={`mode-card ${settings.mode === m.id ? "selected" : ""}`}
                      onClick={() => mode(m.id)}
                    >
                      {FRETTED.includes(m.id) ? (
                        <Guitar size={21} />
                      ) : (
                        <Music2 size={21} />
                      )}
                      <span>
                        <strong>{m.name}</strong>
                        <small>{m.description}</small>
                      </span>
                      {settings.mode === m.id && <Check size={15} />}
                    </button>
                  ))}
                </div>
                <label>
                  Instrument
                  <select
                    value={settings.instrument}
                    onChange={(e) => config({ instrument: e.target.value })}
                  >
                    {[
                      ...new Set(
                        settings.mode === "melody"
                          ? [settings.instrument, ...melodyInstruments]
                          : [
                              settings.instrument,
                              presets[settings.mode].instrument,
                              "Other",
                            ],
                      ),
                    ].map((i) => (
                      <option key={i}>{i}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Detection engine
                  <select
                    value={settings.engine}
                    onChange={(e) =>
                      config({ engine: e.target.value as Settings["engine"] })
                    }
                  >
                    <option value="pyin" disabled={settings.mode === "piano"}>
                      pYIN · isolated melody · lightweight
                    </option>
                    <option value="basic_pitch" disabled={!health?.basic_pitch}>
                      Basic Pitch · polyphonic AI
                      {!health
                        ? " · server offline"
                        : !health.basic_pitch
                          ? " · not installed"
                          : ""}
                    </option>
                  </select>
                </label>
                <p className="field-help">
                  {settings.engine === "pyin"
                    ? "Tracks one pitch at a time. Chords and full-band lead isolation are not supported."
                    : "Detects simultaneous pitches and chords."}
                </p>
                <label>
                  Isolate instrument from a full mix
                  <select
                    value={settings.separate}
                    onChange={(e) =>
                      config({ separate: e.target.value as Stem })
                    }
                  >
                    {stems.map((s) => (
                      <option
                        key={s.id}
                        value={s.id}
                        disabled={s.id !== "none" && !health?.separation}
                      >
                        {s.name}
                        {s.id !== "none" && health && !health.separation
                          ? " · not installed"
                          : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="field-help">
                  {settings.separate === "none"
                    ? "Use Off for recordings of one instrument. For band recordings and YouTube songs, pick the part you want to play."
                    : "An AI model (Demucs) separates this part from the band before notes are detected. This adds a few minutes on CPU."}
                </p>
                <details className="advanced">
                  <summary>
                    <Settings2 size={16} /> Fine-tune settings{" "}
                    <span>Optional</span>
                  </summary>
                  <div className="advanced-grid">
                    <label>
                      Tempo (BPM)
                      <input
                        type="number"
                        min={30}
                        max={300}
                        placeholder="Estimate"
                        value={settings.tempo ?? ""}
                        onChange={(e) =>
                          config({
                            tempo: e.target.value ? +e.target.value : null,
                          })
                        }
                      />
                    </label>
                    <label>
                      Time signature
                      <select
                        value={`${settings.numerator}/${settings.denominator}`}
                        onChange={(e) => {
                          const [n, d] = e.target.value.split("/").map(Number);
                          config({ numerator: n, denominator: d as 4 | 8 });
                        }}
                      >
                        {["4/4", "3/4", "2/4", "6/8", "9/8", "12/8"].map(
                          (t) => (
                            <option key={t}>{t}</option>
                          ),
                        )}
                      </select>
                    </label>
                    <label>
                      Rhythm grid
                      <select
                        value={settings.grid}
                        onChange={(e) =>
                          config({ grid: +e.target.value as Settings["grid"] })
                        }
                      >
                        <option value={0.25}>Sixteenth notes</option>
                        <option value={0.5}>Eighth notes</option>
                        <option value={1}>Quarter notes</option>
                      </select>
                    </label>
                    <label>
                      Min. note (seconds)
                      <input
                        type="number"
                        min={0.04}
                        max={1}
                        step={0.01}
                        value={settings.min_duration}
                        onChange={(e) =>
                          config({ min_duration: +e.target.value })
                        }
                      />
                    </label>
                    <label>
                      Detection threshold
                      <input
                        type="range"
                        min={0.1}
                        max={0.9}
                        step={0.05}
                        value={settings.sensitivity}
                        onChange={(e) =>
                          config({ sensitivity: +e.target.value })
                        }
                      />
                      <small>
                        {settings.sensitivity.toFixed(2)} · lower detects more
                        notes
                      </small>
                    </label>
                  </div>
                  {FRETTED.includes(settings.mode) && (
                    <>
                      <label>
                        Tuning · low to high (MIDI pitches)
                        <input
                          key={settings.mode}
                          defaultValue={settings.tuning.join(", ")}
                          onBlur={(e) =>
                            config({
                              tuning: e.target.value
                                .split(",")
                                .map((v) => Number(v.trim())),
                            })
                          }
                        />
                        <small>
                          {settings.tuning.map(pitchName).join(" · ")}
                        </small>
                      </label>
                      <div className="advanced-grid">
                        <label>
                          Capo
                          <input
                            type="number"
                            min={0}
                            max={12}
                            value={settings.capo}
                            onChange={(e) => config({ capo: +e.target.value })}
                          />
                        </label>
                        <label>
                          Minimum fret
                          <input
                            type="number"
                            min={0}
                            max={24}
                            value={settings.min_fret}
                            onChange={(e) =>
                              config({ min_fret: +e.target.value })
                            }
                          />
                        </label>
                        <label>
                          Maximum fret
                          <input
                            type="number"
                            min={1}
                            max={24}
                            value={settings.max_fret}
                            onChange={(e) =>
                              config({ max_fret: +e.target.value })
                            }
                          />
                        </label>
                      </div>
                    </>
                  )}
                </details>
                <button
                  className="primary transcribe"
                  disabled={
                    !ready ||
                    (source !== "file" && !health?.online_sources) ||
                    !health ||
                    processing ||
                    (settings.engine === "basic_pitch" && !health.basic_pitch)
                  }
                  onClick={() => void submit()}
                >
                  {source === "file"
                    ? "Transcribe recording"
                    : "Transcribe song"}{" "}
                  <ArrowRight size={18} />
                </button>
                <p className="rights">
                  Only transcribe audio you have the rights or permission to
                  use. Scores are for personal practice.
                </p>
              </section>
            </div>
            <div className="feature-strip">
              <div>
                <span>01 / TRANSCRIBE</span>
                <p>Real audio. Real note detection.</p>
              </div>
              <div>
                <span>02 / REFINE</span>
                <p>Edit the notes. Find your fingering.</p>
              </div>
              <div>
                <span>03 / PLAY</span>
                <p>Practice, loop, and take it with you.</p>
              </div>
            </div>
            <p className="honest-note">
              A useful first draft, not a perfect performance. Automatic
              transcription is imperfect, especially with dense mixes, so review
              and edit the result before relying on it.
            </p>
          </>
        )}
        {processing && (
          <section className="processing panel">
            <span className="processing-ring">
              <LoaderCircle size={40} />
            </span>
            <span className="eyebrow">LISTENING CLOSELY</span>
            <h1>
              {state === "uploading"
                ? "Uploading your recording"
                : state === "queued"
                  ? "Your track is in the queue"
                  : "Turning sound into notes"}
            </h1>
            <p>{stage || "Sending audio to the local engine"}</p>
            <div className="indeterminate" />
            <p className="muted">
              Inference time depends on the recording and server. This is a
              stage indicator, not a percentage.
            </p>
            <button
              onClick={() => void reset()}
              disabled={state === "uploading"}
            >
              <X size={16} /> Cancel & delete files
            </button>
          </section>
        )}
        {score && result && (
          <>
            <div className="result-heading no-print">
              <div>
                <button className="back-button" onClick={() => void reset()}>
                  <ArrowLeft size={15} />{" "}
                  {job
                    ? "New recording · delete this job"
                    : "Back to upload & library"}
                </button>
                <span className="eyebrow">YOUR TRANSCRIPTION</span>
                <h1>{score.title}</h1>
                <p>
                  {score.settings.instrument} <span> / </span>{" "}
                  {score.notes.length} notes <span> / </span>{" "}
                  {result.audio.segment_duration.toFixed(1)}s segment
                </p>
              </div>
              <div className="button-row">
                <button onClick={() => void saveToLibrary()}>
                  Save offline
                </button>
                <button
                  onClick={async () => {
                    try {
                      await deliverFile(
                        new Blob(
                          [
                            JSON.stringify({
                              version: 1,
                              id: savedId || crypto.randomUUID(),
                              savedAt: new Date().toISOString(),
                              score,
                              audio: result.audio,
                            }),
                          ],
                          { type: "application/json" },
                        ),
                        (score.title.replace(/[^\w -]/g, "_") || "score") +
                          ".json",
                      );
                    } catch (e) {
                      setError(String(e));
                    }
                  }}
                >
                  Backup score
                </button>
                <button
                  disabled={exporting}
                  onClick={() => void exportFile("midi")}
                >
                  <Download size={16} /> MIDI
                </button>
                <button
                  disabled={exporting}
                  onClick={() => void exportFile("musicxml")}
                >
                  MusicXML
                </button>
                {isFretted && (
                  <button
                    disabled={exporting}
                    onClick={() => void exportFile("txt")}
                  >
                    ASCII tab
                  </button>
                )}
                <button
                  disabled={exporting}
                  onClick={() => void exportFile("pdf")}
                >
                  <Printer size={16} /> PDF
                </button>
                <select
                  aria-label="File format to share"
                  value={shareFormat}
                  onChange={(e) => setShareFormat(e.target.value)}
                >
                  <option value="midi">MIDI</option>
                  <option value="musicxml">MusicXML</option>
                  <option value="pdf">PDF</option>
                  {isFretted && <option value="txt">ASCII tab</option>}
                </select>
                <button
                  disabled={exporting}
                  onClick={async () => {
                    setExporting(true);
                    try {
                      await download(
                        score,
                        shareFormat,
                        view === "combined" && shareFormat !== "pdf"
                          ? "staff"
                          : view,
                        true,
                      );
                    } catch (e) {
                      if (
                        !(e instanceof DOMException && e.name === "AbortError")
                      )
                        setError(String(e));
                    } finally {
                      setExporting(false);
                    }
                  }}
                >
                  Share file
                </button>
                <small role="status">{saveStatus}</small>
              </div>
            </div>
            <div className="result-grid">
              <div className="result-main">
                <Playback score={score} onBeat={onBeat} />
                <NotationGestures zoom={zoom} onZoom={setZoom}>
                  <div className="notation-toolbar no-print">
                    <div className="tabs">
                      {["staff", ...(isFretted ? ["tab", "combined"] : [])].map(
                        (v) => (
                          <button
                            key={v}
                            className={view === v ? "active" : ""}
                            onClick={() => setView(v)}
                          >
                            {v === "staff"
                              ? "Sheet music"
                              : v === "tab"
                                ? "Tablature"
                                : "Staff + tab"}
                          </button>
                        ),
                      )}
                    </div>
                    <div className="button-row">
                      <button
                        aria-label="Zoom out"
                        onClick={() => setZoom((z) => Math.max(0.4, z - 0.1))}
                      >
                        <ZoomOut size={16} />
                      </button>
                      <span>{Math.round(zoom * 100)}%</span>
                      <button
                        aria-label="Zoom in"
                        onClick={() => setZoom((z) => Math.min(1.5, z + 0.1))}
                      >
                        <ZoomIn size={16} />
                      </button>
                    </div>
                  </div>
                  <RendererBoundary
                    recover={async () => {
                      try {
                        await saveDraft();
                        location.reload();
                      } catch (e) {
                        setError(String(e));
                      }
                    }}
                  >
                    <Suspense
                      fallback={
                        <div className="score-paper">
                          Loading notation renderer…
                        </div>
                      }
                    >
                      <ScoreView
                        score={score}
                        view={view === "combined" ? "staff" : view}
                        zoom={zoom}
                        beat={beat}
                      />
                      {view === "combined" && (
                        <ScoreView
                          score={score}
                          view="tab"
                          zoom={zoom}
                          beat={beat}
                        />
                      )}
                    </Suspense>
                  </RendererBoundary>
                </NotationGestures>
                <Editor
                  score={score}
                  change={change}
                  beat={beat}
                  canUndo={past.length > 0}
                  canRedo={future.length > 0}
                  undo={() => {
                    if (!past.length) return;
                    setFuture((f) => [score, ...f]);
                    setScore(past[past.length - 1]);
                    setPast((p) => p.slice(0, -1));
                  }}
                  redo={() => {
                    if (!future.length) return;
                    setPast((p) => [...p, score]);
                    setScore(future[0]);
                    setFuture((f) => f.slice(1));
                  }}
                />
              </div>
              <aside className="result-sidebar no-print">
                <section className="panel">
                  <h3>Recording</h3>
                  <Waveform peaks={result.audio.waveform} />
                  {job ? (
                    <audio controls src={transcriptionEngine.audioUrl(job)} />
                  ) : (
                    <p className="field-help">
                      Offline score: original audio was not retained. Synth
                      playback is available.
                    </p>
                  )}
                  {job && (
                    <>
                      <p className="field-help">
                        Original selected segment. Compare by ear; synth
                        controls are independent.
                      </p>
                      <p className="privacy">
                        Audio and job files expire automatically. Use “New
                        recording” to delete now.
                      </p>
                    </>
                  )}
                </section>
                <section className="panel">
                  <h3>Score settings</h3>
                  <label>
                    Title
                    <input
                      value={score.title}
                      maxLength={120}
                      onChange={(e) =>
                        change({ ...score, title: e.target.value })
                      }
                    />
                  </label>
                  <div className="advanced-grid">
                    <label>
                      Tempo
                      <input
                        type="number"
                        min={30}
                        max={300}
                        value={score.tempo}
                        onChange={(e) =>
                          change({
                            ...score,
                            tempo: Math.max(30, Math.min(300, +e.target.value)),
                          })
                        }
                      />
                    </label>
                    <label>
                      Meter
                      <select
                        value={`${score.settings.numerator}/${score.settings.denominator}`}
                        onChange={(e) => {
                          const [n, d] = e.target.value.split("/").map(Number);
                          change({
                            ...score,
                            settings: {
                              ...score.settings,
                              numerator: n,
                              denominator: d as 4 | 8,
                            },
                          });
                        }}
                      >
                        {["4/4", "3/4", "2/4", "6/8", "9/8", "12/8"].map(
                          (t) => (
                            <option key={t}>{t}</option>
                          ),
                        )}
                      </select>
                    </label>
                  </div>
                  <label>
                    Key signature
                    <select
                      value={score.key}
                      onChange={(e) =>
                        change({ ...score, key: +e.target.value })
                      }
                    >
                      {[
                        "C♭ / A♭m",
                        "G♭ / E♭m",
                        "D♭ / B♭m",
                        "A♭ / Fm",
                        "E♭ / Cm",
                        "B♭ / Gm",
                        "F / Dm",
                        "C / Am",
                        "G / Em",
                        "D / Bm",
                        "A / F♯m",
                        "E / C♯m",
                        "B / G♯m",
                        "F♯ / D♯m",
                        "C♯ / A♯m",
                      ].map((k, i) => (
                        <option value={i - 7} key={k}>
                          {k}
                        </option>
                      ))}
                    </select>
                  </label>
                  {isFretted && (
                    <>
                      <button onClick={() => setEditTab(!editTab)}>
                        <Settings2 size={15} /> Fingering settings
                      </button>
                      {editTab && (
                        <>
                          <label>
                            Tuning (low to high MIDI)
                            <input
                              defaultValue={score.settings.tuning.join(",")}
                              onBlur={(e) =>
                                change({
                                  ...score,
                                  settings: {
                                    ...score.settings,
                                    tuning: e.target.value
                                      .split(",")
                                      .map(Number),
                                  },
                                  notes: score.notes.map((n) => ({
                                    ...n,
                                    string: null,
                                    fret: null,
                                  })),
                                })
                              }
                            />
                          </label>
                          {(["capo", "min_fret", "max_fret"] as const).map(
                            (k) => (
                              <label key={k}>
                                {k.replace("_", " ")}
                                <input
                                  type="number"
                                  min={0}
                                  max={24}
                                  value={score.settings[k]}
                                  onChange={(e) =>
                                    change({
                                      ...score,
                                      settings: {
                                        ...score.settings,
                                        [k]: +e.target.value,
                                      },
                                      notes: score.notes.map((n) => ({
                                        ...n,
                                        string: null,
                                        fret: null,
                                      })),
                                    })
                                  }
                                />
                              </label>
                            ),
                          )}
                        </>
                      )}
                      <button className="wide" onClick={() => void remap()}>
                        <RefreshCw size={15} /> Recalculate fingerings
                      </button>
                    </>
                  )}
                </section>
                <details className="panel limitations" open>
                  <summary>Review before you play</summary>
                  {score.warnings.map((w, i) => (
                    <p key={i}>{w}</p>
                  ))}
                </details>
              </aside>
            </div>
          </>
        )}
      </main>
      <footer className="app-footer">
        <span>
          <AudioLines size={15} />
          {NAME}
        </span>
        <Licenses onError={setError} />
        <span>Open source. Open possibilities.</span>
        <span>Made for the music you make.</span>
      </footer>
    </>
  );
}
