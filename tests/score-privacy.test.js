const assert = require('node:assert/strict')
const test = require('node:test')

process.env.SUPABASE_URL = 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key'

const supabasePath = require.resolve('../lib/supabase')
const authPath = require.resolve('../lib/line-auth')
const { scoreCacheKey, clearScoreCache } = require(supabasePath)

function registerMock(path, exports) {
  require.cache[path] = { id: path, filename: path, loaded: true, exports }
}

test('score joins balance in one lookup and computes opt-in admin visibility outside the cache', async (t) => {
  const uid = 'U-test'
  const privateUser = { id: 'internal-id', name: 'สมาชิกทดสอบ', tel: 'test-phone', passport: 'test-passport', dob: 'test-dob' }
  const cached = new Map([[`score_v2:${uid}`, { user: privateUser, balance: 999 }]])
  const reads = []
  const selections = []
  const redis = {
    async get(key) { reads.push(key); return cached.get(key) },
    async set(key, value, options) { assert.equal(options.ex, 30); cached.set(key, value) }
  }
  let userResult = { data: { ...privateUser, user_points: { balance: 75, updated_at: '2026-11-21T02:00:00Z' } } }
  registerMock(supabasePath, {
    supabaseAdmin: {
      from(table) {
        const builder = {
          select(fields) { selections.push([table, fields]); return builder },
          eq() { return builder },
          maybeSingle: async () => userResult,
          order(field) { return field === 'id' ? Promise.resolve({ data: [{ id: 'reward-1', cost: 20, active: true }] }) : builder }
        }
        return builder
      }
    },
    getRedis: () => redis,
    scoreCacheKey
  })
  const authCalls = []
  let mode = 'legacy'
  registerMock(authPath, {
    AuthError: class extends Error {},
    async authenticateRequest(_req, options) { authCalls.push(options); return { mode, uid } }
  })
  const handler = require('../api/get-score')
  async function readScore(query = {}) {
    const result = { headers: {} }
    const res = {
      setHeader(key, value) { result.headers[key] = value },
      status(code) { result.statusCode = code; return this },
      json(body) { result.body = body; return this }
    }
    await handler({ method: 'GET', query: { uid, ...query } }, res)
    return result
  }

  const fromDatabase = await readScore()
  assert.equal(fromDatabase.statusCode, 200)
  assert.equal(fromDatabase.headers['Cache-Control'], 'private, no-store')
  assert.deepEqual(selections[0], ['users', 'user_points(balance,updated_at)'])
  assert.deepEqual(Object.keys(fromDatabase.body.data).sort(), ['rewards', 'score', 'updated_at'])
  assert.equal(fromDatabase.body.data.score, 75)
  assert.deepEqual(reads, [`score_v3:${uid}`])
  assert.deepEqual(Object.keys(cached.get(scoreCacheKey(uid))).sort(), ['balance', 'rewards', 'updated_at'])

  cached.get(scoreCacheKey(uid)).user = privateUser
  const fromCache = await readScore()
  assert.deepEqual(fromCache, fromDatabase)
  assert.deepEqual(authCalls, [{ claimedUid: uid }, { claimedUid: uid }])

  selections.length = 0
  const scoreOnly = await readScore({ includeRewards: '0' })
  assert.equal(scoreOnly.body.data.score, 75)
  assert.deepEqual(scoreOnly.body.data.rewards, [])
  assert.deepEqual(selections.map(([table]) => table), ['users'])
  assert.ok(cached.has(scoreCacheKey(uid, false)))

  const staleScore = { data: { balance: 42, updated_at: null } }
  cached.set(scoreCacheKey(uid, false), staleScore.data)
  const previousCacheReads = reads.length
  const fresh = await readScore({ includeRewards: '0', fresh: '1' })
  assert.equal(fresh.body.data.score, 75)
  assert.equal(fresh.headers['Cache-Control'], 'private, no-store')
  assert.equal(reads.length, previousCacheReads)
  assert.equal(cached.get(scoreCacheKey(uid, false)), staleScore.data)
  assert.deepEqual(authCalls.at(-1), { claimedUid: uid })

  const setEnv = (name, value) => {
    const previous = process.env[name]
    t.after(() => {
      if (previous === undefined) delete process.env[name]
      else process.env[name] = previous
    })
    process.env[name] = value
  }
  setEnv('ADMIN_UID', uid)
  setEnv('SAFETY_ADMIN_UIDS', '')
  setEnv('SAFETY_VIEWER_UIDS', '')
  const roleQuery = { includeRewards: '0', includeAdmin: '1' }
  mode = 'ticket-recovery'
  assert.equal((await readScore(roleQuery)).body.isAdmin, false)
  mode = 'legacy'
  assert.equal((await readScore(roleQuery)).body.isAdmin, false)
  mode = 'token'
  assert.equal((await readScore(roleQuery)).body.isAdmin, true)
  process.env.ADMIN_UID = 'U-other'
  assert.equal((await readScore(roleQuery)).body.isAdmin, false)
  process.env.SAFETY_ADMIN_UIDS = uid
  assert.equal((await readScore(roleQuery)).body.isAdmin, true)
  process.env.SAFETY_ADMIN_UIDS = ''
  process.env.SAFETY_VIEWER_UIDS = uid
  assert.equal((await readScore(roleQuery)).body.isAdmin, true)
  assert.equal((await readScore({ includeRewards: '0' })).body.isAdmin, undefined)
  assert.equal(cached.get(scoreCacheKey(uid, false)).isAdmin, undefined)

  userResult = { data: { user_points: [] } }
  assert.equal((await readScore({ includeRewards: '0', fresh: '1' })).body.data.score, 0)
  userResult = { data: { user_points: [{ balance: 13 }] } }
  assert.equal((await readScore({ includeRewards: '0', fresh: '1' })).body.data.score, 13)

  cached.delete(scoreCacheKey(uid))
  userResult = { data: null }
  assert.equal((await readScore()).statusCode, 404)
})

test('point changes invalidate both score cache versions even when an individual deletion fails', async () => {
  const deleted = []
  await clearScoreCache({ async del(key) {
    deleted.push(key)
    if (key === 'score_v3:U-test') throw new Error('temporary cache error')
  } }, 'U-test')
  assert.deepEqual(deleted.sort(), ['score:U-test', 'score_v2:U-test', 'score_v3:U-test', 'score_only_v3:U-test'].sort())
})
