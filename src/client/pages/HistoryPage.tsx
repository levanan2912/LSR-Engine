import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { User, SessionWithReport, SessionReport, HistoryData } from '../types'
import ChangePasswordModal from '../components/ChangePasswordModal'
import ChatBot from '../components/ChatBot'
import ProgressSummary, { SessionRecord } from '../components/ProgressSummary'

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
function ReportPanel({ report, riskLevel, isDark = true }: { report: SessionReport; riskLevel: string; isDark?: boolean }) {
  const [checkedItems, setCheckedItems] = useState<Record<number, boolean>>({})
  const riskColor = riskLevel === 'High Risk' ? '#f87171' : riskLevel === 'Fluctuating' ? '#fbbf24' : '#34d399'
  const signalLabelColor  = isDark ? '#fbbf24' : '#b45309'
  const signalBg          = isDark ? 'rgba(251,191,36,0.06)'  : 'rgba(180,83,9,0.06)'
  const signalBorder      = isDark ? '1px solid rgba(251,191,36,0.12)' : '1px solid rgba(180,83,9,0.15)'
  const signalNumColor    = isDark ? '#fbbf24' : '#92400e'
  const cardBg            = isDark ? 'rgba(255,255,255,0.02)'  : 'rgba(0,0,0,0.025)'
  const actionBorderColor = isDark ? 'rgba(255,255,255,0.08)'  : 'rgba(0,0,0,0.10)'
  const actionFaintColor  = isDark ? '#475569' : '#94a3b8'
  const textPrimary       = isDark ? 'rgba(255,255,255,0.88)'  : 'rgba(0,0,0,0.82)'
  const textSecondary     = isDark ? '#94a3b8'                  : '#64748b'

  const toggleCheck = (i: number) => setCheckedItems(prev => ({ ...prev, [i]: !prev[i] }))

  return (
    <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>

      {/* ── Key Signals ── */}
      {report.key_signals.length > 0 && (
        <div style={{
          background: cardBg,
          border: `1px solid ${isDark ? 'rgba(251,191,36,0.25)' : 'rgba(180,83,9,0.22)'}`,
          borderLeft: `3px solid ${signalLabelColor}`,
          borderRadius: '10px', padding: '12px 14px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px' }}>
            <span style={{ fontSize: '14px' }}>⚠️</span>
            <span style={{ fontFamily: 'Space Grotesk, sans-serif', color: signalLabelColor, fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px' }}>Tín hiệu phát hiện</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
            {report.key_signals.map((s, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'flex-start', gap: '8px',
                padding: '7px 10px', background: signalBg,
                borderRadius: '7px', border: signalBorder,
              }}>
                <span style={{ color: signalNumColor, fontSize: '10px', marginTop: '3px', flexShrink: 0, fontWeight: 700 }}>#{i + 1}</span>
                <span style={{ color: textPrimary, fontSize: '12.5px', lineHeight: 1.55, fontWeight: 500 }}>{s}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Forecast ── */}
      {report.short_term_forecast && (
        <div style={{
          background: cardBg,
          border: '1px solid rgba(129,140,248,0.25)',
          borderLeft: '3px solid #818cf8',
          borderRadius: '10px', padding: '12px 14px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
            <span style={{ fontSize: '14px' }}>🔮</span>
            <span style={{ fontFamily: 'Space Grotesk, sans-serif', color: '#818cf8', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px' }}>Dự báo 5–7 phiên tới</span>
          </div>
          <p style={{ color: textPrimary, fontSize: '12.5px', lineHeight: 1.65, margin: 0 }}>{report.short_term_forecast}</p>
        </div>
      )}

      {/* ── Intervention ── */}
      {report.intervention_strategy && (
        <div style={{
          background: `linear-gradient(135deg, ${riskColor}10, ${riskColor}04)`,
          border: `1px solid ${riskColor}30`,
          borderLeft: `3px solid ${riskColor}`,
          borderRadius: '10px', padding: '12px 14px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
            <span style={{ fontSize: '14px' }}>💡</span>
            <span style={{ fontFamily: 'Space Grotesk, sans-serif', color: riskColor, fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px' }}>Chiến lược can thiệp</span>
          </div>
          <p style={{ color: textPrimary, fontSize: '12.5px', lineHeight: 1.65, margin: 0 }}>{report.intervention_strategy}</p>
        </div>
      )}

      {/* ── Action Plan ── */}
      {report.action_plan_48h.length > 0 && (
        <div style={{
          background: cardBg,
          border: '1px solid rgba(99,102,241,0.25)',
          borderLeft: '3px solid #6366f1',
          borderRadius: '10px', padding: '12px 14px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
            <span style={{ fontSize: '14px' }}>📋</span>
            <span style={{ fontFamily: 'Space Grotesk, sans-serif', color: '#6366f1', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px' }}>Kế hoạch hành động 48h</span>
            <span style={{ marginLeft: 'auto', fontSize: '9px', color: actionFaintColor, fontFamily: 'Space Grotesk, sans-serif' }}>Nhấn để đánh dấu</span>
          </div>
          {report.action_plan_48h.map((step, i) => (
            <div key={i} onClick={() => toggleCheck(i)} style={{
              display: 'flex', alignItems: 'flex-start', gap: '10px',
              padding: '8px 0', cursor: 'pointer', transition: 'opacity 0.2s',
              opacity: checkedItems[i] ? 0.45 : 1,
              borderBottom: i < report.action_plan_48h.length - 1 ? `1px solid ${actionBorderColor}` : undefined,
            }}>
              <div style={{
                flexShrink: 0, width: '18px', height: '18px', borderRadius: '6px', marginTop: '1px',
                border: `2px solid ${checkedItems[i] ? '#6366f1' : actionBorderColor}`,
                background: checkedItems[i] ? 'rgba(99,102,241,0.2)' : 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s',
              }}>
                {checkedItems[i] && <span style={{ color: '#818cf8', fontSize: '10px', fontWeight: 800 }}>✓</span>}
              </div>
              <span style={{
                color: checkedItems[i] ? actionFaintColor : textSecondary,
                fontSize: '12.5px', lineHeight: 1.55,
                textDecoration: checkedItems[i] ? 'line-through' : 'none', transition: 'all 0.2s',
              }}>{step}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Session Row ──────────────────────────────────────────────────────────────
function SessionRow({ session, expandedKey, onToggle, isDark = true, onDelete }: {
  session: SessionWithReport
  expandedKey: string | null
  onToggle: (k: string) => void
  isDark?: boolean
  onDelete: (id: number, label: string) => void
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

        {/* Delete button */}
        <button
          onClick={e => { e.stopPropagation(); onDelete(session.id, `Phiên ${session.session_number} — ${session.session_date}`) }}
          title="Xóa phiên này"
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: 'rgba(239,68,68,0.45)', fontSize: '13px', padding: '2px 4px',
            borderRadius: '5px', lineHeight: 1, transition: 'color 0.15s',
            flexShrink: 0,
          }}
          onMouseEnter={e => (e.currentTarget.style.color = '#ef4444')}
          onMouseLeave={e => (e.currentTarget.style.color = 'rgba(239,68,68,0.45)')}
        >🗑</button>

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
            : <p style={{ color: 'var(--text-secondary)', fontSize: '13px', fontStyle: 'italic', margin: 0 }}>Chưa có báo cáo AI cho phiên này.</p>
          }
        </div>
      )}
    </div>
  )
}

// ─── Day Group ────────────────────────────────────────────────────────────────
function DayGroup({ date, sessions, expandedKey, onToggle, defaultOpen, isDark = true, onDelete }: {
  date: string
  sessions: SessionWithReport[]
  expandedKey: string | null
  onToggle: (k: string) => void
  defaultOpen: boolean
  isDark?: boolean
  onDelete: (id: number, label: string) => void
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
              onDelete={onDelete}
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
  const [historyData,   setHistoryData]   = useState<HistoryData | null>(null)
  const [loading,       setLoading]       = useState(true)
  const [expandedKey,   setExpandedKey]   = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: number; label: string } | null>(null)
  const [deleting,      setDeleting]      = useState(false)
  const confirmRef = useRef<HTMLDivElement>(null)

  const loadHistory = useCallback(async () => {
    setLoading(true)
    try {
      const res = await authFetch('/api/entries/history?limit=120')
      if (res.ok) setHistoryData(await res.json())
    } catch (err) { console.error('History load error:', err) }
    finally { setLoading(false) }
  }, [authFetch])

  useEffect(() => { loadHistory() }, [loadHistory])

  const toggleSession = (key: string) => setExpandedKey(prev => prev === key ? null : key)

  const handleDeleteRequest = useCallback((id: number, label: string) => {
    setDeleteConfirm({ id, label })
  }, [])

  const confirmDelete = useCallback(async () => {
    if (!deleteConfirm || deleting) return
    setDeleting(true)
    try {
      const res = await authFetch(`/api/entries/${deleteConfirm.id}`, { method: 'DELETE' })
      if (res.ok) {
        // Xóa khỏi local state không cần reload
        setHistoryData(prev => {
          if (!prev) return prev
          const sessions = prev.sessions.filter(s => s.id !== deleteConfirm.id)
          const grouped: typeof prev.grouped_by_date = {}
          for (const s of sessions) {
            if (!grouped[s.session_date]) grouped[s.session_date] = []
            grouped[s.session_date].push(s)
          }
          return {
            sessions,
            grouped_by_date: grouped,
            total_sessions: sessions.length,
            total_days: Object.keys(grouped).length,
          }
        })
        setDeleteConfirm(null)
      } else {
        const d = await res.json() as { message?: string }
        alert(d.message ?? 'Xóa thất bại, vui lòng thử lại.')
      }
    } catch {
      alert('Lỗi kết nối, vui lòng thử lại.')
    } finally {
      setDeleting(false)
    }
  }, [deleteConfirm, deleting, authFetch])

  // Show ALL dates (including sessions without AI report)
  const dates = historyData
    ? Object.keys(historyData.grouped_by_date)
        .sort((a, b) => b.localeCompare(a))
    : []
  const displayName = user.full_name || user.email.split('@')[0]

  // Convert sessions → SessionRecord for ProgressSummary
  const progressSessions = useMemo<SessionRecord[]>(() => {
    if (!historyData?.sessions) return []
    return historyData.sessions.map(s => ({
      id: s.id,
      session_date: s.session_date,
      session_number: s.session_number ?? 1,
      study_hours: Number(s.study_hours ?? 0),
      focus_level: s.focus_level ?? 3,
      distraction_count: s.distraction_count ?? 0,
      goal_achieved: s.goal_achieved ? 1 : 0,
      dropout_feeling: s.dropout_feeling ?? 3,
      emotional_state: s.emotional_state ?? null,
      report: s.report ? { risk_level: s.report.risk_level } : null,
    }))
  }, [historyData])

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
            {/* ══ Tiến trình học tập ══ */}
            <div style={{
              background: isDark ? 'rgba(255,255,255,0.015)' : 'rgba(0,0,0,0.025)',
              border: isDark ? '1px solid rgba(255,255,255,0.07)' : '1px solid rgba(0,0,0,0.08)',
              borderRadius: '20px',
              padding: '28px 28px 24px',
              marginBottom: '24px',
              boxShadow: isDark ? '0 4px 32px rgba(0,0,0,0.3)' : '0 4px 20px rgba(0,0,0,0.08)',
            }}>
              {/* Section header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '22px' }}>
                <div style={{ width: '4px', height: '22px', borderRadius: '2px', background: 'linear-gradient(180deg, #6366f1, #818cf8)' }} />
                <div>
                  <h2 style={{ margin: 0, fontFamily: 'Space Grotesk, sans-serif', fontSize: '17px', fontWeight: 700, color: isDark ? 'rgba(255,255,255,0.92)' : '#0f172a', letterSpacing: '-0.2px' }}>
                    Tiến trình học tập
                  </h2>
                  <p style={{ margin: 0, fontSize: '12px', color: isDark ? 'rgba(255,255,255,0.4)' : '#64748b', fontFamily: 'Space Grotesk, sans-serif', marginTop: '2px' }}>
                    Phân tích ngữ cảnh — không phản ứng thái quá với từng biến động
                  </p>
                </div>
              </div>
              <ProgressSummary sessions={progressSessions} loading={loading} size="large" isDark={isDark} />
            </div>

            {/* ══ Stats bar ══ */}
            <StatsBar data={historyData} />

            {/* ══ Session list ══ */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', margin: '4px 0 16px' }}>
              <div style={{ width: '4px', height: '18px', borderRadius: '2px', background: 'linear-gradient(180deg, #60a5fa, #818cf8)' }} />
              <h2 style={{ margin: 0, fontFamily: 'Space Grotesk, sans-serif', fontSize: '15px', fontWeight: 700, color: isDark ? 'rgba(255,255,255,0.85)' : '#0f172a' }}>Nhật ký phên học</h2>
              <span style={{ fontSize: '12px', color: isDark ? 'rgba(255,255,255,0.3)' : '#94a3b8', fontFamily: 'Space Grotesk, sans-serif' }}>{historyData.total_sessions} phiên · {historyData.total_days} ngày</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {dates.map((date, idx) => (
                <DayGroup
                  key={date} date={date}
                  sessions={historyData.grouped_by_date[date]}
                  expandedKey={expandedKey} onToggle={toggleSession}
                  defaultOpen={idx === 0}
                  isDark={isDark}
                  onDelete={handleDeleteRequest}
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

      {/* ── Delete confirm modal ── */}
      {deleteConfirm && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 2000,
          background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '20px',
        }} onClick={() => !deleting && setDeleteConfirm(null)}>
          <div
            ref={confirmRef}
            onClick={e => e.stopPropagation()}
            style={{
              background: isDark ? '#0f172a' : '#fff',
              border: '1px solid rgba(239,68,68,0.35)',
              borderRadius: '16px', padding: '28px 28px 24px',
              maxWidth: '360px', width: '100%',
              boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
            }}
          >
            <div style={{ fontSize: '32px', textAlign: 'center', marginBottom: '12px' }}>🗑️</div>
            <h3 style={{
              fontFamily: 'Space Grotesk, sans-serif', fontSize: '15px', fontWeight: 700,
              color: isDark ? '#f1f5f9' : '#0f172a', textAlign: 'center', margin: '0 0 8px',
            }}>Xác nhận xóa phiên học</h3>
            <p style={{
              fontSize: '13px', color: isDark ? '#94a3b8' : '#64748b',
              textAlign: 'center', lineHeight: 1.6, margin: '0 0 20px',
            }}>
              <strong style={{ color: isDark ? '#e2e8f0' : '#1e293b' }}>{deleteConfirm.label}</strong>
              <br />Hành động này không thể hoàn tác. Báo cáo AI liên quan cũng sẽ bị xóa.
            </p>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                onClick={() => setDeleteConfirm(null)}
                disabled={deleting}
                style={{
                  flex: 1, padding: '10px', borderRadius: '10px',
                  background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)',
                  border: isDark ? '1px solid rgba(255,255,255,0.1)' : '1px solid rgba(0,0,0,0.1)',
                  color: isDark ? '#94a3b8' : '#64748b',
                  fontSize: '13px', fontWeight: 600, cursor: 'pointer',
                  fontFamily: 'Space Grotesk, sans-serif',
                }}
              >Hủy</button>
              <button
                onClick={confirmDelete}
                disabled={deleting}
                style={{
                  flex: 1, padding: '10px', borderRadius: '10px',
                  background: deleting ? 'rgba(239,68,68,0.5)' : 'rgba(239,68,68,0.85)',
                  border: '1px solid rgba(239,68,68,0.4)',
                  color: '#fff', fontSize: '13px', fontWeight: 700,
                  cursor: deleting ? 'not-allowed' : 'pointer',
                  fontFamily: 'Space Grotesk, sans-serif',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                }}
              >
                {deleting
                  ? <><span style={{ display: 'inline-block', width: '12px', height: '12px', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} /> Đang xóa...</>
                  : '🗑️ Xóa phiên này'}
              </button>
            </div>
          </div>
        </div>
      )}

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
        @keyframes spin { to { transform: rotate(360deg); } }
        * { scrollbar-width: thin; scrollbar-color: rgba(99,102,241,0.2) transparent; }
        *::-webkit-scrollbar { width: 3px; }
        *::-webkit-scrollbar-track { background: transparent; }
        *::-webkit-scrollbar-thumb { background: rgba(99,102,241,0.2); border-radius: 2px; }

        /* ── CSS custom properties — light / dark ──────────────────────────── */
        :root {
          ${isDark ? `
          --text-primary:   rgba(255,255,255,0.88);
          --text-secondary: rgba(255,255,255,0.55);
          --text-muted:     rgba(255,255,255,0.35);
          --text-faint:     rgba(255,255,255,0.20);
          --nav-inactive:   #64748b;
          --nav-email:      #475569;
          --nav-logout:     #94a3b8;
          --bg-card:        rgba(255,255,255,0.03);
          --bg-card-strong: rgba(255,255,255,0.025);
          --border-card:    rgba(255,255,255,0.07);
          --bg-row:         rgba(255,255,255,0.02);
          --bg-row-open:    rgba(255,255,255,0.035);
          --border-row:     rgba(255,255,255,0.06);
          --section-border: rgba(255,255,255,0.05);
          --bg-expanded:    rgba(0,0,0,0.15);
          --card-shadow:    0 2px 12px rgba(0,0,0,0.25);
          --stats-label:    #94a3b8;
          --stats-sub:      #94a3b8;
          --stats-divider:  rgba(255,255,255,0.06);
          --chip-label:     #94a3b8;
          --meta-label:     #94a3b8;
          --meta-value:     #cbd5e1;
          --session-time:   #94a3b8;
          ` : `
          --text-primary:   rgba(0,0,0,0.85);
          --text-secondary: rgba(0,0,0,0.55);
          --text-muted:     rgba(0,0,0,0.40);
          --text-faint:     rgba(0,0,0,0.28);
          --nav-inactive:   #64748b;
          --nav-email:      #64748b;
          --nav-logout:     #475569;
          --bg-card:        rgba(0,0,0,0.04);
          --bg-card-strong: rgba(0,0,0,0.03);
          --border-card:    rgba(0,0,0,0.09);
          --bg-row:         rgba(0,0,0,0.02);
          --bg-row-open:    rgba(0,0,0,0.04);
          --border-row:     rgba(0,0,0,0.08);
          --section-border: rgba(0,0,0,0.07);
          --bg-expanded:    rgba(0,0,0,0.03);
          --card-shadow:    0 2px 12px rgba(0,0,0,0.08);
          --stats-label:    #64748b;
          --stats-sub:      #64748b;
          --stats-divider:  rgba(0,0,0,0.07);
          --chip-label:     #64748b;
          --meta-label:     #64748b;
          --meta-value:     #374151;
          --session-time:   #64748b;
          `}
        }

        /* Stats bar: scroll horizontally on small screens instead of clipping */
        .stats-bar-row { overflow-x: auto; -webkit-overflow-scrolling: touch; }
        .stats-bar-row > * { min-width: 80px; }

        /* Session row: stack on mobile */
        .session-row-grid {
          display: grid;
          grid-template-columns: 90px 62px 80px 160px 160px 180px 1fr 24px 24px;
          gap: 0 12px;
        }
        .session-row-meta { display: flex; align-items: center; gap: 5px; }

        @media (max-width: 700px) {
          .session-row-grid {
            grid-template-columns: 1fr auto !important;
            gap: 6px 8px !important;
          }
          .session-col-time,
          .session-col-distract,
          .session-col-focus,
          .session-col-dropout { display: none !important; }
          .session-col-hours { font-size: 13px !important; }
        }

        @media (max-width: 700px) {
          .history-nav-email { display: none !important; }
          .history-nav-logotext { display: none !important; }
        }
        button:focus-visible { outline: 2px solid #3b82f6; outline-offset: 2px; }

        /* Day summary bar wraps cleanly */
        .day-summary-bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
      `}</style>
    </div>
  )
}
