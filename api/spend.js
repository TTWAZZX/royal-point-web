const { supabaseAdmin, getRedis } = require('../lib/supabase')
const redis = getRedis()

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ status:'error', message:'Method not allowed' })
    }

    const { uid, rewardId } = req.body || {}
    if (!uid || !rewardId) {
      return res.status(400).json({ status:'error', message:'uid & rewardId required' })
    }

    /* ===============================
       LOAD USER
    ================================ */
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('id,uid')
      .eq('uid', uid)
      .single()

    if (!user) {
      return res.status(404).json({ status:'error', message:'user_not_found' })
    }

    /* ===============================
       LOAD REWARD (LOCK TARGET)
    ================================ */
    const { data: reward } = await supabaseAdmin
      .from('rewards')
      .select('id,name,cost,stock')
      .eq('id', rewardId)
      .single()

    if (!reward) {
      return res.status(404).json({ status:'error', message:'reward_not_found' })
    }

    if (reward.stock <= 0) {
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
      return res.status(400).json({ status:'error', message:'insufficient_points' })
    }

    /* ===============================
       ATOMIC STOCK DECREASE (LOCK)
    ================================ */
    const { error: eStock } = await supabaseAdmin
      .from('rewards')
      .update({ stock: reward.stock - 1 })
      .eq('id', reward.id)
      .eq('stock', reward.stock) // ⭐ ตัวกันแลกซ้อนของจริง

    if (eStock) {
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
      p_actor: uid
    })

    if (ePoint) {
      // 🔁 rollback stock
      await supabaseAdmin
        .from('rewards')
        .update({ stock: reward.stock })
        .eq('id', reward.id)

      return res.status(500).json({ status:'error', message:'apply_points_failed' })
    }

    /* ===============================
       LOG REDEMPTION
    ================================ */
    await supabaseAdmin.from('redemptions').insert({
      user_id: user.id,
      reward_id: reward.id,
      cost: reward.cost,
      status: 'approved'
    })

    if (redis) {
      try { await redis.del(`score:${uid}`) } catch {}
    }

    return res.status(200).json({
      status: 'success',
      reward: reward.name,
      spent: reward.cost
    })

  } catch (e) {
    return res.status(500).json({ status:'error', message:String(e) })
  }
}
