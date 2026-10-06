import { json, normalizeRecord, requireDb, sourceHash } from "../../_shared/settlement.js";

function moneyBasis(r) {
  for (const v of [r.total_income, r.settlement_amount, r.gross_revenue]) {
    const n = Number(v); if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}
function addRate(map, key, money, count) {
  if (!(money > 0) || !(count > 0)) return;
  const x = map.get(key) || { money:0, count:0 };
  x.money += money; x.count += count; map.set(key, x);
}
function rate(map, key) { const x = map.get(key); return x && x.count > 0 ? x.money / x.count : null; }
async function buildHistoricalRates(db) {
  const rows = (await db.prepare(`SELECT song_title, distributor, platform_source,
    SUM(CASE WHEN total_income > 0 THEN total_income WHEN settlement_amount > 0 THEN settlement_amount ELSE gross_revenue END) money,
    SUM(actual_count) cnt
    FROM settlement_records
    WHERE actual_count > 0
    GROUP BY song_title, distributor, platform_source`).all()).results || [];
  const maps = { sdp:new Map(), sd:new Map(), dp:new Map(), d:new Map(), global:new Map() };
  for (const x of rows) {
    const m=Number(x.money), c=Number(x.cnt); if (!(m>0) || !(c>0)) continue;
    addRate(maps.sdp, `${x.song_title}|${x.distributor}|${x.platform_source||""}`, m, c);
    addRate(maps.sd, `${x.song_title}|${x.distributor}`, m, c);
    addRate(maps.dp, `${x.distributor}|${x.platform_source||""}`, m, c);
    addRate(maps.d, `${x.distributor}`, m, c);
    addRate(maps.global, "global", m, c);
  }
  return maps;
}
function applyHistoricalEstimate(r, maps) {
  if (r.count_type !== "unknown") return r;
  const money = moneyBasis(r); if (!(money > 0)) return r;
  const candidates = [
    [maps.sdp, `${r.song_title}|${r.distributor}|${r.platform_source||""}`, "과거 동일 음원·유통사·플랫폼 가중평균", "high"],
    [maps.sd, `${r.song_title}|${r.distributor}`, "과거 동일 음원·유통사 가중평균", "medium"],
    [maps.dp, `${r.distributor}|${r.platform_source||""}`, "과거 동일 유통사·플랫폼 가중평균", "medium"],
    [maps.d, `${r.distributor}`, "과거 동일 유통사 가중평균", "low"],
    [maps.global, "global", "과거 전체 가중평균", "low"],
  ];
  for (const [map,key,label,confidence] of candidates) {
    const unit=rate(map,key); if (!(unit>0)) continue;
    r.estimated_count=Math.max(1,Math.round(money/unit)); r.count_type="estimated"; r.estimate_method=label; r.estimate_confidence=confidence; break;
  }
  return r;
}

export async function onRequestPost({request,env}){
  const db=requireDb(env); let body; try{body=await request.json()}catch{return json({ok:false,error:"invalid_json"},400)}
  const inputRows=Array.isArray(body?.rows)?body.rows:[]; if(!inputRows.length)return json({ok:false,error:"rows_required"},400); if(inputRows.length>10000)return json({ok:false,error:"too_many_rows"},413);
  const batchId=String(body.batchId||crypto.randomUUID()).slice(0,80); let inserted=0,duplicates=0,invalid=0,historicalEstimated=0;
  const maps=await buildHistoricalRates(db);
  const chunks=[]; for(let i=0;i<inputRows.length;i+=50)chunks.push(inputRows.slice(i,i+50));
  for(const chunk of chunks){
    const statements=[];
    for(const input of chunk){
      let r=normalizeRecord({...input,import_batch_id:batchId}); if(!r.song_title){invalid++;continue}
      const before=r.count_type; r=applyHistoricalEstimate(r,maps); if(before==="unknown"&&r.count_type==="estimated")historicalEstimated++;
      const hash=await sourceHash(r);
      statements.push(db.prepare(`INSERT OR IGNORE INTO settlement_records (distributor,project_artist,song_title,settlement_year,settlement_month,settlement_ym,platform_source,gross_revenue,settlement_amount,total_income,actual_count,estimated_count,count_type,estimate_method,estimate_confidence,zero_count_adjustment_count,payment_status,source_type,notes,import_batch_id,source_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(r.distributor,r.project_artist,r.song_title,r.settlement_year,r.settlement_month,r.settlement_ym,r.platform_source,r.gross_revenue,r.settlement_amount,r.total_income,r.actual_count,r.estimated_count,r.count_type,r.estimate_method,r.estimate_confidence,r.zero_count_adjustment_count,r.payment_status,r.source_type||"엑셀업로드",r.notes,batchId,hash));
    }
    if(!statements.length)continue; const results=await db.batch(statements); for(const res of results){if(Number(res.meta?.changes||0)>0)inserted++;else duplicates++;}
  }
  return json({ok:true,batchId,inserted,duplicates,invalid,historicalEstimated,total:inputRows.length});
}
