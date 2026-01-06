/* ============ Royal Point — User App (All-in-One, User Side) ============ */
/** LIFF / API */
const LIFF_ID       = "2007053300-QoEvbXyn";
const API_GET_SCORE = "/api/get-score";
const API_REDEEM    = "/api/redeem";
const API_HISTORY   = "/api/score-history";
const API_SPEND     = "/api/spend";      // หักแต้มเมื่อแลกของรางวัล
/** state & cache (ต้องอยู่ตอนบนของไฟล์) */
let REWARDS_CACHE = [];
// กันผูกอีเวนต์โมดัลสแกนซ้ำหลายครั้ง
window.__SCAN_MODAL_WIRED = window.__SCAN_MODAL_WIRED ?? false;

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
window.showAdminFab = showAdminFabIfAuthorized; // alias ใหม่

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
  if (window.__SKIP_AUTO_INIT__ && !ctx.force) return;
  try {
    // ใช้ค่า LIFF_ID ตัวจริงที่ประกาศไว้ตอนบนไฟล์ (ไม่ต้องประกาศใหม่ในฟังก์ชันนี้)
    const liffId = (typeof LIFF_ID !== 'undefined' ? LIFF_ID : window.LIFF_ID);
    await ensureLiffInit(liffId);

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

      // ⭐ [เพิ่มใหม่ตรงนี้] : อัปเดตลิงก์ปุ่ม "ดูรางวัลทั้งหมด" ให้แนบ UID ไปด้วย
      // เพื่อให้ User ทั่วไปกดเข้าไปแล้วไม่ต้องล็อกอินใหม่
      const allRewardsBtn = document.querySelector('a[href*="all-rewards.html"]');
      if (allRewardsBtn) {
         const separator = allRewardsBtn.href.includes('?') ? '&' : '?';
         // ป้องกันการเติมซ้ำ
         if (!allRewardsBtn.href.includes('uid=')) {
             allRewardsBtn.href = `${allRewardsBtn.href}${separator}uid=${uid}`;
         }
      }
    }

    // 3) preflight check
    const GET_SCORE = (u) => `/api/get-score?uid=${encodeURIComponent(u)}`;
    const resp = await fetch(GET_SCORE(uid), { method: 'GET', cache: 'no-store' });
    if (resp.status === 404) {
      document.querySelectorAll('.skeleton-hide-when-loading,.reward-skeleton,.history-skeleton')
        .forEach(el => el.classList.add('d-none'));
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
    if (typeof refreshUserScore === 'function') await refreshUserScore({ bust: true });
    if (typeof loadRewards === 'function') await loadRewards();
    if (typeof renderRewards === 'function') {
      const s = (typeof window.prevScore === 'number')
        ? window.prevScore
        : (typeof payload?.data?.score !== 'undefined' ? Number(payload.data.score || 0) : 0);
      renderRewards(s);
    }

    // 6) one-time binds
    if (!window.__MAIN_BOUND) {
      // เรียก bindUI() แค่ตัวเดียวพอครับ มันจัดการทุกปุ่มให้แล้ว
      if (typeof bindUI === 'function') { try { bindUI(); } catch(e) { console.warn('bindUI failed', e); } }
      window.__MAIN_BOUND = true;
    }

    // แสดงปุ่มแอดมิน (ถ้ามีฟังก์ชันนี้)
    if (typeof showAdminFabIfAuthorized === 'function') showAdminFabIfAuthorized();

  } catch (err) {
    console.error('[initApp] error:', err);
    window.Swal ? Swal.fire('ผิดพลาด','เริ่มต้นระบบไม่สำเร็จ','error') : alert('เริ่มต้นระบบไม่สำเร็จ');
  }
}

