import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { AnalysisReport } from '../types'

interface Message {
  id: string
  role: 'user' | 'assistant' | 'error' | 'system'
  text: string
  ts: number
  outOfScope?: boolean
}

interface Props {
  authFetch: (url: string, options?: RequestInit) => Promise<Response>
  theme?: 'dark' | 'light'
  report?: AnalysisReport | null
  user?: { id: number; email: string; full_name?: string } | null
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function genId() { return Math.random().toString(36).slice(2, 9) }
function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
}

// ── Risk level display ────────────────────────────────────────────────────────
const RISK_COLORS: Record<string, { bg: string; text: string; border: string; dot: string }> = {
  'Stable':      { bg: 'rgba(34,197,94,0.12)',  text: '#22c55e', border: 'rgba(34,197,94,0.3)',  dot: '#22c55e' },
  'Fluctuating': { bg: 'rgba(245,158,11,0.12)', text: '#f59e0b', border: 'rgba(245,158,11,0.3)', dot: '#f59e0b' },
  'High Risk':   { bg: 'rgba(239,68,68,0.12)',  text: '#ef4444', border: 'rgba(239,68,68,0.3)',  dot: '#ef4444' },
}
const RISK_ICONS: Record<string, string> = {
  'Stable': '🟢', 'Fluctuating': '🟡', 'High Risk': '🔴',
}

// ── Suggested questions based on report ──────────────────────────────────────
function buildSuggestions(report: AnalysisReport | null | undefined): string[] {
  if (!report) {
    return [
      'Tôi nên ghi nhật ký học tập như thế nào?',
      'Focus level và Dropout feeling đo lường gì?',
      'Làm sao để cải thiện sự tập trung khi học?',
    ]
  }
  const suggestions: string[] = []
  const rl = report.risk_level

  if (rl === 'High Risk') {
    suggestions.push('Báo cáo đánh giá High Risk — tôi cần làm gì ngay bây giờ?')
    suggestions.push('Intervention Plan trong báo cáo này hoạt động như thế nào?')
  } else if (rl === 'Fluctuating') {
    suggestions.push('Risk Fluctuating nghĩa là gì với dữ liệu của tôi?')
    suggestions.push('Làm sao để chuyển từ Fluctuating sang Stable?')
  } else {
    suggestions.push('Dữ liệu Stable — điều gì đang hoạt động tốt?')
    suggestions.push('Tôi có thể duy trì trạng thái Stable như thế nào?')
  }

  if (report.primary_risk_driver) {
    suggestions.push(`"${report.primary_risk_driver.slice(0, 45)}${report.primary_risk_driver.length > 45 ? '…' : ''}" — giải thích chi tiết hơn?`)
  }
  if (report.key_signals?.length) {
    suggestions.push(`Key signal "${report.key_signals[0].slice(0, 40)}${report.key_signals[0].length > 40 ? '…' : ''}" nghĩa là gì?`)
  }
  suggestions.push('Kế hoạch 48h trong báo cáo, tôi nên bắt đầu từ đâu?')

  return suggestions.slice(0, 4)
}

// ── Build report context string to send to backend ────────────────────────────
function buildReportContext(report: AnalysisReport | null | undefined): string {
  if (!report) return ''
  const lines = ['=== BÁO CÁO AI ĐANG XEM ===']
  lines.push(`Risk Level: ${report.risk_level}`)
  if (report.key_signals?.length)       lines.push(`Key Signals: ${report.key_signals.join(' | ')}`)
  if (report.primary_risk_driver)       lines.push(`Primary Risk Driver: ${report.primary_risk_driver}`)
  if (report.short_term_forecast)       lines.push(`Short-term Forecast: ${report.short_term_forecast}`)
  if (report.intervention_strategy)     lines.push(`Intervention Strategy: ${report.intervention_strategy}`)
  if (report.monitoring_protocol)       lines.push(`Monitoring Protocol: ${report.monitoring_protocol}`)
  if (report.action_plan_48h?.length)   lines.push(`48h Action Plan: ${report.action_plan_48h.join(' | ')}`)
  return lines.join('\n')
}

