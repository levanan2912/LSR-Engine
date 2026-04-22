import { Hono } from 'hono'
import { authMiddleware } from '../middleware/auth'
import { analyzeStudyBehavior } from '../services/gemini'

type Bindings = {
  DB: D1Database
  GEMINI_API_KEY: string   // single key (backward-compat)
  GEMINI_API_KEYS: string  // comma-separated pool (optional, takes priority)
  JWT_SECRET: string
}

type Variables = {
  userId: number
  email: string
}

const entries = new Hono<{ Bindings: Bindings; Variables: Variables }>()

entries.use('*', authMiddleware)

// ─── Validation helpers ────────────────────────────────────────────────────────

interface ValidationError {
  field: string
  message: string
}

function validateEntry(body: Record<string, unknown>): ValidationError[] {
  const errors: ValidationError[] = []
  const push = (field: string, message: string) => errors.push({ field, message })

  const hours   = Number(body.study_hours)
  const focus   = Number(body.focus_level)
  const dropout = Number(body.dropout_feeling)

  if (body.study_hours == null || body.study_hours === '')   push('study_hours',    'Số giờ học là bắt buộc')
  else if (isNaN(hours) || hours <= 0)                       push('study_hours',    'Số giờ học phải lớn hơn 0')
  else if (hours > 24)                                       push('study_hours',    'Số giờ học không vượt quá 24')

  if (body.focus_level == null)                              push('focus_level',    'Mức tập trung là bắt buộc')
  else if (!Number.isInteger(focus) || focus < 1 || focus > 5) push('focus_level', 'Mức tập trung phải từ 1-5')

  if (body.dropout_feeling == null)                          push('dropout_feeling',  'Mức bỏ cuộc là bắt buộc')
  else if (!Number.isInteger(dropout) || dropout < 1 || dropout > 5) push('dropout_feeling', 'Mức bỏ cuộc phải từ 1-5')

  if (body.distraction_count != null && body.distraction_count !== '') {
    const dc = Number(body.distraction_count)
    if (isNaN(dc) || !Number.isInteger(dc) || dc < 0) push('distraction_count', 'Số lần phải là số nguyên không âm')
    else if (dc > 9999)                                push('distraction_count', 'Quá cao (tối đa 9999)')
  }

  if (body.session_number != null && body.session_number !== '') {
    const sn = Number(body.session_number)
    if (isNaN(sn) || !Number.isInteger(sn) || sn < 1) push('session_number', 'Số phiên phải là số nguyên dương')
    else if (sn > 99)                                  push('session_number', 'Số phiên quá cao (tối đa 99)')
  }

  if (body.session_time != null && body.session_time !== '') {
    const t = String(body.session_time)
    if (!/^\d{2}:\d{2}$/.test(t)) push('session_time', 'Định dạng giờ phải là HH:MM')
    else { const [hh, mm] = t.split(':').map(Number); if (hh > 23 || mm > 59) push('session_time', 'Giờ không hợp lệ') }
  }

  if (body.distracting_factors && String(body.distracting_factors).length > 500) push('distracting_factors', 'Quá dài (tối đa 500 ký tự)')
  if (body.emotional_state     && String(body.emotional_state).length     > 200) push('emotional_state',     'Quá dài (tối đa 200 ký tự)')

  return errors
}

// ─── POST /api/entries ────────────────────────────────────────────────────────
// action: "add_new" | "update" | "keep"
//   add_new — insert a brand-new session (auto session_number = today_count + 1)
//   update  — overwrite the last session of today
//   keep    — do nothing, return early (no DB write, no AI call)
//   omitted — treated as add_new when no sessions exist today,
//             returns 409 with today's sessions when sessions already exist

