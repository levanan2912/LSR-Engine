import { Hono } from 'hono'
import { authMiddleware } from '../middleware/auth'
import { parseApiKeys } from '../services/gemini'

type Bindings = {
  DB: D1Database
  GEMINI_API_KEY: string
  GEMINI_API_KEYS: string
  JWT_SECRET: string
}

type Variables = {
  userId: number
  email: string
}

const forum = new Hono<{ Bindings: Bindings; Variables: Variables }>()

forum.use('*', authMiddleware)

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sanitize(text: string, max: number): string {
  return text.trim().slice(0, max)
}

const FORUM_MODELS = [
  { name: 'gemini-2.5-flash-lite',         maxOutputTokens: 1024 },
  { name: 'gemini-3.1-flash-lite-preview', maxOutputTokens: 1024 },
  { name: 'gemini-2.5-flash',              maxOutputTokens: 1024 },
]

// ─── AI DRAFT ─────────────────────────────────────────────────────────────────

// POST /api/forum/ai-draft
// Gemini đọc dữ liệu học tập của user → viết bài thảo luận thay cho user
forum.post('/ai-draft', async (c) => {
  const userId = c.get('userId')
  const { DB } = c.env

  try {
    // Lấy tối đa 10 phiên gần nhất + báo cáo AI
    const rows = await DB.prepare(`
      SELECT
        e.session_date, e.session_number, e.session_time,
        e.study_hours, e.focus_level, e.distraction_count,
        e.distracting_factors, e.goal_achieved, e.dropout_feeling,
        e.emotional_state,
        r.risk_level, r.key_signals, r.short_term_forecast,
        r.primary_risk_driver, r.intervention_strategy, r.action_plan_48h
      FROM daily_entries e
      LEFT JOIN analysis_reports r ON r.entry_id = e.id
      WHERE e.user_id = ?
      ORDER BY e.session_date DESC, e.session_number DESC
      LIMIT 10
    `).bind(userId).all<Record<string, unknown>>()

    if (rows.results.length === 0) {
      return c.json({
        error: 'no_data',
        message: 'Bạn chưa có dữ liệu học tập nào. Hãy ghi lại ít nhất một phiên học trước khi dùng tính năng này.',
      }, 422)
    }

    // Lấy thông tin user
    const userRow = await DB.prepare(`SELECT full_name, email FROM users WHERE id = ?`).bind(userId).first<{ full_name: string; email: string }>()
    const userName = userRow?.full_name?.trim() || userRow?.email?.split('@')[0] || 'Người học'

    // Build context
    const lines: string[] = [`=== DỮ LIỆU HỌC TẬP CỦA ${userName.toUpperCase()} ===`]
    rows.results.forEach((row, i) => {
      lines.push(`\nPhiên ${i + 1}: ${row.session_date} S${row.session_number}${row.session_time ? ` lúc ${row.session_time}` : ''}`)
      lines.push(`- Thời gian học: ${row.study_hours}h`)
      lines.push(`- Tập trung: ${row.focus_level}/5`)
      lines.push(`- Mất tập trung: ${row.distraction_count} lần${row.distracting_factors ? ` (${row.distracting_factors})` : ''}`)
      lines.push(`- Hoàn thành mục tiêu: ${row.goal_achieved ? 'Có' : 'Không'}`)
      lines.push(`- Cảm giác bỏ cuộc: ${row.dropout_feeling}/5`)
      if (row.emotional_state) lines.push(`- Trạng thái cảm xúc: ${row.emotional_state}`)
      if (row.risk_level) {
        lines.push(`- AI đánh giá: ${row.risk_level}`)
        if (row.key_signals) {
          try {
            const sigs = JSON.parse(String(row.key_signals))
            if (Array.isArray(sigs)) lines.push(`- Tín hiệu chính: ${sigs.join('; ')}`)
          } catch { /* ignore */ }
        }
        if (row.primary_risk_driver) lines.push(`- Vấn đề cốt lõi: ${row.primary_risk_driver}`)
        if (row.short_term_forecast) lines.push(`- Dự báo: ${row.short_term_forecast}`)
        if (row.intervention_strategy) lines.push(`- Chiến lược: ${row.intervention_strategy}`)
      }
    })
    const userContext = lines.join('\n')

    const systemPrompt = `Bạn là một người học tên "${userName}" đang tham gia diễn đàn cộng đồng học tập LSR Engine.
Bạn sẽ đọc dữ liệu học tập thực tế của bản thân và viết một bài thảo luận chân thực, tự nhiên — như thể BẠN đang viết, không phải AI.

QUY TẮC VIẾT BÀI:
1. Viết bằng ngôi thứ nhất ("tôi", "mình") — giọng chân thật, có cảm xúc thật
2. Dựa hoàn toàn vào dữ liệu được cung cấp — không bịa đặt số liệu
3. Bài viết có thể là: thắc mắc cần giải đáp, chia sẻ khó khăn, hỏi kinh nghiệm, hay xin lời khuyên
4. Tiêu đề: ngắn gọn, thực tế, gần gũi (không hoa mỹ, không dùng emoji trong tiêu đề)
5. Nội dung: 120–250 từ, tự nhiên như người thật đang viết trên diễn đàn
6. Có thể bày tỏ sự bối rối, lo lắng, tò mò — đây là điều bình thường
7. Kết thúc bằng một câu hỏi mở cho cộng đồng

ĐỊNH DẠNG OUTPUT (chỉ trả về JSON, không có markdown, không có text ngoài JSON):
{
  "title": "tiêu đề bài viết",
  "content": "nội dung bài viết"
}`

    const prompt = `${userContext}\n\nDựa vào dữ liệu trên, hãy viết một bài thảo luận theo đúng format JSON đã hướng dẫn.`

    // Call Gemini
    const keyPool = parseApiKeys(c.env.GEMINI_API_KEYS, c.env.GEMINI_API_KEY)
    if (keyPool.length === 0) {
      return c.json({ error: 'config_error', message: 'API key chưa được cấu hình' }, 500)
    }

    let title = ''
    let content = ''
    let lastErr: unknown
    const invalidKeys = new Set<number>()

    outer:
    for (const m of FORUM_MODELS) {
      for (let ki = 0; ki < keyPool.length; ki++) {
        if (invalidKeys.has(ki)) continue
        const key = keyPool[ki]

        try {
          const isGemini25 = /gemini-2\.5-/.test(m.name)
          const genConfig: Record<string, unknown> = {
            temperature: 0.75, topK: 40, topP: 0.9,
            maxOutputTokens: m.maxOutputTokens,
          }
          if (isGemini25) genConfig.thinkingConfig = { thinkingBudget: 0 }

          const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${m.name}:generateContent?key=${key}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                systemInstruction: { parts: [{ text: systemPrompt }] },
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                generationConfig: genConfig,
                safetySettings: [
                  { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_NONE' },
                  { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'BLOCK_NONE' },
                  { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
                  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
                ],
              }),
            }
          )

          if (!res.ok) {
            const errText = await res.text()
            if (res.status === 429) {
              if (/prepayment|credits.{0,20}depleted/i.test(errText)) invalidKeys.add(ki)
              lastErr = new Error(errText); continue
            }
            if (res.status === 503) { lastErr = new Error(errText); break }
            if (res.status === 401) { invalidKeys.add(ki); lastErr = new Error(errText); continue }
            throw new Error(`HTTP ${res.status}`)
          }

          type GResp = { candidates: Array<{ content: { parts: Array<{ text: string }> } }>; promptFeedback?: { blockReason?: string } }
          const data = await res.json() as GResp
          const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''

          // Parse JSON từ response (có thể có markdown code block)
          const jsonStr = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
          // Tìm object JSON đầu tiên
          const match = jsonStr.match(/\{[\s\S]*\}/)
          if (!match) throw new Error('No JSON in response')
          const parsed = JSON.parse(match[0])
          title   = String(parsed.title   ?? '').trim()
          content = String(parsed.content ?? '').trim()
          if (!title || !content) throw new Error('Empty title or content')

          break outer
        } catch (err) {
          lastErr = err
          const msg = err instanceof Error ? err.message : String(err)
          if (/quota|rate.?limit|429/i.test(msg)) continue
          if (/503|overload|unavailable/i.test(msg)) break
          throw err
        }
      }
    }

    if (!title || !content) {
      return c.json({ error: 'ai_failed', message: 'AI không thể tạo bài viết lúc này. Thử lại sau.' }, 500)
    }

    return c.json({ success: true, title, content })

  } catch (err: any) {
    console.error('[forum/ai-draft]', err)
    return c.json({ error: 'server_error', message: 'Lỗi máy chủ. Thử lại sau.' }, 500)
  }
})

