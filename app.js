/* ============ Royal Point — User App (All-in-One, User Side) ============ */
/** LIFF / API */
const LIFF_ID       = "2007053300-QoEvbXyn";
const API_GET_SCORE = "/api/get-score";
const API_REDEEM    = "/api/redeem";
const API_HISTORY   = "/api/score-history";
const API_SPEND     = "/api/spend";      // หักแต้มเมื่อแลกของรางวัล

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

async function initApp(){
  try{
    await liff.init({ liffId: LIFF_ID });
    if(!liff.isLoggedIn()){ liff.login(); return; }

    const prof = await liff.getProfile();
    UID = prof.userId;

    if (els.username)   els.username.textContent = prof.displayName || "—";
    if (els.profilePic) els.profilePic.src = prof.pictureUrl || "https://placehold.co/120x120";
    enableAvatarPreview(); // NEW: กดขยายรูปได้

    showAdminEntry(ADMIN_UIDS.includes(UID));
    bindUI();

    // แอนิเมชันปุ่มหลักครั้งเดียว + haptics เล็กน้อย
const pa = document.getElementById("primaryAction");
if (pa){
  pa.classList.add("swing-once");
  pa.addEventListener("click", ()=> navigator.vibrate?.(10));
}

// สถานะ online/offline
toggleOfflineBanner(!navigator.onLine);
window.addEventListener("online",  ()=> toggleOfflineBanner(false));
window.addEventListener("offline", ()=> toggleOfflineBanner(true));

    await refreshUserScore();
    await loadRewards();
    renderRewards(prevScore || 0); // render ตามรางวัลที่โหลดมา
  }catch(e){
    console.error(e);
    toastErr("เริ่มต้นระบบไม่สำเร็จ");
  }finally{
    setAppLoading(false);
    // วิ่งแถบ topbar ให้จบสวย ๆ
    document.body.classList.remove('loading'); 
    document.body.classList.add('ready');
    setTimeout(()=>document.body.classList.remove('ready'), 1000);
  }
}

