const assert = require('node:assert/strict')
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require('playwright-core')

const root = path.resolve(__dirname, '..')
const chromeCandidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean)
const executablePath = chromeCandidates.find(candidate => fs.existsSync(candidate))
if (!executablePath) throw new Error('ไม่พบ Chrome/Edge สำหรับ browser test (กำหนด CHROME_PATH ได้)')

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' }
const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname)
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
  const file = path.resolve(root, relative)
  if (!file.startsWith(`${root}${path.sep}`) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end('not found')
    return
  }
  res.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream' })
  fs.createReadStream(file).pipe(res)
})

async function runViewport(browser, baseUrl, viewport) {
  const page = await browser.newPage({ viewport })
  await page.route('https://static.line-scdn.net/**', route => route.fulfill({
    contentType: 'text/javascript',
    body: `window.liff={init:async()=>{},isLoggedIn:()=>true,getProfile:async()=>({userId:'U_BROWSER_TEST',displayName:'Browser Test'}),getIDToken:()=> 'test-token',login:()=>{}};`
  }))
  await page.route('https://cdn.jsdelivr.net/**', route => route.abort())
  await page.route('https://cdnjs.cloudflare.com/**', route => route.abort())
  await page.route('**/api/rewards?*', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ status: 'success', items: [
      { id: 'safe', name: 'รางวัลทดสอบ', cost: 10, stock: 2, stock_max: 5, sort_index: 1, img: 'https://placehold.co/300x300?text=Safe' },
      { id: 'xss', name: 'XSS', cost: 20, stock: 1, stock_max: 1, sort_index: 2, img: `javascript:window.__rewardXss=true` }
    ] })
  }))
  await page.route('**/api/get-score?*', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ status: 'success', data: { balance: 100 } }) }))

  await page.goto(`${baseUrl}/all-rewards.html`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#rewardGrid .reward-card', { state: 'visible' })
  const result = await page.evaluate(() => ({
    cards: document.querySelectorAll('#rewardGrid .reward-card').length,
    inlineHandlers: document.querySelectorAll('#rewardGrid img[onerror], #rewardGrid img[onload]').length,
    imageSources: [...document.querySelectorAll('#rewardGrid img')].map(image => image.src),
    xss: Boolean(window.__rewardXss),
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    buttons: [...document.querySelectorAll('#rewardGrid button')].map(button => ({ width: button.getBoundingClientRect().width, height: button.getBoundingClientRect().height }))
  }))
  assert.equal(result.cards, 2)
  assert.equal(result.inlineHandlers, 0)
  assert.equal(result.xss, false)
  assert.ok(result.imageSources.every(url => url.startsWith('https://placehold.co/')), `พบ URL รูปที่ไม่อนุญาต: ${result.imageSources.join(', ')}`)
  assert.ok(result.overflow <= 1, `หน้า ${viewport.width}px ล้นแนวนอน ${result.overflow}px`)
  assert.ok(result.buttons.every(button => button.width >= 44 && button.height >= 30), 'ปุ่มรางวัลเล็กเกินไปสำหรับการสัมผัส')
  await page.close()
}

