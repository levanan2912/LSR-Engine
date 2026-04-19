import React, { useState, useEffect } from 'react'
import { AuthApiError } from '../hooks/useAuth'
import { Theme } from '../hooks/useTheme'

interface AuthPageProps {
  onLogin: (email: string, password: string) => Promise<unknown>
  onRegister: (email: string, password: string, fullName: string) => Promise<unknown>
  theme: Theme
  onToggleTheme: () => void
}

interface FormErrors {
  email: string
  password: string
  confirmPassword: string
  general: string
}
const EMPTY: FormErrors = { email: '', password: '', confirmPassword: '', general: '' }

const REMEMBER_KEY  = 'lsr_remembered'
const LAST_EMAIL_KEY = 'lsr_last_email'

export default function AuthPage({ onLogin, onRegister, theme, onToggleTheme }: AuthPageProps) {
  const isDark = theme === 'dark'

  const [mode,            setMode]            = useState<'login' | 'register'>('login')
  const [email,           setEmail]           = useState('')
  const [password,        setPassword]        = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [fullName,        setFullName]        = useState('')
  const [remember,        setRemember]        = useState(false)
  const [errors,          setErrors]          = useState<FormErrors>(EMPTY)
  const [loading,         setLoading]         = useState(false)
  const [showPass,        setShowPass]        = useState(false)
  const [showConfirm,     setShowConfirm]     = useState(false)
  // Banner hiển thị sau khi đăng ký thành công
  const [successBanner,   setSuccessBanner]   = useState('')

  // Load remembered credentials on mount
  useEffect(() => {
    try {
      // Luôn khôi phục email lần cuối đăng nhập
      const lastEmail = localStorage.getItem(LAST_EMAIL_KEY)
      if (lastEmail) setEmail(lastEmail)

      // Nếu đã tick "ghi nhớ" → khôi phục cả password
      const saved = localStorage.getItem(REMEMBER_KEY)
      if (saved) {
        const { email: savedEmail, password: savedPassword } = JSON.parse(saved)
        if (savedEmail) setEmail(savedEmail)
        if (savedPassword) { setPassword(atob(savedPassword)); setRemember(true) }
      }
    } catch {}
  }, [])

  const switchMode = (m: 'login' | 'register') => {
    setMode(m)
    setErrors(EMPTY)
    setSuccessBanner('')
    setPassword('')
    setConfirmPassword('')
  }

  const applyError = (err: unknown) => {
    if (err instanceof AuthApiError) {
      setErrors({
        email:           err.field === 'email'    ? err.message : '',
        password:        err.field === 'password' ? err.message : '',
        confirmPassword: '',
        general:         err.field === 'general'  ? err.message : '',
      })
    } else {
      setErrors({ ...EMPTY, general: 'Không thể kết nối đến máy chủ' })
    }
  }

  // ── Handlers ─────────────────────────────────────────────────────────────
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrors(EMPTY)
    setLoading(true)
    try {
      await onLogin(email, password)
      // Luôn lưu email lần cuối đăng nhập
      localStorage.setItem(LAST_EMAIL_KEY, email)
      // Nếu tick "ghi nhớ" → lưu cả password (base64 obfuscate, không phải mã hoá)
      if (remember) {
        localStorage.setItem(REMEMBER_KEY, JSON.stringify({ email, password: btoa(password) }))
      } else {
        localStorage.removeItem(REMEMBER_KEY)
      }
    } catch (err) { applyError(err) } finally { setLoading(false) }
  }

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrors(EMPTY)

    // Client-side: xác nhận mật khẩu
    if (password !== confirmPassword) {
      setErrors({ ...EMPTY, confirmPassword: 'Mật khẩu xác nhận không khớp' })
      return
    }
    if (password.length < 6) {
      setErrors({ ...EMPTY, password: 'Mật khẩu phải có ít nhất 6 ký tự' })
      return
    }

    setLoading(true)
    try {
      await onRegister(email, password, fullName)
      // Đăng ký thành công → chuyển về trang đăng nhập, hiện banner
      setSuccessBanner('🎉 Tạo tài khoản thành công! Vui lòng đăng nhập.')
      setMode('login')
      setPassword('')
      setConfirmPassword('')
    } catch (err) { applyError(err) } finally { setLoading(false) }
  }

  const isLogin = mode === 'login'

  // ── Dynamic styles ────────────────────────────────────────────────────────
  const pageBg: React.CSSProperties = {
    minHeight: '100vh',
    background: isDark
      ? 'linear-gradient(135deg, #020617 0%, #0f0a2e 40%, #0c1a3a 70%, #060e1a 100%)'
      : 'linear-gradient(135deg, #dce3ef 0%, #c9d3e4 50%, #d1dae8 100%)',
    display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
    paddingTop: '10vh', paddingBottom: '24px',
    paddingLeft: '24px', paddingRight: '24px',
    transition: 'background 0.25s',
  }

  const cardBg: React.CSSProperties = {
    background: isDark ? '#111827' : '#ffffff',
    border: `1px solid ${isDark ? '#1e293b' : '#d0daea'}`,
    borderRadius: '12px',
    padding: '32px',
    width: '100%', maxWidth: '440px',
    boxShadow: isDark ? '0 8px 40px rgba(0,0,0,0.5)' : '0 4px 24px rgba(15,23,42,0.10)',
    transition: 'background 0.25s, border-color 0.25s',
  }

  const labelStyle: React.CSSProperties = {
    display: 'block',
    color: isDark ? '#94a3b8' : '#334155',
    fontSize: '12px', fontWeight: '600',
    marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px',
  }

  const inputStyle = (err: boolean): React.CSSProperties => ({
    width: '100%', padding: '10px 12px',
    background: isDark ? '#0f172a' : '#f8fafc',
    border: `1px solid ${err ? '#ef4444' : (isDark ? '#334155' : '#b8c5d8')}`,
    borderRadius: '8px',
    color: isDark ? '#e2e8f0' : '#0f172a',
    fontSize: '14px', outline: 'none', boxSizing: 'border-box',
    transition: 'border-color 0.2s, background 0.2s',
  })

  const tabStyle = (active: boolean): React.CSSProperties => ({
    flex: 1, padding: '8px', borderRadius: '6px', border: 'none',
    background: active ? (isDark ? '#1e3a5f' : '#dbeafe') : 'transparent',
    color: active ? '#3b82f6' : (isDark ? '#64748b' : '#64748b'),
    fontWeight: active ? '600' : '400',
    cursor: 'pointer', fontSize: '14px', transition: 'all 0.2s',
  })

  const subTextColor = isDark ? '#64748b' : '#94a3b8'
  const footerColor  = isDark ? '#475569' : '#94a3b8'

  // Eye-toggle button (dùng chung)
  const eyeBtn = (show: boolean, onToggle: () => void) => (
    <button
      type="button"
      onClick={onToggle}
      aria-label={show ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
      style={{
        position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)',
        background: 'none', border: 'none', cursor: 'pointer',
        color: isDark ? '#64748b' : '#94a3b8', fontSize: '14px', padding: '2px',
      }}
    >{show ? '🙈' : '👁️'}</button>
  )

  return (
    <>
      {/* ── Nút tối/sáng cố định góc trên phải ── */}
      <div style={{ position: 'fixed', top: '16px', right: '20px', zIndex: 9999 }}>
        <button
          type="button"
          onClick={onToggleTheme}
          aria-label={isDark ? 'Chuyển sang chế độ sáng' : 'Chuyển sang chế độ tối'}
          title={isDark ? 'Chế độ sáng' : 'Chế độ tối'}
          style={{
            padding: '7px 14px', borderRadius: '20px',
            border: `1px solid ${isDark ? '#334155' : '#b8c5d8'}`,
            background: isDark ? 'rgba(15,23,42,0.85)' : 'rgba(255,255,255,0.90)',
            backdropFilter: 'blur(12px)',
            color: isDark ? '#94a3b8' : '#475569',
            fontSize: '12px', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: '6px',
            transition: 'all 0.2s',
            fontFamily: 'Space Grotesk, sans-serif', fontWeight: 600,
            boxShadow: isDark ? '0 2px 12px rgba(0,0,0,0.4)' : '0 2px 8px rgba(15,23,42,0.10)',
          }}
        >
          {isDark ? '☀️' : '🌙'} {isDark ? 'Sáng' : 'Tối'}
        </button>
      </div>

      <div style={pageBg}>
        <div style={{ width: '100%', maxWidth: '440px' }}>

          {/* Logo */}
          <div style={{ textAlign: 'center', marginBottom: '32px' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
              <div style={{
                width: '42px', height: '42px', background: '#3b82f6',
                borderRadius: '10px', display: 'flex', alignItems: 'center',
                justifyContent: 'center', fontSize: '22px',
              }}>📡</div>
              <span style={{ fontSize: '26px', fontWeight: '700', letterSpacing: '-0.5px', color: isDark ? '#e2e8f0' : '#0f172a' }}>LSR</span>
            </div>
            <p style={{ color: subTextColor, fontSize: '14px', fontFamily: 'Inter, sans-serif' }}>
              AI-powered learning behavior analytics
            </p>
          </div>

          <div style={cardBg}>
            {/* Tabs */}
            <div style={{
              display: 'flex',
              background: isDark ? '#0f172a' : '#f1f5f9',
              borderRadius: '8px', padding: '4px', marginBottom: '24px',
            }}>
              <button type="button" onClick={() => switchMode('login')}    style={tabStyle(isLogin)}>Đăng Nhập</button>
              <button type="button" onClick={() => switchMode('register')} style={tabStyle(!isLogin)}>Tạo Tài Khoản</button>
            </div>

            {/* Success banner (sau đăng ký) */}
            {successBanner && (
              <div style={{
                background: 'rgba(34,197,94,0.10)', border: '1px solid rgba(34,197,94,0.35)',
                borderRadius: '8px', padding: '10px 14px', marginBottom: '16px',
                color: '#22c55e', fontSize: '13px', fontWeight: 600,
                display: 'flex', alignItems: 'center', gap: '8px',
                fontFamily: 'Space Grotesk, sans-serif',
              }}>
                <span>{successBanner}</span>
              </div>
            )}

            {/* General error */}
            {errors.general && (
              <div style={{
                background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
                borderRadius: '6px', padding: '10px 12px', marginBottom: '16px',
                color: '#f87171', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px',
              }}><span>⚠</span><span>{errors.general}</span></div>
            )}

            {/* ── Login Form ── */}
            {isLogin && (
              <form onSubmit={handleLogin} noValidate>

                {/* Email */}
                <div style={{ marginBottom: '16px' }}>
                  <label style={labelStyle}>Địa Chỉ Email</label>
                  <input
                    type="email" value={email} required disabled={loading}
                    autoComplete="email"
                    placeholder="email@example.com"
                    onChange={e => { setEmail(e.target.value); if (errors.email) setErrors(p => ({ ...p, email: '' })) }}
                    style={inputStyle(!!errors.email)}
                  />
                  {errors.email && <p style={errText}><span>⚠</span><span>{errors.email}</span></p>}
                </div>

                {/* Password */}
                <div style={{ marginBottom: '16px' }}>
                  <label style={labelStyle}>Mật Khẩu</label>
                  <div style={{ position: 'relative' }}>
                    <input
                      type={showPass ? 'text' : 'password'}
                      value={password} required disabled={loading}
                      autoComplete="current-password"
                      placeholder="password"
                      onChange={e => { setPassword(e.target.value); if (errors.password) setErrors(p => ({ ...p, password: '' })) }}
                      style={{ ...inputStyle(!!errors.password), paddingRight: '40px' }}
                    />
                    {eyeBtn(showPass, () => setShowPass(p => !p))}
                  </div>
                  {errors.password && <p style={errText}><span>⚠</span><span>{errors.password}</span></p>}
                </div>

                {/* Remember Me */}
                <div style={{ marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input
                    type="checkbox" id="remember-me"
                    checked={remember} disabled={loading}
                    onChange={e => setRemember(e.target.checked)}
                    style={{ width: '15px', height: '15px', accentColor: '#3b82f6', cursor: loading ? 'not-allowed' : 'pointer', flexShrink: 0 }}
                  />
                  <label htmlFor="remember-me" style={{ fontSize: '13px', color: isDark ? '#94a3b8' : '#475569', cursor: loading ? 'not-allowed' : 'pointer', userSelect: 'none' }}>
                    Ghi nhớ mật khẩu
                  </label>
                </div>

                <button type="submit" disabled={loading} style={submitBtn(loading)}>
                  {loading ? 'Đang xử lý...' : 'Đăng Nhập'}
                </button>

                {/* Forgot password note */}
                <p style={{ textAlign: 'center', fontSize: '12px', color: isDark ? '#64748b' : '#94a3b8', marginTop: '14px', fontFamily: 'Inter, sans-serif', lineHeight: 1.5 }}>
                  Quên mật khẩu? Liên hệ Admin qua Email:{' '}
                  <a href="mailto:kingminer5826@gmail.com" style={{ color: isDark ? '#818cf8' : '#6366f1', textDecoration: 'none', fontWeight: 600 }}>
                    kingminer5826@gmail.com
                  </a>
                </p>
              </form>
            )}

            {/* ── Register Form ── */}
            {!isLogin && (
              <form onSubmit={handleRegister} noValidate>

                {/* Họ và Tên */}
                <div style={{ marginBottom: '16px' }}>
                  <label style={labelStyle}>Họ và Tên</label>
                  <input
                    type="text" value={fullName} disabled={loading}
                    autoComplete="name"
                    placeholder="Nguyễn Văn A"
                    onChange={e => setFullName(e.target.value)}
                    style={inputStyle(false)}
                  />
                </div>

                {/* Email */}
                <div style={{ marginBottom: '16px' }}>
                  <label style={labelStyle}>Địa Chỉ Email</label>
                  <input
                    type="email" value={email} required disabled={loading}
                    autoComplete="email"
                    placeholder="email@example.com"
                    onChange={e => { setEmail(e.target.value); if (errors.email) setErrors(p => ({ ...p, email: '' })) }}
                    style={inputStyle(!!errors.email)}
                  />
                  {errors.email && <p style={errText}><span>⚠</span><span>{errors.email}</span></p>}
                </div>

                {/* Password */}
                <div style={{ marginBottom: '14px' }}>
                  <label style={labelStyle}>Mật Khẩu</label>
                  <div style={{ position: 'relative' }}>
                    <input
                      type={showPass ? 'text' : 'password'}
                      value={password} required disabled={loading}
                      autoComplete="new-password"
                      placeholder="Ít nhất 6 ký tự"
                      onChange={e => { setPassword(e.target.value); if (errors.password) setErrors(p => ({ ...p, password: '' })) }}
                      style={{ ...inputStyle(!!errors.password), paddingRight: '40px' }}
                    />
                    {eyeBtn(showPass, () => setShowPass(p => !p))}
                  </div>
                  {errors.password && <p style={errText}><span>⚠</span><span>{errors.password}</span></p>}
                </div>

                {/* Confirm Password */}
                <div style={{ marginBottom: '24px' }}>
                  <label style={labelStyle}>Xác Nhận Mật Khẩu</label>
                  <div style={{ position: 'relative' }}>
                    <input
                      type={showConfirm ? 'text' : 'password'}
                      value={confirmPassword} required disabled={loading}
                      autoComplete="new-password"
                      placeholder="Nhập lại mật khẩu"
                      onChange={e => { setConfirmPassword(e.target.value); if (errors.confirmPassword) setErrors(p => ({ ...p, confirmPassword: '' })) }}
                      style={{ ...inputStyle(!!errors.confirmPassword), paddingRight: '40px' }}
                    />
                    {eyeBtn(showConfirm, () => setShowConfirm(p => !p))}
                  </div>
                  {errors.confirmPassword && <p style={errText}><span>⚠</span><span>{errors.confirmPassword}</span></p>}
                </div>

                <button type="submit" disabled={loading} style={submitBtn(loading)}>
                  {loading ? 'Đang xử lý...' : 'Tạo Tài Khoản'}
                </button>
              </form>
            )}
          </div>

          <p style={{ textAlign: 'center', color: footerColor, fontSize: '12px', marginTop: '24px', fontFamily: 'Inter, sans-serif' }}>
            LSR Engine · Learning Stability Risk Engine
          </p>
        </div>

        <style>{`
          input:focus { outline: 2px solid #3b82f6 !important; outline-offset: 0 !important; }
          button:focus-visible { outline: 2px solid #3b82f6; outline-offset: 2px; }
        `}</style>
      </div>
    </>
  )
}

// ── Shared styles ─────────────────────────────────────────────────────────────
const errText: React.CSSProperties = {
  color: '#f87171', fontSize: '12px', marginTop: '5px',
  display: 'flex', alignItems: 'center', gap: '4px',
}

const submitBtn = (loading: boolean): React.CSSProperties => ({
  width: '100%', padding: '12px', border: 'none', borderRadius: '8px',
  color: '#ffffff', fontSize: '14px', fontWeight: '600',
  cursor: loading ? 'not-allowed' : 'pointer',
  background: loading ? '#374151' : '#3b82f6',
  letterSpacing: '0.3px', transition: 'background 0.2s',
})
