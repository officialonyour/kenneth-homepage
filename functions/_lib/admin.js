import { json } from "./http.js";
import { verifySession } from "./auth.js";

export async function requireAdmin(context) {
  const allowed = await verifySession(
    context.request,
    context.env.SESSION_SECRET
  );

  if (!allowed) {
    return json({ error: "관리자 로그인이 필요합니다." }, 401);
  }

  return null;
}
