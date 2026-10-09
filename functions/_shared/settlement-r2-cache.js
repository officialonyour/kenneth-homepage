const PREFIX = "settlement-cache/v16";
const META_KEY = `${PREFIX}/source/meta.json`;
const ANALYTICS_PREFIX = `${PREFIX}/analytics/`;
const CHUNK_SIZE = 500;

const RAW_SELECT = `SELECT
  id,source_row_no,distributor,source_file,settlement_ym,occurrence_ym,artist,album_title,song_title,
  original_platform,original_service,source_key,platform,original_count,adjusted_count,analysis_count,count_basis,
  estimate_method,estimate_confidence,settlement_amount,revenue_source,notes,month_song_key
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
  const value = String(text || "");
  if (typeof Uint8Array.fromBase64 === "function") return Uint8Array.fromBase64(value);
  const raw = atob(value);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
let lastCryptoSecret = null, lastCryptoKey = null;
async function cryptoKey(env) {
  const secret = String(env.SETTLEMENT_SESSION_SECRET || "");
  if (!secret) throw new Error("settlement_session_secret_missing");
  if (lastCryptoSecret === secret && lastCryptoKey) return lastCryptoKey;
  const pending = (async () => {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
    return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  })();
  lastCryptoSecret = secret;
  lastCryptoKey = pending;
  try { return await pending; }
  catch (error) {
    if (lastCryptoKey === pending) { lastCryptoSecret = null; lastCryptoKey = null; }
    throw error;
  }
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
async function putPrivateJson(env, b, key, value, customMetadata = undefined, onlyIf = undefined) {
  return b.put(key, await encodePrivateJson(env, value), {
    httpMetadata: { contentType: "application/octet-stream" },
    customMetadata,
    ...(onlyIf ? { onlyIf } : {}),
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

async function getMetaState(env) {
  const b = bucket(env);
  if (!b) return { meta: null, object: null };
  const obj = await b.get(META_KEY);
  if (!obj) return { meta: null, object: null };
  const meta = await getPrivateJson(env, obj);
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) throw new Error("invalid_r2_snapshot_meta");
  return { meta, object: obj };
}

async function getMeta(env) { return (await getMetaState(env)).meta; }

async function readR2Snapshot(env, suppliedMeta = undefined) {
  const b = bucket(env);
  if (!b) return null;
  const meta = suppliedMeta === undefined ? await getMeta(env) : suppliedMeta;
  if (!meta) return null;
  readManifestFromMeta(meta);
  const rows = [];
  const totalChunks = Number(meta.chunkCount || 0);
  for (let start = 0; start < totalChunks; start += 8) {
    const reqs = [];
    for (let i = start; i < Math.min(totalChunks, start + 8); i++) {
      reqs.push(b.get(snapshotChunkKey(meta, i)));
    }
    const objects = await Promise.all(reqs);
    for (const obj of objects) {
      if (!obj) throw new Error("r2_snapshot_incomplete");
      const part = await getPrivateJson(env, obj);
      if (Array.isArray(part)) rows.push(...part);
      else if (Array.isArray(part?.rows)) rows.push(...part.rows);
      else throw new Error("invalid_r2_snapshot_chunk");
    }
  }
  if (rows.length !== meta.rowsCount) throw new Error("r2_snapshot_count_mismatch");
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

export async function writeSnapshotFromRows(env, rows, mappings = [], snapshotVersion = null, options = {}) {
  const b = bucket(env);
  if (!b) throw new Error("r2_binding_missing");
  const state = await getMetaState(env), oldMeta = state.meta;
  const conditional = Object.hasOwn(options, "expectedSnapshotVersion");
  if (conditional && (oldMeta?.snapshotVersion || null) !== options.expectedSnapshotVersion) throw new Error("append_snapshot_changed_retry");
  if (conditional && state.object && !state.object.etag) throw new Error("append_snapshot_etag_missing");
  const version = snapshotVersion || `${Date.now()}-${crypto.randomUUID()}`;
  let chunkCount = 0;
  for (let i = 0; i < rows.length; i += CHUNK_SIZE, chunkCount++) {
    const part = rows.slice(i, i + CHUNK_SIZE);
    await putPrivateJson(env, b, `${PREFIX}/source/${version}/${String(chunkCount).padStart(4, "0")}.json`, part);
  }
  // R2 conditional put atomically protects the pointer from concurrent imports.
  // If another upload publishes while these chunks are written, fail safely and
  // leave its complete snapshot active for the user to retry against.
  const onlyIf = conditional ? (state.object ? { etagMatches: state.object.etag } : new Headers({ "If-None-Match": "*" })) : undefined;
  const published = await putPrivateJson(env, b, META_KEY, {
    snapshotVersion: version,
    rowsCount: rows.length,
    chunkCount,
    mappingCount: mappings.length,
    mappings,
    manualIndex: buildManualIndex(rows),
    digitalImportedMonths: [...new Set(rows.filter(row => !row.manual_key && isDigitalSingleRow(row)).map(row => row.settlement_ym).filter(month => /^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(month)))],
    builtAt: new Date().toISOString(),
  }, undefined, onlyIf);
  if (conditional && published === null) throw new Error("append_snapshot_changed_retry");
  await invalidateAnalyticsCache(env);
  if (!options.preservePriorSnapshot && !oldMeta?.chunkVersions && oldMeta?.snapshotVersion && oldMeta.snapshotVersion !== version) {
    await deletePrefix(b, `${PREFIX}/source/${oldMeta.snapshotVersion}/`).catch(() => {});
  }
  return { snapshotVersion: version, rowsCount: rows.length, chunkCount };
}

function snapshotChunkKey(meta, no) {
  return `${PREFIX}/source/${meta.chunkVersions?.[no] || meta.snapshotVersion}/${String(no).padStart(4, "0")}.json`;
}

function buildManualIndex(rows) {
  const index = {};
  rows.forEach((row, position) => {
    if (!row.manual_key) return;
    if (!/^[a-f0-9]{64}$/.test(row.manual_key) || !/^[a-f0-9]{64}$/.test(row.manual_fingerprint || "") ||
        !Number.isSafeInteger(row.id) || row.id >= 0 || Object.hasOwn(index, row.manual_key)) throw new Error("invalid_manual_snapshot_row");
    index[row.manual_key] = { id: row.id, fingerprint: row.manual_fingerprint, chunkNo: Math.floor(position / CHUNK_SIZE) };
  });
  return index;
}

function manualIndexFromMeta(meta) {
  const index = meta.manualIndex ?? {};
  if (!index || typeof index !== "object" || Array.isArray(index)) throw new Error("invalid_manual_snapshot_index");
  for (const [key, entry] of Object.entries(index)) {
    if (!/^[a-f0-9]{64}$/.test(key) || !entry || !/^[a-f0-9]{64}$/.test(entry.fingerprint || "") ||
        !Number.isSafeInteger(entry.id) || entry.id >= 0 || !Number.isSafeInteger(entry.chunkNo) ||
        entry.chunkNo < 0 || entry.chunkNo >= meta.chunkCount) throw new Error("invalid_manual_snapshot_index");
  }
  return index;
}

// A one-row manual save decrypts and rewrites one bounded chunk. Immutable
// references retain every imported row without rebuilding the whole history.
export async function saveManualSettlementRow(env, row, { replaceExisting = false, expectedFingerprint = null } = {}) {
  const b = bucket(env);
  if (!b) throw new Error("r2_binding_missing");
  buildManualIndex([row]);
  const state = await getMetaState(env), meta = state.meta;
  readManifestFromMeta(meta);
  if (!state.object?.etag) throw new Error("append_snapshot_etag_missing");
  const index = manualIndexFromMeta(meta), entry = index[row.manual_key];
  if (meta.digitalImportedMonths?.includes(row.settlement_ym)) throw new Error("manual_month_already_imported");
  let no, part, replaced = false;
  if (entry) {
    no = entry.chunkNo;
    const obj = await b.get(snapshotChunkKey(meta, no));
    if (!obj) throw new Error("r2_snapshot_incomplete");
    const decoded = await getPrivateJson(env, obj);
    part = Array.isArray(decoded) ? decoded : decoded?.rows;
    if (!Array.isArray(part) || part.length !== Math.min(CHUNK_SIZE, meta.rowsCount - no * CHUNK_SIZE) ||
        part.some(value => !value || typeof value !== "object" || Array.isArray(value))) throw new Error("r2_snapshot_count_mismatch");
    const matches = part.map((value, position) => ({ value, position })).filter(item => item.value?.manual_key === row.manual_key);
    if (matches.length !== 1 || matches[0].value.id !== entry.id || matches[0].value.manual_fingerprint !== entry.fingerprint) throw new Error("invalid_manual_snapshot_index");
    await getSettlementSnapshotManifest(env, meta.snapshotVersion);
    const previous = matches[0].value;
    if (entry.fingerprint === row.manual_fingerprint) return { ok: true, duplicate: true, replaced: false, id: previous.id, snapshotVersion: meta.snapshotVersion, rowsCount: meta.rowsCount };
    if (!replaceExisting) {
      const conflict = new Error("manual_entry_exists");
      conflict.previous = previous;
      throw conflict;
    }
    if (expectedFingerprint !== previous.manual_fingerprint) {
      const conflict = new Error("manual_entry_changed_retry");
      conflict.previous = previous;
      throw conflict;
    }
    row = { ...row, id: previous.id };
    part = part.slice(); part[matches[0].position] = row;
    replaced = true;
  } else {
    if (replaceExisting) throw new Error("manual_entry_changed_retry");
    no = Math.floor(meta.rowsCount / CHUNK_SIZE);
    part = [];
    if (meta.rowsCount % CHUNK_SIZE) {
      const obj = await b.get(snapshotChunkKey(meta, no));
      if (!obj) throw new Error("r2_snapshot_incomplete");
      const decoded = await getPrivateJson(env, obj);
      part = Array.isArray(decoded) ? decoded : decoded?.rows;
      if (!Array.isArray(part) || part.length !== meta.rowsCount % CHUNK_SIZE ||
          part.some(value => !value || typeof value !== "object" || Array.isArray(value))) throw new Error("r2_snapshot_count_mismatch");
      part = part.slice();
    }
    if (Object.values(index).some(value => value.id === row.id)) throw new Error("manual_id_conflict");
    part.push(row);
  }
  const version = `${Date.now()}-manual-${crypto.randomUUID()}`;
  await putPrivateJson(env, b, `${PREFIX}/source/${version}/${String(no).padStart(4, "0")}.json`, part);
  const chunkVersions = meta.chunkVersions ? meta.chunkVersions.slice() : Array(meta.chunkCount).fill(meta.snapshotVersion);
  chunkVersions[no] = version;
  const rowsCount = meta.rowsCount + (replaced ? 0 : 1);
  const published = await putPrivateJson(env, b, META_KEY, {
    ...meta, snapshotVersion: version, rowsCount, chunkCount: Math.ceil(rowsCount / CHUNK_SIZE), chunkVersions,
    manualIndex: { ...index, [row.manual_key]: { id: row.id, fingerprint: row.manual_fingerprint, chunkNo: no } },
    builtAt: new Date().toISOString(),
  }, undefined, { etagMatches: state.object.etag });
  if (published === null) throw new Error("append_snapshot_changed_retry");
  return { ok: true, duplicate: false, replaced, id: row.id, snapshotVersion: version, rowsCount };
}

function isDigitalSingleRow(row) {
  const provider = canonicalSettlementText(row?.distributor).toLowerCase().replace(/\s/g, "");
  return ["디지털레코즈", "디지털레코드", "digitalrecords"].includes(provider) && canonicalSettlementText(row?.song_title) === "오우야";
}

async function readManualRows(env, meta) {
  readManifestFromMeta(meta);
  const entries = Object.entries(manualIndexFromMeta(meta)), rows = [];
  const byChunk = new Map();
  for (const [key, entry] of entries) {
    if (!byChunk.has(entry.chunkNo)) byChunk.set(entry.chunkNo, []);
    byChunk.get(entry.chunkNo).push([key, entry]);
  }
  for (const [no, group] of byChunk) {
    const obj = await bucket(env).get(snapshotChunkKey(meta, no));
    if (!obj) throw new Error("r2_snapshot_incomplete");
    const decoded = await getPrivateJson(env, obj), part = Array.isArray(decoded) ? decoded : decoded?.rows;
    if (!Array.isArray(part) || part.length !== Math.min(CHUNK_SIZE, meta.rowsCount - no * CHUNK_SIZE) ||
        part.some(value => !value || typeof value !== "object" || Array.isArray(value))) throw new Error("r2_snapshot_count_mismatch");
    for (const [key, entry] of group) {
      const matches = part.filter(row => row?.manual_key === key);
      if (matches.length !== 1 || matches[0].id !== entry.id || matches[0].manual_fingerprint !== entry.fingerprint) throw new Error("invalid_manual_snapshot_index");
      rows.push(matches[0]);
    }
  }
  return rows;
}

function assertNoManualImportOverlap(importedRows, manualRows) {
  const manualMonths = new Set(manualRows.filter(isDigitalSingleRow).map(row => row.settlement_ym));
  if (importedRows.some(row => !row.manual_key && isDigitalSingleRow(row) && manualMonths.has(row.settlement_ym))) throw new Error("manual_import_overlap");
}

export function canonicalSettlementText(value) {
  let valueText = String(value ?? "");
  const entities = { amp: "&", apos: "'", quot: '"', lt: "<", gt: ">", nbsp: " " };
  for (let pass = 0; pass < 2; pass++) {
    valueText = valueText.replace(/&(#x[\da-f]+|#\d+|amp|apos|quot|lt|gt|nbsp);/gi, (whole, name) => {
      if (name[0] !== "#") return entities[name.toLowerCase()] ?? whole;
      const code = name[1].toLowerCase() === "x" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    });
  }
  return valueText.normalize("NFC").trim();
}

function identityCount(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : fallback;
}

function identityAmount(row) {
  const number = Number(row.settlement_amount);
  return Number.isFinite(number) ? number : 0;
}

// The amount remains separate so comparisons retain the D1 import tolerance.
export function settlementImportIdentity(row, business = false) {
  const fields = business
    ? [row.distributor, row.settlement_ym, row.artist, row.album_title, row.song_title, row.original_platform, row.original_service]
    : [identityCount(row.source_row_no, -1), row.distributor, row.settlement_ym, row.song_title, row.source_key];
  const identity = fields.map(canonicalSettlementText);
  if (business) identity.push(identityCount(row.original_count));
  return JSON.stringify(identity);
}

export function isRawSettlementImport(row) {
  return row?.import_format === "minerva" || row?.import_format === "luminant";
}

function luminantCodeIdentity(row) {
  const fields = String(row?.month_song_key ?? "").split("|");
  if (fields.length !== 4 || fields[1] !== "luminant" || !fields[2] || !fields[3]) return null;
  return JSON.stringify(fields.slice(2).map(canonicalSettlementText));
}

function compatibleBusinessCodes(left, right) {
  const leftCodes = luminantCodeIdentity(left), rightCodes = luminantCodeIdentity(right);
  // Legacy integrated statements have no provider codes. Preserve their old
  // business overlap, while distinct coded Luminant releases stay distinct.
  return !leftCodes || !rightCodes || leftCodes === rightCodes;
}

export function validateLuminantImportRow(row) {
  if (row?.import_format !== "luminant") return;
  const period = row.settlement_ym;
  if (typeof period !== "string" || !/^(19\d{2}|20\d{2}|21\d{2}|2200)-(0[1-9]|1[0-2])$/.test(period)) throw new Error("invalid_luminant_settlement_month");
  const settlementYear = Number(period.slice(0, 4)), settlementMonth = Number(period.slice(5, 7));
  const date = new Date(Date.UTC(settlementYear, settlementMonth - 4, 1));
  const occurrence = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  if (row.occurrence_ym !== occurrence) throw new Error("invalid_luminant_occurrence_month");
  for (const [field, expected] of [["settlement_year", settlementYear], ["settlement_month", settlementMonth],
    ["occurrence_year", date.getUTCFullYear()], ["occurrence_month", date.getUTCMonth() + 1]]) {
    if (row[field] !== undefined && row[field] !== expected) throw new Error("invalid_luminant_period_metadata");
  }
  if (!Number.isSafeInteger(row.import_occurrence) || row.import_occurrence < 1) throw new Error("invalid_luminant_row_occurrence");
  if (!Number.isSafeInteger(row.source_row_no) || row.source_row_no < 1) throw new Error("invalid_luminant_source_row");
  if (typeof row.settlement_amount !== "number" || !Number.isFinite(row.settlement_amount)) throw new Error("invalid_luminant_settlement_amount");
  if (!Number.isSafeInteger(row.original_count)) throw new Error("invalid_luminant_count");
  for (const field of ["adjusted_count", "analysis_count"]) {
    if (row[field] !== undefined && row[field] !== null && !Number.isSafeInteger(row[field])) throw new Error("invalid_luminant_count");
  }
  if (row.gross_amount !== undefined && (typeof row.gross_amount !== "number" || !Number.isFinite(row.gross_amount))) throw new Error("invalid_luminant_gross_amount");
  for (const field of ["artist", "album_title", "song_title", "original_platform", "original_service", "source_key", "month_song_key"]) {
    if (typeof row[field] !== "string" || !row[field].trim()) throw new Error("invalid_luminant_business_metadata");
  }
  if (row.distributor !== "루미넌트" || row.source_key !== `${row.original_platform}|${row.original_service}`) throw new Error("invalid_luminant_business_metadata");
  const codes = String(row.month_song_key).split("|");
  if (codes.length !== 4 || codes[0] !== period || codes[1] !== "luminant" || !codes[2].trim() || !codes[3].trim()) throw new Error("invalid_luminant_code_metadata");
  if ((row.album_code !== undefined && row.album_code !== codes[2]) || (row.song_code !== undefined && row.song_code !== codes[3])) throw new Error("invalid_luminant_code_metadata");
  const prefix = row.import_business_prefix, seenCodes = new Set();
  let currentCount = null, totalCount = 0;
  if (!Array.isArray(prefix) || !prefix.length) throw new Error("invalid_luminant_business_prefix");
  for (const entry of prefix) {
    if (!Array.isArray(entry) || entry.length !== 3 || typeof entry[0] !== "string" || !entry[0].trim() ||
        typeof entry[1] !== "string" || !entry[1].trim() || !Number.isSafeInteger(entry[2]) || entry[2] < 1) throw new Error("invalid_luminant_business_prefix");
    const key = JSON.stringify(entry.slice(0, 2).map(canonicalSettlementText));
    if (seenCodes.has(key)) throw new Error("invalid_luminant_business_prefix");
    seenCodes.add(key);
    totalCount += entry[2];
    if (!Number.isSafeInteger(totalCount)) throw new Error("invalid_luminant_business_prefix");
    if (key === luminantCodeIdentity(row)) currentCount = entry[2];
  }
  if (currentCount !== row.import_occurrence) throw new Error("invalid_luminant_business_prefix");
}

export function countSettlementBusinessMatches(existingRows, row) {
  const key = settlementImportIdentity(row, true), amount = identityAmount(row);
  return existingRows.reduce((count, existing) => count + (settlementImportIdentity(existing, true) === key &&
    compatibleBusinessCodes(existing, row) && Math.abs(identityAmount(existing) - amount) < 0.0000001 ? 1 : 0), 0);
}

export function hasSettlementBusinessImportOccurrence(existingRows, row) {
  if (row.import_format !== "luminant") return countSettlementBusinessMatches(existingRows, row) >= row.import_occurrence;
  const key = settlementImportIdentity(row, true), amount = identityAmount(row), codedCounts = new Map();
  let uncodedCount = 0;
  for (const existing of existingRows) {
    if (settlementImportIdentity(existing, true) !== key || Math.abs(identityAmount(existing) - amount) >= 0.0000001) continue;
    const code = luminantCodeIdentity(existing);
    if (code) codedCounts.set(code, (codedCounts.get(code) || 0) + 1);
    else uncodedCount++;
  }
  const currentCode = luminantCodeIdentity(row);
  if ((codedCounts.get(currentCode) || 0) >= row.import_occurrence) return true;
  // Prefix counts span the whole selected statement. After coded historical
  // matches are consumed, allocate each uncoded integrated row once, including
  // when the preceding raw rows were posted in an earlier request chunk.
  let uncodedUsedBefore = 0;
  for (const [albumCode, songCode, count] of row.import_business_prefix) {
    const code = JSON.stringify([albumCode, songCode].map(canonicalSettlementText));
    const countBefore = count - (code === currentCode ? 1 : 0);
    uncodedUsedBefore += Math.max(0, countBefore - (codedCounts.get(code) || 0));
  }
  return uncodedCount > uncodedUsedBefore;
}

function providerIdentity(row) {
  return JSON.stringify([row.original_platform, row.original_service].map(canonicalSettlementText));
}

function mergeMappings(current, incoming) {
  const byKey = new Map();
  for (const mapping of [...current, ...incoming]) {
    const key = canonicalSettlementText(mapping?.source_key);
    if (key) byKey.set(key, mapping);
  }
  return Array.from(byKey.values());
}

export function buildSettlementImportPlatformResolver(existingRows, mappings = []) {
  const mappedKeys = new Map(), mappedProviders = new Map(), priorProviders = new Map();
  const addPlatform = (map, key, platform) => {
    const name = canonicalSettlementText(platform);
    if (!name || name === "미분류") return;
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(name);
  };
  for (const mapping of mappings) {
    addPlatform(mappedKeys, canonicalSettlementText(mapping.source_key), mapping.platform);
    addPlatform(mappedProviders, providerIdentity(mapping), mapping.platform);
  }
  for (const row of existingRows) addPlatform(priorProviders, providerIdentity(row), row.platform);
  const singlePlatform = values => values?.size === 1 ? Array.from(values)[0] : null;
  return row => singlePlatform(mappedKeys.get(canonicalSettlementText(row.source_key))) ||
    singlePlatform(mappedProviders.get(providerIdentity(row))) ||
    singlePlatform(priorProviders.get(providerIdentity(row))) || row.platform;
}

export function resolveSettlementImportPlatform(row, existingRows, mappings = []) {
  return buildSettlementImportPlatformResolver(existingRows, mappings)(row);
}

export function mergeImportRows(existingRows, incomingRows, mappings = []) {
  const rows = existingRows.slice(), exact = new Map(), business = new Map(), incomingRaw = new Map();
  const add = (map, key, row) => {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push({ amount: identityAmount(row), row, used: false });
  };
  for (const row of existingRows) {
    add(exact, settlementImportIdentity(row), row);
    add(business, settlementImportIdentity(row, true), row);
  }
  const resolvePlatform = buildSettlementImportPlatformResolver(existingRows, mappings);
  let appended = 0, duplicates = 0;
  for (const input of incomingRows) {
    const raw = isRawSettlementImport(input);
    const row = raw ? { ...input } : input;
    validateLuminantImportRow(row);
    if (raw) {
      const physicalKey = JSON.stringify([canonicalSettlementText(row.source_file), identityCount(row.source_row_no, -1),
        settlementImportIdentity(row, true), luminantCodeIdentity(row)]);
      const amount = identityAmount(row);
      if ((incomingRaw.get(physicalKey) || []).some(candidate => Math.abs(candidate.amount - amount) < 0.0000001)) {
        duplicates++;
        continue;
      }
      add(incomingRaw, physicalKey, row);
      row.platform = resolvePlatform(row);
    }
    const map = raw ? business : exact;
    const key = settlementImportIdentity(row, raw), amount = identityAmount(row);
    const candidates = (map.get(key) || []).filter(candidate => (!raw || !candidate.used) &&
      (!raw || compatibleBusinessCodes(candidate.row, row)) && Math.abs(candidate.amount - amount) < 0.0000001);
    // Prefer an exact coded release over an uncoded integrated overlap so the
    // latter can still match another release from this same statement.
    const codes = raw ? luminantCodeIdentity(row) : null;
    const match = (codes && candidates.find(candidate => luminantCodeIdentity(candidate.row) === codes)) || candidates[0];
    if (match) {
      // Raw statements may contain legitimate equal-valued rows. Consume each
      // old match once, preserving the incoming statement's multiplicity.
      if (raw) match.used = true;
      duplicates++;
      continue;
    }
    rows.push(row);
    add(exact, settlementImportIdentity(row), row);
    appended++;
  }
  return { rows, appended, duplicates, rowsCount: rows.length };
}

async function readStagedRows(env, version, count, expectedRows) {
  const b = bucket(env), rows = [];
  for (let start = 0; start < count; start += 8) {
    const objects = await Promise.all(Array.from({ length: Math.min(8, count - start) }, (_, offset) =>
      b.get(`${PREFIX}/source/${version}/${String(start + offset).padStart(4, "0")}.json`)));
    for (const object of objects) {
      if (!object) throw new Error("r2_upload_chunk_missing");
      const part = await getPrivateJson(env, object);
      if (!Array.isArray(part) || part.length > CHUNK_SIZE) throw new Error("invalid_chunk_rows");
      rows.push(...part);
    }
  }
  if (rows.length !== expectedRows) throw new Error("r2_upload_count_mismatch");
  return rows;
}

async function snapshotForAppend(env, meta) {
  if (meta) return readR2Snapshot(env, meta);
  if (!env.SETTLEMENT_DB) throw new Error("append_d1_binding_missing");
  // Preserve legacy D1 data before introducing the first R2 snapshot. Errors
  // must propagate: an unreadable D1 database is never equivalent to empty data.
  const rows = await env.SETTLEMENT_DB.prepare(RAW_SELECT).all();
  const mappings = await env.SETTLEMENT_DB.prepare("SELECT source_key,platform,original_platform,original_service FROM settlement_platform_mapping").all();
  if (rows?.success === false || mappings?.success === false || !Array.isArray(rows?.results) || !Array.isArray(mappings?.results)) throw new Error("append_d1_read_failed");
  return { rows: rows.results, mappings: mappings.results };
}

export async function seedSnapshotChunk(env, { snapshotVersion, chunkNo, rows, finalChunk, totalRows, mappings, mode }) {
  const b = bucket(env);
  if (!b) throw new Error("r2_binding_missing");
  const version = String(snapshotVersion || "").trim();
  if (!version) throw new Error("snapshot_version_required");
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(version)) throw new Error("invalid_snapshot_version");
  if (mode !== undefined && mode !== "append" && mode !== "replace") throw new Error("invalid_import_mode");
  const no = Number(chunkNo);
  if (!Number.isInteger(no) || no < 0) throw new Error("invalid_chunk_no");
  if (!Array.isArray(rows) || rows.length > CHUNK_SIZE) throw new Error("invalid_chunk_rows");
  const validateIncoming = incoming => {
    for (const row of incoming) validateLuminantImportRow(row);
    const hasMinerva = incoming.some(row => row?.import_format === "minerva");
    const hasLuminant = incoming.some(row => row?.import_format === "luminant");
    if (hasLuminant && mode !== "append") throw new Error("luminant_append_required");
    if (hasMinerva && mode !== "append") throw new Error("minerva_append_required");
    if ((hasMinerva || hasLuminant) && incoming.some(row => !isRawSettlementImport(row))) throw new Error("mixed_import_formats");
  };
  // Reject invalid raw metadata before staging anything; repeat across all
  // staged chunks before publishing so a later chunk cannot bypass the guard.
  validateIncoming(rows);
  const expectedRows = Number(totalRows);
  if (finalChunk && (!Number.isInteger(expectedRows) || expectedRows < 0)) throw new Error("invalid_total_rows");
  const beforeMeta = await getMeta(env);
  if (beforeMeta?.snapshotVersion === version) throw new Error("snapshot_version_already_active");
  await putPrivateJson(env, b, `${PREFIX}/source/${version}/${String(no).padStart(4, "0")}.json`, rows);
  if (finalChunk) {
    const chunkCount = no + 1;
    const incoming = await readStagedRows(env, version, chunkCount, expectedRows);
    validateIncoming(incoming);
    const oldMeta = await getMeta(env);
    if (mode === "append") {
      const current = await snapshotForAppend(env, oldMeta);
      assertNoManualImportOverlap(incoming, current.rows.filter(row => row.manual_key));
      const combinedMappings = mergeMappings(current.mappings || [], Array.isArray(mappings) ? mappings : []);
      const merged = mergeImportRows(current.rows, incoming, combinedMappings);
      let publishedVersion = oldMeta?.snapshotVersion;
      if (merged.appended || JSON.stringify(combinedMappings) !== JSON.stringify(current.mappings || []) || !oldMeta) {
        const mergedVersion = `${version}-merged-${crypto.randomUUID()}`;
        await writeSnapshotFromRows(env, merged.rows, combinedMappings, mergedVersion, {
          expectedSnapshotVersion: oldMeta?.snapshotVersion || null, preservePriorSnapshot: true,
        });
        publishedVersion = mergedVersion;
      }
      await deletePrefix(b, `${PREFIX}/source/${version}/`).catch(() => {});
      return { ok: true, mode: "append", snapshotVersion: publishedVersion, chunkNo: no, rows: rows.length, finalChunk: true,
        appended: merged.appended, duplicates: merged.duplicates, rowsCount: merged.rowsCount };
    }
    const manualRows = oldMeta ? await readManualRows(env, oldMeta) : [];
    assertNoManualImportOverlap(incoming, manualRows);
    if (manualRows.length) {
      const importedRows = incoming.filter(row => !row?.manual_key);
      const mergedVersion = `${version}-manual-${crypto.randomUUID()}`;
      const nextRows = [...importedRows, ...manualRows];
      const written = await writeSnapshotFromRows(env, nextRows, Array.isArray(mappings) ? mappings : [], mergedVersion, {
        expectedSnapshotVersion: oldMeta.snapshotVersion, preservePriorSnapshot: true,
      });
      return { ok: true, snapshotVersion: written.snapshotVersion, chunkNo: no, rows: rows.length, finalChunk: true,
        rowsCount: written.rowsCount, manualPreserved: manualRows.length };
    }
    // Conditional publication also protects a manual save finishing while an
    // Excel replacement is staged. The user retries against that newer state.
    await writeSnapshotFromRows(env, incoming, Array.isArray(mappings) ? mappings : [], version, {
      expectedSnapshotVersion: oldMeta?.snapshotVersion || null, preservePriorSnapshot: true,
    });
  }
  return { ok: true, snapshotVersion: version, chunkNo: no, rows: rows.length, finalChunk: !!finalChunk };
}

async function fallbackFromD1(env) {
  if (!env.SETTLEMENT_DB) return null;
  try {
    const result = await env.SETTLEMENT_DB.prepare(RAW_SELECT).all();
    const mappingResult = await env.SETTLEMENT_DB.prepare("SELECT source_key,platform,original_platform,original_service FROM settlement_platform_mapping").all();
    if (result?.success === false || mappingResult?.success === false || !Array.isArray(result?.results) || !Array.isArray(mappingResult?.results)) throw new Error("d1_snapshot_read_failed");
    const rows = result.results;
    const mappings = mappingResult.results;
    await writeSnapshotFromRows(env, rows, mappings, null, { expectedSnapshotVersion: null, preservePriorSnapshot: true });
    return {
      rows,
      source: "d1_one_time_seed_v16",
      snapshotVersion: null,
      builtAt: new Date().toISOString(),
      chunkCount: Math.ceil(rows.length / CHUNK_SIZE),
      mappings,
      mappingCount: mappings.length,
      d1RowsRead: Number(result.meta?.rows_read || rows.length) + Number(mappingResult.meta?.rows_read || mappings.length),
    };
  } catch (error) {
    if (String(error?.message) === "append_snapshot_changed_retry") return readR2Snapshot(env);
    console.warn("D1 fallback seed failed", error);
    return null;
  }
}

export async function loadSettlementRows(env) {
  const r2 = await readR2Snapshot(env);
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
  await writeSnapshotFromRows(env, snap.rows, snap.mappings || [], null, { expectedSnapshotVersion: snap.snapshotVersion, preservePriorSnapshot: true });
  return true;
}

export async function removeSnapshotRowById(env, id) {
  const snap = await readR2Snapshot(env);
  if (!snap) return false;
  const before = snap.rows.length;
  const rows = snap.rows.filter(r => Number(r.id) !== Number(id));
  if (rows.length === before) return false;
  await writeSnapshotFromRows(env, rows, snap.mappings || [], null, { expectedSnapshotVersion: snap.snapshotVersion, preservePriorSnapshot: true });
  return true;
}

export function getR2Status(env) {
  return { r2Ready: !!bucket(env), supportsAppend: true, supportsLuminant: true,
    binding: env.MEDIA ? "MEDIA" : env.SETTLEMENT_CACHE ? "SETTLEMENT_CACHE" : null };
}

function readManifestFromMeta(meta) {
  if (!meta) throw new Error("r2_seed_required");
  if (typeof meta.snapshotVersion !== "string" || !/^[a-zA-Z0-9_-]{1,180}$/.test(meta.snapshotVersion) ||
      !Number.isSafeInteger(meta.rowsCount) || meta.rowsCount < 0 ||
      !Number.isSafeInteger(meta.chunkCount) || meta.chunkCount < 0 ||
      meta.chunkCount !== Math.ceil(meta.rowsCount / CHUNK_SIZE)) throw new Error("invalid_r2_snapshot_meta");
  if (meta.chunkVersions !== undefined && (!Array.isArray(meta.chunkVersions) || meta.chunkVersions.length !== meta.chunkCount ||
      meta.chunkVersions.some(version => typeof version !== "string" || !/^[a-zA-Z0-9_-]{1,180}$/.test(version)))) throw new Error("invalid_r2_snapshot_meta");
  if (meta.digitalImportedMonths !== undefined && (!Array.isArray(meta.digitalImportedMonths) || meta.digitalImportedMonths.some(month => typeof month !== "string" || !/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(month)))) throw new Error("invalid_r2_snapshot_meta");
  manualIndexFromMeta(meta);
  const originalMappings = meta.mappings === undefined ? [] : meta.mappings;
  if (!Array.isArray(originalMappings) || originalMappings.some(mapping => !mapping || typeof mapping !== "object" || Array.isArray(mapping))) throw new Error("invalid_r2_snapshot_meta");
  const mappings = originalMappings.map(mapping => ({
    source_key: String(mapping.source_key ?? ""),
    platform: String(mapping.platform ?? ""),
    original_platform: String(mapping.original_platform ?? ""),
    original_service: String(mapping.original_service ?? ""),
  }));
  const mappingCount = meta.mappingCount === undefined ? mappings.length : meta.mappingCount;
  if (!Number.isInteger(mappingCount) || mappingCount !== mappings.length) throw new Error("invalid_r2_snapshot_meta");
  return { snapshotVersion: meta.snapshotVersion, rowsCount: meta.rowsCount, chunkCount: meta.chunkCount,
    chunkSize: CHUNK_SIZE, mappings, mappingCount, builtAt: typeof meta.builtAt === "string" ? meta.builtAt : null,
    source: "r2_chunked_v1", d1RowsRead: 0 };
}

// These read-only helpers deliberately avoid legacy D1 fallback and never
// rebuild a whole snapshot inside one Worker request.
export async function getSettlementSnapshotManifest(env, expectedSnapshotVersion = undefined) {
  if (!bucket(env)) throw new Error("r2_binding_missing");
  const manifest = readManifestFromMeta(await getMeta(env));
  if (expectedSnapshotVersion !== undefined && String(expectedSnapshotVersion) !== manifest.snapshotVersion) throw new Error("snapshot_changed_retry");
  return manifest;
}

export async function readSettlementSnapshotChunk(env, { snapshotVersion, chunkNo }) {
  const version = String(snapshotVersion ?? "").trim();
  if (!version) throw new Error("snapshot_version_required");
  const no = Number(chunkNo);
  if (chunkNo === null || chunkNo === undefined || String(chunkNo).trim() === "" || !Number.isSafeInteger(no) || no < 0) throw new Error("invalid_chunk_no");
  const meta = await getMeta(env), manifest = readManifestFromMeta(meta);
  if (version !== manifest.snapshotVersion) throw new Error("snapshot_changed_retry");
  if (no >= manifest.chunkCount) throw new Error("invalid_chunk_no");
  const b = bucket(env), object = await b.get(snapshotChunkKey(meta, no));
  if (!object) throw new Error("r2_snapshot_incomplete");
  const parsed = await getPrivateJson(env, object), rows = Array.isArray(parsed) ? parsed : parsed?.rows;
  const expectedRows = Math.min(CHUNK_SIZE, manifest.rowsCount - no * CHUNK_SIZE);
  if (!Array.isArray(rows) || rows.length !== expectedRows || rows.some(row => !row || typeof row !== "object" || Array.isArray(row))) throw new Error("r2_snapshot_count_mismatch");
  // Detect an import finishing while a chunk is in flight. The browser also
  // performs a final manifest check before adopting the completed snapshot.
  await getSettlementSnapshotManifest(env, version);
  return { snapshotVersion: version, chunkNo: no, rows, rowsCount: manifest.rowsCount, chunkCount: manifest.chunkCount };
}

export async function readSettlementSnapshotChunkBody(env, options) {
  const version = String(options.snapshotVersion ?? options.version ?? "").trim();
  const chunkNo = options.chunkNo ?? options.no, no = Number(chunkNo);
  if (!version) throw new Error("snapshot_version_required");
  if (chunkNo === null || chunkNo === undefined || String(chunkNo).trim() === "" || !Number.isSafeInteger(no) || no < 0) throw new Error("invalid_chunk_no");
  const meta = await getMeta(env), manifest = readManifestFromMeta(meta);
  if (version !== manifest.snapshotVersion) throw new Error("snapshot_changed_retry");
  if (no >= manifest.chunkCount) throw new Error("invalid_chunk_no");
  const object = await bucket(env).get(snapshotChunkKey(meta, no));
  if (!object) throw new Error("r2_snapshot_incomplete");
  const box = JSON.parse(await object.text());
  if (!box || box.v !== 1 || !box.iv || !box.data) throw new Error("invalid_r2_ciphertext");
  // Authenticate/decrypt the stored chunk without parsing and stringifying
  // hundreds of rows inside a Worker. The browser verifies its JSON shape and
  // exact row count before adopting any part of the completed snapshot.
  const key = await cryptoKey(env);
  const body = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64ToBytes(box.iv) }, key, b64ToBytes(box.data));
  await getSettlementSnapshotManifest(env, version);
  return { body, snapshotVersion: version, chunkNo: no, rowsCount: manifest.rowsCount, chunkCount: manifest.chunkCount };
}

export async function readSettlementManifest(env, expectedSnapshotVersion = undefined) {
  return getSettlementSnapshotManifest(env, expectedSnapshotVersion);
}

export async function readSettlementChunk(env, snapshotVersion, chunkNo) {
  return readSettlementSnapshotChunk(env, { snapshotVersion, chunkNo });
}
