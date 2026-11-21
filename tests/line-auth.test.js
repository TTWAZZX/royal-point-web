const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const test = require('node:test')

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key'
process.env.LINE_LOGIN_CHANNEL_ID = '2007053300'

const migrations = new Map()
const recoveryTickets = []
const helpCases = []
const supabasePath = require.resolve('../lib/supabase')
require.cache[supabasePath] = {
  id: supabasePath,
  filename: supabasePath,
  loaded: true,
  exports: {
    getRedis: () => null,
    clearScoreCache: async () => {},
    supabaseAdmin: {
      async rpc() { throw new Error('Unexpected RPC call') },
      from(table) {
        if (table === 'audit_logs') {
          return { async insert() { return { error: null } } }
        }
        if (table === 'auth_help_cases') {
          return {
            update(changes) {
              const filters = {}
              let statuses = []
              const builder = {
                eq(field, value) { filters[field] = value; return builder },
                in(field, values) { if (field === 'status') statuses = values; return builder },
                select() { return builder },
                async maybeSingle() {
                  const row = helpCases.find(item => Object.entries(filters).every(([key, value]) => item[key] === value) && statuses.includes(item.status)) || null
                  if (row) Object.assign(row, changes)
                  return { data: row ? { id: row.id, case_no: row.case_no } : null, error: null }
                }
              }
              return builder
            }
          }
        }
        if (table === 'auth_recovery_tickets') {
          return {
            select() {
              const filters = {}
              const builder = {
                eq(field, value) { filters[field] = value; return builder },
                not() { return builder },
                async maybeSingle() {
                  const data = recoveryTickets.find(row => Object.entries(filters).every(([key, value]) => row[key] === value) && row.consumed_at) || null
                  return { data, error: null }
                }
              }
              return builder
            }
          }
        }
        assert.equal(table, 'user_auth_migrations')
        return {
          async upsert(row) {
            migrations.set(row.uid, { ...migrations.get(row.uid), ...row })
            return { error: null }
          },
          select() {
            return {
              eq(_field, uid) {
                return {
                  async maybeSingle() {
                    return { data: migrations.get(uid) || null, error: null }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}

const {
  AuthError,
  authenticateRequest
} = require('../lib/line-auth')

function request(token = '') {
  return { headers: token ? { authorization: `Bearer ${token}` } : {} }
}

function mockLine({ uid = 'U-user-1', channelId = '2007053300', valid = true } = {}) {
  global.fetch = async (url) => {
    if (String(url).includes('/oauth2/v2.1/verify')) {
      return new Response(JSON.stringify(valid
        ? { client_id: channelId, expires_in: 3600, scope: 'profile' }
        : { error: 'invalid_request' }), {
        status: valid ? 200 : 400,
        headers: { 'Content-Type': 'application/json' }
      })
    }
    if (String(url).includes('/v2/profile')) {
      return new Response(JSON.stringify({ userId: uid, displayName: 'Test User' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    }
    throw new Error(`Unexpected URL: ${url}`)
  }
}

test.beforeEach(() => {
  migrations.clear()
  recoveryTickets.length = 0
  helpCases.length = 0
  mockLine()
})

test('allows a legacy user until their first verified visit', async () => {
  const auth = await authenticateRequest(request(), { claimedUid: 'U-user-1' })
  assert.deepEqual(auth, { uid: 'U-user-1', mode: 'legacy', migrated: false })
})

test('spend rejects invalid or conflicting request IDs and returns a matching replay', async (t) => {
  const { supabaseAdmin } = require('../lib/supabase')
  const rpc = t.mock.method(supabaseAdmin, 'rpc', async () => ({
    error: { message: 'REQUEST_ID_CONFLICT' }
  }))
  const spend = require('../api/spend')
  const rewardId = '20000000-0000-4000-8000-000000000001'
  const requestId = '30000000-0000-4000-8000-000000000001'
  async function submit(id) {
    const result = { statusCode: 200, headers: {} }
    const res = {
      setHeader(name, value) { result.headers[name] = value },
      status(code) { result.statusCode = code; return this },
      json(payload) { result.payload = payload; return this }
    }
    await spend({ method: 'POST', headers: {}, body: { uid: 'U-user-1', rewardId, requestId: id } }, res)
    return result
  }

  const invalid = await submit('invalid')
  assert.equal(invalid.statusCode, 400)
  assert.equal(rpc.mock.callCount(), 0)
  const conflict = await submit(requestId)
  assert.equal(conflict.statusCode, 409)
  assert.equal(conflict.payload.message, 'request_id_conflict')
  assert.ok(conflict.payload.correlationId)
  assert.equal(conflict.payload.redemption, undefined)
  assert.equal(rpc.mock.calls[0].arguments[1].p_request_id, requestId)

  rpc.mock.mockImplementation(async () => ({ data: [{
    redemption_id: '40000000-0000-4000-8000-000000000001', spent: 30, balance: 70,
    redemption_status: 'cancelled_refunded', was_duplicate: true
  }] }))
  const replay = await submit(requestId)
  assert.equal(replay.statusCode, 200)
  assert.equal(replay.headers['Cache-Control'], 'private, no-store')
  assert.equal(replay.payload.duplicate, true)
  assert.equal(replay.payload.redemption.status, 'cancelled_refunded')
  assert.equal(replay.payload.lineNotification.status, 'not_needed')
})

test('pickup evidence lookup by request is read-only and scoped to the member and reward', async (t) => {
  const { supabaseAdmin } = require('../lib/supabase')
  const originalFrom = supabaseAdmin.from.bind(supabaseAdmin)
  const filters = {}
  t.mock.method(supabaseAdmin, 'from', table => {
    if (table !== 'redemptions') return originalFrom(table)
    const read = {
      select() { return read },
      eq(key, value) { filters[key] = value; return read },
      async maybeSingle() { return { data: { id: 'evidence-id', status: 'approved', cost: 10 } } }
    }
    return read
  })
  const result = {}
  const res = {
    setHeader() {},
    status(code) { result.code = code; return this },
    json(body) { result.body = body; return this }
  }
  const requestId = '30000000-0000-4000-8000-000000000001'
  const rewardId = '20000000-0000-4000-8000-000000000001'
  const spend = require('../api/spend')
  await spend({ method: 'GET', headers: {}, query: { uid: 'U-user-1', requestId, rewardId } }, res)
  assert.equal(result.code, 200)
  assert.equal(result.body.data.id, 'evidence-id')
  assert.deepEqual(filters, { 'users.uid': 'U-user-1', request_id: requestId, reward_id: rewardId })
})

test('privileged routes require a LINE token and use the verified role', async () => {
  process.env.ADMIN_UID = 'U-admin'
  process.env.SAFETY_VIEWER_UIDS = 'U-safety-viewer'
  const adminActions = require('../api/admin-actions')
  const routes = [
    [adminActions, { adminUid: 'U-admin' }],
    [adminActions, { adminUid: 'U-admin', action: 'pending_work' }],
    [require('../api/admin-coupons'), { adminUid: 'U-admin' }],
    [require('../api/all-scores'), { adminUid: 'U-admin' }],
    [require('../api/rewards'), { include: '1' }]
  ]
  async function call(handler, query, token = '', method = 'GET', body) {
    const result = { statusCode: 200, headers: {} }
    const res = {
      setHeader(name, value) { result.headers[name] = value },
      status(code) { result.statusCode = code; return this },
      json(payload) { result.payload = payload; return this }
    }
    await handler({ ...request(token), method, query, body }, res)
    return result
  }

  for (const [handler, query] of routes) {
    const result = await call(handler, query)
    assert.equal(result.statusCode, 401)
    assert.equal(result.payload.code, 'AUTH_TOKEN_REQUIRED')
    assert.equal(result.headers['Cache-Control'], 'private, no-store')
  }
  const mismatch = await call(adminActions, { uid: 'U-admin' }, 'valid-token')
  assert.equal(mismatch.payload.code, 'AUTH_UID_MISMATCH')

  mockLine({ uid: 'U-admin' })
  const admin = await call(adminActions, { uid: 'U-admin' }, 'valid-token')
  assert.equal(admin.payload.role, 'super_admin')

  mockLine({ uid: 'U-safety-viewer' })
  const viewer = await call(adminActions, {}, 'valid-token')
  assert.equal(viewer.payload.role, 'safety_viewer')
  const blocked = await call(adminActions, {}, 'valid-token', 'POST', { action: 'safety_settings_update' })
  assert.equal(blocked.statusCode, 403)
  const blockedPending = await call(adminActions, { action: 'pending_work' }, 'valid-token')
  assert.equal(blockedPending.statusCode, 403)
})

test('pending work returns exact counts and isolates unavailable queues', async (t) => {
  const { supabaseAdmin } = require('../lib/supabase')
  process.env.ADMIN_UID = 'U-admin'
  mockLine({ uid: 'U-admin' })
  const expected = {
    redemptions: ['approved', 174],
    auth_help_cases: ['open', 0],
    line_notification_outbox: ['failed', 3],
    audit_failure_outbox: ['pending', null]
  }
  const seen = new Set()
  const originalFrom = supabaseAdmin.from
  t.mock.method(supabaseAdmin, 'from', table => {
    if (!(table in expected)) return originalFrom(table)
    return {
      ...(table === 'auth_help_cases' ? originalFrom(table) : {}),
      select(field, options) {
        assert.equal(field, 'id')
        assert.deepEqual(options, { count: 'exact', head: true })
        return {
          async eq(column, value) {
            const [status, count] = expected[table]
            assert.equal(column, 'status')
            assert.equal(value, status)
            seen.add(table)
            return { count, error: count === null ? new Error('unavailable') : null }
          }
        }
      }
    }
  })
  const result = { headers: {} }
  await require('../api/admin-actions')({ ...request('valid-token'), method: 'GET', query: { action: 'pending_work' } }, {
    setHeader(name, value) { result.headers[name] = value },
    status(code) { result.code = code; return this },
    json(payload) { result.payload = payload; return this }
  })
  assert.equal(seen.size, 4)
  assert.equal(result.code, 200)
  assert.equal(result.headers['Cache-Control'], 'private, no-store')
  assert.deepEqual(result.payload, { status: 'success', data: { pickup: 174, help: 0, line: 3, audit: null } })
})

test('coupon generation retries code collisions with the same request ID and returns the database batch', async (t) => {
  const { supabaseAdmin } = require('../lib/supabase')
  process.env.ADMIN_UID = 'U-admin'
  mockLine({ uid: 'U-admin' })
  const requestId = '30000000-0000-4000-8000-000000000001'
  const rpc = t.mock.method(supabaseAdmin, 'rpc', async () => ({ error: { code: '23505' } }))
  rpc.mock.mockImplementationOnce(async () => ({
    data: { request_id: requestId, coupon_count: 2, points: 100, codes: ['ABCDEF', 'GHJKLM'], repeated: true }
  }), 1)
  const handler = require('../api/admin-coupons')
  async function submit(id) {
    const result = { status: 200 }
    const res = {
      setHeader() {},
      status(code) { result.status = code; return this },
      json(payload) { result.payload = payload; return this }
    }
    await handler({ ...request('valid-token'), method: 'POST', query: { action: 'generate' }, body: { requestId: id, count: 2, points: 100 } }, res)
    return result
  }
  assert.equal((await submit('')).status, 400)
  assert.equal(rpc.mock.callCount(), 0)
  const replay = await submit(requestId)
  assert.equal(replay.status, 200)
  assert.equal(replay.payload.created, 2)
  assert.equal(replay.payload.data.repeated, true)
  assert.deepEqual(replay.payload.data.codes, ['ABCDEF', 'GHJKLM'])
  assert.equal(rpc.mock.callCount(), 2)
  for (const call of rpc.mock.calls) {
    assert.equal(call.arguments[0], 'generate_coupon_batch_once')
    assert.equal(call.arguments[1].p_request_id, requestId)
    assert.equal(call.arguments[1].p_admin_uid, 'U-admin')
  }
})

test('marks a verified UID and rejects later UID-only requests', async () => {
  const verified = await authenticateRequest(request('valid-token'), { claimedUid: 'U-user-1' })
  assert.equal(verified.mode, 'token')
  assert.equal(migrations.get('U-user-1').token_required, true)

  await assert.rejects(
    authenticateRequest(request(), { claimedUid: 'U-user-1' }),
    error => error instanceof AuthError && error.code === 'AUTH_UPGRADE_REQUIRED'
  )
})

test('allows legacy access only during an active admin recovery window', async () => {
  migrations.set('U-user-1', {
    uid: 'U-user-1',
    token_required: true,
    recovery_until: new Date(Date.now() + 30 * 60 * 1000).toISOString()
  })

  const auth = await authenticateRequest(request(), { claimedUid: 'U-user-1' })
  assert.equal(auth.mode, 'legacy-recovery')
  assert.equal(auth.migrated, true)
})

test('never grants admin endpoints through legacy recovery mode', async () => {
  migrations.set('U-admin', {
    uid: 'U-admin',
    token_required: true,
    recovery_until: new Date(Date.now() + 30 * 60 * 1000).toISOString()
  })

  await assert.rejects(
    authenticateRequest(request(), { claimedUid: 'U-admin', allowRecovery: false }),
    error => error instanceof AuthError && error.code === 'AUTH_UPGRADE_REQUIRED'
  )
})

test('requires the consumed one-time ticket for a case-linked recovery session', async () => {
  const ticket = 'one-time-secret-ticket-1234567890'
  const hash = crypto.createHash('sha256').update(ticket).digest('hex')
  migrations.set('U-user-1', {
    uid: 'U-user-1',
    token_required: true,
    recovery_until: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    recovery_case_id: 7
  })
  recoveryTickets.push({
    id: 'ticket-1',
    case_id: 7,
    target_uid: 'U-user-1',
    token_hash: hash,
    consumed_at: new Date().toISOString()
  })

  await assert.rejects(
    authenticateRequest(request(), { claimedUid: 'U-user-1' }),
    error => error instanceof AuthError && error.code === 'AUTH_RECOVERY_TICKET_REQUIRED'
  )

  const auth = await authenticateRequest({ headers:{ 'x-royal-recovery':ticket } }, { claimedUid:'U-user-1' })
  assert.equal(auth.mode, 'ticket-recovery')
  assert.equal(auth.recoveryCaseId, 7)
})

test('successful token verification closes an active recovery window', async () => {
  migrations.set('U-user-1', {
    uid: 'U-user-1',
    token_required: true,
    recovery_until: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    recovery_reason: 'test',
    recovery_by: 'U-admin'
  })

  await authenticateRequest(request('valid-token'), { claimedUid: 'U-user-1' })
  const state = migrations.get('U-user-1')
  assert.equal(state.recovery_until, null)
  assert.equal(state.recovery_reason, null)
  assert.equal(state.recovery_by, null)
})

test('successful LINE verification resolves the related help case', async () => {
  migrations.set('U-user-1', {
    uid: 'U-user-1',
    token_required: true,
    recovery_until: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    recovery_case_id: 12
  })
  helpCases.push({ id: 12, case_no: 'HELP-000012', target_uid: 'U-user-1', status: 'approved' })

  await authenticateRequest(request('valid-token'), { claimedUid: 'U-user-1' })

  assert.equal(helpCases[0].status, 'resolved')
  assert.ok(helpCases[0].resolved_at)
  assert.equal(migrations.get('U-user-1').recovery_case_id, null)
})

test('rejects a token whose LINE UID differs from the claimed UID', async () => {
  await assert.rejects(
    authenticateRequest(request('valid-token'), { claimedUid: 'U-someone-else' }),
    error => error instanceof AuthError && error.code === 'AUTH_UID_MISMATCH'
  )
  assert.equal(migrations.size, 0)
})

test('requires a token for new registration flows', async () => {
  await assert.rejects(
    authenticateRequest(request(), { claimedUid: 'U-new', requireToken: true }),
    error => error instanceof AuthError && error.code === 'AUTH_TOKEN_REQUIRED'
  )
})

test('rejects access tokens issued for another LINE channel', async () => {
  mockLine({ channelId: 'wrong-channel' })
  await assert.rejects(
    authenticateRequest(request('wrong-channel-token'), { claimedUid: 'U-user-1' }),
    error => error instanceof AuthError && error.code === 'AUTH_TOKEN_INVALID'
  )
})
