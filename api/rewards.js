// /api/rewards.js
export default async function handler(req, res) {
  try {
    const GAS_URL    = process.env.GAS_URL;
    const API_SECRET = process.env.API_SECRET;
    if (!GAS_URL || !API_SECRET) {
      return res.status(500).json({ status: "error", message: "Missing GAS_URL or API_SECRET" });
    }

    // proxy -> Apps Script: action=rewards
    const url = new URL(GAS_URL);
    url.searchParams.set("action", "rewards");
    url.searchParams.set("secret", API_SECRET);

    // ถ้าต้องการให้แอดมินเห็นของ inactive ด้วย: ส่ง include=1 ได้
    if (req.query.include)  url.searchParams.set("include", String(req.query.include));
    if (req.query.uid)      url.searchParams.set("uid", String(req.query.uid));
    if (req.query.adminUid) url.searchParams.set("adminUid", String(req.query.adminUid));

    const r   = await fetch(url.toString());
    const txt = await r.text();
    let data;
    try { data = JSON.parse(txt); }
    catch { data = { status: r.ok ? "success" : "error", message: txt }; }

    return res.status(r.ok ? 200 : r.status).json(data);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ status: "error", message: String(err || "Internal Error") });
  }
}
