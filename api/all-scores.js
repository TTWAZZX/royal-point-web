const { supabaseAdmin } = require('../lib/supabase')

module.exports = async (req, res) => {
  try {
    if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })

    // ดึง users + คะแนน (left join)
    const { data: users, error } = await supabaseAdmin
      .from('users')
      .select('uid,name,room,dob,passport,tel, user_points(balance)')
      .order('uid', { ascending: true })

    if (error) return res.status(500).json({ error: 'db_error' })

    const rows = (users || []).map(u => ({
      uid: u.uid,
      name: u.name || '',
      room: u.room || '',
      dob: u.dob || '',
      passport: u.passport || '',
      tel: u.tel || '',
      score: u.user_points?.balance ?? 0
    }))

    res.status(200).json({ status: 'success', data: rows })
  } catch (e) {
    res.status(500).json({ status: 'error', message: String(e) })
  }
}
