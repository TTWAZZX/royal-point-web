// /api/score-history.js  — read history directly from Supabase, UI-compatible shape
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

module.exports = async (req, res) => {
  try {
    if (req.method !== 'GET') {
      return res.status(405).json({ status: 'error', message: 'Method not allowed' });
    }

    const uid    = String(req.query.uid || '').trim();
    const limit  = Math.min(parseInt(req.query.limit  || '25', 10), 100);
    const offset = Math.max(parseInt(req.query.offset || '0',  10), 0);

    if (!uid) {
      return res.status(400).json({ status: 'error', message: 'uid required' });
    }

    // 1) map uid -> user_id
    const { data: user, error: uerr } = await supabase
      .from('users')
      .select('id')
      .eq('uid', uid)
      .single();

    if (uerr || !user) {
      return res.status(404).json({ status: 'error', message: 'user_not_found' });
    }

    // 2) read transactions by user_id (desc)
    const { data, error } = await supabase
      .from('point_transactions')
      .select('amount, code, type, text, created_by, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      return res.status(500).json({ status: 'error', message: 'db_error' });
    }

    // 3) UI expects { status:'success', items: [...] }
    return res.status(200).json({
      status: 'success',
      items: data ?? [],
      nextOffset: offset + (data?.length || 0)
    });
  } catch (e) {
    return res.status(500).json({ status: 'error', message: String(e) });
  }
};
