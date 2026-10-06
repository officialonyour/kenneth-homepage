import { json, requestAuthenticated, sameOriginWrite } from "../../_shared/settlement.js";
export async function onRequest(context) {
  const path = new URL(context.request.url).pathname;
  const publicAuth = path.endsWith("/auth/login") || path.endsWith("/auth/status");
  if (!sameOriginWrite(context.request)) return json({ ok:false, error:"origin_mismatch" }, 403);
  if (!publicAuth && !(await requestAuthenticated(context.request, context.env))) {
    return json({ ok:false, error:"unauthorized" }, 401);
  }
  return context.next();
}
