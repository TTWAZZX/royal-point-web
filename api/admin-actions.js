const crypto = require('crypto')
const { supabaseAdmin, getRedis, clearScoreCache } = require('../lib/supabase')
const { auditEvent } = require('../lib/audit')
const { AuthError, authenticateRequest, sendAuthError } = require('../lib/line-auth')
const {
  buildPointAdjustmentMessage,
  buildRedemptionCancelledMessage,
  buildRedemptionReceivedMessage,
  buildRecoveryApprovedMessage,
  queueLineNotification,
  retryLineNotification,
  userHistoryUrl,
  userRedemptionUrl,
  userRecoveryUrl
} = require('../lib/line-messaging')
const redis = getRedis()

const ALLOWED_REWARD_FIELDS = ['name', 'cost', 'stock', 'stock_max', 'active', 'img_url', 'sort_index']
const TIME_ZONE = 'Asia/Bangkok'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const AD_BUCKET = 'ad-banners'
const AD_MAX_BYTES = 2 * 1024 * 1024
const AD_MIME_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

function cleanAdText(value, max = 160) {
  return String(value || '').trim().slice(0, max)
}

function safeHttpsUrl(value, { required = false } = {}) {
  const raw = String(value || '').trim()
  if (!raw && !required) return null
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:') return null
    const host = url.hostname.toLowerCase()
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) return null
    return url.toString()
  } catch (_) {
    return null
  }
}

function decodeAdImage(dataUrl) {
  const match = String(dataUrl || '').match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/)
  if (!match) throw new Error('ad_image_invalid')
  const mime = match[1]
  const buffer = Buffer.from(match[2], 'base64')
  if (!buffer.length || buffer.length > AD_MAX_BYTES) throw new Error('ad_image_size_invalid')
  const valid = mime === 'image/jpeg'
    ? buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
    : mime === 'image/png'
      ? buffer.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))
      : buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  if (!valid) throw new Error('ad_image_signature_invalid')
  return { mime, buffer, ext: AD_MIME_EXT[mime] }
}

