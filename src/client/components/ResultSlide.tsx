import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import { AnalysisReport, DailyEntry } from '../types'
import AnalysisReportComponent from './AnalysisReport'

interface Props {
  report: AnalysisReport | null
  analyzing: boolean
  entries: DailyEntry[]
  onClose: () => void
  theme?: 'dark' | 'light'
  authFetch?: (url: string, opts?: RequestInit) => Promise<Response>
}

// ─── Types ─────────────────────────────────────────────────────────────────────
type ViewMode = 'session' | 'week' | 'month'

interface ChartPoint {
  label: string
  subLabel?: string
  focus: number
  dropout: number
  hours: number
  distractions: number
  goalRate: number      // 0–100
  riskLevel: string     // 'Stable'|'Fluctuating'|'High Risk'|''
  count: number
  annotation?: string
}

// ─── Constants ─────────────────────────────────────────────────────────────────
const RISK_COLOR: Record<string, string> = {
  'Stable':      '#34d399',
  'Fluctuating': '#fbbf24',
  'High Risk':   '#f87171',
  '':            '#64748b',
}
const RISK_VI: Record<string, string> = {
  'Stable': 'Ổn định', 'Fluctuating': 'Dao động', 'High Risk': 'Rủi ro cao', '': '—',
}

// ─── Utilities ─────────────────────────────────────────────────────────────────
function fmtDate(iso: string) {
  try { const d = new Date(iso + 'T00:00:00'); return `${d.getDate()}/${d.getMonth() + 1}` }
  catch { return iso }
}

function getWeekKey(iso: string) {
  const d = new Date(iso + 'T00:00:00')
  const jan1 = new Date(d.getFullYear(), 0, 1)
  const week = Math.ceil(((d.getTime() - jan1.getTime()) / 86400000 + jan1.getDay() + 1) / 7)
  return `T${week}/${d.getFullYear().toString().slice(-2)}`
}

function getMonthKey(iso: string) {
  const d = new Date(iso + 'T00:00:00')
  return `Th${d.getMonth() + 1}/${d.getFullYear().toString().slice(-2)}`
}

// Auto-detect annotation events from data patterns
function detectAnnotations(pts: ChartPoint[]): ChartPoint[] {
  return pts.map((pt, i) => {
    if (pt.annotation) return pt
    const prev = pts[i - 1]
    let ann: string | undefined
    if (pt.distractions > 5 && pt.goalRate < 50)                           ann = '⚠️ Xao nhãng cao'
    else if (pt.focus >= 4.5 && pt.goalRate === 100)                       ann = '🌟 Hiệu suất đỉnh'
    else if (prev && pt.hours > prev.hours * 1.5 && pt.focus < prev.focus) ann = '📉 Giờ↑ focus↓'
    else if (prev && pt.dropout > 3.5 && prev.dropout <= 2)               ann = '🔴 Dropout tăng vọt'
    else if (prev && pt.focus - prev.focus >= 1.5)                        ann = '📈 Focus cải thiện'
    else if (pt.riskLevel === 'High Risk')                                  ann = '🚨 Rủi ro cao'
    return ann ? { ...pt, annotation: ann } : pt
  })
}

// ─── Build aggregated data points ──────────────────────────────────────────────
function buildPoints(entries: DailyEntry[], mode: ViewMode, historyEntries?: DailyEntry[]): ChartPoint[] {
  // Merge passed entries with history if available, deduplicate by id
  const allEntries = historyEntries && historyEntries.length > entries.length ? historyEntries : entries
  const asc = [...allEntries].sort((a, b) => {
    const d = a.session_date.localeCompare(b.session_date)
    return d !== 0 ? d : (a.session_number ?? 0) - (b.session_number ?? 0)
  })
  if (asc.length === 0) return []

  if (mode === 'session') {
    const slice = asc.slice(-20)
    return detectAnnotations(slice.map((e, i) => ({
      label: `P${e.session_number ?? i + 1}`,
      subLabel: fmtDate(e.session_date),
      focus: e.focus_level ?? 0,
      dropout: e.dropout_feeling ?? 0,
      hours: Number(e.study_hours ?? 0),
      distractions: e.distraction_count ?? 0,
      goalRate: e.goal_achieved ? 100 : 0,
      riskLevel: '',
      count: 1,
    })))
  }

  const keyFn = mode === 'week' ? getWeekKey : getMonthKey
  const groups: Record<string, DailyEntry[]> = {}
  asc.forEach(e => {
    const k = keyFn(e.session_date)
    if (!groups[k]) groups[k] = []
    groups[k].push(e)
  })

  return detectAnnotations(
    Object.entries(groups).map(([k, grp]) => {
      const n = grp.length
      const avg = (fn: (e: DailyEntry) => number) => grp.reduce((s, e) => s + fn(e), 0) / n
      const goalRate = (grp.filter(e => e.goal_achieved).length / n) * 100
      // Dominant risk for aggregated periods (placeholder — no report data per session in entries list)
      return {
        label: k,
        focus:        avg(e => e.focus_level ?? 0),
        dropout:      avg(e => e.dropout_feeling ?? 0),
        hours:        avg(e => Number(e.study_hours ?? 0)),
        distractions: avg(e => e.distraction_count ?? 0),
        goalRate,
        riskLevel: '',
        count: n,
      }
    })
  )
}

