import {
  json,
  cleanString,
  cleanUrl
} from "../../_lib/http.js";

import {
  requireAdmin
} from "../../_lib/admin.js";

const SETTINGS_FIELDS = [
  "display_name",
  "role",
  "hero_eyebrow",
  "hero_title",
  "hero_description",
  "header_banner_url",
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

const URL_FIELDS =
  new Set([
    "header_banner_url",
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

function normalizeSettings(
  input
) {
  const output = {};

  for (
    const field
    of SETTINGS_FIELDS
  ) {
    if (
      URL_FIELDS.has(field)
    ) {
      output[field] =
        cleanUrl(
          input[field]
        );

      continue;
    }

    if (
      field ===
      "accent_color"
    ) {
      output[field] =
        /^#[0-9a-f]{6}$/i.test(
          input[field] || ""
        )
          ? input[field]
          : "#ef7042";

      continue;
    }

    output[field] =
      cleanString(
        input[field],
        2000
      );
  }

  return output;
}

export async function onRequestGet(
  context
) {
  const unauthorized =
    await requireAdmin(
      context
    );

  if (unauthorized) {
    return unauthorized;
  }

  const settings =
    await context.env.DB
      .prepare(
        `
          SELECT *
          FROM site_settings
          WHERE id = 1
        `
      )
      .first();

  return json({
    settings:
      settings || {}
  });
}

export async function onRequestPut(
  context
) {
  const unauthorized =
    await requireAdmin(
      context
    );

  if (unauthorized) {
    return unauthorized;
  }

  const input =
    await context.request
      .json()
      .catch(() => ({}));

  const values =
    normalizeSettings(
      input
    );

  const columns =
    SETTINGS_FIELDS.join(
      ", "
    );

  const placeholders =
    SETTINGS_FIELDS
      .map(() => "?")
      .join(", ");

  const updates =
    SETTINGS_FIELDS
      .map(
        (field) =>
          `${field} = excluded.${field}`
      )
      .join(", ");

  const query = `
    INSERT INTO site_settings (
      id,
      ${columns},
      updated_at
    )
    VALUES (
      1,
      ${placeholders},
      CURRENT_TIMESTAMP
    )
    ON CONFLICT(id)
    DO UPDATE SET
      ${updates},
      updated_at =
        CURRENT_TIMESTAMP
  `;

  await context.env.DB
    .prepare(query)
    .bind(
      ...SETTINGS_FIELDS.map(
        (field) =>
          values[field]
      )
    )
    .run();

  const settings =
    await context.env.DB
      .prepare(
        `
          SELECT *
          FROM site_settings
          WHERE id = 1
        `
      )
      .first();

  return json({
    settings
  });
}