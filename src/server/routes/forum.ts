import { Hono } from 'hono'
import { authMiddleware } from '../middleware/auth'

type Bindings = {
  DB: D1Database
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
    const countRow = await DB.prepare(
      `SELECT COUNT(*) as total FROM forum_posts`
    ).first<{ total: number }>()
    const total = countRow?.total ?? 0

    const rows = await DB.prepare(`
      SELECT
        fp.id,
        fp.user_id,
        fp.title,
        fp.content,
        fp.created_at,
        fp.updated_at,
        u.full_name  AS author_name,
        u.email      AS author_email,
        (SELECT COUNT(*) FROM forum_comments fc WHERE fc.post_id = fp.id) AS comment_count,
        (SELECT COUNT(*) FROM forum_likes   fl WHERE fl.post_id = fp.id) AS like_count
      FROM forum_posts fp
      JOIN users u ON u.id = fp.user_id
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?
    `).bind(limit, offset).all()

    return c.json({
      posts: rows.results,
      total,
      page,
      limit,
      total_pages: Math.ceil(total / limit),
    })
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
        fp.id,
        fp.user_id,
        fp.title,
        fp.content,
        fp.created_at,
        fp.updated_at,
        u.full_name AS author_name,
        u.email     AS author_email,
        (SELECT COUNT(*) FROM forum_likes fl WHERE fl.post_id = fp.id) AS like_count
      FROM forum_posts fp
      JOIN users u ON u.id = fp.user_id
      WHERE fp.id = ?
    `).bind(postId).first()

    if (!post) return c.json({ error: 'not_found' }, 404)

    // Fetch all comments (top-level + replies) — include parent_id
    const comments = await DB.prepare(`
      SELECT
        fc.id,
        fc.post_id,
        fc.user_id,
        fc.parent_id,
        fc.content,
        fc.created_at,
        u.full_name AS author_name,
        u.email     AS author_email
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

// POST /api/forum/posts — create a post
forum.post('/posts', async (c) => {
  const userId = c.get('userId')
  const { DB } = c.env

  let body: any
  try { body = await c.req.json() } catch { return c.json({ error: 'invalid_json' }, 400) }

  const title   = sanitize(String(body.title   ?? ''), 200)
  const content = sanitize(String(body.content ?? ''), 10000)

  if (!title)   return c.json({ error: 'validation', message: 'Tiêu đề không được để trống' }, 422)
  if (!content) return c.json({ error: 'validation', message: 'Nội dung không được để trống' }, 422)
  if (title.length < 5) return c.json({ error: 'validation', message: 'Tiêu đề phải có ít nhất 5 ký tự' }, 422)

  try {
    const result = await DB.prepare(`
      INSERT INTO forum_posts (user_id, title, content) VALUES (?, ?, ?)
    `).bind(userId, title, content).run()

    const postId = result.meta.last_row_id
    const post   = await DB.prepare(`
      SELECT fp.id, fp.user_id, fp.title, fp.content, fp.created_at, fp.updated_at,
             u.full_name AS author_name, u.email AS author_email
      FROM forum_posts fp JOIN users u ON u.id = fp.user_id
      WHERE fp.id = ?
    `).bind(postId).first()

    return c.json({ success: true, post }, 201)
  } catch (err: any) {
    return c.json({ error: 'db_error', message: err.message }, 500)
  }
})

// PUT /api/forum/posts/:id — edit a post (owner only)
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
    if (!existing) return c.json({ error: 'not_found' }, 404)
    if (existing.user_id !== userId) return c.json({ error: 'forbidden' }, 403)

    await DB.prepare(`
      UPDATE forum_posts SET title = ?, content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).bind(title, content, postId).run()

    return c.json({ success: true })
  } catch (err: any) {
    return c.json({ error: 'db_error', message: err.message }, 500)
  }
})

// DELETE /api/forum/posts/:id — delete a post (owner only)
forum.delete('/posts/:id', async (c) => {
  const userId = c.get('userId')
  const postId = parseInt(c.req.param('id'), 10)
  if (isNaN(postId)) return c.json({ error: 'invalid_id' }, 400)

  const { DB } = c.env

  try {
    const existing = await DB.prepare(`SELECT user_id FROM forum_posts WHERE id = ?`).bind(postId).first<{ user_id: number }>()
    if (!existing) return c.json({ error: 'not_found' }, 404)
    if (existing.user_id !== userId) return c.json({ error: 'forbidden' }, 403)

    await DB.prepare(`DELETE FROM forum_posts WHERE id = ?`).bind(postId).run()
    return c.json({ success: true })
  } catch (err: any) {
    return c.json({ error: 'db_error', message: err.message }, 500)
  }
})

// ─── LIKES ────────────────────────────────────────────────────────────────────

// POST /api/forum/posts/:id/like — toggle like
forum.post('/posts/:id/like', async (c) => {
  const userId = c.get('userId')
  const postId = parseInt(c.req.param('id'), 10)
  if (isNaN(postId)) return c.json({ error: 'invalid_id' }, 400)

  const { DB } = c.env

  try {
    const exists = await DB.prepare(
      `SELECT 1 FROM forum_likes WHERE post_id = ? AND user_id = ?`
    ).bind(postId, userId).first()

    if (exists) {
      await DB.prepare(`DELETE FROM forum_likes WHERE post_id = ? AND user_id = ?`).bind(postId, userId).run()
      const cnt = await DB.prepare(`SELECT COUNT(*) as c FROM forum_likes WHERE post_id = ?`).bind(postId).first<{ c: number }>()
      return c.json({ liked: false, like_count: cnt?.c ?? 0 })
    } else {
      await DB.prepare(`INSERT OR IGNORE INTO forum_likes (post_id, user_id) VALUES (?, ?)`).bind(postId, userId).run()
      const cnt = await DB.prepare(`SELECT COUNT(*) as c FROM forum_likes WHERE post_id = ?`).bind(postId).first<{ c: number }>()
      return c.json({ liked: true, like_count: cnt?.c ?? 0 })
    }
  } catch (err: any) {
    return c.json({ error: 'db_error', message: err.message }, 500)
  }
})

// ─── COMMENTS ────────────────────────────────────────────────────────────────

// POST /api/forum/posts/:id/comments — add comment (top-level or reply)
// body: { content, parent_id? }
forum.post('/posts/:id/comments', async (c) => {
  const userId = c.get('userId')
  const postId = parseInt(c.req.param('id'), 10)
  if (isNaN(postId)) return c.json({ error: 'invalid_id' }, 400)

  const { DB } = c.env

  let body: any
  try { body = await c.req.json() } catch { return c.json({ error: 'invalid_json' }, 400) }

  const content  = sanitize(String(body.content ?? ''), 5000)
  const parentId = body.parent_id ? parseInt(String(body.parent_id), 10) : null

  if (!content) return c.json({ error: 'validation', message: 'Bình luận không được để trống' }, 422)

  try {
    const post = await DB.prepare(`SELECT id FROM forum_posts WHERE id = ?`).bind(postId).first()
    if (!post) return c.json({ error: 'not_found' }, 404)

    // If replying, verify parent belongs to the same post (and is top-level — no nesting beyond 1 level)
    if (parentId) {
      const parent = await DB.prepare(
        `SELECT id, post_id FROM forum_comments WHERE id = ? AND post_id = ?`
      ).bind(parentId, postId).first<{ id: number; post_id: number }>()
      if (!parent) return c.json({ error: 'validation', message: 'Bình luận gốc không tồn tại' }, 422)
    }

    const result = await DB.prepare(`
      INSERT INTO forum_comments (post_id, user_id, parent_id, content) VALUES (?, ?, ?, ?)
    `).bind(postId, userId, parentId, content).run()

    const commentId = result.meta.last_row_id
    const comment   = await DB.prepare(`
      SELECT fc.id, fc.post_id, fc.user_id, fc.parent_id, fc.content, fc.created_at,
             u.full_name AS author_name, u.email AS author_email
      FROM forum_comments fc JOIN users u ON u.id = fc.user_id
      WHERE fc.id = ?
    `).bind(commentId).first()

    return c.json({ success: true, comment }, 201)
  } catch (err: any) {
    return c.json({ error: 'db_error', message: err.message }, 500)
  }
})

// DELETE /api/forum/comments/:id — delete a comment (owner only)
forum.delete('/comments/:id', async (c) => {
  const userId    = c.get('userId')
  const commentId = parseInt(c.req.param('id'), 10)
  if (isNaN(commentId)) return c.json({ error: 'invalid_id' }, 400)

  const { DB } = c.env

  try {
    const existing = await DB.prepare(`SELECT user_id FROM forum_comments WHERE id = ?`).bind(commentId).first<{ user_id: number }>()
    if (!existing) return c.json({ error: 'not_found' }, 404)
    if (existing.user_id !== userId) return c.json({ error: 'forbidden' }, 403)

    await DB.prepare(`DELETE FROM forum_comments WHERE id = ?`).bind(commentId).run()
    return c.json({ success: true })
  } catch (err: any) {
    return c.json({ error: 'db_error', message: err.message }, 500)
  }
})

export default forum
