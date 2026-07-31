import { error } from "../../_shared/http.js";

export async function onRequestGet({ env, params }) {
  if (!env.MEDIA) return error("R2 바인딩 MEDIA가 설정되지 않았습니다.", 503);
  const path = Array.isArray(params.path) ? params.path : [params.path].filter(Boolean);
  const key = path.map((part) => decodeURIComponent(String(part))).join("/");
  if (!key) return error("파일 경로가 없습니다.", 404);

  const object = await env.MEDIA.get(key);
  if (!object) return error("이미지를 찾을 수 없습니다.", 404);

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("ETag", object.httpEtag);
  if (!headers.has("Cache-Control")) headers.set("Cache-Control", "public, max-age=31536000, immutable");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(object.body, { headers });
}
