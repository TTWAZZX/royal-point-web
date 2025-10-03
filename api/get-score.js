// /api/get-score.js  (Supabase version; shape compatible with frontend)
const { createClient } = require('@supabase/supabase-js')
let redis = null
try {
  const { Redis } = require('@upstash/redis')
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    redis = Redis.fromEnv()
  }
} catch {}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
)

module.exports = async (req, res) => {
  try {
    if (req.method !== 'GET') {
      return res.status(405).json({ status: 'error', message: 'Method Not Allowed' })
    }
    const uid = String(req.query.uid || '').trim()
    if (!uid) return res.status(400).json({ status:'error', message:'uid required' })

    const cacheKey = `score:${uid}`
    if (redis) {
      try {
        const cached = await redis.get(cacheKey)
        if (cached) return res.status(200).json({ status:'success', data:{
          user: cached.user, score: cached.balance ?? 0, updated_at: cached.updated_at ?? null
        }})
      } catch {}
    }

    const { data: user, error: e1 } = await supabase
      .from('users').select('id,uid,name,room,dob,passport,tel')
      .eq('uid', uid).single()
    if (e1 || !user) return res.status(404).json({ status:'error', message:'user_not_found' })

    const { data: point } = await supabase
      .from('user_points').select('balance, updated_at')
      .eq('user_id', user.id).single()

    const result = { user, balance: point?.balance ?? 0, updated_at: point?.updated_at ?? null }

    // cache 30 วิ (ถ้าตั้งค่า Upstash)
    if (redis) { try { await redis.setex(cacheKey, 30, result) } catch {} }

    // IMPORTANT: shape ให้เหมือนเดิมกับ frontend เดิม
    return res.status(200).json({
      status: 'success',
      data: { user, score: result.balance, updated_at: result.updated_at }
    })
  } catch (err) {
    return res.status(500).json({ status: 'error', message: String(err || 'Internal Error') })
  }
}
