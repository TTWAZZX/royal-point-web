const { supabaseAdmin } = require('./supabase')

const LINE_PUSH_URL = 'https://api.line.me/v2/bot/message/push'
const TIME_ZONE = 'Asia/Bangkok'

function cleanText(value, max = 300) {
  return String(value || '').trim().slice(0, max)
}

function formatBangkok(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return new Intl.DateTimeFormat('th-TH', {
    timeZone: TIME_ZONE,
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date)
}

function requestOrigin(req) {
  const forwardedProto = cleanText(req?.headers?.['x-forwarded-proto'], 20).split(',')[0]
  const protocol = forwardedProto || 'https'
  const host = cleanText(req?.headers?.['x-forwarded-host'] || req?.headers?.host, 200).split(',')[0]
  return host ? `${protocol}://${host}` : ''
}

function appendUrl(base, path, params = {}) {
  const fallback = base || 'https://example.invalid'
  const url = new URL(fallback)
  if (path) {
    const root = url.pathname.replace(/\/$/, '')
    url.pathname = `${root}/${String(path).replace(/^\//, '')}`
  }
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value))
  }
  return url.toString()
}

function userRecoveryUrl(req, ticket) {
  const configured = cleanText(process.env.LINE_LIFF_URL || process.env.APP_BASE_URL, 500)
  return appendUrl(configured || requestOrigin(req), '', { recovery_ticket: ticket })
}

function adminCaseUrl(req, caseId) {
  const configured = cleanText(process.env.LINE_ADMIN_URL, 500)
  const base = configured || appendUrl(cleanText(process.env.APP_BASE_URL, 500) || requestOrigin(req), 'admin.html')
  return appendUrl(base, '', { helpCase: caseId })
}

function flexMessage(altText, contents) {
  return { type: 'flex', altText: cleanText(altText, 400), contents }
}

function infoRow(label, value, color = '#334155') {
  return {
    type: 'box',
    layout: 'horizontal',
    margin: 'md',
    contents: [
      { type: 'text', text: cleanText(label, 40), size: 'sm', color: '#64748B', flex: 3 },
      { type: 'text', text: cleanText(value, 120) || '-', size: 'sm', color, weight: 'bold', align: 'end', wrap: true, flex: 5 }
    ]
  }
}

function actionButton(label, uri, style = 'primary', color = '#2563EB') {
  return {
    type: 'button',
    style,
    color: style === 'primary' ? color : undefined,
    height: 'sm',
    action: { type: 'uri', label: cleanText(label, 20), uri: cleanText(uri, 1000) }
  }
}

function buildAdminHelpMessage({ helpCase, user, url }) {
  const name = cleanText(user?.name || 'ไม่ระบุชื่อ', 80)
  const maskedUid = maskUid(helpCase.target_uid)
  return flexMessage(`มีคำขอช่วยเหลือใหม่ ${helpCase.case_no}`, {
    type: 'bubble',
    size: 'mega',
    header: {
      type: 'box', layout: 'vertical', backgroundColor: '#FFF7ED', paddingAll: '20px',
      contents: [
        { type: 'text', text: 'คำขอช่วยเหลือใหม่', color: '#C2410C', weight: 'bold', size: 'xl' },
        { type: 'text', text: 'ผู้ใช้ยืนยันตัวตนผ่าน LINE ไม่สำเร็จ', color: '#9A3412', size: 'sm', margin: 'sm', wrap: true }
      ]
    },
    body: {
      type: 'box', layout: 'vertical', paddingAll: '20px',
      contents: [
        infoRow('หมายเลขเรื่อง', helpCase.case_no, '#C2410C'),
        infoRow('ผู้ใช้', name),
        infoRow('UID', maskedUid),
        infoRow('สาเหตุ', thaiErrorLabel(helpCase.error_code)),
        infoRow('เวลาที่แจ้ง', formatBangkok(helpCase.last_requested_at)),
        infoRow('จำนวนครั้ง', `${Number(helpCase.request_count || 1)} ครั้ง`)
      ]
    },
    footer: {
      type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '16px',
      contents: [actionButton('เปิดหน้าจัดการ', url, 'primary', '#C2410C')]
    }
  })
}

