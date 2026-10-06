CREATE TABLE IF NOT EXISTS music_settlement_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_row_no INTEGER,
  distributor TEXT NOT NULL DEFAULT '미분류',
  source_file TEXT,
  settlement_year INTEGER,
  settlement_month INTEGER,
  settlement_ym TEXT,
  occurrence_year INTEGER,
  occurrence_month INTEGER,
  occurrence_ym TEXT,
  artist TEXT,
  album_title TEXT,
  song_title TEXT NOT NULL,
  original_platform TEXT,
  original_service TEXT,
  source_key TEXT,
  platform TEXT,
  original_count INTEGER,
  adjusted_count INTEGER,
  analysis_count INTEGER,
  count_basis TEXT NOT NULL DEFAULT 'missing',
  estimate_method TEXT,
  estimate_confidence TEXT,
  settlement_amount REAL NOT NULL DEFAULT 0,
  revenue_source TEXT,
  notes TEXT,
  month_song_key TEXT,
  import_batch_id TEXT,
  row_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_msr_occurrence_ym ON music_settlement_records(occurrence_ym);
CREATE INDEX IF NOT EXISTS idx_msr_settlement_ym ON music_settlement_records(settlement_ym);
CREATE INDEX IF NOT EXISTS idx_msr_song ON music_settlement_records(song_title);
CREATE INDEX IF NOT EXISTS idx_msr_platform ON music_settlement_records(platform);
CREATE INDEX IF NOT EXISTS idx_msr_distributor ON music_settlement_records(distributor);
CREATE INDEX IF NOT EXISTS idx_msr_album ON music_settlement_records(album_title);
CREATE INDEX IF NOT EXISTS idx_msr_batch ON music_settlement_records(import_batch_id);
CREATE INDEX IF NOT EXISTS idx_msr_count_basis ON music_settlement_records(count_basis);

CREATE TABLE IF NOT EXISTS settlement_platform_mapping (
  source_key TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  original_platform TEXT,
  original_service TEXT,
  import_batch_id TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_spm_platform ON settlement_platform_mapping(platform);

CREATE TABLE IF NOT EXISTS settlement_import_batches (
  batch_id TEXT PRIMARY KEY,
  file_name TEXT,
  rows_received INTEGER NOT NULL DEFAULT 0,
  rows_inserted INTEGER NOT NULL DEFAULT 0,
  duplicate_rows INTEGER NOT NULL DEFAULT 0,
  mapping_rows INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);
