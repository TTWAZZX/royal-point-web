const { supabaseAdmin, getRedis } = require('../lib/supabase')
const redis = getRedis()

module.exports = async (req, res) => {
  // GET /api/admin-actions?uid=... → ตรวจว่าเป็น admin หรือไม่ (ใช้โดย checkAdminFromServer)
  if (req.method === 'GET') {
    const { uid } = req.query
    if (!uid || !process.env.ADMIN_UID) return res.json({ isAdmin: false })
    return res.json({ isAdmin: uid === process.env.ADMIN_UID })
  }

  // 1. ตรวจสอบ Method
  if (req.method !== 'POST') return res.status(405).json({ status: 'error', message: 'Method not allowed' })

  // 2. รับค่า (เพิ่ม rewardId และ rewardData เข้ามาสำหรับฟังก์ชันใหม่)
  const { action, adminUid, targetUid, amount, delta, note, rewardId, rewardData } = req.body || {}

  if (!adminUid || adminUid !== process.env.ADMIN_UID) {
    return res.status(403).json({ status: 'error', message: 'Forbidden' })
  }

  try {
    let rpcName = ''
    let rpcParams = {}

    // ==================================================
    // 🟢 CASE A: ปรับแต้มรายคน (ของเดิม ห้ามลบ)
    // ==================================================
    if (action === 'adjust') {
      if (!targetUid || typeof delta !== 'number') return res.status(400).json({ status: 'error', message: 'Missing data' })
      const { data: user } = await supabaseAdmin.from('users').select('id').eq('uid', targetUid).single()
      if (!user) return res.status(404).json({ status: 'error', message: 'User not found' })

      rpcName = 'apply_points'
      rpcParams = {
        p_user: user.id,
        p_amount: delta,
        p_code: note || 'admin-adjust',
        p_type: delta >= 0 ? 'ADMIN_GIVE' : 'ADMIN_DEDUCT',
        p_actor: adminUid
      }
    }

    // ==================================================
    // 🟢 CASE B: รีเซ็ตแต้มเป็น 0 (ของเดิม ห้ามลบ)
    // ==================================================
    else if (action === 'reset') {
      if (!targetUid) return res.status(400).json({ status: 'error', message: 'Missing targetUid' })
      const { data: user } = await supabaseAdmin.from('users').select('id').eq('uid', targetUid).single()
      if (!user) return res.status(404).json({ status: 'error', message: 'User not found' })

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

    // ==================================================
    // 🟢 CASE C: แจกทุกคน (ของเดิม ห้ามลบ)
    // ==================================================
    else if (action === 'giveaway') {
      if (!amount || amount <= 0) return res.status(400).json({ status: 'error', message: 'Invalid amount' })
      // if (!note) return res.status(400).json({ status: 'error', message: 'Note required' }) // บางทีอาจไม่บังคับ note

      rpcName = 'admin_giveaway_to_all'
      rpcParams = {
        p_amount: amount,
        p_note: note || 'Giveaway',
        p_admin_uid: adminUid
      }
    } 
    
    // ==================================================
    // ⭐ CASE D: จัดการของรางวัล (เพิ่มใหม่ สำหรับ Stock Manager)
    // ==================================================
    else if (action === 'reward_update') {
      if (!rewardId) return res.status(400).json({ status: 'error', message: 'Missing rewardId' })

      // whitelist เฉพาะ field ที่ admin แก้ได้ — ป้องกัน mass-assignment
      const ALLOWED_REWARD_FIELDS = ['name', 'cost', 'stock', 'stock_max', 'active', 'img_url', 'sort_index']
      const safeData = Object.fromEntries(
        Object.entries(rewardData || {}).filter(([k]) => ALLOWED_REWARD_FIELDS.includes(k))
      )
      if (Object.keys(safeData).length === 0) {
        return res.status(400).json({ status: 'error', message: 'No valid fields to update' })
      }

      // อัปเดตข้อมูลลง Table 'rewards' โดยตรง (เช่น active, stock, name, cost)
      const { data, error } = await supabaseAdmin
        .from('rewards')
        .update(safeData)
        .eq('id', rewardId)
        .select()
      
      if (error) throw error
      
      // ไม่ต้องเรียก RPC จบการทำงานแล้วส่งผลลัพธ์กลับเลย
      return res.status(200).json({ status: 'success', data })
    }

    // ==================================================
    // ⭐ CASE E: ดึงประวัติการแลก (แก้ให้ตรง DB เป๊ะๆ)
    // ==================================================
    else if (action === 'get_history') {
      
      const { data, error } = await supabaseAdmin
        .from('redemptions') 
        .select(`
           id,
           created_at,
           cost,
           status,
           users:user_id ( name, uid ),
           rewards:reward_id ( name, img_url ) 
        `)
        // หมายเหตุ: 
        // 1. users: ไม่ดึงรูปภาพเพราะใน DB ไม่มีคอลัมน์รูป
        // 2. rewards: ดึง img_url (ตามรูป table rewards ของคุณ)
        .order('created_at', { ascending: false })
        .limit(50)

      if (error) {
         console.error('Fetch history error:', error);
         throw error;
      }
      
      // จัด Format ข้อมูล
      const formatted = (data || []).map(row => ({
         id: row.id,
         date: row.created_at,
         
         user_name: row.users?.name || 'ไม่ระบุชื่อ',
         user_uid:  row.users?.uid  || 'N/A',
         user_img:  '', // ใน DB ไม่มีรูป ก็ปล่อยว่างไว้ เดี๋ยวหน้าบ้านใส่ Default ให้
         
         reward_name: row.rewards?.name || 'ของรางวัล (ลบแล้ว)', 
         reward_img:  row.rewards?.img_url || 'https://placehold.co/100?text=No+Image', // ใช้ img_url
         
         cost: row.cost,
         status: row.status
      }))

      return res.status(200).json({ status: 'success', data: formatted })
    }

    else {
      return res.status(400).json({ status: 'error', message: 'Invalid action' })
    }

    // ==================================================
    // Process RPC calls (สำหรับ Case A, B, C)
    // ==================================================
    const { error } = await supabaseAdmin.rpc(rpcName, rpcParams)
    
    if (error) {
      console.error('RPC Error:', error)
      return res.status(500).json({ status: 'error', message: error.message })
    }

    res.status(200).json({ status: 'success' })

  } catch (e) {
    console.error('Admin Action Error:', e)
    res.status(500).json({ status: 'error', message: String(e) })
  }
}