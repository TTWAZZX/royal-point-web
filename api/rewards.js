// api/rewards.js
export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ status: "error", message: "Method not allowed" });
  }
  try {
    const GAS    = process.env.APPS_SCRIPT_ENDPOINT || process.env.GAS_WEBAPP_URL;
    const SECRET = process.env.API_SECRET;
    if (!GAS || !SECRET) {
      return res.status(500).json({ status: "error", message: "Missing APPS_SCRIPT_ENDPOINT/API_SECRET env" });
    }

    const { uid, adminUid, include } = req.query || {};
    const u = new URL(GAS);
    u.searchParams.set("action", "rewards");
    if (uid)      u.searchParams.set("uid", uid);
    if (adminUid) u.searchParams.set("adminUid", adminUid);
    if (include)  u.searchParams.set("include", String(include)); // "1" เพื่อขอดู inactive (เฉพาะแอดมิน)
    u.searchParams.set("secret", SECRET);

    const r = await fetch(u, { method: "GET" });
    const t = await r.text();
    let j; try { j = JSON.parse(t); } catch { j = { status: r.ok ? "success" : "error", message: t }; }

    if (j.status !== "success") {
      return res.status(200).json({ status: "error", message: j.message || "GAS error" });
    }
    // โครงสร้างที่ app.js คาดไว้: { status:"success", data:[{id,name,img,cost,active}, ...] }
    return res.status(200).json(j);
  } catch (e) {
    return res.status(500).json({ status: "error", message: String(e) });
  }
}
