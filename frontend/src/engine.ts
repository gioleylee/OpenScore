import type { Result, Settings } from "./types";
import { apiAddress } from "./platform";

export interface EngineHealth {
  basic_pitch: boolean;
  max_duration: number;
  max_upload_mb: number;
  online_sources?: boolean;
  separation?: boolean;
}
export interface SearchResult {
  id: string;
  url: string;
  title: string;
  channel: string;
  duration: number | null;
  thumbnail: string;
}
export interface JobStatus {
  id: string;
  state: "queued" | "running" | "done" | "failed";
  stage: string;
  error?: string;
}
/** Implement this interface for a future real on-device provider. No such
 * provider is shipped; local engraving/playback are not AI transcription. */
export interface TranscriptionEngine {
  readonly id: string;
  readonly offlineInference: boolean;
  health(): Promise<EngineHealth>;
  submit(file: File, settings: Settings): Promise<{ id: string }>;
  submitLink(url: string, settings: Settings): Promise<{ id: string }>;
  search(query: string): Promise<SearchResult[]>;
  status(id: string): Promise<JobStatus>;
  result(id: string): Promise<Result>;
  cancel(id: string): Promise<void>;
  audioUrl(id: string): string;
}
export async function serverRequest(path: string, options?: RequestInit) {
  const response = await fetch(apiAddress(path), {
    ...options,
    signal: options?.signal || AbortSignal.timeout(45000),
  });
  if (!response.ok) {
    const body = await response.text();
    let message = body;
    try {
      message = JSON.parse(body).detail || body;
    } catch {
      /* Plain HTTP error. */
    }
    throw new Error(
      typeof message === "string" ? message : JSON.stringify(message),
    );
  }
  return response;
}
export class ServerTranscriptionEngine implements TranscriptionEngine {
  readonly id = "server";
  readonly offlineInference = false;
  async health() {
    return (await serverRequest("/api/health")).json() as Promise<EngineHealth>;
  }
  async submit(file: File, settings: Settings) {
    const body = new FormData();
    body.append("file", file);
    body.append("settings", JSON.stringify(settings));
    return (
      await serverRequest("/api/jobs", { method: "POST", body })
    ).json() as Promise<{ id: string }>;
  }
  async submitLink(url: string, settings: Settings) {
    return (
      await serverRequest("/api/jobs/online", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, settings }),
      })
    ).json() as Promise<{ id: string }>;
  }
  async search(query: string) {
    const body = (await (
      await serverRequest("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      })
    ).json()) as { results: SearchResult[] };
    return body.results;
  }
  async status(id: string) {
    return (
      await serverRequest(`/api/jobs/${encodeURIComponent(id)}`)
    ).json() as Promise<JobStatus>;
  }
  async result(id: string) {
    return (
      await serverRequest(`/api/jobs/${encodeURIComponent(id)}/result`)
    ).json() as Promise<Result>;
  }
  async cancel(id: string) {
    await serverRequest(`/api/jobs/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  }
  audioUrl(id: string) {
    return apiAddress(`/api/jobs/${encodeURIComponent(id)}/audio`);
  }
}
export const transcriptionEngine: TranscriptionEngine =
  new ServerTranscriptionEngine();
