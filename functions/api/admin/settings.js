import { json, error, readJson } from "../../_shared/http.js";
import { sanitizeSettings } from "../../_shared/data.js";

export async function onRequestPost({ request, env }) {
  if (!env.DB) return error("D1 바인딩 DB가 설정되지 않았습니다.", 503);
  try {
    const settings = sanitizeSettings(await readJson(request));
    const entries = Object.entries(settings);
    if (!entries.length) return error("저장할 설정이 없습니다.", 400);

    await env.DB.batch(entries.map(([key, value]) => env.DB.prepare(`
      INSERT INTO site_settings (key, value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    `).bind(key, value)));

    const result = await env.DB.prepare("SELECT key, value FROM site_settings ORDER BY key").all();
    return json({ ok: true, settings: Object.fromEntries((result.results || []).map((row) => [row.key, row.value])) });
  } catch (cause) {
    return error(cause?.message || "설정 저장에 실패했습니다.", 400);
  }
}
