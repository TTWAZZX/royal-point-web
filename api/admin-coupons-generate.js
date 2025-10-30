import { createClient } from '@supabase/supabase-js';

function genCode(len = 6) {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ status: 'error', message: 'Method not allowed' });
  }

  let body = {};
  try { body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}); } catch {}

  const {
    adminUid,
    amount, count, qty,
    points, point, value,
    prefix = ''
  } = body;

  if (!adminUid || adminUid !== process.env.ADMIN_UID) {
    return res.status(403).json({ status: 'error', message: 'Forbidden' });
  }

  const n = Math.max(1, Math.min(500, Number(count ?? qty ?? amount) || 1));
  const p = Math.max(1, Number(points ?? point ?? value) || 1);

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  const nowIso = new Date().toISOString();
  const rows = Array.from({ length: n }, () => ({
    code: (prefix || '') + genCode(6),
    point: p,
    status: 'unused',
    claimer: null,
    used_at: null,
    created_at: nowIso
  }));

  const { error } = await supabase.from('coupons').insert(rows);
  if (error) {
    return res.status(500).json({ status: 'error', message: error.message });
  }

  return res.status(200).json({ status: 'success', data: { inserted: rows.length } });
}
