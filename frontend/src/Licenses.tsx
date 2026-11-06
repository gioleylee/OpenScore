import { useRef, useState } from "react";
export function Licenses({ onError }: { onError: (m: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null),
    [text, setText] = useState("");
  return (
    <>
      <button
        className="license-button"
        onClick={async () => {
          try {
            const response = await fetch(
              import.meta.env.BASE_URL + "third-party-notices.txt",
            );
            if (!response.ok) throw new Error("Could not open license notices");
            setText(await response.text());
            dialog.current?.showModal();
          } catch (e) {
            onError(String(e));
          }
        }}
      >
        Open-source notices
      </button>
      <dialog ref={dialog} className="license-dialog">
        <button onClick={() => dialog.current?.close()}>Close notices</button>
        <pre>{text}</pre>
      </dialog>
    </>
  );
}
