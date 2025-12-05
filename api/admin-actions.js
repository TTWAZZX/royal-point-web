const { supabaseAdmin, getRedis } = require('../lib/supabase')
const redis = getRedis()

module.exports = async (req, res) => {
  // 1. ตรวจสอบ Method
  if (req.method !== 'POST') return res.status(405).json({ status: 'error', message: 'Method not allowed' })

  // 2. รับค่า action เพื่อแยกว่าจะทำอะไร (adjust / reset / giveaway)
  const { action, adminUid, targetUid, amount, note, delta } = req.body || {}

  if (!adminUid) return res.status(400).json({ status: 'error', message: 'Missing adminUid' })

  try {
    let rpcName = ''
    let rpcParams = {}

    // --- CASE 1: ADJUST (ปรับคะแนนรายคน) ---
    if (action === 'adjust') {
      if (!targetUid || typeof delta !== 'number') return res.status(400).json({ status: 'error', message: 'Missing target/delta' })
      
      const { data: user } = await supabaseAdmin.from('users').select('id').eq('uid', targetUid).single()
      if (!user) return res.status(404).json({ status: 'error', message: 'user_not_found' })

      rpcName = 'apply_points'
      rpcParams = {
        p_user: user.id,
        p_amount: delta,
        p_code: note || 'admin-adjust',
        p_type: delta >= 0 ? 'ADMIN_ADJUST_ADD' : 'ADMIN_ADJUST_SUB',
        p_actor: adminUid
      }
    } 
    
    // --- CASE 2: RESET (ล้างคะแนนรายคน) ---
    else if (action === 'reset') {
      if (!targetUid) return res.status(400).json({ status: 'error', message: 'Missing targetUid' })

      const { data: user } = await supabaseAdmin.from('users').select('id').eq('uid', targetUid).single()
      if (!user) return res.status(404).json({ status: 'error', message: 'user_not_found' })

      // เช็คยอดปัจจุบันก่อน
      const { data: up } = await supabaseAdmin.from('user_points').select('balance').eq('user_id', user.id).single()
      const cur = up?.balance ?? 0

      if (cur === 0) return res.status(200).json({ status: 'success', message: 'Already 0' })

      rpcName = 'apply_points'
      rpcParams = {
        p_user: user.id,
        p_amount: -cur, // ลบเท่ากับยอดที่มี
        p_code: note || 'admin-reset',
        p_type: 'ADMIN_RESET',
        p_actor: adminUid
      }
    }

    // --- CASE 3: GIVEAWAY (แจกทุกคน) ---
    else if (action === 'giveaway') {
      if (!amount || typeof amount !== 'number' || amount <= 0) return res.status(400).json({ status: 'error', message: 'Invalid amount' })
      if (!note) return res.status(400).json({ status: 'error', message: 'Note required' })

      rpcName = 'admin_giveaway_to_all'
      rpcParams = {
        p_amount: amount,
        p_note: note,
        p_type: 'ADMIN_GIVEAWAY',
        p_actor: adminUid
      }
    } 
    
    else {
      return res.status(400).json({ status: 'error', message: 'Invalid action' })
    }

    // 3. ยิงเข้า Database
    const { error } = await supabaseAdmin.rpc(rpcName, rpcParams)
    
    if (error) {
      console.error('RPC Error:', error)
      return res.status(500).json({ status: 'error', message: 'DB Error: ' + error.message })
    }

    // 4. ล้าง Cache (เฉพาะกรณีรายบุคคล)
    if (targetUid && redis) {
      try { await redis.del(`score:${targetUid}`) } catch {}
    }

    res.status(200).json({ status: 'success' })

  } catch (e) {
    console.error(e)
    res.status(500).json({ status: 'error', message: String(e) })
  }
}