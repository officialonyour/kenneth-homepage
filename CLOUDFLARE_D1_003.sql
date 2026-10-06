-- KENNETH MUSIC SETTLEMENT V6
-- Revenue occurrence month rule:
-- settlement month M represents music revenue from M-3 months.
-- Example: settlement 2026-06 -> occurrence/revenue month 2026-03.

UPDATE music_settlement_records
SET
  occurrence_ym = strftime('%Y-%m', date(settlement_ym || '-01', '-3 months')),
  occurrence_year = CAST(strftime('%Y', date(settlement_ym || '-01', '-3 months')) AS INTEGER),
  occurrence_month = CAST(strftime('%m', date(settlement_ym || '-01', '-3 months')) AS INTEGER)
WHERE settlement_ym GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]';

-- Verification samples and counts.
SELECT
  COUNT(*) AS total_rows,
  SUM(CASE WHEN occurrence_ym = strftime('%Y-%m', date(settlement_ym || '-01', '-3 months')) THEN 1 ELSE 0 END) AS corrected_rows,
  SUM(CASE WHEN settlement_ym = '2026-06' AND occurrence_ym = '2026-03' THEN 1 ELSE 0 END) AS june_to_march_rows
FROM music_settlement_records
WHERE settlement_ym IS NOT NULL;

SELECT settlement_ym, occurrence_ym, COUNT(*) AS rows_count
FROM music_settlement_records
WHERE settlement_ym IS NOT NULL
GROUP BY settlement_ym, occurrence_ym
ORDER BY settlement_ym DESC
LIMIT 12;
