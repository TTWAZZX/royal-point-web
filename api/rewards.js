// /api/rewards.js  — Supabase version (Vercel Serverless Function)
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

    if (String(req.query.action || '') === 'banners') {
      const { data, error } = await supabase
        .from('ad_banners')
        .select('id,title,alt_text,image_source,image_url,link_url,sort_index,updated_at')
        .eq('active', true)
        .is('deleted_at', null)
        .order('sort_index', { ascending: true })
        .order('created_at', { ascending: true });
      if (error) throw error;
      res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=120');
      return res.status(200).json({
        status: 'success',
        items: (data || []).map(item => ({
          id: item.id,
          title: item.title,
          altText: item.alt_text,
          imageSource: item.image_source,
          imageUrl: item.image_url,
          linkUrl: item.link_url || '',
          sortIndex: Number(item.sort_index) || 0,
          updatedAt: item.updated_at || null
        }))
      });
    }

    const include = String(req.query.include ?? '0') === '1';

    let query = supabase
      .from('rewards')
      .select('id,name,cost,img_url,active,updated_at,stock,stock_max,sort_index'); // ← เพิ่ม sort_index

    if (!include) {
      query = query.eq('active', true);
    }

    query = query
      .order('sort_index', { ascending: true })
      .order('updated_at', { ascending: false });

    const { data, error } = await query;
    if (error) throw error;

    const items = (data || []).map(r => ({
      id: r.id,
      name: r.name,
      cost: Number(r.cost) || 0,
      img: r.img_url || '',
      active: !!r.active,
      updated_at: r.updated_at || null,
      stock: r.stock ?? 0,
      stock_max: r.stock_max ?? 0,
      sort_index: r.sort_index ?? 9999   // ← เพิ่มตรงนี้
    }));

    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');

    return res.status(200).json({ status: 'success', items });
  } catch (err) {
    console.error('[api/rewards] error:', err);
    return res.status(500).json({ status: 'error', message: String(err || 'Internal Error') });
  }
};