// ─── Insight generator ─────────────────────────────────────────────────────────
function generateInsight(key: 'focus' | 'distractions' | 'goal' | 'dropout', points: ChartPoint[]): string {
  if (points.length < 2) return 'Cần ít nhất 2 điểm dữ liệu để phân tích xu hướng.'
  const n = points.length
  const last = points[points.length - 1]
  const first = points[0]
  const last3 = points.slice(-Math.min(3, n))

  switch (key) {
    case 'focus': {
      const avg = points.reduce((s, p) => s + p.focus, 0) / n
      const trend = last3[last3.length - 1].focus - last3[0].focus
      const corrBad = points.filter(p => p.distractions > 3 && p.focus < 3).length
      const corrGood = points.filter(p => p.distractions <= 2 && p.focus >= 4).length
      let txt = `Tập trung TB: **${avg.toFixed(1)}/5**. `
      txt += trend > 0.5  ? `Xu hướng tăng trong 3 giai đoạn gần nhất (+${trend.toFixed(1)}). ` :
             trend < -0.5 ? `Xu hướng giảm trong 3 giai đoạn gần nhất (${trend.toFixed(1)}). ` :
             'Ổn định trong 3 giai đoạn gần nhất. '
      if (corrBad >= 2) txt += `⚠️ ${corrBad} giai đoạn: xao nhãng cao → tập trung thấp (tương quan rõ rệt).`
      else if (corrGood >= 2) txt += `✅ ${corrGood} giai đoạn: xao nhãng thấp → tập trung cao (môi trường học tập tốt).`
      else txt += 'Chưa thấy tương quan rõ giữa xao nhãng và tập trung.'
      return txt
    }
    case 'distractions': {
      const avg = points.reduce((s, p) => s + p.distractions, 0) / n
      const peak = points.reduce((a, b) => a.distractions > b.distractions ? a : b)
      const highDistrGoalFail = points.filter(p => p.distractions > avg * 1.3 && p.goalRate < 70).length
      const highDistrPts = points.filter(p => p.distractions > avg * 1.3)
      let txt = `Xao nhãng TB: **${avg.toFixed(1)} lần/giai đoạn**. Đỉnh: ${peak.distractions.toFixed(0)} lần (${peak.label}). `
      if (highDistrPts.length > 0) {
        const pct = Math.round(highDistrGoalFail / highDistrPts.length * 100)
        txt += `Khi xao nhãng cao: **${pct}% giai đoạn không đạt mục tiêu** — mối liên hệ trực tiếp.`
      }
      return txt
    }
    case 'goal': {
      const avg = points.reduce((s, p) => s + p.goalRate, 0) / n
      const highFocusGoal = points.filter(p => p.focus >= 4 && p.goalRate === 100).length
      const highDistrFail = points.filter(p => p.distractions > 3 && p.goalRate < 50).length
      let txt = `Tỉ lệ đạt mục tiêu TB: **${avg.toFixed(0)}%**. `
      if (highFocusGoal > 1) txt += `✅ Tập trung ≥4 → đạt 100% mục tiêu trong ${highFocusGoal} giai đoạn. `
      if (highDistrFail > 1) txt += `⚠️ Xao nhãng cao → thất bại mục tiêu trong ${highDistrFail} giai đoạn. `
      txt += avg >= 80 ? 'Hiệu suất tổng thể **tốt**.' :
             avg >= 60 ? 'Hiệu suất **trung bình** — còn nhiều dư địa cải thiện.' :
             'Hiệu suất **thấp** — cần xem lại cách đặt mục tiêu và loại bỏ rào cản.'
      return txt
    }
    case 'dropout': {
      const avg = points.reduce((s, p) => s + p.dropout, 0) / n
      const highDrop = points.filter(p => p.dropout >= 4)
      const afterHeavy = points.filter((p, i) => i > 0 && Number(points[i-1].hours) > p.hours * 1.3 && p.dropout >= 3)
      let txt = `Cảm giác bỏ cuộc TB: **${avg.toFixed(1)}/5**. `
      if (highDrop.length) txt += `🚨 ${highDrop.length} giai đoạn ≥4/5 — ngưỡng nguy hiểm. `
      if (afterHeavy.length) txt += `📉 ${afterHeavy.length} giai đoạn bỏ cuộc tăng sau khi số giờ giảm mạnh → dấu hiệu kiệt sức.`
      else if (avg < 2) txt += '💚 Động lực học tập ổn định, không có dấu hiệu kiệt sức.'
      else txt += 'Mức độ bỏ cuộc chấp nhận được, tiếp tục theo dõi.'
      return txt
    }
  }
}

// ─── Correlation Insight ────────────────────────────────────────────────────────
interface CorrelationItem {
  emoji: string
  text: string
  severity: 'warning' | 'good' | 'neutral'
}

