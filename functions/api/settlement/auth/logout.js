import { clearSessionCookie, json } from "../../../_shared/settlement.js";
export async function onRequestPost() { return json({ ok:true }, 200, { "set-cookie": clearSessionCookie() }); }
