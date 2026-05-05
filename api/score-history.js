// /api/score-history.js — minimal & safe ordering (no id/uuid needed)
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

    const uid = String(req.query.uid || '').trim();
    const parsedLimit = parseInt(req.query.limit || '25', 10);
    const parsedOffset = parseInt(req.query.offset || '0', 10);
    const limit = Math.max(1, Math.min(Number.isFinite(parsedLimit) ? parsedLimit : 25, 100));
    const offset = Math.max(Number.isFinite(parsedOffset) ? parsedOffset : 0, 0);
    if (!uid) return res.status(400).json({ status: 'error', message: 'uid required' });

    // map uid -> user_id
    const { data: user, error: uerr } = await supabase
      .from('users')
      .select('id')
      .eq('uid', uid)
      .single();

    if (uerr || !user) {
      return res.status(404).json({ status: 'error', message: 'user_not_found' });
    }

    // ดึงเฉพาะคอลัมน์ที่มีแน่ ๆ และเรียง created_at DESC
    if (req.query.kind === 'redemptions') {
      const { data, error } = await supabase
        .from('redemptions')
        .select(`
          id,
          created_at,
          cost,
          status,
          rewards:reward_id ( name, img_url )
        `)
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;

      const items = (data || []).map(row => ({
        id: row.id,
        created_at: row.created_at,
        cost: Number(row.cost || 0),
        status: row.status || '',
        reward_name: row.rewards?.name || 'ของรางวัล',
        reward_img: row.rewards?.img_url || ''
      }));

      return res.status(200).json({ status: 'success', items });
    }

    const { data, error } = await supabase
      .from('point_transactions')
      .select('id, amount, code, type, created_by, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false }) // = order by t.created_at desc
      .order('id',         { ascending: false }) // = order by t.id desc
      .range(offset, offset + limit - 1);

    if (error) {
      return res.status(500).json({ status: 'error', message: 'db_error' });
    }

    return res.status(200).json({
      status: 'success',
      items: data ?? [],
      nextOffset: offset + (data?.length || 0)
    });
  } catch (e) {
    return res.status(500).json({ status: 'error', message: 'unhandled_error' });
  }
};