function buildCorrelations(points: ChartPoint[]): CorrelationItem[] {
  if (points.length < 3) return []
  const items: CorrelationItem[] = []
  const n = points.length

  // 1. Distraction↑ → Goal↓
  const distrHighGoalLow = points.filter(p => {
    const avgD = points.reduce((s, x) => s + x.distractions, 0) / n
    return p.distractions > avgD * 1.3 && p.goalRate < 70
  })
  if (distrHighGoalLow.length >= 2) {
    items.push({ emoji: '📱→❌', text: `${distrHighGoalLow.length} giai đoạn xao nhãng tăng → mục tiêu không đạt. Giảm xao nhãng là ưu tiên #1.`, severity: 'warning' })
  }

  // 2. Hours↑ but Focus↓ (overwork pattern)
  const overwork = points.filter((p, i) => {
    if (i === 0) return false
    return p.hours > points[i-1].hours * 1.3 && p.focus < points[i-1].focus - 0.5
  })
  if (overwork.length >= 2) {
    items.push({ emoji: '⏱️→📉', text: `${overwork.length} lần giờ học tăng mạnh nhưng tập trung giảm — dấu hiệu học nhiều nhưng kém hiệu quả.`, severity: 'warning' })
  }

  // 3. Dropout↑ → Risk High (stress cascade)
  const stressCascade = points.filter(p => p.dropout >= 3.5 && p.riskLevel === 'High Risk')
  if (stressCascade.length >= 1) {
    items.push({ emoji: '💔→🚨', text: `Bỏ cuộc cao đi kèm rủi ro cao trong ${stressCascade.length} giai đoạn — can thiệp sớm khi dropout ≥3.5.`, severity: 'warning' })
  }

  // 4. Focus↑ + Goal = 100% (virtuous cycle)
  const virtuous = points.filter(p => p.focus >= 4 && p.goalRate === 100)
  if (virtuous.length >= 2) {
    items.push({ emoji: '🎯→✅', text: `${virtuous.length} giai đoạn tập trung ≥4 đều đạt mục tiêu 100% — duy trì điều kiện này.`, severity: 'good' })
  }

  // 5. Low distraction → High focus (environment quality)
  const cleanEnv = points.filter(p => p.distractions <= 1 && p.focus >= 4)
  if (cleanEnv.length >= 2) {
    items.push({ emoji: '🔇→🎯', text: `${cleanEnv.length} giai đoạn ít xao nhãng → tập trung cao — môi trường học tập sạch có tác động rõ.`, severity: 'good' })
  }

  // 6. Trending down pattern
  const last3focus = points.slice(-3).map(p => p.focus)
  if (last3focus.length === 3 && last3focus[2] < last3focus[1] && last3focus[1] < last3focus[0]) {
    items.push({ emoji: '📉', text: 'Tập trung giảm liên tục 3 giai đoạn gần nhất — cần nghỉ ngơi hoặc thay đổi phương pháp.', severity: 'warning' })
  }

  // Fallback if nothing found
  if (items.length === 0) {
    items.push({ emoji: '📊', text: 'Chưa đủ dữ liệu để phát hiện tương quan rõ rệt giữa các chỉ số. Tiếp tục nhập liệu để hệ thống học.', severity: 'neutral' })
  }

  return items.slice(0, 4) // max 4
}

// ─── SVG Line Chart ─────────────────────────────────────────────────────────────
interface LineChartProps {
  points: ChartPoint[]
  valueKey: keyof Pick<ChartPoint, 'focus' | 'dropout' | 'hours' | 'distractions' | 'goalRate'>
  color: string
  gradFrom: string
  gradTo: string
  maxVal?: number
  minVal?: number
  overlayKey?: keyof Pick<ChartPoint, 'focus' | 'dropout' | 'hours' | 'distractions' | 'goalRate'>
  overlayColor?: string
  overlayLabel?: string
  title: string
  icon: string
  insight: string
  animDelay?: number
  onClick?: () => void
  expanded?: boolean
  suffix?: string
}

