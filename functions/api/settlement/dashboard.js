import { json, requireDb } from "../../_shared/settlement.js";
export async function onRequestGet({ request, env }) {
  const db = requireDb(env);
  const u = new URL(request.url);
  const year = Number(u.searchParams.get("year")) || null;
  const baseClauses = [];
  const baseBinds = [];
  if (year) { baseClauses.push("settlement_year = ?"); baseBinds.push(year); }
  const makeWhere = (extra = []) => {
    const clauses = [...baseClauses, ...extra];
    return clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  };
  const stmt = (sql, binds = baseBinds) => binds.length ? db.prepare(sql).bind(...binds) : db.prepare(sql);
  const one = async (sql, binds = baseBinds) => (await stmt(sql, binds).first()) || {};
  const all = async (sql, binds = baseBinds) => (await stmt(sql, binds).all()).results || [];

  const totals = await one(`SELECT COUNT(*) rows_count,
    COUNT(DISTINCT song_title) songs_count,
    COALESCE(SUM(gross_revenue),0) gross_total,
    COALESCE(SUM(settlement_amount),0) settlement_total,
    COALESCE(SUM(actual_count),0) actual_total,
    COALESCE(SUM(estimated_count),0) estimated_total,
    COALESCE(SUM(CASE WHEN payment_status IN ('이월','대기','미지급') THEN settlement_amount ELSE 0 END),0) pending_total,
    COALESCE(SUM(CASE WHEN payment_status IN ('이월','대기','미지급') THEN 1 ELSE 0 END),0) pending_rows
    FROM settlement_records ${makeWhere()}`);

  const monthly = await all(`SELECT settlement_ym ym,
    COALESCE(SUM(settlement_amount),0) amount,
    COALESCE(SUM(gross_revenue),0) gross
    FROM settlement_records ${makeWhere(["settlement_ym IS NOT NULL"])}
    GROUP BY settlement_ym ORDER BY settlement_ym DESC LIMIT 12`);

  const topSongs = await all(`SELECT song_title, MAX(project_artist) project_artist,
    COALESCE(SUM(settlement_amount),0) amount
    FROM settlement_records ${makeWhere()}
    GROUP BY song_title ORDER BY amount DESC LIMIT 8`);

  const distributors = await all(`SELECT distributor,
    COALESCE(SUM(settlement_amount),0) amount, COUNT(*) rows_count
    FROM settlement_records ${makeWhere()}
    GROUP BY distributor ORDER BY amount DESC LIMIT 8`);

  return json({ ok:true, totals, monthly:monthly.reverse(), topSongs, distributors, generatedAt:new Date().toISOString() });
}
