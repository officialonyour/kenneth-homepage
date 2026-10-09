import { json } from "../../_shared/settlement.js";
import { saveManualSettlementRow } from "../../_shared/settlement-r2-cache.js";

const PROFILE = Object.freeze({ distributor: "디지털 레코즈", artist: "kenneth x ㅌ", album_title: "오우야", song_title: "오우야", platform: "미분류" });

// This route inherits the settlement authentication middleware. The account
// memo is returned only after login and is never stored in financial records.
export async function onRequestGet() {
  return json({ ok: true, account: { login_id: "keti2126x", login_url: "http://www.digitalrecords.co.kr/user/login.asp" } });
}

function validMonth(value) {
  return typeof value === "string" && /^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(value);
}

function parsedNumber(value, optional = false) {
  if (value === null || value === undefined || (typeof value === "string" && !value.trim())) return optional ? null : NaN;
  if (typeof value !== "number" && typeof value !== "string") return NaN;
  const number = Number(value);
  return Number.isFinite(number) ? number : NaN;
}

async function hashText(value) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return Array.from(digest).map(number => number.toString(16).padStart(2, "0")).join("");
}

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "invalid_json" }, 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ ok: false, error: "invalid_manual_entry" }, 400);
  let distributor = PROFILE.distributor;
  if (body.distributor !== undefined) {
    if (typeof body.distributor !== "string") return json({ ok: false, error: "invalid_manual_distributor" }, 400);
    const label = body.distributor.trim(), provider = label.toLowerCase().replace(/\s/g, "");
    if (label.length > 120 || !["디지털레코즈", "디지털레코드", "digitalrecords"].includes(provider)) return json({ ok: false, error: "invalid_manual_distributor" }, 400);
    distributor = label;
  }
  if (!validMonth(body.settlement_ym)) return json({ ok: false, error: "invalid_settlement_month" }, 400);
  if (!validMonth(body.occurrence_ym)) return json({ ok: false, error: "invalid_occurrence_month" }, 400);
  const amount = parsedNumber(body.settlement_amount), count = parsedNumber(body.original_count, true);
  if (!Number.isFinite(amount) || amount < 0 || amount > Number.MAX_SAFE_INTEGER) return json({ ok: false, error: "invalid_settlement_amount" }, 400);
  if (count !== null && (!Number.isSafeInteger(count) || count < 0)) return json({ ok: false, error: "invalid_original_count" }, 400);
  if (body.notes !== undefined && typeof body.notes !== "string") return json({ ok: false, error: "invalid_notes" }, 400);
  const notes = (body.notes || "").trim();
  if (notes.length > 1200) return json({ ok: false, error: "notes_too_long" }, 400);
  if (body.replace_existing !== undefined && typeof body.replace_existing !== "boolean") return json({ ok: false, error: "invalid_replace_flag" }, 400);
  if (body.replace_existing && (typeof body.expected_fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(body.expected_fingerprint))) return json({ ok: false, error: "replacement_token_required" }, 400);
  const manualKey = await hashText(JSON.stringify([PROFILE.distributor, PROFILE.song_title, body.settlement_ym]));
  const row = {
    ...PROFILE, distributor, source_row_no: null, source_file: "", settlement_ym: body.settlement_ym, occurrence_ym: body.occurrence_ym,
    original_platform: "", original_service: "월별 합계", source_key: "", original_count: count,
    adjusted_count: count, analysis_count: count, count_basis: count === null ? "missing" : "actual",
    estimate_method: "", estimate_confidence: "", settlement_amount: amount, revenue_source: "직접입력", notes,
  };
  row.manual_fingerprint = await hashText(JSON.stringify(row));
  row.manual_key = manualKey;
  row.id = -Math.max(1, parseInt(manualKey.slice(0, 13), 16));
  try {
    const result = await saveManualSettlementRow(env, row, { replaceExisting: body.replace_existing === true, expectedFingerprint: body.expected_fingerprint || null });
    return json(result, result.duplicate || result.replaced ? 200 : 201);
  } catch (error) {
    const message = String(error?.message || "manual_save_failed");
    const conflict = ["manual_entry_exists", "manual_entry_changed_retry", "manual_month_already_imported", "append_snapshot_changed_retry", "snapshot_changed_retry"].includes(message);
    const unavailable = ["r2_seed_required", "r2_binding_missing"].includes(message);
    const publicErrors = ["manual_entry_exists", "manual_entry_changed_retry", "manual_month_already_imported", "append_snapshot_changed_retry", "snapshot_changed_retry", "r2_seed_required", "r2_binding_missing", "r2_snapshot_incomplete", "r2_snapshot_count_mismatch", "invalid_r2_snapshot_meta", "invalid_manual_snapshot_index"];
    return json({ ok: false, error: publicErrors.includes(message) ? message : "manual_save_failed", ...(error?.previous ? { previous: error.previous } : {}) }, conflict ? 409 : unavailable ? 503 : 500);
  }
}
