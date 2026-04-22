import React, { useEffect, useRef, useState } from 'react'
import { AnalysisReport, DailyEntry } from '../types'
import AnalysisReportComponent from './AnalysisReport'

interface Props {
  report: AnalysisReport | null
  analyzing: boolean
  entries: DailyEntry[]          // recent entries for chart data
  onClose: () => void
  theme?: 'dark' | 'light'
}

// ─── Bar Chart ────────────────────────────────────────────────────────────────
interface BarDatum { label: string; value: number; max: number; color: string; gradientFrom: string; gradientTo: string }

function BarChart({ data, title, icon, animDelay = 0 }: {
  data: BarDatum[]
  title: string
  icon: string
  animDelay?: number
}) {
  const [animated, setAnimated] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setAnimated(true), animDelay)
    return () => clearTimeout(t)
  }, [animDelay])

  const maxVal = Math.max(...data.map(d => d.max), 1)

  return (
    <div style={{
      flex: '1 1 240px',
      background: 'linear-gradient(160deg, rgba(255,255,255,0.035) 0%, rgba(255,255,255,0.01) 100%)',
      border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: '20px',
      padding: '24px 20px 20px',
      display: 'flex',
      flexDirection: 'column',
      gap: '0',
      minWidth: 0,
      boxShadow: '0 4px 24px rgba(0,0,0,0.25)',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Glow blob */}
      <div style={{
        position: 'absolute', top: '-30px', right: '-30px',
        width: '120px', height: '120px', borderRadius: '50%',
        background: `radial-gradient(circle, ${data[0]?.gradientFrom ?? '#818cf8'}25 0%, transparent 70%)`,
        pointerEvents: 'none',
      }} />

      {/* Header */}
      <div style={{ marginBottom: '20px' }}>
        <div style={{ fontSize: '22px', marginBottom: '6px' }}>{icon}</div>
        <div style={{
          fontFamily: 'Space Grotesk, sans-serif',
          fontSize: '13px', fontWeight: 700,
          color: 'rgba(255,255,255,0.9)',
          letterSpacing: '0.2px',
        }}>{title}</div>
      </div>

      {/* Bars */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px', height: '160px', flex: 1 }}>
        {data.map((d, i) => {
          const pct = animated ? (d.value / maxVal) * 100 : 0
          const id = `grad-${title.replace(/\s/g,'')}-${i}`
          return (
            <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', height: '100%', justifyContent: 'flex-end' }}>
              {/* Value label on top */}
              <div style={{
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: '13px', fontWeight: 800,
                color: d.color,
                opacity: animated ? 1 : 0,
                transform: animated ? 'translateY(0)' : 'translateY(6px)',
                transition: `opacity 0.4s ${animDelay + 200 + i * 80}ms, transform 0.4s ${animDelay + 200 + i * 80}ms`,
                textShadow: `0 0 12px ${d.color}88`,
              }}>
                {d.value % 1 === 0 ? d.value : d.value.toFixed(1)}
                {d.max === 5 && <span style={{ fontSize: '9px', fontWeight: 400, color: 'rgba(255,255,255,0.4)' }}>/5</span>}
              </div>

              {/* Bar wrapper */}
              <div style={{ width: '100%', height: '130px', display: 'flex', alignItems: 'flex-end', position: 'relative' }}>
                <svg width="0" height="0" style={{ position: 'absolute' }}>
                  <defs>
                    <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={d.gradientFrom} stopOpacity="1" />
                      <stop offset="100%" stopColor={d.gradientTo} stopOpacity="0.5" />
                    </linearGradient>
                  </defs>
                </svg>
                <div style={{
                  width: '100%', borderRadius: '8px 8px 5px 5px',
                  background: `linear-gradient(180deg, ${d.gradientFrom}, ${d.gradientTo}88)`,
                  height: `${pct}%`,
                  minHeight: pct > 0 ? '4px' : '0',
                  transition: `height 0.8s cubic-bezier(0.34, 1.56, 0.64, 1) ${animDelay + i * 100}ms`,
                  boxShadow: `0 0 20px ${d.color}55, 0 -2px 8px ${d.color}40`,
                  position: 'relative',
                }}>
                  {/* Shimmer line on top */}
                  <div style={{
                    position: 'absolute', top: 0, left: 0, right: 0,
                    height: '2px', borderRadius: '2px',
                    background: `linear-gradient(90deg, transparent, ${d.color}, transparent)`,
                    animation: animated ? `shimmer 2s ease-in-out ${i * 0.3}s infinite` : 'none',
                  }} />
                </div>
              </div>

              {/* Session label */}
              <div style={{
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: '10px', color: 'rgba(255,255,255,0.4)',
                whiteSpace: 'nowrap', letterSpacing: '0.3px',
              }}>{d.label}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Risk Banner ──────────────────────────────────────────────────────────────
function RiskBanner({ report }: { report: AnalysisReport | null; analyzing: boolean }) {
  if (!report) return null
  const cfg = {
    'Stable':      { icon: '●', label: 'ỔN ĐỊNH',    color: '#34d399', bg: 'linear-gradient(135deg, #10b981, #34d399)', glow: 'rgba(52,211,153,0.4)' },
    'Fluctuating': { icon: '◐', label: 'DAO ĐỘNG',   color: '#fbbf24', bg: 'linear-gradient(135deg, #d97706, #fbbf24)', glow: 'rgba(251,191,36,0.4)'  },
    'High Risk':   { icon: '▲', label: 'RỦI RO CAO', color: '#f87171', bg: 'linear-gradient(135deg, #dc2626, #f87171)', glow: 'rgba(248,113,113,0.5)' },
  }
  const c = cfg[report.risk_level as keyof typeof cfg] ?? cfg['Fluctuating']
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: '10px',
      background: c.bg, borderRadius: '24px', padding: '10px 24px',
      boxShadow: `0 0 32px ${c.glow}`,
      animation: 'badgePop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) both',
    }}>
      <span style={{ color: '#fff', fontSize: '18px' }}>{c.icon}</span>
      <span style={{ color: '#fff', fontSize: '15px', fontWeight: 800, letterSpacing: '1px', fontFamily: 'Space Grotesk, sans-serif' }}>{c.label}</span>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function ResultSlide({ report, analyzing, entries, onClose, theme = 'dark' }: Props) {
  const [visible, setVisible] = useState(false)
  const reportRef = useRef<HTMLDivElement>(null)

  // Trigger slide-up animation
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 30)
    return () => clearTimeout(t)
  }, [])

  // Lock body scroll while slide is open
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  // Build chart data from last 7 entries (oldest → newest)
  const chartEntries = [...entries].slice(0, 7).reverse()

  const focusData: BarDatum[] = chartEntries.map((e, i) => ({
    label: `S${i + 1}`,
    value: e.focus_level ?? 0,
    max: 5,
    color: '#60a5fa',
    gradientFrom: '#3b82f6',
    gradientTo: '#1d4ed8',
  }))

  const dropoutData: BarDatum[] = chartEntries.map((e, i) => ({
    label: `S${i + 1}`,
    value: e.dropout_feeling ?? 0,
    max: 5,
    color: '#f87171',
    gradientFrom: '#ef4444',
    gradientTo: '#991b1b',
  }))

  const hoursData: BarDatum[] = chartEntries.map((e, i) => ({
    label: `S${i + 1}`,
    value: Number(e.study_hours ?? 0),
    max: Math.max(...chartEntries.map(x => Number(x.study_hours ?? 0)), 1),
    color: '#a78bfa',
    gradientFrom: '#8b5cf6',
    gradientTo: '#5b21b6',
  }))

  const charts = [
    { data: focusData,   title: 'Mức tập trung',    icon: '🎯', delay: 150 },
    { data: hoursData,   title: 'Số giờ học',        icon: '⏱️', delay: 300 },
    { data: dropoutData, title: 'Cảm giác bỏ cuộc', icon: '🚨', delay: 450 },
  ]

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 2000,
      background: 'rgba(2,6,23,0.75)',
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      display: 'flex', alignItems: 'flex-end',
      opacity: visible ? 1 : 0,
      transition: 'opacity 0.3s ease',
    }}>
      {/* Slide-up panel */}
      <div style={{
        width: '100%',
        maxHeight: '94vh',
        background: 'linear-gradient(180deg, #0c1128 0%, #080d1e 100%)',
        borderRadius: '24px 24px 0 0',
        border: '1px solid rgba(255,255,255,0.08)',
        borderBottom: 'none',
        boxShadow: '0 -8px 60px rgba(0,0,0,0.7)',
        transform: visible ? 'translateY(0)' : 'translateY(100%)',
        transition: 'transform 0.5s cubic-bezier(0.32, 0.72, 0, 1)',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}>

        {/* ── Drag handle & header ── */}
        <div style={{ padding: '16px 24px 0', flexShrink: 0 }}>
          {/* Handle */}
          <div style={{ width: '40px', height: '4px', borderRadius: '2px', background: 'rgba(255,255,255,0.15)', margin: '0 auto 16px' }} />

          {/* Header row */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
            <div>
              <div style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: '11px', fontWeight: 600, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '4px' }}>
                📡 LSR Engine · Kết quả phân tích
              </div>
              <RiskBanner report={report} analyzing={analyzing} />
            </div>
            <button
              onClick={onClose}
              aria-label="Đóng"
              style={{
                width: '36px', height: '36px', borderRadius: '50%',
                background: 'rgba(255,255,255,0.08)',
                border: '1px solid rgba(255,255,255,0.12)',
                color: 'rgba(255,255,255,0.7)', fontSize: '18px',
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0, transition: 'all 0.15s',
              }}
            >×</button>
          </div>
        </div>

        {/* ── Scrollable body ── */}
        <div style={{ overflowY: 'auto', flex: 1, padding: '24px 24px 48px' }}>

          {/* ── 3 Bar Charts ── */}
          {chartEntries.length > 0 && (
            <section aria-label="Biểu đồ chỉ số học tập">
              <div style={{
                fontFamily: 'Space Grotesk, sans-serif',
                fontSize: '10px', fontWeight: 700,
                color: 'rgba(255,255,255,0.3)',
                textTransform: 'uppercase', letterSpacing: '1px',
                marginBottom: '14px',
              }}>
                Xu hướng {chartEntries.length} phiên gần nhất
              </div>
              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                {charts.map(c => (
                  <BarChart key={c.title} data={c.data} title={c.title} icon={c.icon} animDelay={c.delay} />
                ))}
              </div>
            </section>
          )}

          {/* ── Divider + scroll hint ── */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: '12px',
            margin: '32px 0 24px',
          }}>
            <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.06)' }} />
            <div style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              padding: '5px 14px',
              background: 'rgba(129,140,248,0.08)',
              border: '1px solid rgba(129,140,248,0.18)',
              borderRadius: '20px',
            }}>
              <span style={{ fontSize: '12px' }}>📡</span>
              <span style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: '11px', fontWeight: 600, color: '#a5b4fc' }}>Báo cáo AI</span>
            </div>
            <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.06)' }} />
          </div>

          {/* ── AI Report ── */}
          <div ref={reportRef}>
            <AnalysisReportComponent report={report} loading={analyzing} />
          </div>

          {/* ── Close button at bottom ── */}
          <div style={{ marginTop: '32px', display: 'flex', justifyContent: 'center' }}>
            <button
              onClick={onClose}
              style={{
                padding: '12px 40px', borderRadius: '14px',
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.12)',
                color: 'rgba(255,255,255,0.7)', fontSize: '14px',
                fontFamily: 'Space Grotesk, sans-serif', fontWeight: 600,
                cursor: 'pointer', transition: 'all 0.15s',
                letterSpacing: '0.2px',
              }}
              onMouseEnter={e => { (e.target as HTMLElement).style.background = 'rgba(255,255,255,0.1)' }}
              onMouseLeave={e => { (e.target as HTMLElement).style.background = 'rgba(255,255,255,0.06)' }}
            >
              ← Quay lại nhập liệu
            </button>
          </div>
        </div>
      </div>

      {/* ── CSS animations ── */}
      <style>{`
        @keyframes badgePop {
          from { transform: scale(0.7); opacity: 0 }
          to   { transform: scale(1);   opacity: 1 }
        }
        @keyframes shimmer {
          0%,100% { opacity: 0.3 }
          50%      { opacity: 1   }
        }
      `}</style>
    </div>
  )
}
