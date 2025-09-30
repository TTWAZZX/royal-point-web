// /api/admin-adjust.js
// Proxy ไป Google Apps Script: doPost(action=adjust-score)
// ใช้ env: APPS_SCRIPT_ENDPOINT, API_SECRET

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ status: "error", message: "Method not allowed" });
  }

  const endpoint = process.env.APPS_SCRIPT_ENDPOINT || process.env.GAS_WEBAPP_URL; // fallback รองรับสองชื่อ
  const secret   = process.env.API_SECRET;
  if (!endpoint || !secret) {
  return res.status(500).json({ status: "error", message: "Missing APPS_SCRIPT_ENDPOINT (or GAS_WEBAPP_URL) or API_SECRET env" });
  }

  // รองรับทั้ง JSON และ urlencoded
  let body = req.body || {};
  if (typeof body === "string") {
    try { body = JSON.parse(body || "{}"); } catch { body = {}; }
  }

  const adminUid  = (body.adminUid ?? body.uid ?? "").toString().trim();
  const targetUid = (body.targetUid ?? "").toString().trim();
  const note      = (body.note ?? "").toString();
  const deltaRaw  = body.delta;

  // ตรวจความถูกต้องเบื้องต้น
  if (!adminUid || !targetUid || deltaRaw === undefined || deltaRaw === null) {
    return res.status(400).json({ status: "error", message: "Missing adminUid/targetUid/delta" });
  }

  const delta = Number(deltaRaw);
  if (!Number.isFinite(delta) || delta === 0) {
    return res.status(400).json({ status: "error", message: "Invalid delta (must be number and != 0)" });
  }

  try {
    const params = new URLSearchParams({
      action: "adjust-score",
      secret,
      adminUid,
      targetUid,
      delta: String(delta),
      note
    });

    const r = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString()
    });

    const text = await r.text();
    res.setHeader("Cache-Control", "no-store");

    try {
      const json = JSON.parse(text);
      return res.status(200).json(json);
    } catch {
      // ถ้า Apps Script ตอบไม่ใช่ JSON ให้ส่งข้อความดิบกลับไปช่วยดีบัก
      return res.status(r.ok ? 200 : 502).send(text);
    }
  } catch (err) {
    console.error("admin-adjust proxy error:", err);
    return res.status(502).json({ status: "error", message: String(err) });
  }
}
