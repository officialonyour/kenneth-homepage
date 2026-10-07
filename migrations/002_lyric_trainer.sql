-- Optional manual migration. Authenticated V3 login/list/upload also creates
-- these feature-specific tables automatically in the existing DB binding.
CREATE TABLE IF NOT EXISTS lyric_trainer_tracks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  file_name TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  bytes INTEGER NOT NULL CHECK (bytes > 0),
  mime TEXT NOT NULL,
  bpm REAL,
  offset REAL NOT NULL DEFAULT 0,
  duration REAL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lyric_trainer_tracks_created_at ON lyric_trainer_tracks(created_at DESC);
CREATE TABLE IF NOT EXISTS lyric_trainer_login_attempts (
  key_hash TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  attempts INTEGER NOT NULL
);
