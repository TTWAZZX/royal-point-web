const { supabaseAdmin, getRedis, clearScoreCache } = require('../lib/supabase')
const { auditEvent } = require('../lib/audit')

const redis = getRedis()
const CHECKIN_POINTS = 5
const WEEKLY_MISSION_TARGET = 5
const WEEKLY_MISSION_BONUS = 10
const TIME_ZONE = 'Asia/Bangkok'
const CHECKIN_SELECT = 'id,points,streak,checkin_date,created_at,safety_question_id,safety_answer,safety_mood,safety_note,risk_flag,risk_status'
const CHECKIN_BASE_SELECT = 'id,points,streak,checkin_date,created_at'
const SAFETY_ANSWERS = new Set(['ready', 'minor_risk', 'need_support'])
const SAFETY_MOODS = new Set(['ready', 'tired', 'risk', 'support'])
const DEFAULT_SAFETY_OPTIONS = [
  { label: 'พร้อมและปลอดภัย', description: 'พร้อมเริ่มงานตามมาตรฐานความปลอดภัย', answer: 'ready', answerText: 'พร้อมทำงาน ไม่มีประเด็นความเสี่ยง', mood: 'ready', riskFlag: false },
  { label: 'พบจุดเสี่ยงเล็กน้อย', description: 'รับทราบและจะระวัง หรือแจ้งหัวหน้างาน', answer: 'minor_risk', answerText: 'พบความเสี่ยง ควรเฝ้าระวังหรือติดตาม', mood: 'risk', riskFlag: true },
  { label: 'ต้องการให้ติดตาม', description: 'มีประเด็นที่ควรให้ จป./หัวหน้างานช่วยดู', answer: 'need_support', answerText: 'ต้องการให้แอดมินหรือหัวหน้างานติดตาม', mood: 'support', riskFlag: true }
]
const DEFAULT_SAFETY_QUESTION = {
  id: 'safe_start',
  category: 'general',
  question: 'ก่อนเริ่มงานวันนี้ คุณพร้อมทำงานอย่างปลอดภัยหรือมีจุดเสี่ยงที่ควรแจ้งไหม',
  options: DEFAULT_SAFETY_OPTIONS
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

function bangkokDateParts(date = new Date()) {
  const bangkok = new Date(date.toLocaleString('en-US', { timeZone: TIME_ZONE }))
  return {
    year: bangkok.getFullYear(),
    month: bangkok.getMonth(),
    day: bangkok.getDate(),
    weekday: bangkok.getDay()
  }
}

function formatDate(year, month, day) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function getBangkokWeekWindow() {
  const parts = bangkokDateParts()
  const mondayOffset = parts.weekday === 0 ? -6 : 1 - parts.weekday
  const start = new Date(parts.year, parts.month, parts.day)
  start.setDate(start.getDate() + mondayOffset)
  const end = new Date(start)
  end.setDate(start.getDate() + 6)
  const startDate = formatDate(start.getFullYear(), start.getMonth(), start.getDate())
  const endDate = formatDate(end.getFullYear(), end.getMonth(), end.getDate())
  return {
    startDate,
    endDate,
    code: `weekly-safety:${startDate}`
  }
}

async function loadUser(uid) {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('id,uid,name')
    .eq('uid', uid)
    .single()

  if (error || !data) return null
  return data
}

async function loadCheckin(uid, checkinDate) {
  const { data, error } = await supabaseAdmin
    .from('daily_checkins')
    .select(CHECKIN_SELECT)
    .eq('uid', uid)
    .eq('checkin_date', checkinDate)
    .maybeSingle()

  if (error && isMissingSafetyColumns(error)) {
    const fallback = await supabaseAdmin
      .from('daily_checkins')
      .select(CHECKIN_BASE_SELECT)
      .eq('uid', uid)
      .eq('checkin_date', checkinDate)
      .maybeSingle()
    if (fallback.error) throw fallback.error
    return fallback.data || null
  }

  if (error) throw error
  return data || null
}

function normalizeQuestionOptions(options) {
  const source = Array.isArray(options) && options.length ? options : DEFAULT_SAFETY_OPTIONS
  return [0, 1, 2].map((index) => {
    const option = source[index] || DEFAULT_SAFETY_OPTIONS[index] || {}
    const answer = SAFETY_ANSWERS.has(option?.answer) ? option.answer : DEFAULT_SAFETY_OPTIONS[index]?.answer || 'ready'
    const mood = SAFETY_MOODS.has(option?.mood) ? option.mood : (answer === 'minor_risk' ? 'risk' : answer === 'need_support' ? 'support' : 'ready')
    return {
      label: String(option?.label || DEFAULT_SAFETY_OPTIONS[index]?.label || 'ตัวเลือก').trim().slice(0, 80),
      description: String(option?.description || DEFAULT_SAFETY_OPTIONS[index]?.description || '').trim().slice(0, 180),
      answer,
      answerText: String(option?.answerText || option?.answer_text || DEFAULT_SAFETY_OPTIONS[index]?.answerText || '').trim().slice(0, 120),
      mood,
      riskFlag: Boolean(option?.riskFlag ?? answer !== 'ready')
    }
  })
}

function safeQuestion(row) {
  if (!row) return DEFAULT_SAFETY_QUESTION
  return {
    id: row.id || DEFAULT_SAFETY_QUESTION.id,
    category: row.category || 'general',
    question: row.question || DEFAULT_SAFETY_QUESTION.question,
    options: normalizeQuestionOptions(row.options)
  }
}

async function getTodaySafetyQuestion(today) {
  try {
    const { data, error } = await supabaseAdmin
      .from('safety_questions')
      .select('id,category,question,options')
      .eq('active', true)
      .order('created_at', { ascending: false })
      .limit(30)

    if (error) throw error
    const rows = data || []
    if (!rows.length) return DEFAULT_SAFETY_QUESTION
    let sum = 0
    for (const ch of today) sum += ch.charCodeAt(0)
    return safeQuestion(rows[sum % rows.length])
  } catch (error) {
    if (/safety_questions|schema cache|relation .* does not exist/i.test(String(error?.message || error))) {
      return DEFAULT_SAFETY_QUESTION
    }
    throw error
  }
}

async function getSafetySettings() {
  try {
    const { data, error } = await supabaseAdmin
      .from('safety_settings')
      .select('checkin_time_enabled,checkin_start_time,checkin_end_time,streak_reset_date')
      .eq('id', 'global')
      .maybeSingle()

    if (error) throw error
    return {
      enabled: Boolean(data?.checkin_time_enabled),
      startTime: data?.checkin_start_time || '06:00',
      endTime: data?.checkin_end_time || '18:00',
      streakResetDate: data?.streak_reset_date || null
    }
  } catch (error) {
    if (/streak_reset_date|schema cache|column .* does not exist/i.test(String(error?.message || error))) {
      const { data, error: fallbackError } = await supabaseAdmin
        .from('safety_settings')
        .select('checkin_time_enabled,checkin_start_time,checkin_end_time')
        .eq('id', 'global')
        .maybeSingle()
      if (fallbackError) throw fallbackError
      return {
        enabled: Boolean(data?.checkin_time_enabled),
        startTime: data?.checkin_start_time || '06:00',
        endTime: data?.checkin_end_time || '18:00',
        streakResetDate: null
      }
    }
    if (/safety_settings|schema cache|relation .* does not exist/i.test(String(error?.message || error))) {
      return { enabled: false, startTime: '06:00', endTime: '18:00', streakResetDate: null }
    }
    throw error
  }
}

function currentBangkokTimeText() {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date())
}

