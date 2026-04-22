import React, { useState, useEffect, useCallback, useRef } from 'react'
import { User, DailyEntry, AnalysisReport, EntryFormData } from '../types'
import EntryForm, { EntryFormRef } from '../components/EntryForm'
import { ToastContainer, useToast } from '../components/Toast'
import DuplicateModal, { TodaySession } from '../components/DuplicateModal'
import ChangePasswordModal from '../components/ChangePasswordModal'
import ChatBot from '../components/ChatBot'
import ResultSlide from '../components/ResultSlide'

interface DashboardProps {
  user: User
  authFetch: (url: string, options?: RequestInit) => Promise<Response>
  onLogout: () => void
  onNavigate: (page: 'dashboard' | 'history' | 'forum') => void
  currentPage: string
  theme?: 'dark' | 'light'
  onToggleTheme?: () => void
}

// ── Model palette ──────────────────────────────────────────────────────────────
const MODEL_COLOR: Record<string, string> = {
  'gemini-2.5-flash':              '#818cf8',
  'gemini-3.1-flash-lite-preview': '#22d3ee',
  'gemini-2.0-flash':              '#34d399',
  'gemini-2.0-flash-exp':          '#34d399',
}

// ── AI Status Bar ──────────────────────────────────────────────────────────────
type AIPhase = 'ready' | 'analyzing' | 'done'
interface AIStatus { phase: AIPhase; modelName?: string; keyName?: string; latencyMs?: number }

function AIStatusBar({ status }: { status: AIStatus }) {
  const { phase, modelName, keyName, latencyMs } = status
  const rawModel = modelName?.replace('_success', '').trim() ?? ''
  const color = phase === 'analyzing' ? '#f59e0b' : phase === 'done' ? (MODEL_COLOR[rawModel] ?? '#818cf8') : '#475569'
  const text = phase === 'analyzing'
    ? 'AI · Đang phân tích…'
    : phase === 'done' && rawModel
      ? `${keyName ? `${keyName}` : rawModel.match(/(\d+\.\d+)/)?.[1] ?? 'AI'}${latencyMs ? ` · ${(latencyMs / 1000).toFixed(1)}s` : ''}`
      : 'AI · Sẵn sàng'

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '6px',
      padding: '5px 12px',
      background: 'var(--bg-card-strong, rgba(255,255,255,0.04))',
      border: '1px solid var(--border-card, rgba(255,255,255,0.08))',
      borderRadius: '20px', flexShrink: 0,
    }}>
      <span style={{
        width: '6px', height: '6px', borderRadius: '50%', background: color, flexShrink: 0,
        boxShadow: phase !== 'ready' ? `0 0 8px ${color}` : undefined,
        animation: phase === 'analyzing' ? 'aiBlink 1s ease-in-out infinite' : undefined,
      }} />
      {phase === 'analyzing' && (
        <span style={{
          width: '9px', height: '9px', borderRadius: '50%', flexShrink: 0,
          border: '1.5px solid rgba(245,158,11,0.25)', borderTopColor: '#f59e0b',
          animation: 'spin 0.7s linear infinite', display: 'inline-block',
        }} />
      )}
      <span style={{ fontSize: '10px', fontWeight: 600, color, letterSpacing: '0.15px', fontFamily: 'JetBrains Mono, monospace', whiteSpace: 'nowrap' }}>{text}</span>
    </div>
  )
}

// ── Status Banner ──────────────────────────────────────────────────────────────
type StatusType = 'idle' | 'loading' | 'success' | 'error' | 'warning'
interface SubmitStatus { type: StatusType; message: string }

function StatusBanner({ status }: { status: SubmitStatus }) {
  if (status.type === 'idle' || !status.message) return null
  const s = {
    loading: { bg: '#2d2f6b', border: '#6366f1', color: '#c7d2fe' },
    success: { bg: '#064e3b', border: '#10b981', color: '#6ee7b7' },
    error:   { bg: '#7f1d1d', border: '#ef4444', color: '#fecaca' },
    warning: { bg: '#78350f', border: '#f59e0b', color: '#fde68a' },
    idle:    { bg: '', border: '', color: '' },
  }[status.type]
  return (
    <div style={{ marginTop: '12px', padding: '12px 16px', borderRadius: '10px', fontSize: '13px', fontWeight: 500, display: 'flex', alignItems: 'flex-start', gap: '8px', background: s.bg, border: `1px solid ${s.border}`, color: s.color, flexWrap: 'wrap' }}>
      {status.type === 'loading' && <div style={{ width: '13px', height: '13px', borderRadius: '50%', flexShrink: 0, marginTop: '2px', border: '2px solid rgba(99,102,241,0.4)', borderTopColor: '#818cf8', animation: 'spin 0.8s linear infinite' }} />}
      <span style={{ flex: 1, whiteSpace: 'pre-line' }}>{status.message}</span>
    </div>
  )
}

