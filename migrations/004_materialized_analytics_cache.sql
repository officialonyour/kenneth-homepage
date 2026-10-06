-- KENNETH MUSIC SETTLEMENT V15
-- Persistent materialized analytics cache and chunked source snapshot.
-- This migration creates cache tables only. It does not scan or modify the 8,152 source rows.

CREATE TABLE IF NOT EXISTS settlement_data_snapshot_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  snapshot_version TEXT NOT NULL,
  rows_count INTEGER NOT NULL DEFAULT 0,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  built_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settlement_data_snapshot_chunks (
  snapshot_version TEXT NOT NULL,
  chunk_no INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  rows_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (snapshot_version, chunk_no)
);

CREATE INDEX IF NOT EXISTS idx_settlement_snapshot_version
  ON settlement_data_snapshot_chunks(snapshot_version, chunk_no);

CREATE TABLE IF NOT EXISTS settlement_analytics_cache (
  cache_key TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL,
  generated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_settlement_analytics_cache_generated
  ON settlement_analytics_cache(generated_at);
