// /api/admin-coupons-generate.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ปรับตามจริงของคุณ
const ADMINS = ['Ucadb3c0f63ada96c0432a0aede267ff9'];

function isAdmin(uid = '') {
  return ADMINS.includes(String(uid));
}

function makeCode(prefix = '') {
  // โค้ดอ่านง่าย (หลีกเลี่ยง O0Il)
  const ABC = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 8; i++) s += ABC[Math.floor(Math.random() * ABC.length)];
  return (prefix || '') + s;
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ status: 'error', message: 'method_not_allowed' });
    }

    const body = req.body || {};
    const adminUid = body.adminUid || body.uid || '';
    if (!isAdmin(adminUid)) {
      return res.status(403).json({ status: 'error', message: 'forbidden' });
    }

    const qty  = Math.max(1, Number(body.amount ?? body.qty ?? body.count ?? 1));
    const pts  = Math.max(1, Number(body.points ?? body.point ?? body.value ?? 1));
    const pref = String(body.prefix || '').trim();

    if (qty > 500) {
      return res.status(400).json({ status: 'error', message: 'limit_500' });
    }

    // เตรียม rows ตาม schema ปัจจุบันของคุณ (point/status/claimer/used_at)
    const rows = Array.from({ length: qty }, () => ({
      code: makeCode(pref),
      point: pts,
      status: 'unused',  // เก็บเป็นข้อความ
      claimer: null,
      used_at: null,
      created_at: new Date().toISOString()
    }));

    // ต้องมี UNIQUE(code) ใน DB (ดูข้อ 1)
    const { data, error } = await supabase
      .from('coupons')
      .upsert(rows, { onConflict: 'code', ignoreDuplicates: true })
      .select('code');

    if (error) throw error;

    return res.status(200).json({
      status: 'success',
      generated: rows.length,
      inserted: (data || []).length
    });
  } catch (e) {
    console.error('[admin-coupons-generate] error', e);
    return res.status(500).json({ status: 'error', message: e.message || 'server_error' });
  }
}

export const config = { api: { bodyParser: true } };
