import { useState } from "react";
import { Plus, Trash2, Undo2, Redo2 } from "lucide-react";
import type { Score, Note } from "./types";
import { FRETTED, pitchName, violinFinger } from "./types";

export function Editor({
  score,
  change,
  undo,
  redo,
  canUndo,
  canRedo,
  beat,
}: {
  score: Score;
  change: (s: Score) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  beat: number;
}) {
  const [selected, setSelected] = useState<string | null>(null),
    [page, setPage] = useState(0);
  const note = score.notes.find((n) => n.id === selected);
  const total = Math.max(8, ...score.notes.map((n) => n.onset + n.duration));
  const low = Math.min(48, ...score.notes.map((n) => n.pitch)) - 2,
    high = Math.max(72, ...score.notes.map((n) => n.pitch)) + 2;
  const rows = high - low + 1;
  const update = (patch: Partial<Note>) => {
    if (!note) return;
    change({
      ...score,
      notes: score.notes.map((n) =>
        n.id === note.id
          ? {
              ...n,
              ...patch,
              ...(patch.pitch !== undefined
                ? { string: null, fret: null }
                : {}),
            }
          : n,
      ),
    });
  };
  function add() {
    const n: Note = {
      id: crypto.randomUUID(),
      pitch: 60,
      onset: Math.round(beat * 4) / 4,
      duration: 1,
      velocity: 85,
      string: null,
      fret: null,
    };
    change({ ...score, notes: [...score.notes, n] });
    setSelected(n.id);
  }
  return (
    <section className="panel editor no-print">
      <div className="section-heading">
        <div>
          <span className="eyebrow">MAKE IT YOURS</span>
          <h3>Note editor</h3>
        </div>
        <div className="button-row">
          <button disabled={!canUndo} onClick={undo} title="Undo">
            <Undo2 size={16} />
          </button>
          <button disabled={!canRedo} onClick={redo} title="Redo">
            <Redo2 size={16} />
          </button>
          <button onClick={add}>
            <Plus size={16} /> Add note
          </button>
        </div>
      </div>
      <p className="muted">
        Select a note below to correct it. Timings are in quarter-note beats;
        edits update the score and every export.
      </p>
      <div className="roll-scroll">
        <div
          className="piano-roll"
          style={{
            width: Math.max(720, total * 45),
            height: Math.min(500, rows * 12),
          }}
        >
          {Array.from({ length: rows }, (_, i) => (
            <div
              key={i}
              className={`roll-row ${[1, 3, 6, 8, 10].includes((high - i) % 12) ? "black-key" : ""}`}
              style={{ top: `${(i / rows) * 100}%`, height: `${100 / rows}%` }}
            >
              <span>{(high - i) % 12 === 0 ? pitchName(high - i) : ""}</span>
            </div>
          ))}
          {Array.from({ length: Math.ceil(total) }, (_, i) => (
            <div
              className="beat-line"
              style={{ left: `${(i / total) * 100}%` }}
              key={i}
            >
              <span>{i % 4 === 0 ? i + 1 : ""}</span>
            </div>
          ))}
          {score.notes.map((n) => (
            <button
              key={n.id}
              aria-label={`${pitchName(n.pitch)} at beat ${n.onset}`}
              title={`${pitchName(n.pitch)} · beat ${n.onset}`}
              className={`roll-note ${selected === n.id ? "selected" : ""} ${beat >= n.onset && beat < n.onset + n.duration ? "sounding" : ""}`}
              style={{
                left: `${(n.onset / total) * 100}%`,
                width: `${(n.duration / total) * 100}%`,
                top: `${((high - n.pitch) / rows) * 100}%`,
                height: `${100 / rows}%`,
              }}
              onClick={() => setSelected(n.id)}
            />
          ))}
          <div
            className="playhead"
            style={{ left: `${(beat / total) * 100}%` }}
          />
        </div>
      </div>
      {note && (
        <div className="note-fields">
          <label>
            Pitch (MIDI)
            <input
              type="number"
              min={0}
              max={127}
              value={note.pitch}
              onChange={(e) =>
                update({ pitch: Math.max(0, Math.min(127, +e.target.value)) })
              }
            />
            <small>{pitchName(note.pitch)}</small>
          </label>
          <label>
            Onset
            <input
              type="number"
              min={0}
              step={0.25}
              value={note.onset}
              onChange={(e) => update({ onset: Math.max(0, +e.target.value) })}
            />
          </label>
          <label>
            Duration
            <input
              type="number"
              min={0.0625}
              max={128}
              step={0.25}
              value={note.duration}
              onChange={(e) =>
                update({
                  duration: Math.max(0.0625, Math.min(128, +e.target.value)),
                })
              }
            />
          </label>
          <label>
            Velocity
            <input
              type="number"
              min={1}
              max={127}
              value={note.velocity}
              onChange={(e) =>
                update({
                  velocity: Math.max(1, Math.min(127, +e.target.value)),
                })
              }
            />
          </label>
          {FRETTED.includes(score.settings.mode) && (
            <label>
              String / fret
              <select
                value={
                  note.string === null ? "" : `${note.string},${note.fret}`
                }
                onChange={(e) => {
                  const [string, fret] = e.target.value.split(",").map(Number);
                  update(
                    e.target.value
                      ? { string, fret }
                      : { string: null, fret: null },
                  );
                }}
              >
                <option value="">Unassigned</option>
                {score.settings.tuning
                  .map((p, i) => ({
                    string: score.settings.tuning.length - i,
                    fret: note.pitch - p - score.settings.capo,
                  }))
                  .filter(
                    (c) =>
                      c.fret >= score.settings.min_fret &&
                      c.fret <= score.settings.max_fret,
                  )
                  .map((c) => (
                    <option key={c.string} value={`${c.string},${c.fret}`}>
                      {score.settings.mode === "violin"
                        ? `${pitchName(score.settings.tuning[score.settings.tuning.length - c.string]).replace(/-?\d+$/, "")} string, finger ${violinFinger(c.fret)} (+${c.fret})`
                        : `String ${c.string}, fret ${c.fret}`}
                    </option>
                  ))}
              </select>
            </label>
          )}
          <button
            className="danger"
            onClick={() => {
              change({
                ...score,
                notes: score.notes.filter((n) => n.id !== note.id),
              });
              setSelected(null);
            }}
          >
            <Trash2 size={16} /> Delete
          </button>
        </div>
      )}
      <details>
        <summary>Accessible note list ({score.notes.length} notes)</summary>
        <div className="note-list">
          {score.notes.slice(page * 50, (page + 1) * 50).map((n) => (
            <button key={n.id} onClick={() => setSelected(n.id)}>
              {pitchName(n.pitch)} · beat {n.onset} · length {n.duration}
            </button>
          ))}
        </div>
        <button disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
          Previous
        </button>
        <button
          disabled={(page + 1) * 50 >= score.notes.length}
          onClick={() => setPage((p) => p + 1)}
        >
          Next
        </button>
      </details>
    </section>
  );
}
