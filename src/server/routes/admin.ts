import { Hono } from 'hono'
import { jwtVerify } from 'jose'
import { hash as bcryptHash } from 'bcryptjs'

type Bindings = { DB: D1Database; JWT_SECRET: string }
type Variables = { adminUser: { id: number; email: string; role: string } }

const admin = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// ── Admin Middleware ──────────────────────────────────────────────────────────
admin.use('*', async (c, next) => {
  try {
    const authHeader = c.req.header('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json({ success: false, message: 'Token xác thực không tồn tại' }, 401)
    }
    const token = authHeader.slice(7)
    const secret = new TextEncoder().encode(c.env.JWT_SECRET || 'studysignal-dev-secret-key-2024')
    const { payload } = await jwtVerify(token, secret)

    const user = await c.env.DB.prepare(
      'SELECT id, email, role, is_locked FROM users WHERE id = ?'
    ).bind(payload.userId as number).first<{ id: number; email: string; role: string | null; is_locked: number | null }>()

    if (!user || user.is_locked === 1 || !['rootadmin', 'subadmin'].includes(user.role || '')) {
      return c.json({ success: false, message: 'Bạn không có quyền truy cập khu vực quản trị' }, 403)
    }
    c.set('adminUser', { id: user.id, email: user.email, role: user.role! })
    await next()
  } catch {
    return c.json({ success: false, message: 'Token không hợp lệ hoặc đã hết hạn' }, 401)
  }
})

