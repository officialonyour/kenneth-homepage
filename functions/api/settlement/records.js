import { json, requireDb } from "../../_shared/settlement.js";
import { loadSettlementRows, invalidateAnalyticsCache, appendSnapshotRow, removeSnapshotRowById } from "../../_shared/settlement-r2-cache.js";

function txt(v,n=300){return String(v??"").trim().slice(0,n)}
function num(v){const n=Number(v);return Number.isFinite(n)?n:null}
function monthShift(ymValue,delta){if(!/^\d{4}-\d{2}$/.test(String(ymValue||"")))return null;const d=new Date(Date.UTC(Number(ymValue.slice(0,4)),Number(ymValue.slice(5,7))-1+delta,1));return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}`}
async function hashText(s){const d=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s)));return Array.from(d).map(b=>b.toString(16).padStart(2,"0")).join("")}

function includesText(r,q){
  if(!q)return true;
  const needle=q.toLowerCase();
  return [r.song_title,r.artist,r.album_title,r.platform,r.original_platform,r.original_service]
    .some(v=>String(v||"").toLowerCase().includes(needle));
}

export async function onRequestGet({request,env}){
  const u=new URL(request.url);
  const q=txt(u.searchParams.get("q"));
  const distributor=txt(u.searchParams.get("distributor"));
  const platform=txt(u.searchParams.get("platform"));
  const scope=["year","month"].includes(u.searchParams.get("scope"))?u.searchParams.get("scope"):"all";
  const period=txt(u.searchParams.get("period"),7);
  const from=txt(u.searchParams.get("from"),7),to=txt(u.searchParams.get("to"),7);
  const countBasis=txt(u.searchParams.get("count_basis"),30);
  const page=Math.max(1,Number(u.searchParams.get("page"))||1);
  const limit=Math.min(500,Math.max(1,Number(u.searchParams.get("limit"))||50));
  let snapshot;
  try{snapshot=await loadSettlementRows(env)}catch(error){const msg=String(error?.message||error||"r2_seed_required");return json({ok:false,error:msg},msg==="r2_seed_required"?503:500)}
  let rows=snapshot.rows||[];
  rows=rows.filter(r=>{
    if(!includesText(r,q))return false;
    if(distributor&&String(r.distributor||"")!==distributor)return false;
    if(platform&&String(r.platform||"")!==platform)return false;
    if(countBasis&&String(r.count_basis||"")!==countBasis)return false;
    const ym=String(r.occurrence_ym||"");
    if(scope==="year"&&/^\d{4}$/.test(period)&&!ym.startsWith(period+"-"))return false;
    if(scope==="month"&&/^\d{4}-\d{2}$/.test(period)&&ym!==period)return false;
    if(/^\d{4}-\d{2}$/.test(from)&&ym<from)return false;
    if(/^\d{4}-\d{2}$/.test(to)&&ym>to)return false;
    return true;
  });
  rows.sort((a,b)=>String(b.occurrence_ym||"").localeCompare(String(a.occurrence_ym||"")) || Number(b.id||b.source_row_no||0)-Number(a.id||a.source_row_no||0));
  const total=rows.length,offset=(page-1)*limit;
  const pageRows=rows.slice(offset,offset+limit).map(r=>({
    id:Number.isFinite(Number(r.id))?Number(r.id):null,
    source_row_no:r.source_row_no??null,distributor:r.distributor??"",source_file:r.source_file??"",settlement_ym:r.settlement_ym??null,occurrence_ym:r.occurrence_ym??null,
    artist:r.artist??"",album_title:r.album_title??"",song_title:r.song_title??"",original_platform:r.original_platform??"",original_service:r.original_service??"",platform:r.platform??"",
    original_count:r.original_count??null,adjusted_count:r.adjusted_count??null,analysis_count:r.analysis_count??null,count_basis:r.count_basis??"missing",estimate_method:r.estimate_method??"",estimate_confidence:r.estimate_confidence??"",
    settlement_amount:Number(r.settlement_amount||0),revenue_source:r.revenue_source??"",notes:r.notes??""
  }));
  return json({ok:true,scope,period:scope==="all"?null:period,rows:pageRows,total,page,limit,readOnly:pageRows.some(r=>r.id===null),_d1:{strategy:snapshot.source,queries:Number(snapshot.d1RowsRead||0)>0?1:0,rowsRead:Number(snapshot.d1RowsRead||0)}});
}

export async function onRequestPost({request,env}){
  const db=requireDb(env);let x;try{x=await request.json()}catch{return json({ok:false,error:"invalid_json"},400)}
  const song=txt(x.song_title,240);if(!song)return json({ok:false,error:"song_title_required"},400);
  const settlement=txt(x.settlement_ym,7),settlementYm=/^\d{4}-\d{2}$/.test(settlement)?settlement:null,occurrence=settlementYm?monthShift(settlementYm,-3):null,originalCount=num(x.original_count),amount=num(x.settlement_amount)||0;
  let countBasis="missing",analysisCount=null,method="",conf="";
  if(originalCount!==null&&originalCount>0){countBasis="actual";analysisCount=Math.round(originalCount)}
  else if(originalCount===0&&amount>0){countBasis="zero_adjusted";analysisCount=1;method="직접입력 0카운트 보정";conf="low"}
  const r={distributor:txt(x.distributor||"미분류",120)||"미분류",settlement_ym:settlementYm,occurrence_ym:occurrence,artist:txt(x.artist,180),album_title:txt(x.album_title,240),song_title:song,platform:txt(x.platform||"미분류",160)||"미분류",original_platform:txt(x.original_platform,240),original_service:txt(x.original_service,300),original_count:originalCount===null?null:Math.round(originalCount),adjusted_count:analysisCount,analysis_count:analysisCount,count_basis:countBasis,estimate_method:method,estimate_confidence:conf,settlement_amount:amount,notes:txt(x.notes,1200),revenue_source:"직접입력"};
  const rowHash=await hashText(["manual",Date.now(),crypto.randomUUID(),r.distributor,r.song_title,r.occurrence_ym,r.settlement_amount].join("\u001f"));
  const result=await db.prepare(`INSERT INTO music_settlement_records (distributor,settlement_year,settlement_month,settlement_ym,occurrence_year,occurrence_month,occurrence_ym,artist,album_title,song_title,original_platform,original_service,platform,original_count,adjusted_count,analysis_count,count_basis,estimate_method,estimate_confidence,settlement_amount,revenue_source,notes,row_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(r.distributor,r.settlement_ym?Number(r.settlement_ym.slice(0,4)):null,r.settlement_ym?Number(r.settlement_ym.slice(5,7)):null,r.settlement_ym,r.occurrence_ym?Number(r.occurrence_ym.slice(0,4)):null,r.occurrence_ym?Number(r.occurrence_ym.slice(5,7)):null,r.occurrence_ym,r.artist,r.album_title,r.song_title,r.original_platform,r.original_service,r.platform,r.original_count,r.adjusted_count,r.analysis_count,r.count_basis,r.estimate_method,r.estimate_confidence,r.settlement_amount,r.revenue_source,r.notes,rowHash).run();
  r.id=Number(result.meta?.last_row_id||0)||null;
  await appendSnapshotRow(env,r).catch(()=>{});
  await invalidateAnalyticsCache(env).catch(()=>{});
  return json({ok:true,id:r.id},201);
}

export async function onRequestDelete({request,env}){
  const db=requireDb(env);const id=Number(new URL(request.url).searchParams.get("id"));if(!id)return json({ok:false,error:"id_required"},400);
  await db.prepare("DELETE FROM music_settlement_records WHERE id=?").bind(id).run();
  await removeSnapshotRowById(env,id).catch(()=>{});
  await invalidateAnalyticsCache(env).catch(()=>{});
  return json({ok:true});
}
