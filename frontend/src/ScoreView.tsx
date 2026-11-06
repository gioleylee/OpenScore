import { useEffect, useRef, useState } from "react";
import { OpenSheetMusicDisplay } from "opensheetmusicdisplay";
import { localMusicXml } from "./localExports";
import type { Score } from "./types";

export function ScoreView({
  score,
  view,
  zoom,
  beat,
}: {
  score: Score;
  view: string;
  zoom: number;
  beat: number;
}) {
  const container = useRef<HTMLDivElement>(null),
    osmd = useRef<OpenSheetMusicDisplay | null>(null);
  const latestBeat = useRef(beat);
  latestBeat.current = beat;
  const [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    // Separate renderer instances prevent stale async loads overwriting edits.
    const mount = document.createElement("div");
    const display = new OpenSheetMusicDisplay(mount, {
      autoResize: false,
      backend: "svg",
      drawTitle: true,
      drawSubtitle: false,
      drawComposer: false,
      drawPartNames: true,
      drawMeasureNumbers: true,
    });
    const positionCursor = () => {
      const cursor = display.cursor;
      cursor.reset();
      let guard = 0;
      while (
        !cursor.Iterator.EndReached &&
        cursor.Iterator.currentTimeStamp.RealValue * 4 < latestBeat.current &&
        guard++ < 15000
      )
        cursor.next();
      cursor.show();
    };
    const timer = setTimeout(() => {
      Promise.resolve()
        .then(() => localMusicXml(score, view))
        .then(async (xml) => {
          if (controller.signal.aborted) return;
          await display.load(xml);
          if (controller.signal.aborted || !container.current) return;
          mount.style.width = `${Math.max(300, container.current.clientWidth - 20)}px`;
          container.current.replaceChildren(mount);
          display.Zoom = zoom;
          display.render();
          display.cursor.show();
          osmd.current = display;
          setLoading(false);
        })
        .catch((e) => {
          if (!controller.signal.aborted) {
            setError(String(e));
            setLoading(false);
          }
        });
    }, 300);
    const resize = () => {
      if (osmd.current !== display || !container.current) return;
      mount.style.width = `${Math.max(300, container.current.clientWidth - 20)}px`;
      display.render();
      positionCursor();
    };
    window.addEventListener("resize", resize);
    return () => {
      clearTimeout(timer);
      controller.abort();
      window.removeEventListener("resize", resize);
      if (osmd.current === display) osmd.current = null;
      display.clear();
    };
  }, [score, view, zoom]);
  useEffect(() => {
    const cursor = osmd.current?.cursor;
    if (!cursor || loading || error) return;
    try {
      cursor.reset();
      let guard = 0;
      while (
        !cursor.Iterator.EndReached &&
        cursor.Iterator.currentTimeStamp.RealValue * 4 < beat &&
        guard++ < 15000
      )
        cursor.next();
      cursor.show();
    } catch {
      /* Piano roll remains the playback position fallback. */
    }
  }, [beat, loading, error]);
  return (
    <div className="score-paper">
      {loading && (
        <div className="engraving-status no-print">Engraving your score…</div>
      )}
      {error && (
        <p role="alert" className="error">
          {error} Piano roll and MIDI remain available. Try shorter,
          grid-aligned durations.
        </p>
      )}
      <div ref={container} />
    </div>
  );
}
