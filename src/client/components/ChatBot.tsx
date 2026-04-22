import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react'

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
  // report prop kept for potential future use but not displayed
  report?: any
  user?: any
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function genId() { return Math.random().toString(36).slice(2, 9) }
function fmtTime(ts: number) {
  return new Date(ts).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
}

// ── Static suggestion list ────────────────────────────────────────────────────
const SUGGESTIONS = [
  'Dữ liệu học tập của tôi gần đây thế nào?',
  'Tôi đang ở mức rủi ro nào và cần làm gì?',
  'Focus level thấp ảnh hưởng ra sao?',
  'Làm sao cải thiện sự tập trung khi học?',
  'Giải thích Intervention Plan cho tôi?',
  'Khi nào thì từ Fluctuating lên Stable?',
]

// ── Markdown-lite renderer ────────────────────────────────────────────────────
function renderText(text: string) {
  const lines = text.split('\n')
  const out: React.ReactNode[] = []
  lines.forEach((line, i) => {
    const t = line.trimStart()
    if (/^#{1,3}\s/.test(t)) {
      out.push(<div key={i} style={{ fontWeight: 700, marginTop: i > 0 ? '7px' : 0, marginBottom: '2px' }}>{inlineFmt(t.replace(/^#{1,3}\s/, ''))}</div>)
    } else if (/^[•\-\*]\s/.test(t)) {
      out.push(
        <div key={i} style={{ display: 'flex', gap: '5px', marginTop: '2px' }}>
          <span style={{ color: '#818cf8', flexShrink: 0, fontSize: '10px', marginTop: '3px' }}>▸</span>
          <span>{inlineFmt(t.replace(/^[•\-\*]\s/, ''))}</span>
        </div>
      )
    } else if (/^\d+\.\s/.test(t)) {
      const num = t.match(/^(\d+)\./)?.[1]
      out.push(
        <div key={i} style={{ display: 'flex', gap: '5px', marginTop: '2px' }}>
          <span style={{ color: '#818cf8', flexShrink: 0, minWidth: '15px', fontSize: '11px', fontWeight: 600 }}>{num}.</span>
          <span>{inlineFmt(t.replace(/^\d+\.\s/, ''))}</span>
        </div>
      )
    } else if (t === '') {
      if (i > 0 && i < lines.length - 1) out.push(<div key={i} style={{ height: '4px' }} />)
    } else {
      out.push(<div key={i}>{inlineFmt(line)}</div>)
    }
  })
  return <>{out}</>
}

function inlineFmt(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g)
  return parts.map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**'))
      return <strong key={i}>{p.slice(2, -2)}</strong>
    if (p.startsWith('`') && p.endsWith('`'))
      return <code key={i} style={{ fontFamily: 'monospace', fontSize: '11px', background: 'rgba(99,102,241,0.15)', padding: '1px 4px', borderRadius: '3px', color: '#a5b4fc' }}>{p.slice(1, -1)}</code>
    if (p.startsWith('*') && p.endsWith('*') && p.length > 2)
      return <em key={i} style={{ color: '#a5b4fc' }}>{p.slice(1, -1)}</em>
    return p
  })
}

// ── Typing dots ───────────────────────────────────────────────────────────────
function TypingDots() {
  return (
    <div style={{ display: 'flex', gap: '4px', alignItems: 'center', padding: '2px 0' }}>
      {[0, 1, 2].map(i => (
        <span key={i} style={{
          width: '6px', height: '6px', borderRadius: '50%', background: '#818cf8',
          display: 'inline-block',
          animation: `lsrDot 1.2s ease-in-out ${i * 0.2}s infinite`,
        }} />
      ))}
    </div>
  )
}

// ── Message bubble ────────────────────────────────────────────────────────────
function Bubble({ msg, isDark }: { msg: Message; isDark: boolean }) {
  if (msg.role === 'system') return (
    <div style={{ textAlign: 'center', margin: '2px 0 8px', fontSize: '10px', color: isDark ? '#475569' : '#94a3b8', fontStyle: 'italic' }}>
      {msg.text}
    </div>
  )

  if (msg.role === 'user') return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '10px' }}>
      <div style={{ maxWidth: '80%' }}>
        <div style={{
          background: 'linear-gradient(135deg,#4f46e5,#7c3aed)',
          color: '#fff', borderRadius: '16px 16px 4px 16px',
          padding: '9px 13px', fontSize: '13px', lineHeight: 1.55,
          boxShadow: '0 2px 8px rgba(79,70,229,0.35)',
          wordBreak: 'break-word', whiteSpace: 'pre-wrap',
        }}>{msg.text}</div>
        <div style={{ textAlign: 'right', fontSize: '10px', color: isDark ? '#475569' : '#94a3b8', marginTop: '2px', paddingRight: '4px' }}>
          {fmtTime(msg.ts)}
        </div>
      </div>
    </div>
  )

  if (msg.role === 'error') return (
    <div style={{ display: 'flex', marginBottom: '10px' }}>
      <div style={{ maxWidth: '88%' }}>
        <div style={{
          background: isDark ? 'rgba(127,29,29,0.45)' : '#fee2e2',
          border: '1px solid rgba(239,68,68,0.3)',
          color: isDark ? '#fca5a5' : '#991b1b',
          borderRadius: '4px 16px 16px 16px',
          padding: '9px 13px', fontSize: '12.5px', lineHeight: 1.55,
        }}>⚠️ {msg.text}</div>
      </div>
    </div>
  )

  // Assistant
  return (
    <div style={{ display: 'flex', gap: '7px', marginBottom: '12px', alignItems: 'flex-start' }}>
      <div style={{
        width: '26px', height: '26px', borderRadius: '50%', flexShrink: 0,
        background: 'linear-gradient(135deg,#6366f1,#8b5cf6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '12px', boxShadow: '0 0 6px rgba(99,102,241,0.35)', marginTop: '2px',
      }}>🧮</div>
      <div style={{ maxWidth: 'calc(100% - 34px)', flex: 1 }}>
        <div style={{
          background: isDark ? 'rgba(15,23,42,0.98)' : 'rgba(241,245,249,0.98)',
          border: `1px solid ${isDark ? 'rgba(99,102,241,0.18)' : 'rgba(99,102,241,0.14)'}`,
          color: isDark ? '#e2e8f0' : '#0f172a',
          borderRadius: '4px 16px 16px 16px',
          padding: '10px 13px', fontSize: '13px', lineHeight: 1.65,
          boxShadow: isDark ? '0 2px 10px rgba(0,0,0,0.3)' : '0 2px 8px rgba(0,0,0,0.07)',
          wordBreak: 'break-word',
        }}>
          {msg.outOfScope && (
            <div style={{ fontSize: '10px', fontWeight: 700, color: '#f59e0b', marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
              ⛔ Ngoài phạm vi
            </div>
          )}
          {renderText(msg.text)}
        </div>
        <div style={{ fontSize: '10px', color: isDark ? '#475569' : '#94a3b8', marginTop: '2px', paddingLeft: '3px' }}>
          LSR Coach · {fmtTime(msg.ts)}
        </div>
      </div>
    </div>
  )
}

// ── Suggestion chips ──────────────────────────────────────────────────────────
function SuggestionChips({ isDark, onSelect, disabled }: {
  isDark: boolean
  onSelect: (s: string) => void
  disabled: boolean
}) {
  return (
    <div style={{ padding: '8px 12px 4px', display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
      {SUGGESTIONS.map((s, i) => (
        <button
          key={i}
          onClick={() => !disabled && onSelect(s)}
          disabled={disabled}
          style={{
            background: isDark ? 'rgba(30,41,59,0.75)' : 'rgba(241,245,249,0.9)',
            border: `1px solid ${isDark ? 'rgba(99,102,241,0.18)' : 'rgba(99,102,241,0.16)'}`,
            borderRadius: '8px', padding: '5px 9px',
            fontSize: '11.5px', color: isDark ? '#94a3b8' : '#475569',
            cursor: disabled ? 'not-allowed' : 'pointer',
            textAlign: 'left', lineHeight: 1.35,
            transition: 'border-color 0.12s, color 0.12s, background 0.12s',
            opacity: disabled ? 0.45 : 1,
          }}
          onMouseEnter={e => {
            if (disabled) return
            const el = e.currentTarget as HTMLButtonElement
            el.style.borderColor = 'rgba(99,102,241,0.5)'
            el.style.color = '#818cf8'
            el.style.background = isDark ? 'rgba(99,102,241,0.1)' : 'rgba(99,102,241,0.06)'
          }}
          onMouseLeave={e => {
            const el = e.currentTarget as HTMLButtonElement
            el.style.borderColor = isDark ? 'rgba(99,102,241,0.18)' : 'rgba(99,102,241,0.16)'
            el.style.color = isDark ? '#94a3b8' : '#475569'
            el.style.background = isDark ? 'rgba(30,41,59,0.75)' : 'rgba(241,245,249,0.9)'
          }}
        >{s}</button>
      ))}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function ChatBot({ authFetch, theme = 'dark' }: Props) {
  const isDark = theme === 'dark'

  const [open,         setOpen]         = useState(false)
  const [input,        setInput]        = useState('')
  const [loading,      setLoading]      = useState(false)
  const [showSuggest,  setShowSuggest]  = useState(true)
  const [isMobile,     setIsMobile]     = useState(false)

  const WELCOME: Message = useMemo(() => ({
    id: genId(), role: 'assistant', ts: Date.now(),
    text: 'Tôi là **LSR Coach** — AI coach phân tích dữ liệu học tập.\n\nHỏi tôi về: tín hiệu rủi ro, hành vi học tập, chiến lược cải thiện từ báo cáo AI của bạn.\n\nTôi không tư vấn tâm lý hay các vấn đề ngoài phạm vi học tập.',
  }), [])

  const [messages, setMessages] = useState<Message[]>([WELCOME])

  const endRef   = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Detect mobile
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  // Scroll to bottom
  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, open, loading])

  // Focus textarea when opened
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 150)
  }, [open])

  // Prevent body scroll on mobile when chat is open
  useEffect(() => {
    if (isMobile && open) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [isMobile, open])

  const doSend = useCallback(async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || loading) return

    setMessages(prev => [...prev, { id: genId(), role: 'user', text: trimmed, ts: Date.now() }])
    setInput('')
    // reset textarea height
    if (inputRef.current) {
      inputRef.current.style.height = 'auto'
    }
    setLoading(true)
    // hide suggestions after first real message
    if (showSuggest) setShowSuggest(false)

    try {
      const res  = await authFetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: trimmed }),
      })
      const data = await res.json() as Record<string, unknown>

      if (!res.ok || !data.reply) {
        setMessages(prev => [...prev, {
          id: genId(), role: 'error',
          text: typeof data.message === 'string' ? data.message : 'Không thể kết nối AI. Thử lại sau.',
          ts: Date.now(),
        }])
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
  }, [loading, authFetch, showSuggest])

  const sendMessage = useCallback(() => doSend(input), [doSend, input])

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
  }

  const handleClear = () => {
    setMessages([{ ...WELCOME, id: genId(), ts: Date.now() }])
    setShowSuggest(true)
  }

  // Window dimensions
  // Mobile: full screen overlay
  // Desktop: fixed panel above FAB
  const windowStyle: React.CSSProperties = isMobile ? {
    position: 'fixed',
    inset: 0,
    zIndex: 1100,
    display: 'flex',
    flexDirection: 'column',
    background: isDark ? '#080c1a' : '#ffffff',
    animation: 'lsrSlideUp 0.22s ease-out',
  } : {
    position: 'fixed',
    bottom: '80px',
    right: '16px',
    zIndex: 1050,
    width: '360px',
    height: '520px',
    display: 'flex',
    flexDirection: 'column',
    background: isDark ? 'rgba(8,12,26,0.98)' : 'rgba(255,255,255,0.99)',
    border: `1px solid ${isDark ? 'rgba(99,102,241,0.22)' : 'rgba(99,102,241,0.16)'}`,
    borderRadius: '18px',
    boxShadow: isDark
      ? '0 12px 48px rgba(0,0,0,0.65), 0 0 0 1px rgba(99,102,241,0.08)'
      : '0 12px 40px rgba(0,0,0,0.14)',
    overflow: 'hidden',
    animation: 'lsrSlideUp 0.22s cubic-bezier(0.34,1.56,0.64,1)',
  }

  return (
    <>
      <style>{`
        @keyframes lsrDot {
          0%,60%,100% { transform:translateY(0); opacity:.4; }
          30% { transform:translateY(-5px); opacity:1; }
        }
        @keyframes lsrSlideUp {
          from { opacity:0; transform:translateY(14px) scale(0.98); }
          to   { opacity:1; transform:translateY(0) scale(1); }
        }
        @keyframes lsrPop {
          from { opacity:0; transform:scale(0.7); }
          to   { opacity:1; transform:scale(1); }
        }
        .lsr-input:focus { outline:none; }
        .lsr-send:hover:not(:disabled) { opacity:.82; transform:scale(1.06); }
        .lsr-send:disabled { opacity:.3; cursor:not-allowed; }
        .lsr-fab { transition: transform .2s, box-shadow .2s !important; }
        .lsr-fab:hover { transform:scale(1.09) !important; }
        .lsr-scroll::-webkit-scrollbar { width:3px; }
        .lsr-scroll::-webkit-scrollbar-track { background:transparent; }
        .lsr-scroll::-webkit-scrollbar-thumb { background:rgba(99,102,241,.22); border-radius:2px; }
        .lsr-hdr-btn { background:none; border:none; cursor:pointer; border-radius:7px; padding:5px 6px; transition:background .13s, color .13s; display:flex; align-items:center; justify-content:center; }
        .lsr-hdr-btn:hover { background: ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}; }
      `}</style>

      {/* ── FAB ───────────────────────────────────────────────────────────── */}
      {/* Only show FAB when chat is closed, or on desktop always */}
      {(!open || !isMobile) && (
        <button
          className="lsr-fab"
          onClick={() => setOpen(o => !o)}
          aria-label={open ? 'Đóng LSR Coach' : 'Mở LSR Coach'}
          style={{
            position: 'fixed',
            bottom: '24px',
            right: '20px',
            zIndex: 1200,
            width: '50px', height: '50px',
            borderRadius: '50%', border: 'none',
            background: open
              ? (isDark ? 'rgba(30,41,59,0.95)' : '#e2e8f0')
              : 'linear-gradient(135deg,#4f46e5,#7c3aed)',
            boxShadow: open
              ? '0 4px 14px rgba(0,0,0,0.22)'
              : '0 4px 18px rgba(99,102,241,0.48)',
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '20px',
            animation: 'lsrPop 0.3s cubic-bezier(0.34,1.56,0.64,1)',
          }}
        >
          {open ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
              stroke={isDark ? '#94a3b8' : '#475569'} strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          ) : '🧮'}
        </button>
      )}

      {/* ── Chat window ───────────────────────────────────────────────────── */}
      {open && (
        <div style={windowStyle}>

          {/* Header */}
          <div style={{
            padding: isMobile ? '12px 14px 11px' : '11px 14px',
            background: isDark ? 'rgba(10,15,30,0.99)' : 'rgba(248,250,252,0.99)',
            borderBottom: `1px solid ${isDark ? 'rgba(99,102,241,0.12)' : 'rgba(99,102,241,0.1)'}`,
            display: 'flex', alignItems: 'center', gap: '9px',
            flexShrink: 0,
            // Safe area for mobile status bar
            paddingTop: isMobile ? 'max(12px, env(safe-area-inset-top, 12px))' : '11px',
          }}>
            <div style={{
              width: '30px', height: '30px', borderRadius: '50%', flexShrink: 0,
              background: 'linear-gradient(135deg,#6366f1,#8b5cf6)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '14px', boxShadow: '0 0 8px rgba(99,102,241,0.3)',
            }}>🧮</div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '13px', fontWeight: 700, color: isDark ? '#e2e8f0' : '#0f172a', fontFamily: 'Space Grotesk, sans-serif' }}>
                LSR Coach
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#22c55e', flexShrink: 0 }} />
                <span style={{ fontSize: '10px', color: isDark ? '#64748b' : '#94a3b8' }}>AI Coach · Phân tích học tập</span>
              </div>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: '2px', alignItems: 'center' }}>
              {/* Toggle suggestions */}
              <button
                className="lsr-hdr-btn"
                onClick={() => setShowSuggest(v => !v)}
                title={showSuggest ? 'Ẩn gợi ý' : 'Hiện câu hỏi gợi ý'}
                style={{
                  color: showSuggest ? '#818cf8' : (isDark ? '#475569' : '#94a3b8'),
                  fontSize: '14px',
                }}
              >💡</button>

              {/* Clear */}
              <button
                className="lsr-hdr-btn"
                onClick={handleClear}
                title="Xóa lịch sử"
                style={{ color: isDark ? '#475569' : '#94a3b8', fontSize: '14px' }}
              >🗑️</button>

              {/* Close — always visible on mobile, also on desktop */}
              <button
                className="lsr-hdr-btn"
                onClick={() => setOpen(false)}
                title="Đóng"
                style={{ color: isDark ? '#475569' : '#94a3b8' }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
          </div>

          {/* Suggestion chips (collapsible) */}
          {showSuggest && (
            <div style={{
              borderBottom: `1px solid ${isDark ? 'rgba(99,102,241,0.08)' : 'rgba(99,102,241,0.07)'}`,
              background: isDark ? 'rgba(10,15,30,0.95)' : 'rgba(248,250,252,0.95)',
              flexShrink: 0,
            }}>
              <SuggestionChips
                isDark={isDark}
                onSelect={s => doSend(s)}
                disabled={loading}
              />
            </div>
          )}

          {/* Messages */}
          <div
            className="lsr-scroll"
            style={{
              flex: 1, overflowY: 'auto',
              padding: '14px 12px 6px',
              display: 'flex', flexDirection: 'column',
              minHeight: 0,
              // Extra bottom padding on mobile to avoid overlap with home indicator
              paddingBottom: isMobile ? 'max(6px, env(safe-area-inset-bottom, 6px))' : '6px',
            }}
          >
            {messages.map(msg => <Bubble key={msg.id} msg={msg} isDark={isDark} />)}

            {/* Typing indicator */}
            {loading && (
              <div style={{ display: 'flex', gap: '7px', marginBottom: '10px', alignItems: 'flex-start' }}>
                <div style={{
                  width: '26px', height: '26px', borderRadius: '50%', flexShrink: 0,
                  background: 'linear-gradient(135deg,#6366f1,#8b5cf6)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px',
                }}>🧮</div>
                <div style={{
                  background: isDark ? 'rgba(15,23,42,0.95)' : 'rgba(241,245,249,0.98)',
                  border: `1px solid ${isDark ? 'rgba(99,102,241,0.18)' : 'rgba(99,102,241,0.14)'}`,
                  borderRadius: '4px 16px 16px 16px', padding: '10px 14px',
                }}>
                  <TypingDots />
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>

          {/* Input area */}
          <div style={{
            padding: '8px 12px',
            borderTop: `1px solid ${isDark ? 'rgba(99,102,241,0.1)' : 'rgba(99,102,241,0.08)'}`,
            background: isDark ? 'rgba(10,15,30,0.99)' : 'rgba(248,250,252,0.99)',
            flexShrink: 0,
            // Safe area for iOS home bar
            paddingBottom: isMobile
              ? 'max(10px, env(safe-area-inset-bottom, 10px))'
              : '8px',
          }}>
            <div style={{
              display: 'flex', gap: '8px', alignItems: 'flex-end',
              background: isDark ? 'rgba(20,30,50,0.88)' : '#ffffff',
              border: `1px solid ${isDark ? 'rgba(99,102,241,0.2)' : 'rgba(99,102,241,0.2)'}`,
              borderRadius: '12px', padding: '8px 8px 8px 12px',
            }}>
              <textarea
                ref={inputRef}
                className="lsr-input"
                value={input}
                onChange={e => {
                  setInput(e.target.value)
                  e.target.style.height = 'auto'
                  e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'
                }}
                onKeyDown={handleKey}
                placeholder="Hỏi về dữ liệu học tập…"
                rows={1}
                disabled={loading}
                style={{
                  flex: 1, background: 'none', border: 'none', resize: 'none',
                  color: isDark ? '#e2e8f0' : '#0f172a',
                  fontSize: '14px', lineHeight: '1.5',
                  fontFamily: 'Space Grotesk, sans-serif',
                  padding: 0, maxHeight: '120px', overflowY: 'auto',
                  // Prevent iOS zoom on input focus (font must be ≥16px for that, but 14px is fine with explicit override)
                  WebkitTextSizeAdjust: '100%',
                }}
              />
              <button
                className="lsr-send"
                onClick={sendMessage}
                disabled={!input.trim() || loading}
                style={{
                  width: '34px', height: '34px', borderRadius: '9px', border: 'none',
                  background: 'linear-gradient(135deg,#4f46e5,#7c3aed)',
                  color: '#fff', cursor: 'pointer', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'all .15s',
                  boxShadow: '0 2px 8px rgba(79,70,229,0.38)',
                }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13"/>
                  <polygon points="22 2 15 22 11 13 2 9 22 2"/>
                </svg>
              </button>
            </div>
            <div style={{
              textAlign: 'center', marginTop: '5px',
              fontSize: '10px', color: isDark ? '#334155' : '#cbd5e1', lineHeight: 1.4,
            }}>
              Chỉ phân tích hành vi học tập · Không tư vấn tâm lý
            </div>
          </div>
        </div>
      )}
    </>
  )
}
