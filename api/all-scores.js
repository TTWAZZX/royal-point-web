const { supabaseAdmin } = require('../lib/supabase')
const { AuthError, authenticateRequest, isAdminUid, sendAuthError } = require('../lib/line-auth')

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store')
  try {
    if (req.method !== 'GET') return res.status(405).json({ status:'error', message:'Method not allowed' })

    const { uid: adminUid } = await authenticateRequest(req, {
      claimedUid: req.query.adminUid, requireToken: true, allowRecovery: false
    })
    if (!isAdminUid(adminUid)) {
      return res.status(403).json({ status:'error', message:'บัญชีนี้ไม่มีสิทธิ์ดูข้อมูลสมาชิก' })
    }

    const [usersResult, authResult] = await Promise.all([
      supabaseAdmin
        .from('users')
        .select('uid,name,room,dob,passport,tel, user_points(balance)')
        .order('uid', { ascending:true }),
      supabaseAdmin
        .from('user_auth_migrations')
        .select('uid,token_required,migrated_at,last_verified_at,recovery_until,recovery_reason,recovery_by,recovery_case_id')
    ])
    if (usersResult.error || authResult.error) {
      return res.status(500).json({ status:'error', message:'db_error' })
    }

    const authByUid = new Map((authResult.data || []).map(row => [row.uid, row]))

    const rows = (usersResult.data||[]).map(u => {
      const pointRow = Array.isArray(u.user_points) ? u.user_points[0] : u.user_points
      const auth = authByUid.get(u.uid) || null
      return {
        uid: u.uid,
        name: u.name || '',
        room: u.room || '',
        dob: u.dob || '',
        passport: u.passport || '',
        tel: u.tel || '',
        score: pointRow?.balance ?? 0,
        auth: auth ? {
          tokenRequired: Boolean(auth.token_required),
          migratedAt: auth.migrated_at,
          lastVerifiedAt: auth.last_verified_at,
          recoveryUntil: auth.recovery_until,
          recoveryReason: auth.recovery_reason,
          recoveryBy: auth.recovery_by,
          recoveryCaseId: auth.recovery_case_id
        } : {
          tokenRequired: false,
          migratedAt: null,
          lastVerifiedAt: null,
          recoveryUntil: null,
          recoveryReason: null,
          recoveryBy: null,
          recoveryCaseId: null
        }
      }
    })

    res.status(200).json({ status:'success', data: rows })
  } catch (e) {
    if (e instanceof AuthError) return sendAuthError(res, e)
    res.status(500).json({ status:'error', message:String(e) })
  }
}
