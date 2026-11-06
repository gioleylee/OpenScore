import { useState } from "react";
import { backendUrl, configureBackend, isNative } from "./platform";
export function Connection({
  changed,
  onError,
}: {
  changed: () => void;
  onError: (message: string) => void;
}) {
  const [url, setUrl] = useState(backendUrl()),
    [saving, setSaving] = useState(false);
  return (
    <details className="panel connection no-print">
      <summary>
        Connection settings · {isNative ? "Android app" : "website"}
      </summary>
      <p className="field-help">
        Transcription needs an online server. Offline saved-score viewing,
        editing, exports and synth practice do not. Only choose a server you
        trust with uploaded audio.
      </p>
      <label>
        Transcription server (HTTPS)
        <input
          type="url"
          placeholder={
            isNative
              ? "https://api.example.com"
              : "Empty = this website’s backend"
          }
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      </label>
      <button
        disabled={saving}
        onClick={async () => {
          setSaving(true);
          try {
            await configureBackend(url);
            changed();
          } catch (e) {
            onError(String(e));
          } finally {
            setSaving(false);
          }
        }}
      >
        Apply connection
      </button>
    </details>
  );
}