// ─── POSTS ────────────────────────────────────────────────────────────────────

// GET /api/forum/posts?page=1&limit=20&sort=newest|top
forum.get('/posts', async (c) => {
  const page   = Math.max(1, parseInt(c.req.query('page')  || '1',  10))
  const limit  = Math.min(50, Math.max(1, parseInt(c.req.query('limit') || '20', 10)))
  const offset = (page - 1) * limit
  const sort   = c.req.query('sort') === 'top' ? 'top' : 'newest'
  const { DB } = c.env

  const orderBy = sort === 'top'
    ? '(SELECT COUNT(*) FROM forum_likes fl WHERE fl.post_id = fp.id) DESC, fp.created_at DESC'
    : 'fp.created_at DESC'

  try {
    const countRow = await DB.prepare(`SELECT COUNT(*) as total FROM forum_posts`).first<{ total: number }>()
    const total = countRow?.total ?? 0

    const rows = await DB.prepare(`
      SELECT
        fp.id, fp.user_id, fp.title, fp.content, fp.created_at, fp.updated_at,
        u.full_name  AS author_name,
        u.email      AS author_email,
        (SELECT COUNT(*) FROM forum_comments fc WHERE fc.post_id = fp.id) AS comment_count,
        (SELECT COUNT(*) FROM forum_likes   fl WHERE fl.post_id = fp.id) AS like_count
      FROM forum_posts fp
      JOIN users u ON u.id = fp.user_id
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?
    `).bind(limit, offset).all()

    return c.json({ posts: rows.results, total, page, limit, total_pages: Math.ceil(total / limit) })
  } catch (err: any) {
    return c.json({ error: 'db_error', message: err.message }, 500)
  }
})

