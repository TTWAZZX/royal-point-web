// /api/rewards.js
export default async function handler(req, res) {
  try {
    const APPS = process.env.APPS_SCRIPT_ENDPOINT || process.env.GAS_WEBAPP_URL;
    const API_SECRET = process.env.API_SECRET;
    if (!APPS || !API_SECRET) {
      return res.status(500).json({ status: "error", message: "Missing APPS_SCRIPT_ENDPOINT or API_SECRET" });
    }

    // proxy -> Apps Script: action=rewards
    const url = new URL(APPS);
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
