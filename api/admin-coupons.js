const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'DELETE') {
    return res.status(405).json({ status: 'error', message: 'Method not allowed' });
  }

  let body = {};
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  } catch {
    body = {};
  }
  const adminUid = req.query.adminUid || body.adminUid;
  if (!adminUid || adminUid !== process.env.ADMIN_UID) {
    return res.status(403).json({ status: 'error', message: 'Forbidden' });
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  if (req.method === 'DELETE') {
    const codes = Array.isArray(body.codes) ? body.codes : [body.code || req.query.code];
    const cleanCodes = codes.map(code => String(code || '').trim()).filter(Boolean).slice(0, 100);
    if (cleanCodes.length === 0) {
      return res.status(400).json({ status: 'error', message: 'code required' });
    }

    const { data, error } = await supabase
      .from('coupons')
      .delete()
      .in('code', cleanCodes)
      .eq('status', 'unused')
      .select('code');

    if (error) return res.status(500).json({ status: 'error', message: error.message });
    return res.status(200).json({ status: 'success', deleted: data?.length || 0, data });
  }

  const { data, error } = await supabase
    .from('coupons')
    .select('code, point, status, claimer, used_at, created_at')
    .order('created_at', { ascending: false })  // ใหม่ก่อน
    .order('code', { ascending: true });

  if (error) {
    return res.status(500).json({ status: 'error', message: error.message });
  }

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
