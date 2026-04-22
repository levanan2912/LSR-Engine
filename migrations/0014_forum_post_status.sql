-- Add moderation status to forum_posts
-- status: 'pending' | 'approved' | 'rejected'
-- ai_moderation_reason: short reason from AI why the post was flagged
ALTER TABLE forum_posts ADD COLUMN status TEXT NOT NULL DEFAULT 'approved';
ALTER TABLE forum_posts ADD COLUMN ai_moderation_reason TEXT;

-- Existing posts are already public → mark approved
UPDATE forum_posts SET status = 'approved' WHERE status != 'pending';

CREATE INDEX IF NOT EXISTS idx_forum_posts_status ON forum_posts(status);
