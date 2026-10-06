const PREFIX = "settlement-cache/v16";
const META_KEY = `${PREFIX}/source/meta.json`;
const ANALYTICS_PREFIX = `${PREFIX}/analytics/`;
const CHUNK_SIZE = 500;

const RAW_SELECT = `SELECT
  id,source_row_no,distributor,source_file,settlement_ym,occurrence_ym,artist,album_title,song_title,
  original_platform,original_service,source_key,platform,original_count,adjusted_count,analysis_count,count_basis,
  estimate_method,estimate_confidence,settlement_amount,revenue_source,notes
  FROM music_settlement_records`;

function bucket(env) {
  return env.MEDIA || env.SETTLEMENT_CACHE || null;
}

function bytesToB64(bytes) {
  let raw = "";
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i += 0x8000) raw += String.fromCharCode(...arr.subarray(i, i + 0x8000));
  return btoa(raw);
}
function b64ToBytes(text) {
  const raw = atob(String(text || ""));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
async function cryptoKey(env) {
  const secret = String(env.SETTLEMENT_SESSION_SECRET || "");
  if (!secret) throw new Error("settlement_session_secret_missing");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
async function encodePrivateJson(env, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await cryptoKey(env);
  const plain = new TextEncoder().encode(JSON.stringify(value));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain);
  return JSON.stringify({ v: 1, iv: bytesToB64(iv), data: bytesToB64(new Uint8Array(cipher)) });
}
async function decodePrivateJson(env, text) {
  const box = JSON.parse(text);
  if (!box || box.v !== 1 || !box.iv || !box.data) throw new Error("invalid_r2_ciphertext");
  const key = await cryptoKey(env);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64ToBytes(box.iv) }, key, b64ToBytes(box.data));
  return JSON.parse(new TextDecoder().decode(plain));
}
async function getPrivateJson(env, obj) {
  if (!obj) return null;
  return decodePrivateJson(env, await obj.text());
}
async function putPrivateJson(env, b, key, value, customMetadata = undefined) {
  await b.put(key, await encodePrivateJson(env, value), {
    httpMetadata: { contentType: "application/octet-stream" },
    customMetadata,
  });
}

async function sha256Hex(text) {
  const data = new TextEncoder().encode(String(text));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return Array.from(digest).map(x => x.toString(16).padStart(2, "0")).join("");
}

