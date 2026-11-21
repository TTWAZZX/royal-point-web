const { createClient } = require('@supabase/supabase-js')

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
}

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
)

function getRedis() {
  try {
    const { Redis } = require('@upstash/redis')
    if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
      return Redis.fromEnv()
    }
  } catch (_) {}
  return null
}

async function clearScoreCache(redis, uid) {
  if (!redis || !uid) return
  await Promise.allSettled([scoreCacheKey(uid), `score_v2:${uid}`, `score:${uid}`].map(async key => redis.del(key)))
}

function scoreCacheKey(uid) {
  return `score_v3:${uid}`
}

module.exports = { supabaseAdmin, getRedis, clearScoreCache, scoreCacheKey }