function getCheckinRule(settings) {
  const start = settings?.startTime || '06:00'
  const end = settings?.endTime || '18:00'
  const now = currentBangkokTimeText()
  let allowed = true
  if (settings?.enabled) {
    allowed = start <= end ? now >= start && now <= end : now >= start || now <= end
  }
  return {
    enabled: Boolean(settings?.enabled),
    allowed,
    now,
    startTime: start,
    endTime: end,
    reason: allowed ? null : 'checkin_time_closed'
  }
}

async function nextStreak(uid, resetDate = null) {
  const yesterday = bangkokDate(-1)
  if (resetDate && yesterday < resetDate) return 1
  const { data, error } = await supabaseAdmin
    .from('daily_checkins')
    .select('streak,checkin_date')
    .eq('uid', uid)
    .eq('checkin_date', yesterday)
    .maybeSingle()

  if (error) throw error
  return data ? Number(data.streak || 0) + 1 : 1
}

async function getWeeklyMission(userId, uid) {
  const week = getBangkokWeekWindow()
  const { data: rows, error: countError } = await supabaseAdmin
    .from('daily_checkins')
    .select('checkin_date')
    .eq('uid', uid)
    .gte('checkin_date', week.startDate)
    .lte('checkin_date', week.endDate)

  if (countError) throw countError

  const uniqueDates = [...new Set((rows || []).map(row => row.checkin_date))]
  const days = uniqueDates.length
  const weekDays = Array(7).fill(false)
  for (const dateStr of uniqueDates) {
    const [y, m, d] = dateStr.split('-').map(Number)
    const dow = new Date(y, m - 1, d).getDay() // 0=Sun
    weekDays[dow === 0 ? 6 : dow - 1] = true   // 0=Mon … 6=Sun
  }

  const { data: bonusRows, error: bonusError } = await supabaseAdmin
    .from('point_transactions')
    .select('id,amount,created_at')
    .eq('user_id', userId)
    .eq('code', week.code)
    .limit(1)

  if (bonusError) throw bonusError

  const awarded = Boolean(bonusRows && bonusRows.length)
  return {
    weekStart: week.startDate,
    weekEnd: week.endDate,
    code: week.code,
    count: days,
    target: WEEKLY_MISSION_TARGET,
    remaining: Math.max(WEEKLY_MISSION_TARGET - days, 0),
    bonus: WEEKLY_MISSION_BONUS,
    awarded,
    completed: days >= WEEKLY_MISSION_TARGET,
    awardedAt: bonusRows?.[0]?.created_at || null,
    weekDays
  }
}

