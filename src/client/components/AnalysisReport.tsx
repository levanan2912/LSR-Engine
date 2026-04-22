import React, { useState } from 'react'
import { AnalysisReport } from '../types'

interface Props { report: AnalysisReport | null; loading?: boolean }

// ─── Risk theme ───────────────────────────────────────────────────────────────
const RISK_THEME = {
  'Stable': {
    bg: 'linear-gradient(135deg, rgba(16,185,129,0.12) 0%, rgba(52,211,153,0.04) 100%)',
    border: 'rgba(52,211,153,0.3)', text: '#34d399', icon: '●',
    label: 'ỔN ĐỊNH', glow: 'rgba(52,211,153,0.25)',
    badgeBg: 'linear-gradient(135deg, #059669, #34d399)',
    dot: '#34d399',
  },
  'Fluctuating': {
    bg: 'linear-gradient(135deg, rgba(245,158,11,0.12) 0%, rgba(251,191,36,0.04) 100%)',
    border: 'rgba(251,191,36,0.3)', text: '#fbbf24', icon: '◐',
    label: 'DAO ĐỘNG', glow: 'rgba(251,191,36,0.25)',
    badgeBg: 'linear-gradient(135deg, #b45309, #fbbf24)',
    dot: '#fbbf24',
  },
  'High Risk': {
    bg: 'linear-gradient(135deg, rgba(239,68,68,0.14) 0%, rgba(248,113,113,0.04) 100%)',
    border: 'rgba(248,113,113,0.32)', text: '#f87171', icon: '▲',
    label: 'RỦI RO CAO', glow: 'rgba(248,113,113,0.35)',
    badgeBg: 'linear-gradient(135deg, #991b1b, #f87171)',
    dot: '#f87171',
  },
} as const

// ─── Model Metadata ───────────────────────────────────────────────────────────
const MODEL_META: Record<string, { label: string; chip: string; tier: string; color: string; bg: string; border: string; tierColor: string; tierBg: string; message: string; icon: string }> = {
  'gemini-2.5-flash':              { label: 'Gemini 2.5 Flash',      chip: '2.5', tier: 'Primary',  color: '#818cf8', bg: 'rgba(129,140,248,0.08)',  border: 'rgba(129,140,248,0.2)',  tierColor: '#818cf8', tierBg: 'rgba(129,140,248,0.1)',  message: '',                                                                                  icon: '⚡' },
  'gemini-3.1-flash-lite-preview': { label: 'Gemini 3.1 Flash Lite', chip: '3.1', tier: 'Fallback', color: '#22d3ee', bg: 'rgba(34,211,238,0.08)',   border: 'rgba(34,211,238,0.2)',   tierColor: '#22d3ee', tierBg: 'rgba(34,211,238,0.1)',   message: 'Tự động chuyển model dự phòng để đảm bảo tính ổn định',                            icon: '🔄' },
  'gemini-2.0-flash-exp':          { label: 'Gemini 2.0 Flash Exp',  chip: '2.0', tier: 'Backup',   color: '#34d399', bg: 'rgba(52,211,153,0.08)',   border: 'rgba(52,211,153,0.2)',   tierColor: '#34d399', tierBg: 'rgba(52,211,153,0.1)',   message: 'Sử dụng model backup',                                                              icon: '🛡️' },
  'gemini-2.0-flash':              { label: 'Gemini 2.0 Flash',      chip: '2.0', tier: 'Backup',   color: '#34d399', bg: 'rgba(52,211,153,0.08)',   border: 'rgba(52,211,153,0.2)',   tierColor: '#34d399', tierBg: 'rgba(52,211,153,0.1)',   message: 'Sử dụng model backup',                                                              icon: '🛡️' },
  'gemini-2.5-flash-lite':         { label: 'Gemini 2.5 Flash Lite', chip: '2.5', tier: 'Backup',   color: '#34d399', bg: 'rgba(52,211,153,0.08)',   border: 'rgba(52,211,153,0.2)',   tierColor: '#34d399', tierBg: 'rgba(52,211,153,0.1)',   message: 'Sử dụng model backup',                                                              icon: '🛡️' },
  'gemini-2.0-flash-lite':         { label: 'Gemini 2.0 Flash Lite', chip: '2.0', tier: 'Backup',   color: '#34d399', bg: 'rgba(52,211,153,0.08)',   border: 'rgba(52,211,153,0.2)',   tierColor: '#34d399', tierBg: 'rgba(52,211,153,0.1)',   message: 'Sử dụng model backup',                                                              icon: '🛡️' },
  'rule_based_fallback':           { label: 'Local Rule Engine',     chip: 'LO',  tier: 'Local',    color: '#f87171', bg: 'rgba(248,113,113,0.08)', border: 'rgba(248,113,113,0.2)', tierColor: '#f87171', tierBg: 'rgba(248,113,113,0.1)', message: 'AI tạm thời không khả dụng — dùng quy tắc cục bộ',                                  icon: '⚠️' },
}

