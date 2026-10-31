const { createHash } = require('crypto');
const { supabaseAdmin, getRedis, clearScoreCache } = require('../lib/supabase');
const { auditEvent } = require('../lib/audit');
const { AuthError, authenticateRequest, sendAuthError } = require('../lib/line-auth');
const {
  buildCouponRedeemedMessage,
  queueLineNotification,
  userCouponUrl
} = require('../lib/line-messaging');
const redis = getRedis();

function hashToken(value) {
  return createHash('sha256').update(String(value || '')).digest('hex');
}

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ status: 'error', message: 'Method not allowed' });
    }

    const { uid, code, couponTicket } = req.body || {};
    const cleanUid = String(uid || '').trim();
    const cleanCode = String(code || '').trim();
    const cleanTicket = String(couponTicket || '').trim();
    if (!cleanUid || (!cleanCode && !cleanTicket)) {
      return res.status(400).json({ status: 'error', message: 'uid and coupon required' });
    }
    if (cleanTicket && cleanTicket.length < 32) {
      return res.status(400).json({ status: 'error', message: 'coupon_ticket_invalid' });
    }
    await authenticateRequest(req, { claimedUid: cleanUid });

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
    let redeemedCode = cleanCode;

    if (cleanCode || cleanTicket) {
      // อ่านคูปอง
      let couponQuery = supabaseAdmin
        .from('coupons')
        .select('code, point, status, coupon_type, assigned_uid, assignment_reason, assignment_state, assigned_at, used_at');
      couponQuery = cleanTicket
        ? couponQuery.eq('assignment_token_hash', hashToken(cleanTicket))
        : couponQuery.eq('code', cleanCode);
      const { data: coupon, error: ec1 } = await couponQuery.single();

      if (ec1 || !coupon) {
        await auditEvent(supabaseAdmin, { type: 'redeem_failed', actorUid: cleanUid, entityType: 'coupon', entityId: cleanCode || null, status: 'error', detail: { reason: cleanTicket ? 'invalid_ticket' : 'invalid_code' } });
        return res.status(404).json({ status: 'error', message: 'invalid_code' });
      }
      redeemedCode = coupon.code;

      const isPersonal = String(coupon.coupon_type || 'general') === 'personal';
      if (isPersonal && coupon.assignment_state !== 'active') {
        await auditEvent(supabaseAdmin, { type: 'redeem_failed', actorUid: cleanUid, entityType: 'coupon', entityId: coupon.code, status: 'error', detail: { reason: 'coupon_cancelled' } });
        return res.status(410).json({ status: 'error', message: 'coupon_cancelled' });
      }
      if (isPersonal && coupon.assigned_uid !== cleanUid) {
        await auditEvent(supabaseAdmin, { type: 'redeem_failed', actorUid: cleanUid, targetUid: coupon.assigned_uid, entityType: 'coupon', entityId: coupon.code, status: 'error', detail: { reason: 'coupon_not_owner' } });
        return res.status(403).json({ status: 'error', message: 'coupon_not_owner' });
      }

      const status = String(coupon.status || '').toLowerCase();
      if (status !== 'unused') {
        await auditEvent(supabaseAdmin, { type: 'redeem_failed', actorUid: cleanUid, entityType: 'coupon', entityId: coupon.code, status: 'error', detail: { reason: 'already_used', couponStatus: status } });
        // เคยใช้ไปแล้ว หรือสถานะไม่ถูกต้อง
        return res.status(400).json({ status: 'error', message: 'already_used' });
      }

      // อัปเดตสถานะเป็น used แบบอะตอมมิก (กันแข่งกันกด)
      const { data: updated, error: e3 } = await supabaseAdmin
        .from('coupons')
        .update({ status: 'used', claimer: cleanUid, used_at: new Date().toISOString() })
        .eq('code', coupon.code)
        .eq('status', 'unused')
        .eq('assignment_state', 'active')
        .select('code, point, status, coupon_type, assigned_uid, assignment_reason, assigned_at, used_at')
        .single();

      if (e3 || !updated) {
        await auditEvent(supabaseAdmin, { type: 'redeem_failed', actorUid: cleanUid, entityType: 'coupon', entityId: coupon.code, status: 'error', detail: { reason: 'coupon_conflict' } });
        // หากอัปเดตไม่ได้ แปลว่าอีกคำขอแย่งใช้ไปแล้ว
        return res.status(409).json({ status: 'error', message: 'coupon_conflict' });
      }

      add = Number(updated.point || coupon.point || 0) || 0;

      // ให้แต้ม
      const { error: e4 } = await supabaseAdmin.rpc('apply_points', {
        p_user: user.id,
        p_amount: add,
        p_code: coupon.code,
        p_type: 'COUPON_REDEEM',
        p_actor: cleanUid
      });
      if (e4) {
        await supabaseAdmin
          .from('coupons')
          .update({ status: 'unused', claimer: null, used_at: null })
          .eq('code', coupon.code)
          .eq('claimer', cleanUid);

        await auditEvent(supabaseAdmin, { type: 'redeem_failed', actorUid: cleanUid, entityType: 'coupon', entityId: coupon.code, status: 'error', detail: { reason: 'apply_points_failed', message: e4.message } });
        return res.status(500).json({ status: 'error', message: 'apply_points_failed' });
      }

      if (isPersonal) {
        const { data: balanceRow } = await supabaseAdmin
          .from('user_points')
          .select('balance')
          .eq('user_id', user.id)
          .maybeSingle();
        try {
          await queueLineNotification({
            dedupeKey: `coupon-used:${coupon.code}`,
            caseId: null,
            recipientUid: cleanUid,
            messageKind: 'coupon_redeemed',
            payload: buildCouponRedeemedMessage({
              coupon: updated,
              balance: balanceRow?.balance ?? 0,
              url: userCouponUrl(req, '')
            })
          });
        } catch (notifyError) {
          console.error('[redeem] coupon LINE confirmation failed:', notifyError?.message || notifyError);
        }
      }

    }

    // ล้าง cache คะแนนของผู้ใช้
    await clearScoreCache(redis, cleanUid);
    await auditEvent(supabaseAdmin, { type: 'redeem_success', actorUid: cleanUid, entityType: 'coupon', entityId: redeemedCode, status: 'success', detail: { added: add, source: cleanTicket ? 'personal_link' : 'code' } });

    return res.status(200).json({ status: 'success', added: add });

  } catch (e) {
    if (e instanceof AuthError) return sendAuthError(res, e);
    if (/coupon_type|assigned_uid|assignment_token_hash|schema cache|column .* does not exist/i.test(String(e?.message || e))) {
      return res.status(503).json({ status: 'error', message: 'coupon_assignment_not_ready' });
    }
    return res.status(500).json({ status: 'error', message: String(e) });
  }
};
