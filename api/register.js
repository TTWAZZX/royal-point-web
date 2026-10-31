const { supabaseAdmin } = require('../lib/supabase')
const { AuthError, authenticateRequest, sendAuthError } = require('../lib/line-auth')

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return res.status(405).json({ status:'error', message:'Method not allowed' })
    const { uid, name, room, dob, passport, tel } = req.body || {}
    const claimedUid = String(uid || '').trim()
    if (!claimedUid) return res.status(400).json({ status:'error', message:'uid required' })
    const auth = await authenticateRequest(req, { claimedUid, requireToken: true })
    const cleanUid = auth.uid

    const row = {
      uid: cleanUid,
      name: (name||'').trim() || null,
      room: (room||'').trim() || null,
      dob: (dob||'').trim() || null,
      passport: (passport||'').trim() || null,
      tel: (tel||'').trim() || null
    }

    const { error } = await supabaseAdmin.from('users').upsert(row, { onConflict:'uid' })
    if (error) return res.status(500).json({ status:'error', message:'db_error' })

    res.status(200).json({ status:'success' })
  } catch (e) {
    if (e instanceof AuthError) return sendAuthError(res, e)
    res.status(500).json({ status:'error', message:String(e) })
  }
}