entries.post('/', async (c) => {
  try {
    const userId = c.get('userId')
    const body = await c.req.json()

    // ── Validate form data fields ─────────────────────────────────────────────
    const validationErrors = validateEntry(body)
    if (validationErrors.length > 0) {
      return c.json({ error: 'Validation failed', validation_errors: validationErrors }, 422)
    }

    const {
      action,               // "add_new" | "update" | "keep" | undefined
      study_hours,
      focus_level,
      distraction_count,
      distracting_factors,
      goal_achieved,
      emotional_state,
      dropout_feeling,
      session_date,
    } = body

    // ── Validate action value ─────────────────────────────────────────────────
    const VALID_ACTIONS = new Set(['add_new', 'update', 'keep', undefined, null, ''])
    if (!VALID_ACTIONS.has(action)) {
      return c.json({
        error: 'Validation failed',
        validation_errors: [{ field: 'action', message: 'action must be "add_new", "update", or "keep"' }],
      }, 422)
    }

    // ── GMT+7 helper ──────────────────────────────────────────────────────────
    const nowUtc = new Date()
    const gmt7Offset = 7 * 60 * 60 * 1000
    const nowGmt7 = new Date(nowUtc.getTime() + gmt7Offset)
    const gmt7Date = nowGmt7.toISOString().split('T')[0]           // "YYYY-MM-DD"
    const gmt7HH   = String(nowGmt7.getUTCHours()).padStart(2, '0')
    const gmt7MM   = String(nowGmt7.getUTCMinutes()).padStart(2, '0')

    const date = session_date || gmt7Date

    // ── Current time "HH:MM" (GMT+7) ─────────────────────────────────────────
    const currentTime = `${gmt7HH}:${gmt7MM}`

    // ── Fetch all today's sessions for this user ──────────────────────────────
    const todaySessions = await c.env.DB.prepare(`
      SELECT id, session_number, study_hours, focus_level, dropout_feeling, session_time, created_at
      FROM daily_entries
      WHERE user_id = ? AND session_date = ?
      ORDER BY session_number ASC
    `).bind(userId, date).all<{
      id: number
      session_number: number
      study_hours: number
      focus_level: number
      dropout_feeling: number
      session_time: string | null
      created_at: string
    }>()

    const sessions = todaySessions.results

    console.log(`📊 Found ${sessions.length} existing sessions today for user ${userId}`)

    // ── "keep" — return immediately, no DB write ──────────────────────────────
    if (action === 'keep') {
      return c.json({
        success: true,
        message: 'Đã giữ nguyên các phiên học hiện tại',
        today_sessions: sessions.map(s => ({
          id: s.id,
          session_number: s.session_number,
          session_time: s.session_time,
        })),
      }, 200)
    }

    // ── No action supplied + sessions exist → ask client what to do ──────────
    if (!action && sessions.length > 0) {
      console.log('⚠️ Sessions exist, requiring user action')
      return c.json({
        error: 'SESSION_EXISTS',
        requires_action: true,
        message: `Đã có ${sessions.length} phiên học hôm nay. Vui lòng chọn hành động.`,
        today_sessions: sessions.map(s => ({
          id: s.id,
          session_number: s.session_number,
          session_time: s.session_time,
          study_hours: s.study_hours,
          focus_level: s.focus_level,
          dropout_feeling: s.dropout_feeling,
          created_at: s.created_at,
        })),
        next_session_number: sessions.length + 1,
      }, 409)
    }

    // ── Coerce form data ──────────────────────────────────────────────────────
    const typedForm = {
      study_hours:         parseFloat(String(study_hours)),
      focus_level:         parseInt(String(focus_level), 10),
      distraction_count:   parseInt(String(distraction_count || 0), 10),
      distracting_factors: distracting_factors ? String(distracting_factors) : null,
      goal_achieved:       goal_achieved === true || goal_achieved === 'true' || goal_achieved === 1,
      emotional_state:     emotional_state ? String(emotional_state) : null,
      dropout_feeling:     parseInt(String(dropout_feeling), 10),
    }

    let entryId: number
    let savedSessionNumber: number
    let wasUpdated = false

    if (action === 'update' && sessions.length > 0) {
      // ── UPDATE last session of today ────────────────────────────────────────
      const lastSession = sessions[sessions.length - 1]
      console.log(`📝 Updating session ${lastSession.session_number}`)

      await c.env.DB.prepare(`
        UPDATE daily_entries SET
          study_hours = ?, focus_level = ?, distraction_count = ?,
          distracting_factors = ?, goal_achieved = ?, emotional_state = ?,
          dropout_feeling = ?, session_time = ?
        WHERE id = ? AND user_id = ?
      `).bind(
        typedForm.study_hours, typedForm.focus_level, typedForm.distraction_count,
        typedForm.distracting_factors, typedForm.goal_achieved ? 1 : 0,
        typedForm.emotional_state, typedForm.dropout_feeling,
        currentTime,
        lastSession.id, userId,
      ).run()

      entryId = lastSession.id
      savedSessionNumber = lastSession.session_number
      wasUpdated = true

      // Delete old report so we re-generate a fresh one
      await c.env.DB.prepare(
        'DELETE FROM analysis_reports WHERE entry_id = ?'
      ).bind(entryId).run()

    } else {
      // ── INSERT new session (action === "add_new" OR no sessions yet) ────────
      const nextSessionNumber = sessions.length + 1
      if (sessions.length === 0) {
        console.log('🆕 Creating first session of the day')
      } else {
        console.log(`➕ Adding new session ${nextSessionNumber}`)
      }

      const result = await c.env.DB.prepare(`
        INSERT INTO daily_entries
          (user_id, session_date, session_number, session_time,
           study_hours, focus_level, distraction_count,
           distracting_factors, goal_achieved, emotional_state, dropout_feeling)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        userId, date,
        nextSessionNumber, currentTime,
        typedForm.study_hours, typedForm.focus_level, typedForm.distraction_count,
        typedForm.distracting_factors, typedForm.goal_achieved ? 1 : 0,
        typedForm.emotional_state, typedForm.dropout_feeling,
      ).run()

      entryId = result.meta.last_row_id as number
      savedSessionNumber = nextSessionNumber
      wasUpdated = false
    }

    // ── Lấy lịch sử để làm context cho AI (tối đa 5 phiên, không lấy entry hiện tại) ──
    const previousSessions = await c.env.DB.prepare(`
      SELECT session_date, session_number, study_hours, focus_level,
             distraction_count, distracting_factors, goal_achieved,
             emotional_state, dropout_feeling
      FROM daily_entries
      WHERE user_id = ? AND id != ?
      ORDER BY session_date DESC, session_number DESC
      LIMIT 5
    `).bind(userId, entryId).all()

    const todayEntry = {
      study_hours:         typedForm.study_hours,
      focus_level:         typedForm.focus_level,
      distraction_count:   typedForm.distraction_count,
      distracting_factors: typedForm.distracting_factors ?? undefined,
      goal_achieved:       typedForm.goal_achieved,
      emotional_state:     typedForm.emotional_state ?? undefined,
      dropout_feeling:     typedForm.dropout_feeling,
      session_date:        date,
      session_number:      savedSessionNumber,
      session_time:        currentTime,
    }

    // ── Gọi Gemini AI ─────────────────────────────────────────────────────────
    // Chính sách: lưu phiên học TRƯỚC, gọi AI NGAY SAU.
    // Nếu AI fail → trả về lỗi rõ ràng (không có pending/retry).
    let analysis: Awaited<ReturnType<typeof analyzeStudyBehavior>> | null = null
    let aiError: string | null = null

    try {
      console.log(`🤖 Gọi AI cho entry ${entryId} (session ${savedSessionNumber})...`)
      analysis = await analyzeStudyBehavior(
        todayEntry,
        previousSessions.results as Record<string, unknown>[],
        c.env.GEMINI_API_KEYS || c.env.GEMINI_API_KEY || '',
        c.env.GEMINI_API_KEY || '',
        c.env.DB,
      )
    } catch (analysisErr: unknown) {
      const msg = analysisErr instanceof Error ? analysisErr.message : String(analysisErr)
      console.error(`[StudySignal] AI thất bại cho entry ${entryId}:`, msg)
      aiError = msg
    }

    // ── Log analysis result để debug undefined fields ─────────────────────────
    if (analysis) {
      const undefinedFields = Object.entries(analysis)
        .filter(([, v]) => v === undefined)
        .map(([k]) => k)
      if (undefinedFields.length > 0) {
        console.warn(`⚠️ analysis có fields undefined: ${undefinedFields.join(', ')} — sẽ dùng default`)
      }
    }

    // ── AI thành công: lưu kết quả vào DB ────────────────────────────────────
    if (analysis) {
      await c.env.DB.prepare(`
        INSERT OR REPLACE INTO analysis_reports
          (user_id, entry_id, report_date, risk_level, key_signals, short_term_forecast,
           primary_risk_driver, intervention_strategy, action_plan_48h,
           monitoring_protocol, raw_ai_response, analyzed_by, key_name)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        userId, entryId, date,
        analysis.risk_level,
        JSON.stringify(analysis.key_signals ?? []),
        analysis.short_term_forecast ?? '',
        analysis.primary_risk_driver ?? '',
        analysis.intervention_strategy ?? '',
        JSON.stringify(analysis.action_plan_48h ?? []),
        analysis.monitoring_protocol ?? '',   // deprecated field — default '' để tránh undefined
        analysis.raw_ai_response ?? '',
        analysis.analyzed_by ?? null,
        analysis.key_name ?? null,
      ).run()

      console.log(`✅ Saved session ${savedSessionNumber} + AI report via ${analysis.analyzed_by}`)

      return c.json({
        success:        true,
        entry_id:       entryId,
        session_number: savedSessionNumber,
        session_time:   currentTime,
        action:         wasUpdated ? 'update' : 'add_new',
        was_updated:    wasUpdated,
        analysis,
        message: `Đã lưu phiên ${savedSessionNumber} và phân tích AI thành công.`,
      }, 201)
    }

    // ── AI thất bại: phiên đã lưu nhưng không có kết quả AI ─────────────────
    console.log(`⚠️ Session ${savedSessionNumber} (entry ${entryId}) saved — AI thất bại`)

    return c.json({
      success:        false,
      entry_id:       entryId,
      session_number: savedSessionNumber,
      session_time:   currentTime,
      action:         wasUpdated ? 'update' : 'add_new',
      was_updated:    wasUpdated,
      analysis:       null,
      error:          'ai_failed',
      message:        `Đã lưu phiên ${savedSessionNumber} nhưng phân tích AI thất bại. Vui lòng thử lại sau.`,
      ai_error:       aiError,
    }, 207)

  } catch (err: unknown) {
    console.error('❌ POST /api/entries error:', err)
    return c.json({
      error: 'Lỗi server',
      message: err instanceof Error ? err.message : 'Failed to save entry',
    }, 500)
  }
})

