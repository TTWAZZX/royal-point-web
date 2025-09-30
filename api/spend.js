// /api/spend.js
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ status: "error", message: "Method not allowed" });
  }
  try {
    const { uid, cost, rewardId } = req.body || {};
    const GAS_URL    = process.env.GAS_WEBAPP_URL;  // https://script.google.com/macros/s/.../exec
    const API_SECRET = process.env.API_SECRET;      // ต้องตรงกับ Script Properties
    const ADMIN_UID  = process.env.ADMIN_UID;       // ตั้งใน Vercel → Settings → Environment Variables

    if (!GAS_URL || !API_SECRET || !ADMIN_UID) {
      return res.status(500).json({ status: "error", message: "Missing server env (GAS_URL/API_SECRET/ADMIN_UID)" });
    }
    const costInt = parseInt(cost, 10);
    if (!uid || !Number.isFinite(costInt) || costInt <= 0) {
      return res.status(400).json({ status: "error", message: "Bad params" });
    }

    // เรียก Apps Script action=adjust-score ด้วย delta ติดลบ
    const form = new URLSearchParams();
    form.set("action", "adjust-score");
    form.set("adminUid", ADMIN_UID);
    form.set("targetUid", uid);
    form.set("delta", String(-Math.abs(costInt)));
    form.set("note", `REDEEM:${rewardId || ""}`);
    form.set("secret", API_SECRET);

    const r = await fetch(GAS_URL, { method: "POST", body: form });
    const text = await r.text();
    let j; try { j = JSON.parse(text); } catch { j = { status: r.ok ? "success":"error", message: text }; }

    if (j.status !== "success") {
      return res.status(200).json({ status: "error", message: j.message || "GAS error" });
    }
    return res.status(200).json({ status: "success", data: j });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ status: "error", message: String(e) });
  }
}
