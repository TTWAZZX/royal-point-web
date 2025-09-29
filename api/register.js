export default async function handler(req, res) {
  if (req.method !== "POST") {
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

    const bodyObj = await readBodyAsObject(req);
    const form = new URLSearchParams({ ...bodyObj, secret });

    const r = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
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

async function readBodyAsObject(req) {
  const ct = (req.headers["content-type"] || "").toLowerCase();

  // JSON
  if (ct.includes("application/json")) {
    if (typeof req.body === "object" && req.body !== null) return req.body;
    const raw = await getRaw(req);
    try {
      return JSON.parse(raw || "{}");
    } catch {
      return {};
    }
  }

  // x-www-form-urlencoded
  if (ct.includes("application/x-www-form-urlencoded")) {
    const raw = await getRaw(req);
    const params = new URLSearchParams(raw);
    const obj = {};
    for (const [k, v] of params.entries()) obj[k] = v;
    return obj;
  }

  // Fallback: plain text -> try parse as querystring
  const raw = await getRaw(req);
  try {
    const params = new URLSearchParams(raw);
    const obj = {};
    for (const [k, v] of params.entries()) obj[k] = v;
    return obj;
  } catch {
    return {};
  }
}

function getRaw(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

async function safeJson(resp) {
  const text = await resp.text();
  try {
    return JSON.parse(text);
  } catch {
    // ถ้า GAS คืน text/plain ก็ห่อให้เป็น JSON มาตรฐาน
    return { status: resp.ok ? "success" : "error", message: text };
  }
}