// ─── POST /api/entries/:id/analysis — Retry AI cho phiên chưa có report ──────
// Dùng khi AI thất bại lúc POST /api/entries, user có thể retry sau mà không cần tạo phiên mới.

entries.post('/:id/analysis', async (c) => {
  const userId  = c.get('userId')
  const entryId = parseInt(c.req.param('id'))
  if (isNaN(entryId)) return c.json({ error: 'Invalid entry ID' }, 400)

  try {
    // Xác minh entry thuộc về user này
    const entry = await c.env.DB.prepare(
      'SELECT * FROM daily_entries WHERE id = ? AND user_id = ?'
    ).bind(entryId, userId).first<Record<string, unknown>>()

    if (!entry) return c.json({ error: 'Phiên học không tồn tại' }, 404)

    // Kiểm tra đã có report chưa — nếu rồi thì không cần retry
    const existing = await c.env.DB.prepare(
      'SELECT id FROM analysis_reports WHERE entry_id = ? AND user_id = ?'
    ).bind(entryId, userId).first()
    if (existing) return c.json({ success: true, message: 'Đã có báo cáo AI, không cần retry', already_exists: true })

    // Lấy lịch sử (tối đa 5 phiên trước entry này)
    const previousSessions = await c.env.DB.prepare(`
      SELECT session_date, session_number, study_hours, focus_level,
             distraction_count, distracting_factors, goal_achieved,
             emotional_state, dropout_feeling
      FROM daily_entries
      WHERE user_id = ? AND id != ? AND id < ?
      ORDER BY session_date DESC, session_number DESC
      LIMIT 5
    `).bind(userId, entryId, entryId).all()

    const todayEntry = {
      study_hours:         Number(entry.study_hours),
      focus_level:         Number(entry.focus_level),
      distraction_count:   Number(entry.distraction_count),
      distracting_factors: entry.distracting_factors as string | undefined,
      goal_achieved:       Boolean(entry.goal_achieved),
      emotional_state:     entry.emotional_state as string | undefined,
      dropout_feeling:     Number(entry.dropout_feeling),
      session_date:        entry.session_date as string,
      session_number:      Number(entry.session_number),
      session_time:        entry.session_time as string | undefined,
    }

    const analysis = await analyzeStudyBehavior(
      todayEntry,
      previousSessions.results as Record<string, unknown>[],
      c.env.GEMINI_API_KEYS || c.env.GEMINI_API_KEY || '',
      c.env.GEMINI_API_KEY || '',
      c.env.DB,
    )

    // Lưu report
    await c.env.DB.prepare(`
      INSERT OR REPLACE INTO analysis_reports
        (user_id, entry_id, report_date, risk_level, key_signals, short_term_forecast,
         primary_risk_driver, intervention_strategy, action_plan_48h,
         monitoring_protocol, raw_ai_response, analyzed_by, key_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      userId, entryId, entry.session_date,
      analysis.risk_level,
      JSON.stringify(analysis.key_signals ?? []),
      analysis.short_term_forecast ?? '',
      analysis.primary_risk_driver ?? '',
      analysis.intervention_strategy ?? '',
      JSON.stringify(analysis.action_plan_48h ?? []),
      analysis.monitoring_protocol ?? '',   // deprecated field — default '' để tránh undefined
      analysis.raw_ai_response ?? '',
      analysis.analyzed_by ?? null,
      analysis.key_name ?? null,
    ).run()

    console.log(`[StudySignal] Retry AI OK — entry ${entryId}, model=${analysis.analyzed_by}, key=${analysis.key_name}`)
    return c.json({ success: true, analysis, latency: analysis.latency })

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[StudySignal] Retry AI thất bại entry ${entryId}:`, msg)
    return c.json({ success: false, error: 'ai_failed', message: msg }, 207)
  }
})

