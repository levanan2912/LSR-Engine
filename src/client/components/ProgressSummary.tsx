/**
 * ProgressSummary — Bảng tổng hợp tiến trình học tập theo chuỗi thời gian
 *
 * Logic cốt lõi:
 *  - Baseline cá nhân: trung bình lịch sử ≥7 phiên
 *  - Phát hiện ngoại lệ: phiên lệch >1.5σ so với baseline nhưng không lặp lại → đánh dấu "bất thường nhất thời"
 *  - Trend ngắn hạn: 3–7 phiên gần nhất (EMA-weighted)
 *  - Trend dài hạn: tất cả lịch sử theo tuần
 *  - Risk contextual: chỉ nâng cảnh báo khi tín hiệu tiêu cực lặp ≥3 phiên liên tiếp
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
  report?: {
    risk_level: string
  } | null
}

interface Baseline {
  focus:        number
  dropout:      number
  hours:        number
  distractions: number
  goalRate:     number   // 0-100
  stdFocus:     number
  stdDropout:   number
  sampleSize:   number
}

interface TrendPoint {
  label: string
  focus: number
  dropout: number
  hours: number
  goalRate: number
  distractions: number
}

type TrendDir = 'up' | 'down' | 'stable'
type RiskContext = 'normal' | 'anomaly' | 'short_decline' | 'sustained_decline' | 'improving'

interface Analysis {
  baseline:          Baseline | null
  isAnomaly:         boolean          // phiên mới nhất là ngoại lệ nhất thời
  anomalyReason:     string
  shortTrend:        TrendDir         // 3-7 phiên
  longTrend:         TrendDir         // toàn bộ lịch sử
  riskContext:       RiskContext
  consecutiveDecline: number          // số phiên tiêu cực liên tiếp
  shortPts:          TrendPoint[]
  weeklyPts:         TrendPoint[]
  todayVsBaseline:   { focus: number; dropout: number; goalRate: number } | null
  headline:          string
  subline:           string
  badgeColor:        string
  badgeLabel:        string
}

// ─── Utilities ─────────────────────────────────────────────────────────────────
function mean(arr: number[]): number {
  return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0
}
function std(arr: number[], m?: number): number {
  const mu = m ?? mean(arr)
  return arr.length > 1
    ? Math.sqrt(arr.reduce((s, v) => s + (v - mu) ** 2, 0) / (arr.length - 1))
    : 0
}
/** Exponential moving average — more weight on recent values */
function ema(arr: number[], alpha = 0.3): number {
  if (!arr.length) return 0
  return arr.reduce((s, v) => alpha * v + (1 - alpha) * s)
}
function trendDir(recent: number[], older: number[]): TrendDir {
  const r = mean(recent), o = mean(older)
  const delta = r - o
  const threshold = Math.max(0.15, o * 0.08)
  if (delta > threshold) return 'up'
  if (delta < -threshold) return 'down'
  return 'stable'
}
function getWeekKey(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  const jan1 = new Date(d.getFullYear(), 0, 1)
  const week = Math.ceil(((d.getTime() - jan1.getTime()) / 86400000 + jan1.getDay() + 1) / 7)
  return `T${week}`
}
function fmtDate(iso: string): string {
  try { const d = new Date(iso + 'T00:00:00'); return `${d.getDate()}/${d.getMonth() + 1}` }
  catch { return iso }
}

