const { createClient } = require('@supabase/supabase-js');
const { createHash, createHmac, randomBytes } = require('crypto');
const { auditEvent } = require('../lib/audit');
const { AuthError, authenticateRequest, sendAuthError } = require('../lib/line-auth');
const {
  buildCouponCancelledMessage,
  buildCouponIssuedMessage,
  queueLineNotification,
  retryLineNotification,
  userCouponUrl
} = require('../lib/line-messaging');

function genCode(len = 6) {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const bytes = randomBytes(len);
  let s = '';
  for (let i = 0; i < len; i++) s += chars[bytes[i] % chars.length];
  return s;
}

function hashToken(value) {
  return createHash('sha256').update(String(value || '')).digest('hex');
}

function assignmentTicket(requestId) {
  return createHmac('sha256', String(process.env.SUPABASE_SERVICE_ROLE_KEY || ''))
    .update(`personal-coupon:${requestId}`)
    .digest('base64url');
}

function publicNotification(row) {
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    attemptCount: Number(row.attempt_count || 0),
    lastError: row.last_error || null,
    sentAt: row.sent_at || null
  };
}

module.exports = async (req, res) => {
  try {
  if (!['GET', 'DELETE', 'POST'].includes(req.method)) {
    return res.status(405).json({ status: 'error', message: 'Method not allowed' });
  }

  let body = {};
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  } catch {
    body = {};
  }
  const adminUid = req.query.adminUid || body.adminUid;
  if (!adminUid || adminUid !== process.env.ADMIN_UID) {
    return res.status(403).json({ status: 'error', message: 'Forbidden' });
  }
  await authenticateRequest(req, { claimedUid: adminUid, allowRecovery: false });

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  const action = String(req.query.action || body.action || '').trim();

  if (req.method === 'POST' && action === 'generate') {
    const {
      amount, count, qty,
      points, point, value,
      prefix = ''
    } = body;

    const n = Math.max(1, Math.min(500, Number(count ?? qty ?? amount) || 1));
    const p = Math.max(1, Number(points ?? point ?? value) || 1);
    const nowIso = new Date().toISOString();
    const rows = Array.from({ length: n }, () => ({
      code: String(prefix || '') + genCode(6),
      point: p,
      status: 'unused',
      claimer: null,
      used_at: null,
      created_at: nowIso
    }));

    const { error } = await supabase.from('coupons').insert(rows);
    if (error) return res.status(500).json({ status: 'error', message: error.message });

    return res.status(200).json({
      status: 'success',
      created: rows.length,
      data: {
        inserted: rows.length,
        codes: rows.map(row => row.code)
      }
    });
  }

  if (req.method === 'POST' && action === 'assign') {
    const targetUid = String(body.targetUid || '').trim();
    const requestId = String(body.requestId || '').trim().toLowerCase();
    const requestedPoints = Number(body.points);
    const points = Number.isFinite(requestedPoints) ? Math.trunc(requestedPoints) : 0;
    const reason = String(body.reason || '').trim().slice(0, 300);
    if (!targetUid || points < 1 || points > 1000000 || !reason) {
      return res.status(400).json({ status: 'error', message: 'กรุณาเลือกผู้ใช้ ระบุคะแนน และเหตุผลให้ครบ' });
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(requestId)) {
      return res.status(400).json({ status: 'error', message: 'ไม่พบรหัสป้องกันการสร้างคูปองซ้ำ กรุณาปิดหน้าต่างแล้วลองใหม่' });
    }

    const { data: user, error: userError } = await supabase
      .from('users')
      .select('uid,name')
      .eq('uid', targetUid)
      .single();
    if (userError || !user) {
      return res.status(404).json({ status: 'error', message: 'ไม่พบผู้ใช้ที่เลือก' });
    }

    const nowIso = new Date().toISOString();
    const ticket = assignmentTicket(requestId);
    const row = {
      code: `P${genCode(9)}`,
      point: points,
      status: 'unused',
      claimer: null,
      used_at: null,
      created_at: nowIso,
      coupon_type: 'personal',
      assigned_uid: targetUid,
      assigned_at: nowIso,
      assigned_by: adminUid,
      assignment_reason: reason,
      assignment_request_id: requestId,
      assignment_token_hash: hashToken(ticket),
      assignment_state: 'active'
    };

    let { data: created, error: insertError } = await supabase
      .from('coupons')
      .insert(row)
      .select('code,point,status,coupon_type,assigned_uid,assigned_at,assigned_by,assignment_reason,assignment_request_id,assignment_state,created_at')
      .single();
    let createdNow = !insertError;
    if (insertError && String(insertError.code || '') === '23505') {
      const existingResult = await supabase
        .from('coupons')
        .select('code,point,status,coupon_type,assigned_uid,assigned_at,assigned_by,assignment_reason,assignment_request_id,assignment_state,created_at')
        .eq('assignment_request_id', requestId)
        .single();
      if (existingResult.error) throw existingResult.error;
      created = existingResult.data;
      insertError = null;
      createdNow = false;
    }
    if (insertError) throw insertError;
    if (!created || created.assigned_uid !== targetUid || created.assigned_by !== adminUid) {
      return res.status(409).json({ status: 'error', message: 'รหัสคำขอนี้ถูกใช้งานแล้ว กรุณาปิดหน้าต่างและทำรายการใหม่' });
    }

    let notification = null;
    try {
      notification = await queueLineNotification({
        dedupeKey: `coupon-issued:${created.code}`,
        caseId: null,
        recipientUid: targetUid,
        messageKind: 'coupon_issued',
        payload: buildCouponIssuedMessage({
          coupon: created,
          user,
          url: userCouponUrl(req, ticket)
        })
      });
    } catch (notifyError) {
      console.error('[admin-coupons] issue LINE notification failed:', notifyError?.message || notifyError);
    }

    if (createdNow) {
      await auditEvent(supabase, {
        type: 'coupon_assigned',
        actorUid: adminUid,
        targetUid,
        entityType: 'coupon',
        entityId: created.code,
        status: 'success',
        detail: { points, reason, lineStatus: notification?.status || 'failed' }
      });
    }

    return res.status(200).json({
      status: 'success',
      data: {
        ...created,
        assigned_name: user.name || '',
        idempotentReplay: !createdNow,
        lineNotification: publicNotification(notification)
      }
    });
  }

  if (req.method === 'POST' && action === 'cancel_assignment') {
    const code = String(body.code || '').trim();
    const reason = String(body.reason || '').trim().slice(0, 300);
    if (!code || !reason) {
      return res.status(400).json({ status: 'error', message: 'กรุณาระบุคูปองและเหตุผลที่ยกเลิก' });
    }

    const { data: cancelled, error: cancelError } = await supabase
      .from('coupons')
      .update({
        assignment_state: 'cancelled',
        cancelled_at: new Date().toISOString(),
        cancelled_by: adminUid,
        cancel_reason: reason
      })
      .eq('code', code)
      .eq('coupon_type', 'personal')
      .eq('assignment_state', 'active')
      .eq('status', 'unused')
      .select('code,assigned_uid,point')
      .maybeSingle();
    if (cancelError) throw cancelError;
    if (!cancelled) {
      return res.status(409).json({ status: 'error', message: 'ยกเลิกไม่ได้ คูปองอาจถูกใช้หรือยกเลิกไปแล้ว' });
    }


    let notification = null;
    try {
      notification = await queueLineNotification({
        dedupeKey: `coupon-cancelled:${cancelled.code}`,
        caseId: null,
        recipientUid: cancelled.assigned_uid,
        messageKind: 'coupon_cancelled',
        payload: buildCouponCancelledMessage({
          coupon: cancelled,
          reason,
          url: userCouponUrl(req, '')
        })
      });
    } catch (notifyError) {
      console.error('[admin-coupons] cancellation LINE notification failed:', notifyError?.message || notifyError);
    }

    await auditEvent(supabase, {
      type: 'coupon_assignment_cancelled',
      actorUid: adminUid,
      targetUid: cancelled.assigned_uid,
      entityType: 'coupon',
      entityId: cancelled.code,
      status: 'success',
      detail: { points: cancelled.point, reason, lineStatus: notification?.status || 'failed' }
    });
    return res.status(200).json({ status: 'success', data: { ...cancelled, lineNotification: publicNotification(notification) } });
  }

  if (req.method === 'POST' && action === 'retry_notification') {
    const notificationId = String(body.notificationId || '').trim();
    if (!notificationId) {
      return res.status(400).json({ status: 'error', message: 'ไม่พบรายการแจ้งเตือนที่ต้องการส่งใหม่' });
    }
    const { data: queued, error: queueError } = await supabase
      .from('line_notification_outbox')
      .select('id,message_kind,recipient_uid')
      .eq('id', notificationId)
      .single();
    if (queueError || !queued || !String(queued.message_kind || '').startsWith('coupon_')) {
      return res.status(404).json({ status: 'error', message: 'ไม่พบข้อความคูปองนี้' });
    }
    const notification = await retryLineNotification(notificationId);
    await auditEvent(supabase, {
      type: 'coupon_notification_retry',
      actorUid: adminUid,
      targetUid: notification.recipient_uid,
      entityType: 'line_notification_outbox',
      entityId: notification.id,
      status: notification.status === 'sent' ? 'success' : 'error',
      detail: { messageKind: notification.message_kind, error: notification.last_error || null }
    });
    return res.status(200).json({ status: 'success', data: publicNotification(notification) });
  }

  if (req.method === 'POST') {
    return res.status(400).json({ status: 'error', message: 'Invalid action' });
  }

  if (req.method === 'DELETE') {
    const codes = Array.isArray(body.codes) ? body.codes : [body.code || req.query.code];
    const cleanCodes = codes.map(code => String(code || '').trim()).filter(Boolean).slice(0, 100);
    if (cleanCodes.length === 0) {
      return res.status(400).json({ status: 'error', message: 'code required' });
    }

    const { data, error } = await supabase
      .from('coupons')
      .delete()
      .in('code', cleanCodes)
      .eq('status', 'unused')
      .is('assigned_uid', null)
      .select('code');

    if (error) return res.status(500).json({ status: 'error', message: error.message });
    return res.status(200).json({ status: 'success', deleted: data?.length || 0, data });
  }

  const { data, error } = await supabase
    .from('coupons')
    .select('code, point, status, claimer, used_at, created_at, coupon_type, assigned_uid, assigned_at, assigned_by, assignment_reason, assignment_request_id, assignment_state, cancelled_at, cancelled_by, cancel_reason')
    .order('created_at', { ascending: false })  // ใหม่ก่อน
    .order('code', { ascending: true });

  if (error) {
    return res.status(500).json({ status: 'error', message: error.message });
  }

  const assignedUids = [...new Set((data || []).map(row => row.assigned_uid).filter(Boolean))];
  const [usersResult, notificationsResult] = await Promise.all([
    assignedUids.length
      ? supabase.from('users').select('uid,name').in('uid', assignedUids)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from('line_notification_outbox')
      .select('id,dedupe_key,status,attempt_count,last_error,sent_at')
      .in('message_kind', ['coupon_issued', 'coupon_redeemed', 'coupon_cancelled'])
  ]);
  if (usersResult.error) throw usersResult.error;
  if (notificationsResult.error) throw notificationsResult.error;
  const names = new Map((usersResult.data || []).map(row => [row.uid, row.name || '']));
  const notifications = new Map((notificationsResult.data || []).map(row => [row.dedupe_key, row]));

  const items = (data || []).map(r => ({
    code: r.code,
    points: r.point,
    status: r.status,
    used: r.status === 'used',
    claimer: r.claimer,
    used_at: r.used_at,
    created_at: r.created_at,
    coupon_type: r.coupon_type || 'general',
    assigned_uid: r.assigned_uid,
    assigned_name: names.get(r.assigned_uid) || '',
    assigned_at: r.assigned_at,
    assigned_by: r.assigned_by,
    assignment_reason: r.assignment_reason,
    assignment_request_id: r.assignment_request_id,
    assignment_state: r.assignment_state || 'active',
    cancelled_at: r.cancelled_at,
    cancelled_by: r.cancelled_by,
    cancel_reason: r.cancel_reason,
    issue_notification: publicNotification(notifications.get(`coupon-issued:${r.code}`)),
    redeem_notification: publicNotification(notifications.get(`coupon-used:${r.code}`)),
    cancel_notification: publicNotification(notifications.get(`coupon-cancelled:${r.code}`))
  }));

  return res.status(200).json({ status: 'success', data: items });
  } catch (error) {
    if (error instanceof AuthError) return sendAuthError(res, error);
    console.error('[admin-coupons] error:', error);
    if (/coupon_type|assigned_uid|assignment_token_hash|schema cache|column .* does not exist/i.test(String(error?.message || error))) {
      return res.status(503).json({ status: 'error', message: 'ระบบมอบคูปองยังติดตั้งฐานข้อมูลไม่ครบ กรุณาติดต่อผู้ดูแลระบบ' });
    }
    return res.status(500).json({ status: 'error', message: 'internal_error' });
  }
};
