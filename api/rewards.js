export default async function handler(req, res){
  try{
    const GAS    = process.env.APPS_SCRIPT_ENDPOINT || process.env.GAS_WEBAPP_URL;
    const SECRET = process.env.API_SECRET;
    if(!GAS || !SECRET) {
      return res.status(500).json({status:'error', message:'Missing APPS_SCRIPT_ENDPOINT (or GAS_WEBAPP_URL) or API_SECRET'});
    }

    const u = new URL(GAS);
    u.searchParams.set('action','rewards');
    u.searchParams.set('secret', SECRET);           // ← จำเป็น เพราะ Server.gs requireAuth_()

    // ส่ง uid ไปด้วยเพื่อให้ admin ดู inactive ได้ (Server.gs จะเช็ค isAdmin_(uid))
    const uid = req.query.uid || '';
    if (uid) u.searchParams.set('uid', uid);

    const r = await fetch(u.toString());
    const t = await r.text();
    let j; try{ j = JSON.parse(t); }catch{ j = {status:r.ok?'success':'error', message:t}; }
    return res.status(200).json(j);
  }catch(e){
    return res.status(500).json({status:'error', message:String(e)});
  }
}
