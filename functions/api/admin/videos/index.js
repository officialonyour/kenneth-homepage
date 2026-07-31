import { json, error, readJson } from "../../../_shared/http.js";
import { sanitizeVideo } from "../../../_shared/data.js";

export async function onRequestPost({ request, env }) {
  if (!env.DB) return error("D1 바인딩 DB가 설정되지 않았습니다.", 503);
  try {
    const video = sanitizeVideo(await readJson(request));
    const insert = env.DB.prepare(`
      INSERT INTO videos (
        title, youtube_url, youtube_id, thumbnail_url, published_at,
        is_featured, sort_order, published, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).bind(
      video.title, video.youtube_url, video.youtube_id, video.thumbnail_url,
      video.published_at, video.is_featured, video.sort_order, video.published
    );

    const results = video.is_featured
      ? await env.DB.batch([
          env.DB.prepare("UPDATE videos SET is_featured = 0, updated_at = CURRENT_TIMESTAMP"),
          insert
        ])
      : [await insert.run()];

    const created = results.at(-1);
    return json({ ok: true, id: created?.meta?.last_row_id || null }, 201);
  } catch (cause) {
    return error(cause?.message || "영상 저장에 실패했습니다.", 400);
  }
}
