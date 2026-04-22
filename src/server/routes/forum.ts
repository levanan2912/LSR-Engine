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

/** Parse tag_ids from body — accepts array or comma-separated string */
function parseTagIds(raw: unknown): number[] {
  if (!raw) return []
  if (Array.isArray(raw)) return raw.map(Number).filter(n => !isNaN(n) && n > 0)
  if (typeof raw === 'string') return raw.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n) && n > 0)
  return []
}

const FORUM_MODELS = [
  { name: 'gemini-2.5-flash-lite',         maxOutputTokens: 1024 },
  { name: 'gemini-3.1-flash-lite-preview', maxOutputTokens: 1024 },
  { name: 'gemini-2.5-flash',              maxOutputTokens: 1024 },
]

// ─── AI Content Moderation ────────────────────────────────────────────────────
// Returns { approved: boolean, reason: string }
async function moderatePost(
  title: string,
  content: string,
  keyPool: string[],
): Promise<{ approved: boolean; reason: string }> {
  const systemPrompt = `Bạn là người kiểm duyệt nội dung cho diễn đàn học tập LSR Engine — nơi học sinh chia sẻ về việc học, cảm xúc, tâm lý học tập, kỹ năng, mục tiêu, khó khăn, và kinh nghiệm học tập.

Nhiệm vụ: Xác định xem bài viết có liên quan đến chủ đề học tập, tâm lý học tập, cuộc sống học sinh, hoặc phát triển bản thân không.

ĐƯỢC CHẤP NHẬN (approved=true):
- Học tập, phương pháp học, kỹ thuật ghi nhớ
- Tâm lý học sinh: mệt mỏi, áp lực, xao nhãng, cảm xúc
- Mục tiêu, động lực, thói quen học tập
- Sức khoẻ thể chất/tinh thần liên quan đến học tập
- Kinh nghiệm thi cử, ôn thi
- Câu hỏi về ứng dụng LSR Engine
- Chia sẻ cuộc sống học sinh nói chung
- Hỏi ý kiến cộng đồng về vấn đề học tập

KHÔNG ĐƯỢC CHẤP NHẬN (approved=false):
- Quảng cáo sản phẩm/dịch vụ không liên quan
- Nội dung thù hận, bạo lực, khiêu dâm
- Thông tin sai lệch nguy hiểm
- Spam, nội dung vô nghĩa hoàn toàn
- Hoàn toàn không liên quan đến học tập hoặc cuộc sống học sinh

LƯU Ý: Hãy khoan dung, ưu tiên chấp nhận nếu có chút liên quan. Chỉ từ chối khi nội dung rõ ràng không phù hợp.

Trả về JSON:
{"approved": true/false, "reason": "lý do ngắn gọn dưới 100 ký tự nếu không chấp nhận, hoặc rỗng nếu chấp nhận"}`

  const prompt = `Tiêu đề: ${title}\n\nNội dung:\n${content}`

  for (const m of FORUM_MODELS) {
    for (const key of keyPool) {
      try {
        const isGemini25 = /gemini-2\.5-/.test(m.name)
        const genConfig: Record<string, unknown> = {
          temperature: 0.1, maxOutputTokens: 200,
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
            }),
          }
        )
        if (!res.ok) continue
        type GResp = { candidates: Array<{ content: { parts: Array<{ text: string }> } }> }
        const data = await res.json() as GResp
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
        const jsonStr = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
        const match = jsonStr.match(/\{[\s\S]*\}/)
        if (!match) continue
        const parsed = JSON.parse(match[0])
        return {
          approved: parsed.approved !== false,
          reason: String(parsed.reason ?? '').trim().slice(0, 200),
        }
      } catch { continue }
    }
  }

  // If AI unavailable → approve by default (fail-open)
  return { approved: true, reason: '' }
}

// ─── TAGS ─────────────────────────────────────────────────────────────────────

// GET /api/forum/tags — returns all tags ordered by sort_order
forum.get('/tags', async (c) => {
  const { DB } = c.env
  try {
    const rows = await DB.prepare(
      `SELECT id, slug, label, color, icon, sort_order FROM forum_tags ORDER BY sort_order ASC`
    ).all()
    return c.json({ tags: rows.results })
  } catch (err: any) {
    return c.json({ error: 'db_error', message: err.message }, 500)
  }
})

// ─── AI DRAFT ─────────────────────────────────────────────────────────────────

