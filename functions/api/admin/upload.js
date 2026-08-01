import { json, cleanString } from "../../_lib/http.js";
import { requireAdmin } from "../../_lib/admin.js";

const MAX_FILE_SIZE = 8 * 1024 * 1024;
const ALLOWED_TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/gif", "gif"]
]);

function cleanFolder(value) {
  const folder = cleanString(value, 40)
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "");

  return folder || "images";
}

export async function onRequestPost(context) {
  const unauthorized = await requireAdmin(context);
  if (unauthorized) return unauthorized;

  if (!context.env.MEDIA) {
    return json({ error: "R2 MEDIA 바인딩이 연결되지 않았습니다." }, 500);
  }

  const formData = await context.request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return json({ error: "업로드할 이미지 파일을 선택해 주세요." }, 400);
  }

  const extension = ALLOWED_TYPES.get(file.type);
  if (!extension) {
    return json({ error: "JPG, PNG, WEBP, GIF 이미지만 업로드할 수 있습니다." }, 400);
  }

  if (file.size <= 0 || file.size > MAX_FILE_SIZE) {
    return json({ error: "이미지 크기는 8MB 이하여야 합니다." }, 400);
  }

  const folder = cleanFolder(formData.get("folder"));
  const key = `${folder}/${Date.now()}-${crypto.randomUUID()}.${extension}`;

  await context.env.MEDIA.put(key, file.stream(), {
    httpMetadata: {
      contentType: file.type,
      cacheControl: "public, max-age=31536000, immutable"
    },
    customMetadata: {
      originalName: cleanString(file.name, 200)
    }
  });

  return json({
    key,
    url: `/media/${key}`
  });
}