function LineChart({
  points, valueKey, color, gradFrom, gradTo,
  maxVal, minVal = 0, overlayKey, overlayColor, overlayLabel,
  title, icon, insight, animDelay = 0, onClick, expanded, suffix = '',
}: LineChartProps) {
  const [animated, setAnimated] = useState(false)
  const [hovered, setHovered] = useState<number | null>(null)
  const svgW = 600, svgH = 150, padX = 12, padY = 18

  useEffect(() => {
    const t = setTimeout(() => setAnimated(true), animDelay + 80)
    return () => clearTimeout(t)
  }, [animDelay])

  const vals = points.map(p => p[valueKey] as number)
  const max = maxVal ?? Math.max(...vals, 1)
  const min = minVal

  const toY = (v: number) => padY + (1 - Math.min(Math.max((v - min) / (max - min), 0), 1)) * (svgH - padY * 2)
  const toX = (i: number) => padX + (i / Math.max(points.length - 1, 1)) * (svgW - padX * 2)

  const makePath = (key: keyof ChartPoint, normMax?: number) => {
    const nMax = normMax ?? max
    return points.map((p, i) => {
      const v = p[key] as number
      const y = padY + (1 - Math.min(Math.max((v - min) / (nMax - min), 0), 1)) * (svgH - padY * 2)
      return i === 0 ? `M ${toX(i)} ${y}` : `L ${toX(i)} ${y}`
    }).join(' ')
  }

  const pathD = makePath(valueKey)
  const areaD = points.length > 0
    ? `${pathD} L ${toX(points.length - 1)} ${svgH} L ${toX(0)} ${svgH} Z` : ''

  const overlayMax = overlayKey ? Math.max(...points.map(p => p[overlayKey!] as number), 1) : 1
  const overlayPathD = overlayKey ? makePath(overlayKey, overlayMax) : null

  const gradId = `g${title.replace(/[^a-z]/gi, '')}`
  const clipId = `c${title.replace(/[^a-z]/gi, '')}`

  // Trend arrow
  const trendVal = points.length >= 2
    ? (points[points.length - 1][valueKey] as number) - (points[points.length - 2][valueKey] as number)
    : 0
  const trendIcon = trendVal > 0.05 ? '↑' : trendVal < -0.05 ? '↓' : '→'
  const trendColor = trendVal > 0.05
    ? (valueKey === 'dropout' || valueKey === 'distractions' ? '#f87171' : '#34d399')
    : trendVal < -0.05
    ? (valueKey === 'dropout' || valueKey === 'distractions' ? '#34d399' : '#f87171')
    : '#64748b'

  return (
    <div
      onClick={onClick}
      style={{
        background: 'linear-gradient(160deg, rgba(255,255,255,0.035) 0%, rgba(255,255,255,0.008) 100%)',
        border: `1px solid ${expanded ? color + '55' : 'rgba(255,255,255,0.06)'}`,
        borderLeft: `3px solid ${color}`,
        borderRadius: '14px',
        padding: '16px 18px',
        cursor: 'pointer',
        transition: 'all 0.22s ease',
        boxShadow: expanded ? `0 0 28px ${color}1a, 0 6px 28px rgba(0,0,0,0.35)` : '0 2px 10px rgba(0,0,0,0.18)',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Ambient glow */}
      <div style={{
        position: 'absolute', top: '-30px', right: '-30px',
        width: '120px', height: '120px', borderRadius: '50%',
        background: `radial-gradient(circle, ${color}12 0%, transparent 70%)`,
        pointerEvents: 'none', opacity: expanded ? 1 : 0.4, transition: 'opacity 0.25s',
      }} />

      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '7px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '14px' }}>{icon}</span>
          <span style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: '12.5px', fontWeight: 700, color: 'rgba(255,255,255,0.9)' }}>{title}</span>
          {overlayKey && overlayColor && (
            <span style={{ fontSize: '9.5px', color: 'rgba(255,255,255,0.35)', fontFamily: 'Space Grotesk, sans-serif', background: `${overlayColor}18`, padding: '1px 6px', borderRadius: '4px', border: `1px solid ${overlayColor}30` }}>
              ⋯ {overlayLabel ?? overlayKey}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
          {points.length > 0 && (
            <>
              <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '14px', fontWeight: 800, color, textShadow: `0 0 10px ${color}88` }}>
                {(() => { const v = points[points.length - 1][valueKey] as number; return v % 1 === 0 ? v : v.toFixed(1) })()}{suffix}
              </span>
              <span style={{ fontSize: '11px', fontWeight: 700, color: trendColor, fontFamily: 'JetBrains Mono, monospace' }}>{trendIcon}</span>
            </>
          )}
          <span style={{ fontSize: '9px', color: expanded ? color : 'rgba(255,255,255,0.2)', display: 'inline-block', transform: expanded ? 'rotate(180deg)' : 'none', transition: 'all 0.2s' }}>▼</span>
        </div>
      </div>

      {/* SVG */}
      <div style={{ position: 'relative' }}>
        <svg viewBox={`0 0 ${svgW} ${svgH}`} style={{ width: '100%', height: '110px', overflow: 'visible' }} aria-hidden="true">
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={gradFrom} stopOpacity="0.45" />
              <stop offset="100%" stopColor={gradTo} stopOpacity="0.03" />
            </linearGradient>
            <clipPath id={clipId}>
              <rect x="0" y="0" width={animated ? svgW : 0} height={svgH}
                style={{ transition: `width 1.4s cubic-bezier(0.4, 0, 0.2, 1) ${animDelay}ms` }} />
            </clipPath>
          </defs>

          {/* Horizontal grid */}
          {[0, 0.33, 0.66, 1].map(f => (
            <line key={f} x1={padX} y1={padY + f * (svgH - padY * 2)} x2={svgW - padX} y2={padY + f * (svgH - padY * 2)}
              stroke="rgba(255,255,255,0.035)" strokeWidth="1" />
          ))}

          {/* Area */}
          {areaD && <path d={areaD} fill={`url(#${gradId})`} clipPath={`url(#${clipId})`} />}

          {/* Overlay dashed */}
          {overlayPathD && (
            <path d={overlayPathD} fill="none" stroke={overlayColor} strokeWidth="1.5"
              strokeDasharray="5 3" strokeOpacity="0.6" clipPath={`url(#${clipId})`} />
          )}

          {/* Main line */}
          <path d={pathD} fill="none" stroke={color} strokeWidth="2.5"
            strokeLinecap="round" strokeLinejoin="round" clipPath={`url(#${clipId})`} />

          {/* Points + annotations + tooltips */}
          {points.map((p, i) => {
            const x = toX(i), y = toY(p[valueKey] as number)
            const isH = hovered === i
            const hasAnn = Boolean(p.annotation)
            const dotR = isH ? 6 : (points.length > 14 ? 2 : 3.5)
            const tipRight = i > points.length * 0.65
            return (
              <g key={i}>
                {hasAnn && (
                  <>
                    <line x1={x} y1={padY - 5} x2={x} y2={y - 9}
                      stroke={color} strokeWidth="1" strokeDasharray="2 2" strokeOpacity="0.4" />
                    <circle cx={x} cy={padY - 7} r="3.5" fill={color} opacity="0.75" />
                  </>
                )}
                <circle cx={x} cy={y} r={dotR} fill={color} stroke="#080f26" strokeWidth="1.5"
                  style={{ transition: 'r 0.12s', cursor: 'pointer', opacity: animated ? 1 : 0 }}
                  onMouseEnter={e => { e.stopPropagation(); setHovered(i) }}
                  onMouseLeave={() => setHovered(null)} />
                {isH && (
                  <g>
                    <rect x={tipRight ? x - 110 : x + 8} y={y - 32} width="102" height={hasAnn ? 50 : 34}
                      rx="7" fill="#10172a" stroke={color} strokeWidth="1" opacity="0.96" />
                    <text x={tipRight ? x - 59 : x + 59} y={y - 16} textAnchor="middle"
                      fill="rgba(255,255,255,0.95)" fontSize="11.5" fontFamily="JetBrains Mono, monospace" fontWeight="700">
                      {(() => { const v = p[valueKey] as number; return v % 1 === 0 ? v : v.toFixed(1) })()}{suffix}
                    </text>
                    {p.subLabel && (
                      <text x={tipRight ? x - 59 : x + 59} y={y - 3} textAnchor="middle"
                        fill="rgba(255,255,255,0.4)" fontSize="9" fontFamily="Space Grotesk, sans-serif">
                        {p.label} · {p.subLabel}
                      </text>
                    )}
                    {hasAnn && (
                      <text x={tipRight ? x - 59 : x + 59} y={y + 12} textAnchor="middle"
                        fill={color} fontSize="8.5" fontFamily="Space Grotesk, sans-serif">{p.annotation}</text>
                    )}
                  </g>
                )}
              </g>
            )
          })}
        </svg>

        {/* X-axis labels */}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '1px', paddingLeft: `${(padX / svgW) * 100}%`, paddingRight: `${(padX / svgW) * 100}%` }}>
          {points.map((p, i) => {
            const step = points.length > 15 ? 4 : points.length > 8 ? 2 : 1
            if (i % step !== 0 && i !== points.length - 1) return null
            return (
              <span key={i} style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '9px', color: 'rgba(255,255,255,0.25)', textAlign: 'center', flex: step > 1 ? undefined : 1, whiteSpace: 'nowrap' }}>
                {p.label}
              </span>
            )
          })}
        </div>
      </div>

      {/* Expanded insight */}
      {expanded && (
        <div style={{
          marginTop: '14px', padding: '12px 14px',
          background: `${color}0c`, border: `1px solid ${color}20`, borderRadius: '10px',
          animation: 'insightIn 0.22s ease both',
        }}>
          <div style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: '10px', fontWeight: 700, color: 'rgba(255,255,255,0.45)', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '6px' }}>
            💬 Diễn giải
          </div>
          <p style={{ color: 'rgba(255,255,255,0.82)', fontSize: '12.5px', lineHeight: 1.7, margin: 0, fontFamily: 'Space Grotesk, sans-serif' }}>
            {insight.split('**').map((seg, i) =>
              i % 2 === 1
                ? <strong key={i} style={{ color, fontWeight: 700 }}>{seg}</strong>
                : <React.Fragment key={i}>{seg}</React.Fragment>
            )}
          </p>
        </div>
      )}
    </div>
  )
}

