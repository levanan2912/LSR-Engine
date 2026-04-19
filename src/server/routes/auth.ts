import { Hono } from 'hono'
import { hash, compare } from 'bcryptjs'
import { SignJWT, jwtVerify } from 'jose'

type Bindings = { DB: D1Database; JWT_SECRET: string }

const auth = new Hono<{ Bindings: Bindings }>()

const getSecret = (env: Bindings) => new TextEncoder().encode(env.JWT_SECRET || 'studysignal-dev-secret-key-2024')

const signToken = (secret: Uint8Array, userId: number, email: string) =>
  new SignJWT({ userId, email })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('7d')
    .sign(secret)

// ── Role assignment helper ──────────────────────────────────────────────────
function assignRole(email: string): string {
  const e = email.toLowerCase()
  if (e === 'rootadmin@gmail.com') return 'rootadmin'
  if (e === 'subadmin@gmail.com')  return 'subadmin'
  return 'user'
}

// ── POST /api/auth/register ──────────────────────────────────────────────────
auth.post('/register', async (c) => {
  try {
    const body = await c.req.json()
    const { password, full_name } = body
    const email: string = typeof body.email === 'string' ? body.email.trim() : ''

    if (!email || !password)     return c.json({ field: 'general',  message: 'Vui lòng điền đầy đủ thông tin' }, 400)
    if (password.length < 6)     return c.json({ field: 'password', message: 'Mật khẩu phải có ít nhất 6 ký tự' }, 400)

    const exists = await c.env.DB.prepare('SELECT id FROM users WHERE LOWER(email) = LOWER(?)').bind(email).first()
    if (exists) return c.json({ field: 'email', message: 'Email này đã được đăng ký. Vui lòng đăng nhập hoặc dùng email khác.' }, 409)

    // CF Workers CPU limit: cost=6 (~5ms) avoids the 10ms CPU timeout
    const passwordHash = await hash(password, 6)
    const role = assignRole(email)
    const result = await c.env.DB.prepare(
      'INSERT INTO users (email, password_hash, full_name, role) VALUES (?, ?, ?, ?)'
    ).bind(email.toLowerCase(), passwordHash, full_name || '', role).run()
    const userId = result.meta.last_row_id as number

    // Register does NOT auto-login — return success only (no token)
    // so the client redirects to the login page
    return c.json({ success: true, message: 'Tạo tài khoản thành công' }, 201)
  } catch (err) {
    console.error('Register error:', err)
    return c.json({ error: 'Registration failed' }, 500)
  }
})

// ── POST /api/auth/login ─────────────────────────────────────────────────────
auth.post('/login', async (c) => {
  try {
    const body = await c.req.json()
    const { password } = body
    const email: string = typeof body.email === 'string' ? body.email.trim() : ''

    if (!email || !password) return c.json({ field: 'general', message: 'Vui lòng điền đầy đủ thông tin' }, 400)

    const user = await c.env.DB.prepare(
      'SELECT id, email, password_hash, full_name, role, is_locked, locked_reason, must_change_password FROM users WHERE LOWER(email) = LOWER(?)'
    ).bind(email).first<{
      id: number; email: string; password_hash: string; full_name: string
      role: string | null; is_locked: number | null; locked_reason: string | null
      must_change_password: number | null
    }>()

    if (!user) return c.json({ field: 'email', message: 'Email này chưa được đăng ký trong hệ thống' }, 401)

    // ── Verify password FIRST (security: don't reveal lock status to wrong-password attempts)
    if (!(await compare(password, user.password_hash)))
      return c.json({ field: 'password', message: 'Mật khẩu không chính xác' }, 401)

    // ── Then check lock status ──────────────────────────────────────────────
    if (user.is_locked === 1) {
      const lockMsg = user.locked_reason
        ? `Tài khoản đã bị khóa. Lý do: ${user.locked_reason}. Vui lòng liên hệ quản trị viên để được hỗ trợ.`
        : `Tài khoản đã bị khóa. Vui lòng liên hệ quản trị viên để được hỗ trợ.`
      return c.json({ field: 'general', message: lockMsg }, 401)
    }

    const token = await signToken(getSecret(c.env), user.id, user.email)
    return c.json({
      token,
      user: {
        id:                   user.id,
        email:                user.email,
        full_name:            user.full_name,
        role:                 user.role || 'user',
        must_change_password: user.must_change_password === 1,
      },
    })
  } catch (err) {
    console.error('Login error:', err)
    return c.json({ error: 'Login failed' }, 500)
  }
})

