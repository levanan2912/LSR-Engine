import React, { useState, useImperativeHandle, forwardRef, useRef, useCallback } from 'react'
import { EntryFormData } from '../types'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EntryFormRef {
  reset: () => void
}

interface EntryFormProps {
  onSubmit: (data: EntryFormData) => Promise<void>
  loading: boolean
}

type FieldErrors = Partial<Record<keyof EntryFormData, string>>

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_FORM: EntryFormData = {
  study_hours: 0,
  focus_level: 3,
  distraction_count: 0,
  distracting_factors: '',
  goal_achieved: false,
  emotional_state: '',
  dropout_feeling: 1,
}

const EMOTION_PRESETS = [
  'Tập trung cao', 'Có động lực', 'Tự tin', 'Bình tĩnh',
  'Mệt mỏi', 'Lo lắng', 'Căng thẳng', 'Bối rối',
]

const FOCUS_EMOJIS   = ['', '😴', '😑', '🙂', '😊', '🔥']
const DROPOUT_EMOJIS = ['', '💪', '😐', '😩', '😰', '🚨']

const TOOLTIP_DATA: Record<string, { title: string; body: string; example: string; note?: string }> = {
  study_hours: {
    title: '⏰ Thời gian học thực tế',
    body: 'Số giờ bạn thực sự ngồi học, không tính lúc nghỉ giải lao hay bấm điện thoại nhé!',
    example: 'VD: Học 8h–10h30 (nghỉ 15p) → nhập 2.25h',
  },
  focus_level: {
    title: '🎯 Mức độ tập trung',
    body: "Đánh giá độ 'cuốn' vào bài học hôm nay của bạn một cách thành thật nhất",
    example: '😴 1 = buồn ngủ  |  🔥 5 = tập trung 100%',
  },
  distraction_count: {
    title: '📱 Số lần mất tập trung',
    body: 'Mỗi lần dừng học để làm việc khác đều tính là 1 lần',
    example: 'VD: Check phone 3 lần + TikTok 2 lần = 5',
  },
  distracting_factors: {
    title: '🔍 Thủ phạm làm mất tập trung',
    body: 'Kể tên những thứ đã cướp mất sự chú ý của bạn hôm nay',
    example: 'VD: Điện thoại, tiếng ồn, Facebook...',
    note: '💡 Để trống nếu hôm nay tập trung tốt',
  },
  goal_achieved: {
    title: '🎯 Hoàn thành mục tiêu học tập',
    body: 'Bạn có làm xong những gì đã lên kế hoạch từ đầu phiên học không?',
    example: '✅ Đạt = xong việc đã định  |  ❌ Chưa = còn dang dở',
  },
  emotional_state: {
    title: '💭 Tâm trạng trong phiên học',
    body: 'Cảm xúc của bạn lúc học thế nào? AI dùng thông tin này để hiểu hành vi học tập tốt hơn',
    example: 'VD: Hứng khởi, mệt mỏi, căng thẳng...',
    note: '💡 Tùy chọn, có thể để trống',
  },
  dropout_feeling: {
    title: '🚨 Cảm giác muốn bỏ cuộc',
    body: 'Mức độ bạn muốn dừng học và làm việc khác',
    example: '💪 1 = tràn đầy năng lượng  |  🚨 5 = muốn nghỉ ngay',
  },
}

// ─── Validation ───────────────────────────────────────────────────────────────

function validate(data: EntryFormData): FieldErrors {
  const errors: FieldErrors = {}

  if (data.study_hours === null || data.study_hours === undefined || String(data.study_hours) === '') {
    errors.study_hours = 'Bắt buộc nhập'
  } else if (data.study_hours <= 0) {
    errors.study_hours = 'Phải lớn hơn 0'
  } else if (data.study_hours > 24) {
    errors.study_hours = 'Không vượt quá 24 giờ'
  } else if (data.study_hours !== Math.round(data.study_hours * 4) / 4) {
    errors.study_hours = 'Bội số 0.25 (vd: 1.25, 2.5)'
  }

  if (data.distraction_count < 0) {
    errors.distraction_count = 'Không được âm'
  } else if (!Number.isInteger(data.distraction_count)) {
    errors.distraction_count = 'Phải là số nguyên'
  } else if (data.distraction_count > 9999) {
    errors.distraction_count = 'Tối đa 9999'
  }

  if (data.distracting_factors.length > 500) {
    errors.distracting_factors = `Quá dài (${data.distracting_factors.length}/500)`
  }

  if (data.emotional_state.length > 200) {
    errors.emotional_state = `Quá dài (${data.emotional_state.length}/200)`
  }

  return errors
}

