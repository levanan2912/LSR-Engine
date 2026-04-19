-- Migration 0006: Admin Console Schema
-- Adds role/lock columns to users, is_active columns to daily_entries,
-- updates admin accounts, and creates performance indexes.
-- All ALTER TABLE ADD COLUMN use DEFAULT so existing rows are backward-compatible.

-- ── 1. Extend users table ────────────────────────────────────────────────────
ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user';
ALTER TABLE users ADD COLUMN is_locked INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN locked_at DATETIME;
ALTER TABLE users ADD COLUMN locked_reason TEXT;

-- ── 2. Extend daily_entries table ────────────────────────────────────────────
ALTER TABLE daily_entries ADD COLUMN is_active INTEGER DEFAULT 1;
ALTER TABLE daily_entries ADD COLUMN deactivated_at DATETIME;
ALTER TABLE daily_entries ADD COLUMN deactivated_by TEXT;
ALTER TABLE daily_entries ADD COLUMN deactivated_reason TEXT;

-- ── 3. Seed admin roles ───────────────────────────────────────────────────────
UPDATE users SET role = 'rootadmin' WHERE LOWER(email) = 'rootadmin@gmail.com';
UPDATE users SET role = 'subadmin'  WHERE LOWER(email) = 'subadmin@gmail.com';

-- ── 4. Performance indexes ────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_users_role             ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_email            ON users(email);
CREATE INDEX IF NOT EXISTS idx_daily_entries_user_id  ON daily_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_daily_entries_date     ON daily_entries(session_date);
CREATE INDEX IF NOT EXISTS idx_daily_entries_active   ON daily_entries(is_active);
CREATE INDEX IF NOT EXISTS idx_ai_reports_user_id     ON analysis_reports(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_reports_entry_id    ON analysis_reports(entry_id);
