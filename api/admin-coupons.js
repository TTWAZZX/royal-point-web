// GET /api/admin-coupons?adminUid=...&status=all|used|unused&q=...&limit=...
// ดึงรายการคูปองแบบกระทัดรัด
const SUPABASE_URL  = process.env.SUPABASE_URL;
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY;

module.exports = async (req, res) => {
  try {
    if (req.method !== 'GET') {
      res.status(405).json({ status: 'error', message: 'GET only' }); return;
    }
    if (!SUPABASE_URL || !SERVICE_KEY) {
      res.status(500).json({ status: 'error', message: 'Missing SUPABASE_URL or SERVICE_ROLE_KEY' }); return;
    }

    const { status = 'all', q = '', limit } = req.query;
    const params = new URLSearchParams();
    params.set('select', 'code,point,status,claimer,used_at');
    // filter
    if (status === 'used')   params.set('status', 'eq.used');
    if (status === 'unused') params.set('status', 'eq.unused');
    if (q)                   params.set('code', `ilike.*${q}*`);
    // order + limit
    params.append('order', 'used_at.desc'); // used ล่าสุดก่อน
    params.append('order', 'code.asc');
    if (limit) params.set('limit', String(Math.max(1, Number(limit) || 0)));

    const url = `${SUPABASE_URL}/rest/v1/coupons?${params.toString()}`;
    const r = await fetch(url, {
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
      }
    });
    if (!r.ok) {
      const t = await r.text();
      throw new Error(`${r.status} ${r.statusText} ${t}`);
    }
    const rows = await r.json();
    res.json({ status: 'success', data: rows });
  } catch (e) {
    res.status(500).json({ status: 'error', message: e.message || String(e) });
  }
};
