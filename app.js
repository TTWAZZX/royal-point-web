/* ============ Royal Point — User App (Horizontal Profile Card, FIX) ============ */

/** LIFF / API */
const LIFF_ID = "2007053300-QoEvbXyn";
const API_GET_SCORE = "/api/get-score";
const API_REDEEM    = "/api/redeem";
const API_HISTORY   = "/api/score-history";
// --- Client calls ---
const API_SPEND = "/api/spend"; // (ไฟล์ serverless ด้านล่าง)
// ตัวอย่างข้อมูลรางวัล (แก้ไขตามจริงได้)
const REWARDS = [
  { id:"A", img:"https://placehold.co/800x600?text=Gift+A", cost:70 },
  { id:"B", img:"https://placehold.co/800x600?text=Gift+B", cost:80 },
  { id:"C", img:"https://placehold.co/800x600?text=Gift+C", cost:100 },
  { id:"D", img:"https://placehold.co/800x600?text=Gift+D", cost:150 },
];

// ===== Rewards (dynamic) =====
const API_REWARDS = "/api/rewards";
let REWARDS_CACHE = [];   // [{id,name,img,cost,active}...]

async function loadRewards(){
  try{
    const r = await fetch(API_REWARDS, { cache:"no-store" });
    const j = await safeJson(r);
    if(j.status === "success" && Array.isArray(j.data)){
      REWARDS_CACHE = j.data.filter(x => x.active !== "0" && x.active !== 0 && x.active !== false);
    }else{
      REWARDS_CACHE = [];
    }
  }catch(e){ console.error(e); REWARDS_CACHE = []; }
}

function renderRewards(currentScore){
  const rail = document.getElementById("rewardRail");
  if(!rail) return;
  // โชว์ “ครบทุกชิ้น” แม้แต้มไม่พอ
  rail.innerHTML = (REWARDS_CACHE||[]).map(r=>{
    const locked = Number(currentScore) < Number(r.cost);
    return `
      <div class="rp-reward-card ${locked?'locked':''}" data-id="${r.id}" data-cost="${r.cost}">
        <div class="rp-reward-img">
          <img src="${r.img || 'https://placehold.co/640x480?text=Reward'}" alt="${(r.name||r.id)}">
        </div>
        <div class="rp-reward-body p-2">
          <div class="d-flex justify-content-between align-items-center">
            <div class="fw-bold text-truncate">${escapeHtml(r.name||r.id)}</div>
            <span class="rp-reward-cost">${Number(r.cost||0)} pt</span>
          </div>
        </div>
        <button class="rp-redeem-btn" title="แลกรางวัล" aria-label="แลกรางวัล" ${locked?"disabled":""}>
          <i class="fa-solid fa-gift"></i>
        </button>
      </div>
    `;
  }).join("");

  // delegate click (ไม่มี {once:true})
  rail.addEventListener("click", async (ev)=>{
    const btn  = ev.target.closest(".rp-redeem-btn"); if(!btn) return;
    const card = btn.closest(".rp-reward-card");
    const id   = card.dataset.id;
    const cost = Number(card.dataset.cost);
    await redeemReward({ id, cost }, btn);
  });
}

// ป้องกันกดซ้ำรัว ๆ
let REDEEMING = false;