async function runMemberCheckinViewport(browser, baseUrl, viewport) {
  const page = await browser.newPage({ viewport, hasTouch: viewport.width < 500 })
  await page.addInitScript(() => {
    window.Swal = { fire: async prompt => ({
      isConfirmed: true,
      value: prompt?.title === 'Daily Safety Check-in' ? prompt.preConfirm() : undefined
    }) }
  })
  for (const domain of ['cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'fonts.googleapis.com', 'unpkg.com']) {
    await page.route(`https://${domain}/**`, route => route.abort())
  }
  await page.route('https://static.line-scdn.net/**', route => route.fulfill({
    contentType: 'text/javascript',
    body: `window.liff={init:async()=>{},isLoggedIn:()=>true,getProfile:async()=>({userId:'U_LEGACY_MEMBER',displayName:'สมาชิกทดสอบ'}),getAccessToken:()=>null};`
  }))

  let score = 100
  let checkinPosts = 0
  let scoreReadsAfterCommit = 0
  await page.route('**/api/**', async route => {
    const request = route.request()
    const { pathname } = new URL(request.url())
    if (pathname === '/api/get-score') {
      if (score > 100) scoreReadsAfterCommit++
      return route.fulfill({ json: { status: 'success', data: { score, rewards: [] } } })
    }
    if (pathname === '/api/daily-checkin') {
      const data = {
        checkedIn: Boolean(checkinPosts), points: 5, streak: 1,
        safetyQuestion: { id: 'test-safety', question: 'วันนี้พร้อมทำงานอย่างปลอดภัยไหม', options: [{ answer: 'ready', label: 'พร้อม' }] }
      }
      if (request.method() === 'POST') {
        assert.equal(request.headers().authorization, undefined)
        assert.equal(request.postDataJSON().uid, 'U_LEGACY_MEMBER')
        assert.equal(request.postDataJSON().safetyQuestionId, 'test-safety')
        checkinPosts++
        score += 5
        // Another request already committed today's check-in while this page was open.
        return route.fulfill({ status: 409, json: { status: 'error', message: 'already_checked_in', data: { ...data, checkedIn: true } } })
      }
      return route.fulfill({ json: { status: 'success', data } })
    }
    return route.fulfill({ json: { status: 'success', items: [], data: [] } })
  })

  await page.goto(`${baseUrl}/index.html`)
  await page.locator('#systemBootOverlay').waitFor({ state: 'hidden' })
  const checkin = page.locator('#dailyCheckinBtn')
  await Promise.all([
    page.waitForResponse(response => scoreReadsAfterCommit > 0 && new URL(response.url()).pathname === '/api/get-score'),
    viewport.width < 500 ? checkin.tap() : checkin.click()
  ])
  await page.waitForFunction(() => document.querySelector('#dailyCheckinLabel').textContent.includes('แล้ว'))
  assert.equal(checkinPosts, 1)
  assert.ok(scoreReadsAfterCommit)
  await page.close()
}

async function runRedemptionReplay(browser, baseUrl, viewport, pathName) {
  const page = await browser.newPage({ viewport, hasTouch: viewport.width < 500 })
  await page.addInitScript(() => {
    window.Swal = { fire: async (title, text) => {
      const label = typeof title === 'string' ? title : title.title
      window.testRedemptionDialog = [label, text]
      return { isConfirmed: label !== 'พบรายการแลกเดิมในประวัติ' }
    } }
  })
  for (const domain of ['cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'fonts.googleapis.com', 'unpkg.com']) {
    await page.route(`https://${domain}/**`, route => route.abort())
  }
  await page.route('https://static.line-scdn.net/**', route => route.fulfill({
    contentType: 'text/javascript',
    body: `window.liff={init:async()=>{},isLoggedIn:()=>true,getProfile:async()=>({userId:'U_REDEEM_TEST',displayName:'สมาชิกทดสอบ'}),getAccessToken:()=> 'test-token'};`
  }))

  const rewardId = '20000000-0000-4000-8000-000000000001'
  const redemptionId = '40000000-0000-4000-8000-000000000001'
  const submittedIds = []
  await page.route('**/api/**', async route => {
    const request = route.request()
    const { pathname, searchParams } = new URL(request.url())
    if (pathname === '/api/get-score') {
      return route.fulfill({ json: { status: 'success', data: { score: submittedIds.length ? 80 : 100, rewards: [] } } })
    }
    if (pathname === '/api/rewards' && !searchParams.has('action')) {
      return route.fulfill({ json: { status: 'success', items: [{
        id: rewardId, name: 'รางวัลทดสอบ', cost: 90, stock: submittedIds.length ? 0 : 1, stock_max: 1
      }] } })
    }
    if (pathname === '/api/spend') {
      assert.equal(request.headers().authorization, 'Bearer test-token')
      if (request.method() === 'GET') {
        assert.equal(searchParams.get('redemptionId'), redemptionId)
        return route.fulfill({ json: { status: 'success', data: {
          id: redemptionId, cost: 90, redemptionStatus: 'approved', createdAt: new Date().toISOString(), rewardName: 'รางวัลทดสอบ'
        } } })
      }
      const payload = request.postDataJSON()
      assert.equal(payload.uid, 'U_REDEEM_TEST')
      assert.equal(payload.rewardId, rewardId)
      submittedIds.push(payload.requestId)
      if (submittedIds.length === 1) {
        return route.fulfill({ status: 503, json: { status: 'error', message: 'spend_failed' } })
      }
      return route.fulfill({ json: { status: 'success', duplicate: true, balance: 10, redemption: { id: redemptionId, status: 'approved' } } })
    }
    return route.fulfill({ json: { status: 'success', items: [], data: { checkedIn: false } } })
  })

  const filteredCatalog = pathName === 'all-rewards.html'
  await page.goto(`${baseUrl}/${pathName}${filteredCatalog ? '?filter=affordable' : ''}`)
  await page.locator('#systemBootOverlay').waitFor({ state: 'hidden' })
  const redeem = page.getByRole('button', { name: /^แลก( รางวัลทดสอบ|รางวัล)$/ })
  if (viewport.width < 500) await redeem.tap()
  else await redeem.click()
  await page.waitForFunction(() => window.testRedemptionDialog?.[0] === 'ผิดพลาด')
  await page.reload()
  await page.locator('#systemBootOverlay').waitFor({ state: 'hidden' })
  if (filteredCatalog) {
    await page.waitForFunction(() => !document.querySelector('#rewardPendingLink').classList.contains('d-none'))
    assert.equal(await page.locator('#rewardPendingLink').getAttribute('href'), '/#redemptionTracker')
    assert.equal(await page.locator('#rewardGrid .reward-card').count(), 0)
    await page.getByRole('button', { name: 'ทั้งหมด', exact: true }).click()
  }
  const retry = page.locator('.rp-reward-card, .reward-card').getByRole('button', { name: /^ตรวจรายการเดิม/ })
  if (viewport.width < 500) await retry.tap()
  else await retry.click()
  await page.waitForFunction(() => window.testRedemptionDialog?.some(text => text?.includes('พบรายการแลกเดิมในประวัติ')))
  assert.equal(submittedIds.length, 2)
  assert.match(submittedIds[0], /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  assert.equal(submittedIds[0], submittedIds[1])
  if (pathName === 'index.html') {
    await page.goto(`${baseUrl}/index.html?redemption_id=${redemptionId}`)
    await page.waitForFunction(() => window.testRedemptionDialog?.[0] === 'หลักฐานรายการแลก')
  }
  await page.close()
}

async function runPickupTracking(browser, baseUrl, viewport) {
  const page = await browser.newPage({ viewport, hasTouch: viewport.width < 500 })
  const rewardId = '20000000-0000-4000-8000-000000000005'
  const redemptionId = '40000000-0000-4000-8000-000000000005'
  await page.addInitScript(() => {
    window.Swal = { fire: async (config, text) => {
      window.pickupDialog = typeof config === 'string' ? text : config.title
      window.pickupDialogHtml = typeof config === 'object' ? config.html : ''
      return { isConfirmed: true }
    } }
  })
  await page.route('https://static.line-scdn.net/**', route => route.fulfill({
    contentType: 'text/javascript',
    body: `window.liff={init:async()=>{},isLoggedIn:()=>true,getProfile:async()=>({userId:'U_PICKUP_TEST'}),getAccessToken:()=> 'test-token'};`
  }))
  for (const domain of ['cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'fonts.googleapis.com', 'unpkg.com']) {
    await page.route(`https://${domain}/**`, route => route.abort())
  }
  let postedRequest = ''
  let completed = false
  let pickup = 'approved'
  let evidenceReads = 0
  let successfulSpend = false
  await page.route('**/api/**', async route => {
    const request = route.request()
    const { pathname, searchParams } = new URL(request.url())
    let result = { status: 'success', items: [], data: { checkedIn: false } }
    if (pathname === '/api/get-score') result.data = { score: 100 }
    if (pathname === '/api/rewards' && !searchParams.has('action')) {
      result.items = [{ id: rewardId, cost: 10, stock: 1, name: 'รางวัลทดสอบ' }]
    }
    if (pathname === '/api/redemptions') {
      assert.equal(searchParams.get('pickup'), 'pending')
      if (completed && pickup === 'approved') result.items = [{ id: redemptionId, cost: 10, status: pickup, reward_name: 'รางวัลทดสอบ' }]
    }
    if (pathname === '/api/spend' && request.method() === 'POST') {
      if (successfulSpend) {
        return route.fulfill({ json: { status: 'success', balance: 90, redemption: { id: redemptionId, status: 'approved' } } })
      }
      assert.equal(postedRequest, '')
      postedRequest = request.postDataJSON().requestId
      return route.fulfill({ status: 503, json: { status: 'error', message: 'spend_failed' } })
    }
    if (pathname === '/api/spend' && request.method() === 'GET') {
      evidenceReads++
      if (searchParams.has('requestId')) {
        assert.equal(searchParams.get('requestId'), postedRequest)
        assert.equal(searchParams.get('rewardId'), rewardId)
        if (!completed) return route.fulfill({ status: 404, json: { status: 'error' } })
      } else assert.equal(searchParams.get('redemptionId'), redemptionId)
      result.data = { id: redemptionId, cost: 10, redemptionStatus: pickup, createdAt: new Date().toISOString(), rewardName: 'รางวัลทดสอบ' }
    }
    return route.fulfill({ json: result })
  })

  try {
    await page.goto(`${baseUrl}/index.html`)
    await page.locator('#systemBootOverlay').waitFor({ state: 'hidden' })
    const start = page.getByRole('button', { name: 'แลก รางวัลทดสอบ' })
    if (viewport.width < 500) await start.tap()
    else await start.click()
    const check = page.locator('#redemptionTracker [data-check-redemption]')
    await page.locator('#pendingRedemptionList .rp-status--waiting').getByText('รอตรวจผลการแลก', { exact: true }).waitFor()
    await check.click()
    await page.waitForFunction(() => window.pickupDialog?.includes('ยังไม่พบรายการที่บันทึกไว้'))
    assert.ok(await check.count())

    completed = true
    await check.click()
    await page.waitForFunction(() => window.pickupDialog === 'หลักฐานรายการแลก')
    await check.waitFor({ state: 'detached' })
    const evidence = page.locator('#redemptionTracker [data-open-redemption]')
    await page.locator('#pickupRedemptionList .rp-status--waiting').getByText('รอรับรางวัล', { exact: true }).waitFor()
    const tracker = page.locator('#redemptionTracker')
    assert.equal(await tracker.evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(248, 255, 251)')
    assert.equal(await tracker.locator('h2').evaluate(element => getComputedStyle(element).color), 'rgb(20, 41, 31)')
    assert.equal(await tracker.locator('.rp-redemption-item').evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(255, 255, 255)')
    assert.ok(await evidence.evaluate(element => element.getBoundingClientRect().height >= 44))
    await Promise.all([
      page.waitForResponse(response => new URL(response.url()).searchParams.get('redemptionId') === redemptionId),
      evidence.click()
    ])
    assert.equal(evidenceReads, 3)
    assert.match(await page.evaluate(() => window.pickupDialogHtml), /rp-status--waiting">รอรับรางวัล/)
    pickup = 'received'
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
    await evidence.waitFor({ state: 'detached' })

    pickup = 'approved'
    successfulSpend = true
    await page.goto(`${baseUrl}/all-rewards.html`)
    await page.getByRole('button', { name: 'แลกรางวัล' }).click()
    await page.waitForURL(url => url.pathname === '/' && url.searchParams.get('redemption_id') === redemptionId, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => window.pickupDialog === 'หลักฐานรายการแลก')
  } finally { await page.close() }
}

async function runAdminViewport(browser, baseUrl, viewport) {
  const page = await browser.newPage({ viewport, hasTouch: viewport.width < 500 })
  await page.addInitScript(() => {
    window.bootstrap = {
      Tab: { getOrCreateInstance: button => ({ show: () => button.dispatchEvent(new Event('shown.bs.tab')) }) },
      Modal: class { show() {} }
    }
    window.Swal = { fire: async title => { window.testAdminDialog = title; return { isConfirmed: true } } }
    document.addEventListener('click', event => {
      const tab = event.target.closest('#adminTabs [data-bs-toggle="pill"]')
      if (tab) window.bootstrap.Tab.getOrCreateInstance(tab).show()
    })
    sessionStorage.setItem('ROYAL_AUTH_RECOVERY_UNTIL', String(Date.now() + 60000))
  })
  await page.route('https://cdn.jsdelivr.net/**', route => route.abort())
  await page.route('https://cdnjs.cloudflare.com/**', route => route.abort())
  await page.route('https://fonts.googleapis.com/**', route => route.abort())
  await page.route('https://static.line-scdn.net/**', route => route.fulfill({
    contentType: 'text/javascript',
    body: `window.liff={init:async()=>{},isLoggedIn:()=>!location.search.includes('signedOut'),getProfile:async()=>({userId:'U_BROWSER_ADMIN',displayName:'Browser Admin'}),getAccessToken:()=> 'admin-test-token',login:options=>{window.testAdminRedirect=options.redirectUri}};`
  }))
  let role = 'super_admin'
  let birthdayStatus = 'pending'
  const futureBirthday = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10)
  let birthdayRetryAccepted = false
  let profile = { name: 'สมาชิกทดสอบ', room: 'SHE', dob: '1990-11-22', tel: '0800000000', passport: null }
  let profileWrites = 0
  let memberScore = 100
  let couponBatch = null
  let pendingWorkReads = 0
  let pickupStatus = 'approved'
  const couponRequests = []
  await page.route('**/api/admin-coupons?**', async route => {
    const params = new URL(route.request().url()).searchParams
    if (params.get('action') !== 'generated_batches') return route.fulfill({ json: { status: 'success', data: [] } })
    assert.equal(route.request().headers().authorization, 'Bearer admin-test-token')
    const requestId = params.get('requestId')
    if (requestId) assert.equal(requestId, couponBatch.request_id)
    return route.fulfill({ json: { status: 'success', data: requestId ? couponBatch : [couponBatch] } })
  })
  await page.route('**/api/admin-coupons-generate', async route => {
    const { requestId, count, points } = route.request().postDataJSON()
    assert.equal(count, 2)
    assert.equal(points, 25)
    couponRequests.push(requestId)
    if (!couponBatch) {
      couponBatch = { request_id: requestId, coupon_count: 2, points: 25, codes: ['ABCDEF', 'GHJKLM'], created_at: new Date().toISOString() }
      return route.fulfill({ status: 503, json: { status: 'error', code: 'coupon_batch_unconfirmed' } })
    }
    assert.equal(requestId, couponBatch.request_id)
    return route.fulfill({ json: { status: 'success', created: 2, data: { ...couponBatch, repeated: true } } })
  })
  await page.route('**/api/all-scores?**', async route => {
    await route.fulfill({ json: { status: 'success', data: [{ uid: 'U_MEMBER', name: profile.name, tel: profile.tel, score: memberScore }] } })
  })
  await page.route('**/api/admin-actions?**', async route => {
    assert.equal(route.request().headers().authorization, 'Bearer admin-test-token')
    const params = new URL(route.request().url()).searchParams
    const action = params.get('action')
    if (action === 'birthday_upcoming') {
      return route.fulfill({ json: { status: 'success', data: [{ run_date: futureBirthday, scheduled_members: 1 }] } })
    }
    if (action === 'birthday_runs') {
      assert.match(params.get('date'), /^\d{4}-\d{2}-\d{2}$/)
      if (params.get('date') === futureBirthday) {
        return route.fulfill({ json: { status: 'success', data: {
          upcoming: true, total: 1, awarded: 0, notAwarded: 1,
          items: [{ name: 'สมาชิกรอแจก', dob: '1990-11-22', state: 'not_awarded' }]
        } } })
      }
      const delivery = birthdayRetryAccepted
        ? { line_status: 'sent', line_request_id: 'line-confirmed-fixture', line_confirmed_at: '2026-11-22T08:30:00Z', line_acceptance_recovered: false }
        : { line_status: 'failed', notification_id: 'birthday-report-test', line_queued_at: new Date().toISOString() }
      return route.fulfill({ json: { status: 'success', data: {
        run: { reward_count: 1 }, total: 2, awarded: 1, previouslyAwarded: 0, notAwarded: 1, lineSent: birthdayRetryAccepted ? 1 : 0,
        items: [{ name: 'เกิดวันนี้', dob: '1990-11-22', state: 'awarded', delivery }, { name: 'สมาชิกอีกคน', dob: null, state: 'not_awarded' }]
      } } })
    }
    if (action === 'member_profile') {
      assert.equal(params.get('targetUid'), 'U_MEMBER')
      return route.fulfill({ json: { status: 'success', data: profile } })
    }
    if (action === 'member_activity') {
      assert.equal(params.get('targetUid'), 'U_MEMBER')
      const data = params.get('category') === 'rewards'
        ? [{ category: 'rewards', activity: 'reward_redemption', state: 'approved', label: 'ของทดสอบ', points: null }]
        : [{ category: 'points', activity: 'BIRTHDAY_REWARD', points: 100 }, { category: 'safety', activity: 'safety_checkin', points: null }]
      return route.fulfill({ json: { status: 'success', before: '2026-11-22T00:00:00Z', hasMore: false, data } })
    }
    if (action === 'pending_work') {
      pendingWorkReads++
      return route.fulfill({ json: { status: 'success', data: {
        pickup: pickupStatus === 'approved' ? 1 : 0, help: 2, line: 1, audit: pendingWorkReads === 1 ? null : 0
      } } })
    }
    if (action === 'safety_pulse') {
      return route.fulfill({ json: { status: 'success', data: { riskItems: [{
        id: 'mock-risk', room: 'SHE', name: 'สมาชิกทดสอบ', riskStatus: 'acknowledged', answer: 'need_support'
      }] } } })
    }
    if (action === 'auth_help_cases' && params.get('status') === 'open') {
      return route.fulfill({ json: { status: 'success', data: [{
        id: 'mock-open-help', case_no: 'RP-TEST', status: 'open', notifications: [{ id: 'mock-help-failure', status: 'failed' }]
      }] } })
    }
    if (action === 'line_notifications' && params.get('status') === 'failed') {
      assert.equal(params.get('kind'), 'all')
      return route.fulfill({ json: { status: 'success', data: [{
        id: 'mock-line-failure', dedupe_key: 'mock-failure', message_kind: 'score_adjusted', status: 'failed'
      }] } })
    }
    if (action === 'line_notifications' && params.get('kind') === 'birthday_reward') {
      return route.fulfill({ json: { status: 'success', data: [{
        id: 'birthday-test-id', dedupe_key: 'birthday-reward:test', message_kind: 'birthday_reward', status: birthdayStatus
      }] } })
    }
    await route.fulfill({ json: action ? { status: 'success', data: [] } : { isAdmin: Boolean(role), role } })
  })
  await page.route('**/api/admin-audit-logs?**', route => route.fulfill({ json: { status: 'success', data: [], auditFailures: [] } }))
  await page.route('**/api/admin-actions', async route => {
    assert.equal(route.request().headers().authorization, 'Bearer admin-test-token')
    const { action, notificationId, targetUid, checkinDate, status, redemptionId } = route.request().postDataJSON()
    if (action === 'birthday_notification_retry') {
      assert.equal(notificationId, 'birthday-report-test')
      birthdayRetryAccepted = true
      return route.fulfill({ json: { status: 'success', data: { status: 'sent' } } })
    }
    if (action === 'member_profile_update') {
      const payload = route.request().postDataJSON()
      assert.equal(targetUid, 'U_MEMBER')
      assert.deepEqual(payload.profile, { name: 'สมาชิกแก้ไขแล้ว', dob: '1991-11-22' })
      assert.equal(payload.expected.dob, '1990-11-22')
      profileWrites++
      profile = { ...profile, ...payload.profile }
      return route.fulfill({ json: { status: 'success', data: { changed: true } } })
    }
    if (action === 'get_history') {
      assert.equal(status, 'approved')
      return route.fulfill({ json: { status: 'success', data: pickupStatus === 'approved'
        ? [{ id: 'mock-pickup', status: pickupStatus, reward_name: 'รางวัลรอรับ' }]
        : [] } })
    }
    if (action === 'redemption_receive') {
      assert.equal(redemptionId, 'mock-pickup')
      pickupStatus = 'received'
      return route.fulfill({ json: { status: 'success', data: { lineNotification: { status: 'sent' } } } })
    }
    if (action === 'safety_checkin_points_recover') {
      assert.equal(targetUid, 'U_MEMBER')
      assert.equal(checkinDate, '2026-01-10')
      const recovered = memberScore === 100
      if (recovered) memberScore += 15
      return route.fulfill({ json: { status: 'success', data: { dailyAdded: recovered ? 5 : 0, weeklyAdded: recovered ? 10 : 0 } } })
    }
    assert.equal(action, 'line_notification_retry')
    assert.equal(notificationId, 'birthday-test-id')
    birthdayStatus = 'sent'
    await route.fulfill({ json: { status: 'success', data: { status: 'sent' } } })
  })

  const deepLink = `${baseUrl}/admin.html?helpCase=123`
  await page.goto(`${deepLink}&signedOut=1`)
  assert.equal(await page.evaluate(() => window.testAdminRedirect), `${deepLink}&signedOut=1`)
  assert.equal(await page.locator('#adminContent').evaluate(element => element.hidden), true)

  await page.goto(deepLink)
  assert.equal(await page.evaluate(() => window.RoyalAdminReady()), true)
  assert.equal(await page.evaluate(() => window.RoyalAdminInitialTabReady()), '#pills-auth-help')
  assert.equal(await page.locator('#adminContent').evaluate(element => element.hidden), false)
  await page.locator('#tabBirthdayBtn').click()
  await page.locator('#birthdayRunResult').getByText('ประมวลผลคะแนนสำเร็จ', { exact: true }).waitFor()
  await page.locator('#birthdayRunResult').getByText('ส่ง LINE ไม่สำเร็จ', { exact: true }).waitFor()
  await page.locator('#birthdayRunResult').getByText('วันเกิด 22 พฤศจิกายน พ.ศ. 2533', { exact: true }).waitFor()
  await page.locator('#birthdayRunResult').getByText('ไม่ระบุวันเกิด', { exact: true }).waitFor()
  await page.locator('#birthdayRunResult').getByText('ยังไม่พบคะแนน', { exact: true }).last().waitFor()
  await page.getByRole('button', { name: 'ส่ง LINE ซ้ำ', exact: true }).click()
  await page.locator('#birthdayRunMembers').getByText(/เวลาที่ LINE ตอบรับ.*15:30:00/).waitFor()
  await page.locator('#birthdayRunMembers').getByText(/line-confirmed-fixture/).waitFor()
  await page.locator('#birthdayUpcomingList').getByRole('button', { name: /รอแจก 1 คน/ }).click()
  await page.locator('#birthdayRunResult').getByText('รอแจกคะแนนตามกำหนด', { exact: true }).waitFor()
  assert.equal(await page.locator('#birthdayRunDate').inputValue(), futureBirthday)
  assert.equal(pendingWorkReads, 0)
  const pendingWorkTab = page.getByRole('tab', { name: 'งานค้าง' })
  if (viewport.width < 500) await pendingWorkTab.tap()
  else await pendingWorkTab.click()
  const pendingStatus = page.locator('#pendingWorkStatus')
  await pendingStatus.getByText('โหลดยอดบางรายการไม่สำเร็จ', { exact: false }).waitFor()
  const readCount = name => page.locator(`[data-pending-count="${name}"]`).textContent()
  assert.equal(await readCount('pickup'), '1')
  assert.equal(await readCount('audit'), '—')
  const workGrid = await page.locator('#pendingWorkGrid').evaluate(grid => ({
    overflow: grid.scrollWidth - grid.clientWidth,
    minimumButtonHeight: Math.min(...Array.from(grid.querySelectorAll('button'), button => button.offsetHeight))
  }))
  assert.ok(workGrid.overflow <= 1)
  assert.ok(workGrid.minimumButtonHeight >= 44)
  await page.getByRole('button', { name: 'อัปเดตยอด' }).click()
  await pendingStatus.getByText('อัปเดตยอดแล้ว', { exact: true }).waitFor()
  assert.equal(await readCount('audit'), '0')

  await page.getByRole('button', { name: 'ดูรายการรอรับรางวัล' }).click()
  assert.equal(await page.locator('#historyStatusFilter').inputValue(), 'approved')
  await page.locator('#historyListArea').getByText('รางวัลรอรับ', { exact: true }).waitFor()
  await page.locator('#historyListArea .rp-status--waiting').getByText('รอรับรางวัล', { exact: true }).waitFor()
  await page.locator('#historyListArea').getByRole('button', { name: 'ยืนยันรับของ' }).click()
  await page.locator('#historyListArea').getByText('ไม่มีรายการรอรับรางวัล', { exact: true }).waitFor()
  await pendingWorkTab.click()
  await pendingStatus.getByText('อัปเดตยอดแล้ว', { exact: true }).waitFor()
  assert.equal(await readCount('pickup'), '0')

  await page.getByRole('button', { name: 'ดูเรื่องที่รอดำเนินการ' }).click()
  assert.equal(await page.locator('#authHelpStatusFilter').inputValue(), 'open')
  await page.locator('#authHelpListArea').getByText('RP-TEST', { exact: true }).waitFor()
  await page.locator('#authHelpListArea .rp-status--danger').getByText('ส่ง LINE ไม่สำเร็จ', { exact: true }).waitFor()
  await pendingWorkTab.click()
  await page.getByRole('button', { name: 'ดูข้อความที่ส่งไม่สำเร็จ' }).click()
  assert.equal(await page.locator('#lineNotificationStatus').inputValue(), 'failed')
  await page.locator('#lineNotificationList').getByRole('button', { name: 'ส่งใหม่', exact: true }).waitFor()
  await page.locator('#lineNotificationList .rp-status--danger').getByText('ส่ง LINE ไม่สำเร็จ', { exact: true }).waitFor()
  assert.ok(await page.locator('#lineNotificationList button').evaluateAll(buttons => buttons.every(button => button.offsetHeight >= 44)))
  await pendingWorkTab.click()
  await page.getByRole('button', { name: 'ดูบันทึกที่รอกู้คืน' }).click()
  await page.locator('#auditFailureArea').getByText('ไม่มีบันทึกระบบที่รอกู้คืน', { exact: true }).waitFor()
  await page.locator('#lineNotificationStatus').selectOption('all')
  await page.locator('#lineNotificationKind').selectOption('birthday_reward')
  const birthdayList = page.locator('#lineNotificationList')
  await birthdayList.getByText('คะแนนวันเกิด', { exact: true }).waitFor()
  const sendBirthday = birthdayList.getByRole('button', { name: 'ส่งตอนนี้' })
  if (viewport.width < 500) await sendBirthday.tap()
  else await sendBirthday.click()
  await birthdayList.getByText('ส่ง LINE แล้ว', { exact: true }).waitFor()

  await page.evaluate(async () => { await window.loadPageUsers(); window.openActionModal('U_MEMBER') })
  assert.equal(await page.locator('#adminTableBody .rp-status').textContent(), 'รอย้ายระบบ')
  assert.equal(await page.locator('#actionAuthStatus').textContent(), 'รอย้ายระบบ')
  await page.locator('#safetyRecoveryDate').fill('2026-01-10')
  const recoverPoints = page.locator('#btnRecoverSafetyPoints')
  if (viewport.width < 500) await recoverPoints.tap()
  else await recoverPoints.click()
  await page.waitForFunction(() => window.testAdminDialog === 'เติมคะแนนเรียบร้อย')
  await recoverPoints.click()
  await page.waitForFunction(() => window.testAdminDialog === 'ตรวจสอบแล้ว')
  assert.equal(memberScore, 115)
  await page.locator('#searchInput').fill('0800000000')
  await page.locator('#adminTableBody').getByText('0800000000').waitFor()
  await page.getByRole('button', { name: 'ดูประวัติกิจกรรม' }).click()
  await page.locator('#memberHistoryItems').getByText('คะแนนวันเกิด', { exact: true }).waitFor()
  await page.locator('#memberHistoryItems').getByText('เช็กอินความปลอดภัย', { exact: true }).waitFor()
  await page.locator('#memberHistoryCategory').selectOption('rewards')
  await page.locator('#memberHistoryItems').getByText('รอรับรางวัล', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'จัดการสมาชิก' }).click()
  await page.locator('#memberProfileToggle').click()
  await page.locator('#memberProfileName').fill('สมาชิกแก้ไขแล้ว')
  await page.locator('#memberProfileDob').fill('1991-11-22')
  await page.getByRole('button', { name: 'บันทึกข้อมูลส่วนตัว', exact: true }).click()
  await page.locator('#memberProfileStatus').getByText('บันทึกข้อมูลส่วนตัวแล้ว', { exact: true }).waitFor()
  await page.locator('#adminTableBody').getByText('สมาชิกแก้ไขแล้ว', { exact: true }).waitFor()
  assert.equal(profileWrites, 1)

  await page.locator('#genPoints').fill('25')
  await page.locator('#genCount').fill('2')
  const generate = page.locator('#btnGen')
  if (viewport.width < 500) await generate.tap()
  else await generate.click()
  await page.waitForFunction(() => window.testAdminDialog === 'ตรวจผลการสร้างคูปอง')
  await page.reload()
  assert.equal(await page.evaluate(() => window.RoyalAdminReady()), true)
  await page.waitForFunction(() => document.querySelector('#btnGen').textContent === 'ส่งคำขอเดิมอีกครั้ง')
  await generate.click()
  await page.waitForFunction(() => window.testAdminDialog === 'พบชุดคูปองเดิม')
  assert.equal(couponRequests.length, 2)
  assert.equal(couponRequests[0], couponRequests[1])

  await page.reload()
  assert.equal(await page.evaluate(() => window.RoyalAdminReady()), true)
  await page.locator('#pills-coupons summary').click()
  await page.locator('#btnLoadCouponBatches').click()
  await page.locator('#couponBatchRecent').selectOption(couponBatch.request_id)
  await page.waitForFunction(() => document.querySelector('#couponBatchCodes').value === 'ABCDEF\nGHJKLM')
  assert.equal(couponRequests.length, 2)

  await page.locator('#tabSafetyBtn').click()
  await page.locator('#safetyPulseArea .rp-status--info').getByText('รับทราบแล้ว', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'ดูรายละเอียดเคส', exact: true }).click()
  assert.match(await page.evaluate(() => window.testAdminDialog.html), /rp-status--info">รับทราบแล้ว/)

  role = 'safety_viewer'
  const pendingReadsBeforeRoleChange = pendingWorkReads
  await page.goto(deepLink)
  assert.equal(await page.evaluate(() => window.RoyalAdminReady()), true)
  assert.equal(await page.evaluate(() => window.RoyalAdminInitialTabReady()), '#pills-safety')
  assert.equal(await page.locator('#tabPendingWorkBtn').evaluate(button => button.closest('li').classList.contains('d-none')), true)
  assert.equal(pendingWorkReads, pendingReadsBeforeRoleChange)

  role = ''
  await page.goto(deepLink)
  assert.equal(await page.evaluate(() => window.RoyalAdminReady()), false)
  assert.equal(await page.locator('#adminContent').evaluate(element => element.hidden), true)
  assert.equal(await page.evaluate(() => window.testAdminDialog), 'เปิดหน้าผู้ดูแลไม่ได้')
  await page.close()
}

async function runProgressiveStartupViewport(browser, baseUrl, viewport) {
  for (const scenario of [
    { path: 'index.html', slow: '/api/daily-checkin' },
    { path: 'all-rewards.html', slow: '/api/get-score' },
    { path: 'admin.html', slow: 'safety_pulse' }
  ]) {
    const page = await browser.newPage({ viewport, hasTouch: viewport.width < 500 })
    let releaseSlowResponse
    const slowResponse = new Promise(resolve => { releaseSlowResponse = resolve })
    const requests = []
    try {
      await page.addInitScript(() => {
        sessionStorage.setItem('RP_ADMIN_ACTIVE_TAB', '#pills-safety')
        window.bootstrap = {
          Tab: { getOrCreateInstance: button => ({ show: () => button.dispatchEvent(new Event('shown.bs.tab')) }) },
          Modal: {
            getOrCreateInstance: element => ({ show: () => element.classList.add('show') }),
            getInstance: element => ({ hide: () => element.classList.remove('show') })
          }
        }
        window.Swal = { fire: async config => config.title?.startsWith('แลกสำเร็จ') ? new Promise(() => {}) : { isConfirmed: true } }
      })
      await page.route('https://static.line-scdn.net/**', route => route.fulfill({
        contentType: 'text/javascript',
        body: `window.liff={init:async()=>{},isLoggedIn:()=>true,getProfile:async()=>({userId:'U_STARTUP_TEST',displayName:'Startup Test'}),getAccessToken:()=> 'test-token'};`
      }))
      for (const domain of ['cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'fonts.googleapis.com', 'unpkg.com']) {
        await page.route(`https://${domain}/**`, route => route.abort())
      }
      await page.route('**/api/**', async route => {
        const { pathname, searchParams } = new URL(route.request().url())
        const action = searchParams.get('action')
        const key = action || pathname
        requests.push(key)
        if (key === scenario.slow) await slowResponse
        if (pathname === '/api/get-score') {
          assert.equal(searchParams.get('includeRewards'), '0')
          return route.fulfill({ json: { status: 'success', data: { score: 100 } } })
        }
        if (pathname === '/api/admin-actions' && !action) {
          return route.fulfill({ json: { isAdmin: true, role: 'super_admin' } })
        }
        if (pathname === '/api/rewards' && !action) {
          return route.fulfill({ json: { status: 'success', items: [
            { id: 'startup-reward', cost: 100, stock: 2, name: 'รางวัลทดสอบ' },
            { id: 'expensive', cost: 135, stock: 1, name: 'รางวัลคะแนนสูง' },
            { id: 'sold-out', cost: 20, stock: 0, name: 'รางวัลที่หมด' }
          ] } })
        }
        if (pathname === '/api/spend' && route.request().method() === 'POST') {
          assert.equal(route.request().postDataJSON().rewardId, 'startup-reward')
          return route.fulfill({ json: { status: 'success', balance: 0, redemption: { id: 'startup-redemption' } } })
        }
        return route.fulfill({ json: { status: 'success', data: [], items: [] } })
      })

      const requested = page.waitForRequest(request => {
        const url = new URL(request.url())
        return (url.searchParams.get('action') || url.pathname) === scenario.slow
      })
      const started = performance.now()
      await page.goto(`${baseUrl}/${scenario.path}`, { waitUntil: 'domcontentloaded' })
      await requested
      await page.locator('#systemBootOverlay').waitFor({ state: 'hidden', timeout: 5000 })
      console.log(`startup ${scenario.path} ${viewport.width}px: ${Math.round(performance.now() - started)} ms while ${scenario.slow} was held`)
      if (scenario.path === 'index.html') {
        assert.equal(await page.evaluate(() => window.__userBalance), 100)
        assert.equal(requests.filter(request => request === '/api/get-score').length, 1)
        assert.equal(await page.getByRole('link', { name: 'แลกได้ตอนนี้' }).getAttribute('href'), '/all-rewards.html?filter=affordable')
        const expensive = page.locator('.rp-reward-card[data-id="expensive"]')
        await expensive.waitFor({ state: 'visible' })
        assert.match(await expensive.textContent(), /ขาดอีก 35 คะแนน/)
      } else if (scenario.path === 'all-rewards.html') {
        const rewardButton = page.locator('[data-reward-id="startup-reward"] button')
        const affordable = page.getByRole('button', { name: 'แลกได้ตอนนี้' })
        const all = page.getByRole('button', { name: 'ทั้งหมด', exact: true })
        await rewardButton.waitFor({ state: 'visible' })
        assert.ok(await rewardButton.isDisabled())
        if (viewport.width < 500) await affordable.tap()
        else await affordable.click()
        assert.equal(await page.locator('#rewardWalletBalance').textContent(), '—')
        assert.equal(await page.locator('#rewardGrid .reward-card').count(), 0)
        assert.match(await page.locator('#rewardGrid').textContent(), /เมื่อตรวจคะแนนสำเร็จ/)
        releaseSlowResponse()
        await rewardButton.waitFor({ state: 'visible' })
        assert.ok(await rewardButton.isEnabled())
        assert.equal(await page.locator('#rewardGrid .reward-card').count(), 1)
        assert.equal(await page.locator('#rewardWalletBalance').textContent(), '100')
        assert.equal(await affordable.getAttribute('aria-pressed'), 'true')
        await all.click()
        assert.equal(await page.locator('#rewardGrid .reward-card').count(), 3)
        assert.equal(await page.locator('[data-reward-id="sold-out"] .rp-status').textContent(), 'หมดแล้ว')
        assert.equal(await page.locator('[data-reward-id="startup-reward"] .reward-cost').textContent(), '100 คะแนน')
        assert.ok(await page.getByRole('button', { name: 'ขาดอีก 35 คะแนน' }).isDisabled())
        await page.locator('[data-reward-id="expensive"] .reward-name').click()
        assert.equal(await page.locator('#rewardPreviewRedeemBtn').textContent(), 'ขาดอีก 35 คะแนน')
        assert.ok(await page.locator('#rewardPreviewRedeemBtn').isDisabled())
        await page.evaluate(() => window.bootstrap.Modal.getInstance(document.getElementById('rewardPreviewModal')).hide())
        await affordable.click()
        await rewardButton.click()
        await page.waitForFunction(() => document.querySelector('#rewardWalletBalance').textContent === '0')
        assert.equal(await page.locator('#rewardGrid .reward-card').count(), 0)
        assert.match(await page.locator('#rewardGrid').textContent(), /ยังไม่มีของรางวัลที่แลกได้/)
      } else {
        assert.ok(await page.locator('#adminContent').evaluate(element => !element.hidden))
        assert.ok(!requests.includes('safety_questions') && !requests.includes('safety_settings'))
        await Promise.all([
          page.waitForRequest(request => new URL(request.url()).searchParams.get('action') === 'safety_questions'),
          page.locator('#tabSafetyQuestionsSubBtn').dispatchEvent('shown.bs.tab')
        ])
      }
    } finally {
      releaseSlowResponse()
      await page.close()
    }
  }
}

;(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const baseUrl = `http://127.0.0.1:${address.port}`
  const browser = await chromium.launch({ executablePath, headless: true })
  try {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      await runViewport(browser, baseUrl, viewport)
      await runMemberCheckinViewport(browser, baseUrl, viewport)
      await runRedemptionReplay(browser, baseUrl, viewport, 'index.html')
      await runRedemptionReplay(browser, baseUrl, viewport, 'all-rewards.html')
      await runPickupTracking(browser, baseUrl, viewport)
      await runAdminViewport(browser, baseUrl, viewport)
      await runProgressiveStartupViewport(browser, baseUrl, viewport)
    }
    console.log('✓ browser responsive/XSS, สิทธิ์ผู้ดูแล และกู้คืนคะแนนเช็กอิน: desktop 1440x900 และ mobile 390x844 ผ่าน')
  } finally {
    await browser.close()
    await new Promise(resolve => server.close(resolve))
  }
})().catch(error => {
  console.error(error)
  process.exitCode = 1
})
