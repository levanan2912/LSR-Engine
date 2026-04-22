/**
 * ProgressSummary — Bảng tổng hợp tiến trình học tập theo chuỗi thời gian
 *
 * Logic:
 *  - Baseline cá nhân: trung bình lịch sử, loại trừ 3 phiên gần nhất
 *  - Anomaly detection: phiên lệch >1.5σ mà không lặp lại → "ngoại lệ nhất thời"
 *  - Trend ngắn hạn: 3–7 phiên gần (EMA)
 *  - Trend dài hạn: theo tuần
 *  - Cảnh báo chỉ nâng khi tín hiệu tiêu cực lặp ≥3 phiên liên tiếp
 */

import React, { useMemo, useState } from 'react'

// ─── Types ─────────────────────────────────────────────────────────────────────
export interface SessionRecord {
  id: number
  session_date: string
  session_number: number
  study_hours: number
  focus_level: number
  distraction_count: number
  goal_achieved: number   // 0 | 1
  dropout_feeling: number
  emotional_state?: string | null
  report?: { risk_level: string } | null
}

interface Baseline {
  focus: number; dropout: number; hours: number
  distractions: number; goalRate: number
  stdFocus: number; stdDropout: number; sampleSize: number
}
interface TrendPoint {
  label: string; focus: number; dropout: number
  hours: number; goalRate: number; distractions: number
}
type TrendDir = 'up' | 'down' | 'stable'
type RiskContext = 'normal' | 'anomaly' | 'short_decline' | 'sustained_decline' | 'improving'

interface Analysis {
  baseline: Baseline | null
  isAnomaly: boolean; anomalyReason: string
  shortTrend: TrendDir; longTrend: TrendDir
  riskContext: RiskContext; consecutiveDecline: number
  shortPts: TrendPoint[]; weeklyPts: TrendPoint[]
  todayVsBaseline: { focus: number; dropout: number; goalRate: number } | null
  headline: string; subline: string; badgeColor: string; badgeLabel: string
}

// ─── Math helpers ───────────────────────────────────────────────────────────────
const mean = (a: number[]) => a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0
const std  = (a: number[], m?: number) => {
  const mu = m ?? mean(a)
  return a.length > 1 ? Math.sqrt(a.reduce((s, v) => s + (v - mu) ** 2, 0) / (a.length - 1)) : 0
}
function trendDir(recent: number[], older: number[]): TrendDir {
  const r = mean(recent), o = mean(older), delta = r - o
  const threshold = Math.max(0.15, Math.abs(o) * 0.08)
  return delta > threshold ? 'up' : delta < -threshold ? 'down' : 'stable'
}
function getWeekKey(iso: string) {
  const d = new Date(iso + 'T00:00:00')
  const jan1 = new Date(d.getFullYear(), 0, 1)
  const w = Math.ceil(((d.getTime() - jan1.getTime()) / 86400000 + jan1.getDay() + 1) / 7)
  return `T${w}/${d.getFullYear().toString().slice(-2)}`
}

