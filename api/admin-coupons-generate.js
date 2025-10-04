// POST /api/admin-coupons-generate  { adminUid, count|qty, points|point, prefix }
// สร้างคูปองชุดใหญ่
const crypto         = require('crypto');
const SUPABASE_URL   = process.env.SUPABASE_URL;
const SERVICE_KEY    = process.env.SUPABASE_SERVICE_ROLE_KEY;

function makeCode(prefix='') {
  // 8 ตัว HEX (คุณจะเปลี่ยนสูตรได้)
  return prefix + crypto.randomBytes(4).toString('hex').toUpperCase();
}

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      res.status(405).json({ status: 'error', message: 'POST only' }); return;
    }
    if (!SUPABASE_URL || !SERVICE_KEY) {
      res.status(500).json({ status: 'error', message: 'Missing SUPABASE_URL or SERVICE_ROLE_KEY' }); return;
    }

    const bodyRaw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
    const b = JSON.parse(bodyRaw || '{}');

    const n   = Math.min(500, Math.max(1, Number(b.count ?? b.qty ?? b.amount ?? 1)));
    const pts = Math.max(1, Number(b.points ?? b.point ?? b.value ?? 1));
    const pre = String(b.prefix || '');

    const rows = Array.from({ length: n }, () => ({
      code: makeCode(pre),
      point: pts,
      status: 'unused',
      claimer: null,
      used_at: null
    }));

    const url = `${SUPABASE_URL}/rest/v1/coupons`;
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        Prefer: 'return=representation'
      },
      body: JSON.stringify(rows)
    });
    const text = await r.text();
    if (!r.ok) throw new Error(`${r.status} ${r.statusText} ${text}`);
    const inserted = JSON.parse(text);
    res.json({ status: 'success', inserted: inserted.length, items: inserted });
  } catch (e) {
    res.status(500).json({ status: 'error', message: e.message || String(e) });
  }
};
