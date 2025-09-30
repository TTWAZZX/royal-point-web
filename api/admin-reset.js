// /api/admin-reset.js
// Proxy ไป Google Apps Script: doPost(action=reset-score)
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

  const endpoint = process.env.APPS_SCRIPT_ENDPOINT;
  const secret   = process.env.API_SECRET;
  if (!endpoint || !secret) {
    return res.status(500).json({ status: "error", message: "Missing APPS_SCRIPT_ENDPOINT or API_SECRET env" });
  }

  // รองรับทั้ง JSON และ urlencoded
  let body = req.body || {};
  if (typeof body === "string") {
    try { body = JSON.parse(body || "{}"); } catch { body = {}; }
  }

  const adminUid  = (body.adminUid ?? body.uid ?? "").toString().trim();
  const targetUid = (body.targetUid ?? "").toString().trim();
  const note      = (body.note ?? "").toString();

  if (!adminUid || !targetUid) {
    return res.status(400).json({ status: "error", message: "Missing adminUid/targetUid" });
  }

  try {
    const params = new URLSearchParams({
      action: "reset-score",
      secret,
      adminUid,
      targetUid,
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
      return res.status(r.ok ? 200 : 502).send(text);
    }
  } catch (err) {
    console.error("admin-reset proxy error:", err);
    return res.status(502).json({ status: "error", message: String(err) });
  }
}
