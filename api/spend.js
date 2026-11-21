const { supabaseAdmin, getRedis, clearScoreCache } = require('../lib/supabase')
const { auditEvent } = require('../lib/audit')
const { AuthError, authenticateRequest, sendAuthError } = require('../lib/line-auth')
const {
  adminRedemptionUrl,
  buildAdminRedemptionRequestMessage,
  buildRedemptionCreatedMessage,
  queueLineNotification,
  userRedemptionUrl
} = require('../lib/line-messaging')

const redis = getRedis()
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function rpcErrorCode(error) {
  const text = String(error?.message || error || '').toUpperCase()
  for (const code of [
    'REQUEST_ID_REQUIRED', 'REQUEST_ID_CONFLICT', 'USER_NOT_FOUND', 'REWARD_NOT_FOUND', 'REWARD_INACTIVE',
    'OUT_OF_STOCK', 'INSUFFICIENT_POINTS'
  ]) {
    if (text.includes(code)) return code.toLowerCase()
  }
  return 'spend_failed'
}

async function getRedemptionEvidence(req, res) {
  const cleanUid = String(req.query.uid || '').trim()
  const redemptionId = String(req.query.redemptionId || '').trim()
  const requestId = String(req.query.requestId || '').trim()
  const rewardId = String(req.query.rewardId || '').trim()
  const byRequest = !redemptionId && UUID_RE.test(requestId) && UUID_RE.test(rewardId)
  if (!cleanUid || (!UUID_RE.test(redemptionId) && !byRequest)) {
    return res.status(400).json({ status: 'error', message: 'ข้อมูลรายการไม่ครบ' })
  }
  await authenticateRequest(req, { claimedUid: cleanUid })
  let query = supabaseAdmin
    .from('redemptions')
    .select(`
      id,cost,status,created_at,cancel_reason,
      users:user_id!inner(uid),
      rewards:reward_id(name,img_url)
    `)
    .eq('users.uid', cleanUid)
  query = byRequest ? query.eq('request_id', requestId).eq('reward_id', rewardId) : query.eq('id', redemptionId)
  const { data, error } = await query.maybeSingle()
  if (error) throw error
  if (!data) return res.status(404).json({ status: 'error', message: 'ไม่พบรายการแลกของรางวัล' })
  return res.status(200).json({
    status: 'success',
    data: {
      id: data.id,
      cost: data.cost,
      redemptionStatus: data.status,
      createdAt: data.created_at,
      cancelReason: data.cancel_reason,
      rewardName: data.rewards?.name || 'ของรางวัล',
      rewardImage: data.rewards?.img_url || ''
    }
  })
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store')
  try {
    if (req.method === 'GET') return await getRedemptionEvidence(req, res)
    if (req.method !== 'POST') {
      return res.status(405).json({ status: 'error', message: 'Method not allowed' })
    }

    const { uid, rewardId, requestId } = req.body || {}
    const cleanUid = String(uid || '').trim()
    const cleanRewardId = String(rewardId || '').trim()
    const cleanRequestId = String(requestId || '').trim()
    if (!cleanUid || !UUID_RE.test(cleanRewardId)) {
      return res.status(400).json({ status: 'error', message: 'uid & rewardId required' })
    }
    await authenticateRequest(req, { claimedUid: cleanUid })
    if (!UUID_RE.test(cleanRequestId)) {
      return res.status(400).json({ status: 'error', message: 'request_id_required' })
    }

    const { data: rpcRows, error: spendError } = await supabaseAdmin.rpc('spend_reward_atomic', {
      p_uid: cleanUid,
      p_reward_id: cleanRewardId,
      p_request_id: cleanRequestId
    })
    if (spendError) {
      const reason = rpcErrorCode(spendError)
      const audit = await auditEvent(supabaseAdmin, {
        type: 'spend_failed', actorUid: cleanUid, entityType: 'reward', entityId: cleanRewardId,
        status: 'error', detail: { reason, requestId: cleanRequestId }
      })
      const status = ['out_of_stock', 'insufficient_points', 'request_id_conflict'].includes(reason) ? 409
        : reason.endsWith('not_found') ? 404 : reason === 'request_id_required' ? 400 : 500
      return res.status(status).json({ status: 'error', message: reason, correlationId: audit.correlationId })
    }

    const result = Array.isArray(rpcRows) ? rpcRows[0] : rpcRows
    if (!result?.redemption_id) throw new Error('redemption_result_missing')
    const redemption = {
      id: result.redemption_id,
      cost: Number(result.spent || 0),
      status: result.redemption_status || 'approved',
      balance_after: Number(result.balance || 0),
      created_at: result.created_at
    }
    const reward = {
      id: cleanRewardId,
      name: result.reward_name || 'ของรางวัล',
      img_url: result.reward_image || ''
    }

    let userNotification = null
    let adminNotification = null
    const notify = redemption.status === 'approved'
    if (notify) {
      try {
        userNotification = await queueLineNotification({
          dedupeKey: `redemption-created:${redemption.id}`,
          recipientUid: cleanUid,
          messageKind: 'redemption_created',
          payload: buildRedemptionCreatedMessage({
            redemption,
            reward,
            balance: redemption.balance_after,
            url: userRedemptionUrl(req, redemption.id)
          })
        })
      } catch (notifyError) {
        console.error('[spend] user redemption LINE notification failed:', notifyError?.message || notifyError)
      }
    }

    const adminUid = String(process.env.ADMIN_UID || '').trim()
    if (adminUid && notify) {
      try {
        const { data: userProfile } = await supabaseAdmin.from('users').select('name,room').eq('uid', cleanUid).maybeSingle()
        adminNotification = await queueLineNotification({
          dedupeKey: `redemption-admin:${redemption.id}`,
          recipientUid: adminUid,
          messageKind: 'redemption_admin_new',
          payload: buildAdminRedemptionRequestMessage({
            redemption,
            reward,
            user: userProfile || { name: 'ผู้ใช้ Royal Point' },
            url: adminRedemptionUrl(req, redemption.id)
          })
        })
      } catch (notifyError) {
        console.error('[spend] admin redemption LINE notification failed:', notifyError?.message || notifyError)
      }
    }

    const lineStatus = userNotification?.status || (notify ? 'failed' : 'not_needed')
    const adminLineStatus = adminNotification?.status || (notify ? (adminUid ? 'failed' : 'not_configured') : 'not_needed')
    await auditEvent(supabaseAdmin, {
      type: 'spend_success', actorUid: cleanUid, targetUid: cleanUid,
      entityType: 'redemption', entityId: redemption.id, status: 'success',
      detail: {
        cost: redemption.cost,
        rewardName: reward.name,
        redemptionId: redemption.id,
        requestId: cleanRequestId,
        duplicate: Boolean(result.was_duplicate),
        balanceAfter: redemption.balance_after,
        lineStatus,
        adminLineStatus
      }
    })

    await clearScoreCache(redis, cleanUid)
    return res.status(200).json({
      status: 'success',
      reward: reward.name,
      spent: redemption.cost,
      balance: redemption.balance_after,
      redemption,
      duplicate: Boolean(result.was_duplicate),
      lineNotification: {
        status: lineStatus,
        adminStatus: adminLineStatus
      }
    })
  } catch (error) {
    if (error instanceof AuthError) return sendAuthError(res, error)
    console.error('[spend] unexpected error:', error)
    return res.status(500).json({ status: 'error', message: String(error?.message || error) })
  }
}
