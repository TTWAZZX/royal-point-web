const crypto = require('crypto')
const { supabaseAdmin } = require('../lib/supabase')
const { auditEvent } = require('../lib/audit')
const {
  adminCaseUrl,
  buildAdminHelpMessage,
  buildRecoverySuccessMessage,
  queueLineNotification
} = require('../lib/line-messaging')

const ALLOWED_ERROR_CODES = new Set([
  'AUTH_PROVIDER_UNAVAILABLE',
  'AUTH_TOKEN_INVALID',
  'AUTH_TOKEN_REQUIRED',
  'AUTH_UPGRADE_REQUIRED',
  'AUTH_MIGRATION_NOT_READY'
])

function clean(value, max = 300) {
  return String(value || '').trim().slice(0, max)
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex')
}

function caseNumber() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  return `HELP-${date}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`
}

async function getUser(uid) {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('uid,name')
    .eq('uid', uid)
    .maybeSingle()
  if (error) throw error
  return data || null
}

async function getActiveCase(uid) {
  const now = new Date().toISOString()
  await supabaseAdmin
    .from('auth_help_cases')
    .update({ status: 'expired', updated_at: now })
    .eq('target_uid', uid)
    .eq('status', 'approved')
    .lt('recovery_until', now)

  const { data, error } = await supabaseAdmin
    .from('auth_help_cases')
    .select('*')
    .eq('target_uid', uid)
    .in('status', ['open', 'approved'])
    .order('last_requested_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data || null
}

async function createOrRefreshCase({ uid, errorCode, detail }) {
  const now = new Date().toISOString()
  const existing = await getActiveCase(uid)
  if (existing) {
    const { data, error } = await supabaseAdmin
      .from('auth_help_cases')
      .update({
        error_code: errorCode,
        error_detail: detail || null,
        request_count: Number(existing.request_count || 1) + 1,
        last_requested_at: now,
        updated_at: now
      })
      .eq('id', existing.id)
      .select('*')
      .single()
    if (error) throw error
    return { helpCase: data, created: false }
  }

  const { data, error } = await supabaseAdmin
    .from('auth_help_cases')
    .insert({
      case_no: caseNumber(),
      target_uid: uid,
      error_code: errorCode,
      error_detail: detail || null
    })
    .select('*')
    .single()
  if (!error) return { helpCase: data, created: true }

  if (String(error.code || '') === '23505') {
    const raced = await getActiveCase(uid)
    if (raced) return { helpCase: raced, created: false }
  }
  throw error
}

async function requestHelp(req, res) {
  const uid = clean(req.body?.uid, 100)
  const errorCode = clean(req.body?.errorCode, 80)
  const detail = clean(req.body?.detail, 300)
  if (!uid) return res.status(400).json({ status: 'error', message: 'ไม่พบ UID สำหรับส่งคำขอ' })
  if (!ALLOWED_ERROR_CODES.has(errorCode)) {
    return res.status(400).json({ status: 'error', message: 'สาเหตุคำขอไม่ถูกต้อง' })
  }

  const [user, migrationResult] = await Promise.all([
    getUser(uid),
    supabaseAdmin.from('user_auth_migrations').select('token_required').eq('uid', uid).maybeSingle()
  ])
  if (!user) return res.status(404).json({ status: 'error', message: 'ไม่พบบัญชีผู้ใช้นี้' })
  if (migrationResult.error) throw migrationResult.error
  if (!migrationResult.data?.token_required) {
    return res.status(409).json({ status: 'error', message: 'บัญชีนี้ยังไม่ต้องใช้โหมดช่วยเหลือ' })
  }

  const { helpCase, created } = await createOrRefreshCase({ uid, errorCode, detail })
  let notification = null
  const adminUid = clean(process.env.ADMIN_UID, 100)
  if (adminUid) {
    try {
      notification = await queueLineNotification({
        dedupeKey: `auth-help:${helpCase.id}:admin-request`,
        caseId: helpCase.id,
        recipientUid: adminUid,
        messageKind: 'auth_help_admin_request',
        payload: buildAdminHelpMessage({
          helpCase,
          user,
          url: adminCaseUrl(req, helpCase.id)
        })
      })
    } catch (error) {
      console.error('[auth-help] admin LINE notification failed:', error?.message || error)
    }
  }

  await auditEvent(supabaseAdmin, {
    type: created ? 'auth_help_requested' : 'auth_help_requested_again',
    actorUid: uid,
    targetUid: uid,
    entityType: 'auth_help_case',
    entityId: helpCase.id,
    status: 'success',
    detail: { caseNo: helpCase.case_no, errorCode, notificationStatus: notification?.status || 'not_sent' }
  })

  return res.status(200).json({
    status: 'success',
    data: {
      id: helpCase.id,
      caseNo: helpCase.case_no,
      caseStatus: helpCase.status,
      created,
      lineNotification: notification?.status || (adminUid ? 'failed' : 'not_configured')
    }
  })
}

async function consumeTicket(req, res) {
  const ticket = clean(req.body?.ticket, 300)
  if (ticket.length < 32) return res.status(400).json({ status: 'error', message: 'ลิงก์ช่วยเหลือไม่ถูกต้อง' })

  const { data: ticketRow, error } = await supabaseAdmin
    .from('auth_recovery_tickets')
    .select('*')
    .eq('token_hash', tokenHash(ticket))
    .maybeSingle()
  if (error) throw error
  if (!ticketRow) return res.status(404).json({ status: 'error', message: 'ไม่พบลิงก์ช่วยเหลือนี้' })
  if (ticketRow.consumed_at) return res.status(409).json({ status: 'error', message: 'ลิงก์ช่วยเหลือนี้ถูกใช้แล้ว' })
  if (new Date(ticketRow.expires_at).getTime() <= Date.now()) {
    return res.status(410).json({ status: 'error', message: 'ลิงก์ช่วยเหลือนี้หมดอายุแล้ว กรุณาส่งคำขอใหม่' })
  }

  const { data: helpCase, error: caseError } = await supabaseAdmin
    .from('auth_help_cases')
    .select('*')
    .eq('id', ticketRow.case_id)
    .single()
  if (caseError) throw caseError
  if (helpCase.status !== 'approved' || new Date(helpCase.recovery_until).getTime() <= Date.now()) {
    return res.status(409).json({ status: 'error', message: 'สิทธิ์ช่วยเหลือไม่ได้เปิดใช้งานแล้ว' })
  }

  const now = new Date().toISOString()
  const { data: consumed, error: consumeError } = await supabaseAdmin
    .from('auth_recovery_tickets')
    .update({ consumed_at: now })
    .eq('id', ticketRow.id)
    .is('consumed_at', null)
    .select('id')
    .maybeSingle()
  if (consumeError) throw consumeError
  if (!consumed) return res.status(409).json({ status: 'error', message: 'ลิงก์ช่วยเหลือนี้ถูกใช้แล้ว' })

  await auditEvent(supabaseAdmin, {
    type: 'auth_recovery_link_consumed',
    actorUid: ticketRow.target_uid,
    targetUid: ticketRow.target_uid,
    entityType: 'auth_help_case',
    entityId: helpCase.id,
    status: 'success',
    detail: { caseNo: helpCase.case_no }
  })

  return res.status(200).json({
    status: 'success',
    data: {
      uid: ticketRow.target_uid,
      caseId: helpCase.id,
      caseNo: helpCase.case_no,
      recoveryUntil: helpCase.recovery_until
    }
  })
}

async function completeHelp(req, res) {
  const ticket = clean(req.body?.ticket, 300)
  if (ticket.length < 32) return res.status(400).json({ status: 'error', message: 'ลิงก์ช่วยเหลือไม่ถูกต้อง' })

  const { data: ticketRow, error } = await supabaseAdmin
    .from('auth_recovery_tickets')
    .select('*')
    .eq('token_hash', tokenHash(ticket))
    .maybeSingle()
  if (error) throw error
  if (!ticketRow?.consumed_at) return res.status(403).json({ status: 'error', message: 'ยังไม่ได้เปิดลิงก์ช่วยเหลือ' })

  const { data: existing, error: caseError } = await supabaseAdmin
    .from('auth_help_cases')
    .select('*')
    .eq('id', ticketRow.case_id)
    .single()
  if (caseError) throw caseError

  let helpCase = existing
  if (existing.status !== 'resolved') {
    const now = new Date().toISOString()
    const { data, error: updateError } = await supabaseAdmin
      .from('auth_help_cases')
      .update({ status: 'resolved', resolved_at: now, updated_at: now })
      .eq('id', existing.id)
      .in('status', ['approved', 'resolved'])
      .select('*')
      .single()
    if (updateError) throw updateError
    helpCase = data
  }

  const user = await getUser(ticketRow.target_uid)
  const notifications = []
  const userUrl = clean(process.env.LINE_LIFF_URL || process.env.APP_BASE_URL, 500) || requestOriginSafe(req)
  const adminUrl = adminCaseUrl(req, helpCase.id)
  const targets = [
    {
      key: `auth-help:${helpCase.id}:user-success`,
      uid: ticketRow.target_uid,
      kind: 'auth_help_user_success',
      message: buildRecoverySuccessMessage({ helpCase, user, url: userUrl })
    }
  ]
  const adminUid = clean(process.env.ADMIN_UID, 100)
  if (adminUid) {
    targets.push({
      key: `auth-help:${helpCase.id}:admin-success`,
      uid: adminUid,
      kind: 'auth_help_admin_success',
      message: buildRecoverySuccessMessage({ helpCase, user, admin: true, url: adminUrl })
    })
  }

  for (const target of targets) {
    try {
      notifications.push(await queueLineNotification({
        dedupeKey: target.key,
        caseId: helpCase.id,
        recipientUid: target.uid,
        messageKind: target.kind,
        payload: target.message
      }))
    } catch (notifyError) {
      console.error('[auth-help] completion LINE notification failed:', notifyError?.message || notifyError)
    }
  }

  await auditEvent(supabaseAdmin, {
    type: 'auth_help_resolved',
    actorUid: ticketRow.target_uid,
    targetUid: ticketRow.target_uid,
    entityType: 'auth_help_case',
    entityId: helpCase.id,
    status: 'success',
    detail: { caseNo: helpCase.case_no, resolutionMethod: 'recovery_completed' }
  })

  return res.status(200).json({ status: 'success', data: { caseNo: helpCase.case_no, caseStatus: helpCase.status } })
}

function requestOriginSafe(req) {
  const protocol = clean(req.headers?.['x-forwarded-proto'], 20).split(',')[0] || 'https'
  const host = clean(req.headers?.['x-forwarded-host'] || req.headers?.host, 200).split(',')[0]
  return host ? `${protocol}://${host}/` : '/'
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store')
  if (req.method !== 'POST') return res.status(405).json({ status: 'error', message: 'Method not allowed' })
  try {
    const action = clean(req.body?.action, 40)
    if (action === 'request') return await requestHelp(req, res)
    if (action === 'consume') return await consumeTicket(req, res)
    if (action === 'complete') return await completeHelp(req, res)
    return res.status(400).json({ status: 'error', message: 'คำสั่งไม่ถูกต้อง' })
  } catch (error) {
    console.error('[auth-help] error:', error)
    const migrationMissing = /auth_help_cases|auth_recovery_tickets|line_notification_outbox|schema cache|relation .* does not exist/i.test(String(error?.message || error))
    return res.status(migrationMissing ? 503 : 500).json({
      status: 'error',
      message: migrationMissing ? 'ระบบช่วยเหลือยังติดตั้งไม่ครบ กรุณาติดต่อผู้ดูแล' : 'ระบบช่วยเหลือทำงานไม่สำเร็จ กรุณาลองใหม่'
    })
  }
}
