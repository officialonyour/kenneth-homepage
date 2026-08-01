import { json } from "../../_lib/http.js";
import { requireAdmin } from "../../_lib/admin.js";

export async function onRequestGet(context) {
  const unauthorized = await requireAdmin(context);
  if (unauthorized) return unauthorized;

  return json({ ok: true });
}
