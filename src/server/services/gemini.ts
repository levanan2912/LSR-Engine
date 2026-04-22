// gemini.ts — LSR Engine AI Analysis (Cloudflare Workers compatible)

// ─── Output Schema ─────────────────────────────────────────────────────────────

export interface AnalysisResult {
  risk_level: 'Stable' | 'Fluctuating' | 'High Risk'
  key_signals: string[]
  short_term_forecast: string
  primary_risk_driver: string
  intervention_strategy: string
  action_plan_48h: string[]
  monitoring_protocol?: string   // deprecated — no longer generated, kept for old DB rows
  raw_ai_response?: string
  analyzed_by?: string
  key_name?: string       // friendly name of the API key used (e.g. "June")
  latency?: number        // latency of the winning model call (ms)
  total_latency?: number  // total chain time including failed attempts (ms)
  // ── Exception-handling metadata (computed server-side, passed to client) ──
  session_count?: number      // how many history sessions the AI had context for
  confidence_score?: number   // 0–100 score based on history depth
  is_outlier?: boolean        // true if this session deviates strongly from personal baseline but is not repeating
}

// ─── Entry & History types ─────────────────────────────────────────────────────

export interface EntryInput {
  study_hours: number
  focus_level: number
  distraction_count: number
  distracting_factors?: string
  goal_achieved: boolean
  emotional_state?: string
  dropout_feeling: number
  session_date: string
  session_number?: number   // phiên thứ mấy trong ngày (1, 2, 3…)
  session_time?: string     // giờ bắt đầu "HH:MM", optional
}

type HistoryRow = Record<string, unknown>

// ─── ANALYTICAL_RULES — Bộ quy tắc v13 (Exception-aware, Baseline-aware) ────────

export const ANALYTICAL_RULES = `Bạn là hệ thống phân tích hành vi học tập dài hạn. Trả về DUY NHẤT một JSON object hợp lệ (không markdown, không text ngoài JSON) với đúng 6 fields:
- risk_level: "Stable"|"Fluctuating"|"High Risk"
  • Stable = chỉ số trong biên độ bình thường hoặc cải thiện so với baseline
  • Fluctuating = ≥1 chỉ số dao động >1 bậc SO VỚI BASELINE (không so phiên trước)
  • High Risk = tập trung<3 VÀ (bỏ cuộc≥4 HOẶC không đạt mục tiêu) VÀ xu hướng tiêu cực lặp ≥3 phiên
  ⚠️ QUAN TRỌNG: Nếu prompt ghi "PHIÊN NGOẠI LỆ" → KHÔNG nâng lên High Risk chỉ vì 1 phiên xấu; tối đa là Fluctuating
  ⚠️ QUAN TRỌNG: Chỉ nâng High Risk khi tín hiệu tiêu cực kéo dài liên tục, không phải 1 phiên đơn lẻ
- key_signals: mảng 2–3 string, mỗi cái ≤25 từ, có số cụ thể (vd: "Tập trung 2/5, thấp hơn baseline 3.4/5"), tham chiếu baseline nếu có
- primary_risk_driver: string ≤20 từ — tín hiệu chủ đạo từ key_signals
- intervention_strategy: string ≤35 từ, bắt đầu "Để xử lý [driver]...", 1 hướng cụ thể
- short_term_forecast: string ≤50 từ, cấu trúc "Nếu... có khả năng..."
- action_plan_48h: mảng đúng 3 string ≤20 từ/cái (can thiệp / môi trường / đo lại)
Cấm: từ tuyệt đối, nhãn tâm lý, "phiên -N" (dùng "N phiên trước"). Ngôn ngữ: tiếng Việt (trừ risk_level).`

// ─── computeBaseline — tính baseline cá nhân từ lịch sử ───────────────────────
// Dùng tối đa 14 phiên, loại trừ 2 phiên gần nhất để tránh bias
// Trả về null nếu không đủ dữ liệu (< 3 phiên tham chiếu)

interface PersonalBaseline {
  focus:    number   // trung bình focus/5
  dropout:  number   // trung bình dropout/5
  hours:    number   // trung bình giờ học
  stdFocus: number   // độ lệch chuẩn focus
  stdDropout: number
  sampleSize: number // số phiên tham chiếu
}

function computeBaseline(historyData: HistoryRow[]): PersonalBaseline | null {
  // Lấy tối đa 14 phiên (DESC — mới nhất trước), bỏ 2 phiên mới nhất để tránh bias
  const refRows = historyData.slice(2, 16)  // index 2..15 (bỏ 0,1 — 2 phiên gần nhất)
  if (refRows.length < 3) return null

  const focuses   = refRows.map(r => Number(r.focus_level   ?? 3))
  const dropouts  = refRows.map(r => Number(r.dropout_feeling ?? 3))
  const hours     = refRows.map(r => Number(r.study_hours    ?? 0))

  const mean = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length
  const std  = (arr: number[], m: number) =>
    Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length)

  const mFocus   = mean(focuses)
  const mDropout = mean(dropouts)

  return {
    focus:      Math.round(mFocus * 10) / 10,
    dropout:    Math.round(mDropout * 10) / 10,
    hours:      Math.round(mean(hours) * 10) / 10,
    stdFocus:   Math.round(std(focuses,  mFocus)   * 10) / 10,
    stdDropout: Math.round(std(dropouts, mDropout) * 10) / 10,
    sampleSize: refRows.length,
  }
}

// ─── detectOutlier — phiên hiện tại có phải ngoại lệ không? ─────────────────
// Ngoại lệ = lệch > 1.5σ so với baseline NHƯNG chưa lặp lại (chỉ 1 phiên)
// Nếu lặp lại ≥ 2 phiên liên tiếp → KHÔNG phải ngoại lệ → xu hướng thật

