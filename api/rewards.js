const { supabaseAdmin: supabase } = require('../lib/supabase');
const { safeRewardImageUrl } = require('../lib/reward-image');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
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
      res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=30');
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
    if (include) {
      const { AuthError, authenticateRequest, isAdminUid, sendAuthError } = require('../lib/line-auth');
      let uid;
      try {
        ({ uid } = await authenticateRequest(req, { requireToken: true, allowRecovery: false }));
      } catch (error) {
        if (error instanceof AuthError) return sendAuthError(res, error);
        throw error;
      }
      if (!isAdminUid(uid)) {
        return res.status(403).json({ status: 'error', message: 'บัญชีนี้ไม่มีสิทธิ์จัดการของรางวัล' });
      }
    }

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
      img: safeRewardImageUrl(r.img_url) || '',
      active: !!r.active,
      updated_at: r.updated_at || null,
      stock: r.stock ?? 0,
      stock_max: r.stock_max ?? 0,
      sort_index: r.sort_index ?? 9999   // ← เพิ่มตรงนี้
    }));

    return res.status(200).json({ status: 'success', items });
  } catch (err) {
    console.error('[api/rewards] error:', err);
    return res.status(500).json({ status: 'error', message: String(err || 'Internal Error') });
  }
};