// ─── GET /api/entries/pending (DISABLED) ─────────────────────────────────────
// Tính năng pending đã bị xóa theo yêu cầu.

entries.get('/pending', async (c) => {
  return c.json({ pending: null })
})

// ─── GET /api/entries ─────────────────────────────────────────────────────────
// ?days=14  — kept for backward compat (ignored; limit param drives row count)
// ?limit=20 — max sessions to return, ordered oldest→newest for chart rendering
// Response: { entries: SessionRow[] }  — ASC so chart timeline is left=old right=new

entries.get('/', async (c) => {
  try {
    const userId = c.get('userId')
    // Accept both ?days= (legacy) and ?limit= (new); cap at 90
    const rawLimit = c.req.query('limit') || c.req.query('days') || '20'
    const limit    = Math.min(parseInt(rawLimit), 90)

    // Step 1: get the N most-recent sessions (DESC) so we always get the latest N
    // Step 2: wrap in a subquery and re-sort ASC for the chart (oldest left → newest right)
    const result = await c.env.DB.prepare(`
      SELECT * FROM (
        SELECT * FROM daily_entries
        WHERE user_id = ?
        ORDER BY session_date DESC, session_number DESC
        LIMIT ?
      ) ORDER BY session_date ASC, session_number ASC
    `).bind(userId, limit).all()

    return c.json({ entries: result.results })
  } catch (err: unknown) {
    console.error('Get entries error:', err)
    return c.json({ error: 'Failed to fetch entries' }, 500)
  }
})

