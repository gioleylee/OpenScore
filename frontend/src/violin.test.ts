import { describe, expect, it } from "vitest";
import { localMusicXml } from "./localExports";
import { localFingering } from "./localFingering";
import { defaults, violinFinger, type Score } from "./types";

const twinkle = [69, 69, 76, 76, 78, 78, 76, 76];
const violin: Score = {
  title: "Twinkle",
  tempo: 100,
  key: 3,
  settings: {
    ...defaults,
    mode: "violin",
    instrument: "Violin",
    tuning: [55, 62, 69, 76],
    max_fret: 12,
  },
  notes: twinkle.map((pitch, i) => ({
    id: String(i),
    pitch,
    onset: i,
    duration: 1,
    velocity: 80,
    string: null,
    fret: null,
  })),
  warnings: [],
};

describe("violin", () => {
  it("fingers in first position and matches the server table", () => {
    const fingered = localFingering(violin);
    expect(fingered.notes.map((n) => violinFinger(n.fret!))).toEqual([
      0, 0, 0, 0, 1, 1, 0, 0,
    ]);
    expect(fingered.notes.map((n) => n.string).slice(0, 4)).toEqual([
      2, 2, 1, 1,
    ]);
    expect([0, 1, 2, 4, 5, 7, 8, 9, 12].map(violinFinger)).toEqual([
      0, 1, 1, 2, 3, 4, 3, 3, 3,
    ]);
  });
  it("writes finger numbers on the staff and a 4-line violin tab", () => {
    const fingered = localFingering(violin);
    const staff = localMusicXml(fingered, "staff");
    expect(staff).toContain("<fingering>1</fingering>");
    expect(staff).not.toContain("<string>");
    expect(localMusicXml(fingered, "tab")).toContain(
      "<staff-lines>4</staff-lines>",
    );
  });
  it("spells black keys as flats in flat keys", () => {
    const flat = {
      ...violin,
      key: -2,
      notes: [{ ...violin.notes[0], pitch: 70 }],
    };
    expect(localMusicXml(flat)).toContain(
      "<step>B</step><alter>-1</alter><octave>4</octave>",
    );
    expect(localMusicXml({ ...flat, key: 2 })).toContain(
      "<step>A</step><alter>1</alter>",
    );
  });
});
