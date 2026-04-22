import React, { useState } from 'react'
import { AnalysisReport } from '../types'

interface Props { report: AnalysisReport | null; loading?: boolean; isDark?: boolean }

// ─── Risk palette (same as HistoryPage ReportPanel) ───────────────────────────
const RISK_COLOR_MAP: Record<string, { bg: string; border: string; text: string; textDark: string; dot: string; label: string }> = {
  'Stable': {
    bg:       'rgba(34,197,94,0.10)',  border:    'rgba(34,197,94,0.28)',
    text:     '#15803d',               textDark:  '#34d399',
    dot:      '#22c55e',               label:     'ỔN ĐỊNH',
  },
  'Fluctuating': {
    bg:       'rgba(245,158,11,0.10)', border:    'rgba(245,158,11,0.28)',
    text:     '#b45309',               textDark:  '#fbbf24',
    dot:      '#f59e0b',               label:     'DAO ĐỘNG',
  },
  'High Risk': {
    bg:       'rgba(239,68,68,0.10)',  border:    'rgba(239,68,68,0.28)',
    text:     '#dc2626',               textDark:  '#f87171',
    dot:      '#ef4444',               label:     'RỦI RO CAO',
  },
}

// ─── Model Metadata ───────────────────────────────────────────────────────────
const MODEL_META: Record<string, { label: string; chip: string; tier: string; color: string; bg: string; border: string; message: string; icon: string }> = {
  'gemini-2.5-flash':              { label: 'Gemini 2.5 Flash',      chip: '2.5', tier: 'Primary',  color: '#818cf8', bg: 'rgba(129,140,248,0.08)', border: 'rgba(129,140,248,0.2)', message: '',                                           icon: '⚡' },
  'gemini-3.1-flash-lite-preview': { label: 'Gemini 3.1 Flash Lite', chip: '3.1', tier: 'Fallback', color: '#22d3ee', bg: 'rgba(34,211,238,0.08)',  border: 'rgba(34,211,238,0.2)',  message: 'Tự động chuyển model dự phòng',             icon: '🔄' },
  'gemini-2.0-flash-exp':          { label: 'Gemini 2.0 Flash Exp',  chip: '2.0', tier: 'Backup',   color: '#34d399', bg: 'rgba(52,211,153,0.08)',  border: 'rgba(52,211,153,0.2)',  message: 'Sử dụng model backup',                      icon: '🛡️' },
  'gemini-2.0-flash':              { label: 'Gemini 2.0 Flash',      chip: '2.0', tier: 'Backup',   color: '#34d399', bg: 'rgba(52,211,153,0.08)',  border: 'rgba(52,211,153,0.2)',  message: 'Sử dụng model backup',                      icon: '🛡️' },
  'gemini-2.5-flash-lite':         { label: 'Gemini 2.5 Flash Lite', chip: '2.5', tier: 'Backup',   color: '#34d399', bg: 'rgba(52,211,153,0.08)',  border: 'rgba(52,211,153,0.2)',  message: 'Sử dụng model backup',                      icon: '🛡️' },
  'gemini-2.0-flash-lite':         { label: 'Gemini 2.0 Flash Lite', chip: '2.0', tier: 'Backup',   color: '#34d399', bg: 'rgba(52,211,153,0.08)',  border: 'rgba(52,211,153,0.2)',  message: 'Sử dụng model backup',                      icon: '🛡️' },
  'rule_based_fallback':           { label: 'Local Rule Engine',     chip: 'LO',  tier: 'Local',    color: '#f87171', bg: 'rgba(248,113,113,0.08)', border: 'rgba(248,113,113,0.2)', message: 'AI không khả dụng — dùng quy tắc cục bộ', icon: '⚠️' },
}

function getModelMeta(analyzedBy?: string) {
  if (!analyzedBy) return null
  const raw = analyzedBy.replace('_success', '').trim()
  return MODEL_META[raw] ?? { label: raw, chip: 'AI', tier: 'Primary', color: '#818cf8', bg: 'rgba(129,140,248,0.08)', border: 'rgba(129,140,248,0.2)', message: '', icon: '🤖' }
}

