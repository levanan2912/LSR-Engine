import React, { useState, useCallback, useEffect } from 'react'
import { User } from '../types'

interface Props {
  authFetch: (url: string, options?: RequestInit) => Promise<Response>
  onClose: () => void
  // Called after successful change — receives fresh token+user from backend
  onSuccess?: (token: string, user: User) => void
  theme?: 'dark' | 'light'
  // Force mode: user must change password before doing anything else
  forceMode?: boolean
  // Pre-filled temp password (from admin reset)
  tempPassword?: string
}

interface Fields { current: string; newPass: string; confirm: string }
interface ShowPass { current: boolean; newPass: boolean; confirm: boolean }
interface Errs { current: string; newPass: string; confirm: string; general: string }
const EMPTY_ERR: Errs = { current: '', newPass: '', confirm: '', general: '' }


export default function ChangePasswordModal({ authFetch, onClose, onSuccess, theme = 'dark', forceMode = false, tempPassword = '' }: Props) {
  const isDark = theme === 'dark'

  // In force mode: current password is pre-filled and hidden
  const [fields,   setFields]   = useState<Fields>({ current: tempPassword, newPass: '', confirm: '' })
  const [showPass, setShowPass] = useState<ShowPass>({ current: false, newPass: false, confirm: false })
  const [errs,     setErrs]     = useState<Errs>(EMPTY_ERR)
  const [loading,  setLoading]  = useState(false)
  const [success,  setSuccess]  = useState(false)

  // Sync tempPassword if it arrives after mount
  useEffect(() => {
    if (tempPassword) setFields(f => ({ ...f, current: tempPassword }))
  }, [tempPassword])

  const set = (k: keyof Fields) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setFields(f => ({ ...f, [k]: e.target.value }))
    setErrs(err => ({ ...err, [k === 'newPass' ? 'newPass' : k]: '', general: '' }))
  }

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    setErrs(EMPTY_ERR)

    if (!fields.current) { setErrs(err => ({ ...err, current: 'Thiếu mật khẩu hiện tại' })); return }
    if (!fields.newPass)  { setErrs(err => ({ ...err, newPass: 'Vui lòng nhập mật khẩu mới' })); return }
    if (fields.newPass.length < 6) { setErrs(err => ({ ...err, newPass: 'Mật khẩu mới phải có ít nhất 6 ký tự' })); return }
    if (fields.newPass !== fields.confirm) { setErrs(err => ({ ...err, confirm: 'Mật khẩu xác nhận không khớp' })); return }
    if (fields.newPass === fields.current) { setErrs(err => ({ ...err, newPass: 'Mật khẩu mới không được trùng mật khẩu tạm' })); return }

    setLoading(true)
    try {
      const res = await authFetch('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ current_password: fields.current, new_password: fields.newPass, confirm_password: fields.confirm }),
      })
      const data = await res.json() as Record<string, unknown>
      if (!res.ok) {
        const field = data.field as string | undefined
        const msg   = (data.message as string) || 'Đã xảy ra lỗi'
        if (field === 'current_password') setErrs(err => ({ ...err, current: msg }))
        else if (field === 'new_password') setErrs(err => ({ ...err, newPass: msg }))
        else if (field === 'confirm_password') setErrs(err => ({ ...err, confirm: msg }))
        else setErrs(err => ({ ...err, general: msg }))
        return
      }
      setSuccess(true)
      // If backend returned fresh token+user, call onSuccess to update state in-place
      // (avoids stale must_change_password flag in localStorage after reload)
      if (data.token && data.user && onSuccess) {
        setTimeout(() => onSuccess(data.token as string, data.user as User), 1200)
      } else {
        setTimeout(onClose, 1800)
      }
    } catch {
      setErrs(err => ({ ...err, general: 'Không thể kết nối đến máy chủ' }))
    } finally {
      setLoading(false)
    }
  }, [fields, authFetch, onClose])

  // ── Styles ──────────────────────────────────────────────────────────────────
  const overlay: React.CSSProperties = {
    position: 'fixed', inset: 0,
    background: forceMode ? (isDark ? '#020617' : '#f1f5f9') : 'rgba(0,0,0,0.6)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 9999, padding: '20px',
    backdropFilter: forceMode ? 'none' : 'blur(4px)',
  }
  const card: React.CSSProperties = {
    background: isDark ? '#1e293b' : '#ffffff',
    border: `1px solid ${isDark ? '#334155' : '#d0daea'}`,
    borderRadius: '14px', width: '100%', maxWidth: '420px',
    boxShadow: isDark ? '0 16px 60px rgba(0,0,0,0.6)' : '0 8px 40px rgba(15,23,42,0.15)',
    overflow: 'hidden',
  }
  const inputStyle = (hasErr: boolean): React.CSSProperties => ({
    width: '100%', padding: '9px 36px 9px 12px', borderRadius: '8px',
    border: `1px solid ${hasErr ? '#ef4444' : isDark ? '#334155' : '#b8c5d8'}`,
    background: isDark ? '#0f172a' : '#f8fafc',
    color: isDark ? '#e2e8f0' : '#0f172a',
    fontSize: '13px', outline: 'none', boxSizing: 'border-box',
    fontFamily: 'Space Grotesk, sans-serif',
  })
  const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: '11px', fontWeight: 700,
    color: isDark ? '#94a3b8' : '#334155',
    marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '0.5px',
    fontFamily: 'Space Grotesk, sans-serif',
  }
  const EyeBtn = ({ field }: { field: keyof ShowPass }) => (
    <button type="button" onClick={() => setShowPass(s => ({ ...s, [field]: !s[field] }))}
      style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: isDark ? '#64748b' : '#94a3b8', fontSize: '14px', padding: '2px' }}>
      {showPass[field] ? '🙈' : '👁️'}
    </button>
  )
  const Req = ({ text }: { text: string }) => (
    <span style={{ color: '#f87171', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px', marginTop: '3px' }}>⚠ {text}</span>
  )

  return (
    // forceMode: không cho click ra ngoài để đóng
    <div style={overlay} onClick={e => { if (!forceMode && e.target === e.currentTarget) onClose() }}>
      <div style={card}>

        {/* Header */}
        <div style={{ padding: '18px 22px', borderBottom: `1px solid ${isDark ? '#334155' : '#e2e8f0'}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: '15px', fontWeight: 700, color: isDark ? '#f1f5f9' : '#0f172a', fontFamily: 'Space Grotesk, sans-serif' }}>
              {forceMode ? '🔑 Đặt mật khẩu mới' : '🔐 Đổi mật khẩu'}
            </div>
            <div style={{ fontSize: '11px', color: isDark ? '#64748b' : '#94a3b8', marginTop: '2px', fontFamily: 'Space Grotesk, sans-serif' }}>
              {forceMode
                ? 'Mật khẩu tạm thời của bạn đã được điền sẵn. Hãy đặt mật khẩu mới để tiếp tục.'
                : 'Bảo mật tài khoản của bạn'}
            </div>
          </div>
          {/* Hide X button in force mode */}
          {!forceMode && (
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: isDark ? '#64748b' : '#94a3b8', fontSize: '20px', cursor: 'pointer', lineHeight: 1, padding: '2px 6px' }}>×</button>
          )}
        </div>

        {/* Force mode warning banner */}
        {forceMode && (
          <div style={{ padding: '10px 22px', background: 'rgba(245,158,11,0.1)', borderBottom: `1px solid rgba(245,158,11,0.25)` }}>
            <div style={{ fontSize: '12px', color: '#f59e0b', fontWeight: 600, fontFamily: 'Space Grotesk, sans-serif', display: 'flex', alignItems: 'center', gap: '6px' }}>
              ⚠️ Bạn đang dùng mật khẩu tạm — vui lòng đặt mật khẩu mới để tiếp tục sử dụng.
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ padding: '20px 22px' }} noValidate>

          {/* Success banner */}
          {success && (
            <div style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.35)', borderRadius: '8px', padding: '10px 14px', marginBottom: '16px', color: '#10b981', fontSize: '13px', fontWeight: 600, textAlign: 'center', fontFamily: 'Space Grotesk, sans-serif' }}>
              ✅ Đặt mật khẩu mới thành công! Đang chuyển hướng...
            </div>
          )}

          {/* General error */}
          {errs.general && (
            <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', padding: '9px 12px', marginBottom: '14px', color: '#f87171', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              ⚠ {errs.general}
            </div>
          )}

          {/* Current password — readonly in force mode, visible as read-only info */}
          {forceMode ? (
            <div style={{ marginBottom: '14px', padding: '10px 12px', background: isDark ? 'rgba(99,102,241,0.08)' : 'rgba(99,102,241,0.06)', border: `1px solid ${isDark ? 'rgba(99,102,241,0.25)' : 'rgba(99,102,241,0.2)'}`, borderRadius: '8px' }}>
              <div style={{ fontSize: '10px', fontWeight: 700, color: isDark ? '#818cf8' : '#6366f1', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px', fontFamily: 'Space Grotesk, sans-serif' }}>
                Mật khẩu tạm thời (tự động điền)
              </div>
              <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '15px', fontWeight: 700, color: isDark ? '#f59e0b' : '#d97706', letterSpacing: '2px' }}>
                {tempPassword || fields.current}
              </div>
              {/* Hidden input so the form value is submitted */}
              <input type="hidden" value={fields.current} readOnly />
            </div>
          ) : (
            <div style={{ marginBottom: '14px' }}>
              <label style={labelStyle}>Mật khẩu hiện tại</label>
              <div style={{ position: 'relative' }}>
                <input type={showPass.current ? 'text' : 'password'} value={fields.current}
                  onChange={set('current')} placeholder="Mật khẩu đang dùng" disabled={loading || success}
                  autoComplete="current-password" style={inputStyle(!!errs.current)} />
                <EyeBtn field="current" />
              </div>
              {errs.current && <Req text={errs.current} />}
            </div>
          )}

          {/* New password */}
          <div style={{ marginBottom: '14px' }}>
            <label style={labelStyle}>Mật khẩu mới</label>
            <div style={{ position: 'relative' }}>
              <input type={showPass.newPass ? 'text' : 'password'} value={fields.newPass}
                onChange={set('newPass')} placeholder="Ít nhất 6 ký tự" disabled={loading || success}
                autoFocus={forceMode} autoComplete="new-password" style={inputStyle(!!errs.newPass)} />
              <EyeBtn field="newPass" />
            </div>
            {errs.newPass && <Req text={errs.newPass} />}
          </div>

          {/* Confirm password */}
          <div style={{ marginBottom: '20px' }}>
            <label style={labelStyle}>Xác nhận mật khẩu mới</label>
            <div style={{ position: 'relative' }}>
              <input type={showPass.confirm ? 'text' : 'password'} value={fields.confirm}
                onChange={set('confirm')} placeholder="Nhập lại mật khẩu mới" disabled={loading || success}
                autoComplete="new-password" style={inputStyle(!!errs.confirm)} />
              <EyeBtn field="confirm" />
            </div>
            {errs.confirm && <Req text={errs.confirm} />}
          </div>

          {/* Submit */}
          <button type="submit" disabled={loading || success} style={{
            width: '100%', padding: '10px', border: 'none', borderRadius: '8px',
            background: loading || success ? (isDark ? '#334155' : '#e2e8f0') : '#6366f1',
            color: loading || success ? (isDark ? '#64748b' : '#94a3b8') : '#ffffff',
            fontSize: '13px', fontWeight: 700, cursor: loading || success ? 'not-allowed' : 'pointer',
            transition: 'all 0.2s', fontFamily: 'Space Grotesk, sans-serif', letterSpacing: '0.2px',
          }}>
            {loading ? '⏳ Đang xử lý...' : success ? '✅ Thành công' : forceMode ? '🔑 Xác nhận & Tiếp tục' : '🔐 Xác nhận đổi mật khẩu'}
          </button>

          {/* Cancel button — hidden in force mode */}
          {!forceMode && (
            <button type="button" onClick={onClose} disabled={loading} style={{
              width: '100%', padding: '8px', marginTop: '8px', border: `1px solid ${isDark ? '#334155' : '#d0daea'}`,
              borderRadius: '8px', background: 'transparent',
              color: isDark ? '#64748b' : '#94a3b8', fontSize: '12px', cursor: loading ? 'not-allowed' : 'pointer',
              fontFamily: 'Space Grotesk, sans-serif',
            }}>Hủy</button>
          )}
        </form>
      </div>
    </div>
  )
}
