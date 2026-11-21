const { timingSafeEqual } = require('node:crypto')
const { supabaseAdmin, getRedis, clearScoreCache } = require('../lib/supabase')
const { auditEvent } = require('../lib/audit')
const { buildBirthdayRewardMessage, retryLineNotification, userHistoryUrl } = require('../lib/line-messaging')

const REWARD_POINTS = 100
const NOTIFICATION_BATCH_SIZE = 10
const redis = getRedis()

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store')
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ success: false, message: 'วิธีเรียกใช้งานไม่ถูกต้อง' })
  }

  const secret = process.env.CRON_SECRET
  if (!secret?.trim()) {
    console.error('[cron-birthday] missing CRON_SECRET')
    return res.status(503).json({ success: false, message: 'ระบบแจกคะแนนวันเกิดยังตั้งค่าไม่ครบ' })
  }
  const expected = Buffer.from(`Bearer ${secret}`)
  const supplied = Buffer.from(String(req.headers?.authorization || ''))
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return res.status(401).json({ success: false, message: 'ไม่มีสิทธิ์เรียกงานแจกคะแนนวันเกิด' })
  }

  try {
    const { data: run, error } = await supabaseAdmin.rpc('process_birthday_rewards_once', {
      p_amount: REWARD_POINTS,
      p_message: buildBirthdayRewardMessage({ points: REWARD_POINTS, url: userHistoryUrl(req) })
    })
    if (error) throw error

    let sent = 0
    const notifications = run.notifications
    for (let offset = 0; offset < notifications.length; offset += NOTIFICATION_BATCH_SIZE) {
      const results = await Promise.allSettled(notifications.slice(offset, offset + NOTIFICATION_BATCH_SIZE).map(async row => {
        await clearScoreCache(redis, row.uid)
        return retryLineNotification(row.id)
      }))
      sent += results.filter(result => result.status === 'fulfilled' && result.value?.status === 'sent').length
    }

    const summary = {
      runDate: run.run_date,
      processed: run.reward_count,
      repeated: run.repeated,
      sent,
      outstanding: notifications.length - sent
    }
    await auditEvent(supabaseAdmin, {
      type: 'birthday_reward_run', entityType: 'birthday_reward_run', entityId: run.run_date,
      status: summary.outstanding ? 'warning' : 'success', detail: summary
    })
    return res.status(200).json({ success: true, ...summary })
  } catch (error) {
    const result = await auditEvent(supabaseAdmin, {
      type: 'birthday_reward_failed', entityType: 'birthday_reward_run', status: 'error',
      detail: { reason: String(error?.code || 'BIRTHDAY_REWARD_ERROR') }
    })
    console.error('[cron-birthday] reward run failed', { correlationId: result.correlationId, code: error?.code })
    return res.status(500).json({
      success: false, message: 'ประมวลผลคะแนนวันเกิดไม่สำเร็จ', correlationId: result.correlationId
    })
  }
}
