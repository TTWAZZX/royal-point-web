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
    enableTierTooltip();

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

const torchBtn = document.getElementById("torchBtn");
torchBtn && torchBtn.addEventListener("click", async ()=>{
  try {
    await toggleTorch(!TORCH_ON);
    navigator.vibrate?.(8);
  } catch(e){
    toastErr("อุปกรณ์นี้ไม่รองรับไฟฉาย");
  }
});

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
// ดึงคะแนนจาก API แล้วอัปเดตทั้ง UI
async function refreshUserScore(){
  if (!UID) return;

  // แสดง overlay ถ้าช้าเกิน 300ms เพื่อลดการกะพริบ
  const timer = setTimeout(() => UiOverlay.show('กำลังรีเฟรชคะแนน…'), 300);

  try{
    const r = await fetch(`${API_GET_SCORE}?uid=${encodeURIComponent(UID)}`, { cache: "no-store" });
    const j = await safeJson(r);

    if (j.status === "success" && j.data){
      const sc = Number(j.data.score || 0);

      // เก็บ rank / streak ถ้ามีจาก API
      if (typeof j.data.rank !== "undefined")       window.USER_RANK   = j.data.rank;
      if (typeof j.data.streakDays !== "undefined") window.USER_STREAK = j.data.streakDays;

      // อัปเดต UI หลัก
      // กรณีออนไลน์สำเร็จ
      setPoints(sc);
      updateStatChips({ /* … */ });
      localStorage.setItem("lastScore", String(sc));
      toggleOfflineBanner(false);
      setRefreshTooltip(new Date(), false);     // ← เพิ่มบรรทัดนี้

      // กรณีแคช/ออฟไลน์ (ทั้ง else และ catch)
      setPoints(cached);
      updateStatChips({ /* … */ });
      toggleOfflineBanner(!navigator.onLine);
      setRefreshTooltip(new Date(), true);      // ← เพิ่มบรรทัดนี้

      // อัปเดตชิปสรุปและชิปเล็กฝั่งซ้าย (ถ้ามี)
      updateStatChips({
        tierName: getTier(sc).name,
        points: sc,
        streakDays: window.USER_STREAK,
        uid: UID
      });
      if (typeof updateLeftMiniChips === "function"){
        updateLeftMiniChips({ streakDays: window.USER_STREAK, rank: window.USER_RANK });
      }

      // แคชคะแนนล่าสุด + สถานะเน็ต/เวลาอัปเดต
      localStorage.setItem("lastScore", String(sc));
      toggleOfflineBanner(false);
      if (typeof setLastSync === "function") setLastSync(Date.now(), false);
      if (typeof updateNetChip === "function") updateNetChip();

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
      if (typeof updateLeftMiniChips === "function"){
        updateLeftMiniChips({ streakDays: window.USER_STREAK, rank: window.USER_RANK });
      }
      toggleOfflineBanner(!navigator.onLine);
      if (typeof setLastSync === "function") setLastSync(Date.now(), true);
      if (typeof updateNetChip === "function") updateNetChip();
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
    if (typeof updateLeftMiniChips === "function"){
      updateLeftMiniChips({ streakDays: window.USER_STREAK, rank: window.USER_RANK });
    }
    toggleOfflineBanner(!navigator.onLine);
    if (typeof setLastSync === "function") setLastSync(Date.now(), true);
    if (typeof updateNetChip === "function") updateNetChip();

  }finally{
    clearTimeout(timer);
    UiOverlay.hide();
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

/* ===== Rewards (dynamic) ===== */
const API_REWARDS = "/api/rewards";

/** ลำดับคะแนน 44 ช่อง (ตามที่ระบุ) */
const COST_ORDER = [
  40, 50, 60, 70, 80,
  100,100,100,100,
  120,120,120,120,
  150,180,200,150,180,200,200,
  220,230,250,250,250,250,250,250,
  350,380,
  400,400,400,400,400,400,
  450,500,500,
  600,700,800,900,1000
];

/** สร้าง fallback 44 กล่องจากลำดับคะแนน */
function buildFallbackRewards(costs){
  return costs.map((cost, idx)=>({
    id: `R${String(idx+1).padStart(2,'0')}-${cost}`,
    name: `Gift ${idx+1}`,
    img: `https://placehold.co/640x480?text=Gift+${idx+1}`,
    cost: Number(cost)
  }));
}

/** จัดเรียง rewards ให้ตรงตาม COST_ORDER
 *  - ถ้ามีของใน API ที่ cost ตรง ให้หยิบมาเรียงตามลำดับ
 *  - ถ้าขาดชิ้นไหน ให้เติม placeholder
 *  - (ถ้ามีของเกิน/คะแนนไม่อยู่ในลำดับ จะไม่ถูกใช้)
 */
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
      // ใช้ของจริงจาก API ก่อน
      out.push(b.shift());
    }else{
      // เติมการ์ด placeholder
      out.push({
        id: `R${String(i+1).padStart(2,'0')}-${cost}`,
        name: `Gift ${i+1}`,
        img: `https://placehold.co/640x480?text=Gift+${i+1}`,
        cost: Number(cost)
      });
    }
  });
  return out;
}

