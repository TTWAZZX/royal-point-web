// /api/all-scores.js
// Proxy ไป Google Apps Script: doGet?action=all-scores
// ใช้ env: APPS_SCRIPT_ENDPOINT, API_SECRET

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'GET') {
    return res.status(405).json({ status: 'error', message: 'Method not allowed' });
  }

  const endpoint = process.env.APPS_SCRIPT_ENDPOINT;
  const secret   = process.env.API_SECRET;

  if (!endpoint || !secret) {
    return res.status(500).json({
      status: 'error',
      message: 'Missing APPS_SCRIPT_ENDPOINT or API_SECRET env',
    });
  }

  try {
    // ฝั่ง Admin เรียก /api/all-scores?adminUid=xxxxx
    const adminUid = (req.query.adminUid || req.query.uid || '').toString().trim();
    if (!adminUid) {
      return res.status(400).json({ status: 'error', message: 'Missing adminUid' });
    }

    // Apps Script ต้องการพารามิเตอร์ชื่อ uid (ใช้เช็ค isAdmin)
    const url = `${endpoint}?action=all-scores&secret=${encodeURIComponent(secret)}&uid=${encodeURIComponent(adminUid)}`;

    const r = await fetch(url, { method: 'GET', headers: { 'Content-Type': 'application/json' } });
    const text = await r.text();

    // พยายาม parse เป็น JSON ถ้าไม่ได้ก็ส่งดิบกลับไปเพื่อ debug
    try {
      const json = JSON.parse(text);
      // ป้องกัน cache
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json(json);
    } catch {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(r.ok ? 200 : 502).send(text);
    }
  } catch (err) {
    console.error('all-scores proxy error:', err);
    return res.status(502).json({ status: 'error', message: String(err) });
  }
}