// ─── Risk Timeline Chart ────────────────────────────────────────────────────────
function RiskTimeline({ points, animDelay = 0, onClick, expanded }: {
  points: ChartPoint[], animDelay?: number, onClick?: () => void, expanded?: boolean
}) {
  const [animated, setAnimated] = useState(false)
  useEffect(() => { const t = setTimeout(() => setAnimated(true), animDelay + 80); return () => clearTimeout(t) }, [animDelay])

  const insight = useMemo(() => {
    if (!points.length) return 'Chưa đủ dữ liệu.'
    const n = points.length
    const high = points.filter(p => p.riskLevel === 'High Risk').length
    const stable = points.filter(p => p.riskLevel === 'Stable').length
    const fluct = n - high - stable
    let maxRun = 0, cur = 0
    points.forEach(p => { if (p.riskLevel === 'High Risk') { cur++; maxRun = Math.max(maxRun, cur) } else cur = 0 })
    let txt = `**${stable}** ổn định · **${fluct}** dao động · **${high}** rủi ro cao (${n} giai đoạn). `
    if (maxRun >= 2) txt += `⚠️ ${maxRun} giai đoạn rủi ro cao liên tiếp — cần can thiệp ngay. `
    if (high === 0) txt += '✅ Không có giai đoạn rủi ro cao — học tập trong tầm kiểm soát.'
    else if (stable > fluct + high) txt += 'Xu hướng chung ổn định, chú ý không để dao động kéo dài.'
    return txt
  }, [points])

  const hasData = points.some(p => p.riskLevel !== '')

  return (
    <div onClick={onClick} style={{
      background: 'linear-gradient(160deg, rgba(255,255,255,0.035) 0%, rgba(255,255,255,0.008) 100%)',
      border: `1px solid ${expanded ? 'rgba(129,140,248,0.45)' : 'rgba(255,255,255,0.06)'}`,
      borderLeft: '3px solid #818cf8',
      borderRadius: '14px', padding: '16px 18px',
      cursor: 'pointer', transition: 'all 0.22s ease',
      boxShadow: expanded ? '0 0 28px rgba(129,140,248,0.12), 0 6px 28px rgba(0,0,0,0.35)' : '0 2px 10px rgba(0,0,0,0.18)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
          <span style={{ fontSize: '14px' }}>🗂️</span>
          <span style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: '12.5px', fontWeight: 700, color: 'rgba(255,255,255,0.9)' }}>Trạng thái rủi ro theo giai đoạn</span>
        </div>
        <span style={{ fontSize: '9px', color: expanded ? '#818cf8' : 'rgba(255,255,255,0.2)', display: 'inline-block', transform: expanded ? 'rotate(180deg)' : 'none', transition: 'all 0.2s' }}>▼</span>
      </div>

      {hasData ? (
        <>
          <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap', marginBottom: '10px' }}>
            {points.map((p, i) => {
              const rc = RISK_COLOR[p.riskLevel] ?? '#64748b'
              return (
                <div key={i} title={`${p.label}: ${RISK_VI[p.riskLevel] ?? '—'}${p.annotation ? ' · ' + p.annotation : ''}`} style={{
                  flex: '1 1 22px', height: '26px', borderRadius: '5px',
                  background: `${rc}${animated ? 'cc' : '00'}`,
                  border: `1px solid ${rc}44`,
                  transition: `background 0.5s ease ${i * 35}ms`,
                  position: 'relative', minWidth: '16px',
                }}>
                  {p.annotation && <div style={{ position: 'absolute', top: '-3px', right: '-3px', width: '6px', height: '6px', borderRadius: '50%', background: '#fff', border: '1.5px solid #080f26' }} />}
                </div>
              )
            })}
          </div>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            {(['Stable', 'Fluctuating', 'High Risk'] as const).map(lvl => {
              const cnt = points.filter(p => p.riskLevel === lvl).length
              if (!cnt) return null
              return (
                <div key={lvl} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <div style={{ width: '9px', height: '9px', borderRadius: '2px', background: RISK_COLOR[lvl] }} />
                  <span style={{ fontSize: '11px', color: RISK_COLOR[lvl], fontFamily: 'Space Grotesk, sans-serif', fontWeight: 600 }}>{RISK_VI[lvl]}</span>
                  <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)', fontFamily: 'JetBrains Mono, monospace' }}>{cnt}</span>
                </div>
              )
            })}
          </div>
        </>
      ) : (
        <div style={{ padding: '12px 0', textAlign: 'center', fontSize: '12px', color: 'rgba(255,255,255,0.25)', fontFamily: 'Space Grotesk, sans-serif' }}>
          Chưa có dữ liệu báo cáo rủi ro. Dữ liệu sẽ tích lũy sau nhiều phiên phân tích AI.
        </div>
      )}

      {expanded && (
        <div style={{ marginTop: '14px', padding: '12px 14px', background: 'rgba(129,140,248,0.07)', border: '1px solid rgba(129,140,248,0.18)', borderRadius: '10px', animation: 'insightIn 0.22s ease both' }}>
          <div style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: '10px', fontWeight: 700, color: 'rgba(255,255,255,0.45)', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '6px' }}>💬 Diễn giải</div>
          <p style={{ color: 'rgba(255,255,255,0.82)', fontSize: '12.5px', lineHeight: 1.7, margin: 0, fontFamily: 'Space Grotesk, sans-serif' }}>
            {insight.split('**').map((seg, i) =>
              i % 2 === 1
                ? <strong key={i} style={{ color: '#a5b4fc', fontWeight: 700 }}>{seg}</strong>
                : <React.Fragment key={i}>{seg}</React.Fragment>
            )}
          </p>
        </div>
      )}
    </div>
  )
}

