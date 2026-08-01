import { json, cleanString, cleanUrl } from "../../_lib/http.js";
import { requireAdmin } from "../../_lib/admin.js";

const RELEASE_FIELDS = [
  "title",
  "release_type",
  "release_date",
  "genre",
  "description",
  "cover_url",
  "primary_url",
  "spotify_url",
  "apple_music_url",
  "melon_url",
  "youtube_url",
  "soundcloud_url",
  "beatstars_url",
  "is_featured",
  "is_published",
  "sort_order"
];

function normalizeRelease(input) {
  const urlFields = new Set([
    "cover_url",
    "primary_url",
    "spotify_url",
    "apple_music_url",
    "melon_url",
    "youtube_url",
    "soundcloud_url",
    "beatstars_url"
  ]);

  const output = {};

  for (const field of RELEASE_FIELDS) {
    if (urlFields.has(field)) {
      output[field] = cleanUrl(input[field]);
    } else if (["is_featured", "is_published"].includes(field)) {
      output[field] = Number(input[field]) === 1 ? 1 : 0;
    } else if (field === "sort_order") {
      output[field] = Number.isFinite(Number(input[field]))
        ? Number(input[field])
        : 0;
    } else {
      output[field] = cleanString(input[field], 2000);
    }
  }

  return output;
}

export async function onRequestGet(context) {
  const unauthorized = await requireAdmin(context);
  if (unauthorized) return unauthorized;

  const result = await context.env.DB.prepare(
    `SELECT *
     FROM releases
     ORDER BY sort_order ASC, release_date DESC, id DESC`
  ).all();

  return json({ releases: result.results || [] });
}

export async function onRequestPost(context) {
  const unauthorized = await requireAdmin(context);
  if (unauthorized) return unauthorized;

  const input = await context.request.json().catch(() => ({}));
  const values = normalizeRelease(input);

  if (!values.title) {
    return json({ error: "음원 제목을 입력해 주세요." }, 400);
  }

  if (values.is_featured === 1) {
    await context.env.DB.prepare(
      "UPDATE releases SET is_featured = 0"
    ).run();
  }

  const result = await context.env.DB.prepare(
    `INSERT INTO releases (
      title,
      release_type,
      release_date,
      genre,
      description,
      cover_url,
      primary_url,
      spotify_url,
      apple_music_url,
      melon_url,
      youtube_url,
      soundcloud_url,
      beatstars_url,
      is_featured,
      is_published,
      sort_order,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
  )
    .bind(...RELEASE_FIELDS.map((field) => values[field]))
    .run();

  const release = await context.env.DB.prepare(
    "SELECT * FROM releases WHERE id = ?"
  )
    .bind(result.meta.last_row_id)
    .first();

  return json({ release }, 201);
}
