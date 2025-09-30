export default async function handler(req, res){
  if(req.method!=='POST') return res.status(405).json({status:'error', message:'Method not allowed'});
  try{
    const GAS    = process.env.APPS_SCRIPT_ENDPOINT || process.env.GAS_WEBAPP_URL;
    const SECRET = process.env.API_SECRET;
    if(!GAS || !SECRET) return res.status(500).json({status:'error', message:'Missing env'});
    const { adminUid, id } = req.body || {};
    const form = new URLSearchParams();
    form.set('action','rewards-delete');
    form.set('adminUid', adminUid||'');
    form.set('id', id||'');
    form.set('secret', SECRET);
    const r = await fetch(GAS, { method:'POST', body:form });
    const t = await r.text();
    let j; try{ j = JSON.parse(t); }catch{ j = {status:r.ok?'success':'error', message:t}; }
    res.status(200).json(j);
  }catch(e){ res.status(500).json({status:'error', message:String(e)}); }
}
