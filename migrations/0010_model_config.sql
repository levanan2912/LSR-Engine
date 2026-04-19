-- Migration 0010: Model configuration table
-- Allows rootadmin to control which AI models are used and their priority order.
-- Each row = one Gemini model; sort_order controls priority (lower = higher priority).
-- enabled = 1 means the model is active in the rotation pool.

CREATE TABLE IF NOT EXISTS model_config (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  model_name   TEXT    NOT NULL UNIQUE,   -- e.g. "gemini-2.5-flash-lite"
  display_name TEXT    NOT NULL,          -- e.g. "Gemini 2.5 Flash Lite"
  sort_order   INTEGER NOT NULL DEFAULT 0,-- lower = tried first
  enabled      INTEGER NOT NULL DEFAULT 1,-- 1=active, 0=disabled
  timeout_ms   INTEGER NOT NULL DEFAULT 20000, -- per-request abort timeout
  daily_limit  INTEGER,                   -- free-tier RPD limit (display only)
  notes        TEXT,                      -- admin notes
  updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_by   TEXT                       -- email of rootadmin who last changed
);

-- Seed với thứ tự ưu tiên: 2.5-flash-lite trước (nhanh), 3.1 ở cuối (500 RPD nhưng hay overload).
-- sort_order: 1 = thử trước nhất. Rootadmin có thể thay đổi thứ tự qua Admin UI.
INSERT OR IGNORE INTO model_config
  (model_name, display_name, sort_order, enabled, timeout_ms, daily_limit)
VALUES
  ('gemini-2.5-flash-lite',         'Gemini 2.5 Flash Lite',    1, 1, 20000,  20),
  ('gemini-2.5-flash',              'Gemini 2.5 Flash',         2, 1, 20000,  20),
  ('gemini-2.0-flash-lite',         'Gemini 2.0 Flash Lite',    3, 1, 20000, 200),
  ('gemini-2.0-flash',              'Gemini 2.0 Flash',         4, 1, 20000, 200),
  ('gemini-3.1-flash-lite-preview', 'Gemini 3.1 Flash Lite',    5, 1, 20000, 500);
