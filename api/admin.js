// /api/admin.js
export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ status: "error", message: "Method Not Allowed" });
  }

  try {
    const endpoint = process.env.APPS_SCRIPT_ENDPOINT; // เช่น https://script.google.com/macros/s/XXXX/exec
    const secret   = process.env.API_SECRET;           // ต้องตรงกับ Script Properties: API_SECRET
    if (!endpoint || !secret) {
      return res.status(500).json({ status: "error", message: "Missing server env config" });
    }

    // uid ของผู้เรียก (ต้องเป็น Admin ตามที่ระบุใน Server.gs)
    const uid = (req.query.uid || "").toString().trim();
    if (!uid) {
      return res.status(400).json({ status: "error", message: "Missing uid" });
    }

    // รองรับ output เป็น CSV เมื่อ ?format=csv
    const asCSV = String(req.query.format || "").toLowerCase() === "csv";

    // เรียก Apps Script: action=all-scores → ตรวจสิทธิ์ admin ใน Server.gs
    const params = new URLSearchParams({
      action: "all-scores",
      uid,        // uid ของ requester (ใช้ตรวจ admin)
      secret,     // ส่งไปให้ Server.gs ตรวจ
    });

    const url = `${endpoint}?${params.toString()}`;
    const r = await fetch(url, { headers: { Accept: "application/json" } });
    const text = await r.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      // หากฝั่ง GAS ตอบไม่ใช่ JSON ก็ส่งข้อความดิบกลับไปช่วยดีบัก
      data = { status: r.ok ? "success" : "error", message: text };
    }

    if (!r.ok) {
      return res.status(r.status).json(data);
    }

    // กรณีอยากดาวน์โหลด CSV
    if (asCSV) {
      if (data.status !== "success" || !Array.isArray(data.data)) {
        return res.status(200).json(data);
      }
      const rows = data.data;
      // สร้าง CSV: header + rows
      const header = ["uid", "name", "score"];
      const escape = (v) => {
        const s = String(v ?? "");
        // escape double quotes
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const csv =
        header.join(",") + "\n" +
        rows.map(r => [escape(r.uid), escape(r.name), escape(r.score)].join(",")).join("\n");

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="all-scores.csv"`);
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).send(csv);
    }

    // ปกติคืน JSON
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json(data);

  } catch (err) {
    console.error(err);
    return res.status(500).json({ status: "error", message: String(err || "Internal Error") });
  }
}
