# 📡 StudySignal

AI-powered behavioral learning analytics tool that helps students monitor daily study habits and predict dropout risk using Gemini 2.0 Flash.

## Project Overview

- **Name**: StudySignal
- **Goal**: Detect early warning signs of student dropout through daily behavioral micro-signals
- **Tech Stack**: React + TypeScript + Recharts (frontend) | Hono + Cloudflare Workers (backend) | D1 SQLite (database) | Gemini 2.0 Flash (AI)

## Features

### ✅ Implemented
- **JWT Authentication** — Email + password register/login with 7-day tokens
- **Daily Micro-Signal Input** — Log study hours, focus level, distraction count/factors, emotional state, dropout feeling
- **AI Analysis Engine (v5)** — Gemini 2.0 Flash generates behavioral reports with:
  - `risk_level` — Stable / Fluctuating / High Risk (rule-based classification)
  - `key_signals` — 5 data-backed behavioral observations
  - `short_term_forecast` — 3–7 day trajectory prediction
  - `primary_risk_driver` — Root cause with numeric evidence
  - `intervention_strategy` — Personalized action recommendation
  - `action_plan_48h` — 5 time-stamped concrete steps
  - `monitoring_protocol` — Risk threshold + follow-up frequency
  - `raw_ai_response` — Raw Gemini text for audit/debug
  - **Rule-based fallback** — Full analysis when no Gemini API key is set (10 behavioral rules R1–R10)
- **Multi-Session Support** — Multiple study sessions per day (session_number + session_time)
- **3-Action Modal** — When sessions exist, modal shows list of today's sessions with 3 options:
  - **Add New Session** (green) — logs as Session N+1
  - **Update Latest Session** (amber) — replaces last session and regenerates report
  - **Keep All Sessions** (gray) — discards new input, no DB write
- **Historical Trends Chart** — 14-day line chart (Study Hours, Focus, Dropout Feeling)
- **Analysis History Page** — Expandable cards showing all past reports with monitoring protocol
- **Dark Theme UI** — Full dark mode with Inter font, responsive 2-column layout

### ❌ Not Yet Implemented
- Gemini API key configuration for production deployment (env var `GEMINI_API_KEY`)
- Cloudflare Pages production deployment
- Email notifications / alerts when risk escalates
- Multi-user admin dashboard
- Data export (CSV/PDF)

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/register` | No | Register new user |
| POST | `/api/auth/login` | No | Login + get JWT |
| POST | `/api/entries` | JWT | Save entry + trigger AI analysis |
| GET | `/api/entries?days=14` | JWT | Get recent entries (max 90) |
| GET | `/api/entries/today` | JWT | Get today's sessions list with next_session_number |
| GET | `/api/reports/latest` | JWT | Get latest analysis report |
| GET | `/api/reports/history` | JWT | Get last 14 reports |

### POST /api/entries — Request Body
```json
{
  "study_hours": 3.5,
  "focus_level": 3,
  "distraction_count": 4,
  "distracting_factors": "Mạng xã hội, YouTube",
  "goal_achieved": false,
  "emotional_state": "Stressed",
  "dropout_feeling": 3,
  "action": "add_new"
}
```

**`action` field behavior:**
| `action` | Sessions today? | Result |
|----------|----------------|--------|
| _(omitted)_ | None | Auto `add_new` → Session 1 |
| _(omitted)_ | ≥1 exist | **409 SESSION_EXISTS** → client shows modal |
| `"add_new"` | Any | Insert new session (N+1) + AI report |
| `"update"` | Any | Overwrite latest session + regenerate report |
| `"keep"` | Any | 200, no DB write, no AI call |

### POST /api/entries — Response (201)
```json
{
  "entry_id": 5,
  "session_number": 2,
  "session_time": "14:30",
  "action": "add_new",
  "was_updated": false,
  "analysis": {
    "risk_level": "Fluctuating",
    "key_signals": ["...", "..."],
    "short_term_forecast": "...",
    "primary_risk_driver": "...",
    "intervention_strategy": "...",
    "action_plan_48h": ["...", "..."],
    "monitoring_protocol": "Kiểm tra sau 48h..."
  }
}
```

### POST /api/entries — 409 SESSION_EXISTS
```json
{
  "error": "SESSION_EXISTS",
  "message": "1 session(s) already exist for 2026-04-04. Send action=...",
  "today_sessions": [
    { "id": 1, "session_number": 1, "session_time": "09:30",
      "study_hours": 3, "focus_level": 4, "dropout_feeling": 1 }
  ]
}
```

### GET /api/entries/today — Response
```json
{
  "date": "2026-04-04",
  "has_sessions": true,
  "next_session_number": 3,
  "sessions": [
    { "id": 1, "session_number": 1, "session_time": "09:30", "study_hours": 3, ... },
    { "id": 2, "session_number": 2, "session_time": "14:30", "study_hours": 2.5, ... }
  ]
}
```

## Data Architecture

### Database Schema (Cloudflare D1 — SQLite)

**users**: `id, email, password_hash, full_name, created_at`

**daily_entries** (migration 0004 — current schema):
`id, user_id, session_date, session_number (default 1), session_time (HH:MM), study_hours, focus_level, distraction_count, distracting_factors, goal_achieved, emotional_state, dropout_feeling, created_at`
UNIQUE constraint on `(user_id, session_date, session_number)`

**analysis_reports** (v3 schema — migration 0003):
`id, user_id, entry_id, report_date, risk_level, key_signals (JSON), short_term_forecast, primary_risk_driver, intervention_strategy, action_plan_48h (JSON), monitoring_protocol, raw_ai_response, created_at`

### Risk Classification Rules
- **Stable**: dropout_feeling ≤ 2 AND focus_level ≥ 3 AND goal_achieved = true
- **High Risk**: dropout_feeling ≥ 4 OR (focus_level ≤ 2 AND avg_focus ≤ 2.5) OR dropout rising ≥ 3 consecutive days
- **Fluctuating**: all other cases

## Migrations

| File | Description |
|------|-------------|
| `0001_initial_schema.sql` | users, daily_entries, analysis_reports (initial) |
| `0002_enhanced_reports.sql` | Added momentum_score, consistency_index, distraction_pattern, etc. |
| `0003_restructure_reports.sql` | Removed advice/score fields, added monitoring_protocol + raw_ai_response |
| `0004_add_session_columns.sql` | **Current schema** — added session_number, session_time, UNIQUE(user_id, session_date, session_number) |

## Local Development

```bash
# Install dependencies
npm install

# Apply DB migrations (local SQLite)
npx wrangler d1 migrations apply studysignal-production --local

# Build
npm run build

# Start with PM2 (port 3000)
pm2 start ecosystem.config.cjs

# Test
curl http://localhost:3000
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `JWT_SECRET` | Secret for JWT signing (set in `.dev.vars` or Cloudflare secret) |
| `GEMINI_API_KEY` | Google Gemini API key — if empty, uses rule-based fallback |

## Deployment

- **Platform**: Cloudflare Pages
- **Status**: ⚙️ Local development (PM2 sandbox)
- **Production deployment**: Pending `setup_cloudflare_api_key` + `wrangler pages deploy`
- **Last Updated**: 2026-04-04 (commit 5f3e68c — modal flow + multi-session)

## Recommended Next Steps

1. **Set up Cloudflare API key** → deploy to production via `wrangler pages deploy`
2. **Add GEMINI_API_KEY** → enable live AI analysis (currently uses rule-based fallback)
3. **Add JWT_SECRET** as Cloudflare secret for production security
4. **Implement alert system** → notify users when risk escalates to High Risk
5. **Add data export** → CSV download of entries and reports
