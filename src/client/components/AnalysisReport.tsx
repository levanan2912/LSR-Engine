import React, { useState } from 'react'
import { AnalysisReport } from '../types'

interface Props { report: AnalysisReport | null; loading?: boolean; isDark?: boolean }

// ─── Risk theme ───────────────────────────────────────────────────────────────
const RISK_THEME = {
  'Stable': {
    bg: 'rgba(16,185,129,0.10)', border: 'rgba(52,211,153,0.30)',
    text: '#059669', textDark: '#34d399', icon: '●', label: 'ỔN ĐỊNH',
    glow: 'rgba(52,211,153,0.22)', badgeBg: 'linear-gradient(135deg,#059669,#34d399)', dot: '#34d399',
  },
  'Fluctuating': {
    bg: 'rgba(245,158,11,0.10)', border: 'rgba(251,191,36,0.30)',
    text: '#b45309', textDark: '#fbbf24', icon: '◐', label: 'DAO ĐỘNG',
    glow: 'rgba(251,191,36,0.22)', badgeBg: 'linear-gradient(135deg,#b45309,#fbbf24)', dot: '#fbbf24',
  },
  'High Risk': {
    bg: 'rgba(239,68,68,0.10)', border: 'rgba(248,113,113,0.30)',
    text: '#dc2626', textDark: '#f87171', icon: '▲', label: 'RỦI RO CAO',
    glow: 'rgba(248,113,113,0.30)', badgeBg: 'linear-gradient(135deg,#991b1b,#f87171)', dot: '#f87171',
  },
} as const

// ─── Model Metadata ───────────────────────────────────────────────────────────
const MODEL_META: Record<string, { label: string; chip: string; tier: string; color: string; bg: string; border: string; message: string; icon: string }> = {
  'gemini-2.5-flash':              { label: 'Gemini 2.5 Flash',      chip: '2.5', tier: 'Primary',  color: '#818cf8', bg: 'rgba(129,140,248,0.08)', border: 'rgba(129,140,248,0.2)', message: '',                                              icon: '⚡' },
  'gemini-3.1-flash-lite-preview': { label: 'Gemini 3.1 Flash Lite', chip: '3.1', tier: 'Fallback', color: '#22d3ee', bg: 'rgba(34,211,238,0.08)',  border: 'rgba(34,211,238,0.2)',  message: 'Tự động chuyển model dự phòng',                icon: '🔄' },
  'gemini-2.0-flash-exp':          { label: 'Gemini 2.0 Flash Exp',  chip: '2.0', tier: 'Backup',   color: '#34d399', bg: 'rgba(52,211,153,0.08)',  border: 'rgba(52,211,153,0.2)',  message: 'Sử dụng model backup',                         icon: '🛡️' },
  'gemini-2.0-flash':              { label: 'Gemini 2.0 Flash',      chip: '2.0', tier: 'Backup',   color: '#34d399', bg: 'rgba(52,211,153,0.08)',  border: 'rgba(52,211,153,0.2)',  message: 'Sử dụng model backup',                         icon: '🛡️' },
  'gemini-2.5-flash-lite':         { label: 'Gemini 2.5 Flash Lite', chip: '2.5', tier: 'Backup',   color: '#34d399', bg: 'rgba(52,211,153,0.08)',  border: 'rgba(52,211,153,0.2)',  message: 'Sử dụng model backup',                         icon: '🛡️' },
  'gemini-2.0-flash-lite':         { label: 'Gemini 2.0 Flash Lite', chip: '2.0', tier: 'Backup',   color: '#34d399', bg: 'rgba(52,211,153,0.08)',  border: 'rgba(52,211,153,0.2)',  message: 'Sử dụng model backup',                         icon: '🛡️' },
  'rule_based_fallback':           { label: 'Local Rule Engine',     chip: 'LO',  tier: 'Local',    color: '#f87171', bg: 'rgba(248,113,113,0.08)', border: 'rgba(248,113,113,0.2)', message: 'AI không khả dụng — dùng quy tắc cục bộ',    icon: '⚠️' },
}

