// /public/js/liff-guard.js  (fixed: no redirect; open register modal instead)
window.setupLiffGuard = async function setupLiffGuard(opts) {
  const {
    liffId,
    checkUrl = '/api/get-score',     // API เช็คผู้ใช้
    // registerPage: null,            // ไม่ใช้แล้ว (กัน redirect 404)
    onReady = () => {},              // callback เมื่อเป็นผู้ใช้เก่า/พร้อมใช้งาน
    onNeedRegister = null            // (ถ้ามี) callback กรณีต้องลงทะเบียน
  } = opts || {};

  if (!liffId) {
    console.error('[LIFF Guard] Missing liffId');
    alert('Config ผิดพลาด: ไม่พบ LIFF ID');
    return;
  }

  try {
    await liff.init({ liffId });
    if (!liff.isLoggedIn()) {
      liff.login(); // กลับมาหน้าเดิมหลัง login
      return;
    }

    const [profile, idToken] = await Promise.all([
      liff.getProfile(),
      liff.getIDToken()
    ]);
    const lineUserId = profile?.userId || '';

    // ใช้ uid จากแอป ถ้าไม่มีให้ใช้ lineUserId ตรง ๆ
    let uid = window.__UID || sessionStorage.getItem('uid') || lineUserId;
    window.__UID = uid;
    sessionStorage.setItem('uid', uid);

    // ตรวจว่ามีผู้ใช้นี้แล้วหรือยัง
    const url = new URL(checkUrl, location.origin);
    url.searchParams.set('uid', uid || '');
    const res = await fetch(url.toString(), { cache: 'no-store' });

    if (res.status === 404) {
      // ---- ผู้ใช้ใหม่ → เปิด Register Modal ในหน้าเดียว ----
      if (typeof onNeedRegister === 'function') {
        onNeedRegister({ profile, idToken, uid });
        return;
      }
      if (typeof window.showRegisterModal === 'function') {
        window.showRegisterModal(profile);
        return;
      }
      // fallback เผื่อไม่มี modal/handler
      alert('ยังไม่พบผู้ใช้ในระบบ กรุณาลงทะเบียนใหม่');
      return;
    }

    if (!res.ok) {
      throw new Error('check failed: ' + res.status);
    }

    const data = await res.json(); // { status:'success', uid?, data:{...} } (ตาม API ของคุณ)
    if (data?.uid) {
      uid = data.uid;
      window.__UID = uid;
      sessionStorage.setItem('uid', uid);
    }

    // พร้อมทำงานต่อ
    onReady({ profile, idToken, uid });
  } catch (err) {
    console.error('[LIFF Guard] error:', err);
    alert('เกิดข้อผิดพลาดในการยืนยันตัวตน กรุณาลองใหม่');
  }
};
