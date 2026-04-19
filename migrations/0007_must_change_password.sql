-- Migration 0007: Add must_change_password flag
-- When admin resets a user's password, this flag is set to 1.
-- The user is forced to change password on next login before accessing the app.
ALTER TABLE users ADD COLUMN must_change_password INTEGER DEFAULT 0;
