/* ============ Royal Point — User App (All-in-One, User Side) ============ */
/** LIFF / API */
const LIFF_ID       = "2007053300-QoEvbXyn";
const API_GET_SCORE = "/api/get-score";
const API_REDEEM    = "/api/redeem";
const API_HISTORY   = "/api/score-history";
const API_SPEND     = "/api/spend";      // หักแต้มเมื่อแลกของรางวัล
/** state & cache (ต้องอยู่ตอนบนของไฟล์) */
let REWARDS_CACHE = [];
let rewardRailBound = false;
let AVATAR_SPARKLED_ONCE = false;

// ===== Helpers: pick UID + try multiple endpoints + render safe =====
let CURRENT_UID =
  window.__UID ||
  localStorage.getItem('uid') ||
  document.querySelector('[data-uid]')?.dataset.uid ||
  '';

// ========== DEBUG UTIL ==========
const DEBUG = true;
const dlog = (...a) => { if (DEBUG) console.log('[RP]', ...a); };

function getArrFromResponse(res) {
  if (Array.isArray(res)) return res;
  if (res && Array.isArray(res.items)) return res.items;
  if (res && Array.isArray(res.data))  return res.data;
  return null;
}

async function tryEndpoints(endpoints, fetchOpts, loadingOpts) {
  for (const url of endpoints) {
    try {
      const res = await Loading.apiFetch(url, fetchOpts, loadingOpts);
      const items = getArrFromResponse(res);
      if (items) {
        console.log('[OK] endpoint:', url, 'sample:', items[0], 'raw:', res);
        return { items, used: url, raw: res };
      }
      console.warn('[No array in payload]', url, res);
    } catch (e) {
      console.warn('[Fetch failed]', url, e);
    }
  }
  throw new Error('all_endpoints_failed');
}

