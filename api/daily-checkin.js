const { supabaseAdmin, getRedis, clearScoreCache } = require('../lib/supabase')
const { auditEvent } = require('../lib/audit')

const redis = getRedis()
const CHECKIN_POINTS = 5
const TIME_ZONE = 'Asia/Bangkok'
const CHECKIN_SELECT = 'id,points,streak,checkin_date,created_at,safety_question_id,safety_answer,safety_mood,safety_note,risk_flag'
const CHECKIN_BASE_SELECT = 'id,points,streak,checkin_date,created_at'
const SAFETY_ANSWERS = new Set(['ready', 'minor_risk', 'need_support'])
const SAFETY_MOODS = new Set(['ready', 'tired', 'risk', 'support'])

function bangkokDate(offsetDays = 0) {
  const now = new Date()
  const bangkokNow = new Date(now.toLocaleString('en-US', { timeZone: TIME_ZONE }))
  bangkokNow.setDate(bangkokNow.getDate() + offsetDays)
  const year = bangkokNow.getFullYear()
  const month = String(bangkokNow.getMonth() + 1).padStart(2, '0')
  const day = String(bangkokNow.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
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

async function nextStreak(uid) {
  const yesterday = bangkokDate(-1)
  const { data, error } = await supabaseAdmin
    .from('daily_checkins')
    .select('streak,checkin_date')
    .eq('uid', uid)
    .eq('checkin_date', yesterday)
    .maybeSingle()

  if (error) throw error
  return data ? Number(data.streak || 0) + 1 : 1
}

function sendStatus(res, statusCode, payload) {
  const { error, ...body } = payload
  return res.status(statusCode).json({
    status: payload.error ? 'error' : 'success',
    ...body
  })
}

function isMissingSafetyColumns(error) {
  const message = String(error?.message || error?.details || '')
  return /safety_|risk_flag|column .* does not exist|Could not find .* column/i.test(message)
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
    riskFlag: Boolean(row.risk_flag)
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

    if (req.method === 'GET') {
      const streak = existing ? Number(existing.streak || 1) : await nextStreak(cleanUid)
      return sendStatus(res, 200, {
        data: {
          checkedIn: Boolean(existing),
          today,
          points: existing ? Number(existing.points || CHECKIN_POINTS) : CHECKIN_POINTS,
          streak,
          checkedInAt: existing?.created_at || null,
          safety: toSafetyResponse(existing)
        }
      })
    }

    if (existing) {
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
          safety: toSafetyResponse(existing)
        }
      })
    }

    const streak = await nextStreak(cleanUid)
    const safety = normalizeSafetyPayload(source)
    const insertPayload = {
      user_id: user.id,
      uid: cleanUid,
      checkin_date: today,
      points: CHECKIN_POINTS,
      streak,
      ...safety
    }

    let { data: inserted, error: insertError } = await supabaseAdmin
      .from('daily_checkins')
      .insert(insertPayload)
      .select(CHECKIN_SELECT)
      .single()

    if (insertError && isMissingSafetyColumns(insertError)) {
      const { safety_question_id, safety_answer, safety_mood, safety_note, risk_flag, ...basePayload } = insertPayload
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

    await clearScoreCache(redis, cleanUid)
    await auditEvent(supabaseAdmin, {
      type: 'daily_checkin_success',
      actorUid: cleanUid,
      targetUid: cleanUid,
      entityType: 'daily_checkin',
      entityId: inserted.id,
      status: 'success',
      detail: { today, points: CHECKIN_POINTS, streak, safety }
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
          riskFlag: safety.risk_flag
        }
      }
    })
  } catch (error) {
    return sendStatus(res, 500, { error: true, message: String(error?.message || error) })
  }
}