function getModelMeta(analyzedBy?: string) {
  if (!analyzedBy) return null
  const raw = analyzedBy.replace('_success', '').trim()
  return MODEL_META[raw] ?? { label: raw, chip: 'AI', tier: 'Primary', color: '#818cf8', bg: 'rgba(129,140,248,0.08)', border: 'rgba(129,140,248,0.2)', tierColor: '#818cf8', tierBg: 'rgba(129,140,248,0.1)', message: '', icon: '🤖' }
}

// ─── Checklist Item ───────────────────────────────────────────────────────────
function ChecklistItem({ text, index, total, accentColor }: { text: string; index: number; total: number; accentColor: string }) {
  const [checked, setChecked] = useState(false)
  return (
    <div
      onClick={() => setChecked(c => !c)}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: '11px',
        padding: '9px 0',
        borderBottom: index < total - 1 ? '1px solid rgba(255,255,255,0.04)' : undefined,
        cursor: 'pointer',
        transition: 'opacity 0.2s',
        opacity: checked ? 0.4 : 1,
      }}
    >
      <div style={{
        flexShrink: 0, width: '20px', height: '20px', borderRadius: '6px', marginTop: '1px',
        border: `2px solid ${checked ? accentColor : 'rgba(255,255,255,0.12)'}`,
        background: checked ? `${accentColor}20` : 'transparent',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'all 0.2s',
      }}>
        {checked && <span style={{ color: accentColor, fontSize: '11px', fontWeight: 900 }}>✓</span>}
      </div>
      <span style={{
        color: checked ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.82)',
        fontSize: '13px', lineHeight: 1.6,
        textDecoration: checked ? 'line-through' : 'none',
        fontFamily: 'Space Grotesk, sans-serif',
        transition: 'all 0.2s',
      }}>{text}</span>
    </div>
  )
}

// ─── Signal item ──────────────────────────────────────────────────────────────
function SignalItem({ text, index }: { text: string; index: number }) {
  // Detect emphasis patterns: numbers, percentages, keywords
  const highlighted = text
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: '10px',
      padding: '9px 12px',
      background: 'rgba(251,191,36,0.05)',
      borderRadius: '9px',
      border: '1px solid rgba(251,191,36,0.1)',
    }}>
      <div style={{
        flexShrink: 0, width: '22px', height: '22px',
        borderRadius: '50%',
        background: 'rgba(251,191,36,0.15)',
        border: '1px solid rgba(251,191,36,0.3)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        marginTop: '1px',
      }}>
        <span style={{ color: '#fbbf24', fontSize: '10px', fontWeight: 800 }}>{index + 1}</span>
      </div>
      <span style={{ color: 'rgba(255,255,255,0.88)', fontSize: '13px', lineHeight: 1.65, fontFamily: 'Space Grotesk, sans-serif', fontWeight: 500 }}>{highlighted}</span>
    </div>
  )
}

