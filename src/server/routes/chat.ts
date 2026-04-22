import { Hono } from 'hono'
import { authMiddleware } from '../middleware/auth'
import { ANALYTICAL_RULES, parseApiKeys } from '../services/gemini'

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

// ─── System prompt cho chatbot ─────────────────────────────────────────────────
const CHAT_SYSTEM_PROMPT = `${ANALYTICAL_RULES}

===== CHẾ ĐỘ TRỢ LÝ CHAT =====
Bạn là trợ lý AI tích hợp trong ứng dụng LSR Engine — hệ thống phân tích hành vi học tập.
Nhiệm vụ: trả lời câu hỏi của người dùng về dữ liệu học tập, báo cáo phân tích, và chiến lược cải thiện.

Quy tắc trả lời:
- Trả lời bằng tiếng Việt, ngắn gọn, trực tiếp vào vấn đề.
- Dựa trên dữ liệu học tập được cung cấp trong context (nếu có).
- Không dùng ngôn ngữ cảm xúc, không động viên sáo rỗng, không phán xét.
- Phân tích hành vi dựa trên số liệu, không suy đoán về tính cách.
- Nếu câu hỏi nằm ngoài phạm vi dữ liệu học tập, trả lời ngắn gọn và đề nghị người dùng cung cấp thêm dữ liệu.
- Có thể trả lời các câu hỏi chung về học tập, phương pháp học, tập trung, quản lý thời gian.
- Không trả về JSON. Trả lời bằng văn xuôi tự nhiên.
- Giới hạn câu trả lời khoảng 200–400 từ trừ khi cần giải thích chi tiết.`

const MODELS = [
  { name: 'gemini-2.5-flash-lite',         maxOutputTokens: 1024 },
  { name: 'gemini-3.1-flash-lite-preview', maxOutputTokens: 1024 },
  { name: 'gemini-2.5-flash',              maxOutputTokens: 1024 },
]

// ─── POST /api/chat ────────────────────────────────────────────────────────────
chat.post('/', async (c) => {
  try {
    const userId = c.get('userId')
    const body = await c.req.json().catch(() => ({}))
    const message  = typeof body.message  === 'string' ? body.message.trim()  : ''
    const context  = typeof body.context  === 'string' ? body.context.trim()  : ''

    if (!message) return c.json({ error: 'Validation Error', message: 'Tin nhắn không được để trống' }, 400)
    if (message.length > 2000) return c.json({ error: 'Validation Error', message: 'Tin nhắn quá dài (tối đa 2000 ký tự)' }, 400)

    // Lấy dữ liệu gần nhất của user để làm context
    let userContext = context
    if (!userContext) {
      try {
        const recentEntries = await c.env.DB.prepare(`
          SELECT e.session_date, e.session_number, e.session_time,
                 e.study_hours, e.focus_level, e.distraction_count,
                 e.distracting_factors, e.goal_achieved, e.dropout_feeling,
                 e.emotional_state,
                 r.risk_level, r.key_signals, r.short_term_forecast,
                 r.primary_risk_driver, r.intervention_strategy
          FROM daily_entries e
          LEFT JOIN analysis_reports r ON r.entry_id = e.id
          WHERE e.user_id = ?
          ORDER BY e.session_date DESC, e.session_number DESC
          LIMIT 5
        `).bind(userId).all<Record<string, unknown>>()

        if (recentEntries.results.length > 0) {
          const lines = ['=== DỮ LIỆU HỌC TẬP GẦN ĐÂY ===']
          recentEntries.results.forEach((row, i) => {
            lines.push(`\nPhiên ${i + 1}: ${row.session_date} S${row.session_number} lúc ${row.session_time ?? 'N/A'}`)
            lines.push(`- Thời gian: ${row.study_hours}h`)
            lines.push(`- Tập trung: ${row.focus_level}/5`)
            lines.push(`- Mất tập trung: ${row.distraction_count} lần${row.distracting_factors ? ` (${row.distracting_factors})` : ''}`)
            lines.push(`- Mục tiêu: ${row.goal_achieved ? 'Đạt' : 'Chưa đạt'}`)
            lines.push(`- Bỏ cuộc: ${row.dropout_feeling}/5`)
            if (row.emotional_state) lines.push(`- Cảm xúc: ${row.emotional_state}`)
            if (row.risk_level) {
              lines.push(`- Đánh giá AI: ${row.risk_level}`)
              if (row.key_signals) {
                try {
                  const sigs = JSON.parse(String(row.key_signals))
                  if (Array.isArray(sigs)) lines.push(`- Tín hiệu: ${sigs.join('; ')}`)
                } catch { /* ignore */ }
              }
              if (row.primary_risk_driver) lines.push(`- Vấn đề cốt lõi: ${row.primary_risk_driver}`)
            }
          })
          userContext = lines.join('\n')
        }
      } catch (dbErr) {
        console.warn('[chat] DB context fetch failed:', dbErr)
      }
    }

    const prompt = userContext
      ? `${userContext}\n\n===========================\nCÂU HỎI CỦA NGƯỜI DÙNG:\n${message}`
      : message

    // Key pool
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
            temperature: 0.3, topK: 40, topP: 0.9,
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
    const message = err instanceof Error ? err.message : 'Unknown error'
    return c.json({ error: 'Chat Error', message: 'AI không phản hồi. Thử lại sau.' }, 500)
  }
})

export default chat
