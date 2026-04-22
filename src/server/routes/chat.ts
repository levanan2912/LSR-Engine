import { Hono } from 'hono'
import { authMiddleware } from '../middleware/auth'
import { parseApiKeys } from '../services/gemini'

type Bindings = {
  DB: D1Database
  GEMINI_API_KEY: string
  GEMINI_API_KEYS: string
  JWT_SECRET: string
}

type Variables = {
  userId: number
  email: string
}

const chat = new Hono<{ Bindings: Bindings; Variables: Variables }>()

chat.use('*', authMiddleware)

// ─── System prompt cốt lõi ────────────────────────────────────────────────────
const CHAT_SYSTEM_PROMPT = `Bạn là LSR Coach — một AI coach phân tích dữ liệu học tập tích hợp trong LSR Engine (Learning Stability Risk Engine).

===== TRIẾT LÝ CỐT LÕI =====
• Bạn KHÔNG phải bác sĩ, nhà tâm lý, hay nhà trị liệu.
• Bạn KHÔNG chẩn đoán trạng thái tâm lý hay bệnh lý.
• Bạn KHÔNG động viên cảm xúc chung chung, không nói những câu như "Cố lên!", "Bạn làm tốt lắm!" khi không có căn cứ dữ liệu.
• Bạn CHỈ trao đổi trong phạm vi: hành vi học tập, số liệu phiên học, tín hiệu rủi ro, và chiến lược cải thiện dựa trên dữ liệu.
• Mọi nhận xét PHẢI được neo vào số liệu cụ thể từ context được cung cấp.

===== PHẠM VI ĐƯỢC PHÉP =====
1. Phân tích dữ liệu phiên học: giờ học, focus level, dropout feeling, distraction count
2. Giải thích Risk Level (Stable / Fluctuating / High Risk) và ý nghĩa của nó
3. Giải thích Key Signals, Primary Risk Driver trong báo cáo AI
4. Đề xuất chiến lược cụ thể từ Intervention Plan trong báo cáo
5. Trả lời câu hỏi về phương pháp học tập, quản lý thời gian, tập trung — khi có dữ liệu hỗ trợ
6. So sánh xu hướng giữa các phiên học (nếu có dữ liệu nhiều phiên)

===== PHẠM VI TỪ CHỐI =====
Nếu câu hỏi thuộc các loại sau, từ chối ngắn gọn và định hướng lại:
• Tư vấn tâm lý, sức khỏe tinh thần, trầm cảm, lo âu → "Câu hỏi này nằm ngoài phạm vi của LSR Coach. Nếu bạn đang gặp vấn đề về sức khỏe tâm thần, hãy liên hệ chuyên gia hoặc đường dây hỗ trợ tâm lý."
• Câu hỏi không liên quan đến học tập (tình cảm, tài chính, sự kiện thời sự...) → "LSR Coach chỉ phân tích trong phạm vi dữ liệu học tập. Câu hỏi này nằm ngoài phạm vi."
• Yêu cầu dự đoán kết quả thi cử, điểm số cụ thể → "LSR Coach không dự đoán kết quả học thuật. Tôi chỉ phân tích hành vi và tín hiệu rủi ro trong quá trình học."

===== CÁCH DIỄN ĐẠT =====
• Tiếng Việt, ngắn gọn, trực tiếp. Không hoa mỹ.
• Dùng số liệu cụ thể khi trả lời: "Focus level 2/5 trong 3 phiên gần nhất..." thay vì "Bạn đang học không tốt."
• Phân tích hành vi, không phán xét tính cách hay động lực.
• Câu trả lời 150–350 từ. Dùng bullet point khi liệt kê nhiều điểm.
• Không trả về JSON. Văn xuôi tự nhiên.
• Nếu không có đủ dữ liệu để trả lời, nói rõ: "Không đủ dữ liệu để phân tích điều này. Hãy ghi nhật ký học tập thêm vài phiên."

===== XỬ LÝ KHI KHÔNG CÓ DỮ LIỆU =====
Nếu context không chứa dữ liệu học tập, hướng dẫn người dùng ghi nhật ký phiên học để có dữ liệu phân tích. Không bịa đặt nhận xét.`

// ─── Giới hạn scope câu hỏi (client-side hint, server enforce) ────────────────
const OUT_OF_SCOPE_PATTERNS = [
  /trầm cảm|lo âu|tự tử|rối loạn tâm lý|sức khỏe tâm thần|tâm lý trị liệu/i,
  /bệnh viện|bác sĩ|thuốc|điều trị/i,
  /tình yêu|yêu đương|chia tay|hẹn hò/i,
  /tiền|tài chính|chứng khoán|đầu tư/i,
  /thời sự|chính trị|chiến tranh|bầu cử/i,
  /nấu ăn|du lịch|giải trí|phim|âm nhạc/i,
]

