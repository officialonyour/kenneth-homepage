import { cleanText, cleanUrl, intValue, youtubeId } from "./http.js";

export const SETTING_KEYS = [
  "display_name",
  "english_name",
  "role",
  "eyebrow",
  "hero_statement",
  "hero_description",
  "contact_email",
  "accent_color",
  "accent_color_2",
  "spotify_url",
  "apple_music_url",
  "youtube_url",
  "instagram_url",
  "melon_url",
  "soundcloud_url",
  "beatstars_url",
  "onyour_url"
];

export function sanitizeSettings(input = {}) {
  const output = {};
  for (const key of SETTING_KEYS) {
    if (!(key in input)) continue;
    if (key.endsWith("_url")) output[key] = cleanUrl(input[key]);
    else if (key === "contact_email") output[key] = cleanText(input[key], 254);
    else if (key.startsWith("accent_color")) {
      const color = cleanText(input[key], 7);
      output[key] = /^#[0-9a-f]{6}$/i.test(color) ? color : "";
    } else if (key === "hero_statement" || key === "hero_description") output[key] = cleanText(input[key], 1200);
    else output[key] = cleanText(input[key], 160);
  }
  return output;
}

export function sanitizeRelease(input = {}) {
  const title = cleanText(input.title, 160);
  if (!title) throw new Error("음원명을 입력해 주세요.");

  return {
    title,
    release_type: cleanText(input.release_type || "Single", 60),
    release_date: cleanText(input.release_date, 10),
    genre: cleanText(input.genre, 120),
    description: cleanText(input.description, 1200),
    track_count: intValue(input.track_count, 1, 1, 999),
    cover_url: cleanUrl(input.cover_url) || (String(input.cover_url || "").startsWith("/") ? cleanText(input.cover_url, 2048) : ""),
    primary_url: cleanUrl(input.primary_url),
    spotify_url: cleanUrl(input.spotify_url),
    apple_music_url: cleanUrl(input.apple_music_url),
    melon_url: cleanUrl(input.melon_url),
    youtube_url: cleanUrl(input.youtube_url),
    soundcloud_url: cleanUrl(input.soundcloud_url),
    beatstars_url: cleanUrl(input.beatstars_url),
    is_featured: intValue(input.is_featured, 0, 0, 1),
    sort_order: intValue(input.sort_order, 0, 0, 99999),
    published: 1
  };
}

export function sanitizeVideo(input = {}) {
  const title = cleanText(input.title, 200);
  const youtubeUrl = cleanUrl(input.youtube_url);
  const id = youtubeId(youtubeUrl);
  if (!title) throw new Error("영상 제목을 입력해 주세요.");
  if (!youtubeUrl || !id) throw new Error("올바른 YouTube 링크를 입력해 주세요.");

  return {
    title,
    youtube_url: youtubeUrl,
    youtube_id: id,
    thumbnail_url: `https://i.ytimg.com/vi/${encodeURIComponent(id)}/hqdefault.jpg`,
    published_at: cleanText(input.published_at, 10),
    is_featured: intValue(input.is_featured, 0, 0, 1),
    sort_order: intValue(input.sort_order, 0, 0, 99999),
    published: 1
  };
}

export async function fetchAllData(db, includeUnpublished = false) {
  const settingsResult = await db.prepare("SELECT key, value FROM site_settings ORDER BY key").all();
  const settings = Object.fromEntries((settingsResult.results || []).map((row) => [row.key, row.value]));
  const releaseWhere = includeUnpublished ? "" : "WHERE published = 1";
  const videoWhere = includeUnpublished ? "" : "WHERE published = 1";

  const [releasesResult, videosResult] = await Promise.all([
    db.prepare(`SELECT * FROM releases ${releaseWhere} ORDER BY is_featured DESC, sort_order ASC, release_date DESC, id DESC`).all(),
    db.prepare(`SELECT * FROM videos ${videoWhere} ORDER BY is_featured DESC, sort_order ASC, published_at DESC, id DESC`).all()
  ]);

  return {
    settings,
    releases: releasesResult.results || [],
    videos: videosResult.results || []
  };
}