async function applyWeeklyMissionBonus(user, uid) {
  const mission = await getWeeklyMission(user.id, uid)
  if (!mission.completed || mission.awarded) return { mission, awardedNow: false }

  const { error } = await supabaseAdmin.rpc('apply_points', {
    p_user: user.id,
    p_amount: WEEKLY_MISSION_BONUS,
    p_code: mission.code,
    p_type: 'WEEKLY_SAFETY_MISSION',
    p_actor: uid
  })

  if (error) {
    await auditEvent(supabaseAdmin, {
      type: 'weekly_mission_failed',
      actorUid: uid,
      targetUid: uid,
      entityType: 'weekly_mission',
      entityId: mission.code,
      status: 'error',
      detail: { reason: 'apply_points_failed', message: error.message, mission }
    })
    return { mission: { ...mission, error: 'apply_points_failed' }, awardedNow: false }
  }

  const updatedMission = { ...mission, awarded: true, awardedNow: true, remaining: 0 }
  await auditEvent(supabaseAdmin, {
    type: 'weekly_mission_success',
    actorUid: uid,
    targetUid: uid,
    entityType: 'weekly_mission',
    entityId: mission.code,
    status: 'success',
    detail: { bonus: WEEKLY_MISSION_BONUS, count: mission.count, target: mission.target }
  })

  return { mission: updatedMission, awardedNow: true }
}

function sendStatus(res, statusCode, payload) {
  const { error, ...body } = payload
  res.setHeader('Cache-Control', 'no-store, max-age=0')
  return res.status(statusCode).json({
    status: payload.error ? 'error' : 'success',
    ...body
  })
}

function isMissingSafetyColumns(error) {
  const message = String(error?.message || error?.details || '')
  return /safety_|risk_flag|risk_status|column .* does not exist|Could not find .* column/i.test(message)
}

