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

// ─── ANALYTICAL_RULES — Bộ quy tắc v11 (Signal-Driven, Compact Output) ────────

export const ANALYTICAL_RULES = `
===== VAI TRÒ =====
Bạn là hệ thống phân tích hành vi học tập. Xây dựng chuỗi suy luận khép kín — mỗi phần output phải xuất phát trực tiếp từ dữ liệu tín hiệu đã xác định ở phần trước.

===== PIPELINE 4 BƯỚC =====

BƯỚC 1 — TÍN HIỆU (key_signals): 2–3 quan sát
  - Kết hợp ít nhất 2 chỉ số, hoặc 1 chỉ số với xu hướng lịch sử
  - Phải có con số cụ thể: "Tập trung 2/5, giảm từ 4/5 (1 phiên trước)"
  - Chỉ mô tả sự kiện, không đánh giá (tốt/xấu/đáng lo...)
  - Nếu có yếu tố gây mất tập trung: bắt buộc xuất hiện trong ≥1 tín hiệu
  - MỖI tín hiệu tối đa 25 từ

BƯỚC 2 — CHIẾN LƯỢC (intervention_strategy): 1 câu duy nhất
  - Bắt đầu: "Để xử lý [tín hiệu chủ đạo từ Bước 1]..."
  - Chỉ 1 hướng tiếp cận, nêu cơ chế tác động cụ thể
  - Tối đa 35 từ, không dùng từ chung chung (cải thiện, nâng cao...)

BƯỚC 3 — DỰ BÁO (short_term_forecast): 1–2 câu
  - Câu 1: "Nếu [driver] không thay đổi, [tín hiệu X] có khả năng [hệ quả]."
  - Câu 2 (tuỳ chọn): "Nếu [hành động từ Bước 2] được thực hiện, [chỉ số] có khả năng đạt [mức]."
  - Tối đa 50 từ tổng cộng

BƯỚC 4 — HÀNH ĐỘNG (action_plan_48h): đúng 3 mục
  - Mục 1: Can thiệp trực tiếp vào driver (ai, làm gì, khi nào, bao lâu)
  - Mục 2: Kiểm soát môi trường liên quan tín hiệu cụ thể ở Bước 1
  - Mục 3: Đo lại — chỉ số nào cần đạt bao nhiêu ở phiên tiếp theo
  - Mỗi mục tối đa 20 từ, không trùng nội dung nhau

===== QUY TẮC CỨNG =====
- Không thêm lời khuyên chung không xuất phát từ dữ liệu
- Không gán nhãn tâm lý (lo lắng, mất động lực...), chỉ mô tả hành vi đo được
- Không dùng từ tuyệt đối (chắc chắn, sẽ xảy ra, không thể...)
- NGHIÊM CẤM "phiên -1", "phiên -N" — PHẢI dùng "1 phiên trước", "2 phiên trước"

===== PHÂN LOẠI RỦI RO =====
- Stable    : Tập trung ổn định, muốn bỏ cuộc thấp, đạt mục tiêu
- Fluctuating: ≥1 chỉ số dao động >1 bậc giữa các phiên
- High Risk : Tập trung <3 VÀ (bỏ cuộc ≥4 HOẶC không đạt mục tiêu)

===== OUTPUT =====
Trả về DUY NHẤT một JSON hợp lệ, đúng 6 fields:
  risk_level          : "Stable" | "Fluctuating" | "High Risk"
  key_signals         : array of 2–3 strings (Bước 1)
  intervention_strategy: string (Bước 2)
  short_term_forecast : string (Bước 3)
  action_plan_48h     : array of exactly 3 strings (Bước 4)
  primary_risk_driver : string — tín hiệu chủ đạo được dùng ở Bước 2 (1 câu)
Không markdown. Không text ngoài JSON.

===== NGÔN NGỮ =====
Toàn bộ text PHẢI bằng tiếng Việt, trừ risk_level (giữ nguyên EN vì là key hệ thống).
Phong cách: súc tích, phân tích, bám dữ liệu — không văn hoa, không rào đón.
`

// ─── formatAnalysisData — session-based prompt (v7) ──────────────────────────
// INPUT:  historyData thô từ DB (DESC — mới nhất trước).
//         Hàm tự reverse để tạo timeline cũ → mới (ASC), giữ tối đa 7 phiên.
//         3 phiên gần nhất được hiển thị riêng để AI ưu tiên phân tích xu hướng.

