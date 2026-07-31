PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS login_attempts (
  ip TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL DEFAULT 0,
  blocked_until INTEGER NOT NULL DEFAULT 0
) STRICT;

CREATE TABLE IF NOT EXISTS site_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;

CREATE TABLE IF NOT EXISTS releases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  release_type TEXT NOT NULL DEFAULT 'Single',
  release_date TEXT NOT NULL DEFAULT '',
  genre TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  track_count INTEGER NOT NULL DEFAULT 1,
  cover_url TEXT NOT NULL DEFAULT '',
  primary_url TEXT NOT NULL DEFAULT '',
  spotify_url TEXT NOT NULL DEFAULT '',
  apple_music_url TEXT NOT NULL DEFAULT '',
  melon_url TEXT NOT NULL DEFAULT '',
  youtube_url TEXT NOT NULL DEFAULT '',
  soundcloud_url TEXT NOT NULL DEFAULT '',
  beatstars_url TEXT NOT NULL DEFAULT '',
  is_featured INTEGER NOT NULL DEFAULT 0 CHECK (is_featured IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  published INTEGER NOT NULL DEFAULT 1 CHECK (published IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;

CREATE INDEX IF NOT EXISTS idx_releases_public
ON releases (published, is_featured DESC, sort_order, release_date DESC);

CREATE TABLE IF NOT EXISTS videos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  youtube_url TEXT NOT NULL,
  youtube_id TEXT NOT NULL,
  thumbnail_url TEXT NOT NULL DEFAULT '',
  published_at TEXT NOT NULL DEFAULT '',
  is_featured INTEGER NOT NULL DEFAULT 0 CHECK (is_featured IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  published INTEGER NOT NULL DEFAULT 1 CHECK (published IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;

CREATE INDEX IF NOT EXISTS idx_videos_public
ON videos (published, is_featured DESC, sort_order, published_at DESC);

INSERT OR IGNORE INTO site_settings (key, value) VALUES
  ('display_name', '이휘근'),
  ('english_name', 'HWEGEUN'),
  ('role', 'HIPHOP / EDM PRODUCER'),
  ('eyebrow', 'BEAT · VIBE · ENERGY'),
  ('hero_statement', '감정은 깊게,\n드롭은 강하게.'),
  ('hero_description', '힙합의 무게감과 EDM의 에너지를 하나의 사운드로 설계합니다.'),
  ('contact_email', 'kenneth.whee@gmail.com'),
  ('accent_color', '#ff5d2e'),
  ('accent_color_2', '#6af7df'),
  ('spotify_url', 'https://open.spotify.com/artist/6TdOEKyyP53FqBQ50VDvlK'),
  ('apple_music_url', 'https://music.apple.com/kr/artist/1661635079'),
  ('youtube_url', 'https://youtube.com/channel/UCA05duT3IUBs3Wozk9htniQ'),
  ('instagram_url', 'https://www.instagram.com/knth_whee'),
  ('melon_url', ''),
  ('soundcloud_url', ''),
  ('beatstars_url', ''),
  ('onyour_url', 'https://onyour-homepage.pages.dev/');

INSERT INTO releases (
  title, release_type, release_date, genre, description, track_count,
  cover_url, is_featured, sort_order, published
)
SELECT 'Side by Side', 'Single', '2026-05-01', 'HIPHOP / EDM',
       '현재 가장 선명한 이휘근의 사운드.', 1,
       '/assets/side-by-side.jpg', 1, 1, 1
WHERE NOT EXISTS (SELECT 1 FROM releases WHERE title = 'Side by Side' AND release_date = '2026-05-01');

INSERT INTO releases (
  title, release_type, release_date, genre, description, track_count,
  cover_url, is_featured, sort_order, published
)
SELECT 'STEP IN', 'Single', '2026-02-27', 'HIPHOP',
       '차가운 질감과 추진력을 담은 싱글.', 1,
       '/assets/step-in.jpg', 0, 2, 1
WHERE NOT EXISTS (SELECT 1 FROM releases WHERE title = 'STEP IN' AND release_date = '2026-02-27');

INSERT INTO releases (
  title, release_type, release_date, genre, description, track_count,
  cover_url, is_featured, sort_order, published
)
SELECT 'Alive', 'Single', '2026-01-09', 'HIPHOP / EDM',
       '두 곡으로 이어지는 에너지와 생동감.', 2,
       '/assets/alive.jpg', 0, 3, 1
WHERE NOT EXISTS (SELECT 1 FROM releases WHERE title = 'Alive' AND release_date = '2026-01-09');

INSERT INTO releases (
  title, release_type, release_date, genre, description, track_count,
  cover_url, is_featured, sort_order, published
)
SELECT 'dsm', 'Single', '2025-12-12', 'EDM',
       '차갑고 넓은 공간감 위에 쌓은 강한 드롭.', 1,
       '/assets/dsm.jpg', 0, 4, 1
WHERE NOT EXISTS (SELECT 1 FROM releases WHERE title = 'dsm' AND release_date = '2025-12-12');