function normalizeSafetyPayload(source = {}) {
  const answer = String(source.safetyAnswer || source.safety_answer || '').trim()
  const mood = String(source.safetyMood || source.safety_mood || answer || '').trim()
  const questionId = String(source.safetyQuestionId || source.safety_question_id || '').trim()
  const note = String(source.safetyNote || source.safety_note || '').trim().slice(0, 300)
  const safeAnswer = SAFETY_ANSWERS.has(answer) ? answer : ''
  const safeMood = SAFETY_MOODS.has(mood) ? mood : (safeAnswer === 'minor_risk' ? 'risk' : safeAnswer === 'need_support' ? 'support' : 'ready')

  return {
    safety_question_id: questionId.slice(0, 80) || null,
    safety_answer: safeAnswer || null,
    safety_mood: safeMood || null,
    safety_note: note || null,
    risk_flag: safeAnswer === 'minor_risk' || safeAnswer === 'need_support' || safeMood === 'risk' || safeMood === 'support'
  }
}

function toSafetyResponse(row) {
  if (!row) return null
  const hasSafetyColumns = Object.prototype.hasOwnProperty.call(row, 'safety_answer')
    || Object.prototype.hasOwnProperty.call(row, 'risk_flag')
  if (!hasSafetyColumns) return null

  return {
    questionId: row.safety_question_id || null,
    answer: row.safety_answer || null,
    mood: row.safety_mood || null,
    note: row.safety_note || null,
    riskFlag: Boolean(row.risk_flag),
    riskStatus: row.risk_status || (row.risk_flag ? 'new' : 'none')
  }
}