async function redeemReward(reward, btn) {
  if (REDEEMING) return;
  if (!UID) return toastErr("ยังไม่พร้อมใช้งาน");
  const id   = reward?.id;
  const cost = Math.max(0, Number(reward?.cost) || 0);
  if (!id || !cost) return toastErr("ข้อมูลรางวัลไม่ถูกต้อง");

  // พอแต้มก่อน
  const scoreNow = Number(prevScore || 0);
  if (scoreNow < cost) return toastErr("คะแนนไม่พอสำหรับรางวัลนี้");

  // ยืนยัน
  const confirmed = window.Swal
    ? (await Swal.fire({
        title: "ยืนยันการแลก?",
        html: `จะใช้ <b>${cost} pt</b> แลกรางวัล <b>${id}</b>`,
        icon: "question",
        showCancelButton: true,
        confirmButtonText: "แลกเลย"
      })).isConfirmed
    : confirm(`ใช้ ${cost} pt แลกรางวัล ${id}?`);
  if (!confirmed) return;

  // ล็อกปุ่มกันกดซ้ำ
  REDEEMING = true;
  const oldDisabled = btn?.disabled;
  if (btn) { btn.disabled = true; btn.classList.add("is-loading"); }

  try {
    const res = await fetch(API_SPEND, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid: UID, cost, rewardId: id })
    });
    const payload = await safeJson(res);
    if (payload?.status !== "success") {
      throw new Error(payload?.message || "spend failed");
    }

    await refreshUserScore(); // คะแนนจะถูกหักแล้วอัปเดต UI

    if (window.Swal) {
      await Swal.fire({
        title: "แลกสำเร็จ ✅",
        html: `ใช้ไป <b>${cost} pt</b><br><small>กรุณาแคปหน้าจอนี้ไว้เพื่อนำไปแสดงรับรางวัล</small>`,
        icon: "success"
      });
    } else {
      alert("แลกสำเร็จ! กรุณาแคปหน้าจอไว้เพื่อนำไปแสดงรับรางวัล");
    }
  } catch (err) {
    console.error(err);
    toastErr(err.message || "แลกรางวัลไม่สำเร็จ");
  } finally {
    REDEEMING = false;
    if (btn) { btn.disabled = oldDisabled ?? false; btn.classList.remove("is-loading"); }
  }
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

  // Progress (legacy line) – ไม่ใช้ก็ได้
  progressBar: $("progressBar"),
  progressFill: $("progressFill"),

  // Level Track ใหม่
  levelTrack: $("levelTrack"),
  trackFill: $("trackFill"),

  nextTier: $("next-tier"),

  btnRefresh: $("refreshBtn"),
  btnAdmin: $("btnAdmin"),
  btnHistory: $("historyBtn"),

  modal: $("scoreModal"),
  qrReader: $("qr-reader"),
  secretInput: $("secretCode"),
  submitBtn: $("submitCodeBtn"),

  historyModal: $("historyModal"),
  historyList: $("historyList"),
  historyUser: $("historyUser"),
};

/** State */
let UID = "";
let html5qrcode = null;
let prevScore = 0;
let prevLevel = "";

/** Level mapping (Gold=500, Platinum=1200) */
const TIERS = [
  { key:"silver",   name:"Silver",   min:0,   next:500,      class:"rp-level-silver",   progClass:"prog-silver"   },
  { key:"gold",     name:"Gold",     min:500, next:1200,     class:"rp-level-gold",     progClass:"prog-gold"     },
  { key:"platinum", name:"Platinum", min:1200,next:Infinity, class:"rp-level-platinum", progClass:"prog-platinum" },
];
const TIER_EMOJI = { Silver:"🥈", Gold:"🥇", Platinum:"💎" };

/* ================= Boot ================= */
document.addEventListener("DOMContentLoaded", initApp);

async function initApp(){
  try{
    await liff.init({ liffId: LIFF_ID });
    if(!liff.isLoggedIn()){ liff.login(); return; }

    const prof = await liff.getProfile();
    UID = prof.userId;

    if (els.username)   els.username.textContent = prof.displayName || "—";
    if (els.profilePic) els.profilePic.src = prof.pictureUrl || "https://placehold.co/120x120";

    showAdminEntry(ADMIN_UIDS.includes(UID));
    bindUI();
    await refreshUserScore();
    await loadRewards();
    renderRewards(prevScore || 0);

  }catch(e){ console.error(e); toastErr("เริ่มต้นระบบไม่สำเร็จ"); }
}

