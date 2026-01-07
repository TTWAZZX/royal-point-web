const { supabaseAdmin, getRedis } = require('../lib/supabase')
const redis = getRedis()

module.exports = async (req, res) => {
  // 1. ตรวจสอบ Method
  if (req.method !== 'POST') return res.status(405).json({ status: 'error', message: 'Method not allowed' })

  // 2. รับค่า (เพิ่ม rewardId และ rewardData เข้ามาสำหรับฟังก์ชันใหม่)
  const { action, adminUid, targetUid, amount, delta, note, rewardId, rewardData } = req.body || {}

  // *ควรเช็ค ADMIN_UID จาก env เพื่อความปลอดภัย (ถ้ามี)*
  // if (adminUid !== process.env.ADMIN_UID) return res.status(403).json(...)

  if (!adminUid) return res.status(400).json({ status: 'error', message: 'Missing adminUid' })

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
      
      // อัปเดตข้อมูลลง Table 'rewards' โดยตรง (เช่น active, stock, name, cost)
      const { data, error } = await supabaseAdmin
        .from('rewards')
        .update(rewardData) // รับ object ที่ต้องการแก้มาเลย
        .eq('id', rewardId)
        .select()
      
      if (error) throw error
      
      // ไม่ต้องเรียก RPC จบการทำงานแล้วส่งผลลัพธ์กลับเลย
      return res.status(200).json({ status: 'success', data })
    }

    // ==================================================
    // ⭐ CASE D: จัดการของรางวัล (เพิ่มใหม่ สำหรับ Stock Manager)
    // ==================================================
    else if (action === 'reward_update') {
      if (!rewardId) return res.status(400).json({ status: 'error', message: 'Missing rewardId' })
      
      // อัปเดตข้อมูลลง Table 'rewards' โดยตรง
      const { data, error } = await supabaseAdmin
        .from('rewards')
        .update(rewardData)
        .eq('id', rewardId)
        .select()
      
      if (error) throw error
      
      return res.status(200).json({ status: 'success', data })
    }

    // ==================================================
    // ⭐ CASE E: ดึงประวัติการแลก (แก้ให้ตรงกับตาราง redemptions)
    // ==================================================
    else if (action === 'get_history') {
      
      // ดึงจากตาราง redemptions โดยตรง และ Join เอาชื่อผู้ใช้กับชื่อรางวัลมาด้วย
      const { data, error } = await supabaseAdmin
        .from('redemptions') 
        .select(`
           id,
           created_at,
           cost,
           status,
           users:user_id ( name, uid ), 
           rewards:reward_id ( name )
        `)
        .order('created_at', { ascending: false })
        .limit(50)

      if (error) {
         console.error('Fetch history error:', error); // log error ไว้ดูใน vercel ได้
         throw error;
      }
      
      // จัดรูปแบบข้อมูลส่งกลับไปหน้าบ้าน
      const formatted = (data || []).map(row => ({
         id: row.id,
         date: row.created_at,
         // ถ้า user หรือ reward ถูกลบไปแล้ว ให้แสดง fallback text
         user: row.users?.name || 'ไม่ระบุชื่อ',
         uid:  row.users?.uid  || 'N/A',
         reward: row.rewards?.name || 'ของรางวัล (ลบแล้ว)', 
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