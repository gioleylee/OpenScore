import { useEffect, useRef, type ReactNode } from "react";
export function NotationGestures({
  zoom,
  onZoom,
  children,
}: {
  zoom: number;
  onZoom: (zoom: number) => void;
  children: ReactNode;
}) {
  const host = useRef<HTMLElement>(null),
    latest = useRef(zoom);
  latest.current = zoom;
  useEffect(() => {
    const element = host.current!;
    let distance = 0,
      startZoom = 1;
    const start = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        distance = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY,
        );
        startZoom = latest.current;
      }
    };
    const move = (e: TouchEvent) => {
      if (e.touches.length === 2 && distance) {
        e.preventDefault();
        const next = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY,
        );
        onZoom(Math.max(0.4, Math.min(1.5, (startZoom * next) / distance)));
      }
    };
    const end = () => {
      distance = 0;
    };
    element.addEventListener("touchstart", start, { passive: true });
    element.addEventListener("touchmove", move, { passive: false });
    element.addEventListener("touchend", end);
    element.addEventListener("touchcancel", end);
    return () => {
      element.removeEventListener("touchstart", start);
      element.removeEventListener("touchmove", move);
      element.removeEventListener("touchend", end);
      element.removeEventListener("touchcancel", end);
    };
  }, [onZoom]);
  return (
    <section ref={host} className="notation-panel">
      {children}
    </section>
  );
}
