import { json } from "../_shared/http.js";
import { clearSessionCookie } from "../_shared/auth.js";

export function onRequestPost() {
  return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie(), "Cache-Control": "no-store" });
}
