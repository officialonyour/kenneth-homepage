/* Read-only global song trends from the existing authenticated snapshot. */
const validMonth = value => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value || ""));
const validYear = value => /^\d{4}$/.test(String(value || ""));
const number = value => { const result = Number(value); return Number.isFinite(result) ? result : 0; };
const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const text = value => value === null || value === undefined ? "" : String(value);
const named = value => text(value).trim() ? text(value) : "";
const growth = (current, previous, present) => present && previous > 0 ? (current / previous - 1) * 100 : null;
const share = (revenue, total) => total > 0 ? revenue / total * 100 : 0;

function monthNumber(ym) { return Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1; }
function monthText(index) {
  const year = Math.floor(index / 12), month = index - year * 12 + 1;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}
function previousMonth(ym) { return validMonth(ym) ? monthText(monthNumber(ym) - 1) : null; }
function monthAxis(start, end) {
  if (!validMonth(start) || !validMonth(end) || start > end) return [];
  const out = [], stop = monthNumber(end);
  for (let index = monthNumber(start); index <= stop; index++) out.push(monthText(index));
  return out;
}
function getMonth(map, ym) {
  let value = map.get(ym);
  if (!value) {
    value = { revenue: 0, rows_count: 0, actual_count: 0, analysis_count: 0, tracks: new Set(), platforms: new Set(), distributors: new Set(), trackRevenue: new Map(), trackActual: new Map(), platformRevenue: new Map() };
    map.set(ym, value);
  }
  return value;
}
function addRevenue(map, name, revenue) { if (name) map.set(name, (map.get(name) || 0) + revenue); }