const MODELS = [
  { name: 'gemini-2.5-flash-lite',         maxOutputTokens: 1024 },
  { name: 'gemini-3.1-flash-lite-preview', maxOutputTokens: 1024 },
  { name: 'gemini-2.5-flash',              maxOutputTokens: 1500 },
]

// ─── Helper: build context string từ DB ──────────────────────────────────────
async function buildDBContext(DB: D1Database, userId: number): Promise<string> {
  const rows = await DB.prepare(`
    SELECT
      e.session_date, e.session_number, e.session_time,
      e.study_hours, e.focus_level, e.distraction_count,
      e.distracting_factors, e.goal_achieved, e.dropout_feeling,
      e.emotional_state,
      r.risk_level, r.key_signals, r.short_term_forecast,
      r.primary_risk_driver, r.intervention_strategy,
      r.action_plan_48h, r.monitoring_protocol
    FROM daily_entries e
    LEFT JOIN analysis_reports r ON r.entry_id = e.id
    WHERE e.user_id = ?
    ORDER BY e.session_date DESC, e.session_number DESC
    LIMIT 7
  `).bind(userId).all<Record<string, unknown>>()

  if (!rows.results.length) return ''

  const lines: string[] = ['=== DỮ LIỆU HỌC TẬP GẦN ĐÂY ===']
  rows.results.forEach((row, i) => {
    lines.push(`\n[Phiên ${i + 1}] ${row.session_date} · Buổi ${row.session_number} · ${row.session_time ?? 'N/A'}`)
    lines.push(`  Giờ học: ${row.study_hours}h | Focus: ${row.focus_level}/5 | Dropout: ${row.dropout_feeling}/5 | Mất tập trung: ${row.distraction_count} lần`)
    if (row.distracting_factors) lines.push(`  Yếu tố mất tập trung: ${row.distracting_factors}`)
    lines.push(`  Mục tiêu: ${row.goal_achieved ? '✓ Đạt' : '✗ Chưa đạt'}`)
    if (row.emotional_state) lines.push(`  Cảm xúc: ${row.emotional_state}`)
    if (row.risk_level) {
      lines.push(`  → Risk Level: ${row.risk_level}`)
      if (row.key_signals) {
        try {
          const sigs = JSON.parse(String(row.key_signals))
          if (Array.isArray(sigs) && sigs.length) lines.push(`  → Key Signals: ${sigs.join(' | ')}`)
        } catch { /* ignore */ }
      }
      if (row.primary_risk_driver) lines.push(`  → Primary Risk Driver: ${row.primary_risk_driver}`)
      if (row.short_term_forecast) lines.push(`  → Short-term Forecast: ${row.short_term_forecast}`)
      if (row.intervention_strategy) lines.push(`  → Intervention Strategy: ${row.intervention_strategy}`)
      if (row.action_plan_48h) {
        try {
          const plan = JSON.parse(String(row.action_plan_48h))
          if (Array.isArray(plan) && plan.length) lines.push(`  → 48h Action Plan: ${plan.join(' | ')}`)
        } catch { /* ignore */ }
      }
    }
  })
  return lines.join('\n')
}