// ─── GET /api/entries/today ───────────────────────────────────────────────────
// Returns all sessions recorded today, ordered by session_number ASC.
// Response shape:
//   { date, sessions: [...], next_session_number, has_sessions }

entries.get('/today', async (c) => {
  try {
    const userId = c.get('userId')
    const today = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().split('T')[0]

    const result = await c.env.DB.prepare(`
      SELECT id, session_number, session_time,
             study_hours, focus_level, distraction_count,
             distracting_factors, goal_achieved, emotional_state,
             dropout_feeling, created_at
      FROM daily_entries
      WHERE user_id = ? AND session_date = ?
      ORDER BY session_number ASC
    `).bind(userId, today).all<{
      id: number
      session_number: number
      session_time: string | null
      study_hours: number
      focus_level: number
      distraction_count: number
      distracting_factors: string | null
      goal_achieved: number
      emotional_state: string | null
      dropout_feeling: number
      created_at: string
    }>()

    const sessions = result.results

    return c.json({
      date:                today,
      sessions,
      next_session_number: sessions.length + 1,
      has_sessions:        sessions.length > 0,
    })
  } catch (err: unknown) {
    console.error('Get today entry error:', err)
    return c.json({ error: 'Failed to fetch today entry' }, 500)
  }
})

// ─── GET /api/entries/history ─────────────────────────────────────────────────
// Returns every session for this user (up to `limit`, default 60) plus a
// grouped_by_date map keyed by YYYY-MM-DD, each value being an array of
// sessions with their linked analysis report (if any).
//
// Response shape:
// {
//   sessions: SessionWithReport[],            // flat list newest → oldest
//   grouped_by_date: {                        // map date → sessions[]
//     "2026-04-04": [ SessionWithReport, … ],
//     "2026-04-03": [ … ],
//   },
//   total_sessions: number,
//   total_days:     number,
// }

