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

test('score responses and cache writes omit member data and skip caches from the old deployment', async () => {
  const uid = 'U-test'
  const privateUser = { id: 'internal-id', name: 'สมาชิกทดสอบ', tel: 'test-phone', passport: 'test-passport', dob: 'test-dob' }
  const cached = new Map([[`score_v2:${uid}`, { user: privateUser, balance: 999 }]])
  const reads = []
  const selections = []
  const redis = {
    async get(key) { reads.push(key); return cached.get(key) },
    async set(key, value, options) { assert.equal(options.ex, 30); cached.set(key, value) }
  }
  let userResult = { data: privateUser }
  registerMock(supabasePath, {
    supabaseAdmin: {
      from(table) {
        const builder = {
          select(fields) { selections.push([table, fields]); return builder },
          eq() { return builder },
          maybeSingle: async () => userResult,
          single: async () => ({ data: { balance: 75, updated_at: '2026-11-21T02:00:00Z' } }),
          order(field) { return field === 'id' ? Promise.resolve({ data: [{ id: 'reward-1', cost: 20, active: true }] }) : builder }
        }
        return builder
      }
    },
    getRedis: () => redis,
    scoreCacheKey
  })
  const authCalls = []
  registerMock(authPath, {
    AuthError: class extends Error {},
    async authenticateRequest(_req, options) { authCalls.push(options); return { mode: 'legacy', uid } }
  })
  const handler = require('../api/get-score')
  async function readScore() {
    const result = { headers: {} }
    const res = {
      setHeader(key, value) { result.headers[key] = value },
      status(code) { result.statusCode = code; return this },
      json(body) { result.body = body; return this }
    }
    await handler({ method: 'GET', query: { uid } }, res)
    return result
  }

  const fromDatabase = await readScore()
  assert.equal(fromDatabase.statusCode, 200)
  assert.equal(fromDatabase.headers['Cache-Control'], 'private, no-store')
  assert.deepEqual(selections[0], ['users', 'id'])
  assert.deepEqual(Object.keys(fromDatabase.body.data).sort(), ['rewards', 'score', 'updated_at'])
  assert.equal(fromDatabase.body.data.score, 75)
  assert.deepEqual(reads, [`score_v3:${uid}`])
  assert.deepEqual(Object.keys(cached.get(scoreCacheKey(uid))).sort(), ['balance', 'rewards', 'updated_at'])

  cached.get(scoreCacheKey(uid)).user = privateUser
  const fromCache = await readScore()
  assert.deepEqual(fromCache, fromDatabase)
  assert.deepEqual(authCalls, [{ claimedUid: uid }, { claimedUid: uid }])

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
  assert.deepEqual(deleted.sort(), ['score:U-test', 'score_v2:U-test', 'score_v3:U-test'].sort())
})
