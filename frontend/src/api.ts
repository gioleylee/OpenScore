import type { Score } from "./types";
import { localExport } from "./localExports";
import { deliverFile } from "./platform";
export async function download(
  score: Score,
  format: string,
  view = "staff",
  share = false,
) {
  const blob = await localExport(score, format, view);
  const filename = `${score.title.replace(/[^\w -]/g, "_") || "score"}.${format === "midi" ? "mid" : format === "musicxml" ? "musicxml" : format}`;
  await deliverFile(blob, filename, share);
}
