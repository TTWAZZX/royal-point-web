// /api/score-history.js
// Proxy ไป Google Apps Script: doGet?action=history
// ใช้ env: APPS_SCRIPT_ENDPOINT, API_SECRET

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "GET") {
    return res.status(405).json({ status: "error", message: "Method not allowed" });
  }

  const endpoint = process.env.APPS_SCRIPT_ENDPOINT;
  const secret   = process.env.API_SECRET;
  if (!endpoint || !secret) {
    return res.status(500).json({ status: "error", message: "Missing APPS_SCRIPT_ENDPOINT or API_SECRET env" });
  }

  const uid = (req.query.uid || "").toString().trim();
  if (!uid) {
    return res.status(400).json({ status: "error", message: "Missing uid" });
  }

  try {
    const url = `${endpoint}?action=history&secret=${encodeURIComponent(secret)}&uid=${encodeURIComponent(uid)}`;
    const r = await fetch(url, { method: "GET", headers: { "Content-Type": "application/json" } });
    const text = await r.text();

    res.setHeader("Cache-Control", "no-store");
    try {
      const json = JSON.parse(text);
      return res.status(200).json(json);
    } catch {
      return res.status(r.ok ? 200 : 502).send(text);
    }
  } catch (err) {
    console.error("score-history proxy error:", err);
    return res.status(502).json({ status: "error", message: String(err) });
  }
}
