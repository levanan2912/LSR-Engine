import React, { useEffect, useRef } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

export type ToastType = 'success' | 'error' | 'warning' | 'info'

export interface ToastItem {
  id: string
  type: ToastType
  title: string
  message?: string
  duration?: number   // ms, default 4500; 0 = persist
}

// ─── Single Toast ─────────────────────────────────────────────────────────────

const ICONS: Record<ToastType, string> = {
  success: '✓',
  error:   '✕',
  warning: '⚠',
  info:    'ℹ',
}

const COLORS: Record<ToastType, { bg: string; border: string; text: string; progress: string }> = {
  success: { bg: 'rgba(34,197,94,0.08)',  border: 'rgba(34,197,94,0.28)',  text: '#22c55e', progress: '#22c55e' },
  error:   { bg: 'rgba(239,68,68,0.08)',  border: 'rgba(239,68,68,0.28)',  text: '#ef4444', progress: '#ef4444' },
  warning: { bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.28)', text: '#f59e0b', progress: '#f59e0b' },
  info:    { bg: 'rgba(59,130,246,0.08)', border: 'rgba(59,130,246,0.28)', text: '#3b82f6', progress: '#3b82f6' },
}

interface ToastCardProps {
  toast: ToastItem
  onDismiss: (id: string) => void
}

function ToastCard({ toast, onDismiss }: ToastCardProps) {
  const c = COLORS[toast.type]
  const duration = toast.duration ?? 4500
  const progressRef = useRef<HTMLDivElement>(null)

  // Animate the progress bar shrinking
  useEffect(() => {
    if (duration === 0 || !progressRef.current) return
    const el = progressRef.current
    el.style.transition = 'none'
    el.style.width = '100%'
    // Force reflow
    void el.offsetWidth
    el.style.transition = `width ${duration}ms linear`
    el.style.width = '0%'
  }, [duration])

  return (
    <div
      role="alert"
      style={{
        position: 'relative', overflow: 'hidden',
        background: c.bg,
        border: `1px solid ${c.border}`,
        borderRadius: '9px',
        padding: '11px 36px 11px 13px',
        minWidth: '260px', maxWidth: '340px',
        boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
        animation: 'toastIn 0.28s cubic-bezier(0.34,1.3,0.64,1)',
        cursor: 'default',
      }}
    >
      {/* Body */}
      <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
        <span style={{
          flexShrink: 0,
          width: '20px', height: '20px',
          borderRadius: '50%',
          background: c.border,
          color: c.text,
          fontSize: '11px', fontWeight: 700,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          marginTop: '1px',
        }}>
          {ICONS[toast.type]}
        </span>
        <div>
          <div style={{ color: '#e8e8e8', fontSize: '13px', fontWeight: 600, lineHeight: '1.3' }}>
            {toast.title}
          </div>
          {toast.message && (
            <div style={{ color: '#777', fontSize: '12px', marginTop: '3px', lineHeight: '1.4' }}>
              {toast.message}
            </div>
          )}
        </div>
      </div>

      {/* Close button */}
      <button
        onClick={() => onDismiss(toast.id)}
        style={{
          position: 'absolute', top: '8px', right: '9px',
          background: 'transparent', border: 'none',
          color: '#444', fontSize: '14px', cursor: 'pointer',
          padding: '2px 4px', borderRadius: '3px',
          lineHeight: 1,
          transition: 'color 0.15s',
        }}
        onMouseEnter={e => (e.currentTarget.style.color = '#aaa')}
        onMouseLeave={e => (e.currentTarget.style.color = '#444')}
      >×</button>

      {/* Progress bar */}
      {duration > 0 && (
        <div style={{
          position: 'absolute', bottom: 0, left: 0,
          height: '2px', background: c.border,
          width: '100%',
        }}>
          <div
            ref={progressRef}
            style={{
              height: '100%',
              background: c.progress,
              width: '100%',
            }}
          />
        </div>
      )}
    </div>
  )
}

// ─── Toast Container ─────────────────────────────────────────────────────────

interface ToastContainerProps {
  toasts: ToastItem[]
  onDismiss: (id: string) => void
}

export function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  return (
    <div style={{
      position: 'fixed', top: '66px', right: '18px',
      zIndex: 2000,
      display: 'flex', flexDirection: 'column', gap: '8px',
      pointerEvents: 'none',
    }}>
      <style>{`
        @keyframes toastIn {
          from { opacity: 0; transform: translateX(40px) scale(0.96); }
          to   { opacity: 1; transform: translateX(0)   scale(1);    }
        }
      `}</style>
      {toasts.map(t => (
        <div key={t.id} style={{ pointerEvents: 'all' }}>
          <ToastCard toast={t} onDismiss={onDismiss} />
        </div>
      ))}
    </div>
  )
}

// ─── useToast hook ────────────────────────────────────────────────────────────

export function useToast() {
  const [toasts, setToasts] = React.useState<ToastItem[]>([])
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const dismiss = React.useCallback((id: string) => {
    clearTimeout(timers.current.get(id))
    timers.current.delete(id)
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const push = React.useCallback((item: Omit<ToastItem, 'id'>) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const duration = item.duration ?? 4500
    setToasts(prev => [...prev.slice(-4), { ...item, id, duration }]) // max 5 toasts
    if (duration > 0) {
      const t = setTimeout(() => dismiss(id), duration + 100)
      timers.current.set(id, t)
    }
    return id
  }, [dismiss])

  // Helpers
  const success = (title: string, message?: string, duration?: number) =>
    push({ type: 'success', title, message, duration })
  const error = (title: string, message?: string, duration?: number) =>
    push({ type: 'error', title, message, duration: duration ?? 6000 })
  const warning = (title: string, message?: string, duration?: number) =>
    push({ type: 'warning', title, message, duration: duration ?? 5500 })
  const info = (title: string, message?: string, duration?: number) =>
    push({ type: 'info', title, message, duration })

  return { toasts, dismiss, push, success, error, warning, info }
}
