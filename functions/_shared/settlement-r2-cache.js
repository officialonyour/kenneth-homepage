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
  if (!meta.snapshotVersion || !Number.isInteger(meta.chunkCount) || meta.chunkCount < 0 ||
      !Number.isInteger(meta.rowsCount) || meta.rowsCount < 0) throw new Error("invalid_r2_snapshot_meta");
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
    builtAt: new Date().toISOString(),
  }, undefined, onlyIf);
  if (conditional && published === null) throw new Error("append_snapshot_changed_retry");
  await invalidateAnalyticsCache(env);
  if (!options.preservePriorSnapshot && oldMeta?.snapshotVersion && oldMeta.snapshotVersion !== version) {
    await deletePrefix(b, `${PREFIX}/source/${oldMeta.snapshotVersion}/`).catch(() => {});
  }
  return { snapshotVersion: version, rowsCount: rows.length, chunkCount };
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

export function countSettlementBusinessMatches(existingRows, row) {
  const key = settlementImportIdentity(row, true), amount = identityAmount(row);
  return existingRows.reduce((count, existing) => count + (settlementImportIdentity(existing, true) === key &&
    Math.abs(identityAmount(existing) - amount) < 0.0000001 ? 1 : 0), 0);
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
    map.get(key).push({ amount: identityAmount(row), used: false });
  };
  for (const row of existingRows) {
    add(exact, settlementImportIdentity(row), row);
    add(business, settlementImportIdentity(row, true), row);
  }
  const resolvePlatform = buildSettlementImportPlatformResolver(existingRows, mappings);
  let appended = 0, duplicates = 0;
  for (const input of incomingRows) {
    const raw = input.import_format === "minerva";
    const row = raw ? { ...input } : input;
    if (raw) {
      const physicalKey = JSON.stringify([canonicalSettlementText(row.source_file), identityCount(row.source_row_no, -1), settlementImportIdentity(row, true)]);
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
    const match = (map.get(key) || []).find(candidate => (!raw || !candidate.used) && Math.abs(candidate.amount - amount) < 0.0000001);
    if (match) {
      // Raw workbooks can contain legitimate identical rows. Consume an old
      // match once, preserving the incoming file's multiplicity on reimport.
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
  const beforeMeta = await getMeta(env);
  if (beforeMeta?.snapshotVersion === version) throw new Error("snapshot_version_already_active");
  await putPrivateJson(env, b, `${PREFIX}/source/${version}/${String(no).padStart(4, "0")}.json`, rows);
  if (finalChunk) {
    const expectedRows = Number(totalRows);
    if (!Number.isInteger(expectedRows) || expectedRows < 0) throw new Error("invalid_total_rows");
    const chunkCount = no + 1;
    const incoming = await readStagedRows(env, version, chunkCount, expectedRows);
    const hasMinerva = incoming.some(row => row?.import_format === "minerva");
    if (hasMinerva && mode !== "append") throw new Error("minerva_append_required");
    if (mode === "append" && hasMinerva && incoming.some(row => row?.import_format !== "minerva")) throw new Error("mixed_import_formats");
    const oldMeta = await getMeta(env);
    if (mode === "append") {
      const current = await snapshotForAppend(env, oldMeta);
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
    await putPrivateJson(env, b, META_KEY, {
      snapshotVersion: version,
      rowsCount: expectedRows,
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
  return { r2Ready: !!bucket(env), supportsAppend: true, binding: env.MEDIA ? "MEDIA" : env.SETTLEMENT_CACHE ? "SETTLEMENT_CACHE" : null };
}