// ─── Confidence calculation ───────────────────────────────────────────────────
function calcConfidence(report: AnalysisReport) {
  const contextWindow = report.session_count ?? 0
  const totalSessions = report.total_sessions ?? (contextWindow + 1)
  const sc = report.confidence_score

  let base: number
  if (sc != null) {
    base = sc
  } else {
    base = contextWindow === 0 ? 30 : Math.min(30 + contextWindow * 7, 90)
    if (contextWindow <= 2) base = Math.min(base, 45)
    else if (contextWindow <= 4) base = Math.min(base, 65)
    else if (contextWindow <= 6) base = Math.min(base, 78)
  }

  const score = Math.round(base)

  if (score >= 75) return {
    score, contextWindow, totalSessions,
    label: 'Cao', color: '#15803d', colorDark: '#34d399',
    bar: 'linear-gradient(90deg,#059669,#34d399)',
    note: `AI phân tích với ${contextWindow} phiên gần nhất — đánh giá có độ tin cậy tốt`,
  }
  if (score >= 50) return {
    score, contextWindow, totalSessions,
    label: 'Trung bình', color: '#b45309', colorDark: '#fbbf24',
    bar: 'linear-gradient(90deg,#b45309,#fbbf24)',
    note: `${contextWindow} phiên trong cửa sổ phân tích — thêm dữ liệu để tăng độ chính xác`,
  }
  return {
    score, contextWindow, totalSessions,
    label: 'Thấp', color: '#dc2626', colorDark: '#f87171',
    bar: 'linear-gradient(90deg,#dc2626,#f87171)',
    note: contextWindow === 0
      ? 'Phiên đầu tiên — chưa có lịch sử tham chiếu'
      : `Chỉ ${contextWindow} phiên lịch sử — cần ít nhất 7 phiên để phân tích xu hướng ổn định`,
  }
}

// ─── Conditions calculation ───────────────────────────────────────────────────
function calcConditions(report: AnalysisReport) {
  const contextWindow = report.session_count ?? 0
  const totalSessions = report.total_sessions ?? (contextWindow + 1)
  const isExc = report.is_outlier ?? false

  return [
    {
      met: contextWindow >= 3,
      label: 'Đủ lịch sử ngắn hạn (≥3 phiên)',
      desc: contextWindow >= 3
        ? `AI có ${contextWindow} phiên gần nhất làm context phân tích`
        : `Chỉ ${contextWindow} phiên — cần ≥3 phiên để phân tích xu hướng ngắn hạn`,
    },
    {
      met: totalSessions >= 7,
      label: 'Đủ lịch sử dài hạn (≥7 phiên)',
      desc: totalSessions >= 7
        ? `Tổng ${totalSessions} phiên — đủ để tính baseline cá nhân và xu hướng dài hạn`
        : `Tổng ${totalSessions} phiên — cần ≥7 phiên để xây dựng baseline cá nhân`,
    },
    {
      met: !isExc,
      label: 'Phiên không phải ngoại lệ',
      desc: isExc
        ? 'Phiên này lệch mạnh so với baseline cá nhân — cảnh báo sẽ KHÔNG được nâng mức dựa trên 1 phiên đơn lẻ'
        : 'Chỉ số phiên này nằm trong biên độ bình thường của lịch sử bạn',
    },
  ]
}

// ─── Checklist Item ───────────────────────────────────────────────────────────
function ChecklistItem({ text, index, total, accentColor, isDark }: {
  text: string; index: number; total: number; accentColor: string; isDark: boolean
}) {
  const [checked, setChecked] = useState(false)
  const borderColor  = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.10)'
  const faintColor   = isDark ? '#475569' : '#94a3b8'
  const textColor    = checked
    ? faintColor
    : (isDark ? 'rgba(255,255,255,0.82)' : 'rgba(0,0,0,0.78)')

  return (
    <div onClick={() => setChecked(c => !c)} style={{
      display: 'flex', alignItems: 'flex-start', gap: '10px',
      padding: '8px 0', cursor: 'pointer', transition: 'opacity 0.2s',
      opacity: checked ? 0.45 : 1,
      borderBottom: index < total - 1 ? `1px solid ${borderColor}` : undefined,
    }}>
      <div style={{
        flexShrink: 0, width: '18px', height: '18px', borderRadius: '6px', marginTop: '1px',
        border: `2px solid ${checked ? accentColor : borderColor}`,
        background: checked ? `${accentColor}20` : 'transparent',
        display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s',
      }}>
        {checked && <span style={{ color: accentColor, fontSize: '10px', fontWeight: 800 }}>✓</span>}
      </div>
      <span style={{
        color: textColor, fontSize: '12.5px', lineHeight: 1.55,
        textDecoration: checked ? 'line-through' : 'none', transition: 'all 0.2s',
        fontFamily: 'Space Grotesk, sans-serif',
      }}>{text}</span>
    </div>
  )
}

