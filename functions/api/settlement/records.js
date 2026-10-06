import { json, requireDb } from "../../_shared/settlement.js";

function txt(v,n=300){return String(v??"").trim().slice(0,n)}
function num(v){const n=Number(v);return Number.isFinite(n)?n:null}
function monthShift(ymValue,delta){if(!/^\d{4}-\d{2}$/.test(String(ymValue||"")))return null;const d=new Date(Date.UTC(Number(ymValue.slice(0,4)),Number(ymValue.slice(5,7))-1+delta,1));return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}`}
async function hashText(s){const d=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s)));return Array.from(d).map(b=>b.toString(16).padStart(2,"0")).join("")}

export async function onRequestGet({request,env}){
  const db=requireDb(env), u=new URL(request.url);
  const q=txt(u.searchParams.get("q")); const distributor=txt(u.searchParams.get("distributor")); const platform=txt(u.searchParams.get("platform"));
  const basis=u.searchParams.get("basis")==="settlement"?"settlement":"occurrence"; const timeCol=basis==="settlement"?"settlement_ym":"occurrence_ym";
  const from=txt(u.searchParams.get("from"),7), to=txt(u.searchParams.get("to"),7);
  const countBasis=txt(u.searchParams.get("count_basis"),30); const page=Math.max(1,Number(u.searchParams.get("page"))||1); const limit=Math.min(500,Math.max(1,Number(u.searchParams.get("limit"))||50));
  const clauses=[], binds=[];
  if(q){clauses.push("(song_title LIKE ? OR artist LIKE ? OR album_title LIKE ? OR platform LIKE ? OR original_platform LIKE ? OR original_service LIKE ?)");const like=`%${q}%`;binds.push(like,like,like,like,like,like)}
  if(distributor){clauses.push("distributor=?");binds.push(distributor)}
  if(platform){clauses.push("platform=?");binds.push(platform)}
  if(countBasis){clauses.push("count_basis=?");binds.push(countBasis)}
  if(/^\d{4}-\d{2}$/.test(from)){clauses.push(`${timeCol}>=?`);binds.push(from)}
  if(/^\d{4}-\d{2}$/.test(to)){clauses.push(`${timeCol}<=?`);binds.push(to)}
  const where=clauses.length?`WHERE ${clauses.join(" AND ")}`:"", offset=(page-1)*limit;
  const cstmt=db.prepare(`SELECT COUNT(*) total FROM music_settlement_records ${where}`); const crow=await (binds.length?cstmt.bind(...binds):cstmt).first();
  const rows=(await db.prepare(`SELECT id,source_row_no,distributor,source_file,settlement_ym,occurrence_ym,artist,album_title,song_title,original_platform,original_service,platform,original_count,adjusted_count,analysis_count,count_basis,estimate_method,estimate_confidence,settlement_amount,revenue_source,notes FROM music_settlement_records ${where} ORDER BY COALESCE(${timeCol},'0000-00') DESC,id DESC LIMIT ? OFFSET ?`).bind(...binds,limit,offset).all()).results||[];
  return json({ok:true,basis,rows,total:Number(crow?.total||0),page,limit});
}

export async function onRequestPost({request,env}){
  const db=requireDb(env);let x;try{x=await request.json()}catch{return json({ok:false,error:"invalid_json"},400)}
  const song=txt(x.song_title,240);if(!song)return json({ok:false,error:"song_title_required"},400);
  const settlement=txt(x.settlement_ym,7), settlementYm=/^\d{4}-\d{2}$/.test(settlement)?settlement:null, occurrence=settlementYm?monthShift(settlementYm,-3):null, originalCount=num(x.original_count), amount=num(x.settlement_amount)||0;
  let countBasis="missing",analysisCount=null,method="",conf="";
  if(originalCount!==null&&originalCount>0){countBasis="actual";analysisCount=Math.round(originalCount)}
  else if(originalCount===0&&amount>0){countBasis="zero_adjusted";analysisCount=1;method="직접입력 0카운트 보정";conf="low"}
  const r={distributor:txt(x.distributor||"미분류",120)||"미분류",settlement_ym:settlementYm,occurrence_ym:occurrence,artist:txt(x.artist,180),album_title:txt(x.album_title,240),song_title:song,platform:txt(x.platform||"미분류",160)||"미분류",original_platform:txt(x.original_platform,240),original_service:txt(x.original_service,300),original_count:originalCount===null?null:Math.round(originalCount),adjusted_count:analysisCount,analysis_count:analysisCount,count_basis:countBasis,estimate_method:method,estimate_confidence:conf,settlement_amount:amount,notes:txt(x.notes,1200)};
  const rowHash=await hashText(["manual",Date.now(),crypto.randomUUID(),r.distributor,r.song_title,r.occurrence_ym,r.settlement_amount].join("\u001f"));
  const result=await db.prepare(`INSERT INTO music_settlement_records (distributor,settlement_year,settlement_month,settlement_ym,occurrence_year,occurrence_month,occurrence_ym,artist,album_title,song_title,original_platform,original_service,platform,original_count,adjusted_count,analysis_count,count_basis,estimate_method,estimate_confidence,settlement_amount,revenue_source,notes,row_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(r.distributor,r.settlement_ym?Number(r.settlement_ym.slice(0,4)):null,r.settlement_ym?Number(r.settlement_ym.slice(5,7)):null,r.settlement_ym,r.occurrence_ym?Number(r.occurrence_ym.slice(0,4)):null,r.occurrence_ym?Number(r.occurrence_ym.slice(5,7)):null,r.occurrence_ym,r.artist,r.album_title,r.song_title,r.original_platform,r.original_service,r.platform,r.original_count,r.adjusted_count,r.analysis_count,r.count_basis,r.estimate_method,r.estimate_confidence,r.settlement_amount,"직접입력",r.notes,rowHash).run();
  return json({ok:true,id:result.meta?.last_row_id||null},201);
}

export async function onRequestDelete({request,env}){const db=requireDb(env);const id=Number(new URL(request.url).searchParams.get("id"));if(!id)return json({ok:false,error:"id_required"},400);await db.prepare("DELETE FROM music_settlement_records WHERE id=?").bind(id).run();return json({ok:true})}
