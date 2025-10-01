export default async function handler(req, res) {
  try {
    const { APPS_SCRIPT_ENDPOINT, API_SECRET } = process.env;
    if (!APPS_SCRIPT_ENDPOINT || !API_SECRET) {
      return res.status(500).json({ status: "error", message: "Missing APPS_SCRIPT_ENDPOINT or API_SECRET" });
    }

    const url = new URL(APPS_SCRIPT_ENDPOINT);
    url.searchParams.set("action", "rewards");
    url.searchParams.set("secret", API_SECRET);
    // ถ้าส่ง uid/adminUid มาด้วย จะช่วยให้ฝั่ง GAS เปิดดู inactive ได้สำหรับแอดมิน
    if (req.query.uid)      url.searchParams.set("uid", req.query.uid);
    if (req.query.adminUid) url.searchParams.set("adminUid", req.query.adminUid);
    // ถ้าอยากดู inactive ด้วยใส่ include=1 (เฉพาะแอดมิน)
    if (req.query.include)  url.searchParams.set("include", req.query.include);

    const resp = await fetch(url.toString(), { method: "GET" });
    const text = await resp.text();
    try {
      const json = JSON.parse(text);
      return res.status(200).json(json);
    } catch {
      return res.status(200).json({ status: "error", message: "Bad payload from Apps Script", raw: text });
    }
  } catch (err) {
    return res.status(500).json({ status: "error", message: String(err) });
  }
}
