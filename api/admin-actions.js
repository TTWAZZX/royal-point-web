const { supabaseAdmin, getRedis } = require('../lib/supabase')
const redis = getRedis()

module.exports = async (req, res) => {
  // 1. ตรวจสอบ Method
  if (req.method !== 'POST') return res.status(405).json({ status: 'error', message: 'Method not allowed' })

  // 2. รับค่า action
  const { action, adminUid, targetUid, amount, delta, note } = req.body || {}

  if (!adminUid) return res.status(400).json({ status: 'error', message: 'Missing adminUid' })

  try {
    let rpcName = ''
    let rpcParams = {}

    // --- CASE A: ปรับแต้มรายคน (Adjust) ---
    if (action === 'adjust') {
      if (!targetUid || typeof delta !== 'number') return res.status(400).json({ status: 'error', message: 'Missing data' })
      
      const { data: user } = await supabaseAdmin.from('users').select('id').eq('uid', targetUid).single()
      if (!user) return res.status(404).json({ status: 'error', message: 'User not found' })

      rpcName = 'apply_points'
      rpcParams = {
        p_user: user.id,
        p_amount: delta,
        p_code: note || 'admin-adjust',
        p_type: delta >= 0 ? 'ADMIN_ADJUST_ADD' : 'ADMIN_ADJUST_SUB',
        p_actor: adminUid
      }
    } 
    
    // --- CASE B: ล้างแต้มรายคน (Reset) ---
    else if (action === 'reset') {
      if (!targetUid) return res.status(400).json({ status: 'error', message: 'Missing targetUid' })
      
      const { data: user } = await supabaseAdmin.from('users').select('id').eq('uid', targetUid).single()
      if (!user) return res.status(404).json({ status: 'error', message: 'User not found' })

      // เช็คยอดก่อนลบ
      const { data: up } = await supabaseAdmin.from('user_points').select('balance').eq('user_id', user.id).single()
      const cur = up?.balance ?? 0
      if (cur === 0) return res.status(200).json({ status: 'success', message: 'Already 0' })

      rpcName = 'apply_points'
      rpcParams = {
        p_user: user.id,
        p_amount: -cur,
        p_code: note || 'admin-reset',
        p_type: 'ADMIN_RESET',
        p_actor: adminUid
      }
    }

    // --- CASE C: แจกทุกคน (Giveaway) ---
    else if (action === 'giveaway') {
      if (!amount || amount <= 0) return res.status(400).json({ status: 'error', message: 'Invalid amount' })
      if (!note) return res.status(400).json({ status: 'error', message: 'Note required' })

      rpcName = 'admin_giveaway_to_all'
      rpcParams = {
        p_amount: amount,
        p_note: note,
        p_admin_uid: adminUid
      }
    } 
    
    else {
      return res.status(400).json({ status: 'error', message: 'Invalid action' })
    }

    // 3. ยิง Database
    const { error } = await supabaseAdmin.rpc(rpcName, rpcParams)
    
    if (error) {
      console.error('RPC Error:', error)
      return res.status(500).json({ status: 'error', message: 'DB Error: ' + error.message })
    }

    // 4. ล้าง Cache (เฉพาะรายบุคคล)
    if (targetUid && redis) {
      try { await redis.del(`score:${targetUid}`) } catch {}
    }

    res.status(200).json({ status: 'success' })

  } catch (e) {
    console.error(e)
    res.status(500).json({ status: 'error', message: String(e) })
  }
}