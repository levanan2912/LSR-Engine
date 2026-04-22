import React, { useState } from 'react'
import { AnalysisReport } from '../types'

interface Props { report: AnalysisReport | null; loading?: boolean }

// ─── Risk theme ───────────────────────────────────────────────────────────────
const RISK_THEME = {
  'Stable': {
    bg: 'linear-gradient(135deg, rgba(16,185,129,0.15), rgba(52,211,153,0.06))',
    border: 'rgba(52,211,153,0.35)', text: '#34d399', icon: '●',
    label: 'ỔN ĐỊNH', glow: 'rgba(52,211,153,0.3)',
    badgeBg: 'linear-gradient(135deg, #10b981, #34d399)',
    animation: 'pulse2s 2s ease-in-out infinite',
    pill: 'rgba(52,211,153,0.12)',
  },
  'Fluctuating': {
    bg: 'linear-gradient(135deg, rgba(245,158,11,0.15), rgba(251,191,36,0.06))',
    border: 'rgba(251,191,36,0.35)', text: '#fbbf24', icon: '◐',
    label: 'DAO ĐỘNG', glow: 'rgba(251,191,36,0.3)',
    badgeBg: 'linear-gradient(135deg, #d97706, #fbbf24)',
    animation: 'waveFloat 3s ease-in-out infinite',
    pill: 'rgba(251,191,36,0.12)',
  },
  'High Risk': {
    bg: 'linear-gradient(135deg, rgba(239,68,68,0.15), rgba(248,113,113,0.06))',
    border: 'rgba(248,113,113,0.35)', text: '#f87171', icon: '▲',
    label: 'RỦI RO CAO', glow: 'rgba(248,113,113,0.4)',
    badgeBg: 'linear-gradient(135deg, #dc2626, #f87171)',
    animation: 'pulse1s 1s ease-in-out infinite',
    pill: 'rgba(248,113,113,0.12)',
  },
} as const

// ─── Model Metadata ───────────────────────────────────────────────────────────
interface ModelMeta { label: string; chip: string; tier: string; color: string; bg: string; border: string; tierColor: string; tierBg: string; message: string; icon: string }

const MODEL_META: Record<string, ModelMeta> = {
  'gemini-2.5-flash':              { label: 'Gemini 2.5 Flash',      chip: '2.5', tier: 'Primary',  color: '#818cf8', bg: 'rgba(129,140,248,0.08)',  border: 'rgba(129,140,248,0.25)',  tierColor: '#818cf8', tierBg: 'rgba(129,140,248,0.12)',  message: 'Sử dụng AI engine chính',                                          icon: '⚡' },
  'gemini-3.1-flash-lite-preview': { label: 'Gemini 3.1 Flash Lite', chip: '3.1', tier: 'Fallback', color: '#22d3ee', bg: 'rgba(34,211,238,0.08)',   border: 'rgba(34,211,238,0.25)',   tierColor: '#22d3ee', tierBg: 'rgba(34,211,238,0.12)',   message: 'Đã tự động chuyển sang model dự phòng để đảm bảo kết quả ổn định', icon: '🔄' },
  'gemini-2.0-flash-exp':          { label: 'Gemini 2.0 Flash Exp',  chip: '2.0', tier: 'Backup',   color: '#34d399', bg: 'rgba(52,211,153,0.08)',   border: 'rgba(52,211,153,0.25)',   tierColor: '#34d399', tierBg: 'rgba(52,211,153,0.12)',   message: 'Sử dụng model backup để đảm bảo tính liên tục',                    icon: '🛡️' },
  'gemini-2.0-flash':              { label: 'Gemini 2.0 Flash',      chip: '2.0', tier: 'Backup',   color: '#34d399', bg: 'rgba(52,211,153,0.08)',   border: 'rgba(52,211,153,0.25)',   tierColor: '#34d399', tierBg: 'rgba(52,211,153,0.12)',   message: 'Sử dụng model backup để đảm bảo tính liên tục',                    icon: '🛡️' },
  'gemini-2.5-flash-lite':         { label: 'Gemini 2.5 Flash Lite', chip: '2.5', tier: 'Backup',   color: '#34d399', bg: 'rgba(52,211,153,0.08)',   border: 'rgba(52,211,153,0.25)',   tierColor: '#34d399', tierBg: 'rgba(52,211,153,0.12)',   message: 'Sử dụng model backup để đảm bảo tính liên tục',                    icon: '🛡️' },
  'gemini-2.0-flash-lite':         { label: 'Gemini 2.0 Flash Lite', chip: '2.0', tier: 'Backup',   color: '#34d399', bg: 'rgba(52,211,153,0.08)',   border: 'rgba(52,211,153,0.25)',   tierColor: '#34d399', tierBg: 'rgba(52,211,153,0.12)',   message: 'Sử dụng model backup để đảm bảo tính liên tục',                    icon: '🛡️' },
  'rule_based_fallback':           { label: 'Local Rule Engine',     chip: 'LO',  tier: 'Local',    color: '#f87171', bg: 'rgba(248,113,113,0.08)', border: 'rgba(248,113,113,0.25)', tierColor: '#f87171', tierBg: 'rgba(248,113,113,0.12)', message: 'API tạm thời không khả dụng',                                       icon: '⚠️' },
}

