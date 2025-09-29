export default async function handler(req, res) {
  try {
    const endpoint = process.env.APPS_SCRIPT_ENDPOINT;
    const secret   = process.env.API_SECRET;
    if (!endpoint || !secret) {
      return res.status(500).json({ status: "error", message: "Missing APPS_SCRIPT_ENDPOINT or API_SECRET" });
    }

    const uid = String(req.query.uid || "");
    const format = String(req.query.format || "").toLowerCase();

    // ขอข้อมูลรวมคะแนนจาก Apps Script
    const gsRes = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        action: "all-scores",
        apiSecret: secret,
        uid
      })
    });
    const data = await gsRes.json();

    if (data.status !== "success" || !Array.isArray(data.data)) {
      return res.status(200).json({ status: "error", message: data.message || "Apps Script error" });
    }

    // ถ้าขอ CSV
    if (format === "csv") {
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

    // ปกติ: ส่ง JSON
    return res.status(200).json({
      status: "success",
      data: data.data
    });

  } catch (e) {
    return res.status(200).json({ status: "error", message: String(e) });
  }
}