// GET /api/forum/posts/:id  — single post + all comments (flat, with parent_id)
forum.get('/posts/:id', async (c) => {
  const postId = parseInt(c.req.param('id'), 10)
  if (isNaN(postId)) return c.json({ error: 'invalid_id' }, 400)
  const { DB } = c.env

  try {
    const post = await DB.prepare(`
      SELECT
        fp.id, fp.user_id, fp.title, fp.content, fp.created_at, fp.updated_at,
        u.full_name AS author_name, u.email AS author_email,
        (SELECT COUNT(*) FROM forum_likes fl WHERE fl.post_id = fp.id) AS like_count
      FROM forum_posts fp
      JOIN users u ON u.id = fp.user_id
      WHERE fp.id = ?
    `).bind(postId).first()

    if (!post) return c.json({ error: 'not_found' }, 404)

    // Flat list — client builds tree
    const comments = await DB.prepare(`
      SELECT
        fc.id, fc.post_id, fc.user_id, fc.parent_id,
        fc.content, fc.created_at,
        u.full_name AS author_name, u.email AS author_email
      FROM forum_comments fc
      JOIN users u ON u.id = fc.user_id
      WHERE fc.post_id = ?
      ORDER BY fc.created_at ASC
    `).bind(postId).all()

    const userId = c.get('userId')
    const liked  = await DB.prepare(
      `SELECT 1 FROM forum_likes WHERE post_id = ? AND user_id = ?`
    ).bind(postId, userId).first()

    return c.json({ post, comments: comments.results, liked: !!liked })
  } catch (err: any) {
    return c.json({ error: 'db_error', message: err.message }, 500)
  }
})

