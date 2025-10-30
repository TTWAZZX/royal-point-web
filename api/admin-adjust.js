// api/admin-adjust.js
const { supabaseAdmin, getRedis } = require('../lib/supabase');
const requireAdmin = require('../lib/admin-auth');
const redis = getRedis();

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ status:'error', code:'method_not_allowed', message:'Method not allowed' });
  if (!requireAdmin(req, res)) return;

  try {
    const { targetUid, delta, note } = req.body || {};
    if (!targetUid || typeof delta !== 'number') {
      return res.status(400).json({ status:'error', code:'bad_request', message:'targetUid/delta required' });
    }

    const { data: user } = await supabaseAdmin.from('users').select('id').eq('uid', targetUid).single();
    if (!user) return res.status(404).json({ status:'error', code:'user_not_found', message:'user_not_found' });

    const { error } = await supabaseAdmin.rpc('apply_points', {
      p_user: user.id,
      p_amount: delta,
      p_code: note || 'admin-adjust',
      p_type: delta >= 0 ? 'ADMIN_ADJUST_ADD' : 'ADMIN_ADJUST_SUB',
      p_actor: 'admin'
    });
    if (error) return res.status(500).json({ status:'error', code:'apply_points_failed', message:'apply_points_failed' });

    if (redis) {
      try {
        await Promise.all([
          redis.del(`score:${targetUid}`),
          redis.del(`score_v2:${targetUid}`)
        ]);
      } catch {}
    }

    res.status(200).json({ status:'success' });
  } catch (e) {
    res.status(500).json({ status:'error', code:'unhandled', message:String(e) });
  }
};
