-- Migration 0009: Add temp_password column to users
-- Stores the temporary password shown in admin until user changes it
ALTER TABLE users ADD COLUMN temp_password TEXT;
