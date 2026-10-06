import { json, normalizeRecord, requireDb, sourceHash } from "../../_shared/settlement.js";
const PAGE_SIZE = 50;
export async function onRequestGet({ request, env }) {
  const db = requireDb(env); const u = new URL(request.url); const q = String(u.searchParams.get("q")||"").trim(); const year=Number(u.searchParams.get("year"))||null; const distributor=String(u.searchParams.get("distributor")||"").trim(); const payment=String(u.searchParams.get("payment")||"").trim(); const page=Math.max(1,Number(u.searchParams.get("page"))||1); const limit=Math.min(500,Math.max(1,Number(u.searchParams.get("limit"))||PAGE_SIZE));
  const clauses=[]; const binds=[];
  if(q){clauses.push("(song_title LIKE ? OR project_artist LIKE ? OR platform_source LIKE ?)"); const like=`%${q}%`; binds.push(like,like,like)}
  if(year){clauses.push("settlement_year = ?");binds.push(year)}
  if(distributor){clauses.push("distributor = ?");binds.push(distributor)}
  if(payment){clauses.push("payment_status = ?");binds.push(payment)}
  const where=clauses.length?`WHERE ${clauses.join(" AND ")}`:""; const offset=(page-1)*limit;
  const countStmt=db.prepare(`SELECT COUNT(*) total FROM settlement_records ${where}`);
  const countRow=await (binds.length?countStmt.bind(...binds):countStmt).first();
  const rowsStmt=db.prepare(`SELECT * FROM settlement_records ${where} ORDER BY COALESCE(settlement_ym,'0000-00') DESC, id DESC LIMIT ? OFFSET ?`);
  const rows=(await rowsStmt.bind(...binds,limit,offset).all()).results||[];
  return json({ok:true,rows,total:Number(countRow?.total||0),page,limit});
}
export async function onRequestPost({request,env}){
  const db=requireDb(env); let input; try{input=await request.json()}catch{return json({ok:false,error:"invalid_json"},400)}
  const r=normalizeRecord(input); if(!r.song_title)return json({ok:false,error:"song_title_required"},400); const hash=await sourceHash(r);
  try{
    const result=await db.prepare(`INSERT INTO settlement_records (distributor,project_artist,song_title,settlement_year,settlement_month,settlement_ym,platform_source,gross_revenue,settlement_amount,total_income,actual_count,estimated_count,count_type,estimate_method,estimate_confidence,zero_count_adjustment_count,payment_status,source_type,notes,import_batch_id,source_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(r.distributor,r.project_artist,r.song_title,r.settlement_year,r.settlement_month,r.settlement_ym,r.platform_source,r.gross_revenue,r.settlement_amount,r.total_income,r.actual_count,r.estimated_count,r.count_type,r.estimate_method,r.estimate_confidence,r.zero_count_adjustment_count,r.payment_status,r.source_type||"직접입력",r.notes,r.import_batch_id,hash).run();
    return json({ok:true,id:result.meta?.last_row_id||null},201);
  }catch(e){if(String(e).toLowerCase().includes("unique"))return json({ok:false,error:"duplicate"},409);throw e}
}
export async function onRequestDelete({request,env}){
  const db=requireDb(env); const id=Number(new URL(request.url).searchParams.get("id")); if(!id)return json({ok:false,error:"id_required"},400); await db.prepare("DELETE FROM settlement_records WHERE id = ?").bind(id).run(); return json({ok:true});
}