function detectOutlier(
  today: EntryInput,
  historyData: HistoryRow[],
  baseline: PersonalBaseline | null,
): boolean {
  if (!baseline || baseline.sampleSize < 3) return false
  const threshold = 1.5

  // Kiểm tra phiên hiện tại có lệch mạnh so với baseline
  const focusDev   = baseline.stdFocus   > 0.3
    ? Math.abs(today.focus_level    - baseline.focus)   / baseline.stdFocus
    : 0
  const dropoutDev = baseline.stdDropout > 0.3
    ? Math.abs(today.dropout_feeling - baseline.dropout) / baseline.stdDropout
    : 0

  const isDeviant = focusDev > threshold || dropoutDev > threshold
  if (!isDeviant) return false

  // Kiểm tra phiên ngay trước (index 0 — mới nhất trong history) có cùng pattern không
  const prev = historyData[0]
  if (!prev) return true   // không có history → lệch mạnh = ngoại lệ (chưa đủ context)

  const prevFocusDev   = baseline.stdFocus   > 0.3
    ? Math.abs(Number(prev.focus_level ?? 3)    - baseline.focus)   / baseline.stdFocus
    : 0
  const prevDropoutDev = baseline.stdDropout > 0.3
    ? Math.abs(Number(prev.dropout_feeling ?? 3) - baseline.dropout) / baseline.stdDropout
    : 0

  // Nếu phiên trước CŨNG lệch mạnh → đây là xu hướng, không phải ngoại lệ
  if (prevFocusDev > threshold || prevDropoutDev > threshold) return false

  return true  // chỉ phiên này lệch, phiên trước bình thường → ngoại lệ nhất thời
}

// ─── countConsecutiveDecline — đếm số phiên tiêu cực liên tiếp gần nhất ────
// "Tiêu cực" = focus < baseline - 0.5 HOẶC dropout > baseline + 0.5

function countConsecutiveDecline(
  today: EntryInput,
  historyData: HistoryRow[],
  baseline: PersonalBaseline | null,
): number {
  if (!baseline) return 0
  const isNegative = (f: number, d: number) =>
    f < baseline.focus - 0.5 || d > baseline.dropout + 0.5

  let count = isNegative(today.focus_level, today.dropout_feeling) ? 1 : 0
  if (count === 0) return 0   // phiên hiện tại không tiêu cực → chuỗi = 0

  for (const row of historyData.slice(0, 6)) {  // kiểm tra tối đa 6 phiên trước
    if (isNegative(Number(row.focus_level ?? 3), Number(row.dropout_feeling ?? 3))) {
      count++
    } else {
      break
    }
  }
  return count
}

// ─── formatAnalysisData — session-based prompt (v9, baseline-aware) ──────────
// INPUT:  historyData thô từ DB (DESC — mới nhất trước).
//         Slice tối đa 7 phiên để hiểu xu hướng dài hơn.
//         Thêm baseline cá nhân, outlier flag, consecutive decline count.

export function formatAnalysisData(todayData: EntryInput, historyData: HistoryRow[]): string {
  // allSessions: ASC (cũ → mới), tối đa 7 phiên lịch sử (tăng từ 5 để phát hiện xu hướng tốt hơn)
  const allSessions = historyData.slice(0, 7).reverse()
  const n           = allSessions.length

  // ── Tính baseline, outlier, consecutive decline ───────────────────────────
  const baseline        = computeBaseline(historyData)
  const isOutlier       = detectOutlier(todayData, historyData, baseline)
  const conseqDecline   = countConsecutiveDecline(todayData, historyData, baseline)

  const dd = todayData.study_hours > 0
    ? (todayData.distraction_count / todayData.study_hours).toFixed(1)
    : '0'

  // ── Phiên hiện tại (compact) ──────────────────────────────────────────────
  const today = todayData
  let out = `PHIÊN HIỆN TẠI (${today.session_date} S${today.session_number ?? 1}${today.session_time ? ' ' + today.session_time : ''}):
F=${today.focus_level}/5 H=${today.study_hours}h D=${today.distraction_count}(${dd}/h) G=${today.goal_achieved ? 'Y' : 'N'} DO=${today.dropout_feeling}/5`

  if (today.distracting_factors) out += ` dist="${today.distracting_factors}"`
  if (today.emotional_state)     out += ` emo="${today.emotional_state}"`

  if (isOutlier) {
    out += `\n⚠️ PHIÊN NGOẠI LỆ: phiên này lệch mạnh so với baseline nhưng CHƯA LẶP LẠI — không nâng High Risk chỉ vì phiên này.`
  }
  if (conseqDecline >= 3) {
    out += `\n🚨 XU HƯỚNG XẤU KÉO DÀI: ${conseqDecline} phiên tiêu cực liên tiếp — có thể nâng cảnh báo.`
  } else if (conseqDecline === 2) {
    out += `\n⚠️ Tín hiệu xấu lặp lần 2 (${conseqDecline} phiên liên tiếp) — theo dõi thêm, chưa đủ cơ sở nâng cảnh báo.`
  }

  if (n === 0) {
    out += '\n[Phiên đầu tiên, không có lịch sử — không có baseline cá nhân]'
    return out
  }

  // ── Baseline cá nhân ─────────────────────────────────────────────────────
  if (baseline) {
    out += `\n\nBASELINE CÁ NHÂN (từ ${baseline.sampleSize} phiên tham chiếu): F=${baseline.focus}/5 (σ=${baseline.stdFocus}) DO=${baseline.dropout}/5 (σ=${baseline.stdDropout}) H=${baseline.hours}h`
  } else {
    out += `\n\nBASELINE: chưa đủ dữ liệu (cần ≥5 phiên để tính baseline ổn định)`
  }

  // ── Lịch sử (ASC, cũ → mới) — compact table ─────────────────────────────
  out += `\n\nLỊCH SỬ (${n} phiên, cũ→mới):`
  allSessions.forEach((s, i) => {
    const h      = Number(s.study_hours       || 0)
    const dc     = Number(s.distraction_count || 0)
    const dens   = h > 0 ? (dc / h).toFixed(1) : '0'
    const sameDay = String(s.session_date) === today.session_date
    const dateStr = String(s.session_date)
    const [, mo, dy] = dateStr.split('-')
    const lbl = sameDay ? `cùng ngày S${s.session_number ?? ''}` : `${dy}/${mo} S${s.session_number ?? ''}`
    const offset = n - i   // n, n-1, ... 1 phiên trước
    out += `\n${offset}pt (${lbl}): F=${s.focus_level} H=${h}h D=${dc}(${dens}/h) G=${s.goal_achieved ? 'Y' : 'N'} DO=${s.dropout_feeling}`
  })

  // ── Chuỗi xu hướng (compact) ─────────────────────────────────────────────
  const fChain  = [...allSessions.map(s => s.focus_level),    today.focus_level]
  const doChain = [...allSessions.map(s => s.dropout_feeling), today.dropout_feeling]

  out += `\n\nXU HƯỚNG (cũ→mới): F=${fChain.join('→')} DO=${doChain.join('→')}`
  out += `\n(pt=phiên trước; F=tập trung/5; H=giờ; D=mất tập trung; G=mục tiêu Y/N; DO=bỏ cuộc/5)`

  return out
}

