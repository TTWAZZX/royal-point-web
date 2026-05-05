const { supabaseAdmin, getRedis, clearScoreCache } = require('../lib/supabase')
const { auditEvent } = require('../lib/audit')
const redis = getRedis()

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ status:'error', message:'Method not allowed' })
    }

    const { uid, rewardId } = req.body || {}
    const cleanUid = String(uid || '').trim()
    const cleanRewardId = String(rewardId || '').trim()
    if (!cleanUid || !cleanRewardId) {
      return res.status(400).json({ status:'error', message:'uid & rewardId required' })
    }

    /* ===============================
       LOAD USER
    ================================ */
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('id,uid')
      .eq('uid', cleanUid)
      .single()

    if (!user) {
      await auditEvent(supabaseAdmin, { type: 'spend_failed', actorUid: cleanUid, entityType: 'reward', entityId: cleanRewardId, status: 'error', detail: { reason: 'user_not_found' } })
      return res.status(404).json({ status:'error', message:'user_not_found' })
    }

    /* ===============================
       LOAD REWARD (LOCK TARGET)
    ================================ */
    const { data: reward } = await supabaseAdmin
      .from('rewards')
      .select('id,name,cost,stock,active')
      .eq('id', cleanRewardId)
      .single()

    if (!reward) {
      await auditEvent(supabaseAdmin, { type: 'spend_failed', actorUid: cleanUid, entityType: 'reward', entityId: cleanRewardId, status: 'error', detail: { reason: 'reward_not_found' } })
      return res.status(404).json({ status:'error', message:'reward_not_found' })
    }

    if (!reward.active) {
      await auditEvent(supabaseAdmin, { type: 'spend_failed', actorUid: cleanUid, entityType: 'reward', entityId: reward.id, status: 'error', detail: { reason: 'reward_inactive' } })
      return res.status(400).json({ status:'error', message:'reward_inactive' })
    }

    if (reward.stock <= 0) {
      await auditEvent(supabaseAdmin, { type: 'spend_failed', actorUid: cleanUid, entityType: 'reward', entityId: reward.id, status: 'error', detail: { reason: 'out_of_stock' } })
      return res.status(400).json({ status:'error', message:'out_of_stock' })
    }

    /* ===============================
       CHECK USER BALANCE
    ================================ */
    const { data: up } = await supabaseAdmin
      .from('user_points')
      .select('balance')
      .eq('user_id', user.id)
      .single()

    const balance = up?.balance ?? 0
    if (balance < reward.cost) {
      await auditEvent(supabaseAdmin, { type: 'spend_failed', actorUid: cleanUid, entityType: 'reward', entityId: reward.id, status: 'error', detail: { reason: 'insufficient_points', balance, cost: reward.cost } })
      return res.status(400).json({ status:'error', message:'insufficient_points' })
    }

    /* ===============================
       ATOMIC STOCK DECREASE (LOCK)
    ================================ */
    const { data: stockData, error: eStock } = await supabaseAdmin
      .from('rewards')
      .update({ stock: reward.stock - 1 })
      .eq('id', reward.id)
      .eq('stock', reward.stock) // ⭐ ตัวกันแลกซ้อนของจริง
      .select('id')

    if (eStock || !stockData || stockData.length === 0) {
      await auditEvent(supabaseAdmin, { type: 'spend_failed', actorUid: cleanUid, entityType: 'reward', entityId: reward.id, status: 'error', detail: { reason: 'stock_conflict' } })
      return res.status(409).json({ status:'error', message:'stock_conflict' })
    }

    /* ===============================
       DEDUCT POINTS (AFTER LOCK)
    ================================ */
    const { error: ePoint } = await supabaseAdmin.rpc('apply_points', {
      p_user: user.id,
      p_amount: -reward.cost,
      p_code: reward.name,
      p_type: 'SPEND_REWARD',
      p_actor: cleanUid
    })

    if (ePoint) {
      // 🔁 rollback stock
      await supabaseAdmin
        .from('rewards')
        .update({ stock: reward.stock })
        .eq('id', reward.id)

      await auditEvent(supabaseAdmin, { type: 'spend_failed', actorUid: cleanUid, entityType: 'reward', entityId: reward.id, status: 'error', detail: { reason: 'apply_points_failed', message: ePoint.message } })
      return res.status(500).json({ status:'error', message:'apply_points_failed' })
    }

    /* ===============================
       LOG REDEMPTION
    ================================ */
    const { data: redemption, error: redemptionError } = await supabaseAdmin.from('redemptions').insert({
      user_id: user.id,
      reward_id: reward.id,
      cost: reward.cost,
      status: 'approved'
    }).select('id, created_at').single()

    if (redemptionError) {
      await auditEvent(supabaseAdmin, { type: 'redemption_log_failed', actorUid: cleanUid, entityType: 'reward', entityId: reward.id, status: 'error', detail: { message: redemptionError.message } })
    }

    await auditEvent(supabaseAdmin, { type: 'spend_success', actorUid: cleanUid, entityType: 'reward', entityId: reward.id, status: 'success', detail: { cost: reward.cost, redemptionId: redemption?.id || null } })

    await clearScoreCache(redis, cleanUid)

    return res.status(200).json({
      status: 'success',
      reward: reward.name,
      spent: reward.cost,
      redemption: redemption || null
    })

  } catch (e) {
    return res.status(500).json({ status:'error', message:String(e) })
  }
}