// ─── Core Analysis Engine ───────────────────────────────────────────────────────
function analyzeProgress(sessions: SessionRecord[]): Analysis | null {
  if (sessions.length === 0) return null

  // Sort oldest → newest
  const asc = [...sessions].sort((a, b) => {
    const d = a.session_date.localeCompare(b.session_date)
    return d !== 0 ? d : (a.session_number ?? 0) - (b.session_number ?? 0)
  })

  const n = asc.length
  const latest = asc[n - 1]

  // ── 1. Baseline (dùng tất cả trừ 3 phiên mới nhất, tối thiểu 5 phiên) ────
  let baseline: Baseline | null = null
  if (n >= 7) {
    const basePool = asc.slice(0, n - 3)     // loại 3 phiên gần nhất khỏi baseline
    const focusArr     = basePool.map(s => s.focus_level)
    const dropoutArr   = basePool.map(s => s.dropout_feeling)
    const hoursArr     = basePool.map(s => Number(s.study_hours))
    const distrArr     = basePool.map(s => s.distraction_count ?? 0)
    const goalArr      = basePool.map(s => (s.goal_achieved ? 100 : 0))
    const mFocus   = mean(focusArr)
    const mDropout = mean(dropoutArr)
    baseline = {
      focus:        mFocus,
      dropout:      mDropout,
      hours:        mean(hoursArr),
      distractions: mean(distrArr),
      goalRate:     mean(goalArr),
      stdFocus:     std(focusArr, mFocus),
      stdDropout:   std(dropoutArr, mDropout),
      sampleSize:   basePool.length,
    }
  }

  // ── 2. Anomaly detection (phiên mới nhất) ─────────────────────────────────
  let isAnomaly = false
  let anomalyReason = ''

  if (baseline && n >= 7) {
    const focusDelta   = baseline.focus - latest.focus_level    // positive = drop
    const dropoutDelta = latest.dropout_feeling - baseline.dropout  // positive = rise
    const sigmaF = Math.max(baseline.stdFocus, 0.3)
    const sigmaD = Math.max(baseline.stdDropout, 0.3)

    const focusOutlier   = focusDelta   > sigmaF * 1.5
    const dropoutOutlier = dropoutDelta > sigmaD * 1.5

    if (focusOutlier || dropoutOutlier) {
      // Check if the dip appeared in previous 2 sessions too (pattern vs one-off)
      const prev2 = asc.slice(-3, -1)
      const prev2FocusAvg = mean(prev2.map(s => s.focus_level))
      const alreadyLow = prev2FocusAvg < baseline.focus - sigmaF * 0.8

      if (!alreadyLow) {
        isAnomaly = true
        const reasons: string[] = []
        if (focusOutlier)   reasons.push(`tập trung giảm mạnh (${latest.focus_level.toFixed(1)} vs TB ${baseline.focus.toFixed(1)})`)
        if (dropoutOutlier) reasons.push(`bỏ cuộc tăng đột biến (${latest.dropout_feeling}/5)`)
        anomalyReason = reasons.join(', ')
      }
    }
  }

  // ── 3. Consecutive decline (số phiên tiêu cực liên tiếp) ─────────────────
  let consecutiveDecline = 0
  if (n >= 3) {
    const refFocus = baseline?.focus ?? mean(asc.slice(0, Math.max(1, n - 5)).map(s => s.focus_level))
    for (let i = n - 1; i >= 0; i--) {
      const isBad = asc[i].focus_level < refFocus - 0.5 || asc[i].dropout_feeling >= 3.5
      if (isBad) consecutiveDecline++
      else break
    }
  }

  // ── 4. Short-term trend (3-7 phiên) ──────────────────────────────────────
  const shortSlice  = asc.slice(-Math.min(7, n))
  const shortHalf   = Math.floor(shortSlice.length / 2)
  const shortRecent = shortSlice.slice(shortHalf).map(s => s.focus_level)
  const shortOlder  = shortSlice.slice(0, shortHalf).map(s => s.focus_level)
  const shortTrend  = shortOlder.length >= 1 ? trendDir(shortRecent, shortOlder) : 'stable'

  // ── 5. Long-term trend (weekly aggregation) ───────────────────────────────
  const weekGroups: Record<string, SessionRecord[]> = {}
  asc.forEach(s => {
    const k = getWeekKey(s.session_date)
    if (!weekGroups[k]) weekGroups[k] = []
    weekGroups[k].push(s)
  })
  const weekKeys    = Object.keys(weekGroups)
  const weeklyPts: TrendPoint[] = weekKeys.map(k => {
    const g = weekGroups[k]
    return {
      label:        k,
      focus:        mean(g.map(s => s.focus_level)),
      dropout:      mean(g.map(s => s.dropout_feeling)),
      hours:        mean(g.map(s => Number(s.study_hours))),
      goalRate:     mean(g.map(s => s.goal_achieved ? 100 : 0)),
      distractions: mean(g.map(s => s.distraction_count ?? 0)),
    }
  })
  const longHalf   = Math.floor(weeklyPts.length / 2)
  const longRecent = weeklyPts.slice(longHalf).map(p => p.focus)
  const longOlder  = weeklyPts.slice(0, longHalf).map(p => p.focus)
  const longTrend  = longOlder.length >= 1 ? trendDir(longRecent, longOlder) : 'stable'

  // ── 6. Short-term points (for sparkline) ─────────────────────────────────
  const shortPts: TrendPoint[] = asc.slice(-10).map((s, i) => ({
    label:        `P${s.session_number ?? i + 1}`,
    focus:        s.focus_level,
    dropout:      s.dropout_feeling,
    hours:        Number(s.study_hours),
    goalRate:     s.goal_achieved ? 100 : 0,
    distractions: s.distraction_count ?? 0,
  }))

  // ── 7. Today vs Baseline delta ────────────────────────────────────────────
  const todayVsBaseline = baseline ? {
    focus:   latest.focus_level   - baseline.focus,
    dropout: latest.dropout_feeling - baseline.dropout,
    goalRate: (latest.goal_achieved ? 100 : 0) - baseline.goalRate,
  } : null

  // ── 8. Risk context (contextual, not reactive) ────────────────────────────
  let riskContext: RiskContext = 'normal'
  if (isAnomaly) {
    riskContext = 'anomaly'
  } else if (consecutiveDecline >= 3) {
    riskContext = 'sustained_decline'
  } else if (consecutiveDecline >= 2 || shortTrend === 'down') {
    riskContext = 'short_decline'
  } else if (shortTrend === 'up' || (longTrend === 'up' && shortTrend !== 'down')) {
    riskContext = 'improving'
  }

  // ── 9. Headline & badge ───────────────────────────────────────────────────
  const headlineMap: Record<RiskContext, string> = {
    anomaly:          `Hôm nay có vẻ là một ngày khó — nhưng đây có thể chỉ là ngoại lệ`,
    sustained_decline:`${consecutiveDecline} phiên liên tiếp có dấu hiệu giảm sút — cần chú ý`,
    short_decline:    `Tín hiệu hơi yếu trong vài phiên gần đây, chưa đủ để kết luận`,
    improving:        `Xu hướng cải thiện rõ — bạn đang đi đúng hướng`,
    normal:           `Tiến trình ổn định — tiếp tục duy trì nhịp học tập`,
  }
  const sublineMap: Record<RiskContext, string> = {
    anomaly:          `Lịch sử dài hạn của bạn vẫn ${longTrend === 'up' ? 'tốt và đang cải thiện' : longTrend === 'stable' ? 'ổn định' : 'cần theo dõi thêm'}. Hệ thống sẽ không nâng cảnh báo dựa trên một phiên bất thường đơn lẻ.`,
    sustained_decline:`Khi tín hiệu tiêu cực lặp lại nhiều phiên liên tiếp, đây là thời điểm để xem xét lại chiến lược học tập, không phải tự trách bản thân.`,
    short_decline:    `Hệ thống cần ít nhất 3 phiên tiêu cực liên tiếp để nâng mức cảnh báo. Hiện tại vẫn đang theo dõi.`,
    improving:        `Xu hướng ngắn hạn và dài hạn đều cho thấy tiến bộ. Baseline của bạn đang được cập nhật lên.`,
    normal:           `Các chỉ số trong khoảng bình thường của chính bạn. Không có tín hiệu đáng lo.`,
  }
  const badgeMap: Record<RiskContext, { color: string; label: string }> = {
    anomaly:          { color: '#f59e0b', label: 'Ngoại lệ nhất thời' },
    sustained_decline:{ color: '#f87171', label: 'Cần theo dõi' },
    short_decline:    { color: '#fbbf24', label: 'Hơi chậm lại' },
    improving:        { color: '#34d399', label: 'Đang cải thiện' },
    normal:           { color: '#60a5fa', label: 'Ổn định' },
  }

  return {
    baseline,
    isAnomaly,
    anomalyReason,
    shortTrend,
    longTrend,
    riskContext,
    consecutiveDecline,
    shortPts,
    weeklyPts,
    todayVsBaseline,
    headline:   headlineMap[riskContext],
    subline:    sublineMap[riskContext],
    badgeColor: badgeMap[riskContext].color,
    badgeLabel: badgeMap[riskContext].label,
  }
}

