import "fake-indexeddb/auto";
import { describe, it, expect, vi } from "vitest";
import { localMidi, localMusicXml, localAsciiTab } from "./localExports";
import { localFingering } from "./localFingering";
import {
  saveTranscription,
  listTranscriptions,
  deleteTranscription,
  validateSaved,
  type SavedTranscription,
} from "./storage";
import { defaults, type Score } from "./types";
import { ServerTranscriptionEngine } from "./engine";
const score: Score = {
  title: "A & B <script>",
  tempo: 120,
  key: 0,
  settings: { ...defaults, mode: "guitar" },
  warnings: [],
  notes: [
    {
      id: "n1",
      pitch: 64,
      onset: 0,
      duration: 5,
      velocity: 90,
      string: 1,
      fret: 0,
    },
    {
      id: "n2",
      pitch: 67,
      onset: 1,
      duration: 1,
      velocity: 80,
      string: 2,
      fret: 8,
    },
  ],
};
function saved(id = crypto.randomUUID()): SavedTranscription {
  return {
    version: 1,
    id,
    savedAt: new Date().toISOString(),
    score: structuredClone(score),
    audio: {
      duration: 3,
      segment_duration: 3,
      segment_start: 0,
      waveform: [0.4, 0.8],
    },
  };
}
describe("offline source of truth", () => {
  it("persists an edited score transactionally in IndexedDB and removes it", async () => {
    const item = saved();
    item.score.notes[0].pitch = 65;
    item.score.notes[0].string = null;
    item.score.notes[0].fret = null;
    await saveTranscription(item);
    const result = (await listTranscriptions()).find((s) => s.id === item.id)!;
    expect(result.score.notes[0].pitch).toBe(65);
    await deleteTranscription(item.id);
    expect((await listTranscriptions()).some((s) => s.id === item.id)).toBe(
      false,
    );
  });
  it("preserves concurrent saves and last-session recovery", async () => {
    const a = saved(),
      b = saved();
    await Promise.all([
      saveTranscription(a),
      saveTranscription(b),
      saveTranscription({ ...saved(), id: "draft" }),
    ]);
    const items = await listTranscriptions();
    expect(items.map((i) => i.id)).toEqual(
      expect.arrayContaining([a.id, b.id, "draft"]),
    );
    await Promise.all(items.map((i) => deleteTranscription(i.id)));
  });
  it("rejects malformed backups, NaN timing and injected technical notation", () => {
    expect(() => validateSaved({ ...saved(), version: 2 })).toThrow();
    const bad = saved();
    bad.score.notes[0].onset = NaN;
    expect(() => validateSaved(bad)).toThrow();
    const injection = saved();
    (injection.score.notes[0] as unknown as { string: string }).string =
      "</string>";
    expect(() => validateSaved(injection)).toThrow();
  });
  it("engraves independent voices, rests, escaped titles and cross-bar ties locally", () => {
    const xml = localMusicXml(score);
    expect(xml).toContain("A &amp; B &lt;script&gt;");
    expect(xml).toContain("<backup>");
    expect(xml).toContain("<rest/>");
    expect(xml).toContain('<tie type="start"/>');
    expect(xml).toContain('<tie type="stop"/>');
    expect(xml).toContain('<measure number="2">');
    expect(localMusicXml(score, "tab")).toContain(
      "<string>1</string><fret>0</fret>",
    );
  });
  it("writes real MIDI bytes with edited pitch and declared track size", () => {
    const edited = { ...score, notes: [{ ...score.notes[0], pitch: 72 }] };
    const bytes = localMidi(edited);
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("MThd");
    const view = new DataView(bytes.buffer);
    expect(view.getUint16(12)).toBe(960);
    expect(view.getUint32(18)).toBe(bytes.length - 22);
    expect([...bytes]).toEqual(expect.arrayContaining([144, 72, 90]));
  });
  it("optimizes alternate tuning/capo offline and respects sustained strings", () => {
    const bass: Score = {
      ...score,
      settings: {
        ...defaults,
        mode: "bass",
        tuning: [28, 33, 38, 43],
        capo: 2,
        max_fret: 4,
      },
      notes: [
        {
          ...score.notes[0],
          id: "a",
          pitch: 30,
          onset: 0,
          duration: 4,
          string: null,
          fret: null,
        },
        {
          ...score.notes[1],
          id: "b",
          pitch: 31,
          onset: 1,
          string: null,
          fret: null,
        },
      ],
    };
    const result = localFingering(bass);
    expect(result.notes[0].string).toBe(4);
    expect(result.notes[0].fret).toBe(0);
    expect(result.notes[1].string).toBeNull();
    expect(localAsciiTab(result)).toContain("? unmapped");
  });
  it("fails failed inference honestly, and advertises no offline AI", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ detail: "Inference failed" }), {
          status: 500,
        }),
      ),
    );
    const engine = new ServerTranscriptionEngine();
    expect(engine.offlineInference).toBe(false);
    await expect(engine.health()).rejects.toThrow("Inference failed");
    vi.unstubAllGlobals();
  });
});