// ── Markdown-lite renderer ────────────────────────────────────────────────────
function renderText(text: string) {
  const lines = text.split('\n')
  const elements: React.ReactNode[] = []

  lines.forEach((line, i) => {
    const trimmed = line.trimStart()
    if (/^#{1,3}\s/.test(trimmed)) {
      const content = trimmed.replace(/^#{1,3}\s/, '')
      elements.push(
        <div key={i} style={{ fontWeight: 700, fontSize: '13px', marginTop: i > 0 ? '8px' : '0', marginBottom: '3px', color: 'inherit' }}>
          {inlineFormat(content)}
        </div>
      )
    } else if (/^[•\-\*]\s/.test(trimmed)) {
      const content = trimmed.replace(/^[•\-\*]\s/, '')
      elements.push(
        <div key={i} style={{ display: 'flex', gap: '6px', marginTop: '3px' }}>
          <span style={{ color: '#818cf8', flexShrink: 0, marginTop: '2px', fontSize: '10px' }}>▸</span>
          <span>{inlineFormat(content)}</span>
        </div>
      )
    } else if (/^\d+\.\s/.test(trimmed)) {
      const num = trimmed.match(/^(\d+)\./)?.[1]
      const content = trimmed.replace(/^\d+\.\s/, '')
      elements.push(
        <div key={i} style={{ display: 'flex', gap: '6px', marginTop: '3px' }}>
          <span style={{ color: '#818cf8', flexShrink: 0, minWidth: '16px', fontSize: '11px', fontWeight: 600 }}>{num}.</span>
          <span>{inlineFormat(content)}</span>
        </div>
      )
    } else if (trimmed === '') {
      if (i > 0 && i < lines.length - 1) elements.push(<div key={i} style={{ height: '5px' }} />)
    } else {
      elements.push(<div key={i}>{inlineFormat(line)}</div>)
    }
  })

  return <>{elements}</>
}

function inlineFormat(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**'))
      return <strong key={i} style={{ fontWeight: 700 }}>{part.slice(2, -2)}</strong>
    if (part.startsWith('`') && part.endsWith('`'))
      return (
        <code key={i} style={{
          fontFamily: 'JetBrains Mono, monospace', fontSize: '11px',
          background: 'rgba(99,102,241,0.15)', padding: '1px 5px',
          borderRadius: '4px', color: '#a5b4fc',
        }}>{part.slice(1, -1)}</code>
      )
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2)
      return <em key={i} style={{ fontStyle: 'italic', color: '#a5b4fc' }}>{part.slice(1, -1)}</em>
    return part
  })
}

// ── Typing indicator ──────────────────────────────────────────────────────────
function TypingDots() {
  return (
    <div style={{ display: 'flex', gap: '4px', alignItems: 'center', padding: '2px 0' }}>
      {[0, 1, 2].map(i => (
        <span key={i} style={{
          width: '6px', height: '6px', borderRadius: '50%',
          background: '#818cf8', display: 'inline-block',
          animation: `chatDot 1.2s ease-in-out ${i * 0.2}s infinite`,
        }} />
      ))}
    </div>
  )
}

