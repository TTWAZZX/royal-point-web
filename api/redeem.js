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

function couponRpcReason(error) {
  const text = String(error?.message || error || '').toUpperCase();
  const codes = [
    'USER_NOT_FOUND', 'INVALID_CODE', 'COUPON_IDENTIFIER_INVALID',
    'COUPON_CANCELLED', 'COUPON_NOT_OWNER', 'ALREADY_USED', 'INVALID_COUPON_POINTS'
  ];
  const code = codes.find(item => text.includes(item));
  return code ? code.toLowerCase() : 'redeem_failed';
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    if (!['GET', 'POST'].includes(req.method)) {
      return res.status(405).json({ status: 'error', message: 'Method not allowed' });
    }

    const input = req.method === 'GET' ? (req.query || {}) : (req.body || {});
    const { uid, code, couponTicket } = input;
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

    if (req.method === 'GET') {
      if (!cleanTicket) {
        return res.status(400).json({ status: 'error', message: 'coupon_ticket_required' });
      }
      const { data: coupon, error: couponError } = await supabaseAdmin
        .from('coupons')
        .select('code,point,status,claimer,coupon_type,assigned_uid,assignment_state,used_at')
        .eq('assignment_token_hash', hashToken(cleanTicket))
        .maybeSingle();
      if (couponError) throw couponError;
      if (!coupon) return res.status(404).json({ status: 'error', message: 'invalid_code' });
      if (coupon.assigned_uid !== cleanUid) {
        return res.status(403).json({ status: 'error', message: 'coupon_not_owner' });
      }
      const redeemed = coupon.status === 'used' && coupon.claimer === cleanUid;
      return res.status(200).json({
        status: 'success',
        data: {
          state: redeemed ? 'redeemed' : (coupon.assignment_state === 'cancelled' ? 'cancelled' : 'pending'),
          added: redeemed ? Number(coupon.point || 0) : 0,
          usedAt: coupon.used_at || null
        }
      });
    }

    const { data: rpcRows, error: redeemError } = await supabaseAdmin.rpc('redeem_coupon_atomic', {
      p_uid: cleanUid,
      p_code: cleanCode || null,
      p_ticket_hash: cleanTicket ? hashToken(cleanTicket) : null
    });
    if (redeemError) {
      if (/redeem_coupon_atomic|schema cache|function .* does not exist/i.test(String(redeemError?.message || redeemError))) {
        return res.status(503).json({ status: 'error', message: 'coupon_atomic_not_ready' });
      }
      const reason = couponRpcReason(redeemError);
      await auditEvent(supabaseAdmin, {
        type: 'redeem_failed', actorUid: cleanUid, entityType: 'coupon', entityId: cleanCode || null,
        status: 'error', detail: { reason, source: cleanTicket ? 'personal_link' : 'code' }
      });
      const httpStatus = reason === 'user_not_found' || reason === 'invalid_code' ? 404
        : reason === 'coupon_not_owner' ? 403
          : reason === 'coupon_cancelled' ? 410
            : reason === 'already_used' ? 409
              : reason === 'coupon_identifier_invalid' ? 400 : 500;
      return res.status(httpStatus).json({ status: 'error', message: reason });
    }

    const result = Array.isArray(rpcRows) ? rpcRows[0] : rpcRows;
    if (!result?.coupon_code) throw new Error('coupon_result_missing');
    const add = Number(result.added_points || 0);
    const redeemedCode = String(result.coupon_code);
    const coupon = {
      code: redeemedCode,
      point: add,
      coupon_type: result.coupon_type || 'general',
      assigned_uid: result.assigned_uid || null,
      assignment_reason: result.assignment_reason || null,
      assigned_at: result.assigned_at || null,
      used_at: result.used_at || null
    };

    if (coupon.coupon_type === 'personal') {
      try {
        await queueLineNotification({
          dedupeKey: `coupon-used:${redeemedCode}`,
          caseId: null,
          recipientUid: cleanUid,
          messageKind: 'coupon_redeemed',
          payload: buildCouponRedeemedMessage({
            coupon,
            balance: Number(result.balance || 0),
            url: userCouponUrl(req, '')
          })
        });
      } catch (notifyError) {
        console.error('[redeem] coupon LINE confirmation failed:', notifyError?.message || notifyError);
      }
    }

    // ล้าง cache คะแนนของผู้ใช้
    await clearScoreCache(redis, cleanUid);
    await auditEvent(supabaseAdmin, { type: 'redeem_success', actorUid: cleanUid, entityType: 'coupon', entityId: redeemedCode, status: 'success', detail: { added: add, source: cleanTicket ? 'personal_link' : 'code', duplicate: Boolean(result.was_duplicate) } });

    return res.status(200).json({
      status: 'success',
      added: add,
      duplicate: Boolean(result.was_duplicate),
      ...(Number.isSafeInteger(result.balance) ? { balance: result.balance } : {})
    });

  } catch (e) {
    if (e instanceof AuthError) return sendAuthError(res, e);
    if (/redeem_coupon_atomic|coupon_type|assigned_uid|assignment_token_hash|schema cache|column .* does not exist/i.test(String(e?.message || e))) {
      return res.status(503).json({ status: 'error', message: 'coupon_assignment_not_ready' });
    }
    return res.status(500).json({ status: 'error', message: String(e) });
  }
};
