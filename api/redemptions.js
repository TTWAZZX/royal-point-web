const { supabaseAdmin } = require('../lib/supabase')

module.exports = async (req, res) => {
  try {
    if (req.method !== 'GET') {
      return res.status(405).json({ status: 'error', message: 'Method not allowed' })
    }

    const uid = String(req.query.uid || '').trim()
    const parsedLimit = parseInt(req.query.limit || '50', 10)
    const limit = Math.max(1, Math.min(Number.isFinite(parsedLimit) ? parsedLimit : 50, 100))
    if (!uid) return res.status(400).json({ status: 'error', message: 'uid required' })

    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('uid', uid)
      .single()

    if (userError || !user) {
      return res.status(404).json({ status: 'error', message: 'user_not_found' })
    }

    const { data, error } = await supabaseAdmin
      .from('redemptions')
      .select(`
        id,
        created_at,
        cost,
        status,
        rewards:reward_id ( name, img_url )
      `)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) throw error

    const items = (data || []).map(row => ({
      id: row.id,
      created_at: row.created_at,
      cost: Number(row.cost || 0),
      status: row.status || '',
      reward_name: row.rewards?.name || 'ของรางวัล',
      reward_img: row.rewards?.img_url || ''
    }))

    return res.status(200).json({ status: 'success', items })
  } catch (e) {
    return res.status(500).json({ status: 'error', message: String(e?.message || e) })
  }
}
