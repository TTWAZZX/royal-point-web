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


/** Admin gate */
const ADMIN_UIDS = ["Ucadb3c0f63ada96c0432a0aede267ff9"];

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
let SCANNING = false;          // กล้องกำลังทำงานอยู่หรือไม่
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

// ⬇️ วางทับของเดิมทั้งหมด
async function initApp(){
  try{
    await liff.init({ liffId: LIFF_ID });
    if (!liff.isLoggedIn()){ liff.login(); return; }

    const prof = await liff.getProfile();
    UID = prof.userId;

    // บันทึก UID เผื่อรอบหน้า และให้โค้ดส่วนอื่นมองเห็นแน่ ๆ
    window.__UID = UID;
    try { localStorage.setItem('uid', UID); } catch {}

   if (els.username) {
  els.username.textContent = prof.displayName || "—";
  try { localStorage.setItem('displayName', prof.displayName || ""); } catch {}
  }
  if (els.profilePic) {
    els.profilePic.src = prof.pictureUrl || "https://placehold.co/120x120";
  }
    setHistoryUserName();

    enableAvatarPreview();
    showAdminEntry(ADMIN_UIDS.includes(UID));
    bindUI();
    enableTierTooltip();

    // สถานะ online/offline
    toggleOfflineBanner(!navigator.onLine);
    window.addEventListener("online",  ()=> toggleOfflineBanner(false));
    window.addEventListener("offline", ()=> toggleOfflineBanner(true));

    await refreshUserScore();
    await loadRewards();
    renderRewards(prevScore || 0);
  }catch(e){
    console.error(e);
    toastErr("เริ่มต้นระบบไม่สำเร็จ");
  }finally{
    setAppLoading(false);
    document.body.classList.remove('loading');
    document.body.classList.add('ready');
    setTimeout(()=>document.body.classList.remove('ready'), 1000);
  }
}

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