// ── Message bubble ────────────────────────────────────────────────────────────
function Bubble({ msg, isDark }: { msg: Message; isDark: boolean }) {
  const isUser = msg.role === 'user'
  const isErr  = msg.role === 'error'
  const isSys  = msg.role === 'system'

  if (isSys) return (
    <div style={{
      textAlign: 'center', margin: '4px 0 10px',
      fontSize: '10px', color: isDark ? '#475569' : '#94a3b8',
      fontStyle: 'italic',
    }}>
      {msg.text}
    </div>
  )

  if (isUser) return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '10px' }}>
      <div style={{ maxWidth: '82%' }}>
        <div style={{
          background: 'linear-gradient(135deg, #4f46e5, #7c3aed)',
          color: '#fff', borderRadius: '16px 16px 4px 16px',
          padding: '9px 13px', fontSize: '13px', lineHeight: 1.55,
          boxShadow: '0 2px 8px rgba(79,70,229,0.35)',
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        }}>
          {msg.text}
        </div>
        <div style={{ textAlign: 'right', fontSize: '10px', color: isDark ? '#475569' : '#94a3b8', marginTop: '3px', paddingRight: '4px' }}>
          {formatTime(msg.ts)}
        </div>
      </div>
    </div>
  )

  if (isErr) return (
    <div style={{ display: 'flex', marginBottom: '10px' }}>
      <div style={{ maxWidth: '88%' }}>
        <div style={{
          background: isDark ? 'rgba(127,29,29,0.5)' : '#fee2e2',
          border: '1px solid rgba(239,68,68,0.35)',
          color: isDark ? '#fca5a5' : '#991b1b',
          borderRadius: '4px 16px 16px 16px',
          padding: '9px 13px', fontSize: '12.5px', lineHeight: 1.55,
        }}>
          ⚠️ {msg.text}
        </div>
      </div>
    </div>
  )

  // Assistant bubble
  return (
    <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', alignItems: 'flex-start' }}>
      <div style={{
        width: '26px', height: '26px', borderRadius: '50%', flexShrink: 0,
        background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '12px', boxShadow: '0 0 6px rgba(99,102,241,0.4)',
        marginTop: '2px',
      }}>🧮</div>
      <div style={{ maxWidth: '88%', flex: 1 }}>
        <div style={{
          background: isDark ? 'rgba(15,23,42,0.98)' : 'rgba(241,245,249,0.98)',
          border: `1px solid ${isDark ? 'rgba(99,102,241,0.18)' : 'rgba(99,102,241,0.15)'}`,
          color: isDark ? '#e2e8f0' : '#0f172a',
          borderRadius: '4px 16px 16px 16px',
          padding: '10px 13px', fontSize: '13px', lineHeight: 1.65,
          boxShadow: isDark ? '0 2px 10px rgba(0,0,0,0.35)' : '0 2px 8px rgba(0,0,0,0.07)',
          wordBreak: 'break-word',
        }}>
          {msg.outOfScope && (
            <div style={{
              fontSize: '10px', fontWeight: 700, letterSpacing: '0.5px',
              color: '#f59e0b', marginBottom: '6px', textTransform: 'uppercase',
            }}>⛔ Ngoài phạm vi</div>
          )}
          {renderText(msg.text)}
        </div>
        <div style={{ fontSize: '10px', color: isDark ? '#475569' : '#94a3b8', marginTop: '3px', paddingLeft: '4px' }}>
          LSR Coach · {formatTime(msg.ts)}
        </div>
      </div>
    </div>
  )
}

