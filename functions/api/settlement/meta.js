import { json, requireDb } from "../../_shared/settlement.js";
import { getAnalyticsCache, setAnalyticsCache, loadSettlementRows } from "../../_shared/settlement-cache.js";

export async function onRequestGet({env}){
  const db=requireDb(env);
  const cacheKey="v15|meta";
  const cached=await getAnalyticsCache(db,cacheKey);
  if(cached?.payload){
    const payload=cached.payload;
    payload._cache={hit:true,strategy:"materialized_response_v15",generatedAt:cached.generatedAt};
    payload._d1={strategy:"materialized_response_v15",queries:1,rowsRead:cached.rowsRead||1};
    return json(payload);
  }

  const snapshot=await loadSettlementRows(db);
  const rows=snapshot.rows||[];
  const distributors=[...new Set(rows.map(r=>String(r.distributor||"").trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"ko"));
  const platforms=[...new Set(rows.map(r=>String(r.platform||"").trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"ko"));
  const occurrence=rows.map(r=>r.occurrence_ym).filter(Boolean).sort();
  const settlement=rows.map(r=>r.settlement_ym).filter(Boolean).sort();
  const bounds={
    occurrence_min:occurrence[0]||null,
    occurrence_max:occurrence.at(-1)||null,
    settlement_min:settlement[0]||null,
    settlement_max:settlement.at(-1)||null,
    rows_count:rows.length,
  };
  const payload={ok:true,distributors,platforms,bounds,_d1:{strategy:snapshot.source,queries:snapshot.source==="snapshot_v15"?2:1,rowsRead:Number(snapshot.rowsRead||0),snapshotChunks:Number(snapshot.chunkCount||0)},_cache:{hit:false,strategy:"materialized_response_v15"}};
  await setAnalyticsCache(db,cacheKey,payload);
  return json(payload);
}
