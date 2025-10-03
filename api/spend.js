const { supabaseAdmin, getRedis } = require('../lib/supabase')
const redis = getRedis()

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return res.status(405).json({ status:'error', message:'Method not allowed' })
    const { uid, cost, rewardId } = req.body || {}
    const amount = Math.max(0, parseInt(cost, 10) || 0)
    if (!uid || !amount) return res.status(400).json({ status:'error', message:'uid & cost required' })

    const { data: user } = await supabaseAdmin.from('users').select('id,uid').eq('uid', uid).single()
    if (!user) return res.status(404).json({ status:'error', message:'user_not_found' })

    // โหลดยอดปัจจุบัน
    const { data: up } = await supabaseAdmin.from('user_points').select('balance').eq('user_id', user.id).single()
    const cur = up?.balance ?? 0
    if (cur < amount) return res.status(400).json({ status:'error', message:'insufficient_points' })

    // หา reward (ออปชัน: ผูกด้วย rewardId ถ้ามี)
    let reward = null
    if (rewardId) {
      const r = await supabaseAdmin.from('rewards').select('id,name,cost').eq('id', rewardId).single()
      reward = r.data || null
    }

    // หักแต้มเป็นทรานแซกชัน
    const { error: e1 } = await supabaseAdmin.rpc('apply_points', {
      p_user: user.id,
      p_amount: -amount,
      p_code: reward ? reward.name : `spend-${amount}`,
      p_type: 'SPEND_REWARD',
      p_actor: uid
    })
    if (e1) return res.status(500).json({ status:'error', message:'apply_points_failed' })

    // บันทึกการแลก (ถ้ามีตาราง redemptions)
    if (reward) {
      await supabaseAdmin.from('redemptions').insert({
        user_id: user.id,
        reward_id: reward.id,
        cost: amount,
        status: 'approved'
      })
    }

    if (redis) { try { await redis.del(`score:${uid}`) } catch {} }
    res.status(200).json({ status:'success', spent: amount, reward: reward?.name || null })
  } catch (e) {
    res.status(500).json({ status:'error', message:String(e) })
  }
}
