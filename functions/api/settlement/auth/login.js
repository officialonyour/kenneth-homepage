import { createSession, json, safeSecretEqual, sessionCookie } from "../../../_shared/settlement.js";
export async function onRequestPost({ request, env }) {
  if (!env.ADMIN_PASSWORD || !env.SESSION_SECRET || !env.SETTLEMENT_DB) return json({ ok:false, error:"not_configured" }, 503);
  let body; try { body = await request.json(); } catch { return json({ ok:false, error:"invalid_json" }, 400); }
  if (!(await safeSecretEqual(body?.password, env.ADMIN_PASSWORD))) return json({ ok:false, error:"invalid_password" }, 401);
  const token = await createSession(env.SESSION_SECRET);
  return json({ ok:true }, 200, { "set-cookie": sessionCookie(token) });
}
