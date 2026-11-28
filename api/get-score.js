const { supabaseAdmin: supabase, getRedis, scoreCacheKey } = require('../lib/supabase');
const { AuthError, authenticateRequest, sendAuthError } = require('../lib/line-auth');
const { getAdminRole } = require('../lib/admin-access');

const redis = getRedis();

function sendScore(res, uid, { balance, updated_at, rewards }, adminStatus) {
  return res.status(200).json({
    status: 'success', uid,
    ...adminStatus,
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
    const auth = await authenticateRequest(req, { claimedUid: uid });
    const adminStatus = req.query.includeAdmin === '1'
      ? { isAdmin: auth.mode === 'token' && auth.uid === uid && Boolean(getAdminRole(auth.uid)) }
      : {};

    const includeRewards = req.query.includeRewards !== '0';
    const cacheKey = scoreCacheKey(uid, includeRewards);
    const useCache = redis && (includeRewards || req.query.fresh !== '1');

    // ---- Try cache first
    if (useCache) {
      try {
        const cached = await redis.get(cacheKey);
        if (cached) return sendScore(res, uid, cached, adminStatus);
      } catch (e) {
        // ignore cache errors
      }
    }

    // A member without a balance row still exists and starts at zero.
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('user_points(balance,updated_at)')
      .eq('uid', uid)
      .maybeSingle();

    if (userError) throw userError;
    if (!user) {
      return res.status(404).json({ status: 'error', message: 'user_not_found' });
    }

    const point = Array.isArray(user.user_points)
      ? (user.user_points.length === 1 ? user.user_points[0] : null)
      : user.user_points;
    const balance = Number(point?.balance ?? 0);
    const updated_at = point?.updated_at ?? null;

    let rewards = [];
    if (includeRewards) {
      const { data: rewardsRows, error: e3 } = await supabase
        .from('rewards')
        .select('id, name, cost, img_url, active')
        .eq('active', true)
        .order('cost', { ascending: true })
        .order('id', { ascending: true });
      if (e3) throw e3;
      rewards = (rewardsRows || []).map(r => ({
        id: r.id,
        name: r.name || '',
        cost: Number(r.cost || 0),
        img: r.img_url || '',
        active: !!r.active
      }));
    }

    // ---- Cache 30s (Upstash)
    if (useCache) {
      try {
        await redis.set(cacheKey, { balance, updated_at, rewards }, { ex: 30 });
      } catch {}
    }

    return sendScore(res, uid, { balance, updated_at, rewards }, adminStatus);

  } catch (err) {
    if (err instanceof AuthError) return sendAuthError(res, err);
    console.error('[api/get-score] error:', err);
    return res.status(500).json({ status: 'error', message: 'โหลดข้อมูลคะแนนไม่สำเร็จ' });
  }
};
