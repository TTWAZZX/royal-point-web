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
  assert.match(read('all-rewards.html'), /RoyalAuth\?\.isRecoveryMode\?\.\(\)/)
  assert.match(read('api/admin-actions.js'), /allowRecovery: false/)
})

test('all rewards verifies LINE identity before using UID on desktop and mobile links', () => {
  const rewards = read('all-rewards.html')
  const app = read('app.js')

  assert.match(rewards, /await liff\.init\(\{ liffId: LIFF_ID_REWARDS \}\)/)
  assert.match(rewards, /liff\.login\(\{ redirectUri: window\.location\.href \}\)/)
  assert.match(rewards, /const profile = await liff\.getProfile\(\)/)
  assert.match(rewards, /cleanUrl\.searchParams\.delete\('uid'\)/)
  assert.match(rewards, /if \(window\.RoyalAuth\?\.isRecoveryMode\?\.\(\)\)/)
  assert.doesNotMatch(app, /allRewardsBtn\.href\s*=/)
})

test('LINE authentication help center is connected end to end', () => {
  const migration = read('supabase_user_auth_migration.sql')
  assert.match(migration, /auth_help_cases/)
  assert.match(migration, /auth_recovery_tickets/)
  assert.match(migration, /line_notification_outbox/)
  assert.match(read('api/liff-guard.js'), /action === 'request'/)
  assert.match(read('api/liff-guard.js'), /action === 'consume'/)
  assert.match(read('api/liff-guard.js'), /action === 'complete'/)
  assert.match(read('lib/line-auth.js'), /resolutionMethod: 'line_verified'/)
  assert.match(read('api/liff-guard.js'), /resolutionMethod: 'recovery_completed'/)
  assert.match(read('api/admin-actions.js'), /resolution_method:/)
  assert.match(read('api/admin-actions.js'), /last_verified_at/)
  assert.match(read('api/admin-actions.js'), /reconciled: true/)
  assert.match(read('admin.page.js'), /ผลผู้ใช้:/)
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
  assert.match(read('api/admin-coupons.js'), /assignmentRequestId/)
  assert.match(read('admin.js'), /submitCouponAssignment/)
  assert.match(read('admin.js'), /findCouponAssignment/)
  assert.match(read('admin.js'), /COUPON_ASSIGNMENT_TIMEOUT/)
  assert.match(read('admin.js'), /void loadCoupons\(\)/)
  assert.doesNotMatch(read('admin.js'), /await loadCoupons\(\);\s*const sent/)
  assert.match(read('app.js'), /hasCouponDeepLink/)
  assert.match(read('index.html'), /window\.__LIFF_INITED = true/)
  assert.match(read('index.html'), /LIFF_INIT_TIMEOUT/)
  assert.match(read('index.html'), /bootFetch/)
  assert.match(read('index.html'), /const hasCouponTicket/)
  assert.ok(
    read('index.html').indexOf('const hasCouponTicket') < read('index.html').indexOf('const resp = await bootFetch'),
    'personal coupon must open before dashboard score preflight'
  )
  assert.match(read('app.js'), /redeemAssignedCoupon/)
  assert.match(read('app.js'), /COUPON_CONFIRMATION_TIMEOUT/)
  assert.match(read('api/redeem.js'), /state: redeemed \? 'redeemed'/)
  assert.doesNotMatch(read('app.js'), /redeemAssignedCoupon[\s\S]{0,2200}method: 'POST'[\s\S]{0,1200}method: 'POST'/)
  assert.ok(
    read('app.js').indexOf('await handleCouponDeepLink()') < read('app.js').indexOf('await Promise.allSettled([', read('app.js').indexOf('async function initApp(ctx')),
    'coupon deep links must open before optional dashboard requests'
  )
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

test('admin-managed advertisement carousel keeps legacy fallback and full workflow', () => {
  const migration = read('supabase_ad_banners_migration.sql')
  const adminApi = read('api/admin-actions.js')
  const publicApi = read('api/rewards.js')
  const adminHtml = read('admin.html')
  const adminJs = read('admin.js')
  const app = read('app.js')
  const index = read('index.html')

  assert.match(migration, /create table if not exists public\.ad_banners/)
  assert.match(migration, /insert into storage\.buckets/)
  assert.match(migration, /10000000-0000-4000-8000-000000000003/)
  assert.match(publicApi, /req\.query\.action \|\| ''\) === 'banners'/)
  for (const action of ['ad_banner_save', 'ad_banner_toggle', 'ad_banner_delete', 'ad_banner_restore', 'ad_banner_reorder']) {
    assert.match(adminApi, new RegExp(action))
  }
  assert.match(adminApi, /AD_MAX_BYTES = 2 \* 1024 \* 1024/)
  assert.match(adminApi, /ad_image_signature_invalid/)
  assert.match(adminHtml, /id="pills-ads"/)
  assert.match(adminHtml, /id="adBannerFile"/)
  assert.match(adminHtml, /id="adBannerImageUrl"/)
  assert.match(adminJs, /function loadAdBanners/)
  assert.match(adminJs, /window\.moveAdBanner = async/)
  assert.match(app, /function readLegacyAdItems/)
  assert.match(app, /using legacy fallback/)
  assert.match(app, /interval: 3500/)
  assert.match(index, /id="adPreviewModal"/)
})

test('Safety Questions supports accurate totals, filters, pagination and fair daily rotation', () => {
  const migration = read('supabase_safety_questions_pagination_migration.sql')
  const adminApi = read('api/admin-actions.js')
  const dailyApi = read('api/daily-checkin.js')
  const adminHtml = read('admin.html')
  const adminJs = read('admin.js')
  const safetyQuestionsGet = adminApi.slice(
    adminApi.indexOf("if (req.query.action === 'safety_questions')"),
    adminApi.indexOf("if (req.query.action === 'safety_settings')")
  )

  assert.match(migration, /safety_questions_created_id_idx/)
  assert.match(migration, /question gin_trgm_ops/)
  assert.match(adminApi, /select\('id,category,question,options,active,source,created_by,created_at,updated_at', \{ count: 'exact' \}\)/)
  assert.match(adminApi, /\.range\(from, to\)/)
  assert.match(adminApi, /statusFilter === 'inactive'/)
  assert.match(adminApi, /query\.ilike\('question'/)
  assert.match(adminApi, /safety_question_batch_create/)
  assert.doesNotMatch(safetyQuestionsGet, /\.limit\(100\)/)
  assert.match(dailyApi, /selectSmartSafetyQuestion/)
  assert.match(dailyApi, /select\('safety_question_id,checkin_date,created_at'\)/)
  assert.doesNotMatch(dailyApi, /\.limit\(30\)/)
  for (const id of ['safetyQuestionSearch', 'safetyQuestionStatusFilter', 'safetyQuestionCategoryFilter', 'safetyQuestionSourceFilter', 'safetyQuestionSort', 'safetyQuestionPageSize']) {
    assert.match(adminHtml, new RegExp(`id="${id}"`))
  }
  assert.match(adminJs, /function renderSafetyQuestionPagination/)
  assert.match(adminJs, /showNewestSafetyQuestions/)
  assert.match(adminJs, /action: 'safety_question_batch_create'/)
})

test('Safety Questions rotate intelligently per user without changing during the day', () => {
  const migration = read('supabase_safety_question_rotation_migration.sql')
  const dailyApi = read('api/daily-checkin.js')
  const rotation = read('lib/safety-question-rotation.js')

  assert.match(migration, /create table if not exists public\.safety_question_assignments/)
  assert.match(migration, /unique \(uid, assignment_date\)/)
  assert.match(migration, /daily_checkins_question_rotation_idx/)
  assert.match(migration, /to service_role/i)
  assert.doesNotMatch(migration, /to (?:anon|authenticated)/i)
  assert.match(dailyApi, /loadAssignedSafetyQuestion/)
  assert.match(dailyApi, /persistSafetyQuestionAssignment/)
  assert.match(dailyApi, /selectSafetyQuestionForUser/)
  assert.match(dailyApi, /getTodaySafetyQuestion\(today, user, existing\)/)
  assert.match(dailyApi, /mode: 'existing_checkin'/)
  assert.match(rotation, /mode = 'least_recently_seen'/)
  assert.match(rotation, /stableQuestionScore/)
})

test('admin restores the saved tab only after administrator authentication finishes', () => {
  const source = read('admin.js')
  const auth = source.indexOf('const ready = await startAdminSystem()')
  const restoreAndLoad = source.indexOf('await ensureInitialAdminTab()', auth)
  assert.ok(auth >= 0 && restoreAndLoad > auth, 'saved admin tab must restore after administrator authentication completes')
})

test('admin restores and loads the previous tab before hiding the startup screen', () => {
  const admin = read('admin.js')
  const page = read('admin.page.js')
  assert.match(admin, /RoyalAdminInitialTabReady = ensureInitialAdminTab/)
  assert.match(admin, /await ensureInitialAdminTab\(\)/)
  assert.match(admin, /scrollIntoView\(\{ behavior:'auto', block:'nearest', inline:'center' \}\)/)
  assert.doesNotMatch(admin, /setTimeout\(\(\) => bootstrap\.Tab/)
  assert.match(page, /await window\.RoyalAdminInitialTabReady\(\)/)
  assert.ok(page.indexOf('await window.RoyalAdminInitialTabReady()') < page.indexOf('window.SystemBoot?.hide?.()'))
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