// POST /api/forum/posts
forum.post('/posts', async (c) => {
  const userId = c.get('userId')
  const { DB } = c.env

  let body: any
  try { body = await c.req.json() } catch { return c.json({ error: 'invalid_json' }, 400) }

  const title   = sanitize(String(body.title   ?? ''), 200)
  const content = sanitize(String(body.content ?? ''), 10000)

  if (!title)              return c.json({ error: 'validation', message: 'Tiêu đề không được để trống' }, 422)
  if (title.length < 5)   return c.json({ error: 'validation', message: 'Tiêu đề phải có ít nhất 5 ký tự' }, 422)
  if (!content)            return c.json({ error: 'validation', message: 'Nội dung không được để trống' }, 422)

  try {
    const result = await DB.prepare(
      `INSERT INTO forum_posts (user_id, title, content) VALUES (?, ?, ?)`
    ).bind(userId, title, content).run()

    const postId = result.meta.last_row_id
    const post   = await DB.prepare(`
      SELECT fp.id, fp.user_id, fp.title, fp.content, fp.created_at, fp.updated_at,
             u.full_name AS author_name, u.email AS author_email
      FROM forum_posts fp JOIN users u ON u.id = fp.user_id WHERE fp.id = ?
    `).bind(postId).first()

    return c.json({ success: true, post }, 201)
  } catch (err: any) {
    return c.json({ error: 'db_error', message: err.message }, 500)
  }
})

