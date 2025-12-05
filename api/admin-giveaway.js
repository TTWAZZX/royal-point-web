const { supabaseAdmin, getRedis } = require('../lib/supabase')
const redis = getRedis()

module.exports = async (req, res) => {
  try {
    // 1. เช็คว่าเป็น POST
    if (req.method !== 'POST') return res.status(405).json({ status: 'error', message: 'Method not allowed' })
    
    const { adminUid, amount, note } = req.body || {}

    // 2. ตรวจสอบข้อมูล
    if (!adminUid) return res.status(400).json({ status: 'error', message: 'Missing adminUid' })
    if (!amount || typeof amount !== 'number' || amount <= 0) {
      return res.status(400).json({ status: 'error', message: 'Invalid amount' })
    }
    if (!note) return res.status(400).json({ status: 'error', message: 'Note is required' })

    // 3. เรียก SQL Function ที่เราสร้างไว้ในขั้นตอนที่ 1
    const { error } = await supabaseAdmin.rpc('admin_giveaway_to_all', {
      p_amount: amount,
      p_note: note,
      p_type: 'ADMIN_GIVEAWAY',
      p_actor: adminUid
    })

    if (error) {
      console.error('RPC Error:', error)
      return res.status(500).json({ status: 'error', message: 'Database error: ' + error.message })
    }

    // (ถ้ามี Redis เราจะไม่ลบ Cache ของทุกคนเพราะจะหนักระบบ ปล่อยให้มันหมดอายุเองตามเวลา)

    res.status(200).json({ status: 'success', message: 'Points distributed to all users' })

  } catch (e) {
    console.error(e)
    res.status(500).json({ status: 'error', message: String(e) })
  }
}