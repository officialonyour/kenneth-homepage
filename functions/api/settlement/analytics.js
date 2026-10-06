import { json, requireDb } from "../../_shared/settlement.js";

function monthShift(ym, delta) {
  if (!/^\d{4}-\d{2}$/.test(String(ym || ""))) return null;
  const d = new Date(Date.UTC(Number(ym.slice(0,4)), Number(ym.slice(5,7)) - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}`;
}
function seqMonths(endYm, count, offset = 0) {
  const a=[]; for(let i=count-1;i>=0;i--) a.push(monthShift(endYm, -i-offset)); return a;
}
function placeholders(n){ return Array.from({length:n},()=>"?").join(","); }
function pct(cur, prev){ return prev > 0 ? ((cur / prev) - 1) * 100 : null; }

export async function onRequestGet({ request, env }) {
  const db = requireDb(env);
  const u = new URL(request.url);
  const view = u.searchParams.get("view") || "overview";
  const basis = u.searchParams.get("basis") === "settlement" ? "settlement" : "occurrence";
  const timeCol = basis === "settlement" ? "settlement_ym" : "occurrence_ym";
  const all = async (sql, binds=[]) => (await (binds.length ? db.prepare(sql).bind(...binds) : db.prepare(sql)).all()).results || [];
  const one = async (sql, binds=[]) => (await (binds.length ? db.prepare(sql).bind(...binds) : db.prepare(sql)).first()) || {};

  const active = await one(`SELECT COUNT(DISTINCT distributor) n FROM music_settlement_records`);
  const activeDistributors = Number(active.n || 0);
  const complete = activeDistributors ? await one(`SELECT MAX(ym) ym FROM (
    SELECT ${timeCol} ym, COUNT(DISTINCT distributor) d FROM music_settlement_records
    WHERE ${timeCol} IS NOT NULL GROUP BY ${timeCol} HAVING d >= ?
  )`, [activeDistributors]) : {};
  const latest = await one(`SELECT MAX(${timeCol}) ym FROM music_settlement_records WHERE ${timeCol} IS NOT NULL`);
  const completeYm = complete.ym || latest.ym || null;
  const recent3 = completeYm ? seqMonths(completeYm, 3) : [];
  const prev3 = completeYm ? seqMonths(completeYm, 3, 3) : [];

  if (view === "overview") {
    const totals = await one(`SELECT COUNT(*) rows_count, COUNT(DISTINCT song_title) tracks_count,
      COUNT(DISTINCT platform) platforms_count, COUNT(DISTINCT distributor) distributors_count, COUNT(DISTINCT album_title) albums_count,
      COALESCE(SUM(settlement_amount),0) revenue_total,
      COALESCE(SUM(CASE WHEN original_count > 0 THEN original_count ELSE 0 END),0) actual_count_total,
      COALESCE(SUM(CASE WHEN analysis_count > 0 THEN analysis_count ELSE 0 END),0) analysis_count_total,
      SUM(CASE WHEN count_basis='actual' THEN 1 ELSE 0 END) actual_rows,
      SUM(CASE WHEN count_basis='zero_adjusted' THEN 1 ELSE 0 END) zero_adjusted_rows,
      SUM(CASE WHEN count_basis='estimated' THEN 1 ELSE 0 END) estimated_rows,
      SUM(CASE WHEN count_basis='missing' THEN 1 ELSE 0 END) missing_rows
      FROM music_settlement_records`);

    let recent = {revenue:0, prev_revenue:0, complete_revenue:0, previous_month_revenue:0};
    if (recent3.length) {
      const vals = await one(`SELECT
        COALESCE(SUM(CASE WHEN ${timeCol} IN (${placeholders(recent3.length)}) THEN settlement_amount ELSE 0 END),0) revenue,
        COALESCE(SUM(CASE WHEN ${timeCol} IN (${placeholders(prev3.length)}) THEN settlement_amount ELSE 0 END),0) prev_revenue,
        COALESCE(SUM(CASE WHEN ${timeCol}=? THEN settlement_amount ELSE 0 END),0) complete_revenue,
        COALESCE(SUM(CASE WHEN ${timeCol}=? THEN settlement_amount ELSE 0 END),0) previous_month_revenue
        FROM music_settlement_records`, [...recent3, ...prev3, completeYm, monthShift(completeYm,-1)]);
      recent = vals;
    }

    const monthly = (await all(`SELECT ${timeCol} ym, COALESCE(SUM(settlement_amount),0) revenue,
      COALESCE(SUM(CASE WHEN original_count>0 THEN original_count ELSE 0 END),0) actual_count,
      COALESCE(SUM(CASE WHEN analysis_count>0 THEN analysis_count ELSE 0 END),0) analysis_count,
      COUNT(DISTINCT distributor) distributor_count, COUNT(DISTINCT song_title) track_count
      FROM music_settlement_records WHERE ${timeCol} IS NOT NULL GROUP BY ${timeCol} ORDER BY ${timeCol} DESC LIMIT 30`)).reverse();

    const topTracks = await all(`SELECT song_title, COALESCE(SUM(settlement_amount),0) revenue
      FROM music_settlement_records GROUP BY song_title ORDER BY revenue DESC LIMIT 8`);
    const topPlatforms = await all(`SELECT platform, COALESCE(SUM(settlement_amount),0) revenue,
      COALESCE(SUM(CASE WHEN original_count>0 THEN original_count ELSE 0 END),0) actual_count
      FROM music_settlement_records GROUP BY platform ORDER BY revenue DESC LIMIT 8`);
    const coverage = await all(`SELECT distributor, COUNT(*) rows_count, COALESCE(SUM(settlement_amount),0) revenue,
      MAX(occurrence_ym) latest_occurrence, MAX(settlement_ym) latest_settlement,
      SUM(CASE WHEN count_basis='actual' THEN 1 ELSE 0 END) actual_rows,
      SUM(CASE WHEN count_basis='estimated' THEN 1 ELSE 0 END) estimated_rows,
      SUM(CASE WHEN count_basis='zero_adjusted' THEN 1 ELSE 0 END) zero_adjusted_rows
      FROM music_settlement_records GROUP BY distributor ORDER BY revenue DESC`);

    let trackMomentum=[], platformMomentum=[];
    if (recent3.length) {
      const binds=[...recent3,...prev3];
      trackMomentum = await all(`SELECT song_title,
        SUM(CASE WHEN ${timeCol} IN (${placeholders(recent3.length)}) THEN settlement_amount ELSE 0 END) current_revenue,
        SUM(CASE WHEN ${timeCol} IN (${placeholders(prev3.length)}) THEN settlement_amount ELSE 0 END) previous_revenue
        FROM music_settlement_records GROUP BY song_title HAVING current_revenue>0 OR previous_revenue>0`, binds);
      platformMomentum = await all(`SELECT platform,
        SUM(CASE WHEN ${timeCol} IN (${placeholders(recent3.length)}) THEN settlement_amount ELSE 0 END) current_revenue,
        SUM(CASE WHEN ${timeCol} IN (${placeholders(prev3.length)}) THEN settlement_amount ELSE 0 END) previous_revenue
        FROM music_settlement_records GROUP BY platform HAVING current_revenue>0 OR previous_revenue>0`, binds);
      trackMomentum = trackMomentum.map(x=>({...x,delta:Number(x.current_revenue||0)-Number(x.previous_revenue||0),growth_pct:pct(Number(x.current_revenue||0),Number(x.previous_revenue||0))})).sort((a,b)=>b.delta-a.delta).slice(0,8);
      platformMomentum = platformMomentum.map(x=>({...x,delta:Number(x.current_revenue||0)-Number(x.previous_revenue||0),growth_pct:pct(Number(x.current_revenue||0),Number(x.previous_revenue||0))})).sort((a,b)=>b.delta-a.delta).slice(0,8);
    }

    const concentration = await one(`WITH p AS (SELECT platform, SUM(settlement_amount) r FROM music_settlement_records GROUP BY platform ORDER BY r DESC LIMIT 4),
      t AS (SELECT song_title, SUM(settlement_amount) r FROM music_settlement_records GROUP BY song_title ORDER BY r DESC LIMIT 10),
      a AS (SELECT SUM(settlement_amount) r FROM music_settlement_records)
      SELECT COALESCE((SELECT SUM(r) FROM p),0) platform_top4, COALESCE((SELECT SUM(r) FROM t),0) track_top10, COALESCE((SELECT r FROM a),0) total`);

    return json({ok:true,basis,latestYm:latest.ym||null,completeYm,recent3,prev3,totals,recent:{...recent,growth_pct:pct(Number(recent.revenue||0),Number(recent.prev_revenue||0)),mom_pct:pct(Number(recent.complete_revenue||0),Number(recent.previous_month_revenue||0))},monthly,topTracks,topPlatforms,coverage,trackMomentum,platformMomentum,concentration});
  }

  if (view === "platforms") {
    const total = await one(`SELECT COALESCE(SUM(settlement_amount),0) revenue FROM music_settlement_records`);
    const binds = [...recent3, ...prev3];
    const rows = await all(`SELECT platform,
      COALESCE(SUM(settlement_amount),0) revenue,
      COUNT(*) rows_count, COUNT(DISTINCT song_title) tracks_count,
      COALESCE(SUM(CASE WHEN original_count>0 THEN original_count ELSE 0 END),0) actual_count,
      COALESCE(SUM(CASE WHEN original_count>0 THEN settlement_amount ELSE 0 END),0) actual_revenue,
      COALESCE(SUM(CASE WHEN analysis_count>0 THEN analysis_count ELSE 0 END),0) analysis_count,
      SUM(CASE WHEN count_basis='zero_adjusted' THEN 1 ELSE 0 END) zero_adjusted_rows,
      SUM(CASE WHEN count_basis='estimated' THEN 1 ELSE 0 END) estimated_rows,
      MAX(${timeCol}) latest_month,
      ${recent3.length ? `SUM(CASE WHEN ${timeCol} IN (${placeholders(recent3.length)}) THEN settlement_amount ELSE 0 END)` : '0'} current_revenue,
      ${prev3.length ? `SUM(CASE WHEN ${timeCol} IN (${placeholders(prev3.length)}) THEN settlement_amount ELSE 0 END)` : '0'} previous_revenue
      FROM music_settlement_records GROUP BY platform ORDER BY revenue DESC`, binds);
    const out=rows.map(x=>{const ar=Number(x.actual_revenue||0), ac=Number(x.actual_count||0), cur=Number(x.current_revenue||0), prev=Number(x.previous_revenue||0);return {...x,share_pct:Number(total.revenue||0)>0?Number(x.revenue||0)/Number(total.revenue)*100:0,rpm_actual:ac>0?ar/ac*1000:null,delta:cur-prev,growth_pct:pct(cur,prev)};});
    return json({ok:true,basis,completeYm,recent3,prev3,rows:out});
  }

  if (view === "tracks") {
    const binds = [...recent3, ...prev3];
    const rows = await all(`SELECT song_title, GROUP_CONCAT(DISTINCT artist) artists, GROUP_CONCAT(DISTINCT album_title) albums,
      COALESCE(SUM(settlement_amount),0) revenue, COUNT(*) rows_count, COUNT(DISTINCT ${timeCol}) active_months,
      COUNT(DISTINCT platform) platforms_count, COUNT(DISTINCT distributor) distributors_count,
      COALESCE(SUM(CASE WHEN original_count>0 THEN original_count ELSE 0 END),0) actual_count,
      COALESCE(SUM(CASE WHEN analysis_count>0 THEN analysis_count ELSE 0 END),0) analysis_count,
      SUM(CASE WHEN count_basis='zero_adjusted' THEN 1 ELSE 0 END) zero_adjusted_rows,
      SUM(CASE WHEN count_basis='estimated' THEN 1 ELSE 0 END) estimated_rows,
      MAX(${timeCol}) latest_month,
      ${recent3.length ? `SUM(CASE WHEN ${timeCol} IN (${placeholders(recent3.length)}) THEN settlement_amount ELSE 0 END)` : '0'} current_revenue,
      ${prev3.length ? `SUM(CASE WHEN ${timeCol} IN (${placeholders(prev3.length)}) THEN settlement_amount ELSE 0 END)` : '0'} previous_revenue
      FROM music_settlement_records GROUP BY song_title ORDER BY revenue DESC`, binds);
    const out=rows.map(x=>{const cur=Number(x.current_revenue||0),prev=Number(x.previous_revenue||0);return {...x,delta:cur-prev,growth_pct:pct(cur,prev)};});
    return json({ok:true,basis,completeYm,recent3,prev3,rows:out});
  }

  if (view === "months") {
    const rows = await all(`SELECT ${timeCol} ym, COALESCE(SUM(settlement_amount),0) revenue, COUNT(*) rows_count,
      COUNT(DISTINCT distributor) distributors_count, COUNT(DISTINCT song_title) tracks_count, COUNT(DISTINCT platform) platforms_count,
      COALESCE(SUM(CASE WHEN original_count>0 THEN original_count ELSE 0 END),0) actual_count,
      COALESCE(SUM(CASE WHEN analysis_count>0 THEN analysis_count ELSE 0 END),0) analysis_count,
      SUM(CASE WHEN count_basis='actual' THEN 1 ELSE 0 END) actual_rows,
      SUM(CASE WHEN count_basis='zero_adjusted' THEN 1 ELSE 0 END) zero_adjusted_rows,
      SUM(CASE WHEN count_basis='estimated' THEN 1 ELSE 0 END) estimated_rows
      FROM music_settlement_records WHERE ${timeCol} IS NOT NULL GROUP BY ${timeCol} ORDER BY ${timeCol}`);
    const out=rows.map((x,i)=>({...x,complete:Number(x.distributors_count||0)>=activeDistributors,mom_pct:i?pct(Number(x.revenue||0),Number(rows[i-1].revenue||0)):null}));
    return json({ok:true,basis,activeDistributors,completeYm,rows:out});
  }

  if (view === "distributors") {
    const total=await one(`SELECT COALESCE(SUM(settlement_amount),0) revenue FROM music_settlement_records`);
    const rows=await all(`SELECT distributor, COALESCE(SUM(settlement_amount),0) revenue, COUNT(*) rows_count,
      COUNT(DISTINCT song_title) tracks_count, COUNT(DISTINCT platform) platforms_count,
      MAX(occurrence_ym) latest_occurrence, MAX(settlement_ym) latest_settlement,
      SUM(CASE WHEN count_basis='actual' THEN 1 ELSE 0 END) actual_rows,
      SUM(CASE WHEN count_basis='zero_adjusted' THEN 1 ELSE 0 END) zero_adjusted_rows,
      SUM(CASE WHEN count_basis='estimated' THEN 1 ELSE 0 END) estimated_rows,
      SUM(CASE WHEN count_basis='missing' THEN 1 ELSE 0 END) missing_rows,
      COALESCE(SUM(CASE WHEN original_count>0 THEN original_count ELSE 0 END),0) actual_count
      FROM music_settlement_records GROUP BY distributor ORDER BY revenue DESC`);
    return json({ok:true,rows:rows.map(x=>({...x,share_pct:Number(total.revenue||0)>0?Number(x.revenue||0)/Number(total.revenue)*100:0,count_actual_row_pct:Number(x.rows_count||0)>0?Number(x.actual_rows||0)/Number(x.rows_count)*100:0}))});
  }

  if (view === "quality") {
    const summary=await one(`SELECT COUNT(*) rows_count,
      SUM(CASE WHEN original_count IS NULL THEN 1 ELSE 0 END) original_missing_rows,
      SUM(CASE WHEN original_count=0 AND settlement_amount>0 THEN 1 ELSE 0 END) original_zero_positive_rows,
      SUM(CASE WHEN occurrence_ym IS NULL THEN 1 ELSE 0 END) occurrence_missing_rows,
      SUM(CASE WHEN platform IS NULL OR platform='' OR platform='미분류' THEN 1 ELSE 0 END) platform_missing_rows,
      SUM(CASE WHEN count_basis='estimated' THEN 1 ELSE 0 END) estimated_rows,
      SUM(CASE WHEN count_basis='missing' THEN 1 ELSE 0 END) count_missing_rows,
      COUNT(DISTINCT artist) artist_variants, COUNT(DISTINCT platform) platform_variants,
      COUNT(DISTINCT source_key) source_keys FROM music_settlement_records`);
    const artists=await all(`SELECT artist, COUNT(*) rows_count, COALESCE(SUM(settlement_amount),0) revenue FROM music_settlement_records GROUP BY artist ORDER BY rows_count DESC`);
    const bases=await all(`SELECT count_basis, COUNT(*) rows_count, COALESCE(SUM(settlement_amount),0) revenue FROM music_settlement_records GROUP BY count_basis ORDER BY rows_count DESC`);
    const imports=await all(`SELECT batch_id,file_name,rows_received,rows_inserted,duplicate_rows,mapping_rows,started_at,completed_at FROM settlement_import_batches ORDER BY started_at DESC LIMIT 20`);
    const mapped=await one(`SELECT COUNT(*) n FROM settlement_platform_mapping`);
    const unmapped=await one(`SELECT COUNT(DISTINCT r.source_key) n FROM music_settlement_records r LEFT JOIN settlement_platform_mapping m ON m.source_key=r.source_key WHERE r.source_key IS NOT NULL AND r.source_key<>'' AND m.source_key IS NULL`);
    return json({ok:true,summary,artists,bases,imports,mappingRows:Number(mapped.n||0),unmappedSourceKeys:Number(unmapped.n||0)});
  }

  return json({ok:false,error:"unknown_view"},400);
}