/* ================= UI Helpers ================= */
function bindUI(){
  els.btnRefresh && els.btnRefresh.addEventListener("click", refreshUserScore);
  els.btnHistory && els.btnHistory.addEventListener("click", openHistory);

  if (els.modal){
    els.modal.addEventListener("shown.bs.modal", () => startScanner && startScanner());
    // ไม่ปิดกล้องอัตโนมัติเมื่อปิดโมดัลก็ไม่มีผลข้างเคียง แต่เก็บไว้ก็ได้
    els.modal.addEventListener("hidden.bs.modal", () => stopScanner && stopScanner());
  }

  // NEW: ปุ่มควบคุมกล้อง
  const startBtn = document.getElementById("startScanBtn");
  const stopBtn  = document.getElementById("stopScanBtn");
  startBtn && startBtn.addEventListener("click", () => startScanner && startScanner());
  stopBtn  && stopBtn.addEventListener("click", () => stopScanner && stopScanner());

  els.submitBtn && els.submitBtn.addEventListener("click", async()=>{
    const code = (els.secretInput?.value || "").trim();
    if(!code) return toastErr("กรอกรหัสลับก่อน");
    await redeemCode(code, "MANUAL");
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

// 1) ดึงคะแนนจาก API แล้วส่งเข้า setPoints() เท่านั้น
async function refreshUserScore(){
  if(!UID) return;
  try{
    const r = await fetch(`${API_GET_SCORE}?uid=${encodeURIComponent(UID)}`, { cache:"no-store" });
    const j = await safeJson(r);

    if (j.status === "success" && j.data){
      const sc = Number(j.data.score || 0);
      setPoints(sc);                           // <-- ทำทุกอย่างใน setPoints()
      localStorage.setItem("lastScore", String(sc));
    } else {
      const cached = Number(localStorage.getItem("lastScore") || "0");
      setPoints(cached);                       // <-- ทำทุกอย่างใน setPoints()
    }
  }catch(e){
    console.error(e);
    const cached = Number(localStorage.getItem("lastScore") || "0");
    setPoints(cached);                         // <-- ทำทุกอย่างใน setPoints()
  }
}

// 2) อัปเดต UI ทั้งหมด (progress, track, ข้อความ, รีวอร์ด ฯลฯ) ให้รวมไว้ที่นี่จุดเดียว
function setPoints(score){
  score = Number(score || 0);

  const tier = getTier(score);
  const idx  = TIERS.findIndex(t => t.key === tier.key);
  const nextTierObj = TIERS[idx + 1] || null;

  // คะแนนเด้งขึ้น
  if (els.points){
    const from = prevScore || Number(els.points.textContent || 0);
    animateCount(els.points, from, score, 600);
  }

  // Badge / Current level
  if (els.levelBadge){
    els.levelBadge.textContent = tier.name;
    els.levelBadge.classList.remove("rp-level-silver","rp-level-gold","rp-level-platinum","sparkle");
    els.levelBadge.classList.add(tier.class);
  }
  if (els.currentLevelText) els.currentLevelText.textContent = tier.name;

  // Progress line (ถ้าใช้)
  if (els.progressBar){
    els.progressBar.classList.remove("prog-silver","prog-gold","prog-platinum");
    els.progressBar.classList.add(tier.progClass);
  }
  if (els.progressFill){
    const pct = tier.next === Infinity ? 1 : (score - tier.min) / (tier.next - tier.min);
    els.progressFill.style.width = `${Math.max(0, Math.min(100, pct * 100))}%`;
  }

  // Level Track ใหม่ (บาร์ยาวมีหมุด)
  updateLevelTrack(score);

  // ข้อความเลเวลถัดไป
  if (els.nextTier){
    if (!nextTierObj){
      els.nextTier.textContent = "คุณถึงระดับสูงสุดแล้ว ✨";
    } else {
      const need = Math.max(0, nextTierObj.min - score);
      els.nextTier.textContent = `สะสมอีก ${need} คะแนน → เลื่อนเป็น ${nextTierObj.name} ${TIER_EMOJI[nextTierObj.name] || ""}`;
    }
  }

  // Render ของรางวัลให้ล็อก/ปลดล็อกตามคะแนนปัจจุบัน
  renderRewards(score);

  // Sparkle + confetti เมื่อเลเวลเปลี่ยน
  if (prevLevel && prevLevel !== tier.key){
    els.levelBadge?.classList.add("sparkle");
    setTimeout(()=> els.levelBadge?.classList.remove("sparkle"), 1300);
    launchConfetti();
  }
  prevLevel = tier.key;
  prevScore = score;
}

function setPoints(sc){
  const score = Number(sc||0);

  const tier = getTier(score);
  const idx = TIERS.findIndex(t=>t.key===tier.key);
  const nextTierObj = TIERS[idx+1] || null;

  // 1) คะแนนเด้งขึ้น
  if(els.points){
    const from = prevScore || Number(els.points.textContent || 0);
    animateCount(els.points, from, score, 600);
  }

  // 2) Badge / Current level
  if(els.levelBadge){
    els.levelBadge.textContent = tier.name;
    els.levelBadge.classList.remove("rp-level-silver","rp-level-gold","rp-level-platinum","sparkle");
    els.levelBadge.classList.add(tier.class);
  }
  if(els.currentLevelText) els.currentLevelText.textContent = tier.name;

  // 3) Progress line (ถ้าใช้)
  if(els.progressBar){
    els.progressBar.classList.remove("prog-silver","prog-gold","prog-platinum");
    els.progressBar.classList.add(tier.progClass);
  }
  if(els.progressFill){
    const pct = tier.next === Infinity ? 1 : (score - tier.min) / (tier.next - tier.min);
    els.progressFill.style.width = `${Math.max(0, Math.min(100, pct*100))}%`;
  }

  // 4) Level Track ใหม่ – ชัดเจน
  updateLevelTrack(score);

  // 5) ข้อความเลเวลถัดไป
  if(els.nextTier){
    if(!nextTierObj){
      els.nextTier.textContent = "คุณถึงระดับสูงสุดแล้ว ✨";
    }else{
      const need = Math.max(0, nextTierObj.min - score);
      els.nextTier.textContent = `สะสมอีก ${need} คะแนน → เลื่อนเป็น ${nextTierObj.name} ${TIER_EMOJI[nextTierObj.name]||""}`;
    }
  }

  // 6) เอฟเฟกต์เลเวลอัป
  if(prevLevel && prevLevel !== tier.key){
    els.levelBadge?.classList.add("sparkle");
    setTimeout(()=> els.levelBadge?.classList.remove("sparkle"), 1300);
    launchConfetti();
  }

  prevLevel = tier.key;
  prevScore = score;
  renderRewards(score);
}

/* ================= Redeem / Scanner ================= */
async function redeemCode(code, type){
  try{
    const r = await fetch(API_REDEEM, { method:"POST", headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({ uid: UID, code, type }) });
    const j = await safeJson(r);
    if(j.status === "success"){
      navigator.vibrate?.(12);
      toastOk(`รับคะแนนแล้ว +${j.point || 0}`);
      await refreshUserScore();
      stopScanner();
      if($("secretCode")) $("secretCode").value = "";
      if(els.modal){ const m = bootstrap.Modal.getInstance(els.modal); m && m.hide(); }
    }else{
      toastErr(j.message || "คูปองไม่ถูกต้องหรือถูกใช้ไปแล้ว");
    }
  }catch(e){ console.error(e); toastErr("ไม่สามารถยืนยันรับคะแนนได้"); }
}

async function startScanner(){
  if(!els.qrReader) return;

  const onScan = async (decoded) => {
    try { await redeemCode(String(decoded||"").trim(), "SCAN"); }
    finally { stopScanner(); }
  };

  try{
    html5qrcode = new Html5Qrcode(els.qrReader.id);

    // พยายามเปิด "กล้องหลัง" ก่อนเสมอ
    try {
      await html5qrcode.start(
        { facingMode: { exact: "environment" } },
        { fps: 10, qrbox: { width: 260, height: 260 } },
        onScan
      );
      return;
    } catch {}
    try {
      await html5qrcode.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 260, height: 260 } },
        onScan
      );
      return;
    } catch {}

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
    if (els.qrReader) els.qrReader.innerHTML = "";
  }catch(e){ console.warn("stopScanner error", e); }
}

