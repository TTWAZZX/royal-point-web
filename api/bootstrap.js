// /api/bootstrap.js
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

module.exports = async (req, res) => {
  try {
    if (req.method !== 'GET') {
      return res.status(405).json({ status: 'error', message: 'Method Not Allowed' });
    }
    const uid = String(req.query.uid || '').trim();
    if (!uid) return res.status(400).json({ status:'error', message:'missing uid' });

    // ดึงคะแนนผู้ใช้ + rewards พร้อมกัน
    const rewardsQ = supabase
      .from('rewards')
      .select('id,slot_index,name,cost,img_url,active,updated_at')
      .eq('active', true)
      .order('slot_index', { ascending: true });

    // แก้ให้ตรงตารางคะแนนของคุณ (เดิมเหมือนใช้ user_points)
    const scoreQ = supabase
      .from('user_points')
      .select('total_points')
      .eq('uid', uid)
      .single();

    const [rewardsRes, scoreRes] = await Promise.all([rewardsQ, scoreQ]);
    if (rewardsRes.error) throw rewardsRes.error;
    if (scoreRes.error && scoreRes.error.code !== 'PGRST116') throw scoreRes.error; // ไม่มีแถวก็ 0

    const rewards = (rewardsRes.data || []).map(r => ({
      id: r.id,
      slot: Number(r.slot_index || 0),
      name: r.name || '',
      cost: Number(r.cost || 0),
      img: r.img_url || '',
      active: !!r.active
    }));

    const score = Number(scoreRes.data?.total_points || 0);

    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    return res.status(200).json({
      status: 'success',
      data: { score, rewards }
    });
  } catch (e) {
    console.error('[api/bootstrap] ', e);
    return res.status(500).json({ status: 'error', message: 'internal' });
  }
};
