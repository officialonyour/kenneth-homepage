import { json, getClientIp } from "../../_lib/http.js";
import {
  createSessionCookie,
  createSessionToken,
  verifyPassword
} from "../../_lib/auth.js";

const LIMIT_WINDOW_SECONDS = 15 * 60;
const MAX_FAILURES = 5;

export async function onRequestPost({ request, env }) {
  if (!env.ADMIN_PASSWORD || !env.SESSION_SECRET) {
    return json(
      { error: "Cloudflare Secret 설정이 완료되지 않았습니다." },
      500
    );
  }

  const ip = getClientIp(request);
  const cutoff = Math.floor(Date.now() / 1000) - LIMIT_WINDOW_SECONDS;

  await env.DB.prepare(
    "DELETE FROM admin_login_attempts WHERE attempted_at < ?"
  )
    .bind(cutoff)
    .run();

  const attempt = await env.DB.prepare(
    `SELECT COUNT(*) AS count
     FROM admin_login_attempts
     WHERE ip = ? AND attempted_at >= ?`
  )
    .bind(ip, cutoff)
    .first();

  if (Number(attempt?.count || 0) >= MAX_FAILURES) {
    return json(
      { error: "로그인 시도가 너무 많습니다. 15분 뒤 다시 시도해 주세요." },
      429
    );
  }

  const body = await request.json().catch(() => ({}));
  const valid = await verifyPassword(
    body.password,
    env.ADMIN_PASSWORD
  );

  if (!valid) {
    await env.DB.prepare(
      "INSERT INTO admin_login_attempts (ip, attempted_at) VALUES (?, ?)"
    )
      .bind(ip, Math.floor(Date.now() / 1000))
      .run();

    return json({ error: "비밀번호가 올바르지 않습니다." }, 401);
  }

  await env.DB.prepare(
    "DELETE FROM admin_login_attempts WHERE ip = ?"
  )
    .bind(ip)
    .run();

  const token = await createSessionToken(env.SESSION_SECRET);

  return json(
    { ok: true },
    200,
    { "Set-Cookie": createSessionCookie(token) }
  );
}
