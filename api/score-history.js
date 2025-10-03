// /api/score-history.js — safe version for Supabase (no reserved-name issues)
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

module.exports = async (req, res) => {
  try {
    if (req.method !== 'GET') {
      return res.status(405).json({ status: 'error', message: 'Method not allowed' });
    }

    const uidRaw = String(req.query.uid || '');
    const uid = uidRaw.trim();
    const limit = Math.min(parseInt(req.query.limit || '25', 10), 100);
    const offset = Math.max(parseInt(req.query.offset || '0', 10), 0);

    if (!uid) {
      return res.status(400).json({ status: 'error', message: 'uid required' });
    }

    // 1) แปลง uid -> user_id
    const { data: user, error: uerr } = await supabase
      .from('users')
      .select('id')
      .eq('uid', uid)
      .single();

    if (uerr || !user) {
      // ไม่พบผู้ใช้ → บอกเป็น 404 ชัดเจน
      return res.status(404).json({ status: 'error', message: 'user_not_found' });
    }

    // 2) ดึงประวัติ — ตัดคอลัมน์ 'text' ออกเพื่อกันชนคำสงวน
    const { data, error } = await supabase
      .from('point_transactions')
      .select('amount, code, type, created_by, created_at') // << no "text"
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      // เพื่อดีบั๊กง่าย ให้ส่งรายละเอียดแบบ non-500 (ไม่ทำให้ modal แดง)
      return res.status(200).json({
        status: 'error',
        message: 'db_error',
        detail: process.env.NODE_ENV === 'production' ? undefined : String(error?.message || error)
      });
    }

    return res.status(200).json({
      status: 'success',
      items: data ?? [],
      nextOffset: offset + (data?.length || 0)
    });
  } catch (e) {
    // กัน 500 ที่อ่านไม่ออก: ส่งรายละเอียดคืน (ยกเว้น production)
    return res.status(200).json({
      status: 'error',
      message: 'unhandled_error',
      detail: process.env.NODE_ENV === 'production' ? undefined : String(e)
    });
  }
};
