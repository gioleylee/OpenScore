import { Capacitor, registerPlugin } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

export const isNative = Capacitor.isNativePlatform();
let serverUrl = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");
const key = "openscore.backend";
export async function initializePlatform() {
  const saved = isNative
    ? (await Preferences.get({ key })).value
    : localStorage.getItem(key);
  if (saved !== null) serverUrl = saved;
}
export function backendUrl() {
  return serverUrl;
}
export async function readPreference(key: string) {
  return isNative
    ? (await Preferences.get({ key })).value
    : localStorage.getItem(key);
}
export async function writePreference(key: string, value: string | null) {
  if (isNative) {
    if (value === null) await Preferences.remove({ key });
    else await Preferences.set({ key, value });
  } else if (value === null) localStorage.removeItem(key);
  else localStorage.setItem(key, value);
}
export async function configureBackend(value: string) {
  const next = value.trim().replace(/\/$/, "");
  if (next) {
    const url = new URL(next);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    )
      throw new Error(
        "Use a server origin without credentials, paths or query parameters.",
      );
    if (
      url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        !isNative &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      )
    )
      throw new Error("Use HTTPS for the transcription server.");
  }
  if (isNative) await Preferences.set({ key, value: next });
  else localStorage.setItem(key, next);
  serverUrl = next;
}
export function apiAddress(path: string) {
  if (isNative && !serverUrl)
    throw new Error(
      "Set an HTTPS backend URL in Connection settings to transcribe. Saved scores work offline.",
    );
  return serverUrl + path;
}

const Documents = registerPlugin<{
  saveFile(options: {
    name: string;
    mime: string;
    data: string;
  }): Promise<{ uri: string }>;
}>("ScoreDocuments");
export async function blobBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
export async function deliverFile(blob: Blob, name: string, share = false) {
  if (isNative) {
    const data = await blobBase64(blob);
    if (!share) {
      await Documents.saveFile({
        name,
        mime: blob.type || "application/octet-stream",
        data,
      });
      return;
    }
    // Only temporary exports go into Cache; the official Share plugin exposes
    // them through FileProvider. No broad external-storage permission is needed.
    const path = `exports/${crypto.randomUUID()}/${name}`;
    const file = await Filesystem.writeFile({
      directory: Directory.Cache,
      path,
      data,
      recursive: true,
    });
    await Share.share({
      title: name,
      files: [file.uri],
      dialogTitle: "Share transcription",
    });
    return;
  }
  const file = new File([blob], name, { type: blob.type });
  if (share && navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title: name });
    return;
  }
  const url = URL.createObjectURL(blob),
    link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
