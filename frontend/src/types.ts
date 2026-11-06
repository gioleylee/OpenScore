export type Mode =
  | "melody"
  | "piano"
  | "guitar"
  | "bass"
  | "ukulele"
  | "violin";
export type Stem = "none" | "vocals" | "bass" | "guitar" | "piano" | "other";
/** Instruments whose notes are mapped to strings (tab and fingering). */
export const FRETTED: Mode[] = ["guitar", "bass", "ukulele", "violin"];
/** Suggested violin finger (0 = open string) for semitones above the string,
 * using 1st, 3rd, 5th, 7th, 8th and 10th position as commonly taught. */
export function violinFinger(semitones: number) {
  if (semitones <= 0) return 0;
  if (semitones === 1) return 1;
  for (const first of [2, 5, 9, 12, 14, 17])
    if (semitones >= first && semitones <= first + 5)
      return [1, 2, 2, 3, 3, 4][semitones - first];
  return 4;
}
export interface Settings {
  mode: Mode;
  engine: "pyin" | "basic_pitch";
  instrument: string;
  start: number;
  end: number | null;
  tempo: number | null;
  numerator: number;
  denominator: 4 | 8;
  grid: 0.25 | 0.5 | 1;
  min_duration: number;
  sensitivity: number;
  tuning: number[];
  capo: number;
  min_fret: number;
  max_fret: number;
  separate: Stem;
}
export interface Note {
  id: string;
  pitch: number;
  onset: number;
  duration: number;
  velocity: number;
  string: number | null;
  fret: number | null;
}
export interface Score {
  title: string;
  tempo: number;
  key: number;
  settings: Settings;
  notes: Note[];
  warnings: string[];
}
export interface Result {
  score: Score;
  audio: {
    duration: number;
    segment_duration: number;
    segment_start: number;
    waveform: number[];
  };
}
export const defaults: Settings = {
  mode: "melody",
  engine: "pyin",
  instrument: "Voice",
  start: 0,
  end: null,
  tempo: null,
  numerator: 4,
  denominator: 4,
  grid: 0.25,
  min_duration: 0.09,
  sensitivity: 0.3,
  tuning: [40, 45, 50, 55, 59, 64],
  capo: 0,
  min_fret: 0,
  max_fret: 20,
  separate: "none",
};
export const pitchName = (p: number) =>
  ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"][
    ((p % 12) + 12) % 12
  ] +
  (Math.floor(p / 12) - 1);