function bindUI(){
  els.btnRefresh && els.btnRefresh.addEventListener("click", refreshUserScore);
  els.btnHistory && els.btnHistory.addEventListener("click", openHistory);

  if (els.modal){
    els.modal.addEventListener("shown.bs.modal", () => startScanner && startScanner());
    els.modal.addEventListener("hidden.bs.modal", () => stopScanner && stopScanner());
  }

  // ปุ่มควบคุมกล้องในโมดัล (ถ้ามี)
  const startBtn = document.getElementById("startScanBtn");
  const stopBtn  = document.getElementById("stopScanBtn");
  startBtn && startBtn.addEventListener("click", () => startScanner && startScanner());
  stopBtn  && stopBtn.addEventListener("click", () => stopScanner && stopScanner());

  // ยืนยันรหัสลับ (กรณีกรอกมือ)
  els.submitBtn && els.submitBtn.addEventListener("click", async()=>{
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
}

function showAdminEntry(isAdmin){ const b=$("btnAdmin"); if(b) b.classList.toggle("d-none", !isAdmin); }
function toastOk(msg){ return window.Swal ? Swal.fire("สำเร็จ", msg || "", "success") : alert(msg || "สำเร็จ"); }
function toastErr(msg){ return window.Swal ? Swal.fire("ผิดพลาด", msg || "", "error") : alert(msg || "ผิดพลาด"); }

/* ================= Score / Level / Progress ================= */
function getTier(score){
  for(const t of TIERS){ if(score >= t.min && score < t.next) return t; }
  return TIERS[TIERS.length-1];
}

// ดึงคะแนนจาก API แล้วอัปเดตทั้ง UI
async function refreshUserScore(){
  if(!UID) return;
  // แสดง overlay ถ้าช้าเกิน 300ms เพื่อลดการกะพริบ
  const timer = setTimeout(()=>UiOverlay.show('กำลังรีเฟรชคะแนน…'), 300);

  try{
    const r = await fetch(`${API_GET_SCORE}?uid=${encodeURIComponent(UID)}`, { cache:"no-store" });
    const j = await safeJson(r);

    if (j.status === "success" && j.data){
      const sc = Number(j.data.score || 0);

      // เก็บ rank / streak ถ้ามีจาก API
      if (typeof j.data.rank !== "undefined")       window.USER_RANK   = j.data.rank;
      if (typeof j.data.streakDays !== "undefined") window.USER_STREAK = j.data.streakDays;

      // อัปเดต UI หลัก
      setPoints(sc);

      // อัปเดตชิปสรุปด้านใต้ชื่อ
      updateStatChips({
        tierName: getTier(sc).name,
        points: sc,
        streakDays: window.USER_STREAK,
        uid: UID
      });

      // แคชคะแนนล่าสุด + ปิดแบนเนอร์ออฟไลน์ (ถือว่าออนไลน์)
      localStorage.setItem("lastScore", String(sc));
      toggleOfflineBanner(false);

    } else {
      // โหมดแคช/ออฟไลน์
      const cached = Number(localStorage.getItem("lastScore") || "0");
      setPoints(cached);
      updateStatChips({
        tierName: getTier(cached).name,
        points: cached,
        streakDays: window.USER_STREAK,
        uid: UID
      });
      toggleOfflineBanner(!navigator.onLine);
    }

  }catch(e){
    console.error(e);

    // ล้มเหลว → ใช้คะแนนแคช + โชว์แบนเนอร์ถ้าออฟไลน์
    const cached = Number(localStorage.getItem("lastScore") || "0");
    setPoints(cached);
    updateStatChips({
      tierName: getTier(cached).name,
      points: cached,
      streakDays: window.USER_STREAK,
      uid: UID
    });
    toggleOfflineBanner(!navigator.onLine);

  }finally{
    clearTimeout(timer);
    UiOverlay.hide();
  }
}


// อัปเดต UI ทั้งหมดจากคะแนนเดียว
function setPoints(score){
  score = Number(score || 0);

  const tier = getTier(score);
  setTierMedal(tier);   // ← NEW: อัปเดตป้ายรางวัลบน avatar
  const idx  = TIERS.findIndex(t => t.key === tier.key);
  const nextTierObj = TIERS[idx + 1] || null;

  // 1) ตัวเลขแต้มเด้งขึ้น
  if (els.points){
    const from = prevScore || Number(els.points.textContent || 0);
    animateCount(els.points, from, score, 600);
  }

  // 2) Badge + ข้อความเลเวล
  if (els.levelBadge){
    els.levelBadge.textContent = tier.name;
    els.levelBadge.classList.remove("rp-level-silver","rp-level-gold","rp-level-platinum","sparkle");
    els.levelBadge.classList.add(tier.class);
  }
  if (els.currentLevelText) els.currentLevelText.textContent = tier.name;

  // 3) เส้น progress (เก่า)
  if (els.progressBar){
    els.progressBar.classList.remove("prog-silver","prog-gold","prog-platinum");
    els.progressBar.classList.add(tier.progClass);
  }
  if (els.progressFill){
    const pct = tier.next === Infinity ? 1 : (score - tier.min) / (tier.next - tier.min);
    els.progressFill.style.width = `${Math.max(0, Math.min(100, pct * 100))}%`;
  }

  // 4) Track ใหม่ (ถ้ามี)
  applyXpThemeByTier(tier.key);   // ถ้ามี xp theme (มีอยู่แล้ว)
  updateLevelTrack(score);
  updatePremiumBar(score);  // (เดิมมีอยู่แล้ว)
  bumpXpFill();             // NEW: เด้งแถบ XP เมื่อแต้มเปลี่ยน
  updateStatChips({         // NEW: อัปเดตชิปสรุปทุกครั้งที่ UI เปลี่ยนแต้ม
    tierName: getTier(score).name,
    points: score,
    streakDays: window.USER_STREAK,
    uid: UID
  });

  // 5) ข้อความเลเวลถัดไป
  if (els.nextTier){
    if (!nextTierObj){
      els.nextTier.textContent = "คุณถึงระดับสูงสุดแล้ว ✨";
    } else {
      const need = Math.max(0, nextTierObj.min - score);
      els.nextTier.textContent = `สะสมอีก ${need} คะแนน → เลื่อนเป็น ${nextTierObj.name} ${TIER_EMOJI[nextTierObj.name] || ""}`;
    }
  }

  // 6) Render rewards ตามแต้มล่าสุด
  renderRewards(score);

  // 7) เอฟเฟกต์เมื่อเลเวลเปลี่ยน
  if (prevLevel && prevLevel !== tier.key){
    els.levelBadge?.classList.add("sparkle");
    setTimeout(()=> els.levelBadge?.classList.remove("sparkle"), 1300);
    launchConfetti();
  }

  // Level Meter
  const lmFill  = document.getElementById("lm-fill");
  const lmLabel = document.getElementById("lm-label");
  if (lmFill && lmLabel){
    // ช่วง: [0,500), [500,1200), >=1200
    const t = getTier(score);
    const total = 1200; // ใช้ 1200 เป็น max bar
    const widthPct = Math.max(0, Math.min(100, (score/total)*100));
    lmFill.style.width = widthPct + "%";

    if (t.next === Infinity){
      lmLabel.textContent = `ระดับ ${t.name} สูงสุดแล้ว ✨ คะแนนรวม ${score.toLocaleString()}`;
    } else {
      const need = t.next - score;
      lmLabel.textContent = `อยู่ระดับ ${t.name} • ขาดอีก ${need} คะแนนเพื่อไป ${TIERS.find(x=>x.min===t.next)?.name || 'ระดับถัดไป'}`;
    }
  }
  // อัปเดตป้ายอันดับ + วงแหวนตาม tier (NEW)
  setRankBadge(window.USER_RANK, tier.key);

  // ตั้งธีมสีของ XP bar ให้ตรงกับ tier (ไม่ต้องพึ่ง sibling selector)
const xpWrap = document.querySelector('.xp-wrap');
if (xpWrap){
  const colors = {
    silver:   ['#cfd8dc','#eceff1'],
    gold:     ['#ffd166','#ffb703'],
    platinum: ['#b3e5fc','#e0f7fa']
  };
  const [a,b] = colors[tier.key] || colors.silver;
  xpWrap.style.setProperty('--ring-a', a);
  xpWrap.style.setProperty('--ring-b', b);
}

applyXpThemeByTier(tier.key);

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

/* ===== Rewards (dynamic) ===== */
const API_REWARDS = "/api/rewards";          // มีไฟล์แล้วจากแพตช์ 1
const REWARDS_FALLBACK = [                   // เอาไว้กันหน้าโล่ง
  { id:"A", name:"Gift A", img:"https://placehold.co/800x600?text=Gift+A", cost:70 },
  { id:"B", name:"Gift B", img:"https://placehold.co/800x600?text=Gift+B", cost:80 },
  { id:"C", name:"Gift C", img:"https://placehold.co/800x600?text=Gift+C", cost:100 },
  { id:"D", name:"Gift D", img:"https://placehold.co/800x600?text=Gift+D", cost:150 },
];

let rewardRailBound = false;
let REWARDS_CACHE = [];

async function loadRewards() {
  try {
    const resp = await fetch(`${API_REWARDS}?include=1`, { headers: { 'Accept': 'application/json' } });
    const data = await resp.json();
    if (data && data.status === 'success' && Array.isArray(data.rewards)) {
      REWARDS_CACHE = data.rewards;
    } else {
      REWARDS_CACHE = [];
      console.warn('No rewards from API:', data);
    }
  } catch (err) {
    REWARDS_CACHE = [];
    console.error('loadRewards error:', err);
  }
}

// render รางวัล พร้อมกันผูก event คลิกแลก (ผูกครั้งเดียว)
function renderRewards(currentScore){
  const rail = document.getElementById("rewardRail");
  if (!rail) return;

  const data = (REWARDS_CACHE && REWARDS_CACHE.length) ? REWARDS_CACHE : REWARDS_FALLBACK;

  rail.innerHTML = data.map(r => {
    const locked  = Number(currentScore) < Number(r.cost);
    const id      = escapeHtml(r.id || "");
    const name    = escapeHtml(r.name || r.id || "");
    const img     = r.img || "https://placehold.co/640x480?text=Reward";
    const cost    = Number(r.cost || 0);
    const tagHtml = r.tag ? `<span class="rp-tag">${escapeHtml(r.tag)}</span>` : "";

    return `
      <div class="rp-reward-card ${locked ? 'locked' : ''}"
           data-id="${id}" data-cost="${cost}">
        ${tagHtml}
        <div class="rp-reward-img">
          <img src="${img}" alt="${name}" loading="lazy">
        </div>
        <div class="rp-reward-body p-2">
          <div class="d-flex justify-content-between align-items-center">
            <div class="fw-bold text-truncate">${name}</div>
            <span class="rp-reward-cost">${cost} pt</span>
          </div>
        </div>
        <button class="rp-redeem-btn" title="แลกรางวัล" aria-label="แลกรางวัล" ${locked ? "disabled" : ""}>
          <i class="fa-solid fa-gift"></i>
        </button>
      </div>
    `;
  }).join("");

  // ผูกครั้งเดียวพอ กันซ้อน
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
    rewardRailBound = true; // ✅ สำคัญ: ตั้งธงหลังผูกแล้ว
  }
}

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
async function redeemCode(code, type){
  UiOverlay.show('กำลังตรวจสอบคูปอง…');
  try{
    const r = await fetch(API_REDEEM, {
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({ uid: UID, code, type })
    });
    const j = await safeJson(r);
    if(j.status === "success"){
      navigator.vibrate?.(12);
      UiOverlay.hide();               // ซ่อนก่อนขึ้นข้อความสำเร็จ
      await refreshUserScore();
      stopScanner();
      if(els.secretInput) els.secretInput.value = "";
      if(els.modal){
        const m = bootstrap.Modal.getInstance(els.modal); m && m.hide();
      }
      toastOk(`รับคะแนนแล้ว +${j.point || 0}`);
    }else{
      UiOverlay.hide();
      toastErr(j.message || "คูปองไม่ถูกต้องหรือถูกใช้ไปแล้ว");
    }
  }catch(e){
    UiOverlay.hide();
    console.error(e);
    toastErr("ไม่สามารถยืนยันรับคะแนนได้");
  }
}

async function startScanner(){
  if (!els.qrReader) return;
  if (SCANNING) return;      // ป้องกันเปิดกล้องซ้อน
  SCANNING = true;

  const onScan = async (decodedText) => {
    const code = String(decodedText || "").trim();
    const now  = Date.now();

    // กันการยิงซ้ำ ๆ จาก callback เดียวกัน
    if (REDEEM_IN_FLIGHT) return;
    if (code && code === LAST_DECODE && (now - LAST_DECODE_AT) < DUP_COOLDOWN) return;

    LAST_DECODE = code;
    LAST_DECODE_AT = now;

    REDEEM_IN_FLIGHT = true;
    try {
      // หยุดกล้องทันทีที่เจอโค้ดครั้งแรก เพื่อไม่ให้ยิงซ้ำ
      await stopScanner();
      await redeemCode(code, "SCAN");   // เรียก API แค่ครั้งเดียว
    } finally {
      // หน่วงเล็กน้อยกัน callback ที่ยังค้างอยู่
      setTimeout(()=>{ REDEEM_IN_FLIGHT = false; }, 300);
    }
  };

  try{
    html5qrcode = new Html5Qrcode(els.qrReader.id);

    // พยายามเปิดกล้องหลังก่อน
    try {
      await html5qrcode.start(
        { facingMode: { exact: "environment" } },
        { fps: 10, qrbox: { width: 260, height: 260 } },
        onScan
      );
      return;
    } catch {}

    // กล้องหลังแบบทั่วไป
    try {
      await html5qrcode.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 260, height: 260 } },
        onScan
      );
      return;
    } catch {}

    // เลือกจากรายการอุปกรณ์
    const devices = await Html5Qrcode.getCameras();
    if(!devices?.length) throw new Error("No camera devices");
    const re = /(back|rear|environment|wide|main)/i;
    const preferred = devices.find(d=>re.test(d.label)) || devices[devices.length-1];

    await html5qrcode.start(
      preferred.id,
      { fps: 10, qrbox: { width: 260, height: 260 } },
      onScan
    );
  }catch(e){
    console.warn("Scanner start failed:", e);
    SCANNING = false; // reset flag เมื่อเปิดกล้องไม่สำเร็จ
    toastErr("ไม่สามารถเปิดกล้องได้");
  }
}