// ─── Mini Sparkline ─────────────────────────────────────────────────────────────
function Sparkline({
  pts, valueKey, color, height = 48, showDots = true, highlight = true,
}: {
  pts: TrendPoint[]
  valueKey: keyof Pick<TrendPoint, 'focus' | 'dropout' | 'hours' | 'goalRate' | 'distractions'>
  color: string
  height?: number
  showDots?: boolean
  highlight?: boolean   // highlight last point
}) {
  if (pts.length < 2) return null
  const vals = pts.map(p => p[valueKey] as number)
  const min = Math.min(...vals)
  const max = Math.max(...vals, min + 0.01)
  const W = 200, H = height, padX = 6, padY = 4
  const toX = (i: number) => padX + (i / (pts.length - 1)) * (W - padX * 2)
  const toY = (v: number) => padY + (1 - (v - min) / (max - min)) * (H - padY * 2)
  const pathD = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${toX(i)} ${toY(p[valueKey] as number)}`).join(' ')
  const areaD = `${pathD} L ${toX(pts.length - 1)} ${H} L ${toX(0)} ${H} Z`
  const gradId = `spk-${valueKey}-${color.replace('#', '')}`
  const last = pts[pts.length - 1]
  const lastY = toY(last[valueKey] as number)
  const lastX = toX(pts.length - 1)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: `${height}px`, overflow: 'visible' }} aria-hidden="true">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={areaD} fill={`url(#${gradId})`} />
      <path d={pathD} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      {showDots && pts.map((p, i) => (
        <circle key={i} cx={toX(i)} cy={toY(p[valueKey] as number)}
          r={highlight && i === pts.length - 1 ? 4.5 : 2}
          fill={highlight && i === pts.length - 1 ? color : `${color}88`}
          stroke={highlight && i === pts.length - 1 ? '#080f26' : 'none'}
          strokeWidth="1.5"
        />
      ))}
    </svg>
  )
}