function h(str) {
  return String(str ?? '').replace(/[&<>"']/g, s => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[s]));
}


// ===== Admin allowlist (วางบนสุดของ app.js) =====
const ADMIN_UIDS = [
  "Ucadb3c0f63ada96c0432a0aede267ff9", // ← UID ของคุณ
  // เพิ่ม UID คนอื่น ๆ ได้ที่นี่
];

/** Elements */
const $ = (x)=>document.getElementById(x);
const els = {
  username: $("username"),
  profilePic: $("profilePic"),
  points: $("points"),

  levelBadge: $("levelBadge"),
  currentLevelText: $("currentLevelText"),

  // เส้น progress (แบบเก่า)
  progressBar: $("progressBar"),
  progressFill: $("progressFill"),

  // Track ใหม่ (ถ้ามีในหน้า)
  levelTrack: $("levelTrack"),
  trackFill: $("trackFill"),

  nextTier: $("next-tier"),

  btnRefresh: $("refreshBtn"),
  btnAdmin: $("btnAdmin"),
  btnHistory: $("historyBtn"),

  // โมดัล “สแกน/กรอกรหัส”
  modal: $("scoreModal"),
  qrReader: $("qr-reader"),
  secretInput: $("secretCode"),
  submitBtn: $("submitCodeBtn"),

  // โมดัล “ประวัติ”
  historyModal: $("historyModal"),
  historyList: $("historyList"),
  historyUser: $("historyUser"),
};

/** State */
let UID = "";
let html5qrcode = null;
let prevScore = 0;
let prevLevel = "";

// === Rank state (new)
window.USER_RANK   = window.USER_RANK   ?? null; // อันดับ (อาจไม่มีจาก API)
window.USER_STREAK = window.USER_STREAK ?? 0;    // จำนวนวันติด (อาจไม่มีจาก API)

// ---- Scan / redeem guards ----
let REDEEM_IN_FLIGHT = false;  // กำลังเรียก /api/redeem อยู่หรือไม่
let LAST_DECODE = "";          // ค่าที่สแกนได้ล่าสุด
let LAST_DECODE_AT = 0;        // เวลา (ms) ที่สแกนได้ล่าสุด
const DUP_COOLDOWN = 2500;     // กันยิงค่าซ้ำภายใน X ms

/* ===== UI Overlay & Button Loading (User) ===== */
const UiOverlay = {
  show(text='กำลังดำเนินการ...'){
    const old = document.getElementById('rp-ovl');
    if (old) { old.querySelector('#rp-ovl-text').textContent = text; return; }
    const el = document.createElement('div');
    el.id = 'rp-ovl';
    el.innerHTML = `
      <div class="rp-ovl-card">
        <div class="rp-ovl-spinner"></div>
        <div id="rp-ovl-text" class="rp-ovl-text">${text}</div>
      </div>`;
    document.body.appendChild(el);
  },
  hide(){ document.getElementById('rp-ovl')?.remove(); }
};

function setBtnLoading(btn, on, labelWhenLoading){
  if (!btn) return;
  if (on){
    if (!btn.dataset._html) btn.dataset._html = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML =
      `<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>${labelWhenLoading || 'กำลังทำงาน...'}`;
  }else{
    btn.disabled = false;
    if (btn.dataset._html){ btn.innerHTML = btn.dataset._html; delete btn.dataset._html; }
  }
}

/** Level mapping */
const TIERS = [
  { key:"silver",   name:"Silver",   min:0,   next:500,      class:"rp-level-silver",   progClass:"prog-silver"   },
  { key:"gold",     name:"Gold",     min:500, next:1200,     class:"rp-level-gold",     progClass:"prog-gold"     },
  { key:"platinum", name:"Platinum", min:1200,next:Infinity, class:"rp-level-platinum", progClass:"prog-platinum" },
];
const TIER_EMOJI = { Silver:"🥈", Gold:"🥇", Platinum:"💎" };

/* ================= Boot ================= */
function setAppLoading(on){
  document.body.classList.toggle('loading', !!on);
  const sk = document.getElementById('appSkeleton');
  if (sk) sk.style.display = on ? 'block' : 'none';
}
document.addEventListener("DOMContentLoaded", () => { setAppLoading(true); });
document.addEventListener("DOMContentLoaded", initApp);

// ==== Admin FAB control (copy-paste) ====
// ตั้ง whitelist ไว้ในไฟล์นี้ก่อน (เพิ่ม/ลบได้ตามต้องการ)
const LOCAL_ADMIN_UIDS = [
  'Ucadb3c0f63ada96c0432a0aede267ff9', // <- UID ของคุณ
  // 'Uxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', // เพิ่มคนอื่นได้
];

// ตัวช่วย: ตรวจสิทธิ์จาก server ถ้ามี endpoint ให้ใช้ (optional)
async function checkAdminFromServer(uid) {
  try {
    // ถ้ามี endpoint จริงให้แก้ URL ตรงนี้ เช่น /api/admin-check?uid=
    const r = await fetch(`/api/admin-check?uid=${encodeURIComponent(uid)}`, { cache: 'no-store' });
    if (!r.ok) return false;
    const j = await r.json();
    // รองรับหลายรูปแบบผลลัพธ์
    return !!(j?.isAdmin || j?.data?.isAdmin || j?.role === 'admin' || j?.status === 'ok' && j?.admin === true);
  } catch (_) {
    return false;
  }
}

// ฟังก์ชันหลัก: แสดง/ซ่อนปุ่ม Admin
async function showAdminFabIfAuthorized() {
  const btn = document.getElementById('btnAdmin');
  if (!btn) return;

  const uid = window.__UID || sessionStorage.getItem('uid') || '';
  if (!uid) { btn.classList.add('d-none'); return; }

  // 1) เช็คจาก whitelist ในไฟล์ก่อน
  let ok = LOCAL_ADMIN_UIDS.includes(uid);

  // 2) ถ้าไม่ผ่าน whitelist ลองขอจาก server (ถ้ามี)
  if (!ok) ok = await checkAdminFromServer(uid);

  // 3) แสดง/ซ่อนปุ่ม
  if (ok) {
    btn.classList.remove('d-none');
    btn.style.display = '';         // เผื่อมี style display:none ที่อื่น
    btn.href = '/admin.html';       // ย้ำ path
    btn.title = 'ไปหน้าแอดมิน';
  } else {
    btn.classList.add('d-none');
  }
}

// (เผื่อโค้ดเก่าของคุณเรียกชื่อเดิม)
window.showAdminEntry = showAdminFabIfAuthorized;

// ===== LIFF bootstrap helper =====
window.ensureLiffInit = async function ensureLiffInit(LIFF_ID){
  if (!window.liff) throw new Error('LIFF SDK not loaded');
  if (window.__LIFF_INITED) return true;

  // กันเรียกซ้ำซ้อนหลายที่พร้อมกัน
  if (window.__LIFF_INITING) { 
    await window.__LIFF_INITING; 
    return true; 
  }

  if (!LIFF_ID || typeof LIFF_ID !== 'string') {
    throw new Error('Missing LIFF_ID');
  }

  window.__LIFF_INITING = (async () => {
    await liff.init({ liffId: LIFF_ID });
    window.__LIFF_INITED = true;
  })();

  await window.__LIFF_INITING;
  return true;
};

// ===== REPLACE WHOLE FUNCTION: initApp =====
async function initApp(ctx = {}) {
  try {
    // ใช้ค่า LIFF_ID ตัวจริงที่ประกาศไว้ตอนบนไฟล์ (ไม่ต้องประกาศใหม่ในฟังก์ชันนี้)
    await ensureLiffInit(LIFF_ID);

    // 2) resolve UID/PROFILE
    let uid  = ctx.uid || window.__UID || sessionStorage.getItem('uid');
    let prof = ctx.profile || null;

    if (liff.isLoggedIn()) {
      if (!prof) prof = await liff.getProfile().catch(() => null);
      if (!uid)  uid  = prof?.userId || '';
    } else {
      liff.login();
      return;
    }

    if (uid) {
      window.__UID = uid;
      sessionStorage.setItem('uid', uid);
    }

    // 3) preflight check
    const GET_SCORE = (u) => `/api/get-score?uid=${encodeURIComponent(u)}`;
    const resp = await fetch(GET_SCORE(uid), { method: 'GET', cache: 'no-store' });
    if (resp.status === 404) {
      if (typeof window.showRegisterModal === 'function') return window.showRegisterModal(prof || null);
      console.warn('showRegisterModal() not found');
      return;
    }
    if (!resp.ok) throw new Error(`get-score failed: ${resp.status}`);

    const payload = await resp.json(); // { status, data:{ user, score, updated_at } }

    // 4) seed UI with profile
    if (prof) {
      const nameEl = document.getElementById('username');
      if (nameEl && !nameEl.dataset.locked) nameEl.textContent = prof.displayName || nameEl.textContent;
      const picEl = document.getElementById('profilePic');
      if (picEl && prof.pictureUrl) picEl.src = prof.pictureUrl;
    }

    // 5) โหลดข้อมูลหลัก
    if (typeof refreshUserScore === 'function') await refreshUserScore();
    if (typeof loadRewards === 'function') await loadRewards();
    if (typeof renderRewards === 'function') {
      const s = (typeof window.prevScore === 'number')
        ? window.prevScore
        : (typeof payload?.data?.score !== 'undefined' ? Number(payload.data.score || 0) : 0);
      renderRewards(s);
    }

    // 6) one-time binds
    if (!window.__MAIN_BOUND) {
      window.__MAIN_BOUND = true;

      // รีเฟรช
      document.getElementById('refreshBtn')?.addEventListener('click', async () => {
        try {
          await ensureLiffInit(LIFF_ID);
          await fetch(`/api/get-score?uid=${encodeURIComponent(window.__UID)}`, { method: 'GET', cache: 'no-store' });
          if (typeof refreshUserScore === 'function') await refreshUserScore();
          if (typeof loadRewards === 'function') await loadRewards();
          if (typeof renderRewards === 'function') renderRewards(Number(window.prevScore || 0));
        } catch (e) {
          console.error(e);
          window.Swal ? Swal.fire('ผิดพลาด','โหลดข้อมูลไม่สำเร็จ','error') : alert('โหลดข้อมูลไม่สำเร็จ');
        }
      });

      // ประวัติ
      document.getElementById('historyBtn')?.addEventListener('click', () => {
        openHistory && openHistory();
      });

      // สแกน/หยุด + lifecycle ของโมดัล
      document.getElementById('startScanBtn')?.addEventListener('click', () => startScanner && startScanner());
      document.getElementById('stopScanBtn') ?.addEventListener('click', () => stopScanner  && stopScanner());
      const scanModalEl = document.getElementById('scoreModal');
      if (scanModalEl) {
        scanModalEl.addEventListener('shown.bs.modal',  () => startScanner && startScanner());
        scanModalEl.addEventListener('hide.bs.modal',   () => stopScanner  && stopScanner());
        scanModalEl.addEventListener('hidden.bs.modal', () => stopScanner  && stopScanner());
      }

      // ยืนยันรหัสรับคะแนน
      document.getElementById('submitCodeBtn')?.addEventListener('click', async () => {
        const code = (document.getElementById('secretCode')?.value || '').trim();
        if (!code) return toastErr && toastErr('กรอกรหัสลับก่อน');
        await redeemCode && redeemCode(code, 'MANUAL');
      });
    }

    // แสดงปุ่มแอดมิน (ถ้ามีฟังก์ชันนี้)
    if (typeof showAdminFabIfAuthorized === 'function') showAdminFabIfAuthorized();

  } catch (err) {
    console.error('[initApp] error:', err);
    window.Swal ? Swal.fire('ผิดพลาด','เริ่มต้นระบบไม่สำเร็จ','error') : alert('เริ่มต้นระบบไม่สำเร็จ');
  }
}

// ===== QR Scanner (html5-qrcode) =====
let QR_INSTANCE = null;
let SCANNING = false;
let TORCH_ON = false;

async function ensureCameraPermission() {
  if (!navigator.mediaDevices?.getUserMedia) {
    const e = new Error('browser_no_getUserMedia');
    e.userMessage = 'เบราว์เซอร์นี้ไม่รองรับกล้อง';
    throw e;
  }
  try {
    const s = await navigator.mediaDevices.getUserMedia({ video: true });
    s.getTracks().forEach(t => t.stop());
    return true;
  } catch (err) {
    err.userMessage = 'ไม่ได้รับสิทธิ์ใช้งานกล้อง';
    throw err;
  }
}

async function startScanner() {
  try { await ensureCameraPermission(); }
  catch (e) { return toastErr(e.userMessage || 'ใช้กล้องไม่ได้'); }

  const hostId = 'qr-reader';
  const el = document.getElementById(hostId);
  if (!el) return;

  if (!QR_INSTANCE) QR_INSTANCE = new Html5Qrcode(hostId);
  if (SCANNING) return;

  // เลือกกล้องหลังถ้ามี
  let cameraId = undefined;
  try {
    const cams = await Html5Qrcode.getCameras();
    const back = cams.find(c => /back|หลัง|environment/i.test(c.label)) || cams[0];
    cameraId = back?.id || back?.deviceId;
  } catch {}

  const config = {
    fps: 10,
    qrbox: { width: 280, height: 280 },
    rememberLastUsedCamera: true,
    aspectRatio: 1.0
  };

  const onScanSuccess = async (text /*, result */) => {
    const now = Date.now();
    if (text === window.LAST_DECODE && now - (window.LAST_DECODE_AT||0) < 2500) return;
    window.LAST_DECODE = text; window.LAST_DECODE_AT = now;
    await redeemCode(text, 'SCAN');
  };
  const onScanError = () => {};

  try {
    await QR_INSTANCE.start(cameraId || { facingMode: "environment" }, config, onScanSuccess, onScanError);
    SCANNING = true;

    // ตั้งค่าไฟฉาย (ถ้าอุปกรณ์รองรับ)
    const torchBtn = document.getElementById('torchBtn');
    try {
      const caps = QR_INSTANCE.getRunningTrackCapabilities?.();
      if (torchBtn) torchBtn.disabled = !(caps && 'torch' in caps);
    } catch { if (torchBtn) torchBtn.disabled = true; }
  } catch (err) {
    console.error('startScanner failed:', err);
    toastErr('เปิดกล้องไม่สำเร็จ');
  }
}

async function stopScanner() {
  try {
    const torchBtn = document.getElementById('torchBtn');
    if (torchBtn) torchBtn.disabled = true;
    TORCH_ON = false;

    if (QR_INSTANCE) {
      await QR_INSTANCE.stop();
      await QR_INSTANCE.clear();
    }
  } catch (e) {
    console.warn('stopScanner:', e);
  } finally {
    SCANNING = false;
  }
}

async function toggleTorch(on) {
  try {
    const ok = await QR_INSTANCE?.applyVideoConstraints?.({ advanced: [{ torch: !!on }] });
    TORCH_ON = !!on;
    const torchBtn = document.getElementById('torchBtn');
    if (torchBtn) torchBtn.classList.toggle('active', TORCH_ON);
    return ok;
  } catch (e) {
    console.warn('toggleTorch:', e);
    throw e;
  }
}

function bindUI(){
  // ปุ่มรีเฟรชคะแนน
  els.btnRefresh && els.btnRefresh.addEventListener("click", refreshUserScore);

  // ปุ่มประวัติ
  els.btnHistory && els.btnHistory.addEventListener("click", openHistory);

  // ✅ ควบคุมกล้องในโมดัล (ใช้ id ที่ถูกต้อง: #scoreModal)
  const scanModalEl = document.getElementById('scoreModal');
  if (scanModalEl) {
    // เปิดโมดัลแล้วเริ่มกล้องอัตโนมัติ
    scanModalEl.addEventListener('shown.bs.modal', () => { startScanner && startScanner(); });
    // ปิด/กำลังปิด → หยุดกล้อง
    scanModalEl.addEventListener('hide.bs.modal',   () => { stopScanner && stopScanner(); });
    scanModalEl.addEventListener('hidden.bs.modal', () => { stopScanner && stopScanner(); });
  }

  // ปุ่ม start/stop (ควบคุมมือได้)
  const startBtn = document.getElementById("startScanBtn");
  const stopBtn  = document.getElementById("stopScanBtn");
  startBtn && startBtn.addEventListener("click", () => startScanner && startScanner());
  stopBtn  && stopBtn .addEventListener("click", () => stopScanner  && stopScanner());

  // ปุ่มไฟฉาย
  const torchBtn = document.getElementById("torchBtn");
  if (torchBtn){
    torchBtn.addEventListener("click", async ()=>{
      try {
        await toggleTorch(!TORCH_ON);
        navigator.vibrate?.(8);
      } catch(e){
        toastErr("อุปกรณ์นี้ไม่รองรับไฟฉาย");
      }
    });
  }

  // ✅ ปุ่ม “ยืนยันรับคะแนน” (กรอกรหัสลับ)
  els.submitBtn && els.submitBtn.addEventListener("click", async ()=>{
    const code = (els.secretInput?.value || "").trim();
    if(!code) return toastErr("กรอกรหัสลับก่อน");
    if (REDEEM_IN_FLIGHT) return;

    REDEEM_IN_FLIGHT = true;
    setBtnLoading(els.submitBtn, true, 'กำลังยืนยัน…');
    UiOverlay.show('กำลังยืนยันรหัส…');

    try { await redeemCode(code, "MANUAL"); }
    finally {
      setBtnLoading(els.submitBtn, false);
      UiOverlay.hide();
      setTimeout(()=>{ REDEEM_IN_FLIGHT = false; }, 300);
    }
  });

  // export ฟังก์ชันกล้องให้เรียกได้จากภายนอกด้วย (เช่นใน HTML)
  window.startScanner = startScanner;
  window.stopScanner  = stopScanner;
}

// === Last updated (หนึ่งเดียว ใช้ได้ทั้งปุ่มรีเฟรช และ #lastUpdated) ===
function setLastUpdated(ts = Date.now(), fromCache = false){
  // 1) อัปเดต tooltip ของปุ่มรีเฟรช
  const btn = document.getElementById('refreshBtn');
  if (btn){
    const d = new Date(ts);
    const text = `${fromCache ? 'อัปเดตจากแคช' : 'อัปเดตล่าสุด'}: ` +
      d.toLocaleString('th-TH', {
        year:'numeric', month:'2-digit', day:'2-digit',
        hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false
      });
    btn.setAttribute('title', text);
    btn.setAttribute('data-bs-original-title', text);
    try {
      let tip = bootstrap.Tooltip.getInstance(btn);
      if (!tip) tip = new bootstrap.Tooltip(btn);
      if (typeof tip.setContent === 'function') tip.setContent({ '.tooltip-inner': text });
      else tip.update();
    } catch {}
  }

  // 2) ถ้ามี #lastUpdated หรือ [data-last-updated] → อัปเดตข้อความด้วย
  const el = document.querySelector('#lastUpdated, [data-last-updated]');
  if (el){
    const d = new Date(ts);
    el.classList.remove('hidden');
    el.textContent = `${fromCache ? '(แคช) ' : ''}อัปเดตล่าสุด ` +
      d.toLocaleString('th-TH', { hour:'2-digit', minute:'2-digit', hour12:false });
  }
}
window.setLastUpdated = setLastUpdated;

// ---- OVERRIDE: ซ่อนข้อความ "อัปเดตล่าสุด" บนหัวโปรไฟล์ แต่คง tooltip ของปุ่มรีเฟรช ----
(function(){
  // เก็บฟังก์ชันเดิมไว้เผื่ออนาคต (ตอนนี้ยังไม่เรียกกลับ เพราะเดี๋ยวมันจะไปใส่ข้อความคืน)
  const _orig = window.setLastUpdated;

  window.setLastUpdated = function(ts = Date.now(), fromCache = false){
    // 1) อัปเดต tooltip ของปุ่มรีเฟรชตามเดิม (เผื่ออยากชี้เมาส์ดูเวลาได้)
    const btn = document.getElementById('refreshBtn');
    if (btn){
      const d = new Date(ts);
      const text =
        `${fromCache ? 'อัปเดตจากแคช' : 'อัปเดตล่าสุด'}: ` +
        d.toLocaleString('th-TH', {
          year:'numeric', month:'2-digit', day:'2-digit',
          hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false
        });

      btn.setAttribute('title', text);
      btn.setAttribute('data-bs-original-title', text);
      try {
        let tip = bootstrap.Tooltip.getInstance(btn);
        if (!tip) tip = new bootstrap.Tooltip(btn);
        if (typeof tip.setContent === 'function') {
          tip.setContent({ '.tooltip-inner': text });   // Bootstrap 5.3+
        } else {
          tip.update();                                  // Bootstrap 5.0–5.2
        }
      } catch {}
    }

    // 2) ล้าง/ซ่อนข้อความบนหัวโปรไฟล์
    const el = document.querySelector('#lastUpdated, [data-last-updated]');
    if (el){
      el.textContent = '';         // ล้างข้อความ
      el.classList.add('hidden');  // ถ้ามี CSS .hidden อยู่แล้วจะหายทันที
      // ถ้าอยากลบออกจาก DOM เลย ให้ใช้บรรทัดล่างแทน:
      // el.remove();
    }

    // 3) ไม่เรียก _orig(ts, fromCache) เพราะของเดิมจะไปเขียนข้อความทับกลับมาอีกรอบ
  };
})();

// ===== REPLACE WHOLE FUNCTION: showAdminEntry =====
function showAdminEntry(isAdmin) {
  try {
    // ถ้าไม่ได้ส่ง isAdmin มา ให้คำนวณจาก UID ปัจจุบันเอง
    if (typeof isAdmin === 'undefined') {
      const uid =
        (typeof UID !== 'undefined' && UID) ||
        window.__UID ||
        localStorage.getItem('uid') || '';
      isAdmin = ADMIN_UIDS.includes(uid);
    }

    const btn = document.getElementById('btnAdmin');
    if (!btn) return; // ไม่มีปุ่มก็ข้าม

    btn.classList.toggle('d-none', !isAdmin);
  } catch (e) {
    console.warn('[admin-gate] error:', e);
  }
}


function toastOk(msg){ return window.Swal ? Swal.fire("สำเร็จ", msg || "", "success") : alert(msg || "สำเร็จ"); }
function toastErr(msg){ return window.Swal ? Swal.fire("ผิดพลาด", msg || "", "error") : alert(msg || "ผิดพลาด"); }

// ===== refreshUserScore (patched) =====
async function refreshUserScore(){
  const uid =
    (typeof UID !== 'undefined' && UID) ||
    window.__UID ||
    localStorage.getItem('uid') ||
    '';

  // ไม่มี uid → รีเซ็ตแบบปลอดภัย
  if (!uid) {
    console.warn('[refreshUserScore] missing uid');
    if (els?.points) els.points.textContent = '0';
    document.getElementById('xpPair')
      ?.replaceChildren(document.createTextNode('0 / 0 คะแนน'));
    try { window.setLastUpdated?.(true); } catch {}
    return;
  }

  // helper: ดึง score จาก payload หลายทรง
  const pickScore = (o) => {
    if (!o || typeof o !== 'object') return null;
    const cands = [
      o.score, o.points, o.point, o.balance, o.total,
      o?.data?.score, o?.data?.points, o?.data?.balance, o?.data?.total
    ];
    for (const v of cands) {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
    return null;
  };

  let fromCache = false, data = null;

  // 1) ลองเรียก API ปกติ
  try{
    const res  = await fetch(`${API_GET_SCORE}?uid=${encodeURIComponent(uid)}`, { cache: 'no-store' });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json || json?.status === 'error') {
      throw new Error(json?.message || `HTTP ${res.status}`);
    }
    data = json;
  }catch(e){
    console.warn('[refreshUserScore] fetch failed → use cache if any', e);
    // 2) fallback: ใช้แคชในหน่วยความจำ
    if (Number.isFinite(Number(window.__userBalance))) {
      data = { score: Number(window.__userBalance) };
      fromCache = true;
    }
  }

  // ถ้าไม่มีข้อมูลเลย
  if (!data) {
    if (els?.points) els.points.textContent = '0';
    document.getElementById('xpPair')
      ?.replaceChildren(document.createTextNode('0 / 0 คะแนน'));
    try { window.setLastUpdated?.(true); } catch {}
    return;
  }

  const newScore = pickScore(data) ?? 0;

  // --- commit state (อย่าเซ็ต prevScore ตรงนี้) ---
  window.__userBalance = newScore;

  // อัปเดตการ์ดโปรไฟล์/ธีม/แถบ ฯลฯ ให้ครบ ผ่าน setPoints()
  try { setPoints(newScore); } catch (e) { console.warn('setPoints failed', e); }

  // ===== คำนวณคู่ตัวเลขความคืบหน้า: cur / max (fallback ถ้า API ไม่ให้) =====
  let need = Number(data?.need ?? data?.next_need);
  let cur  = Number(data?.current ?? newScore);
  let max  = Number(data?.max ?? data?.target);

  if (!Number.isFinite(max) || max <= 0) {
    try {
      const tier = (typeof getTier === 'function') ? getTier(newScore) : null; // {min, next}
      if (tier && Number.isFinite(tier.next)) {
        max  = tier.next;
        cur  = newScore;
        need = Math.max(0, tier.next - newScore);
      } else {
        max  = newScore || 1;
        cur  = newScore;
        need = 0;
      }
    } catch {
      max  = newScore || 1;
      cur  = newScore;
      need = 0;
    }
  }

  const pair = document.getElementById('xpPair');
  if (pair) pair.textContent = `${cur} / ${max} คะแนน`;

  // ตราประทับเวลา/ทูลทิป “อัปเดตล่าสุด”
  try { window.setLastUpdated?.(Date.now(), fromCache); } catch {}
}

/* ===== Next-tier chip (always visible) ===== */
function updateTierStatus(score){
  // host: ใช้ .rp-status-center ถ้ามี ไม่งั้นสร้างใต้ .rp-progress-area
  const host = document.querySelector('.rp-status-center') || (()=>{
    const h = document.createElement('div');
    h.className = 'rp-status-center mt-1';
    document.querySelector('.rp-progress-area')?.insertAdjacentElement('afterend', h);
    return h;
  })();

  // element: #tierStatus ถ้าไม่มีให้สร้าง
  let el = document.getElementById('tierStatus');
  if (!el){
    el = document.createElement('span');
    el.id = 'tierStatus';
    el.className = 'status-chip';
    host.appendChild(el);
  }

  // คำนวณข้อความชิป
  const s = Number(score || 0);
  const t = getTier(s);                      // { key, name, min, next, ... }
  const hasNext = Number.isFinite(t.next) && t.next > s;

  if (hasNext){
    const remain   = Math.max(0, Math.round(t.next - s));
    const nextName = (getTier(t.next)?.name) || 'ระดับถัดไป';
    const emoji    = (window.TIER_EMOJI && TIER_EMOJI[nextName]) || '';
    el.textContent = `สะสมอีก ${remain.toLocaleString('th-TH')} คะแนน → เลื่อนเป็น ${nextName} ${emoji}`;
  } else {
    el.textContent = '✨ Max Level';
  }

  // บังคับให้มองเห็นเสมอ
  el.style.opacity = '1';
  el.classList.remove('hidden','d-none');   // เผื่อมีคลาสเดิมหลงเหลือ
}

// อัปเดต UI ทั้งหมดจาก "คะแนนเดียว"
function setPoints(score){
  score = Number(score || 0);

  // ---- Tier / Theme ----
  const tier = getTier(score); // { key, name, min, next, progClass }

  if (typeof applyPremiumTheme === 'function') applyPremiumTheme(tier.key);
  if (typeof setAvatarArc      === 'function') setAvatarArc(score);

  // ---- ชื่อ/ป้ายระดับ & ไอคอนต่าง ๆ ----
  if (typeof setTierUI === 'function') setTierUI(tier, score);

  // ---- ตัวเลขคะแนน (เด้งนุ่ม ๆ) ----
  if (els?.points){
    const from = (typeof prevScore === 'number')
      ? prevScore
      : Number(els.points.textContent || 0);

    if (from !== score) animateCount(els.points, from, score, 600);
  }
  if (typeof bumpScoreFx === 'function') bumpScoreFx();

  // ---- Progress bar สี + ความกว้าง ----
  if (els?.progressBar){
    els.progressBar.classList.remove('prog-silver','prog-gold','prog-platinum');
    els.progressBar.classList.add(tier.progClass);
  }
  if (els?.progressFill){
    const pct = (tier.next === Infinity)
      ? 1
      : (score - tier.min) / (tier.next - tier.min);
    els.progressFill.style.width = `${Math.max(0, Math.min(100, pct * 100))}%`;
  }

  // ---- คู่ตัวเลข XP ใต้แถบ ----
  if (typeof setXpPair === 'function') setXpPair(score);
  if (typeof bumpXpFill === 'function') bumpXpFill();

  // ---- ชิป "สะสมอีก X คะแนน → เลื่อนเป็น ..." (โชว์ตลอด) ----
  if (typeof updateTierStatus === 'function') {
    try { updateTierStatus(score); } catch(e) { console.warn(e); }
  }

  // ---- เอฟเฟกต์/ส่วนเสริมอื่น ๆ (ถ้ามีฟังก์ชัน) ----
  if (typeof applyXpThemeByTier === 'function') applyXpThemeByTier(tier.key);
  if (typeof updateLevelTrack   === 'function') updateLevelTrack(score);
  if (typeof updatePremiumBar   === 'function') updatePremiumBar(score);
  if (typeof renderRewards      === 'function') renderRewards(score);

  // เปลี่ยนเลเวล → ปล่อยคอนเฟตติ
  if (typeof prevLevel !== 'undefined' && prevLevel && prevLevel !== tier.key){
    try { launchConfetti(); } catch {}
  }

  // ป้ายอันดับ (ถ้ามี)
  if (typeof setRankBadge === 'function') setRankBadge(window.USER_RANK, tier.key);

  // ---- commit state ----
  prevLevel = tier.key;
  prevScore = score;
}

function setRankBadge(rank, tierKey){
  const avatar = document.getElementById("rpAvatar");
  const rankText = document.getElementById("rankText");
  if(!avatar || !rankText) return;

  // เคลียร์ tier เดิม แล้วใส่ใหม่
  avatar.classList.remove("tier-silver","tier-gold","tier-platinum");
  const map = { silver:"tier-silver", gold:"tier-gold", platinum:"tier-platinum" };
  avatar.classList.add(map[tierKey] || "tier-silver");

  // จัดการโชว์/ซ่อนป้าย และเซ็ตข้อความ
  const badgeEl = avatar.querySelector(".rp-rank-badge");
  if(!badgeEl) return;
  if(rank == null || rank === ""){
    badgeEl.style.display = "none";
  }else{
    badgeEl.style.display = "inline-flex";
    rankText.textContent = `#${rank}`;
  }
}

function applyXpThemeByTier(tierKey){
  const xpWrap = document.querySelector('.xp-wrap');
  if (!xpWrap) return;
  const colors = {
    silver:   ['#cfd8dc','#eceff1'],
    gold:     ['#ffd166','#ffb703'],
    platinum: ['#b3e5fc','#e0f7fa']
  };
  const [a,b] = colors[tierKey] || colors.silver;
  xpWrap.style.setProperty('--ring-a', a);
  xpWrap.style.setProperty('--ring-b', b);
}

/* ===== Rewards (dynamic) — FULL BLOCK (replace old one) ===== */
const API_REWARDS = "/api/rewards";

/** ลำดับคะแนน 44 ช่อง (ตามที่กำหนด) */
const COST_ORDER = [
  40, 50, 60, 70, 80,
  100,100,100,100,
  120,120,120,120,
  150,180,200, 150,180,200,200,
  220,230,
  250,250,250,250,250,250,
  350,380,
  400,400,400,400,400,400,
  450,500,500,
  600,700,800,900,1000
];

/* ========= Reward Images (Frontend Mapping) ========= */
/** อ้างด้วย ID ของรางวัล (ใช้เมื่อรู้ id ที่แน่ชัด เช่น R01-40) */
const IMAGE_BY_ID = {
  // ตัวอย่าง (ถ้าคุณใช้ id รูปแบบนี้อยู่)
  // "R01-40": "https://lh3.googleusercontent.com/d/1o_VHWrIuc9o56MCRuzjrycB8W5w_dT5d",
  // "R02-50": "https://lh3.googleusercontent.com/d/1vEP5DqyX0vgkv3_XDAyLxJpLm3zUtrqR",
  // "R03-60": "https://lh3.googleusercontent.com/d/1Ve6_BNWlL59BdQXaTLdxdvX4iLYomUyX",
};

/** ใส่รูปตามลำดับ “ช่อง” 1–44 (index เริ่ม 0)
 *  ด้านล่างเป็น URL จำลองด้วย placehold.co — เปลี่ยนเป็นลิงก์จริงของคุณเมื่อพร้อม
 */
// วางแทน const IMAGE_BY_INDEX = [ ... ] เดิมทั้งหมด
const IMAGE_BY_INDEX = [
  "https://lh3.googleusercontent.com/d/1tzYzZvuVWNiXT2wccYMI0UFh6lRTkbJ6", // 01 → 40 pt
  "https://lh3.googleusercontent.com/d/1uom60jA2Ro0Yy-OGVaedm8mdKULxCFEE", // 02 → 50 pt
  "https://lh3.googleusercontent.com/d/1ewIghQ5BclphzBErZuozCv7Z7BCyT2lN", // 03 → 60 pt
  "https://lh3.googleusercontent.com/d/14QUnoEEuIjhlOP2z-BD40lGUXuzCSB3r", // 04 → 70 pt
  "https://lh3.googleusercontent.com/d/1XolP2GN-VZHe89TEGBIzw-w0Ryy_aYAc", // 05 → 80 pt
  "https://lh3.googleusercontent.com/d/1aT21MZZNHdS3CRfkrLjna1JiX4A9Rn-M", // 06 → 100 pt
  "https://lh3.googleusercontent.com/d/1lhcANAqeHQ13XEkL467_yC7omadhcZZn", // 07 → 100 pt
  "https://lh3.googleusercontent.com/d/1t6B9XMNuUvaBBjo818ZKqhc5nmCx2vdO", // 08 → 100 pt
  "https://lh3.googleusercontent.com/d/1Ky0gv6_m61S49_KHqNQE_2X30RmcDLj8", // 09 → 100 pt
  "https://lh3.googleusercontent.com/d/19T7uXQVgQgLwT0VQ117PdMFSgyuzqOVI", // 10 → 120 pt
  "https://lh3.googleusercontent.com/d/1TXLYFAu9ZvCko0360qxJTi1Pd4GKdIWb", // 11 → 120 pt
  "https://lh3.googleusercontent.com/d/1svMqu3Ge2GjalHmqVllY-ndA-heXpYIX", // 12 → 120 pt
  "https://lh3.googleusercontent.com/d/1zemY7NwelAuduqvM3e0Wi8WmXBndHwB-", // 13 → 120 pt
  "https://lh3.googleusercontent.com/d/1D4GGczCWdRrHbmP7A_3Gfs6_fr_KS90i", // 14 → 150 pt
  "https://lh3.googleusercontent.com/d/1y9KbZYWmj53QF2_OPj7lid8HRvsUxJe3", // 15 → 180 pt
  "https://lh3.googleusercontent.com/d/1WodL4DLw45xdPb6pg28d_mXVOldOpvjN", // 16 → 200 pt
  "https://lh3.googleusercontent.com/d/1zoQBfcoJ_xXXz5CEWTTMJbXH6jw0RXWq", // 17 → 150 pt
  "https://lh3.googleusercontent.com/d/12SMtYCokS2X8WhwS2J0azlDlA-iphZYO", // 18 → 180 pt
  "https://lh3.googleusercontent.com/d/13M8mpNwCeEWL_kRJ-xHvwTQHUS4H0CON", // 19 → 200 pt
  "https://lh3.googleusercontent.com/d/1psxmP2KcMddkRJ0CXHus19DZvMTedev_", // 20 → 200 pt
  "https://lh3.googleusercontent.com/d/1twHwdnz0s71pvRjETIA9cooAxFONQdtz", // 21 → 220 pt
  "https://lh3.googleusercontent.com/d/1lYz3T8FwFGQBEo5oBlEbx598klaRwwEe", // 22 → 230 pt
  "https://lh3.googleusercontent.com/d/1fW2MftUbOncqpandHSglzTzzD3DaX8HD", // 23 → 250 pt
  "https://lh3.googleusercontent.com/d/1X59mn0tSd3nK6KTOltbNcmqeVlTnEB-S", // 24 → 250 pt
  "https://lh3.googleusercontent.com/d/19_UOzuEjbI9DeYqdrp6Rt_WRgpR7ncrf", // 25 → 250 pt
  "https://lh3.googleusercontent.com/d/1UUuLYzIePqrfU08HPT30o6JxtBpGr8m7", // 26 → 250 pt
  "https://lh3.googleusercontent.com/d/1YgutbniKKkjsGOCs4u2S3ThvAELzse9r", // 27 → 250 pt
  "https://lh3.googleusercontent.com/d/1NQy15RAK0qLu267rAFRiRR-uMtBATSr_", // 28 → 250 pt
  "https://lh3.googleusercontent.com/d/1VGi5BEfa2-Bk5WZw_Wf_EDCHT52x_l55", // 29 → 350 pt
  "https://lh3.googleusercontent.com/d/1PGbkV97OS_wkGz7vWmB59a2paKjgULZF", // 30 → 380 pt
  "https://lh3.googleusercontent.com/d/1_pARo-iiyA68pDqOp6TSLCRj33TN6x-d", // 31 → 400 pt
  "https://lh3.googleusercontent.com/d/1epsk3teYcJw0uL4o3OwIywUsZw2CiCHW", // 32 → 400 pt
  "https://lh3.googleusercontent.com/d/1LDYALZaa0Swo-SjknugAztmw2YQT3iq2", // 33 → 400 pt
  "https://lh3.googleusercontent.com/d/1pxVisHXsJtvX6uqpx5hmiBTSHl92vLW3", // 34 → 400 pt
  "https://lh3.googleusercontent.com/d/1WpUh8FY7cWlhTp8BKnC40ScOJ2IhQkUR", // 35 → 400 pt
  "https://lh3.googleusercontent.com/d/1jWzvazjQdfGipCkGaKZVDA3NuzwjBK0x", // 36 → 400 pt
  "https://lh3.googleusercontent.com/d/1ZqlCs9QjejQJ3e-Ikxd3hce4SX3CXZOQ", // 37 → 450 pt
  "https://lh3.googleusercontent.com/d/1aur2qx_cR23DNTHQo5MRsJLuG0V0Jo7J", // 38 → 500 pt
  "https://lh3.googleusercontent.com/d/1pxapISLJkRMGmcOL3Vj7DmANop-As2Pe", // 39 → 500 pt
  "https://lh3.googleusercontent.com/d/1RC5G_HntHj8K1XEQfzLyA-N1w8vO4IIO", // 40 → 600 pt
  "https://lh3.googleusercontent.com/d/12237FMpOJ-bODwOCmJWXCxEzugRWiGZh", // 41 → 700 pt
  "https://lh3.googleusercontent.com/d/18L16KpZuaJTpio4CVD-IHuZFeFlLmXjm", // 42 → 800 pt
  "https://lh3.googleusercontent.com/d/10SVEtB7e1xrYsTIEjfc2kLMFyPIay1Tq", // 43 → 900 pt
  "https://lh3.googleusercontent.com/d/1uPg2s7N5QCg6He6_8563tfoTuu-jlBew"  // 44 → 1000 pt
];

/** เลือกรูปตามลำดับ: ID → INDEX → r.img จาก API → placeholder */
function pickRewardImage(r, slotIndex){
  const fallback = `https://placehold.co/640x480?text=${encodeURIComponent(r?.name || `Gift ${slotIndex+1}`)}`;
  const idGuess  = r?.id || `R${String(slotIndex+1).padStart(2,'0')}-${r?.cost ?? ''}`;
  // ถ้า IMAGE_BY_ID ตรง id → ใช้เลย, ไม่งั้นดูตามลำดับช่อง, ไม่งั้นใช้ r.img จาก API, ไม่งั้น fallback
  return IMAGE_BY_ID[idGuess] || IMAGE_BY_INDEX[slotIndex] || r?.img || fallback;
}

/** สร้าง fallback 44 กล่องจากลำดับคะแนน */
function buildFallbackRewards(costs){
  return costs.map((cost, idx)=>({
    id:   `R${String(idx+1).padStart(2,'0')}-${cost}`,
    name: `Gift ${idx+1}`,
    cost: Number(cost),
    img:  IMAGE_BY_INDEX[idx] || `https://placehold.co/640x480?text=Gift+${idx+1}`
  }));
}

/** จัดเรียง rewards จาก API ให้ตรงตาม COST_ORDER และเติมที่ขาด */
function orderRewardsBySequence(list, sequence){
  const buckets = new Map();
  list.forEach(r=>{
    const c = Number(r?.cost || 0);
    if (!buckets.has(c)) buckets.set(c, []);
    buckets.get(c).push(r);
  });

  const out = [];
  sequence.forEach((cost, i)=>{
    const b = buckets.get(cost);
    if (b && b.length){
      out.push(b.shift()); // ใช้ของจริงจาก API
    }else{
      out.push({ id:`R${String(i+1).padStart(2,'0')}-${cost}`, name:`Gift ${i+1}`, cost:Number(cost) });
    }
  });
  return out;
}

function hideRewardSkeleton() {
  document.querySelectorAll('.reward-skeleton').forEach(el => el.style.display = 'none');
  document.getElementById('rewardsSection')?.classList.remove('skeleton-hide-when-loading');
}

async function kickOffUI() {
  try {
    // โหลดคะแนน/โปรไฟล์
    if (typeof refreshUserScore === 'function') await refreshUserScore();
  } catch (e) {
    console.warn('refreshUserScore failed:', e);
  }

  try {
    // โหลดของรางวัล แล้ววาดการ์ด
    if (typeof loadRewards === 'function') await loadRewards();
    if (typeof renderRewards === 'function') {
      const score = Number(window.prevScore || 0);
      renderRewards(score);
    }
  } catch (e) {
    console.warn('loadRewards/renderRewards failed:', e);
  } finally {
    hideRewardSkeleton();
  }
}

// ฟังก์ชันจริง
function hideRewardSkeletons(){
  document.querySelectorAll('.reward-skeleton').forEach(el => el.style.display = 'none');
}
// กันโค้ดเก่าที่เรียกชื่อแบบพิมพ์ผิด
window.hideRewardSkeletons = hideRewardSkeletons;
window.hideRewardsSkeletons = hideRewardSkeletons;

/** โหลดรางวัล แล้วจัดรูปแบบให้ตรง COST_ORDER */
async function loadRewards() {
  const rail = document.getElementById('rewardRail');
  const section = document.getElementById('rewardsSection');

  try {
    const { items } = await tryEndpoints(
      ['/api/rewards', '/api/list-rewards', '/api/reward-list'],
      {},
      { scope: 'page', skeletonOf: section }
    );

    rail.innerHTML = items.length
      ? items.map(r => {
          const title = r.name || r.title || r.reward_name || 'Reward';
          const desc  = r.desc || r.description || '';
          const img   = r.image || r.image_url || r.thumbnail || '';
          const cost  = r.cost ?? r.point_cost ?? r.points ?? '?';
          const rid   = r.id ?? r.reward_id ?? '';
          return `
            <div class="card my-2">
              <div class="card-body d-flex gap-3 align-items-center">
                ${img ? `<img src="${h(img)}" alt="" class="rounded" style="width:80px;height:80px;object-fit:cover">`
                      : `<div class="skeleton skel-thumb" style="width:80px;height:80px"></div>`}
                <div class="flex-grow-1">
                  <div class="fw-bold">${h(title)}</div>
                  <div class="text-muted small">${h(desc)}</div>
                </div>
                <button class="btn btn-primary" data-reward="${h(rid)}">แลก ${h(cost)} pt</button>
              </div>
            </div>`;
        }).join('')
      : `<div class="text-center text-muted py-3">ยังไม่มีของรางวัล</div>`;
  } catch (e) {
    console.error('loadRewards error:', e);
    rail.innerHTML = `<div class="alert alert-danger">โหลดของรางวัลไม่สำเร็จ</div>`;
  } finally {
    hideRewardSkeletons();  // <<<< ซ่อนแถบดำ
  }
}

/** render + click-to-redeem */
function renderRewards(currentScore){
  const rail = document.getElementById("rewardRail");
  if (!rail) return;

  const data = (REWARDS_CACHE && REWARDS_CACHE.length)
    ? REWARDS_CACHE
    : buildFallbackRewards(COST_ORDER);

  rail.innerHTML = data.map((r, i) => {
    const locked  = Number(currentScore) < Number(r.cost);
    const id      = escapeHtml(r.id || `R${i+1}`);
    const name    = escapeHtml(r.name || id);
    const img     = pickRewardImage(r, i); // ใช้ helper รูป
    const cost    = Number(r.cost || 0);

    return `
      <div class="rp-reward-card ${locked ? 'locked' : ''}"
           data-id="${id}" data-cost="${cost}" title="${name}">
        <div class="rp-reward-img">
          <img src="${img}" alt="${name}" loading="lazy"
               onerror="this.onerror=null;this.src='https://placehold.co/640x480?text=${encodeURIComponent(name)}';">
          <div class="rp-reward-badge">${cost} pt</div>
        </div>
        <div class="rp-reward-body p-2">
          <div class="fw-bold text-truncate">${name}</div>
        </div>
        <button class="rp-redeem-btn" aria-label="แลก ${name}" ${locked ? "disabled" : ""}>
          <i class="fa-solid fa-gift"></i>
        </button>
      </div>
    `;
  }).join("");

  if (!rewardRailBound) {
    rail.addEventListener("click", async (ev) => {
      const btn = ev.target.closest(".rp-redeem-btn");
      if (!btn || btn.disabled) return;
      const card = btn.closest(".rp-reward-card");
      if (!card) return;
      const id   = card.dataset.id;
      const cost = Number(card.dataset.cost);
      if (!id || Number.isNaN(cost)) return;
      await redeemReward({ id, cost }, btn);
    });
    rewardRailBound = true;
  }
}
/* ===== end Rewards (dynamic) ===== */

// กันกดซ้ำ
let REDEEMING = false;
async function redeemReward(reward, btn){
  if (REDEEMING) return;

  // ✅ ดึง uid แบบกันพลาด
  const curUid = (typeof UID !== 'undefined' && UID) ||
                 window.__UID ||
                 localStorage.getItem('uid') || '';
  if (!curUid) return toastErr("ยังไม่พร้อมใช้งาน");

  const id   = reward?.id;
  const cost = Math.max(0, Number(reward?.cost) || 0);
  if (!id || !cost) return toastErr("ข้อมูลรางวัลไม่ถูกต้อง");

  // กันคะแนนไม่พอ
  const scoreNow = Number(prevScore || 0);
  if (scoreNow < cost) return toastErr("คะแนนไม่พอสำหรับรางวัลนี้");

  // ยืนยัน
  const confirmed = window.Swal
    ? (await Swal.fire({
        title:"ยืนยันการแลก?", html:`จะใช้ <b>${cost}</b> pt`,
        icon:"question", showCancelButton:true, confirmButtonText:"แลกเลย"
      })).isConfirmed
    : confirm(`ใช้ ${cost} pt แลกรางวัล ${id}?`);
  if (!confirmed) return;

  REDEEMING = true;
  setBtnLoading(btn, true, 'กำลังแลก…');
  UiOverlay.show('กำลังบันทึกการแลกของรางวัล…');

  try{
    const res = await fetch(API_SPEND, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid: curUid, cost, rewardId: id }),
      cache: 'no-store'
    });
    const payload = await safeJson(res);
    if (payload?.status !== "success") throw new Error(payload?.message || "spend failed");

    await refreshUserScore();
    UiOverlay.hide();
    if (window.Swal){
      await Swal.fire({
        title:"แลกสำเร็จ ✅",
        html:`ใช้ไป <b>${cost}</b> pt<br><small>แคปหน้าจอนี้ไว้เพื่อนำไปแสดงรับรางวัล</small>`,
        icon:"success"
      });
    }else{
      alert("แลกสำเร็จ! กรุณาแคปหน้าจอไว้เพื่อนำไปแสดงรับรางวัล");
    }
  }catch(err){
    console.error(err);
    UiOverlay.hide();
    toastErr("แลกไม่สำเร็จ");
  }finally{
    setBtnLoading(btn, false);
    REDEEMING = false;
  }
}

