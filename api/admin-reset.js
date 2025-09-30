export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ status: "error", message: "Method not allowed" });
  }
  try {
    const endpoint = process.env.APPS_SCRIPT_ENDPOINT;
    const secret   = process.env.API_SECRET;
    if (!endpoint || !secret) {
      return res.status(500).json({ status: "error", message: "Missing APPS_SCRIPT_ENDPOINT or API_SECRET" });
    }

    const { adminUid, targetUid, note } = req.body || {};
    if (!adminUid || !targetUid) {
      return res.status(200).json({ status: "error", message: "Missing adminUid/targetUid" });
    }

    const gsRes = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        action: "reset-score",
        apiSecret: secret,
        adminUid,
        targetUid,
        note: String(note || "")
      })
    });

    const data = await gsRes.json();
    return res.status(200).json(data);

  } catch (e) {
    return res.status(200).json({ status: "error", message: String(e) });
  }
}
