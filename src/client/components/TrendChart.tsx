import React from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, defs, linearGradient, stop, Area, AreaChart } from 'recharts'
import { DailyEntry } from '../types'

interface Props { entries: DailyEntry[]; compact?: boolean }

const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: Array<{ color: string; name: string; value: number }>; label?: string }) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: 'rgba(10,15,35,0.95)',
      backdropFilter: 'blur(12px)',
      border: '1px solid rgba(99,102,241,0.2)',
      borderRadius: '10px', padding: '10px 14px', fontSize: '12px',
      boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
    }}>
      <p style={{ color: '#64748b', marginBottom: '6px', fontWeight: 600, fontFamily: 'Space Grotesk, sans-serif', fontSize: '11px' }}>{label}</p>
      {payload.map(p => (
        <p key={p.name} style={{ color: p.color, margin: '3px 0', fontFamily: 'JetBrains Mono, monospace' }}>
          {p.name}: <strong>{p.value}</strong>
        </p>
      ))}
    </div>
  )
}

export default function TrendChart({ entries, compact }: Props) {
  // Use only the last 7 sessions for the trend chart
  const last7 = entries.slice(-7)
  const data = last7.map(e => ({
    label: `${e.session_date.slice(8, 10)}/${e.session_date.slice(5, 7)} S${e.session_number ?? 1}`,
    'Giờ học':   e.study_hours,
    'Tập trung': e.focus_level,
    'Bỏ cuộc':  e.dropout_feeling,
  }))

  const chartH = compact ? 130 : 220

  if (!data.length) return (
    <div style={{ height: `${chartH}px`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '8px' }}>
      <div style={{ fontSize: compact ? '24px' : '36px', filter: 'grayscale(60%) opacity(0.35)' }}>📊</div>
      {!compact && <p style={{ color: '#1e293b', fontSize: '12px', fontFamily: 'Space Grotesk, sans-serif' }}>Chưa có dữ liệu — nhập phiên học đầu tiên</p>}
    </div>
  )

  const rotate = data.length > 7
  const rotateAngle = compact ? -30 : -40
  const marginBottom = compact ? (rotate ? 28 : 4) : (rotate ? 42 : 5)
  return (
    <ResponsiveContainer width="100%" height={compact ? chartH : (rotate ? 250 : 220)}>
      <LineChart data={data} margin={{ top: 3, right: 6, left: compact ? -28 : -22, bottom: marginBottom }}>
        <defs>
          <linearGradient id="colorHours" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"   stopColor="#6366f1" stopOpacity={0.15} />
            <stop offset="95%"  stopColor="#6366f1" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="colorFocus" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"   stopColor="#34d399" stopOpacity={0.15} />
            <stop offset="95%"  stopColor="#34d399" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fill: '#334155', fontSize: compact ? 7 : 9, fontFamily: 'JetBrains Mono, monospace' }}
          axisLine={{ stroke: 'rgba(255,255,255,0.06)' }}
          tickLine={false}
          angle={rotate ? rotateAngle : 0}
          textAnchor={rotate ? 'end' : 'middle'}
          interval={compact ? 'preserveStartEnd' : 0}
        />
        <YAxis
          domain={[0, 10]}
          tick={{ fill: '#334155', fontSize: compact ? 8 : 10, fontFamily: 'JetBrains Mono, monospace' }}
          axisLine={{ stroke: 'rgba(255,255,255,0.06)' }}
          tickLine={false}
          tickCount={compact ? 3 : 6}
        />
        <Tooltip content={<CustomTooltip />} />
        <Line type="monotone" dataKey="Giờ học"   stroke="#6366f1" strokeWidth={2.5} dot={{ fill: '#6366f1',  r: 3, strokeWidth: 0 }} activeDot={{ r: 5, fill: '#818cf8', stroke: '#6366f1', strokeWidth: 2 }} />
        <Line type="monotone" dataKey="Tập trung" stroke="#34d399" strokeWidth={2.5} dot={{ fill: '#34d399',  r: 3, strokeWidth: 0 }} activeDot={{ r: 5, fill: '#6ee7b7', stroke: '#34d399', strokeWidth: 2 }} />
        <Line type="monotone" dataKey="Bỏ cuộc"   stroke="#f87171" strokeWidth={2}   dot={{ fill: '#f87171',  r: 3, strokeWidth: 0 }} activeDot={{ r: 5, fill: '#fca5a5', stroke: '#f87171', strokeWidth: 2 }} strokeDasharray="5 3" />
      </LineChart>
    </ResponsiveContainer>
  )
}