function buildRecoveryApprovedMessage({ helpCase, user, url }) {
  const name = cleanText(user?.name || 'ผู้ใช้', 80)
  return flexMessage(`เปิดโหมดช่วยเหลือแล้ว ${helpCase.case_no}`, {
    type: 'bubble',
    size: 'mega',
    header: {
      type: 'box', layout: 'vertical', backgroundColor: '#ECFDF5', paddingAll: '20px',
      contents: [
        { type: 'text', text: 'พร้อมกลับเข้าสู่ระบบแล้ว', color: '#047857', weight: 'bold', size: 'xl' },
        { type: 'text', text: `คุณ${name} ผู้ดูแลเปิดโหมดช่วยเหลือให้แล้ว`, color: '#065F46', size: 'sm', margin: 'sm', wrap: true }
      ]
    },
    body: {
      type: 'box', layout: 'vertical', paddingAll: '20px',
      contents: [
        infoRow('หมายเลขเรื่อง', helpCase.case_no, '#047857'),
        infoRow('ใช้สิทธิ์ได้ถึง', formatBangkok(helpCase.recovery_until)),
        { type: 'separator', margin: 'lg' },
        { type: 'text', text: 'คะแนน ประวัติ คูปอง และข้อมูลเดิมของคุณยังอยู่ครบ', color: '#475569', size: 'sm', wrap: true, margin: 'lg' },
        { type: 'text', text: 'ลิงก์นี้ใช้ได้ครั้งเดียว กรุณากดจากบัญชี LINE ของคุณ', color: '#B45309', size: 'xs', wrap: true, margin: 'md' }
      ]
    },
    footer: {
      type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '16px',
      contents: [actionButton('กลับเข้าสู่ระบบ', url, 'primary', '#059669')]
    }
  })
}

function buildRecoverySuccessMessage({ helpCase, user, admin = false, url }) {
  const name = cleanText(user?.name || 'ผู้ใช้', 80)
  const title = admin ? 'ผู้ใช้กลับเข้าสู่ระบบแล้ว' : 'กลับเข้าสู่ระบบสำเร็จ'
  const detail = admin
    ? `${name} ใช้ลิงก์ช่วยเหลือและโหลดข้อมูลบัญชีเดิมสำเร็จ`
    : 'ระบบเชื่อมต่อบัญชีเดิมและโหลดข้อมูลของคุณเรียบร้อยแล้ว'
  return flexMessage(`${title} ${helpCase.case_no}`, {
    type: 'bubble',
    header: {
      type: 'box', layout: 'vertical', backgroundColor: '#EFF6FF', paddingAll: '20px',
      contents: [{ type: 'text', text: title, color: '#1D4ED8', weight: 'bold', size: 'xl', wrap: true }]
    },
    body: {
      type: 'box', layout: 'vertical', paddingAll: '20px',
      contents: [
        { type: 'text', text: detail, color: '#334155', size: 'sm', wrap: true },
        infoRow('หมายเลขเรื่อง', helpCase.case_no, '#1D4ED8'),
        infoRow('สถานะ', 'แก้ไขแล้ว', '#047857')
      ]
    },
    footer: {
      type: 'box', layout: 'vertical', paddingAll: '16px',
      contents: [actionButton(admin ? 'เปิดเรื่องช่วยเหลือ' : 'เปิดหน้าหลัก', url, 'primary', '#2563EB')]
    }
  })
}

function thaiErrorLabel(code) {
  const labels = {
    AUTH_PROVIDER_UNAVAILABLE: 'เชื่อมต่อ LINE ไม่ได้ชั่วคราว',
    AUTH_TOKEN_INVALID: 'ข้อมูลยืนยัน LINE หมดอายุ',
    AUTH_TOKEN_REQUIRED: 'ไม่พบข้อมูลยืนยัน LINE',
    AUTH_UPGRADE_REQUIRED: 'หน้าเดิมยังไม่ส่งข้อมูลยืนยัน',
    AUTH_MIGRATION_NOT_READY: 'ระบบย้ายบัญชียังไม่พร้อม'
  }
  return labels[String(code || '')] || 'ยืนยันตัวตนไม่สำเร็จ'
}

