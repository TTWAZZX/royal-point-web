const crypto = require('crypto')
const { supabaseAdmin, getRedis } = require('./supabase')

const LINE_VERIFY_URL = 'https://api.line.me/oauth2/v2.1/verify'
const LINE_PROFILE_URL = 'https://api.line.me/v2/profile'
const DEFAULT_LINE_CHANNEL_ID = '2007053300'
const TOKEN_CACHE_SECONDS = 30
const redis = getRedis()

class AuthError extends Error {
  constructor(status, code, message = code) {
    super(message)
    this.name = 'AuthError'
    this.status = status
    this.code = code
  }
}

function getExpectedChannelId() {
  return String(process.env.LINE_LOGIN_CHANNEL_ID || DEFAULT_LINE_CHANNEL_ID).trim()
}

function getBearerToken(req) {
  const value = String(req?.headers?.authorization || req?.headers?.Authorization || '').trim()
  const match = value.match(/^Bearer\s+(.+)$/i)
  const token = match ? match[1].trim() : ''
  return token.length <= 4096 ? token : ''
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 6000)
  try {
    const response = await fetch(url, { ...options, signal: controller.signal })
    const data = await response.json().catch(() => ({}))
    return { response, data }
  } finally {
    clearTimeout(timeout)
  }
}

function tokenCacheKey(token) {
  return `line_auth_v1:${crypto.createHash('sha256').update(token).digest('hex')}`
}

async function readCachedIdentity(token) {
  if (!redis) return null
  try {
    const cached = await redis.get(tokenCacheKey(token))
    if (!cached || !cached.uid || cached.channelId !== getExpectedChannelId()) return null
    return cached
  } catch (_) {
    return null
  }
}

async function cacheIdentity(token, identity, expiresIn) {
  if (!redis) return
  const ttl = Math.max(1, Math.min(TOKEN_CACHE_SECONDS, Number(expiresIn) || TOKEN_CACHE_SECONDS))
  try {
    await redis.set(tokenCacheKey(token), identity, { ex: ttl })
  } catch (_) {}
}

async function verifyLineAccessToken(token) {
  if (!token) throw new AuthError(401, 'AUTH_TOKEN_REQUIRED')

  const cached = await readCachedIdentity(token)
  if (cached) return cached

  let verified
  let profile
  try {
    const verifyUrl = `${LINE_VERIFY_URL}?access_token=${encodeURIComponent(token)}`
    const verifyResult = await fetchJson(verifyUrl, { headers: { Accept: 'application/json' } })
    if (!verifyResult.response.ok) throw new AuthError(401, 'AUTH_TOKEN_INVALID')
    verified = verifyResult.data

    const expectedChannelId = getExpectedChannelId()
    if (String(verified.client_id || '') !== expectedChannelId || Number(verified.expires_in || 0) <= 0) {
      throw new AuthError(401, 'AUTH_TOKEN_INVALID')
    }

    const profileResult = await fetchJson(LINE_PROFILE_URL, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
    })
    if (!profileResult.response.ok) throw new AuthError(401, 'AUTH_TOKEN_INVALID')
    profile = profileResult.data
  } catch (error) {
    if (error instanceof AuthError) throw error
    throw new AuthError(503, 'AUTH_PROVIDER_UNAVAILABLE')
  }

  const uid = String(profile?.userId || '').trim()
  if (!uid) throw new AuthError(401, 'AUTH_TOKEN_INVALID')

  const identity = {
    uid,
    channelId: String(verified.client_id),
    expiresIn: Number(verified.expires_in || 0)
  }
  await cacheIdentity(token, identity, verified.expires_in)
  return identity
}

async function markTokenRequired(uid) {
  const now = new Date().toISOString()
  const { error } = await supabaseAdmin
    .from('user_auth_migrations')
    .upsert({
      uid,
      token_required: true,
      last_verified_at: now,
      recovery_until: null,
      recovery_reason: null,
      recovery_by: null,
      recovery_case_id: null
    }, { onConflict: 'uid' })

  if (error) {
    console.error('[line-auth] migration state write failed:', error.code || error.message)
    throw new AuthError(503, 'AUTH_MIGRATION_NOT_READY')
  }
}

