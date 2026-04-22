import React, { useState, useRef, useEffect, useCallback } from 'react'

interface Message {
  id: string
  role: 'user' | 'assistant' | 'error'
  text: string
  ts: number
}

interface Props {
  authFetch: (url: string, options?: RequestInit) => Promise<Response>
  theme?: 'dark' | 'light'
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function genId() { return Math.random().toString(36).slice(2, 9) }

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
}

// ── Markdown-lite renderer (bold, inline-code, bullet lists) ──────────────────
function renderText(text: string) {
  const lines = text.split('\n')
  const elements: React.ReactNode[] = []

  lines.forEach((line, i) => {
    const trimmed = line.trimStart()

    // Bullet list
    if (/^[•\-\*]\s/.test(trimmed)) {
      const content = trimmed.replace(/^[•\-\*]\s/, '')
      elements.push(
        <div key={i} style={{ display: 'flex', gap: '6px', marginTop: '2px' }}>
          <span style={{ color: '#818cf8', flexShrink: 0, marginTop: '1px' }}>•</span>
          <span>{inlineFormat(content)}</span>
        </div>
      )
    }
    // Numbered list
    else if (/^\d+\.\s/.test(trimmed)) {
      const num = trimmed.match(/^(\d+)\./)?.[1]
      const content = trimmed.replace(/^\d+\.\s/, '')
      elements.push(
        <div key={i} style={{ display: 'flex', gap: '6px', marginTop: '2px' }}>
          <span style={{ color: '#818cf8', flexShrink: 0, minWidth: '16px' }}>{num}.</span>
          <span>{inlineFormat(content)}</span>
        </div>
      )
    }
    // Empty line → spacer
    else if (trimmed === '') {
      if (i > 0 && i < lines.length - 1) elements.push(<div key={i} style={{ height: '6px' }} />)
    }
    // Normal line
    else {
      elements.push(<div key={i}>{inlineFormat(line)}</div>)
    }
  })

  return <>{elements}</>
}

function inlineFormat(text: string): React.ReactNode {
  // Split on **bold** and `code`
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
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

  if (isUser) return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '10px' }}>
      <div style={{ maxWidth: '78%' }}>
        <div style={{
          background: 'linear-gradient(135deg, #4f46e5, #7c3aed)',
          color: '#fff', borderRadius: '16px 16px 4px 16px',
          padding: '9px 13px', fontSize: '13px', lineHeight: 1.55,
          boxShadow: '0 2px 8px rgba(79,70,229,0.35)',
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
      <div style={{ maxWidth: '85%' }}>
        <div style={{
          background: isDark ? 'rgba(127,29,29,0.6)' : '#fee2e2',
          border: '1px solid rgba(239,68,68,0.35)',
          color: isDark ? '#fca5a5' : '#991b1b',
          borderRadius: '16px 16px 16px 4px',
          padding: '9px 13px', fontSize: '13px', lineHeight: 1.55,
        }}>
          ⚠️ {msg.text}
        </div>
      </div>
    </div>
  )

  return (
    <div style={{ display: 'flex', gap: '8px', marginBottom: '10px', alignItems: 'flex-start' }}>
      {/* Avatar */}
      <div style={{
        width: '28px', height: '28px', borderRadius: '50%', flexShrink: 0,
        background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '13px', boxShadow: '0 0 8px rgba(99,102,241,0.4)',
      }}>📡</div>
      <div style={{ maxWidth: '85%' }}>
        <div style={{
          background: isDark ? 'rgba(30,41,59,0.95)' : 'rgba(241,245,249,0.98)',
          border: `1px solid ${isDark ? 'rgba(99,102,241,0.2)' : 'rgba(99,102,241,0.15)'}`,
          color: isDark ? '#e2e8f0' : '#0f172a',
          borderRadius: '16px 16px 16px 4px',
          padding: '10px 13px', fontSize: '13px', lineHeight: 1.6,
          boxShadow: isDark ? '0 2px 8px rgba(0,0,0,0.3)' : '0 2px 8px rgba(0,0,0,0.08)',
        }}>
          {renderText(msg.text)}
        </div>
        <div style={{ fontSize: '10px', color: isDark ? '#475569' : '#94a3b8', marginTop: '3px', paddingLeft: '4px' }}>
          LSR AI · {formatTime(msg.ts)}
        </div>
      </div>
    </div>
  )
}

