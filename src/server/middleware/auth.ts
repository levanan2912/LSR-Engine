import { Context, Next } from 'hono'
import { jwtVerify } from 'jose'

export interface JWTPayload {
  userId: number
  email: string
}

export async function authMiddleware(c: Context, next: Next) {
  const authHeader = c.req.header('Authorization')

  // ── No token at all ────────────────────────────────────────────────────────
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'NO_TOKEN' }, 401)
  }

  const token = authHeader.slice(7)
  if (!token) {
    return c.json({ error: 'NO_TOKEN' }, 401)
  }

  const jwtSecret = c.env?.JWT_SECRET || 'studysignal-dev-secret-key-2024'

  try {
    const secret = new TextEncoder().encode(jwtSecret)
    const { payload } = await jwtVerify(token, secret)

    // PHẢI dùng payload.userId (số nguyên từ JWT) — không dùng email làm khóa
    c.set('userId', payload.userId as number)
    c.set('email', payload.email as string)

    await next()
  } catch {
    return c.json({ error: 'INVALID_TOKEN' }, 401)
  }
}