export function computeAllTrends(snapshot, parameters = {}) {
  const rows = Array.isArray(snapshot?.rows) ? snapshot.rows : [];
  // One source-row pass builds all month/series aggregates. The scoped response
  // merges those aggregates, so each series never scans the full snapshot.
  // The empty month key holds undated totals without polluting calendar charts.
  const globalMonths = new Map(), allDistributors = new Set();
  let globalLatest = null;
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const distributor = named(row.distributor);
    if (distributor) allDistributors.add(distributor);
    const ym = text(row.occurrence_ym), dated = validMonth(ym);
    if (dated && (globalLatest === null || ym > globalLatest)) globalLatest = ym;
    const month = getMonth(globalMonths, dated ? ym : "");
    const amount = number(row.settlement_amount), song = named(row.song_title), platform = named(row.platform);
    const original = Math.max(0, number(row.original_count)), analysis = Math.max(0, number(row.analysis_count));
    month.revenue += amount;
    month.rows_count++;
    month.actual_count += original;
    month.analysis_count += analysis;
    if (song) month.tracks.add(song);
    if (platform) month.platforms.add(platform);
    if (distributor) month.distributors.add(distributor);
    addRevenue(month.trackRevenue, song, amount);
    addRevenue(month.trackActual, song, original);
    addRevenue(month.platformRevenue, platform, amount);
  }

  let scope = parameters.scope === "year" || parameters.scope === "month" ? parameters.scope : "all";
  let period = text(parameters.period).trim();
  if (scope === "year" && !validYear(period)) period = globalLatest ? globalLatest.slice(0, 4) : "";
  if (scope === "month" && !validMonth(period)) period = globalLatest || "";
  if (scope !== "all" && !period) scope = "all";

  const months = new Map(), yearlyRevenue = new Map(), trackTotals = new Map(), platformTotals = new Map();
  const platforms = new Set();
  let revenue = 0, rowsCount = 0, actualCount = 0, analysisCount = 0;
  let firstMonth = null, latestMonth = null, undatedRevenue = 0, undatedRows = 0;
  for (const [ym, month] of globalMonths) {
    const dated = !!ym;
    if (scope === "year" && (!dated || ym.slice(0, 4) !== period)) continue;
    if (scope === "month" && (!dated || ym !== period)) continue;
    revenue += month.revenue;
    rowsCount += month.rows_count;
    actualCount += month.actual_count;
    analysisCount += month.analysis_count;
    for (const platform of month.platforms) platforms.add(platform);

    for (const [song, amount] of month.trackRevenue) {
      let track = trackTotals.get(song);
      if (!track) { track = { song_title: song, revenue: 0, latest_month: null, actual_count: 0 }; trackTotals.set(song, track); }
      track.revenue += amount;
      track.actual_count += month.trackActual.get(song) || 0;
      if (dated && (track.latest_month === null || ym > track.latest_month)) track.latest_month = ym;
    }
    for (const [platform, amount] of month.platformRevenue) addRevenue(platformTotals, platform, amount);

    if (!dated) { undatedRevenue += month.revenue; undatedRows += month.rows_count; continue; }
    if (firstMonth === null || ym < firstMonth) firstMonth = ym;
    if (latestMonth === null || ym > latestMonth) latestMonth = ym;
    addRevenue(yearlyRevenue, ym.slice(0, 4), month.revenue);
    months.set(ym, month);
  }

  let completeYm = null;
  if (allDistributors.size) {
    for (const [ym, month] of months) {
      if (month.distributors.size >= allDistributors.size && (completeYm === null || ym > completeYm)) completeYm = ym;
    }
  }
  let axis;
  if (scope === "month") axis = [period];
  else if (scope === "year") {
    const end = globalLatest && globalLatest.slice(0, 4) === period ? globalLatest : `${period}-12`;
    axis = monthAxis(`${period}-01`, end);
  } else axis = monthAxis(firstMonth, latestMonth);

  const monthly = axis.map(ym => {
    const month = months.get(ym), prior = globalMonths.get(previousMonth(ym));
    const value = month?.revenue || 0, previous = prior ? prior.revenue : null;
    return { ym, revenue: value, previous_revenue: previous, mom_pct: growth(value, previous, !!month && !!prior), rows_count: month?.rows_count || 0, tracks_count: month?.tracks.size || 0, platforms_count: month?.platforms.size || 0, actual_count: month?.actual_count || 0, analysis_count: month?.analysis_count || 0, has_data: !!month };
  });
  const yearly = [...yearlyRevenue].map(([year, value]) => ({ year, revenue: value })).sort((a, b) => compareText(a.year, b.year));
  const tracks = [...trackTotals.values()].map(track => ({ ...track, share_pct: share(track.revenue, revenue) })).sort((a, b) => b.revenue - a.revenue || compareText(a.song_title, b.song_title));
  const topTracks = tracks.slice(0, 5);
  const topPlatforms = [...platformTotals].map(([platform, value]) => ({ platform, revenue: value, share_pct: share(value, revenue) })).sort((a, b) => b.revenue - a.revenue || compareText(a.platform, b.platform)).slice(0, 5);
  const trackMonthly = [], platformMonthly = [];
  for (const ym of axis) {
    const month = months.get(ym);
    for (const track of topTracks) trackMonthly.push({ ym, song_title: track.song_title, revenue: month?.trackRevenue.get(track.song_title) || 0 });
    for (const platform of topPlatforms) platformMonthly.push({ ym, platform: platform.platform, revenue: month?.platformRevenue.get(platform.platform) || 0 });
  }
  const latestAnchor = scope === "month" ? period : latestMonth;
  const latestRevenue = latestAnchor ? months.get(latestAnchor)?.revenue || 0 : 0;
  const previous = previousMonth(latestAnchor), prior = previous ? globalMonths.get(previous) : null;
  return {
    ok: true, basis: "occurrence", scope, period: scope === "all" ? null : period,
    latestYm: latestMonth, completeYm,
    summary: { revenue, rows_count: rowsCount, tracks_count: trackTotals.size, platforms_count: platforms.size, actual_count: actualCount, analysis_count: analysisCount, first_month: firstMonth, latest_month: latestMonth, latest_revenue: latestRevenue, previous_month: previous, previous_revenue: prior ? prior.revenue : null, mom_pct: growth(latestRevenue, prior?.revenue || 0, !!months.get(latestAnchor) && !!prior), undated_revenue: undatedRevenue, undated_rows: undatedRows },
    monthly, yearly, tracks, topTracks, topPlatforms, trackMonthly, platformMonthly,
  };
}
