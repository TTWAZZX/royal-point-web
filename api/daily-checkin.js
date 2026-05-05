const { supabaseAdmin, getRedis, clearScoreCache } = require('../lib/supabase')
const { auditEvent } = require('../lib/audit')

const redis = getRedis()
const CHECKIN_POINTS = 5
const TIME_ZONE = 'Asia/Bangkok'

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
    .select('id,points,streak,checkin_date,created_at')
    .eq('uid', uid)
    .eq('checkin_date', checkinDate)
    .maybeSingle()

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
          checkedInAt: existing?.created_at || null
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
          checkedInAt: existing.created_at || null
        }
      })
    }

    const streak = await nextStreak(cleanUid)
    const { data: inserted, error: insertError } = await supabaseAdmin
      .from('daily_checkins')
      .insert({
        user_id: user.id,
        uid: cleanUid,
        checkin_date: today,
        points: CHECKIN_POINTS,
        streak
      })
      .select('id,points,streak,checkin_date,created_at')
      .single()

    if (insertError || !inserted) {
      const isDuplicate = insertError && String(insertError.code || '') === '23505'
      await auditEvent(supabaseAdmin, {
        type: isDuplicate ? 'daily_checkin_duplicate' : 'daily_checkin_failed',
        actorUid: cleanUid,
        entityType: 'daily_checkin',
        status: isDuplicate ? 'warning' : 'error',
        detail: { reason: isDuplicate ? 'duplicate' : 'insert_failed', message: insertError?.message || null, today }
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
      detail: { today, points: CHECKIN_POINTS, streak }
    })

    return sendStatus(res, 200, {
      data: {
        checkedIn: true,
        today,
        points: CHECKIN_POINTS,
        streak,
        checkedInAt: inserted.created_at || null
      }
    })
  } catch (error) {
    return sendStatus(res, 500, { error: true, message: String(error?.message || error) })
  }
}