// ── Main ChatBot component ─────────────────────────────────────────────────────
export default function ChatBot({ authFetch, theme = 'dark' }: Props) {
  const isDark = theme === 'dark'
  const [open,    setOpen]    = useState(false)
  const [input,   setInput]   = useState('')
  const [loading, setLoading] = useState(false)
  const [messages, setMessages] = useState<Message[]>([
    {
      id: genId(),
      role: 'assistant',
      text: 'Xin chào! Tôi là trợ lý AI của LSR Engine.\n\nBạn có thể hỏi tôi về:\n• Báo cáo phân tích học tập của bạn\n• Các tín hiệu rủi ro được phát hiện\n• Chiến lược cải thiện hiệu suất\n• Bất kỳ câu hỏi nào về dữ liệu học tập',
      ts: Date.now(),
    },
  ])
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef  = useRef<HTMLTextAreaElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Scroll to bottom when messages change
  useEffect(() => {
    if (open) messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, open, loading])

  // Focus input when opened
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100)
  }, [open])

  const sendMessage = useCallback(async () => {
    const text = input.trim()
    if (!text || loading) return

    const userMsg: Message = { id: genId(), role: 'user', text, ts: Date.now() }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setLoading(true)

    try {
      const res = await authFetch('/api/chat', {
        method: 'POST',
        body: JSON.stringify({ message: text }),
      })
      const data = await res.json() as Record<string, unknown>

      if (!res.ok || !data.reply) {
        const errMsg = typeof data.message === 'string' ? data.message : 'Không thể kết nối AI. Thử lại sau.'
        setMessages(prev => [...prev, { id: genId(), role: 'error', text: errMsg, ts: Date.now() }])
      } else {
        setMessages(prev => [...prev, { id: genId(), role: 'assistant', text: String(data.reply), ts: Date.now() }])
      }
    } catch {
      setMessages(prev => [...prev, { id: genId(), role: 'error', text: 'Lỗi kết nối mạng. Kiểm tra internet rồi thử lại.', ts: Date.now() }])
    } finally {
      setLoading(false)
    }
  }, [input, loading, authFetch])

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  // Unread dot — show when closed and last message is from assistant
  const hasUnread = !open && messages.length > 1 && messages[messages.length - 1].role === 'assistant'

  return (
    <>
      {/* CSS animations */}
      <style>{`
        @keyframes chatDot {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
          30% { transform: translateY(-5px); opacity: 1; }
        }
        @keyframes chatSlideUp {
          from { opacity: 0; transform: translateY(16px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes chatBubblePop {
          from { opacity: 0; transform: scale(0.8); }
          to   { opacity: 1; transform: scale(1); }
        }
        .chat-input:focus { outline: none; }
        .chat-send-btn:hover:not(:disabled) { opacity: 0.85; transform: scale(1.05); }
        .chat-send-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .chat-bubble-btn:hover { transform: scale(1.08); box-shadow: 0 6px 24px rgba(99,102,241,0.55) !important; }
        .chat-scroll::-webkit-scrollbar { width: 3px; }
        .chat-scroll::-webkit-scrollbar-track { background: transparent; }
        .chat-scroll::-webkit-scrollbar-thumb { background: rgba(99,102,241,0.25); border-radius: 2px; }
        .chat-clear-btn:hover { opacity: 1 !important; }
      `}</style>

      {/* ── Floating bubble button ── */}
      <div
        ref={bottomRef}
        style={{
          position: 'fixed', bottom: '80px', right: '20px', zIndex: 1000,
          animation: 'chatBubblePop 0.35s cubic-bezier(0.34,1.56,0.64,1)',
        }}
      >
        <button
          className="chat-bubble-btn"
          onClick={() => setOpen(o => !o)}
          aria-label={open ? 'Đóng chat' : 'Mở chat AI'}
          style={{
            width: '52px', height: '52px', borderRadius: '50%', border: 'none',
            background: open
              ? (isDark ? 'rgba(30,41,59,0.95)' : 'rgba(241,245,249,0.98)')
              : 'linear-gradient(135deg, #4f46e5, #7c3aed)',
            boxShadow: open
              ? '0 4px 16px rgba(0,0,0,0.25)'
              : '0 4px 20px rgba(99,102,241,0.45)',
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '22px', transition: 'all 0.2s',
            position: 'relative',
          }}
        >
          {open ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={isDark ? '#94a3b8' : '#64748b'} strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          ) : '💬'}

          {/* Unread dot */}
          {hasUnread && (
            <span style={{
              position: 'absolute', top: '2px', right: '2px',
              width: '10px', height: '10px', borderRadius: '50%',
              background: '#22c55e',
              border: '2px solid ' + (isDark ? '#020617' : '#f1f5f9'),
            }} />
          )}
        </button>
      </div>

      {/* ── Chat window ── */}
      {open && (
        <div style={{
          position: 'fixed', bottom: '142px', right: '20px', zIndex: 999,
          width: '340px', height: '480px',
          background: isDark ? 'rgba(10,15,30,0.97)' : 'rgba(255,255,255,0.98)',
          border: `1px solid ${isDark ? 'rgba(99,102,241,0.25)' : 'rgba(99,102,241,0.18)'}`,
          borderRadius: '18px',
          boxShadow: isDark
            ? '0 8px 40px rgba(0,0,0,0.6), 0 0 0 1px rgba(99,102,241,0.1)'
            : '0 8px 40px rgba(0,0,0,0.15)',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
          animation: 'chatSlideUp 0.25s cubic-bezier(0.34,1.56,0.64,1)',
        }}>

          {/* Header */}
          <div style={{
            padding: '12px 16px',
            background: isDark ? 'rgba(15,23,42,0.98)' : 'rgba(248,250,252,0.98)',
            borderBottom: `1px solid ${isDark ? 'rgba(99,102,241,0.15)' : 'rgba(99,102,241,0.12)'}`,
            display: 'flex', alignItems: 'center', gap: '10px',
            flexShrink: 0,
          }}>
            <div style={{
              width: '32px', height: '32px', borderRadius: '50%',
              background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '15px', flexShrink: 0,
              boxShadow: '0 0 10px rgba(99,102,241,0.4)',
            }}>📡</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: '13px', fontWeight: 700,
                fontFamily: 'Space Grotesk, sans-serif',
                color: isDark ? '#e2e8f0' : '#0f172a',
              }}>LSR AI</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#22c55e', flexShrink: 0 }} />
                <span style={{ fontSize: '10px', color: isDark ? '#64748b' : '#94a3b8', fontFamily: 'Space Grotesk, sans-serif' }}>
                  Trợ lý phân tích học tập
                </span>
              </div>
            </div>
            {/* Clear chat */}
            <button
              className="chat-clear-btn"
              onClick={() => setMessages([{
                id: genId(), role: 'assistant',
                text: 'Cuộc trò chuyện đã được xóa. Bạn có thể bắt đầu hỏi câu hỏi mới.',
                ts: Date.now(),
              }])}
              title="Xóa lịch sử chat"
              style={{
                background: 'none', border: 'none', cursor: 'pointer', padding: '4px',
                color: isDark ? '#475569' : '#94a3b8', borderRadius: '6px',
                fontSize: '14px', opacity: 0.6, transition: 'opacity 0.15s',
                display: 'flex', alignItems: 'center',
              }}
            >🗑️</button>
          </div>

          {/* Messages */}
          <div
            className="chat-scroll"
            style={{
              flex: 1, overflowY: 'auto', padding: '14px 12px 8px',
              display: 'flex', flexDirection: 'column',
            }}
          >
            {messages.map(msg => <Bubble key={msg.id} msg={msg} isDark={isDark} />)}

            {/* Typing indicator */}
            {loading && (
              <div style={{ display: 'flex', gap: '8px', marginBottom: '10px', alignItems: 'flex-start' }}>
                <div style={{
                  width: '28px', height: '28px', borderRadius: '50%', flexShrink: 0,
                  background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px',
                }}>📡</div>
                <div style={{
                  background: isDark ? 'rgba(30,41,59,0.95)' : 'rgba(241,245,249,0.98)',
                  border: `1px solid ${isDark ? 'rgba(99,102,241,0.2)' : 'rgba(99,102,241,0.15)'}`,
                  borderRadius: '16px 16px 16px 4px',
                  padding: '10px 14px',
                }}>
                  <TypingDots />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input area */}
          <div style={{
            padding: '10px 12px',
            borderTop: `1px solid ${isDark ? 'rgba(99,102,241,0.12)' : 'rgba(99,102,241,0.1)'}`,
            background: isDark ? 'rgba(15,23,42,0.98)' : 'rgba(248,250,252,0.98)',
            flexShrink: 0,
          }}>
            <div style={{
              display: 'flex', gap: '8px', alignItems: 'flex-end',
              background: isDark ? 'rgba(30,41,59,0.8)' : 'rgba(255,255,255,0.9)',
              border: `1px solid ${isDark ? 'rgba(99,102,241,0.2)' : 'rgba(99,102,241,0.2)'}`,
              borderRadius: '12px', padding: '8px 8px 8px 12px',
              transition: 'border-color 0.15s',
            }}>
              <textarea
                ref={inputRef}
                className="chat-input"
                value={input}
                onChange={e => {
                  setInput(e.target.value)
                  // Auto-resize
                  e.target.style.height = 'auto'
                  e.target.style.height = Math.min(e.target.scrollHeight, 100) + 'px'
                }}
                onKeyDown={handleKey}
                placeholder="Nhập câu hỏi... (Enter để gửi)"
                rows={1}
                disabled={loading}
                style={{
                  flex: 1, background: 'none', border: 'none', resize: 'none',
                  color: isDark ? '#e2e8f0' : '#0f172a',
                  fontSize: '13px', lineHeight: '1.5', fontFamily: 'Space Grotesk, sans-serif',
                  padding: 0, maxHeight: '100px', overflowY: 'auto',
                }}
              />
              <button
                className="chat-send-btn"
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
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13"/>
                  <polygon points="22 2 15 22 11 13 2 9 22 2"/>
                </svg>
              </button>
            </div>
            <div style={{ textAlign: 'center', marginTop: '6px', fontSize: '10px', color: isDark ? '#334155' : '#cbd5e1', fontFamily: 'Space Grotesk, sans-serif' }}>
              Shift+Enter để xuống dòng
            </div>
          </div>
        </div>
      )}
    </>
  )
}
