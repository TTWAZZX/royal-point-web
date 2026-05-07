const { supabaseAdmin, getRedis, clearScoreCache } = require('../lib/supabase')
const { auditEvent } = require('../lib/audit')
const redis = getRedis()

const ALLOWED_REWARD_FIELDS = ['name', 'cost', 'stock', 'stock_max', 'active', 'img_url', 'sort_index']
const TIME_ZONE = 'Asia/Bangkok'
const GEMINI_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-3.1-flash-lite'
]
const SAFETY_ACTIONS = new Set([
  'safety_question_create',
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
      .limit(300)
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
  // GET /api/admin-actions?uid=... → ตรวจว่าเป็น admin หรือไม่ (ใช้โดย checkAdminFromServer)
  if (req.method === 'GET') {
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

        return res.status(200).json({ status: 'success', data: data || [] })
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

        const includeInactive = String(req.query.includeInactive || '') === '1'
        let query = supabaseAdmin
          .from('safety_questions')
          .select('id,category,question,options,active,source,created_by,created_at,updated_at')
          .order('created_at', { ascending: false })
          .limit(100)
        if (!includeInactive) query = query.eq('active', true)
        const { data, error } = await query
        if (error) throw error
        return res.status(200).json({ status: 'success', data: (data || []).map(safeSafetyQuestion) })
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

  // 1. ตรวจสอบ Method
  if (req.method !== 'POST') return res.status(405).json({ status: 'error', message: 'Method not allowed' })

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
    options,
    active,
    tone,
    count,
    status,
    checkinTimeEnabled,
    checkinStartTime,
    checkinEndTime
  } = req.body || {}

  const requestedAction = String(action || '').trim()
  const requiredScope = SAFETY_ACTIONS.has(requestedAction) ? 'safety_write' : 'full'
  if (!hasAdminAccess(adminUid, requiredScope)) return forbidden(res)

  try {
    let rpcName = ''
    let rpcParams = {}

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
          source: 'admin',
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
      if (!targetUid || typeof delta !== 'number') return res.status(400).json({ status: 'error', message: 'Missing data' })
      const { data: user } = await supabaseAdmin.from('users').select('id').eq('uid', targetUid).single()
      if (!user) return res.status(404).json({ status: 'error', message: 'User not found' })

      rpcName = 'apply_points'
      rpcParams = {
        p_user: user.id,
        p_amount: delta,
        p_code: note || 'admin-adjust',
        p_type: delta >= 0 ? 'ADMIN_GIVE' : 'ADMIN_DEDUCT',
        p_actor: adminUid
      }
    }

    // ==================================================
    // 🟢 CASE B: รีเซ็ตแต้มเป็น 0 (ของเดิม ห้ามลบ)
    // ==================================================
    else if (action === 'reset') {
      if (!targetUid) return res.status(400).json({ status: 'error', message: 'Missing targetUid' })
      const { data: user } = await supabaseAdmin.from('users').select('id').eq('uid', targetUid).single()
      if (!user) return res.status(404).json({ status: 'error', message: 'User not found' })

      const { data: up } = await supabaseAdmin.from('user_points').select('balance').eq('user_id', user.id).single()
      const cur = up?.balance ?? 0
      if (cur === 0) return res.status(200).json({ status: 'success', message: 'Already 0' })

      rpcName = 'apply_points'
      rpcParams = {
        p_user: user.id,
        p_amount: -cur,
        p_code: note || 'admin-reset',
        p_type: 'ADMIN_RESET',
        p_actor: adminUid
      }
    }

    // ==================================================
    // 🟢 CASE C: แจกทุกคน (ของเดิม ห้ามลบ)
    // ==================================================
    else if (action === 'giveaway') {
      if (!amount || amount <= 0) return res.status(400).json({ status: 'error', message: 'Invalid amount' })
      // if (!note) return res.status(400).json({ status: 'error', message: 'Note required' }) // บางทีอาจไม่บังคับ note

      rpcName = 'admin_giveaway_to_all'
      rpcParams = {
        p_amount: amount,
        p_note: note || 'Giveaway',
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
      
      const { data, error } = await supabaseAdmin
        .from('redemptions') 
        .select(`
           id,
           created_at,
           cost,
           status,
           users:user_id ( name, uid ),
           rewards:reward_id ( name, img_url ) 
        `)
        // หมายเหตุ: 
        // 1. users: ไม่ดึงรูปภาพเพราะใน DB ไม่มีคอลัมน์รูป
        // 2. rewards: ดึง img_url (ตามรูป table rewards ของคุณ)
        .order('created_at', { ascending: false })
        .limit(50)

      if (error) {
         console.error('Fetch history error:', error);
         throw error;
      }
      
      // จัด Format ข้อมูล
      const formatted = (data || []).map(row => ({
         id: row.id,
         date: row.created_at,
         
         user_name: row.users?.name || 'ไม่ระบุชื่อ',
         user_uid:  row.users?.uid  || 'N/A',
         user_img:  '', // ใน DB ไม่มีรูป ก็ปล่อยว่างไว้ เดี๋ยวหน้าบ้านใส่ Default ให้
         
         reward_name: row.rewards?.name || 'ของรางวัล (ลบแล้ว)', 
         reward_img:  row.rewards?.img_url || 'https://placehold.co/100?text=No+Image', // ใช้ img_url
         
         cost: row.cost,
         status: row.status
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
    res.status(500).json({ status: 'error', message: String(e) })
  }
}