/** state & cache */
let rewardRailBound = false;
let REWARDS_CACHE = [];

/** โหลดรางวัล แล้วจัดรูปแบบให้ตรง COST_ORDER */
async function loadRewards() {
  try {
    const resp = await fetch(`${API_REWARDS}?include=1`, { headers: { 'Accept': 'application/json' }, cache: 'no-store' });
    const data = await resp.json();
    if (data && data.status === 'success' && Array.isArray(data.rewards)) {
      // จัดเรียงตาม COST_ORDER + เติมที่ขาด
      REWARDS_CACHE = orderRewardsBySequence(data.rewards, COST_ORDER);
    } else {
      console.warn('No rewards from API:', data);
      REWARDS_CACHE = buildFallbackRewards(COST_ORDER);
    }
  } catch (err) {
    console.error('loadRewards error:', err);
    REWARDS_CACHE = buildFallbackRewards(COST_ORDER);
  }
}

/** render + click-to-redeem */
function renderRewards(currentScore){
  const rail = document.getElementById("rewardRail");
  if (!rail) return;

  const data = (REWARDS_CACHE && REWARDS_CACHE.length) ? REWARDS_CACHE : buildFallbackRewards(COST_ORDER);

  rail.innerHTML = data.map((r, i) => {
    const locked  = Number(currentScore) < Number(r.cost);
    const id      = escapeHtml(r.id || `R${i+1}`);
    const name    = escapeHtml(r.name || id);
    const img     = r.img || `https://placehold.co/640x480?text=Gift+${i+1}`;
    const cost    = Number(r.cost || 0);

    return `
      <div class="rp-reward-card ${locked ? 'locked' : ''}"
           data-id="${id}" data-cost="${cost}" title="${name}">
        <div class="rp-reward-img">
          <img src="${img}" alt="${name}" loading="lazy">
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
  if (SCANNING) return;
  SCANNING = true;

  const onScan = async (decodedText) => {
    const code = String(decodedText || "").trim();
    const now  = Date.now();
    if (REDEEM_IN_FLIGHT) return;
    if (code && code === LAST_DECODE && (now - LAST_DECODE_AT) < DUP_COOLDOWN) return;
    LAST_DECODE = code; LAST_DECODE_AT = now;

    REDEEM_IN_FLIGHT = true;
    try {
      await stopScanner();
      await redeemCode(code, "SCAN");
    } finally {
      setTimeout(()=>{ REDEEM_IN_FLIGHT = false; }, 300);
    }
  };

  try{
    html5qrcode = new Html5Qrcode(els.qrReader.id);

    // 1) กล้องหลัง exact
    try{
      await html5qrcode.start(
        { facingMode: { exact: "environment" } },
        { fps: 10, qrbox: { width: 260, height: 260 } },
        onScan
      );
      afterCameraStarted();
      return;
    }catch{}

    // 2) กล้องหลังทั่วไป
    try{
      await html5qrcode.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 260, height: 260 } },
        onScan
      );
      afterCameraStarted();
      return;
    }catch{}

    // 3) เลือกจากรายการอุปกรณ์
    const devices = await Html5Qrcode.getCameras();
    if(!devices?.length) throw new Error("No camera devices");
    const re = /(back|rear|environment|wide|main)/i;
    const preferred = devices.find(d=>re.test(d.label)) || devices[devices.length-1];
    await html5qrcode.start(
      preferred.id,
      { fps: 10, qrbox: { width: 260, height: 260 } },
      onScan
    );
    afterCameraStarted();
  }catch(e){
    console.warn("Scanner start failed:", e);
    SCANNING = false;
    toastErr("ไม่สามารถเปิดกล้องได้");
  }
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

function setLastSync(ts, fromCache){
  const chip = document.getElementById('lastSyncChip');
  if (!chip) return;
  const d = new Date(ts);
  const pad = n => String(n).padStart(2,'0');
  const stamp = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  chip.classList.remove('d-none');
  chip.innerHTML = fromCache
    ? `<i class="fa-solid fa-cloud"></i> แคช • ${stamp}`
    : `<i class="fa-regular fa-clock"></i> อัปเดตแล้ว • ${stamp}`;
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
function setLastSync(ts, fromCache){
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

/* ---------- setLastSync : แยกไอคอน Online/Cache ---------- */
function setLastSync(ts, fromCache){
  const chip = document.getElementById('lastSyncChip');
  if (!chip) return;
  const d = new Date(ts);
  const pad = n => String(n).padStart(2,'0');
  const stamp = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  chip.classList.remove('d-none');
  chip.innerHTML = fromCache
    ? `<i class="fa-solid fa-cloud"></i> แคช • ${stamp}`
    : `<i class="fa-regular fa-clock"></i> อัปเดตแล้ว • ${stamp}`;
}

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
