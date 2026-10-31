const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')

test('Vercel serverless API file count stays within the 12-function budget', () => {
  const apiFiles = fs.readdirSync(path.join(root, 'api')).filter(file => file.endsWith('.js')).sort()
  assert.ok(apiFiles.length <= 12, `พบ API ${apiFiles.length} ไฟล์ เกินเพดาน 12: ${apiFiles.join(', ')}`)
})

test('all primary pages use the shared full-screen startup loading state', () => {
  assert.match(read('loader.js'), /global\.SystemBoot =/)
  assert.match(read('loader.js'), /การเชื่อมต่อใช้เวลานานกว่าปกติ/)
  assert.match(read('index.html'), /SystemBoot\?\.hide/)
  assert.match(read('admin.page.js'), /SystemBoot\?\.hide/)
  assert.match(read('all-rewards.html'), /SystemBoot\?\.hide/)
})

test('all user-facing pages load the shared authentication bridge', () => {
  for (const file of ['index.html', 'admin.html', 'all-rewards.html']) {
    assert.match(read(file), /loader\.js\?v=line-token-v1/, `${file} must load the shared authentication bridge`)
  }
})

test('all private user and admin APIs use the shared authentication guard', () => {
  const privateApis = [
    'api/register.js',
    'api/get-score.js',
    'api/redeem.js',
    'api/spend.js',
    'api/daily-checkin.js',
    'api/score-history.js',
    'api/all-scores.js',
    'api/admin-coupons.js',
    'api/admin-actions.js'
  ]
  for (const file of privateApis) {
    const source = read(file)
    assert.match(source, /line-auth/, `${file} must import the shared authentication guard`)
    assert.match(source, /authenticateRequest\(/, `${file} must authenticate its request`)
  }
})

test('recovery is wired through database, backend, admin UI, user UI, and audit labels', () => {
  assert.match(read('supabase_user_auth_migration.sql'), /recovery_until/)
  assert.match(read('lib/line-auth.js'), /legacy-recovery/)
  assert.match(read('api/admin-actions.js'), /auth_recovery_open/)
  assert.match(read('api/all-scores.js'), /recoveryUntil/)
  assert.match(read('admin.html'), /btnOpenAuthRecovery/)
  assert.match(read('admin.page.js'), /openAuthRecovery/)
  assert.match(read('admin.js'), /auth_recovery_open/)
  assert.match(read('loader.js'), /ส่งคำขอช่วยเหลือ/)
  assert.match(read('index.html'), /recoveryMode/)
  assert.match(read('app.js'), /ctx\.recovery/)
  assert.match(read('all-rewards.html'), /const existing = getUid\(\)/)
  assert.match(read('api/admin-actions.js'), /allowRecovery: false/)
})

test('LINE authentication help center is connected end to end', () => {
  const migration = read('supabase_user_auth_migration.sql')
  assert.match(migration, /auth_help_cases/)
  assert.match(migration, /auth_recovery_tickets/)
  assert.match(migration, /line_notification_outbox/)
  assert.match(read('api/liff-guard.js'), /action === 'request'/)
  assert.match(read('api/liff-guard.js'), /action === 'consume'/)
  assert.match(read('api/liff-guard.js'), /action === 'complete'/)
  assert.match(read('vercel.json'), /"source": "\/api\/auth-help"/)
  assert.match(read('lib/line-messaging.js'), /X-Line-Retry-Key/)
  assert.match(read('lib/line-messaging.js'), /buildAdminHelpMessage/)
  assert.match(read('lib/line-messaging.js'), /buildRecoveryApprovedMessage/)
  assert.match(read('admin.html'), /pills-auth-help/)
  assert.match(read('admin.page.js'), /loadAuthHelpCases/)
  assert.match(read('loader.js'), /recovery_ticket/)
  assert.match(read('loader.js'), /X-Royal-Recovery/)
  assert.match(read('lib/line-auth.js'), /verifyRecoveryProof/)
  assert.match(read('supabase_user_auth_migration.sql'), /recovery_case_id/)
  assert.match(read('index.html'), /RoyalAuth\?\.ready/)
})

test('personal coupons are connected across database, admin, user, audit, and LINE', () => {
  const migration = read('supabase_coupon_assignment_migration.sql')
  assert.match(migration, /assigned_uid/)
  assert.match(migration, /assignment_token_hash/)
  assert.match(migration, /assignment_request_id/)
  assert.match(migration, /coupon_type/)
  assert.match(read('api/admin-coupons.js'), /action === 'assign'/)
  assert.match(read('api/admin-coupons.js'), /coupon_assigned/)
  assert.match(read('api/admin-coupons.js'), /coupon-issued:/)
  assert.match(read('api/admin-coupons.js'), /assignmentTicket/)
  assert.match(read('admin.js'), /COUPON_ASSIGN_REQUEST_ID/)
  assert.match(read('api/redeem.js'), /coupon_not_owner/)
  assert.match(read('api/redeem.js'), /coupon-used:/)
  assert.match(read('lib/line-messaging.js'), /buildCouponIssuedMessage/)
  assert.match(read('lib/line-messaging.js'), /buildCouponRedeemedMessage/)
  assert.match(read('lib/line-messaging.js'), /buildCouponCancelledMessage/)
  assert.match(read('admin.html'), /couponAssignModal/)
  assert.match(read('admin.js'), /assignCouponToUser/)
  assert.match(read('app.js'), /handleCouponDeepLink/)
  assert.match(read('app.js'), /couponTicket/)
})

test('transaction notifications and reward pickup are connected end to end', () => {
  const migration = read('supabase_transaction_notifications_migration.sql')
  assert.match(migration, /admin_adjust_points_v2/)
  assert.match(migration, /spend_reward_atomic/)
  assert.match(migration, /mark_redemption_received/)
  assert.match(migration, /cancel_redemption_with_refund/)
  assert.match(migration, /request_id uuid/)
  assert.match(migration, /status = 'legacy'/)
  assert.match(read('api/spend.js'), /redemption-created:/)
  assert.match(read('api/spend.js'), /redemption-admin:/)
  assert.match(read('api/spend.js'), /redemption_admin_new/)
  assert.match(read('api/spend.js'), /spend_reward_atomic/)
  assert.match(read('api/admin-actions.js'), /score-adjusted:/)
  assert.match(read('api/admin-actions.js'), /redemption-received:/)
  assert.match(read('api/admin-actions.js'), /redemption-cancelled:/)
  assert.match(read('lib/line-messaging.js'), /buildPointAdjustmentMessage/)
  assert.match(read('lib/line-messaging.js'), /buildRedemptionCreatedMessage/)
  assert.match(read('lib/line-messaging.js'), /buildAdminRedemptionRequestMessage/)
  assert.match(read('lib/line-messaging.js'), /adminRedemptionUrl/)
  assert.match(read('admin.html'), /pills-line-notifications/)
  assert.match(read('admin.js'), /confirmRedemptionReceived/)
  assert.match(read('admin.js'), /openRedemptionDeepLink/)
  assert.match(read('admin.js'), /RP_ADMIN_ACTIVE_TAB/)
  assert.match(read('admin.js'), /setupPersistentAdminTab/)
  assert.match(read('admin.js'), /restorePersistentAdminTab/)
  assert.match(read('admin.js'), /hasAdminDeepLink/)
  assert.match(read('admin.js'), /cancelRedemptionAndRefund/)
  assert.match(read('app.js'), /handleTransactionDeepLinks/)
  assert.match(read('all-rewards.html'), /RP_REDEEM_REQUEST/)
})

test('admin restores the saved tab only after administrator authentication finishes', () => {
  const source = read('admin.js')
  const init = source.indexOf('await startAdminSystem()')
  const restore = source.indexOf('restorePersistentAdminTab()', init)
  assert.ok(init >= 0 && restore > init, 'saved admin tab must restore after administrator authentication completes')
})

test('admin Flex deep links authenticate with LINE and preserve the target URL', () => {
  const admin = read('admin.js')
  const page = read('admin.page.js')
  assert.match(admin, /liff\.login\(\{ redirectUri \}\)/)
  assert.match(admin, /const redirectUri = window\.location\.href/)
  assert.match(admin, /window\.RoyalAdminReady = startAdminSystem/)
  assert.match(page, /await window\.RoyalAdminReady\(\)/)
  assert.doesNotMatch(page, /LIFF init slow, forcing start/)
})

test('LINE login preserves deep links on both desktop and mobile entry points', () => {
  for (const file of ['index.html', 'app.js', 'all-rewards.html', 'admin.js', 'loader.js']) {
    const source = read(file)
    assert.doesNotMatch(source, /liff\.login\(\s*\)/, `${file} must preserve the current deep-link URL during LINE login`)
  }
  assert.match(read('index.html'), /liff\.login\(\{ redirectUri: window\.location\.href \}\)/)
  assert.match(read('app.js'), /liff\.login\(\{ redirectUri: window\.location\.href \}\)/)
})

test('internal desk numbers are never exposed as clickable telephone links', () => {
  for (const file of ['lib/line-messaging.js', 'app.js', 'all-rewards.html']) {
    assert.doesNotMatch(read(file), /tel:1199/i, `${file} must describe internal extensions as text only`)
  }
})

test('user-facing source files contain no common UTF-8 mojibake sequences', () => {
  const userFacingFiles = [
    'index.html',
    'admin.html',
    'all-rewards.html',
    'app.js',
    'admin.js',
    'admin.page.js',
    'loader.js'
  ]
  const mojibakePatterns = ['เน€', 'เธ', 'โ€', 'โญ']
  for (const file of userFacingFiles) {
    const source = read(file)
    for (const pattern of mojibakePatterns) {
      assert.equal(source.includes(pattern), false, `${file} contains a likely encoding error: ${pattern}`)
    }
  }
})
