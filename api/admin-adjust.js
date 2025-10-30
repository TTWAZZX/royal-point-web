const { supabaseAdmin, getRedis } = require('../lib/supabase')
const redis = getRedis()

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return res.status(405).json({ status:'error', message:'Method not allowed' })
    const { adminUid, targetUid, delta, note } = req.body || {}
    if (!adminUid || !targetUid || typeof delta !== 'number') {
      return res.status(400).json({ status:'error', message:'Missing adminUid/targetUid/delta' })
    }

    const { data: user } = await supabaseAdmin.from('users').select('id').eq('uid', targetUid).single()
    if (!user) return res.status(404).json({ status:'error', message:'user_not_found' })

    const { error } = await supabaseAdmin.rpc('apply_points', {
      p_user: user.id,
      p_amount: delta,
      p_code: note || 'admin-adjust',
      p_type: delta >= 0 ? 'ADMIN_ADJUST_ADD' : 'ADMIN_ADJUST_SUB',
      p_actor: adminUid
    })
    if (error) return res.status(500).json({ status:'error', message:'apply_points_failed' })

    if (redis) { try { await redis.del(`score:${targetUid}`) } catch {} }
    res.status(200).json({ status:'success' })
  } catch (e) {
    res.status(500).json({ status:'error', message:String(e) })
  }
}