async function stopScanner(){
  try{
    if (html5qrcode){
      await html5qrcode.stop();
      await html5qrcode.clear();
      html5qrcode = null;
    }
  }catch(e){ console.warn("stopScanner error", e); }
  finally {
    els.qrReader && (els.qrReader.innerHTML = "");
    SCANNING = false;   // กล้องหยุดแล้ว
  }
}

/* ================= History (เปิดเร็ว โหลดทีหลัง) ================= */
async function openHistory(){
  if (!UID) return;

  if (els.historyList) {
    els.historyList.innerHTML = `<div class="list-group-item text-center text-muted">กำลังโหลด…</div>`;
  }
  if (els.historyUser) els.historyUser.textContent = els.username?.textContent || "—";
  new bootstrap.Modal(els.historyModal).show();

  UiOverlay.show('กำลังโหลดประวัติ…');
  try{
    const r = await fetch(`${API_HISTORY}?uid=${encodeURIComponent(UID)}`, { cache: "no-store" });
    const j = await safeJson(r);
    UiOverlay.hide();
    if (j.status !== "success") {
      els.historyList.innerHTML = `<div class="list-group-item text-center text-danger">โหลดไม่สำเร็จ</div>`;
      return;
    }
    const list = j.data || [];
    els.historyList.innerHTML = list.length
      ? list.map(i=>{
          const ts = fmtDT(i.ts);
          const p  = Number(i.point||0);
          const sign = p>=0?"+":"";
          const color = p>=0?"#16a34a":"#dc2626";
          return `<div class="list-group-item d-flex justify-content-between align-items-center">
                    <div>
                      <div class="fw-bold">${escapeHtml(i.type||"—")}</div>
                      <div class="small text-muted">${escapeHtml(i.code||"")}</div>
                    </div>
                    <div class="text-end">
                      <div style="color:${color};font-weight:800">${sign}${p}</div>
                      <div class="small text-muted">${ts}</div>
                    </div>
                  </div>`;
        }).join("")
      : `<div class="list-group-item text-center text-muted">ไม่มีรายการ</div>`;
  }catch(e){
    console.error(e);
    UiOverlay.hide();
    els.historyList.innerHTML = `<div class="list-group-item text-center text-danger">โหลดไม่สำเร็จ</div>`;
  }
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

function toggleOfflineBanner(on){
  const el = document.getElementById("offlineBanner");
  if (el) el.classList.toggle("d-none", !on);
}

function bumpXpFill(){
  const xpFill = document.getElementById("xpFill");
  if (!xpFill) return;
  xpFill.classList.remove("bump");
  void xpFill.offsetWidth; // รีเฟรชเพื่อให้ animation เล่นซ้ำได้
  xpFill.classList.add("bump");
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

function updateStatChips({ tierName, points, streakDays, uid } = {}){
  const box = document.getElementById("statChips");
  if(!box) return;

  const chips = [];
  if (tierName) chips.push(`<span class="chip"><i class="fa-solid fa-medal"></i> ${tierName}</span>`);
  if (typeof points === "number") chips.push(`<span class="chip"><i class="fa-solid fa-star"></i> ${points.toLocaleString()} pt</span>`);
  if (typeof streakDays === "number") chips.push(`<span class="chip"><i class="fa-solid fa-fire"></i> ${streakDays} วันติด</span>`);
  // (ออปชัน) แสดง UID สั้น
  if (uid) chips.push(`<span class="chip"><i class="fa-solid fa-user"></i> ${uid.slice(-4).padStart(uid.length,"•")}</span>`);

  box.innerHTML = chips.join("") || `<span class="chip"><i class="fa-regular fa-circle-question"></i> กำลังโหลด…</span>`;
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