// /api/admin-reset.js
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ status: "error", message: "Method Not Allowed" });
  }
  try {
    const endpoint = process.env.APPS_SCRIPT_ENDPOINT;
    const secret   = process.env.API_SECRET;
    if (!endpoint || !secret) {
      return res.status(500).json({ status: "error", message: "Missing server env config" });
    }

    const { adminUid, targetUid, note } = req.body || {};
    if (!adminUid || !targetUid) {
      return res.status(400).json({ status: "error", message: "Missing adminUid/targetUid" });
    }

    const form = new URLSearchParams({
      action: "reset-score",
      adminUid,
      targetUid,
      note: String(note || ""),
      secret
    });

    const r = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString()
    });

    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { status: r.ok ? "success" : "error", message: text }; }

    return res.status(r.ok ? 200 : r.status).json(data);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ status: "error", message: String(err || "Internal Error") });
  }
}
