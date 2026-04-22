import React, { useState, useEffect, useCallback } from 'react'
import { User, SessionWithReport, SessionReport, HistoryData } from '../types'
import ChangePasswordModal from '../components/ChangePasswordModal'
import ChatBot from '../components/ChatBot'

interface Props {
  user: User
  authFetch: (url: string, options?: RequestInit) => Promise<Response>
  onLogout: () => void
  onNavigate: (page: 'dashboard' | 'history' | 'forum') => void
  currentPage: string
  theme?: 'dark' | 'light'
  onToggleTheme?: () => void
}

// ─── Risk palette ─────────────────────────────────────────────────────────────
const RISK = {
  'Stable':      { bg: 'rgba(34,197,94,0.10)',  border: 'rgba(34,197,94,0.3)',  text: '#22c55e', dot: '#22c55e' },
  'Fluctuating': { bg: 'rgba(245,158,11,0.10)', border: 'rgba(245,158,11,0.3)', text: '#f59e0b', dot: '#f59e0b' },
  'High Risk':   { bg: 'rgba(239,68,68,0.10)',  border: 'rgba(239,68,68,0.3)',  text: '#ef4444', dot: '#ef4444' },
} as const

const RISK_VI: Record<string, string> = { 'Stable': 'Ổn định', 'Fluctuating': 'Dao động', 'High Risk': 'Rủi ro cao' }
type RiskKey = keyof typeof RISK
const riskLabel = (l: string) => RISK_VI[l] ?? l
const riskStyle = (l: string) => RISK[l as RiskKey] ?? RISK['Fluctuating']
const focusColor   = (v: number) => v >= 4 ? '#22c55e' : v >= 3 ? '#60a5fa' : '#f59e0b'
const dropoutColor = (v: number) => v >= 4 ? '#ef4444' : v >= 3 ? '#f59e0b' : '#22c55e'

const NAV = [{ id: 'dashboard', label: '🏠 Bảng điều khiển' }, { id: 'history', label: '📈 Lịch sử' }, { id: 'forum', label: '💬 Diễn đàn' }]

// ─── Risk Badge ───────────────────────────────────────────────────────────────
function RiskBadge({ level, small }: { level: string; small?: boolean }) {
  const rs = riskStyle(level)
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center',
      gap: small ? '4px' : '5px',
      background: rs.bg,
      border: `1px solid ${rs.border}`,
      borderRadius: '6px',
      padding: small ? '3px 8px' : '4px 10px',
      flexShrink: 0,
    }}>
      <span style={{ width: small ? '5px' : '6px', height: small ? '5px' : '6px', borderRadius: '50%', background: rs.dot, flexShrink: 0 }} />
      <span style={{ color: rs.text, fontSize: small ? '10px' : '11px', fontWeight: 700, fontFamily: 'Space Grotesk, sans-serif', whiteSpace: 'nowrap' }}>{riskLabel(level)}</span>
    </div>
  )
}

// ─── Stat Chip ────────────────────────────────────────────────────────────────
function Chip({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
      <span style={{ fontSize: '10px', color: 'var(--chip-label, #94a3b8)', whiteSpace: 'nowrap' }}>{label}</span>
      <span style={{ fontSize: '12px', fontWeight: 700, color, fontFamily: 'JetBrains Mono, monospace', whiteSpace: 'nowrap' }}>{value}</span>
    </div>
  )
}

