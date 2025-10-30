// api/redeem.js
const { supabaseAdmin, getRedis } = require('../lib/supabase');
const redis = getRedis();

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ status: 'error', code:'method_not_allowed', message: 'Method not allowed' });
    }

    const { uid, code, points } = req.body || {};
    if (!uid || (!code && typeof points !== 'number')) {
      return res.status(400).json({ status: 'error', code:'bad_request', message: 'uid and (code or points) required' });
    }

    const { data: user, error: e1 } = await supabaseAdmin.from('users').select('id,uid').eq('uid', uid).single();
    if (e1 || !user) return res.status(404).json({ status: 'error', code:'user_not_found', message: 'user_not_found' });

    let add = 0;

    if (code) {
      const { data: coupon, error: ec1 } = await supabaseAdmin.from('coupons').select('code, point, status').eq('code', code).single();
      if (ec1 || !coupon) return res.status(404).json({ status: 'error', code:'invalid_code', message: 'invalid_code' });

      const status = String(coupon.status || '').toLowerCase();
      if (status !== 'unused') return res.status(400).json({ status: 'error', code:'already_used', message: 'already_used' });

      const { data: updated, error: e3 } = await supabaseAdmin
        .from('coupons')
        .update({ status: 'used', claimer: uid, used_at: new Date().toISOString() })
        .eq('code', code)
        .eq('status', 'unused')
        .select('code, point, status')
        .single();
      if (e3 || !updated) return res.status(409).json({ status: 'error', code:'coupon_conflict', message: 'coupon_conflict' });

      add = Number(updated.point || coupon.point || 0) || 0;

      const { error: e4 } = await supabaseAdmin.rpc('apply_points', {
        p_user: user.id, p_amount: add, p_code: code, p_type: 'COUPON_REDEEM', p_actor: uid
      });
      if (e4) return res.status(500).json({ status: 'error', code:'apply_points_failed', message: 'apply_points_failed' });
    } else {
      add = Number(points) || 0;
      const { error } = await supabaseAdmin.rpc('apply_points', {
        p_user: user.id, p_amount: add, p_code: 'direct', p_type: 'POINT_ADD', p_actor: uid
      });
      if (error) return res.status(500).json({ status: 'error', code:'apply_points_failed', message: 'apply_points_failed' });
    }

    if (redis) {
      try {
        await Promise.all([ redis.del(`score:${uid}`), redis.del(`score_v2:${uid}`) ]);
      } catch {}
    }

    return res.status(200).json({ status: 'success', added: add });
  } catch (e) {
    return res.status(500).json({ status: 'error', code:'unhandled', message: String(e) });
  }
};
