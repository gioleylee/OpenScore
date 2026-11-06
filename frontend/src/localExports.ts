import type { Note, Score } from "./types";
const DIV = 960;
const escapeXml = (v: unknown) =>
  String(v).replace(
    /[<>&"']/g,
    (c) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
const tick = (beat: number) => Math.round(beat * DIV);
const spelling = (pitch: number) => {
  const index = pitch % 12;
  return {
    step: ["C", "C", "D", "D", "E", "F", "F", "G", "G", "A", "A", "B"][index],
    alter: [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0][index],
    octave: Math.floor(pitch / 12) - 1,
  };
};
function pitchXml(pitch: number) {
  const p = spelling(pitch);
  return `<step>${p.step}</step>${p.alter ? "<alter>1</alter>" : ""}<octave>${p.octave}</octave>`;
}
const lengths: [number, string][] = [
  [3840, "whole"],
  [1920, "half"],
  [960, "quarter"],
  [480, "eighth"],
  [240, "16th"],
  [120, "32nd"],
  [60, "64th"],
];
function fragments(length: number) {
  const out: { ticks: number; type?: string }[] = [];
  while (length > 0) {
    const candidate = lengths.find(([n]) => n <= length);
    if (!candidate) {
      out.push({ ticks: length });
      break;
    }
    out.push({ ticks: candidate[0], type: candidate[1] });
    length -= candidate[0];
  }
  return out;
}
function eventXml(
  n: Note | null,
  start: number,
  end: number,
  voice: number,
  tab: boolean,
) {
  const pieces = fragments(end - start);
  let position = start;
  return pieces
    .map((piece) => {
      const stopped = !!n && position > tick(n.onset),
        continued = !!n && position + piece.ticks < tick(n.onset + n.duration);
      const ties = n
        ? `${stopped ? '<tie type="stop"/>' : ""}${continued ? '<tie type="start"/>' : ""}`
        : "";
      const notation =
        n && (stopped || continued || tab)
          ? `<notations>${stopped ? '<tied type="stop"/>' : ""}${continued ? '<tied type="start"/>' : ""}${tab && n.string !== null ? `<technical><string>${n.string}</string><fret>${n.fret}</fret></technical>` : ""}</notations>`
          : "";
      position += piece.ticks;
      return `<note>${n ? `<pitch>${pitchXml(n.pitch)}</pitch>` : "<rest/>"}<duration>${piece.ticks}</duration>${ties}<voice>${voice}</voice>${piece.type ? `<type>${piece.type}</type>` : ""}${notation}${tab && n && n.string === null ? "<lyric><text>?</text></lyric>" : ""}</note>`;
    })
    .join("");
}
/** Local score engraving. Independent voices preserve polyphonic durations;
 * ties split notes at measures. No audio inference occurs in this module. */
export function localMusicXml(score: Score, view = "staff") {
  const tab =
      view === "tab" &&
      ["guitar", "bass", "ukulele"].includes(score.settings.mode),
    s = score.settings;
  const partitions =
    s.mode === "piano"
      ? [
          score.notes.filter((n) => n.pitch >= 60),
          score.notes.filter((n) => n.pitch < 60),
        ]
      : [score.notes];
  const bar = ((s.numerator * 4) / s.denominator) * DIV,
    end = Math.max(bar, ...score.notes.map((n) => tick(n.onset + n.duration))),
    measureCount = Math.ceil(end / bar);
  if (measureCount > 300)
    throw new Error(
      "Too many measures for local engraving; shorten the timeline.",
    );
  const parts = partitions.map((notes, index) => {
    const voices: Note[][] = [],
      ends: number[] = [];
    for (const n of [...notes].sort(
      (a, b) => a.onset - b.onset || a.pitch - b.pitch,
    )) {
      let vi = ends.findIndex((end) => end <= tick(n.onset));
      if (vi === -1) {
        vi = ends.length;
        voices.push([]);
        ends.push(0);
      }
      if (vi >= 16) throw new Error("Too many overlapping notes to engrave.");
      voices[vi].push(n);
      ends[vi] = tick(n.onset + n.duration);
    }
    if (!voices.length) voices.push([]);
    return `<part id="P${index + 1}">${Array.from(
      { length: measureCount },
      (_, m) => {
        const from = m * bar,
          to = from + bar;
        const attributes =
          m === 0
            ? `<attributes><divisions>${DIV}</divisions><key><fifths>${score.key}</fifths></key><time><beats>${s.numerator}</beats><beat-type>${s.denominator}</beat-type></time><clef><sign>${tab ? "TAB" : index === 1 || s.mode === "bass" ? "F" : "G"}</sign><line>${tab ? 5 : index === 1 || s.mode === "bass" ? 4 : 2}</line></clef>${
                tab
                  ? `<staff-details><staff-lines>${s.tuning.length}</staff-lines>${s.tuning
                      .map((p, i) => {
                        const pitch = spelling(p + s.capo);
                        return `<staff-tuning line="${i + 1}"><tuning-step>${pitch.step}</tuning-step>${pitch.alter ? "<tuning-alter>1</tuning-alter>" : ""}<tuning-octave>${pitch.octave}</tuning-octave></staff-tuning>`;
                      })
                      .join("")}</staff-details>`
                  : ""
              }</attributes><direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${score.tempo}</per-minute></metronome></direction-type><sound tempo="${score.tempo}"/></direction>`
            : "";
        const body = voices
          .map((voice, vi) => {
            let cursor = from;
            let xml = vi ? `<backup><duration>${bar}</duration></backup>` : "";
            for (const n of voice) {
              const a = Math.max(from, tick(n.onset)),
                b = Math.min(to, tick(n.onset + n.duration));
              if (a >= b) continue;
              if (a > cursor) xml += eventXml(null, cursor, a, vi + 1, tab);
              xml += eventXml(n, a, b, vi + 1, tab);
              cursor = b;
            }
            if (cursor < to) xml += eventXml(null, cursor, to, vi + 1, tab);
            return xml;
          })
          .join("");
        return `<measure number="${m + 1}">${attributes}${body}</measure>`;
      },
    ).join("")}</part>`;
  });
  return `<?xml version="1.0" encoding="utf-8"?><score-partwise version="4.0"><work><work-title>${escapeXml(score.title)}</work-title></work><part-list>${partitions.map((_, i) => `<score-part id="P${i + 1}"><part-name>${escapeXml(s.instrument)}${partitions.length === 2 ? (i === 0 ? " upper" : " lower") : ""}</part-name></score-part>`).join("")}</part-list>${parts.join("")}</score-partwise>`;
}
function variable(value: number) {
  const result = [value & 127];
  while ((value >>>= 7) > 0) result.unshift((value & 127) | 128);
  return result;
}
function big(value: number, bytes: number) {
  return Array.from(
    { length: bytes },
    (_, i) => (value >>> ((bytes - i - 1) * 8)) & 255,
  );
}
export function localMidi(score: Score): Uint8Array {
  const micros = Math.round(60000000 / score.tempo),
    s = score.settings;
  const data = [
    0,
    255,
    81,
    3,
    ...big(micros, 3),
    0,
    255,
    88,
    4,
    s.numerator,
    Math.log2(s.denominator),
    24,
    8,
    0,
    192,
    s.mode === "guitar" || s.mode === "ukulele"
      ? 24
      : s.mode === "bass"
        ? 33
        : 0,
  ];
  const events = score.notes
    .flatMap((n) => [
      { at: tick(n.onset), on: 1, n },
      { at: tick(n.onset + n.duration), on: 0, n },
    ])
    .sort((a, b) => a.at - b.at || a.on - b.on || a.n.pitch - b.n.pitch);
  let previous = 0;
  for (const e of events) {
    data.push(
      ...variable(e.at - previous),
      e.on ? 144 : 128,
      e.n.pitch,
      e.on ? e.n.velocity : 0,
    );
    previous = e.at;
  }
  data.push(0, 255, 47, 0);
  return new Uint8Array([
    77,
    84,
    104,
    100,
    0,
    0,
    0,
    6,
    0,
    0,
    0,
    1,
    ...big(DIV, 2),
    77,
    84,
    114,
    107,
    ...big(data.length, 4),
    ...data,
  ]);
}
export function localAsciiTab(score: Score) {
  const groups = new Map<number, Note[]>();
  for (const n of [...score.notes].sort(
    (a, b) => a.onset - b.onset || a.pitch - b.pitch,
  ))
    groups.set(n.onset, [...(groups.get(n.onset) || []), n]);
  const items = [...groups],
    lines = [
      `${score.title}\n${score.tempo} BPM; quarter-note beats; frets relative to capo ${score.settings.capo}\n`,
    ];
  for (let offset = 0; offset < items.length; offset += 12) {
    const block = items.slice(offset, offset + 12);
    lines.push(
      "beat " + block.map(([beat]) => String(beat).padEnd(8)).join(""),
    );
    for (let string = 1; string <= score.settings.tuning.length; string++)
      lines.push(
        `${string} |` +
          block
            .map(([, notes]) =>
              String(notes.find((n) => n.string === string)?.fret ?? "-")
                .padStart(4, "-")
                .padEnd(8, "-"),
            )
            .join("") +
          "|",
      );
    const missing = block.flatMap(([beat, notes]) =>
      notes
        .filter((n) => n.string === null)
        .map((n) => `beat ${beat}: MIDI ${n.pitch}`),
    );
    if (missing.length) lines.push("? unmapped: " + missing.join("; "));
    lines.push("");
  }
  return lines.join("\n");
}
export async function localPdf(score: Score, view: string): Promise<Blob> {
  const [{ OpenSheetMusicDisplay }, { jsPDF }] = await Promise.all([
    import("opensheetmusicdisplay"),
    import("jspdf"),
  ]);
  await import("svg2pdf.js");
  const mount = document.createElement("div");
  mount.style.cssText =
    "position:fixed;left:-10000px;top:0;width:794px;background:white;";
  document.body.append(mount);
  const renderer = new OpenSheetMusicDisplay(mount, {
    backend: "svg",
    autoResize: false,
    pageFormat: "A4_P",
    drawTitle: true,
    drawSubtitle: false,
    drawComposer: false,
  });
  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  let page = 0;
  try {
    for (const type of view === "combined" ? ["staff", "tab"] : [view]) {
      await renderer.load(localMusicXml(score, type));
      renderer.Zoom = 0.8;
      renderer.render();
      const pages = mount.querySelectorAll("svg");
      if (!pages.length) throw new Error("No notation was engraved");
      if (pages.length > 40)
        throw new Error("Too many PDF pages for this device");
      for (const svg of pages) {
        if (page++) pdf.addPage();
        await pdf.svg(svg, { x: 10, y: 20, width: 190, height: 267 });
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(9);
        pdf.text(
          `${score.settings.instrument} | ${score.tempo} BPM | ${score.settings.numerator}/${score.settings.denominator} | Key signature: ${score.key} sharps`,
          10,
          12,
        );
      }
      renderer.clear();
    }
    return pdf.output("blob");
  } finally {
    renderer.clear();
    mount.remove();
  }
}
export async function localExport(
  score: Score,
  format: string,
  view = "staff",
): Promise<Blob> {
  if (format === "midi")
    return new Blob([new Uint8Array(localMidi(score))], { type: "audio/midi" });
  if (format === "musicxml")
    return new Blob([localMusicXml(score, view)], {
      type: "application/vnd.recordare.musicxml+xml",
    });
  if (format === "txt")
    return new Blob([localAsciiTab(score)], { type: "text/plain" });
  if (format === "pdf") return localPdf(score, view);
  throw new Error("Unsupported export format");
}
