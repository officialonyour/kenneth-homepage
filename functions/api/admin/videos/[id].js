import { json, error, readJson, intValue } from "../../../_shared/http.js";
import { sanitizeVideo } from "../../../_shared/data.js";

export async function onRequestPut({ request, env, params }) {
  if (!env.DB) return error("D1 바인딩 DB가 설정되지 않았습니다.", 503);
  const id = intValue(params.id, 0, 1);
  if (!id) return error("잘못된 영상 번호입니다.", 400);

  try {
    const video = sanitizeVideo(await readJson(request));
    const update = env.DB.prepare(`
      UPDATE videos SET
        title = ?, youtube_url = ?, youtube_id = ?, thumbnail_url = ?, published_at = ?,
        is_featured = ?, sort_order = ?, published = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(
      video.title, video.youtube_url, video.youtube_id, video.thumbnail_url,
      video.published_at, video.is_featured, video.sort_order, video.published, id
    );

    const results = video.is_featured
      ? await env.DB.batch([
          env.DB.prepare("UPDATE videos SET is_featured = 0, updated_at = CURRENT_TIMESTAMP WHERE id != ?").bind(id),
          update
        ])
      : [await update.run()];

    const updated = results.at(-1);
    if (!updated?.meta?.changes) return error("해당 영상을 찾을 수 없습니다.", 404);
    return json({ ok: true });
  } catch (cause) {
    return error(cause?.message || "영상 수정에 실패했습니다.", 400);
  }
}

export async function onRequestDelete({ env, params }) {
  if (!env.DB) return error("D1 바인딩 DB가 설정되지 않았습니다.", 503);
  const id = intValue(params.id, 0, 1);
  if (!id) return error("잘못된 영상 번호입니다.", 400);
  try {
    const result = await env.DB.prepare("DELETE FROM videos WHERE id = ?").bind(id).run();
    if (!result.meta?.changes) return error("해당 영상을 찾을 수 없습니다.", 404);
    return json({ ok: true });
  } catch (cause) {
    return error("영상 삭제에 실패했습니다.", 500, String(cause?.message || cause));
  }
}
