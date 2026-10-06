CREATE TABLE IF NOT EXISTS settlement_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  distributor TEXT NOT NULL DEFAULT '미분류',
  project_artist TEXT,
  song_title TEXT NOT NULL,
  settlement_year INTEGER,
  settlement_month INTEGER,
  settlement_ym TEXT,
  platform_source TEXT,
  gross_revenue REAL,
  settlement_amount REAL,
  total_income REAL,
  actual_count INTEGER,
  estimated_count INTEGER,
  count_type TEXT NOT NULL DEFAULT 'unknown' CHECK (count_type IN ('actual','estimated','unknown')),
  estimate_method TEXT,
  estimate_confidence TEXT,
  zero_count_adjustment_count INTEGER,
  payment_status TEXT,
  source_type TEXT,
  notes TEXT,
  import_batch_id TEXT,
  source_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_settlement_ym ON settlement_records(settlement_ym);
CREATE INDEX IF NOT EXISTS idx_settlement_song ON settlement_records(song_title);
CREATE INDEX IF NOT EXISTS idx_settlement_distributor ON settlement_records(distributor);
CREATE INDEX IF NOT EXISTS idx_settlement_payment ON settlement_records(payment_status);
CREATE INDEX IF NOT EXISTS idx_settlement_batch ON settlement_records(import_batch_id);
