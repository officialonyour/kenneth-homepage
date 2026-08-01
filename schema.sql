PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS site_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  display_name TEXT NOT NULL DEFAULT 'KENNETH',
  role TEXT NOT NULL DEFAULT 'HIPHOP / EDM PRODUCER',
  hero_eyebrow TEXT NOT NULL DEFAULT 'HIPHOP / EDM PRODUCER',
  hero_title TEXT NOT NULL DEFAULT 'SOUND
THAT MOVES.',
  hero_description TEXT NOT NULL DEFAULT '묵직한 리듬과 선명한 에너지를 설계합니다.',
  hero_image_url TEXT NOT NULL DEFAULT '',
  contact_email TEXT NOT NULL DEFAULT 'kenneth.whee@gmail.com',
  accent_color TEXT NOT NULL DEFAULT '#ef7042',
  spotify_url TEXT NOT NULL DEFAULT 'https://open.spotify.com/artist/6TdOEKyyP53FqBQ50VDvlK',
  apple_music_url TEXT NOT NULL DEFAULT 'https://music.apple.com/kr/artist/1661635079',
  youtube_url TEXT NOT NULL DEFAULT 'https://youtube.com/channel/UCA05duT3IUBs3Wozk9htniQ',
  instagram_url TEXT NOT NULL DEFAULT 'https://www.instagram.com/kenneth_beats',
  melon_url TEXT NOT NULL DEFAULT '',
  soundcloud_url TEXT NOT NULL DEFAULT '',
  beatstars_url TEXT NOT NULL DEFAULT '',
  onyour_url TEXT NOT NULL DEFAULT 'https://onyour-homepage.pages.dev/',
  onyour_title TEXT NOT NULL DEFAULT 'ONYOUR',
  onyour_description TEXT NOT NULL DEFAULT '재즈 힙합 프로젝트의 음악과 라이브를 확인하세요.',
  onyour_image_url TEXT NOT NULL DEFAULT '',
  video_title TEXT NOT NULL DEFAULT '',
  video_url TEXT NOT NULL DEFAULT '',
  video_thumbnail_url TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);


CREATE TABLE IF NOT EXISTS releases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  release_type TEXT NOT NULL DEFAULT 'Single',
  release_date TEXT NOT NULL DEFAULT '',
  genre TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  cover_url TEXT NOT NULL DEFAULT '',
  primary_url TEXT NOT NULL DEFAULT '',
  spotify_url TEXT NOT NULL DEFAULT '',
  apple_music_url TEXT NOT NULL DEFAULT '',
  melon_url TEXT NOT NULL DEFAULT '',
  youtube_url TEXT NOT NULL DEFAULT '',
  soundcloud_url TEXT NOT NULL DEFAULT '',
  beatstars_url TEXT NOT NULL DEFAULT '',
  is_featured INTEGER NOT NULL DEFAULT 0 CHECK (is_featured IN (0, 1)),
  is_published INTEGER NOT NULL DEFAULT 1 CHECK (is_published IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS admin_login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip TEXT NOT NULL,
  attempted_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_releases_public
ON releases (is_published, is_featured, sort_order, release_date);

CREATE INDEX IF NOT EXISTS idx_login_attempts
ON admin_login_attempts (ip, attempted_at);

INSERT OR IGNORE INTO site_settings (
  id,
  display_name,
  role,
  hero_eyebrow,
  hero_title,
  hero_description,
  contact_email,
  accent_color,
  spotify_url,
  apple_music_url,
  youtube_url,
  instagram_url,
  onyour_url,
  onyour_title,
  onyour_description
) VALUES (
  1,
  'KENNETH',
  'HIPHOP / EDM PRODUCER',
  'HIPHOP / EDM PRODUCER',
  'SOUND
THAT MOVES.',
  '묵직한 리듬과 선명한 에너지를 설계합니다.',
  'kenneth.whee@gmail.com',
  '#ef7042',
  'https://open.spotify.com/artist/6TdOEKyyP53FqBQ50VDvlK',
  'https://music.apple.com/kr/artist/1661635079',
  'https://youtube.com/channel/UCA05duT3IUBs3Wozk9htniQ',
  'https://www.instagram.com/kenneth_beats',
  'https://onyour-homepage.pages.dev/',
  'ONYOUR',
  '재즈 힙합 프로젝트의 음악과 라이브를 확인하세요.'
);

INSERT OR IGNORE INTO releases (
  id,
  title,
  release_type,
  release_date,
  genre,
  is_featured,
  is_published,
  sort_order
) VALUES
  (1, 'Side by Side', 'Single', '2026-05-01', 'HIPHOP / EDM', 1, 1, 1),
  (2, 'STEP IN', 'Single', '2026-02-27', 'HIPHOP', 0, 1, 2),
  (3, 'Alive', 'Single', '2026-01-09', 'HIPHOP / EDM', 0, 1, 3),
  (4, 'dsm', 'Single', '2025-12-12', 'EDM', 0, 1, 4);

UPDATE sqlite_sequence
SET seq = MAX(seq, 4)
WHERE name = 'releases';
