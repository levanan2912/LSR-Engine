// gemini.ts — LSR Engine AI Analysis (Cloudflare Workers compatible)

// ─── Output Schema ─────────────────────────────────────────────────────────────

export interface AnalysisResult {
  risk_level: 'Stable' | 'Fluctuating' | 'High Risk'
  key_signals: string[]
  short_term_forecast: string
  primary_risk_driver: string
  intervention_strategy: string
  action_plan_48h: string[]
  monitoring_protocol: string
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

// ─── ANALYTICAL_RULES — Bộ quy tắc v10 (Signal-Driven Pipeline) ─────────────────

export const ANALYTICAL_RULES = `
===== VAI TRÒ =====
Bạn là hệ thống phân tích hành vi học tập. Nhiệm vụ: xây dựng chuỗi suy luận khép kín — mỗi phần output phải xuất phát trực tiếp từ dữ liệu tín hiệu đã xác định ở phần trước. Không được tạo ra nhận định mới ở phần sau nếu chưa có căn cứ từ phần trước.

===== KIẾN TRÚC PIPELINE =====
Thực hiện theo đúng 5 bước tuần tự. Kết quả mỗi bước là đầu vào bắt buộc của bước tiếp theo:

BƯỚC 1 — XÁC ĐỊNH TÍN HIỆU (key_signals)
  Liệt kê 2–3 quan sát thực tế từ dữ liệu. Mỗi tín hiệu phải:
  - Kết hợp ít nhất 2 chỉ số với nhau, hoặc 1 chỉ số với xu hướng lịch sử
  - Có con số cụ thể (ví dụ: "Mức tập trung 2/5 giảm từ 4/5 ở phiên trước")
  - Không dùng từ đánh giá (tốt, xấu, đáng lo, tích cực...), chỉ mô tả sự kiện
  - Nếu có Yếu tố gây mất tập trung thì bắt buộc phải xuất hiện trong ít nhất 1 tín hiệu

BƯỚC 2 — CHỌN PRIMARY RISK DRIVER (primary_risk_driver)
  Từ các tín hiệu ở Bước 1, chọn DUY NHẤT 1 tín hiệu có ảnh hưởng nhân quả lớn nhất.
  Câu phải bắt đầu bằng: "Tín hiệu [tên tín hiệu] cho thấy..."
  Giải thích vì sao tín hiệu đó là nguyên nhân gốc, không phải triệu chứng.

BƯỚC 3 — DỰ BÁO (short_term_forecast)
  Phải trích dẫn đúng tên tín hiệu từ Bước 1 và driver từ Bước 2.
  Cấu trúc bắt buộc: "Nếu [tên driver cụ thể] không thay đổi, [tín hiệu X] có khả năng [hệ quả cụ thể]."
  Thêm 1 câu điều kiện ngược: "Nếu [hành động cụ thể] được thực hiện, [chỉ số cụ thể] có khả năng cải thiện về [mức cụ thể]."
  Không được đề cập tới bất kỳ hành động nào chưa có trong Bước 1 hoặc 2.

BƯỚC 4 — CHIẾN LƯỢC CAN THIỆP (intervention_strategy)
  Phải bắt đầu bằng: "Để xử lý [driver từ Bước 2]..."
  Mô tả 1 hướng tiếp cận duy nhất, cụ thể về cơ chế tác động vào driver đó.
  Không được đề xuất nhiều hướng song song. Không dùng từ chung chung (cải thiện, nâng cao, tăng cường...).

BƯỚC 5 — KẾ HOẠCH HÀNH ĐỘNG (action_plan_48h)
  Đúng 3 hành động, được suy ra từ chiến lược ở Bước 4. Mỗi hành động:
  - Hành động 1: Can thiệp trực tiếp vào driver (ai làm gì, khi nào, bao lâu)
  - Hành động 2: Kiểm soát môi trường hoặc điều kiện liên quan đến tín hiệu cụ thể trong Bước 1
  - Hành động 3: Đo lại — chỉ số nào cần đạt bao nhiêu ở phiên tiếp theo để xác nhận can thiệp có hiệu quả
  Mỗi hành động phải có kết quả quan sát được ngay trong phiên tiếp theo.
  Không được lặp lại nội dung giữa 3 hành động.

===== QUY TẮC RÀNG BUỘC =====
- Mọi từ trong short_term_forecast, intervention_strategy, action_plan_48h phải có thể truy nguồn về ít nhất 1 tín hiệu trong key_signals
- Nếu không thể truy nguồn → xóa câu đó, không được giữ lại
- Không được thêm lời khuyên chung chung không xuất phát từ dữ liệu
- Không gán nhãn tâm lý (lo lắng, mất động lực, tinh thần...), chỉ mô tả hành vi đo lường được
- Không dùng từ tuyệt đối (chắc chắn, sẽ xảy ra, không thể...)

===== PHÂN LOẠI RỦI RO =====
- Stable: Mức tập trung ổn định, Mức muốn bỏ cuộc thấp, Đạt mục tiêu
- Fluctuating: ít nhất 1 chỉ số dao động hơn 1 bậc giữa các phiên
- High Risk: Mức tập trung dưới 3 VÀ (Mức bỏ cuộc từ 4 HOẶC Không đạt mục tiêu)
- risk_level phải nhất quán với primary_risk_driver

===== GIAO THỨC GIÁM SÁT (monitoring_protocol) =====
Phải có 2 điều kiện kích hoạt dạng: "Nếu [chỉ số] đạt [ngưỡng cụ thể] trong phiên tiếp theo thì [hành động cụ thể]."
Các ngưỡng phải suy ra từ dữ liệu hiện tại, không được dùng ngưỡng cố định như 3/5, 4/5 chung chung.

===== ĐỊNH DẠNG OUTPUT =====
Trả về DUY NHẤT một JSON object hợp lệ với đúng 7 fields:
  risk_level         : "Stable" | "Fluctuating" | "High Risk"
  key_signals        : array of 2–3 strings (Bước 1)
  primary_risk_driver: string (Bước 2)
  short_term_forecast: string (Bước 3)
  intervention_strategy: string (Bước 4)
  action_plan_48h    : array of exactly 3 strings (Bước 5)
  monitoring_protocol: string
Không markdown. Không text ngoài JSON.

===== NGÔN NGỮ BẮT BUỘC =====
TOÀN BỘ nội dung text trong JSON (key_signals, primary_risk_driver, short_term_forecast, intervention_strategy, action_plan_48h, monitoring_protocol) PHẢI viết hoàn toàn bằng tiếng Việt.
NGHIÊM CẤM dùng tiếng Anh trong bất kỳ trường nào ngoài risk_level (giữ nguyên "Stable"/"Fluctuating"/"High Risk" vì đây là key hệ thống).
Phong cách: phân tích, ngắn gọn, chính xác theo dữ liệu.
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
    const offset  = recentThree.length - i   // -3, -2, -1
    output += `- ${label} (phiên -${offset}): Tập trung ${s.focus_level}/5, Giờ học ${h}h, Mật độ ${density} lần/giờ, Mục tiêu ${s.goal_achieved ? 'Đạt' : 'Không đạt'}, Bỏ cuộc ${s.dropout_feeling}/5\n`
  })

  // ── Các phiên cũ hơn (tham khảo thêm) ───────────────────────────────────
  if (n > 3) {
    const olderSessions = allSessions.slice(0, -3)
    output += `\nCÁC PHIÊN CŨ HƠN (${olderSessions.length} phiên, tham khảo thêm):\n`
    olderSessions.forEach((s, i) => {
      const dateStr = String(s.session_date)
      const [yr2, mo2, dy2] = dateStr.split('-')
      const shortDate2 = `${dy2}/${mo2}`
      output += `- ${shortDate2} S${s.session_number ?? ''} (phiên -${n - i}): Tập trung ${s.focus_level}/5, Bỏ cuộc ${s.dropout_feeling}/5\n`
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

  // monitoring_protocol không được dùng ký hiệu toán học
  if (analysis.monitoring_protocol && /[<>=≤≥]/.test(analysis.monitoring_protocol)) {
    violations.push('Monitoring protocol sử dụng ký hiệu toán học thay vì viết bằng chữ')
  }

  return { isValid: violations.length === 0, violations }
}

// ─── parseGeminiResponse ──────────────────────────────────────────────────────

// normalizeGeminiFields — map các alias field name mà Gemini hay dùng về đúng schema
// Gemini đôi khi trả về: key_signals_detected, recommended_intervention_strategy,
// monitoring_protocol (array thay vì string), v.v.
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

  // monitoring_protocol — alias: monitoring, protocol; đôi khi là array → join
  const mp = raw['monitoring_protocol'] ?? raw['monitoring'] ?? raw['protocol']
  if (typeof mp === 'string' && mp)       out.monitoring_protocol = mp
  else if (Array.isArray(mp) && mp.length > 0) out.monitoring_protocol = (mp as string[]).join(' ')

  return out
}

export function parseGeminiResponse(responseText: string): Partial<AnalysisResult> {
  // 1. Parse trực tiếp → normalize
  try {
    const raw = JSON.parse(responseText) as Record<string, unknown>
    const normalized = normalizeGeminiFields(raw)
    console.log('[StudySignal] JSON parse: SUCCESS (direct)')
    return normalized
  } catch { /* tiếp */ }

  // 2. Bóc markdown fences
  const stripped = responseText.replace(/^```(?:json)?\s*/m, '').replace(/```\s*$/m, '').trim()
  try {
    const raw = JSON.parse(stripped) as Record<string, unknown>
    const normalized = normalizeGeminiFields(raw)
    console.log('[StudySignal] JSON parse: SUCCESS (markdown stripped)')
    return normalized
  } catch { /* tiếp */ }

  // 3. Tìm JSON object đầu tiên trong text
  const jsonMatch = stripped.match(/\{[\s\S]*\}/)
  if (jsonMatch) {
    try {
      const raw = JSON.parse(jsonMatch[0]) as Record<string, unknown>
      const normalized = normalizeGeminiFields(raw)
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

  const protocolMatch = responseText.match(/"monitoring_protocol"\s*:\s*"([\s\S]*?)"(?:\s*,|\s*\})/)
  if (protocolMatch) partial.monitoring_protocol = protocolMatch[1]

  return partial
}

// ─── Key name labels (theo thứ tự trong pool) ───────────────────────────────────
// Vị trí 0 = March, 1 = April, ...
// Nếu số key vượt quá tên đặt sẵn, fallback sang "Key#N"

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
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(responseText)
    } catch {
      throw new Error(`PARSE_ERROR: ${responseText.substring(0, 150)}`)
    }

    // ── VALIDATION 7: Đủ 7 fields bắt buộc ───────────────────────────────
    const requiredFields = [
      'risk_level', 'key_signals', 'short_term_forecast',
      'primary_risk_driver', 'intervention_strategy',
      'action_plan_48h', 'monitoring_protocol',
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

    // ── VALIDATION 8: risk_level hợp lệ ──────────────────────────────────
    const validRiskLevels = ['Stable', 'Fluctuating', 'High Risk']
    if (!validRiskLevels.includes(parsed.risk_level as string)) {
      const latencyOnFail = Date.now() - callStart
      console.error(
        `🔍 [${modelName}] Validation thất bại (${latencyOnFail}ms)\n` +
        `   risk_level không hợp lệ: "${parsed.risk_level}" (chỉ chấp nhận: Stable, Fluctuating, High Risk)\n` +
        `   Raw response (150 ký tự đầu): ${responseText.substring(0, 150)}`,
      )
      throw new Error(`INVALID_RISK_LEVEL: "${parsed.risk_level}"`)
    }

    // ── VALIDATION 9: action_plan_48h là array có ít nhất 1 phần tử ──────
    if (!Array.isArray(parsed.action_plan_48h) || parsed.action_plan_48h.length === 0) {
      const latencyOnFail = Date.now() - callStart
      console.error(
        `🔍 [${modelName}] Validation thất bại (${latencyOnFail}ms)\n` +
        `   action_plan_48h không hợp lệ: type=${typeof parsed.action_plan_48h}, length=${Array.isArray(parsed.action_plan_48h) ? (parsed.action_plan_48h as unknown[]).length : 'n/a'}\n` +
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

    // Normalise field name aliases từ Gemini (đôi khi đổi tên)
    const normalized = {
      ...parsed,
      key_signals:           parsed.key_signals           ?? parsed.key_signals_detected,
      intervention_strategy: parsed.intervention_strategy ?? parsed.recommended_intervention_strategy,
    } as AnalysisResult

    return { success: true, data: normalized, latency }

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
// ⚠️ QUOTA THỰC TẾ Free Tier (nguồn: Google AI Studio, 2026-04):
//   Model                         │ RPM │ RPD/key │ Ghi chú
//   ──────────────────────────────┼─────┼─────────┼──────────────────────────
//   gemini-3.1-flash-lite-preview │  15 │   500   │ ← QUOTA CAO NHẤT → ưu tiên 1
//   gemini-2.0-flash-lite         │  30 │   200   │ backup ổn định
//   gemini-2.0-flash              │  15 │   200   │ backup ổn định
//   gemini-2.5-flash              │   5 │    20   │ quota thấp, dùng sau cùng
//   gemini-2.5-flash-lite         │  10 │    20   │ quota thấp, last resort
//
// DB config (model_config table) sẽ override list này nếu đọc được.
// Thứ tự ưu tiên: nhiều RPD nhất trước → ít nhất sau.
const DEFAULT_MODEL_DEFS: Array<{ name: string; timeout: number; priority: string }> = [
  { name: 'gemini-3.1-flash-lite-preview', timeout: 20000, priority: 'primary'  },
  { name: 'gemini-2.0-flash-lite',         timeout: 20000, priority: 'fallback' },
  { name: 'gemini-2.0-flash',              timeout: 20000, priority: 'backup'   },
  { name: 'gemini-2.5-flash',              timeout: 20000, priority: 'backup'   },
  { name: 'gemini-2.5-flash-lite',         timeout: 20000, priority: 'backup'   },
]

export async function analyzeStudyBehavior(
  todayData:   EntryInput,
  historyData: HistoryRow[],
  apiKeysEnv:  string,      // GEMINI_API_KEYS (comma-sep) hoặc GEMINI_API_KEY đơn
  apiKeyEnv?:  string,      // GEMINI_API_KEY backward-compat (optional)
  db?:         D1Database,  // Cloudflare D1 — đọc model_config nếu có
): Promise<AnalysisResult> {
  const overallStart = Date.now()
  // ── Overall timeout: Cloudflare Worker có giới hạn CPU 30s (free) / 30s wall-clock
  // Set tổng thời gian tối đa = 25s để đảm bảo kịp trả response trước khi Worker bị kill
  const OVERALL_TIMEOUT_MS = 25000

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
JSON có đúng 7 fields: risk_level, key_signals (array), short_term_forecast, primary_risk_driver, intervention_strategy, action_plan_48h (array gồm đúng 3 phần tử), monitoring_protocol.`

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
  // Quy tắc rotation:
  //
  //   429 (quota/rate-limit) → thử KEY tiếp theo, CÙNG model
  //     Lý do: key này đã hết quota, key khác có thể vẫn còn
  //
  //   503 / Timeout / Overload → chuyển thẳng sang MODEL tiếp theo (bỏ qua các key còn lại)
  //     Lý do: server đang quá tải toàn cục, thử key khác cũng sẽ bị tương tự
  //             và sẽ tốn quota không cần thiết
  //
  //   401 (invalid key) → đánh dấu key invalid vĩnh viễn, thử key khác cùng model
  //
  //   Parse/Validation error → thử key tiếp theo, cùng model
  //     Lý do: có thể do lỗi tạm thời của key đó
  //
  //   Chuyển model chỉ khi:
  //     a) Tất cả keys đã 429 (quota pool cạn kiệt), HOẶC
  //     b) Gặp 503/timeout (overload) → nhảy model ngay sau 1 lần thử
  //
  // Tên key = vị trí cố định trong pool: March=0, April=1, May=2, June=3, July=4

  const attemptResults: ModelAttempt[] = []
  // Track key đã 401 (invalid) — skip vĩnh viễn trong toàn session
  const invalidKeys   = new Set<number>()
  // Track key đã 429 (quota hết) — skip ưu tiên, thử sau nếu không còn key nào khác
  const exhaustedKeys = new Set<number>()

  for (const modelConfig of modelDefs) {
    // ── Check overall timeout trước khi thử model mới ────────────────────────
    const elapsedOverall = Date.now() - overallStart
    if (elapsedOverall >= OVERALL_TIMEOUT_MS) {
      console.warn(`⏱️ Overall timeout ${OVERALL_TIMEOUT_MS}ms đã hết (${elapsedOverall}ms) — dừng thử models`)
      break
    }

    let modelSucceeded = false
    let skipThisModel  = false

    // Thứ tự key: ưu tiên key chưa exhausted, sau đó mới dùng exhausted
    const keyOrder = [
      ...Array.from({ length: keyPool.length }, (_, i) => i)
        .filter(i => !invalidKeys.has(i) && !exhaustedKeys.has(i)),
      ...Array.from({ length: keyPool.length }, (_, i) => i)
        .filter(i => !invalidKeys.has(i) && exhaustedKeys.has(i)),
    ]

    if (keyOrder.length === 0) {
      console.log(`⛔ [${modelConfig.name}] Không còn key khả dụng — bỏ qua`)
      continue
    }

    // Điều chỉnh timeout của model để không vượt quá overall timeout còn lại
    const remainingMs    = OVERALL_TIMEOUT_MS - (Date.now() - overallStart)
    const effectiveTimeout = Math.min(modelConfig.timeout, Math.max(remainingMs - 500, 3000))

    console.log(`🔄 [${modelConfig.name}] Bắt đầu — timeout=${effectiveTimeout}ms (overall còn ${remainingMs}ms), keys=[${keyOrder.map(i => getKeyName(i)).join(',')}]`)

    // ── Sequential: thử TẤT CẢ keys khả dụng trước khi chuyển model ────────
    // KHÔNG giới hạn số key mỗi model — mỗi key có quota độc lập.
    // Ví dụ: March/April/May hết quota (429) → June/July vẫn dùng được.
    // Nếu chỉ thử 2 key đầu thì bỏ lỡ June/July còn quota → gây fail.

    for (const keyIdx of keyOrder) {
      if (skipThisModel) break

      const key     = keyPool[keyIdx]
      const keyName = getKeyName(keyIdx)
      console.log(`⏳ [${modelConfig.name}][${keyName}] Đang gọi...`)

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
        console.log(`🎯 Hoàn thành [${modelConfig.name}][${keyName}] — total: ${totalElapsed}ms`)
        console.log('📋 Chain:', JSON.stringify(attemptResults))
        return {
          ...outcome.data,
          analyzed_by:     modelConfig.name,
          key_name:        keyName,
          latency:         outcome.latency,
          total_latency:   totalElapsed,
          raw_ai_response: undefined,
        }
      }

      // ── Phân loại lỗi ──────────────────────────────────────────────────
      const msg = outcome.message ?? ''

      if (/429|quota|rate.?limit/i.test(msg)) {
        // Quota hết → thử key tiếp
        console.log(`🔒 [${modelConfig.name}][${keyName}] 429 quota — thử key tiếp`)
        exhaustedKeys.add(keyIdx)

      } else if (/401|invalid.?key/i.test(msg)) {
        // Key không hợp lệ → đánh dấu invalid, thử key tiếp
        console.warn(`🔑 [${modelConfig.name}][${keyName}] 401 invalid key — skip key`)
        invalidKeys.add(keyIdx)

      } else if (/HTTP_400/i.test(msg)) {
        // 400 Bad Request: thường do param không hợp lệ với model này
        // Đây là lỗi cấu hình model (không phải lỗi key) → skip model ngay
        console.warn(`🚫 [${modelConfig.name}][${keyName}] HTTP 400 bad request — skip model: ${msg.slice(0, 120)}`)
        skipThisModel = true

      } else if (/HTTP_403/i.test(msg)) {
        // 403 Forbidden: key không có quyền dùng model này → skip key, thử key khác
        console.warn(`🔑 [${modelConfig.name}][${keyName}] HTTP 403 forbidden — skip key`)
        invalidKeys.add(keyIdx)

      } else if (/HTTP_404/i.test(msg)) {
        // 404 Not Found: model name sai hoặc không tồn tại → skip model ngay
        console.warn(`🚫 [${modelConfig.name}][${keyName}] HTTP 404 model not found — skip model`)
        skipThisModel = true

      } else if (/HTTP_4\d\d/i.test(msg)) {
        // Các 4xx khác (402, 405...): lỗi không xác định → thử key tiếp
        console.warn(`⚠️  [${modelConfig.name}][${keyName}] HTTP 4xx unknown — thử key tiếp: ${msg.slice(0, 80)}`)

      } else if (/503|overload|unavailable|high.?demand/i.test(msg)) {
        // Server quá tải → skip model ngay
        console.log(`⚡ [${modelConfig.name}][${keyName}] 503 overload — skip model`)
        skipThisModel = true

      } else if (/TIMEOUT/i.test(msg)) {
        // Timeout → skip model ngay (nếu key này timeout, key khác cùng model cũng chậm)
        console.log(`⏰ [${modelConfig.name}][${keyName}] Timeout — skip model`)
        skipThisModel = true

      } else {
        // Parse/Validation/network error → thử key tiếp
        console.log(`⚠️  [${modelConfig.name}][${keyName}] ${outcome.error}: ${msg.slice(0, 80)} — thử key tiếp`)
      }
    }

    if (!modelSucceeded) {
      const reason = skipThisModel
        ? 'timeout/503/4xx (skip ngay)'
        : `thử hết ${keyOrder.length} key(s)`
      console.log(`🔁 [${modelConfig.name}] Thất bại (${reason}) — chuyển model tiếp`)
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