// ── Helper: date range defaults ───────────────────────────────────────────────
function dateRange(fromQ: string | undefined, toQ: string | undefined) {
  const to   = toQ   || new Date(Date.now() + 7 * 3600000).toISOString().split('T')[0]
  const from = fromQ || (() => { const d = new Date(to); d.setDate(d.getDate() - 29); return d.toISOString().split('T')[0] })()
  return { from, to }
}

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/admin/stats
// ═══════════════════════════════════════════════════════════════════════════════
admin.get('/stats', async (c) => {
  const { from, to } = dateRange(c.req.query('from'), c.req.query('to'))

  const [newUsers, activeUsers, highRiskUsers, riskDist, dailyUsers, dailySessions] = await Promise.all([
    // New regular users in range
    c.env.DB.prepare(
      `SELECT COUNT(*) as count FROM users WHERE role='user' AND DATE(created_at) BETWEEN ? AND ?`
    ).bind(from, to).first<{ count: number }>(),

    // Active users (have active entries) in range
    c.env.DB.prepare(
      `SELECT COUNT(DISTINCT user_id) as count FROM daily_entries WHERE DATE(session_date) BETWEEN ? AND ? AND is_active=1`
    ).bind(from, to).first<{ count: number }>(),

    // Users with at least 1 High Risk report in range
    c.env.DB.prepare(
      `SELECT COUNT(DISTINCT user_id) as count FROM analysis_reports WHERE risk_level='High Risk' AND DATE(report_date) BETWEEN ? AND ?`
    ).bind(from, to).first<{ count: number }>(),

    // Risk distribution
    c.env.DB.prepare(
      `SELECT risk_level, COUNT(*) as count FROM analysis_reports WHERE DATE(report_date) BETWEEN ? AND ? GROUP BY risk_level`
    ).bind(from, to).all<{ risk_level: string; count: number }>(),

    // Daily new users chart
    c.env.DB.prepare(
      `SELECT DATE(created_at) as date, COUNT(*) as count FROM users WHERE role='user' AND DATE(created_at) BETWEEN ? AND ? GROUP BY DATE(created_at) ORDER BY date`
    ).bind(from, to).all<{ date: string; count: number }>(),

    // Daily sessions chart
    c.env.DB.prepare(
      `SELECT session_date as date, COUNT(*) as count FROM daily_entries WHERE DATE(session_date) BETWEEN ? AND ? AND is_active=1 GROUP BY session_date ORDER BY session_date`
    ).bind(from, to).all<{ date: string; count: number }>(),
  ])

  // Total users
  const totalUsers = await c.env.DB.prepare(`SELECT COUNT(*) as count FROM users WHERE role='user'`).first<{ count: number }>()

  return c.json({
    from, to,
    total_users:       totalUsers?.count ?? 0,
    new_users_count:   newUsers?.count ?? 0,
    active_users_count: activeUsers?.count ?? 0,
    high_risk_count:   highRiskUsers?.count ?? 0,
    risk_distribution: riskDist.results,
    daily_new_users:   dailyUsers.results,
    daily_sessions:    dailySessions.results,
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/admin/users
// ═══════════════════════════════════════════════════════════════════════════════
admin.get('/users', async (c) => {
  const page   = Math.max(1, parseInt(c.req.query('page') || '1'))
  const limit  = Math.min(50, Math.max(1, parseInt(c.req.query('limit') || '20')))
  const offset = (page - 1) * limit
  const search = (c.req.query('search') || '').trim()
  const filter = c.req.query('filter') || 'all'   // all | locked | active

  const conditions: string[] = ["u.role = 'user'"]
  const params: (string | number)[] = []

  if (search) { conditions.push('(u.email LIKE ? OR u.full_name LIKE ?)'); params.push(`%${search}%`, `%${search}%`) }
  if (filter === 'locked')  { conditions.push('u.is_locked = 1') }
  if (filter === 'active')  { conditions.push('u.is_locked = 0') }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''

  const [rows, countRow] = await Promise.all([
    c.env.DB.prepare(`
      SELECT
        u.id, u.email, u.full_name, u.role, u.is_locked,
        u.locked_reason, u.locked_at, u.created_at,
        u.must_change_password, u.temp_password,
        COUNT(de.id) as sessions_count,
        MAX(de.session_date) as last_active
      FROM users u
      LEFT JOIN daily_entries de ON de.user_id = u.id AND de.is_active = 1
      ${where}
      GROUP BY u.id
      ORDER BY u.created_at DESC
      LIMIT ? OFFSET ?
    `).bind(...params, limit, offset).all<Record<string, unknown>>(),

    c.env.DB.prepare(`SELECT COUNT(*) as count FROM users u ${where}`)
      .bind(...params).first<{ count: number }>(),
  ])

  return c.json({
    users: rows.results,
    total: countRow?.count ?? 0,
    page, limit,
    total_pages: Math.ceil((countRow?.count ?? 0) / limit),
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/admin/users/:id/lock   (rootadmin only)
// POST /api/admin/users/:id/unlock (rootadmin only)
// ═══════════════════════════════════════════════════════════════════════════════
admin.post('/users/:id/lock', async (c) => {
  const adminUser = c.get('adminUser')
  if (adminUser.role !== 'rootadmin')
    return c.json({ success: false, message: 'Chỉ rootadmin mới có quyền này' }, 403)

  const userId = parseInt(c.req.param('id'))
  if (adminUser.id === userId)
    return c.json({ success: false, message: 'Không thể khóa chính mình' }, 400)

  const { reason } = await c.req.json().catch(() => ({ reason: '' }))

  const target = await c.env.DB.prepare('SELECT id, role FROM users WHERE id = ?').bind(userId).first<{ id: number; role: string }>()
  if (!target) return c.json({ success: false, message: 'Không tìm thấy người dùng' }, 404)
  if (['rootadmin', 'subadmin'].includes(target.role))
    return c.json({ success: false, message: 'Không thể khóa tài khoản admin' }, 400)

  await c.env.DB.prepare(
    `UPDATE users SET is_locked=1, locked_at=datetime('now'), locked_reason=? WHERE id=?`
  ).bind((reason || '').trim() || null, userId).run()

  return c.json({ success: true, message: 'Đã khóa tài khoản' })
})

admin.post('/users/:id/unlock', async (c) => {
  const adminUser = c.get('adminUser')
  if (adminUser.role !== 'rootadmin')
    return c.json({ success: false, message: 'Chỉ rootadmin mới có quyền này' }, 403)

  const userId = parseInt(c.req.param('id'))
  const target = await c.env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(userId).first()
  if (!target) return c.json({ success: false, message: 'Không tìm thấy người dùng' }, 404)

  await c.env.DB.prepare(
    `UPDATE users SET is_locked=0, locked_at=NULL, locked_reason=NULL WHERE id=?`
  ).bind(userId).run()

  return c.json({ success: true, message: 'Đã mở khóa tài khoản' })
})

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/admin/entries
// ═══════════════════════════════════════════════════════════════════════════════
admin.get('/entries', async (c) => {
  const page   = Math.max(1, parseInt(c.req.query('page') || '1'))
  const limit  = Math.min(50, Math.max(1, parseInt(c.req.query('limit') || '20')))
  const offset = (page - 1) * limit
  const search = (c.req.query('user_email') || '').trim()
  const filter = c.req.query('filter') || 'all'
  const { from, to } = dateRange(c.req.query('from'), c.req.query('to'))

  const conditions: string[] = ['DATE(e.session_date) BETWEEN ? AND ?']
  const params: (string | number)[] = [from, to]

  if (search) { conditions.push('u.email LIKE ?'); params.push(`%${search}%`) }
  if (filter === 'active')   conditions.push('e.is_active = 1')
  if (filter === 'inactive') conditions.push('e.is_active = 0')
  if (filter === 'no_report') conditions.push('r.id IS NULL AND e.is_active = 1')

  const where = 'WHERE ' + conditions.join(' AND ')

  const [rows, countRow] = await Promise.all([
    c.env.DB.prepare(`
      SELECT
        e.id, e.user_id, u.email as user_email, u.full_name,
        e.session_date, e.session_number, e.session_time,
        e.study_hours, e.focus_level, e.distraction_count,
        e.goal_achieved, e.dropout_feeling, e.is_active,
        e.deactivated_at, e.deactivated_by, e.deactivated_reason,
        e.created_at,
        CASE WHEN r.id IS NOT NULL THEN 1 ELSE 0 END as has_report,
        r.risk_level
      FROM daily_entries e
      JOIN users u ON u.id = e.user_id
      LEFT JOIN analysis_reports r ON r.entry_id = e.id
      ${where}
      ORDER BY e.session_date DESC, e.id DESC
      LIMIT ? OFFSET ?
    `).bind(...params, limit, offset).all<Record<string, unknown>>(),

    c.env.DB.prepare(`
      SELECT COUNT(*) as count
      FROM daily_entries e
      JOIN users u ON u.id = e.user_id
      LEFT JOIN analysis_reports r ON r.entry_id = e.id
      ${where}
    `).bind(...params).first<{ count: number }>(),
  ])

  return c.json({
    entries: rows.results,
    total: countRow?.count ?? 0,
    page, limit, from, to,
    total_pages: Math.ceil((countRow?.count ?? 0) / limit),
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/admin/entries/:id/deactivate
// POST /api/admin/entries/:id/reactivate
// ═══════════════════════════════════════════════════════════════════════════════
admin.post('/entries/:id/deactivate', async (c) => {
  const adminUser = c.get('adminUser')
  if (adminUser.role !== 'rootadmin')
    return c.json({ success: false, message: 'Chỉ rootadmin mới có quyền này' }, 403)

  const entryId = parseInt(c.req.param('id'))
  const { reason } = await c.req.json().catch(() => ({ reason: '' }))

  const entry = await c.env.DB.prepare('SELECT id, is_active FROM daily_entries WHERE id = ?').bind(entryId).first<{ id: number; is_active: number }>()
  if (!entry) return c.json({ success: false, message: 'Không tìm thấy phiên học' }, 404)
  if (!entry.is_active) return c.json({ success: false, message: 'Phiên học đã bị deactivate rồi' }, 400)

  await c.env.DB.prepare(
    `UPDATE daily_entries SET is_active=0, deactivated_at=datetime('now'), deactivated_by=?, deactivated_reason=? WHERE id=?`
  ).bind(adminUser.email, (reason || '').trim() || null, entryId).run()

  return c.json({ success: true, message: 'Đã deactivate phiên học' })
})

admin.post('/entries/:id/reactivate', async (c) => {
  const adminUser = c.get('adminUser')
  if (adminUser.role !== 'rootadmin')
    return c.json({ success: false, message: 'Chỉ rootadmin mới có quyền này' }, 403)

  const entryId = parseInt(c.req.param('id'))
  const entry = await c.env.DB.prepare('SELECT id, is_active FROM daily_entries WHERE id = ?').bind(entryId).first<{ id: number; is_active: number }>()
  if (!entry) return c.json({ success: false, message: 'Không tìm thấy phiên học' }, 404)
  if (entry.is_active) return c.json({ success: false, message: 'Phiên học đang hoạt động rồi' }, 400)

  await c.env.DB.prepare(
    `UPDATE daily_entries SET is_active=1, deactivated_at=NULL, deactivated_by=NULL, deactivated_reason=NULL WHERE id=?`
  ).bind(entryId).run()

  return c.json({ success: true, message: 'Đã reactivate phiên học' })
})

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/admin/reports
// ═══════════════════════════════════════════════════════════════════════════════
admin.get('/reports', async (c) => {
  const page      = Math.max(1, parseInt(c.req.query('page') || '1'))
  const limit     = Math.min(50, Math.max(1, parseInt(c.req.query('limit') || '20')))
  const offset    = (page - 1) * limit
  const riskLevel = c.req.query('risk_level') || ''
  const search    = (c.req.query('user_email') || '').trim()
  const { from, to } = dateRange(c.req.query('from'), c.req.query('to'))

  const conditions: string[] = ['DATE(r.report_date) BETWEEN ? AND ?']
  const params: (string | number)[] = [from, to]

  if (riskLevel) { conditions.push('r.risk_level = ?'); params.push(riskLevel) }
  if (search)    { conditions.push('u.email LIKE ?');   params.push(`%${search}%`) }

  const where = 'WHERE ' + conditions.join(' AND ')

  const [rows, countRow] = await Promise.all([
    c.env.DB.prepare(`
      SELECT
        r.id, r.entry_id, r.report_date, r.risk_level,
        r.primary_risk_driver, r.short_term_forecast,
        r.intervention_strategy, r.key_signals,
        r.action_plan_48h, r.monitoring_protocol,
        r.analyzed_by, r.key_name,
        r.created_at,
        u.id as user_id, u.email as user_email, u.full_name,
        e.session_number, e.study_hours, e.focus_level, e.dropout_feeling
      FROM analysis_reports r
      JOIN users u ON u.id = r.user_id
      JOIN daily_entries e ON e.id = r.entry_id
      ${where}
      ORDER BY r.report_date DESC, r.id DESC
      LIMIT ? OFFSET ?
    `).bind(...params, limit, offset).all<Record<string, unknown>>(),

    c.env.DB.prepare(`
      SELECT COUNT(*) as count
      FROM analysis_reports r
      JOIN users u ON u.id = r.user_id
      ${where}
    `).bind(...params).first<{ count: number }>(),
  ])

  return c.json({
    reports: rows.results,
    total: countRow?.count ?? 0,
    page, limit, from, to,
    total_pages: Math.ceil((countRow?.count ?? 0) / limit),
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/admin/user-timeline/:userId
// ═══════════════════════════════════════════════════════════════════════════════
admin.get('/user-timeline/:userId', async (c) => {
  const userId = parseInt(c.req.param('userId'))
  const { from, to } = dateRange(c.req.query('from'), c.req.query('to'))

  const [user, timeline] = await Promise.all([
    c.env.DB.prepare('SELECT id, email, full_name, role, is_locked, created_at FROM users WHERE id = ?')
      .bind(userId).first<Record<string, unknown>>(),
    c.env.DB.prepare(`
      SELECT
        e.id, e.session_date, e.session_number, e.study_hours,
        e.focus_level, e.dropout_feeling, e.is_active,
        r.risk_level, r.primary_risk_driver
      FROM daily_entries e
      LEFT JOIN analysis_reports r ON r.entry_id = e.id
      WHERE e.user_id = ? AND DATE(e.session_date) BETWEEN ? AND ?
      ORDER BY e.session_date ASC, e.session_number ASC
    `).bind(userId, from, to).all<Record<string, unknown>>(),
  ])

  if (!user) return c.json({ success: false, message: 'Không tìm thấy người dùng' }, 404)

  return c.json({ user, timeline: timeline.results, from, to })
})

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/admin/users/:id/history — full session history for one user
// Returns same format as /api/entries/history but for any user (admin view)
// ═══════════════════════════════════════════════════════════════════════════════
admin.get('/users/:id/history', async (c) => {
  const userId = parseInt(c.req.param('id'))
  const limit  = Math.min(200, Math.max(1, parseInt(c.req.query('limit') || '100')))

  const [user, rows] = await Promise.all([
    c.env.DB.prepare('SELECT id, email, full_name, role FROM users WHERE id = ?')
      .bind(userId).first<{ id: number; email: string; full_name: string; role: string }>(),
    c.env.DB.prepare(`
      SELECT
        e.id, e.session_date, e.session_number, e.session_time,
        e.study_hours, e.focus_level, e.distraction_count,
        e.goal_achieved, e.dropout_feeling, e.notes,
        e.distraction_factors, e.emotional_state,
        r.id as report_id, r.risk_level, r.primary_risk_driver,
        r.short_term_forecast, r.intervention_strategy,
        r.key_signals, r.action_plan_48h, r.monitoring_protocol,
        r.report_date
      FROM daily_entries e
      LEFT JOIN analysis_reports r ON r.entry_id = e.id
      WHERE e.user_id = ? AND e.is_active = 1
      ORDER BY e.session_date DESC, e.session_number DESC
      LIMIT ?
    `).bind(userId, limit).all<Record<string, unknown>>(),
  ])

  if (!user) return c.json({ success: false, message: 'Không tìm thấy người dùng' }, 404)

  // Group by date — same structure as /api/entries/history
  const grouped: Record<string, unknown[]> = {}
  for (const row of rows.results) {
    const date = String(row.session_date)
    if (!grouped[date]) grouped[date] = []
    grouped[date].push({
      ...row,
      report: row.report_id ? {
        risk_level: row.risk_level,
        primary_risk_driver: row.primary_risk_driver,
        short_term_forecast: row.short_term_forecast,
        intervention_strategy: row.intervention_strategy,
        key_signals: (() => { try { return JSON.parse(String(row.key_signals || '[]')) } catch { return [] } })(),
        action_plan_48h: (() => { try { return JSON.parse(String(row.action_plan_48h || '[]')) } catch { return [] } })(),
        monitoring_protocol: row.monitoring_protocol,
        report_date: row.report_date,
      } : null,
    })
  }

  return c.json({
    user,
    grouped_by_date: grouped,
    total_sessions: rows.results.length,
    total_days: Object.keys(grouped).length,
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/admin/users/:id/reset-password  (rootadmin only)
// Generates temp password "Study" + 6 random digits, hashes and saves it
// ═══════════════════════════════════════════════════════════════════════════════
admin.post('/users/:id/reset-password', async (c) => {
  const adminUser = c.get('adminUser')
  if (adminUser.role !== 'rootadmin')
    return c.json({ success: false, message: 'Chỉ rootadmin mới có quyền này' }, 403)

  const userId = parseInt(c.req.param('id'))
  const target = await c.env.DB.prepare(
    'SELECT id, email, full_name, role FROM users WHERE id = ?'
  ).bind(userId).first<{ id: number; email: string; full_name: string; role: string }>()

  if (!target) return c.json({ success: false, message: 'Không tìm thấy người dùng' }, 404)
  if (['rootadmin', 'subadmin'].includes(target.role))
    return c.json({ success: false, message: 'Không thể reset mật khẩu tài khoản admin' }, 400)

  // Generate temporary password: Study + 6 random digits
  const digits = Math.floor(100000 + Math.random() * 900000).toString()
  const tempPassword = `Study${digits}`

  // CF Workers CPU limit: use cost=6 (~5ms) instead of 12 (~400ms) to avoid timeout
  const newHash = await bcryptHash(tempPassword, 6)
  // Save temp_password in plain text so admin can see it until user changes it
  await c.env.DB.prepare('UPDATE users SET password_hash = ?, must_change_password = 1, temp_password = ? WHERE id = ?')
    .bind(newHash, tempPassword, userId).run()

  return c.json({
    success: true,
    message: 'Đã reset mật khẩu thành công',
    data: {
      email: target.email,
      full_name: target.full_name || target.email,
      temporary_password: tempPassword,
    },
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/admin/model-stats  — usage per model × key_name today (from DB)
// ═══════════════════════════════════════════════════════════════════════════════
admin.get('/model-stats', async (c) => {
  // GMT+7 today date
  const today = new Date(Date.now() + 7 * 3600 * 1000).toISOString().split('T')[0]

  const rows = await c.env.DB.prepare(`
    SELECT analyzed_by, key_name, COUNT(*) as cnt
    FROM analysis_reports
    WHERE DATE(report_date) = ?
      AND analyzed_by IS NOT NULL
      AND key_name IS NOT NULL
    GROUP BY analyzed_by, key_name
    ORDER BY analyzed_by, key_name
  `).bind(today).all<{ analyzed_by: string; key_name: string; cnt: number }>()

  // Build stats[model][keyName] = count
  const stats: Record<string, Record<string, number>> = {}
  for (const row of rows.results) {
    if (!stats[row.analyzed_by]) stats[row.analyzed_by] = {}
    stats[row.analyzed_by][row.key_name] = row.cnt
  }

  return c.json({ success: true, date: today, stats })
})

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/admin/model-config  — list all model configs (sorted by sort_order)
// ═══════════════════════════════════════════════════════════════════════════════
admin.get('/model-config', async (c) => {
  try {
    // Auto-seed defaults if table is empty (first time after migration)
    const count = await c.env.DB.prepare(
      'SELECT COUNT(*) as cnt FROM model_config'
    ).first<{ cnt: number }>()

    if (!count || count.cnt === 0) {
      // ⚠️ Thứ tự ưu tiên đúng theo RPD thực tế (Google AI Studio, 2026-04):
      //   1. gemini-3.1-flash-lite-preview → 500 RPD (ưu tiên cao nhất)
      //   2. gemini-2.0-flash-lite         → 200 RPD
      //   3. gemini-2.0-flash              → 200 RPD
      //   4. gemini-2.5-flash              → 20  RPD
      //   5. gemini-2.5-flash-lite         → 20  RPD (last resort)
      const defaults = [
        // timeout_ms=25000 phù hợp với Workers Paid Plan (overall timeout 55s)
        ['gemini-3.1-flash-lite-preview', 'Gemini 3.1 Flash Lite', 1, 1, 25000, 500],
        ['gemini-2.0-flash-lite',         'Gemini 2.0 Flash Lite', 2, 1, 25000, 200],
        ['gemini-2.0-flash',              'Gemini 2.0 Flash',      3, 1, 25000, 200],
        ['gemini-2.5-flash',              'Gemini 2.5 Flash',      4, 1, 25000,  20],
        ['gemini-2.5-flash-lite',         'Gemini 2.5 Flash Lite', 5, 1, 25000,  20],
      ]
      for (const [name, label, order, enabled, timeout, limit] of defaults) {
        await c.env.DB.prepare(`
          INSERT OR IGNORE INTO model_config (model_name, display_name, sort_order, enabled, timeout_ms, daily_limit)
          VALUES (?, ?, ?, ?, ?, ?)
        `).bind(name, label, order, enabled, timeout, limit).run()
      }
    }

    const rows = await c.env.DB.prepare(
      'SELECT * FROM model_config ORDER BY sort_order ASC, id ASC'
    ).all()
    return c.json({ success: true, models: rows.results })
  } catch (err) {
    console.error('GET /model-config error:', err)
    return c.json({ success: false, message: 'Lỗi đọc cấu hình model' }, 500)
  }
})

// ═══════════════════════════════════════════════════════════════════════════════
// PUT /api/admin/model-config  — update full list (rootadmin only)
// Body: { models: Array<{ id, sort_order, enabled, timeout_ms, notes }> }
// ═══════════════════════════════════════════════════════════════════════════════
admin.put('/model-config', async (c) => {
  const adminUser = c.get('adminUser')
  if (adminUser.role !== 'rootadmin') {
    return c.json({ success: false, message: 'Chỉ rootadmin mới có thể thay đổi cấu hình model' }, 403)
  }

  try {
    const body = await c.req.json() as {
      models: Array<{
        id:         number
        sort_order: number
        enabled:    number | boolean
        timeout_ms: number
        notes?:     string
      }>
    }

    if (!Array.isArray(body.models) || body.models.length === 0) {
      return c.json({ success: false, message: 'Dữ liệu không hợp lệ' }, 422)
    }

    // Validate each entry
    for (const m of body.models) {
      if (typeof m.id !== 'number') return c.json({ success: false, message: `id không hợp lệ: ${m.id}` }, 422)
      const order = Number(m.sort_order)
      if (!Number.isInteger(order) || order < 1 || order > 99)
        return c.json({ success: false, message: `sort_order phải từ 1–99 (model id ${m.id})` }, 422)
      const timeout = Number(m.timeout_ms)
      if (!Number.isInteger(timeout) || timeout < 5000 || timeout > 60000)
        return c.json({ success: false, message: `timeout_ms phải từ 5000–60000ms (model id ${m.id})` }, 422)
    }

    const now = new Date(Date.now() + 7 * 3600000).toISOString()

    for (const m of body.models) {
      const enabledVal = m.enabled === true || m.enabled === 1 ? 1 : 0
      await c.env.DB.prepare(`
        UPDATE model_config
        SET sort_order  = ?,
            enabled     = ?,
            timeout_ms  = ?,
            notes       = ?,
            updated_at  = ?,
            updated_by  = ?
        WHERE id = ?
      `).bind(
        Number(m.sort_order),
        enabledVal,
        Number(m.timeout_ms),
        m.notes ?? null,
        now,
        adminUser.email,
        m.id,
      ).run()
    }

    console.log(`✅ model_config updated by ${adminUser.email} — ${body.models.length} rows`)

    // Return updated list
    const rows = await c.env.DB.prepare(
      'SELECT * FROM model_config ORDER BY sort_order ASC, id ASC'
    ).all()
    return c.json({ success: true, models: rows.results })
  } catch (err) {
    console.error('PUT /model-config error:', err)
    return c.json({ success: false, message: err instanceof Error ? err.message : 'Lỗi server' }, 500)
  }
})

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/admin/me  — verify admin token & return role
// ═══════════════════════════════════════════════════════════════════════════════
admin.get('/me', async (c) => {
  return c.json({ success: true, admin: c.get('adminUser') })
})

export default admin
