-- Migration 0002: Enhanced analysis_reports schema
-- Adds new columns for extended AI analysis output
-- NOTE: daily_entries.distracting_factors already exists from migration 0001

-- Add new columns to analysis_reports for enriched AI output
ALTER TABLE analysis_reports ADD COLUMN momentum_score REAL;
ALTER TABLE analysis_reports ADD COLUMN consistency_index REAL;
ALTER TABLE analysis_reports ADD COLUMN distraction_pattern TEXT;
ALTER TABLE analysis_reports ADD COLUMN emotional_trend TEXT;
ALTER TABLE analysis_reports ADD COLUMN weekly_summary TEXT;
ALTER TABLE analysis_reports ADD COLUMN personalized_tip TEXT;
ALTER TABLE analysis_reports ADD COLUMN model_used TEXT DEFAULT 'gemini-2.0-flash';

-- Index for faster report lookups by entry
CREATE INDEX IF NOT EXISTS idx_reports_entry_id ON analysis_reports(entry_id);
-- Index for date-range queries
CREATE INDEX IF NOT EXISTS idx_entries_session_date ON daily_entries(session_date);
