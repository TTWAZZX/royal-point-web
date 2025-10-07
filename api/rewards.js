// /api/rewards.js  (Server → proxy ไป Google Apps Script)
module.exports = async (req, res) => {
  try {
    // 1) อนุญาตเฉพาะ GET
    if (req.method !== 'GET') {
      return res.status(405).json({ status: 'error', message: 'Method Not Allowed' });
    }

    // 2) ตรวจ env
    const APPS = process.env.APPS_SCRIPT_ENDPOINT || process.env.GAS_WEBAPP_URL;
    const API_SECRET = process.env.API_SECRET;
    if (!APPS || !API_SECRET) {
      return res.status(500).json({
        status: 'error',
        message: 'Missing APPS_SCRIPT_ENDPOINT or API_SECRET'
      });
    }

    // 3) สร้าง URL proxy ไป Apps Script
    const url = new URL(APPS);
    url.searchParams.set('action', 'rewards');
    url.searchParams.set('secret', API_SECRET);

    // ✅ บังคับให้รวม INACTIVE เสมอ
    url.searchParams.set('include', '1');

    // ส่งต่อพารามิเตอร์อื่นที่ไม่กระทบ include
    if (req.query.uid)      url.searchParams.set('uid', String(req.query.uid));
    if (req.query.adminUid) url.searchParams.set('adminUid', String(req.query.adminUid));

    // 4) เรียก upstream พร้อม timeout (12s)
    const controller = new AbortController();
    const timeoutId  = setTimeout(() => controller.abort(), 12000);
    let upstreamRes;
    try {
      upstreamRes = await fetch(url.toString(), { signal: controller.signal });
    } finally {
      clearTimeout(timeoutId);
    }

    const text = await upstreamRes.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { status: upstreamRes.ok ? 'success' : 'error', message: text };
    }

    // 5) ห้ามแคชผล proxy
    res.setHeader('Cache-Control', 'no-store, max-age=0');

    return res.status(upstreamRes.ok ? 200 : upstreamRes.status).json(data);
  } catch (err) {
    console.error('[api/rewards] error:', err);
    return res.status(500).json({ status: 'error', message: String(err || 'Internal Error') });
  }
};
