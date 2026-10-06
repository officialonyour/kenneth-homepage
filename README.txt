KENNETH MUSIC SETTLEMENT ANALYTICS V2 / 2026-10-06

PURPOSE
- Upgrade /settlement from a simple settlement list to an analytics/monitoring dashboard.
- Preserve existing kenneth-homepage root files and existing Cloudflare resources/secrets.
- Use a new full-fidelity D1 table for the detailed workbook schema.

WORKBOOK AUDIT TARGET
- Detailed rows: 8,152
- Platform mappings: 149
- Occurrence period: 2016-04 ~ 2026-05
- Distributors: 3
- Tracks: 41
- Normalized platforms: 26
- Albums: 13
- Settlement amount total: 196,490.894817798
- Count quality after V2 rules:
  actual rows 3,760
  zero-count adjusted rows 4,267
  missing-original-count estimated rows 122
  unresolved rows 3

IMPORTANT
- Do NOT upload the workbook before running migrations/002_settlement_analytics.sql in Cloudflare D1 Console.
- The workbook's derived summary sheets are not duplicated into D1. They are recalculated from the 8,152 detailed rows, which avoids double counting.
- The 플랫폼매핑 sheet IS imported as a master mapping table.
- Existing ADMIN_PASSWORD / SESSION_SECRET are not touched.
- Settlement auth continues using SETTLEMENT_ADMIN_PASSWORD / SETTLEMENT_SESSION_SECRET.
