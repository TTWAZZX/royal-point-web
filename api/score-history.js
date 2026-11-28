const { supabaseAdmin: supabase } = require('../lib/supabase');
const { AuthError, authenticateRequest, isAdminUid, sendAuthError } = require('../lib/line-auth');

async function loadRedemptions(userId, limit, pendingOnly) {
  let query = supabase
    .from('redemptions')
    .select('id,created_at,cost,status,rewards:reward_id(name,img_url)')
    .eq('user_id', userId);
  if (pendingOnly) query = query.eq('status', 'approved');
  const { data, error } = await query.order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return (data || []).map(row => ({
    id: row.id,
    created_at: row.created_at,
    cost: Number(row.cost || 0),
    status: row.status || '',
    reward_name: row.rewards?.name || 'ของรางวัล',
    reward_img: row.rewards?.img_url || ''
  }));
}

async function loadPoints(userId, offset, limit) {
  return supabase
    .from('point_transactions')
    .select('id, amount, code, type, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(offset, offset + limit - 1);
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    if (req.method !== 'GET') {
      return res.status(405).json({ status: 'error', message: 'Method not allowed' });
    }

    const uid = String(req.query.uid || '').trim();
    const parsedLimit = parseInt(req.query.limit || '25', 10);
    const parsedOffset = parseInt(req.query.offset || '0', 10);
    const limit = Math.max(1, Math.min(Number.isFinite(parsedLimit) ? parsedLimit : 25, 100));
    const offset = Math.max(Number.isFinite(parsedOffset) ? parsedOffset : 0, 0);
    if (!uid) return res.status(400).json({ status: 'error', message: 'uid required' });

    const auth = await authenticateRequest(req, { claimedUid: uid, enforceClaimMatch: false });
    if (auth.mode === 'token' && auth.uid !== uid && !isAdminUid(auth.uid)) {
      return res.status(403).json({ status: 'error', message: 'AUTH_UID_MISMATCH', code: 'AUTH_UID_MISMATCH' });
    }

    // map uid -> user_id
    const { data: user, error: uerr } = await supabase
      .from('users')
      .select('id')
      .eq('uid', uid)
      .single();

    if (uerr || !user) {
      return res.status(404).json({ status: 'error', message: 'user_not_found' });
    }

    if (req.query.kind === 'timeline') {
      const [points, redemptions] = await Promise.allSettled([
        loadPoints(user.id, offset, limit),
        loadRedemptions(user.id, limit, false)
      ]);
      const pointItems = points.status === 'fulfilled' && !points.value.error ? (points.value.data ?? []) : null;
      const redemptionItems = redemptions.status === 'fulfilled' ? redemptions.value : null;
      if (pointItems === null && redemptionItems === null) {
        return res.status(500).json({ status: 'error', message: 'db_error' });
      }
      return res.status(200).json({ status: 'success', pointItems, redemptionItems });
    }

    if (req.query.kind === 'redemptions') {
      const items = await loadRedemptions(user.id, limit, req.query.pickup === 'pending');
      return res.status(200).json({ status: 'success', items });
    }

    const { data, error } = await loadPoints(user.id, offset, limit);

    if (error) {
      return res.status(500).json({ status: 'error', message: 'db_error' });
    }

    return res.status(200).json({
      status: 'success',
      items: data ?? [],
      nextOffset: offset + (data?.length || 0)
    });
  } catch (e) {
    if (e instanceof AuthError) return sendAuthError(res, e);
    return res.status(500).json({ status: 'error', message: 'unhandled_error' });
  }
};
