import { error } from "../../_shared/http.js";
import { getCookie, verifySession } from "../../_shared/auth.js";

export async function onRequest(context) {
  const token = getCookie(context.request);
  const valid = await verifySession(token, context.env.SESSION_SECRET);
  if (!valid) return error("관리자 로그인이 필요합니다.", 401);
  return context.next();
}
