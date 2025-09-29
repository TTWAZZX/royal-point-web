// /api/score-history.js
export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ status: "error", message: "Method Not Allowed" });
  }

  try {
    const endpoint = process.env.APPS_SCRIPT_ENDPOINT; // ต้องชี้ไปที่ .../exec
    const secret   = process.env.API_SECRET;           // ต้องตรงกับ Script Properties: API_SECRET

    if (!endpoint || !secret) {
      return res.status(500).json({ status: "error", message: "Missing server env config" });
    }

    const uid = (req.query.uid || "").toString().trim();
    if (!uid) {
      return res.status(400).json({ status: "error", message: "Missing uid" });
    }

    const params = new URLSearchParams({
      action: "history",
      uid,
      secret,
    });
    const url = `${endpoint}?${params.toString()}`;

    const r = await fetch(url, { headers: { Accept: "application/json" } });
    const text = await r.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { status: r.ok ? "success" : "error", message: text };
    }

    return res.status(r.ok ? 200 : r.status).json(data);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ status: "error", message: String(err || "Internal Error") });
  }
}