// ── Context panel (report snapshot) ──────────────────────────────────────────
function ContextPanel({ report, isDark, onClose }: {
  report: AnalysisReport
  isDark: boolean
  onClose: () => void
}) {
  const rl = report.risk_level
  const rc = RISK_COLORS[rl] ?? RISK_COLORS['Fluctuating']
  const signals = report.key_signals?.slice(0, 3) ?? []

  return (
    <div style={{
      margin: '0 12px 10px',
      background: isDark ? 'rgba(15,23,42,0.9)' : 'rgba(241,245,249,0.95)',
      border: `1px solid ${rc.border}`,
      borderRadius: '10px', padding: '10px 12px',
      fontSize: '11.5px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '7px' }}>
        <span style={{ fontWeight: 700, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.6px', color: isDark ? '#64748b' : '#94a3b8' }}>
          📊 Ngữ cảnh báo cáo hiện tại
        </span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: isDark ? '#475569' : '#94a3b8', fontSize: '13px', lineHeight: 1, padding: '0 2px' }}>×</button>
      </div>

      {/* Risk badge */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '7px' }}>
        <span style={{
          background: rc.bg, color: rc.text, border: `1px solid ${rc.border}`,
          borderRadius: '20px', padding: '2px 9px', fontSize: '11px', fontWeight: 700,
          display: 'flex', alignItems: 'center', gap: '4px',
        }}>
          <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: rc.dot, flexShrink: 0 }} />
          {RISK_ICONS[rl]} {rl}
        </span>
        <span style={{ fontSize: '10px', color: isDark ? '#64748b' : '#94a3b8' }}>Risk Level</span>
      </div>

      {/* Primary risk driver */}
      {report.primary_risk_driver && (
        <div style={{ marginBottom: '6px' }}>
          <span style={{ color: isDark ? '#64748b' : '#94a3b8', marginRight: '4px' }}>⚡</span>
          <span style={{ color: isDark ? '#cbd5e1' : '#334155' }}>
            {report.primary_risk_driver.length > 70
              ? report.primary_risk_driver.slice(0, 70) + '…'
              : report.primary_risk_driver}
          </span>
        </div>
      )}

      {/* Key signals */}
      {signals.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '4px' }}>
          {signals.map((s, i) => (
            <span key={i} style={{
              background: isDark ? 'rgba(99,102,241,0.1)' : 'rgba(99,102,241,0.08)',
              border: '1px solid rgba(99,102,241,0.2)',
              color: '#818cf8', borderRadius: '6px', padding: '1px 7px',
              fontSize: '10px', fontWeight: 500,
            }}>
              {s.length > 30 ? s.slice(0, 30) + '…' : s}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Suggestion chips ──────────────────────────────────────────────────────────
function SuggestionChips({ suggestions, isDark, onSelect, disabled }: {
  suggestions: string[]
  isDark: boolean
  onSelect: (s: string) => void
  disabled: boolean
}) {
  return (
    <div style={{ padding: '0 12px 8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <div style={{ fontSize: '9.5px', textTransform: 'uppercase', letterSpacing: '0.5px', color: isDark ? '#475569' : '#94a3b8', marginBottom: '2px', fontWeight: 600 }}>
        💡 Câu hỏi gợi ý
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
        {suggestions.map((s, i) => (
          <button
            key={i}
            onClick={() => !disabled && onSelect(s)}
            disabled={disabled}
            style={{
              background: isDark ? 'rgba(30,41,59,0.8)' : 'rgba(241,245,249,0.9)',
              border: `1px solid ${isDark ? 'rgba(99,102,241,0.2)' : 'rgba(99,102,241,0.18)'}`,
              borderRadius: '8px', padding: '5px 9px',
              fontSize: '11px', color: isDark ? '#94a3b8' : '#475569',
              cursor: disabled ? 'not-allowed' : 'pointer',
              textAlign: 'left', lineHeight: 1.4,
              transition: 'all 0.15s', opacity: disabled ? 0.5 : 1,
            }}
            onMouseEnter={e => {
              if (!disabled) {
                const el = e.currentTarget as HTMLButtonElement
                el.style.borderColor = '#818cf8'
                el.style.color = '#818cf8'
                el.style.background = isDark ? 'rgba(99,102,241,0.1)' : 'rgba(99,102,241,0.06)'
              }
            }}
            onMouseLeave={e => {
              const el = e.currentTarget as HTMLButtonElement
              el.style.borderColor = isDark ? 'rgba(99,102,241,0.2)' : 'rgba(99,102,241,0.18)'
              el.style.color = isDark ? '#94a3b8' : '#475569'
              el.style.background = isDark ? 'rgba(30,41,59,0.8)' : 'rgba(241,245,249,0.9)'
            }}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Main ChatBot component ────────────────────────────────────────────────────
export default function ChatBot({ authFetch, theme = 'dark', report, user: _ }: Props) {
  const isDark = theme === 'dark'

  const [open,         setOpen]         = useState(false)
  const [input,        setInput]        = useState('')
  const [loading,      setLoading]      = useState(false)
  const [showCtxPanel, setShowCtxPanel] = useState(true)
  const [messages, setMessages] = useState<Message[]>([])

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef       = useRef<HTMLTextAreaElement>(null)

  // Build suggestions & context lazily
  const suggestions   = useMemo(() => buildSuggestions(report), [report?.id, report?.risk_level])
  const reportContext = useMemo(() => buildReportContext(report), [report?.id])

  // Welcome message — rebuild when report changes
  useEffect(() => {
    const hasReport = !!report
    const riskLine = hasReport
      ? `\n\nBáo cáo hiện tại: **${report!.risk_level}** — tôi đã tải ngữ cảnh và sẵn sàng phân tích.`
      : '\n\nChưa có báo cáo. Hãy ghi nhật ký phiên học để có dữ liệu phân tích.'

    setMessages([{
      id: genId(),
      role: 'assistant',
      text: `Tôi là **LSR Coach** — AI coach phân tích dữ liệu học tập.${riskLine}\n\nTôi hoạt động trong phạm vi: tín hiệu rủi ro, hành vi học tập, và chiến lược cải thiện dựa trên số liệu. Tôi không tư vấn tâm lý hay các vấn đề ngoài học tập.`,
      ts: Date.now(),
    }])
  }, [report?.id])

  // Scroll to bottom
  useEffect(() => {
    if (open) messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, open, loading])

  // Focus input when opened
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 120)
  }, [open])

  const doSend = useCallback(async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || loading) return

    const userMsg: Message = { id: genId(), role: 'user', text: trimmed, ts: Date.now() }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setLoading(true)

    try {
      const res = await authFetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: trimmed, reportContext }),
      })
      const data = await res.json() as Record<string, unknown>

      if (!res.ok || !data.reply) {
        const errMsg = typeof data.message === 'string' ? data.message : 'Không thể kết nối AI. Thử lại sau.'
        setMessages(prev => [...prev, { id: genId(), role: 'error', text: errMsg, ts: Date.now() }])
      } else {
        setMessages(prev => [...prev, {
          id: genId(), role: 'assistant',
          text: String(data.reply), ts: Date.now(),
          outOfScope: data.outOfScope === true,
        }])
      }
    } catch {
      setMessages(prev => [...prev, { id: genId(), role: 'error', text: 'Lỗi kết nối. Kiểm tra mạng rồi thử lại.', ts: Date.now() }])
    } finally {
      setLoading(false)
    }
  }, [loading, authFetch, reportContext])

  const sendMessage = useCallback(() => doSend(input), [doSend, input])

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
  }

  const hasUnread = !open && messages.length > 1 && messages[messages.length - 1].role === 'assistant'

  // Show suggestion chips only when few messages
  const showSuggestions = messages.length <= 2 && !loading

  return (
    <>
      <style>{`
        @keyframes chatDot {
          0%,60%,100% { transform: translateY(0); opacity: 0.4; }
          30% { transform: translateY(-5px); opacity: 1; }
        }
        @keyframes chatSlideUp {
          from { opacity: 0; transform: translateY(16px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes chatPop {
          from { opacity: 0; transform: scale(0.8); }
          to   { opacity: 1; transform: scale(1); }
        }
        .chat-input:focus { outline: none; }
        .chat-send:hover:not(:disabled) { opacity: 0.85; transform: scale(1.05); }
        .chat-send:disabled { opacity: 0.35; cursor: not-allowed; }
        .chat-fab:hover { transform: scale(1.08); box-shadow: 0 6px 24px rgba(99,102,241,0.6) !important; }
        .chat-scroll::-webkit-scrollbar { width: 3px; }
        .chat-scroll::-webkit-scrollbar-track { background: transparent; }
        .chat-scroll::-webkit-scrollbar-thumb { background: rgba(99,102,241,0.25); border-radius: 2px; }
        .lsr-scope-note { font-size:10px; color: ${isDark ? '#475569' : '#94a3b8'}; text-align:center; padding: 4px 8px; line-height:1.4; }
      `}</style>

      {/* FAB */}
      <div style={{
        position: 'fixed', bottom: '80px', right: '20px', zIndex: 1000,
        animation: 'chatPop 0.35s cubic-bezier(0.34,1.56,0.64,1)',
      }}>
        <button
          className="chat-fab"
          onClick={() => setOpen(o => !o)}
          aria-label={open ? 'Đóng LSR Coach' : 'Mở LSR Coach'}
          style={{
            width: '54px', height: '54px', borderRadius: '50%', border: 'none',
            background: open
              ? (isDark ? 'rgba(30,41,59,0.95)' : 'rgba(241,245,249,0.98)')
              : 'linear-gradient(135deg, #4f46e5, #7c3aed)',
            boxShadow: open
              ? '0 4px 16px rgba(0,0,0,0.25)'
              : '0 4px 20px rgba(99,102,241,0.5)',
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '22px', transition: 'all 0.2s',
            position: 'relative',
          }}
        >
          {open ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
              stroke={isDark ? '#94a3b8' : '#64748b'} strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          ) : '🧮'}

          {/* Risk dot when closed */}
          {!open && report && (
            <span style={{
              position: 'absolute', top: '2px', right: '2px',
              width: '12px', height: '12px', borderRadius: '50%',
              background: RISK_COLORS[report.risk_level]?.dot ?? '#818cf8',
              border: `2px solid ${isDark ? '#020617' : '#f1f5f9'}`,
            }} />
          )}
          {/* Unread dot */}
          {hasUnread && !report && (
            <span style={{
              position: 'absolute', top: '2px', right: '2px',
              width: '10px', height: '10px', borderRadius: '50%',
              background: '#22c55e',
              border: `2px solid ${isDark ? '#020617' : '#f1f5f9'}`,
            }} />
          )}
        </button>

        {/* Tooltip label when closed */}
        {!open && (
          <div style={{
            position: 'absolute', right: '62px', top: '50%', transform: 'translateY(-50%)',
            background: isDark ? 'rgba(15,23,42,0.95)' : 'rgba(255,255,255,0.95)',
            border: `1px solid ${isDark ? 'rgba(99,102,241,0.2)' : 'rgba(99,102,241,0.15)'}`,
            borderRadius: '8px', padding: '4px 10px',
            fontSize: '11px', fontWeight: 600, color: isDark ? '#818cf8' : '#6366f1',
            whiteSpace: 'nowrap', pointerEvents: 'none',
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            opacity: 0,
            transition: 'opacity 0.15s',
          }}>LSR Coach</div>
        )}
      </div>

      {/* Chat window */}
      {open && (
        <div style={{
          position: 'fixed', bottom: '145px', right: '20px', zIndex: 999,
          width: '360px',
          maxHeight: '520px',
          background: isDark ? 'rgba(8,12,26,0.98)' : 'rgba(255,255,255,0.99)',
          border: `1px solid ${isDark ? 'rgba(99,102,241,0.22)' : 'rgba(99,102,241,0.16)'}`,
          borderRadius: '18px',
          boxShadow: isDark
            ? '0 12px 48px rgba(0,0,0,0.65), 0 0 0 1px rgba(99,102,241,0.08)'
            : '0 12px 40px rgba(0,0,0,0.14)',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
          animation: 'chatSlideUp 0.25s cubic-bezier(0.34,1.56,0.64,1)',
        }}>

          {/* Header */}
          <div style={{
            padding: '11px 14px',
            background: isDark ? 'rgba(10,15,30,0.99)' : 'rgba(248,250,252,0.99)',
            borderBottom: `1px solid ${isDark ? 'rgba(99,102,241,0.12)' : 'rgba(99,102,241,0.1)'}`,
            display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0,
          }}>
            <div style={{
              width: '32px', height: '32px', borderRadius: '50%',
              background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '15px', flexShrink: 0,
              boxShadow: '0 0 10px rgba(99,102,241,0.35)',
            }}>🧮</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: '13px', fontWeight: 700,
                fontFamily: 'Space Grotesk, sans-serif',
                color: isDark ? '#e2e8f0' : '#0f172a',
                letterSpacing: '-0.2px',
              }}>LSR Coach</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#22c55e', flexShrink: 0 }} />
                <span style={{ fontSize: '10px', color: isDark ? '#64748b' : '#94a3b8', fontFamily: 'Space Grotesk, sans-serif' }}>
                  AI Coach · Phân tích dữ liệu học tập
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
              {/* Toggle context panel */}
              {report && (
                <button
                  onClick={() => setShowCtxPanel(v => !v)}
                  title={showCtxPanel ? 'Ẩn ngữ cảnh' : 'Hiện ngữ cảnh báo cáo'}
                  style={{
                    background: showCtxPanel
                      ? `${RISK_COLORS[report.risk_level]?.bg ?? 'rgba(99,102,241,0.12)'}`
                      : 'none',
                    border: `1px solid ${showCtxPanel
                      ? (RISK_COLORS[report.risk_level]?.border ?? 'rgba(99,102,241,0.2)')
                      : (isDark ? 'rgba(255,255,255,0.06)' : '#e2e8f0')}`,
                    cursor: 'pointer', padding: '3px 7px', borderRadius: '6px',
                    color: showCtxPanel
                      ? (RISK_COLORS[report.risk_level]?.text ?? '#818cf8')
                      : (isDark ? '#475569' : '#94a3b8'),
                    fontSize: '11px', fontWeight: 600,
                    display: 'flex', alignItems: 'center', gap: '3px',
                    transition: 'all 0.15s',
                  }}
                >
                  <span style={{ fontSize: '10px' }}>{RISK_ICONS[report.risk_level]}</span>
                  {report.risk_level}
                </button>
              )}
              {/* Clear */}
              <button
                onClick={() => setMessages([{
                  id: genId(), role: 'system',
                  text: 'Cuộc trò chuyện đã được xóa.',
                  ts: Date.now(),
                }])}
                title="Xóa lịch sử"
                style={{
                  background: 'none', border: 'none', cursor: 'pointer', padding: '4px 5px',
                  color: isDark ? '#475569' : '#94a3b8', borderRadius: '6px',
                  fontSize: '13px', opacity: 0.7, transition: 'opacity 0.15s',
                  display: 'flex', alignItems: 'center',
                }}
              >🗑️</button>
            </div>
          </div>

          {/* Context panel */}
          {report && showCtxPanel && (
            <div style={{
              background: isDark ? 'rgba(10,15,30,0.95)' : 'rgba(248,250,252,0.95)',
              borderBottom: `1px solid ${isDark ? 'rgba(99,102,241,0.1)' : 'rgba(99,102,241,0.08)'}`,
              flexShrink: 0,
              paddingTop: '8px',
            }}>
              <ContextPanel report={report} isDark={isDark} onClose={() => setShowCtxPanel(false)} />
            </div>
          )}

          {/* Messages */}
          <div
            className="chat-scroll"
            style={{
              flex: 1, overflowY: 'auto', padding: '14px 12px 8px',
              display: 'flex', flexDirection: 'column',
              minHeight: 0,
            }}
          >
            {messages.map(msg => <Bubble key={msg.id} msg={msg} isDark={isDark} />)}

            {/* Typing */}
            {loading && (
              <div style={{ display: 'flex', gap: '8px', marginBottom: '10px', alignItems: 'flex-start' }}>
                <div style={{
                  width: '26px', height: '26px', borderRadius: '50%', flexShrink: 0,
                  background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px',
                }}>🧮</div>
                <div style={{
                  background: isDark ? 'rgba(15,23,42,0.95)' : 'rgba(241,245,249,0.98)',
                  border: `1px solid ${isDark ? 'rgba(99,102,241,0.18)' : 'rgba(99,102,241,0.15)'}`,
                  borderRadius: '4px 16px 16px 16px', padding: '10px 14px',
                }}>
                  <TypingDots />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Suggestion chips */}
          {showSuggestions && (
            <div style={{
              borderTop: `1px solid ${isDark ? 'rgba(99,102,241,0.08)' : 'rgba(99,102,241,0.07)'}`,
              background: isDark ? 'rgba(10,15,30,0.95)' : 'rgba(248,250,252,0.95)',
              flexShrink: 0, paddingTop: '8px',
            }}>
              <SuggestionChips
                suggestions={suggestions}
                isDark={isDark}
                onSelect={s => doSend(s)}
                disabled={loading}
              />
            </div>
          )}

          {/* Input area */}
          <div style={{
            padding: '9px 12px 10px',
            borderTop: `1px solid ${isDark ? 'rgba(99,102,241,0.1)' : 'rgba(99,102,241,0.08)'}`,
            background: isDark ? 'rgba(10,15,30,0.99)' : 'rgba(248,250,252,0.99)',
            flexShrink: 0,
          }}>
            <div style={{
              display: 'flex', gap: '8px', alignItems: 'flex-end',
              background: isDark ? 'rgba(20,30,50,0.9)' : 'rgba(255,255,255,0.95)',
              border: `1px solid ${isDark ? 'rgba(99,102,241,0.18)' : 'rgba(99,102,241,0.18)'}`,
              borderRadius: '12px', padding: '8px 8px 8px 12px',
            }}>
              <textarea
                ref={inputRef}
                className="chat-input"
                value={input}
                onChange={e => {
                  setInput(e.target.value)
                  e.target.style.height = 'auto'
                  e.target.style.height = Math.min(e.target.scrollHeight, 96) + 'px'
                }}
                onKeyDown={handleKey}
                placeholder="Hỏi về dữ liệu học tập… (Enter để gửi)"
                rows={1}
                disabled={loading}
                style={{
                  flex: 1, background: 'none', border: 'none', resize: 'none',
                  color: isDark ? '#e2e8f0' : '#0f172a',
                  fontSize: '13px', lineHeight: '1.5',
                  fontFamily: 'Space Grotesk, sans-serif',
                  padding: 0, maxHeight: '96px', overflowY: 'auto',
                }}
              />
              <button
                className="chat-send"
                onClick={sendMessage}
                disabled={!input.trim() || loading}
                style={{
                  width: '32px', height: '32px', borderRadius: '8px', border: 'none',
                  background: 'linear-gradient(135deg, #4f46e5, #7c3aed)',
                  color: '#fff', cursor: 'pointer', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'all 0.15s',
                  boxShadow: '0 2px 8px rgba(79,70,229,0.4)',
                }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13"/>
                  <polygon points="22 2 15 22 11 13 2 9 22 2"/>
                </svg>
              </button>
            </div>

            {/* Scope disclaimer */}
            <div className="lsr-scope-note">
              Chỉ phân tích hành vi học tập · Không tư vấn tâm lý hay các vấn đề khác
            </div>
          </div>
        </div>
      )}
    </>
  )
}
