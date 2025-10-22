// /api/get-score.js  (Supabase + Rewards; response shape compatible with frontend)
const { createClient } = require('@supabase/supabase-js');

let redis = null;
try {
  const { Redis } = require('@upstash/redis');
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    redis = Redis.fromEnv(); // Upstash client
  }
} catch {}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

module.exports = async (req, res) => {
  try {
    if (req.method !== 'GET') {
      return res.status(405).json({ status: 'error', message: 'Method Not Allowed' });
    }

    const uid = String(req.query.uid || '').trim();
    if (!uid) {
      return res.status(400).json({ status: 'error', message: 'uid required' });
    }

    const cacheKey = `score_v2:${uid}`; // v2: รวม rewards ด้วยแล้ว

    // ---- Try cache first
    if (redis) {
      try {
        const cached = await redis.get(cacheKey); // { user, balance, updated_at, rewards }
        if (cached) {
          return res.status(200).json({
            status: 'success',
            uid,
            data: {
              user: cached.user,
              score: cached.balance ?? 0,
              updated_at: cached.updated_at ?? null,
              rewards: Array.isArray(cached.rewards) ? cached.rewards : []
            }
          });
        }
      } catch (e) {
        // ignore cache errors
      }
    }

    // ---- Load user
    const { data: user, error: e1 } = await supabase
      .from('users')
      .select('id,uid,name,room,dob,passport,tel')
      .eq('uid', uid)
      .single();

    if (e1 || !user) {
      return res.status(404).json({ status: 'error', message: 'user_not_found' });
    }

    // ---- Load balance
    const { data: point, error: e2 } = await supabase
      .from('user_points')
      .select('balance, updated_at')
      .eq('user_id', user.id)
      .single();

    if (e2 && e2.code !== 'PGRST116') { // ไม่ถือว่า error ถ้าไม่พบแถว
      throw e2;
    }

    const balance = Number(point?.balance ?? 0);
    const updated_at = point?.updated_at ?? null;

    // ---- Load rewards (active only)
    // ปรับชื่อคอลัมน์ตามตารางจริงของคุณได้เลย
    const { data: rewardsRows, error: e3 } = await supabase
      .from('rewards')
      .select('id, name, cost, img_url, active')
      .eq('active', true)
      .order('cost', { ascending: true })
      .order('id',   { ascending: true });

    if (e3) throw e3;

    // แปลงเป็นรูปที่ frontend ใช้
    const rewards = (rewardsRows || []).map(r => ({
      id    : r.id,
      name  : r.name || '',
      cost  : Number(r.cost || 0),
      img   : r.img_url || '',
      active: !!r.active
    }));

    // ---- Cache 30s (Upstash)
    if (redis) {
      try {
        await redis.set(cacheKey, { user, balance, updated_at, rewards }, { ex: 30 });
      } catch {}
    }

    // ---- Response (keep shape + rewards)
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    return res.status(200).json({
      status: 'success',
      uid,
      data: {
        user,
        score: balance,
        updated_at,
        rewards
      }
    });

  } catch (err) {
    console.error('[api/get-score] error:', err);
    return res.status(500).json({ status: 'error', message: String(err?.message || 'Internal Error') });
  }
};