// ── Streak Counter ─────────────────────────────────────────────────────────────
function StreakBadge({ entries }: { entries: DailyEntry[] }) {
  const streak = React.useMemo(() => {
    if (!entries.length) return 0
    const dates = [...new Set(entries.map(e => e.session_date))].sort((a, b) => b.localeCompare(a))
    let count = 0
    const today = new Date(Date.now() + 7 * 3600000).toISOString().split('T')[0]
    let cursor = today
    for (const d of dates) {
      if (d === cursor) { count++; const dt = new Date(cursor); dt.setDate(dt.getDate() - 1); cursor = dt.toISOString().split('T')[0] }
      else if (d < cursor) break
    }
    return count
  }, [entries])

  const milestone = streak >= 30 ? 30 : streak >= 14 ? 14 : 7
  const pct = Math.min(100, (streak / milestone) * 100)

  if (!streak) return null
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 12px', background: 'rgba(251,146,60,0.08)', border: '1px solid rgba(251,146,60,0.2)', borderRadius: '20px' }}>
      <span style={{ fontSize: '14px', animation: 'flamePulse 2s ease-in-out infinite' }}>🔥</span>
      <div>
        <div style={{ fontSize: '11px', fontWeight: 700, color: '#fb923c', fontFamily: 'Space Grotesk, sans-serif' }}>{streak} ngày liên tục</div>
        <div style={{ width: '60px', height: '3px', background: 'rgba(251,146,60,0.15)', borderRadius: '2px', marginTop: '2px', overflow: 'hidden' }}>
          <div style={{ height: '100%', background: 'linear-gradient(90deg, #fb923c, #f59e0b)', borderRadius: '2px', width: `${pct}%`, transition: 'width 0.5s' }} />
        </div>
      </div>
    </div>
  )
}

// ── Section Header ─────────────────────────────────────────────────────────────
function SectionHeader({ icon, title, right }: { icon: string; title: string; right?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px', paddingBottom: '10px', borderBottom: '1px solid var(--section-border, rgba(255,255,255,0.06))' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span style={{ fontSize: '14px' }}>{icon}</span>
        <h2 style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: '12px', fontWeight: 700, color: 'var(--section-title)', textTransform: 'uppercase', letterSpacing: '0.8px', margin: 0 }}>{title}</h2>
      </div>
      {right}
    </div>
  )
}

// ── Glass Panel ────────────────────────────────────────────────────────────────
function GlassPanel({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: 'var(--bg-card, rgba(255,255,255,0.03))',
      backdropFilter: 'blur(20px)',
      border: '1px solid var(--border-card, rgba(255,255,255,0.07))',
      borderRadius: '20px', padding: '20px',
      boxShadow: 'var(--card-shadow, 0 8px 32px rgba(0,0,0,0.3))',
      ...style,
    }}>{children}</div>
  )
}

const NAV = [
  { id: 'dashboard', label: '🏠 Bảng điều khiển' },
  { id: 'history',   label: '📈 Lịch sử'  },
  { id: 'forum',     label: '💬 Diễn đàn'  },
]

