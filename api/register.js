const { supabaseAdmin } = require('../lib/supabase')

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
    const { uid, name, room, dob, passport, tel } = req.body || {}
    if (!uid) return res.status(400).json({ error: 'uid required' })
    const row = {
      uid: String(uid).trim(),
      name: (name || '').trim() || null,
      room: (room || '').trim() || null,
      dob: (dob || '').trim() || null,
      passport: (passport || '').trim() || null,
      tel: (tel || '').trim() || null
    }

    const { error } = await supabaseAdmin
      .from('users')
      .upsert(row, { onConflict: 'uid' })

    if (error) return res.status(500).json({ error: 'db_error' })
    res.status(200).json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: 'server_error', detail: String(e) })
  }
}