async function getMigrationState(uid) {
  const { data, error } = await supabaseAdmin
    .from('user_auth_migrations')
    .select('token_required,recovery_until,recovery_case_id')
    .eq('uid', uid)
    .maybeSingle()

  if (error) {
    console.error('[line-auth] migration state read failed:', error.code || error.message)
    throw new AuthError(503, 'AUTH_MIGRATION_NOT_READY')
  }
  return data || null
}

async function verifyRecoveryProof(req, uid, caseId) {
  const raw = String(req?.headers?.['x-royal-recovery'] || req?.headers?.['X-Royal-Recovery'] || '').trim()
  if (raw.length < 32 || raw.length > 300) throw new AuthError(401, 'AUTH_RECOVERY_TICKET_REQUIRED')
  const hash = crypto.createHash('sha256').update(raw).digest('hex')
  const { data, error } = await supabaseAdmin
    .from('auth_recovery_tickets')
    .select('id')
    .eq('case_id', caseId)
    .eq('target_uid', uid)
    .eq('token_hash', hash)
    .not('consumed_at', 'is', null)
    .maybeSingle()
  if (error) {
    console.error('[line-auth] recovery proof read failed:', error.code || error.message)
    throw new AuthError(503, 'AUTH_MIGRATION_NOT_READY')
  }
  if (!data) throw new AuthError(401, 'AUTH_RECOVERY_TICKET_INVALID')
}

async function authenticateRequest(req, options = {}) {
  const claimedUid = String(options.claimedUid || '').trim()
  const token = getBearerToken(req)

  if (token) {
    const identity = await verifyLineAccessToken(token)
    if (options.enforceClaimMatch !== false && claimedUid && identity.uid !== claimedUid) {
      throw new AuthError(403, 'AUTH_UID_MISMATCH')
    }
    await markTokenRequired(identity.uid)
    return { uid: identity.uid, mode: 'token', migrated: true }
  }

  if (options.requireToken) throw new AuthError(401, 'AUTH_TOKEN_REQUIRED')
  if (!claimedUid) throw new AuthError(401, 'AUTH_UID_REQUIRED')
  const migration = await getMigrationState(claimedUid)
  if (migration?.token_required) {
    const recoveryUntil = new Date(migration.recovery_until || 0).getTime()
    if (options.allowRecovery !== false && Number.isFinite(recoveryUntil) && recoveryUntil > Date.now()) {
      if (migration.recovery_case_id) {
        await verifyRecoveryProof(req, claimedUid, migration.recovery_case_id)
      }
      return {
        uid: claimedUid,
        mode: migration.recovery_case_id ? 'ticket-recovery' : 'legacy-recovery',
        migrated: true,
        recoveryUntil: migration.recovery_until,
        recoveryCaseId: migration.recovery_case_id || null
      }
    }
    throw new AuthError(401, 'AUTH_UPGRADE_REQUIRED')
  }

  return { uid: claimedUid, mode: 'legacy', migrated: false }
}

function sendAuthError(res, error) {
  const status = error instanceof AuthError ? error.status : 500
  const code = error instanceof AuthError ? error.code : 'AUTH_ERROR'
  res.setHeader('Cache-Control', 'private, no-store')
  return res.status(status).json({ status: 'error', message: code, code })
}

function isAdminUid(uid) {
  const configuredAdminUid = String(process.env.ADMIN_UID || '').trim()
  return Boolean(configuredAdminUid) && String(uid || '').trim() === configuredAdminUid
}

module.exports = {
  AuthError,
  authenticateRequest,
  getBearerToken,
  isAdminUid,
  sendAuthError,
  verifyLineAccessToken
}
