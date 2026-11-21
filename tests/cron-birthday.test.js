const assert = require('node:assert/strict')
const test = require('node:test')

test('birthday cron authorizes before accessing data and returns only an aggregate result', async (t) => {
  process.env.SUPABASE_URL = 'https://example.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key'
  const { supabaseAdmin } = require('../lib/supabase')
  const messaging = require('../lib/line-messaging')
  const audit = require('../lib/audit')
  const recordAudit = t.mock.method(audit, 'auditEvent', async () => ({ correlationId: 'test-correlation' }))
  const rpc = t.mock.method(supabaseAdmin, 'rpc', async () => ({
    data: {
      run_date: '2026-11-21', reward_count: 2, repeated: false,
      notifications: [{ id: 'notification-1', uid: 'member-1' }, { id: 'notification-2', uid: 'member-2' }]
    }
  }))
  const delivery = t.mock.method(messaging, 'retryLineNotification', async id => {
    if (id === 'notification-2') throw new Error('transport failure')
    return { status: 'sent' }
  })
  const log = t.mock.method(console, 'error', () => {})
  const handler = require('../api/cron-birthday')

  async function invoke({ method = 'GET', authorization } = {}) {
    const result = { headers: {}, status: 200 }
    const res = {
      setHeader(name, value) { result.headers[name] = value },
      status(code) { result.status = code; return this },
      json(body) { result.body = body; return this }
    }
    await handler({ method, headers: { authorization } }, res)
    return result
  }

  delete process.env.CRON_SECRET
  assert.equal((await invoke()).status, 503)
  process.env.CRON_SECRET = 'test-cron-secret'
  assert.equal((await invoke({ method: 'POST' })).status, 405)
  assert.equal((await invoke()).status, 401)
  assert.equal((await invoke({ authorization: 'Bearer test-cron-wrong!' })).status, 401)
  assert.equal(rpc.mock.callCount(), 0)
  assert.equal(delivery.mock.callCount(), 0)

  const authorized = { authorization: 'Bearer test-cron-secret' }
  const result = await invoke(authorized)
  assert.equal(result.headers['Cache-Control'], 'private, no-store')
  assert.deepEqual(result.body, { success: true, runDate: '2026-11-21', processed: 2, repeated: false, sent: 1, outstanding: 1 })
  assert.equal(rpc.mock.calls[0].arguments[0], 'process_birthday_rewards_once')
  assert.equal(rpc.mock.calls[0].arguments[1].p_amount, 100)
  assert.equal(recordAudit.mock.calls[0].arguments[1].status, 'warning')

  rpc.mock.mockImplementation(async () => ({ error: { code: 'TEST_DB_ERROR', message: 'private database details' } }))
  const failure = await invoke(authorized)
  assert.equal(failure.status, 500)
  assert.deepEqual(failure.body, { success: false, message: 'ประมวลผลคะแนนวันเกิดไม่สำเร็จ', correlationId: 'test-correlation' })
  assert.equal(recordAudit.mock.calls[1].arguments[1].type, 'birthday_reward_failed')
  assert.equal(log.mock.callCount(), 2)
})
