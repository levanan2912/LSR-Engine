import { Hono } from 'hono'
import { authMiddleware } from '../middleware/auth'

type Bindings = { DB: D1Database; JWT_SECRET: string }
type Variables = { userId: number; email: string }

const reports = new Hono<{ Bindings: Bindings; Variables: Variables }>()
reports.use('*', authMiddleware)

const parseJson = (v: unknown, fallback: unknown[] = []) => { try { return JSON.parse(v as string) } catch { return fallback } }

function parseRow(r: Record<string, unknown>) {
  return { ...r, key_signals: parseJson(r.key_signals), action_plan_48h: parseJson(r.action_plan_48h), raw_ai_response: r.raw_ai_response || null }
}

// GET /api/reports/latest
reports.get('/latest', async (c) => {
  try {
    const row = await c.env.DB.prepare(`
      SELECT r.*, e.study_hours, e.focus_level, e.distraction_count,
             e.distracting_factors, e.goal_achieved, e.emotional_state,
             e.dropout_feeling, e.session_date
      FROM analysis_reports r JOIN daily_entries e ON r.entry_id = e.id
      WHERE r.user_id = ? ORDER BY r.created_at DESC LIMIT 1
    `).bind(c.get('userId')).first()
    return c.json({ report: row ? parseRow(row as Record<string, unknown>) : null })
  } catch (err) {
    console.error('Get latest report error:', err)
    return c.json({ error: 'Failed to fetch report' }, 500)
  }
})

// GET /api/reports/pending
// Trả về entry mới nhất của user chưa có analysis_report (pending AI analysis).
// Frontend dùng để tự động retry phân tích khi user mở lại trang sau lỗi mạng.
reports.get('/pending', async (c) => {
  try {
    const row = await c.env.DB.prepare(`
      SELECT e.id, e.session_number, e.session_date, e.session_time
      FROM daily_entries e
      LEFT JOIN analysis_reports r ON r.entry_id = e.id
      WHERE e.user_id = ? AND r.id IS NULL
      ORDER BY e.created_at DESC
      LIMIT 1
    `).bind(c.get('userId')).first<{ id: number; session_number: number; session_date: string; session_time: string | null }>()
    return c.json({ pending_entry: row ?? null })
  } catch (err) {
    console.error('Get pending report error:', err)
    return c.json({ pending_entry: null })
  }
})

// GET /api/reports/history
reports.get('/history', async (c) => {
  try {
    const result = await c.env.DB.prepare(`
      SELECT r.*, e.study_hours, e.focus_level, e.distraction_count,
             e.distracting_factors, e.emotional_state, e.dropout_feeling, e.session_date
      FROM analysis_reports r JOIN daily_entries e ON r.entry_id = e.id
      WHERE r.user_id = ? ORDER BY r.created_at DESC LIMIT 14
    `).bind(c.get('userId')).all()
    return c.json({ reports: result.results.map(r => parseRow(r as Record<string, unknown>)) })
  } catch (err) {
    console.error('Get reports history error:', err)
    return c.json({ error: 'Failed to fetch reports' }, 500)
  }
})

export default reports