function getModelMeta(analyzedBy?: string) {
  if (!analyzedBy) return null
  const raw = analyzedBy.replace('_success', '').trim()
  return MODEL_META[raw] ?? { label: raw, chip: 'AI', tier: 'Primary', color: '#818cf8', bg: 'rgba(129,140,248,0.08)', border: 'rgba(129,140,248,0.2)', message: '', icon: '🤖' }
}

// ─── Tính Mức độ tin cậy từ số phiên lịch sử ─────────────────────────────────
// Trường confidence_score (0–100) và session_count được tính frontend từ dữ liệu report
interface ConfidenceInfo {
  score: number         // 0–100
  label: string
  color: string
  colorDark: string
  bar: string           // gradient
  note: string
  sessionCount: number  // số phiên AI đã có context
}

function calcConfidence(report: AnalysisReport): ConfidenceInfo {
  // Ưu tiên dùng confidence_score nếu AI trả về, nếu không tính từ session_count
  const sc = report.confidence_score
  const n  = report.session_count ?? 0

  // Tính điểm cơ bản từ số phiên
  let base = sc != null ? sc : Math.min(30 + n * 10, 90)

  // Giới hạn tối đa khi ít dữ liệu
  if (n === 0) base = Math.min(base, 40)
  if (n <= 2)  base = Math.min(base, 60)
  if (n <= 4)  base = Math.min(base, 78)

  const score = Math.round(base)

  if (score >= 75) return {
    score, sessionCount: n,
    label: 'Cao', color: '#059669', colorDark: '#34d399',
    bar: 'linear-gradient(90deg,#059669,#34d399)',
    note: `Đủ lịch sử (${n} phiên) — đánh giá có độ tin cậy tốt`,
  }
  if (score >= 50) return {
    score, sessionCount: n,
    label: 'Trung bình', color: '#b45309', colorDark: '#fbbf24',
    bar: 'linear-gradient(90deg,#b45309,#fbbf24)',
    note: `${n} phiên lịch sử — thêm dữ liệu để tăng độ chính xác`,
  }
  return {
    score, sessionCount: n,
    label: 'Thấp', color: '#dc2626', colorDark: '#f87171',
    bar: 'linear-gradient(90deg,#dc2626,#f87171)',
    note: n === 0 ? 'Phiên đầu tiên — chưa có lịch sử tham chiếu' : `Chỉ ${n} phiên — cần ít nhất 5–7 phiên để phân tích ổn định`,
  }
}

// ─── Tính Điều kiện áp dụng ──────────────────────────────────────────────────
interface ApplyCondition {
  met: boolean
  label: string
  desc: string
}

