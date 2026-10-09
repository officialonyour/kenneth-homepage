import { json } from "../../_shared/settlement.js";
import { onRequestGet as readSnapshot } from "./cache/read.js";

const VIEWS = new Set(["overview", "platforms", "tracks", "months", "distributors", "quality", "track-detail", "all-trends"]);
export async function onRequestGet(context) {
  const parameters = new URL(context.request.url).searchParams;
  const view = parameters.get("view") || "overview";
  if (!VIEWS.has(view)) return json({ ok: false, error: "unknown_view" }, 400);
  if (view === "track-detail" && !String(parameters.get("song") || "").trim()) return json({ ok: false, error: "song_required" }, 400);
  // The browser computes exact analytics from bounded authenticated snapshot reads.
  // This request never decrypts or groups the complete historical dataset.
  return readSnapshot(context);
}
