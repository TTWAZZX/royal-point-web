// /api/rewards.js  — Supabase version (Vercel Serverless Function)
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  // ใช้ Service Role Key เพราะดึงข้อมูลแบบ Server-to-Server
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

module.exports = async (req, res) => {
  try {
    if (req.method !== 'GET') {
      return res.status(405).json({ status: 'error', message: 'Method Not Allowed' });
    }

    // include=1 → รวมของ inactive ด้วย (ค่าเริ่มต้นของ frontend ตั้งไว้ให้โชว์ทั้งหมด)
    const include = String(req.query.include ?? '1') === '1';

    // ดึงของรางวัลจากตาราง public.rewards
    // ฟิลด์ที่ใช้: id, name, cost, img_url, active, updated_at
    let query = supabase
      .from('rewards')
      .select('id,name,cost,img_url,active,updated_at');

    if (!include) {
      query = query.eq('active', true);
    }

    // จัดลำดับเบื้องต้น: ตาม cost ก่อน แล้วค่อยตาม updated_at
    query = query.order('cost', { ascending: true }).order('updated_at', { ascending: false });

    const { data, error } = await query;
    if (error) throw error;

    // map เป็นรูปแบบที่หน้าเว็บเข้าใจ (ฝั่ง frontend จะอ่าน r.img ถ้ามี)
    const items = (data || []).map(r => ({
      id: r.id,
      name: r.name,
      cost: Number(r.cost) || 0,
      img: r.img_url || '',      // << สำคัญ: ใส่เข้า key 'img'
      active: !!r.active,
      updated_at: r.updated_at || null
    }));

    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');

    return res.status(200).json({ status: 'success', items });
  } catch (err) {
    console.error('[api/rewards] error:', err);
    return res.status(500).json({ status: 'error', message: String(err || 'Internal Error') });
  }
};
