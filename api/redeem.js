const { supabaseAdmin, getRedis, clearScoreCache } = require('../lib/supabase');
const { auditEvent } = require('../lib/audit');
const redis = getRedis();

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ status: 'error', message: 'Method not allowed' });
    }

    const { uid, code } = req.body || {};
    const cleanUid = String(uid || '').trim();
    const cleanCode = String(code || '').trim();
    if (!cleanUid || !cleanCode) {
      return res.status(400).json({ status: 'error', message: 'uid and code required' });
    }

    // หา user
    const { data: user, error: e1 } = await supabaseAdmin
      .from('users')
      .select('id,uid')
      .eq('uid', cleanUid)
      .single();
    if (e1 || !user) {
      await auditEvent(supabaseAdmin, { type: 'redeem_failed', actorUid: cleanUid, entityType: 'coupon', entityId: cleanCode, status: 'error', detail: { reason: 'user_not_found' } });
      return res.status(404).json({ status: 'error', message: 'user_not_found' });
    }

    let add = 0;

    if (cleanCode) {
      // อ่านคูปอง
      const { data: coupon, error: ec1 } = await supabaseAdmin
        .from('coupons')
        .select('code, point, status')
        .eq('code', cleanCode)
        .single();

      if (ec1 || !coupon) {
        await auditEvent(supabaseAdmin, { type: 'redeem_failed', actorUid: cleanUid, entityType: 'coupon', entityId: cleanCode, status: 'error', detail: { reason: 'invalid_code' } });
        return res.status(404).json({ status: 'error', message: 'invalid_code' });
      }

      const status = String(coupon.status || '').toLowerCase();
      if (status !== 'unused') {
        await auditEvent(supabaseAdmin, { type: 'redeem_failed', actorUid: cleanUid, entityType: 'coupon', entityId: cleanCode, status: 'error', detail: { reason: 'already_used', couponStatus: status } });
        // เคยใช้ไปแล้ว หรือสถานะไม่ถูกต้อง
        return res.status(400).json({ status: 'error', message: 'already_used' });
      }

      // อัปเดตสถานะเป็น used แบบอะตอมมิก (กันแข่งกันกด)
      const { data: updated, error: e3 } = await supabaseAdmin
        .from('coupons')
        .update({ status: 'used', claimer: cleanUid, used_at: new Date().toISOString() })
        .eq('code', cleanCode)
        .eq('status', 'unused')
        .select('code, point, status')
        .single();

      if (e3 || !updated) {
        await auditEvent(supabaseAdmin, { type: 'redeem_failed', actorUid: cleanUid, entityType: 'coupon', entityId: cleanCode, status: 'error', detail: { reason: 'coupon_conflict' } });
        // หากอัปเดตไม่ได้ แปลว่าอีกคำขอแย่งใช้ไปแล้ว
        return res.status(409).json({ status: 'error', message: 'coupon_conflict' });
      }

      add = Number(updated.point || coupon.point || 0) || 0;

      // ให้แต้ม
      const { error: e4 } = await supabaseAdmin.rpc('apply_points', {
        p_user: user.id,
        p_amount: add,
        p_code: cleanCode,
        p_type: 'COUPON_REDEEM',
        p_actor: cleanUid
      });
      if (e4) {
        await supabaseAdmin
          .from('coupons')
          .update({ status: 'unused', claimer: null, used_at: null })
          .eq('code', cleanCode)
          .eq('claimer', cleanUid);

        await auditEvent(supabaseAdmin, { type: 'redeem_failed', actorUid: cleanUid, entityType: 'coupon', entityId: cleanCode, status: 'error', detail: { reason: 'apply_points_failed', message: e4.message } });
        return res.status(500).json({ status: 'error', message: 'apply_points_failed' });
      }

    }

    // ล้าง cache คะแนนของผู้ใช้
    await clearScoreCache(redis, cleanUid);
    await auditEvent(supabaseAdmin, { type: 'redeem_success', actorUid: cleanUid, entityType: 'coupon', entityId: cleanCode, status: 'success', detail: { added: add } });

    return res.status(200).json({ status: 'success', added: add });

  } catch (e) {
    return res.status(500).json({ status: 'error', message: String(e) });
  }
};
