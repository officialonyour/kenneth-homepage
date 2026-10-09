import { json } from "../../../_shared/settlement.js";
import { getSettlementSnapshotManifest, readSettlementSnapshotChunkBody, getR2Status } from "../../../_shared/settlement-r2-cache.js";

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url), expectedVersion = url.searchParams.get("snapshotVersion");
  try {
    if (url.searchParams.has("chunkNo")) {
      const result = await readSettlementSnapshotChunkBody(env, { snapshotVersion: expectedVersion, chunkNo: url.searchParams.get("chunkNo") });
      return new Response(result.body, { headers: {
        "content-type": "application/json; charset=utf-8", "cache-control": "no-store",
        "x-settlement-snapshot-version": result.snapshotVersion,
        "x-settlement-chunk-no": String(result.chunkNo),
        "x-settlement-rows-count": String(result.rowsCount),
        "x-settlement-chunk-count": String(result.chunkCount),
      } });
    }
    const manifest = await getSettlementSnapshotManifest(env, expectedVersion === null ? undefined : expectedVersion);
    return json({ ok: true, processing: "browser_snapshot_v1", snapshot: manifest, ...getR2Status(env) });
  } catch (error) {
    const message = String(error?.message || error || "snapshot_read_failed");
    const status = message === "snapshot_changed_retry" ? 409 :
      ["r2_seed_required", "r2_binding_missing"].includes(message) ? 503 :
      ["snapshot_version_required", "invalid_chunk_no"].includes(message) ? 400 : 500;
    return json({ ok: false, error: message }, status);
  }
}
