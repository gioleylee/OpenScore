import { it, expect, vi } from "vitest";
import { defaults } from "./types";
it("commits complete Android revisions before the index and serializes concurrent updates", async () => {
  const files = new Map<string, string>(),
    preferences = new Map<string, string>(),
    events: string[] = [];
  vi.doMock("./platform", () => ({ isNative: true }));
  vi.doMock("@capacitor/filesystem", () => ({
    Directory: { Data: "DATA" },
    Encoding: { UTF8: "UTF8" },
    Filesystem: {
      writeFile: vi.fn(
        async ({ path, data }: { path: string; data: string }) => {
          events.push("file");
          files.set(path, data);
          return { uri: path };
        },
      ),
      deleteFile: vi.fn(async ({ path }: { path: string }) => {
        files.delete(path);
      }),
      readFile: vi.fn(async ({ path }: { path: string }) => ({
        data: files.get(path),
      })),
    },
  }));
  vi.doMock("@capacitor/preferences", () => ({
    Preferences: {
      get: vi.fn(async ({ key }: { key: string }) => ({
        value: preferences.get(key) || null,
      })),
      set: vi.fn(async ({ key, value }: { key: string; value: string }) => {
        events.push("index");
        preferences.set(key, value);
      }),
    },
  }));
  const { saveTranscription, listTranscriptions, deleteTranscription } =
    await import("./storage");
  const item = {
    version: 1 as const,
    id: crypto.randomUUID(),
    savedAt: new Date().toISOString(),
    score: {
      title: "Android saved score",
      tempo: 120,
      key: 0,
      settings: defaults,
      notes: [],
      warnings: [],
    },
    audio: { duration: 1, segment_duration: 1, segment_start: 0, waveform: [] },
  };
  const second = { ...item, id: crypto.randomUUID() };
  await Promise.all([saveTranscription(item), saveTranscription(second)]);
  expect(events).toEqual(["file", "index", "file", "index"]);
  expect(await listTranscriptions()).toHaveLength(2);
  await saveTranscription({
    ...item,
    score: { ...item.score, title: "Edited" },
  });
  expect(files.size).toBe(2);
  expect(
    (await listTranscriptions()).find((s) => s.id === item.id)?.score.title,
  ).toBe("Edited");
  await deleteTranscription(item.id);
  expect(files.size).toBe(1);
  expect(await listTranscriptions()).toHaveLength(1);
  vi.doUnmock("./platform");
  vi.doUnmock("@capacitor/filesystem");
  vi.doUnmock("@capacitor/preferences");
});
