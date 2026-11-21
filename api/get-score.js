const { supabaseAdmin: supabase, getRedis, scoreCacheKey } = require('../lib/supabase');
const { AuthError, authenticateRequest, sendAuthError } = require('../lib/line-auth');

const redis = getRedis();

function sendScore(res, uid, { balance, updated_at, rewards }) {
  return res.status(200).json({
    status: 'success', uid,
    data: { score: balance ?? 0, updated_at: updated_at ?? null, rewards: Array.isArray(rewards) ? rewards : [] }
  });
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    if (req.method !== 'GET') {
      return res.status(405).json({ status: 'error', message: 'Method Not Allowed' });
    }

    const uid = String(req.query.uid || '').trim();
    if (!uid) {
      return res.status(400).json({ status: 'error', message: 'uid required' });
    }
    await authenticateRequest(req, { claimedUid: uid });

    const cacheKey = scoreCacheKey(uid);

    // ---- Try cache first
    if (redis) {
      try {
        const cached = await redis.get(cacheKey);
        if (cached) return sendScore(res, uid, cached);
      } catch (e) {
        // ignore cache errors
      }
    }

    // ---- Load user
    const { data: user, error: e1 } = await supabase
      .from('users')
      .select('id')
      .eq('uid', uid)
      .maybeSingle();

    if (e1) throw e1;
    if (!user) {
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
        await redis.set(cacheKey, { balance, updated_at, rewards }, { ex: 30 });
      } catch {}
    }

    return sendScore(res, uid, { balance, updated_at, rewards });

  } catch (err) {
    if (err instanceof AuthError) return sendAuthError(res, err);
    console.error('[api/get-score] error:', err);
    return res.status(500).json({ status: 'error', message: 'โหลดข้อมูลคะแนนไม่สำเร็จ' });
  }
};