function bindUI(){
  // ปุ่มรีเฟรชคะแนน
  els.btnRefresh && els.btnRefresh.addEventListener("click", refreshUserScore);

  // ปุ่มประวัติ — ผูกที่เดียวพอ
  els.btnHistory && els.btnHistory.addEventListener("click", openHistory);

  // ควบคุมกล้องในโมดัล
  const scanModalEl = document.getElementById('scanModal');
  if (scanModalEl) {
    // เริ่มอัตโนมัติเมื่อโมดัลแสดง
    scanModalEl.addEventListener('shown.bs.modal', () => { startScanner && startScanner(); });
    // หยุดเมื่อจะปิด/ปิดแล้ว
    scanModalEl.addEventListener('hide.bs.modal',   () => { stopScanner && stopScanner(); });
    scanModalEl.addEventListener('hidden.bs.modal', () => { stopScanner && stopScanner(); });
  }

  // ปุ่ม start/stop (ไว้สำหรับควบคุมมือ)
  const startBtn = document.getElementById("startScanBtn");
  const stopBtn  = document.getElementById("stopScanBtn");
  startBtn && startBtn.addEventListener("click", () => startScanner && startScanner());
  stopBtn  && stopBtn .addEventListener("click", () => stopScanner  && stopScanner());

  // ปุ่มไฟฉายตามเดิม
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

  async function startScanner(){
  if (!els?.qrReader) return toastErr('ไม่พบพื้นที่สแกน');
  if (SCANNING) return;

  // ต้องเป็น HTTPS/localhost
  const secure = (location.protocol === 'https:' ||
                  location.hostname === 'localhost' ||
                  location.hostname === '127.0.0.1');
  if (!secure || !isSecureContext) {
    return toastErr('กล้องถูกบล็อก: กรุณาเปิดผ่าน HTTPS หรือ localhost');
  }

  // ขอสิทธิ์กล้อง (เพื่อให้ enumerate ได้ label)
  try { await ensureCameraPermission(); }
  catch (e) { console.warn(e); return toastErr(e.userMessage || 'อนุญาตกล้องก่อนใช้งาน'); }

  // เตรียมพื้นที่สแกน
  els.qrReader.innerHTML = '';
  els.qrReader.style.minHeight = '320px';

  // เคลียร์ตัวเก่า
  try { if (html5qrcode) { await stopScanner(); } } catch {}
  html5qrcode = new Html5Qrcode(els.qrReader.id, { verbose: false });

  const onScan = async (decodedText) => {
    const code = String(decodedText || '').trim();
    const now  = Date.now();
    if (!code) return;
    if (REDEEM_IN_FLIGHT) return;
    if (code && code === LAST_DECODE && (now - LAST_DECODE_AT) < DUP_COOLDOWN) return;
    LAST_DECODE = code; LAST_DECODE_AT = now;

    REDEEM_IN_FLIGHT = true;
    try {
      await stopScanner();
      await redeemCode(code, 'SCAN');
    } finally {
      setTimeout(()=>{ REDEEM_IN_FLIGHT = false; }, 300);
    }
  };
  const onScanFailure = (_err) => {};

  const qrbox = (() => {
    const size = Math.min(320, Math.floor(Math.min(window.innerWidth, 480) - 32));
    return { width: size, height: size };
  })();

  // ไม่จำ device เดิม เพื่อกันติดกล้องหน้าที่เคยใช้
  const config = { fps: 10, qrbox, aspectRatio: 1.7778, rememberLastUsedCamera: false };

  async function startWithEnvironment(strict){
    const constraint = strict
      ? { facingMode: { exact: "environment" } }
      : { facingMode: "environment" };
    await html5qrcode.start(constraint, config, onScan, onScanFailure);
  }

  SCANNING = true;
  try {
    // 1) บังคับ environment แบบ strict ก่อน
    await startWithEnvironment(true);
    afterCameraStarted?.();
  } catch (e1) {
    try {
      // 2) ผ่อนเงื่อนไขลง (บางเบราว์เซอร์)
      await startWithEnvironment(false);
      afterCameraStarted?.();
    } catch (e2) {
      // 3) เลือกจากรายการอุปกรณ์ โดยพยายามเล็ง “กล้องหลัง”
      let devices = [];
      try { devices = await Html5Qrcode.getCameras(); } catch {}
      if (!devices?.length) {
        SCANNING = false;
        console.warn('no camera devices', e2);
        return toastErr('ไม่พบกล้องในอุปกรณ์นี้');
      }

      const backRe  = /(back|rear|environment|world|main|wide|triple)/i;
      const frontRe = /(front|user|selfie|face)/i;

      let chosen = devices.find(d => backRe.test(d.label));
      if (!chosen) {
        // บางเครื่องเรียงกล้องหน้าไว้ก่อน → ลองจากท้ายก่อน
        chosen = [...devices].reverse().find(d => !frontRe.test(d.label)) || devices[devices.length - 1];
      }

      await html5qrcode.start(chosen.id, config, onScan, onScanFailure);
      afterCameraStarted?.();

      // 4) ยืนยันอีกชั้นว่าไม่ได้เผลอเปิดกล้องหน้า
      const track = getActiveVideoTrack();
      const fm = track?.getSettings?.().facingMode || '';
      const lbl = track?.label || '';
      if (/^user$/i.test(fm) || frontRe.test(lbl)) {
        await stopScanner();
        await startWithEnvironment(false);
        afterCameraStarted?.();
      }
    }
  }

  // อัปเดตสถานะ track สำหรับไฟฉาย
  ACTIVE_VIDEO_TRACK = getActiveVideoTrack();
}

  // ยืนยันรหัสลับ (กรณีกรอกมือ)
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
  // === ปิดท้าย bindUI: ค่อย export เป็น global ตรงนี้ ===
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

function showAdminEntry(isAdmin){ const b=$("btnAdmin"); if(b) b.classList.toggle("d-none", !isAdmin); }
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

// แสดงข้อความ: อีกกี่คะแนนถึงระดับถัดไป
function updateTierStatus(score){
  const el = document.getElementById('tierStatus');
  if (!el) return;

  try {
    // คาดหวังว่ามี getTier(score) คืน { name/label, min, next, nextName? }
    const tier = (typeof getTier === 'function') ? getTier(score) : null;

    // ถ้า tier.next เป็นเลขและมากกว่าคะแนนปัจจุบัน → ยังมีระดับถัดไป
    if (tier && Number.isFinite(tier.next) && tier.next > score) {
      const remain = Math.max(0, tier.next - Number(score || 0));
      // ชื่อระดับถัดไป (ถ้ามี) ไม่มีก็ใช้ข้อความกลาง
      const nextName =
        tier.nextName || tier.next_label ||
        (typeof getTier === 'function' ? (getTier(tier.next)?.name || getTier(tier.next)?.label) : '') ||
        'ระดับถัดไป';

      el.textContent = `ต้องการอีก ${remain.toLocaleString('th-TH')} คะแนนเพื่อเลื่อนเป็น ${nextName}`;
      el.classList.remove('hidden');
      return;
    }

    // อยู่ระดับสูงสุด / ไม่มีข้อมูล tier → ซ่อนบรรทัด
    el.textContent = '';
    el.classList.add('hidden');
  } catch (e) {
    // ผิดพลาดใด ๆ → ซ่อน
    el.textContent = '';
    el.classList.add('hidden');
  }
}

// อัปเดต UI ทั้งหมดจากคะแนนเดียว
function setPoints(score){
  score = Number(score || 0);

  // ---- Tier + Next tier ----
  const tier = getTier(score);

  applyPremiumTheme(tier.key);  // ← ย้อมธีมการ์ดตามระดับ
  setAvatarArc(score);         // ← วาดวงแหวนรอบรูป
  let _sparkledOnce = false;
  function spawnAvatarSparklesOnce(){
    if (_sparkledOnce) return;
    _sparkledOnce = true;
  spawnAvatarSparkles();
  }
  // ใน setPoints():
  // - ตอนโหลดครั้งแรก
  spawnAvatarSparklesOnce();
  // - และ/หรือ ตอนเลเวลเปลี่ยน
  if (prevLevel && prevLevel !== tier.key){ spawnAvatarSparkles(); }

  bumpScoreFx();                // ← เด้งตัวเลขทุกครั้ง

  // ฟองคะแนนลอยขึ้น
  const delta = Number(score) - Number(prevScore || 0);
  if (delta) showScoreDelta(delta);

  const idx  = TIERS.findIndex(t => t.key === tier.key);
  const nextTierObj = TIERS[idx + 1] || null;

  // ---- คะแนนเด้งขึ้น ----
  if (els.points){
    const from = prevScore ?? Number(els.points.textContent || 0);
    animateCount(els.points, from, score, 600);
  }

  // ---- UI ระดับ (pill/dot/tag) + ข้อความระดับปัจจุบัน ----
  if (typeof setTierUI === "function") setTierUI(tier, score);  // NEW
  if (els.currentLevelText) els.currentLevelText.textContent = tier.name;

  // ---- Progress bar (สี + ความกว้าง) ----
  if (els.progressBar){
    els.progressBar.classList.remove("prog-silver","prog-gold","prog-platinum");
    els.progressBar.classList.add(tier.progClass);
  }
  if (els.progressFill){
    const pct = tier.next === Infinity ? 1 : (score - tier.min) / (tier.next - tier.min);
    els.progressFill.style.width = `${Math.max(0, Math.min(100, pct * 100))}%`;
  }

  // ---- แถบ/ธีม/ตัวเลขคู่ของ XP + motion ----
  if (typeof applyXpThemeByTier === "function") applyXpThemeByTier(tier.key);
  if (typeof updateLevelTrack   === "function") updateLevelTrack(score);
  if (typeof updatePremiumBar   === "function") updatePremiumBar(score);
  if (typeof setXpPair          === "function") setXpPair(score);      // NEW 1209 / 1200 คะแนน
  if (typeof bumpXpFill         === "function") bumpXpFill();          // เด้งแถบทุกครั้งที่แต้มเปลี่ยน

  // ---- Chips สรุปย่อใต้ชื่อ (มี/ไม่มีก็ไม่พัง) ----
  if (typeof updateStatChips === "function"){
    updateStatChips({
      tierName: tier.name,
      points: score,
      streakDays: window.USER_STREAK
    });
  }

  // ---- ข้อความเลเวลถัดไป ----
  if (els.nextTier){
    if (!nextTierObj){
      els.nextTier.textContent = "คุณถึงระดับสูงสุดแล้ว ✨";
    } else {
      const need = Math.max(0, nextTierObj.min - score);
      els.nextTier.textContent = `สะสมอีก ${need} คะแนน → เลื่อนเป็น ${nextTierObj.name} ${TIER_EMOJI[nextTierObj.name] || ""}`;
    }
  }

  // ---- รางวัล & เอฟเฟกต์เปลี่ยนเลเวล ----
  if (typeof renderRewards === "function") renderRewards(score);
  if (prevLevel && prevLevel !== tier.key){
    try{ launchConfetti(); }catch{}
  }

  // ---- Level meter (ถ้ามีเวอร์ชันเก่า) ----
  const lmFill  = document.getElementById("lm-fill");
  const lmLabel = document.getElementById("lm-label");
  if (lmFill && lmLabel){
    const total = 1200;
    const widthPct = Math.max(0, Math.min(100, (score/total)*100));
    lmFill.style.width = widthPct + "%";
    if (tier.next === Infinity){
      lmLabel.textContent = `ระดับ ${tier.name} สูงสุดแล้ว ✨ คะแนนรวม ${score.toLocaleString()}`;
    } else {
      const need = tier.next - score;
      lmLabel.textContent = `อยู่ระดับ ${tier.name} • ขาดอีก ${need} คะแนนเพื่อไป ${TIERS.find(x=>x.min===tier.next)?.name || 'ระดับถัดไป'}`;
    }
  }

  // ---- ป้ายอันดับ (ถ้ามีฟังก์ชัน) ----
  if (typeof setRankBadge === "function") setRankBadge(window.USER_RANK, tier.key);

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
const IMAGE_BY_INDEX = [
  "https://lh3.googleusercontent.com/d/1o_VHWrIuc9o56MCRuzjrycB8W5w_dT5d", // ช่อง 1 (40 pt)
  "https://lh3.googleusercontent.com/d/1vEP5DqyX0vgkv3_XDAyLxJpLm3zUtrqR", // ช่อง 2 (50 pt)
  "https://lh3.googleusercontent.com/d/1Ve6_BNWlL59BdQXaTLdxdvX4iLYomUyX", // ช่อง 3 (60 pt)
  "https://placehold.co/640x480?text=Gift+04", // 70
  "https://placehold.co/640x480?text=Gift+05", // 80
  "https://placehold.co/640x480?text=Gift+06", // 100
  "https://placehold.co/640x480?text=Gift+07", // 100
  "https://placehold.co/640x480?text=Gift+08", // 100
  "https://placehold.co/640x480?text=Gift+09", // 100
  "https://placehold.co/640x480?text=Gift+10", // 120
  "https://placehold.co/640x480?text=Gift+11", // 120
  "https://placehold.co/640x480?text=Gift+12", // 120
  "https://placehold.co/640x480?text=Gift+13", // 120
  "https://placehold.co/640x480?text=Gift+14", // 150
  "https://placehold.co/640x480?text=Gift+15", // 180
  "https://placehold.co/640x480?text=Gift+16", // 200
  "https://placehold.co/640x480?text=Gift+17", // 150
  "https://placehold.co/640x480?text=Gift+18", // 180
  "https://placehold.co/640x480?text=Gift+19", // 200
  "https://placehold.co/640x480?text=Gift+20", // 200
  "https://placehold.co/640x480?text=Gift+21", // 220
  "https://placehold.co/640x480?text=Gift+22", // 230
  "https://placehold.co/640x480?text=Gift+23", // 250
  "https://placehold.co/640x480?text=Gift+24", // 250
  "https://placehold.co/640x480?text=Gift+25", // 250
  "https://placehold.co/640x480?text=Gift+26", // 250
  "https://placehold.co/640x480?text=Gift+27", // 250
  "https://placehold.co/640x480?text=Gift+28", // 250
  "https://placehold.co/640x480?text=Gift+29", // 350
  "https://placehold.co/640x480?text=Gift+30", // 380
  "https://placehold.co/640x480?text=Gift+31", // 400
  "https://placehold.co/640x480?text=Gift+32", // 400
  "https://placehold.co/640x480?text=Gift+33", // 400
  "https://placehold.co/640x480?text=Gift+34", // 400
  "https://placehold.co/640x480?text=Gift+35", // 400
  "https://placehold.co/640x480?text=Gift+36", // 400
  "https://placehold.co/640x480?text=Gift+37", // 450
  "https://placehold.co/640x480?text=Gift+38", // 500
  "https://placehold.co/640x480?text=Gift+39", // 500
  "https://placehold.co/640x480?text=Gift+40", // 600
  "https://placehold.co/640x480?text=Gift+41", // 700
  "https://placehold.co/640x480?text=Gift+42", // 800
  "https://placehold.co/640x480?text=Gift+43", // 900
  "https://placehold.co/640x480?text=Gift+44"  // 1000
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

function hideRewardSkeletons(){
  document.querySelectorAll('.reward-skeleton').forEach(el => el.style.display = 'none');
}

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
  if (!UID) return toastErr("ยังไม่พร้อมใช้งาน");

  const id   = reward?.id;
  const cost = Math.max(0, Number(reward?.cost) || 0);
  if (!id || !cost) return toastErr("ข้อมูลรางวัลไม่ถูกต้อง");

  const scoreNow = Number(prevScore || 0);
  if (scoreNow < cost) return toastErr("คะแนนไม่พอสำหรับรางวัลนี้");

  const confirmed = window.Swal
    ? (await Swal.fire({ title:"ยืนยันการแลก?", html:`จะใช้ <b>${cost} pt</b> แลกรางวัล <b>${escapeHtml(id)}</b>`, icon:"question", showCancelButton:true, confirmButtonText:"แลกเลย" })).isConfirmed
    : confirm(`ใช้ ${cost} pt แลกรางวัล ${id}?`);
  if (!confirmed) return;

  REDEEMING = true;
  setBtnLoading(btn, true, 'กำลังแลก…');
  UiOverlay.show('กำลังบันทึกการแลกของรางวัล…');

  try{
    const res = await fetch(API_SPEND, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid: UID, cost, rewardId: id })
    });
    const payload = await safeJson(res);
    if (payload?.status !== "success") throw new Error(payload?.message || "spend failed");

    await refreshUserScore(); // คะแนนจะถูกหักแล้วอัปเดต UI
    UiOverlay.hide();
    if (window.Swal){
      await Swal.fire({ title:"แลกสำเร็จ ✅", html:`ใช้ไป <b>${cost} pt</b><br><small>กรุณาแคปหน้าจอนี้ไว้เพื่อนำไปแสดงรับรางวัล</small>`, icon:"success" });
    }else{
      alert("แลกสำเร็จ! กรุณาแคปหน้าจอไว้เพื่อนำไปแสดงรับรางวัล");
    }
  }catch(err){
    console.error(err);
    UiOverlay.hide();
    toastErr(err.message || "แลกรางวัลไม่สำเร็จ");
  }finally{
    REDEEMING = false;
    setBtnLoading(btn, false);
  }
}