// ── POST /api/auth/change-password ───────────────────────────────────────────
// Requires valid JWT. Verifies current password, hashes new one, updates DB.
auth.post('/change-password', async (c) => {
  try {
    // ── Verify JWT ─────────────────────────────────────────────────────────
    const authHeader = c.req.header('Authorization')
    if (!authHeader?.startsWith('Bearer '))
      return c.json({ field: 'general', message: 'Chưa đăng nhập' }, 401)
    const token = authHeader.slice(7)
    let userId: number
    try {
      const secret = getSecret(c.env)
      const { payload } = await jwtVerify(token, secret)
      userId = payload.userId as number
    } catch {
      return c.json({ error: 'INVALID_TOKEN' }, 401)
    }

    // ── Parse body ─────────────────────────────────────────────────────────
    const body = await c.req.json().catch(() => ({}))
    const { current_password, new_password, confirm_password } = body as Record<string, string>

    // ── Validation ─────────────────────────────────────────────────────────
    if (!current_password || !new_password || !confirm_password)
      return c.json({ field: 'general', message: 'Vui lòng điền đầy đủ thông tin' }, 400)
    if (new_password !== confirm_password)
      return c.json({ field: 'confirm_password', message: 'Mật khẩu xác nhận không khớp' }, 400)
    if (new_password.length < 6)
      return c.json({ field: 'new_password', message: 'Mật khẩu mới phải có ít nhất 6 ký tự' }, 400)
    if (new_password === current_password)
      return c.json({ field: 'new_password', message: 'Mật khẩu mới không được trùng với mật khẩu hiện tại' }, 400)

    // ── Get user from DB ────────────────────────────────────────────────────
    const user = await c.env.DB.prepare(
      'SELECT id, password_hash FROM users WHERE id = ?'
    ).bind(userId).first<{ id: number; password_hash: string }>()
    if (!user) return c.json({ field: 'general', message: 'Không tìm thấy tài khoản' }, 404)

    // ── Verify current password ─────────────────────────────────────────────
    const isMatch = await compare(current_password, user.password_hash)
    if (!isMatch)
      return c.json({ field: 'current_password', message: 'Mật khẩu hiện tại không chính xác' }, 400)

    // ── Hash new password and update; clear must_change_password flag ────────
    // CF Workers CPU limit: cost=6 (~5ms) avoids the 10ms CPU timeout
    const newHash = await hash(new_password, 6)
    // Clear temp_password when user sets their own new password
    await c.env.DB.prepare('UPDATE users SET password_hash = ?, must_change_password = 0, temp_password = NULL WHERE id = ?')
      .bind(newHash, userId).run()

    // Return a fresh token + updated user so client can update state immediately
    // without requiring a page reload (avoids stale must_change_password=true in localStorage)
    const freshUser = await c.env.DB.prepare(
      'SELECT id, email, full_name, role, must_change_password FROM users WHERE id = ?'
    ).bind(userId).first<{ id: number; email: string; full_name: string; role: string; must_change_password: number }>()

    const secret    = getSecret(c.env)
    const newToken  = await signToken(secret, userId, freshUser!.email)

    return c.json({
      success: true,
      message: 'Đổi mật khẩu thành công',
      token: newToken,
      user: {
        id:                   freshUser!.id,
        email:                freshUser!.email,
        full_name:            freshUser!.full_name,
        role:                 freshUser!.role || 'user',
        must_change_password: false,   // always false after successful change
      },
    })
  } catch (err) {
    console.error('Change password error:', err)
    return c.json({ error: 'Internal server error' }, 500)
  }
})

// ── GET /api/auth/me ──────────────────────────────────────────────────────────
// Returns the current user from DB (always fresh — no stale localStorage data).
// Used by useAuth on app start to get real must_change_password status.
auth.get('/me', async (c) => {
  try {
    const authHeader = c.req.header('Authorization')
    if (!authHeader?.startsWith('Bearer '))
      return c.json({ error: 'NO_TOKEN' }, 401)
    const token = authHeader.slice(7)
    let userId: number
    try {
      const { payload } = await jwtVerify(token, getSecret(c.env))
      userId = payload.userId as number
    } catch {
      return c.json({ error: 'INVALID_TOKEN' }, 401)
    }
    const user = await c.env.DB.prepare(
      'SELECT id, email, full_name, role, must_change_password FROM users WHERE id = ?'
    ).bind(userId).first<{ id: number; email: string; full_name: string; role: string; must_change_password: number | null }>()
    if (!user) return c.json({ error: 'NOT_FOUND' }, 404)
    return c.json({
      user: {
        id:                   user.id,
        email:                user.email,
        full_name:            user.full_name,
        role:                 user.role || 'user',
        must_change_password: user.must_change_password === 1,
      }
    })
  } catch (err) {
    return c.json({ error: 'Internal server error' }, 500)
  }
})

export default auth