function getModelMeta(analyzedBy?: string): ModelMeta | null {
  if (!analyzedBy) return null
  const raw = analyzedBy.replace('_success', '').trim()
  return MODEL_META[raw] ?? { label: raw, chip: 'AI', tier: 'Primary', color: '#818cf8', bg: 'rgba(129,140,248,0.08)', border: 'rgba(129,140,248,0.25)', tierColor: '#818cf8', tierBg: 'rgba(129,140,248,0.12)', message: '', icon: '🤖' }
}

function AIModelBadge({ analyzedBy, keyName }: { analyzedBy?: string; keyName?: string | null }) {
  const meta = getModelMeta(analyzedBy)
  if (!meta) return null

  if (keyName) {
    return (
      <div style={{ paddingTop: '12px', borderTop: '1px solid var(--section-border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '10px', color: '#94a3b8', letterSpacing: '0.5px', fontFamily: 'Space Grotesk, sans-serif', fontWeight: 600, textTransform: 'uppercase' }}>ANALYZED BY</span>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '4px 10px', background: meta.bg, border: `1px solid ${meta.border}`, borderRadius: '20px' }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: meta.color, flexShrink: 0, boxShadow: `0 0 6px ${meta.color}` }} />
            <span style={{ fontSize: '11px', fontWeight: 700, color: meta.color, fontFamily: 'JetBrains Mono, monospace' }}>{keyName}</span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ paddingTop: '12px', borderTop: '1px solid var(--section-border, rgba(255,255,255,0.06))' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: meta.message && meta.tier !== 'Primary' ? '6px' : '0' }}>
        <span style={{ fontSize: '10px', color: '#94a3b8', letterSpacing: '0.5px', fontFamily: 'Space Grotesk, sans-serif', fontWeight: 600, textTransform: 'uppercase' }}>ANALYZED BY</span>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
          <span style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.5px', padding: '2px 6px', borderRadius: '4px', color: meta.tierColor, background: meta.tierBg, border: `1px solid ${meta.border}`, textTransform: 'uppercase', fontFamily: 'Space Grotesk, sans-serif' }}>{meta.icon} {meta.tier}</span>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '2px 8px 2px 4px', background: meta.bg, border: `1px solid ${meta.border}`, borderRadius: '20px' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '18px', height: '18px', borderRadius: '50%', background: meta.color, color: '#000', fontSize: '8px', fontWeight: 800 }}>{meta.chip}</span>
            <span style={{ fontSize: '11px', fontWeight: 600, color: meta.color, fontFamily: 'JetBrains Mono, monospace' }}>{meta.label}</span>
          </div>
        </div>
      </div>
      {meta.message && meta.tier !== 'Primary' && (
        <div style={{ fontSize: '10px', color: meta.tierColor, background: meta.tierBg, border: `1px solid ${meta.border}`, borderRadius: '6px', padding: '4px 8px', opacity: 0.85, lineHeight: 1.5 }}>{meta.message}</div>
      )}
    </div>
  )
}

// ─── Checklist Item ───────────────────────────────────────────────────────────
function ChecklistItem({ text, index, accentColor }: { text: string; index: number; accentColor: string }) {
  const [checked, setChecked] = useState(false)
  return (
    <div
      onClick={() => setChecked(c => !c)}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: '10px',
        padding: '8px 0',
        borderBottom: index < 2 ? '1px solid var(--section-border)' : undefined,
        cursor: 'pointer',
        transition: 'opacity 0.2s',
        opacity: checked ? 0.45 : 1,
      }}
    >
      <div style={{
        flexShrink: 0, width: '18px', height: '18px', borderRadius: '6px', marginTop: '1px',
        border: `2px solid ${checked ? accentColor : 'var(--border-card)'}`,
        background: checked ? `${accentColor}22` : 'transparent',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'all 0.2s',
      }}>
        {checked && <span style={{ color: accentColor, fontSize: '10px', fontWeight: 800 }}>✓</span>}
      </div>
      <span style={{
        color: checked ? 'var(--text-faint)' : 'var(--text-secondary)',
        fontSize: '12.5px', lineHeight: 1.55,
        textDecoration: checked ? 'line-through' : 'none',
        transition: 'all 0.2s',
      }}>{text}</span>
    </div>
  )
}