// ─── getExceptionMeta — trả về metadata để gắn vào AnalysisResult ─────────
export function getExceptionMeta(
  todayData:   EntryInput,
  historyData: HistoryRow[],
): { session_count: number; confidence_score: number; is_outlier: boolean } {
  const n        = historyData.slice(0, 7).length
  const baseline = computeBaseline(historyData)
  const isOut    = detectOutlier(todayData, historyData, baseline)

  // confidence_score: tăng dần theo số phiên (tối đa ~90 khi ≥10 phiên)
  let score = n === 0 ? 30 : Math.min(30 + n * 7, 90)
  if (n <= 2)  score = Math.min(score, 45)
  if (n <= 4)  score = Math.min(score, 65)
  if (n <= 6)  score = Math.min(score, 78)

  return {
    session_count:    n,
    confidence_score: Math.round(score),
    is_outlier:       isOut,
  }
}

// ─── validateAnalysisOutput — kiểm tra vi phạm quy tắc ───────────────────────

interface ValidationResult {
  isValid: boolean
  violations: string[]
}

function validateAnalysisOutput(analysis: Partial<AnalysisResult>): ValidationResult {
  const forbiddenPhrases = [
    // Cụm từ tâm lý bị cấm
    'tự tin', 'mất động lực', 'cảm xúc tiêu cực', 'cảm xúc tích cực',
    'tinh thần', 'tâm lý', 'sức khỏe tâm thần', 'lo lắng', 'áp lực',
    'động lực', 'hứng thú', 'chán nản', 'tích cực', 'tiêu cực',
    'stress', 'căng thẳng', 'thư giãn', 'bình tĩnh', 'phấn khích',
    // Cụm từ khuyến khích bị cấm
    'cố gắng hơn', 'tập trung hơn', 'nỗ lực', 'kiên trì', 'chịu đựng',
    // Cụm từ phán xét bị cấm
    'lười', 'thiếu ý chí', 'trốn tránh', 'bỏ cuộc', 'yếu đuối',
    // Từ tuyệt đối bị cấm
    'chắc chắn', 'sẽ xảy ra', 'không thể', 'tuyệt đối',
    // Nhãn chữ của slider bị cấm
    '"high"', '"low"', '"moderate"', '"extreme"', '"none"', '"peak"',
  ]

  const outputText = JSON.stringify(analysis).toLowerCase()
  const violations: string[] = []

  forbiddenPhrases.forEach(phrase => {
    if (outputText.includes(phrase.toLowerCase())) {
      violations.push(`Sử dụng cụm từ bị cấm: "${phrase}"`)
    }
  })

  // key_signals phải có tham chiếu số liệu định lượng
  if (Array.isArray(analysis.key_signals) && analysis.key_signals.length > 0) {
    const hasQuantitativeRef = analysis.key_signals.some(signal =>
      /\d/.test(signal) && (signal.includes('/5') || signal.includes('lần') || signal.includes('giờ'))
    )
    if (!hasQuantitativeRef) {
      violations.push('Key signals thiếu tham chiếu định lượng cụ thể')
    }
  }

  // short_term_forecast phải có cấu trúc điều kiện
  if (analysis.short_term_forecast) {
    const txt = analysis.short_term_forecast.toLowerCase()
    if (!(txt.includes('nếu') && txt.includes('khả năng'))) {
      violations.push("Short-term forecast thiếu cấu trúc điều kiện 'nếu...thì có khả năng'")
    }
  }


  return { isValid: violations.length === 0, violations }
}

// ─── parseGeminiResponse ──────────────────────────────────────────────────────

// sanitizeSessionRefs — thay "phiên -N" → "N phiên trước" trong text AI output
function sanitizeSessionRefs(text: string): string {
  // "phiên -3" → "3 phiên trước", "(phiên -2)" → "(2 phiên trước)", v.v.
  return text
    .replace(/phi[eê]n\s*-\s*(\d+)/gi, (_m, n) => `${n} phiên trước`)
    .replace(/\(S(\d+),?\s*phi[eê]n\s*-\s*(\d+)\)/gi, (_m, s, n) => `(S${s}, ${n} phiên trước)`)
}

function sanitizeAnalysisResult(result: Partial<AnalysisResult>): Partial<AnalysisResult> {
  if (result.key_signals)
    result.key_signals = result.key_signals.map(sanitizeSessionRefs)
  if (result.primary_risk_driver)
    result.primary_risk_driver = sanitizeSessionRefs(result.primary_risk_driver)
  if (result.short_term_forecast)
    result.short_term_forecast = sanitizeSessionRefs(result.short_term_forecast)
  if (result.intervention_strategy)
    result.intervention_strategy = sanitizeSessionRefs(result.intervention_strategy)
  if (result.action_plan_48h)
    result.action_plan_48h = result.action_plan_48h.map(sanitizeSessionRefs)
  return result
}

