import { json, requireDb } from "../../_shared/settlement.js";
export async function onRequestGet({env}){
  const db=requireDb(env);
  const one=async(sql)=>(await db.prepare(sql).first())||{};
  const all=async(sql)=>(await db.prepare(sql).all()).results||[];
  const distributors=await all("SELECT DISTINCT distributor value FROM music_settlement_records WHERE distributor IS NOT NULL AND distributor<>'' ORDER BY distributor");
  const platforms=await all("SELECT DISTINCT platform value FROM music_settlement_records WHERE platform IS NOT NULL AND platform<>'' ORDER BY platform");
  const bounds=await one("SELECT MIN(occurrence_ym) occurrence_min,MAX(occurrence_ym) occurrence_max,MIN(settlement_ym) settlement_min,MAX(settlement_ym) settlement_max,COUNT(*) rows_count FROM music_settlement_records");
  return json({ok:true,distributors:distributors.map(x=>x.value),platforms:platforms.map(x=>x.value),bounds});
}
