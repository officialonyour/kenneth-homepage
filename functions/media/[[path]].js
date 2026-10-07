export async function onRequestGet({ env, params }) {
  const rawPath = params.path;
  const key = Array.isArray(rawPath)
    ? rawPath.join("/")
    : String(rawPath || "");

  if (!key || key.includes("..")) {
    return new Response("Not found", { status: 404 });
  }

  // Trainer audio is served only through its authenticated API, never here.
  let privateCheck = key;
  try {
    for (let pass = 0; pass < 3; pass += 1) privateCheck = decodeURIComponent(privateCheck);
  } catch {
    // Preserve existing public object names containing a literal percent sign.
  }
  if (privateCheck.replace(/^\/+/, "").startsWith("lyric-trainer-private/")) {
    return new Response("Not found", { status: 404 });
  }

  if (!env.MEDIA) {
    return new Response("R2 binding missing", { status: 500 });
  }

  const object = await env.MEDIA.get(key);
  if (!object) {
    return new Response("Not found", { status: 404 });
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("ETag", object.httpEtag);
  headers.set(
    "Cache-Control",
    headers.get("Cache-Control") || "public, max-age=31536000, immutable"
  );

  return new Response(object.body, {
    status: 200,
    headers
  });
}
