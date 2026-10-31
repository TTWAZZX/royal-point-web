const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

function createContext(options = {}) {
  const calls = []
  const swalCalls = []
  const responses = [...(options.responses || [])]
  const swalResults = [...(options.swalResults || [])]
  const navigation = { reloads: 0, replacements: [] }
  const sessionValues = new Map()
  const storage = {
    getItem: key => sessionValues.get(key) || null,
    setItem: (key, value) => sessionValues.set(key, String(value)),
    removeItem: key => sessionValues.delete(key)
  }
  const window = {
    location: {
      href: options.href || 'https://royal.example/index.html',
      pathname: '/index.html',
      origin: 'https://royal.example',
      reload: () => { navigation.reloads += 1 },
      replace: value => { navigation.replacements.push(value) }
    },
    history: { replaceState: (_state, _title, value) => { window.location.href = String(value) } },
    sessionStorage: storage,
    localStorage: storage,
    liff: {
      isLoggedIn: () => true,
      getAccessToken: () => 'line-access-token'
    },
    fetch: async (input, init) => {
      calls.push({ input, init })
      const next = responses.length ? responses.shift() : { status: 200, payload: { status: 'success' } }
      if (next.error) throw next.error
      return {
        ok: next.status >= 200 && next.status < 300,
        status: next.status,
        json: async () => next.payload,
        clone() {
          return { json: async () => next.payload }
        }
      }
    }
  }
  if (options.withSwal) {
    window.Swal = {
      fire: async config => {
        swalCalls.push(config)
        return swalResults.length ? swalResults.shift() : { isConfirmed:false, isDenied:false, isDismissed:false }
      }
    }
  }
  const context = vm.createContext({
    window,
    document: { querySelector: () => null, body: { style: {} } },
    URL,
    Headers,
    Request,
    console,
    setInterval,
    clearInterval,
    setTimeout: options.immediateTimers ? (fn => { fn(); return 0 }) : setTimeout,
    clearTimeout
  })
  vm.runInContext(fs.readFileSync(require.resolve('../loader.js'), 'utf8'), context)
  return { window, calls, navigation, swalCalls }
}

test('adds the LIFF bearer token to same-origin API requests', async () => {
  const { window, calls } = createContext()
  await window.fetch('/api/get-score?uid=U-user-1', { headers: { Accept: 'application/json' } })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].init.headers.get('Authorization'), 'Bearer line-access-token')
  assert.equal(calls[0].init.headers.get('X-Royal-Client'), 'line-token-v1')
  assert.equal(calls[0].init.headers.get('Accept'), 'application/json')
})

test('does not send the LINE token to third-party URLs', async () => {
  const { window, calls } = createContext()
  await window.fetch('https://cdn.example/image.png')

  assert.equal(calls.length, 1)
  assert.equal(new Headers(calls[0].init?.headers || {}).has('Authorization'), false)
})

test('manual recovery mode intentionally omits the bearer token', async () => {
  const { window, calls } = createContext()
  window.RoyalAuth.enableRecoveryMode(30)
  await window.fetch('/api/get-score?uid=U-user-1')

  assert.equal(calls.length, 1)
  assert.equal(calls[0].init.headers.has('Authorization'), false)
  assert.equal(window.RoyalAuth.isRecoveryMode(), true)
})

test('retries a temporary LINE provider failure twice before showing help', async () => {
  const failure = { status: 503, payload: { status:'error', code:'AUTH_PROVIDER_UNAVAILABLE' } }
  const { window, calls, swalCalls } = createContext({
    responses: [failure, failure, failure],
    withSwal: true,
    immediateTimers: true
  })
  await window.fetch('/api/get-score?uid=U-user-1')
  await Promise.resolve()

  assert.equal(calls.length, 3)
  assert.equal(swalCalls[0].confirmButtonText, 'ลองอีกครั้ง')
  assert.equal(swalCalls[0].denyButtonText, 'เข้าสู่ระบบ LINE ใหม่')
  assert.equal(swalCalls[0].cancelButtonText, 'ติดต่อผู้ดูแล')
})

test('does not retry an ambiguous POST network failure', async () => {
  const { window, calls } = createContext({ responses: [{ error: new Error('network down') }], immediateTimers: true })
  await assert.rejects(
    window.fetch('/api/spend', { method:'POST', body:JSON.stringify({ uid:'U-user-1', rewardId:'R1' }) }),
    /network down/
  )
  assert.equal(calls.length, 1)
})

test('shows the dedicated upgrade and migration actions', async () => {
  const { window, swalCalls } = createContext({
    responses: [
      { status:401, payload:{ code:'AUTH_UPGRADE_REQUIRED' } },
      { status:503, payload:{ code:'AUTH_MIGRATION_NOT_READY' } }
    ],
    withSwal: true
  })

  await window.fetch('/api/get-score?uid=U-user-1')
  await Promise.resolve()
  await window.fetch('/api/get-score?uid=U-user-1')
  await Promise.resolve()

  assert.equal(swalCalls[0].confirmButtonText, 'โหลดระบบเวอร์ชันใหม่')
  assert.equal(swalCalls[1].confirmButtonText, 'ลองใหม่ภายหลัง')
  assert.equal(swalCalls[1].showDenyButton, false)
})

test('submits an authentication help case from the user dialog', async () => {
  const { window, calls, swalCalls } = createContext({
    responses: [
      { status:401, payload:{ code:'AUTH_TOKEN_INVALID' } },
      { status:200, payload:{ status:'success', data:{ caseNo:'HELP-000123', lineNotification:'sent' } } }
    ],
    withSwal: true,
    swalResults: [
      { isConfirmed:false, isDenied:false, isDismissed:true },
      { isConfirmed:true, isDenied:false, isDismissed:false }
    ]
  })
  window.sessionStorage.setItem('uid', 'U-user-1')

  await window.fetch('/api/get-score?uid=U-user-1')
  for (let attempt = 0; attempt < 10 && calls.length < 2; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 5))
  }

  assert.equal(calls.length, 2)
  assert.equal(calls[1].input, '/api/auth-help')
  assert.match(String(calls[1].init.body), /"action":"request"/)
  assert.ok(swalCalls.some(call => call.confirmButtonText === 'ส่งคำขอช่วยเหลือ'))
  assert.ok(swalCalls.some(call => String(call.html || '').includes('HELP-000123')))
})

test('consumes a one-time recovery link before the app starts', async () => {
  const { window, calls } = createContext({
    href: 'https://royal.example/index.html?recovery_ticket=one-time-secret-ticket-1234567890',
    responses: [
      {
        status:200,
        payload:{
          status:'success',
          data:{ uid:'U-user-1', caseId:7, caseNo:'HELP-000007', recoveryUntil:new Date(Date.now() + 30 * 60 * 1000).toISOString() }
        }
      },
      { status:200, payload:{ status:'success' } },
      { status:200, payload:{ status:'success' } }
    ]
  })

  await window.RoyalAuth.ready
  assert.equal(window.RoyalAuth.isRecoveryMode(), true)
  assert.equal(window.sessionStorage.getItem('uid'), 'U-user-1')
  assert.equal(window.location.href.includes('recovery_ticket='), false)

  await window.fetch('/api/get-score?uid=U-user-1')
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(calls.length, 3)
  assert.equal(calls[1].init.headers.get('X-Royal-Recovery'), 'one-time-secret-ticket-1234567890')
  assert.match(String(calls[2].init.body), /"action":"complete"/)
})
