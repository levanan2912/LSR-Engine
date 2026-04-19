-- Ensure email uniqueness at DB level.
-- The original schema already declares `email TEXT UNIQUE NOT NULL`,
-- so this migration is a safety net for any environment where the
-- constraint may have been dropped or the table was recreated without it.
-- SQLite does not support ALTER TABLE ADD CONSTRAINT, so we use a
-- unique index instead (equivalent for enforcement purposes).

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique
  ON users (LOWER(email));