// normalizeGeminiFields — map các alias field name mà Gemini hay dùng về đúng schema
// Gemini đôi khi trả về: key_signals_detected, recommended_intervention_strategy,
// v.v.
function normalizeGeminiFields(raw: Record<string, unknown>): Partial<AnalysisResult> {
  const out: Partial<AnalysisResult> = {}

  // risk_level
  const rl = (raw['risk_level'] ?? raw['risk'] ?? '') as string
  if (rl.includes('High Risk') || rl.includes('High'))       out.risk_level = 'High Risk'
  else if (rl.includes('Fluctuating'))                        out.risk_level = 'Fluctuating'
  else if (rl.includes('Stable'))                             out.risk_level = 'Stable'

  // key_signals — alias: key_signals_detected, signals, behavioral_signals
  const ks = raw['key_signals'] ?? raw['key_signals_detected'] ?? raw['signals'] ?? raw['behavioral_signals']
  if (Array.isArray(ks) && ks.length > 0) out.key_signals = ks as string[]

  // short_term_forecast — alias: forecast, short_term_prediction
  const stf = raw['short_term_forecast'] ?? raw['forecast'] ?? raw['short_term_prediction']
  if (typeof stf === 'string' && stf) out.short_term_forecast = stf

  // primary_risk_driver — alias: primary_driver, risk_driver, main_risk_factor
  const prd = raw['primary_risk_driver'] ?? raw['primary_driver'] ?? raw['risk_driver'] ?? raw['main_risk_factor']
  if (typeof prd === 'string' && prd) out.primary_risk_driver = prd

  // intervention_strategy — alias: recommended_intervention_strategy, strategy, intervention
  const is_ = raw['intervention_strategy'] ?? raw['recommended_intervention_strategy'] ?? raw['strategy'] ?? raw['intervention']
  if (typeof is_ === 'string' && is_) out.intervention_strategy = is_

  // action_plan_48h — alias: action_plan, actions, 48h_action_plan
  const ap = raw['action_plan_48h'] ?? raw['action_plan'] ?? raw['actions'] ?? raw['48h_action_plan']
  if (Array.isArray(ap) && ap.length > 0) out.action_plan_48h = ap as string[]


  return out
}

export function parseGeminiResponse(responseText: string): Partial<AnalysisResult> {
  // 1. Parse trực tiếp → normalize
  try {
    const raw = JSON.parse(responseText) as Record<string, unknown>
    const normalized = sanitizeAnalysisResult(normalizeGeminiFields(raw))
    console.log('[StudySignal] JSON parse: SUCCESS (direct)')
    return normalized
  } catch { /* tiếp */ }

  // 2. Bóc markdown fences
  const stripped = responseText.replace(/^```(?:json)?\s*/m, '').replace(/```\s*$/m, '').trim()
  try {
    const raw = JSON.parse(stripped) as Record<string, unknown>
    const normalized = sanitizeAnalysisResult(normalizeGeminiFields(raw))
    console.log('[StudySignal] JSON parse: SUCCESS (markdown stripped)')
    return normalized
  } catch { /* tiếp */ }

  // 3. Tìm JSON object đầu tiên trong text
  const jsonMatch = stripped.match(/\{[\s\S]*\}/)
  if (jsonMatch) {
    try {
      const raw = JSON.parse(jsonMatch[0]) as Record<string, unknown>
      const normalized = sanitizeAnalysisResult(normalizeGeminiFields(raw))
      console.log('[StudySignal] JSON parse: SUCCESS (extracted object)')
      return normalized
    } catch { /* tiếp */ }
  }

  // 4. Regex fallback từng trường — last resort
  console.warn('[StudySignal] ⚠️  JSON parse failed entirely, extracting fields via regex...')
  const partial: Partial<AnalysisResult> = {}

  const riskMatch = responseText.match(/risk_level["'\s:]+([^"',\n]+)/i)
  if (riskMatch) {
    const risk = riskMatch[1].trim().replace(/"/g, '')
    if (risk.includes('High Risk'))    partial.risk_level = 'High Risk'
    else if (risk.includes('Fluctuating')) partial.risk_level = 'Fluctuating'
    else if (risk.includes('Stable'))  partial.risk_level = 'Stable'
  }

  const signalsMatch = responseText.match(/"key_signals(?:_detected)?"\s*:\s*\[([\s\S]*?)\]/i)
  if (signalsMatch) {
    try { partial.key_signals = JSON.parse(`[${signalsMatch[1]}]`) as string[] } catch { /* bỏ qua */ }
  }

  const forecastMatch = responseText.match(/"short_term_forecast"\s*:\s*"([\s\S]*?)"(?:\s*,|\s*\})/)
  if (forecastMatch) partial.short_term_forecast = forecastMatch[1]

  const driverMatch = responseText.match(/"primary_risk_driver"\s*:\s*"([\s\S]*?)"(?:\s*,|\s*\})/)
  if (driverMatch) partial.primary_risk_driver = driverMatch[1]

  const strategyMatch = responseText.match(/"(?:intervention_strategy|recommended_intervention_strategy)"\s*:\s*"([\s\S]*?)"(?:\s*,|\s*\})/)
  if (strategyMatch) partial.intervention_strategy = strategyMatch[1]

  const planMatch = responseText.match(/"action_plan(?:_48h)?"\s*:\s*\[([\s\S]*?)\]/)
  if (planMatch) {
    try { partial.action_plan_48h = JSON.parse(`[${planMatch[1]}]`) as string[] } catch { /* bỏ qua */ }
  }

  return sanitizeAnalysisResult(partial)
}

// ─── Key name labels (theo thứ tự trong pool) ───────────────────────────────────
// Thứ tự KEY_NAMES phải khớp ĐÚNG với thứ tự key trong GEMINI_API_KEYS env:
// [0]=March, [1]=April, [2]=May, [3]=June, [4]=July — tất cả đều OK (2026-04-19)
// Key cũ bị leak đã bị thay thế toàn bộ bằng key mới

export const KEY_NAMES: string[] = ['March', 'April', 'May', 'June', 'July']

export function getKeyName(keyIndex: number): string {
  return KEY_NAMES[keyIndex] ?? `Key#${keyIndex + 1}`
}

