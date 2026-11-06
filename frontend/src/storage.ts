import { Filesystem, Directory, Encoding } from "@capacitor/filesystem";
import { Preferences } from "@capacitor/preferences";
import { isNative } from "./platform";
import type { Result, Score } from "./types";

export interface SavedTranscription {
  version: 1;
  id: string;
  savedAt: string;
  score: Score;
  audio: Result["audio"];
}
const ID = /^(?:draft|[a-f0-9-]{36})$/;
export function validateSaved(value: unknown): SavedTranscription {
  if (!value || typeof value !== "object")
    throw new Error("Invalid saved transcription");
  const item = value as SavedTranscription,
    s = item.score;
  if (
    item.version !== 1 ||
    !ID.test(item.id) ||
    !s ||
    typeof s.title !== "string" ||
    s.title.length > 120 ||
    !Number.isFinite(s.tempo) ||
    s.tempo < 30 ||
    s.tempo > 300 ||
    !Array.isArray(s.notes) ||
    s.notes.length > 12000 ||
    !s.settings ||
    !["melody", "guitar", "bass", "piano", "ukulele", "violin"].includes(
      s.settings.mode,
    ) ||
    ![4, 8].includes(s.settings.denominator) ||
    !Number.isInteger(s.settings.numerator) ||
    s.settings.numerator < 2 ||
    s.settings.numerator > 12 ||
    !Array.isArray(s.settings.tuning) ||
    s.settings.tuning.length < 4 ||
    s.settings.tuning.length > 6 ||
    s.settings.tuning.some((p) => !Number.isInteger(p) || p < 20 || p > 90) ||
    !Number.isInteger(s.key) ||
    Math.abs(s.key) > 7 ||
    !item.audio ||
    !Array.isArray(item.audio.waveform) ||
    item.audio.waveform.length > 600
  )
    throw new Error(
      "Saved transcription is invalid or has an unsupported version.",
    );
  const config = s.settings;
  if (
    typeof item.savedAt !== "string" ||
    item.savedAt.length > 40 ||
    !Number.isFinite(Date.parse(item.savedAt)) ||
    typeof config.instrument !== "string" ||
    config.instrument.length > 60 ||
    !Number.isInteger(config.capo) ||
    config.capo < 0 ||
    config.capo > 12 ||
    !Number.isInteger(config.min_fret) ||
    !Number.isInteger(config.max_fret) ||
    config.min_fret < 0 ||
    config.max_fret > 24 ||
    config.min_fret > config.max_fret ||
    (config.mode === "guitar" && config.tuning.length !== 6) ||
    (config.mode === "bass" && config.tuning.length !== 4) ||
    (config.mode === "ukulele" && config.tuning.length !== 4) ||
    (config.mode === "violin" && config.tuning.length !== 4) ||
    !Array.isArray(s.warnings) ||
    s.warnings.length > 100 ||
    s.warnings.some((w) => typeof w !== "string" || w.length > 2000) ||
    item.audio.waveform.some((v) => !Number.isFinite(v) || v < 0 || v > 1) ||
    [
      item.audio.duration,
      item.audio.segment_duration,
      item.audio.segment_start,
    ].some((v) => !Number.isFinite(v) || v < 0 || v > 7200)
  )
    throw new Error("Invalid saved score metadata");
  const ids = new Set<string>();
  for (const n of s.notes) {
    if (
      typeof n.id !== "string" ||
      n.id.length > 80 ||
      ids.has(n.id) ||
      !Number.isInteger(n.pitch) ||
      n.pitch < 0 ||
      n.pitch > 127 ||
      !Number.isFinite(n.onset) ||
      n.onset < 0 ||
      n.onset > 4096 ||
      !Number.isFinite(n.duration) ||
      n.duration < 0.0625 ||
      n.duration > 128 ||
      !Number.isInteger(n.velocity) ||
      n.velocity < 1 ||
      n.velocity > 127
    )
      throw new Error("Invalid note in saved transcription");
    if (
      (n.string === null) !== (n.fret === null) ||
      (n.string !== null &&
        (!Number.isInteger(n.string) ||
          n.string < 1 ||
          n.string > config.tuning.length ||
          !Number.isInteger(n.fret) ||
          n.fret! < config.min_fret ||
          n.fret! > config.max_fret ||
          n.pitch !==
            config.tuning[-n.string + config.tuning.length] +
              config.capo +
              n.fret!))
    )
      throw new Error("Invalid saved string/fret mapping");
    ids.add(n.id);
  }
  return item;
}
let database: Promise<IDBDatabase> | undefined;
function db() {
  return (database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("openscore-library", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("scores", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));
}
async function transaction<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction("scores", mode),
      request = action(tx.objectStore("scores"));
    tx.oncomplete = () => resolve(request.result);
    tx.onabort = () => reject(tx.error || request.error);
    tx.onerror = () => reject(tx.error);
  });
}
type Index = Record<string, string>;
// Serialize native index updates so autosave/library writes cannot lose entries.
let nativeQueue: Promise<unknown> = Promise.resolve();
function nativeWrite<T>(fn: () => Promise<T>): Promise<T> {
  const next = nativeQueue.then(fn, fn);
  nativeQueue = next.catch(() => {});
  return next;
}
async function nativeIndex(): Promise<Index> {
  const index: Index = JSON.parse(
    (await Preferences.get({ key: "openscore.library.v1" })).value || "{}",
  );
  for (const [id, path] of Object.entries(index)) {
    if (
      !ID.test(id) ||
      typeof path !== "string" ||
      !/^scores\/(?:draft|[a-f0-9-]{36})-[a-f0-9-]{36}\.json$/.test(path)
    )
      throw new Error("Invalid native library index");
  }
  return index;
}
export async function saveTranscription(item: SavedTranscription) {
  validateSaved(item);
  if (!isNative) {
    await transaction("readwrite", (store) => store.put(item));
    return;
  }
  await nativeWrite(async () => {
    const index = await nativeIndex(),
      old = index[item.id],
      path = `scores/${item.id}-${crypto.randomUUID()}.json`;
    await Filesystem.writeFile({
      directory: Directory.Data,
      path,
      data: JSON.stringify(item),
      encoding: Encoding.UTF8,
      recursive: true,
    });
    // Commit the small Preferences index only after the complete revision is durable.
    await Preferences.set({
      key: "openscore.library.v1",
      value: JSON.stringify({ ...index, [item.id]: path }),
    });
    if (old)
      await Filesystem.deleteFile({
        directory: Directory.Data,
        path: old,
      }).catch(() => {});
  });
}
export async function listTranscriptions(): Promise<SavedTranscription[]> {
  let items: unknown[];
  if (!isNative)
    items = await transaction("readonly", (store) => store.getAll());
  else {
    await nativeQueue;
    const index = await nativeIndex();
    items = await Promise.all(
      Object.values(index).map(async (path) => {
        if (
          !/^scores\/[a-f0-9-]+\.json$/.test(path) &&
          !/^scores\/draft-[a-f0-9-]+\.json$/.test(path)
        )
          throw new Error("Invalid library path");
        const result = await Filesystem.readFile({
          directory: Directory.Data,
          path,
          encoding: Encoding.UTF8,
        });
        return JSON.parse(String(result.data));
      }),
    );
  }
  return items
    .map(validateSaved)
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}
export async function deleteTranscription(id: string) {
  if (!ID.test(id)) throw new Error("Invalid saved score ID");
  if (!isNative) {
    await transaction("readwrite", (store) => store.delete(id));
    return;
  }
  await nativeWrite(async () => {
    const index = await nativeIndex(),
      path = index[id];
    delete index[id];
    await Preferences.set({
      key: "openscore.library.v1",
      value: JSON.stringify(index),
    });
    if (path)
      await Filesystem.deleteFile({ directory: Directory.Data, path }).catch(
        () => {},
      );
  });
}
export async function persistPermission() {
  if (!isNative && navigator.storage?.persist)
    return navigator.storage.persist();
  return isNative;
}
