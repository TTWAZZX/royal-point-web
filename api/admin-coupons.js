// /api/admin-coupons.js
import { supabase } from '../supabase.js';  // ปรับ path ให้ตรงโปรเจกต์ของคุณ
const ADMIN_UID = 'Ucadb3c0f63ada96c0432a0aede267ff9'; // เปลี่ยนได้

export default async function handler(req, res) {
  try {
    const { adminUid, filter = 'all', q = '' } = req.query || {};
    if (adminUid !== ADMIN_UID) return res.status(403).json({ status:'error', message:'forbidden' });

    let query = supabase
      .from('coupons')
      .select('code, points, used, used_by, used_at, created_at')
      .order('created_at', { ascending:false });

    if (filter === 'used')   query = query.eq('used', true);
    if (filter === 'unused') query = query.eq('used', false);
    if (q) query = query.ilike('code', `%${q}%`);

    const { data, error } = await query.limit(500);
    if (error) throw error;

    return res.json({ status:'success', data });
  } catch (e) {
    return res.status(500).json({ status:'error', message: e.message || String(e) });
  }
}
