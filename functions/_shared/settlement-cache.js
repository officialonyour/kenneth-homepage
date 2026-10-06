const SNAPSHOT_CHUNK_SIZE = 250;

const RAW_SELECT = `SELECT
  distributor,settlement_ym,occurrence_ym,artist,album_title,song_title,platform,
  original_count,analysis_count,count_basis,settlement_amount,source_key
  FROM music_settlement_records`;

function rowsRead(result, fallback = 0) {
  return Number(result?.meta?.rows_read ?? fallback ?? 0);
}

function isCacheTableMissing(error) {
  return /no such table|settlement_(?:data_snapshot|analytics_cache)/i.test(String(error?.message || error || ""));
}

export async function getAnalyticsCache(db, cacheKey) {
  try {
    const row = await db.prepare(`SELECT payload_json,generated_at FROM settlement_analytics_cache WHERE cache_key=? LIMIT 1`)
      .bind(cacheKey).first();
    if (!row?.payload_json) return null;
    const payload = JSON.parse(row.payload_json);
    return { payload, generatedAt: row.generated_at || null, rowsRead: 1 };
  } catch (error) {
    if (!isCacheTableMissing(error)) console.warn("analytics cache read failed", error);
    return null;
  }
}

export async function setAnalyticsCache(db, cacheKey, payload) {
  try {
    await db.prepare(`INSERT INTO settlement_analytics_cache (cache_key,payload_json,generated_at)
      VALUES (?,?,datetime('now'))
      ON CONFLICT(cache_key) DO UPDATE SET payload_json=excluded.payload_json,generated_at=datetime('now')`)
      .bind(cacheKey, JSON.stringify(payload)).run();
  } catch (error) {
    if (!isCacheTableMissing(error)) console.warn("analytics cache write failed", error);
  }
}

async function readSnapshot(db) {
  try {
    const metaResult = await db.prepare(`SELECT snapshot_version,rows_count,built_at FROM settlement_data_snapshot_meta WHERE id=1 LIMIT 1`).all();
    const meta = metaResult.results?.[0];
    if (!meta?.snapshot_version) return null;
    const chunkResult = await db.prepare(`SELECT chunk_no,payload_json,rows_count
      FROM settlement_data_snapshot_chunks
      WHERE snapshot_version=? ORDER BY chunk_no`).bind(meta.snapshot_version).all();
    const chunks = chunkResult.results || [];
    if (!chunks.length && Number(meta.rows_count || 0) > 0) return null;
    const rows = [];
    for (const chunk of chunks) {
      const parsed = JSON.parse(chunk.payload_json || "[]");
      if (Array.isArray(parsed)) rows.push(...parsed);
    }
    if (rows.length !== Number(meta.rows_count || 0)) return null;
    return {
      rows,
      source: "snapshot_v15",
      rowsRead: rowsRead(metaResult, 1) + rowsRead(chunkResult, chunks.length),
      snapshotVersion: meta.snapshot_version,
      builtAt: meta.built_at || null,
      chunkCount: chunks.length,
    };
  } catch (error) {
    if (!isCacheTableMissing(error)) console.warn("snapshot read failed", error);
    return null;
  }
}

async function persistSnapshot(db, rows) {
  const version = `${Date.now()}-${crypto.randomUUID()}`;
  const statements = [];
  for (let i = 0, chunkNo = 0; i < rows.length; i += SNAPSHOT_CHUNK_SIZE, chunkNo++) {
    const slice = rows.slice(i, i + SNAPSHOT_CHUNK_SIZE);
    statements.push(db.prepare(`INSERT INTO settlement_data_snapshot_chunks
      (snapshot_version,chunk_no,payload_json,rows_count,created_at)
      VALUES (?,?,?,?,datetime('now'))`)
      .bind(version, chunkNo, JSON.stringify(slice), slice.length));
  }
  try {
    for (let i = 0; i < statements.length; i += 50) {
      await db.batch(statements.slice(i, i + 50));
    }
    await db.prepare(`INSERT INTO settlement_data_snapshot_meta
      (id,snapshot_version,rows_count,chunk_count,built_at)
      VALUES (1,?,?,?,datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        snapshot_version=excluded.snapshot_version,
        rows_count=excluded.rows_count,
        chunk_count=excluded.chunk_count,
        built_at=datetime('now')`)
      .bind(version, rows.length, statements.length).run();
    await db.prepare(`DELETE FROM settlement_data_snapshot_chunks WHERE snapshot_version<>?`).bind(version).run();
    return { snapshotVersion: version, chunkCount: statements.length };
  } catch (error) {
    if (!isCacheTableMissing(error)) console.warn("snapshot persist failed", error);
    return null;
  }
}

export async function loadSettlementRows(db) {
  const snapshot = await readSnapshot(db);
  if (snapshot) return snapshot;

  const rawResult = await db.prepare(RAW_SELECT).all();
  const rows = rawResult.results || [];
  const persisted = await persistSnapshot(db, rows);
  return {
    rows,
    source: persisted ? "raw_rebuild_v15" : "raw_fallback_v15",
    rowsRead: rowsRead(rawResult, rows.length),
    snapshotVersion: persisted?.snapshotVersion || null,
    chunkCount: persisted?.chunkCount || 0,
    builtAt: null,
  };
}

export async function invalidateSettlementCaches(db) {
  try {
    await db.batch([
      db.prepare(`DELETE FROM settlement_analytics_cache`),
      db.prepare(`DELETE FROM settlement_data_snapshot_meta`),
      db.prepare(`DELETE FROM settlement_data_snapshot_chunks`),
    ]);
  } catch (error) {
    if (!isCacheTableMissing(error)) console.warn("cache invalidation failed", error);
  }
}
