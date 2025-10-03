const { supabaseAdmin } = require('../lib/supabase')
const { getRedis } = require('../lib/supabase')

const redis = getRedis()

module.exports = async (req, res) => {
  try {
    if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })
    const uid = (req.query.uid || '').trim()
    if (!uid) return res.status(400).json({ error: 'uid required' })

    const key = `score:${uid}`
    if (redis) {
      try { const cached = await redis.get(key); if (cached) return res.status(200).json(cached) } catch {}
    }

    const { data: user, error: e1 } = await supabaseAdmin
      .from('users').select('id,uid,name,room,dob,passport,tel')
      .eq('uid', uid).single()
    if (e1 || !user) return res.status(404).json({ error: 'user_not_found' })

    const { data: up } = await supabaseAdmin
      .from('user_points').select('balance, updated_at').eq('user_id', user.id).single()

    const result = { user, balance: up?.balance ?? 0, updated_at: up?.updated_at ?? null }
    if (redis) { try { await redis.setex(key, 30, result) } catch {} }
    res.status(200).json(result)
  } catch (err) {
    res.status(500).json({ error: 'server_error', detail: String(err) })
  }
}