export function formatAnalysisData(todayData: EntryInput, historyData: HistoryRow[]): string {
  // allSessions: ASC (cũ → mới), tối đa 7 phiên lịch sử
  const allSessions = historyData.slice(0, 7).reverse()
  const n           = allSessions.length

  // 3 phiên gần nhất (index cuối của allSessions) — AI ưu tiên xu hướng ở đây
  const recentThree = allSessions.slice(-3)

  const distractionDensity = todayData.study_hours > 0
    ? (todayData.distraction_count / todayData.study_hours).toFixed(2)
    : '0'

  // ── Header ───────────────────────────────────────────────────────────────
  let output = `TỔNG DỮ LIỆU: ${n + 1} phiên (${n} lịch sử + phiên hiện tại).
DỮ LIỆU ĐÃ ĐỦ - KHÔNG YÊU CẦU THÊM DỮ LIỆU.

PHIÊN HIỆN TẠI:
- Ngày: ${todayData.session_date} - Phiên ${todayData.session_number ?? 1} (${todayData.session_time ?? 'Không rõ giờ'})
- Số giờ học: ${todayData.study_hours}h
- Mức tập trung: ${todayData.focus_level}/5
- Số lần mất tập trung: ${todayData.distraction_count} lần (mật độ: ${distractionDensity} lần/giờ)
- Yếu tố gây mất tập trung: ${todayData.distracting_factors || 'Không ghi nhận'}
- Đạt mục tiêu: ${todayData.goal_achieved ? 'Có' : 'Không'}
- Mức muốn bỏ cuộc: ${todayData.dropout_feeling}/5
- Trạng thái cảm xúc: ${todayData.emotional_state || 'Không ghi nhận'}
`

  if (n === 0) {
    output += '\n(Đây là phiên đầu tiên, chưa có dữ liệu lịch sử.)\n'
    return output
  }

  // ── 3 phiên gần nhất (ưu tiên phân tích xu hướng) ────────────────────────
  output += `\n3 PHIÊN GẦN NHẤT (ưu tiên phân tích xu hướng):\n`
  recentThree.forEach((s, i) => {
    const h       = Number(s.study_hours       || 0)
    const dc      = Number(s.distraction_count || 0)
    const density = h > 0 ? (dc / h).toFixed(2) : '0'
    const sameDay = String(s.session_date) === todayData.session_date
    // Format date as DD/MM for display
    const dateStr = String(s.session_date)  // "YYYY-MM-DD"
    const [yr, mo, dy] = dateStr.split('-')
    const shortDate = `${dy}/${mo}`
    const label   = sameDay
      ? `cùng ngày S${s.session_number ?? ''}`
      : `${shortDate} S${s.session_number ?? ''}`
    const offset  = recentThree.length - i   // 3, 2, 1 phiên trước
    output += `- ${label} (${offset} phiên trước): Tập trung ${s.focus_level}/5, Giờ học ${h}h, Mật độ ${density} lần/giờ, Mục tiêu ${s.goal_achieved ? 'Đạt' : 'Không đạt'}, Bỏ cuộc ${s.dropout_feeling}/5\n`
  })

  // ── Các phiên cũ hơn (tham khảo thêm) ───────────────────────────────────
  if (n > 3) {
    const olderSessions = allSessions.slice(0, -3)
    output += `\nCÁC PHIÊN CŨ HƠN (${olderSessions.length} phiên, tham khảo thêm):\n`
    olderSessions.forEach((s, i) => {
      const dateStr = String(s.session_date)
      const [yr2, mo2, dy2] = dateStr.split('-')
      const shortDate2 = `${dy2}/${mo2}`
      output += `- ${shortDate2} S${s.session_number ?? ''} (${n - i} phiên trước): Tập trung ${s.focus_level}/5, Bỏ cuộc ${s.dropout_feeling}/5\n`
    })
  }

  // ── Chuỗi xu hướng cũ → mới (bao gồm phiên hiện tại) ────────────────────
  const focusChain   = [...allSessions.map(s => s.focus_level),   todayData.focus_level]
  const dropoutChain = [...allSessions.map(s => s.dropout_feeling), todayData.dropout_feeling]

  output += `
CHUỖI XU HƯỚNG (từ cũ → mới, ${focusChain.length} phiên):
- Mức tập trung: ${focusChain.join(' → ')}
- Mức bỏ cuộc:   ${dropoutChain.join(' → ')}

LƯU Ý: Ưu tiên phân tích xu hướng dựa trên 3 phiên gần nhất. Đơn vị thời gian là PHIÊN, không phải ngày.
QUY TẮC VIẾT: Khi đề cập đến phiên lịch sử trong output, PHẢI dùng dạng "N phiên trước" (ví dụ: "1 phiên trước", "2 phiên trước", "3 phiên trước"). NGHIÊM CẤM dùng "phiên -1", "phiên -2", "phiên -N" hay bất kỳ số âm nào để chỉ phiên học.
`

  return output
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
      maxOutputTokens: 2048,
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

  // ── Build prompt ──────────────────────────────────────────────────────────
  const dataInput  = formatAnalysisData(todayData, historyData)
  const fullPrompt = `${dataInput}

THỰC HIỆN THEO ĐÚNG 5 BƯỚC PIPELINE:
Bước 1 → key_signals: 2–3 tín hiệu, mỗi tín hiệu kết hợp ≥2 chỉ số có con số cụ thể.
Bước 2 → primary_risk_driver: chọn 1 tín hiệu từ Bước 1, bắt đầu bằng "Tín hiệu...".
Bước 3 → short_term_forecast: trích dẫn đúng tên driver và tín hiệu từ Bước 1+2.
Bước 4 → intervention_strategy: bắt đầu bằng "Để xử lý [driver]...", 1 hướng duy nhất.
Bước 5 → action_plan_48h: đúng 3 hành động (can thiệp / kiểm soát / đo lại), suy ra từ Bước 4.

Trả về DUY NHẤT một JSON object hợp lệ, không markdown, không text ngoài JSON.
JSON có đúng 6 fields: risk_level, key_signals (array), short_term_forecast, primary_risk_driver, intervention_strategy, action_plan_48h (array gồm đúng 3 phần tử).`

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
        // 503 = server-side overload, all keys same → skip model
        console.log(`⚡ [${modelConfig.name}][${keyName}] 503 server overload — skip model immediately`)
        skipThisModel = true

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