// ── Dashboard ──────────────────────────────────────────────────────────────────
export default function Dashboard({ user, authFetch, onLogout, onNavigate, currentPage, theme = 'dark', onToggleTheme }: DashboardProps) {
  const isDark = theme === 'dark'
  const [showChangePass, setShowChangePass] = useState(false)
  const [entries,       setEntries]       = useState<DailyEntry[]>([])
  const [report,        setReport]        = useState<AnalysisReport | null>(null)
  const [submitting,    setSubmitting]    = useState(false)
  const [analyzing,     setAnalyzing]     = useState(false)
  const [aiStatus,      setAiStatus]      = useState<AIStatus>({ phase: 'ready' })
  const [submitStatus,  setSubmitStatus]  = useState<SubmitStatus>({ type: 'idle', message: '' })
  const [todaySessions, setTodaySessions] = useState<TodaySession[] | null>(null)
  const [sessionDate,   setSessionDate]   = useState('')
  const [showResult,    setShowResult]    = useState(false)
  const pendingData  = useRef<EntryFormData | null>(null)
  const statusTimer  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const formRef      = useRef<EntryFormRef>(null)
  const toast        = useToast()


  const loadData = useCallback(async () => {
    try {
      const [eRes, rRes] = await Promise.all([authFetch('/api/entries?limit=20'), authFetch('/api/reports/latest')])
      if (eRes.ok) setEntries((await eRes.json()).entries ?? [])
      if (rRes.ok) setReport((await rRes.json()).report ?? null)
    } catch (err) { console.error('Load error:', err) }
  }, [authFetch])

  useEffect(() => { loadData() }, [loadData])


  const showStatus = useCallback((type: StatusType, message: string, autoMs?: number) => {
    if (statusTimer.current) clearTimeout(statusTimer.current)
    statusTimer.current = null
    setSubmitStatus({ type, message })
    if (autoMs && autoMs > 0) statusTimer.current = setTimeout(() => setSubmitStatus({ type: 'idle', message: '' }), autoMs)
  }, [])

  // ── _doSubmit: inner recursive — không gọi trực tiếp, dùng submitEntry ──────
  const _doSubmit = useCallback(async (
    formData: EntryFormData,
    action: 'add_new' | 'update' | 'keep' | undefined,
    attempt: number,
  ): Promise<void> => {
    const MAX_RETRIES = 3
    const isRetry = attempt > 1

    if (!isRetry) {
      showStatus('loading', '⏳ Đang gửi và phân tích AI... (thường 5–15 giây)')
      setAnalyzing(true); setAiStatus({ phase: 'analyzing' })
    } else {
      showStatus('loading', `⏳ AI chậm, thử lại lần ${attempt}/${MAX_RETRIES}...`)
    }

    try {
      const payload: Record<string, unknown> = { ...formData }
      if (action) payload.action = action

      let res: Response
      try {
        res = await authFetch('/api/entries', { method: 'POST', body: JSON.stringify(payload) })
      } catch {
        // Network error (offline, DNS fail) — không retry vì dữ liệu chưa được gửi
        showStatus('error', '❌ Lỗi kết nối mạng. Kiểm tra internet rồi thử lại.', 10000)
        toast.error('Lỗi mạng', 'Không thể gửi dữ liệu tới server.')
        setAiStatus({ phase: 'ready' }); setAnalyzing(false)
        return
      }

      // Đọc body trước khi kiểm tra status
      let data: Record<string, unknown> = {}
      try { data = await res.json() } catch { /* body rỗng hoặc không phải JSON */ }

      // DEBUG: log để chẩn đoán lỗi AI
      console.log(`[LSR-DEBUG] POST /api/entries → HTTP ${res.status}`, {
        success: data.success,
        error: data.error,
        ai_error: data.ai_error,
        has_analysis: !!data.analysis,
        message: String(data.message ?? '').slice(0, 120),
      })

      // ── 409: hỏi user chọn hành động ─────────────────────────────────────
      if (res.status === 409 && (data.error === 'SESSION_EXISTS' || data.requires_action)) {
        setTodaySessions(data.today_sessions as TodaySession[])
        setSessionDate(data.today_sessions != null ? new Date(Date.now() + 7 * 3600000).toISOString().split('T')[0] : '')
        pendingData.current = formData
        showStatus('idle', '')
        setAnalyzing(false)
        return
      }

      // ── Lỗi client (4xx khác) — không retry ──────────────────────────────
      if (res.status === 401) {
        showStatus('error', '❌ Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.', 8000)
        toast.error('Hết phiên', 'Vui lòng đăng nhập lại để tiếp tục.')
        setAiStatus({ phase: 'ready' }); setAnalyzing(false)
        return
      }
      if (res.status === 422 && data.validation_errors) {
        const msgs = (data.validation_errors as Array<{ message: string }>).map(e => e.message).join(' · ')
        showStatus('error', `❌ ${msgs}`, 6000); toast.error('Dữ liệu không hợp lệ', msgs)
        setAiStatus({ phase: 'ready' }); setAnalyzing(false)
        return
      }

      // ── Lỗi server / AI / timeout (5xx) — retry nếu còn lượt ────────────
      if (!res.ok) {
        if (attempt < MAX_RETRIES) {
          const waitMs = res.status === 503 ? 1500 : 2000
          showStatus('loading', `⏳ AI chưa phản hồi (lần ${attempt + 1}/${MAX_RETRIES})... đang thử lại`)
          await new Promise(r => setTimeout(r, waitMs))
          return _doSubmit(formData, action, attempt + 1)
        }
        // Hết retry
        const AI_TEMP_FIX = `⚠️ AI tạm thời không khả dụng\n\nCách fix tạm thời:\n• Sử dụng kết nối mạng khác (đổi WiFi hoặc dùng 4G/5G)\n• Sử dụng VPN\n• Thử lại sau vài phút\n• Dữ liệu phiên học của bạn đã được lưu an toàn`
        showStatus('error', AI_TEMP_FIX, 5000)
        toast.error('Không thể phân tích', 'Dịch vụ AI không khả dụng. Dữ liệu đã lưu.')
        setAiStatus({ phase: 'ready' }); setAnalyzing(false)
        return
      }

      // ── AI thất bại (HTTP 207 hoặc success:false) ──
      if (res.status === 207 || data.success === false) {
        const sessionNumber = data.session_number as number
        setTodaySessions(null); pendingData.current = null
        formRef.current?.reset()
        await loadData()
        showStatus('error', `⚠️ Đã lưu phiên ${sessionNumber} nhưng AI không phản hồi\n\nCách fix tạm thời:\n• Thay đổi mạng (WiFi/4G/5G/VPN)\n• Thử lại sau vài phút\n• Dữ liệu đã được lưu an toàn`, 5000)
        toast.error('AI không phản hồi', 'Dữ liệu phiên học đã lưu an toàn.')
        setAiStatus({ phase: 'ready' }); setAnalyzing(false)
        return
      }

      // ── keep: không có gì để làm ─────────────────────────────────────────
      if (action === 'keep') {
        setTodaySessions(null); pendingData.current = null
        showStatus('success', String(data.message || '✅ Đã giữ nguyên các phiên học hiện tại'), 5000)
        toast.info('Giữ nguyên', 'Không có thay đổi.')
        setAnalyzing(false)
        return
      }

      // ── Thành công: entry + AI report đã lưu ─────────────────────────────
      setTodaySessions(null); pendingData.current = null
      formRef.current?.reset()

      const a = data.analysis as Record<string, unknown> | undefined
      const sessionNumber = data.session_number as number
      const wasUpdated    = data.was_updated as boolean

      if (a) {
        setReport({
          id:         data.entry_id as number,
          user_id:    user.id,
          entry_id:   data.entry_id as number,
          report_date: new Date(Date.now() + 7 * 3600000).toISOString().split('T')[0],
          created_at:  new Date(Date.now() + 7 * 3600000).toISOString(),
          risk_level:            String(a.risk_level            || 'Fluctuating'),
          key_signals:           Array.isArray(a.key_signals)     ? a.key_signals as string[]     : [],
          action_plan_48h:       Array.isArray(a.action_plan_48h) ? a.action_plan_48h as string[] : [],
          short_term_forecast:   String(a.short_term_forecast   || ''),
          primary_risk_driver:   String(a.primary_risk_driver   || ''),
          intervention_strategy: String(a.intervention_strategy || ''),
          monitoring_protocol:   String(a.monitoring_protocol   || ''),
          raw_ai_response:       (a.raw_ai_response as string)   ?? null,
          analyzed_by:           (a.analyzed_by as string)       ?? null,
          key_name:              (a.key_name as string)           ?? null,
        })
        setAiStatus({
          phase:     'done',
          modelName: a.analyzed_by as string ?? undefined,
          keyName:   a.key_name   as string ?? undefined,
          latencyMs: typeof a.latency === 'number' ? a.latency : undefined,
        })
      }

      const verb = wasUpdated ? 'Cập nhật' : 'Lưu'
      showStatus('success', `✅ ${verb} phiên ${sessionNumber} và phân tích AI thành công`, 5000)
      if (wasUpdated) toast.warning(`Phiên ${sessionNumber} đã cập nhật`, 'Dữ liệu cũ đã được thay thế.')
      else            toast.success(`Phiên ${sessionNumber} đã lưu`, 'Phân tích AI hoàn thành.')

      setAnalyzing(false)
      setShowResult(true)   // ← mở ResultSlide
      await loadData()

    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Request failed'
      showStatus('error', `❌ ${msg}`, 6000); toast.error('Lỗi', msg)
      setAiStatus({ phase: 'ready' }); setAnalyzing(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authFetch, loadData, toast, user.id, showStatus])

  // ── submitEntry: public API — quản lý setSubmitting, gọi _doSubmit ──────────
  const submitEntry = useCallback(async (formData: EntryFormData, action?: 'add_new' | 'update' | 'keep') => {
    setSubmitting(true)
    try {
      await _doSubmit(formData, action, 1)
    } finally {
      setSubmitting(false)
    }
  }, [_doSubmit])

  const handleAddNew = () => { const d = pendingData.current; setTodaySessions(null); if (d) submitEntry(d, 'add_new') }
  const handleUpdate = () => { const d = pendingData.current; setTodaySessions(null); if (d) submitEntry(d, 'update') }
  const handleKeep   = () => { const d = pendingData.current; setTodaySessions(null); pendingData.current = null; if (d) submitEntry(d, 'keep') }


  const displayName = user.full_name || user.email.split('@')[0]

  return (
    <div className="root-wrap" style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* ── Navbar ─────────────────────────────────────── */}
      <nav style={{
        background: 'var(--bg-nav, rgba(2,6,23,0.9))',
        backdropFilter: 'blur(20px)',
        borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.08)'}`,
        padding: '0 20px', height: '48px', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        zIndex: 100,
      }}>
        {/* Logo + Nav */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <button
            type="button"
            onClick={() => onNavigate('dashboard')}
            aria-label="Về Bảng điều khiển"
            style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', borderRadius: '6px' }}
          >
            <span style={{ fontSize: '16px', filter: 'drop-shadow(0 0 6px rgba(99,102,241,0.6))' }}>📡</span>
            <span className="nav-logo-text" style={{
              fontFamily: 'Space Grotesk, sans-serif', fontSize: '14px', fontWeight: 700,
              background: 'linear-gradient(90deg, #22d3ee, #818cf8, #a855f7)',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
              backgroundClip: 'text', letterSpacing: '-0.3px',
              whiteSpace: 'nowrap',
            }}>LSR Engine</span>
          </button>
          <div style={{ display: 'flex', gap: '2px' }}>
            {NAV.map(({ id, label }) => (
              <button key={id} onClick={() => onNavigate(id as 'dashboard' | 'history' | 'forum')}
                style={{
                  padding: '4px 11px', borderRadius: '8px', border: 'none',
                  background: currentPage === id ? 'rgba(99,102,241,0.15)' : 'transparent',
                  color: currentPage === id ? '#818cf8' : 'var(--nav-inactive)',
                  fontSize: '12px', fontWeight: 600, cursor: 'pointer',
                  transition: 'all 0.15s', fontFamily: 'Space Grotesk, sans-serif',
                  boxShadow: currentPage === id ? 'inset 0 0 0 1px rgba(99,102,241,0.25)' : 'none',
                }}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Right side: streak → theme toggle → user info → logout */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>

          {/* Streak — leftmost */}
          <div className="nav-streak"><StreakBadge entries={entries} /></div>

          {/* Theme toggle — inverted fill: dark bg in dark mode, white bg in light mode */}
          <button
            type="button"
            onClick={onToggleTheme}
            aria-label={isDark ? 'Chuyển sang chế độ sáng' : 'Chuyển sang chế độ tối'}
            title={isDark ? 'Chế độ sáng' : 'Chế độ tối'}
            style={{
              padding: '4px 10px', borderRadius: '8px', flexShrink: 0,
              border: `1px solid ${isDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.18)'}`,
              background: isDark ? 'rgba(2,6,23,0.85)' : 'rgba(255,255,255,0.92)',
              color: isDark ? '#e2e8f0' : '#0f172a', fontSize: '13px', cursor: 'pointer',
              fontFamily: 'Space Grotesk, sans-serif', fontWeight: 600,
              transition: 'all 0.15s', whiteSpace: 'nowrap',
              display: 'flex', alignItems: 'center', gap: '4px',
              boxShadow: isDark ? '0 1px 4px rgba(0,0,0,0.5)' : '0 1px 4px rgba(0,0,0,0.12)',
            }}
          >{isDark ? '☀️' : '🌙'} <span style={{ fontSize: '11px' }}>{isDark ? 'Sáng' : 'Tối'}</span></button>

          {/* User name + email */}
          <div style={{ textAlign: 'right', minWidth: 0 }}>
            <div style={{ fontSize: '11px', color: 'var(--text-primary)', fontWeight: 600, fontFamily: 'Space Grotesk, sans-serif', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '120px' }}>{displayName}</div>
            <div className="nav-email" style={{ fontSize: '9px', color: 'var(--nav-email)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '120px' }}>{user.email}</div>
          </div>

          {/* Change password */}
          <button onClick={() => setShowChangePass(true)} style={{
            padding: '4px 10px', borderRadius: '8px', flexShrink: 0,
            border: `1px solid ${isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)'}`,
            background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)',
            color: 'var(--nav-logout)', fontSize: '11px', cursor: 'pointer',
            fontFamily: 'Space Grotesk, sans-serif', fontWeight: 500,
            transition: 'all 0.15s', whiteSpace: 'nowrap',
          }}>🔐 Đổi MK</button>

          {/* Logout */}
          <button className="nav-logout" onClick={onLogout} style={{
            padding: '4px 10px', borderRadius: '8px', flexShrink: 0,
            border: `1px solid ${isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)'}`,
            background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)',
            color: 'var(--nav-logout)', fontSize: '11px', cursor: 'pointer',
            fontFamily: 'Space Grotesk, sans-serif', fontWeight: 500,
            transition: 'all 0.15s', whiteSpace: 'nowrap',
          }}>Đăng xuất</button>
        </div>
      </nav>

      {/* Change Password Modal */}
      {showChangePass && (
        <ChangePasswordModal authFetch={authFetch} onClose={() => setShowChangePass(false)} theme={theme} />
      )}

      <ToastContainer toasts={toast.toasts} onDismiss={toast.dismiss} />
      {todaySessions && <DuplicateModal date={sessionDate} sessions={todaySessions} onAddNew={handleAddNew} onUpdate={handleUpdate} onKeep={handleKeep} />}

      {/* ── Main Grid ── fills remaining viewport height, no outer scroll ── */}
      <div className="main-grid" style={{
        flex: 1, display: 'grid',
        gridTemplateColumns: '460px 1fr',
        overflow: 'hidden',
        minHeight: 0,
        padding: '0 12px',
        gap: '0',
        boxSizing: 'border-box',
      }}>

        {/* ── Left column: Form (scrollable) + Chart (fixed bottom) ── */}
        <div className="col-left" style={{
          display: 'flex', flexDirection: 'column',
          borderRight: '1px solid var(--section-border, rgba(255,255,255,0.07))',
          overflow: 'hidden',
          minHeight: 0,
        }}>
          {/* Form panel — scrolls independently */}
          <div style={{ flex: '1 1 0', overflowY: 'auto', padding: '10px 10px 0', minHeight: 0 }}>
            {/* zoom 90% để StatusBanner luôn hiển thị trong viewport */}
            <div style={{ zoom: 0.9 }}>
              <div style={{
                background: 'var(--bg-card, rgba(255,255,255,0.03))',
                border: '1px solid var(--border-card, rgba(255,255,255,0.07))',
                borderRadius: '14px', padding: '12px 14px',
                boxShadow: 'var(--card-shadow)',
              }}>
                <SectionHeader
                  icon="📝"
                  title="Nhật ký học tập hôm nay"
                  right={<AIStatusBar status={aiStatus} />}
                />
                <EntryForm ref={formRef} onSubmit={d => submitEntry(d)} loading={submitting} />
                <StatusBanner status={submitStatus} />
              </div>
            </div>
          </div>

        </div>

        {/* ── Right column: prompt card ── */}
        <div className="col-right" style={{ overflowY: 'auto', padding: '10px', minHeight: 0 }}>
          <div style={{
            background: 'var(--bg-card, rgba(255,255,255,0.03))',
            border: '1px solid var(--border-card, rgba(255,255,255,0.07))',
            borderRadius: '14px', padding: '24px 20px',
            minHeight: 'calc(100% - 20px)',
            boxShadow: 'var(--card-shadow)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            textAlign: 'center', gap: '16px',
          }}>
            {report ? (
              <>
                <div style={{ fontSize: '40px', opacity: 0.7 }}>📊</div>
                <div style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)' }}>Đã có báo cáo phân tích</div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted, #64748b)', lineHeight: 1.6, maxWidth: '240px' }}>Điền nhật ký và nhấn phân tích để xem kết quả mới nhất</div>
                <button
                  onClick={() => setShowResult(true)}
                  style={{
                    marginTop: '4px', padding: '10px 24px', borderRadius: '12px',
                    background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.35)',
                    color: '#a5b4fc', fontSize: '13px', fontWeight: 600,
                    fontFamily: 'Space Grotesk, sans-serif', cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                >📡 Xem báo cáo gần nhất</button>
              </>
            ) : (
              <>
                <div style={{ fontSize: '40px', opacity: 0.3 }}>🧠</div>
                <div style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)' }}>Chưa có báo cáo AI</div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted, #64748b)', lineHeight: 1.6, maxWidth: '240px' }}>Điền nhật ký học tập và nhấn ⚡ Phân tích bằng AI để bắt đầu</div>
              </>
            )}
          </div>
        </div>

      </div>

      {/* A.N.D Watermark */}
      <div style={{ position: 'fixed', bottom: '10px', right: '82px', zIndex: 999, opacity: 0.5, pointerEvents: 'none' }}>
        <img src="/static/and-logo.png" alt="A.N.D" style={{ width: '52px', height: 'auto', display: 'block' }} />
      </div>

      {/* ChatBot */}
      <ChatBot authFetch={authFetch} theme={theme} report={report} />

      {/* ResultSlide — hiện sau khi submit thành công */}
      {showResult && (
        <ResultSlide
          report={report}
          analyzing={analyzing}
          entries={entries}
          onClose={() => setShowResult(false)}
          theme={theme}
          authFetch={authFetch}
        />
      )}

      <style>{`
        @keyframes spin       { to { transform: rotate(360deg); } }
        @keyframes aiBlink    { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.3;transform:scale(0.6)} }
        @keyframes flamePulse { 0%,100%{transform:scale(1)} 50%{transform:scale(1.2)} }
        [data-theme='light'] .root-wrap { background: linear-gradient(160deg, #dde3ed 0%, #c8d3e3 50%, #d4dbe8 100%) !important; }
        button:focus-visible { outline: 2px solid #3b82f6; outline-offset: 2px; }
        * { scrollbar-width: thin; scrollbar-color: rgba(99,102,241,0.2) transparent; }
        *::-webkit-scrollbar { width: 3px; }
        *::-webkit-scrollbar-track { background: transparent; }
        *::-webkit-scrollbar-thumb { background: rgba(99,102,241,0.2); border-radius: 2px; }

        /* ── Mobile navbar: hide email + streak, compress ── */
        @media (max-width: 700px) {
          .nav-email   { display: none !important; }
          .nav-streak  { display: none !important; }
          .nav-logout  { padding: 4px 8px !important; font-size: 10px !important; }
          .nav-logo-text { display: none !important; }
        }

        @media (max-width: 1000px) {
          /* On small screens: root scrolls naturally, no height clipping */
          .root-wrap  { height: auto !important; overflow: visible !important; }
          .main-grid  {
            display: flex !important;
            flex-direction: column !important;
            overflow: visible !important;
            height: auto !important;
            min-height: unset !important;
            padding: 0 8px 16px !important;
            gap: 0 !important;
          }
          .col-left {
            overflow: visible !important;
            height: auto !important;
            min-height: unset !important;
            border-right: none !important;
            border-bottom: 1px solid var(--section-border, rgba(255,255,255,0.07));
            padding-bottom: 4px;
          }
          /* Form panel inside col-left: let height grow naturally */
          .col-left > div:first-child {
            flex: none !important;
            overflow: visible !important;
            height: auto !important;
          }
          .col-right {
            overflow: visible !important;
            height: auto !important;
            min-height: unset !important;
          }
        }
      `}</style>
    </div>
  )
}
