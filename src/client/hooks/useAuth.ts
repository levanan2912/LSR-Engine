import { useState, useEffect, useCallback, useRef } from 'react'
import { User } from '../types'

export interface AuthError { field: 'email' | 'password' | 'general'; message: string }

export class AuthApiError extends Error {
  field: AuthError['field']
  constructor({ field, message }: AuthError) {
    super(message)
    this.field = field
    this.name = 'AuthApiError'
  }
}

const TOKEN_KEY = 'lsr_token'
const USER_KEY  = 'lsr_user'

// ── Fetch fresh user from DB via /api/auth/me ─────────────────────────────────
// Trả về user thực từ DB (kể cả must_change_password mới nhất).
// Trả về null nếu token hết hạn / không hợp lệ.
async function fetchMe(token: string): Promise<User | null> {
  try {
    const res = await fetch('/api/auth/me', {
      headers: { 'Authorization': `Bearer ${token}` },
    })
    if (!res.ok) return null          // 401 / 404 → token bad hoặc user không tồn tại
    const data = await res.json() as { user: User }
    return data.user ?? null
  } catch {
    // Network error — trả null để fallback dùng localStorage
    return null
  }
}

export function useAuth() {
  const [user,    setUser]    = useState<User | null>(null)
  const [token,   setToken]   = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // Ref so authFetch always has fresh token without needing re-creation
  const tokenRef = useRef<string | null>(null)

  // ── Restore session on mount ─────────────────────────────────────────────
  useEffect(() => {
    const restore = async () => {
      try {
        const t = localStorage.getItem(TOKEN_KEY)
        if (t) {
          // Fetch user trực tiếp từ DB — luôn có must_change_password chính xác
          // Không đọc user từ localStorage để tránh stale data
          const freshUser = await fetchMe(t)
          if (freshUser) {
            setToken(t)
            tokenRef.current = t
            setUser(freshUser)
            // Cập nhật localStorage với user mới nhất từ DB
            localStorage.setItem(USER_KEY, JSON.stringify(freshUser))
          } else {
            // Token hết hạn / không hợp lệ — dọn dẹp
            localStorage.removeItem(TOKEN_KEY)
            localStorage.removeItem(USER_KEY)
          }
        }
      } catch {
        localStorage.removeItem(TOKEN_KEY)
        localStorage.removeItem(USER_KEY)
      } finally {
        setLoading(false)
      }
    }
    restore()
  }, [])

  // Keep tokenRef in sync whenever token state changes
  useEffect(() => {
    tokenRef.current = token
  }, [token])

  const apiCall = async (path: string, body: Record<string, unknown>) => {
    const res  = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const data = await res.json()
    if (!res.ok) throw new AuthApiError({ field: data.field ?? 'general', message: data.message ?? data.error ?? 'Lỗi không xác định' })
    localStorage.setItem(TOKEN_KEY, data.token)
    localStorage.setItem(USER_KEY,  JSON.stringify(data.user))
    setToken(data.token)
    tokenRef.current = data.token
    setUser(data.user)
    return data
  }

  const login = async (email: string, password: string) => {
    const data = await apiCall('/api/auth/login', { email: email.trim(), password })
    // If admin reset password, store temp password in sessionStorage for force-change screen
    if (data.user?.must_change_password) {
      sessionStorage.setItem('lsr_temp_pw', password)
    } else {
      sessionStorage.removeItem('lsr_temp_pw')
    }
    return data
  }

  // register: chỉ tạo tài khoản, KHÔNG tự động đăng nhập — trả về data thô
  const register = async (email: string, password: string, full_name: string) => {
    const res  = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim(), password, full_name }),
    })
    const data = await res.json()
    if (!res.ok) throw new AuthApiError({ field: data.field ?? 'general', message: data.message ?? data.error ?? 'Lỗi không xác định' })
    // Không lưu token / user — người dùng cần đăng nhập thủ công
    return data
  }

  // updateUser: dùng sau change-password để cập nhật state + localStorage ngay lập tức
  // mà không cần reload — tránh stale must_change_password=true từ localStorage cũ
  const updateUser = useCallback((newUser: User, newToken: string) => {
    localStorage.setItem(TOKEN_KEY, newToken)
    localStorage.setItem(USER_KEY,  JSON.stringify(newUser))
    setToken(newToken)
    tokenRef.current = newToken
    setUser(newUser)
    sessionStorage.removeItem('lsr_temp_pw')
  }, [])

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
    tokenRef.current = null
    setToken(null)
    setUser(null)
  }, [])

  // authFetch: uses tokenRef so it always reads the latest token
  // Auto-logout on 401 (expired / invalid token) so user is prompted to log in again
  const authFetch = useCallback(async (url: string, options: RequestInit = {}): Promise<Response> => {
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenRef.current ?? ''}`,
        ...(options.headers ?? {}),
      },
    })

    // Auto-logout on authentication failure — token expired or invalid
    if (res.status === 401) {
      let body: Record<string, unknown> = {}
      try { body = await res.clone().json() } catch { /* ignore parse errors */ }
      if (body.error === 'INVALID_TOKEN' || body.error === 'NO_TOKEN') {
        console.warn('[useAuth] Token invalid/expired — logging out automatically')
        logout()
      }
    }

    return res
  }, [logout])

  return { user, token, loading, login, register, logout, authFetch, updateUser }
}