// เรียกหลังสมัครสำเร็จ เพื่อบังคับโหลดทุกอย่างให้ครบแบบเต็มหน้า
async function hydrateAfterRegister(uid) {
  try {
    // เก็บ uid ไว้ให้ชัดเจน
    if (uid) {
      window.__UID = uid;
      sessionStorage.setItem('uid', uid);
    }

    // 1) อัปคะแนนขึ้นหน้าหลัก
    if (typeof refreshUserScore === 'function') {
      await refreshUserScore({ bust: true });
    }

    // 2) โหลดของรางวัลทั้งหมด (รวม inactive)
    if (typeof loadRewards === 'function') {
      // ถ้าฟังก์ชัน loadRewards รองรับ options
      try { await loadRewards({ include: 0 }); }
      catch { await loadRewards(); }
    }

    // 3) เรนเดอร์ของรางวัลทันทีด้วยคะแนนปัจจุบัน
    if (typeof renderRewards === 'function') {
      const s = Number(
        (typeof window.prevScore === 'number' ? window.prevScore : 0)
      );
      renderRewards(s);
    }

    // 4) โชว์ปุ่มแอดมินถ้าเป็นแอดมิน
    if (typeof showAdminFabIfAuthorized === 'function') {
      showAdminFabIfAuthorized();
    }

    // 5) เก็บกวาด skeleton ให้หายไป (ถ้ามีฟังก์ชันช่วย)
    try {
      document.querySelectorAll('.reward-skeleton').forEach(el => el.classList.add('d-none'));
      document.querySelectorAll('.skeleton-hide-when-loading').forEach(el => el.classList.remove('d-none'));
    } catch {}
  } catch (e) {
    console.error('hydrateAfterRegister error:', e);
    window.Swal ? Swal.fire('ผิดพลาด','โหลดหน้าหลังสมัครไม่สำเร็จ','error') : alert('โหลดหน้าหลังสมัครไม่สำเร็จ');
  }
}