// ─── Delta Badge ────────────────────────────────────────────────────────────────
function Delta({ val, inverse = false, suffix = '' }: { val: number; inverse?: boolean; suffix?: string }) {
  if (Math.abs(val) < 0.05) return <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: '11px', fontFamily: 'JetBrains Mono, monospace' }}>±0</span>
  const positive = inverse ? val < 0 : val > 0
  const color = positive ? '#34d399' : '#f87171'
  const sign = val > 0 ? '+' : ''
  const display = val % 1 === 0 ? val.toFixed(0) : val.toFixed(1)
  return (
    <span style={{ color, fontSize: '11px', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700 }}>
      {sign}{display}{suffix}
    </span>
  )
}

// ─── Trend Icon ─────────────────────────────────────────────────────────────────
function TrendIcon({ dir, color }: { dir: 'up' | 'down' | 'stable'; color?: string }) {
  const cfg = {
    up:     { icon: '↗', color: color ?? '#34d399' },
    down:   { icon: '↘', color: color ?? '#f87171' },
    stable: { icon: '→', color: color ?? '#64748b' },
  }
  const c = cfg[dir]
  return <span style={{ color: c.color, fontSize: '14px', fontWeight: 700, fontFamily: 'JetBrains Mono, monospace' }}>{c.icon}</span>
}