// ─── Core analysis engine ───────────────────────────────────────────────────────
function analyzeProgress(sessions: SessionRecord[]): Analysis | null {
  if (!sessions.length) return null
  const asc = [...sessions].sort((a, b) => {
    const d = a.session_date.localeCompare(b.session_date)
    return d !== 0 ? d : (a.session_number ?? 0) - (b.session_number ?? 0)
  })
  const n = asc.length
  const latest = asc[n - 1]

  // 1. Baseline (loại 3 phiên gần nhất, cần ≥7)
  let baseline: Baseline | null = null
  if (n >= 7) {
    const pool = asc.slice(0, n - 3)
    const fa = pool.map(s => s.focus_level), da = pool.map(s => s.dropout_feeling)
    const mf = mean(fa), md = mean(da)
    baseline = {
      focus: mf, dropout: md,
      hours: mean(pool.map(s => Number(s.study_hours))),
      distractions: mean(pool.map(s => s.distraction_count ?? 0)),
      goalRate: mean(pool.map(s => s.goal_achieved ? 100 : 0)),
      stdFocus: std(fa, mf), stdDropout: std(da, md),
      sampleSize: pool.length,
    }
  }

  // 2. Anomaly detection
  let isAnomaly = false, anomalyReason = ''
  if (baseline && n >= 7) {
    const sf = Math.max(baseline.stdFocus, 0.3), sd = Math.max(baseline.stdDropout, 0.3)
    const fDrop = baseline.focus - latest.focus_level
    const dRise = latest.dropout_feeling - baseline.dropout
    if (fDrop > sf * 1.5 || dRise > sd * 1.5) {
      const prev2avgFocus = mean(asc.slice(-3, -1).map(s => s.focus_level))
      if (prev2avgFocus >= baseline.focus - sf * 0.8) {
        isAnomaly = true
        const r: string[] = []
        if (fDrop > sf * 1.5) r.push(`tập trung giảm mạnh (${latest.focus_level.toFixed(1)} vs TB ${baseline.focus.toFixed(1)})`)
        if (dRise > sd * 1.5) r.push(`cảm giác bỏ cuộc tăng đột biến (${latest.dropout_feeling}/5)`)
        anomalyReason = r.join(', ')
      }
    }
  }

  // 3. Consecutive decline
  let consecutiveDecline = 0
  if (n >= 3) {
    const ref = baseline?.focus ?? mean(asc.slice(0, Math.max(1, n - 5)).map(s => s.focus_level))
    for (let i = n - 1; i >= 0; i--) {
      if (asc[i].focus_level < ref - 0.5 || asc[i].dropout_feeling >= 3.5) consecutiveDecline++
      else break
    }
  }

  // 4. Short-term trend (3–7 phiên)
  const sSlice = asc.slice(-Math.min(7, n))
  const sH = Math.floor(sSlice.length / 2)
  const shortTrend = sH >= 1
    ? trendDir(sSlice.slice(sH).map(s => s.focus_level), sSlice.slice(0, sH).map(s => s.focus_level))
    : 'stable'

  // 5. Long-term trend (weekly)
  const wGroups: Record<string, SessionRecord[]> = {}
  asc.forEach(s => { const k = getWeekKey(s.session_date); (wGroups[k] = wGroups[k] ?? []).push(s) })
  const weeklyPts: TrendPoint[] = Object.entries(wGroups).map(([k, g]) => ({
    label: k, focus: mean(g.map(s => s.focus_level)), dropout: mean(g.map(s => s.dropout_feeling)),
    hours: mean(g.map(s => Number(s.study_hours))),
    goalRate: mean(g.map(s => s.goal_achieved ? 100 : 0)),
    distractions: mean(g.map(s => s.distraction_count ?? 0)),
  }))
  const lH = Math.floor(weeklyPts.length / 2)
  const longTrend = lH >= 1
    ? trendDir(weeklyPts.slice(lH).map(p => p.focus), weeklyPts.slice(0, lH).map(p => p.focus))
    : 'stable'

  // 6. Short-term points for sparkline
  const shortPts: TrendPoint[] = asc.slice(-12).map((s, i) => ({
    label: `P${s.session_number ?? i + 1}`,
    focus: s.focus_level, dropout: s.dropout_feeling,
    hours: Number(s.study_hours), goalRate: s.goal_achieved ? 100 : 0,
    distractions: s.distraction_count ?? 0,
  }))

  // 7. Today vs baseline
  const todayVsBaseline = baseline ? {
    focus:   latest.focus_level - baseline.focus,
    dropout: latest.dropout_feeling - baseline.dropout,
    goalRate: (latest.goal_achieved ? 100 : 0) - baseline.goalRate,
  } : null

  // 8. Risk context
  let riskContext: RiskContext = 'normal'
  if (isAnomaly) riskContext = 'anomaly'
  else if (consecutiveDecline >= 3) riskContext = 'sustained_decline'
  else if (consecutiveDecline >= 2 || shortTrend === 'down') riskContext = 'short_decline'
  else if (shortTrend === 'up' || (longTrend === 'up' && shortTrend !== 'down')) riskContext = 'improving'

  const HM: Record<RiskContext, string> = {
    anomaly:           'Hôm nay có vẻ là một ngày khó — nhưng đây có thể chỉ là ngoại lệ',
    sustained_decline: `${consecutiveDecline} phiên liên tiếp có dấu hiệu giảm sút — cần chú ý`,
    short_decline:     'Tín hiệu hơi yếu trong vài phiên gần đây, chưa đủ để kết luận',
    improving:         'Xu hướng cải thiện rõ — bạn đang đi đúng hướng',
    normal:            'Tiến trình ổn định — tiếp tục duy trì nhịp học tập',
  }
  const SM: Record<RiskContext, string> = {
    anomaly:           `Lịch sử dài hạn của bạn vẫn ${longTrend === 'up' ? 'đang cải thiện' : longTrend === 'stable' ? 'ổn định' : 'cần theo dõi thêm'}. Hệ thống sẽ không nâng cảnh báo dựa trên một phiên bất thường đơn lẻ.`,
    sustained_decline: 'Khi tín hiệu tiêu cực lặp lại nhiều phiên liên tiếp, đây là thời điểm xem xét lại chiến lược — không phải tự trách bản thân.',
    short_decline:     'Hệ thống cần ít nhất 3 phiên tiêu cực liên tiếp để nâng mức cảnh báo. Hiện tại vẫn đang theo dõi.',
    improving:         'Xu hướng ngắn và dài hạn đều cho thấy tiến bộ. Baseline cá nhân đang được cập nhật lên.',
    normal:            'Các chỉ số trong khoảng bình thường của chính bạn. Không có tín hiệu đáng lo.',
  }
  const BM: Record<RiskContext, { color: string; label: string }> = {
    anomaly:           { color: '#f59e0b', label: 'Ngoại lệ nhất thời' },
    sustained_decline: { color: '#f87171', label: 'Cần theo dõi' },
    short_decline:     { color: '#fbbf24', label: 'Hơi chậm lại' },
    improving:         { color: '#34d399', label: 'Đang cải thiện' },
    normal:            { color: '#60a5fa', label: 'Ổn định' },
  }

  return {
    baseline, isAnomaly, anomalyReason, shortTrend, longTrend,
    riskContext, consecutiveDecline, shortPts, weeklyPts, todayVsBaseline,
    headline: HM[riskContext], subline: SM[riskContext],
    badgeColor: BM[riskContext].color, badgeLabel: BM[riskContext].label,
  }
}

