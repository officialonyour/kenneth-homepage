import { json } from "../_lib/http.js";

export async function onRequestGet({ env }) {
  try {
    const [settings, releaseResult] = await Promise.all([
      env.DB.prepare("SELECT * FROM site_settings WHERE id = 1").first(),
      env.DB.prepare(
        `SELECT *
         FROM releases
         WHERE is_published = 1
         ORDER BY is_featured DESC, sort_order ASC, release_date DESC, id DESC`
      ).all()
    ]);

    return json(
      {
        settings: settings || {},
        releases: releaseResult.results || []
      },
      200,
      { "Cache-Control": "public, max-age=30, stale-while-revalidate=60" }
    );
  } catch (error) {
    return json(
      {
        error: "데이터베이스를 확인해 주세요.",
        detail: error.message
      },
      500
    );
  }
}
