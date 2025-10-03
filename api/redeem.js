const { supabaseAdmin, getRedis } = require('../lib/supabase')
const redis = getRedis()

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return res.status(405).json({ status:'error', message:'Method not allowed' })
    const { uid, code, points } = req.body || {}
    if (!uid || (!code && typeof points !== 'number')) {
      return res.status(400).json({ status:'error', message:'uid and (code or points) required' })
    }

    const { data: user, error: e1 } = await supabaseAdmin
      .from('users').select('id,uid').eq('uid', uid).single()
    if (e1 || !user) return res.status(404).json({ status:'error', message:'user_not_found' })

    let add = 0
    if (code) {
      const { data: coupon } = await supabaseAdmin.from('coupons').select('*').eq('code', code).single()
      if (!coupon) return res.status(404).json({ status:'error', message:'invalid_code' })
      if (coupon.status === 'Used') return res.status(400).json({ status:'error', message:'already_used' })

      const { error: e3 } = await supabaseAdmin
        .from('coupons')
        .update({ status:'Used', claimer: uid, used_at: new Date().toISOString() })
        .eq('code', code)
      if (e3) return res.status(500).json({ status:'error', message:'mark_used_failed' })

      add = coupon.point
      const { error: e4 } = await supabaseAdmin.rpc('apply_points', {
        p_user: user.id, p_amount: add, p_code: code, p_type: 'COUPON_REDEEM', p_actor: uid
      })
      if (e4) return res.status(500).json({ status:'error', message:'apply_points_failed' })
    } else {
      add = Number(points) || 0
      const { error } = await supabaseAdmin.rpc('apply_points', {
        p_user: user.id, p_amount: add, p_code: 'direct', p_type: 'POINT_ADD', p_actor: uid
      })
      if (error) return res.status(500).json({ status:'error', message:'apply_points_failed' })
    }

    if (redis) { try { await redis.del(`score:${uid}`) } catch {} }
    res.status(200).json({ status:'success', added: add })
  } catch (e) {
    res.status(500).json({ status:'error', message:String(e) })
  }
}