/* ================= Redeem code / Scanner ================= */
// ใช้แทนฟังก์ชันเดิมทั้งหมด
// แก้ทั้งฟังก์ชัน redeemCode ให้แนบ uid เสมอ
// ใช้แค่ /api/redeem ที่เดียว และส่งฟิลด์ให้ครบ
// แลกคูปอง + แจ้งจำนวนคะแนนที่ได้รับ (รองรับ manual และ SCAN)
// แลกคูปอง: robust ต่อ status code + json.code และ auto-resume กล้องเมื่อคูปองใช้แล้ว
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
  const scanOpen = !!document.getElementById('scanModal')?.classList.contains('show');
  if (source === 'SCAN' && scanOpen) {
    setTimeout(() => { try { startScanner?.(); } catch {} }, 400);
  }
}

// เดิมคุณอาจมี redeemCoupon แยก: ให้เรียกผ่าน redeemCode เพื่อรวม logic เดียวกัน
async function redeemCoupon(code, uid) {
  // uid ไม่จำเป็นต้องส่งเข้ามาแล้ว เพราะ redeemCode จะดึง UID เอง
  return redeemCode(code, 'MANUAL');
}

async function stopScanner(){
  try{
    try{ if (TORCH_ON) await toggleTorch(false); }catch{}
    ACTIVE_VIDEO_TRACK = null; TORCH_ON = false;

    if (html5qrcode){
      await html5qrcode.stop();
      await html5qrcode.clear();
      html5qrcode = null;
    }
  }catch(e){ console.warn("stopScanner error", e); }
  finally{
    els.qrReader && (els.qrReader.innerHTML = "");
    SCANNING = false;
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
// ประวัติพ้อยท์ (มินิมอล: แสดงเฉพาะคะแนน + วันเวลา)
// ประวัติพ้อยท์ (มินิมอล: วันเวลา + คะแนน) + หัวโมดัลเป็นชื่อผู้ใช้
async function openHistory(){
  const uid =
    (typeof UID !== 'undefined' && UID) ||
    window.__UID ||
    localStorage.getItem('uid') || '';
  if (!uid) return toastErr('ไม่พบผู้ใช้');

  setHistoryUserName(); // <-- ใส่บรรทัดนี้setHistoryUserName(); // <-- ใส่บรรทัดนี้
  setHistoryUserName(); // <-- ใส่บรรทัดนี้

  const listEl  = document.getElementById('historyList');
  const modalEl = document.getElementById('historyModal');
  const modal   = new bootstrap.Modal(modalEl);

  // helper ไม่ชนชื่อเดิม
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
  const getDisplayName = () =>
    (window.DISPLAY_NAME ||
     window.__DISPLAY_NAME ||
     localStorage.getItem('displayName') ||
     document.querySelector('#profileName, [data-profile-name], .profile-name, .user-name, .profile-title')?.textContent?.trim() ||
     uid || 'ผู้ใช้');

  // ใส่ชื่อผู้ใช้ที่หัวโมดัล
  const titleEl = modalEl.querySelector('.modal-title');
  if (titleEl) titleEl.innerHTML = `ประวัติพ้อยท์ — <span class="text-primary fw-semibold">${esc(getDisplayName())}</span>`;

  // formatter เวลาแบบไทย
  const fmtThaiDateTime = (v) => {
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString('th-TH', {
      timeZone: 'Asia/Bangkok',
      year:'numeric', month:'short', day:'2-digit',
      hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false
    }) + ' น.';
  };

  UiOverlay.show('กำลังโหลดประวัติ…');
  try{
    const resp = await fetch(`${API_HISTORY}?uid=${encodeURIComponent(uid)}`, { cache:'no-store' });
    const json = await resp.json().catch(()=> ({}));
    const items = Array.isArray(json) ? json
      : Array.isArray(json.items) ? json.items
      : Array.isArray(json.data)  ? json.data
      : [];

    // ล่าสุดอยู่บน
    items.sort((a,b)=>{
      const ta = new Date(a.created_at || a.time || 0).getTime();
      const tb = new Date(b.created_at || b.time || 0).getTime();
      if (tb !== ta) return tb - ta;
      return String(b.id || b.uuid || '').localeCompare(String(a.id || a.uuid || ''));
    });

    // โหมดมินิมอล: เวลา + คะแนน
    listEl.classList.add('hist-compact');
    listEl.innerHTML = items.map(it=>{
      const amt  = Number(it.amount ?? it.points ?? it.point ?? it.delta ?? 0);
      const sign = amt > 0 ? '+' : '';
      const when = fmtThaiDateTime(it.created_at || it.time || '');
      return `
        <div class="hc-row">
          <div class="hc-at">${esc(when)}</div>
          <div class="hc-amt ${amt>=0?'plus':'minus'}">${sign}${amt}</div>
        </div>
      `;
    }).join('') || `<div class="text-muted text-center py-3">ไม่มีรายการ</div>`;

    modal.show();
  }catch(e){
    console.error(e);
    toastErr('โหลดประวัติไม่สำเร็จ');
  }finally{
    UiOverlay.hide();
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

  // เคลียร์คลาสเดิม แล้วใส่คลาสตามระดับ
  avatar.classList.remove("tier-silver","tier-gold","tier-platinum");
  avatar.classList.add(`tier-${tier.key}`);

  // ปรับไตเติล/aria
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

// อัปเดต pill/dot/สถานะ ตามระดับ
function setTierUI(tier, score){
  const pill = document.getElementById('tierPill');
  const name = document.getElementById('tierName');
  const av   = document.getElementById('rpAvatar');
  const dot  = document.getElementById('tierDot');
  const st   = document.getElementById('tierStatus');
  const tag  = document.getElementById('tierTag');

  // Pill / Avatar theme
  pill?.classList.remove('rp-tier-silver','rp-tier-gold','rp-tier-platinum');
  pill?.classList.add(`rp-tier-${tier.key}`);
  if (name) name.textContent = tier.name;

  av?.classList.remove('rp-tier-silver','rp-tier-gold','rp-tier-platinum');
  av?.classList.add(`rp-tier-${tier.key}`);

  // เหรียญ: icon ตามระดับ
  if (dot){
    const icon = tier.key === 'platinum' ? 'fa-gem' : (tier.key === 'gold' ? 'fa-star' : 'fa-circle');
    dot.innerHTML = `<i class="fa-solid ${icon}"></i>`;
  }

  // ชิปสถานะ/แท็ก
  if (tier.next === Infinity){
    tag?.classList.remove('d-none');
    tag && (tag.textContent = '✨ Max Level');
    if (st){ st.textContent = ''; st.setAttribute('data-ico',''); }
  } else {
    tag?.classList.add('d-none');
    const need = Math.max(0, tier.next - Number(score||0));
    if (st){
      st.textContent = `สะสมอีก ${need.toLocaleString()} คะแนน → เลื่อนเป็น ${TIERS.find(t=>t.min===tier.next)?.name || 'Level ถัดไป'}`;
      st.setAttribute('data-ico','↗️');  // ใช้กับ ::before
    }
  }

  // ย้อมธีมการ์ด (progress/ambient) ตามระดับ
  applyPremiumTheme?.(tier.key);
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
let TORCH_ON = false;

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
