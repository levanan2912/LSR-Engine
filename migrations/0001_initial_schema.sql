-- Users table
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Daily entries table
CREATE TABLE IF NOT EXISTS daily_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  session_date DATE DEFAULT CURRENT_DATE,
  study_hours REAL,
  focus_level INTEGER CHECK(focus_level BETWEEN 1 AND 5),
  distraction_count INTEGER,
  distracting_factors TEXT,
  goal_achieved INTEGER CHECK(goal_achieved IN (0,1)),
  emotional_state TEXT,
  dropout_feeling INTEGER CHECK(dropout_feeling BETWEEN 1 AND 5),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Analysis reports table
CREATE TABLE IF NOT EXISTS analysis_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  entry_id INTEGER REFERENCES daily_entries(id),
  report_date DATE DEFAULT CURRENT_DATE,
  risk_level TEXT CHECK(risk_level IN ('Stable','Fluctuating','High Risk')),
  key_signals TEXT,
  short_term_forecast TEXT,
  primary_risk_driver TEXT,
  intervention_strategy TEXT,
  action_plan_48h TEXT,
  study_advice TEXT,
  session_advice TEXT,
  rest_advice TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_entries_user_date ON daily_entries(user_id, session_date);
CREATE INDEX IF NOT EXISTS idx_reports_user ON analysis_reports(user_id, created_at);
