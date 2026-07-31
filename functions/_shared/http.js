export function json(data, status = 200, extraHeaders = {}) {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    ...extraHeaders
  });
  return new Response(JSON.stringify(data), { status, headers });
}

export function error(message, status = 400, details) {
  return json({ ok: false, message, ...(details ? { details } : {}) }, status);
}

export async function readJson(request, maxBytes = 128 * 1024) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > maxBytes) throw new Error("요청 데이터가 너무 큽니다.");
  const text = await request.text();
  if (text.length > maxBytes) throw new Error("요청 데이터가 너무 큽니다.");
  if (!text) return {};
  return JSON.parse(text);
}

export function cleanText(value, max = 1000) {
  return String(value ?? "").trim().slice(0, max);
}

export function cleanUrl(value) {
  const raw = cleanText(value, 2048);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    return url.href;
  } catch {
    return "";
  }
}

export function intValue(value, fallback = 0, min = -2147483648, max = 2147483647) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function youtubeId(value) {
  const urlString = cleanUrl(value);
  if (!urlString) return "";
  try {
    const url = new URL(urlString);
    if (url.hostname.includes("youtu.be")) return url.pathname.split("/").filter(Boolean)[0] || "";
    if (url.pathname.startsWith("/shorts/")) return url.pathname.split("/")[2] || "";
    if (url.pathname.startsWith("/embed/")) return url.pathname.split("/")[2] || "";
    return url.searchParams.get("v") || "";
  } catch {
    return "";
  }
}

export async function readLimitedText(response, maxBytes = 512 * 1024) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      break;
    }
    chunks.push(value);
  }
  const output = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(output);
}
