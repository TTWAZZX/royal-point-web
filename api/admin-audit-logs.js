const { supabaseAdmin } = require('../lib/supabase')

module.exports = async (req, res) => {
  try {
    if (req.method !== 'GET') {
      return res.status(405).json({ status: 'error', message: 'Method not allowed' })
    }

    const adminUid = String(req.query.adminUid || '').trim()
    if (!adminUid || adminUid !== process.env.ADMIN_UID) {
      return res.status(403).json({ status: 'error', message: 'Forbidden' })
    }

    const parsedLimit = parseInt(req.query.limit || '100', 10)
    const limit = Math.max(1, Math.min(Number.isFinite(parsedLimit) ? parsedLimit : 100, 200))
    const type = String(req.query.type || '').trim()

    let query = supabaseAdmin
      .from('audit_logs')
      .select('id,event_type,actor_uid,target_uid,entity_type,entity_id,status,detail,created_at')
      .order('created_at', { ascending: false })
      .limit(limit)

    if (type) query = query.eq('event_type', type)

    const { data, error } = await query
    if (error) throw error

    return res.status(200).json({ status: 'success', data: data || [] })
  } catch (e) {
    const message = String(e?.message || e)
    if (/audit_logs|relation .* does not exist/i.test(message)) {
      return res.status(200).json({ status: 'success', data: [], warning: 'audit_logs table not found' })
    }
    return res.status(500).json({ status: 'error', message })
  }
}
