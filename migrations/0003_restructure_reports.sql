-- Migration 0003: Restructure analysis_reports
-- Removes: study_advice, session_advice, rest_advice, momentum_score,
--          consistency_index, distraction_pattern, emotional_trend,
--          weekly_summary, personalized_tip, model_used
-- Adds:    monitoring_protocol, raw_ai_response
-- NOTE: daily_entries.distracting_factors already exists (migration 0001)

-- SQLite does not support DROP COLUMN before v3.35 (Cloudflare D1 supports it).
-- We recreate analysis_reports with the new schema, migrating existing rows.

-- 1. Create new table with target schema
CREATE TABLE IF NOT EXISTS analysis_reports_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  entry_id INTEGER REFERENCES daily_entries(id),
  report_date DATE DEFAULT CURRENT_DATE,
  risk_level TEXT CHECK(risk_level IN ('Stable','Fluctuating','High Risk')),
  key_signals TEXT,
  short_term_forecast TEXT,
  primary_risk_driver TEXT,
  intervention_strategy TEXT,
  action_plan_48h TEXT,
  monitoring_protocol TEXT,
  raw_ai_response TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. Copy existing data (map old columns → new; dropped columns are discarded)
INSERT INTO analysis_reports_new (
  id, user_id, entry_id, report_date,
  risk_level, key_signals, short_term_forecast,
  primary_risk_driver, intervention_strategy,
  action_plan_48h, monitoring_protocol, raw_ai_response,
  created_at
)
SELECT
  id, user_id, entry_id, report_date,
  risk_level, key_signals, short_term_forecast,
  primary_risk_driver, intervention_strategy,
  action_plan_48h,
  NULL AS monitoring_protocol,
  NULL AS raw_ai_response,
  created_at
FROM analysis_reports;

-- 3. Drop old table and rename new one
DROP TABLE analysis_reports;
ALTER TABLE analysis_reports_new RENAME TO analysis_reports;

-- 4. Recreate indexes
CREATE INDEX IF NOT EXISTS idx_reports_user     ON analysis_reports(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_reports_entry_id ON analysis_reports(entry_id);
