import { json, requireDb } from "../../_shared/settlement.js";
import { invalidateSettlementCaches } from "../../_shared/settlement-cache.js";

function text(v, max = 300) { return String(v ?? "").trim().slice(0, max); }
function integer(v) { const n = Number(v); return Number.isFinite(n) ? Math.round(n) : null; }
function money(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function ym(v) { const s = text(v, 7); return /^\d{4}-\d{2}$/.test(s) ? s : null; }
function monthShift(ymValue, delta) {
  if (!/^\d{4}-\d{2}$/.test(String(ymValue || ""))) return null;
  const d = new Date(Date.UTC(Number(ymValue.slice(0,4)), Number(ymValue.slice(5,7)) - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}`;
}
async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest).map(b => b.toString(16).padStart(2, "0")).join("");
}
async function normalize(input, batchId) {
  const settlementYm = ym(input.settlement_ym);
  const occurrenceYm = settlementYm ? monthShift(settlementYm, -3) : null;
  const originalCount = input.original_count === null || input.original_count === undefined || input.original_count === "" ? null : integer(input.original_count);
  const adjustedCount = input.adjusted_count === null || input.adjusted_count === undefined || input.adjusted_count === "" ? null : integer(input.adjusted_count);
  const analysisCount = input.analysis_count === null || input.analysis_count === undefined || input.analysis_count === "" ? null : integer(input.analysis_count);
  const countBasis = ["actual", "zero_adjusted", "estimated", "missing"].includes(input.count_basis) ? input.count_basis : "missing";
  const r = {
    source_row_no: integer(input.source_row_no),
    distributor: text(input.distributor || "미분류", 120) || "미분류",
    source_file: text(input.source_file, 240),
    settlement_year: integer(input.settlement_year) || (settlementYm ? Number(settlementYm.slice(0, 4)) : null),
    settlement_month: integer(input.settlement_month) || (settlementYm ? Number(settlementYm.slice(5, 7)) : null),
    settlement_ym: settlementYm,
    occurrence_year: occurrenceYm ? Number(occurrenceYm.slice(0, 4)) : null,
    occurrence_month: occurrenceYm ? Number(occurrenceYm.slice(5, 7)) : null,
    occurrence_ym: occurrenceYm,
    artist: text(input.artist, 180),
    album_title: text(input.album_title, 240),
    song_title: text(input.song_title, 240),
    original_platform: text(input.original_platform, 240),
    original_service: text(input.original_service, 300),
    source_key: text(input.source_key, 500),
    platform: text(input.platform || "미분류", 160) || "미분류",
    original_count: originalCount,
    adjusted_count: adjustedCount,
    analysis_count: analysisCount,
    count_basis: countBasis,
    estimate_method: text(input.estimate_method, 240),
    estimate_confidence: text(input.estimate_confidence, 40),
    settlement_amount: money(input.settlement_amount),
    revenue_source: text(input.revenue_source, 120),
    notes: text(input.notes, 1200),
    month_song_key: text(input.month_song_key, 360),
    import_batch_id: batchId,
  };
  const hashInput = [r.source_file, r.source_row_no, r.distributor, r.settlement_ym, r.occurrence_ym, r.artist, r.album_title, r.song_title, r.source_key, r.original_count, r.adjusted_count, r.settlement_amount].join("\u001f");
  r.row_hash = await sha256(hashInput);
  return r;
}

export async function onRequestPost({ request, env }) {
  const db = requireDb(env);
  let body;
  try { body = await request.json(); } catch { return json({ ok:false, error:"invalid_json" }, 400); }
  const rows = Array.isArray(body?.rows) ? body.rows : [];
  const mappings = Array.isArray(body?.mappings) ? body.mappings : [];
  if (!rows.length && !mappings.length) return json({ ok:false, error:"empty_import" }, 400);
  if (rows.length > 500) return json({ ok:false, error:"rows_chunk_too_large" }, 413);
  if (mappings.length > 500) return json({ ok:false, error:"mapping_chunk_too_large" }, 413);
  const batchId = text(body.batchId || crypto.randomUUID(), 100);
  const fileName = text(body.fileName, 240);

  await db.prepare(`INSERT OR IGNORE INTO settlement_import_batches (batch_id,file_name) VALUES (?,?)`).bind(batchId, fileName).run();
  let inserted = 0, duplicates = 0, invalid = 0, mappingUpserts = 0;

  for (let i = 0; i < mappings.length; i += 100) {
    const stmts = mappings.slice(i, i + 100).map(m => db.prepare(`INSERT INTO settlement_platform_mapping (source_key,platform,original_platform,original_service,import_batch_id,updated_at)
      VALUES (?,?,?,?,?,datetime('now'))
      ON CONFLICT(source_key) DO UPDATE SET platform=excluded.platform, original_platform=excluded.original_platform, original_service=excluded.original_service, import_batch_id=excluded.import_batch_id, updated_at=datetime('now')`)
      .bind(text(m.source_key,500), text(m.platform||"미분류",160), text(m.original_platform,240), text(m.original_service,300), batchId));
    if (stmts.length) { const results = await db.batch(stmts); mappingUpserts += results.length; }
  }

  for (let i = 0; i < rows.length; i += 50) {
    const chunk = rows.slice(i, i + 50);
    const normalized = [];
    for (const input of chunk) {
      const r = await normalize(input, batchId);
      if (!r.song_title || !r.settlement_ym) { invalid++; continue; }
      normalized.push(r);
    }
    if (!normalized.length) continue;

    // Keep imports idempotent even after the occurrence-month correction.  The
    // identity below intentionally excludes occurrence_ym because it is derived
    // from settlement_ym by the fixed -3 month rule.
    const checkStmts = normalized.map(r => db.prepare(`SELECT id FROM music_settlement_records
      WHERE COALESCE(source_row_no,-1)=COALESCE(?,-1)
        AND distributor=?
        AND COALESCE(settlement_ym,'')=COALESCE(?,'')
        AND song_title=?
        AND COALESCE(source_key,'')=COALESCE(?,'')
        AND ABS(COALESCE(settlement_amount,0)-?) < 0.0000001
      LIMIT 1`).bind(r.source_row_no,r.distributor,r.settlement_ym,r.song_title,r.source_key,r.settlement_amount));
    const checks = await db.batch(checkStmts);
    const stmts = [];
    normalized.forEach((r, idx) => {
      const exists = Array.isArray(checks[idx]?.results) && checks[idx].results.length > 0;
      if (exists) { duplicates++; return; }
      stmts.push(db.prepare(`INSERT OR IGNORE INTO music_settlement_records (
        source_row_no,distributor,source_file,settlement_year,settlement_month,settlement_ym,occurrence_year,occurrence_month,occurrence_ym,
        artist,album_title,song_title,original_platform,original_service,source_key,platform,original_count,adjusted_count,analysis_count,count_basis,
        estimate_method,estimate_confidence,settlement_amount,revenue_source,notes,month_song_key,import_batch_id,row_hash
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
        r.source_row_no,r.distributor,r.source_file,r.settlement_year,r.settlement_month,r.settlement_ym,r.occurrence_year,r.occurrence_month,r.occurrence_ym,
        r.artist,r.album_title,r.song_title,r.original_platform,r.original_service,r.source_key,r.platform,r.original_count,r.adjusted_count,r.analysis_count,r.count_basis,
        r.estimate_method,r.estimate_confidence,r.settlement_amount,r.revenue_source,r.notes,r.month_song_key,r.import_batch_id,r.row_hash
      ));
    });
    if (!stmts.length) continue;
    const results = await db.batch(stmts);
    for (const res of results) Number(res.meta?.changes || 0) > 0 ? inserted++ : duplicates++;
  }

  await db.prepare(`UPDATE settlement_import_batches SET rows_received=rows_received+?, rows_inserted=rows_inserted+?, duplicate_rows=duplicate_rows+?, mapping_rows=mapping_rows+?, completed_at=CASE WHEN ? THEN datetime('now') ELSE completed_at END WHERE batch_id=?`)
    .bind(rows.length, inserted, duplicates, mappingUpserts, body.finalChunk ? 1 : 0, batchId).run();

  if (inserted > 0 || mappingUpserts > 0) await invalidateSettlementCaches(db);

  return json({ ok:true, batchId, received:rows.length, inserted, duplicates, invalid, mappingUpserts });
}
