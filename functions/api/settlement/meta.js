import { json } from "../../_shared/settlement.js";
import { getAnalyticsCache, setAnalyticsCache, loadSettlementRows, getR2Status } from "../../_shared/settlement-r2-cache.js";

export async function onRequestGet({env}){
  const cacheKey="v16|meta";
  const cached=await getAnalyticsCache(env,cacheKey);
  if(cached?.payload){
    const payload=cached.payload;
    payload._cache={hit:true,strategy:"r2_materialized_response_v16",generatedAt:cached.generatedAt};
    payload._d1={strategy:"r2_only_v16",queries:0,rowsRead:0};
    return json(payload);
  }

  let snapshot;
  try { snapshot=await loadSettlementRows(env); }
  catch(error){
    const msg=String(error?.message||error||"r2_seed_required");
    return json({ok:false,error:msg,...getR2Status(env)}, msg==="r2_seed_required"?503:500);
  }
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
  const payload={
    ok:true,distributors,platforms,bounds,
    readSource:snapshot.source,
    ...getR2Status(env),
    _d1:{strategy:snapshot.source,queries:Number(snapshot.d1RowsRead||0)>0?1:0,rowsRead:Number(snapshot.d1RowsRead||0)},
    _cache:{hit:false,strategy:"r2_materialized_response_v16"}
  };
  await setAnalyticsCache(env,cacheKey,payload);
  return json(payload);
}
