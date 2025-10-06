// /public/js/liff-guard.js
window.setupLiffGuard = async function setupLiffGuard(opts){
  const {
    liffId,
    checkUrl = '/api/get-score',   // ใช้ตรวจ uid ที่มีอยู่แล้ว
    registerPage = '/register.html',
    onReady = ()=>{}
  } = opts || {};

  if(!liffId){
    console.error('[LIFF Guard] Missing liffId');
    alert('Config ผิดพลาด: ไม่พบ LIFF ID');
    return;
  }

  try{
    await liff.init({ liffId });
    if(!liff.isLoggedIn()){
      liff.login();     // กลับมาหน้าเดิมหลัง login
      return;
    }

    const [profile, idToken] = await Promise.all([
      liff.getProfile(),
      liff.getIDToken()
    ]);
    const lineUserId = profile?.userId;

    // ลองอ่าน uid ที่แอปเคยเก็บไว้
    let uid = window.__UID || sessionStorage.getItem('uid');

    // ถ้ายังไม่มี uid ฝั่งแอป ให้ลองสร้างจาก lineUserId (หรือรอหน้า register)
    if(!uid && lineUserId){
      uid = `LINE:${lineUserId}`;
      // ไม่เซฟถาวร จนกว่าจะลงทะเบียนจริง
    }

    // ตรวจว่ามีผู้ใช้นี้ในระบบหรือยัง
    const url = new URL(checkUrl, location.origin);
    url.searchParams.set('uid', uid || '');
    const res = await fetch(url.toString(), { cache:'no-store' });

    if(res.status === 404){
      // ยังไม่ลงทะเบียน → ส่งไปหน้าลงทะเบียน พร้อม path ที่จะกลับ
      const back = encodeURIComponent(location.pathname + location.search);
      const params = new URLSearchParams({ from: back, lineUserId: lineUserId || '' });
      window.location.replace(`${registerPage}?${params.toString()}`);
      return;
    }

    if(!res.ok){
      throw new Error('check failed: ' + res.status);
    }

    const data = await res.json(); // คาดว่า { score, ... } หรือ payloadของคุณ
    if(data?.uid) sessionStorage.setItem('uid', data.uid);

    onReady({ profile, idToken, uid: data?.uid || uid });

  }catch(err){
    console.error('[LIFF Guard] error:', err);
    alert('เกิดข้อผิดพลาดในการยืนยันตัวตน กรุณาลองใหม่');
  }
};
