-- Forum content reports (user-submitted flags)
CREATE TABLE IF NOT EXISTS forum_content_reports (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_id INTEGER NOT NULL,          -- user who submitted the report
  target_type TEXT    NOT NULL CHECK(target_type IN ('post','comment')),
  target_id   INTEGER NOT NULL,          -- id of the post or comment
  reason      TEXT    NOT NULL,          -- category slug (see CHECK below)
  note        TEXT,                      -- optional extra detail from reporter
  status      TEXT    NOT NULL DEFAULT 'pending'
                CHECK(status IN ('pending','reviewed','dismissed')),
  admin_note  TEXT,                      -- internal note left by reviewing admin
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  reviewed_at DATETIME,
  reviewed_by INTEGER,                   -- admin user id
  FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Prevent the same user from reporting the same target twice
CREATE UNIQUE INDEX IF NOT EXISTS uidx_forum_reports_user_target
  ON forum_content_reports(reporter_id, target_type, target_id);

CREATE INDEX IF NOT EXISTS idx_forum_reports_status
  ON forum_content_reports(status);

CREATE INDEX IF NOT EXISTS idx_forum_reports_target
  ON forum_content_reports(target_type, target_id);
