-- Optional migration: V4 authenticated login/list/upload/groups operations
-- initialize these tables automatically without altering existing tracks.
CREATE TABLE IF NOT EXISTS lyric_trainer_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS lyric_trainer_group_members (
  group_id TEXT NOT NULL,
  track_id TEXT NOT NULL,
  PRIMARY KEY (group_id, track_id),
  FOREIGN KEY (group_id) REFERENCES lyric_trainer_groups(id) ON DELETE CASCADE,
  FOREIGN KEY (track_id) REFERENCES lyric_trainer_tracks(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_lyric_trainer_group_members_track ON lyric_trainer_group_members(track_id);
