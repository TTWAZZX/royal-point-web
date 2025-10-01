export default async function handler(req, res) {
  const GAS = process.env.APPS_SCRIPT_ENDPOINT || process.env.GAS_WEBAPP_URL;
  const SECRET = process.env.API_SECRET;
  if (!GAS || !SECRET) {
    return res.status(500).json({ status: "error", message: "Missing APPS_SCRIPT_ENDPOINT or API_SECRET env" });
  }
  try {
    const uid = req.query.uid || req.query.adminUid || req.query.alias || "";
    const u = new URL(GAS);
    u.searchParams.set("action", "all-scores");
    u.searchParams.set("uid", uid);
    u.searchParams.set("secret", SECRET);

    const r = await fetch(u.toString());
    const t = await r.text();
    let j; try { j = JSON.parse(t); } catch { j = { status: r.ok ? "success" : "error", message: t }; }
    return res.status(200).json(j);
  } catch (e) {
    return res.status(500).json({ status: "error", message: String(e) });
  }
}
