-- Add parent_id to forum_comments to support threaded replies
ALTER TABLE forum_comments ADD COLUMN parent_id INTEGER REFERENCES forum_comments(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_forum_comments_parent_id ON forum_comments(parent_id);