// ─── Empty State ──────────────────────────────────────────────────────────────
function EmptyState({ isDark }: { isDark: boolean }) {
  const textPrimary = isDark ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.80)'
  const textMuted   = isDark ? 'rgba(255,255,255,0.40)' : 'rgba(0,0,0,0.40)'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '52px 24px', textAlign: 'center' }}>
      <div style={{ fontSize: '48px', marginBottom: '16px', filter: 'grayscale(60%) opacity(0.35)' }}>🧠</div>
      <h3 style={{ fontFamily: 'Space Grotesk, sans-serif', color: textPrimary, fontSize: '15px', fontWeight: 700, marginBottom: '8px' }}>Chờ dữ liệu đầu tiên</h3>
      <p style={{ color: textMuted, fontSize: '13px', lineHeight: 1.7, maxWidth: '260px' }}>
        Điền nhật ký học tập và nhấn <strong style={{ color: '#818cf8' }}>⚡ Phân tích bằng AI</strong> để tạo báo cáo đầu tiên nhé!
      </p>
    </div>
  )
}

// ─── Loading State ────────────────────────────────────────────────────────────
function LoadingState({ isDark }: { isDark: boolean }) {
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
  const textPrimary = isDark ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.80)'
  const textMuted   = isDark ? 'rgba(255,255,255,0.40)' : 'rgba(0,0,0,0.40)'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px 24px', textAlign: 'center' }}>
      <div style={{ display: 'flex', gap: '6px', marginBottom: '20px' }}>
        {[0, 0.18, 0.36].map((d, i) => (
          <div key={i} style={{ width: '9px', height: '9px', borderRadius: '50%', background: cfg.dot, animation: `aiPulse 1.3s ease-in-out ${d}s infinite`, boxShadow: `0 0 9px ${cfg.dot}55` }} />
        ))}
      </div>
      <p style={{ fontFamily: 'Space Grotesk, sans-serif', color: textPrimary, fontSize: '14px', fontWeight: 600, marginBottom: '5px' }}>{cfg.label}</p>
      <p style={{ color: textMuted, fontSize: '11px', marginBottom: '20px' }}>{cfg.sub}</p>
      <div style={{ width: '200px', height: '4px', borderRadius: '2px', background: isDark ? 'rgba(128,128,128,0.12)' : 'rgba(0,0,0,0.08)', overflow: 'hidden' }}>
        <div style={{ height: '100%', borderRadius: '2px', background: `linear-gradient(90deg,${cfg.dot},${cfg.dot}88)`, width: `${Math.min(90,(elapsed/15)*90)}%`, transition: 'width 1s linear', boxShadow: `0 0 8px ${cfg.dot}55` }} />
      </div>
      <p style={{ color: textMuted, fontSize: '10px', marginTop: '8px', fontFamily: 'JetBrains Mono, monospace', opacity: 0.5 }}>{elapsed}s</p>
      <style>{`@keyframes aiPulse{0%,80%,100%{transform:scale(.5);opacity:.3}40%{transform:scale(1);opacity:1}}`}</style>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function AnalysisReportComponent({ report, loading, isDark = true }: Props) {
  if (loading) return <LoadingState isDark={isDark} />
  if (!report)  return <EmptyState isDark={isDark} />

  const riskCfg      = RISK_COLOR_MAP[report.risk_level] ?? RISK_COLOR_MAP['Fluctuating']
  const meta         = getModelMeta(report.analyzed_by ?? undefined)
  const riskColor    = isDark ? riskCfg.textDark : riskCfg.text
  const conf         = calcConfidence(report)
  const conditions   = calcConditions(report)

  // Theme-aware color vars (same as ReportPanel)
  const textPrimary       = isDark ? 'rgba(255,255,255,0.88)' : 'rgba(0,0,0,0.82)'
  const textSecondary     = isDark ? '#94a3b8'                 : '#64748b'
  const cardBg            = isDark ? 'rgba(255,255,255,0.02)'  : 'rgba(0,0,0,0.025)'
  const signalLabelColor  = isDark ? '#fbbf24' : '#d97706'
  const signalBg          = isDark ? 'rgba(251,191,36,0.06)'   : 'rgba(251,191,36,0.12)'
  const signalBorder      = isDark ? '1px solid rgba(251,191,36,0.12)' : '1px solid rgba(245,158,11,0.30)'
  const signalNumColor    = isDark ? '#fbbf24' : '#d97706'
  const actionBorderColor = isDark ? 'rgba(255,255,255,0.08)'  : 'rgba(0,0,0,0.10)'
  const actionFaintColor  = isDark ? '#475569' : '#94a3b8'
  const dividerColor      = isDark ? 'rgba(255,255,255,0.06)'  : 'rgba(0,0,0,0.08)'

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

  const confColor = isDark ? conf.colorDark : conf.color

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>

      {/* ── 1. Risk status badge (compact, matching HistoryPage style) ── */}
      <div style={{
        background: riskCfg.bg,
        border: `1px solid ${riskCfg.border}`,
        borderLeft: `3px solid ${riskColor}`,
        borderRadius: '10px', padding: '12px 14px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
          {/* Risk badge */}
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '7px' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: riskCfg.dot, flexShrink: 0, boxShadow: `0 0 6px ${riskCfg.dot}88` }} />
            <span style={{ color: riskColor, fontSize: '13px', fontWeight: 800, letterSpacing: '0.5px', fontFamily: 'Space Grotesk, sans-serif' }}>{riskCfg.label}</span>
          </div>
          {/* Timestamp + model */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '11px', color: textSecondary, fontFamily: 'JetBrains Mono, monospace' }}>{ts}</span>
            {meta && (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '2px 8px 2px 5px', background: meta.bg, border: `1px solid ${meta.border}`, borderRadius: '14px' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '15px', height: '15px', borderRadius: '50%', background: meta.color, color: '#000', fontSize: '7px', fontWeight: 900 }}>{meta.chip}</span>
                <span style={{ fontSize: '10px', fontWeight: 600, color: meta.color, fontFamily: 'JetBrains Mono, monospace' }}>{meta.label}</span>
              </div>
            )}
          </div>
        </div>
        {meta && meta.tier !== 'Primary' && meta.message && (
          <div style={{ marginTop: '8px', fontSize: '11px', color: meta.color, background: meta.bg, border: `1px solid ${meta.border}`, borderRadius: '6px', padding: '5px 9px', lineHeight: 1.5 }}>
            {meta.icon} {meta.message}
          </div>
        )}
      </div>

      {/* ── 2. Key Signals ── */}
      {(report.key_signals ?? []).length > 0 && (
        <div style={{
          background: cardBg,
          border: `1px solid ${isDark ? 'rgba(251,191,36,0.25)' : 'rgba(245,158,11,0.35)'}`,
          background: isDark ? cardBg : 'rgba(251,191,36,0.06)',
          borderLeft: `3px solid ${signalLabelColor}`,
          borderRadius: '10px', padding: '12px 14px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px' }}>
            <span style={{ fontSize: '14px' }}>⚠️</span>
            <span style={{ fontFamily: 'Space Grotesk, sans-serif', color: signalLabelColor, fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px' }}>Tín hiệu phát hiện</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
            {(report.key_signals ?? []).map((s, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'flex-start', gap: '8px',
                padding: '7px 10px', background: signalBg,
                borderRadius: '7px', border: signalBorder,
              }}>
                <span style={{ color: signalNumColor, fontSize: '10px', marginTop: '3px', flexShrink: 0, fontWeight: 700 }}>#{i + 1}</span>
                <span style={{ color: textPrimary, fontSize: '12.5px', lineHeight: 1.55, fontWeight: 500, fontFamily: 'Space Grotesk, sans-serif' }}>{s}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── 3. Short-term Forecast ── */}
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
          <p style={{ color: textPrimary, fontSize: '12.5px', lineHeight: 1.65, margin: 0, fontFamily: 'Space Grotesk, sans-serif' }}>{report.short_term_forecast}</p>
        </div>
      )}

      {/* ── 4. Intervention Strategy ── */}
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
          <p style={{ color: textPrimary, fontSize: '12.5px', lineHeight: 1.65, margin: 0, fontFamily: 'Space Grotesk, sans-serif' }}>{report.intervention_strategy}</p>
        </div>
      )}

      {/* ── 5. Action Plan 48h ── */}
      {(report.action_plan_48h ?? []).length > 0 && (
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
          {(report.action_plan_48h ?? []).map((action, i) => (
            <ChecklistItem
              key={i} text={action} index={i}
              total={(report.action_plan_48h ?? []).length}
              accentColor="#6366f1" isDark={isDark}
            />
          ))}
        </div>
      )}

      {/* ── 6. Confidence score ── */}
      <div style={{
        background: `${confColor}08`,
        border: `1px solid ${confColor}28`,
        borderLeft: `3px solid ${confColor}`,
        borderRadius: '10px', padding: '12px 14px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px' }}>
          <span style={{ fontSize: '14px' }}>📊</span>
          <span style={{ fontFamily: 'Space Grotesk, sans-serif', color: confColor, fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px' }}>Mức độ tin cậy</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ color: textPrimary, fontSize: '12.5px', fontFamily: 'Space Grotesk, sans-serif' }}>Độ tin cậy đánh giá</span>
            <span style={{ color: confColor, fontSize: '12.5px', fontWeight: 700, fontFamily: 'JetBrains Mono, monospace' }}>{conf.score}% — {conf.label}</span>
          </div>
          <div style={{ height: '5px', borderRadius: '3px', background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.09)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${conf.score}%`, borderRadius: '3px', background: conf.bar, transition: 'width 0.6s ease' }} />
          </div>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '3px 8px', background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)', border: `1px solid ${dividerColor}`, borderRadius: '7px' }}>
              <span style={{ fontSize: '10px', color: textSecondary }}>🔍 Context AI</span>
              <span style={{ fontSize: '11px', fontWeight: 700, color: confColor, fontFamily: 'JetBrains Mono, monospace' }}>{conf.contextWindow} phiên</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '3px 8px', background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)', border: `1px solid ${dividerColor}`, borderRadius: '7px' }}>
              <span style={{ fontSize: '10px', color: textSecondary }}>📚 Tổng lịch sử</span>
              <span style={{ fontSize: '11px', fontWeight: 700, color: textPrimary, fontFamily: 'JetBrains Mono, monospace' }}>{conf.totalSessions} phiên</span>
            </div>
          </div>
          <p style={{ color: textSecondary, fontSize: '12px', margin: 0, lineHeight: 1.55, fontFamily: 'Space Grotesk, sans-serif' }}>{conf.note}</p>
        </div>
      </div>

      {/* ── 7. Conditions ── */}
      <div style={{
        background: cardBg,
        border: `1px solid ${dividerColor}`,
        borderLeft: `3px solid ${isDark ? '#64748b' : '#94a3b8'}`,
        borderRadius: '10px', padding: '12px 14px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px' }}>
          <span style={{ fontSize: '14px' }}>📋</span>
          <span style={{ fontFamily: 'Space Grotesk, sans-serif', color: isDark ? '#94a3b8' : '#64748b', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px' }}>Điều kiện áp dụng</span>
        </div>
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
          {report.is_outlier && (
            <div style={{ marginTop: '4px', padding: '7px 10px', background: isDark ? 'rgba(251,191,36,0.06)' : 'rgba(180,83,9,0.06)', border: `1px solid ${isDark ? 'rgba(251,191,36,0.18)' : 'rgba(180,83,9,0.18)'}`, borderRadius: '7px' }}>
              <p style={{ color: isDark ? '#fbbf24' : '#b45309', fontSize: '12px', margin: 0, lineHeight: 1.55, fontFamily: 'Space Grotesk, sans-serif' }}>
                ⚠️ Phiên này được đánh dấu là <strong>ngoại lệ</strong> — lệch mạnh so với baseline cá nhân của bạn. Hệ thống sẽ không nâng mức cảnh báo dựa trên một phiên đơn lẻ.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── 8. Analyzed by ── */}
      {(report.key_name || (meta && meta.tier !== 'Primary')) && (
        <div style={{ paddingTop: '2px' }}>
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