/* ================= Redeem code / Scanner ================= */
// ===== Redeem code (unified) — Overlay เฉพาะ SCAN + จัดการทุกเคสครบ =====
async function redeemCode(input, source = 'manual') {
  const code = String(
    (input ?? document.getElementById('couponInput')?.value ?? '')
  ).trim();
  if (!code) return toastErr('กรุณากรอกรหัสคูปอง');

  const uid =
    (typeof UID !== 'undefined' && UID) ||
    window.__UID ||
    localStorage.getItem('uid') || '';
  if (!uid) return toastErr('ยังไม่พบ UID ของผู้ใช้');

  // ใช้ overlay เฉพาะโฟลว์สแกน
  const usingScan = String(source || '').toUpperCase() === 'SCAN';
  if (usingScan) UiOverlay.show('กำลังยืนยันรหัส…');

  // เก็บยอดก่อนหน้าไว้เทียบ หาก backend ไม่ส่ง amount
  try { await refreshUserScore(); } catch {}
  const before = Number(window.__userBalance || 0);

  const payload = { uid, code, coupon: code, coupon_code: code, source };

  let res, json;
  try {
    res  = await fetch((typeof API_REDEEM !== 'undefined' ? API_REDEEM : '/api/redeem'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      cache: 'no-store',
    });
    json = await safeJson(res);
  } catch (e) {
    if (usingScan) UiOverlay.hide();
    console.error('[redeem] network error', e);
    toastErr('เครือข่ายผิดพลาด ลองใหม่อีกครั้ง');
    resumeScanIfNeeded(source);
    return;
  }

  // เคสผิดพลาดจากเซิร์ฟเวอร์
  if (!res.ok || json?.status === 'error') {
    if (usingScan) UiOverlay.hide();
    const { userMsg } = mapRedeemError(res, json);
    toastErr(userMsg);
    resumeScanIfNeeded(source);
    return;
  }

  // ===== สำเร็จ: คำนวณแต้มที่ได้ (fallback เป็นส่วนต่าง before/after) =====
  const pickAmount = (o) => {
    if (!o || typeof o !== 'object') return null;
    const keys = [
      'amount','delta','added','increment','points','point','score',
      'data.amount','data.delta','data.points','data.point'
    ];
    for (const k of keys) {
      const v = k.includes('.') ? k.split('.').reduce((a,c)=>a?.[c], o) : o[k];
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
    return null;
  };

  let added = pickAmount(json);
  try { await refreshUserScore(); } catch {}
  const after = Number(window.__userBalance || before);
  if (added === null) added = after - before;

  if (usingScan) UiOverlay.hide();

  if (added > 0) {
    toastOk(`รับ +${added} คะแนน`);
    try { showScoreDelta?.(added); } catch {}
  } else {
    toastOk('แลกคูปองสำเร็จ');
  }

  // เคลียร์ช่องกรอกเมื่อเป็นโฟลว์กรอกมือ
  if (String(source || '').toUpperCase() === 'MANUAL') {
    const inp = document.getElementById('couponInput') || els?.secretInput;
    if (inp) { inp.value = ''; inp.focus?.(); }
  }
}

// แปลง res/json → ข้อความสำหรับผู้ใช้ และประเภท error ที่สนใจ
function mapRedeemError(res, json) {
  const code = String(json?.code || '').toUpperCase();
  const msg  = String(json?.message || '');

  if (res.status === 409 || code === 'COUPON_USED' || /used|already/i.test(msg)) {
    return { userMsg: 'คูปองนี้ถูกใช้ไปแล้ว', type: 'USED' };
  }
  if (res.status === 404 || code === 'COUPON_NOT_FOUND' || /not.*found/i.test(msg)) {
    return { userMsg: 'ไม่พบรหัสคูปอง', type: 'NOT_FOUND' };
  }
  if (res.status === 400 || code === 'BAD_REQUEST' || /uid|code|required/i.test(msg)) {
    return { userMsg: 'คำขอไม่ถูกต้อง: กรุณารีเฟรช/เข้าสู่ระบบอีกครั้ง', type: 'BAD_REQ' };
  }
  return { userMsg: json?.message || `แลกคูปองไม่สำเร็จ (HTTP ${res.status})`, type: 'OTHER' };
}

function resumeScanIfNeeded(source){
  const scanOpen = !!document.getElementById('scoreModal')?.classList.contains('show');
  if (source === 'SCAN' && scanOpen) {
    setTimeout(() => { try { startScanner?.(); } catch {} }, 400);
  }
}

// ดึงชื่อผู้ใช้จากแหล่งที่น่าจะมีอยู่
function getUserDisplayName() {
  return (
    window.DISPLAY_NAME ||
    window.__DISPLAY_NAME ||
    localStorage.getItem('displayName') ||
    document.querySelector('#profileName, [data-profile-name], .profile-name')?.textContent?.trim() ||
    UID || 'ผู้ใช้'
  );
}

// แปลงวันเวลาเป็นรูปแบบไทย + เขตเวลาไทย
function fmtThaiDateTime(v) {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  // จะได้ปี พ.ศ. อัตโนมัติ เพราะใช้ th-TH
  const s = d.toLocaleString('th-TH', {
    timeZone : 'Asia/Bangkok',
    year     : 'numeric',
    month    : 'short',
    day      : '2-digit',
    hour     : '2-digit',
    minute   : '2-digit',
    second   : '2-digit',
    hour12   : false,
  });
  return s + ' น.'; // เติม "น." แบบไทย
}

function setHistoryUserName() {
  const span = document.getElementById('historyUser');
  if (!span) return;

  // 1) เอาตามที่โชว์บนการ์ดโปรไฟล์ก่อน
  let name = (els?.username?.textContent || '').trim();

  // 2) ถ้าเป็นว่าง/ขีด ให้ใช้ที่เก็บไว้
  if (!name || name === '—') {
    name =
      (localStorage.getItem('displayName') || '').trim() ||
      (window.DISPLAY_NAME || window.__DISPLAY_NAME || '').trim();
  }

  // 3) ถ้ายังไม่มี ให้ใช้คำทั่วไปแทน (ไม่ fallback เป็น UID)
  span.textContent = name || 'ผู้ใช้';
}

/* ================= History (เปิดเร็ว โหลดทีหลัง) ================= */
// ===== REPLACE WHOLE FUNCTION: openHistory =====
async function openHistory(){
  const uid =
    (typeof UID !== 'undefined' && UID) ||
    window.__UID ||
    localStorage.getItem('uid') || '';
  if (!uid) return toastErr('ไม่พบผู้ใช้');

  // ชื่อบนหัว
  try { setHistoryUserName?.(); } catch {}

  const modalEl  = document.getElementById('historyModal');
  const listWrap = document.getElementById('historyListWrap');
  const listEl   = document.getElementById('historyList');
  const skelEl   = modalEl?.querySelector('.history-skeleton');
  const modal    = new bootstrap.Modal(modalEl);

  // เริ่มโหลด: เปิด skeleton
  if (skelEl) skelEl.style.display = '';
  if (listWrap) listWrap.classList.add('skeleton-hide-when-loading');
  listEl && (listEl.innerHTML = '');

  try{
    const resp = await fetch(`/api/score-history?uid=${encodeURIComponent(uid)}`, { cache:'no-store' });
    const json = await resp.json().catch(()=> ({}));
    const items = Array.isArray(json) ? json
      : Array.isArray(json.items) ? json.items
      : Array.isArray(json.data)  ? json.data
      : [];

    // เรียงใหม่ (ล่าสุดก่อน)
    items.sort((a,b)=>{
      const ta = new Date(a.created_at || a.time || 0).getTime();
      const tb = new Date(b.created_at || b.time || 0).getTime();
      if (tb !== ta) return tb - ta;
      return String(b.id || b.uuid || '').localeCompare(String(a.id || a.uuid || ''));
    });

    const esc = s => String(s ?? '').replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
    const fmt = v => { const d = new Date(v); if (isNaN(d)) return ''; const p=n=>String(n).padStart(2,'0'); return `${p(d.getDate())}/${p(d.getMonth()+1)}/${d.getFullYear()+543} ${p(d.getHours())}:${p(d.getMinutes())}`; };

    listEl.classList.add('hist-compact');
    listEl.innerHTML = items.map(it=>{
      const amt  = Number(it.amount ?? it.points ?? it.point ?? it.delta ?? 0);
      const sign = amt > 0 ? '+' : '';
      const when = fmt(it.created_at || it.time || '');
      return `
        <div class="hc-row">
          <div class="hc-at">${esc(when)}</div>
          <div class="hc-amt ${amt>=0?'plus':'minus'}">${sign}${amt}</div>
        </div>`;
    }).join('') || `<div class="text-muted text-center py-3">ไม่มีรายการ</div>`;
  } catch (e){
    console.error(e);
    toastErr('โหลดประวัติไม่สำเร็จ');
  } finally {
    // ปิด skeleton แล้วโชว์รายการ
    if (skelEl) skelEl.style.display = 'none';
    if (listWrap) listWrap.classList.remove('skeleton-hide-when-loading');
    bootstrap.Modal.getOrCreateInstance(modalEl).show();
  }
}

// คัดลอก-วางแทนของเดิม
function renderHistoryList(rows = []) {
  const host = document.getElementById('historyList');
  if (!host) return;
  const fmtSign = (n) => (n > 0 ? `+${n}` : `${n}`);
  const fmtDate = (s) => {
    try { return new Date(s).toLocaleString('th-TH', { hour12:false }); }
    catch { return s || ''; }
  };

  host.innerHTML = rows.map(tx => {
    const amount = Number(tx.amount ?? tx.points ?? tx.point ?? tx.delta ?? 0);
    const title  = (tx.title || tx.source || tx.activity || 'ADMIN').toString();
    const subParts = [
      tx.code || tx.coupon || tx.coupon_code || '',
      tx.ref  || tx.reference || '',
      tx.note || ''
    ].filter(Boolean);
    const sub = subParts.join(' · '); // ถ้าไม่มี จะได้สตริงว่าง → ไม่เรนเดอร์

    return `
      <div class="tx-row">
        <div class="tx-main">
          <div class="tx-title">${escapeHtml(title)}</div>
          ${sub ? `<div class="tx-sub">${escapeHtml(sub)}</div>` : ''}
        </div>
        <div class="tx-amt ${amount >= 0 ? 'plus' : 'minus'}">${fmtSign(amount)}</div>
        <div class="tx-at">${fmtDate(tx.created_at || tx.at)}</div>
      </div>
    `;
  }).join('');
}

/* ================= Utils ================= */
function escapeHtml(s){return String(s||"").replace(/[&<>"'`=\/]/g,a=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','/':'&#47;','`':'&#x60;','=':'&#x3D;'}[a]))}
function safeInt(n, d=0){ const x=Number(n); return Number.isFinite(x)?x:d; }
async function safeJson(resp){ const t=await resp.text(); try{ return JSON.parse(t); }catch{ return {status: resp.ok?"success":"error", message:t}; } }

function enableAvatarPreview(){
  const avatar = document.getElementById("rpAvatar");
  const img    = document.getElementById("profilePic");
  const modalEl= document.getElementById("avatarModal");
  const modal  = modalEl ? new bootstrap.Modal(modalEl) : null;
  const target = document.getElementById("avatarPreviewImg");
  if(!avatar || !img || !modal || !target) return;

  avatar.addEventListener("click", ()=>{
    target.src = img.src;
    modal.show();
  });
}

function updateStatChips({ tierName, points, streakDays } = {}){
  const box = document.getElementById("statChips");
  if(!box) return;
  const chips = [];
  if (tierName) chips.push(`<span class="chip"><i class="fa-solid fa-medal"></i> ${tierName}</span>`);
  if (typeof points === "number") chips.push(`<span class="chip"><i class="fa-solid fa-star"></i> ${points.toLocaleString()} pt</span>`);
  if (typeof streakDays === "number") chips.push(`<span class="chip"><i class="fa-solid fa-fire"></i> ${streakDays} วันติด</span>`);
  box.innerHTML = chips.join("");
}

function setTierMedal(tier){
  const avatar = document.getElementById("rpAvatar");
  const medal  = document.getElementById("tierMedal");
  if(!avatar || !medal || !tier) return;

  // ใช้คลาส rp-tier-* ให้ตรงกับ HTML/CSS ของหน้า
  avatar.classList.remove("rp-tier-silver","rp-tier-gold","rp-tier-platinum");
  avatar.classList.add(`rp-tier-${tier.key}`);

  medal.title = tier.name;
}

// padding + date formatter (hoisted)
function pad(n){ n = safeInt(n,0); return n<10?("0"+n):String(n); }
function fmtDT(ts){
  const d = new Date(ts);
  if (isNaN(d)) return String(ts||"");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function setRefreshTooltip(ts = new Date(), offline = false){
  const btn = document.getElementById('refreshBtn');
  if (!btn) return;
  const d = (ts instanceof Date) ? ts : new Date(ts);
  const two = n => String(n).padStart(2,'0');
  const txt = `อัปเดตล่าสุด${offline ? ' (ออฟไลน์แคช)' : ''}: ${d.getFullYear()}-${two(d.getMonth()+1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;

  // อัปเดตทั้ง title และ data-bs-original-title (รองรับ Bootstrap 5)
  btn.setAttribute('title', txt);
  btn.setAttribute('data-bs-original-title', txt);

  // สร้าง tooltip ถ้ายังไม่มี แล้วอัปเดตข้อความ
  const tip = bootstrap.Tooltip.getInstance(btn) || new bootstrap.Tooltip(btn, { placement: 'left', trigger: 'hover focus' });
  if (typeof tip.setContent === 'function') {
    tip.setContent({ '.tooltip-inner': txt });   // 5.3+
  } else {
    tip.update(); // 5.0–5.2
  }
}

/* Level Track (ถ้าคุณมี element เหล่านี้ในหน้า ให้กำกับความยาวตามสัดส่วนแต้ม) */
function updateLevelTrack(score){
  if (!els.levelTrack || !els.trackFill) return;
  const tier = getTier(score);
  const pct = tier.next === Infinity ? 1 : (score - tier.min) / (tier.next - tier.min);
  els.trackFill.style.width = `${Math.max(0, Math.min(100, pct * 100))}%`;
}

function updatePremiumBar(score){
  const xpFill  = document.getElementById("xpFill");
  const xpLabel = document.getElementById("xpLabel");
  const xpStart = document.getElementById("xpStart");
  const xpEnd   = document.getElementById("xpEnd");
  if(!xpFill || !xpLabel || !xpStart || !xpEnd) return;

  const t = getTier(score);            // ใช้ TIERS เดิมของคุณ
  const start = t.min;
  const end   = (t.next === Infinity) ? score : t.next;
  const pct   = (t.next === Infinity) ? 1 : Math.max(0, Math.min(1, (score - start)/(end - start)));

  xpFill.style.width = (pct*100) + "%";
  xpStart.textContent = start.toLocaleString();
  xpEnd.textContent   = (t.next === Infinity ? score : end).toLocaleString();

  if (t.next === Infinity){
    xpLabel.textContent = `ระดับ ${t.name} สูงสุดแล้ว • ${score.toLocaleString()} คะแนน`;
  } else {
    const need = end - score;
    xpLabel.textContent = `ระดับ ${t.name} • ขาดอีก ${need.toLocaleString()} คะแนน`;
  }
}

function toggleOfflineBanner(on){
  const el = document.getElementById("offlineBanner");
  if (el) el.classList.toggle("d-none", !on);
}

function bumpXpFill(){
  const xpFill = document.getElementById("xpFill");
  if (!xpFill) return;
  xpFill.classList.remove("bump");
  void xpFill.offsetWidth; // reflow เพื่อให้เล่นแอนิเมชันซ้ำได้
  xpFill.classList.add("bump");
}

/* Count-up effect */
function animateCount(el, from, to, duration=600){
  if(from === to){ el.textContent = String(to); return; }
  const start = performance.now();
  const ease = t => t<.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2,3)/2;
  function frame(now){
    const p = Math.min(1, (now-start)/duration);
    const v = Math.round(from + (to-from)*ease(p));
    el.textContent = String(v);
    if(p<1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

/* Confetti */
function launchConfetti(){
  try{
    const duration = 1200, end = Date.now()+duration;
    (function frame(){
      confetti({ particleCount:40, angle:60, spread:50, origin:{x:0} });
      confetti({ particleCount:40, angle:120, spread:50, origin:{x:1} });
      if(Date.now()<end) requestAnimationFrame(frame);
    })();
  }catch{}
}

function updateXpLabels(score){
  const t = getTier(score);
  const start = t.min;
  const end   = (t.next === Infinity) ? score : t.next;
  const xpStart = document.getElementById('xpStart');
  const xpEnd   = document.getElementById('xpEnd');
  if (xpStart) xpStart.textContent = String(start);
  if (xpEnd)   xpEnd.textContent   = String(end);
}

function setTierUI(tier, score){
  // อ้างอิง element ที่เกี่ยวข้อง
  const pill = document.getElementById('tierPill');
  const name = document.getElementById('tierName');
  const av   = document.getElementById('rpAvatar');
  const dot  = document.getElementById('tierDot');
  const tag  = document.getElementById('tierTag');   // ป้าย Max Level (ถ้ามี)
  const medal= document.getElementById('tierMedal'); // เหรียญซ้อนบนรูป (ถ้ามี)

  // อัปเดตชื่อระดับ
  if (name) name.textContent = tier.name;

  // เคลียร์แล้วใส่คลาสธีม rp-tier-*
  [pill, av].forEach(el=>{
    if (!el) return;
    el.classList.remove('rp-tier-silver','rp-tier-gold','rp-tier-platinum');
    el.classList.add(`rp-tier-${tier.key}`);
  });

  // ไอคอนจุด/เหรียญกำกับระดับ
  if (dot){
    const ic = tier.key === 'platinum' ? 'fa-gem'
             : tier.key === 'gold'     ? 'fa-star'
             : 'fa-circle';
    dot.innerHTML = `<i class="fa-solid ${ic}"></i>`;
  }

  // เหรียญซ้อนบนอวาตาร์ (ถ้ามี setTierMedal ให้ใช้, ไม่มีก็ตั้ง title พอ)
  if (typeof setTierMedal === 'function') {
    try { setTierMedal(tier); } catch {}
  } else if (medal){
    medal.title = tier.name;
  }

  // โชว์/ซ่อน Max Level tag (ถ้ามี)
  if (tag){
    if (tier.next === Infinity){
      tag.classList.remove('d-none');
      tag.textContent = '✨ Max Level';
    } else {
      tag.classList.add('d-none');
    }
  }
}


function setXpPair(score){
  const pair = document.getElementById('xpPair');
  if (!pair) return;
  const tier = getTier(score);
  const goal = (tier.next === Infinity) ? Number(score||0) : tier.next;
  pair.textContent = `${Number(score||0).toLocaleString()} / ${goal.toLocaleString()} คะแนน`;
  pair.setAttribute('data-ico','🎯'); // ไอคอนชิปตัวเลขคู่
}

// เปิด tooltip ของ Bootstrap (info icon)
function enableTierTooltip(){
  try{
    const el = document.getElementById('levelInfo');
    if(!el) return;
    new bootstrap.Tooltip(el);
  }catch{}
}

// ==== Tier helpers (ต้องอยู่นอกฟังก์ชัน อาศัยได้ทั้งไฟล์) ====
function getTier(score){
  score = Number(score || 0);
  for (let i = 0; i < TIERS.length; i++){
    const t = TIERS[i];
    if (score >= t.min && score < t.next) return t;
  }
  return TIERS[TIERS.length - 1];
}

// ==== Torch / Low-light scan ====
let ACTIVE_VIDEO_TRACK = null;

function getActiveVideoTrack(){
  try{
    const v = document.querySelector('#qr-reader video');
    return v?.srcObject?.getVideoTracks?.[0] || null;
  }catch{ return null; }
}
function canUseTorch(track){
  try{ return !!track?.getCapabilities?.().torch; }catch{ return false; }
}
async function toggleTorch(on){
  const track = ACTIVE_VIDEO_TRACK || getActiveVideoTrack();
  if (!track) throw new Error('no-camera-track');
  if (!canUseTorch(track)) throw new Error('torch-not-supported');

  await track.applyConstraints({ advanced: [{ torch: !!on }] });
  TORCH_ON = !!on;
  const btn = document.getElementById('torchBtn');
  if (btn){
    btn.classList.toggle('active', TORCH_ON);
    btn.innerHTML = TORCH_ON
      ? '<i class="fa-solid fa-bolt"></i> ไฟฉาย: เปิด'
      : '<i class="fa-solid fa-bolt"></i> ไฟฉาย';
  }
}
function afterCameraStarted(){
  ACTIVE_VIDEO_TRACK = getActiveVideoTrack();
  const btn = document.getElementById('torchBtn');
  if (!btn) return;
  const supported = canUseTorch(ACTIVE_VIDEO_TRACK);
  btn.disabled = !supported;
  btn.classList.toggle('d-none', !supported); // ไม่รองรับก็ซ่อน
}

/* ===== Premium helpers ===== */

/** ตั้งธีมให้การ์ดด้วย data-tier (ใช้กับ CSS glow/gradient) */
function applyPremiumTheme(tierKey){
  const card = document.querySelector('.rp-profile-card');
  if (card) card.setAttribute('data-tier', tierKey);
}

/** ทำให้ตัวเลขคะแนนเด้งนุ่ม ๆ */
function bumpScoreFx(){
  const el = document.querySelector('.rp-point-value');
  if (!el) return;
  el.classList.remove('bump'); void el.offsetWidth; // restart animation
  el.classList.add('bump');
}

/** แสดงฟองคะแนนลอยขึ้น (+/- delta) */
function showScoreDelta(delta){
  if (!delta) return;
  const stack = document.querySelector('.rp-score-stack');
  if (!stack) return;
  const chip = document.createElement('div');
  chip.className = 'rp-score-floater' + (delta < 0 ? ' minus' : '');
  chip.textContent = (delta>0?'+':'') + delta;
  stack.appendChild(chip);
  setTimeout(()=>chip.remove(), 1200);
}

/** สปินปุ่มรีเฟรช + haptic */
(function wireRefreshFx(){
  const btn = document.getElementById('refreshBtn');
  if (!btn || btn.dataset._spinwired) return;
  btn.dataset._spinwired = 1;
  btn.addEventListener('click', ()=>{
    btn.classList.add('spin');
    navigator.vibrate?.(8);
    setTimeout(()=>btn.classList.remove('spin'), 900);
  });
})();

/* ===== Premium Plus – JS helpers ===== */
/** 3D tilt บนเดสก์ท็อป */
(function enableCardTilt(){
  const card = document.querySelector('.rp-profile-card');
  if (!card || 'ontouchstart' in window) return; // มือถือไม่ใช้
  card.classList.add('rp-tilt');
  const max = 8; // องศาสูงสุด
  let raf;
  function onMove(e){
    const rect = card.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(()=>{
      card.style.transform = `rotateX(${(-y*max).toFixed(2)}deg) rotateY(${(x*max).toFixed(2)}deg)`;
      card.dataset.tilt = "1";
    });
  }
  function reset(){ card.style.transform=''; card.dataset.tilt="0"; }
  card.addEventListener('mousemove', onMove);
  card.addEventListener('mouseleave', reset);
})();

/** สร้าง sparkles 1 ชุดรอบ avatar (ใช้สีตาม tier) */
function spawnAvatarSparkles(){
  const wrap = document.querySelector('.rp-avatar-wrap');
  const card = document.querySelector('.rp-profile-card');
  if (!wrap || !card) return;
  const n = 6;
  for (let i=0;i<n;i++){
    const dot = document.createElement('span');
    dot.className = 'rp-sparkle';
    const size = 5 + Math.random()*4;
    const left = -6 + Math.random()*72;   // วางแถว ๆ รอบรูป
    const top  = 40 + Math.random()*10;
    dot.style.cssText = `
      left:${left}px; top:${top}px; width:${size}px; height:${size}px;
      background: radial-gradient(circle at 30% 30%, var(--spA), var(--spB));
      animation:sparkleFloat ${900+Math.random()*600}ms ease forwards;
      filter: drop-shadow(0 6px 10px rgba(0,0,0,.18));
    `;
    wrap.appendChild(dot);
    setTimeout(()=>dot.remove(), 1200);
  }
}

/** Tooltip บน progress: แตะ/คลิกเพื่อโชว์ % และแต้มที่ต้องใช้ */
(function wireXpTooltip(){
  const bar = document.getElementById('progressBar');
  if (!bar) return;
  let tip;
  function show(msg){
    hide();
    tip = document.createElement('div');
    tip.className = 'rp-xp-tip';
    tip.textContent = msg;
    bar.style.position='relative';
    bar.appendChild(tip);
    setTimeout(hide, 1400);
  }
  function hide(){ tip && tip.remove(); tip=null; }
  bar.addEventListener('click', ()=>{
    const sc = Number(document.getElementById('points')?.textContent || 0);
    const t  = getTier(sc);
    if (t.next === Infinity){ show('ครบแล้ว • Max Level ✨'); return; }
    const need = Math.max(0, t.next - sc);
    const pct = Math.min(100, Math.round(((sc - t.min)/(t.next - t.min))*100));
    show(`${pct}% • ขาดอีก ${need.toLocaleString()} คะแนน`);
  });
})();

/* วงแหวนรอบรูป: ตั้งค่า 0..1 ตาม % ความคืบหน้าสู่ระดับถัดไป */
function setAvatarArc(score){
  const av = document.getElementById('rpAvatar');
  if (!av) return;
  const t = getTier(score);
  const pct = (t.next === Infinity) ? 1 : Math.max(0, Math.min(1, (score - t.min) / (t.next - t.min)));
  av.style.setProperty('--arc', pct.toFixed(4));
}

/* อัปเดต mini-chips ใต้รูป (streak / rank) */
function updateLeftMiniChips({ streakDays, rank }){
  const elSt = document.getElementById('miniStreak');
  const elRk = document.getElementById('miniRank');
  if (elSt){
    if (Number.isFinite(streakDays) && streakDays > 0){
      elSt.textContent = `🔥 ${streakDays} วันติด`; elSt.classList.remove('d-none');
    } else elSt.classList.add('d-none');
  }
  if (elRk){
    if (Number.isFinite(rank) && rank > 0){
      elRk.textContent = `🏆 อันดับ ${rank}`; elRk.classList.remove('d-none');
    } else elRk.classList.add('d-none');
  }
}

// แสดงเวลาอัปเดตล่าสุดที่ชิปขวา
function setLastSync(ts = Date.now(), fromCache = false){
  const chip = document.getElementById('lastSyncChip');
  if (!chip) return;
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2,'0');
  const mm = String(d.getMinutes()).padStart(2,'0');
  const today = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  chip.classList.remove('d-none');
  chip.innerHTML = `<i class="fa-regular fa-clock"></i> ${fromCache ? 'แคช' : 'อัปเดต'} • ${today} ${hh}:${mm}`;
}

// อัปเดตชิปเครือข่าย (แสดงเฉพาะตอนออฟไลน์)
function updateNetChip(){
  const chip = document.getElementById('netChip');
  if (!chip) return;
  if (navigator.onLine){
    chip.classList.add('d-none');
  } else {
    chip.classList.remove('d-none');
    chip.innerHTML = `<i class="fa-solid fa-wifi-slash"></i> ออฟไลน์`;
  }
}

// ผูกให้รีเฟรชชิปสถานะอัตโนมัติ
window.addEventListener('online',  updateNetChip);
window.addEventListener('offline', updateNetChip);
updateNetChip(); // ครั้งแรก

// ปุ่มรีเฟรช: ใช้ตัวเดิม (หมุน) — ถ้ามีแล้วข้ามได้
(function wireRefreshFx(){
  const btn = document.getElementById('refreshBtn');
  if (!btn || btn.dataset._spinwired) return;
  btn.dataset._spinwired = 1;
  btn.addEventListener('click', ()=>{
    btn.classList.add('spin');
    navigator.vibrate?.(8);
    setTimeout(()=>btn.classList.remove('spin'), 900);
  });
})();

/* ---------- A11y: live regions ---------- */
document.addEventListener('DOMContentLoaded', () => {
  try{
    els.points?.setAttribute('aria-live','polite');
    document.getElementById('lastSyncChip')?.setAttribute('aria-live','polite');
  }catch{}
});

/* ---------- Reduced motion guard ---------- */
const REDUCE_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const maybe = (fn)=> REDUCE_MOTION ? ()=>{} : fn;

// หุ้มเอฟเฟกต์ที่เคลื่อนไหวแรง ๆ
const _bumpScoreFx = bumpScoreFx;      window.bumpScoreFx      = maybe(_bumpScoreFx);
const _sparkles    = spawnAvatarSparkles; window.spawnAvatarSparkles = maybe(_sparkles);
// ถ้ามี tilt
try{
  const tiltOn = document.querySelector('.rp-profile-card')?.classList.contains('rp-tilt');
  if (REDUCE_MOTION && tiltOn) document.querySelector('.rp-profile-card').classList.remove('rp-tilt');
}catch{}

/* ---------- Progress ripple + tooltip (เติมบน click) ---------- */
(function enhanceProgress(){
  const bar = document.getElementById('progressBar');
  if (!bar) return;
  bar.addEventListener('click', (e)=>{
    // ripple
    const r = bar.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const dot = document.createElement('span');
    dot.className = 'rp-xp-ripple';
    dot.style.left = x + 'px'; dot.style.top = y + 'px';
    bar.appendChild(dot);
    setTimeout(()=>dot.remove(), 650);
  }, {passive:true});
})();

/* ---------- Code-health: ปิดเสียง log จาก rewards ---------- */
(function calmRewardsLogs(){
  const oldInfo = console.info;
  console.info = function(...args){
    if (String(args[0]||'').startsWith('[rewards]')) return; // กลบเฉพาะบรรทัด rewards
    oldInfo.apply(console, args);
  };
})();

// === Mini CTA (โผล่เมื่อเลื่อนลง) ===
(function enableMiniCta(){
  const bar = document.getElementById('miniCta');
  const miniRefresh = document.getElementById('miniRefresh');
  if(!bar) return;

  let shown = false;
  const sync = ()=>{
    const y = window.scrollY || document.documentElement.scrollTop || 0;
    const shouldShow = y > 140;
    if (shouldShow !== shown){
      shown = shouldShow;
      bar.classList.toggle('d-none', false);
      bar.classList.toggle('show', shown);
    }
  };
  window.addEventListener('scroll', sync, { passive:true });
  window.addEventListener('resize', sync);
  setTimeout(sync, 0);

  miniRefresh?.addEventListener('click', ()=>{
    try{ navigator.vibrate?.(10); }catch{}
    refreshUserScore?.();
  });
})();
