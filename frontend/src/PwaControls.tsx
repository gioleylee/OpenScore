import { useEffect, useRef, useState } from "react";
interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: string }>;
}
export function PwaControls({
  beforeUpdate,
  onError,
}: {
  beforeUpdate: () => Promise<void>;
  onError: (m: string) => void;
}) {
  const [install, setInstall] = useState<InstallPrompt | null>(null);
  const [ready, setReady] = useState(false),
    [refresh, setRefresh] = useState(false);
  const registration = useRef<ServiceWorkerRegistration | null>(null),
    reloading = useRef(false);
  useEffect(() => {
    if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
    let disposed = false;
    const controller = () => {
      if (reloading.current) location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", controller);
    navigator.serviceWorker
      .register(import.meta.env.BASE_URL + "sw.js", {
        scope: import.meta.env.BASE_URL,
        updateViaCache: "none",
      })
      .then((result) => {
        if (disposed) return;
        registration.current = result;
        if (result.active) setReady(true);
        if (result.waiting) setRefresh(true);
        const watchInstalling = () => {
          const worker = result.installing;
          worker?.addEventListener("statechange", () => {
            if (worker.state === "installed") {
              setReady(true);
              if (navigator.serviceWorker.controller) setRefresh(true);
            }
          });
        };
        result.addEventListener("updatefound", watchInstalling);
        watchInstalling();
        void result.update().catch(() => {
          /* Existing cached shell remains usable offline. */
        });
      })
      .catch((e) =>
        onError(`Offline cache could not be installed: ${String(e)}`),
      );
    return () => {
      disposed = true;
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        controller,
      );
    };
  }, [onError]);
  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setInstall(e as InstallPrompt);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);
  return (
    <div className="pwa-controls no-print">
      {install && (
        <button
          onClick={async () => {
            try {
              await install.prompt();
              await install.userChoice;
              setInstall(null);
            } catch (e) {
              onError(String(e));
            }
          }}
        >
          Install app
        </button>
      )}
      {ready && !refresh && (
        <small>App cached · saved scores work offline</small>
      )}
      {refresh && (
        <button
          onClick={async () => {
            try {
              await beforeUpdate();
              if (!registration.current?.waiting)
                throw new Error("No update is waiting");
              reloading.current = true;
              registration.current.waiting.postMessage("SKIP_WAITING");
            } catch (e) {
              onError(String(e));
            }
          }}
        >
          Save session & update app
        </button>
      )}
    </div>
  );
}
