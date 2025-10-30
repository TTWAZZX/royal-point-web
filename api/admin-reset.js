const { supabaseAdmin, getRedis } = require('../lib/supabase')
const redis = getRedis()

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return res.status(405).json({ status:'error', message:'Method not allowed' })
    const { adminUid, targetUid, note } = req.body || {}
    if (!adminUid || !targetUid) return res.status(400).json({ status:'error', message:'Missing adminUid/targetUid' })

    const { data: user } = await supabaseAdmin.from('users').select('id').eq('uid', targetUid).single()
    if (!user) return res.status(404).json({ status:'error', message:'user_not_found' })

    const { data: up } = await supabaseAdmin
      .from('user_points').select('balance').eq('user_id', user.id).single()
    const cur = up?.balance ?? 0

    if (cur !== 0) {
      const { error } = await supabaseAdmin.rpc('apply_points', {
        p_user: user.id,
        p_amount: -cur,
        p_code: note || 'admin-reset',
        p_type: 'ADMIN_RESET',
        p_actor: adminUid
      })
      if (error) return res.status(500).json({ status:'error', message:'apply_points_failed' })
    }

    if (redis) { try { await redis.del(`score:${targetUid}`) } catch {} }
    res.status(200).json({ status:'success' })
  } catch (e) {
    res.status(500).json({ status:'error', message:String(e) })
  }
}
