import { json, error, readJson, cleanUrl, readLimitedText } from "../../_shared/http.js";

function isBlockedHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".local") || host === "::1") return true;
  if (/^127\./.test(host) || /^10\./.test(host) || /^0\./.test(host)) return true;
  if (/^192\.168\./.test(host) || /^169\.254\./.test(host)) return true;
  const match = host.match(/^172\.(\d{1,3})\./);
  if (match && Number(match[1]) >= 16 && Number(match[1]) <= 31) return true;
  return false;
}

function decodeEntities(value) {
  return String(value || "")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function extractAttributes(tag) {
  const attrs = {};
  const regex = /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let match;
  while ((match = regex.exec(tag))) attrs[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
  return attrs;
}

function extractMeta(html) {
  const values = {};
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = extractAttributes(match[0]);
    const key = (attrs.property || attrs.name || "").toLowerCase();
    if (key && attrs.content && !(key in values)) values[key] = decodeEntities(attrs.content.trim());
  }
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = values["og:title"] || values["twitter:title"] || decodeEntities(titleMatch?.[1]?.replace(/\s+/g, " ").trim());
  const image = values["og:image:secure_url"] || values["og:image"] || values["twitter:image"] || "";
  const description = values["og:description"] || values.description || "";
  return { title, image, description };
}

export async function onRequestPost({ request }) {
  let body;
  try {
    body = await readJson(request, 16 * 1024);
  } catch {
    return error("링크 요청이 올바르지 않습니다.", 400);
  }

  const urlString = cleanUrl(body.url);
  if (!urlString) return error("올바른 http 또는 https 링크를 입력해 주세요.", 400);
  const source = new URL(urlString);
  if (isBlockedHost(source.hostname)) return error("허용되지 않는 주소입니다.", 400);

  try {
    const response = await fetch(source.href, {
      redirect: "follow",
      headers: {
        "Accept": "text/html,application/xhtml+xml",
        "User-Agent": "Mozilla/5.0 (compatible; HweegeunLinkPreview/1.0)"
      }
    });
    if (!response.ok) return error(`링크를 불러오지 못했습니다. (${response.status})`, 400);
    const type = response.headers.get("content-type") || "";
    if (!type.includes("text/html") && !type.includes("application/xhtml+xml")) {
      return error("웹페이지 링크에서만 앨범 정보를 가져올 수 있습니다.", 400);
    }

    const html = await readLimitedText(response);
    const meta = extractMeta(html);
    let image = "";
    if (meta.image) {
      try { image = new URL(meta.image, response.url).href; } catch { image = ""; }
    }

    return json({
      ok: true,
      title: String(meta.title || "").slice(0, 200),
      image,
      description: String(meta.description || "").slice(0, 500),
      source_url: response.url
    });
  } catch (cause) {
    return error(cause?.message || "링크 정보를 가져오지 못했습니다.", 400);
  }
}