// ─── Tooltip Component ────────────────────────────────────────────────────────

function Tooltip({ field }: { field: keyof typeof TOOLTIP_DATA }) {
  const [visible, setVisible] = useState(false)
  const data = TOOLTIP_DATA[field]
  if (!data) return null

  return (
    <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      <button
        type="button"
        onMouseEnter={() => setVisible(true)}
        onMouseLeave={() => setVisible(false)}
        onClick={() => setVisible(v => !v)}
        onBlur={() => setVisible(false)}
        onFocus={() => setVisible(true)}
        aria-label="Thông tin"
        style={{
          width: '14px', height: '14px', borderRadius: '50%',
          border: '1px solid rgba(99,102,241,0.35)',
          background: 'rgba(99,102,241,0.08)',
          color: 'rgba(165,180,252,0.65)',
          fontSize: '8px', fontWeight: 700,
          cursor: 'pointer', display: 'inline-flex',
          alignItems: 'center', justifyContent: 'center',
          transition: 'all 0.2s', flexShrink: 0,
          lineHeight: 1, outline: 'none',
        }}
      >?</button>
      {visible && (
        <div style={{
          position: 'absolute', left: '16px', top: '-8px',
          zIndex: 1000, minWidth: '210px', maxWidth: '250px',
          background: 'rgba(10,12,30,0.97)',
          backdropFilter: 'blur(12px)',
          border: '1px solid rgba(99,102,241,0.3)',
          borderRadius: '12px', padding: '9px 11px',
          boxShadow: '0 16px 32px rgba(0,0,0,0.5)',
          animation: 'tooltipIn 0.15s ease',
          pointerEvents: 'none',
        }}>
          <div style={{ fontFamily: 'Space Grotesk, sans-serif', fontWeight: 700, fontSize: '11px', color: '#a5b4fc', marginBottom: '4px' }}>{data.title}</div>
          <div style={{ fontSize: '10px', color: '#94a3b8', lineHeight: 1.5, marginBottom: '4px' }}>{data.body}</div>
          <div style={{ fontSize: '10px', color: '#6366f1', background: 'rgba(99,102,241,0.1)', borderRadius: '5px', padding: '3px 6px', fontFamily: 'JetBrains Mono, monospace', lineHeight: 1.4 }}>{data.example}</div>
          {data.note && <div style={{ fontSize: '9px', color: '#475569', marginTop: '4px', fontStyle: 'italic' }}>{data.note}</div>}
        </div>
      )}
    </span>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function FieldError({ msg }: { msg?: string }) {
  if (!msg) return null
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '3px', marginTop: '2px', animation: 'errorSlide 0.2s ease' }}>
      <span style={{ color: '#f87171', fontSize: '9px' }}>●</span>
      <span style={{ color: '#f87171', fontSize: '9px' }}>{msg}</span>
    </div>
  )
}

function FieldWrap({ children, error }: { children: React.ReactNode; error?: string }) {
  return <div>{children}<FieldError msg={error} /></div>
}

// ─── Label with Tooltip ───────────────────────────────────────────────────────

function Label({ text, field, required }: { text: string; field: keyof typeof TOOLTIP_DATA; required?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '5px' }}>
      <span style={{
        fontFamily: 'Space Grotesk, sans-serif', fontWeight: 600, fontSize: '10px',
        color: '#818cf8', textTransform: 'uppercase', letterSpacing: '0.4px',
      }}>{text}</span>
      {required && <span style={{ color: '#f87171', fontSize: '9px' }}>*</span>}
      <Tooltip field={field} />
    </div>
  )
}

// ─── Compact Stepper with inline direct-edit input ────────────────────────────
//   Fixed outer width so layout never shifts when value changes digit count.

interface StepperProps {
  value: number
  step: number
  min: number
  max: number
  decimals?: number
  suffix: string
  onChange: (v: number) => void
  onBlur: () => void
  error?: boolean
}