function calcConditions(report: AnalysisReport): ApplyCondition[] {
  const sc = report.session_count ?? 0
  const isExc = report.is_outlier ?? false

  return [
    {
      met: sc >= 3,
      label: 'Đủ lịch sử ngắn hạn',
      desc: sc >= 3 ? `${sc} phiên gần đây` : `Chỉ ${sc} phiên — cần ≥3`,
    },
    {
      met: sc >= 7,
      label: 'Đủ lịch sử dài hạn',
      desc: sc >= 7 ? `${sc} phiên — phân tích xu hướng ổn định` : `Cần ≥7 phiên để hiểu xu hướng dài hạn`,
    },
    {
      met: !isExc,
      label: 'Không phải phiên ngoại lệ',
      desc: isExc ? 'Phiên này lệch mạnh so với baseline — đánh giá có thể bị ảnh hưởng' : 'Phiên học nằm trong biên độ bình thường',
    },
  ]
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function ChecklistItem({ text, index, total, accentColor, isDark }: { text: string; index: number; total: number; accentColor: string; isDark: boolean }) {
  const [checked, setChecked] = useState(false)
  const textColor = isDark
    ? (checked ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.82)')
    : (checked ? 'rgba(0,0,0,0.25)'       : 'rgba(0,0,0,0.78)')
  return (
    <div onClick={() => setChecked(c => !c)} style={{
      display: 'flex', alignItems: 'flex-start', gap: '11px',
      padding: '9px 0',
      borderBottom: index < total - 1 ? `1px solid ${isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)'}` : undefined,
      cursor: 'pointer', transition: 'opacity 0.2s', opacity: checked ? 0.4 : 1,
    }}>
      <div style={{
        flexShrink: 0, width: '20px', height: '20px', borderRadius: '6px', marginTop: '1px',
        border: `2px solid ${checked ? accentColor : (isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.18)')}`,
        background: checked ? `${accentColor}20` : 'transparent',
        display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s',
      }}>
        {checked && <span style={{ color: accentColor, fontSize: '11px', fontWeight: 900 }}>✓</span>}
      </div>
      <span style={{ color: textColor, fontSize: '13px', lineHeight: 1.6, textDecoration: checked ? 'line-through' : 'none', fontFamily: 'Space Grotesk, sans-serif', transition: 'all 0.2s' }}>{text}</span>
    </div>
  )
}

function SignalItem({ text, index, isDark }: { text: string; index: number; isDark: boolean }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '9px 12px',
      background: isDark ? 'rgba(251,191,36,0.06)' : 'rgba(180,83,9,0.06)',
      borderRadius: '9px', border: `1px solid ${isDark ? 'rgba(251,191,36,0.12)' : 'rgba(180,83,9,0.15)'}`,
    }}>
      <div style={{
        flexShrink: 0, width: '22px', height: '22px', borderRadius: '50%',
        background: isDark ? 'rgba(251,191,36,0.15)' : 'rgba(180,83,9,0.12)',
        border: `1px solid ${isDark ? 'rgba(251,191,36,0.3)' : 'rgba(180,83,9,0.25)'}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: '1px',
      }}>
        <span style={{ color: isDark ? '#fbbf24' : '#b45309', fontSize: '10px', fontWeight: 800 }}>{index + 1}</span>
      </div>
      <span style={{ color: isDark ? 'rgba(255,255,255,0.88)' : 'rgba(0,0,0,0.80)', fontSize: '13px', lineHeight: 1.65, fontFamily: 'Space Grotesk, sans-serif', fontWeight: 500 }}>{text}</span>
    </div>
  )
}

function SectionCard({ icon, label, labelColor, borderColor, bg, children, delay = 0 }: {
  icon: string; label: string; labelColor: string; borderColor: string; bg: string; children: React.ReactNode; delay?: number
}) {
  return (
    <div style={{ animation: `arSlide 0.32s ease ${delay}ms both`, background: bg, border: `1px solid ${borderColor}`, borderLeft: `3px solid ${labelColor}`, borderRadius: '12px', padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '11px' }}>
        <span style={{ fontSize: '15px' }}>{icon}</span>
        <span style={{ fontFamily: 'Space Grotesk, sans-serif', color: labelColor, fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.9px' }}>{label}</span>
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
    { label: 'AI Engine đang phân tích…',    sub: 'Thường xong trong 5–15 giây',             dot: '#818cf8' },
    { label: 'Đang chờ phản hồi từ AI…',     sub: 'Sắp có kết quả, vui lòng chờ thêm chút', dot: '#f59e0b' },
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
      <div style={{ width: '200px', height: '4px', borderRadius: '2px', background: 'rgba(128,128,128,0.12)', overflow: 'hidden' }}>
        <div style={{ height: '100%', borderRadius: '2px', background: `linear-gradient(90deg,${cfg.dot},${cfg.dot}88)`, width: `${Math.min(90,(elapsed/15)*90)}%`, transition: 'width 1s linear', boxShadow: `0 0 8px ${cfg.dot}55` }} />
      </div>
      <p style={{ color: 'var(--text-muted)', fontSize: '10px', marginTop: '8px', fontFamily: 'JetBrains Mono, monospace', opacity: 0.5 }}>{elapsed}s</p>
      <style>{`@keyframes aiPulse{0%,80%,100%{transform:scale(.5);opacity:.3}40%{transform:scale(1);opacity:1}}`}</style>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function AnalysisReportComponent({ report, loading, isDark = true }: Props) {
  if (loading) return <LoadingState />
  if (!report)  return <EmptyState />

  const theme      = RISK_THEME[report.risk_level as keyof typeof RISK_THEME] ?? RISK_THEME['Stable']
  const meta       = getModelMeta(report.analyzed_by ?? undefined)
  const riskColor  = isDark ? theme.textDark : theme.text
  const conf       = calcConfidence(report)
  const conditions = calcConditions(report)

  // Màu chữ adaptive cho light/dark
  const textPrimary   = isDark ? 'rgba(255,255,255,0.88)' : 'rgba(0,0,0,0.82)'
  const textSecondary = isDark ? 'rgba(255,255,255,0.50)' : 'rgba(0,0,0,0.50)'
  const dividerColor  = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)'

  // ── Timestamp: DB lưu UTC, cộng +7h → giờ Hà Nội ────────────────────────
  const ts = (() => {
    const raw = report.created_at
    if (!raw) return report.report_date
    const iso = raw.includes('T')
      ? (raw.endsWith('Z') ? raw : raw + 'Z')
      : raw.replace(' ', 'T') + 'Z'
    try {
      const utcMs = Date.parse(iso)
      if (isNaN(utcMs)) return report.report_date
      const vnD   = new Date(utcMs + 7 * 3_600_000)
      const hh    = String(vnD.getUTCHours()).padStart(2, '0')
      const min   = String(vnD.getUTCMinutes()).padStart(2, '0')
      const dd    = String(vnD.getUTCDate()).padStart(2, '0')
      const mm    = String(vnD.getUTCMonth() + 1).padStart(2, '0')
      return `${hh}:${min} ${dd}/${mm}/${vnD.getUTCFullYear()}`
    } catch { return report.report_date }
  })()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>

      <style>{`
        @keyframes arSlide    { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
        @keyframes arBadgePop { from{transform:scale(0.7);opacity:0} to{transform:scale(1);opacity:1} }
        @keyframes arGlow2    { 0%,100%{box-shadow:0 0 18px rgba(52,211,153,0.22)} 50%{box-shadow:0 0 32px rgba(52,211,153,0.40)} }
        @keyframes arGlow1    { 0%,100%{box-shadow:0 0 20px rgba(248,113,113,0.30)} 50%{box-shadow:0 0 38px rgba(248,113,113,0.55)} }
        @keyframes arWave     { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-2px)} }
      `}</style>

      {/* ── 1. Risk status hero ── */}
      <div style={{
        background: theme.bg,
        border: `1px solid ${theme.border}`,
        borderRadius: '16px', padding: '18px 20px',
        position: 'relative', overflow: 'hidden',
        animation: report.risk_level === 'Stable'    ? 'arSlide 0.28s ease both,arGlow2 3s ease-in-out infinite' :
                   report.risk_level === 'High Risk' ? 'arSlide 0.28s ease both,arGlow1 1.5s ease-in-out infinite' :
                   'arSlide 0.28s ease both,arWave 3s ease-in-out infinite',
      }}>
        <div style={{ position: 'absolute', top: '-60px', right: '-60px', width: '200px', height: '200px', borderRadius: '50%', background: `radial-gradient(circle,${theme.glow} 0%,transparent 70%)`, pointerEvents: 'none' }} />

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '14px', flexWrap: 'wrap' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '10px', background: theme.badgeBg, borderRadius: '24px', padding: '10px 22px', animation: 'arBadgePop 0.4s cubic-bezier(0.34,1.56,0.64,1) both', boxShadow: `0 4px 20px ${theme.glow}`, flexShrink: 0 }}>
            <span style={{ color: '#fff', fontSize: '18px', fontWeight: 900 }}>{theme.icon}</span>
            <span style={{ color: '#fff', fontSize: '15px', fontWeight: 800, letterSpacing: '1px', fontFamily: 'Space Grotesk, sans-serif' }}>{theme.label}</span>
          </div>

          <div style={{ textAlign: 'right', minWidth: 0 }}>
            <div style={{ fontSize: '10px', color: textSecondary, fontFamily: 'Space Grotesk, sans-serif', marginBottom: '3px', textTransform: 'uppercase', letterSpacing: '0.6px' }}>📡 LSR Engine</div>
            <div style={{ fontSize: '11.5px', color: textSecondary, fontFamily: 'JetBrains Mono, monospace' }}>{ts}</div>
            {meta && (
              <div style={{ marginTop: '6px', display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '2px 8px 2px 4px', background: meta.bg, border: `1px solid ${meta.border}`, borderRadius: '16px' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '16px', height: '16px', borderRadius: '50%', background: meta.color, color: '#000', fontSize: '7px', fontWeight: 900 }}>{meta.chip}</span>
                <span style={{ fontSize: '10px', fontWeight: 600, color: meta.color, fontFamily: 'JetBrains Mono, monospace' }}>{meta.label}</span>
              </div>
            )}
          </div>
        </div>

        {meta && meta.tier !== 'Primary' && meta.message && (
          <div style={{ marginTop: '10px', fontSize: '10.5px', color: meta.color, background: meta.bg, border: `1px solid ${meta.border}`, borderRadius: '7px', padding: '5px 10px', lineHeight: 1.5 }}>
            {meta.icon} {meta.message}
          </div>
        )}
      </div>

      {/* ── 2. Key Signals ── */}
      {(report.key_signals ?? []).length > 0 && (
        <SectionCard icon="⚠️" label="Tín hiệu phát hiện" labelColor={isDark ? '#fbbf24' : '#b45309'} borderColor={isDark ? 'rgba(251,191,36,0.18)' : 'rgba(180,83,9,0.20)'} bg={isDark ? 'rgba(251,191,36,0.03)' : 'rgba(180,83,9,0.04)'} delay={60}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {(report.key_signals ?? []).map((s, i) => <SignalItem key={i} text={s} index={i} isDark={isDark} />)}
          </div>
        </SectionCard>
      )}

      {/* ── 3. Short-term forecast ── */}
      {report.short_term_forecast && (
        <SectionCard icon="🔮" label="Dự báo 5–7 phiên tới" labelColor="#818cf8" borderColor="rgba(129,140,248,0.20)" bg={isDark ? 'rgba(129,140,248,0.03)' : 'rgba(129,140,248,0.05)'} delay={120}>
          <p style={{ color: textPrimary, fontSize: '13px', lineHeight: 1.75, margin: 0, fontFamily: 'Space Grotesk, sans-serif' }}>{report.short_term_forecast}</p>
        </SectionCard>
      )}

      {/* ── 4. Intervention Strategy ── */}
      {report.intervention_strategy && (
        <SectionCard icon="💡" label="Chiến lược can thiệp" labelColor={riskColor} borderColor={`${riskColor}30`} bg={`${riskColor}08`} delay={180}>
          <p style={{ color: textPrimary, fontSize: '13px', lineHeight: 1.75, margin: 0, fontFamily: 'Space Grotesk, sans-serif' }}>{report.intervention_strategy}</p>
        </SectionCard>
      )}

      {/* ── 5. Action Plan 48h ── */}
      {(report.action_plan_48h ?? []).length > 0 && (
        <SectionCard icon="📋" label="Kế hoạch hành động 48h" labelColor="#6366f1" borderColor="rgba(99,102,241,0.20)" bg={isDark ? 'rgba(99,102,241,0.03)' : 'rgba(99,102,241,0.05)'} delay={240}>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '4px', marginTop: '-8px' }}>
            <span style={{ fontSize: '10px', color: textSecondary, fontFamily: 'Space Grotesk, sans-serif' }}>Nhấn để đánh dấu hoàn thành</span>
          </div>
          {(report.action_plan_48h ?? []).map((action, i) => (
            <ChecklistItem key={i} text={action} index={i} total={(report.action_plan_48h ?? []).length} accentColor="#6366f1" isDark={isDark} />
          ))}
        </SectionCard>
      )}

      {/* ── 6. Mức độ tin cậy ── */}
      <SectionCard icon="📊" label="Mức độ tin cậy" labelColor={isDark ? conf.colorDark : conf.color} borderColor={`${isDark ? conf.colorDark : conf.color}30`} bg={`${isDark ? conf.colorDark : conf.color}08`} delay={300}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {/* Score + label */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ color: textPrimary, fontSize: '13px', fontFamily: 'Space Grotesk, sans-serif' }}>
              Độ tin cậy đánh giá
            </span>
            <span style={{ color: isDark ? conf.colorDark : conf.color, fontSize: '13px', fontWeight: 700, fontFamily: 'JetBrains Mono, monospace' }}>
              {conf.score}% — {conf.label}
            </span>
          </div>
          {/* Progress bar */}
          <div style={{ height: '6px', borderRadius: '3px', background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.09)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${conf.score}%`, borderRadius: '3px', background: conf.bar, transition: 'width 0.6s ease' }} />
          </div>
          {/* Note */}
          <p style={{ color: textSecondary, fontSize: '12px', margin: 0, lineHeight: 1.55, fontFamily: 'Space Grotesk, sans-serif' }}>
            {conf.note}
          </p>
        </div>
      </SectionCard>

      {/* ── 7. Điều kiện áp dụng ── */}
      <SectionCard icon="📋" label="Điều kiện áp dụng" labelColor={isDark ? '#94a3b8' : '#475569'} borderColor={isDark ? 'rgba(148,163,184,0.18)' : 'rgba(71,85,105,0.18)'} bg={isDark ? 'rgba(148,163,184,0.03)' : 'rgba(71,85,105,0.04)'} delay={360}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
          {conditions.map((c, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
              <span style={{ fontSize: '13px', flexShrink: 0, marginTop: '1px' }}>{c.met ? '✅' : '⚠️'}</span>
              <div>
                <div style={{ color: textPrimary, fontSize: '12.5px', fontWeight: 600, fontFamily: 'Space Grotesk, sans-serif' }}>{c.label}</div>
                <div style={{ color: textSecondary, fontSize: '11.5px', marginTop: '1px', fontFamily: 'Space Grotesk, sans-serif' }}>{c.desc}</div>
              </div>
            </div>
          ))}
          {/* Ghi chú nếu có outlier */}
          {report.is_outlier && (
            <div style={{ marginTop: '4px', padding: '7px 10px', background: isDark ? 'rgba(251,191,36,0.06)' : 'rgba(180,83,9,0.06)', border: `1px solid ${isDark ? 'rgba(251,191,36,0.18)' : 'rgba(180,83,9,0.18)'}`, borderRadius: '7px' }}>
              <p style={{ color: isDark ? '#fbbf24' : '#b45309', fontSize: '12px', margin: 0, lineHeight: 1.55, fontFamily: 'Space Grotesk, sans-serif' }}>
                ⚠️ Phiên này được đánh dấu là <strong>ngoại lệ</strong> — lệch mạnh so với baseline cá nhân của bạn. Hệ thống sẽ không nâng mức cảnh báo dựa trên một phiên đơn lẻ.
              </p>
            </div>
          )}
        </div>
      </SectionCard>

      {/* ── 8. Analyzed by ── */}
      {(report.key_name || (meta && meta.tier !== 'Primary')) && (
        <div style={{ animation: 'arSlide 0.32s ease 420ms both', paddingTop: '4px' }}>
          <div style={{ height: '1px', background: dividerColor, marginBottom: '8px' }} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '10px', color: textSecondary, letterSpacing: '0.5px', fontFamily: 'Space Grotesk, sans-serif', fontWeight: 600, textTransform: 'uppercase' }}>ANALYZED BY</span>
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
