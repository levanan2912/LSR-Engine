import React, { useState } from 'react'
import { AnalysisReport } from '../types'

interface Props { report: AnalysisReport | null; loading?: boolean }

// ─── Risk theme ───────────────────────────────────────────────────────────────
const RISK_THEME = {
  'Stable': {
    bg: 'linear-gradient(135deg, rgba(16,185,129,0.12), rgba(52,211,153,0.06))',
    border: 'rgba(52,211,153,0.3)', text: '#34d399', icon: '●',
    label: 'ỔN ĐỊNH', glow: 'rgba(52,211,153,0.3)',
    badgeBg: 'linear-gradient(135deg, #10b981, #34d399)',
    animation: 'pulse2s 2s ease-in-out infinite',
  },
  'Fluctuating': {
    bg: 'linear-gradient(135deg, rgba(245,158,11,0.12), rgba(251,191,36,0.06))',
    border: 'rgba(251,191,36,0.3)', text: '#fbbf24', icon: '◐',
    label: 'DAO ĐỘNG', glow: 'rgba(251,191,36,0.3)',
    badgeBg: 'linear-gradient(135deg, #d97706, #fbbf24)',
    animation: 'waveFloat 3s ease-in-out infinite',
  },
  'High Risk': {
    bg: 'linear-gradient(135deg, rgba(239,68,68,0.12), rgba(248,113,113,0.06))',
    border: 'rgba(248,113,113,0.3)', text: '#f87171', icon: '▲',
    label: 'RỦI RO CAO', glow: 'rgba(248,113,113,0.4)',
    badgeBg: 'linear-gradient(135deg, #dc2626, #f87171)',
    animation: 'pulse1s 1s ease-in-out infinite',
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
      <div style={{ paddingTop: '14px', borderTop: '1px solid var(--section-border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '10px', color: '#94a3b8', letterSpacing: '0.5px', fontFamily: 'Space Grotesk, sans-serif', fontWeight: 600, textTransform: 'uppercase' }}>ANALYZED BY</span>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '5px 12px', background: meta.bg, border: `1px solid ${meta.border}`, borderRadius: '20px' }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: meta.color, flexShrink: 0, boxShadow: `0 0 6px ${meta.color}` }} />
            <span style={{ fontSize: '12px', fontWeight: 700, color: meta.color, fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.15px' }}>{keyName}</span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ paddingTop: '14px', borderTop: '1px solid var(--section-border, rgba(255,255,255,0.06))' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: meta.message && meta.tier !== 'Primary' ? '8px' : '0' }}>
        <span style={{ fontSize: '10px', color: '#94a3b8', letterSpacing: '0.5px', fontFamily: 'Space Grotesk, sans-serif', fontWeight: 600, textTransform: 'uppercase' }}>ANALYZED BY</span>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
          <span style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.5px', padding: '2px 7px', borderRadius: '4px', color: meta.tierColor, background: meta.tierBg, border: `1px solid ${meta.border}`, textTransform: 'uppercase', fontFamily: 'Space Grotesk, sans-serif' }}>{meta.icon} {meta.tier}</span>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '3px 8px 3px 4px', background: meta.bg, border: `1px solid ${meta.border}`, borderRadius: '20px' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '20px', height: '20px', borderRadius: '50%', background: meta.color, color: '#000', fontSize: '8px', fontWeight: 800 }}>{meta.chip}</span>
            <span style={{ fontSize: '11px', fontWeight: 600, color: meta.color, fontFamily: 'JetBrains Mono, monospace' }}>{meta.label}</span>
            <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: meta.color, opacity: 0.7, boxShadow: `0 0 4px ${meta.color}` }} />
          </div>
        </div>
      </div>
      {meta.message && meta.tier !== 'Primary' && (
        <div style={{ fontSize: '10px', color: meta.tierColor, background: meta.tierBg, border: `1px solid ${meta.border}`, borderRadius: '8px', padding: '5px 10px', opacity: 0.85, lineHeight: 1.5 }}>{meta.message}</div>
      )}
    </div>
  )
}

// ─── Mini Card ────────────────────────────────────────────────────────────────
function MiniCard({ icon, title, children, delay = 0, accentColor }: {
  icon: string; title: string; children: React.ReactNode; delay?: number; accentColor?: string
}) {
  return (
    <div style={{
      background: 'var(--bg-card)',
      border: `1px solid ${accentColor ? `${accentColor}35` : 'var(--border-card)'}`,
      borderRadius: '10px', padding: '10px 12px',
      animation: `cardSlideIn 0.4s ease ${delay}ms both`,
      boxShadow: 'var(--card-shadow)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '6px' }}>
        <span style={{ fontSize: '13px' }}>{icon}</span>
        <span style={{ fontFamily: 'Space Grotesk, sans-serif', color: accentColor || '#94a3b8', fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.7px' }}>{title}</span>
      </div>
      {children}
    </div>
  )
}

// ─── Checklist Item ───────────────────────────────────────────────────────────
function ChecklistItem({ text, index }: { text: string; index: number }) {
  const [checked, setChecked] = useState(false)
  return (
    <div
      onClick={() => setChecked(c => !c)}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: '8px',
        padding: '5px 0', cursor: 'pointer',
        borderBottom: index > 0 ? '1px solid var(--section-border)' : undefined,
        transition: 'opacity 0.2s',
        opacity: checked ? 0.5 : 1,
      }}
    >
      <div style={{
        flexShrink: 0, width: '16px', height: '16px', borderRadius: '5px', marginTop: '1px',
        border: `2px solid ${checked ? '#6366f1' : 'var(--border-card)'}`,
        background: checked ? 'rgba(99,102,241,0.2)' : 'transparent',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'all 0.2s',
      }}>
        {checked && <span style={{ color: '#818cf8', fontSize: '9px', fontWeight: 700 }}>✓</span>}
      </div>
      <span style={{ color: checked ? 'var(--text-faint)' : 'var(--text-secondary)', fontSize: '12px', lineHeight: 1.5, textDecoration: checked ? 'line-through' : 'none', transition: 'all 0.2s' }}>{text}</span>
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

  // Phase dựa trên 15s tổng (timeout backend = 20s/model, thường xong trong 5-15s)
  const phase = elapsed >= 12 ? 1 : 0
  const cfg = [
    { label: 'AI Engine đang phân tích…',     sub: 'Thường xong trong 5–15 giây',                  dot: '#818cf8' },
    { label: 'Đang chờ phản hồi từ AI…',      sub: 'Sắp có kết quả, vui lòng chờ thêm chút',      dot: '#f59e0b' },
  ][phase]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px 24px', textAlign: 'center' }}>
      <div style={{ display: 'flex', gap: '6px', marginBottom: '20px' }}>
        {[0, 0.18, 0.36].map((d, i) => (
          <div key={i} style={{ width: '8px', height: '8px', borderRadius: '50%', background: cfg.dot, animation: `aiPulse 1.3s ease-in-out ${d}s infinite`, transition: 'background 0.4s', boxShadow: `0 0 8px ${cfg.dot}60` }} />
        ))}
      </div>
      <p style={{ fontFamily: 'Space Grotesk, sans-serif', color: 'var(--text-primary)', fontSize: '14px', fontWeight: 600, marginBottom: '5px' }}>{cfg.label}</p>
      <p style={{ color: 'var(--text-muted)', fontSize: '11px', marginBottom: '20px' }}>{cfg.sub}</p>
      <div style={{ width: '200px', height: '4px', borderRadius: '2px', background: 'var(--border-card)', overflow: 'hidden' }}>
        <div style={{ height: '100%', borderRadius: '2px', background: `linear-gradient(90deg, ${cfg.dot}, ${cfg.dot}88)`, width: `${Math.min(90, (elapsed / 15) * 90)}%`, transition: 'width 1s linear, background 0.4s', boxShadow: `0 0 8px ${cfg.dot}60` }} />
      </div>
      <p style={{ color: 'var(--text-faint)', fontSize: '10px', marginTop: '8px', fontFamily: 'JetBrains Mono, monospace' }}>{elapsed}s</p>
      <style>{`
        @keyframes aiPulse{0%,80%,100%{transform:scale(.5);opacity:.3}40%{transform:scale(1);opacity:1}}
      `}</style>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function AnalysisReportComponent({ report, loading }: Props) {
  if (loading) return <LoadingState />
  if (!report)  return <EmptyState />

  const theme = RISK_THEME[report.risk_level as keyof typeof RISK_THEME] ?? RISK_THEME['Stable']
  const ts = report.created_at
    ? new Date(new Date(report.created_at).getTime() + 7 * 3600000).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })
    : report.report_date

  const riskColor = report.risk_level === 'High Risk' ? '#f87171' : report.risk_level === 'Fluctuating' ? '#fbbf24' : '#34d399'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>

      <style>{`
        @keyframes cardSlideIn { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:translateY(0)} }
        @keyframes pulse2s     { 0%,100%{box-shadow:0 0 20px rgba(52,211,153,0.3)} 50%{box-shadow:0 0 35px rgba(52,211,153,0.5)} }
        @keyframes pulse1s     { 0%,100%{box-shadow:0 0 20px rgba(248,113,113,0.4)} 50%{box-shadow:0 0 40px rgba(248,113,113,0.65)} }
        @keyframes waveFloat   { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-3px)} }
      `}</style>

      {/* ── Risk Level Badge ─── */}
      <div style={{ animation: 'cardSlideIn 0.3s ease both' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '4px' }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: '8px',
            background: theme.badgeBg,
            borderRadius: '20px', padding: '8px 18px',
            animation: theme.animation,
            boxShadow: `0 0 20px ${theme.glow}`,
            flexShrink: 0,
          }}>
            <span style={{ color: '#fff', fontSize: '15px' }}>{theme.icon}</span>
            <span style={{ color: '#fff', fontSize: '13px', fontWeight: 800, letterSpacing: '0.8px', fontFamily: 'Space Grotesk, sans-serif' }}>{theme.label}</span>
          </div>
          <div>
            <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: '2px', fontFamily: 'Space Grotesk, sans-serif' }}>📡 Báo cáo Phân tích AI</div>
            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'JetBrains Mono, monospace' }}>{ts}</div>
          </div>
        </div>
      </div>

      {/* ── Key Signals ─── */}
      <MiniCard icon="⚠️" title="Tín hiệu phát hiện" delay={100} accentColor="#fbbf24">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
          {(report.key_signals ?? []).map((s, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '6px' }}>
              <span style={{ color: '#6366f1', fontSize: '11px', marginTop: '2px', flexShrink: 0 }}>▸</span>
              <span style={{ color: 'var(--text-secondary)', fontSize: '12px', lineHeight: 1.5 }}>{s}</span>
            </div>
          ))}
        </div>
      </MiniCard>

      {/* ── Forecast + Risk Driver ─── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
        <MiniCard icon="🔮" title="Dự báo 5–7 phiên tới" delay={150} accentColor="#818cf8">
          <p style={{ color: 'var(--text-secondary)', fontSize: '11px', lineHeight: 1.55, margin: 0 }}>{report.short_term_forecast}</p>
        </MiniCard>
        <MiniCard icon="🎯" title="Vấn đề cốt lõi" delay={200} accentColor={riskColor}>
          <p style={{ color: 'var(--text-secondary)', fontSize: '11px', lineHeight: 1.55, margin: 0 }}>{report.primary_risk_driver}</p>
        </MiniCard>
      </div>

      {/* ── Intervention Strategy ─── */}
      <MiniCard icon="💡" title="Chiến lược can thiệp" delay={250} accentColor="#34d399">
        <p style={{ color: 'var(--text-secondary)', fontSize: '12px', lineHeight: 1.55, margin: 0 }}>{report.intervention_strategy}</p>
      </MiniCard>

      {/* ── Action Plan 48h ─── */}
      <MiniCard icon="📋" title="Kế hoạch hành động 48h" delay={300} accentColor="#6366f1">
        <div>
          {(report.action_plan_48h ?? []).map((action, i) => (
            <ChecklistItem key={i} text={action} index={i} />
          ))}
        </div>
      </MiniCard>

      {/* ── Monitoring Protocol ─── */}
      {report.monitoring_protocol && (
        <MiniCard icon="🔔" title="Giao thức giám sát" delay={350} accentColor={riskColor}>
          <p style={{ color: 'var(--text-secondary)', fontSize: '11px', lineHeight: 1.55, margin: 0 }}>{report.monitoring_protocol}</p>
        </MiniCard>
      )}

      {/* ── AI Badge ─── */}
      <div style={{ animation: `cardSlideIn 0.4s ease 400ms both` }}>
        <AIModelBadge analyzedBy={report.analyzed_by ?? undefined} keyName={report.key_name} />
      </div>

    </div>
  )
}
