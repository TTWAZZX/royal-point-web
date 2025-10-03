const { supabaseAdmin } = require('../lib/supabase')

module.exports = async (req, res) => {
  try {
    if (req.method !== 'GET') return res.status(405).json({ status:'error', message:'Method not allowed' })
    const uid = (req.query.uid || '').trim()
    const limit = Math.min(parseInt(req.query.limit || '25', 10), 100)
    const offset = Math.max(parseInt(req.query.offset || '0', 10), 0)
    if (!uid) return res.status(400).json({ status:'error', message:'uid required' })

    const { data: user, error: e1 } = await supabaseAdmin
      .from('users').select('id').eq('uid', uid).single()
    if (e1 || !user) return res.status(404).json({ status:'error', message:'user_not_found' })

    const { data, error } = await supabaseAdmin
      .from('point_transactions')
      .select('amount, code, type, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending:false })
      .range(offset, offset + limit - 1)
    if (error) return res.status(500).json({ status:'error', message:'db_error' })

    res.status(200).json({ status:'success', items: data ?? [], nextOffset: offset + (data?.length || 0) })
  } catch (e) {
    res.status(500).json({ status:'error', message:String(e) })
  }
}
