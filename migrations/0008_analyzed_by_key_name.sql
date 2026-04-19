-- Migration 0008: Add analyzed_by and key_name to analysis_reports
-- Track which Gemini model and API key was used for each report
ALTER TABLE analysis_reports ADD COLUMN analyzed_by TEXT;
ALTER TABLE analysis_reports ADD COLUMN key_name TEXT;
