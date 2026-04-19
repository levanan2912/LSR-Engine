import { Hono } from 'hono'
import { ANALYTICAL_RULES } from '../services/gemini'

type Bindings = {
  GEMINI_API_KEY: string
}

const gemini = new Hono<{ Bindings: Bindings }>()

// ─── System prompt — dùng bộ quy tắc cũ làm "vai trò" cho AI ─────────────────
// Khi người dùng hỏi về báo cáo, AI phải trả lời THEO bộ quy tắc ANALYTICAL_RULES:
// - Không dùng ngôn ngữ cảm xúc / động viên
// - Chỉ dựa vào dữ liệu số liệu cụ thể
// - Phân tích hành vi, không đánh giá tính cách
// Tuy nhiên output là TEXT tự do (không ép JSON) vì đây là Q&A, không phải phân tích batch.
const SYSTEM_PROMPT = `${ANALYTICAL_RULES}

===== CHẾ ĐỘ TRẢ LỜI =====
Bạn đang trả lời câu hỏi trực tiếp từ người dùng về báo cáo phân tích học tập của họ.
Không trả về JSON. Trả lời bằng văn xuôi ngắn gọn, trung lập, dựa trên dữ liệu đã cung cấp trong context.
Không được thêm lời khuyên cảm xúc, không động viên, không phán xét.
Nếu câu hỏi yêu cầu thông tin ngoài dữ liệu đã có, hãy nói rõ giới hạn đó.
Trả lời bằng tiếng Việt.`

// ─── POST /api/ask-gemini ─────────────────────────────────────────────────────
// Body: { prompt: string }
// Response: { result: string } | { error: string, message: string }

gemini.post('/ask-gemini', async (c) => {
  try {
    // ── Parse & validate body ──────────────────────────────────────────────────
    const body = await c.req.json().catch(() => ({}))
    const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''

    if (!prompt) {
      return c.json({
        error: 'Validation Error',
        message: 'Trường "prompt" là bắt buộc và không được để trống',
      }, 400)
    }

    if (prompt.length > 10000) {
      return c.json({
        error: 'Validation Error',
        message: 'Prompt quá dài (tối đa 10.000 ký tự)',
      }, 400)
    }

    // ── Build key pool ─────────────────────────────────────────────────────────
    const keyPool = parseApiKeys(c.env.GEMINI_API_KEYS, c.env.GEMINI_API_KEY)
    if (keyPool.length === 0) {
      return c.json({
        error: 'Configuration Error',
        message: 'GEMINI_API_KEY(S) chưa được cấu hình',
      }, 500)
    }

    // ── Model × Key loop (sequential, stop on first success) ──────────────────
    const MODELS = [
      { name: 'gemini-2.5-flash',              maxOutputTokens: 1024 },
      { name: 'gemini-3.1-flash-lite-preview', maxOutputTokens: 1024 },
      { name: 'gemini-2.0-flash',              maxOutputTokens: 1024 },
    ]

    let result  = ''
    let lastErr: unknown
    const invalidKeys = new Set<number>()

    outer:
    for (const m of MODELS) {
      for (let ki = 0; ki < keyPool.length; ki++) {
        if (invalidKeys.has(ki)) continue
        const key   = keyPool[ki]
        const start = Date.now()
        console.log(`🤖 [ask-gemini] ${m.name}[key#${ki + 1}/${keyPool.length}]`)

        try {
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${m.name}:generateContent?key=${key}`
          const reqBody = {
            systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: {
              temperature:     0.1,
              topK:            32,
              topP:            0.8,
              maxOutputTokens: m.maxOutputTokens,
            },
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
            body:    JSON.stringify(reqBody),
          })

          if (!res.ok) {
            const errText = await res.text()
            console.warn(`⚠️  ${m.name}[key#${ki+1}] → ${res.status}`)
            if (res.status === 429) { lastErr = new Error(errText); continue }       // quota → thử key khác
            if (res.status === 503) { lastErr = new Error(errText); break }          // overload → thử model khác
            if (res.status === 401) { invalidKeys.add(ki); lastErr = new Error(errText); continue } // invalid key
            throw new Error(`Gemini ${res.status}: ${errText.slice(0, 200)}`)
          }

          type GeminiResp = {
            candidates: Array<{ content: { parts: Array<{ text: string }> } }>
            promptFeedback?: { blockReason?: string }
          }
          const data = await res.json() as GeminiResp
          if (data.promptFeedback?.blockReason) throw new Error(`Blocked: ${data.promptFeedback.blockReason}`)

          const text = data.candidates?.[0]?.content?.parts?.[0]?.text
          if (!text) throw new Error(`Empty response from ${m.name}`)

          result = text
          console.log(`✅ [ask-gemini] ${m.name}[key#${ki+1}] - ${Date.now() - start}ms`)
          break outer   // success → thoát cả 2 vòng lặp

        } catch (err: unknown) {
          lastErr = err
          const msg = err instanceof Error ? err.message : String(err)
          if (msg.includes('429') || /quota|rate.?limit/i.test(msg)) continue   // thử key khác
          if (msg.includes('503') || /overload|unavailable/i.test(msg)) break    // thử model khác
          throw err   // lỗi không thể recover
        }
      }
    }

    if (!result) throw lastErr ?? new Error('All models exhausted')

    return c.json({ result }, 200)

  } catch (err: unknown) {
    console.error('❌ /api/ask-gemini error:', err)

    const message   = err instanceof Error ? err.message : 'Unknown error'
    const isQuota   = message.includes('429') || message.toLowerCase().includes('quota')
    const isAuth    = message.includes('401') || message.toLowerCase().includes('api key')
    const isInvalid = message.includes('400') && message.toLowerCase().includes('invalid')

    return c.json({
      error:   isQuota ? 'Quota Exceeded' : (isAuth || isInvalid) ? 'Invalid API Key' : 'Gemini Error',
      message,
    }, isQuota ? 429 : (isAuth || isInvalid) ? 401 : 500)
  }
})

export default gemini