// ─── Correlation Panel ──────────────────────────────────────────────────────────
function CorrelationPanel({ points }: { points: ChartPoint[] }) {
  const items = useMemo(() => buildCorrelations(points), [points])
  if (items.length === 0) return null

  return (
    <div style={{ marginBottom: '10px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
        <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.04)' }} />
        <span style={{ fontSize: '10px', fontWeight: 700, color: 'rgba(255,255,255,0.35)', fontFamily: 'Space Grotesk, sans-serif', textTransform: 'uppercase', letterSpacing: '0.6px', whiteSpace: 'nowrap' }}>
          🔗 Mối liên hệ giữa các chỉ số
        </span>
        <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.04)' }} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '6px' }}>
        {items.map((item, i) => (
          <div key={i} style={{
            display: 'flex', gap: '8px', alignItems: 'flex-start',
            padding: '10px 12px', borderRadius: '10px',
            background: item.severity === 'warning' ? 'rgba(248,113,113,0.06)' :
                        item.severity === 'good'    ? 'rgba(52,211,153,0.06)' :
                        'rgba(255,255,255,0.03)',
            border: `1px solid ${item.severity === 'warning' ? 'rgba(248,113,113,0.15)' :
                                  item.severity === 'good'    ? 'rgba(52,211,153,0.15)' :
                                  'rgba(255,255,255,0.05)'}`,
          }}>
            <span style={{ fontSize: '13px', flexShrink: 0, marginTop: '1px' }}>{item.emoji}</span>
            <p style={{ margin: 0, fontSize: '11.5px', lineHeight: 1.6, color: 'rgba(255,255,255,0.72)', fontFamily: 'Space Grotesk, sans-serif' }}>{item.text}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Risk Badge ─────────────────────────────────────────────────────────────────
function RiskBanner({ report }: { report: AnalysisReport | null }) {
  if (!report) return null
  const cfg = {
    'Stable':      { icon: '●', label: 'ỔN ĐỊNH',    bg: 'linear-gradient(135deg,#10b981,#34d399)', glow: 'rgba(52,211,153,0.35)' },
    'Fluctuating': { icon: '◐', label: 'DAO ĐỘNG',   bg: 'linear-gradient(135deg,#d97706,#fbbf24)', glow: 'rgba(251,191,36,0.35)' },
    'High Risk':   { icon: '▲', label: 'RỦI RO CAO', bg: 'linear-gradient(135deg,#dc2626,#f87171)', glow: 'rgba(248,113,113,0.45)' },
  }
  const c = cfg[report.risk_level as keyof typeof cfg] ?? cfg['Fluctuating']
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '9px', background: c.bg, borderRadius: '22px', padding: '9px 22px', boxShadow: `0 0 28px ${c.glow}`, animation: 'badgePop 0.45s cubic-bezier(0.34,1.56,0.64,1) both' }}>
      <span style={{ color: '#fff', fontSize: '16px' }}>{c.icon}</span>
      <span style={{ color: '#fff', fontSize: '14px', fontWeight: 800, letterSpacing: '0.8px', fontFamily: 'Space Grotesk, sans-serif' }}>{c.label}</span>
    </div>
  )
}

// ─── Main Component ─────────────────────────────────────────────────────────────
export default function ResultSlide({ report, analyzing, entries, onClose, theme = 'dark', authFetch }: Props) {
  const [visible,     setVisible]     = useState(false)
  const [viewMode,    setViewMode]    = useState<ViewMode>('session')
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null)
  const [historyEntries, setHistoryEntries] = useState<DailyEntry[]>([])

  useEffect(() => { const t = setTimeout(() => setVisible(true), 30); return () => clearTimeout(t) }, [])
  useEffect(() => { document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = '' } }, [])

  // Fetch more history for week/month views
  useEffect(() => {
    if (!authFetch || historyEntries.length > 0) return
    authFetch('/api/entries/history?limit=90').then(r => r.ok ? r.json() : null).then(data => {
      if (data?.sessions) {
        // history returns sessions; convert to DailyEntry shape
        const converted: DailyEntry[] = data.sessions.map((s: any) => ({
          id: s.id, user_id: 0,
          session_date: s.session_date, session_number: s.session_number,
          session_time: s.session_time,
          study_hours: s.study_hours, focus_level: s.focus_level,
          distraction_count: s.distraction_count, distracting_factors: s.distracting_factors,
          goal_achieved: s.goal_achieved, emotional_state: s.emotional_state,
          dropout_feeling: s.dropout_feeling, created_at: s.created_at ?? '',
        }))
        setHistoryEntries(converted)
      }
    }).catch(() => {})
  }, [authFetch])

  const points = useMemo(() => buildPoints(entries, viewMode, historyEntries), [entries, viewMode, historyEntries])

  const riskPoints = useMemo<ChartPoint[]>(() =>
    points.map((p, i) => ({
      ...p,
      riskLevel: i === points.length - 1 && report ? report.risk_level : p.riskLevel,
    })),
    [points, report]
  )

  const toggle = (i: number) => setExpandedIdx(prev => prev === i ? null : i)

  const charts: Array<{ id: string; node: React.ReactNode }> = [
    {
      id: 'focus',
      node: <LineChart key="focus" points={points} valueKey="focus"
        color="#60a5fa" gradFrom="#3b82f6" gradTo="#1e3a8a"
        maxVal={5} minVal={0} suffix="/5"
        overlayKey="dropout" overlayColor="#f87171" overlayLabel="Bỏ cuộc"
        title="Xu hướng tập trung theo thời gian" icon="🎯"
        insight={generateInsight('focus', points)}
        animDelay={80} onClick={() => toggle(0)} expanded={expandedIdx === 0} />,
    },
    {
      id: 'distractions',
      node: <LineChart key="distractions" points={points} valueKey="distractions"
        color="#f59e0b" gradFrom="#d97706" gradTo="#78350f"
        suffix=" lần"
        title="Tần suất xao nhãng" icon="📱"
        insight={generateInsight('distractions', points)}
        animDelay={180} onClick={() => toggle(1)} expanded={expandedIdx === 1} />,
    },
    {
      id: 'goal',
      node: <LineChart key="goal" points={points} valueKey="goalRate"
        color="#34d399" gradFrom="#10b981" gradTo="#064e3b"
        maxVal={100} minVal={0} suffix="%"
        title="Mức độ hoàn thành mục tiêu" icon="✅"
        insight={generateInsight('goal', points)}
        animDelay={280} onClick={() => toggle(2)} expanded={expandedIdx === 2} />,
    },
    {
      id: 'dropout',
      node: <LineChart key="dropout" points={points} valueKey="dropout"
        color="#f87171" gradFrom="#ef4444" gradTo="#7f1d1d"
        maxVal={5} minVal={0} suffix="/5"
        title="Biến động cảm giác bỏ cuộc" icon="💔"
        insight={generateInsight('dropout', points)}
        animDelay={380} onClick={() => toggle(3)} expanded={expandedIdx === 3} />,
    },
    {
      id: 'risk',
      node: <RiskTimeline key="risk" points={riskPoints}
        animDelay={480} onClick={() => toggle(4)} expanded={expandedIdx === 4} />,
    },
  ]

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 2000,
      background: 'rgba(2,6,23,0.82)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
      display: 'flex', alignItems: 'flex-end',
      opacity: visible ? 1 : 0, transition: 'opacity 0.28s ease',
    }}>
      <div style={{
        width: '100%', maxHeight: '94vh',
        background: 'linear-gradient(180deg, #0b1020 0%, #070919 100%)',
        borderRadius: '22px 22px 0 0',
        border: '1px solid rgba(255,255,255,0.07)', borderBottom: 'none',
        boxShadow: '0 -14px 70px rgba(0,0,0,0.75)',
        transform: visible ? 'translateY(0)' : 'translateY(100%)',
        transition: 'transform 0.5s cubic-bezier(0.32,0.72,0,1)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>

        {/* ── Fixed header ── */}
        <div style={{ padding: '12px 18px 12px', flexShrink: 0, borderBottom: '1px solid rgba(255,255,255,0.045)' }}>
          {/* Drag handle */}
          <div style={{ width: '32px', height: '3px', borderRadius: '2px', background: 'rgba(255,255,255,0.1)', margin: '0 auto 12px' }} />

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: '9.5px', fontWeight: 600, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '5px' }}>
                📡 LSR Engine · Kết quả phân tích
              </div>
              {analyzing
                ? <div style={{ display: 'inline-flex', alignItems: 'center', gap: '7px', padding: '7px 16px', background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: '18px' }}>
                    <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#f59e0b', animation: 'aiBlink 1s ease-in-out infinite' }} />
                    <span style={{ color: '#fbbf24', fontSize: '11.5px', fontWeight: 700, fontFamily: 'Space Grotesk, sans-serif' }}>Đang phân tích AI…</span>
                  </div>
                : <RiskBanner report={report} />
              }
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
              {/* View mode */}
              <div style={{ display: 'flex', gap: '2px', background: 'rgba(255,255,255,0.04)', borderRadius: '9px', padding: '3px' }}>
                {([['session', 'Phiên'], ['week', 'Tuần'], ['month', 'Tháng']] as [ViewMode, string][]).map(([m, l]) => (
                  <button key={m} onClick={e => { e.stopPropagation(); setViewMode(m) }} style={{
                    padding: '4px 10px', borderRadius: '6px', border: 'none',
                    background: viewMode === m ? 'rgba(129,140,248,0.22)' : 'transparent',
                    color: viewMode === m ? '#a5b4fc' : 'rgba(255,255,255,0.3)',
                    fontSize: '10.5px', fontWeight: 600, cursor: 'pointer',
                    fontFamily: 'Space Grotesk, sans-serif', transition: 'all 0.14s',
                    boxShadow: viewMode === m ? 'inset 0 0 0 1px rgba(129,140,248,0.25)' : 'none',
                  }}>{l}</button>
                ))}
              </div>
              {/* Close */}
              <button onClick={onClose} aria-label="Đóng" style={{
                width: '32px', height: '32px', borderRadius: '50%', flexShrink: 0,
                background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)',
                color: 'rgba(255,255,255,0.55)', fontSize: '17px', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.14s',
              }}>×</button>
            </div>
          </div>
        </div>

        {/* ── Scrollable body ── */}
        <div style={{ overflowY: 'auto', flex: 1, padding: '16px 18px 44px' }}>

          {/* Info strip */}
          {points.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px', flexWrap: 'wrap' }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '3px 10px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '16px' }}>
                <span style={{ fontSize: '9.5px', color: 'rgba(255,255,255,0.35)', fontFamily: 'Space Grotesk, sans-serif' }}>
                  {viewMode === 'session' ? `${points.length} phiên gần nhất` : viewMode === 'week' ? `${points.length} tuần` : `${points.length} tháng`}
                </span>
              </div>
              <span style={{ fontSize: '9.5px', color: 'rgba(255,255,255,0.2)', fontFamily: 'Space Grotesk, sans-serif' }}>
                Nhấn vào biểu đồ để xem phân tích · ● = sự kiện đặc biệt
              </span>
            </div>
          )}

          {points.length > 0 ? (
            <>
              {/* Correlation panel — shown above charts */}
              <CorrelationPanel points={points} />

              {/* 5 Charts vertical */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {charts.map(c => <React.Fragment key={c.id}>{c.node}</React.Fragment>)}
              </div>
            </>
          ) : (
            <div style={{ textAlign: 'center', padding: '48px 20px', color: 'rgba(255,255,255,0.25)', fontFamily: 'Space Grotesk, sans-serif', fontSize: '13px' }}>
              Chưa có dữ liệu để hiển thị biểu đồ.<br />
              <span style={{ fontSize: '11px', opacity: 0.6 }}>Tiếp tục nhập nhật ký để xem xu hướng.</span>
            </div>
          )}

          {/* AI Report divider */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', margin: '26px 0 20px' }}>
            <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.045)' }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '5px 13px', background: 'rgba(129,140,248,0.07)', border: '1px solid rgba(129,140,248,0.15)', borderRadius: '18px' }}>
              <span style={{ fontSize: '11px' }}>📡</span>
              <span style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: '10.5px', fontWeight: 600, color: '#a5b4fc' }}>Báo cáo AI</span>
            </div>
            <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.045)' }} />
          </div>

          <AnalysisReportComponent report={report} loading={analyzing} />

          <div style={{ marginTop: '26px', display: 'flex', justifyContent: 'center' }}>
            <button onClick={onClose} style={{
              padding: '10px 32px', borderRadius: '11px',
              background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)',
              color: 'rgba(255,255,255,0.5)', fontSize: '12.5px',
              fontFamily: 'Space Grotesk, sans-serif', fontWeight: 600,
              cursor: 'pointer', transition: 'all 0.14s',
            }}
              onMouseEnter={e => { (e.target as HTMLElement).style.background = 'rgba(255,255,255,0.08)' }}
              onMouseLeave={e => { (e.target as HTMLElement).style.background = 'rgba(255,255,255,0.04)' }}
            >← Quay lại nhập liệu</button>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes badgePop   { from { transform: scale(0.65); opacity: 0 } to { transform: scale(1); opacity: 1 } }
        @keyframes aiBlink    { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.3;transform:scale(0.6)} }
        @keyframes insightIn  { from { opacity: 0; transform: translateY(-5px) } to { opacity: 1; transform: translateY(0) } }
      `}</style>
    </div>
  )
}
