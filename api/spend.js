export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ status: "error", message: "Method not allowed" });
  }
  try {
    const { uid, cost, rewardId } = req.body || {};
    const GAS    = process.env.APPS_SCRIPT_ENDPOINT || process.env.GAS_WEBAPP_URL;
    const SECRET = process.env.API_SECRET;
    const ADMIN  = process.env.ADMIN_UID;

    if (!GAS || !SECRET || !ADMIN) {
      return res.status(500).json({ status: "error", message: "Missing APPS_SCRIPT_ENDPOINT/API_SECRET/ADMIN_UID env" });
    }

    const amount = Math.max(0, parseInt(cost, 10) || 0);
    if (!uid || !amount) {
      return res.status(400).json({ status: "error", message: "Bad params" });
    }

    // เรียก Apps Script: action=adjust-score ด้วยค่า delta ติดลบ
    const form = new URLSearchParams();
    form.set("action", "adjust-score");
    form.set("adminUid", ADMIN);
    form.set("targetUid", uid);
    form.set("delta", String(-amount));
    form.set("note", `REDEEM:${rewardId || ""}`);
    form.set("secret", SECRET);

    const r = await fetch(GAS, { method: "POST", body: form });
    const t = await r.text();
    let j; try { j = JSON.parse(t); } catch { j = { status: r.ok ? "success" : "error", message: t }; }

    if (j.status !== "success") {
      return res.status(200).json({ status: "error", message: j.message || "GAS error" });
    }
    return res.status(200).json({ status: "success", data: j });
  } catch (e) {
    return res.status(500).json({ status: "error", message: String(e) });
  }
}