function Stepper({ value, step, min, max, decimals = 0, suffix, onChange, onBlur, error }: StepperProps) {
  const [inputStr, setInputStr] = useState('')
  const [editing, setEditing] = useState(false)

  // Display: when editing show raw string; otherwise show clean number
  const cleanDisplay = decimals > 0
    ? (value === 0 ? '0' : String(Math.round(value * 10000) / 10000))
    : String(value)

  const displayed = editing ? inputStr : cleanDisplay

  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v / step) * step))
  const roundTo = (v: number) => Math.round(v * 10000) / 10000

  const decrement = () => { onChange(roundTo(clamp(value - step))); onBlur() }
  const increment = () => { onChange(roundTo(clamp(value + step))); onBlur() }

  const handleFocus = () => {
    setEditing(true)
    setInputStr(value === 0 ? '' : cleanDisplay)
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Allow only digits, single dot, and leading minus
    const raw = e.target.value
    if (/^-?\d*\.?\d*$/.test(raw) || raw === '') {
      setInputStr(raw)
    }
  }

  const handleBlur = () => {
    setEditing(false)
    const parsed = parseFloat(inputStr)
    if (!isNaN(parsed)) {
      onChange(roundTo(clamp(parsed)))
    }
    onBlur()
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur() }
    if (e.key === 'ArrowUp')   { e.preventDefault(); onChange(roundTo(clamp(value + step))); onBlur() }
    if (e.key === 'ArrowDown') { e.preventDefault(); onChange(roundTo(clamp(value - step))); onBlur() }
  }

  const btnStyle = (disabled: boolean): React.CSSProperties => ({
    width: '26px', height: '26px', borderRadius: '50%', flexShrink: 0,
    border: '1px solid var(--border)',
    background: disabled ? 'transparent' : 'var(--bg-row)',
    color: disabled ? 'var(--text-faint)' : 'var(--text-secondary)',
    fontSize: '15px', fontWeight: 300, cursor: disabled ? 'not-allowed' : 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    transition: 'all 0.15s', lineHeight: 1,
  })

  return (
    // Outer div has a fixed width so it never shifts regardless of value length
    <div style={{ display: 'flex', alignItems: 'center', gap: '5px', width: '100%' }}>
      <button type="button" onClick={decrement} disabled={value <= min} style={btnStyle(value <= min)}>−</button>

      {/* The input+suffix wrapper is flex-1 with a min-width, centering contents */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', minWidth: 0 }}>
        <input
          type="text"
          inputMode="decimal"
          value={displayed}
          onFocus={handleFocus}
          onChange={handleChange}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          style={{
            /* Fixed width prevents any layout shift */
            width: '64px',
            textAlign: 'center',
            background: error ? 'rgba(248,113,113,0.06)' : 'var(--bg-input)',
            border: `1px solid ${error ? 'rgba(248,113,113,0.4)' : 'var(--border-input)'}`,
            borderRadius: '8px', padding: '4px 6px',
            color: error ? '#f87171' : 'var(--text-primary)',
            fontSize: '18px', fontWeight: 700,
            fontFamily: 'JetBrains Mono, monospace',
            outline: 'none', boxSizing: 'border-box',
            transition: 'border-color 0.2s',
          }}
        />
        <span style={{ fontSize: '10px', color: 'var(--text-faint)', fontWeight: 500, flexShrink: 0, minWidth: '20px' }}>{suffix}</span>
      </div>

      <button type="button" onClick={increment} disabled={value >= max} style={btnStyle(value >= max)}>+</button>
    </div>
  )
}

// ─── Compact Emoji Slider ─────────────────────────────────────────────────────

interface EmojiSliderProps {
  value: number
  min: number
  max: number
  emojis: string[]
  accentColor: string
  gradientFrom: string
  gradientTo: string
  onChange: (v: number) => void
}

