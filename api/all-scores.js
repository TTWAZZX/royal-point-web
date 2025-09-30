// /api/all-scores.js
// Proxy ไป Google Apps Script: doGet?action=all-scores
// ใช้ env: APPS_SCRIPT_ENDPOINT, API_SECRET

export default async function handler(req, res) {
  try {
    // อ่าน uid จาก query — รองรับทั้ง uid และ adminUid (alias)
    const { uid: uidRaw, adminUid } = req.query || {};
    const uid = (uidRaw || adminUid || "").toString().trim();

    // ถ้าไม่ส่ง uid/adminUid มา → ตอบกลับลิสต์ว่าง (กันหน้าเว็บล่ม)
    if (!uid) {
      return res.status(200).json({ status: "success", data: [] });
    }

    const endpoint = process.env.APPS_SCRIPT_ENDPOINT;
    const secret   = process.env.API_SECRET;
    if (!endpoint || !secret) {
      return res
        .status(500)
        .json({ status: "error", message: "Missing APPS_SCRIPT_ENDPOINT or API_SECRET env" });
    }

    // call Apps Script
    const url = `${endpoint}?action=all-scores&uid=${encodeURIComponent(uid)}&secret=${encodeURIComponent(secret)}`;
    const r   = await fetch(url);
    const j   = await r.json();

    // ถ้าเซิร์ฟเวอร์ตอบ error/permission denied → รีเทิร์นเป็น success + data ว่าง
    if (j.status !== "success" || !Array.isArray(j.data)) {
      return res.status(200).json({ status: "success", data: [] });
    }

    return res.status(200).json({ status: "success", data: j.data });
  } catch (e) {
    console.error("all-scores proxy error:", e);
    // กรณีเครือข่าย/อื่น ๆ ก็ไม่ทำให้หน้าแตก
    return res.status(200).json({ status: "success", data: [] });
  }
}