// PUT /api/forum/posts/:id
forum.put('/posts/:id', async (c) => {
  const userId = c.get('userId')
  const postId = parseInt(c.req.param('id'), 10)
  if (isNaN(postId)) return c.json({ error: 'invalid_id' }, 400)
  const { DB } = c.env

  let body: any
  try { body = await c.req.json() } catch { return c.json({ error: 'invalid_json' }, 400) }

  const title   = sanitize(String(body.title   ?? ''), 200)
  const content = sanitize(String(body.content ?? ''), 10000)
  if (!title || !content) return c.json({ error: 'validation', message: 'Tiêu đề và nội dung không được để trống' }, 422)

  try {
    const existing = await DB.prepare(`SELECT user_id FROM forum_posts WHERE id = ?`).bind(postId).first<{ user_id: number }>()
    if (!existing)                      return c.json({ error: 'not_found' }, 404)
    if (existing.user_id !== userId)    return c.json({ error: 'forbidden' }, 403)

    await DB.prepare(`UPDATE forum_posts SET title=?, content=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(title, content, postId).run()
    return c.json({ success: true })
  } catch (err: any) {
    return c.json({ error: 'db_error', message: err.message }, 500)
  }
})

// DELETE /api/forum/posts/:id
forum.delete('/posts/:id', async (c) => {
  const userId = c.get('userId')
  const postId = parseInt(c.req.param('id'), 10)
  if (isNaN(postId)) return c.json({ error: 'invalid_id' }, 400)
  const { DB } = c.env

  try {
    const existing = await DB.prepare(`SELECT user_id FROM forum_posts WHERE id = ?`).bind(postId).first<{ user_id: number }>()
    if (!existing)                   return c.json({ error: 'not_found' }, 404)
    if (existing.user_id !== userId) return c.json({ error: 'forbidden' }, 403)

    await DB.prepare(`DELETE FROM forum_posts WHERE id = ?`).bind(postId).run()
    return c.json({ success: true })
  } catch (err: any) {
    return c.json({ error: 'db_error', message: err.message }, 500)
  }
})

// ─── LIKES ────────────────────────────────────────────────────────────────────

forum.post('/posts/:id/like', async (c) => {
  const userId = c.get('userId')
  const postId = parseInt(c.req.param('id'), 10)
  if (isNaN(postId)) return c.json({ error: 'invalid_id' }, 400)
  const { DB } = c.env

  try {
    const exists = await DB.prepare(`SELECT 1 FROM forum_likes WHERE post_id=? AND user_id=?`).bind(postId, userId).first()
    if (exists) {
      await DB.prepare(`DELETE FROM forum_likes WHERE post_id=? AND user_id=?`).bind(postId, userId).run()
    } else {
      await DB.prepare(`INSERT OR IGNORE INTO forum_likes (post_id, user_id) VALUES (?,?)`).bind(postId, userId).run()
    }
    const cnt = await DB.prepare(`SELECT COUNT(*) as c FROM forum_likes WHERE post_id=?`).bind(postId).first<{ c: number }>()
    return c.json({ liked: !exists, like_count: cnt?.c ?? 0 })
  } catch (err: any) {
    return c.json({ error: 'db_error', message: err.message }, 500)
  }
})

// ─── COMMENTS ────────────────────────────────────────────────────────────────

// POST /api/forum/posts/:id/comments — add comment or nested reply (unlimited depth)
// body: { content, parent_id? }
forum.post('/posts/:id/comments', async (c) => {
  const userId = c.get('userId')
  const postId = parseInt(c.req.param('id'), 10)
  if (isNaN(postId)) return c.json({ error: 'invalid_id' }, 400)
  const { DB } = c.env

  let body: any
  try { body = await c.req.json() } catch { return c.json({ error: 'invalid_json' }, 400) }

  const content  = sanitize(String(body.content ?? ''), 5000)
  const parentId = body.parent_id != null ? parseInt(String(body.parent_id), 10) : null

  if (!content) return c.json({ error: 'validation', message: 'Bình luận không được để trống' }, 422)

  try {
    const post = await DB.prepare(`SELECT id FROM forum_posts WHERE id=?`).bind(postId).first()
    if (!post) return c.json({ error: 'not_found' }, 404)

    // Validate parent if provided — must belong to the same post (no restriction on depth)
    if (parentId != null) {
      const parent = await DB.prepare(`SELECT id FROM forum_comments WHERE id=? AND post_id=?`).bind(parentId, postId).first()
      if (!parent) return c.json({ error: 'validation', message: 'Bình luận gốc không tồn tại' }, 422)
    }

    const result = await DB.prepare(
      `INSERT INTO forum_comments (post_id, user_id, parent_id, content) VALUES (?,?,?,?)`
    ).bind(postId, userId, parentId, content).run()

    const commentId = result.meta.last_row_id
    const comment   = await DB.prepare(`
      SELECT fc.id, fc.post_id, fc.user_id, fc.parent_id, fc.content, fc.created_at,
             u.full_name AS author_name, u.email AS author_email
      FROM forum_comments fc JOIN users u ON u.id = fc.user_id WHERE fc.id = ?
    `).bind(commentId).first()

    return c.json({ success: true, comment }, 201)
  } catch (err: any) {
    return c.json({ error: 'db_error', message: err.message }, 500)
  }
})

// DELETE /api/forum/comments/:id
forum.delete('/comments/:id', async (c) => {
  const userId    = c.get('userId')
  const commentId = parseInt(c.req.param('id'), 10)
  if (isNaN(commentId)) return c.json({ error: 'invalid_id' }, 400)
  const { DB } = c.env

  try {
    const existing = await DB.prepare(`SELECT user_id FROM forum_comments WHERE id=?`).bind(commentId).first<{ user_id: number }>()
    if (!existing)                   return c.json({ error: 'not_found' }, 404)
    if (existing.user_id !== userId) return c.json({ error: 'forbidden' }, 403)

    await DB.prepare(`DELETE FROM forum_comments WHERE id=?`).bind(commentId).run()
    return c.json({ success: true })
  } catch (err: any) {
    return c.json({ error: 'db_error', message: err.message }, 500)
  }
})

export default forum