// ─── Day Summary Bar ──────────────────────────────────────────────────────────
function DaySummaryBar({ sessions }: { sessions: SessionWithReport[] }) {
  const total    = sessions.length
  const totHours = sessions.reduce((s, x) => s + (x.study_hours || 0), 0)
  const avgFocus = sessions.reduce((s, x) => s + (x.focus_level || 0), 0) / total
  const avgDrop  = sessions.reduce((s, x) => s + (x.dropout_feeling || 0), 0) / total
  const rankMap: Record<string, number> = { 'Stable': 0, 'Fluctuating': 1, 'High Risk': 2 }
  const hasReport = sessions.some(s => s.report)
  const worst = hasReport
    ? sessions.filter(s => s.report).map(s => s.report!.risk_level).reduce((w, l) => (rankMap[l] ?? 0) > (rankMap[w] ?? 0) ? l : w, 'Stable') as RiskKey
    : null

  return (
    <>
      {worst
        ? <RiskBadge level={worst} />
        : (
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: '4px',
            background: 'rgba(100,116,139,0.10)', border: '1px solid rgba(100,116,139,0.25)',
            borderRadius: '6px', padding: '3px 8px', flexShrink: 0,
          }}>
            <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#64748b', flexShrink: 0 }} />
            <span style={{ color: '#94a3b8', fontSize: '10px', fontWeight: 700, fontFamily: 'Space Grotesk, sans-serif', whiteSpace: 'nowrap' }}>Chưa có AI</span>
          </div>
        )
      }
      <Chip label="" value={`${totHours.toFixed(1)}h`} color="#60a5fa" />
      <Chip label="Focus" value={`${avgFocus.toFixed(1)}/5`} color={focusColor(avgFocus)} />
      <Chip label="Dropout" value={`${avgDrop.toFixed(1)}/5`} color={dropoutColor(avgDrop)} />
      <div style={{ background: 'var(--bg-card, rgba(255,255,255,0.04))', border: '1px solid var(--border-card, rgba(255,255,255,0.08))', borderRadius: '5px', padding: '2px 8px', flexShrink: 0 }}>
        <span style={{ color: 'var(--text-muted, #64748b)', fontSize: '10px', fontFamily: 'JetBrains Mono, monospace' }}>{total} phiên</span>
      </div>
    </>
  )
}