// ===== QR Scanner (html5-qrcode) =====
let QR_INSTANCE = null;
let SCANNING = false;
let TORCH_ON = false;
let QR_STARTING = false; // กัน start ซ้อน

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
  // กันเรียกซ้อน
  if (QR_STARTING || SCANNING) return;
  QR_STARTING = true;

  try {
    // ขอสิทธิ์กล้อง (จะโยน error พร้อม userMessage ถ้าไม่ได้สิทธิ์)
    await ensureCameraPermission();

    // หน่วงสั้น ๆ ให้โมดัลนิ่งก่อน (ช่วย iOS/บางเครื่อง)
    await new Promise(r => setTimeout(r, 60));

    const hostId = 'qr-reader';
    const el = document.getElementById(hostId);
    if (!el) return;

    if (!QR_INSTANCE) QR_INSTANCE = new Html5Qrcode(hostId);

    // เลือกกล้องหลังถ้ามี
    let cameraId;
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
      if (text === window.LAST_DECODE && now - (window.LAST_DECODE_AT || 0) < DUP_COOLDOWN) return;
      window.LAST_DECODE = text; window.LAST_DECODE_AT = now;
      await redeemCode(text, 'SCAN');
    };
    const onScanError = () => {};

    await QR_INSTANCE.start(
      cameraId || { facingMode: "environment" },
      config,
      onScanSuccess,
      onScanError
    );
    SCANNING = true;

    // ตั้งค่าไฟฉายถ้าอุปกรณ์รองรับ
    const torchBtn = document.getElementById('torchBtn');
    try {
      const caps = QR_INSTANCE.getRunningTrackCapabilities?.();
      if (torchBtn) torchBtn.disabled = !(caps && 'torch' in caps);
    } catch { if (torchBtn) torchBtn.disabled = true; }

  } catch (err) {
    console.error('startScanner failed:', err);
    toastErr(err?.userMessage || 'เปิดกล้องไม่สำเร็จ ลองกด “เปิดกล้อง” อีกครั้ง');
  } finally {
    QR_STARTING = false;
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
    // ปุ่มรีเฟรชคะแนน (เวอร์ชันฉลาด: bust + poll)
  if (els.btnRefresh && !els.btnRefresh.dataset._rpBound) {
    els.btnRefresh.dataset._rpBound = 1;
    els.btnRefresh.addEventListener("click", async () => {
      try {
        await ensureLiffInit(LIFF_ID);
      } catch {}
      try {
        await refreshUserScore({ bust: true, poll: true, pollTries: 3, pollInterval: 500 });
        await loadRewards?.();
        renderRewards?.(Number(window.prevScore || 0));
      } catch (e) { console.warn('refresh failed', e); }
    });
  }

  // ปุ่มประวัติ
  els.btnHistory && els.btnHistory.addEventListener("click", openHistory);

  // ✅ ควบคุมกล้องในโมดัล (กันซ้ำด้วยแฟล็ก + หน่วง 60ms ช่วย iOS)
  if (!window.__SCAN_MODAL_WIRED) {
    const scanModalEl = document.getElementById('scoreModal');
    if (scanModalEl) {
      scanModalEl.addEventListener('shown.bs.modal', () => {
        // หน่วงนิดให้ layout โมดัลนิ่งก่อนค่อย start (แก้อาการ “กด OK แล้วจึงติด” บน iOS)
        setTimeout(() => { startScanner && startScanner(); }, 60);
      });
      scanModalEl.addEventListener('hide.bs.modal',   () => { stopScanner && stopScanner(); });
      scanModalEl.addEventListener('hidden.bs.modal', () => { stopScanner && stopScanner(); });
    }
    window.__SCAN_MODAL_WIRED = true;
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

// ฟังก์ชันโหลดคะแนน (ฉบับแก้ไข: ห้ามรีเซ็ตเป็น 0 ถ้าโหลดพลาด)
async function refreshUserScore(opts = {}) {
  const { bust=false, poll=false, pollTries=5, pollInterval=600 } = opts;

  const uid =
    (typeof UID !== 'undefined' && UID) ||
    window.__UID ||
    localStorage.getItem('uid') ||
    '';

  // ถ้าไม่มี UID จริงๆ ถึงจะยอมให้เป็น 0
  if (!uid) return 0;

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
  const bustQS = bust ? `&_=${Date.now()}` : '';
  const url = `${API_GET_SCORE}?uid=${encodeURIComponent(uid)}${bustQS}`;

  try {
    const res  = await fetch(url, {
      cache: 'no-store',
      headers: {
        'Cache-Control':'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json || json?.status === 'error') {
      // ถ้า Error จาก Server (เช่น 500, 502) ให้ถือว่าโหลดพลาด
      throw new Error(json?.message || `HTTP ${res.status}`);
    }
    data = json;
  } catch (e) {
    console.warn('[refreshUserScore] fetch failed, keeping previous score', e);
    // ⭐ [จุดแก้สำคัญ 1] ถ้าโหลดพลาด อย่าเพิ่งรีเซ็ตเป็น 0 ให้ใช้ค่าเดิมไปก่อน!
    if (typeof window.__userBalance === 'number') {
        return window.__userBalance; 
    }
    return 0; // ถ้าไม่มีค่าเดิมเลยจริงๆ ค่อยยอมคืนค่า 0
  }

  // ⭐ [จุดแก้สำคัญ 2] ถ้า data เป็น null (โหลดไม่ได้) ให้ใช้ค่าเดิม ห้ามปรับเป็น 0
  if (!data) {
    if (typeof window.__userBalance === 'number') return window.__userBalance;
    return 0;
  }

  let newScore = pickScore(data);
  
  // ⭐ [จุดแก้สำคัญ 3] ถ้าค่าที่ได้มาไม่ใช่ตัวเลข (undefined/null) ให้ใช้ค่าเดิม
  if (newScore === null || isNaN(newScore)) {
      if (typeof window.__userBalance === 'number') return window.__userBalance;
      newScore = 0;
  }

  // --- commit state ---
  window.__userBalance = newScore;
  try { cacheScore?.(uid, newScore); } catch {}

  // อัปเดต UI (การ์ด/หลอดเลือด/ตัวเลข)
  try { setPoints(newScore); } catch (e) { console.warn('setPoints failed', e); }

  // คำนวณ XP Pair
  let need = Number(data?.need ?? data?.next_need);
  let cur  = Number(data?.current ?? newScore);
  let max  = Number(data?.max ?? data?.target);

  if (!Number.isFinite(max) || max <= 0) {
    try {
      const tier = (typeof getTier === 'function') ? getTier(newScore) : null;
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
      max  = newScore || 1; cur = newScore; need = 0;
    }
  }

  const pair = document.getElementById('xpPair');
  if (pair) pair.textContent = `${cur} / ${max} คะแนน`;

  try { window.setLastUpdated?.(Date.now(), fromCache); } catch {}

  // ถ้าขอ poll เพื่อตามคะแนนจริงหลังทำธุรกรรม
  if (poll) {
    // ลดความถี่การ Poll ลงนิดนึงเพื่อกัน Server รับภาระหนักเกินไป (เป็น 1 วินาที)
    try { await pollScoreUntil(uid, newScore, pollTries, 1000); } catch {}
  }

  return newScore;
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

// ใช้รูปจาก API เป็นหลัก ถ้าไม่มีให้ใช้ placeholder
function pickRewardImage(r, slotIndex){
  return r?.img || `https://placehold.co/640x480?text=${encodeURIComponent(r?.name || `Gift ${slotIndex+1}`)}`;
}

// fallback เวลา API ไม่มีข้อมูล (ไม่อ้างอิง IMAGE_BY_INDEX อีกต่อไป)
function buildFallbackRewards(costs){
  return costs.map((cost, idx)=>({
    id:   `R${String(idx+1).padStart(2,'0')}-${cost}`,
    name: `Gift ${idx+1}`,
    cost: Number(cost)
  }));
}

/** จัดเรียง rewards จาก API ให้ตรงตาม COST_ORDER และเติมที่ขาด */
// เรียงรางวัล: ของที่ "ยังมี stock" มาอยู่ก่อน แล้วเรียงตาม sort_index
function orderRewardsBySequence(list) {
  return [...list].sort((a, b) => {
    const sa = Number(a.stock ?? 0);
    const sb = Number(b.stock ?? 0);

    // 1) ของหมดต้องอยู่ท้ายสุด
    if (sa <= 0 && sb > 0) return 1;
    if (sb <= 0 && sa > 0) return -1;

    // 2) ถ้าทั้งคู่ยังมีของ → เรียงตาม sort_index
    const ia = Number(a.sort_index ?? 999);
    const ib = Number(b.sort_index ?? 999);

    return ia - ib;
  });
}

function hideRewardSkeleton() {
  document.querySelectorAll('.reward-skeleton').forEach(el => el.style.display = 'none');
  document.getElementById('rewardsSection')?.classList.remove('skeleton-hide-when-loading');
}

async function kickOffUI() {
  try {
    // โหลดคะแนน/โปรไฟล์
    if (typeof refreshUserScore === 'function') await refreshUserScore({ bust: true });
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

// โหลดของรางวัล + cache
async function loadRewards(opts = {}) {
  const include = opts.include ?? 0;
  const uid     = opts.uid || window.__UID || '';
  const qs      = new URLSearchParams();
  if (include != null) qs.set('include', String(include));
  if (uid) qs.set('uid', uid);

  const url = `/api/rewards${qs.toString() ? `?${qs}` : ''}`;

  try {
    const res  = await fetch(url, { cache: 'no-store' });
    const json = await res.json();
    if (json?.status !== 'success') throw new Error('bad payload');

  const list = (json.items || json.data || []).map(x => ({
    id        : x.id ?? x.reward_id ?? '',
    name      : x.name ?? x.title ?? `Reward`,
    cost      : Number(x.cost ?? x.point_cost ?? x.points ?? 0),
    img       : x.img ?? x.image ?? x.image_url ?? '',
    
    // 👇👇 เพิ่ม 2 ฟิลด์นี้เข้าไป
    stock     : Number(x.stock ?? 0),
    stock_max : Number(x.stock_max ?? 0)
  }));

    const ordered = orderRewardsBySequence(list, COST_ORDER);

    REWARDS_CACHE = ordered;
    try { cacheRewards(ordered); } catch {}

    if (typeof renderRewards === 'function') {
      const score = Number(window.prevScore || 0);
      renderRewards(score);
    }
  } catch (e) {
    console.error('loadRewards error:', e);
    REWARDS_CACHE = buildFallbackRewards(COST_ORDER);
    try { cacheRewards(REWARDS_CACHE); } catch {}
    if (typeof renderRewards === 'function') {
      const score = Number(window.prevScore || 0);
      renderRewards(score);
    }
  } finally {
    try { hideRewardSkeletons && hideRewardSkeletons(); } catch {}
  }
}

// preload รูปบนสุด (เพื่อให้ช่องแรก/แถวแรกขึ้นไว)
function preloadTopRewardImages(rewards, count = 2) {
  const top = rewards.slice(0, count);
  for (const r of top) {
    if (!r?.img) continue;
    const link = document.createElement('link');
    link.rel = 'preload';
    link.as = 'image';
    link.href = r.img;
    // บางเบราว์เซอร์รองรับ fetchpriority ใน <link>
    link.fetchPriority = 'high';
    document.head.appendChild(link);
  }
}

/** render + click-to-redeem (optimized images) */
function renderRewards(currentScore){
  const rail = document.querySelector('.rp-reward-rail');
  if (!rail) return;

  // ถ้าโหลดจาก API แล้วใช้ REWARDS_CACHE, ถ้ายังไม่มีใช้ fallback เดิม
  const data = Array.isArray(REWARDS_CACHE) && REWARDS_CACHE.length
    ? REWARDS_CACHE
    : buildFallbackRewards(COST_ORDER);

  // preload รูป 1–2 ใบแรกให้ขึ้นไว
  preloadTopRewardImages(data, 2);

  rail.innerHTML = data.map((r, i) => {
    const cost  = Number(r.cost || 0);
    const score = Number(currentScore || 0);

    // stock จาก API (/api/rewards.js ส่งมาแล้ว)
    const stockRaw    = typeof r.stock === 'number' ? r.stock : parseInt(r.stock ?? '0', 10) || 0;
    const stockMaxRaw = typeof r.stock_max === 'number' ? r.stock_max : parseInt(r.stock_max ?? '0', 10) || 0;

    const stock    = Math.max(0, stockRaw);
    const stockMax = stockMaxRaw > 0 ? stockMaxRaw : null;

    const outOfStock    = stock <= 0;
    const lockedByPoint = !outOfStock && score < cost; // ถ้าของหมด ไม่ต้องโชว์ "คะแนนไม่พอ"

    const classes = ['rp-reward-card'];
    if (lockedByPoint) classes.push('locked');
    if (outOfStock)    classes.push('soldout');

    const id   = escapeHtml(r.id || `R${i+1}`);
    const name = escapeHtml(r.name || id);
    const img  = pickRewardImage(r, i);

    const eager = i < 2 ? 'eager' : 'lazy';
    const prio  = i < 2 ? 'high'  : 'low';

    // text stock
    let stockLabel = '';
    if (outOfStock) {
      stockLabel = `<span class="rp-reward-stock rp-reward-stock-out">หมดแล้ว</span>`;
    } else if (stockMax != null) {
      stockLabel = `<span class="rp-reward-stock">เหลือ ${stock}/${stockMax} ชิ้น</span>`;
    } else {
      stockLabel = `<span class="rp-reward-stock">เหลือ ${stock} ชิ้น</span>`;
    }

    return `
      <div class="${classes.join(' ')}"
           data-id="${id}"
           data-cost="${cost}"
           data-stock="${stock}"
           title="${name}">
        <div class="rp-reward-img">
          <img
            src="${img}"
            alt="${name}"
            loading="${eager}"
            decoding="async"
            fetchpriority="${prio}"
            width="300" height="425"
            onload="this.classList.add('is-ready')"
            onerror="this.onerror=null;this.src='https://placehold.co/600x850?text=${encodeURIComponent(name)}';this.classList.add('is-ready');"
          >
          <div class="rp-reward-cost">${cost} pt</div>
          ${stockLabel}
        </div>
        <div class="rp-reward-body p-2">
          <div class="fw-bold text-truncate">${name}</div>
        </div>
        <button class="rp-redeem-btn"
                aria-label="แลก ${name}"
                ${outOfStock || lockedByPoint ? 'disabled' : ''}>
          <i class="fa-solid fa-gift"></i>
        </button>
      </div>
    `;
  }).join("");

  // one-time click binding (ใช้ของเดิมได้เลย)
  if (!rewardRailBound) {
    rail.addEventListener("click", async (ev) => {
      const btn = ev.target.closest(".rp-redeem-btn");
      if (!btn || btn.disabled) return;
      const card = btn.closest(".rp-reward-card");
      if (!card) return;
      const id   = card.dataset.id;
      const cost = Number(card.dataset.cost);
      
      // ⭐ เพิ่ม: ดึงชื่อและรูปภาพจากการ์ด
      const name = card.getAttribute('title') || 'ของรางวัล';
      const img  = card.querySelector('img')?.src || '';

      if (!id || Number.isNaN(cost)) return;
      
      // ⭐ ส่ง name และ img ไปที่ฟังก์ชัน redeemReward ด้วย
      await redeemReward({ id, cost, name, img }, btn);
    });
    rewardRailBound = true;
  }
}

// ฟังก์ชันแลกของรางวัล (แก้ไข: ตัดระบบเช็คซ้ำออก แก้ปัญหาจอกระพริบและแต้มหาย)
let REDEEMING = false;
async function redeemReward(reward, btn){
  if (REDEEMING) return;

  const curUid = (typeof UID !== 'undefined' && UID) ||
                 window.__UID ||
                 localStorage.getItem('uid') || '';
  if (!curUid) return toastErr("ยังไม่พร้อมใช้งาน");

  const id   = reward?.id;
  const cost = Math.max(0, Number(reward?.cost) || 0);
  
  // Fallback ชื่อ/รูป
  let name = reward?.name;
  let img  = reward?.img;
  if (!name || !img) {
    const cached = (window.REWARDS_CACHE || []).find(r => r.id === id);
    if (cached) {
       if (!name) name = cached.name;
       if (!img)  img  = cached.img;
    } else {
       const card = document.querySelector(`.rp-reward-card[data-id="${id}"]`);
       if (card) {
          if (!name) name = card.getAttribute('title');
          if (!img)  img  = card.querySelector('img')?.src;
       }
    }
  }
  name = name || id;
  img  = img  || '';

  if (!id || !cost) return toastErr("ข้อมูลรางวัลไม่ถูกต้อง");

  // เช็คคะแนนแบบแม่นยำ (Variables + DOM)
  let scoreNow = 0;
  if (typeof prevScore !== 'undefined') scoreNow = Number(prevScore);
  if (scoreNow === 0 && typeof window.__userBalance === 'number') scoreNow = window.__userBalance;
  if (scoreNow === 0) {
      const pointEl = document.getElementById('points');
      if (pointEl) scoreNow = Number(pointEl.textContent.replace(/,/g, '')) || 0;
  }

  if (scoreNow < cost) {
      return toastErr(`คะแนนไม่พอ (มี ${scoreNow} ใช้ ${cost})`);
  }

  // Popup ยืนยัน
  const confirmed = window.Swal
    ? (await Swal.fire({
        title: "ยืนยันการแลก?", 
        html: `ต้องการแลก <b>${h(name)}</b><br>จะใช้คะแนน <b>${cost}</b> pt`,
        icon: "question", 
        showCancelButton: true, 
        confirmButtonText: "แลกเลย",
        confirmButtonColor: "#3085d6",
        cancelButtonText: "ยกเลิก"
      })).isConfirmed
    : confirm(`ใช้ ${cost} pt แลกรางวัล ${name}?`);
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
    if (payload?.status !== "success")
      throw new Error(payload?.message || "spend failed");

    // ตัดสต็อกใน Cache ทันที
    if (Array.isArray(window.REWARDS_CACHE)) {
        const cacheIndex = window.REWARDS_CACHE.findIndex(r => r.id === id);
        if (cacheIndex > -1) {
            let s = window.REWARDS_CACHE[cacheIndex].stock;
            if (s > 0) window.REWARDS_CACHE[cacheIndex].stock = s - 1;
        }
    }

    // ตัดแต้มที่หน้าจอทันที (Optimistic Update)
    optimisticSpend(cost);

    // อัปเดตการ์ดสต็อก (DOM)
    const card = document.querySelector(`.rp-reward-card[data-id="${id}"]`);
    if (card) {
      const stockEl = card.querySelector(".rp-reward-stock");
      let stock = Number(card.dataset.stock || 0);
      if (stock > 0) {
        stock -= 1;
        card.dataset.stock = stock;
        if (stock === 0) {
          stockEl.textContent = "หมดแล้ว";
          card.classList.add("soldout");
          const btnRedeem = card.querySelector(".rp-redeem-btn");
          if (btnRedeem) btnRedeem.disabled = true;
        } else {
          const max = Number(card.dataset.stockMax || 0);
          stockEl.textContent = max > 0 ? `เหลือ ${stock}/${max} ชิ้น` : `เหลือ ${stock} ชิ้น`;
        }
      }
    }

    UiOverlay.hide();

    // Popup สำเร็จ
    if (window.Swal){
      await Swal.fire({
        title: "แลกสำเร็จ! 🎉",
        imageUrl: img || undefined,
        imageWidth: 150,
        imageHeight: 'auto',
        imageAlt: name,
        html: `
          <h5 class="fw-bold text-dark mt-2">${h(name)}</h5>
          <div class="mb-3 text-muted">ใช้ไป <span class="badge bg-danger rounded-pill">${cost} pt</span></div>
          <div class="alert alert-warning small p-2">
             <i class="fa-solid fa-camera"></i> แคปหน้าจอนี้ไว้เพื่อรับของรางวัล
          </div>
        `,
        confirmButtonText: "ตกลง",
        confirmButtonColor: "#22c55e"
      });
    } else {
      alert(`แลก ${name} สำเร็จ!`);
    }

    // ⭐ [จุดสำคัญ] ตัดบรรทัด pollScoreUntil ออกไปเลยครับ ไม่ต้องเช็คซ้ำแล้ว
    // จะได้ไม่รีเฟรช 4 รอบ และแต้มจะไม่หาย
    
    // โหลดแค่อัปเดตสต็อกของรางวัลก็พอ
    try { await loadRewards({ include: 1, uid: curUid }); } catch {}

  }catch(err){
    console.error(err);
    UiOverlay.hide();
    toastErr("แลกไม่สำเร็จ: " + (err.message || "Error"));
  }finally{
    setBtnLoading(btn, false);
    REDEEMING = false;
  }
}

// ===== Redeem code (unified) — overlay เฉพาะ SCAN + optimistic + poll baseline ที่ถูกต้อง =====
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
  try { await refreshUserScore({ bust: true }); } catch {}
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

  // รีเฟรชอีกครั้งแบบ bust เพื่อดึงยอด “จริงล่าสุดจากเซิร์ฟเวอร์”
  try { await refreshUserScore({ bust: true }); } catch {}
  const after = Number(window.__userBalance || before);
  if (added === null) added = after - before;

  // เก็บ baseline "ก่อน" optimistic ไว้ใช้กับ poll
  const baselineBeforeOptimistic = Number(window.__userBalance || 0);

  if (usingScan) UiOverlay.hide();

  // 1) โชว์ผล + อัปเดตจอแบบ optimistic
  if (added > 0) {
    toastOk(`รับ +${added} คะแนน`);
    try { showScoreDelta?.(added); } catch {}
    optimisticAdd(added);
  } else {
    toastOk('แลกคูปองสำเร็จ');
  }

  // 2) ตามคะแนนจริงจากเซิร์ฟเวอร์ (โพลจน "แตกต่าง" จาก baseline ก่อน optimistic)
  try {
    const uidNow = (typeof UID !== 'undefined' && UID) || window.__UID || localStorage.getItem('uid') || '';
    await pollScoreUntil(uidNow, baselineBeforeOptimistic, 5, 650);
  } catch {}

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

  // เริ่มโหลด: เปิด skeleton
  if (skelEl) skelEl.style.display = '';
  if (listWrap) listWrap.classList.add('skeleton-hide-when-loading');
  listEl && (listEl.innerHTML = '');

  try{
    const resp = await fetch(`${API_HISTORY}?uid=${encodeURIComponent(uid)}`, { cache:'no-store' });
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

// ✅ ใช้บล็อกเดียวพอ
document.addEventListener('DOMContentLoaded', () => {
  if (window.__SKIP_AUTO_INIT__) return;
  initAppFast();
});

// ===== Local cache keys =====
const LS_PROFILE  = 'RP_PROFILE';
const LS_SCORE    = (uid)=>`RP_SCORE:${uid || 'anon'}`;
const LS_REWARDS  = 'RP_REWARDS_V1';

// hydrate จาก localStorage (เร็ว) + fallback ไป setPoints
function hydrateFromCache(uid) {
  try {
    const p = JSON.parse(localStorage.getItem(LS_PROFILE) || 'null');
    if (p?.displayName && typeof applyProfile === 'function') {
      applyProfile(p);
    }

    const scoreStr = localStorage.getItem(LS_SCORE(uid));
    const score = scoreStr ? Number(scoreStr) : null;
    if (score != null) {
      window.prevScore = score;
      if (typeof renderScoreCard === 'function') {
        renderScoreCard(score);
      } else if (typeof setPoints === 'function') {
        setPoints(score);
      }
    }

    const rewards = JSON.parse(localStorage.getItem(LS_REWARDS) || 'null');
    if (Array.isArray(rewards) && rewards.length) {
      window.REWARDS_CACHE = rewards;
      if (typeof renderRewards === 'function') renderRewards(score ?? 0);
    }
  } catch {}
}

// ===== Poll จนคะแนน "เปลี่ยน" (สั้น ๆ หลังธุรกรรม) =====
async function pollScoreUntil(uid, baseline, tries = 5, interval = 600) {
  for (let i = 0; i < tries; i++) {
    await new Promise(r => setTimeout(r, interval));
    const s = await refreshUserScore({ bust: true }); // บังคับดึงสด
    if (Number(s) !== Number(baseline)) {
      return s; // ได้คะแนนใหม่แล้ว
    }
  }
  return baseline; // ไม่เปลี่ยนภายในเวลาที่กำหนด
}

// ===== อัปเดตแบบ Optimistic แล้วค่อยตามผลจริง =====
function optimisticAdd(delta) {
  const cur = Number(window.__userBalance || 0);
  const next = cur + Number(delta || 0);
  window.__userBalance = next;
  try { setPoints(next); } catch {}
}

function optimisticSpend(cost) {
  const cur = Number(window.__userBalance || 0);
  const next = Math.max(0, cur - Number(cost || 0));
  window.__userBalance = next;
  try { setPoints(next); } catch {}
}

// ===== save back to cache =====
function cacheProfile(p){ try{ localStorage.setItem(LS_PROFILE, JSON.stringify(p || {})); }catch{} }
function cacheScore(uid,score){ try{ localStorage.setItem(LS_SCORE(uid), String(score ?? 0)); }catch{} }
function cacheRewards(list){ try{ localStorage.setItem(LS_REWARDS, JSON.stringify(list || [])); }catch{} }

// ===== helper: race with timeout to avoid slow LIFF =====
function withTimeout(promise, ms, fallback){
  let t; return Promise.race([
    promise.finally(()=>clearTimeout(t)),
    new Promise(res=>{ t=setTimeout(()=>res(fallback), ms); })
  ]);
}

// ===== boot sequence (no /api/bootstrap) =====
async function initAppFast() {
  // 1) เริ่ม LIFF พร้อม timeout กันช้า
  const { uid, profile } = await withTimeout(initLiffSafe(), 1500, { uid:'', profile:null });

  // 1.1 commit UID ไว้ให้ส่วนอื่นใช้
  if (uid) {
    window.__UID = uid;
    sessionStorage.setItem('uid', uid);
  }

  // 2) hydrate UI จาก cache (เร็วทันใจ)
  try { hydrateFromCache(uid); } catch {}

  // 3) อัปเดตชื่อ/รูปจาก LIFF (ถ้ามี)
  try {
    if (profile?.displayName && typeof applyProfile === 'function') {
      applyProfile(profile);
      cacheProfile(profile);
    }
  } catch {}

  // 3.1 ผูกอีเวนต์ UI ครั้งเดียว (ปุ่มสแกน/หยุด/รีเฟรช ฯลฯ)
  if (!window.__MAIN_BOUND && typeof bindUI === 'function') {
    try { bindUI(); } catch (e) { console.warn('bindUI failed', e); }
    window.__MAIN_BOUND = true;
  }

  // 3.2 แสดงปุ่มแอดมินถ้าเข้าเกณฑ์
  if (typeof showAdminFabIfAuthorized === 'function') {
    try { await showAdminFabIfAuthorized(); } catch {}
  }

  // 4) โหลดข้อมูลหลักแบบแยก endpoint
  try {
    await Promise.allSettled([
      (typeof refreshUserScore === 'function' ? refreshUserScore() : Promise.resolve()),
      (typeof loadRewards      === 'function' ? loadRewards()      : Promise.resolve())
    ]);

    // 5) เรนเดอร์ของรางวัลด้วยคะแนนล่าสุด
    if (typeof renderRewards === 'function') {
      const score = Number(window.prevScore || 0);
      renderRewards(score);
    }
  } catch (e) {
    console.warn('fast boot fallback failed', e);
  }

  // 6) ปิด skeleton
  try { hideRewardSkeleton && hideRewardSkeleton(); } catch {}
}

// ===== LIFF safe init (fixed to always use LIFF_ID) =====
async function initLiffSafe() {
  try {
    if (!window.__LIFF_INITED) {
      const liffId =
        (typeof LIFF_ID !== 'undefined' && LIFF_ID) ||
        (typeof window.LIFF_ID !== 'undefined' && window.LIFF_ID) ||
        '';
      if (!liffId) throw new Error('missing_liff_id');
      await liff.init({ liffId });
      window.__LIFF_INITED = true;
    }

    const prof = await liff.getProfile().catch(() => null);
    const uid =
      liff.getDecodedIDToken?.()?.sub ||
      prof?.userId || '';

    return {
      uid,
      profile: prof
        ? { displayName: prof.displayName || '', pictureUrl: prof.pictureUrl || '' }
        : null
    };
  } catch (e) {
    console.warn('liff init failed', e);
    return { uid: '', profile: null };
  }
}