// ─── Progress Summary Component ─────────────────────────────────────────────────
interface ProgressSummaryProps {
  sessions: SessionRecord[]
  loading?: boolean
}

export default function ProgressSummary({ sessions, loading = false }: ProgressSummaryProps) {
  const [expanded, setExpanded] = useState<'short' | 'long' | 'baseline' | null>(null)

  const analysis = useMemo(() => analyzeProgress(sessions), [sessions])

  if (loading) {
    return (
      <div style={{ padding: '20px', textAlign: 'center' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', color: 'rgba(255,255,255,0.3)', fontFamily: 'Space Grotesk, sans-serif', fontSize: '12px' }}>
          <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#6366f1', animation: 'spkPulse 1s infinite' }} />
          Đang phân tích tiến trình…
        </div>
      </div>
    )
  }
  if (!analysis) {
    return (
      <div style={{ padding: '20px 0', textAlign: 'center', color: 'rgba(255,255,255,0.2)', fontFamily: 'Space Grotesk, sans-serif', fontSize: '12px' }}>
        Cần ít nhất 3 phiên để phân tích tiến trình.
      </div>
    )
  }

  const { baseline, isAnomaly, anomalyReason, shortTrend, longTrend, riskContext,
          consecutiveDecline, shortPts, weeklyPts, todayVsBaseline,
          headline, subline, badgeColor, badgeLabel } = analysis

  const n = sessions.length
  const latest = sessions.length > 0
    ? [...sessions].sort((a, b) => b.session_date.localeCompare(a.session_date) || (b.session_number ?? 0) - (a.session_number ?? 0))[0]
    : null

  // Color helpers
  const shortColor = shortTrend === 'up' ? '#34d399' : shortTrend === 'down' ? '#f87171' : '#64748b'
  const longColor  = longTrend  === 'up' ? '#34d399' : longTrend  === 'down' ? '#f87171' : '#64748b'

  return (
    <div style={{ fontFamily: 'Space Grotesk, sans-serif' }}>

      {/* ── Header card ── */}
      <div style={{
        background: `linear-gradient(135deg, ${badgeColor}14 0%, rgba(255,255,255,0.02) 100%)`,
        border: `1px solid ${badgeColor}30`,
        borderLeft: `3px solid ${badgeColor}`,
        borderRadius: '14px',
        padding: '16px 18px',
        marginBottom: '10px',
      }}>
        {/* Badge + headline */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', marginBottom: '10px' }}>
          <div style={{ flex: 1, minWidth: '200px' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '3px 10px', background: `${badgeColor}20`, border: `1px solid ${badgeColor}40`, borderRadius: '12px', marginBottom: '8px' }}>
              <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: badgeColor, boxShadow: `0 0 6px ${badgeColor}` }} />
              <span style={{ fontSize: '10.5px', fontWeight: 700, color: badgeColor, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{badgeLabel}</span>
            </div>
            <p style={{ margin: 0, fontSize: '13.5px', fontWeight: 700, color: 'rgba(255,255,255,0.92)', lineHeight: 1.5 }}>{headline}</p>
          </div>
          {/* Session count */}
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ fontSize: '22px', fontWeight: 800, color: badgeColor, fontFamily: 'JetBrains Mono, monospace', lineHeight: 1 }}>{n}</div>
            <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)', marginTop: '2px' }}>phiên học</div>
          </div>
        </div>
        <p style={{ margin: 0, fontSize: '12px', color: 'rgba(255,255,255,0.55)', lineHeight: 1.65 }}>{subline}</p>

        {/* Anomaly callout */}
        {isAnomaly && anomalyReason && (
          <div style={{ marginTop: '10px', padding: '8px 12px', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: '8px', display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
            <span style={{ fontSize: '13px', flexShrink: 0 }}>⚡</span>
            <p style={{ margin: 0, fontSize: '11.5px', color: 'rgba(255,255,255,0.65)', lineHeight: 1.55 }}>
              <strong style={{ color: '#fbbf24' }}>Phiên này khác với lịch sử của bạn:</strong> {anomalyReason}. Hệ thống đánh dấu là <em>ngoại lệ nhất thời</em> và sẽ không tính vào đánh giá xu hướng cho đến khi tín hiệu lặp lại.
            </p>
          </div>
        )}

        {/* Consecutive decline warning */}
        {consecutiveDecline >= 3 && !isAnomaly && (
          <div style={{ marginTop: '10px', padding: '8px 12px', background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: '8px', display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
            <span style={{ fontSize: '13px', flexShrink: 0 }}>🔴</span>
            <p style={{ margin: 0, fontSize: '11.5px', color: 'rgba(255,255,255,0.65)', lineHeight: 1.55 }}>
              <strong style={{ color: '#f87171' }}>{consecutiveDecline} phiên liên tiếp</strong> có chỉ số dưới baseline cá nhân — đây là tín hiệu thực sự, không phải ngẫu nhiên. Xem xét báo cáo AI để biết hướng can thiệp.
            </p>
          </div>
        )}
      </div>

      {/* ── Three columns: hôm nay / ngắn hạn / dài hạn ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginBottom: '10px' }}>

        {/* Hôm nay */}
        <div style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '12px', padding: '12px 14px' }}>
          <div style={{ fontSize: '10px', fontWeight: 700, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '10px' }}>📸 Hôm nay</div>
          {latest ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {[
                { label: 'Tập trung', val: latest.focus_level.toFixed(1), sub: '/5', color: '#60a5fa' },
                { label: 'Bỏ cuộc', val: latest.dropout_feeling.toFixed(1), sub: '/5', color: '#f87171' },
                { label: 'Giờ học', val: Number(latest.study_hours).toFixed(1), sub: 'h', color: '#34d399' },
                { label: 'Xao nhãng', val: String(latest.distraction_count ?? 0), sub: ' lần', color: '#f59e0b' },
              ].map(({ label, val, sub, color }) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.45)' }}>{label}</span>
                  <span style={{ fontSize: '12.5px', fontWeight: 700, color, fontFamily: 'JetBrains Mono, monospace' }}>{val}<span style={{ fontSize: '9.5px', fontWeight: 400, color: 'rgba(255,255,255,0.3)' }}>{sub}</span></span>
                </div>
              ))}
              {todayVsBaseline && (
                <div style={{ marginTop: '4px', paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                  <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.25)', marginBottom: '4px' }}>vs baseline cá nhân</div>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                      <span style={{ fontSize: '9.5px', color: 'rgba(255,255,255,0.35)' }}>Focus</span>
                      <Delta val={todayVsBaseline.focus} suffix="/5" />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                      <span style={{ fontSize: '9.5px', color: 'rgba(255,255,255,0.35)' }}>Dropout</span>
                      <Delta val={todayVsBaseline.dropout} inverse suffix="/5" />
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.2)' }}>Chưa có dữ liệu</span>
          )}
        </div>

        {/* Ngắn hạn */}
        <div
          onClick={() => setExpanded(e => e === 'short' ? null : 'short')}
          style={{ background: 'rgba(255,255,255,0.025)', border: `1px solid ${expanded === 'short' ? shortColor + '50' : 'rgba(255,255,255,0.06)'}`, borderRadius: '12px', padding: '12px 14px', cursor: 'pointer', transition: 'border-color 0.2s' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <div style={{ fontSize: '10px', fontWeight: 700, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>📈 3–7 phiên</div>
            <TrendIcon dir={shortTrend} color={shortColor} />
          </div>
          <Sparkline pts={shortPts} valueKey="focus" color={shortColor} height={44} />
          <div style={{ marginTop: '6px', fontSize: '10.5px', color: 'rgba(255,255,255,0.4)', lineHeight: 1.5 }}>
            Tập trung {shortTrend === 'up' ? '↑ cải thiện' : shortTrend === 'down' ? '↓ giảm nhẹ' : '→ ổn định'} · {shortPts.length} phiên
          </div>
          {expanded === 'short' && (
            <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
              {[
                { label: 'Tập trung', key: 'focus' as const, color: '#60a5fa' },
                { label: 'Bỏ cuộc',  key: 'dropout' as const, color: '#f87171' },
                { label: 'Hoàn thành', key: 'goalRate' as const, color: '#34d399' },
              ].map(({ label, key, color }) => {
                const vals = shortPts.map(p => p[key])
                const avg  = mean(vals)
                const first3 = vals.slice(0, Math.ceil(vals.length / 2))
                const last3  = vals.slice(Math.floor(vals.length / 2))
                const dir = trendDir(last3, first3)
                return (
                  <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '5px' }}>
                    <span style={{ fontSize: '10.5px', color: 'rgba(255,255,255,0.4)' }}>{label}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <span style={{ fontSize: '11px', fontWeight: 700, color, fontFamily: 'JetBrains Mono, monospace' }}>{avg.toFixed(1)}</span>
                      <TrendIcon dir={dir} color={dir === 'up' ? '#34d399' : dir === 'down' ? '#f87171' : '#64748b'} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Dài hạn */}
        <div
          onClick={() => setExpanded(e => e === 'long' ? null : 'long')}
          style={{ background: 'rgba(255,255,255,0.025)', border: `1px solid ${expanded === 'long' ? longColor + '50' : 'rgba(255,255,255,0.06)'}`, borderRadius: '12px', padding: '12px 14px', cursor: 'pointer', transition: 'border-color 0.2s' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <div style={{ fontSize: '10px', fontWeight: 700, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>📅 Theo tuần</div>
            <TrendIcon dir={longTrend} color={longColor} />
          </div>
          <Sparkline pts={weeklyPts.length >= 2 ? weeklyPts : shortPts} valueKey="focus" color={longColor} height={44} />
          <div style={{ marginTop: '6px', fontSize: '10.5px', color: 'rgba(255,255,255,0.4)', lineHeight: 1.5 }}>
            {weeklyPts.length >= 2
              ? `${weeklyPts.length} tuần · ${longTrend === 'up' ? 'cải thiện' : longTrend === 'down' ? 'có chiều hướng giảm' : 'ổn định'}`
              : `Chưa đủ dữ liệu tuần (${n} phiên)`}
          </div>
          {expanded === 'long' && weeklyPts.length >= 2 && (
            <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
              {weeklyPts.slice(-4).map((wp, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.35)', fontFamily: 'JetBrains Mono, monospace' }}>{wp.label}</span>
                  <span style={{ fontSize: '10.5px', color: '#60a5fa', fontFamily: 'JetBrains Mono, monospace' }}>{wp.focus.toFixed(1)}<span style={{ color: 'rgba(255,255,255,0.25)', fontSize: '9px' }}>/5</span></span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Baseline card ── */}
      {baseline && (
        <div
          onClick={() => setExpanded(e => e === 'baseline' ? null : 'baseline')}
          style={{ background: 'rgba(255,255,255,0.02)', border: `1px solid ${expanded === 'baseline' ? 'rgba(129,140,248,0.35)' : 'rgba(255,255,255,0.05)'}`, borderLeft: '3px solid #6366f1', borderRadius: '12px', padding: '12px 16px', cursor: 'pointer', transition: 'border-color 0.2s' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '13px' }}>🧮</span>
              <span style={{ fontSize: '11.5px', fontWeight: 700, color: 'rgba(255,255,255,0.7)' }}>Baseline cá nhân</span>
              <span style={{ fontSize: '9.5px', color: 'rgba(255,255,255,0.25)', background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: '6px', padding: '1px 6px' }}>
                n={baseline.sampleSize}
              </span>
            </div>
            <span style={{ fontSize: '9px', color: expanded === 'baseline' ? '#818cf8' : 'rgba(255,255,255,0.2)', display: 'inline-block', transform: expanded === 'baseline' ? 'rotate(180deg)' : 'none', transition: 'all 0.2s' }}>▼</span>
          </div>

          {/* Compact baseline row */}
          <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', marginTop: '10px' }}>
            {[
              { label: 'Focus TB', val: baseline.focus.toFixed(1), sub: '/5', color: '#60a5fa' },
              { label: 'Dropout TB', val: baseline.dropout.toFixed(1), sub: '/5', color: '#f87171' },
              { label: 'Giờ TB', val: baseline.hours.toFixed(1), sub: 'h', color: '#34d399' },
              { label: 'Mục tiêu', val: baseline.goalRate.toFixed(0), sub: '%', color: '#a78bfa' },
            ].map(({ label, val, sub, color }) => (
              <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <span style={{ fontSize: '9.5px', color: 'rgba(255,255,255,0.3)' }}>{label}</span>
                <span style={{ fontSize: '13px', fontWeight: 800, color, fontFamily: 'JetBrains Mono, monospace' }}>{val}<span style={{ fontSize: '9.5px', fontWeight: 400, color: 'rgba(255,255,255,0.3)' }}>{sub}</span></span>
              </div>
            ))}
          </div>

          {/* Expanded explanation */}
          {expanded === 'baseline' && (
            <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
              <p style={{ margin: '0 0 8px', fontSize: '11.5px', color: 'rgba(255,255,255,0.55)', lineHeight: 1.65 }}>
                Baseline được tính từ <strong style={{ color: '#a5b4fc' }}>{baseline.sampleSize} phiên lịch sử</strong>, loại trừ 3 phiên gần nhất để tránh ảnh hưởng từ biến động nhất thời. Hệ thống dùng baseline này để phân biệt "<em>khác bình thường của chính bạn</em>" với "<em>suy giảm thực sự</em>".
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                <div style={{ padding: '8px 10px', background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.12)', borderRadius: '8px' }}>
                  <div style={{ fontSize: '9.5px', color: 'rgba(255,255,255,0.3)', marginBottom: '3px' }}>Độ lệch chuẩn Focus</div>
                  <div style={{ fontSize: '12px', fontWeight: 700, color: '#60a5fa', fontFamily: 'JetBrains Mono, monospace' }}>±{baseline.stdFocus.toFixed(2)}</div>
                  <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.25)', marginTop: '2px' }}>Ngưỡng ngoại lệ: &lt;{(baseline.focus - baseline.stdFocus * 1.5).toFixed(1)}</div>
                </div>
                <div style={{ padding: '8px 10px', background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.12)', borderRadius: '8px' }}>
                  <div style={{ fontSize: '9.5px', color: 'rgba(255,255,255,0.3)', marginBottom: '3px' }}>Ngưỡng cảnh báo</div>
                  <div style={{ fontSize: '12px', fontWeight: 700, color: '#f87171', fontFamily: 'JetBrains Mono, monospace' }}>3 phiên</div>
                  <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.25)', marginTop: '2px' }}>Tín hiệu tiêu cực liên tiếp</div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <style>{`
        @keyframes spkPulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.4;transform:scale(0.7)} }
      `}</style>
    </div>
  )
}