// ─── Sparkline SVG ─────────────────────────────────────────────────────────────
function Sparkline({
  pts, valueKey, color, height = 64, isDark = true,
}: {
  pts: TrendPoint[]
  valueKey: keyof Pick<TrendPoint, 'focus' | 'dropout' | 'hours' | 'goalRate' | 'distractions'>
  color: string
  height?: number
  isDark?: boolean
}) {
  const emptyColor = isDark ? 'rgba(255,255,255,0.20)' : 'rgba(0,0,0,0.25)'
  const gridColor  = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.06)'
  const dotStroke  = isDark ? '#080f26' : '#f8fafc'

  if (pts.length < 2) return (
    <div style={{ height: `${height}px`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span style={{ fontSize: '11px', color: emptyColor, fontFamily: 'Space Grotesk, sans-serif' }}>Chưa đủ dữ liệu</span>
    </div>
  )
  const vals = pts.map(p => p[valueKey] as number)
  const min = Math.min(...vals), max = Math.max(...vals, min + 0.01)
  const W = 300, H = height, px = 8, py = 6
  const tx = (i: number) => px + (i / (pts.length - 1)) * (W - px * 2)
  const ty = (v: number) => py + (1 - (v - min) / (max - min)) * (H - py * 2)
  const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${tx(i)} ${ty(p[valueKey] as number)}`).join(' ')
  const area = `${path} L ${tx(pts.length - 1)} ${H} L ${tx(0)} ${H} Z`
  const gid = `spk${valueKey}${color.replace(/[^a-z0-9]/gi, '')}`

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: `${height}px`, overflow: 'visible' }} aria-hidden>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {[0, 0.5, 1].map(f => (
        <line key={f} x1={px} y1={py + f * (H - py * 2)} x2={W - px} y2={py + f * (H - py * 2)}
          stroke={gridColor} strokeWidth="1" />
      ))}
      <path d={area} fill={`url(#${gid})`} />
      <path d={path} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {pts.map((p, i) => (
        <circle key={i} cx={tx(i)} cy={ty(p[valueKey] as number)}
          r={i === pts.length - 1 ? 5 : 2.5}
          fill={i === pts.length - 1 ? color : `${color}77`}
          stroke={i === pts.length - 1 ? dotStroke : 'none'}
          strokeWidth="1.5"
        />
      ))}
      {pts.length > 0 && (() => {
        const lv = pts[pts.length - 1][valueKey] as number
        const lx = tx(pts.length - 1), ly = ty(lv)
        return (
          <text x={lx - 4} y={ly - 10} textAnchor="end"
            fill={color} fontSize="10" fontFamily="JetBrains Mono, monospace" fontWeight="700">
            {lv % 1 === 0 ? lv : lv.toFixed(1)}
          </text>
        )
      })()}
    </svg>
  )
}

// ─── Delta badge ────────────────────────────────────────────────────────────────
function Delta({ val, inverse = false, suffix = '', isDark = true }: { val: number; inverse?: boolean; suffix?: string; isDark?: boolean }) {
  if (Math.abs(val) < 0.05) return <span style={{ color: isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.28)', fontSize: '12px', fontFamily: 'JetBrains Mono' }}>±0{suffix}</span>
  const pos = inverse ? val < 0 : val > 0
  const color = pos ? '#34d399' : '#f87171'
  return <span style={{ color, fontSize: '12px', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700 }}>{val > 0 ? '+' : ''}{val % 1 === 0 ? val.toFixed(0) : val.toFixed(1)}{suffix}</span>
}

// ─── Trend icon ─────────────────────────────────────────────────────────────────
function TrendIcon({ dir, focusKey = true }: { dir: TrendDir; focusKey?: boolean }) {
  const color = dir === 'stable' ? '#64748b'
    : (dir === 'up') === focusKey ? '#34d399' : '#f87171'
  const icon = dir === 'up' ? '↗' : dir === 'down' ? '↘' : '→'
  return <span style={{ color, fontSize: '18px', fontWeight: 800, fontFamily: 'JetBrains Mono, monospace', lineHeight: 1 }}>{icon}</span>
}

// ─── Metric row ─────────────────────────────────────────────────────────────────
function MetricRow({ label, value, color, delta, inverseDelta, isDark = true }: {
  label: string; value: string; color: string; delta?: number; inverseDelta?: boolean; isDark?: boolean
}) {
  const labelColor  = isDark ? 'rgba(255,255,255,0.50)' : 'rgba(0,0,0,0.52)'
  const borderColor = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.07)'
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: `1px solid ${borderColor}` }}>
      <span style={{ fontSize: '13px', color: labelColor, fontFamily: 'Space Grotesk, sans-serif' }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        {delta !== undefined && <Delta val={delta} inverse={inverseDelta} isDark={isDark} />}
        <span style={{ fontSize: '16px', fontWeight: 800, color, fontFamily: 'JetBrains Mono, monospace' }}>{value}</span>
      </div>
    </div>
  )
}