async function deletePrefix(b, prefix) {
  if (!b) return;
  let cursor;
  do {
    const listed = await b.list({ prefix, cursor, limit: 1000 });
    const keys = (listed.objects || []).map(x => x.key);
    if (keys.length) await b.delete(keys);
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
}

export async function invalidateAnalyticsCache(env) {
  const b = bucket(env);
  if (!b) return;
  await deletePrefix(b, ANALYTICS_PREFIX);
}

export async function getAnalyticsCache(env, cacheKey) {
  const b = bucket(env);
  if (!b) return null;
  try {
    const hash = await sha256Hex(cacheKey);
    const obj = await b.get(`${ANALYTICS_PREFIX}${hash}.json`);
    if (!obj) return null;
    const payload = await getPrivateJson(env, obj);
    return { payload, generatedAt: obj.uploaded?.toISOString?.() || null };
  } catch (error) {
    console.warn("R2 analytics cache read failed", error);
    return null;
  }
}

export async function setAnalyticsCache(env, cacheKey, payload) {
  const b = bucket(env);
  if (!b) return;
  try {
    const hash = await sha256Hex(cacheKey);
    await putPrivateJson(env, b, `${ANALYTICS_PREFIX}${hash}.json`, payload, { cacheKey, generatedAt: new Date().toISOString() });
  } catch (error) {
    console.warn("R2 analytics cache write failed", error);
  }
}

async function getMeta(env) {
  const b = bucket(env);
  if (!b) return null;
  const obj = await b.get(META_KEY);
  if (!obj) return null;
  return getPrivateJson(env, obj);
}

async function readR2Snapshot(env) {
  const b = bucket(env);
  if (!b) return null;
  const meta = await getMeta(env);
  if (!meta?.snapshotVersion || !Number.isFinite(Number(meta.chunkCount))) return null;
  const rows = [];
  const totalChunks = Number(meta.chunkCount || 0);
  for (let start = 0; start < totalChunks; start += 8) {
    const reqs = [];
    for (let i = start; i < Math.min(totalChunks, start + 8); i++) {
      reqs.push(b.get(`${PREFIX}/source/${meta.snapshotVersion}/${String(i).padStart(4, "0")}.json`));
    }
    const objects = await Promise.all(reqs);
    for (const obj of objects) {
      if (!obj) throw new Error("r2_snapshot_incomplete");
      const part = await getPrivateJson(env, obj);
      if (Array.isArray(part)) rows.push(...part);
      else if (Array.isArray(part?.rows)) rows.push(...part.rows);
    }
  }
  if (Number(meta.rowsCount || 0) && rows.length !== Number(meta.rowsCount)) throw new Error("r2_snapshot_count_mismatch");
  return {
    rows,
    source: "r2_snapshot_v16",
    snapshotVersion: meta.snapshotVersion,
    builtAt: meta.builtAt || null,
    chunkCount: totalChunks,
    mappings: Array.isArray(meta.mappings) ? meta.mappings : [],
    mappingCount: Number(meta.mappingCount || 0),
    d1RowsRead: 0,
  };
}

export async function writeSnapshotFromRows(env, rows, mappings = [], snapshotVersion = null) {
  const b = bucket(env);
  if (!b) throw new Error("r2_binding_missing");
  const oldMeta = await getMeta(env).catch(() => null);
  const version = snapshotVersion || `${Date.now()}-${crypto.randomUUID()}`;
  let chunkCount = 0;
  for (let i = 0; i < rows.length; i += CHUNK_SIZE, chunkCount++) {
    const part = rows.slice(i, i + CHUNK_SIZE);
    await putPrivateJson(env, b, `${PREFIX}/source/${version}/${String(chunkCount).padStart(4, "0")}.json`, part);
  }
  await putPrivateJson(env, b, META_KEY, {
    snapshotVersion: version,
    rowsCount: rows.length,
    chunkCount,
    mappingCount: mappings.length,
    mappings,
    builtAt: new Date().toISOString(),
  });
  await invalidateAnalyticsCache(env);
  if (oldMeta?.snapshotVersion && oldMeta.snapshotVersion !== version) {
    await deletePrefix(b, `${PREFIX}/source/${oldMeta.snapshotVersion}/`).catch(() => {});
  }
  return { snapshotVersion: version, rowsCount: rows.length, chunkCount };
}

export async function seedSnapshotChunk(env, { snapshotVersion, chunkNo, rows, finalChunk, totalRows, mappings }) {
  const b = bucket(env);
  if (!b) throw new Error("r2_binding_missing");
  const version = String(snapshotVersion || "").trim();
  if (!version) throw new Error("snapshot_version_required");
  const no = Number(chunkNo);
  if (!Number.isInteger(no) || no < 0) throw new Error("invalid_chunk_no");
  if (!Array.isArray(rows) || rows.length > CHUNK_SIZE) throw new Error("invalid_chunk_rows");
  await putPrivateJson(env, b, `${PREFIX}/source/${version}/${String(no).padStart(4, "0")}.json`, rows);
  if (finalChunk) {
    const oldMeta = await getMeta(env).catch(() => null);
    const chunkCount = no + 1;
    await putPrivateJson(env, b, META_KEY, {
      snapshotVersion: version,
      rowsCount: Number(totalRows || 0),
      chunkCount,
      mappingCount: Array.isArray(mappings) ? mappings.length : 0,
      mappings: Array.isArray(mappings) ? mappings : [],
      builtAt: new Date().toISOString(),
    });
    await invalidateAnalyticsCache(env);
    if (oldMeta?.snapshotVersion && oldMeta.snapshotVersion !== version) {
      await deletePrefix(b, `${PREFIX}/source/${oldMeta.snapshotVersion}/`).catch(() => {});
    }
  }
  return { ok: true, snapshotVersion: version, chunkNo: no, rows: rows.length, finalChunk: !!finalChunk };
}

async function fallbackFromD1(env) {
  if (!env.SETTLEMENT_DB) return null;
  try {
    const result = await env.SETTLEMENT_DB.prepare(RAW_SELECT).all();
    const rows = result.results || [];
    await writeSnapshotFromRows(env, rows, []);
    return {
      rows,
      source: "d1_one_time_seed_v16",
      snapshotVersion: null,
      builtAt: new Date().toISOString(),
      chunkCount: Math.ceil(rows.length / CHUNK_SIZE),
      mappings: [],
      mappingCount: 0,
      d1RowsRead: Number(result.meta?.rows_read || rows.length),
    };
  } catch (error) {
    console.warn("D1 fallback seed failed", error);
    return null;
  }
}

export async function loadSettlementRows(env) {
  const r2 = await readR2Snapshot(env).catch(error => {
    console.warn("R2 snapshot read failed", error);
    return null;
  });
  if (r2) return r2;
  const fallback = await fallbackFromD1(env);
  if (fallback) return fallback;
  const error = new Error("r2_seed_required");
  error.code = "r2_seed_required";
  throw error;
}

export async function appendSnapshotRow(env, row) {
  const snap = await readR2Snapshot(env);
  if (!snap) return false;
  snap.rows.push(row);
  await writeSnapshotFromRows(env, snap.rows, snap.mappings || []);
  return true;
}

export async function removeSnapshotRowById(env, id) {
  const snap = await readR2Snapshot(env);
  if (!snap) return false;
  const before = snap.rows.length;
  const rows = snap.rows.filter(r => Number(r.id) !== Number(id));
  if (rows.length === before) return false;
  await writeSnapshotFromRows(env, rows, snap.mappings || []);
  return true;
}

export function getR2Status(env) {
  return { r2Ready: !!bucket(env), binding: env.MEDIA ? "MEDIA" : env.SETTLEMENT_CACHE ? "SETTLEMENT_CACHE" : null };
}