// ─── Section card ──────────────────────────────────────────────────────────────
function SectionCard({
  icon, label, labelColor, borderColor, bg, children, delay = 0,
}: {
  icon: string; label: string; labelColor: string; borderColor: string; bg: string; children: React.ReactNode; delay?: number
}) {
  return (
    <div style={{
      animation: `arSlide 0.32s ease ${delay}ms both`,
      background: bg,
      border: `1px solid ${borderColor}`,
      borderLeft: `3px solid ${labelColor}`,
      borderRadius: '12px',
      padding: '14px 16px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '11px' }}>
        <span style={{ fontSize: '15px' }}>{icon}</span>
        <span style={{
          fontFamily: 'Space Grotesk, sans-serif',
          color: labelColor, fontSize: '10.5px', fontWeight: 700,
          textTransform: 'uppercase', letterSpacing: '0.9px',
        }}>{label}</span>
      </div>
      {children}
    </div>
  )
}

// ─── Empty / Loading ──────────────────────────────────────────────────────────
function EmptyState() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '52px 24px', textAlign: 'center' }}>
      <div style={{ fontSize: '48px', marginBottom: '16px', filter: 'grayscale(60%) opacity(0.35)' }}>🧠</div>
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
    { label: 'AI Engine đang phân tích…',     sub: 'Thường xong trong 5–15 giây',              dot: '#818cf8' },
    { label: 'Đang chờ phản hồi từ AI…',      sub: 'Sắp có kết quả, vui lòng chờ thêm chút',  dot: '#f59e0b' },
  ][phase]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px 24px', textAlign: 'center' }}>
      <div style={{ display: 'flex', gap: '6px', marginBottom: '20px' }}>
        {[0, 0.18, 0.36].map((d, i) => (
          <div key={i} style={{ width: '9px', height: '9px', borderRadius: '50%', background: cfg.dot, animation: `aiPulse 1.3s ease-in-out ${d}s infinite`, boxShadow: `0 0 9px ${cfg.dot}55` }} />
        ))}
      </div>
      <p style={{ fontFamily: 'Space Grotesk, sans-serif', color: 'var(--text-primary)', fontSize: '14px', fontWeight: 600, marginBottom: '5px' }}>{cfg.label}</p>
      <p style={{ color: 'var(--text-muted)', fontSize: '11px', marginBottom: '20px' }}>{cfg.sub}</p>
      <div style={{ width: '200px', height: '4px', borderRadius: '2px', background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
        <div style={{ height: '100%', borderRadius: '2px', background: `linear-gradient(90deg, ${cfg.dot}, ${cfg.dot}88)`, width: `${Math.min(90, (elapsed / 15) * 90)}%`, transition: 'width 1s linear', boxShadow: `0 0 8px ${cfg.dot}55` }} />
      </div>
      <p style={{ color: 'rgba(255,255,255,0.2)', fontSize: '10px', marginTop: '8px', fontFamily: 'JetBrains Mono, monospace' }}>{elapsed}s</p>
      <style>{`@keyframes aiPulse{0%,80%,100%{transform:scale(.5);opacity:.3}40%{transform:scale(1);opacity:1}}`}</style>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function AnalysisReportComponent({ report, loading }: Props) {
  if (loading) return <LoadingState />
  if (!report)  return <EmptyState />

  const theme = RISK_THEME[report.risk_level as keyof typeof RISK_THEME] ?? RISK_THEME['Stable']
  const meta = getModelMeta(report.analyzed_by ?? undefined)

  // created_at từ SQLite: "2026-04-22 13:46:00" (UTC, không có T/Z suffix)
  // Phải normalize thành ISO format trước khi parse để tránh browser interpret sai
  const ts = (() => {
    if (!report.created_at) return report.report_date
    // Thêm 'T' và 'Z' nếu chuỗi chưa có để đảm bảo parse đúng UTC
    const iso = report.created_at.includes('T')
      ? (report.created_at.endsWith('Z') ? report.created_at : report.created_at + 'Z')
      : report.created_at.replace(' ', 'T') + 'Z'
    try {
      return new Date(iso).toLocaleString('vi-VN', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh',
      })
    } catch { return report.report_date }
  })()

  const riskColor = theme.text

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>

      <style>{`
        @keyframes arSlide   { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
        @keyframes arBadgePop{ from{transform:scale(0.7);opacity:0} to{transform:scale(1);opacity:1} }
        @keyframes arBlink   { 0%,100%{opacity:1} 50%{opacity:0.35} }
        @keyframes arGlow2   { 0%,100%{box-shadow:0 0 18px rgba(52,211,153,0.25)} 50%{box-shadow:0 0 32px rgba(52,211,153,0.45)} }
        @keyframes arGlow1   { 0%,100%{box-shadow:0 0 20px rgba(248,113,113,0.35)} 50%{box-shadow:0 0 38px rgba(248,113,113,0.6)} }
        @keyframes arWave    { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-2px)} }
      `}</style>

      {/* ── 1. Risk status hero ── */}
      <div style={{
        background: theme.bg,
        border: `1px solid ${theme.border}`,
        borderRadius: '16px',
        padding: '18px 20px',
        position: 'relative', overflow: 'hidden',
        animation: report.risk_level === 'Stable'    ? 'arSlide 0.28s ease both, arGlow2 3s ease-in-out infinite' :
                   report.risk_level === 'High Risk' ? 'arSlide 0.28s ease both, arGlow1 1.5s ease-in-out infinite' :
                   'arSlide 0.28s ease both, arWave 3s ease-in-out infinite',
      }}>
        {/* Ambient glow */}
        <div style={{ position: 'absolute', top: '-60px', right: '-60px', width: '220px', height: '220px', borderRadius: '50%', background: `radial-gradient(circle, ${theme.glow} 0%, transparent 70%)`, pointerEvents: 'none' }} />

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '14px', flexWrap: 'wrap' }}>
          {/* Badge */}
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: '10px',
            background: theme.badgeBg,
            borderRadius: '24px', padding: '10px 22px',
            animation: 'arBadgePop 0.4s cubic-bezier(0.34,1.56,0.64,1) both',
            boxShadow: `0 4px 20px ${theme.glow}`,
            flexShrink: 0,
          }}>
            <span style={{ color: '#fff', fontSize: '18px', fontWeight: 900 }}>{theme.icon}</span>
            <span style={{ color: '#fff', fontSize: '15px', fontWeight: 800, letterSpacing: '1px', fontFamily: 'Space Grotesk, sans-serif' }}>{theme.label}</span>
          </div>

          {/* Time + model */}
          <div style={{ textAlign: 'right', minWidth: 0 }}>
            <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)', fontFamily: 'Space Grotesk, sans-serif', marginBottom: '3px', textTransform: 'uppercase', letterSpacing: '0.6px' }}>
              📡 LSR Engine
            </div>
            <div style={{ fontSize: '11.5px', color: 'rgba(255,255,255,0.55)', fontFamily: 'JetBrains Mono, monospace' }}>{ts}</div>
            {meta && (
              <div style={{ marginTop: '6px', display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '2px 8px 2px 4px', background: meta.bg, border: `1px solid ${meta.border}`, borderRadius: '16px' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '16px', height: '16px', borderRadius: '50%', background: meta.color, color: '#000', fontSize: '7px', fontWeight: 900 }}>{meta.chip}</span>
                <span style={{ fontSize: '10px', fontWeight: 600, color: meta.color, fontFamily: 'JetBrains Mono, monospace' }}>{meta.label}</span>
              </div>
            )}
          </div>
        </div>

        {/* Model fallback notice */}
        {meta && meta.tier !== 'Primary' && meta.message && (
          <div style={{ marginTop: '10px', fontSize: '10.5px', color: meta.tierColor, background: meta.tierBg, border: `1px solid ${meta.border}`, borderRadius: '7px', padding: '5px 10px', lineHeight: 1.5 }}>
            {meta.icon} {meta.message}
          </div>
        )}
      </div>

      {/* ── 2. Key Signals ── */}
      {(report.key_signals ?? []).length > 0 && (
        <SectionCard icon="⚠️" label="Tín hiệu phát hiện" labelColor="#fbbf24" borderColor="rgba(251,191,36,0.18)" bg="rgba(251,191,36,0.03)" delay={60}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {(report.key_signals ?? []).map((s, i) => (
              <SignalItem key={i} text={s} index={i} />
            ))}
          </div>
        </SectionCard>
      )}

      {/* ── 3. Short-term forecast ── */}
      {report.short_term_forecast && (
        <SectionCard icon="🔮" label="Dự báo 5–7 phiên tới" labelColor="#818cf8" borderColor="rgba(129,140,248,0.18)" bg="rgba(129,140,248,0.03)" delay={120}>
          <p style={{ color: 'rgba(255,255,255,0.85)', fontSize: '13px', lineHeight: 1.75, margin: 0, fontFamily: 'Space Grotesk, sans-serif' }}>
            {report.short_term_forecast}
          </p>
        </SectionCard>
      )}

      {/* ── 4. Intervention Strategy ── */}
      {report.intervention_strategy && (
        <SectionCard icon="💡" label="Chiến lược can thiệp" labelColor={riskColor} borderColor={`${riskColor}22`} bg={`${riskColor}06`} delay={180}>
          <p style={{ color: 'rgba(255,255,255,0.85)', fontSize: '13px', lineHeight: 1.75, margin: 0, fontFamily: 'Space Grotesk, sans-serif' }}>
            {report.intervention_strategy}
          </p>
        </SectionCard>
      )}

      {/* ── 5. Action Plan 48h ── */}
      {(report.action_plan_48h ?? []).length > 0 && (
        <SectionCard icon="📋" label="Kế hoạch hành động 48h" labelColor="#6366f1" borderColor="rgba(99,102,241,0.18)" bg="rgba(99,102,241,0.03)" delay={240}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginBottom: '4px', marginTop: '-8px' }}>
            <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.2)', fontFamily: 'Space Grotesk, sans-serif' }}>Nhấn để đánh dấu hoàn thành</span>
          </div>
          {(report.action_plan_48h ?? []).map((action, i) => (
            <ChecklistItem key={i} text={action} index={i} total={(report.action_plan_48h ?? []).length} accentColor="#6366f1" />
          ))}
        </SectionCard>
      )}

      {/* ── 6. API Key info (if key_name present) ── */}
      {(report.key_name || (meta && meta.tier !== 'Primary')) && (
        <div style={{ animation: 'arSlide 0.32s ease 300ms both', paddingTop: '4px' }}>
          <div style={{ height: '1px', background: 'rgba(255,255,255,0.04)', marginBottom: '8px' }} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.2)', letterSpacing: '0.5px', fontFamily: 'Space Grotesk, sans-serif', fontWeight: 600, textTransform: 'uppercase' }}>ANALYZED BY</span>
            {report.key_name ? (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '3px 10px', background: 'rgba(129,140,248,0.07)', border: '1px solid rgba(129,140,248,0.18)', borderRadius: '14px' }}>
                <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#818cf8', boxShadow: '0 0 5px #818cf8' }} />
                <span style={{ fontSize: '10.5px', fontWeight: 700, color: '#818cf8', fontFamily: 'JetBrains Mono, monospace' }}>{report.key_name}</span>
              </div>
            ) : meta ? (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '3px 10px', background: meta.bg, border: `1px solid ${meta.border}`, borderRadius: '14px' }}>
                <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: meta.color, boxShadow: `0 0 5px ${meta.color}` }} />
                <span style={{ fontSize: '10.5px', fontWeight: 700, color: meta.color, fontFamily: 'JetBrains Mono, monospace' }}>{meta.label}</span>
              </div>
            ) : null}
          </div>
        </div>
      )}

    </div>
  )
}
