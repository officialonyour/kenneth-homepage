import { json, error } from "../../_shared/http.js";

const MAX_BYTES = 8 * 1024 * 1024;
const TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/gif", "gif"]
]);

export async function onRequestPost({ request, env }) {
  if (!env.MEDIA) return error("R2 바인딩 MEDIA가 설정되지 않았습니다.", 503);

  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) return error("업로드할 이미지 파일을 선택해 주세요.", 400);
    if (!TYPES.has(file.type)) return error("JPG, PNG, WEBP, GIF 이미지만 업로드할 수 있습니다.", 415);
    if (file.size <= 0 || file.size > MAX_BYTES) return error("이미지는 8MB 이하로 업로드해 주세요.", 413);

    const extension = TYPES.get(file.type);
    const key = `uploads/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${extension}`;
    const body = await file.arrayBuffer();

    await env.MEDIA.put(key, body, {
      httpMetadata: {
        contentType: file.type,
        cacheControl: "public, max-age=31536000, immutable"
      },
      customMetadata: {
        originalName: String(file.name || "upload").slice(0, 180)
      }
    });

    const url = `/api/media/${key.split("/").map(encodeURIComponent).join("/")}`;
    return json({ ok: true, key, url }, 201);
  } catch (cause) {
    return error(cause?.message || "이미지 업로드에 실패했습니다.", 400);
  }
}
