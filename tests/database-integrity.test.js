const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { createClient } = require('@supabase/supabase-js')

const testUrl = String(process.env.SUPABASE_TEST_URL || '').trim()
const testKey = String(process.env.SUPABASE_TEST_SERVICE_ROLE_KEY || '').trim()
const testUid = String(process.env.DATABASE_TEST_USER_UID || '').trim()
const confirmation = String(process.env.ROYAL_POINT_TEST_CONFIRM || '')
const productionUrl = String(process.env.SUPABASE_URL || '').trim()

if (!testUrl || !testKey || !testUid || confirmation !== 'DISPOSABLE_TEST_DATABASE') {
  console.log('SKIP database integration: ต้องกำหนด SUPABASE_TEST_URL, SUPABASE_TEST_SERVICE_ROLE_KEY, DATABASE_TEST_USER_UID และ ROYAL_POINT_TEST_CONFIRM=DISPOSABLE_TEST_DATABASE')
  process.exit(0)
}
if (productionUrl && new URL(testUrl).host === new URL(productionUrl).host) {
  throw new Error('ปฏิเสธการรัน integration test: SUPABASE_TEST_URL ตรงกับ SUPABASE_URL ของ production')
}

const db = createClient(testUrl, testKey, { auth: { persistSession: false, autoRefreshToken: false } })

;(async () => {
  const { data: user, error: userError } = await db.from('users').select('id,uid,user_points(balance)').eq('uid', testUid).single()
  if (userError) throw userError
  const initialBalance = Number((Array.isArray(user.user_points) ? user.user_points[0] : user.user_points)?.balance || 0)

  const couponCode = `TEST${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`
  const { error: couponError } = await db.from('coupons').insert({ code: couponCode, point: 7, status: 'unused', claimer: null, used_at: null })
  if (couponError) throw couponError

  const redeemParams = { p_uid: testUid, p_code: couponCode, p_ticket_hash: null }
  const firstRedeem = await db.rpc('redeem_coupon_atomic', redeemParams)
  if (firstRedeem.error) throw firstRedeem.error
  const secondRedeem = await db.rpc('redeem_coupon_atomic', redeemParams)
  if (secondRedeem.error) throw secondRedeem.error
  assert.equal(Boolean(firstRedeem.data?.[0]?.was_duplicate), false)
  assert.equal(Boolean(secondRedeem.data?.[0]?.was_duplicate), true)
  assert.equal(Number(firstRedeem.data?.[0]?.balance), initialBalance + 7)
  assert.equal(Number(secondRedeem.data?.[0]?.balance), initialBalance + 7)

  const adjustmentRequestId = crypto.randomUUID()
  const adjustmentParams = {
    p_target_uid: testUid, p_mode: 'add', p_amount: 3, p_reason: 'database integration test',
    p_admin_uid: 'INTEGRATION_TEST', p_request_id: adjustmentRequestId
  }
  const firstAdjustment = await db.rpc('admin_adjust_points_v2', adjustmentParams)
  if (firstAdjustment.error) throw firstAdjustment.error
  const secondAdjustment = await db.rpc('admin_adjust_points_v2', adjustmentParams)
  if (secondAdjustment.error) throw secondAdjustment.error
  assert.equal(firstAdjustment.data?.[0]?.adjustment_id, secondAdjustment.data?.[0]?.adjustment_id)
  assert.equal(Boolean(firstAdjustment.data?.[0]?.was_duplicate), false)
  assert.equal(Boolean(secondAdjustment.data?.[0]?.was_duplicate), true)
  assert.equal(Number(firstAdjustment.data?.[0]?.balance_after), initialBalance + 10)
  assert.equal(Number(secondAdjustment.data?.[0]?.balance_after), initialBalance + 10)

  const requestId = crypto.randomUUID()
  const giveawayParams = { p_amount: 1, p_reason: 'database integration test', p_admin_uid: 'INTEGRATION_TEST', p_request_id: requestId }
  const firstGiveaway = await db.rpc('admin_giveaway_to_all_v2', giveawayParams)
  if (firstGiveaway.error) throw firstGiveaway.error
  const secondGiveaway = await db.rpc('admin_giveaway_to_all_v2', giveawayParams)
  if (secondGiveaway.error) throw secondGiveaway.error
  assert.equal(firstGiveaway.data?.[0]?.giveaway_id, secondGiveaway.data?.[0]?.giveaway_id)
  assert.equal(Boolean(firstGiveaway.data?.[0]?.was_duplicate), false)
  assert.equal(Boolean(secondGiveaway.data?.[0]?.was_duplicate), true)
  console.log('✓ database integration: redeem atomic, admin adjustment และ giveaway idempotency ผ่านบนฐานทดสอบ')
})().catch(error => {
  console.error(error)
  process.exitCode = 1
})
