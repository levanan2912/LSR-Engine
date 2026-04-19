-- Migration 0004: Add session_number and session_time to daily_entries
--
-- Changes:
--   1. Add session_number INTEGER DEFAULT 1  (which session in the day: 1, 2, 3...)
--   2. Add session_time   TEXT               (start time of session: "09:30", "14:15")
--   3. Add UNIQUE(user_id, session_date, session_number) constraint
--
-- SQLite does not support ALTER TABLE ADD CONSTRAINT, so we recreate the table.
-- PRAGMA foreign_keys is disabled for the duration to allow the DROP/RENAME dance.

PRAGMA foreign_keys = OFF;

-- 1. Create new daily_entries table with target schema
CREATE TABLE IF NOT EXISTS daily_entries_new (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id             INTEGER REFERENCES users(id),
  session_date        DATE    DEFAULT CURRENT_DATE,
  session_number      INTEGER DEFAULT 1,
  session_time        TEXT,
  study_hours         REAL,
  focus_level         INTEGER CHECK(focus_level BETWEEN 1 AND 5),
  distraction_count   INTEGER,
  distracting_factors TEXT,
  goal_achieved       INTEGER CHECK(goal_achieved IN (0,1)),
  emotional_state     TEXT,
  dropout_feeling     INTEGER CHECK(dropout_feeling BETWEEN 1 AND 5),
  created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, session_date, session_number)
);

-- 2. Copy existing rows.
--    Use ROW_NUMBER() OVER (PARTITION BY user_id, session_date ORDER BY created_at)
--    to assign sequential session_number so duplicate-date rows each get a unique
--    number (1, 2, 3...) satisfying the new UNIQUE constraint.
INSERT INTO daily_entries_new (
  id, user_id, session_date,
  session_number, session_time,
  study_hours, focus_level, distraction_count,
  distracting_factors, goal_achieved, emotional_state,
  dropout_feeling, created_at
)
SELECT
  id, user_id, session_date,
  ROW_NUMBER() OVER (PARTITION BY user_id, session_date ORDER BY created_at ASC) AS session_number,
  NULL AS session_time,
  study_hours, focus_level, distraction_count,
  distracting_factors, goal_achieved, emotional_state,
  dropout_feeling, created_at
FROM daily_entries;

-- 3. Drop old table and promote new one
DROP TABLE daily_entries;
ALTER TABLE daily_entries_new RENAME TO daily_entries;

-- 4. Recreate indexes
CREATE INDEX IF NOT EXISTS idx_entries_user_date    ON daily_entries(user_id, session_date);
CREATE INDEX IF NOT EXISTS idx_entries_session_date ON daily_entries(session_date);
CREATE INDEX IF NOT EXISTS idx_entries_user_session ON daily_entries(user_id, session_date, session_number);

PRAGMA foreign_keys = ON;
