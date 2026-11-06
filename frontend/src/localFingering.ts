import type { Note, Score } from "./types";
type Choice = { string: number; fret: number };
export function localFingering(score: Score): Score {
  const s = score.settings,
    notes = score.notes.map(
      (n) => ({ ...n, string: null, fret: null }) as Note,
    ),
    groups = new Map<number, Note[]>();
  for (const n of [...notes].sort(
    (a, b) => a.onset - b.onset || a.pitch - b.pitch,
  ))
    groups.set(n.onset, [...(groups.get(n.onset) || []), n]);
  type State = {
    cost: number;
    position: number;
    occupied: Map<number, { end: number; fret: number }>;
    path: (Choice[] | null)[];
  };
  let beam: State[] = [{ cost: 0, position: 0, occupied: new Map(), path: [] }];
  for (const [onset, group] of groups) {
    const candidates = group.map((n) =>
      s.tuning.flatMap((p, i) => {
        const fret = n.pitch - p - s.capo;
        return fret >= s.min_fret && fret <= s.max_fret
          ? [{ string: s.tuning.length - i, fret }]
          : [];
      }),
    );
    const assignments: Choice[][] = [];
    function visit(index: number, combo: Choice[]) {
      if (index === group.length) {
        assignments.push(combo);
        return;
      }
      for (const c of candidates[index]) {
        if (combo.some((x) => x.string === c.string)) continue;
        const frets = [...combo, c].map((x) => x.fret).filter(Boolean);
        if (
          frets.length &&
          (Math.max(...frets) - Math.min(...frets) > 4 ||
            new Set(frets).size > 4)
        )
          continue;
        visit(index + 1, [...combo, c]);
      }
    }
    if (group.length <= s.tuning.length) visit(0, []);
    const next: State[] = [];
    for (const state of beam) {
      const live = new Map(
        [...state.occupied].filter(([, v]) => v.end > onset + 1e-6),
      );
      for (const combo of assignments) {
        if (combo.some((c) => live.has(c.string))) continue;
        const frets = [
          ...combo.map((c) => c.fret),
          ...[...live.values()].map((v) => v.fret),
        ].filter(Boolean);
        const span = frets.length ? Math.max(...frets) - Math.min(...frets) : 0;
        if (span > 4 || new Set(frets).size > 4) continue;
        const position = frets.length
            ? frets.reduce((a, b) => a + b, 0) / frets.length
            : state.position,
          occupied = new Map(live);
        combo.forEach((c, i) =>
          occupied.set(c.string, {
            end: onset + group[i].duration,
            fret: c.fret,
          }),
        );
        next.push({
          cost:
            state.cost +
            Math.abs(position - state.position) * 1.5 +
            span ** 2 * 0.5 +
            combo.reduce((a, c) => a + c.fret * 0.03, 0),
          position,
          occupied,
          path: [...state.path, combo],
        });
      }
      next.push({
        ...state,
        cost: state.cost + 1000,
        occupied: live,
        path: [...state.path, null],
      });
    }
    beam = next.sort((a, b) => a.cost - b.cost).slice(0, 48);
  }
  let missing = 0;
  [...groups.values()].forEach((group, i) => {
    const combo = beam[0].path[i];
    if (!combo) {
      missing += group.length;
      return;
    }
    group.forEach((n, j) => Object.assign(n, combo[j]));
  });
  const warnings = score.warnings.filter(
    (w) =>
      !w.includes("fingering") &&
      !w.includes("fret-span") &&
      !w.includes("playable fingering"),
  );
  if (missing)
    warnings.push(
      `${missing} notes have no playable fingering under the selected constraints; they remain in MIDI/staff and show '?' in tab.`,
    );
  warnings.push(
    "Tab fingerings use a conservative four-fret-span heuristic. Review sustained notes and chords.",
  );
  return { ...score, notes, warnings };
}