function maskUid(uid) {
  const value = cleanText(uid, 100)
  if (value.length <= 12) return value
  return `${value.slice(0, 6)}…${value.slice(-4)}`
}

async function findOrCreateOutbox({ dedupeKey, caseId, recipientUid, messageKind, payload }) {
  const { data: existing } = await supabaseAdmin
    .from('line_notification_outbox')
    .select('*')
    .eq('dedupe_key', dedupeKey)
    .maybeSingle()
  if (existing) return existing

  const { data, error } = await supabaseAdmin
    .from('line_notification_outbox')
    .insert({
      dedupe_key: dedupeKey,
      case_id: caseId || null,
      recipient_uid: recipientUid,
      message_kind: messageKind,
      payload
    })
    .select('*')
    .single()
  if (!error) return data

  if (String(error.code || '') === '23505') {
    const { data: raced, error: racedError } = await supabaseAdmin
      .from('line_notification_outbox')
      .select('*')
      .eq('dedupe_key', dedupeKey)
      .single()
    if (!racedError) return raced
  }
  throw error
}

async function deliverOutbox(row) {
  if (!row || row.status === 'sent') return row
  const accessToken = cleanText(process.env.LINE_CHANNEL_ACCESS_TOKEN, 4096)
  if (!accessToken) return updateFailure(row, 'ยังไม่ได้ตั้งค่า LINE_CHANNEL_ACCESS_TOKEN')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    const response = await fetch(LINE_PUSH_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-Line-Retry-Key': String(row.retry_key)
      },
      body: JSON.stringify({ to: row.recipient_uid, messages: [row.payload] })
    })
    const requestId = response.headers.get('x-line-request-id') || response.headers.get('x-line-accepted-request-id') || null
    if (response.ok || response.status === 409) {
      const { data, error } = await supabaseAdmin
        .from('line_notification_outbox')
        .update({
          status: 'sent',
          attempt_count: Number(row.attempt_count || 0) + 1,
          line_request_id: requestId,
          last_error: null,
          sent_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', row.id)
        .select('*')
        .single()
      if (error) throw error
      return data
    }
    const result = await response.json().catch(() => ({}))
    return updateFailure(row, cleanText(result.message || `LINE HTTP ${response.status}`, 500), requestId)
  } catch (error) {
    return updateFailure(row, error?.name === 'AbortError' ? 'LINE ตอบกลับช้าเกินกำหนด' : cleanText(error?.message, 500))
  } finally {
    clearTimeout(timer)
  }
}

async function updateFailure(row, message, requestId = null) {
  const { data, error } = await supabaseAdmin
    .from('line_notification_outbox')
    .update({
      status: 'failed',
      attempt_count: Number(row.attempt_count || 0) + 1,
      line_request_id: requestId,
      last_error: cleanText(message, 500) || 'ส่ง LINE ไม่สำเร็จ',
      updated_at: new Date().toISOString()
    })
    .eq('id', row.id)
    .select('*')
    .single()
  if (error) throw error
  return data
}

async function queueLineNotification(input) {
  const row = await findOrCreateOutbox(input)
  return deliverOutbox(row)
}

async function retryLineNotification(id) {
  const { data, error } = await supabaseAdmin
    .from('line_notification_outbox')
    .select('*')
    .eq('id', id)
    .single()
  if (error) throw error
  return deliverOutbox(data)
}

module.exports = {
  adminCaseUrl,
  buildAdminHelpMessage,
  buildRecoveryApprovedMessage,
  buildRecoverySuccessMessage,
  formatBangkok,
  queueLineNotification,
  retryLineNotification,
  thaiErrorLabel,
  userRecoveryUrl
}
