const encoder = new TextEncoder();
const decoder = new TextDecoder();
export const SESSION_COOKIE = "kenneth_settlement_session";
const SESSION_SECONDS = 60 * 60 * 12;

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

function b64url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function b64urlText(text) { return b64url(encoder.encode(text)); }
function decodeB64url(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const raw = atob(s); const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}
async function sign(secret, value) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}
function equalBytes(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0; for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
export async function safeSecretEqual(a, b) {
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(String(a ?? ""))),
    crypto.subtle.digest("SHA-256", encoder.encode(String(b ?? ""))),
  ]);
  return equalBytes(new Uint8Array(ha), new Uint8Array(hb));
}
export async function createSession(secret) {
  const payload = { exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS, nonce: crypto.randomUUID() };
  const body = b64urlText(JSON.stringify(payload));
  const sig = b64url(await sign(secret, body));
  return `${body}.${sig}`;
}
export async function verifySession(secret, token) {
  try {
    if (!secret || !token) return false;
    const [body, sigText] = token.split("."); if (!body || !sigText) return false;
    const expected = await sign(secret, body); const got = decodeB64url(sigText);
    if (!equalBytes(expected, got)) return false;
    const payload = JSON.parse(decoder.decode(decodeB64url(body)));
    return Number(payload.exp) > Math.floor(Date.now() / 1000);
  } catch { return false; }
}
export function parseCookie(header) {
  const out = {};
  for (const part of String(header || "").split(";")) {
    const idx = part.indexOf("="); if (idx < 0) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}
export function sessionCookie(token) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_SECONDS}`;
}
export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}
export async function requestAuthenticated(request, env) {
  const token = parseCookie(request.headers.get("cookie"))[SESSION_COOKIE];
  return verifySession(env.SESSION_SECRET, token);
}
export function sameOriginWrite(request) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return true;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try { return new URL(origin).host === new URL(request.url).host; } catch { return false; }
}
export function requireDb(env) {
  if (!env.SETTLEMENT_DB) throw new Error("SETTLEMENT_DB binding is not configured.");
  return env.SETTLEMENT_DB;
}
export function clampNumber(v, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const n = Number(v); if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, n));
}
export function normalizeRecord(input = {}) {
  const ym = String(input.settlement_ym || "").slice(0, 7);
  let year = clampNumber(input.settlement_year, 1900, 2200);
  let month = clampNumber(input.settlement_month, 1, 12);
  if (ym && /^\d{4}-\d{2}$/.test(ym)) { year = Number(ym.slice(0, 4)); month = Number(ym.slice(5, 7)); }
  const actual = clampNumber(input.actual_count);
  const estimated = clampNumber(input.estimated_count);
  const countType = actual > 0 ? "actual" : estimated > 0 ? "estimated" : "unknown";
  return {
    distributor: String(input.distributor || "미분류").trim().slice(0, 120),
    project_artist: String(input.project_artist || "").trim().slice(0, 160),
    song_title: String(input.song_title || "").trim().slice(0, 240),
    settlement_year: year,
    settlement_month: month,
    settlement_ym: year && month ? `${String(year).padStart(4,"0")}-${String(month).padStart(2,"0")}` : null,
    platform_source: String(input.platform_source || "").trim().slice(0, 200),
    gross_revenue: clampNumber(input.gross_revenue),
    settlement_amount: clampNumber(input.settlement_amount),
    total_income: clampNumber(input.total_income),
    actual_count: actual,
    estimated_count: estimated,
    count_type: countType,
    estimate_method: String(input.estimate_method || "").trim().slice(0, 200),
    estimate_confidence: String(input.estimate_confidence || "").trim().slice(0, 40),
    zero_count_adjustment_count: clampNumber(input.zero_count_adjustment_count),
    payment_status: String(input.payment_status || "").trim().slice(0, 40),
    source_type: String(input.source_type || "").trim().slice(0, 80),
    notes: String(input.notes || "").trim().slice(0, 1200),
    import_batch_id: String(input.import_batch_id || "").trim().slice(0, 80),
  };
}
async function digestText(text) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(text)));
  return Array.from(digest).map(b => b.toString(16).padStart(2,"0")).join("");
}
export async function sourceHash(r) {
  return digestText([r.distributor,r.project_artist,r.song_title,r.settlement_ym,r.platform_source,r.gross_revenue,r.settlement_amount,r.total_income,r.actual_count,r.estimated_count,r.payment_status,r.source_type].join("\u001f"));
}