// POST /api/forum/ai-draft
forum.post('/ai-draft', async (c) => {
  const userId = c.get('userId')
  const { DB } = c.env

  try {
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

    const userRow = await DB.prepare(`SELECT full_name, email FROM users WHERE id = ?`).bind(userId).first<{ full_name: string; email: string }>()
    const userName = userRow?.full_name?.trim() || userRow?.email?.split('@')[0] || 'Người học'

    // Fetch tag slugs for genre suggestion
    const allTagsRows = await DB.prepare(`SELECT slug, label FROM forum_tags ORDER BY sort_order`).all<{ slug: string; label: string }>()
    const tagList = allTagsRows.results.map(t => `${t.slug} (${t.label})`).join(', ')

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
        if (row.short_term_forecast)  lines.push(`- Dự báo: ${row.short_term_forecast}`)
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
8. Chọn 1–3 genre phù hợp nhất từ danh sách slug sau: ${tagList}

ĐỊNH DẠNG OUTPUT (chỉ trả về JSON, không có markdown, không có text ngoài JSON):
{
  "title": "tiêu đề bài viết",
  "content": "nội dung bài viết",
  "suggested_tag_slugs": ["slug1", "slug2"]
}`

    const prompt = `${userContext}\n\nDựa vào dữ liệu trên, hãy viết một bài thảo luận theo đúng format JSON đã hướng dẫn.`

    const keyPool = parseApiKeys(c.env.GEMINI_API_KEYS, c.env.GEMINI_API_KEY)
    if (keyPool.length === 0) {
      return c.json({ error: 'config_error', message: 'API key chưa được cấu hình' }, 500)
    }

    let title = ''
    let content = ''
    let suggestedSlugs: string[] = []
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

          const jsonStr = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
          const match = jsonStr.match(/\{[\s\S]*\}/)
          if (!match) throw new Error('No JSON in response')
          const parsed = JSON.parse(match[0])
          title   = String(parsed.title   ?? '').trim()
          content = String(parsed.content ?? '').trim()
          if (!title || !content) throw new Error('Empty title or content')
          if (Array.isArray(parsed.suggested_tag_slugs)) {
            suggestedSlugs = parsed.suggested_tag_slugs.map(String)
          }

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

    // Resolve suggested slugs → tag ids
    let suggestedTagIds: number[] = []
    if (suggestedSlugs.length > 0) {
      const placeholders = suggestedSlugs.map(() => '?').join(',')
      const tagRows = await DB.prepare(
        `SELECT id FROM forum_tags WHERE slug IN (${placeholders})`
      ).bind(...suggestedSlugs).all<{ id: number }>()
      suggestedTagIds = tagRows.results.map(r => r.id)
    }

    return c.json({ success: true, title, content, suggested_tag_ids: suggestedTagIds })

  } catch (err: any) {
    console.error('[forum/ai-draft]', err)
    return c.json({ error: 'server_error', message: 'Lỗi máy chủ. Thử lại sau.' }, 500)
  }
})

// ─── POSTS ────────────────────────────────────────────────────────────────────

// GET /api/forum/posts?page=1&limit=20&sort=newest|top&tag=<slug>
// Shows: approved posts to everyone + owner's own pending posts
forum.get('/posts', async (c) => {
  const page    = Math.max(1, parseInt(c.req.query('page')  || '1',  10))
  const limit   = Math.min(50, Math.max(1, parseInt(c.req.query('limit') || '20', 10)))
  const offset  = (page - 1) * limit
  const sort    = c.req.query('sort') === 'top' ? 'top' : 'newest'
  const tagSlug = c.req.query('tag') || ''
  const userId  = c.get('userId')
  const { DB }  = c.env

  const orderBy = sort === 'top'
    ? '(SELECT COUNT(*) FROM forum_likes fl WHERE fl.post_id = fp.id) DESC, fp.created_at DESC'
    : 'fp.created_at DESC'

  // Visibility: approved OR (pending AND owned by this user)
  const visWhere = `(fp.status = 'approved' OR (fp.status = 'pending' AND fp.user_id = ?))`

  try {
    let countRow: { total: number } | null
    let rows: D1Result

    if (tagSlug) {
      countRow = await DB.prepare(`
        SELECT COUNT(DISTINCT fp.id) as total
        FROM forum_posts fp
        JOIN forum_post_tags fpt ON fpt.post_id = fp.id
        JOIN forum_tags ft ON ft.id = fpt.tag_id AND ft.slug = ?
        WHERE ${visWhere}
      `).bind(tagSlug, userId).first<{ total: number }>()

      rows = await DB.prepare(`
        SELECT
          fp.id, fp.user_id, fp.title, fp.content, fp.created_at, fp.updated_at,
          fp.status, fp.ai_moderation_reason,
          u.full_name  AS author_name,
          u.email      AS author_email,
          (SELECT COUNT(*) FROM forum_comments fc WHERE fc.post_id = fp.id) AS comment_count,
          (SELECT COUNT(*) FROM forum_likes   fl WHERE fl.post_id = fp.id) AS like_count
        FROM forum_posts fp
        JOIN users u ON u.id = fp.user_id
        JOIN forum_post_tags fpt ON fpt.post_id = fp.id
        JOIN forum_tags ft ON ft.id = fpt.tag_id AND ft.slug = ?
        WHERE ${visWhere}
        GROUP BY fp.id
        ORDER BY ${orderBy}
        LIMIT ? OFFSET ?
      `).bind(tagSlug, userId, limit, offset).all()
    } else {
      countRow = await DB.prepare(`
        SELECT COUNT(*) as total FROM forum_posts fp WHERE ${visWhere}
      `).bind(userId).first<{ total: number }>()

      rows = await DB.prepare(`
        SELECT
          fp.id, fp.user_id, fp.title, fp.content, fp.created_at, fp.updated_at,
          fp.status, fp.ai_moderation_reason,
          u.full_name  AS author_name,
          u.email      AS author_email,
          (SELECT COUNT(*) FROM forum_comments fc WHERE fc.post_id = fp.id) AS comment_count,
          (SELECT COUNT(*) FROM forum_likes   fl WHERE fl.post_id = fp.id) AS like_count
        FROM forum_posts fp
        JOIN users u ON u.id = fp.user_id
        WHERE ${visWhere}
        ORDER BY ${orderBy}
        LIMIT ? OFFSET ?
      `).bind(userId, limit, offset).all()
    }

    const total = countRow?.total ?? 0

    // Fetch tags for each post
    const postIds: number[] = (rows.results as any[]).map((r: any) => r.id)
    let postTagsMap: Map<number, any[]> = new Map()
    if (postIds.length > 0) {
      const ph = postIds.map(() => '?').join(',')
      const tagRows = await DB.prepare(`
        SELECT fpt.post_id, ft.id, ft.slug, ft.label, ft.color, ft.icon
        FROM forum_post_tags fpt
        JOIN forum_tags ft ON ft.id = fpt.tag_id
        WHERE fpt.post_id IN (${ph})
        ORDER BY ft.sort_order
      `).bind(...postIds).all<{ post_id: number; id: number; slug: string; label: string; color: string; icon: string }>()

      for (const t of tagRows.results) {
        if (!postTagsMap.has(t.post_id)) postTagsMap.set(t.post_id, [])
        postTagsMap.get(t.post_id)!.push({ id: t.id, slug: t.slug, label: t.label, color: t.color, icon: t.icon })
      }
    }

    const postsWithTags = (rows.results as any[]).map((p: any) => ({
      ...p,
      tags: postTagsMap.get(p.id) ?? [],
    }))

    return c.json({ posts: postsWithTags, total, page, limit, total_pages: Math.ceil(total / limit) })
  } catch (err: any) {
    return c.json({ error: 'db_error', message: err.message }, 500)
  }
})

// GET /api/forum/posts/:id  — single post + comments + tags
// Visible if: approved, OR pending+owner, OR pending+admin
forum.get('/posts/:id', async (c) => {
  const postId = parseInt(c.req.param('id'), 10)
  if (isNaN(postId)) return c.json({ error: 'invalid_id' }, 400)
  const userId = c.get('userId')
  const { DB } = c.env

  try {
    const post = await DB.prepare(`
      SELECT
        fp.id, fp.user_id, fp.title, fp.content, fp.created_at, fp.updated_at,
        fp.status, fp.ai_moderation_reason,
        u.full_name AS author_name, u.email AS author_email,
        (SELECT COUNT(*) FROM forum_likes fl WHERE fl.post_id = fp.id) AS like_count
      FROM forum_posts fp
      JOIN users u ON u.id = fp.user_id
      WHERE fp.id = ?
    `).bind(postId).first() as any

    if (!post) return c.json({ error: 'not_found' }, 404)

    // Access check: pending posts only visible to owner or admin
    const isOwner = (post as any).user_id === userId
    const userRow = await DB.prepare(`SELECT role FROM users WHERE id = ?`).bind(userId).first<{ role: string }>()
    const isAdmin = userRow?.role === 'rootadmin' || userRow?.role === 'subadmin'
    if ((post as any).status === 'pending' && !isOwner && !isAdmin) {
      return c.json({ error: 'not_found' }, 404)
    }

    // Tags for this post
    const tagsRows = await DB.prepare(`
      SELECT ft.id, ft.slug, ft.label, ft.color, ft.icon
      FROM forum_post_tags fpt
      JOIN forum_tags ft ON ft.id = fpt.tag_id
      WHERE fpt.post_id = ?
      ORDER BY ft.sort_order
    `).bind(postId).all()

    // Flat comments
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

    const liked  = await DB.prepare(
      `SELECT 1 FROM forum_likes WHERE post_id = ? AND user_id = ?`
    ).bind(postId, userId).first()

    return c.json({
      post: { ...post, tags: tagsRows.results },
      comments: comments.results,
      liked: !!liked,
    })
  } catch (err: any) {
    return c.json({ error: 'db_error', message: err.message }, 500)
  }
})

// POST /api/forum/posts   body: { title, content, tag_ids?: number[] }
forum.post('/posts', async (c) => {
  const userId = c.get('userId')
  const { DB } = c.env

  let body: any
  try { body = await c.req.json() } catch { return c.json({ error: 'invalid_json' }, 400) }

  const title   = sanitize(String(body.title   ?? ''), 200)
  const content = sanitize(String(body.content ?? ''), 10000)
  const tagIds  = parseTagIds(body.tag_ids).slice(0, 5) // max 5 tags

  if (!title)            return c.json({ error: 'validation', message: 'Tiêu đề không được để trống' }, 422)
  if (title.length < 5)  return c.json({ error: 'validation', message: 'Tiêu đề phải có ít nhất 5 ký tự' }, 422)
  if (!content)          return c.json({ error: 'validation', message: 'Nội dung không được để trống' }, 422)

  try {
    // ── AI moderation ──────────────────────────────────────────────────────────
    const keyPool = parseApiKeys(c.env.GEMINI_API_KEYS, c.env.GEMINI_API_KEY)
    let postStatus = 'approved'
    let aiReason = ''
    if (keyPool.length > 0) {
      const mod = await moderatePost(title, content, keyPool)
      if (!mod.approved) {
        postStatus = 'pending'
        aiReason   = mod.reason
      }
    }
    // ──────────────────────────────────────────────────────────────────────────

    const result = await DB.prepare(
      `INSERT INTO forum_posts (user_id, title, content, status, ai_moderation_reason) VALUES (?, ?, ?, ?, ?)`
    ).bind(userId, title, content, postStatus, aiReason || null).run()

    const postId = result.meta.last_row_id

    // Insert tags
    if (tagIds.length > 0) {
      const stmts = tagIds.map(tid =>
        DB.prepare(`INSERT OR IGNORE INTO forum_post_tags (post_id, tag_id) VALUES (?,?)`).bind(postId, tid)
      )
      await DB.batch(stmts)
    }

    const post = await DB.prepare(`
      SELECT fp.id, fp.user_id, fp.title, fp.content, fp.created_at, fp.updated_at,
             fp.status, fp.ai_moderation_reason,
             u.full_name AS author_name, u.email AS author_email
      FROM forum_posts fp JOIN users u ON u.id = fp.user_id WHERE fp.id = ?
    `).bind(postId).first()

    const tagsRows = await DB.prepare(`
      SELECT ft.id, ft.slug, ft.label, ft.color, ft.icon
      FROM forum_post_tags fpt JOIN forum_tags ft ON ft.id = fpt.tag_id
      WHERE fpt.post_id = ? ORDER BY ft.sort_order
    `).bind(postId).all()

    return c.json({
      success: true,
      post: { ...post, tags: tagsRows.results, like_count: 0, comment_count: 0 },
      moderation: { status: postStatus, reason: aiReason },
    }, 201)
  } catch (err: any) {
    return c.json({ error: 'db_error', message: err.message }, 500)
  }
})

// PUT /api/forum/posts/:id   body: { title, content, tag_ids?: number[] }
forum.put('/posts/:id', async (c) => {
  const userId = c.get('userId')
  const postId = parseInt(c.req.param('id'), 10)
  if (isNaN(postId)) return c.json({ error: 'invalid_id' }, 400)
  const { DB } = c.env

  let body: any
  try { body = await c.req.json() } catch { return c.json({ error: 'invalid_json' }, 400) }

  const title   = sanitize(String(body.title   ?? ''), 200)
  const content = sanitize(String(body.content ?? ''), 10000)
  const tagIds  = parseTagIds(body.tag_ids).slice(0, 5)
  if (!title || !content) return c.json({ error: 'validation', message: 'Tiêu đề và nội dung không được để trống' }, 422)

  try {
    const existing = await DB.prepare(`SELECT user_id FROM forum_posts WHERE id = ?`).bind(postId).first<{ user_id: number }>()
    if (!existing)                   return c.json({ error: 'not_found' }, 404)
    if (existing.user_id !== userId) return c.json({ error: 'forbidden' }, 403)

    await DB.prepare(`UPDATE forum_posts SET title=?, content=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(title, content, postId).run()

    // Replace tags
    await DB.prepare(`DELETE FROM forum_post_tags WHERE post_id = ?`).bind(postId).run()
    if (tagIds.length > 0) {
      const stmts = tagIds.map(tid =>
        DB.prepare(`INSERT OR IGNORE INTO forum_post_tags (post_id, tag_id) VALUES (?,?)`).bind(postId, tid)
      )
      await DB.batch(stmts)
    }

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

// POST /api/forum/posts/:id/comments — body: { content, parent_id? }
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
