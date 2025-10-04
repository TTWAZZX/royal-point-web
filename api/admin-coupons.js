// /api/admin-coupons.js
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

// แปลง row -> shape ที่ฝั่งหน้าเว็บอ่านง่าย
function mapRow(r = {}) {
  const statusStr = String(r.status ?? '').toLowerCase();
  const usedByFlag =
    !!r.claimer || !!r.used_at ||
    statusStr.startsWith('used') ||
    statusStr === '1' || statusStr === 'true' || statusStr === 'ใช้งานแล้ว';

  return {
    code: r.code || '',
    points: Number(r.point ?? 0),
    used: !!usedByFlag,
    is_used: !!usedByFlag,     // เผื่อฟรอนต์อ่านชื่อนี้
    redeemed: !!usedByFlag,    // เผื่อฟรอนต์อ่านชื่อนี้
    created_at: r.created_at || null,
    used_at: r.used_at || null,
    used_by: r.claimer || null,
    status: r.status || null,
  };
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'GET') {
      return res.status(405).json({ status: 'error', message: 'method_not_allowed' });
    }

    const { adminUid } = req.query;
    if (!isAdmin(adminUid)) {
      return res.status(403).json({ status: 'error', message: 'forbidden' });
    }

    const { data, error } = await supabase
      .from('coupons')
      .select('code, point, status, claimer, used_at, created_at')
      .order('used_at', { ascending: true, nullsFirst: true })
      .limit(1000);

    if (error) throw error;

    const items = (data || []).map(mapRow);
    return res.status(200).json({ status: 'success', data: items });
  } catch (e) {
    console.error('[admin-coupons] error', e);
    return res.status(500).json({ status: 'error', message: e.message || 'server_error' });
  }
}

// ให้ Vercel รองรับ CommonJS ด้วย
export const config = { api: { bodyParser: true } };
