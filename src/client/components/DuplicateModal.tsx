import React from 'react'

export interface TodaySession {
  id: number
  session_number: number
  session_time: string | null
  study_hours: number
  focus_level: number
  dropout_feeling: number
}

interface Props {
  date: string
  sessions: TodaySession[]
  onAddNew: () => void
  onUpdate: () => void
  onKeep: () => void
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const focusColor   = (v: number) => v >= 4 ? '#22c55e' : v >= 3 ? '#3b82f6' : '#f59e0b'
const dropoutColor = (v: number) => v >= 4 ? '#ef4444' : v >= 3 ? '#f59e0b' : '#22c55e'

function Metric({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <span style={{ color, background: 'rgba(0,0,0,0.4)', border: `1px solid ${color}44`, fontSize: '11px', fontWeight: 600, padding: '1px 7px', borderRadius: '4px' }}>
      {label} {value}
    </span>
  )
}

function SessionRow({ s }: { s: TodaySession }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', background: '#0a0a0a', border: '1px solid #1e1e1e', borderRadius: '7px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ background: '#1e3a5f', color: '#3b82f6', fontSize: '10px', fontWeight: 700, padding: '2px 7px', borderRadius: '4px', letterSpacing: '0.3px' }}>S{s.session_number}</span>
        {s.session_time && <span style={{ color: '#555', fontSize: '11px', fontFamily: 'monospace' }}>{s.session_time}</span>}
        <span style={{ color: '#3b82f6', fontSize: '12px', fontWeight: 600 }}>{s.study_hours}h học</span>
      </div>
      <div style={{ display: 'flex', gap: '6px' }}>
        <Metric label="TC" value={`${s.focus_level}/5`}   color={focusColor(s.focus_level)} />
        <Metric label="BC" value={`${s.dropout_feeling}/5`} color={dropoutColor(s.dropout_feeling)} />
      </div>
    </div>
  )
}

// ── Option button ─────────────────────────────────────────────────────────────
const VARIANTS = {
  primary:   { bg: 'rgba(59,130,246,0.08)',  border: 'rgba(59,130,246,0.30)',  bgH: 'rgba(59,130,246,0.15)', borderH: 'rgba(59,130,246,0.55)', title: '#3b82f6', sub: '#1e4080' },
  secondary: { bg: 'rgba(245,158,11,0.08)',  border: 'rgba(245,158,11,0.28)',  bgH: 'rgba(245,158,11,0.15)', borderH: 'rgba(245,158,11,0.50)', title: '#f59e0b', sub: '#665530' },
  tertiary:  { bg: '#0c0c0c',               border: '#222222',                bgH: '#141414',               borderH: '#333333',               title: '#aaaaaa', sub: '#444444' },
}

function OptionBtn({ icon, title, subtitle, variant, onClick }: { icon: string; title: string; subtitle: string; variant: keyof typeof VARIANTS; onClick: () => void }) {
  const [hov, setHov] = React.useState(false)
  const v = VARIANTS[variant]
  return (
    <button onClick={onClick} onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{ width: '100%', padding: '11px 14px', background: hov ? v.bgH : v.bg, border: `1px solid ${hov ? v.borderH : v.border}`, borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '11px', transition: 'all 0.15s', textAlign: 'left' }}>
      <span style={{ fontSize: '17px', flexShrink: 0 }}>{icon}</span>
      <div>
        <div style={{ color: v.title, fontSize: '13px', fontWeight: 600, lineHeight: 1.3 }}>{title}</div>
        <div style={{ color: v.sub, fontSize: '11px', marginTop: '2px' }}>{subtitle}</div>
      </div>
    </button>
  )
}

// ── Modal ─────────────────────────────────────────────────────────────────────
export default function DuplicateModal({ date, sessions, onAddNew, onUpdate, onKeep }: Props) {
  const n = sessions.length; const last = sessions[n - 1]
  return (
    <>
      <div onClick={onKeep} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.72)', zIndex: 3000, animation: 'fadeIn 0.18s ease' }} />
      <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 3001, width: '100%', maxWidth: '440px', background: '#111111', border: '1px solid #2a2a2a', borderRadius: '12px', padding: '22px', boxShadow: '0 24px 60px rgba(0,0,0,0.75)', animation: 'modalIn 0.25s cubic-bezier(0.34,1.25,0.64,1)', maxHeight: '90vh', overflowY: 'auto' }}>

        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '11px', marginBottom: '16px' }}>
          <div style={{ flexShrink: 0, width: '36px', height: '36px', borderRadius: '8px', background: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.28)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px' }}>📋</div>
          <div>
            <h3 style={{ color: '#ffffff', fontSize: '15px', fontWeight: 700, margin: 0, marginBottom: '3px' }}>Đã có phiên học hôm nay</h3>
            <p style={{ color: '#666', fontSize: '12px', margin: 0, lineHeight: 1.5 }}>
              Bạn đã ghi <span style={{ color: '#3b82f6', fontWeight: 600 }}>{n} phiên</span> vào ngày <span style={{ color: '#aaa', fontWeight: 600 }}>{date}</span>
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', marginBottom: '16px' }}>
          {sessions.map(s => <SessionRow key={s.id} s={s} />)}
        </div>

        <div style={{ borderTop: '1px solid #1e1e1e', marginBottom: '14px', paddingTop: '14px' }}>
          <div style={{ color: '#444', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '10px' }}>Chọn hành động</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
            <OptionBtn icon="➕" title="Thêm phiên mới"          subtitle={`Ghi thêm Phiên ${n + 1} cho hôm nay`}                    variant="primary"   onClick={onAddNew} />
            <OptionBtn icon="🔄" title="Cập nhật phiên cuối"     subtitle={`Ghi đè Phiên ${last?.session_number ?? n} bằng dữ liệu mới`} variant="secondary" onClick={onUpdate} />
            <OptionBtn icon="✅" title="Giữ nguyên tất cả"       subtitle="Bỏ qua, giữ các phiên hiện có"                              variant="tertiary"  onClick={onKeep} />
          </div>
        </div>

      </div>
      <style>{`
        @keyframes fadeIn  { from{opacity:0} to{opacity:1} }
        @keyframes modalIn { from{opacity:0;transform:translate(-50%,-48%) scale(0.96)} to{opacity:1;transform:translate(-50%,-50%) scale(1)} }
      `}</style>
    </>
  )
}
