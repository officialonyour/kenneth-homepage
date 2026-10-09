/* Settlement calculations run in the authenticated browser worker. */
function n(v) { const x = Number(v); return Number.isFinite(x) ? x : 0; }
function pct(cur, prev) { return prev > 0 ? ((cur / prev) - 1) * 100 : null; }
function safeScope(v) { return v === "year" || v === "month" ? v : "all"; }
function validYear(v) { return /^\d{4}$/.test(String(v || "")); }
function validMonth(v) { return /^\d{4}-\d{2}$/.test(String(v || "")); }
function monthShift(ym, delta) {
  if (!validMonth(ym)) return null;
  const d = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function seqMonths(endYm, count, offset = 0) {
  const out = [];
  for (let i = count - 1; i >= 0; i--) out.push(monthShift(endYm, -i - offset));
  return out;
}
function distinctCount(rows, key) {
  const s = new Set();
  for (const r of rows) if (r[key] !== null && r[key] !== undefined) s.add(String(r[key]));
  return s.size;
}
function maxField(rows, key) {
  let m = null;
  for (const r of rows) {
    const v = r[key];
    if (v !== null && v !== undefined && v !== "" && (m === null || String(v) > m)) m = String(v);
  }
  return m;
}
function minField(rows, key) {
  let m = null;
  for (const r of rows) {
    const v = r[key];
    if (v !== null && v !== undefined && v !== "" && (m === null || String(v) < m)) m = String(v);
  }
  return m;
}
function sumWhere(rows, pred, field = "settlement_amount") {
  let s = 0;
  for (const r of rows) if (pred(r)) s += n(r[field]);
  return s;
}
function sumField(rows, field) {
  let s = 0;
  for (const r of rows) s += n(r[field]);
  return s;
}
function groupRows(rows, keyFn) {
  const m = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (k === null || k === undefined || k === "") continue;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
}
function completeMonth(rows, activeDistributors) {
  if (!activeDistributors) return null;
  const byMonth = groupRows(rows.filter(r => r.occurrence_ym), r => r.occurrence_ym);
  const candidates = [];
  for (const [ym, items] of byMonth) {
    if (distinctCount(items, "distributor") >= activeDistributors) candidates.push(ym);
  }
  candidates.sort();
  return candidates.at(-1) || null;
}
function filterScope(rows, scope, period) {
  if (scope === "year") return rows.filter(r => String(r.occurrence_ym || "").slice(0, 4) === period);
  if (scope === "month") return rows.filter(r => r.occurrence_ym === period);
  return rows;
}
function filterContext(rows, scope, period) {
  if (scope === "month" && validMonth(period)) {
    const from = monthShift(period, -11);
    return rows.filter(r => r.occurrence_ym && r.occurrence_ym >= from && r.occurrence_ym <= period);
  }
  if (scope === "year" && validYear(period)) return rows.filter(r => String(r.occurrence_ym || "").slice(0, 4) === period);
  return rows;
}
function basisCounts(items) {
  let actual = 0, zero = 0, estimated = 0, missing = 0;
  for (const r of items) {
    if (r.count_basis === "actual") actual++;
    else if (r.count_basis === "zero_adjusted") zero++;
    else if (r.count_basis === "estimated") estimated++;
    else if (r.count_basis === "missing") missing++;
  }
  return { actual_rows: actual, zero_adjusted_rows: zero, estimated_rows: estimated, missing_rows: missing };
}
function monthlyAgg(rows) {
  const out = [];
  for (const [ym, items] of groupRows(rows.filter(r => r.occurrence_ym), r => r.occurrence_ym)) {
    out.push({
      ym,
      revenue: sumField(items, "settlement_amount"),
      rows_count: items.length,
      actual_count: sumWhere(items, r => n(r.original_count) > 0, "original_count"),
      analysis_count: sumWhere(items, r => n(r.analysis_count) > 0, "analysis_count"),
      distributor_count: distinctCount(items, "distributor"),
      distributors_count: distinctCount(items, "distributor"),
      track_count: distinctCount(items, "song_title"),
      tracks_count: distinctCount(items, "song_title"),
      platforms_count: distinctCount(items, "platform"),
      ...basisCounts(items),
    });
  }
  out.sort((a, b) => a.ym.localeCompare(b.ym));
  return out;
}
function momentum(rows, key, currentWindow, previousWindow) {
  const curSet = new Set(currentWindow), prevSet = new Set(previousWindow), out = [];
  for (const [name, items] of groupRows(rows, r => r[key])) {
    let cur = 0, prev = 0;
    for (const r of items) {
      if (curSet.has(r.occurrence_ym)) cur += n(r.settlement_amount);
      if (prevSet.has(r.occurrence_ym)) prev += n(r.settlement_amount);
    }
    if (cur > 0 || prev > 0) out.push({ [key]: name, current_revenue: cur, previous_revenue: prev, delta: cur - prev, growth_pct: pct(cur, prev) });
  }
  return out;
}
function uniqueJoin(items, key) {
  const s = new Set();
  for (const r of items) {
    const v = String(r[key] ?? "").trim();
    if (v) s.add(v);
  }
  return [...s].join(",");
}

// Confirmed artist aliases affect browser display/grouping only. The cached
// source rows, import identities and other artist names remain unchanged.
function canonicalArtist(value) {
  if (typeof value !== "string") return value;
  const artist = value.normalize("NFC").trim();
  if (/^kenneth\s*x\s*(?:tieut|ㅌ)$/i.test(artist)) return "Kenneth x TIEUT";
  if (/^이휘근\s*\(\s*kenneth\s*\)$/i.test(artist)) return "이휘근 (Kenneth)";
  if (/^이휘근\s*(?:x|\{\]|\{\[)\s*김정섭\s*(?:x|\{\]|\{\[)\s*토이디$/i.test(artist)) return "이휘근 x 김정섭 x 토이디";
  return value;
}

function normalizeArtistRows(rows) {
  return rows.map(row => {
    const artist = canonicalArtist(row.artist);
    return artist === row.artist ? row : { ...row, artist };
  });
}
function baseTrackRow(song, items) {
  return {
    song_title: song,
    artists: uniqueJoin(items, "artist"),
    albums: uniqueJoin(items, "album_title"),
    revenue: sumField(items, "settlement_amount"),
    rows_count: items.length,
    active_months: distinctCount(items, "occurrence_ym"),
    platforms_count: distinctCount(items, "platform"),
    distributors_count: distinctCount(items, "distributor"),
    actual_count: sumWhere(items, r => n(r.original_count) > 0, "original_count"),
    analysis_count: sumWhere(items, r => n(r.analysis_count) > 0, "analysis_count"),
    zero_adjusted_rows: items.filter(r => r.count_basis === "zero_adjusted").length,
    estimated_rows: items.filter(r => r.count_basis === "estimated").length,
    latest_month: maxField(items, "occurrence_ym"),
  };
}


export function computeAnalytics(snapshot, parameters = {}) {
  const u = new URL("https://settlement.invalid/analytics");
  for (const [key, value] of Object.entries(parameters)) if (value !== null && value !== undefined) u.searchParams.set(key, value);
  const view = u.searchParams.get("view") || "overview";
  const allRows = normalizeArtistRows(snapshot.rows || []);
  const d1RowsRead = 0;
  const finish = payload => ({ ...payload, _cache: { hit: false, strategy: "browser_snapshot_v1" }, _d1: { strategy: "r2_chunked_v1", queries: 0, rowsRead: 0, snapshotChunks: snapshot.chunkCount || 0 } });
  const activeDistributors = distinctCount(allRows, "distributor");
  const globalLatest = maxField(allRows, "occurrence_ym");
  const globalComplete = completeMonth(allRows, activeDistributors);
  const fallbackMonth = globalComplete || globalLatest || null;

  let scope = safeScope(u.searchParams.get("scope"));
  let period = String(u.searchParams.get("period") || "").trim();
  if (scope === "year" && !validYear(period)) period = fallbackMonth ? fallbackMonth.slice(0, 4) : "";
  if (scope === "month" && !validMonth(period)) period = fallbackMonth || "";
  if ((scope === "year" || scope === "month") && !period) scope = "all";

  const sourceRows = filterScope(allRows, scope, period);
  const contextRows = filterContext(allRows, scope, period);
  const latestYm = maxField(sourceRows, "occurrence_ym");
  const completeYm = completeMonth(sourceRows, activeDistributors);
  const anchorYm = scope === "month" ? period : (completeYm || latestYm || fallbackMonth);
  const currentWindow = anchorYm ? (scope === "month" ? [anchorYm] : seqMonths(anchorYm, 3)) : [];
  const previousWindow = anchorYm ? (scope === "month" ? [monthShift(anchorYm, -1)] : seqMonths(anchorYm, 3, 3)) : [];

  const responseBase = {
    ok: true,
    basis: "occurrence",
    scope,
    period: scope === "all" ? null : period,
    latestYm,
    completeYm,
    currentWindow,
    previousWindow,
    comparisonMode: scope === "month" ? "month" : "three_month",
    _d1: { strategy: snapshot.source, queries: d1RowsRead > 0 ? 1 : 0, rowsRead: d1RowsRead },
  };

  if (view === "overview") {
    const bc = basisCounts(sourceRows);
    const totals = {
      rows_count: sourceRows.length,
      tracks_count: distinctCount(sourceRows, "song_title"),
      platforms_count: distinctCount(sourceRows, "platform"),
      distributors_count: distinctCount(sourceRows, "distributor"),
      albums_count: distinctCount(sourceRows, "album_title"),
      revenue_total: sumField(sourceRows, "settlement_amount"),
      actual_count_total: sumWhere(sourceRows, r => n(r.original_count) > 0, "original_count"),
      analysis_count_total: sumWhere(sourceRows, r => n(r.analysis_count) > 0, "analysis_count"),
      ...bc,
    };

    const curSet = new Set(currentWindow), prevSet = new Set(previousWindow);
    const recent = {
      revenue: sumWhere(allRows, r => curSet.has(r.occurrence_ym)),
      prev_revenue: sumWhere(allRows, r => prevSet.has(r.occurrence_ym)),
      complete_revenue: anchorYm ? sumWhere(allRows, r => r.occurrence_ym === anchorYm) : 0,
      previous_month_revenue: anchorYm ? sumWhere(allRows, r => r.occurrence_ym === monthShift(anchorYm, -1)) : 0,
    };
    recent.growth_pct = pct(recent.revenue, recent.prev_revenue);
    recent.mom_pct = pct(recent.complete_revenue, recent.previous_month_revenue);

    let monthly = monthlyAgg(scope === "all" ? allRows : contextRows);
    if (scope === "all") monthly = monthly.slice(-30);

    const topTracks = [...groupRows(sourceRows, r => r.song_title)].map(([song_title, items]) => ({ song_title, revenue: sumField(items, "settlement_amount") })).sort((a,b)=>b.revenue-a.revenue).slice(0,8);
    const topPlatforms = [...groupRows(sourceRows, r => r.platform)].map(([platform, items]) => ({ platform, revenue: sumField(items, "settlement_amount"), actual_count: sumWhere(items, r => n(r.original_count) > 0, "original_count") })).sort((a,b)=>b.revenue-a.revenue).slice(0,8);
    const coverage = [...groupRows(sourceRows, r => r.distributor)].map(([distributor, items]) => ({
      distributor,
      rows_count: items.length,
      revenue: sumField(items, "settlement_amount"),
      latest_occurrence: maxField(items, "occurrence_ym"),
      latest_settlement: maxField(items, "settlement_ym"),
      actual_rows: items.filter(r=>r.count_basis==="actual").length,
      estimated_rows: items.filter(r=>r.count_basis==="estimated").length,
      zero_adjusted_rows: items.filter(r=>r.count_basis==="zero_adjusted").length,
    })).sort((a,b)=>b.revenue-a.revenue);

    const trackMomentum = momentum(allRows, "song_title", currentWindow, previousWindow).sort((a,b)=>b.delta-a.delta).slice(0,8);
    const platformMomentum = momentum(allRows, "platform", currentWindow, previousWindow).sort((a,b)=>b.delta-a.delta).slice(0,8);
    const platformTotals = [...groupRows(sourceRows, r=>r.platform)].map(([,items])=>sumField(items,"settlement_amount")).sort((a,b)=>b-a);
    const trackTotals = [...groupRows(sourceRows, r=>r.song_title)].map(([,items])=>sumField(items,"settlement_amount")).sort((a,b)=>b-a);
    const totalRevenue = sumField(sourceRows, "settlement_amount");
    const concentration = {
      platform_top4: platformTotals.slice(0,4).reduce((a,b)=>a+b,0),
      track_top10: trackTotals.slice(0,10).reduce((a,b)=>a+b,0),
      total: totalRevenue,
    };

    return finish({...responseBase, totals, recent, monthly, topTracks, topPlatforms, coverage, trackMomentum, platformMomentum, concentration});
  }

  if (view === "platforms") {
    const totalRevenue = sumField(sourceRows, "settlement_amount");
    const mm = new Map(momentum(allRows, "platform", currentWindow, previousWindow).map(x=>[x.platform,x]));
    const out = [...groupRows(sourceRows, r=>r.platform)].map(([platform, items]) => {
      const m = mm.get(platform) || {};
      const revenue = sumField(items, "settlement_amount");
      const actual_count = sumWhere(items, r=>n(r.original_count)>0, "original_count");
      const actual_revenue = sumWhere(items, r=>n(r.original_count)>0, "settlement_amount");
      const current_revenue = n(m.current_revenue), previous_revenue = n(m.previous_revenue);
      return {
        platform,
        revenue,
        rows_count: items.length,
        tracks_count: distinctCount(items, "song_title"),
        actual_count,
        actual_revenue,
        analysis_count: sumWhere(items, r=>n(r.analysis_count)>0, "analysis_count"),
        zero_adjusted_rows: items.filter(r=>r.count_basis==="zero_adjusted").length,
        estimated_rows: items.filter(r=>r.count_basis==="estimated").length,
        latest_month: maxField(items, "occurrence_ym"),
        current_revenue,
        previous_revenue,
        share_pct: totalRevenue > 0 ? revenue / totalRevenue * 100 : 0,
        rpm_actual: actual_count > 0 ? actual_revenue / actual_count * 1000 : null,
        delta: current_revenue - previous_revenue,
        growth_pct: pct(current_revenue, previous_revenue),
      };
    }).sort((a,b)=>b.revenue-a.revenue);
    return finish({...responseBase, rows:out});
  }

  if (view === "track-detail") {
    const song = String(u.searchParams.get("song") || "").trim();
    if (!song) throw new Error("song_required");
    const scopedSong = sourceRows.filter(r=>r.song_title===song);
    const allSong = allRows.filter(r=>r.song_title===song);
    const contextSong = contextRows.filter(r=>r.song_title===song);
    const sb = basisCounts(scopedSong);
    const summary = {
      song_title: song,
      artists: uniqueJoin(scopedSong,"artist"),
      albums: uniqueJoin(scopedSong,"album_title"),
      revenue: sumField(scopedSong,"settlement_amount"),
      rows_count: scopedSong.length,
      active_months: distinctCount(scopedSong,"occurrence_ym"),
      platforms_count: distinctCount(scopedSong,"platform"),
      distributors_count: distinctCount(scopedSong,"distributor"),
      first_month: minField(scopedSong,"occurrence_ym"),
      latest_month: maxField(scopedSong,"occurrence_ym"),
      actual_count: sumWhere(scopedSong,r=>n(r.original_count)>0,"original_count"),
      analysis_count: sumWhere(scopedSong,r=>n(r.analysis_count)>0,"analysis_count"),
      ...sb,
    };

    const currentYear=anchorYm?anchorYm.slice(0,4):null;
    const previousYear=currentYear?String(Number(currentYear)-1):null;
    const currentMonthNo=anchorYm?Number(anchorYm.slice(5,7)):null;
    const recent12=anchorYm?seqMonths(anchorYm,12):[];
    const curSet=new Set(currentWindow),prevSet=new Set(previousWindow),r12Set=new Set(recent12);
    const recent={
      recent3_revenue:sumWhere(allSong,r=>curSet.has(r.occurrence_ym)),
      prev3_revenue:sumWhere(allSong,r=>prevSet.has(r.occurrence_ym)),
      recent12_revenue:sumWhere(allSong,r=>r12Set.has(r.occurrence_ym)),
      ytd_revenue:currentYear?sumWhere(allSong,r=>String(r.occurrence_ym||"").slice(0,4)===currentYear&&Number(String(r.occurrence_ym).slice(5,7))<=currentMonthNo):0,
      prev_ytd_revenue:previousYear?sumWhere(allSong,r=>String(r.occurrence_ym||"").slice(0,4)===previousYear&&Number(String(r.occurrence_ym).slice(5,7))<=currentMonthNo):0,
      complete_revenue:anchorYm?sumWhere(allSong,r=>r.occurrence_ym===anchorYm):0,
      previous_month_revenue:anchorYm?sumWhere(allSong,r=>r.occurrence_ym===monthShift(anchorYm,-1)):0,
    };
    recent.recent3_growth_pct=pct(recent.recent3_revenue,recent.prev3_revenue);
    recent.ytd_yoy_pct=pct(recent.ytd_revenue,recent.prev_ytd_revenue);
    recent.mom_pct=pct(recent.complete_revenue,recent.previous_month_revenue);

    const monthly=monthlyAgg(contextSong).map((x,i,a)=>({...x,previous_revenue:i?n(a[i-1].revenue):0,mom_pct:i?pct(n(x.revenue),n(a[i-1].revenue)):null}));
    const yearly=[];
    for(const [year,items] of groupRows(allSong.filter(r=>r.occurrence_ym),r=>String(r.occurrence_ym).slice(0,4))){
      yearly.push({year,revenue:sumField(items,"settlement_amount"),rows_count:items.length,active_months:distinctCount(items,"occurrence_ym"),platforms_count:distinctCount(items,"platform"),actual_count:sumWhere(items,r=>n(r.original_count)>0,"original_count"),analysis_count:sumWhere(items,r=>n(r.analysis_count)>0,"analysis_count")});
    }
    yearly.sort((a,b)=>a.year.localeCompare(b.year));

    const pmm=new Map(momentum(allSong,"platform",currentWindow,previousWindow).map(x=>[x.platform,x]));
    const totalRevenue=n(summary.revenue);
    const platforms=[...groupRows(scopedSong,r=>r.platform)].map(([platform,items])=>{
      const m=pmm.get(platform)||{},cur=n(m.current_revenue),prev=n(m.previous_revenue),ac=sumWhere(items,r=>n(r.original_count)>0,"original_count"),ar=sumWhere(items,r=>n(r.original_count)>0,"settlement_amount"),revenue=sumField(items,"settlement_amount");
      return {platform,revenue,rows_count:items.length,distributors:uniqueJoin(items,"distributor"),actual_count:ac,actual_revenue:ar,analysis_count:sumWhere(items,r=>n(r.analysis_count)>0,"analysis_count"),latest_month:maxField(items,"occurrence_ym"),current_revenue:cur,previous_revenue:prev,share_pct:totalRevenue>0?revenue/totalRevenue*100:0,delta:cur-prev,growth_pct:pct(cur,prev),rpm_actual:ac>0?ar/ac*1000:null};
    }).sort((a,b)=>b.revenue-a.revenue);

    const platformMonthly=[];
    for(const [key,items] of groupRows(contextSong.filter(r=>r.occurrence_ym),r=>`${r.occurrence_ym}\u001f${r.platform}`)){
      const [ym,platform]=key.split("\u001f");
      platformMonthly.push({ym,platform,revenue:sumField(items,"settlement_amount")});
    }
    platformMonthly.sort((a,b)=>a.ym.localeCompare(b.ym)||b.revenue-a.revenue);

    const distributors=[...groupRows(scopedSong,r=>r.distributor)].map(([distributor,items])=>{const revenue=sumField(items,"settlement_amount");return {distributor,revenue,rows_count:items.length,platforms_count:distinctCount(items,"platform"),latest_month:maxField(items,"occurrence_ym"),share_pct:totalRevenue>0?revenue/totalRevenue*100:0};}).sort((a,b)=>b.revenue-a.revenue);
    return finish({...responseBase,summary,recent,monthly,yearly,platforms,platformMonthly,distributors});
  }

  if (view === "tracks") {
    const mm=new Map(momentum(allRows,"song_title",currentWindow,previousWindow).map(x=>[x.song_title,x]));
    const out=[...groupRows(sourceRows,r=>r.song_title)].map(([song,items])=>{
      const x=baseTrackRow(song,items),m=mm.get(song)||{},cur=n(m.current_revenue),prev=n(m.previous_revenue);
      return {...x,current_revenue:cur,previous_revenue:prev,delta:cur-prev,growth_pct:pct(cur,prev)};
    }).sort((a,b)=>b.revenue-a.revenue);
    return finish({...responseBase,rows:out});
  }

  if (view === "months") {
    const rows=monthlyAgg(contextRows);
    const out=rows.map((x,i)=>({...x,complete:n(x.distributors_count)>=activeDistributors,mom_pct:i?pct(n(x.revenue),n(rows[i-1].revenue)):null}));
    return finish({...responseBase,activeDistributors,rows:out});
  }

  if (view === "distributors") {
    const totalRevenue=sumField(sourceRows,"settlement_amount");
    const rows=[...groupRows(sourceRows,r=>r.distributor)].map(([distributor,items])=>{
      const bc=basisCounts(items), revenue=sumField(items,"settlement_amount");
      return {distributor,revenue,rows_count:items.length,tracks_count:distinctCount(items,"song_title"),platforms_count:distinctCount(items,"platform"),latest_occurrence:maxField(items,"occurrence_ym"),latest_settlement:maxField(items,"settlement_ym"),actual_count:sumWhere(items,r=>n(r.original_count)>0,"original_count"),...bc,share_pct:totalRevenue>0?revenue/totalRevenue*100:0,count_actual_row_pct:items.length?bc.actual_rows/items.length*100:0};
    }).sort((a,b)=>b.revenue-a.revenue);
    return finish({...responseBase,rows});
  }

  if (view === "quality") {
    const summary={
      rows_count:allRows.length,
      original_missing_rows:allRows.filter(r=>r.original_count===null||r.original_count===undefined).length,
      original_zero_positive_rows:allRows.filter(r=>n(r.original_count)===0&&n(r.settlement_amount)>0).length,
      occurrence_missing_rows:allRows.filter(r=>!r.occurrence_ym).length,
      platform_missing_rows:allRows.filter(r=>!r.platform||r.platform==="미분류").length,
      estimated_rows:allRows.filter(r=>r.count_basis==="estimated").length,
      count_missing_rows:allRows.filter(r=>r.count_basis==="missing").length,
      artist_variants:distinctCount(allRows,"artist"),
      platform_variants:distinctCount(allRows,"platform"),
      source_keys:distinctCount(allRows,"source_key"),
    };
    const artists=[...groupRows(allRows,r=>r.artist)].map(([artist,items])=>({artist,rows_count:items.length,revenue:sumField(items,"settlement_amount")})).sort((a,b)=>b.rows_count-a.rows_count);
    const bases=[...groupRows(allRows,r=>r.count_basis)].map(([count_basis,items])=>({count_basis,rows_count:items.length,revenue:sumField(items,"settlement_amount")})).sort((a,b)=>b.rows_count-a.rows_count);
    const mappings=Array.isArray(snapshot.mappings)?snapshot.mappings:[];
    const mappedKeys=new Set(mappings.map(x=>String(x?.source_key||"").trim()).filter(Boolean));
    const uniqueSourceKeys=new Set(allRows.map(r=>r.source_key).filter(Boolean));
    let unmappedSourceKeys=0;
    if(mappedKeys.size){for(const k of uniqueSourceKeys) if(!mappedKeys.has(k)) unmappedSourceKeys++;}
    else unmappedSourceKeys=allRows.filter(r=>!r.platform||r.platform==="미분류").length;
    const imports=[];
    const payload={ok:true,summary,artists,bases,imports,mappingRows:mappedKeys.size||Number(snapshot.mappingCount||0),unmappedSourceKeys,_d1:{strategy:snapshot.source,queries:d1RowsRead>0?1:0,rowsRead:d1RowsRead}};
    return finish(payload);
  }

  throw new Error("unknown_view");
}

export function computeMeta(snapshot) {
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
    readSource:"r2_chunked_v1",
    r2Enabled:true,supportsAppend:true,
    _d1:{strategy:"r2_chunked_v1",queries:0,rowsRead:0},
    _cache:{hit:false,strategy:"browser_snapshot_v1"}
  };
  return payload;
}

function txt(v,n=300){return String(v??"").trim().slice(0,n)}
function includesText(r,q){
  if(!q)return true;
  const needles=[q.toLowerCase(),String(canonicalArtist(q)).toLowerCase()];
  return [r.song_title,r.artist,canonicalArtist(r.artist),r.album_title,r.platform,r.original_platform,r.original_service]
    .some(v=>needles.some(needle=>String(v||"").toLowerCase().includes(needle)));
}


export function computeRecords(snapshot, parameters = {}) {
  const u = new URL("https://settlement.invalid/records");
  for (const [key, value] of Object.entries(parameters)) if (value !== null && value !== undefined) u.searchParams.set(key,value);
  const q=txt(u.searchParams.get("q"));
  const distributor=txt(u.searchParams.get("distributor"));
  const platform=txt(u.searchParams.get("platform"));
  const scope=["year","month"].includes(u.searchParams.get("scope"))?u.searchParams.get("scope"):"all";
  const period=txt(u.searchParams.get("period"),7);
  const from=txt(u.searchParams.get("from"),7),to=txt(u.searchParams.get("to"),7);
  const countBasis=txt(u.searchParams.get("count_basis"),30);
  const page=Math.max(1,Number(u.searchParams.get("page"))||1);
  const limit=Math.min(500,Math.max(1,Number(u.searchParams.get("limit"))||50));
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
  rows=normalizeArtistRows(rows);
  rows.sort((a,b)=>String(b.occurrence_ym||"").localeCompare(String(a.occurrence_ym||"")) || Number(b.id||b.source_row_no||0)-Number(a.id||a.source_row_no||0));
  const total=rows.length,offset=(page-1)*limit;
  const pageRows=rows.slice(offset,offset+limit).map(r=>({
    id:Number.isFinite(Number(r.id))?Number(r.id):null,
    source_row_no:r.source_row_no??null,distributor:r.distributor??"",source_file:r.source_file??"",settlement_ym:r.settlement_ym??null,occurrence_ym:r.occurrence_ym??null,
    artist:r.artist??"",album_title:r.album_title??"",song_title:r.song_title??"",original_platform:r.original_platform??"",original_service:r.original_service??"",platform:r.platform??"",
    original_count:r.original_count??null,adjusted_count:r.adjusted_count??null,analysis_count:r.analysis_count??null,count_basis:r.count_basis??"missing",estimate_method:r.estimate_method??"",estimate_confidence:r.estimate_confidence??"",
    settlement_amount:Number(r.settlement_amount||0),revenue_source:r.revenue_source??"",notes:r.notes??"",
    ...(r.manual_key?{manual_key:r.manual_key}:{})
  }));
  return {ok:true,scope,period:scope==="all"?null:period,rows:pageRows,total,page,limit,readOnly:pageRows.some(r=>r.id===null),_d1:{strategy:"r2_chunked_v1",queries:0,rowsRead:0}};
}
