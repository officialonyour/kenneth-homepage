import { json, requestAuthenticated } from "../../../_shared/settlement.js";
export async function onRequestGet({ request, env }) {
  const configured = Boolean(env.ADMIN_PASSWORD && env.SESSION_SECRET && env.SETTLEMENT_DB);
  const authenticated = configured ? await requestAuthenticated(request, env) : false;
  return json({ ok:true, configured, authenticated, dbReady:Boolean(env.SETTLEMENT_DB) });
}
