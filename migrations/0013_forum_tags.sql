-- Forum genre/tag system
-- Seed tags (fixed list, relevant to LSR Engine learning theme)
CREATE TABLE IF NOT EXISTS forum_tags (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT    NOT NULL UNIQUE,   -- machine key
  label TEXT   NOT NULL,          -- display name (Vietnamese)
  color TEXT   NOT NULL DEFAULT '#6366f1',  -- hex color for badge
  icon  TEXT   NOT NULL DEFAULT '🏷️',
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- Junction table: many posts ↔ many tags
CREATE TABLE IF NOT EXISTS forum_post_tags (
  post_id INTEGER NOT NULL REFERENCES forum_posts(id) ON DELETE CASCADE,
  tag_id  INTEGER NOT NULL REFERENCES forum_tags(id)  ON DELETE CASCADE,
  PRIMARY KEY (post_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_forum_post_tags_post ON forum_post_tags(post_id);
CREATE INDEX IF NOT EXISTS idx_forum_post_tags_tag  ON forum_post_tags(tag_id);

-- ── Seed genre list ────────────────────────────────────────────────────────────
INSERT OR IGNORE INTO forum_tags (slug, label, color, icon, sort_order) VALUES
  ('met-moi',      'Mệt mỏi',        '#ef4444', '😴', 1),
  ('xao-nhang',    'Xao nhãng',       '#f97316', '🌀', 2),
  ('ap-luc',       'Áp lực',          '#dc2626', '🔥', 3),
  ('bo-cuoc',      'Cảm giác bỏ cuộc','#b91c1c', '💔', 4),
  ('cam-xuc',      'Cảm xúc',         '#ec4899', '💭', 5),
  ('tap-trung',    'Tập trung',        '#8b5cf6', '🎯', 6),
  ('giai-phap',    'Giải pháp',        '#10b981', '💡', 7),
  ('dong-luc',     'Động lực',         '#06b6d4', '⚡', 8),
  ('thoi-quen',    'Thói quen',        '#6366f1', '📅', 9),
  ('ky-thuat',     'Kỹ thuật học',     '#3b82f6', '📚', 10),
  ('muc-tieu',     'Mục tiêu',         '#0ea5e9', '🏆', 11),
  ('chinh-phuc',   'Thành tích',       '#22c55e', '🎉', 12),
  ('hoi-ngo',      'Hỏi ngợi',         '#a855f7', '🙋', 13),
  ('chia-se',      'Chia sẻ',          '#64748b', '🤝', 14),
  ('suc-khoe',     'Sức khoẻ',         '#14b8a6', '💪', 15);
