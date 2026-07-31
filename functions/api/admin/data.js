import { json, error } from "../../_shared/http.js";
import { fetchAllData } from "../../_shared/data.js";

export async function onRequestGet({ env }) {
  if (!env.DB) return error("D1 바인딩 DB가 설정되지 않았습니다.", 503);
  try {
    return json(await fetchAllData(env.DB, true), 200, { "Cache-Control": "no-store" });
  } catch (cause) {
    return error("관리 데이터를 불러오지 못했습니다.", 500, String(cause?.message || cause));
  }
}
