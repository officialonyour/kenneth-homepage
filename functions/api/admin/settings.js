import { json, cleanString, cleanUrl } from "../../_lib/http.js";
import { requireAdmin } from "../../_lib/admin.js";

const SETTINGS_FIELDS = [
  "display_name",
  "role",
  "hero_eyebrow",
  "hero_title",
  "hero_description",
  "hero_image_url",
  "contact_email",
  "accent_color",
  "spotify_url",
  "apple_music_url",
  "youtube_url",
  "instagram_url",
  "melon_url",
  "soundcloud_url",
  "beatstars_url",
  "onyour_url",
  "onyour_title",
  "onyour_description",
  "onyour_image_url",
  "video_title",
  "video_url",
  "video_thumbnail_url"
];

function normalizeSettings(input) {
  const urlFields = new Set([
    "hero_image_url",
    "spotify_url",
    "apple_music_url",
    "youtube_url",
    "instagram_url",
    "melon_url",
    "soundcloud_url",
    "beatstars_url",
    "onyour_url",
    "onyour_image_url",
    "video_url",
    "video_thumbnail_url"
  ]);

  const output = {};

  for (const field of SETTINGS_FIELDS) {
    if (urlFields.has(field)) {
      output[field] = cleanUrl(input[field]);
    } else if (field === "accent_color") {
      output[field] = /^#[0-9a-f]{6}$/i.test(input[field] || "")
        ? input[field]
        : "#ef7042";
    } else {
      output[field] = cleanString(input[field], 2000);
    }
  }

  return output;
}

export async function onRequestGet(context) {
  const unauthorized = await requireAdmin(context);
  if (unauthorized) return unauthorized;

  const settings = await context.env.DB.prepare(
    "SELECT * FROM site_settings WHERE id = 1"
  ).first();

  return json({ settings: settings || {} });
}

export async function onRequestPut(context) {
  const unauthorized = await requireAdmin(context);
  if (unauthorized) return unauthorized;

  const input = await context.request.json().catch(() => ({}));
  const values = normalizeSettings(input);

  await context.env.DB.prepare(
    `INSERT INTO site_settings (
      id,
      display_name,
      role,
      hero_eyebrow,
      hero_title,
      hero_description,
      hero_image_url,
      contact_email,
      accent_color,
      spotify_url,
      apple_music_url,
      youtube_url,
      instagram_url,
      melon_url,
      soundcloud_url,
      beatstars_url,
      onyour_url,
      onyour_title,
      onyour_description,
      onyour_image_url,
      video_title,
      video_url,
      video_thumbnail_url,
      updated_at
    ) VALUES (
      1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT(id) DO UPDATE SET
      display_name = excluded.display_name,
      role = excluded.role,
      hero_eyebrow = excluded.hero_eyebrow,
      hero_title = excluded.hero_title,
      hero_description = excluded.hero_description,
      hero_image_url = excluded.hero_image_url,
      contact_email = excluded.contact_email,
      accent_color = excluded.accent_color,
      spotify_url = excluded.spotify_url,
      apple_music_url = excluded.apple_music_url,
      youtube_url = excluded.youtube_url,
      instagram_url = excluded.instagram_url,
      melon_url = excluded.melon_url,
      soundcloud_url = excluded.soundcloud_url,
      beatstars_url = excluded.beatstars_url,
      onyour_url = excluded.onyour_url,
      onyour_title = excluded.onyour_title,
      onyour_description = excluded.onyour_description,
      onyour_image_url = excluded.onyour_image_url,
      video_title = excluded.video_title,
      video_url = excluded.video_url,
      video_thumbnail_url = excluded.video_thumbnail_url,
      updated_at = CURRENT_TIMESTAMP`
  )
    .bind(...SETTINGS_FIELDS.map((field) => values[field]))
    .run();

  const settings = await context.env.DB.prepare(
    "SELECT * FROM site_settings WHERE id = 1"
  ).first();

  return json({ settings });
}
