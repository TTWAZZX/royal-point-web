export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res
      .status(405)
      .json({ status: "error", message: "Method Not Allowed" });
  }

  try {
    const endpoint = process.env.APPS_SCRIPT_ENDPOINT;
    const secret = process.env.API_SECRET;
    if (!endpoint || !secret) {
      return res
        .status(500)
        .json({ status: "error", message: "Missing server env config" });
    }

    const uid = (req.query.uid || "").toString().trim();
    if (!uid) {
      return res
        .status(400)
        .json({ status: "error", message: "Missing uid" });
    }

    // แก้พารามิเตอร์ให้ตรงกับ doGet ของคุณ
    const params = new URLSearchParams({
      action: "score",
      uid,
      secret,
    });

    const url = `${endpoint}?${params.toString()}`;

    const r = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
    });

    const data = await safeJson(r);
    return res.status(r.ok ? 200 : r.status).json(data);
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ status: "error", message: String(err || "Internal Error") });
  }
}

async function safeJson(resp) {
  const text = await resp.text();
  try {
    return JSON.parse(text);
  } catch {
    return { status: resp.ok ? "success" : "error", message: text };
  }
}
