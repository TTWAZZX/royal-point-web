// /api/admin.js  (Vercel serverless - GET -> Apps Script doGet)
export default async function handler(req, res) {
  try {
    const endpoint = process.env.APPS_SCRIPT_ENDPOINT; // URL ลงท้ายด้วย /exec
    const secret   = process.env.API_SECRET;           // ต้องตรงกับ Script Properties: API_SECRET
    const debug    = String(req.query.debug || "") === "1";

    if (!endpoint || !secret) {
      return res.status(500).json({ status: "error", message: "Missing APPS_SCRIPT_ENDPOINT or API_SECRET" });
    }

    const uid = String(req.query.uid || "");

    // === เรียก Apps Script แบบ GET (ให้เข้า doGet) และใช้พารามิเตอร์ชื่อ 'secret' ===
    const qs = new URLSearchParams({
      action: "all-scores",
      secret,
      uid
    }).toString();

    const gsRes = await fetch(`${endpoint}?${qs}`, { method: "GET", cache: "no-store" });
    const text  = await gsRes.text();

    let data = null;
    try { data = JSON.parse(text); } catch (_) {}

    if (!data || data.status !== "success" || !Array.isArray(data.data)) {
      if (debug) {
        return res.status(200).json({
          status: "error",
          message: (data && data.message) || "Apps Script error",
          httpStatus: gsRes.status,
          raw: text?.slice(0, 1200)
        });
      }
      return res.status(200).json({ status: "error", message: (data && data.message) || "Apps Script error" });
    }

    // CSV export
    if (String(req.query.format || "").toLowerCase() === "csv") {
      const rows = data.data;
      const headers = ["rank","uid","name","score"];
      const csv = [
        headers.join(","),
        ...rows.map((r, i) => [
          i + 1,
          `"${String(r.uid||"").replace(/"/g,'""')}"`,
          `"${String(r.name||"").replace(/"/g,'""')}"`,
          Number(r.score||0)
        ].join(","))
      ].join("\n");

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="royal-point-leaderboard.csv"`);
      return res.status(200).send(csv);
    }

    return res.status(200).json({ status: "success", data: data.data });

  } catch (e) {
    return res.status(200).json({ status: "error", message: String(e) });
  }
}