async function uploadAdImage(dataUrl) {
  const image = decodeAdImage(dataUrl)
  const path = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${image.ext}`
  const { error } = await supabaseAdmin.storage.from(AD_BUCKET).upload(path, image.buffer, {
    contentType: image.mime,
    cacheControl: '31536000',
    upsert: false
  })
  if (error) throw error
  const { data } = supabaseAdmin.storage.from(AD_BUCKET).getPublicUrl(path)
  return { path, url: data.publicUrl }
}

async function removeAdImage(path) {
  if (!path) return
  const { error } = await supabaseAdmin.storage.from(AD_BUCKET).remove([path])
  if (error) console.error('[admin-actions] ad image cleanup failed:', error.message)
}

function adminErrorMessage(error) {
  const raw = String(error?.message || error || '')
  const upper = raw.toUpperCase()
  const labels = {
    ADJUSTMENT_REASON_REQUIRED: 'กรุณาระบุเหตุผลอย่างน้อย 3 ตัวอักษร',
    INVALID_ADJUSTMENT_AMOUNT: 'จำนวนคะแนนไม่ถูกต้อง',
    INSUFFICIENT_POINTS: 'คะแนนของผู้ใช้ไม่เพียงพอสำหรับการตัดคะแนน',
    REDEMPTION_NOT_FOUND: 'ไม่พบรายการแลกของรางวัล',
    REDEMPTION_NOT_RECEIVABLE: 'รายการนี้ไม่สามารถยืนยันการรับของได้',
    REDEMPTION_NOT_CANCELLABLE: 'ยกเลิกได้เฉพาะรายการที่ยังรอรับของ',
    CANCEL_REASON_REQUIRED: 'กรุณาระบุเหตุผลการยกเลิกอย่างน้อย 3 ตัวอักษร'
  }
  const found = Object.keys(labels).find(code => upper.includes(code))
  return found ? labels[found] : raw
}
const GEMINI_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-3.1-flash-lite'
]
const SAFETY_ACTIONS = new Set([
  'safety_question_create',
  'safety_question_batch_create',
  'safety_question_update',
  'safety_question_delete',
  'safety_question_hard_delete',
  'safety_generate_questions',
  'safety_risk_update',
  'safety_streak_reset',
  'safety_settings_update'
])

function uidList(value = '') {
  return String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
}

function getAdminRole(uid = '') {
  const cleanUid = String(uid || '').trim()
  if (!cleanUid) return null
  if (cleanUid === process.env.ADMIN_UID) return 'super_admin'
  if (uidList(process.env.SAFETY_ADMIN_UIDS).includes(cleanUid)) return 'safety_admin'
  if (uidList(process.env.SAFETY_VIEWER_UIDS).includes(cleanUid)) return 'safety_viewer'
  return null
}

function hasAdminAccess(uid = '', scope = 'full') {
  const role = getAdminRole(uid)
  if (!role) return false
  if (scope === 'full') return role === 'super_admin'
  if (scope === 'safety_write') return role === 'super_admin' || role === 'safety_admin'
  if (scope === 'safety_read') return role === 'super_admin' || role === 'safety_admin' || role === 'safety_viewer'
  return false
}

function forbidden(res) {
  return res.status(403).json({ status: 'error', message: 'Forbidden' })
}
const SAFETY_DEFAULT_OPTIONS = [
  {
    label: 'พร้อมและปลอดภัย',
    description: 'พร้อมเริ่มงานตามมาตรฐานความปลอดภัย',
    answer: 'ready',
    answerText: 'พร้อมทำงาน ไม่มีประเด็นความเสี่ยง',
    mood: 'ready',
    riskFlag: false
  },
  {
    label: 'พบจุดเสี่ยงเล็กน้อย',
    description: 'รับทราบและจะระวังหรือแจ้งหัวหน้างาน',
    answer: 'minor_risk',
    answerText: 'พบความเสี่ยง ควรเฝ้าระวังหรือติดตาม',
    mood: 'risk',
    riskFlag: true
  },
  {
    label: 'ต้องการให้ติดตาม',
    description: 'มีประเด็นที่ควรให้ จป./หัวหน้างานช่วยดู',
    answer: 'need_support',
    answerText: 'ต้องการให้แอดมินหรือหัวหน้างานติดตาม',
    mood: 'support',
    riskFlag: true
  }
]

function getSafeRewardData(rewardData = {}) {
  const safeData = Object.fromEntries(
    Object.entries(rewardData || {}).filter(([k]) => ALLOWED_REWARD_FIELDS.includes(k))
  )

  for (const key of ['cost', 'stock', 'stock_max', 'sort_index']) {
    if (key in safeData) {
      const value = Number(safeData[key])
      if (!Number.isFinite(value)) delete safeData[key]
      else safeData[key] = value
    }
  }

  if ('active' in safeData) safeData.active = !!safeData.active
  if ('name' in safeData) safeData.name = String(safeData.name || '').trim()
  if ('img_url' in safeData) safeData.img_url = String(safeData.img_url || '').trim()

  return safeData
}

function bangkokDate(offsetDays = 0) {
  const now = new Date()
  const bangkokNow = new Date(now.toLocaleString('en-US', { timeZone: TIME_ZONE }))
  bangkokNow.setDate(bangkokNow.getDate() + offsetDays)
  const year = bangkokNow.getFullYear()
  const month = String(bangkokNow.getMonth() + 1).padStart(2, '0')
  const day = String(bangkokNow.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function normalizeSafetyOptions(options) {
  const source = Array.isArray(options) && options.length ? options : SAFETY_DEFAULT_OPTIONS
  return [0, 1, 2].map((index) => {
    const option = source[index] || SAFETY_DEFAULT_OPTIONS[index] || {}
    const answer = String(option?.answer || (index === 0 ? 'ready' : index === 1 ? 'minor_risk' : 'need_support')).trim()
    const safeAnswer = ['ready', 'minor_risk', 'need_support'].includes(answer) ? answer : 'ready'
    const mood = String(option?.mood || (safeAnswer === 'minor_risk' ? 'risk' : safeAnswer === 'need_support' ? 'support' : 'ready')).trim()
    const safeMood = ['ready', 'tired', 'risk', 'support'].includes(mood) ? mood : 'ready'
    return {
      label: String(option?.label || SAFETY_DEFAULT_OPTIONS[index]?.label || 'ตัวเลือก').trim().slice(0, 80),
      description: String(option?.description || SAFETY_DEFAULT_OPTIONS[index]?.description || '').trim().slice(0, 180),
      answer: safeAnswer,
      answerText: String(option?.answerText || option?.answer_text || SAFETY_DEFAULT_OPTIONS[index]?.answerText || '').trim().slice(0, 120),
      mood: safeMood,
      riskFlag: Boolean(option?.riskFlag ?? safeAnswer !== 'ready')
    }
  })
}

function safeSafetyQuestion(row) {
  if (!row) return null
  return {
    id: row.id,
    category: row.category || 'general',
    question: row.question || '',
    options: normalizeSafetyOptions(row.options),
    active: Boolean(row.active),
    source: row.source || 'admin',
    created_by: row.created_by || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null
  }
}

function safeSafetySettings(row) {
  return {
    checkinTimeEnabled: Boolean(row?.checkin_time_enabled),
    checkinStartTime: row?.checkin_start_time || '06:00',
    checkinEndTime: row?.checkin_end_time || '18:00',
    streakResetDate: row?.streak_reset_date || null,
    updatedBy: row?.updated_by || null,
    updatedAt: row?.updated_at || null
  }
}

const SAFETY_CATEGORY_CONTEXT = {
  general: {
    label: 'ทั่วไป',
    focus: 'daily readiness, hazard awareness, housekeeping, safe work planning, and speaking up before work starts',
    mustInclude: ['ความพร้อมก่อนเริ่มงาน', 'การสังเกตจุดเสี่ยง', 'การแจ้งหัวหน้างานหรือ จป. เมื่อไม่มั่นใจ'],
    avoid: ['deep PPE-specific inspection', 'chemical handling details', 'ergonomics-only wording']
  },
  ppe: {
    label: 'PPE',
    focus: 'personal protective equipment selection, fit, condition, replacement, and correct use for the planned task',
    mustInclude: ['อุปกรณ์ป้องกันส่วนบุคคล', 'สภาพ/ขนาด/ความพอดี', 'การเปลี่ยนหรือขออุปกรณ์เมื่อไม่พร้อม'],
    avoid: ['chemical storage as the main topic', 'general mood questions without PPE context']
  },
  chemical: {
    label: 'สารเคมี',
    focus: 'chemical labels, SDS awareness, storage, spills, ventilation, containers, and safe handling readiness',
    mustInclude: ['ฉลากหรือ SDS', 'การรั่วไหล/หก/กลิ่นผิดปกติ', 'ภาชนะและพื้นที่จัดเก็บสารเคมี'],
    avoid: ['PPE-only questions without chemical context', 'medical diagnosis or asking for private health details']
  },
  ergonomics: {
    label: 'Ergonomics',
    focus: 'posture, lifting, repetitive work, workstation setup, tool height, fatigue prevention, and task rotation',
    mustInclude: ['ท่าทางการทำงาน', 'การยก/ดัน/ลากหรือทำซ้ำ', 'การปรับอุปกรณ์หรือขอช่วยเหลือก่อนบาดเจ็บ'],
    avoid: ['chemical, PPE, or environmental compliance as the main topic']
  },
  environment: {
    label: 'สิ่งแวดล้อม',
    focus: 'waste segregation, spills, water/energy use, dust, odor, noise, drainage, and environmental incident reporting',
    mustInclude: ['ของเสีย/น้ำเสีย/การรั่วไหล', 'ฝุ่น/กลิ่น/เสียง/สภาพแวดล้อมผิดปกติ', 'การแจ้งเหตุด้านสิ่งแวดล้อม'],
    avoid: ['employee discipline', 'general safety readiness without environmental context']
  },
  near_miss: {
    label: 'Near miss',
    focus: 'near miss observation, unsafe conditions, unsafe acts, stopping work safely, reporting, and learning before injury',
    mustInclude: ['เหตุเกือบเกิดอุบัติเหตุ', 'สภาพหรือพฤติกรรมไม่ปลอดภัย', 'การรายงานเพื่อป้องกันซ้ำโดยไม่กล่าวโทษ'],
    avoid: ['blame, punishment, or asking who caused the event']
  }
}

function normalizeQuestionText(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/[“”"'.!?;:()[\]{}<>/\\|,，。！？ๆฯ]/g, '')
    .replace(/\s+/g, '')
    .trim()
}

async function getExistingSafetyQuestionTexts() {
  try {
    const { data, error } = await supabaseAdmin
      .from('safety_questions')
      .select('question')
      .limit(1000)
    if (error) throw error
    return (data || []).map(row => row.question).filter(Boolean)
  } catch (error) {
    if (/safety_questions|schema cache|relation .* does not exist|Could not find the table/i.test(String(error?.message || error))) {
      return []
    }
    throw error
  }
}

async function getSafetySettings() {
  try {
    const { data, error } = await supabaseAdmin
      .from('safety_settings')
      .select('checkin_time_enabled,checkin_start_time,checkin_end_time,streak_reset_date,updated_by,updated_at')
      .eq('id', 'global')
      .maybeSingle()

    if (error) throw error
    return safeSafetySettings(data)
  } catch (error) {
    if (/streak_reset_date|schema cache|column .* does not exist/i.test(String(error?.message || error))) {
      const { data, error: fallbackError } = await supabaseAdmin
        .from('safety_settings')
        .select('checkin_time_enabled,checkin_start_time,checkin_end_time,updated_by,updated_at')
        .eq('id', 'global')
        .maybeSingle()
      if (fallbackError) throw fallbackError
      return safeSafetySettings(data)
    }
    if (/safety_settings|schema cache|relation .* does not exist/i.test(String(error?.message || error))) {
      return safeSafetySettings(null)
    }
    throw error
  }
}

async function generateSafetyQuestionsWithGemini({ category = 'general', tone = 'practical', count = 10, existingQuestions = [] }) {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    const error = new Error('gemini_key_missing')
    error.statusCode = 400
    throw error
  }

  const safeCount = Math.max(1, Math.min(Number(count || 10), 10))
  const safeCategory = SAFETY_CATEGORY_CONTEXT[category] ? String(category) : 'general'
  const categoryContext = SAFETY_CATEGORY_CONTEXT[safeCategory]
  const existingNormalized = new Set((existingQuestions || []).map(normalizeQuestionText).filter(Boolean))
  const duplicateExamples = (existingQuestions || [])
    .map(item => String(item || '').trim())
    .filter(Boolean)
    .slice(0, 80)
  const prompt = `
Create ${safeCount} Thai daily safety check-in questions for an enterprise workplace.
Selected category key: ${safeCategory}
Selected category label: ${categoryContext.label}
Category focus: ${categoryContext.focus}
Every question must directly fit the selected category. Do not switch to another category.
Must include ideas from this category: ${categoryContext.mustInclude.join(', ')}
Avoid for this category: ${categoryContext.avoid.join(', ')}
Style: ${tone}
Scope: occupational safety, occupational health, environment, near miss prevention, fit for work, only when relevant to the selected category.
Governance: non-punitive, privacy-aware, no blame, no medical diagnosis, no requests for sensitive personal health details.
Return only JSON with this shape:
{"questions":[{"category":"...","question":"...","options":[{"label":"...","description":"...","answer":"ready","answerText":"...","mood":"ready","riskFlag":false},{"label":"...","description":"...","answer":"minor_risk","answerText":"...","mood":"risk","riskFlag":true},{"label":"...","description":"...","answer":"need_support","answerText":"...","mood":"support","riskFlag":true}]}]}
Questions must be short, clear, non-punitive, and suitable for daily check-in.
Questions must focus on workplace readiness or hazard reporting, not employee discipline.
Set every returned category exactly to "${safeCategory}".
Do not duplicate or closely paraphrase any existing question.
Existing questions to avoid:
${duplicateExamples.length ? duplicateExamples.map((item, index) => `${index + 1}. ${item}`).join('\n') : '- none'}
Each question must have exactly 3 options.
Keep the answer codes exactly as ready, minor_risk, and need_support so the app can score risk consistently.
Make option labels and descriptions specific to the question and category.
For every option, answerText must explain the meaning/outcome in Thai for the admin, not repeat the answer code.
Do not reuse generic labels such as "พร้อมและปลอดภัย", "พบจุดเสี่ยงเล็กน้อย", or "ต้องการให้ติดตาม" unless they are truly the best wording for that exact question.
`.trim()

  let lastError = null
  for (const model of GEMINI_MODELS) {
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey
        },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.9
          }
        })
      })

      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.error?.message || `Gemini ${model} failed`)

      const text = payload?.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('') || ''
      const parsed = JSON.parse(text)
      const batchNormalized = new Set()
      const questions = (Array.isArray(parsed?.questions) ? parsed.questions : [])
        .filter(item => item?.question)
        .map(item => {
          const question = String(item.question || '').trim().slice(0, 240)
          return {
            category: safeCategory,
            question,
            options: normalizeSafetyOptions(item.options),
            source: 'gemini',
            model,
            normalized: normalizeQuestionText(question)
          }
        })
        .filter(item => {
          if (!item.normalized || existingNormalized.has(item.normalized) || batchNormalized.has(item.normalized)) return false
          batchNormalized.add(item.normalized)
          return true
        })
        .map(({ normalized, ...item }) => item)

      if (questions.length) return { model, questions }
      throw new Error(`Gemini ${model} returned no questions`)
    } catch (error) {
      lastError = error
    }
  }

  const error = new Error(lastError?.message || 'gemini_generation_failed')
  error.statusCode = 502
  throw error
}

function monthWindow(monthText = '') {
  const match = String(monthText || '').match(/^(\d{4})-(\d{2})$/)
  const nowDate = bangkokDate()
  const fallback = nowDate.slice(0, 7)
  const month = match ? String(monthText) : fallback
  const [year, monthNumber] = month.split('-').map(Number)
  const start = `${year}-${String(monthNumber).padStart(2, '0')}-01`
  const endDate = new Date(Date.UTC(year, monthNumber, 0))
  const end = `${year}-${String(monthNumber).padStart(2, '0')}-${String(endDate.getUTCDate()).padStart(2, '0')}`
  return { month, start, end }
}

function streakLevel(streak) {
  const d = Number(streak || 0)
  if (d >= 30) return 'champion'
  if (d >= 15) return 'gold'
  if (d >= 7)  return 'silver'
  if (d >= 3)  return 'bronze'
  return 'starter'
}

async function getSafetyPulse(dateText = '') {
  const checkinDate = /^\d{4}-\d{2}-\d{2}$/.test(String(dateText || '')) ? String(dateText) : bangkokDate()

  const [usersResult, checkinsInitialResult] = await Promise.all([
    supabaseAdmin.from('users').select('id,uid,name,room'),
    supabaseAdmin
      .from('daily_checkins')
      .select(`
        id,
        uid,
        checkin_date,
        streak,
        safety_answer,
        safety_mood,
        safety_note,
        risk_flag,
        risk_status,
        risk_admin_note,
        risk_ack_by,
        risk_ack_at,
        risk_resolved_by,
        risk_resolved_at,
        created_at,
        users:user_id ( name, uid, room )
      `)
      .eq('checkin_date', checkinDate)
      .order('created_at', { ascending: false })
  ])

  if (usersResult.error) throw usersResult.error
  let checkinsResult = checkinsInitialResult
  if (checkinsResult.error && /risk_status|risk_admin_note|risk_ack|risk_resolved|schema cache|column .* does not exist/i.test(String(checkinsResult.error.message || checkinsResult.error.details || ''))) {
    checkinsResult = await supabaseAdmin
      .from('daily_checkins')
      .select(`
        id,
        uid,
        checkin_date,
        streak,
        safety_answer,
        safety_mood,
        safety_note,
        risk_flag,
        created_at,
        users:user_id ( name, uid, room )
      `)
      .eq('checkin_date', checkinDate)
      .order('created_at', { ascending: false })
  }
  if (checkinsResult.error) throw checkinsResult.error

  const users = usersResult.data || []
  const rows = checkinsResult.data || []
  const uniqueUids = new Set(rows.map(row => row.uid).filter(Boolean))
  const ready = rows.filter(row => row.safety_answer === 'ready' || row.safety_mood === 'ready').length
  const risk = rows.filter(row => row.risk_flag || row.safety_answer === 'minor_risk' || row.safety_mood === 'risk').length
  const support = rows.filter(row => row.safety_answer === 'need_support' || row.safety_mood === 'support').length
  const total = users.length

  const departmentsMap = new Map()
  for (const user of users) {
    const room = user.room || 'ไม่ระบุ'
    const current = departmentsMap.get(room) || { room, totalUsers: 0, checkins: 0, ready: 0, risk: 0, support: 0, participationRate: 0 }
    current.totalUsers += 1
    departmentsMap.set(room, current)
  }

  for (const row of rows) {
    const room = row.users?.room || 'ไม่ระบุ'
    const current = departmentsMap.get(room) || { room, totalUsers: 0, checkins: 0, ready: 0, risk: 0, support: 0, participationRate: 0 }
    current.checkins += 1
    if (row.safety_answer === 'ready' || row.safety_mood === 'ready') current.ready += 1
    if (row.risk_flag || row.safety_answer === 'minor_risk' || row.safety_mood === 'risk') current.risk += 1
    if (row.safety_answer === 'need_support' || row.safety_mood === 'support') current.support += 1
    departmentsMap.set(room, current)
  }

  const departments = Array.from(departmentsMap.values())
    .map(dep => ({
      ...dep,
      participationRate: dep.totalUsers > 0 ? Math.round((dep.checkins / dep.totalUsers) * 100) : 0,
      pending: Math.max(Number(dep.totalUsers || 0) - Number(dep.checkins || 0), 0)
    }))
    .sort((a, b) => b.participationRate - a.participationRate || b.checkins - a.checkins || a.risk - b.risk || a.room.localeCompare(b.room))

  const riskItems = rows
    .filter(row => row.risk_flag || row.safety_answer === 'minor_risk' || row.safety_answer === 'need_support' || row.safety_mood === 'risk' || row.safety_mood === 'support')
    .slice(0, 20)
    .map(row => ({
      id: row.id,
      uid: row.uid,
      name: row.users?.name || 'ไม่ระบุชื่อ',
      room: row.users?.room || 'ไม่ระบุ',
      answer: row.safety_answer || '',
      mood: row.safety_mood || '',
      note: row.safety_note || '',
      riskFlag: Boolean(row.risk_flag),
      riskStatus: row.risk_status || (row.risk_flag ? 'new' : 'none'),
      riskAdminNote: row.risk_admin_note || '',
      riskAckBy: row.risk_ack_by || null,
      riskAckAt: row.risk_ack_at || null,
      riskResolvedBy: row.risk_resolved_by || null,
      riskResolvedAt: row.risk_resolved_at || null,
      created_at: row.created_at
    }))

  // Streak levels for checked-in users today
  const streakLevels = { starter: 0, bronze: 0, silver: 0, gold: 0, champion: 0 }
  for (const row of rows) {
    const lv = streakLevel(row.streak)
    streakLevels[lv] = (streakLevels[lv] || 0) + 1
  }

  // Fetch yesterday's streaks for pending users so admin can see who is about to lose their streak
  const pendingUids = users.filter(u => u.uid && !uniqueUids.has(u.uid)).map(u => u.uid)
  let yesterdayStreakMap = {}
  if (pendingUids.length) {
    const yesterday = bangkokDate(-1)
    const { data: ydRows } = await supabaseAdmin
      .from('daily_checkins')
      .select('uid, streak')
      .in('uid', pendingUids)
      .eq('checkin_date', yesterday)
    for (const row of ydRows || []) {
      yesterdayStreakMap[row.uid] = Number(row.streak || 0)
    }
  }

  const pendingItems = users
    .filter(user => user.uid && !uniqueUids.has(user.uid))
    .map(user => ({
      uid: user.uid,
      name: user.name || 'ไม่ระบุชื่อ',
      room: user.room || 'ไม่ระบุ',
      streak: yesterdayStreakMap[user.uid] || 0
    }))
    .sort((a, b) => (b.streak - a.streak) || String(a.room || '').localeCompare(String(b.room || '')) || String(a.name || '').localeCompare(String(b.name || '')))

  return {
    date: checkinDate,
    totalUsers: total,
    checkedIn: uniqueUids.size,
    participationRate: total > 0 ? Math.round((uniqueUids.size / total) * 100) : 0,
    ready,
    risk,
    support,
    departments,
    riskItems,
    pendingItems,
    streakLevels
  }
}

async function getSafetyMonthlySummary(monthText = '') {
  const window = monthWindow(monthText)
  const [usersResult, checkinsResult] = await Promise.all([
    supabaseAdmin.from('users').select('id,uid,room'),
    supabaseAdmin
      .from('daily_checkins')
      .select('id,uid,checkin_date,safety_answer,safety_mood,risk_flag,users:user_id ( room )')
      .gte('checkin_date', window.start)
      .lte('checkin_date', window.end)
  ])

  if (usersResult.error) throw usersResult.error
  if (checkinsResult.error) throw checkinsResult.error

  const users = usersResult.data || []
  const rows = checkinsResult.data || []
  const totalUsers = users.length
  const dailyMap = new Map()
  const departmentMap = new Map()

  for (const user of users) {
    const room = user.room || 'ไม่ระบุ'
    const current = departmentMap.get(room) || { room, totalUsers: 0, checkins: 0, risk: 0, support: 0 }
    current.totalUsers += 1
    departmentMap.set(room, current)
  }

  for (const row of rows) {
    const date = row.checkin_date
    const isRisk = Boolean(row.risk_flag) || row.safety_answer === 'minor_risk' || row.safety_mood === 'risk'
    const isSupport = row.safety_answer === 'need_support' || row.safety_mood === 'support'
    const daily = dailyMap.get(date) || { date, checkins: 0, risk: 0, support: 0 }
    daily.checkins += 1
    if (isRisk) daily.risk += 1
    if (isSupport) daily.support += 1
    dailyMap.set(date, daily)

    const room = row.users?.room || 'ไม่ระบุ'
    const dep = departmentMap.get(room) || { room, totalUsers: 0, checkins: 0, risk: 0, support: 0 }
    dep.checkins += 1
    if (isRisk) dep.risk += 1
    if (isSupport) dep.support += 1
    departmentMap.set(room, dep)
  }

  const activeDays = dailyMap.size
  const risk = rows.filter(row => row.risk_flag || row.safety_answer === 'minor_risk' || row.safety_mood === 'risk').length
  const support = rows.filter(row => row.safety_answer === 'need_support' || row.safety_mood === 'support').length
  const today = bangkokDate()
  const periodEnd = window.end > today ? today : window.end
  const periodDays = Math.max(1, Math.floor((new Date(`${periodEnd}T00:00:00Z`) - new Date(`${window.start}T00:00:00Z`)) / 86400000) + 1)
  const possible = Math.max(totalUsers * periodDays, 1)

  return {
    month: window.month,
    start: window.start,
    end: window.end,
    periodEnd,
    periodDays,
    totalUsers,
    totalCheckins: rows.length,
    activeDays,
    averageParticipationRate: Math.round((rows.length / possible) * 100),
    riskRate: rows.length > 0 ? Math.round((risk / rows.length) * 100) : 0,
    supportRate: rows.length > 0 ? Math.round((support / rows.length) * 100) : 0,
    risk,
    support,
    daily: Array.from(dailyMap.values())
      .map(day => ({
        ...day,
        participationRate: totalUsers > 0 ? Math.round((day.checkins / totalUsers) * 100) : 0,
        riskRate: day.checkins > 0 ? Math.round((day.risk / day.checkins) * 100) : 0
      }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    departments: Array.from(departmentMap.values())
      .map(dep => ({
        ...dep,
        averagePerUser: dep.totalUsers > 0 ? Number((dep.checkins / dep.totalUsers).toFixed(1)) : 0,
        participationRate: dep.totalUsers > 0 ? Math.round((dep.checkins / Math.max(dep.totalUsers * periodDays, 1)) * 100) : 0,
        riskRate: dep.checkins > 0 ? Math.round((dep.risk / dep.checkins) * 100) : 0
      }))
      .sort((a, b) => b.participationRate - a.participationRate || b.riskRate - a.riskRate || a.room.localeCompare(b.room))
  }
}

module.exports = async (req, res) => {
  if (!['GET', 'POST'].includes(req.method)) {
    return res.status(405).json({ status: 'error', message: 'Method not allowed' })
  }

  const claimedAdminUid = String(
    req.method === 'GET'
      ? (req.query.adminUid || req.query.uid || '')
      : (req.body?.adminUid || '')
  ).trim()
  try {
    await authenticateRequest(req, { claimedUid: claimedAdminUid, allowRecovery: false })
  } catch (error) {
    if (error instanceof AuthError) return sendAuthError(res, error)
    console.error('[admin-actions] auth error:', error)
    return res.status(500).json({ status: 'error', message: 'AUTH_ERROR', code: 'AUTH_ERROR' })
  }

  // GET /api/admin-actions?uid=... → ตรวจว่าเป็น admin หรือไม่ (ใช้โดย checkAdminFromServer)
  if (req.method === 'GET') {
    if (req.query.action === 'ad_banners') {
      try {
        const adminUid = String(req.query.adminUid || '').trim()
        if (!hasAdminAccess(adminUid, 'full')) return forbidden(res)
        const { data, error } = await supabaseAdmin
          .from('ad_banners')
          .select('*')
          .order('sort_index', { ascending: true })
          .order('created_at', { ascending: true })
        if (error) throw error
        return res.status(200).json({ status: 'success', data: data || [] })
      } catch (error) {
        const missing = /ad_banners|schema cache|relation .* does not exist/i.test(String(error?.message || error))
        return res.status(missing ? 503 : 500).json({
          status: 'error',
          message: missing ? 'ระบบการ์ดประชาสัมพันธ์ยังติดตั้งไม่ครบ' : String(error?.message || error)
        })
      }
    }

    if (req.query.action === 'auth_help_cases') {
      try {
        const adminUid = String(req.query.adminUid || '').trim()
        if (!hasAdminAccess(adminUid, 'full')) return forbidden(res)

        const now = new Date().toISOString()
        await supabaseAdmin
          .from('auth_help_cases')
          .update({ status: 'expired', updated_at: now })
          .eq('status', 'approved')
          .lt('recovery_until', now)

        let query = supabaseAdmin
          .from('auth_help_cases')
          .select('*')
          .order('last_requested_at', { ascending: false })
          .limit(200)
        const requestedStatus = String(req.query.status || '').trim()
        if (requestedStatus && requestedStatus !== 'all') query = query.eq('status', requestedStatus)
        const { data: cases, error } = await query
        if (error) throw error

        const uids = [...new Set((cases || []).map(row => row.target_uid).filter(Boolean))]
        const caseIds = (cases || []).map(row => row.id)
        const [usersResult, notificationsResult, ticketsResult, migrationsResult] = await Promise.all([
          uids.length
            ? supabaseAdmin.from('users').select('uid,name,tel,room').in('uid', uids)
            : Promise.resolve({ data: [], error: null }),
          caseIds.length
            ? supabaseAdmin.from('line_notification_outbox').select('id,case_id,message_kind,status,attempt_count,last_error,sent_at,updated_at').in('case_id', caseIds).order('created_at', { ascending: false })
            : Promise.resolve({ data: [], error: null }),
          caseIds.length
            ? supabaseAdmin.from('auth_recovery_tickets').select('case_id,consumed_at').in('case_id', caseIds).not('consumed_at', 'is', null)
            : Promise.resolve({ data: [], error: null }),
          uids.length
            ? supabaseAdmin.from('user_auth_migrations').select('uid,last_verified_at').in('uid', uids)
            : Promise.resolve({ data: [], error: null })
        ])
        if (usersResult.error) throw usersResult.error
        if (notificationsResult.error) throw notificationsResult.error
        if (ticketsResult.error) throw ticketsResult.error
        if (migrationsResult.error) throw migrationsResult.error

        // รองรับเรื่องเก่าที่ผู้ใช้ยืนยัน LINE สำเร็จแล้ว แต่เรื่องเคยค้างจนหมดอายุ
        const migrations = new Map((migrationsResult.data || []).map(item => [item.uid, item]))
        const verifiedCases = (cases || []).filter(helpCase => {
          if (helpCase.status === 'resolved' || helpCase.status === 'closed') return false
          const verifiedAt = new Date(migrations.get(helpCase.target_uid)?.last_verified_at || 0).getTime()
          const requestedAt = new Date(helpCase.last_requested_at || helpCase.requested_at || 0).getTime()
          return Number.isFinite(verifiedAt) && Number.isFinite(requestedAt) && verifiedAt > requestedAt
        })
        await Promise.all(verifiedCases.map(async helpCase => {
          const resolvedAt = migrations.get(helpCase.target_uid).last_verified_at
          const { data, error: resolveError } = await supabaseAdmin
            .from('auth_help_cases')
            .update({ status: 'resolved', resolved_at: resolvedAt, updated_at: now })
            .eq('id', helpCase.id)
            .in('status', ['open', 'approved', 'expired'])
            .select('id')
            .maybeSingle()
          if (resolveError) throw resolveError
          if (!data) return
          helpCase.status = 'resolved'
          helpCase.resolved_at = resolvedAt
          await auditEvent(supabaseAdmin, {
            type: 'auth_help_resolved',
            actorUid: helpCase.target_uid,
            targetUid: helpCase.target_uid,
            entityType: 'auth_help_case',
            entityId: helpCase.id,
            status: 'success',
            detail: { caseNo: helpCase.case_no, resolutionMethod: 'line_verified', reconciled: true }
          })
        }))

        const users = new Map((usersResult.data || []).map(user => [user.uid, user]))
        const notifications = new Map()
        for (const item of notificationsResult.data || []) {
          const current = notifications.get(item.case_id) || []
          current.push(item)
          notifications.set(item.case_id, current)
        }
        const consumedRecoveryCases = new Set((ticketsResult.data || []).map(item => String(item.case_id)))
        const rows = (cases || []).map(helpCase => ({
          ...helpCase,
          user: users.get(helpCase.target_uid) || null,
          notifications: notifications.get(helpCase.id) || [],
          resolution_method: helpCase.status === 'resolved'
            ? (consumedRecoveryCases.has(String(helpCase.id)) ? 'recovery_completed' : 'line_verified')
            : null
        }))
        return res.status(200).json({ status: 'success', data: rows })
      } catch (error) {
        const migrationMissing = /auth_help_cases|line_notification_outbox|schema cache|relation .* does not exist/i.test(String(error?.message || error))
        return res.status(migrationMissing ? 503 : 500).json({
          status: 'error',
          message: migrationMissing ? 'ระบบเรื่องช่วยเหลือยังติดตั้งไม่ครบ' : String(error?.message || error)
        })
      }
    }

    if (req.query.action === 'line_notifications') {
      try {
        const adminUid = String(req.query.adminUid || '').trim()
        if (!hasAdminAccess(adminUid, 'full')) return forbidden(res)
        const parsedLimit = parseInt(req.query.limit || '200', 10)
        const limit = Math.max(1, Math.min(Number.isFinite(parsedLimit) ? parsedLimit : 200, 300))
        const requestedStatus = String(req.query.status || '').trim()
        const requestedKind = String(req.query.kind || '').trim()
        let query = supabaseAdmin
          .from('line_notification_outbox')
          .select('id,dedupe_key,recipient_uid,message_kind,status,attempt_count,line_request_id,last_error,created_at,updated_at,sent_at')
          .order('created_at', { ascending: false })
          .limit(limit)
        if (requestedStatus && requestedStatus !== 'all') query = query.eq('status', requestedStatus)
        if (requestedKind && requestedKind !== 'all') query = query.eq('message_kind', requestedKind)
        const { data, error } = await query
        if (error) throw error
        const rows = data || []
        const uids = [...new Set(rows.map(row => row.recipient_uid).filter(Boolean))]
        const { data: users, error: usersError } = uids.length
          ? await supabaseAdmin.from('users').select('uid,name,room').in('uid', uids)
          : { data: [], error: null }
        if (usersError) throw usersError
        const userMap = new Map((users || []).map(user => [user.uid, user]))
        return res.status(200).json({
          status: 'success',
          data: rows.map(row => ({ ...row, user: userMap.get(row.recipient_uid) || null }))
        })
      } catch (error) {
        return res.status(500).json({ status: 'error', message: String(error?.message || error) })
      }
    }

    if (req.query.action === 'audit_logs') {
      try {
        const adminUid = String(req.query.adminUid || '').trim()
        if (!hasAdminAccess(adminUid, 'full')) return forbidden(res)

        const parsedLimit = parseInt(req.query.limit || '100', 10)
        const limit = Math.max(1, Math.min(Number.isFinite(parsedLimit) ? parsedLimit : 100, 200))
        const type = String(req.query.type || '').trim()

        let query = supabaseAdmin
          .from('audit_logs')
          .select('id,event_type,actor_uid,target_uid,entity_type,entity_id,status,detail,created_at')
          .order('created_at', { ascending: false })
          .limit(limit)

        if (type) query = query.eq('event_type', type)

        const { data, error } = await query
        if (error) throw error

        const rows = data || []

        // Enrich rows with user names
        const uids = [...new Set(rows.flatMap(r => [r.actor_uid, r.target_uid].filter(Boolean)))]
        let nameMap = {}
        if (uids.length) {
          const { data: users } = await supabaseAdmin
            .from('users')
            .select('uid, name')
            .in('uid', uids)
          for (const u of users || []) {
            if (u.uid) nameMap[u.uid] = u.name || null
          }
        }

        const enriched = rows.map(r => ({
          ...r,
          actor_name: (r.actor_uid && nameMap[r.actor_uid]) || null,
          target_name: (r.target_uid && nameMap[r.target_uid]) || null,
        }))

        return res.status(200).json({ status: 'success', data: enriched })
      } catch (e) {
        const message = String(e?.message || e)
        if (/audit_logs|relation .* does not exist/i.test(message)) {
          return res.status(200).json({ status: 'success', data: [], warning: 'audit_logs table not found' })
        }
        return res.status(500).json({ status: 'error', message })
      }
    }

    if (req.query.action === 'safety_pulse') {
      try {
        const adminUid = String(req.query.adminUid || '').trim()
        if (!hasAdminAccess(adminUid, 'safety_read')) return forbidden(res)

        const data = await getSafetyPulse(req.query.date)
        return res.status(200).json({ status: 'success', data })
      } catch (e) {
        if (/safety_questions|schema cache|relation .* does not exist/i.test(String(e?.message || e))) {
          return res.status(200).json({ status: 'success', data: [], warning: 'safety_questions table not found' })
        }
        return res.status(500).json({ status: 'error', message: String(e?.message || e) })
      }
    }

    if (req.query.action === 'safety_monthly_summary') {
      try {
        const adminUid = String(req.query.adminUid || '').trim()
        if (!hasAdminAccess(adminUid, 'safety_read')) return forbidden(res)

        const data = await getSafetyMonthlySummary(req.query.month)
        return res.status(200).json({ status: 'success', data })
      } catch (e) {
        if (/safety_questions|schema cache|relation .* does not exist|Could not find the table/i.test(String(e?.message || e))) {
          return res.status(200).json({ status: 'success', data: [], warning: 'safety_questions table not found' })
        }
        return res.status(500).json({ status: 'error', message: String(e?.message || e) })
      }
    }

    if (req.query.action === 'safety_questions') {
      try {
        const adminUid = String(req.query.adminUid || '').trim()
        if (!hasAdminAccess(adminUid, 'safety_read')) return forbidden(res)

        const requestedPage = Math.max(1, Number.parseInt(req.query.page, 10) || 1)
        const requestedPageSize = Number.parseInt(req.query.pageSize, 10) || 20
        const pageSize = [20, 50, 100].includes(requestedPageSize) ? requestedPageSize : 20
        const statusFilter = ['active', 'inactive'].includes(String(req.query.status || '')) ? String(req.query.status) : 'all'
        const categoryFilter = String(req.query.category || '').trim().slice(0, 60)
        const sourceFilter = String(req.query.source || '').trim().slice(0, 30)
        const search = String(req.query.search || '').trim().slice(0, 80).replace(/[%_]/g, '\\$&')
        const sortKey = String(req.query.sort || 'created_desc')
        const sortMap = {
          created_desc: { column: 'created_at', ascending: false },
          created_asc: { column: 'created_at', ascending: true },
          updated_desc: { column: 'updated_at', ascending: false },
          question_asc: { column: 'question', ascending: true }
        }
        const sort = sortMap[sortKey] || sortMap.created_desc
        const from = (requestedPage - 1) * pageSize
        const to = from + pageSize - 1
        let query = supabaseAdmin
          .from('safety_questions')
          .select('id,category,question,options,active,source,created_by,created_at,updated_at', { count: 'exact' })
        if (statusFilter === 'active') query = query.eq('active', true)
        if (statusFilter === 'inactive') query = query.eq('active', false)
        if (categoryFilter && categoryFilter !== 'all') query = query.eq('category', categoryFilter)
        if (sourceFilter && sourceFilter !== 'all') query = query.eq('source', sourceFilter)
        if (search) query = query.ilike('question', `%${search}%`)
        query = query
          .order(sort.column, { ascending: sort.ascending })
          .order('id', { ascending: sort.ascending })
          .range(from, to)

        const [pageResult, allResult, activeResult, inactiveResult] = await Promise.all([
          query,
          supabaseAdmin.from('safety_questions').select('id', { count: 'exact', head: true }),
          supabaseAdmin.from('safety_questions').select('id', { count: 'exact', head: true }).eq('active', true),
          supabaseAdmin.from('safety_questions').select('id', { count: 'exact', head: true }).eq('active', false)
        ])
        const { data, error, count: filteredCount } = pageResult
        if (error) throw error
        if (allResult.error) throw allResult.error
        if (activeResult.error) throw activeResult.error
        if (inactiveResult.error) throw inactiveResult.error
        const total = Number(filteredCount || 0)
        const totalPages = Math.max(1, Math.ceil(total / pageSize))
        return res.status(200).json({
          status: 'success',
          data: (data || []).map(safeSafetyQuestion),
          pagination: {
            page: requestedPage,
            pageSize,
            total,
            totalPages,
            hasPrevious: requestedPage > 1,
            hasNext: requestedPage < totalPages
          },
          summary: {
            total: Number(allResult.count || 0),
            active: Number(activeResult.count || 0),
            inactive: Number(inactiveResult.count || 0)
          }
        })
      } catch (e) {
        if (/safety_questions|schema cache|relation .* does not exist|Could not find the table/i.test(String(e?.message || e))) {
          return res.status(200).json({ status: 'success', data: [], warning: 'safety_questions table not found' })
        }
        return res.status(500).json({ status: 'error', message: String(e?.message || e) })
      }
    }

    if (req.query.action === 'safety_settings') {
      try {
        const adminUid = String(req.query.adminUid || '').trim()
        if (!hasAdminAccess(adminUid, 'safety_read')) return forbidden(res)

        const data = await getSafetySettings()
        return res.status(200).json({ status: 'success', data })
      } catch (e) {
        return res.status(500).json({ status: 'error', message: String(e?.message || e) })
      }
    }

    const { uid } = req.query
    const role = getAdminRole(uid)
    return res.json({ isAdmin: Boolean(role), role, safetyAdmin: role === 'safety_admin', safetyViewer: role === 'safety_viewer' })
  }

  // 2. รับค่า (เพิ่ม rewardId และ rewardData เข้ามาสำหรับฟังก์ชันใหม่)
  const {
    action,
    adminUid,
    targetUid,
    amount,
    delta,
    note,
    rewardId,
    rewardData,
    id,
    category,
    question,
    questions,
    options,
    source,
    active,
    tone,
    count,
    status,
    checkinTimeEnabled,
    checkinStartTime,
    checkinEndTime,
    durationMinutes,
    caseId,
    notificationId,
    requestId,
    redemptionId,
    reason,
    bannerData,
    bannerIds
  } = req.body || {}

  const requestedAction = String(action || '').trim()
  const requiredScope = SAFETY_ACTIONS.has(requestedAction) ? 'safety_write' : 'full'
  if (!hasAdminAccess(adminUid, requiredScope)) return forbidden(res)

  try {
    let rpcName = ''
    let rpcParams = {}

    if (action === 'ad_banner_save') {
      const payload = bannerData && typeof bannerData === 'object' ? bannerData : {}
      const bannerId = String(payload.id || '').trim()
      const isUpdate = Boolean(bannerId)
      if (isUpdate && !UUID_RE.test(bannerId)) return res.status(400).json({ status:'error', message:'ad_banner_id_invalid' })

      let existing = null
      if (isUpdate) {
        const { data, error } = await supabaseAdmin.from('ad_banners').select('*').eq('id', bannerId).maybeSingle()
        if (error) throw error
        if (!data) return res.status(404).json({ status:'error', message:'ad_banner_not_found' })
        existing = data
      }

      const title = cleanAdText(payload.title, 120) || 'การ์ดประชาสัมพันธ์'
      const altText = cleanAdText(payload.altText, 180) || title
      const imageSource = String(payload.imageSource || existing?.image_source || 'url').trim()
      if (!['url', 'upload'].includes(imageSource)) return res.status(400).json({ status:'error', message:'ad_image_source_invalid' })
      const rawLink = String(payload.linkUrl || '').trim()
      const linkUrl = rawLink ? safeHttpsUrl(rawLink, { required:true }) : null
      if (rawLink && !linkUrl) return res.status(400).json({ status:'error', message:'ad_link_url_invalid' })

      let uploaded = null
      let imageUrl = existing?.image_url || ''
      let storagePath = existing?.storage_path || null
      try {
        if (imageSource === 'upload' && payload.imageData) {
          uploaded = await uploadAdImage(payload.imageData)
          imageUrl = uploaded.url
          storagePath = uploaded.path
        } else if (imageSource === 'url') {
          const requestedUrl = String(payload.imageUrl || '').trim()
          if (requestedUrl) imageUrl = safeHttpsUrl(requestedUrl, { required:true }) || ''
          if (!imageUrl || (existing && existing.image_source !== 'url' && !requestedUrl)) {
            return res.status(400).json({ status:'error', message:'ad_image_url_invalid' })
          }
          storagePath = null
        } else if (!existing || existing.image_source !== 'upload') {
          return res.status(400).json({ status:'error', message:'ad_image_file_required' })
        }

        const now = new Date().toISOString()
        const record = {
          title,
          alt_text: altText,
          image_source: imageSource,
          image_url: imageUrl,
          storage_path: storagePath,
          link_url: linkUrl,
          active: payload.active !== false,
          updated_by: adminUid,
          updated_at: now
        }
        let saved = null
        if (isUpdate) {
          const { data, error } = await supabaseAdmin.from('ad_banners').update(record).eq('id', bannerId).select('*').single()
          if (error) throw error
          saved = data
        } else {
          const { data: last } = await supabaseAdmin.from('ad_banners').select('sort_index').order('sort_index', { ascending:false }).limit(1).maybeSingle()
          record.sort_index = Number(last?.sort_index || 0) + 10
          record.created_by = adminUid
          const { data, error } = await supabaseAdmin.from('ad_banners').insert(record).select('*').single()
          if (error) throw error
          saved = data
        }

        if (existing?.storage_path && existing.storage_path !== saved.storage_path) await removeAdImage(existing.storage_path)
        await auditEvent(supabaseAdmin, {
          type: isUpdate ? 'ad_banner_updated' : 'ad_banner_created',
          actorUid: adminUid,
          entityType: 'ad_banner',
          entityId: saved.id,
          status: 'success',
          detail: { title: saved.title, imageSource: saved.image_source, active: saved.active }
        })
        return res.status(200).json({ status:'success', data:saved })
      } catch (error) {
        if (uploaded?.path) await removeAdImage(uploaded.path)
        throw error
      }
    }

    if (action === 'ad_banner_toggle') {
      const bannerId = String(id || '').trim()
      if (!UUID_RE.test(bannerId)) return res.status(400).json({ status:'error', message:'ad_banner_id_invalid' })
      const { data, error } = await supabaseAdmin
        .from('ad_banners')
        .update({ active:Boolean(active), updated_by:adminUid, updated_at:new Date().toISOString() })
        .eq('id', bannerId).is('deleted_at', null).select('*').single()
      if (error) throw error
      await auditEvent(supabaseAdmin, { type:'ad_banner_toggled', actorUid:adminUid, entityType:'ad_banner', entityId:bannerId, status:'success', detail:{ active:data.active } })
      return res.status(200).json({ status:'success', data })
    }

    if (action === 'ad_banner_delete' || action === 'ad_banner_restore') {
      const bannerId = String(id || '').trim()
      if (!UUID_RE.test(bannerId)) return res.status(400).json({ status:'error', message:'ad_banner_id_invalid' })
      const restoring = action === 'ad_banner_restore'
      const now = new Date().toISOString()
      const { data, error } = await supabaseAdmin
        .from('ad_banners')
        .update({ deleted_at:restoring ? null : now, active:restoring, updated_by:adminUid, updated_at:now })
        .eq('id', bannerId).select('*').single()
      if (error) throw error
      await auditEvent(supabaseAdmin, { type:restoring ? 'ad_banner_restored' : 'ad_banner_deleted', actorUid:adminUid, entityType:'ad_banner', entityId:bannerId, status:'success', detail:{ title:data.title } })
      return res.status(200).json({ status:'success', data })
    }

    if (action === 'ad_banner_reorder') {
      const orderedIds = Array.isArray(bannerIds) ? [...new Set(bannerIds.map(value => String(value || '').trim()))] : []
      if (!orderedIds.length || orderedIds.length > 100 || orderedIds.some(value => !UUID_RE.test(value))) {
        return res.status(400).json({ status:'error', message:'ad_banner_order_invalid' })
      }
      const now = new Date().toISOString()
      const updates = await Promise.all(orderedIds.map((bannerId, index) => supabaseAdmin
        .from('ad_banners')
        .update({ sort_index:(index + 1) * 10, updated_by:adminUid, updated_at:now })
        .eq('id', bannerId).is('deleted_at', null)))
      const failed = updates.find(result => result.error)
      if (failed?.error) throw failed.error
      await auditEvent(supabaseAdmin, { type:'ad_banner_reordered', actorUid:adminUid, entityType:'ad_banner', status:'success', detail:{ ids:orderedIds } })
      return res.status(200).json({ status:'success' })
    }

    if (action === 'auth_recovery_open') {
      const cleanTargetUid = String(targetUid || '').trim()
      const cleanReason = String(note || '').trim().slice(0, 300)
      const minutes = Math.max(5, Math.min(60, Number(durationMinutes) || 30))
      if (!cleanTargetUid) return res.status(400).json({ status: 'error', message: 'target_uid_required' })
      if (cleanReason.length < 3) return res.status(400).json({ status: 'error', message: 'recovery_reason_required' })

      const { data: migration, error: findError } = await supabaseAdmin
        .from('user_auth_migrations')
        .select('uid,token_required')
        .eq('uid', cleanTargetUid)
        .maybeSingle()
      if (findError) throw findError
      if (!migration?.token_required) {
        return res.status(409).json({ status: 'error', message: 'auth_not_migrated' })
      }

      const recoveryUntil = new Date(Date.now() + minutes * 60 * 1000).toISOString()
      let helpCase = null
      let notification = null
      let data = null
      if (caseId) {
        const { data: foundCase, error: caseFindError } = await supabaseAdmin
          .from('auth_help_cases')
          .select('*')
          .eq('id', caseId)
          .eq('target_uid', cleanTargetUid)
          .in('status', ['open', 'approved'])
          .maybeSingle()
        if (caseFindError) throw caseFindError
        if (!foundCase) return res.status(404).json({ status: 'error', message: 'help_case_not_found' })

        const rawTicket = crypto.randomBytes(32).toString('base64url')
        const ticketExpiresAt = new Date(Math.min(
          new Date(recoveryUntil).getTime(),
          Date.now() + 15 * 60 * 1000
        )).toISOString()
        const { data: approvedCase, error: openError } = await supabaseAdmin.rpc('open_auth_recovery_case', {
          p_case_id: foundCase.id,
          p_target_uid: cleanTargetUid,
          p_admin_uid: adminUid,
          p_reason: cleanReason,
          p_recovery_until: recoveryUntil,
          p_ticket_hash: crypto.createHash('sha256').update(rawTicket).digest('hex'),
          p_ticket_expires_at: ticketExpiresAt
        })
        if (openError) throw openError
        helpCase = Array.isArray(approvedCase) ? approvedCase[0] : approvedCase
        data = {
          uid: cleanTargetUid,
          token_required: true,
          recovery_until: recoveryUntil,
          recovery_reason: cleanReason,
          recovery_by: adminUid,
          recovery_case_id: foundCase.id
        }

        const { data: user } = await supabaseAdmin
          .from('users')
          .select('uid,name')
          .eq('uid', cleanTargetUid)
          .maybeSingle()
        try {
          notification = await queueLineNotification({
            dedupeKey: `auth-help:${foundCase.id}:user-approved:${helpCase.approved_at}`,
            caseId: foundCase.id,
            recipientUid: cleanTargetUid,
            messageKind: 'auth_help_user_approved',
            payload: buildRecoveryApprovedMessage({
              helpCase: approvedCase,
              user,
              url: userRecoveryUrl(req, rawTicket)
            })
          })
        } catch (notifyError) {
          console.error('[admin-actions] recovery LINE notification failed:', notifyError?.message || notifyError)
        }
      } else {
        const { data: recoveryData, error } = await supabaseAdmin
          .from('user_auth_migrations')
          .update({
            recovery_until: recoveryUntil,
            recovery_reason: cleanReason,
            recovery_by: adminUid,
            recovery_case_id: null
          })
          .eq('uid', cleanTargetUid)
          .select('uid,token_required,migrated_at,last_verified_at,recovery_until,recovery_reason,recovery_by,recovery_case_id')
          .single()
        if (error) throw error
        data = recoveryData
      }

      await auditEvent(supabaseAdmin, {
        type: 'auth_recovery_open',
        actorUid: adminUid,
        targetUid: cleanTargetUid,
        entityType: 'user_auth_migration',
        entityId: cleanTargetUid,
        status: 'success',
        detail: {
          recoveryUntil,
          minutes,
          reason: cleanReason,
          caseId: helpCase?.id || null,
          caseNo: helpCase?.case_no || null,
          notificationStatus: notification?.status || (helpCase ? 'failed' : 'not_requested')
        }
      })
      return res.status(200).json({
        status: 'success',
        data: {
          ...data,
          helpCase,
          lineNotification: notification ? {
            id: notification.id,
            status: notification.status,
            lastError: notification.last_error || null
          } : null
        }
      })
    }

    if (action === 'auth_recovery_close') {
      const cleanTargetUid = String(targetUid || '').trim()
      if (!cleanTargetUid) return res.status(400).json({ status: 'error', message: 'target_uid_required' })

      const { data, error } = await supabaseAdmin
        .from('user_auth_migrations')
        .update({ recovery_until: null, recovery_reason: null, recovery_by: null, recovery_case_id: null })
        .eq('uid', cleanTargetUid)
        .select('uid,token_required,migrated_at,last_verified_at,recovery_until,recovery_reason,recovery_by,recovery_case_id')
        .single()
      if (error) throw error

      if (caseId) {
        const now = new Date().toISOString()
        const { error: caseCloseError } = await supabaseAdmin
          .from('auth_help_cases')
          .update({ status: 'closed', closed_at: now, updated_at: now })
          .eq('id', caseId)
          .eq('target_uid', cleanTargetUid)
          .in('status', ['open', 'approved'])
        if (caseCloseError) throw caseCloseError
      }

      await auditEvent(supabaseAdmin, {
        type: 'auth_recovery_close',
        actorUid: adminUid,
        targetUid: cleanTargetUid,
        entityType: 'user_auth_migration',
        entityId: cleanTargetUid,
        status: 'success',
        detail: { reason: String(note || 'admin-closed-recovery').trim().slice(0, 300) }
      })
      return res.status(200).json({ status: 'success', data })
    }

    if (action === 'auth_notification_retry') {
      const cleanNotificationId = String(notificationId || '').trim()
      if (!cleanNotificationId) return res.status(400).json({ status: 'error', message: 'notification_id_required' })
      const notification = await retryLineNotification(cleanNotificationId)
      await auditEvent(supabaseAdmin, {
        type: 'auth_notification_retry',
        actorUid: adminUid,
        targetUid: notification.recipient_uid,
        entityType: 'line_notification_outbox',
        entityId: notification.id,
        status: notification.status === 'sent' ? 'success' : 'error',
        detail: { caseId: notification.case_id, messageKind: notification.message_kind, error: notification.last_error || null }
      })
      return res.status(200).json({ status: 'success', data: notification })
    }

    if (action === 'line_notification_retry') {
      const cleanNotificationId = String(notificationId || '').trim()
      if (!UUID_RE.test(cleanNotificationId)) return res.status(400).json({ status: 'error', message: 'notification_id_required' })
      const notification = await retryLineNotification(cleanNotificationId)
      await auditEvent(supabaseAdmin, {
        type: 'line_notification_retry', actorUid: adminUid, targetUid: notification.recipient_uid,
        entityType: 'line_notification_outbox', entityId: notification.id,
        status: notification.status === 'sent' ? 'success' : 'error',
        detail: { messageKind: notification.message_kind, error: notification.last_error || null }
      })
      return res.status(200).json({ status: 'success', data: notification })
    }

    if (action === 'redemption_receive' || action === 'redemption_cancel_refund') {
      const cleanRedemptionId = String(redemptionId || '').trim()
      if (!UUID_RE.test(cleanRedemptionId)) return res.status(400).json({ status: 'error', message: 'redemption_id_required' })
      const cleanReason = String(reason || note || '').trim().slice(0, 300)
      if (action === 'redemption_cancel_refund' && cleanReason.length < 3) {
        return res.status(400).json({ status: 'error', message: 'cancel_reason_required' })
      }

      const rpcName = action === 'redemption_receive' ? 'mark_redemption_received' : 'cancel_redemption_with_refund'
      const rpcParams = action === 'redemption_receive'
        ? { p_redemption_id: cleanRedemptionId, p_admin_uid: adminUid }
        : { p_redemption_id: cleanRedemptionId, p_admin_uid: adminUid, p_reason: cleanReason }
      const { data: rpcRows, error: workflowError } = await supabaseAdmin.rpc(rpcName, rpcParams)
      if (workflowError) throw workflowError
      const workflow = Array.isArray(rpcRows) ? rpcRows[0] : rpcRows

      const { data: redemption, error: redemptionError } = await supabaseAdmin
        .from('redemptions')
        .select(`
          id,cost,status,created_at,balance_after,received_at,cancelled_at,cancel_reason,refund_balance,
          users:user_id(uid,name),rewards:reward_id(name,img_url)
        `)
        .eq('id', cleanRedemptionId)
        .single()
      if (redemptionError) throw redemptionError
      const targetUid = redemption.users?.uid
      let notification = null
      try {
        const isReceived = action === 'redemption_receive'
        notification = await queueLineNotification({
          dedupeKey: `${isReceived ? 'redemption-received' : 'redemption-cancelled'}:${redemption.id}`,
          recipientUid: targetUid,
          messageKind: isReceived ? 'redemption_received' : 'redemption_cancelled',
          payload: isReceived
            ? buildRedemptionReceivedMessage({
                redemption, reward: redemption.rewards,
                url: userRedemptionUrl(req, redemption.id)
              })
            : buildRedemptionCancelledMessage({
                redemption, reward: redemption.rewards, reason: cleanReason,
                balance: workflow?.balance ?? redemption.refund_balance,
                url: userHistoryUrl(req)
              })
        })
      } catch (notifyError) {
        console.error('[admin-actions] redemption LINE notification failed:', notifyError?.message || notifyError)
      }

      await clearScoreCache(redis, targetUid)
      await auditEvent(supabaseAdmin, {
        type: action === 'redemption_receive' ? 'redemption_received' : 'redemption_cancelled_refunded',
        actorUid: adminUid, targetUid, entityType: 'redemption', entityId: redemption.id,
        status: 'success', detail: {
          rewardName: redemption.rewards?.name,
          points: redemption.cost,
          reason: action === 'redemption_cancel_refund' ? cleanReason : null,
          duplicate: Boolean(workflow?.already_done),
          lineStatus: notification?.status || 'failed'
        }
      })
      return res.status(200).json({
        status: 'success',
        data: { ...redemption, workflow, lineNotification: notification ? { id: notification.id, status: notification.status, lastError: notification.last_error } : { status: 'failed' } }
      })
    }

    if (action === 'safety_question_create') {
      const cleanQuestion = String(question || '').trim()
      if (!cleanQuestion) return res.status(400).json({ status: 'error', message: 'question_required' })
      const existingQuestions = await getExistingSafetyQuestionTexts()
      const cleanNormalized = normalizeQuestionText(cleanQuestion)
      if (cleanNormalized && existingQuestions.some(item => normalizeQuestionText(item) === cleanNormalized)) {
        return res.status(409).json({ status: 'error', message: 'duplicate_question' })
      }

      const { data, error } = await supabaseAdmin
        .from('safety_questions')
        .insert({
          category: String(category || 'general').trim().slice(0, 60) || 'general',
          question: cleanQuestion.slice(0, 240),
          options: normalizeSafetyOptions(options),
          active: active !== false,
          source: source === 'gemini' ? 'gemini' : 'admin',
          created_by: adminUid,
          updated_at: new Date().toISOString()
        })
        .select('id,category,question,options,active,source,created_by,created_at,updated_at')
        .single()

      if (error) throw error
      await auditEvent(supabaseAdmin, {
        type: 'safety_question_create',
        actorUid: adminUid,
        entityType: 'safety_question',
        entityId: data.id,
        status: 'success',
        detail: { category: data.category, source: data.source }
      })
      return res.status(200).json({ status: 'success', data: safeSafetyQuestion(data) })
    }

    else if (action === 'safety_question_batch_create') {
      const rows = Array.isArray(questions) ? questions.slice(0, 10) : []
      if (!rows.length) return res.status(400).json({ status: 'error', message: 'questions_required' })
      const existingQuestions = await getExistingSafetyQuestionTexts()
      const known = new Set(existingQuestions.map(normalizeQuestionText).filter(Boolean))
      const skipped = []
      const records = []
      for (const item of rows) {
        const cleanQuestion = String(item?.question || '').trim().slice(0, 240)
        const normalized = normalizeQuestionText(cleanQuestion)
        if (!cleanQuestion) continue
        if (!normalized || known.has(normalized)) {
          skipped.push(cleanQuestion)
          continue
        }
        known.add(normalized)
        records.push({
          category: String(item?.category || 'general').trim().slice(0, 60) || 'general',
          question: cleanQuestion,
          options: normalizeSafetyOptions(item?.options),
          active: item?.active !== false,
          source: item?.source === 'gemini' ? 'gemini' : 'admin',
          created_by: adminUid,
          updated_at: new Date().toISOString()
        })
      }
      if (!records.length) {
        return res.status(200).json({ status: 'success', data: { items: [], insertedCount: 0, skippedCount: skipped.length } })
      }
      const { data, error } = await supabaseAdmin
        .from('safety_questions')
        .insert(records)
        .select('id,category,question,options,active,source,created_by,created_at,updated_at')
      if (error) throw error
      await auditEvent(supabaseAdmin, {
        type: 'safety_question_batch_create',
        actorUid: adminUid,
        entityType: 'safety_question_pack',
        status: 'success',
        detail: { insertedCount: data?.length || 0, skippedCount: skipped.length, source: records[0]?.source || 'admin' }
      })
      return res.status(200).json({
        status: 'success',
        data: { items: (data || []).map(safeSafetyQuestion), insertedCount: data?.length || 0, skippedCount: skipped.length }
      })
    }

    else if (action === 'safety_question_update') {
      if (!id) return res.status(400).json({ status: 'error', message: 'id_required' })
      const update = { updated_at: new Date().toISOString() }
      if (category !== undefined) update.category = String(category || 'general').trim().slice(0, 60) || 'general'
      if (question !== undefined) update.question = String(question || '').trim().slice(0, 240)
      if (options !== undefined) update.options = normalizeSafetyOptions(options)
      if (active !== undefined) update.active = Boolean(active)
      if (question !== undefined && !update.question) return res.status(400).json({ status: 'error', message: 'question_required' })

      const { data, error } = await supabaseAdmin
        .from('safety_questions')
        .update(update)
        .eq('id', id)
        .select('id,category,question,options,active,source,created_by,created_at,updated_at')
        .single()

      if (error) throw error
      await auditEvent(supabaseAdmin, {
        type: 'safety_question_update',
        actorUid: adminUid,
        entityType: 'safety_question',
        entityId: data.id,
        status: 'success',
        detail: { category: data.category, active: data.active }
      })
      return res.status(200).json({ status: 'success', data: safeSafetyQuestion(data) })
    }

    else if (action === 'safety_question_delete') {
      if (!id) return res.status(400).json({ status: 'error', message: 'id_required' })
      const { data, error } = await supabaseAdmin
        .from('safety_questions')
        .update({ active: false, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select('id')
        .single()

      if (error) throw error
      await auditEvent(supabaseAdmin, {
        type: 'safety_question_archive',
        actorUid: adminUid,
        entityType: 'safety_question',
        entityId: id,
        status: 'success',
        detail: { active: false }
      })
      return res.status(200).json({ status: 'success', data })
    }

    else if (action === 'safety_question_hard_delete') {
      if (!id) return res.status(400).json({ status: 'error', message: 'id_required' })
      const { data, error } = await supabaseAdmin
        .from('safety_questions')
        .delete()
        .eq('id', id)
        .select('id')
        .single()

      if (error) throw error
      await auditEvent(supabaseAdmin, {
        type: 'safety_question_delete',
        actorUid: adminUid,
        entityType: 'safety_question',
        entityId: id,
        status: 'success',
        detail: { deleted: true }
      })
      return res.status(200).json({ status: 'success', data })
    }

    else if (action === 'safety_generate_questions') {
      try {
        const existingQuestions = await getExistingSafetyQuestionTexts()
        const generated = await generateSafetyQuestionsWithGemini({ category, tone, count, existingQuestions })
        await auditEvent(supabaseAdmin, {
          type: 'safety_ai_generate_questions',
          actorUid: adminUid,
          entityType: 'safety_question_pack',
          status: 'success',
          detail: { category: category || 'general', count: generated.questions?.length || 0, model: generated.model }
        })
        return res.status(200).json({ status: 'success', data: generated })
      } catch (error) {
        return res.status(error.statusCode || 500).json({ status: 'error', message: String(error.message || error) })
      }
    }

    else if (action === 'safety_risk_update') {
      if (!id) return res.status(400).json({ status: 'error', message: 'id_required' })
      const cleanStatus = String(status || '').trim()
      if (!['new', 'acknowledged', 'resolved'].includes(cleanStatus)) {
        return res.status(400).json({ status: 'error', message: 'invalid_status' })
      }

      const now = new Date().toISOString()
      const update = {
        risk_status: cleanStatus,
        risk_admin_note: String(note || '').trim().slice(0, 500) || null
      }
      if (cleanStatus === 'acknowledged') {
        update.risk_ack_by = adminUid
        update.risk_ack_at = now
      }
      if (cleanStatus === 'resolved') {
        update.risk_resolved_by = adminUid
        update.risk_resolved_at = now
      }
      if (cleanStatus === 'new') {
        update.risk_ack_by = null
        update.risk_ack_at = null
        update.risk_resolved_by = null
        update.risk_resolved_at = null
      }

      const { data, error } = await supabaseAdmin
        .from('daily_checkins')
        .update(update)
        .eq('id', id)
        .select('id,risk_status,risk_admin_note,risk_ack_by,risk_ack_at,risk_resolved_by,risk_resolved_at')
        .single()

      if (error) throw error
      await auditEvent(supabaseAdmin, {
        type: 'safety_risk_update',
        actorUid: adminUid,
        entityType: 'daily_checkin',
        entityId: id,
        status: 'success',
        detail: { riskStatus: cleanStatus, hasNote: Boolean(String(note || '').trim()) }
      })
      return res.status(200).json({ status: 'success', data })
    }

    else if (action === 'safety_streak_reset') {
      const resetDate = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body?.resetDate || '')) ? String(req.body.resetDate) : bangkokDate()
      const cleanNote = String(note || '').trim().slice(0, 300) || 'admin-streak-reset'

      const { data: settingsData, error: settingsError } = await supabaseAdmin
        .from('safety_settings')
        .upsert({
          id: 'global',
          streak_reset_date: resetDate,
          updated_by: adminUid,
          updated_at: new Date().toISOString()
        })
        .select('checkin_time_enabled,checkin_start_time,checkin_end_time,streak_reset_date,updated_by,updated_at')
        .single()

      if (settingsError) throw settingsError

      const { data: resetRows, error: resetError } = await supabaseAdmin
        .from('daily_checkins')
        .select('id,uid,checkin_date,streak')
        .gte('checkin_date', resetDate)
        .order('uid', { ascending: true })
        .order('checkin_date', { ascending: true })

      if (resetError) throw resetError

      let affectedRows = 0
      const nextByUid = new Map()
      for (const row of resetRows || []) {
        const next = nextByUid.get(row.uid) || 1
        nextByUid.set(row.uid, next + 1)
        if (Number(row.streak || 0) === next) continue
        const { error: updateError } = await supabaseAdmin
          .from('daily_checkins')
          .update({ streak: next })
          .eq('id', row.id)
        if (updateError) throw updateError
        affectedRows += 1
      }

      await auditEvent(supabaseAdmin, {
        type: 'safety_streak_reset',
        actorUid: adminUid,
        entityType: 'safety_settings',
        entityId: 'global',
        status: 'success',
        detail: { resetDate, affectedRows, scannedRows: resetRows?.length || 0, note: cleanNote }
      })

      return res.status(200).json({
        status: 'success',
        data: {
          ...safeSafetySettings(settingsData),
          affectedRows,
          scannedRows: resetRows?.length || 0
        }
      })
    }

    else if (action === 'safety_settings_update') {
      const timePattern = /^\d{2}:\d{2}$/
      const start = timePattern.test(String(checkinStartTime || '')) ? String(checkinStartTime) : '06:00'
      const end = timePattern.test(String(checkinEndTime || '')) ? String(checkinEndTime) : '18:00'
      const { data, error } = await supabaseAdmin
        .from('safety_settings')
        .upsert({
          id: 'global',
          checkin_time_enabled: Boolean(checkinTimeEnabled),
          checkin_start_time: start,
          checkin_end_time: end,
          updated_by: adminUid,
          updated_at: new Date().toISOString()
        })
        .select('checkin_time_enabled,checkin_start_time,checkin_end_time,streak_reset_date,updated_by,updated_at')
        .single()

      if (error) throw error
      await auditEvent(supabaseAdmin, {
        type: 'safety_settings_update',
        actorUid: adminUid,
        entityType: 'safety_settings',
        entityId: 'global',
        status: 'success',
        detail: { checkinTimeEnabled: Boolean(checkinTimeEnabled), start, end }
      })
      return res.status(200).json({ status: 'success', data: safeSafetySettings(data) })
    }

    // ==================================================
    // 🟢 CASE A: ปรับแต้มรายคน (ของเดิม ห้ามลบ)
    // ==================================================
    if (action === 'adjust') {
      const cleanReason = String(note || '').trim().slice(0, 300)
      const numericDelta = Number(delta)
      if (!targetUid || !Number.isFinite(numericDelta) || numericDelta === 0) return res.status(400).json({ status: 'error', message: 'Missing data' })
      if (cleanReason.length < 3) return res.status(400).json({ status: 'error', message: 'adjustment_reason_required' })
      const cleanRequestId = UUID_RE.test(String(requestId || '').trim()) ? String(requestId).trim() : crypto.randomUUID()
      const { data: user, error: userError } = await supabaseAdmin.from('users').select('id,uid,name').eq('uid', targetUid).single()
      if (userError || !user) return res.status(404).json({ status: 'error', message: 'User not found' })
      const mode = numericDelta > 0 ? 'add' : 'deduct'
      const { data: adjustmentRows, error: adjustmentError } = await supabaseAdmin.rpc('admin_adjust_points_v2', {
        p_target_uid: targetUid, p_mode: mode, p_amount: Math.abs(Math.trunc(numericDelta)),
        p_reason: cleanReason, p_admin_uid: adminUid, p_request_id: cleanRequestId
      })
      if (adjustmentError) throw adjustmentError
      const adjustment = { ...(Array.isArray(adjustmentRows) ? adjustmentRows[0] : adjustmentRows), mode, reason: cleanReason, created_at: new Date().toISOString() }
      let notification = null
      try {
        notification = await queueLineNotification({
          dedupeKey: `score-adjusted:${adjustment.adjustment_id}`,
          recipientUid: targetUid, messageKind: 'score_adjusted',
          payload: buildPointAdjustmentMessage({ adjustment, user, url: userHistoryUrl(req) })
        })
      } catch (notifyError) {
        console.error('[admin-actions] point adjustment LINE notification failed:', notifyError?.message || notifyError)
      }
      await clearScoreCache(redis, targetUid)
      await auditEvent(supabaseAdmin, {
        type: 'admin_points_adjusted', actorUid: adminUid, targetUid,
        entityType: 'admin_point_adjustment', entityId: adjustment.adjustment_id, status: 'success',
        detail: { delta: adjustment.applied_delta, balanceBefore: adjustment.balance_before, balanceAfter: adjustment.balance_after, reason: cleanReason, duplicate: Boolean(adjustment.was_duplicate), lineStatus: notification?.status || 'failed' }
      })
      return res.status(200).json({ status: 'success', data: { ...adjustment, lineNotification: notification ? { id: notification.id, status: notification.status, lastError: notification.last_error } : { status: 'failed' } } })
    }

    // ==================================================
    // 🟢 CASE B: รีเซ็ตแต้มเป็น 0 (ของเดิม ห้ามลบ)
    // ==================================================
    else if (action === 'reset') {
      const cleanReason = String(note || '').trim().slice(0, 300)
      if (!targetUid) return res.status(400).json({ status: 'error', message: 'Missing targetUid' })
      if (cleanReason.length < 3) return res.status(400).json({ status: 'error', message: 'adjustment_reason_required' })
      const cleanRequestId = UUID_RE.test(String(requestId || '').trim()) ? String(requestId).trim() : crypto.randomUUID()
      const { data: user, error: userError } = await supabaseAdmin.from('users').select('id,uid,name').eq('uid', targetUid).single()
      if (userError || !user) return res.status(404).json({ status: 'error', message: 'User not found' })
      const { data: adjustmentRows, error: adjustmentError } = await supabaseAdmin.rpc('admin_adjust_points_v2', {
        p_target_uid: targetUid, p_mode: 'reset', p_amount: 0,
        p_reason: cleanReason, p_admin_uid: adminUid, p_request_id: cleanRequestId
      })
      if (adjustmentError) throw adjustmentError
      const adjustment = { ...(Array.isArray(adjustmentRows) ? adjustmentRows[0] : adjustmentRows), mode: 'reset', reason: cleanReason, created_at: new Date().toISOString() }
      let notification = null
      try {
        notification = await queueLineNotification({
          dedupeKey: `score-adjusted:${adjustment.adjustment_id}`,
          recipientUid: targetUid, messageKind: 'score_adjusted',
          payload: buildPointAdjustmentMessage({ adjustment, user, url: userHistoryUrl(req) })
        })
      } catch (notifyError) {
        console.error('[admin-actions] reset LINE notification failed:', notifyError?.message || notifyError)
      }
      await clearScoreCache(redis, targetUid)
      await auditEvent(supabaseAdmin, {
        type: 'admin_points_adjusted', actorUid: adminUid, targetUid,
        entityType: 'admin_point_adjustment', entityId: adjustment.adjustment_id, status: 'success',
        detail: { delta: adjustment.applied_delta, balanceBefore: adjustment.balance_before, balanceAfter: adjustment.balance_after, reason: cleanReason, duplicate: Boolean(adjustment.was_duplicate), lineStatus: notification?.status || 'failed' }
      })
      return res.status(200).json({ status: 'success', data: { ...adjustment, lineNotification: notification ? { id: notification.id, status: notification.status, lastError: notification.last_error } : { status: 'failed' } } })
    }

    // ==================================================
    // 🟢 CASE C: แจกทุกคน (ของเดิม ห้ามลบ)
    // ==================================================
    else if (action === 'giveaway') {
      if (!amount || amount <= 0) return res.status(400).json({ status: 'error', message: 'Invalid amount' })
      if (String(note || '').trim().length < 3) return res.status(400).json({ status: 'error', message: 'giveaway_reason_required' })

      rpcName = 'admin_giveaway_to_all'
      rpcParams = {
        p_amount: amount,
        p_note: String(note).trim().slice(0, 300),
        p_admin_uid: adminUid
      }
    } 
    
    // ==================================================
    // ⭐ CASE D: จัดการของรางวัล (เพิ่มใหม่ สำหรับ Stock Manager)
    // ==================================================
    else if (action === 'reward_create') {
      const safeData = getSafeRewardData({
        active: true,
        stock: 0,
        stock_max: 0,
        sort_index: 9999,
        ...(rewardData || {})
      })

      if (!safeData.name || !Number.isFinite(safeData.cost)) {
        return res.status(400).json({ status: 'error', message: 'Missing reward name or cost' })
      }

      // cap stock to stock_max when both are set
      if (Number.isFinite(safeData.stock) && safeData.stock_max > 0) {
        safeData.stock = Math.min(safeData.stock, safeData.stock_max)
      }

      const { data, error } = await supabaseAdmin
        .from('rewards')
        .insert(safeData)
        .select()
        .single()

      if (error) throw error
      return res.status(200).json({ status: 'success', data })
    }

    else if (action === 'reward_update') {
      if (!rewardId) return res.status(400).json({ status: 'error', message: 'Missing rewardId' })

      const safeData = getSafeRewardData(rewardData)
      if (Object.keys(safeData).length === 0) {
        return res.status(400).json({ status: 'error', message: 'No valid fields to update' })
      }

      // cap stock to stock_max when both fields arrive in the same update
      if (Number.isFinite(safeData.stock) && Number.isFinite(safeData.stock_max) && safeData.stock_max > 0) {
        safeData.stock = Math.min(safeData.stock, safeData.stock_max)
      }

      // อัปเดตข้อมูลลง Table 'rewards' โดยตรง (เช่น active, stock, name, cost)
      const { data, error } = await supabaseAdmin
        .from('rewards')
        .update(safeData)
        .eq('id', rewardId)
        .select()
      
      if (error) throw error
      
      // ไม่ต้องเรียก RPC จบการทำงานแล้วส่งผลลัพธ์กลับเลย
      return res.status(200).json({ status: 'success', data })
    }

    else if (action === 'reward_delete') {
      if (!rewardId) return res.status(400).json({ status: 'error', message: 'Missing rewardId' })

      const { data, error } = await supabaseAdmin
        .from('rewards')
        .delete()
        .eq('id', rewardId)
        .select('id')

      if (error) throw error
      if (!data || data.length === 0) {
        return res.status(404).json({ status: 'error', message: 'Reward not found' })
      }

      return res.status(200).json({ status: 'success', data })
    }

    // ==================================================
    // ⭐ CASE E: ดึงประวัติการแลก (แก้ให้ตรง DB เป๊ะๆ)
    // ==================================================
    else if (action === 'get_history') {
      
      let query = supabaseAdmin
        .from('redemptions')
        .select(`
           id,
           created_at,
           cost,
           status,
           balance_after,
           received_at,
           received_by,
           cancelled_at,
           cancelled_by,
           cancel_reason,
           refund_balance,
           reward_id,
           users:user_id ( name, uid, room ),
           rewards:reward_id ( name, img_url )
        `)
        .order('created_at', { ascending: false })
        .limit(100)

      // optional filter by reward
      if (rewardId) query = query.eq('reward_id', rewardId)

      const { data, error } = await query

      if (error) {
         console.error('Fetch history error:', error);
         throw error;
      }

      const redemptionIds = new Set((data || []).map(row => String(row.id)))
      const { data: rawNotificationRows, error: notificationError } = redemptionIds.size
        ? await supabaseAdmin
            .from('line_notification_outbox')
            .select('id,dedupe_key,message_kind,status,attempt_count,last_error,sent_at,updated_at')
            .in('message_kind', ['redemption_created', 'redemption_admin_new', 'redemption_received', 'redemption_cancelled'])
            .order('created_at', { ascending: false })
            .limit(300)
        : { data: [], error: null }
      if (notificationError) throw notificationError
      const notificationRows = (rawNotificationRows || []).filter(item => redemptionIds.has(String(item.dedupe_key || '').split(':').slice(1).join(':')))
      const notificationMap = new Map((notificationRows || []).map(item => [item.dedupe_key, item]))
      
      // จัด Format ข้อมูล
      const formatted = (data || []).map(row => ({
         id: row.id,
         date: row.created_at,
         
         user_name: row.users?.name || 'ไม่ระบุชื่อ',
         user_uid:  row.users?.uid  || 'N/A',
         user_room: row.users?.room || '-',
         user_img:  '', // ใน DB ไม่มีรูป ก็ปล่อยว่างไว้ เดี๋ยวหน้าบ้านใส่ Default ให้
         
         reward_name: row.rewards?.name || 'ของรางวัล (ลบแล้ว)', 
         reward_img:  row.rewards?.img_url || 'https://placehold.co/100?text=No+Image', // ใช้ img_url
         
         cost: row.cost,
         status: row.status,
         balance_after: row.balance_after,
         received_at: row.received_at,
         received_by: row.received_by,
         cancelled_at: row.cancelled_at,
         cancelled_by: row.cancelled_by,
         cancel_reason: row.cancel_reason,
         refund_balance: row.refund_balance,
         created_notification: notificationMap.get(`redemption-created:${row.id}`) || null,
         admin_notification: notificationMap.get(`redemption-admin:${row.id}`) || null,
         received_notification: notificationMap.get(`redemption-received:${row.id}`) || null,
         cancelled_notification: notificationMap.get(`redemption-cancelled:${row.id}`) || null
      }))

      return res.status(200).json({ status: 'success', data: formatted })
    }

    else {
      return res.status(400).json({ status: 'error', message: 'Invalid action' })
    }

    // ==================================================
    // Process RPC calls (สำหรับ Case A, B, C)
    // ==================================================
    const { error } = await supabaseAdmin.rpc(rpcName, rpcParams)
    
    if (error) {
      console.error('RPC Error:', error)
      return res.status(500).json({ status: 'error', message: error.message })
    }

    if (action === 'adjust' || action === 'reset') {
      await clearScoreCache(redis, targetUid)
    }

    res.status(200).json({ status: 'success' })

  } catch (e) {
    console.error('Admin Action Error:', e)
    res.status(500).json({ status: 'error', message: adminErrorMessage(e) })
  }
}
