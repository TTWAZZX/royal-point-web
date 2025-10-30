import { createClient } from '@supabase/supabase-js';

function genCode(len = 6) {
  // เลี่ยงตัวที่สับสน เช่น 0O1Il
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ status: 'error', message: 'Method not allowed' });
  }

  // ✅ ตรวจสิทธิ์ด้วย x-admin-token (ให้สอดคล้องกับฝั่ง client)
  const token = req.headers['x-admin-token'];
  if (!token || token !== process.env.ADMIN_TOKEN) {
    return res.status(403).json({ status: 'error', message: 'Forbidden: Invalid admin token' });
  }

  // parse body ยืดหยุ่น (รองรับ raw string / JSON)
  let body = {};
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  } catch {}

  const {
    // adminUid ไม่จำเป็นอีกต่อไป แต่ไม่ error ถ้ามีส่งมา
    amount, count, qty,
    points, point, value,
    prefix = ''
  } = body;

  // จำนวนคูปอง (จำกัด safety)
  const n = Math.max(1, Math.min(500, Number(count ?? qty ?? amount) || 1));
  // แต้มต่อคูปอง (อย่างน้อย 1)
  const p = Math.max(1, Number(points ?? point ?? value) || 1);

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const nowIso = new Date().toISOString();

  // ฟังก์ชันสร้าง payload แยกไว้เผื่อ retry
  const makeRows = (k) => Array.from({ length: k }, () => ({
    code: (prefix || '') + genCode(6),
    point: p,
    status: 'unused',
    claimer: null,
    used_at: null,
    created_at: nowIso
  }));

  // ✳️ ใส่กลไกกันชนเคส duplicate code แบบง่ายๆ (หากมี unique index ที่คอลัมน์ code)
  // ลองสูงสุด 3 รอบ: ถ้าเจอ unique violation (code 23505) จะสุ่มใหม่แล้วลองอีก
  let left = n, inserted = 0;
  for (let attempt = 1; attempt <= 3 && left > 0; attempt++) {
    const rows = makeRows(left);
    const { error } = await supabase.from('coupons').insert(rows);
    if (!error) {
      inserted += rows.length;
      left = 0;
      break;
    }
    // Postgres unique_violation = 23505
    if (error.code === '23505' || /duplicate/i.test(error.message || '')) {
      // ลดขนาดแล้วลองใหม่ (สุ่มใหม่ทั้งหมดของที่เหลือ)
      // ในความเป็นจริง เราไม่รู้จำนวนชนจริง ๆ แต่ส่วนใหญ่จะน้อยมาก
      // ดังนั้นให้ลองใหม่ทั้งก้อนที่เหลือพอ
      if (attempt === 3) {
        return res.status(500).json({ status: 'error', message: 'Duplicate code, please retry' });
      }
      continue; // ไป generate อีกรอบ
    }
    // error อื่น ๆ
    return res.status(500).json({ status: 'error', message: error.message || 'Insert failed' });
  }

  return res.status(200).json({ status: 'success', data: { inserted } });
}
