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
function safeScope(v){ return v === "year" || v === "month" ? v : "all"; }
function validYear(v){ return /^\d{4}$/.test(String(v||"")); }
function validMonth(v){ return /^\d{4}-\d{2}$/.test(String(v||"")); }

export async function onRequestGet({ request, env }) {
  const db = requireDb(env);
  const u = new URL(request.url);
  const view = u.searchParams.get("view") || "overview";
  const all = async (sql, binds=[]) => (await (binds.length ? db.prepare(sql).bind(...binds) : db.prepare(sql)).all()).results || [];
  const one = async (sql, binds=[]) => (await (binds.length ? db.prepare(sql).bind(...binds) : db.prepare(sql)).first()) || {};

  // Analysis always uses the true music revenue month (settlement month - 3 months).
  const timeCol = "occurrence_ym";
  const active = await one(`SELECT COUNT(DISTINCT distributor) n FROM music_settlement_records`);
  const activeDistributors = Number(active.n || 0);
  const globalLatest = await one(`SELECT MAX(${timeCol}) ym FROM music_settlement_records WHERE ${timeCol} IS NOT NULL`);
  const globalComplete = activeDistributors ? await one(`SELECT MAX(ym) ym FROM (
    SELECT ${timeCol} ym, COUNT(DISTINCT distributor) d FROM music_settlement_records
    WHERE ${timeCol} IS NOT NULL GROUP BY ${timeCol} HAVING d >= ?
  )`, [activeDistributors]) : {};

  let scope = safeScope(u.searchParams.get("scope"));
  let period = String(u.searchParams.get("period") || "").trim();
  const fallbackMonth = globalComplete.ym || globalLatest.ym || null;
  if (scope === "year" && !validYear(period)) period = fallbackMonth ? fallbackMonth.slice(0,4) : "";
  if (scope === "month" && !validMonth(period)) period = fallbackMonth || "";
  if (scope === "year" && !period) scope = "all";
  if (scope === "month" && !period) scope = "all";

  const scopeWhere = scope === "year"
    ? `substr(${timeCol},1,4)='${period}'`
    : scope === "month"
      ? `${timeCol}='${period}'`
      : "1=1";
  const source = `(SELECT * FROM music_settlement_records WHERE ${scopeWhere})`;

  const selectedLatest = await one(`SELECT MAX(${timeCol}) ym FROM ${source} WHERE ${timeCol} IS NOT NULL`);
  const selectedComplete = activeDistributors ? await one(`SELECT MAX(ym) ym FROM (
    SELECT ${timeCol} ym, COUNT(DISTINCT distributor) d FROM ${source}
    WHERE ${timeCol} IS NOT NULL GROUP BY ${timeCol} HAVING d >= ?
  )`, [activeDistributors]) : {};
  const latestYm = selectedLatest.ym || null;
  const completeYm = selectedComplete.ym || null;
  const anchorYm = scope === "month" ? period : (completeYm || latestYm || fallbackMonth);
  const currentWindow = anchorYm ? (scope === "month" ? [anchorYm] : seqMonths(anchorYm,3)) : [];
  const previousWindow = anchorYm ? (scope === "month" ? [monthShift(anchorYm,-1)] : seqMonths(anchorYm,3,3)) : [];

  const contextWhere = scope === "month" && validMonth(period)
    ? `${timeCol}>='${monthShift(period,-11)}' AND ${timeCol}<='${period}'`
    : scope === "year"
      ? `substr(${timeCol},1,4)='${period}'`
      : "1=1";
  const contextSource = `(SELECT * FROM music_settlement_records WHERE ${contextWhere})`;

  const responseBase = {
    ok:true,
    basis:"occurrence",
    scope,
    period:scope === "all" ? null : period,
    latestYm,
    completeYm,
    currentWindow,
    previousWindow,
    comparisonMode: scope === "month" ? "month" : "three_month"
  };

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
      FROM ${source}`);

    let recent = {revenue:0, prev_revenue:0, complete_revenue:0, previous_month_revenue:0};
    if (currentWindow.length && previousWindow.length) {
      recent = await one(`SELECT
        COALESCE(SUM(CASE WHEN ${timeCol} IN (${placeholders(currentWindow.length)}) THEN settlement_amount ELSE 0 END),0) revenue,
        COALESCE(SUM(CASE WHEN ${timeCol} IN (${placeholders(previousWindow.length)}) THEN settlement_amount ELSE 0 END),0) prev_revenue,
        COALESCE(SUM(CASE WHEN ${timeCol}=? THEN settlement_amount ELSE 0 END),0) complete_revenue,
        COALESCE(SUM(CASE WHEN ${timeCol}=? THEN settlement_amount ELSE 0 END),0) previous_month_revenue
        FROM music_settlement_records`, [...currentWindow, ...previousWindow, anchorYm, monthShift(anchorYm,-1)]);
    }

    let monthly;
    if (scope === "all") {
      monthly = (await all(`SELECT ${timeCol} ym, COALESCE(SUM(settlement_amount),0) revenue,
        COALESCE(SUM(CASE WHEN original_count>0 THEN original_count ELSE 0 END),0) actual_count,
        COALESCE(SUM(CASE WHEN analysis_count>0 THEN analysis_count ELSE 0 END),0) analysis_count,
        COUNT(DISTINCT distributor) distributor_count, COUNT(DISTINCT song_title) track_count
        FROM music_settlement_records WHERE ${timeCol} IS NOT NULL GROUP BY ${timeCol} ORDER BY ${timeCol} DESC LIMIT 30`)).reverse();
    } else {
      monthly = await all(`SELECT ${timeCol} ym, COALESCE(SUM(settlement_amount),0) revenue,
        COALESCE(SUM(CASE WHEN original_count>0 THEN original_count ELSE 0 END),0) actual_count,
        COALESCE(SUM(CASE WHEN analysis_count>0 THEN analysis_count ELSE 0 END),0) analysis_count,
        COUNT(DISTINCT distributor) distributor_count, COUNT(DISTINCT song_title) track_count
        FROM ${contextSource} WHERE ${timeCol} IS NOT NULL GROUP BY ${timeCol} ORDER BY ${timeCol}`);
    }

    const topTracks = await all(`SELECT song_title, COALESCE(SUM(settlement_amount),0) revenue
      FROM ${source} GROUP BY song_title ORDER BY revenue DESC LIMIT 8`);
    const topPlatforms = await all(`SELECT platform, COALESCE(SUM(settlement_amount),0) revenue,
      COALESCE(SUM(CASE WHEN original_count>0 THEN original_count ELSE 0 END),0) actual_count
      FROM ${source} GROUP BY platform ORDER BY revenue DESC LIMIT 8`);
    const coverage = await all(`SELECT distributor, COUNT(*) rows_count, COALESCE(SUM(settlement_amount),0) revenue,
      MAX(occurrence_ym) latest_occurrence, MAX(settlement_ym) latest_settlement,
      SUM(CASE WHEN count_basis='actual' THEN 1 ELSE 0 END) actual_rows,
      SUM(CASE WHEN count_basis='estimated' THEN 1 ELSE 0 END) estimated_rows,
      SUM(CASE WHEN count_basis='zero_adjusted' THEN 1 ELSE 0 END) zero_adjusted_rows
      FROM ${source} GROUP BY distributor ORDER BY revenue DESC`);

    let trackMomentum=[], platformMomentum=[];
    if (currentWindow.length && previousWindow.length) {
      const binds=[...currentWindow,...previousWindow];
      trackMomentum = await all(`SELECT song_title,
        SUM(CASE WHEN ${timeCol} IN (${placeholders(currentWindow.length)}) THEN settlement_amount ELSE 0 END) current_revenue,
        SUM(CASE WHEN ${timeCol} IN (${placeholders(previousWindow.length)}) THEN settlement_amount ELSE 0 END) previous_revenue
        FROM music_settlement_records GROUP BY song_title HAVING current_revenue>0 OR previous_revenue>0`, binds);
      platformMomentum = await all(`SELECT platform,
        SUM(CASE WHEN ${timeCol} IN (${placeholders(currentWindow.length)}) THEN settlement_amount ELSE 0 END) current_revenue,
        SUM(CASE WHEN ${timeCol} IN (${placeholders(previousWindow.length)}) THEN settlement_amount ELSE 0 END) previous_revenue
        FROM music_settlement_records GROUP BY platform HAVING current_revenue>0 OR previous_revenue>0`, binds);
      trackMomentum = trackMomentum.map(x=>({...x,delta:Number(x.current_revenue||0)-Number(x.previous_revenue||0),growth_pct:pct(Number(x.current_revenue||0),Number(x.previous_revenue||0))})).sort((a,b)=>b.delta-a.delta).slice(0,8);
      platformMomentum = platformMomentum.map(x=>({...x,delta:Number(x.current_revenue||0)-Number(x.previous_revenue||0),growth_pct:pct(Number(x.current_revenue||0),Number(x.previous_revenue||0))})).sort((a,b)=>b.delta-a.delta).slice(0,8);
    }

    const concentration = await one(`WITH scoped AS (SELECT * FROM music_settlement_records WHERE ${scopeWhere}),
      p AS (SELECT platform, SUM(settlement_amount) r FROM scoped GROUP BY platform ORDER BY r DESC LIMIT 4),
      t AS (SELECT song_title, SUM(settlement_amount) r FROM scoped GROUP BY song_title ORDER BY r DESC LIMIT 10),
      a AS (SELECT SUM(settlement_amount) r FROM scoped)
      SELECT COALESCE((SELECT SUM(r) FROM p),0) platform_top4, COALESCE((SELECT SUM(r) FROM t),0) track_top10, COALESCE((SELECT r FROM a),0) total`);

    return json({...responseBase,totals,recent:{...recent,growth_pct:pct(Number(recent.revenue||0),Number(recent.prev_revenue||0)),mom_pct:pct(Number(recent.complete_revenue||0),Number(recent.previous_month_revenue||0))},monthly,topTracks,topPlatforms,coverage,trackMomentum,platformMomentum,concentration});
  }

  if (view === "platforms") {
    const total = await one(`SELECT COALESCE(SUM(settlement_amount),0) revenue FROM ${source}`);
    const baseRows = await all(`SELECT platform,
      COALESCE(SUM(settlement_amount),0) revenue,
      COUNT(*) rows_count, COUNT(DISTINCT song_title) tracks_count,
      COALESCE(SUM(CASE WHEN original_count>0 THEN original_count ELSE 0 END),0) actual_count,
      COALESCE(SUM(CASE WHEN original_count>0 THEN settlement_amount ELSE 0 END),0) actual_revenue,
      COALESCE(SUM(CASE WHEN analysis_count>0 THEN analysis_count ELSE 0 END),0) analysis_count,
      SUM(CASE WHEN count_basis='zero_adjusted' THEN 1 ELSE 0 END) zero_adjusted_rows,
      SUM(CASE WHEN count_basis='estimated' THEN 1 ELSE 0 END) estimated_rows,
      MAX(${timeCol}) latest_month
      FROM ${source} GROUP BY platform ORDER BY revenue DESC`);
    let momentum=[];
    if(currentWindow.length && previousWindow.length){
      momentum=await all(`SELECT platform,
        SUM(CASE WHEN ${timeCol} IN (${placeholders(currentWindow.length)}) THEN settlement_amount ELSE 0 END) current_revenue,
        SUM(CASE WHEN ${timeCol} IN (${placeholders(previousWindow.length)}) THEN settlement_amount ELSE 0 END) previous_revenue
        FROM music_settlement_records GROUP BY platform`,[...currentWindow,...previousWindow]);
    }
    const mm=new Map(momentum.map(x=>[x.platform,x]));
    const out=baseRows.map(x=>{const m=mm.get(x.platform)||{}, ar=Number(x.actual_revenue||0), ac=Number(x.actual_count||0), cur=Number(m.current_revenue||0), prev=Number(m.previous_revenue||0);return {...x,current_revenue:cur,previous_revenue:prev,share_pct:Number(total.revenue||0)>0?Number(x.revenue||0)/Number(total.revenue)*100:0,rpm_actual:ac>0?ar/ac*1000:null,delta:cur-prev,growth_pct:pct(cur,prev)};});
    return json({...responseBase,rows:out});
  }

  if (view === "track-detail") {
    const song = String(u.searchParams.get("song") || "").trim();
    if (!song) return json({ok:false,error:"song_required"},400);

    const summary = await one(`SELECT song_title,
      GROUP_CONCAT(DISTINCT artist) artists, GROUP_CONCAT(DISTINCT album_title) albums,
      COALESCE(SUM(settlement_amount),0) revenue, COUNT(*) rows_count,
      COUNT(DISTINCT ${timeCol}) active_months, COUNT(DISTINCT platform) platforms_count,
      COUNT(DISTINCT distributor) distributors_count,
      MIN(${timeCol}) first_month, MAX(${timeCol}) latest_month,
      COALESCE(SUM(CASE WHEN original_count>0 THEN original_count ELSE 0 END),0) actual_count,
      COALESCE(SUM(CASE WHEN analysis_count>0 THEN analysis_count ELSE 0 END),0) analysis_count,
      SUM(CASE WHEN count_basis='actual' THEN 1 ELSE 0 END) actual_rows,
      SUM(CASE WHEN count_basis='zero_adjusted' THEN 1 ELSE 0 END) zero_adjusted_rows,
      SUM(CASE WHEN count_basis='estimated' THEN 1 ELSE 0 END) estimated_rows,
      SUM(CASE WHEN count_basis='missing' THEN 1 ELSE 0 END) missing_rows
      FROM ${source} WHERE song_title=?`, [song]);

    const currentYear=anchorYm?anchorYm.slice(0,4):null;
    const previousYear=currentYear?String(Number(currentYear)-1):null;
    const currentMonthNo=anchorYm?Number(anchorYm.slice(5,7)):null;
    const recent12=anchorYm?seqMonths(anchorYm,12):[];
    let recent={recent3_revenue:0,prev3_revenue:0,recent12_revenue:0,ytd_revenue:0,prev_ytd_revenue:0,complete_revenue:0,previous_month_revenue:0};
    if(anchorYm&&currentWindow.length&&previousWindow.length&&recent12.length){
      recent=await one(`SELECT
        COALESCE(SUM(CASE WHEN ${timeCol} IN (${placeholders(currentWindow.length)}) THEN settlement_amount ELSE 0 END),0) recent3_revenue,
        COALESCE(SUM(CASE WHEN ${timeCol} IN (${placeholders(previousWindow.length)}) THEN settlement_amount ELSE 0 END),0) prev3_revenue,
        COALESCE(SUM(CASE WHEN ${timeCol} IN (${placeholders(recent12.length)}) THEN settlement_amount ELSE 0 END),0) recent12_revenue,
        COALESCE(SUM(CASE WHEN substr(${timeCol},1,4)=? AND CAST(substr(${timeCol},6,2) AS INTEGER)<=? THEN settlement_amount ELSE 0 END),0) ytd_revenue,
        COALESCE(SUM(CASE WHEN substr(${timeCol},1,4)=? AND CAST(substr(${timeCol},6,2) AS INTEGER)<=? THEN settlement_amount ELSE 0 END),0) prev_ytd_revenue,
        COALESCE(SUM(CASE WHEN ${timeCol}=? THEN settlement_amount ELSE 0 END),0) complete_revenue,
        COALESCE(SUM(CASE WHEN ${timeCol}=? THEN settlement_amount ELSE 0 END),0) previous_month_revenue
        FROM music_settlement_records WHERE song_title=?`, [...currentWindow,...previousWindow,...recent12,currentYear,currentMonthNo,previousYear,currentMonthNo,anchorYm,monthShift(anchorYm,-1),song]);
    }
    recent.recent3_growth_pct=pct(Number(recent.recent3_revenue||0),Number(recent.prev3_revenue||0));
    recent.ytd_yoy_pct=pct(Number(recent.ytd_revenue||0),Number(recent.prev_ytd_revenue||0));
    recent.mom_pct=pct(Number(recent.complete_revenue||0),Number(recent.previous_month_revenue||0));

    const monthly = await all(`SELECT ${timeCol} ym,
      COALESCE(SUM(settlement_amount),0) revenue, COUNT(*) rows_count,
      COUNT(DISTINCT platform) platforms_count, COUNT(DISTINCT distributor) distributors_count,
      COALESCE(SUM(CASE WHEN original_count>0 THEN original_count ELSE 0 END),0) actual_count,
      COALESCE(SUM(CASE WHEN analysis_count>0 THEN analysis_count ELSE 0 END),0) analysis_count
      FROM ${contextSource} WHERE song_title=? AND ${timeCol} IS NOT NULL
      GROUP BY ${timeCol} ORDER BY ${timeCol}`, [song]);
    const monthlyOut=monthly.map((x,i)=>({...x,previous_revenue:i?Number(monthly[i-1].revenue||0):0,mom_pct:i?pct(Number(x.revenue||0),Number(monthly[i-1].revenue||0)):null}));

    // Keep the annual trend as full-history context even when a year/month filter is selected.
    const yearly = await all(`SELECT substr(${timeCol},1,4) year,
      COALESCE(SUM(settlement_amount),0) revenue, COUNT(*) rows_count,
      COUNT(DISTINCT ${timeCol}) active_months, COUNT(DISTINCT platform) platforms_count,
      COALESCE(SUM(CASE WHEN original_count>0 THEN original_count ELSE 0 END),0) actual_count,
      COALESCE(SUM(CASE WHEN analysis_count>0 THEN analysis_count ELSE 0 END),0) analysis_count
      FROM music_settlement_records WHERE song_title=? AND ${timeCol} IS NOT NULL
      GROUP BY substr(${timeCol},1,4) ORDER BY year`, [song]);

    const platformBase=await all(`SELECT platform,
      COALESCE(SUM(settlement_amount),0) revenue, COUNT(*) rows_count,
      GROUP_CONCAT(DISTINCT distributor) distributors,
      COALESCE(SUM(CASE WHEN original_count>0 THEN original_count ELSE 0 END),0) actual_count,
      COALESCE(SUM(CASE WHEN original_count>0 THEN settlement_amount ELSE 0 END),0) actual_revenue,
      COALESCE(SUM(CASE WHEN analysis_count>0 THEN analysis_count ELSE 0 END),0) analysis_count,
      MAX(${timeCol}) latest_month
      FROM ${source} WHERE song_title=? GROUP BY platform ORDER BY revenue DESC`,[song]);
    let platformMomentum=[];
    if(currentWindow.length&&previousWindow.length){
      platformMomentum=await all(`SELECT platform,
        SUM(CASE WHEN ${timeCol} IN (${placeholders(currentWindow.length)}) THEN settlement_amount ELSE 0 END) current_revenue,
        SUM(CASE WHEN ${timeCol} IN (${placeholders(previousWindow.length)}) THEN settlement_amount ELSE 0 END) previous_revenue
        FROM music_settlement_records WHERE song_title=? GROUP BY platform`,[...currentWindow,...previousWindow,song]);
    }
    const pmm=new Map(platformMomentum.map(x=>[x.platform,x]));
    const totalRevenue=Number(summary.revenue||0);
    const platforms=platformBase.map(x=>{const m=pmm.get(x.platform)||{},cur=Number(m.current_revenue||0),prev=Number(m.previous_revenue||0),ac=Number(x.actual_count||0),ar=Number(x.actual_revenue||0);return {...x,current_revenue:cur,previous_revenue:prev,share_pct:totalRevenue>0?Number(x.revenue||0)/totalRevenue*100:0,delta:cur-prev,growth_pct:pct(cur,prev),rpm_actual:ac>0?ar/ac*1000:null};});

    const platformMonthly=await all(`SELECT ${timeCol} ym, platform, COALESCE(SUM(settlement_amount),0) revenue
      FROM ${contextSource} WHERE song_title=? AND ${timeCol} IS NOT NULL
      GROUP BY ${timeCol}, platform ORDER BY ${timeCol}, revenue DESC`, [song]);

    const distributorRows=await all(`SELECT distributor, COALESCE(SUM(settlement_amount),0) revenue,
      COUNT(*) rows_count, COUNT(DISTINCT platform) platforms_count, MAX(${timeCol}) latest_month
      FROM ${source} WHERE song_title=? GROUP BY distributor ORDER BY revenue DESC`, [song]);
    const distributors=distributorRows.map(x=>({...x,share_pct:totalRevenue>0?Number(x.revenue||0)/totalRevenue*100:0}));

    return json({...responseBase,summary,recent,monthly:monthlyOut,yearly,platforms,platformMonthly,distributors});
  }

  if (view === "tracks") {
    const baseRows = await all(`SELECT song_title, GROUP_CONCAT(DISTINCT artist) artists, GROUP_CONCAT(DISTINCT album_title) albums,
      COALESCE(SUM(settlement_amount),0) revenue, COUNT(*) rows_count, COUNT(DISTINCT ${timeCol}) active_months,
      COUNT(DISTINCT platform) platforms_count, COUNT(DISTINCT distributor) distributors_count,
      COALESCE(SUM(CASE WHEN original_count>0 THEN original_count ELSE 0 END),0) actual_count,
      COALESCE(SUM(CASE WHEN analysis_count>0 THEN analysis_count ELSE 0 END),0) analysis_count,
      SUM(CASE WHEN count_basis='zero_adjusted' THEN 1 ELSE 0 END) zero_adjusted_rows,
      SUM(CASE WHEN count_basis='estimated' THEN 1 ELSE 0 END) estimated_rows,
      MAX(${timeCol}) latest_month
      FROM ${source} GROUP BY song_title ORDER BY revenue DESC`);
    let momentum=[];
    if(currentWindow.length&&previousWindow.length){
      momentum=await all(`SELECT song_title,
        SUM(CASE WHEN ${timeCol} IN (${placeholders(currentWindow.length)}) THEN settlement_amount ELSE 0 END) current_revenue,
        SUM(CASE WHEN ${timeCol} IN (${placeholders(previousWindow.length)}) THEN settlement_amount ELSE 0 END) previous_revenue
        FROM music_settlement_records GROUP BY song_title`,[...currentWindow,...previousWindow]);
    }
    const mm=new Map(momentum.map(x=>[x.song_title,x]));
    const out=baseRows.map(x=>{const m=mm.get(x.song_title)||{},cur=Number(m.current_revenue||0),prev=Number(m.previous_revenue||0);return {...x,current_revenue:cur,previous_revenue:prev,delta:cur-prev,growth_pct:pct(cur,prev)};});
    return json({...responseBase,rows:out});
  }

  if (view === "months") {
    const rows = await all(`SELECT ${timeCol} ym, COALESCE(SUM(settlement_amount),0) revenue, COUNT(*) rows_count,
      COUNT(DISTINCT distributor) distributors_count, COUNT(DISTINCT song_title) tracks_count, COUNT(DISTINCT platform) platforms_count,
      COALESCE(SUM(CASE WHEN original_count>0 THEN original_count ELSE 0 END),0) actual_count,
      COALESCE(SUM(CASE WHEN analysis_count>0 THEN analysis_count ELSE 0 END),0) analysis_count,
      SUM(CASE WHEN count_basis='actual' THEN 1 ELSE 0 END) actual_rows,
      SUM(CASE WHEN count_basis='zero_adjusted' THEN 1 ELSE 0 END) zero_adjusted_rows,
      SUM(CASE WHEN count_basis='estimated' THEN 1 ELSE 0 END) estimated_rows
      FROM ${contextSource} WHERE ${timeCol} IS NOT NULL GROUP BY ${timeCol} ORDER BY ${timeCol}`);
    const out=rows.map((x,i)=>({...x,complete:Number(x.distributors_count||0)>=activeDistributors,mom_pct:i?pct(Number(x.revenue||0),Number(rows[i-1].revenue||0)):null}));
    return json({...responseBase,activeDistributors,rows:out});
  }

  if (view === "distributors") {
    const total=await one(`SELECT COALESCE(SUM(settlement_amount),0) revenue FROM ${source}`);
    const rows=await all(`SELECT distributor, COALESCE(SUM(settlement_amount),0) revenue, COUNT(*) rows_count,
      COUNT(DISTINCT song_title) tracks_count, COUNT(DISTINCT platform) platforms_count,
      MAX(occurrence_ym) latest_occurrence, MAX(settlement_ym) latest_settlement,
      SUM(CASE WHEN count_basis='actual' THEN 1 ELSE 0 END) actual_rows,
      SUM(CASE WHEN count_basis='zero_adjusted' THEN 1 ELSE 0 END) zero_adjusted_rows,
      SUM(CASE WHEN count_basis='estimated' THEN 1 ELSE 0 END) estimated_rows,
      SUM(CASE WHEN count_basis='missing' THEN 1 ELSE 0 END) missing_rows,
      COALESCE(SUM(CASE WHEN original_count>0 THEN original_count ELSE 0 END),0) actual_count
      FROM ${source} GROUP BY distributor ORDER BY revenue DESC`);
    return json({...responseBase,rows:rows.map(x=>({...x,share_pct:Number(total.revenue||0)>0?Number(x.revenue||0)/Number(total.revenue)*100:0,count_actual_row_pct:Number(x.rows_count||0)>0?Number(x.actual_rows||0)/Number(x.rows_count)*100:0}))});
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