/* ================= History (FIX: pad hoist) ================= */
async function openHistory(){
  if (!UID) return;

  // เปิดโมดัลก่อน ให้ผู้ใช้รู้สึกว่าปุ่มทำงาน
  if (els.historyList) {
    els.historyList.innerHTML = `
      <div class="list-group-item text-center text-muted">กำลังโหลด…</div>`;
  }
  if (els.historyUser) els.historyUser.textContent = els.username?.textContent || "—";
  new bootstrap.Modal(els.historyModal).show();

  // แล้วค่อยโหลดข้อมูล
  try{
    const r = await fetch(`${API_HISTORY}?uid=${encodeURIComponent(UID)}`, { cache: "no-store" });
    const j = await safeJson(r);
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
    els.historyList.innerHTML = `<div class="list-group-item text-center text-danger">โหลดไม่สำเร็จ</div>`;
  }
}

/* ================= Utils ================= */
function escapeHtml(s){return String(s||"").replace(/[&<>"'`=\/]/g,a=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','/':'&#47;','`':'&#x60;','=':'&#x3D;'}[a]))}
function safeInt(n, d=0){ const x=Number(n); return Number.isFinite(x)?x:d; }
async function safeJson(resp){ const t=await resp.text(); try{ return JSON.parse(t); }catch{ return {status: resp.ok?"success":"error", message:t}; } }

/* HOISTED version ป้องกัน Error: Cannot access 'pad' before initialization */
function pad(n){ n = safeInt(n,0); return n<10?("0"+n):String(n); }
function fmtDT(ts){
  const d = new Date(ts);
  if (isNaN(d)) return String(ts||"");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/* Count-up */
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