module.exports = async (req, res) => {
  try {
    if (!['GET', 'POST'].includes(req.method)) {
      return sendStatus(res, 405, { error: true, message: 'Method not allowed' })
    }

    const source = req.method === 'GET' ? req.query : req.body
    const cleanUid = String(source?.uid || '').trim()
    if (!cleanUid) {
      return sendStatus(res, 400, { error: true, message: 'uid required' })
    }

    const user = await loadUser(cleanUid)
    if (!user) {
      await auditEvent(supabaseAdmin, {
        type: 'daily_checkin_failed',
        actorUid: cleanUid,
        entityType: 'daily_checkin',
        status: 'error',
        detail: { reason: 'user_not_found' }
      })
      return sendStatus(res, 404, { error: true, message: 'user_not_found' })
    }

    const today = bangkokDate()
    const existing = await loadCheckin(cleanUid, today)
    const [safetyQuestion, safetySettings] = await Promise.all([
      getTodaySafetyQuestion(today),
      getSafetySettings()
    ])
    const checkinRule = getCheckinRule(safetySettings)

    if (req.method === 'GET') {
      const streak = existing ? Number(existing.streak || 1) : await nextStreak(cleanUid, safetySettings?.streakResetDate)
      const weeklyMission = await getWeeklyMission(user.id, cleanUid)
      return sendStatus(res, 200, {
        data: {
          checkedIn: Boolean(existing),
          today,
          points: existing ? Number(existing.points || CHECKIN_POINTS) : CHECKIN_POINTS,
          streak,
          checkedInAt: existing?.created_at || null,
          safety: toSafetyResponse(existing),
          safetyQuestion,
          checkinRule,
          weeklyMission
        }
      })
    }

    if (!checkinRule.allowed) {
      await auditEvent(supabaseAdmin, {
        type: 'daily_checkin_blocked',
        actorUid: cleanUid,
        entityType: 'daily_checkin',
        status: 'warning',
        detail: { reason: 'checkin_time_closed', today, checkinRule }
      })
      return sendStatus(res, 403, {
        error: true,
        message: 'checkin_time_closed',
        data: {
          checkedIn: false,
          today,
          points: CHECKIN_POINTS,
          checkinRule,
          safetyQuestion
        }
      })
    }

    if (existing) {
      const weeklyMission = await getWeeklyMission(user.id, cleanUid)
      await auditEvent(supabaseAdmin, {
        type: 'daily_checkin_duplicate',
        actorUid: cleanUid,
        entityType: 'daily_checkin',
        entityId: existing.id,
        status: 'warning',
        detail: { today, streak: existing.streak, points: existing.points }
      })
      return sendStatus(res, 409, {
        error: true,
        message: 'already_checked_in',
        data: {
          checkedIn: true,
          today,
          points: Number(existing.points || CHECKIN_POINTS),
          streak: Number(existing.streak || 1),
          checkedInAt: existing.created_at || null,
          safety: toSafetyResponse(existing),
          safetyQuestion,
          checkinRule,
          weeklyMission
        }
      })
    }

    const streak = await nextStreak(cleanUid, safetySettings?.streakResetDate)
    const safety = normalizeSafetyPayload(source)
    if (safety.safety_question_id && safety.safety_question_id !== safetyQuestion.id) {
      return sendStatus(res, 409, {
        error: true,
        message: 'safety_question_expired',
        data: {
          checkedIn: false,
          today,
          points: CHECKIN_POINTS,
          safetyQuestion,
          checkinRule
        }
      })
    }

    const insertPayload = {
      user_id: user.id,
      uid: cleanUid,
      checkin_date: today,
      points: CHECKIN_POINTS,
      streak,
      ...safety,
      risk_status: safety.risk_flag ? 'new' : 'none'
    }

    let { data: inserted, error: insertError } = await supabaseAdmin
      .from('daily_checkins')
      .insert(insertPayload)
      .select(CHECKIN_SELECT)
      .single()

    if (insertError && isMissingSafetyColumns(insertError)) {
      const { safety_question_id, safety_answer, safety_mood, safety_note, risk_flag, risk_status, ...basePayload } = insertPayload
      const fallback = await supabaseAdmin
        .from('daily_checkins')
        .insert(basePayload)
        .select(CHECKIN_BASE_SELECT)
        .single()
      inserted = fallback.data
      insertError = fallback.error
    }

    if (insertError || !inserted) {
      const isDuplicate = insertError && String(insertError.code || '') === '23505'
      await auditEvent(supabaseAdmin, {
        type: isDuplicate ? 'daily_checkin_duplicate' : 'daily_checkin_failed',
        actorUid: cleanUid,
        entityType: 'daily_checkin',
        status: isDuplicate ? 'warning' : 'error',
        detail: { reason: isDuplicate ? 'duplicate' : 'insert_failed', message: insertError?.message || null, today, safety }
      })
      return sendStatus(res, isDuplicate ? 409 : 500, {
        error: true,
        message: isDuplicate ? 'already_checked_in' : 'checkin_failed'
      })
    }

    const { error: pointError } = await supabaseAdmin.rpc('apply_points', {
      p_user: user.id,
      p_amount: CHECKIN_POINTS,
      p_code: `daily-checkin:${today}`,
      p_type: 'DAILY_CHECKIN',
      p_actor: cleanUid
    })

    if (pointError) {
      await supabaseAdmin.from('daily_checkins').delete().eq('id', inserted.id)
      await auditEvent(supabaseAdmin, {
        type: 'daily_checkin_failed',
        actorUid: cleanUid,
        entityType: 'daily_checkin',
        entityId: inserted.id,
        status: 'error',
        detail: { reason: 'apply_points_failed', message: pointError.message, today }
      })
      return sendStatus(res, 500, { error: true, message: 'apply_points_failed' })
    }

    const { mission: weeklyMission, awardedNow: weeklyBonusAwarded } = await applyWeeklyMissionBonus(user, cleanUid)

    await clearScoreCache(redis, cleanUid)
    await auditEvent(supabaseAdmin, {
      type: 'daily_checkin_success',
      actorUid: cleanUid,
      targetUid: cleanUid,
      entityType: 'daily_checkin',
      entityId: inserted.id,
      status: 'success',
      detail: { today, points: CHECKIN_POINTS, streak, safety, weeklyMission, weeklyBonusAwarded }
    })

    return sendStatus(res, 200, {
      data: {
        checkedIn: true,
        today,
        points: CHECKIN_POINTS,
        streak,
        checkedInAt: inserted.created_at || null,
        safety: toSafetyResponse(inserted) || {
          questionId: safety.safety_question_id,
          answer: safety.safety_answer,
          mood: safety.safety_mood,
          note: safety.safety_note,
          riskFlag: safety.risk_flag,
          riskStatus: safety.risk_flag ? 'new' : 'none'
        },
        safetyQuestion,
        checkinRule,
        weeklyMission,
        weeklyBonusAwarded,
        totalAdded: CHECKIN_POINTS + (weeklyBonusAwarded ? WEEKLY_MISSION_BONUS : 0)
      }
    })
  } catch (error) {
    return sendStatus(res, 500, { error: true, message: String(error?.message || error) })
  }
}
