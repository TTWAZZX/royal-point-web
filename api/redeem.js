const { supabaseAdmin, getRedis } = require('../lib/supabase');
const redis = getRedis();

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ status: 'error', message: 'Method not allowed' });
    }

    const { uid, code, points } = req.body || {};
    if (!uid || (!code && typeof points !== 'number')) {
      return res.status(400).json({ status: 'error', message: 'uid and (code or points) required' });
    }

    // หา user
    const { data: user, error: e1 } = await supabaseAdmin
      .from('users')
      .select('id,uid')
      .eq('uid', uid)
      .single();
    if (e1 || !user) {
      return res.status(404).json({ status: 'error', message: 'user_not_found' });
    }

    let add = 0;

    if (code) {
      // อ่านคูปอง
      const { data: coupon, error: ec1 } = await supabaseAdmin
        .from('coupons')
        .select('code, point, status')
        .eq('code', code)
        .single();

      if (ec1 || !coupon) {
        return res.status(404).json({ status: 'error', message: 'invalid_code' });
      }

      const status = String(coupon.status || '').toLowerCase();
      if (status !== 'unused') {
        // เคยใช้ไปแล้ว หรือสถานะไม่ถูกต้อง
        return res.status(400).json({ status: 'error', message: 'already_used' });
      }

      // อัปเดตสถานะเป็น used แบบอะตอมมิก (กันแข่งกันกด)
      const { data: updated, error: e3 } = await supabaseAdmin
        .from('coupons')
        .update({ status: 'used', claimer: uid, used_at: new Date().toISOString() })
        .eq('code', code)
        .eq('status', 'unused')
        .select('code, point, status')
        .single();

      if (e3 || !updated) {
        // หากอัปเดตไม่ได้ แปลว่าอีกคำขอแย่งใช้ไปแล้ว
        return res.status(409).json({ status: 'error', message: 'coupon_conflict' });
      }

      add = Number(updated.point || coupon.point || 0) || 0;

      // ให้แต้ม
      const { error: e4 } = await supabaseAdmin.rpc('apply_points', {
        p_user: user.id,
        p_amount: add,
        p_code: code,
        p_type: 'COUPON_REDEEM',
        p_actor: uid
      });
      if (e4) {
        return res.status(500).json({ status: 'error', message: 'apply_points_failed' });
      }

    } else {
      // กรณีเพิ่มแต้มตรง ๆ (admin / ระบบ)
      add = Number(points) || 0;

      const { error } = await supabaseAdmin.rpc('apply_points', {
        p_user: user.id,
        p_amount: add,
        p_code: 'direct',
        p_type: 'POINT_ADD',
        p_actor: uid
      });
      if (error) {
        return res.status(500).json({ status: 'error', message: 'apply_points_failed' });
      }
    }

    // ล้าง cache คะแนนของผู้ใช้
    if (redis) {
      try { await redis.del(`score:${uid}`); } catch {}
    }

    return res.status(200).json({ status: 'success', added: add });

  } catch (e) {
    return res.status(500).json({ status: 'error', message: String(e) });
  }
};
