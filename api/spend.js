// api/spend.js
const { supabaseAdmin, getRedis } = require('../lib/supabase');
// const requireAdmin = require('../lib/admin-auth'); // เปิดใช้หากต้องการจำกัดเฉพาะแอดมิน
const redis = getRedis();

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ status:'error', code:'method_not_allowed', message:'Method not allowed' });
  // if (!requireAdmin(req, res)) return;

  try {
    const { uid, cost, rewardId, note } = req.body || {};
    if (!uid || !(Number.isFinite(cost) && cost > 0)) {
      return res.status(400).json({ status:'error', code:'bad_request', message:'uid/cost required' });
    }

    const { data: user, error: e1 } = await supabaseAdmin.from('users').select('id,uid').eq('uid', uid).single();
    if (e1 || !user) return res.status(404).json({ status:'error', code:'user_not_found', message:'user_not_found' });

    const { data: up, error: e2 } = await supabaseAdmin.from('user_points').select('balance').eq('user_id', user.id).single();
    if (e2) return res.status(500).json({ status:'error', code:'db_error', message:'db_error' });

    const cur = Number(up?.balance ?? 0);
    if (cur < cost) return res.status(400).json({ status:'error', code:'insufficient_balance', message:'insufficient_balance' });

    const { error: e3 } = await supabaseAdmin.rpc('apply_points', {
      p_user: user.id,
      p_amount: -Math.abs(cost),
      p_code: note || `spend:${rewardId || 'reward'}`,
      p_type: 'REDEEM_SPEND',
      p_actor: uid
    });
    if (e3) return res.status(500).json({ status:'error', code:'apply_points_failed', message:'apply_points_failed' });

    if (redis) {
      try { await Promise.all([ redis.del(`score:${uid}`), redis.del(`score_v2:${uid}`) ]); } catch {}
    }

    return res.status(200).json({ status:'success' });
  } catch (e) {
    return res.status(500).json({ status:'error', code:'unhandled', message:String(e) });
  }
};
