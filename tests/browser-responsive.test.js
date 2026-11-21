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
  const relative = pathname === '/' ? 'all-rewards.html' : pathname.replace(/^\/+/, '')
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
      window.testRedemptionDialog = [typeof title === 'string' ? title : title.title, text]
      return { isConfirmed: true }
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

  await page.goto(`${baseUrl}/${pathName}`)
  await page.locator('#systemBootOverlay').waitFor({ state: 'hidden' })
  const redeem = page.getByRole('button', { name: /^แลก( รางวัลทดสอบ|รางวัล)$/ })
  if (viewport.width < 500) await redeem.tap()
  else await redeem.click()
  await page.waitForFunction(() => window.testRedemptionDialog?.[0] === 'ผิดพลาด')
  await page.reload()
  await page.locator('#systemBootOverlay').waitFor({ state: 'hidden' })
  const retry = page.getByRole('button', { name: /^ตรวจรายการเดิม/ })
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

async function runAdminViewport(browser, baseUrl, viewport) {
  const page = await browser.newPage({ viewport, hasTouch: viewport.width < 500 })
  await page.addInitScript(() => {
    window.bootstrap = {
      Tab: { getOrCreateInstance: button => ({ show: () => button.dispatchEvent(new Event('shown.bs.tab')) }) },
      Modal: class { show() {} }
    }
    window.Swal = { fire: async title => { window.testAdminDialog = title; return { isConfirmed: true } } }
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
  let memberScore = 100
  let couponBatch = null
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
    await route.fulfill({ json: { status: 'success', data: [{ uid: 'U_MEMBER', name: 'สมาชิกทดสอบ', tel: '0800000000', score: memberScore }] } })
  })
  await page.route('**/api/admin-actions?**', async route => {
    assert.equal(route.request().headers().authorization, 'Bearer admin-test-token')
    const params = new URL(route.request().url()).searchParams
    const action = params.get('action')
    if (action === 'line_notifications' && params.get('kind') === 'birthday_reward') {
      return route.fulfill({ json: { status: 'success', data: [{
        id: 'birthday-test-id', dedupe_key: 'birthday-reward:test', message_kind: 'birthday_reward', status: birthdayStatus
      }] } })
    }
    await route.fulfill({ json: action ? { status: 'success', data: [] } : { isAdmin: Boolean(role), role } })
  })
  await page.route('**/api/admin-actions', async route => {
    assert.equal(route.request().headers().authorization, 'Bearer admin-test-token')
    const { action, notificationId, targetUid, checkinDate } = route.request().postDataJSON()
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
  await page.locator('#lineNotificationKind').selectOption('birthday_reward')
  const birthdayList = page.locator('#lineNotificationList')
  await birthdayList.getByText('คะแนนวันเกิด', { exact: true }).waitFor()
  const sendBirthday = birthdayList.getByRole('button', { name: 'ส่งตอนนี้' })
  if (viewport.width < 500) await sendBirthday.tap()
  else await sendBirthday.click()
  await birthdayList.getByText('ส่งแล้ว', { exact: true }).waitFor()

  await page.evaluate(async () => { await window.loadPageUsers(); window.openActionModal('U_MEMBER') })
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

  role = 'safety_viewer'
  await page.goto(deepLink)
  assert.equal(await page.evaluate(() => window.RoyalAdminReady()), true)
  assert.equal(await page.evaluate(() => window.RoyalAdminInitialTabReady()), '#pills-safety')

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
    const page = await browser.newPage({ viewport })
    let releaseSlowResponse
    const slowResponse = new Promise(resolve => { releaseSlowResponse = resolve })
    const requests = []
    try {
      await page.addInitScript(() => {
        sessionStorage.setItem('RP_ADMIN_ACTIVE_TAB', '#pills-safety')
        window.bootstrap = { Tab: { getOrCreateInstance: button => ({ show: () => button.dispatchEvent(new Event('shown.bs.tab')) }) } }
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
          return route.fulfill({ json: { status: 'success', items: [{ id: 'startup-reward', cost: 20, stock: 1, name: 'รางวัลทดสอบ' }] } })
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
      } else if (scenario.path === 'all-rewards.html') {
        const rewardButton = page.locator('#rewardGrid .reward-card button')
        await rewardButton.waitFor({ state: 'visible' })
        assert.ok(await rewardButton.isDisabled())
        releaseSlowResponse()
        await page.waitForFunction(() => !document.querySelector('#rewardGrid .reward-card button')?.disabled)
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
