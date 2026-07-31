import { json, error, readJson } from "../_shared/http.js";
import { createSession, secureCompare, sessionCookie } from "../_shared/auth.js";

const WINDOW_SECONDS = 15 * 60;
const MAX_ATTEMPTS = 6;

function clientIp(request) {
  return (request.headers.get("CF-Connecting-IP") || "local").slice(0, 80);
}

async function checkRateLimit(db, ip, now) {
  if (!db) return { blocked: false };
  const row = await db.prepare("SELECT attempts, window_start, blocked_until FROM login_attempts WHERE ip = ? LIMIT 1").bind(ip).first();
  if (!row) return { blocked: false };
  if (Number(row.blocked_until || 0) > now) return { blocked: true, retryAfter: Number(row.blocked_until) - now };
  if (now - Number(row.window_start || 0) > WINDOW_SECONDS) {
    await db.prepare("DELETE FROM login_attempts WHERE ip = ?").bind(ip).run();
    return { blocked: false };
  }
  return { blocked: false };
}

async function recordFailure(db, ip, now) {
  if (!db) return;
  const row = await db.prepare("SELECT attempts, window_start FROM login_attempts WHERE ip = ? LIMIT 1").bind(ip).first();
  const activeWindow = row && now - Number(row.window_start || 0) <= WINDOW_SECONDS;
  const attempts = activeWindow ? Number(row.attempts || 0) + 1 : 1;
  const windowStart = activeWindow ? Number(row.window_start) : now;
  const blockedUntil = attempts >= MAX_ATTEMPTS ? now + WINDOW_SECONDS : 0;
  await db.prepare(`
    INSERT INTO login_attempts (ip, attempts, window_start, blocked_until)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(ip) DO UPDATE SET
      attempts = excluded.attempts,
      window_start = excluded.window_start,
      blocked_until = excluded.blocked_until
  `).bind(ip, attempts, windowStart, blockedUntil).run();
}

export async function onRequestPost({ request, env }) {
  if (!env.ADMIN_PASSWORD) return error("ADMIN_PASSWORD 환경 변수가 설정되지 않았습니다.", 500);
  if (!env.SESSION_SECRET) return error("SESSION_SECRET 환경 변수가 설정되지 않았습니다.", 500);

  const ip = clientIp(request);
  const now = Math.floor(Date.now() / 1000);
  const limit = await checkRateLimit(env.DB, ip, now);
  if (limit.blocked) {
    return error("로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.", 429, { retry_after: limit.retryAfter });
  }

  let body;
  try {
    body = await readJson(request, 8 * 1024);
  } catch {
    return error("로그인 요청이 올바르지 않습니다.", 400);
  }

  const valid = await secureCompare(body.password, env.ADMIN_PASSWORD);
  if (!valid) {
    await recordFailure(env.DB, ip, now);
    return error("비밀번호가 올바르지 않습니다.", 401);
  }

  if (env.DB) await env.DB.prepare("DELETE FROM login_attempts WHERE ip = ?").bind(ip).run();
  const token = await createSession(env.SESSION_SECRET);
  return json({ ok: true }, 200, { "Set-Cookie": sessionCookie(token), "Cache-Control": "no-store" });
}
