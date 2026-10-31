const assert = require('node:assert/strict')
const test = require('node:test')

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key'

const {
  adminCaseUrl,
  adminRedemptionUrl,
  buildAdminHelpMessage,
  buildAdminRedemptionRequestMessage,
  buildCouponCancelledMessage,
  buildCouponIssuedMessage,
  buildCouponRedeemedMessage,
  buildPointAdjustmentMessage,
  buildRedemptionCancelledMessage,
  buildRedemptionCreatedMessage,
  buildRedemptionReceivedMessage,
  buildRecoveryApprovedMessage,
  buildRecoverySuccessMessage,
  userCouponUrl,
  userRedemptionUrl,
  userRecoveryUrl
} = require('../lib/line-messaging')

const req = { headers: { host: 'royal.example', 'x-forwarded-proto': 'https' } }
const helpCase = {
  id: 7,
  case_no: 'HELP-000007',
  target_uid: 'U12345678901234567890',
  error_code: 'AUTH_TOKEN_INVALID',
  request_count: 1,
  last_requested_at: new Date().toISOString(),
  recovery_until: new Date(Date.now() + 30 * 60 * 1000).toISOString()
}

function assertFlex(message) {
  assert.equal(message.type, 'flex')
  assert.ok(message.altText.length > 0 && message.altText.length <= 400)
  assert.equal(message.contents.type, 'bubble')
  assert.doesNotThrow(() => JSON.stringify(message))
  assert.equal(JSON.stringify(message).includes('tel:'), false, 'เบอร์ภายในบริษัทต้องไม่เป็นลิงก์โทรศัพท์')

  const visit = value => {
    if (!value || typeof value !== 'object') return
    if (value.type === 'button') {
      const label = String(value.action?.label || '')
      const graphemes = [...new Intl.Segmenter('th', { granularity: 'grapheme' }).segment(label)]
      assert.ok(graphemes.length <= 20, `ป้ายปุ่ม LINE ยาวเกิน 20 ตัวอักษร: ${label}`)
    }
    if (value.type === 'text' && value.size === 'xl') {
      assert.equal(value.wrap, true, `หัวข้อ Flex ต้องตัดบรรทัดได้: ${value.text}`)
    }
    for (const child of Object.values(value)) {
      if (Array.isArray(child)) child.forEach(visit)
      else if (child && typeof child === 'object') visit(child)
    }
  }
  visit(message.contents)
}

test('builds LINE Flex Messages for every authentication help stage', () => {
  assertFlex(buildAdminHelpMessage({ helpCase, user:{ name:'ผู้ใช้ทดสอบ' }, url:'https://royal.example/admin.html?helpCase=7' }))
  assertFlex(buildRecoveryApprovedMessage({ helpCase, user:{ name:'ผู้ใช้ทดสอบ' }, url:'https://liff.line.me/test?recovery_ticket=secret' }))
  assertFlex(buildRecoverySuccessMessage({ helpCase, user:{ name:'ผู้ใช้ทดสอบ' }, url:'https://liff.line.me/test' }))
  assertFlex(buildRecoverySuccessMessage({ helpCase, user:{ name:'ผู้ใช้ทดสอบ' }, admin:true, url:'https://royal.example/admin.html?helpCase=7' }))
})

test('creates direct user and admin links without exposing a UID', () => {
  const recoveryUrl = userRecoveryUrl(req, 'one-time-secret')
  const adminUrl = adminCaseUrl(req, 7)
  const adminRedemption = adminRedemptionUrl(req, 'adb9d292-f1da-4a73-9802-66a13b0ccfca')
  assert.equal(new URL(recoveryUrl).searchParams.get('recovery_ticket'), 'one-time-secret')
  assert.equal(new URL(adminUrl).searchParams.get('helpCase'), '7')
  assert.equal(new URL(adminRedemption).searchParams.get('redemption_id'), 'adb9d292-f1da-4a73-9802-66a13b0ccfca')
  assert.equal(recoveryUrl.includes(helpCase.target_uid), false)
})

test('builds secure personal coupon messages and links', () => {
  const coupon = {
    code: 'PTEST123',
    point: 250,
    assigned_uid: helpCase.target_uid,
    assigned_at: new Date().toISOString(),
    used_at: new Date().toISOString(),
    assignment_reason: 'รางวัลกิจกรรมทดสอบ'
  }
  const couponUrl = userCouponUrl(req, 'coupon-one-time-ticket')
  assert.equal(new URL(couponUrl).searchParams.get('coupon_ticket'), 'coupon-one-time-ticket')
  assert.equal(couponUrl.includes(helpCase.target_uid), false)
  assert.equal(couponUrl.includes(coupon.code), false)
  assertFlex(buildCouponIssuedMessage({ coupon, user:{ name:'ผู้ใช้ทดสอบ' }, url:couponUrl }))
  assertFlex(buildCouponRedeemedMessage({ coupon, balance:1250, url:'https://liff.line.me/test' }))
  assertFlex(buildCouponCancelledMessage({ coupon, reason:'ทดสอบการยกเลิก', url:'https://liff.line.me/test' }))
})

test('builds point and reward transaction Flex Messages', () => {
  const redemption = { id:'adb9d292-f1da-4a73-9802-66a13b0ccfca', cost:40, balance_after:960, refund_balance:1000, created_at:new Date().toISOString(), received_at:new Date().toISOString() }
  const reward = { name:'ของรางวัลทดสอบ', img_url:'https://example.com/reward.png' }
  const redemptionUrl = userRedemptionUrl(req, redemption.id)
  assert.equal(new URL(redemptionUrl).searchParams.get('redemption_id'), redemption.id)
  assertFlex(buildPointAdjustmentMessage({
    adjustment:{ adjustment_id:'2154e6c2-8cc4-4354-a156-3c3c7248ad55', applied_delta:50, balance_before:950, balance_after:1000, reason:'รางวัลกิจกรรม', mode:'add' },
    user:{ name:'ผู้ใช้ทดสอบ' }, url:'https://liff.line.me/test?view=score-history'
  }))
  const created = buildRedemptionCreatedMessage({ redemption, reward, balance:960, url:redemptionUrl })
  assertFlex(created)
  assert.match(JSON.stringify(created), /โทรศัพท์ภายในบริษัทที่ 1199 หรือ 1919/)
  assertFlex(buildAdminRedemptionRequestMessage({
    redemption, reward, user:{ name:'ผู้ใช้ทดสอบ', room:'SHE' },
    url:adminRedemptionUrl(req, redemption.id)
  }))
  assertFlex(buildRedemptionReceivedMessage({ redemption, reward, url:redemptionUrl }))
  assertFlex(buildRedemptionCancelledMessage({ redemption, reward, reason:'ของจริงไม่พร้อมจ่าย', balance:1000, url:'https://liff.line.me/test?view=score-history' }))
})