// ─── Empty / Loading ──────────────────────────────────────────────────────────
function EmptyState() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '52px 24px', textAlign: 'center' }}>
      <div style={{ fontSize: '48px', marginBottom: '16px', filter: 'grayscale(60%) opacity(0.4)' }}>🧠</div>
      <h3 style={{ fontFamily: 'Space Grotesk, sans-serif', color: 'var(--text-primary)', fontSize: '15px', fontWeight: 700, marginBottom: '8px' }}>Chờ dữ liệu đầu tiên</h3>
      <p style={{ color: 'var(--text-muted)', fontSize: '13px', lineHeight: 1.7, maxWidth: '260px' }}>
        Điền nhật ký học tập và nhấn <strong style={{ color: '#818cf8' }}>⚡ Phân tích bằng AI</strong> để tạo báo cáo đầu tiên nhé!
      </p>
    </div>
  )
}

function LoadingState() {
  const [elapsed, setElapsed] = useState(0)
  React.useEffect(() => {
    setElapsed(0)
    const t = setInterval(() => setElapsed(s => s + 1), 1000)
    return () => clearInterval(t)
  }, [])

  const phase = elapsed >= 12 ? 1 : 0
  const cfg = [
    { label: 'AI Engine đang phân tích…',     sub: 'Thường xong trong 5–15 giây',             dot: '#818cf8' },
    { label: 'Đang chờ phản hồi từ AI…',      sub: 'Sắp có kết quả, vui lòng chờ thêm chút', dot: '#f59e0b' },
  ][phase]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px 24px', textAlign: 'center' }}>
      <div style={{ display: 'flex', gap: '6px', marginBottom: '20px' }}>
        {[0, 0.18, 0.36].map((d, i) => (
          <div key={i} style={{ width: '8px', height: '8px', borderRadius: '50%', background: cfg.dot, animation: `aiPulse 1.3s ease-in-out ${d}s infinite`, boxShadow: `0 0 8px ${cfg.dot}60` }} />
        ))}
      </div>
      <p style={{ fontFamily: 'Space Grotesk, sans-serif', color: 'var(--text-primary)', fontSize: '14px', fontWeight: 600, marginBottom: '5px' }}>{cfg.label}</p>
      <p style={{ color: 'var(--text-muted)', fontSize: '11px', marginBottom: '20px' }}>{cfg.sub}</p>
      <div style={{ width: '200px', height: '4px', borderRadius: '2px', background: 'var(--border-card)', overflow: 'hidden' }}>
        <div style={{ height: '100%', borderRadius: '2px', background: `linear-gradient(90deg, ${cfg.dot}, ${cfg.dot}88)`, width: `${Math.min(90, (elapsed / 15) * 90)}%`, transition: 'width 1s linear', boxShadow: `0 0 8px ${cfg.dot}60` }} />
      </div>
      <p style={{ color: 'var(--text-faint)', fontSize: '10px', marginTop: '8px', fontFamily: 'JetBrains Mono, monospace' }}>{elapsed}s</p>
      <style>{`@keyframes aiPulse{0%,80%,100%{transform:scale(.5);opacity:.3}40%{transform:scale(1);opacity:1}}`}</style>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function AnalysisReportComponent({ report, loading }: Props) {
  if (loading) return <LoadingState />
  if (!report)  return <EmptyState />

  const theme = RISK_THEME[report.risk_level as keyof typeof RISK_THEME] ?? RISK_THEME['Stable']
  const ts = report.created_at
    ? new Date(new Date(report.created_at).getTime() + 7 * 3600000).toLocaleString('vi-VN', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
      })
    : report.report_date

  const riskColor = report.risk_level === 'High Risk' ? '#f87171'
                  : report.risk_level === 'Fluctuating' ? '#fbbf24'
                  : '#34d399'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>

      <style>{`
        @keyframes cardSlideIn { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
        @keyframes pulse2s     { 0%,100%{box-shadow:0 0 18px rgba(52,211,153,0.3)} 50%{box-shadow:0 0 32px rgba(52,211,153,0.5)} }
        @keyframes pulse1s     { 0%,100%{box-shadow:0 0 18px rgba(248,113,113,0.4)} 50%{box-shadow:0 0 36px rgba(248,113,113,0.65)} }
        @keyframes waveFloat   { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-3px)} }
      `}</style>

      {/* ── Risk Header ─── */}
      <div style={{
        animation: 'cardSlideIn 0.3s ease both',
        background: theme.bg,
        border: `1px solid ${theme.border}`,
        borderRadius: '14px',
        padding: '14px 16px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px',
        flexWrap: 'wrap',
      }}>
        {/* Badge */}
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: '8px',
          background: theme.badgeBg,
          borderRadius: '20px', padding: '8px 18px',
          animation: theme.animation,
          boxShadow: `0 0 20px ${theme.glow}`,
          flexShrink: 0,
        }}>
          <span style={{ color: '#fff', fontSize: '16px' }}>{theme.icon}</span>
          <span style={{ color: '#fff', fontSize: '13px', fontWeight: 800, letterSpacing: '0.8px', fontFamily: 'Space Grotesk, sans-serif' }}>{theme.label}</span>
        </div>

        {/* Meta */}
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: '3px', fontFamily: 'Space Grotesk, sans-serif' }}>📡 Báo cáo AI · LSR Engine</div>
          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'JetBrains Mono, monospace' }}>{ts}</div>
        </div>
      </div>

      {/* ── Key Signals ─── */}
      <div style={{
        animation: 'cardSlideIn 0.35s ease 60ms both',
        background: 'var(--bg-card)',
        border: '1px solid rgba(251,191,36,0.25)',
        borderLeft: `3px solid #fbbf24`,
        borderRadius: '10px',
        padding: '12px 14px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px' }}>
          <span style={{ fontSize: '14px' }}>⚠️</span>
          <span style={{ fontFamily: 'Space Grotesk, sans-serif', color: '#fbbf24', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px' }}>Tín hiệu phát hiện</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
          {(report.key_signals ?? []).map((s, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'flex-start', gap: '8px',
              padding: '7px 10px',
              background: 'rgba(251,191,36,0.06)',
              borderRadius: '7px',
              border: '1px solid rgba(251,191,36,0.12)',
            }}>
              <span style={{ color: '#fbbf24', fontSize: '10px', marginTop: '3px', flexShrink: 0, fontWeight: 700 }}>#{i + 1}</span>
              <span style={{ color: 'var(--text-primary)', fontSize: '12.5px', lineHeight: 1.55, fontWeight: 500 }}>{s}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Forecast ─── */}
      <div style={{
        animation: 'cardSlideIn 0.35s ease 120ms both',
        background: 'var(--bg-card)',
        border: '1px solid rgba(129,140,248,0.25)',
        borderLeft: `3px solid #818cf8`,
        borderRadius: '10px',
        padding: '12px 14px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
          <span style={{ fontSize: '14px' }}>🔮</span>
          <span style={{ fontFamily: 'Space Grotesk, sans-serif', color: '#818cf8', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px' }}>Dự báo 5–7 phiên tới</span>
        </div>
        <p style={{ color: 'var(--text-primary)', fontSize: '12.5px', lineHeight: 1.65, margin: 0, fontWeight: 400 }}>{report.short_term_forecast}</p>
      </div>

      {/* ── Intervention Strategy ─── */}
      <div style={{
        animation: 'cardSlideIn 0.35s ease 180ms both',
        background: `linear-gradient(135deg, ${riskColor}10, ${riskColor}04)`,
        border: `1px solid ${riskColor}30`,
        borderLeft: `3px solid ${riskColor}`,
        borderRadius: '10px',
        padding: '12px 14px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
          <span style={{ fontSize: '14px' }}>💡</span>
          <span style={{ fontFamily: 'Space Grotesk, sans-serif', color: riskColor, fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px' }}>Chiến lược can thiệp</span>
        </div>
        <p style={{ color: 'var(--text-primary)', fontSize: '12.5px', lineHeight: 1.65, margin: 0, fontWeight: 400 }}>{report.intervention_strategy}</p>
      </div>

      {/* ── Action Plan 48h ─── */}
      <div style={{
        animation: 'cardSlideIn 0.35s ease 240ms both',
        background: 'var(--bg-card)',
        border: '1px solid rgba(99,102,241,0.25)',
        borderLeft: `3px solid #6366f1`,
        borderRadius: '10px',
        padding: '12px 14px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
          <span style={{ fontSize: '14px' }}>📋</span>
          <span style={{ fontFamily: 'Space Grotesk, sans-serif', color: '#6366f1', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px' }}>Kế hoạch hành động 48h</span>
          <span style={{ marginLeft: 'auto', fontSize: '9px', color: 'var(--text-faint)', fontFamily: 'Space Grotesk, sans-serif' }}>Nhấn để đánh dấu</span>
        </div>
        {(report.action_plan_48h ?? []).map((action, i) => (
          <ChecklistItem key={i} text={action} index={i} accentColor="#6366f1" />
        ))}
      </div>

      {/* ── AI Badge ─── */}
      <div style={{ animation: 'cardSlideIn 0.35s ease 300ms both' }}>
        <AIModelBadge analyzedBy={report.analyzed_by ?? undefined} keyName={report.key_name} />
      </div>

    </div>
  )
}
