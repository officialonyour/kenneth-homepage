export function json(data, status = 200, extraHeaders = {}) {
  const headers = new Headers(extraHeaders);
  headers.set("Content-Type", "application/json; charset=utf-8");
  if (!headers.has("Cache-Control")) {
    headers.set("Cache-Control", "no-store");
  }

  return new Response(JSON.stringify(data), {
    status,
    headers
  });
}

export function getClientIp(request) {
  return (
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

export function cleanString(value, maxLength = 2000) {
  return String(value ?? "").trim().slice(0, maxLength);
}

export function cleanUrl(value) {
  const stringValue = cleanString(value, 2000);
  if (!stringValue) return "";

  try {
    const url = new URL(stringValue, "https://kenneth.local");

    if (url.origin === "https://kenneth.local") {
      return url.pathname.startsWith("/media/")
        ? `${url.pathname}${url.search}`
        : "";
    }

    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}