function EmojiSlider({ value, min, max, emojis, accentColor, gradientFrom, gradientTo, onChange }: EmojiSliderProps) {
  const pct = ((value - min) / (max - min)) * 100
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
      <span style={{ fontSize: value === min ? '14px' : '11px', filter: value === min ? undefined : 'grayscale(70%) opacity(0.5)', transition: 'all 0.15s', flexShrink: 0 }}>{emojis[min]}</span>
      <div style={{ flex: 1, position: 'relative' }}>
        <div style={{ position: 'absolute', top: '50%', transform: 'translateY(-50%)', left: 0, right: 0, height: '4px', borderRadius: '999px', background: `linear-gradient(to right, ${gradientFrom} 0%, ${gradientTo} 100%)`, opacity: 0.2 }} />
        <div style={{ position: 'absolute', top: '50%', transform: 'translateY(-50%)', left: 0, height: '4px', borderRadius: '999px', background: `linear-gradient(to right, ${gradientFrom}, ${gradientTo})`, width: `${pct}%`, transition: 'width 0.1s', boxShadow: `0 0 5px ${accentColor}60` }} />
        <input
          type="range" min={min} max={max} step="1" value={value}
          onChange={e => onChange(parseInt(e.target.value))}
          style={{ position: 'relative', width: '100%', height: '18px', appearance: 'none', background: 'transparent', cursor: 'pointer', zIndex: 2 }}
        />
      </div>
      <span style={{ fontSize: value === max ? '14px' : '11px', filter: value === max ? undefined : 'grayscale(70%) opacity(0.5)', transition: 'all 0.15s', flexShrink: 0 }}>{emojis[max]}</span>
      <span style={{
        minWidth: '28px', textAlign: 'center',
        fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', fontWeight: 700,
        color: accentColor, background: `${accentColor}18`,
        border: `1px solid ${accentColor}30`, borderRadius: '20px', padding: '1px 6px',
        flexShrink: 0,
      }}>{value}</span>
      <span style={{ fontSize: '16px', minWidth: '20px', textAlign: 'center', transition: 'all 0.15s' }}>{emojis[value]}</span>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

const EntryForm = forwardRef<EntryFormRef, EntryFormProps>(({ onSubmit, loading }, ref) => {
  const [formData, setFormData] = useState<EntryFormData>(DEFAULT_FORM)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [touched, setTouched] = useState<Partial<Record<keyof EntryFormData, boolean>>>({})
  const [submitAttempted, setSubmitAttempted] = useState(false)
  const isSubmittingRef = useRef(false)

  useImperativeHandle(ref, () => ({
    reset() {
      setFormData(DEFAULT_FORM)
      setErrors({})
      setTouched({})
      setSubmitAttempted(false)
    },
  }))

  const touch = useCallback((field: keyof EntryFormData) =>
    setTouched(p => ({ ...p, [field]: true })), [])

  const update = useCallback(<K extends keyof EntryFormData>(field: K, value: EntryFormData[K]) => {
    const next = { ...formData, [field]: value }
    setFormData(next)
    if (touched[field] || submitAttempted) setErrors(validate(next))
  }, [formData, touched, submitAttempted])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isSubmittingRef.current || loading) return
    setSubmitAttempted(true)
    setTouched({ study_hours: true, focus_level: true, distraction_count: true, distracting_factors: true, emotional_state: true, goal_achieved: true, dropout_feeling: true })
    const errs = validate(formData)
    setErrors(errs)
    if (Object.keys(errs).length > 0) return
    isSubmittingRef.current = true
    try { await onSubmit(formData) }
    finally { isSubmittingRef.current = false }
  }

  const showErr = (field: keyof EntryFormData) =>
    (touched[field] || submitAttempted) ? errors[field] : undefined

  const hasErrors = Object.keys(errors).length > 0 && submitAttempted

  const focusColor   = formData.focus_level   >= 4 ? '#34d399' : formData.focus_level   >= 3 ? '#fbbf24' : '#f87171'
  const dropoutColor = formData.dropout_feeling >= 4 ? '#f87171' : formData.dropout_feeling >= 3 ? '#f59e0b' : '#34d399'

  const inputStyle = (err?: string): React.CSSProperties => ({
    width: '100%', padding: '5px 10px',
    background: 'var(--bg-input)',
    border: `1px solid ${err ? 'rgba(248,113,113,0.5)' : 'var(--border-input)'}`,
    borderRadius: '8px', color: 'var(--text-primary)',
    fontSize: '12px', outline: 'none',
    boxSizing: 'border-box', fontFamily: 'Inter, sans-serif',
    transition: 'border-color 0.2s',
  })

  // Shared card style — uses CSS variables so it adapts to light/dark
  const card: React.CSSProperties = {
    background: 'var(--bg-card)',
    border: '1px solid var(--border-card)',
    borderRadius: '10px', padding: '8px 10px',
  }

  return (
    <>
      <style>{`
        @keyframes errorSlide { from{opacity:0;transform:translateY(-3px)} to{opacity:1;transform:translateY(0)} }
        @keyframes spin        { to{transform:rotate(360deg)} }
        @keyframes tooltipIn   { from{opacity:0;transform:scale(0.93) translateY(-3px)} to{opacity:1;transform:scale(1) translateY(0)} }
        @keyframes dotsLoading { 0%,80%,100%{opacity:.3;transform:scale(.8)} 40%{opacity:1;transform:scale(1)} }
        input[type=range] { -webkit-appearance:none; appearance:none; background:transparent; }
        input[type=range]::-webkit-slider-thumb {
          -webkit-appearance:none; appearance:none;
          width:16px; height:16px; border-radius:50%;
          background:white; cursor:pointer;
          box-shadow:0 2px 5px rgba(0,0,0,0.3);
          border:2px solid rgba(255,255,255,0.15);
          transition:box-shadow 0.2s, transform 0.15s;
        }
        input[type=range]::-webkit-slider-thumb:hover {
          box-shadow:0 0 0 5px rgba(99,102,241,0.15),0 2px 5px rgba(0,0,0,0.3);
          transform:scale(1.1);
        }
        input[type=range]::-moz-range-thumb {
          width:16px;height:16px;border-radius:50%;background:white;cursor:pointer;border:2px solid rgba(255,255,255,0.15);
        }
        textarea{resize:none;}
        textarea::placeholder,input::placeholder{color:var(--text-placeholder, #64748b) !important;}
      `}</style>

      <form onSubmit={handleSubmit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>

        {/* Row 1: Study Hours + Distraction Count — side by side */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '7px' }}>

          <div style={card}>
            <Label text="Số giờ học" field="study_hours" required />
            <FieldWrap error={showErr('study_hours')}>
              <Stepper
                value={formData.study_hours}
                step={0.25} min={0} max={24} decimals={2}
                suffix="giờ"
                onChange={v => update('study_hours', v)}
                onBlur={() => touch('study_hours')}
                error={!!showErr('study_hours')}
              />
            </FieldWrap>
          </div>

          <div style={card}>
            <Label text="📱 Số lần mất tập trung" field="distraction_count" />
            <FieldWrap error={showErr('distraction_count')}>
              <Stepper
                value={formData.distraction_count}
                step={1} min={0} max={9999} decimals={0}
                suffix="lần"
                onChange={v => update('distraction_count', v)}
                onBlur={() => touch('distraction_count')}
                error={!!showErr('distraction_count')}
              />
            </FieldWrap>
          </div>
        </div>

        {/* Row 2: Focus Level */}
        <div style={card}>
          <Label text="🎯 Mức tập trung" field="focus_level" />
          <EmojiSlider
            value={formData.focus_level} min={1} max={5}
            emojis={FOCUS_EMOJIS} accentColor={focusColor}
            gradientFrom="#f87171" gradientTo="#34d399"
            onChange={v => update('focus_level', v)}
          />
        </div>

        {/* Row 3: Dropout Feeling */}
        <div style={card}>
          <Label text="🚨 Cảm giác bỏ cuộc" field="dropout_feeling" />
          <EmojiSlider
            value={formData.dropout_feeling} min={1} max={5}
            emojis={DROPOUT_EMOJIS} accentColor={dropoutColor}
            gradientFrom="#34d399" gradientTo="#f87171"
            onChange={v => update('dropout_feeling', v)}
          />
        </div>

        {/* Row 4: Goal Achieved */}
        <div style={card}>
          <Label text="🏆 Đạt mục tiêu?" field="goal_achieved" required />
          <div style={{ display: 'flex', gap: '6px' }}>
            {([true, false] as const).map(val => {
              const active = formData.goal_achieved === val
              return (
                <button
                  key={String(val)} type="button"
                  onClick={() => update('goal_achieved', val)}
                  style={{
                    flex: 1, padding: '6px 4px', borderRadius: '8px',
                    border: `1px solid ${active ? (val ? 'rgba(52,211,153,0.45)' : 'rgba(248,113,113,0.45)') : 'var(--border-card)'}`,
                    background: active ? (val ? 'rgba(52,211,153,0.1)' : 'rgba(248,113,113,0.1)') : 'var(--bg-input)',
                    color: active ? (val ? '#34d399' : '#f87171') : 'var(--text-muted)',
                    fontSize: '12px', fontWeight: 700, cursor: 'pointer',
                    transition: 'all 0.15s', fontFamily: 'Space Grotesk, sans-serif',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px',
                    boxShadow: active ? `0 0 10px ${val ? 'rgba(52,211,153,0.1)' : 'rgba(248,113,113,0.1)'}` : 'none',
                  }}
                >
                  <span style={{ fontSize: '13px' }}>{val ? '✅' : '❌'}</span>
                  {val ? 'Đạt' : 'Chưa đạt'}
                </button>
              )
            })}
          </div>
        </div>

        {/* Row 5: Distracting Factors */}
        <div style={card}>
          <Label text="🔍 Nguyên nhân xao nhãng" field="distracting_factors" />
          <FieldWrap error={showErr('distracting_factors')}>
            <textarea
              value={formData.distracting_factors}
              placeholder="vd: Mạng xã hội, tiếng ồn, điện thoại..."
              maxLength={501} rows={1}
              onBlur={() => touch('distracting_factors')}
              onChange={e => update('distracting_factors', e.target.value)}
              style={{ ...inputStyle(showErr('distracting_factors')), lineHeight: '1.5', minHeight: '30px' }}
            />
          </FieldWrap>
        </div>

        {/* Row 6: Emotional State */}
        <div style={card}>
          <Label text="💭 Tâm trạng lúc học" field="emotional_state" />
          <FieldWrap error={showErr('emotional_state')}>
            <input
              type="text"
              value={formData.emotional_state}
              placeholder="Bạn đang cảm thấy thế nào hôm nay?"
              maxLength={201}
              onBlur={() => touch('emotional_state')}
              onChange={e => update('emotional_state', e.target.value)}
              style={inputStyle(showErr('emotional_state'))}
            />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', marginTop: '5px' }}>
              {EMOTION_PRESETS.map(preset => {
                const tokens = formData.emotional_state.split(',').map(t => t.trim()).filter(Boolean)
                const active = tokens.includes(preset)
                return (
                  <button
                    key={preset} type="button"
                    onClick={() => {
                      if (active) update('emotional_state', tokens.filter(t => t !== preset).join(', '))
                      else {
                        const cur = formData.emotional_state.trim()
                        update('emotional_state', cur ? `${cur}, ${preset}` : preset)
                      }
                    }}
                    style={{
                      padding: '2px 7px', borderRadius: '20px',
                      border: `1px solid ${active ? 'rgba(99,102,241,0.4)' : 'var(--border-card)'}`,
                      background: active ? 'rgba(99,102,241,0.12)' : 'var(--bg-input)',
                      color: active ? '#818cf8' : 'var(--text-secondary)',
                      fontSize: '10px', fontWeight: 500, cursor: 'pointer',
                      transition: 'all 0.15s',
                    }}
                  >{preset}</button>
                )
              })}
            </div>
          </FieldWrap>
        </div>

        {/* Validation Summary */}
        {hasErrors && (
          <div style={{
            background: 'rgba(248,113,113,0.06)', border: '1px solid rgba(248,113,113,0.2)',
            borderRadius: '8px', padding: '6px 10px', animation: 'errorSlide 0.2s ease',
          }}>
            <div style={{ color: '#f87171', fontSize: '9px', fontWeight: 700, fontFamily: 'Space Grotesk, sans-serif', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '3px' }}>✕ Vui lòng sửa lỗi</div>
            {Object.values(errors).map((msg, i) => (
              <div key={i} style={{ color: '#fca5a5', fontSize: '10px', lineHeight: '1.5' }}>• {msg}</div>
            ))}
          </div>
        )}

        {/* Submit Button */}
        <button
          type="submit"
          disabled={loading}
          style={{
            width: '100%', padding: '10px 16px',
            background: loading ? 'rgba(99,102,241,0.12)' : hasErrors ? 'rgba(248,113,113,0.12)' : 'linear-gradient(135deg, #3b82f6 0%, #6366f1 50%, #a855f7 100%)',
            border: hasErrors ? '1px solid rgba(248,113,113,0.25)' : loading ? '1px solid rgba(99,102,241,0.2)' : 'none',
            borderRadius: '10px', color: '#ffffff',
            fontSize: '13px', fontWeight: 700,
            cursor: loading ? 'not-allowed' : 'pointer',
            fontFamily: 'Space Grotesk, sans-serif',
            boxShadow: loading || hasErrors ? 'none' : '0 0 18px rgba(99,102,241,0.25)',
            transition: 'all 0.2s',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
          }}
        >
          {loading ? (
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              🧠 <span>Đang phân tích...</span>
              <span style={{ display: 'flex', gap: '3px' }}>
                {[0, 0.15, 0.3].map((d, i) => (
                  <span key={i} style={{ display: 'inline-block', width: '3px', height: '3px', borderRadius: '50%', background: '#a5b4fc', animation: `dotsLoading 1.2s ease-in-out ${d}s infinite` }} />
                ))}
              </span>
            </span>
          ) : hasErrors ? <>✕ Sửa lỗi ở trên</> : <>⚡ Phân tích bằng AI</>}
        </button>

      </form>
    </>
  )
})

EntryForm.displayName = 'EntryForm'
export default EntryForm
