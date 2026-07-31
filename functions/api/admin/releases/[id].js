import { json, error, readJson, intValue } from "../../../_shared/http.js";
import { sanitizeRelease } from "../../../_shared/data.js";

export async function onRequestPut({ request, env, params }) {
  if (!env.DB) return error("D1 바인딩 DB가 설정되지 않았습니다.", 503);
  const id = intValue(params.id, 0, 1);
  if (!id) return error("잘못된 음원 번호입니다.", 400);

  try {
    const release = sanitizeRelease(await readJson(request));
    const update = env.DB.prepare(`
      UPDATE releases SET
        title = ?, release_type = ?, release_date = ?, genre = ?, description = ?, track_count = ?,
        cover_url = ?, primary_url = ?, spotify_url = ?, apple_music_url = ?, melon_url = ?,
        youtube_url = ?, soundcloud_url = ?, beatstars_url = ?,
        is_featured = ?, sort_order = ?, published = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(
      release.title, release.release_type, release.release_date, release.genre,
      release.description, release.track_count, release.cover_url, release.primary_url,
      release.spotify_url, release.apple_music_url, release.melon_url,
      release.youtube_url, release.soundcloud_url, release.beatstars_url,
      release.is_featured, release.sort_order, release.published, id
    );

    const results = release.is_featured
      ? await env.DB.batch([
          env.DB.prepare("UPDATE releases SET is_featured = 0, updated_at = CURRENT_TIMESTAMP WHERE id != ?").bind(id),
          update
        ])
      : [await update.run()];

    const updated = results.at(-1);
    if (!updated?.meta?.changes) return error("해당 음원을 찾을 수 없습니다.", 404);
    return json({ ok: true });
  } catch (cause) {
    return error(cause?.message || "음원 수정에 실패했습니다.", 400);
  }
}

export async function onRequestDelete({ env, params }) {
  if (!env.DB) return error("D1 바인딩 DB가 설정되지 않았습니다.", 503);
  const id = intValue(params.id, 0, 1);
  if (!id) return error("잘못된 음원 번호입니다.", 400);
  try {
    const result = await env.DB.prepare("DELETE FROM releases WHERE id = ?").bind(id).run();
    if (!result.meta?.changes) return error("해당 음원을 찾을 수 없습니다.", 404);
    return json({ ok: true });
  } catch (cause) {
    return error("음원 삭제에 실패했습니다.", 500, String(cause?.message || cause));
  }
}
