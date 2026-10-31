const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const test = require('node:test')

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key'
process.env.LINE_LOGIN_CHANNEL_ID = '2007053300'

const migrations = new Map()
const recoveryTickets = []
const supabasePath = require.resolve('../lib/supabase')
require.cache[supabasePath] = {
  id: supabasePath,
  filename: supabasePath,
  loaded: true,
  exports: {
    getRedis: () => null,
    supabaseAdmin: {
      from(table) {
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
  mockLine()
})

test('allows a legacy user until their first verified visit', async () => {
  const auth = await authenticateRequest(request(), { claimedUid: 'U-user-1' })
  assert.deepEqual(auth, { uid: 'U-user-1', mode: 'legacy', migrated: false })
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