// ─── Report Panel ─────────────────────────────────────────────────────────────
// Styled to match the dashboard MiniCard heading style
function ReportPanel({ report, riskLevel, isDark = true }: { report: SessionReport; riskLevel: string; isDark?: boolean }) {
  const rs = riskStyle(riskLevel)
  const riskColor = riskLevel === 'High Risk' ? '#f87171' : riskLevel === 'Fluctuating' ? '#fbbf24' : '#34d399'

  // MiniCard replica matching dashboard AnalysisReport style
  const Card = ({ icon, title, accentColor, children }: {
    icon: string; title: string; accentColor: string; children: React.ReactNode
  }) => (
    <div style={{
      background: isDark
        ? 'var(--bg-card, rgba(255,255,255,0.02))'
        : `${accentColor}0a`,           /* subtle tint of accent on light bg */
      border: `1px solid ${accentColor}${isDark ? '30' : '50'}`,   /* stronger border in light mode */
      borderRadius: '10px', padding: '10px 12px',
      boxShadow: isDark ? 'var(--card-shadow)' : `0 1px 4px rgba(0,0,0,0.06)`,
    }}>
      {/* Heading row — matches dashboard MiniCard */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '7px' }}>
        <span style={{ fontSize: '13px' }}>{icon}</span>
        <span style={{
          fontFamily: 'Space Grotesk, sans-serif',
          color: accentColor,
          fontSize: '9px', fontWeight: 700,
          textTransform: 'uppercase', letterSpacing: '0.7px',
        }}>{title}</span>
      </div>
      {children}
    </div>
  )

  return (
    <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>

      {report.key_signals.length > 0 && (
        <Card icon="⚠️" title="Tín hiệu phát hiện" accentColor="#fbbf24">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {report.key_signals.map((s, i) => (
              <div key={i} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                <span style={{ color: '#6366f1', fontSize: '11px', marginTop: '2px', flexShrink: 0 }}>▸</span>
                <span style={{ color: 'var(--text-primary)', fontSize: '12px', lineHeight: 1.55 }}>{s}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
        {report.short_term_forecast && (
          <Card icon="🔮" title="Dự báo 5–7 phiên tới" accentColor="#818cf8">
            <p style={{ color: 'var(--text-primary)', fontSize: '11px', lineHeight: 1.55, margin: 0 }}>{report.short_term_forecast}</p>
          </Card>
        )}
        {report.primary_risk_driver && (
          <Card icon="🎯" title="Vấn đề cốt lõi" accentColor={riskColor}>
            <p style={{ color: 'var(--text-primary)', fontSize: '11px', lineHeight: 1.55, margin: 0 }}>{report.primary_risk_driver}</p>
          </Card>
        )}
      </div>

      {report.intervention_strategy && (
        <Card icon="💡" title="Chiến lược can thiệp" accentColor="#34d399">
          <p style={{ color: 'var(--text-primary)', fontSize: '12px', lineHeight: 1.55, margin: 0 }}>{report.intervention_strategy}</p>
        </Card>
      )}

      {report.action_plan_48h.length > 0 && (
        <Card icon="📋" title="Kế hoạch hành động 48h" accentColor="#6366f1">
          <ol style={{ margin: 0, paddingLeft: '16px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {report.action_plan_48h.map((step, i) => (
              <li key={i} style={{ color: 'var(--text-primary)', fontSize: '12px', lineHeight: 1.55 }}>{step}</li>
            ))}
          </ol>
        </Card>
      )}

      {report.monitoring_protocol && (
        <Card icon="🔔" title="Giao thức giám sát" accentColor={riskColor}>
          <p style={{ color: 'var(--text-primary)', fontSize: '11px', lineHeight: 1.55, margin: 0 }}>{report.monitoring_protocol}</p>
        </Card>
      )}
    </div>
  )
}

// ─── Session Row ──────────────────────────────────────────────────────────────
function SessionRow({ session, expandedKey, onToggle, isDark = true }: {
  session: SessionWithReport
  expandedKey: string | null
  onToggle: (k: string) => void
  isDark?: boolean
}) {
  const key    = `${session.session_date}-${session.session_number}`
  const isOpen = expandedKey === key
  const report = session.report
  const riskLvl = report?.risk_level ?? ''

  return (
    <div style={{
      background: isOpen ? 'var(--bg-row-open, rgba(255,255,255,0.035))' : 'var(--bg-row, rgba(255,255,255,0.02))',
      border: `1px solid ${isOpen ? 'rgba(99,102,241,0.3)' : 'var(--border-row, rgba(255,255,255,0.06))'}`,
      borderRadius: '10px', overflow: 'hidden',
      transition: 'background 0.15s, border-color 0.15s',
      boxShadow: 'var(--card-shadow)',
    }}>
      {/* ── Row header ── */}
      {/* ── Row header — flex on mobile, grid on desktop — */}
      <div
        onClick={() => onToggle(key)}
        className="session-row-grid"
        style={{ alignItems: 'center', padding: '11px 14px', cursor: 'pointer' }}
      >
        {/* Session badge */}
        <span style={{
          background: 'rgba(99,102,241,0.15)', color: '#818cf8',
          fontSize: '11px', fontWeight: 700,
          padding: '3px 10px', borderRadius: '6px',
          fontFamily: 'JetBrains Mono, monospace',
          border: '1px solid rgba(99,102,241,0.2)',
          textAlign: 'center', whiteSpace: 'nowrap',
        }}>S{session.session_number}</span>

        {/* Giờ (Time) */}
        <span className="session-col-time" style={{ color: 'var(--session-time, #94a3b8)', fontSize: '12px', fontFamily: 'JetBrains Mono, monospace', whiteSpace: 'nowrap' }}>
          {session.session_time ?? '——:——'}
        </span>

        {/* Số giờ học (Hours) */}
        <span className="session-col-hours" style={{ color: '#60a5fa', fontSize: '13px', fontWeight: 700, fontFamily: 'JetBrains Mono, monospace', whiteSpace: 'nowrap' }}>
          {session.study_hours}h học
        </span>

        {/* Số lần mất tập trung (Distraction) — moved to 4th */}
        <div className="session-col-distract session-row-meta">
          {session.distraction_count != null && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
              <span style={{
                fontSize: '9px', fontWeight: 700, letterSpacing: '0.5px',
                textTransform: 'uppercase', whiteSpace: 'nowrap',
                color: '#f472b6', fontFamily: 'Space Grotesk, sans-serif',
              }}>📱 Mất tập trung</span>
              <span style={{ color: 'var(--text-primary, #e2e8f0)', fontSize: '14px', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700 }}>{session.distraction_count} <span style={{ fontSize: '10px', color: 'var(--text-muted, #64748b)', fontWeight: 400 }}>lần</span></span>
            </div>
          )}
        </div>

        {/* Mức độ tập trung (Focus) — moved to 5th, full label */}
        <div className="session-col-focus session-row-meta">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
            <span style={{
              fontSize: '9px', fontWeight: 700, letterSpacing: '0.5px',
              textTransform: 'uppercase', whiteSpace: 'nowrap',
              color: '#60a5fa', fontFamily: 'Space Grotesk, sans-serif',
            }}>🎯 Tập trung</span>
            <span style={{ color: focusColor(session.focus_level), fontSize: '14px', fontWeight: 700, fontFamily: 'JetBrains Mono, monospace' }}>{session.focus_level}<span style={{ fontSize: '10px', color: 'var(--text-muted, #64748b)', fontWeight: 400 }}>/5</span></span>
          </div>
        </div>

        {/* Cảm giác muốn bỏ cuộc (Dropout) — moved to 6th, full label */}
        <div className="session-col-dropout session-row-meta">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
            <span style={{
              fontSize: '9px', fontWeight: 700, letterSpacing: '0.5px',
              textTransform: 'uppercase', whiteSpace: 'nowrap',
              color: '#f87171', fontFamily: 'Space Grotesk, sans-serif',
            }}>🚨 Bỏ cuộc</span>
            <span style={{ color: dropoutColor(session.dropout_feeling), fontSize: '14px', fontWeight: 700, fontFamily: 'JetBrains Mono, monospace' }}>{session.dropout_feeling}<span style={{ fontSize: '10px', color: 'var(--text-muted, #64748b)', fontWeight: 400 }}>/5</span></span>
          </div>
        </div>

        {/* Risk badge */}
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          {report ? <RiskBadge level={riskLvl} small /> : <span />}
        </div>

        {/* Chevron */}
        <span style={{ color: 'var(--text-secondary, #94a3b8)', fontSize: '11px', transition: 'transform 0.2s', transform: isOpen ? 'rotate(90deg)' : 'none', textAlign: 'center' }}>▸</span>
      </div>

      {/* ── Expanded detail ── */}
      {isOpen && (
        <div style={{ borderTop: '1px solid var(--section-border)', padding: '14px 16px', background: 'var(--bg-expanded)' }}>
          {/* Meta row */}
          {(session.distracting_factors || session.emotional_state) && (
            <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', marginBottom: '10px', paddingBottom: '10px', borderBottom: '1px solid var(--section-border, rgba(255,255,255,0.04))' }}>
              {session.distracting_factors && (
                <div style={{ display: 'flex', gap: '6px', alignItems: 'baseline' }}>
                  <span style={{ fontSize: '10px', color: 'var(--meta-label, #94a3b8)', whiteSpace: 'nowrap' }}>Yếu tố mất tp:</span>
                  <span style={{ fontSize: '12px', color: 'var(--meta-value, #cbd5e1)' }}>{session.distracting_factors}</span>
                </div>
              )}
              {session.emotional_state && (
                <div style={{ display: 'flex', gap: '6px', alignItems: 'baseline' }}>
                  <span style={{ fontSize: '10px', color: 'var(--meta-label, #94a3b8)', whiteSpace: 'nowrap' }}>Cảm xúc:</span>
                  <span style={{ fontSize: '12px', color: 'var(--meta-value, #cbd5e1)' }}>{session.emotional_state}</span>
                </div>
              )}
              <div style={{ display: 'flex', gap: '6px', alignItems: 'baseline' }}>
                <span style={{ fontSize: '10px', color: 'var(--meta-label, #94a3b8)', whiteSpace: 'nowrap' }}>Mục tiêu:</span>
                <span style={{ fontSize: '12px', fontWeight: 600, color: session.goal_achieved ? '#22c55e' : '#ef4444' }}>
                  {session.goal_achieved ? '✅ Đạt được' : '❌ Chưa đạt'}
                </span>
              </div>
            </div>
          )}
          {!session.distracting_factors && !session.emotional_state && (
            <div style={{ display: 'flex', gap: '6px', alignItems: 'baseline', marginBottom: '10px', paddingBottom: '10px', borderBottom: '1px solid var(--section-border, rgba(255,255,255,0.04))' }}>
              <span style={{ fontSize: '10px', color: 'var(--meta-label, #94a3b8)' }}>Mục tiêu:</span>
              <span style={{ fontSize: '12px', fontWeight: 600, color: session.goal_achieved ? '#22c55e' : '#ef4444' }}>
                {session.goal_achieved ? '✅ Đạt được' : '❌ Chưa đạt'}
              </span>
            </div>
          )}
          {report
            ? <ReportPanel report={report} riskLevel={riskLvl} isDark={isDark} />
            : <p style={{ color: 'var(--text-secondary, #94a3b8)', fontSize: '12px', fontStyle: 'italic', margin: 0 }}>Chưa có báo cáo AI cho phiên này.</p>
          }
        </div>
      )}
    </div>
  )
}

// ─── Day Group ────────────────────────────────────────────────────────────────
function DayGroup({ date, sessions, expandedKey, onToggle, defaultOpen, isDark = true }: {
  date: string
  sessions: SessionWithReport[]
  expandedKey: string | null
  onToggle: (k: string) => void
  defaultOpen: boolean
  isDark?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)

  const formatted = (() => {
    try {
      const d = new Date(date + 'T00:00:00')
      return `${String(d.getDate()).padStart(2, '0')} Tháng ${d.getMonth() + 1} ${d.getFullYear()}`
    } catch { return date }
  })()

  const totalHours = sessions.reduce((s, x) => s + (x.study_hours || 0), 0)

  return (
    <div style={{
      background: 'var(--bg-card-strong, rgba(255,255,255,0.025))',
      border: '1px solid var(--border-card, rgba(255,255,255,0.07))',
      borderRadius: '14px', overflow: 'hidden',
      boxShadow: 'var(--card-shadow)',
    }}>
      {/* Day header */}
      <div
        onClick={() => setOpen(o => !o)}
        style={{ padding: '13px 18px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '14px' }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flex: 1, minWidth: 0 }}>
          {/* Date pill + meta */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              background: 'var(--bg-card-strong, rgba(255,255,255,0.04))',
              border: '1px solid var(--border-card, rgba(255,255,255,0.09))',
              borderRadius: '8px', padding: '4px 12px',
              flexShrink: 0,
            }}>
              <span style={{ color: 'var(--text-primary)', fontSize: '13px', fontWeight: 700, fontFamily: 'Space Grotesk, sans-serif', whiteSpace: 'nowrap' }}>{formatted}</span>
              <span style={{ color: '#475569', fontSize: '12px' }}>·</span>
              <span style={{ color: '#60a5fa', fontSize: '11px', fontWeight: 600, fontFamily: 'JetBrains Mono, monospace', whiteSpace: 'nowrap' }}>{sessions.length} phiên</span>
              <span style={{ color: '#475569', fontSize: '12px' }}>·</span>
              <span style={{ color: '#94a3b8', fontSize: '11px', fontFamily: 'JetBrains Mono, monospace', whiteSpace: 'nowrap' }}>{totalHours.toFixed(1)}h</span>
            </div>
          </div>
          {/* Summary chips — wrap freely */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <DaySummaryBar sessions={sessions} />
          </div>
        </div>
        <span style={{
          color: 'var(--text-secondary, #94a3b8)', fontSize: '12px', flexShrink: 0,
          transition: 'transform 0.2s',
          transform: open ? 'rotate(90deg)' : 'none',
        }}>▸</span>
      </div>

      {open && (
        <div style={{
          borderTop: '1px solid var(--section-border, rgba(255,255,255,0.06))',
          padding: '10px 14px',
          display: 'flex', flexDirection: 'column', gap: '7px',
          background: 'var(--bg-expanded, rgba(0,0,0,0.15))',
        }}>
          {sessions.map(s => (
            <SessionRow
              key={`${s.session_date}-${s.session_number}`}
              session={s}
              expandedKey={expandedKey}
              onToggle={onToggle}
              isDark={isDark}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Stats Bar ────────────────────────────────────────────────────────────────
function StatsBar({ data }: { data: HistoryData }) {
  const sessions = data.sessions
  if (!sessions.length) return null

  const total      = sessions.length
  const totHours   = sessions.reduce((s, x) => s + (x.study_hours || 0), 0)
  const avgStudy   = totHours / total
  const avgFocus   = sessions.reduce((s, x) => s + (x.focus_level || 0), 0) / total
  const avgDrop    = sessions.reduce((s, x) => s + (x.dropout_feeling || 0), 0) / total
  const goalCount  = sessions.filter(x => x.goal_achieved).length
  const goalRate   = goalCount / total * 100
  const withReport = sessions.filter(x => x.report)
  const riskCounts: Record<string, number> = { 'Stable': 0, 'Fluctuating': 0, 'High Risk': 0 }
  withReport.forEach(s => { const l = s.report!.risk_level; if (l in riskCounts) riskCounts[l]++ })
  const riskTotal = withReport.length

  const stats = [
    { label: 'Tổng phiên',   value: String(total),              color: '#818cf8', sub: `trong ${data.total_days} ngày` },
    { label: 'Tổng giờ học', value: `${totHours.toFixed(1)}h`,  color: '#60a5fa', sub: `TB ${avgStudy.toFixed(1)}h/phiên` },
    { label: 'Đạt mục tiêu', value: `${goalRate.toFixed(0)}%`,  color: goalRate >= 70 ? '#22c55e' : goalRate >= 40 ? '#f59e0b' : '#ef4444', sub: `${goalCount}/${total} phiên` },
    { label: 'TB tập trung', value: `${avgFocus.toFixed(1)}/5`, color: focusColor(avgFocus),  sub: avgFocus >= 4 ? 'Cao' : avgFocus >= 3 ? 'Trung bình' : 'Thấp' },
    { label: 'TB bỏ cuộc',  value: `${avgDrop.toFixed(1)}/5`,  color: dropoutColor(avgDrop), sub: avgDrop  >= 4 ? 'Cao' : avgDrop  >= 3 ? 'Trung bình' : 'Thấp' },
  ]

  return (
    <div style={{
      background: 'var(--bg-card-strong, rgba(255,255,255,0.025))',
      border: '1px solid var(--border-card, rgba(255,255,255,0.07))',
      borderRadius: '14px', marginBottom: '18px', overflow: 'hidden',
      boxShadow: 'var(--card-shadow)',
    }}>
      {/* Stat row — scrollable on mobile */}
      <div className="stats-bar-row" style={{ display: 'flex', borderBottom: '1px solid var(--stats-divider, rgba(255,255,255,0.06))' }}>
        {stats.map((item, i) => (
          <React.Fragment key={item.label}>
            <div style={{ flex: '1 1 100px', padding: '14px 18px', textAlign: 'center', minWidth: '90px' }}>
              <div style={{ fontSize: '10px', color: 'var(--stats-label, #94a3b8)', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '5px', fontFamily: 'Space Grotesk, sans-serif', fontWeight: 600 }}>{item.label}</div>
              <div style={{ fontSize: '22px', fontWeight: 700, color: item.color, fontFamily: 'JetBrains Mono, monospace', lineHeight: 1 }}>{item.value}</div>
              <div style={{ fontSize: '10px', color: 'var(--stats-sub, #94a3b8)', marginTop: '4px', fontFamily: 'Space Grotesk, sans-serif' }}>{item.sub}</div>
            </div>
            {i < stats.length - 1 && <div style={{ width: '1px', background: 'var(--stats-divider, rgba(255,255,255,0.06))', alignSelf: 'stretch' }} />}
          </React.Fragment>
        ))}
      </div>

      {/* Risk distribution */}
      {riskTotal > 0 && (
        <div style={{ padding: '12px 18px' }}>
          <div style={{ fontSize: '10px', color: 'var(--stats-sub, #94a3b8)', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '10px', fontFamily: 'Space Grotesk, sans-serif', fontWeight: 600 }}>
            Phân bổ rủi ro · {riskTotal} phiên có báo cáo AI
          </div>
          <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ flex: '1 1 200px', height: '7px', borderRadius: '4px', overflow: 'hidden', display: 'flex', minWidth: '140px' }}>
              {(['Stable', 'Fluctuating', 'High Risk'] as const).map(lvl => {
                const pct = (riskCounts[lvl] / riskTotal) * 100
                return pct ? <div key={lvl} style={{ width: `${pct}%`, background: riskStyle(lvl).dot, transition: 'width 0.5s' }} /> : null
              })}
            </div>
            {(['Stable', 'Fluctuating', 'High Risk'] as const).map(lvl => {
              const cnt = riskCounts[lvl]; const pct = Math.round(cnt / riskTotal * 100)
              if (!cnt) return null
              return (
                <div key={lvl} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: riskStyle(lvl).dot, flexShrink: 0 }} />
                  <span style={{ fontSize: '12px', color: riskStyle(lvl).text, fontWeight: 600, fontFamily: 'Space Grotesk, sans-serif' }}>{riskLabel(lvl)}</span>
                  <span style={{ fontSize: '11px', color: 'var(--text-secondary, #94a3b8)', fontFamily: 'JetBrains Mono, monospace' }}>{cnt} ({pct}%)</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── History Streak Badge ─────────────────────────────────────────────────────
function HistoryStreakBadge({ dates }: { dates: string[] }) {
  const streak = React.useMemo(() => {
    if (!dates.length) return 0
    const sorted = [...new Set(dates)].sort((a, b) => b.localeCompare(a))
    const today = new Date(Date.now() + 7 * 3600000).toISOString().split('T')[0]
    let count = 0; let cursor = today
    for (const d of sorted) {
      if (d === cursor) { count++; const dt = new Date(cursor); dt.setDate(dt.getDate() - 1); cursor = dt.toISOString().split('T')[0] }
      else if (d < cursor) break
    }
    return count
  }, [dates])
  const milestone = streak >= 30 ? 30 : streak >= 14 ? 14 : 7
  const pct = Math.min(100, (streak / milestone) * 100)
  if (!streak) return null
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 12px', background: 'rgba(251,146,60,0.08)', border: '1px solid rgba(251,146,60,0.2)', borderRadius: '20px', flexShrink: 0 }}>
      <span style={{ fontSize: '14px' }}>🔥</span>
      <div>
        <div style={{ fontSize: '11px', fontWeight: 700, color: '#fb923c', fontFamily: 'Space Grotesk, sans-serif', whiteSpace: 'nowrap' }}>{streak} ngày liên tục</div>
        <div style={{ width: '60px', height: '3px', background: 'rgba(251,146,60,0.15)', borderRadius: '2px', marginTop: '2px', overflow: 'hidden' }}>
          <div style={{ height: '100%', background: 'linear-gradient(90deg, #fb923c, #f59e0b)', borderRadius: '2px', width: `${pct}%`, transition: 'width 0.5s' }} />
        </div>
      </div>
    </div>
  )
}

// ─── HistoryPage ──────────────────────────────────────────────────────────────
export default function HistoryPage({ user, authFetch, onLogout, onNavigate, currentPage, theme = 'dark', onToggleTheme }: Props) {
  const isDark = theme === 'dark'
  const [showChangePass, setShowChangePass] = useState(false)
  const [historyData, setHistoryData] = useState<HistoryData | null>(null)
  const [loading,     setLoading]     = useState(true)
  const [expandedKey, setExpandedKey] = useState<string | null>(null)

  const loadHistory = useCallback(async () => {
    setLoading(true)
    try {
      const res = await authFetch('/api/entries/history?limit=60')
      if (res.ok) setHistoryData(await res.json())
    } catch (err) { console.error('History load error:', err) }
    finally { setLoading(false) }
  }, [authFetch])

  useEffect(() => { loadHistory() }, [loadHistory])

  const toggleSession = (key: string) => setExpandedKey(prev => prev === key ? null : key)

  // Show ALL dates (including sessions without AI report)
  const dates = historyData
    ? Object.keys(historyData.grouped_by_date)
        .sort((a, b) => b.localeCompare(a))
    : []
  const displayName = user.full_name || user.email.split('@')[0]

  return (
    <div style={{ minHeight: '100vh', background: isDark ? 'linear-gradient(135deg, #020617 0%, #0f172a 50%, #0d1117 100%)' : 'linear-gradient(135deg, #f1f5f9 0%, #e8edf5 50%, #edf2f8 100%)' }}>

      {/* ── Navbar ── */}
      <nav style={{
        background: isDark ? 'rgba(2,6,23,0.9)' : 'rgba(255,255,255,0.92)',
        backdropFilter: 'blur(20px)',
        borderBottom: isDark ? '1px solid rgba(255,255,255,0.07)' : '1px solid rgba(0,0,0,0.08)',
        padding: '0 20px', height: '48px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        position: 'sticky', top: 0, zIndex: 100,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <button
            type="button"
            onClick={() => onNavigate('dashboard')}
            aria-label="Về Bảng điều khiển"
            style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', borderRadius: '6px', flexShrink: 0 }}
          >
            <span style={{ fontSize: '16px', filter: 'drop-shadow(0 0 6px rgba(99,102,241,0.6))' }}>📡</span>
            <span style={{
              fontFamily: 'Space Grotesk, sans-serif', fontSize: '14px', fontWeight: 700,
              background: 'linear-gradient(90deg, #22d3ee, #818cf8, #a855f7)',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
              backgroundClip: 'text', letterSpacing: '-0.3px', whiteSpace: 'nowrap',
            }}>LSR Engine</span>
          </button>
          <div style={{ display: 'flex', gap: '2px' }}>
            {NAV.map(({ id, label }) => (
              <button key={id} onClick={() => onNavigate(id as 'dashboard' | 'history' | 'forum')}
                style={{
                  padding: '4px 11px', borderRadius: '8px', border: 'none',
                  background: currentPage === id ? 'rgba(99,102,241,0.15)' : 'transparent',
                  color: currentPage === id ? '#a5b4fc' : 'var(--nav-inactive, #64748b)',
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>

          {/* Streak badge — leftmost on right side */}
          <HistoryStreakBadge dates={historyData ? Object.keys(historyData.grouped_by_date) : []} />

          {/* Theme toggle — inverted fill: dark bg in dark mode, white bg in light mode */}
          {onToggleTheme && (
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
          )}

          {/* User name + email */}
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '11px', color: 'var(--text-primary)', fontWeight: 600, fontFamily: 'Space Grotesk, sans-serif' }}>{displayName}</div>
            <div style={{ fontSize: '9px', color: 'var(--nav-email)' }}>{user.email}</div>
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
          <button onClick={onLogout} style={{
            padding: '4px 10px', borderRadius: '8px',
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

      {/* ── Content ── */}
      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '20px 16px 48px' }}>

        {/* Page title */}
        <div style={{ marginBottom: '20px' }}>
          <h1 style={{
            fontFamily: 'Space Grotesk, sans-serif', fontSize: '22px', fontWeight: 700,
            color: 'var(--text-primary)', marginBottom: '4px', letterSpacing: '-0.3px',
          }}>Lịch sử phiên học</h1>
          <p style={{ color: 'var(--text-muted, #64748b)', fontSize: '13px', fontFamily: 'Space Grotesk, sans-serif' }}>
            {historyData ? `${historyData.total_sessions} phiên trong ${historyData.total_days} ngày` : 'Đang tải…'}
          </p>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-muted, #64748b)', fontFamily: 'Space Grotesk, sans-serif' }}>
            Đang tải lịch sử…
          </div>
        ) : !historyData || !historyData.total_sessions ? (
          <div style={{
            background: 'var(--bg-card)', border: '1px solid var(--border-card)',
            borderRadius: '14px', padding: '60px', textAlign: 'center',
            boxShadow: 'var(--card-shadow)',
          }}>
            <div style={{ fontSize: '48px', opacity: 0.3, marginBottom: '16px' }}>📋</div>
            <p style={{ color: 'var(--text-muted, #64748b)', fontSize: '14px', fontFamily: 'Space Grotesk, sans-serif' }}>Chưa có phiên học nào.</p>
            <button onClick={() => onNavigate('dashboard')} style={{
              marginTop: '16px', padding: '8px 20px', borderRadius: '8px',
              background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.3)',
              color: '#a5b4fc', fontSize: '13px', cursor: 'pointer', fontWeight: 500,
              fontFamily: 'Space Grotesk, sans-serif',
            }}>Về Trang chủ →</button>
          </div>
        ) : (
          <>
            <StatsBar data={historyData} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {dates.map((date, idx) => (
                <DayGroup
                  key={date} date={date}
                  sessions={historyData.grouped_by_date[date]}
                  expandedKey={expandedKey} onToggle={toggleSession}
                  defaultOpen={idx === 0}
                  isDark={isDark}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* Watermark */}
      <div style={{ position: 'fixed', bottom: '14px', right: '84px', zIndex: 999, opacity: 0.45, pointerEvents: 'none' }}>
        <img src="/static/and-logo.png" alt="A.N.D" style={{ width: '56px', height: 'auto', display: 'block' }} />
      </div>

      {/* ChatBot — pass most recent report for context */}
      <ChatBot
        authFetch={authFetch}
        theme={theme}
        report={(() => {
          if (!historyData) return null
          const s = historyData.sessions.find(s => s.report)
          if (!s?.report) return null
          // Cast SessionReport → AnalysisReport shape (fields are compatible)
          return { ...s.report, id: s.report.id, user_id: 0, entry_id: s.id, report_date: s.session_date } as any
        })()}
      />

      <style>{`
        * { scrollbar-width: thin; scrollbar-color: rgba(99,102,241,0.2) transparent; }
        *::-webkit-scrollbar { width: 3px; }
        *::-webkit-scrollbar-track { background: transparent; }
        *::-webkit-scrollbar-thumb { background: rgba(99,102,241,0.2); border-radius: 2px; }

        /* Stats bar: scroll horizontally on small screens instead of clipping */
        .stats-bar-row { overflow-x: auto; -webkit-overflow-scrolling: touch; }
        .stats-bar-row > * { min-width: 80px; }

        /* Session row: stack on mobile */
        .session-row-grid {
          display: grid;
          grid-template-columns: 90px 62px 80px 160px 160px 180px 1fr 24px;
          gap: 0 16px;
        }
        .session-row-meta { display: flex; align-items: center; gap: 5px; }

        @media (max-width: 700px) {
          .session-row-grid {
            grid-template-columns: 1fr auto !important;
            gap: 6px 8px !important;
          }
          /* Hide the individual columns, show only badge + risk + chevron */
          .session-col-time,
          .session-col-distract,
          .session-col-focus,
          .session-col-dropout { display: none !important; }
          .session-col-hours { font-size: 12px !important; }
        }

        @media (max-width: 700px) {
          .history-nav-email { display: none !important; }
          .history-nav-logotext { display: none !important; }
        }
        button:focus-visible { outline: 2px solid #3b82f6; outline-offset: 2px; }
        [data-theme='light'] .day-date-pill { background: rgba(0,0,0,0.04) !important; border-color: rgba(0,0,0,0.08) !important; }

        /* Day summary bar wraps cleanly */
        .day-summary-bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
      `}</style>
    </div>
  )
}