// ─── Multi-key pool helper ───────────────────────────────────────────────────
//
// Nhận vào chuỗi env GEMINI_API_KEYS (các key phân cách bằng dấu phẩy)
// hoặc GEMINI_API_KEY (key đơn, backward-compat).
// Trả về mảng key đã dedup và bỏ các giá trị rỗng/placeholder.
//
// Ví dụ .dev.vars:
//   GEMINI_API_KEYS=AIza..key1..,AIza..key2..,AIza..key3..
//   GEMINI_API_KEY=AIza..key1..   ← vẫn hoạt động nếu chỉ có 1 key

export function parseApiKeys(keysEnv: string | undefined, keyEnv: string | undefined): string[] {
  const raw = (keysEnv || keyEnv || '')
    .split(',')
    .map(k => k.trim())
    .filter(k => k.length > 0 && !k.startsWith('your_'))
  // dedup giữ thứ tự
  return [...new Set(raw)]
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface ModelAttempt {
  model:    string
  key_index: number        // index trong pool (che giấu key thật)
  priority: string
  success:  boolean
  error:    string | null
  latency:  number
}

interface ModelCallResult {
  success:  true
  data:     AnalysisResult
  latency:  number
}

interface ModelCallFailure {
  success:  false
  error:    string        // error type/code ngắn gọn
  message:  string        // full error message
  latency:  number
}

type ModelCallOutcome = ModelCallResult | ModelCallFailure

// ─── callGeminiModelSafely — gọi một model, trả về kết quả hoặc lỗi có cấu trúc ─
// Không bao giờ throw. Mọi lỗi đều được bắt và trả về ModelCallFailure.
// Timeout kiểm soát bằng AbortController (Cloudflare Workers compatible).

async function callGeminiModelSafely(
  modelName: string,
  fullPrompt: string,
  apiKey: string,
  timeoutMs: number,
  keyIndex = 0,   // chỉ dùng để log — không log key thật
): Promise<ModelCallOutcome> {
  const callStart = Date.now()
  console.log(`⏳ [${modelName}] Bắt đầu API call (timeout ${timeoutMs}ms)...`)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    // ── Gọi Gemini API ─────────────────────────────────────────────────────
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`
    // ── thinkingConfig + responseMimeType compatibility ──────────────────────
    // ⚠️ Tham khảo: https://ai.google.dev/gemini-api/docs/thinking
    //
    //  gemini-2.5-flash / gemini-2.5-flash-lite:
    //    • Hỗ trợ thinkingBudget (0 = tắt thinking)
    //    • thinkingBudget:0 KHÔNG TƯƠNG THÍCH với responseMimeType:'application/json'
    //      (API trả 400 "thinkingBudget incompatible with JSON mode")
    //    • → Dùng text mode (không set responseMimeType), parse JSON thủ công
    //
    //  gemini-3.1-flash-lite-preview (và gemini-3.x nói chung):
    //    • Preview model — thinkingLevel chưa có tài liệu chính thức, có thể gây 400
    //    • An toàn nhất: KHÔNG gửi thinkingConfig, chỉ dùng responseMimeType JSON
    //    • → responseMimeType:'application/json', không thinkingConfig
    //
    //  gemini-2.0-flash / gemini-2.0-flash-lite:
    //    • Không hỗ trợ thinkingConfig
    //    • → responseMimeType:'application/json', không thinkingConfig
    const isGemini25 = /gemini-2\.5-/.test(modelName)

    const generationConfig: Record<string, unknown> = {
      temperature:     0.05,
      maxOutputTokens: 800,   // JSON output compact ~300-500 tokens — 800 là đủ, giảm latency
      topP:            0.8,
      topK:            32,
    }

    if (isGemini25) {
      // Gemini 2.5-*: thinkingBudget=0 tắt thinking mode để giảm latency.
      // KHÔNG set responseMimeType khi dùng thinkingBudget:0 → model trả text, tự parse JSON.
      generationConfig.thinkingConfig = { thinkingBudget: 0 }
      // responseMimeType intentionally omitted — incompatible with thinkingBudget:0
    } else {
      // gemini-3.1-flash-lite-preview, gemini-2.0-*, và các model khác:
      // Dùng JSON mode chuẩn, không thinkingConfig (an toàn nhất với preview models).
      generationConfig.responseMimeType = 'application/json'
    }

    const body = {
      systemInstruction: { parts: [{ text: ANALYTICAL_RULES }] },
      contents: [{ parts: [{ text: fullPrompt }] }],
      generationConfig,
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
      ],
    }

    const res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
      signal:  controller.signal,
    })

    clearTimeout(timer)

    // ── VALIDATION 1: HTTP status ──────────────────────────────────────────
    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      throw new Error(`HTTP_${res.status}: ${errText.slice(0, 200)}`)
    }

    type GeminiResponse = {
      candidates: Array<{
        content:      { parts: Array<{ text: string }> }
        finishReason?: string
      }>
      promptFeedback?: { blockReason?: string }
    }
    const data = await res.json() as GeminiResponse

    // ── VALIDATION 2: Prompt không bị block ───────────────────────────────
    if (data.promptFeedback?.blockReason) {
      throw new Error(`BLOCKED: ${data.promptFeedback.blockReason}`)
    }

    const candidate = data.candidates?.[0]

    // ── VALIDATION 3: finishReason không phải MAX_TOKENS ──────────────────
    if (candidate?.finishReason === 'MAX_TOKENS') {
      throw new Error('MAX_TOKENS: Response bị cắt, JSON không hợp lệ')
    }

    // ── VALIDATION 4: Response text tồn tại ───────────────────────────────
    let responseText = candidate?.content?.parts?.[0]?.text ?? ''
    if (!responseText.trim()) {
      throw new Error('EMPTY_RESPONSE: Model không trả về text')
    }

    // ── VALIDATION 5: Làm sạch markdown contamination ─────────────────────
    responseText = responseText
      .replace(/```json\s*/gi, '')
      .replace(/```\s*/g, '')
      .trim()

    // ── VALIDATION 6: Parse JSON ───────────────────────────────────────────
    let rawParsed: Record<string, unknown>
    try {
      rawParsed = JSON.parse(responseText)
    } catch {
      throw new Error(`PARSE_ERROR: ${responseText.substring(0, 150)}`)
    }

    // ── NORMALIZATION: Dùng normalizeGeminiFields để chuẩn hoá aliases ────
    const parsed = { ...rawParsed, ...normalizeGeminiFields(rawParsed) } as Record<string, unknown>

    // ── AUTO-FIX: risk_level fuzzy match ──────────────────────────────────
    // Model đôi khi trả tiếng Việt hoặc biến thể khác → map về 3 giá trị chuẩn
    if (typeof parsed.risk_level === 'string') {
      const rl = (parsed.risk_level as string).toLowerCase()
      if (/high.?risk|rủi ro cao|nguy cơ cao|very.?high/i.test(rl)) {
        parsed.risk_level = 'High Risk'
      } else if (/fluctuat|dao động|biến động|trung bình|không ổn|moderate/i.test(rl)) {
        parsed.risk_level = 'Fluctuating'
      } else if (/stable|ổn định|thấp|low/i.test(rl)) {
        parsed.risk_level = 'Stable'
      }
      // Ghi log nếu đã auto-fix
      if (!['Stable', 'Fluctuating', 'High Risk'].includes(rawParsed.risk_level as string) &&
           ['Stable', 'Fluctuating', 'High Risk'].includes(parsed.risk_level as string)) {
        console.warn(`⚠️  [${modelName}] risk_level auto-fixed: "${rawParsed.risk_level}" → "${parsed.risk_level}"`)
      }
    }

    // ── VALIDATION 7: Đủ fields cốt lõi ─────────────────────────────────────
    const requiredFields = [
      'risk_level', 'key_signals', 'short_term_forecast',
      'primary_risk_driver', 'intervention_strategy',
      'action_plan_48h',
    ] as const

    const missingFields = requiredFields.filter(f =>
      !parsed[f] || (Array.isArray(parsed[f]) && (parsed[f] as unknown[]).length === 0)
    )
    if (missingFields.length > 0) {
      const latencyOnFail = Date.now() - callStart
      console.error(
        `🔍 [${modelName}] Validation thất bại (${latencyOnFail}ms)\n` +
        `   Trường thiếu/sai: ${missingFields.join(', ')}\n` +
        `   Raw response (150 ký tự đầu): ${responseText.substring(0, 150)}`,
      )
      throw new Error(`MISSING_FIELDS: ${missingFields.join(', ')}`)
    }

    // ── VALIDATION 8: risk_level hợp lệ (sau auto-fix) ───────────────────
    const validRiskLevels = ['Stable', 'Fluctuating', 'High Risk']
    if (!validRiskLevels.includes(parsed.risk_level as string)) {
      const latencyOnFail = Date.now() - callStart
      console.error(
        `🔍 [${modelName}] Validation thất bại (${latencyOnFail}ms)\n` +
        `   risk_level không hợp lệ: "${parsed.risk_level}" (không thể auto-fix)\n` +
        `   Raw response (150 ký tự đầu): ${responseText.substring(0, 150)}`,
      )
      throw new Error(`INVALID_RISK_LEVEL: "${parsed.risk_level}"`)
    }

    // ── VALIDATION 9: action_plan_48h là array có ít nhất 1 phần tử ──────
    if (!Array.isArray(parsed.action_plan_48h) || (parsed.action_plan_48h as unknown[]).length === 0) {
      const latencyOnFail = Date.now() - callStart
      console.error(
        `🔍 [${modelName}] Validation thất bại (${latencyOnFail}ms)\n` +
        `   action_plan_48h không hợp lệ: type=${typeof parsed.action_plan_48h}\n` +
        `   Raw response (150 ký tự đầu): ${responseText.substring(0, 150)}`,
      )
      throw new Error(`INVALID_ACTION_PLAN: Expected array, got ${typeof parsed.action_plan_48h}`)
    }
    // Log cảnh báo nếu không đủ 3 hành động (không reject, vẫn dùng được)
    if ((parsed.action_plan_48h as unknown[]).length !== 3) {
      console.warn(`⚠️  [${modelName}] action_plan_48h có ${(parsed.action_plan_48h as unknown[]).length} items (kỳ vọng 3)`)
    }

    const latency = Date.now() - callStart
    console.log(`✅ [${modelName}] Thành công - ${latency}ms`)

    return { success: true, data: parsed as unknown as AnalysisResult, latency }

  } catch (err: unknown) {
    clearTimeout(timer)
    const latency  = Date.now() - callStart
    const fullMsg  = err instanceof Error ? err.message : String(err)
    // AbortController → timeout
    const message  = fullMsg.includes('abort') || fullMsg.includes('Abort')
      ? `TIMEOUT_${timeoutMs}ms`
      : fullMsg
    const errorType = message.split(':')[0]?.trim() ?? 'UNKNOWN'

    console.error(`❌ [${modelName}][key#${keyIndex}] Thất bại (${latency}ms): ${message.slice(0, 200)}`)
    return { success: false, error: errorType, message, latency }
  }
}

// raceGeminiKeys đã bị xoá — dùng sequential loop trong analyzeStudyBehavior thay thế.

// ─── analyzeStudyBehavior — hàm chính, fallback chain có logging đầy đủ ─────
//   historyData (raw DB) — ORDER BY session_date DESC, session_number DESC (mới nhất trước)
//   formatAnalysisData   — nhận historyData thô, tự slice(0,7).reverse() → ASC bên trong

// ── Default model pool (used as fallback when DB is unavailable) ──────────────
// ⚠️ Luôn ưu tiên đọc từ DB (model_config table). List này chỉ dùng khi DB lỗi.
// Thứ tự: thử nhiều model nhất, quota cao nhất → thấp nhất
const DEFAULT_MODEL_DEFS: Array<{ name: string; timeout: number; priority: string }> = [
  { name: 'gemini-2.5-flash',              timeout: 40000, priority: 'primary'  },
  { name: 'gemini-2.5-flash-lite',         timeout: 35000, priority: 'fallback' },
  { name: 'gemini-3.1-flash-lite-preview', timeout: 30000, priority: 'backup'   },
  // gemini-2.0-flash-lite & gemini-2.0-flash: deprecated, removed
]

export async function analyzeStudyBehavior(
  todayData:   EntryInput,
  historyData: HistoryRow[],
  apiKeysEnv:  string,      // GEMINI_API_KEYS (comma-sep) hoặc GEMINI_API_KEY đơn
  apiKeyEnv?:  string,      // GEMINI_API_KEY backward-compat (optional)
  db?:         D1Database,  // Cloudflare D1 — đọc model_config nếu có
): Promise<AnalysisResult> {
  const overallStart = Date.now()
  // ── Overall timeout: Workers Paid Plan — CPU 30s, wall-clock dài hơn nhiều
  // Free:  25s overall (phải trả response trước khi Worker bị kill ở ~30s wall-clock)
  // Paid:  55s overall — cho phép thử nhiều model/key hơn mà không bị timeout sớm
  // Nguồn: https://developers.cloudflare.com/workers/platform/limits/
  const OVERALL_TIMEOUT_MS = 55000

  // ── Parse key pool ────────────────────────────────────────────────────────
  const keyPool = parseApiKeys(apiKeysEnv, apiKeyEnv)
  if (keyPool.length === 0) {
    throw new Error('Không có GEMINI API key nào hợp lệ. Thêm GEMINI_API_KEYS hoặc GEMINI_API_KEY vào .dev.vars / Cloudflare secrets.')
  }
  console.log(`🚀 Bắt đầu phân tích AI — ${keyPool.length} key(s) trong pool`)

  // ── Tính exception metadata trước khi gọi AI ─────────────────────────────
  const exceptionMeta = getExceptionMeta(todayData, historyData)
  console.log(`📊 Exception metadata: session_count=${exceptionMeta.session_count} confidence=${exceptionMeta.confidence_score}% is_outlier=${exceptionMeta.is_outlier}`)

  // ── Build prompt ──────────────────────────────────────────────────────────
  const dataInput  = formatAnalysisData(todayData, historyData)
  // Prompt ngắn gọn — toàn bộ quy tắc đã nằm trong systemInstruction
  const fullPrompt = `${dataInput}

Phân tích và trả về JSON 6 fields: risk_level, key_signals(2-3 items), primary_risk_driver, intervention_strategy, short_term_forecast, action_plan_48h(đúng 3 items).`

  // ── Load model definitions từ DB (nếu có), fallback về hardcoded ─────────
  let modelDefs: Array<{ name: string; timeout: number; priority: string }>
  if (db) {
    try {
      const rows = await db.prepare(
        'SELECT model_name, timeout_ms, sort_order FROM model_config WHERE enabled = 1 ORDER BY sort_order ASC, id ASC'
      ).all<{ model_name: string; timeout_ms: number; sort_order: number }>()

      if (rows.results.length > 0) {
        modelDefs = rows.results.map((r, idx) => ({
          name:     r.model_name,
          timeout:  r.timeout_ms,
          priority: idx === 0 ? 'primary' : idx === 1 ? 'fallback' : 'backup',
        }))
        console.log(`📋 Loaded ${modelDefs.length} model(s) from DB config: ${modelDefs.map(m => m.name).join(' → ')}`)
      } else {
        console.warn('⚠️ model_config trống, dùng cấu hình mặc định')
        modelDefs = DEFAULT_MODEL_DEFS
      }
    } catch (dbErr) {
      console.warn('⚠️ Không đọc được model_config từ DB, dùng cấu hình mặc định:', dbErr)
      modelDefs = DEFAULT_MODEL_DEFS
    }
  } else {
    modelDefs = DEFAULT_MODEL_DEFS
  }

  // ── Sequential (model × key) attempt matrix ──────────────────────────────
  // Rotation policy (PER MODEL, không share exhausted state giữa models):
  //
  //   QUAN TRỌNG: exhaustedKeys chỉ tồn tại trong scope của từng model.
  //   Lý do: key có thể hết quota RPM cho model A nhưng vẫn còn quota cho model B
  //   (mỗi model có RPM/RPD bucket riêng biệt).
  //   Chỉ invalidKeys (401/403/PREPAID) là vĩnh viễn cross-model.
  //
  //   Per-model rotation:
  //     429/quota   → exhausted cho model này, thử key tiếp theo
  //     503/overload → skip cả model ngay (server overload affects all keys)
  //     401/403/PREPAID → invalid vĩnh viễn (cross-model)
  //     400/404     → skip cả model (config/name issue)
  //     TIMEOUT     → exhausted cho model này, thử key tiếp theo
  //     parse/val   → thử key tiếp theo

  const attemptResults: ModelAttempt[] = []
  const invalidKeys = new Set<number>()  // 401/403/PREPAID: skip vĩnh viễn, cross-model

  for (const modelConfig of modelDefs) {
    // ── Overall timeout guard ────────────────────────────────────────────────
    const elapsedOverall = Date.now() - overallStart
    if (elapsedOverall >= OVERALL_TIMEOUT_MS) {
      console.warn(`⏱️ Overall timeout ${OVERALL_TIMEOUT_MS}ms đã hết (${elapsedOverall}ms) — dừng`)
      break
    }

    let modelSucceeded  = false
    let skipThisModel   = false
    // exhaustedKeys là PER-MODEL — reset mỗi model mới
    const exhaustedThisModel = new Set<number>()

    // Lấy tất cả key còn valid (chưa bị 401/403/PREPAID)
    const availableKeys = Array.from({ length: keyPool.length }, (_, i) => i)
      .filter(i => !invalidKeys.has(i))

    if (availableKeys.length === 0) {
      console.log(`⛔ [${modelConfig.name}] Không còn key hợp lệ — dừng toàn bộ`)
      break
    }

    const remainingMs      = OVERALL_TIMEOUT_MS - (Date.now() - overallStart)
    const effectiveTimeout = Math.min(modelConfig.timeout, Math.max(remainingMs - 1000, 5000))

    console.log(`🔄 [${modelConfig.name}] Start — timeout=${effectiveTimeout}ms, remaining=${remainingMs}ms, keys=[${availableKeys.map(i => getKeyName(i)).join(',')}]`)

    for (const keyIdx of availableKeys) {
      if (skipThisModel) break
      if (exhaustedThisModel.has(keyIdx)) continue

      // Re-check overall timeout before each key call
      const beforeCall = Date.now() - overallStart
      if (beforeCall >= OVERALL_TIMEOUT_MS - 2000) {
        console.warn(`⏱️ [${modelConfig.name}] Overall timeout sắp hết (${beforeCall}ms) — dừng key loop`)
        break
      }

      const key     = keyPool[keyIdx]
      const keyName = getKeyName(keyIdx)
      // Thêm delay nhỏ giữa các lần thử key để tránh burst rate-limit
      const attemptNo = availableKeys.indexOf(keyIdx)
      if (attemptNo > 0) {
        const delayMs = Math.min(attemptNo * 500, 2000)  // 500ms, 1000ms, 1500ms, 2000ms max
        console.log(`⏸️  [${modelConfig.name}][${keyName}] Waiting ${delayMs}ms before retry...`)
        await new Promise(r => setTimeout(r, delayMs))
      }
      console.log(`⏳ [${modelConfig.name}][${keyName}] Calling...`)

      const outcome = await callGeminiModelSafely(
        modelConfig.name,
        fullPrompt,
        key,
        effectiveTimeout,
        keyIdx + 1,
      )

      attemptResults.push({
        model:     modelConfig.name,
        key_index: keyIdx + 1,
        priority:  modelConfig.priority,
        success:   outcome.success,
        error:     outcome.success ? null : outcome.error,
        latency:   outcome.latency,
      })

      if (outcome.success) {
        modelSucceeded = true
        const totalElapsed = Date.now() - overallStart
        console.log(`🎯 SUCCESS [${modelConfig.name}][${keyName}] — latency=${outcome.latency}ms total=${totalElapsed}ms`)
        console.log('📋 Attempt chain:', JSON.stringify(attemptResults))
        return {
          ...outcome.data,
          analyzed_by:     modelConfig.name,
          key_name:        keyName,
          latency:         outcome.latency,
          total_latency:   totalElapsed,
          raw_ai_response: undefined,
          // Gắn exception metadata vào kết quả
          session_count:    exceptionMeta.session_count,
          confidence_score: exceptionMeta.confidence_score,
          is_outlier:       exceptionMeta.is_outlier,
        }
      }

      // ── Error classification ────────────────────────────────────────────
      const msg = outcome.message ?? ''

      if (/prepayment|credits.{0,20}depleted|depleted.{0,20}credits/i.test(msg)) {
        // PREPAID_DEPLETED: key hết tiền hoàn toàn — invalid vĩnh viễn, cross-model
        console.warn(`💳 [${modelConfig.name}][${keyName}] PREPAID_DEPLETED — invalidate key permanently (all models)`)
        invalidKeys.add(keyIdx)

      } else if (/429|quota|rate.?limit/i.test(msg)) {
        // 429: hết quota cho model này, nhưng key vẫn có thể dùng cho model khác
        console.log(`🔒 [${modelConfig.name}][${keyName}] 429 quota — exhausted for THIS model, try next key`)
        exhaustedThisModel.add(keyIdx)

      } else if (/401|invalid.?key/i.test(msg)) {
        console.warn(`🔑 [${modelConfig.name}][${keyName}] 401 invalid key — skip permanently (all models)`)
        invalidKeys.add(keyIdx)

      } else if (/HTTP_400/i.test(msg)) {
        console.warn(`🚫 [${modelConfig.name}][${keyName}] HTTP 400 — skip model: ${msg.slice(0, 100)}`)
        skipThisModel = true

      } else if (/HTTP_403/i.test(msg)) {
        console.warn(`🔑 [${modelConfig.name}][${keyName}] HTTP 403 forbidden — skip key permanently`)
        invalidKeys.add(keyIdx)

      } else if (/HTTP_404/i.test(msg)) {
        console.warn(`🚫 [${modelConfig.name}][${keyName}] HTTP 404 model not found — skip model`)
        skipThisModel = true

      } else if (/503|overload|unavailable|high.?demand/i.test(msg)) {
        // 503 = server overload — thử key khác trước (mỗi key dùng API region khác nhau).
        // Chỉ skip model nếu ĐÃ thử tất cả keys mà vẫn 503 (exhaustedThisModel sẽ bao hết).
        console.log(`⚡ [${modelConfig.name}][${keyName}] 503 server overload — exhausted for THIS model, try next key`)
        exhaustedThisModel.add(keyIdx)

      } else if (/TIMEOUT/i.test(msg)) {
        // Timeout: exhausted cho model này (server đang chậm), thử key khác
        console.log(`⏰ [${modelConfig.name}][${keyName}] Timeout — exhausted for THIS model, try next key`)
        exhaustedThisModel.add(keyIdx)

      } else {
        // Parse/validation/network error → thử key tiếp theo
        console.log(`⚠️  [${modelConfig.name}][${keyName}] ${outcome.error}: ${msg.slice(0, 80)} — try next key`)
      }
    }

    if (!modelSucceeded) {
      const reason = skipThisModel
        ? 'skip (503/400/404)'
        : `all ${availableKeys.length} key(s) exhausted/failed for this model`
      console.log(`🔁 [${modelConfig.name}] Failed (${reason}) — next model`)
    }
  }

  // ── Tất cả models thất bại ────────────────────────────────────────────────
  const totalElapsed = Date.now() - overallStart
  console.error(`❌ Tất cả AI models thất bại sau ${totalElapsed}ms`)
  console.error('📋 Chi tiết lỗi chain:', JSON.stringify(attemptResults, null, 2))
  throw new Error('Tất cả Gemini models đều thất bại. Vui lòng thử lại sau.')
}

// ─── Backward-compat alias ────────────────────────────────────────────────────
// generateAnalysis(todayData, historyData, apiKey) — single-key form, backward compat
export const generateAnalysis = analyzeStudyBehavior
