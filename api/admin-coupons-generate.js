// /api/admin-coupons-generate.js
import { supabase } from '../supabase.js';
const ADMIN_UID = 'Ucadb3c0f63ada96c0432a0aede267ff9';

function makeCode(prefix='') {
  const rand = Math.random().toString(36).slice(2, 8); // 6 ตัว
  return (prefix || '') + rand.toUpperCase();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ status:'error', message:'method not allowed' });
  try {
    const { adminUid, count=10, points=10, prefix='' } = req.body || {};
    if (adminUid !== ADMIN_UID) return res.status(403).json({ status:'error', message:'forbidden' });

    const n  = Math.max(1, Math.min(500, Number(count)));
    const pt = Math.max(1, Number(points));
    const rows = Array.from({length:n}, ()=>({ code: makeCode(prefix), points: pt, used:false }));

    const { data, error } = await supabase.from('coupons').insert(rows).select('code, points, used, created_at');
    if (error) throw error;

    res.json({ status:'success', data });
  } catch (e) {
    res.status(500).json({ status:'error', message: e.message || String(e) });
  }
}