entries.get('/history', async (c) => {
  try {
    const userId = c.get('userId')
    const limit  = Math.min(parseInt(c.req.query('limit') || '60'), 200)

    // ── Single query: sessions LEFT JOINed with their latest report ────────
    const result = await c.env.DB.prepare(`
      SELECT
        e.id,
        e.session_date,
        e.session_number,
        e.session_time,
        e.study_hours,
        e.focus_level,
        e.distraction_count,
        e.distracting_factors,
        e.goal_achieved,
        e.emotional_state,
        e.dropout_feeling,
        e.created_at,

        r.id              AS report_id,
        r.risk_level,
        r.key_signals,
        r.short_term_forecast,
        r.primary_risk_driver,
        r.intervention_strategy,
        r.action_plan_48h,
        r.monitoring_protocol,
        r.raw_ai_response,
        r.created_at      AS report_created_at

      FROM daily_entries e
      LEFT JOIN analysis_reports r ON r.entry_id = e.id
      WHERE e.user_id = ?
      ORDER BY e.session_date DESC, e.session_number DESC
      LIMIT ?
    `).bind(userId, limit).all<Record<string, unknown>>()

    // ── Parse + shape each row ─────────────────────────────────────────────
    type SessionWithReport = {
      id: number
      session_date: string
      session_number: number
      session_time: string | null
      study_hours: number
      focus_level: number
      distraction_count: number
      distracting_factors: string | null
      goal_achieved: number
      emotional_state: string | null
      dropout_feeling: number
      created_at: string
      report: {
        id: number
        risk_level: string
        key_signals: string[]
        short_term_forecast: string
        primary_risk_driver: string
        intervention_strategy: string
        action_plan_48h: string[]
        monitoring_protocol: string
        raw_ai_response: string | null
        created_at: string
      } | null
    }

    const sessions: SessionWithReport[] = result.results.map(row => {
      const parseArr = (v: unknown): string[] => {
        if (Array.isArray(v)) return v as string[]
        try { return JSON.parse(v as string) } catch { return [] }
      }

      return {
        id:                  row.id as number,
        session_date:        row.session_date as string,
        session_number:      row.session_number as number,
        session_time:        row.session_time as string | null,
        study_hours:         row.study_hours as number,
        focus_level:         row.focus_level as number,
        distraction_count:   row.distraction_count as number,
        distracting_factors: row.distracting_factors as string | null,
        goal_achieved:       row.goal_achieved as number,
        emotional_state:     row.emotional_state as string | null,
        dropout_feeling:     row.dropout_feeling as number,
        created_at:          row.created_at as string,

        report: row.report_id == null ? null : {
          id:                    row.report_id as number,
          risk_level:            (row.risk_level || 'Stable') as string,
          key_signals:           parseArr(row.key_signals),
          short_term_forecast:   (row.short_term_forecast  || '') as string,
          primary_risk_driver:   (row.primary_risk_driver  || '') as string,
          intervention_strategy: (row.intervention_strategy || '') as string,
          action_plan_48h:       parseArr(row.action_plan_48h),
          monitoring_protocol:   (row.monitoring_protocol  || '') as string,
          raw_ai_response:       row.raw_ai_response as string | null,
          created_at:            row.report_created_at as string,
        },
      }
    })

    // ── Build grouped_by_date (preserves DESC date order via insertion order) ─
    const grouped_by_date: Record<string, SessionWithReport[]> = {}
    for (const s of sessions) {
      if (!grouped_by_date[s.session_date]) grouped_by_date[s.session_date] = []
      grouped_by_date[s.session_date].push(s)
    }
    // Within each day, re-sort sessions by session_number DESC (newest first)
    for (const date of Object.keys(grouped_by_date)) {
      grouped_by_date[date].sort((a, b) => b.session_number - a.session_number)
    }

    return c.json({
      sessions,
      grouped_by_date,
      total_sessions: sessions.length,
      total_days:     Object.keys(grouped_by_date).length,
    })
  } catch (err: unknown) {
    console.error('Get history error:', err)
    return c.json({ error: 'Failed to fetch history' }, 500)
  }
})

export default entries