// ─── POST /api/chat ────────────────────────────────────────────────────────────
chat.post('/', async (c) => {
  try {
    const userId = c.get('userId')
    const body   = await c.req.json().catch(() => ({})) as Record<string, unknown>

    const message = typeof body.message === 'string' ? body.message.trim() : ''
    // reportContext: structured JSON gửi từ frontend (report hiện tại đang xem)
    const reportContext = typeof body.reportContext === 'string' ? body.reportContext.trim() : ''

    if (!message) return c.json({ error: 'Validation Error', message: 'Tin nhắn không được để trống' }, 400)
    if (message.length > 2000) return c.json({ error: 'Validation Error', message: 'Tin nhắn quá dài (tối đa 2000 ký tự)' }, 400)

    // ─── Kiểm tra out-of-scope sơ bộ ─────────────────────────────────────────
    for (const pat of OUT_OF_SCOPE_PATTERNS) {
      if (pat.test(message)) {
        const isHealthMental = /trầm cảm|lo âu|tự tử|rối loạn tâm lý|sức khỏe tâm thần/i.test(message)
        const reply = isHealthMental
          ? 'Câu hỏi này nằm ngoài phạm vi của LSR Coach. Nếu bạn đang gặp vấn đề về sức khỏe tâm thần, hãy liên hệ chuyên gia tâm lý hoặc đường dây hỗ trợ (VD: 1800 599 920 — miễn phí, 24/7).'
          : 'LSR Coach chỉ phân tích trong phạm vi dữ liệu học tập. Câu hỏi này nằm ngoài phạm vi tôi có thể hỗ trợ.'
        return c.json({ reply, outOfScope: true }, 200)
      }
    }

    // ─── Xây dựng context ─────────────────────────────────────────────────────
    let contextBlock = ''

    // Ưu tiên: report context gửi từ frontend (dữ liệu báo cáo đang xem)
    if (reportContext) {
      contextBlock = reportContext
    } else {
      // Fallback: lấy từ DB
      try {
        contextBlock = await buildDBContext(c.env.DB, userId)
      } catch (dbErr) {
        console.warn('[chat] DB context fetch failed:', dbErr)
      }
    }

    // Luôn enrich thêm lịch sử DB nếu chưa có (ngay cả khi đã có reportContext)
    if (reportContext && !contextBlock.includes('DỮ LIỆU HỌC TẬP GẦN ĐÂY')) {
      try {
        const dbCtx = await buildDBContext(c.env.DB, userId)
        if (dbCtx) contextBlock = reportContext + '\n\n' + dbCtx
      } catch { /* ignore */ }
    }

    const prompt = contextBlock
      ? `${contextBlock}\n\n${'='.repeat(40)}\nCÂU HỎI: ${message}`
      : `[Không có dữ liệu học tập trong context]\n\nCÂU HỎI: ${message}`

    // ─── Gọi Gemini ──────────────────────────────────────────────────────────
    const keyPool = parseApiKeys(c.env.GEMINI_API_KEYS, c.env.GEMINI_API_KEY)
    if (keyPool.length === 0) return c.json({ error: 'Config Error', message: 'API key chưa được cấu hình' }, 500)

    let reply = ''
    let lastErr: unknown
    const invalidKeys = new Set<number>()

    outer:
    for (const m of MODELS) {
      for (let ki = 0; ki < keyPool.length; ki++) {
        if (invalidKeys.has(ki)) continue
        const key = keyPool[ki]
        console.log(`💬 [chat] ${m.name}[key#${ki + 1}] user=${userId}`)

        try {
          const isGemini25 = /gemini-2\.5-/.test(m.name)
          const genConfig: Record<string, unknown> = {
            temperature: 0.25, topK: 32, topP: 0.85,
            maxOutputTokens: m.maxOutputTokens,
          }
          if (isGemini25) genConfig.thinkingConfig = { thinkingBudget: 0 }

          const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${m.name}:generateContent?key=${key}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                systemInstruction: { parts: [{ text: CHAT_SYSTEM_PROMPT }] },
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                generationConfig: genConfig,
                safetySettings: [
                  { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_NONE' },
                  { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'BLOCK_NONE' },
                  { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
                  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
                ],
              }),
            }
          )

          if (!res.ok) {
            const errText = await res.text()
            if (res.status === 429) {
              if (/prepayment|credits.{0,20}depleted/i.test(errText)) invalidKeys.add(ki)
              lastErr = new Error(errText); continue
            }
            if (res.status === 503) { lastErr = new Error(errText); break }
            if (res.status === 401) { invalidKeys.add(ki); lastErr = new Error(errText); continue }
            throw new Error(`HTTP ${res.status}`)
          }

          type GResp = { candidates: Array<{ content: { parts: Array<{ text: string }> } }>; promptFeedback?: { blockReason?: string } }
          const data = await res.json() as GResp
          if (data.promptFeedback?.blockReason) throw new Error(`Blocked: ${data.promptFeedback.blockReason}`)
          const text = data.candidates?.[0]?.content?.parts?.[0]?.text
          if (!text) throw new Error('Empty response')

          reply = text
          console.log(`✅ [chat] ${m.name}[key#${ki + 1}] OK`)
          break outer

        } catch (err) {
          lastErr = err
          const msg = err instanceof Error ? err.message : String(err)
          if (/quota|rate.?limit|429/i.test(msg)) continue
          if (/503|overload|unavailable/i.test(msg)) break
          throw err
        }
      }
    }

    if (!reply) throw lastErr ?? new Error('All models exhausted')

    return c.json({ reply }, 200)

  } catch (err) {
    console.error('❌ [chat] error:', err)
    return c.json({ error: 'Chat Error', message: 'AI không phản hồi. Thử lại sau.' }, 500)
  }
})

export default chat
