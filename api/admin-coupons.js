const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ status: 'error', message: 'Method not allowed' });
  }

  const { adminUid } = req.query;
  if (!adminUid || adminUid !== process.env.ADMIN_UID) {
    return res.status(403).json({ status: 'error', message: 'Forbidden' });
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data, error } = await supabase
    .from('coupons')
    .select('code, point, status, claimer, used_at, created_at')
    .order('created_at', { ascending: false })
    .order('code', { ascending: true });

  if (error) return res.status(500).json({ status: 'error', message: error.message });

  const items = (data || []).map(r => ({
    code: r.code,
    points: r.point,
    status: r.status,
    used: r.status === 'used',
    claimer: r.claimer,
    used_at: r.used_at,
    created_at: r.created_at
  }));

  return res.status(200).json({ status: 'success', data: items });
};