// ─── Main component ─────────────────────────────────────────────────────────────
interface ProgressSummaryProps {
  sessions: SessionRecord[]
  loading?: boolean
  size?: 'normal' | 'large'
  isDark?: boolean
}

export default function ProgressSummary({ sessions, loading = false, size = 'normal', isDark = true }: ProgressSummaryProps) {
  const [expanded, setExpanded] = useState<'short' | 'long' | 'baseline' | null>(null)
  const lg = size === 'large'

  const analysis = useMemo(() => analyzeProgress(sessions), [sessions])

  // ── Adaptive color tokens ─────────────────────────────────────────────────
  const t = {
    textPrimary:   isDark ? 'rgba(255,255,255,0.92)' : 'rgba(0,0,0,0.85)',
    textSecondary: isDark ? 'rgba(255,255,255,0.58)' : 'rgba(0,0,0,0.55)',
    textMuted:     isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.38)',
    textFaint:     isDark ? 'rgba(255,255,255,0.20)' : 'rgba(0,0,0,0.22)',
    textEmpty:     isDark ? 'rgba(255,255,255,0.20)' : 'rgba(0,0,0,0.25)',
    bgCard:        isDark ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.028)',
    bgCardInset:   isDark ? 'rgba(99,102,241,0.06)'  : 'rgba(99,102,241,0.07)',
    borderCard:    isDark ? 'rgba(255,255,255,0.07)'  : 'rgba(0,0,0,0.09)',
    borderInset:   isDark ? 'rgba(99,102,241,0.12)'   : 'rgba(99,102,241,0.18)',
    borderExpand:  isDark ? 'rgba(255,255,255,0.05)'  : 'rgba(0,0,0,0.07)',
    headerBg:      isDark ? 'rgba(255,255,255,0.02)'  : 'rgba(0,0,0,0.025)',
    anomalyBg:     isDark ? 'rgba(245,158,11,0.08)'   : 'rgba(245,158,11,0.07)',
    anomalyBorder: isDark ? 'rgba(245,158,11,0.22)'   : 'rgba(245,158,11,0.30)',
    declineBg:     isDark ? 'rgba(248,113,113,0.08)'  : 'rgba(248,113,113,0.07)',
    declineBorder: isDark ? 'rgba(248,113,113,0.22)'  : 'rgba(248,113,113,0.28)',
    stdBg:         isDark ? 'rgba(99,102,241,0.06)'   : 'rgba(99,102,241,0.07)',
    stdBorder:     isDark ? 'rgba(99,102,241,0.12)'   : 'rgba(99,102,241,0.18)',
    expandArrow:   isDark ? 'rgba(255,255,255,0.20)'  : 'rgba(0,0,0,0.25)',
  }

  if (loading) return (
    <div style={{ padding: lg ? '28px' : '20px', textAlign: 'center' }}>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', color: t.textMuted, fontFamily: 'Space Grotesk, sans-serif', fontSize: lg ? '14px' : '12px' }}>
        <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#6366f1', animation: 'psPulse 1s infinite' }} />
        Đang phân tích tiến trình…
      </div>
    </div>
  )

  if (!analysis) return (
    <div style={{ padding: lg ? '24px' : '16px', textAlign: 'center', color: t.textEmpty, fontFamily: 'Space Grotesk, sans-serif', fontSize: lg ? '14px' : '12px' }}>
      Cần ít nhất 3 phiên để phân tích tiến trình.
    </div>
  )

  const { baseline, isAnomaly, anomalyReason, shortTrend, longTrend, riskContext,
          consecutiveDecline, shortPts, weeklyPts, todayVsBaseline,
          headline, subline, badgeColor, badgeLabel } = analysis

  const n = sessions.length
  const latest = [...sessions].sort((a, b) =>
    b.session_date.localeCompare(a.session_date) || (b.session_number ?? 0) - (a.session_number ?? 0)
  )[0]

  const shortColor = shortTrend === 'up' ? '#34d399' : shortTrend === 'down' ? '#f87171' : '#64748b'
  const longColor  = longTrend  === 'up' ? '#34d399' : longTrend  === 'down' ? '#f87171' : '#64748b'

  return (
    <div style={{ fontFamily: 'Space Grotesk, sans-serif' }}>

      {/* ══ Header status card ══ */}
      <div style={{
        background: `linear-gradient(135deg, ${badgeColor}12 0%, ${isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)'} 100%)`,
        border: `1px solid ${badgeColor}35`,
        borderLeft: `4px solid ${badgeColor}`,
        borderRadius: lg ? '18px' : '14px',
        padding: lg ? '24px 28px' : '16px 18px',
        marginBottom: lg ? '14px' : '10px',
        position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', top: '-40px', right: '-40px', width: '180px', height: '180px', borderRadius: '50%', background: `radial-gradient(circle, ${badgeColor}0d 0%, transparent 70%)`, pointerEvents: 'none' }} />

        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap', marginBottom: '12px' }}>
          <div style={{ flex: 1, minWidth: '200px' }}>
            {/* Badge pill */}
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '7px', padding: lg ? '5px 14px' : '3px 10px', background: `${badgeColor}1e`, border: `1px solid ${badgeColor}45`, borderRadius: '14px', marginBottom: lg ? '12px' : '8px' }}>
              <div style={{ width: lg ? '8px' : '6px', height: lg ? '8px' : '6px', borderRadius: '50%', background: badgeColor, boxShadow: `0 0 8px ${badgeColor}` }} />
              <span style={{ fontSize: lg ? '12px' : '10.5px', fontWeight: 700, color: badgeColor, textTransform: 'uppercase', letterSpacing: '0.6px' }}>{badgeLabel}</span>
            </div>
            {/* Headline */}
            <p style={{ margin: 0, fontSize: lg ? '18px' : '13.5px', fontWeight: 700, color: t.textPrimary, lineHeight: 1.4, letterSpacing: '-0.2px' }}>{headline}</p>
          </div>
          {/* Session count */}
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ fontSize: lg ? '36px' : '24px', fontWeight: 800, color: badgeColor, fontFamily: 'JetBrains Mono, monospace', lineHeight: 1 }}>{n}</div>
            <div style={{ fontSize: lg ? '12px' : '10px', color: t.textMuted, marginTop: '3px' }}>phiên học</div>
          </div>
        </div>

        {/* Subline */}
        <p style={{ margin: 0, fontSize: lg ? '14px' : '12px', color: t.textSecondary, lineHeight: 1.7 }}>{subline}</p>

        {/* Anomaly callout */}
        {isAnomaly && anomalyReason && (
          <div style={{ marginTop: lg ? '16px' : '10px', padding: lg ? '14px 16px' : '8px 12px', background: t.anomalyBg, border: `1px solid ${t.anomalyBorder}`, borderRadius: '10px', display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
            <span style={{ fontSize: lg ? '16px' : '13px', flexShrink: 0 }}>⚡</span>
            <p style={{ margin: 0, fontSize: lg ? '13px' : '11.5px', color: t.textSecondary, lineHeight: 1.6 }}>
              <strong style={{ color: '#fbbf24' }}>Phiên này khác với lịch sử của bạn:</strong> {anomalyReason}. Hệ thống đánh dấu là <em>ngoại lệ nhất thời</em> và không tính vào xu hướng cho đến khi tín hiệu lặp lại.
            </p>
          </div>
        )}

        {/* Consecutive decline warning */}
        {consecutiveDecline >= 3 && !isAnomaly && (
          <div style={{ marginTop: lg ? '16px' : '10px', padding: lg ? '14px 16px' : '8px 12px', background: t.declineBg, border: `1px solid ${t.declineBorder}`, borderRadius: '10px', display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
            <span style={{ fontSize: lg ? '16px' : '13px', flexShrink: 0 }}>🔴</span>
            <p style={{ margin: 0, fontSize: lg ? '13px' : '11.5px', color: t.textSecondary, lineHeight: 1.6 }}>
              <strong style={{ color: '#f87171' }}>{consecutiveDecline} phiên liên tiếp</strong> có chỉ số dưới baseline cá nhân — tín hiệu thực sự, không phải ngẫu nhiên. Xem báo cáo AI để biết hướng can thiệp.
            </p>
          </div>
        )}
      </div>

      {/* ══ Three panels: Hôm nay / Ngắn hạn / Dài hạn ══ */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: lg ? '12px' : '8px', marginBottom: lg ? '14px' : '10px' }}>

        {/* ── Hôm nay ── */}
        <div style={{ background: t.bgCard, border: `1px solid ${t.borderCard}`, borderRadius: lg ? '16px' : '12px', padding: lg ? '20px 22px' : '12px 14px' }}>
          <div style={{ fontSize: lg ? '11px' : '10px', fontWeight: 700, color: t.textMuted, textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: lg ? '14px' : '10px' }}>📸 Ảnh chụp hôm nay</div>
          {latest ? (
            <>
              <MetricRow label="Tập trung" value={`${latest.focus_level}/5`} color="#60a5fa" delta={todayVsBaseline?.focus} isDark={isDark} />
              <MetricRow label="Cảm giác bỏ cuộc" value={`${latest.dropout_feeling}/5`} color="#f87171" delta={todayVsBaseline?.dropout} inverseDelta isDark={isDark} />
              <MetricRow label="Giờ học" value={`${Number(latest.study_hours).toFixed(1)}h`} color="#34d399" isDark={isDark} />
              <MetricRow label="Xao nhãng" value={`${latest.distraction_count ?? 0} lần`} color="#f59e0b" isDark={isDark} />
              <div style={{ padding: '8px 0 0' }}>
                <span style={{ fontSize: lg ? '13px' : '11.5px', color: latest.goal_achieved ? '#22c55e' : '#ef4444', fontWeight: 600 }}>
                  {latest.goal_achieved ? '✅ Đạt mục tiêu' : '❌ Chưa đạt mục tiêu'}
                </span>
              </div>
              {baseline && (
                <div style={{ marginTop: lg ? '14px' : '10px', padding: lg ? '10px 12px' : '8px 10px', background: t.bgCardInset, border: `1px solid ${t.borderInset}`, borderRadius: '8px' }}>
                  <div style={{ fontSize: '10px', color: t.textMuted, marginBottom: '4px' }}>vs baseline cá nhân</div>
                  <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                    {todayVsBaseline && <>
                      <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                        <span style={{ fontSize: '11px', color: t.textFaint }}>Focus</span>
                        <Delta val={todayVsBaseline.focus} suffix="/5" isDark={isDark} />
                      </div>
                      <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                        <span style={{ fontSize: '11px', color: t.textFaint }}>Dropout</span>
                        <Delta val={todayVsBaseline.dropout} inverse suffix="/5" isDark={isDark} />
                      </div>
                      <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                        <span style={{ fontSize: '11px', color: t.textFaint }}>Mục tiêu</span>
                        <Delta val={todayVsBaseline.goalRate} suffix="%" isDark={isDark} />
                      </div>
                    </>}
                  </div>
                </div>
              )}
            </>
          ) : <span style={{ fontSize: '13px', color: t.textEmpty }}>Chưa có dữ liệu</span>}
        </div>

        {/* ── Ngắn hạn (3-7 phiên) ── */}
        <div
          onClick={() => setExpanded(e => e === 'short' ? null : 'short')}
          style={{ background: t.bgCard, border: `1px solid ${expanded === 'short' ? shortColor + '55' : t.borderCard}`, borderRadius: lg ? '16px' : '12px', padding: lg ? '20px 22px' : '12px 14px', cursor: 'pointer', transition: 'border-color 0.2s' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: lg ? '6px' : '4px' }}>
            <div style={{ fontSize: lg ? '11px' : '10px', fontWeight: 700, color: t.textMuted, textTransform: 'uppercase', letterSpacing: '0.6px' }}>📈 3–7 phiên gần đây</div>
            <TrendIcon dir={shortTrend} />
          </div>
          <div style={{ fontSize: lg ? '12px' : '10.5px', color: t.textFaint, marginBottom: lg ? '14px' : '10px' }}>
            Tập trung {shortTrend === 'up' ? '↑ cải thiện' : shortTrend === 'down' ? '↓ giảm nhẹ' : '→ ổn định'} · {shortPts.length} phiên
          </div>
          <Sparkline pts={shortPts} valueKey="focus" color={shortColor} height={lg ? 80 : 52} isDark={isDark} />

          <div style={{ marginTop: lg ? '14px' : '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {([
              { label: 'Focus TB', key: 'focus' as const, color: '#60a5fa', good: true },
              { label: 'Dropout TB', key: 'dropout' as const, color: '#f87171', good: false },
              { label: 'Mục tiêu', key: 'goalRate' as const, color: '#34d399', good: true },
            ] as const).map(({ label, key, color, good }) => {
              const vals = shortPts.map(p => p[key])
              const avg = vals.reduce((s, v) => s + v, 0) / (vals.length || 1)
              const h = vals.length
              const dir = h >= 4 ? trendDir(vals.slice(Math.floor(h / 2)), vals.slice(0, Math.floor(h / 2))) : 'stable' as TrendDir
              return (
                <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: lg ? '12px' : '10.5px', color: t.textFaint }}>{label}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <span style={{ fontSize: lg ? '13px' : '11.5px', fontWeight: 700, color, fontFamily: 'JetBrains Mono, monospace' }}>{avg.toFixed(1)}</span>
                    <TrendIcon dir={dir} focusKey={good} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* ── Dài hạn (theo tuần) ── */}
        <div
          onClick={() => setExpanded(e => e === 'long' ? null : 'long')}
          style={{ background: t.bgCard, border: `1px solid ${expanded === 'long' ? longColor + '55' : t.borderCard}`, borderRadius: lg ? '16px' : '12px', padding: lg ? '20px 22px' : '12px 14px', cursor: 'pointer', transition: 'border-color 0.2s' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: lg ? '6px' : '4px' }}>
            <div style={{ fontSize: lg ? '11px' : '10px', fontWeight: 700, color: t.textMuted, textTransform: 'uppercase', letterSpacing: '0.6px' }}>📅 Xu hướng theo tuần</div>
            <TrendIcon dir={longTrend} />
          </div>
          <div style={{ fontSize: lg ? '12px' : '10.5px', color: t.textFaint, marginBottom: lg ? '14px' : '10px' }}>
            {weeklyPts.length >= 2
              ? `${weeklyPts.length} tuần · ${longTrend === 'up' ? 'cải thiện' : longTrend === 'down' ? 'có chiều hướng giảm' : 'ổn định'}`
              : `Chưa đủ dữ liệu tuần (${n} phiên)`}
          </div>
          <Sparkline pts={weeklyPts.length >= 2 ? weeklyPts : shortPts} valueKey="focus" color={longColor} height={lg ? 80 : 52} isDark={isDark} />

          {weeklyPts.length >= 2 && (
            <div style={{ marginTop: lg ? '14px' : '8px', display: 'flex', flexDirection: 'column', gap: '5px' }}>
              {weeklyPts.slice(-4).map((wp, i) => {
                const isLast = i === Math.min(weeklyPts.length, 4) - 1
                return (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', opacity: isLast ? 1 : 0.55 + i * 0.15 }}>
                    <span style={{ fontSize: lg ? '12px' : '10px', color: t.textMuted, fontFamily: 'JetBrains Mono, monospace' }}>{wp.label}</span>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <span style={{ fontSize: lg ? '12px' : '10.5px', color: '#60a5fa', fontFamily: 'JetBrains Mono, monospace', fontWeight: isLast ? 700 : 400 }}>{wp.focus.toFixed(1)}<span style={{ color: t.textFaint, fontSize: '9px' }}>/5</span></span>
                      <span style={{ fontSize: lg ? '12px' : '10.5px', color: '#f59e0b', fontFamily: 'JetBrains Mono, monospace' }}>{wp.distractions.toFixed(0)}<span style={{ color: t.textFaint, fontSize: '9px' }}>x</span></span>
                      <span style={{ fontSize: lg ? '12px' : '10.5px', color: '#34d399', fontFamily: 'JetBrains Mono, monospace' }}>{wp.goalRate.toFixed(0)}<span style={{ color: t.textFaint, fontSize: '9px' }}>%</span></span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* ══ Baseline card ══ */}
      {baseline && (
        <div
          onClick={() => setExpanded(e => e === 'baseline' ? null : 'baseline')}
          style={{
            background: t.headerBg,
            border: `1px solid ${expanded === 'baseline' ? 'rgba(99,102,241,0.4)' : t.borderCard}`,
            borderLeft: `4px solid #6366f1`,
            borderRadius: lg ? '16px' : '12px',
            padding: lg ? '20px 24px' : '12px 16px',
            cursor: 'pointer', transition: 'border-color 0.2s',
          }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: lg ? '16px' : '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: lg ? '16px' : '13px' }}>🧮</span>
              <span style={{ fontSize: lg ? '14px' : '11.5px', fontWeight: 700, color: t.textPrimary }}>{`Baseline cá nhân của bạn`}</span>
              <span style={{ fontSize: lg ? '11px' : '9.5px', color: t.textMuted, background: 'rgba(99,102,241,0.10)', border: '1px solid rgba(99,102,241,0.20)', borderRadius: '6px', padding: '2px 8px' }}>
                Tính từ {baseline.sampleSize} phiên
              </span>
            </div>
            <span style={{ fontSize: '10px', color: expanded === 'baseline' ? '#818cf8' : t.expandArrow, display: 'inline-block', transform: expanded === 'baseline' ? 'rotate(180deg)' : 'none', transition: 'all 0.2s' }}>▼</span>
          </div>

          {/* Baseline metrics grid */}
          <div style={{ display: 'grid', gridTemplateColumns: lg ? 'repeat(4, 1fr)' : 'repeat(2, 1fr)', gap: lg ? '12px' : '8px' }}>
            {[
              { label: 'Focus trung bình', val: baseline.focus.toFixed(1), sub: '/ 5', color: '#60a5fa' },
              { label: 'Dropout trung bình', val: baseline.dropout.toFixed(1), sub: '/ 5', color: '#f87171' },
              { label: 'Giờ học trung bình', val: baseline.hours.toFixed(1), sub: 'h', color: '#34d399' },
              { label: 'Tỉ lệ đạt mục tiêu', val: baseline.goalRate.toFixed(0), sub: '%', color: '#a78bfa' },
            ].map(({ label, val, sub, color }) => (
              <div key={label} style={{ padding: lg ? '14px 16px' : '10px 12px', background: `${color}0a`, border: `1px solid ${color}20`, borderRadius: '10px' }}>
                <div style={{ fontSize: lg ? '11px' : '9.5px', color: t.textMuted, marginBottom: '6px', fontWeight: 600 }}>{label}</div>
                <div style={{ fontSize: lg ? '26px' : '18px', fontWeight: 800, color, fontFamily: 'JetBrains Mono, monospace', lineHeight: 1 }}>
                  {val}<span style={{ fontSize: lg ? '13px' : '11px', fontWeight: 400, color: t.textFaint }}>{sub}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Expanded detail */}
          {expanded === 'baseline' && (
            <div style={{ marginTop: lg ? '16px' : '12px', paddingTop: lg ? '16px' : '12px', borderTop: `1px solid ${t.borderExpand}` }}>
              <p style={{ margin: '0 0 12px', fontSize: lg ? '13px' : '11.5px', color: t.textSecondary, lineHeight: 1.7 }}>
                Baseline được tính từ <strong style={{ color: '#a5b4fc' }}>{baseline.sampleSize} phiên lịch sử</strong>, loại trừ 3 phiên gần nhất để tránh bị ảnh hưởng bởi biến động nhất thời. Hệ thống dùng baseline này để phân biệt <em>"khác bình thường của chính bạn"</em> với <em>"suy giảm thực sự"</em>.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <div style={{ padding: lg ? '12px 14px' : '8px 10px', background: t.stdBg, border: `1px solid ${t.stdBorder}`, borderRadius: '9px' }}>
                  <div style={{ fontSize: '10px', color: t.textMuted, marginBottom: '4px' }}>Độ lệch chuẩn Focus (σ)</div>
                  <div style={{ fontSize: lg ? '18px' : '14px', fontWeight: 700, color: '#60a5fa', fontFamily: 'JetBrains Mono, monospace' }}>±{baseline.stdFocus.toFixed(2)}</div>
                  <div style={{ fontSize: '10px', color: t.textFaint, marginTop: '3px' }}>Ngưỡng ngoại lệ: &lt;{(baseline.focus - baseline.stdFocus * 1.5).toFixed(1)}</div>
                </div>
                <div style={{ padding: lg ? '12px 14px' : '8px 10px', background: t.stdBg, border: `1px solid ${t.stdBorder}`, borderRadius: '9px' }}>
                  <div style={{ fontSize: '10px', color: t.textMuted, marginBottom: '4px' }}>Ngưỡng nâng cảnh báo</div>
                  <div style={{ fontSize: lg ? '18px' : '14px', fontWeight: 700, color: '#f87171', fontFamily: 'JetBrains Mono, monospace' }}>3 phiên</div>
                  <div style={{ fontSize: '10px', color: t.textFaint, marginTop: '3px' }}>Tín hiệu tiêu cực liên tiếp</div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <style>{`@keyframes psPulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.4;transform:scale(0.7)} }`}</style>
    </div>
  )
}
