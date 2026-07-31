import { json, error, readJson } from "../../../_shared/http.js";
import { sanitizeRelease } from "../../../_shared/data.js";

export async function onRequestPost({ request, env }) {
  if (!env.DB) return error("D1 바인딩 DB가 설정되지 않았습니다.", 503);
  try {
    const release = sanitizeRelease(await readJson(request));
    const insert = env.DB.prepare(`
      INSERT INTO releases (
        title, release_type, release_date, genre, description, track_count,
        cover_url, primary_url, spotify_url, apple_music_url, melon_url,
        youtube_url, soundcloud_url, beatstars_url,
        is_featured, sort_order, published, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).bind(
      release.title, release.release_type, release.release_date, release.genre,
      release.description, release.track_count, release.cover_url, release.primary_url,
      release.spotify_url, release.apple_music_url, release.melon_url,
      release.youtube_url, release.soundcloud_url, release.beatstars_url,
      release.is_featured, release.sort_order, release.published
    );

    const results = release.is_featured
      ? await env.DB.batch([
          env.DB.prepare("UPDATE releases SET is_featured = 0, updated_at = CURRENT_TIMESTAMP"),
          insert
        ])
      : [await insert.run()];

    const created = results.at(-1);
    return json({ ok: true, id: created?.meta?.last_row_id || null }, 201);
  } catch (cause) {
    return error(cause?.message || "음원 저장에 실패했습니다.", 400);
  }
}
