import { json } from "../../../_shared/settlement.js";
import { seedSnapshotChunk, getR2Status } from "../../../_shared/settlement-r2-cache.js";

export async function onRequestGet({ env }) {
  return json({ ok: true, ...getR2Status(env) });
}

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return json({ ok:false, error:"invalid_json" }, 400); }
  try {
    const result = await seedSnapshotChunk(env, {
      snapshotVersion: body.snapshotVersion,
      chunkNo: body.chunkNo,
      rows: body.rows,
      finalChunk: body.finalChunk,
      totalRows: body.totalRows,
      mappings: body.mappings,
    });
    return json(result);
  } catch (error) {
    const msg = String(error?.message || error || "r2_seed_failed");
    return json({ ok:false, error:msg }, msg === "r2_binding_missing" ? 503 : 400);
  }
}
