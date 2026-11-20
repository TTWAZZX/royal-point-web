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

;(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const baseUrl = `http://127.0.0.1:${address.port}`
  const browser = await chromium.launch({ executablePath, headless: true })
  try {
    await runViewport(browser, baseUrl, { width: 1440, height: 900 })
    await runViewport(browser, baseUrl, { width: 390, height: 844 })
    console.log('✓ browser responsive/XSS: desktop 1440x900 และ mobile 390x844 ผ่าน')
  } finally {
    await browser.close()
    await new Promise(resolve => server.close(resolve))
  }
})().catch(error => {
  console.error(error)
  process.exitCode = 1
})
