import { useEffect, useState } from "react";
import {
  deleteTranscription,
  listTranscriptions,
  type SavedTranscription,
  saveTranscription,
  validateSaved,
} from "./storage";
export function Library({
  open,
  onError,
}: {
  open: (item: SavedTranscription) => void;
  onError: (message: string) => void;
}) {
  const [items, setItems] = useState<SavedTranscription[]>([]),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    let disposed = false;
    const refresh = () => {
      listTranscriptions()
        .then((items) => {
          if (!disposed) {
            setItems(items);
            setLoading(false);
          }
        })
        .catch((e) => {
          if (!disposed) {
            onError(String(e));
            setLoading(false);
          }
        });
    };
    refresh();
    window.addEventListener("openscore-library", refresh);
    return () => {
      disposed = true;
      window.removeEventListener("openscore-library", refresh);
    };
  }, [onError]);
  async function remove(id: string) {
    try {
      await deleteTranscription(id);
      setItems((items) => items.filter((item) => item.id !== id));
    } catch (e) {
      onError(String(e));
    }
  }
  return (
    <section className="panel library no-print">
      <div className="section-heading">
        <div>
          <span className="eyebrow">ON THIS DEVICE</span>
          <h2>Saved transcriptions</h2>
        </div>
        <span className="tag">OFFLINE READY</span>
      </div>
      <label className="library-import">
        Import score backup (.json)
        <input
          type="file"
          accept=".json,application/json"
          onChange={async (e) => {
            const input = e.currentTarget,
              file = input.files?.[0];
            if (!file) return;
            try {
              if (file.size > 2000000) throw new Error("Backup exceeds 2 MB");
              const item = validateSaved(JSON.parse(await file.text()));
              const imported = {
                ...item,
                id: crypto.randomUUID(),
                savedAt: new Date().toISOString(),
              };
              await saveTranscription(imported);
              setItems((items) => [imported, ...items]);
            } catch (error) {
              onError(String(error));
            } finally {
              input.value = "";
            }
          }}
        />
      </label>
      <p className="field-help">
        Scores, edits and synth practice stay on this device. Original
        recordings are not saved. Export important scores before clearing app
        data or uninstalling.
      </p>
      {loading ? (
        <p>Opening library…</p>
      ) : items.length === 0 ? (
        <p className="muted">
          Save a transcription to practice without a connection.
        </p>
      ) : (
        <div className="library-grid">
          {items.map((item) => (
            <article key={item.id}>
              <div>
                <strong>
                  {item.id === "draft"
                    ? "Recover last session"
                    : item.score.title}
                </strong>
                <small>
                  {item.id === "draft"
                    ? item.score.title
                    : item.score.settings.instrument}{" "}
                  · {item.score.notes.length} notes ·{" "}
                  {new Date(item.savedAt).toLocaleString()}
                </small>
              </div>
              <div className="button-row">
                <button onClick={() => open(item)}>Open</button>
                <button
                  onClick={() => void remove(item.id)}
                  aria-label={`Remove ${item.id === "draft" ? "recovery" : item.score.title} from device`}
                >
                  Remove
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
