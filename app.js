/* ============ Royal Point — User App (Horizontal Profile Card, FIX) ============ */

/** LIFF / API */
const LIFF_ID = "2007053300-QoEvbXyn";
const API_GET_SCORE = "/api/get-score";
const API_REDEEM    = "/api/redeem";
const API_HISTORY   = "/api/score-history";
// --- Client calls ---
const API_SPEND = "/api/spend"; // (ไฟล์ serverless ด้านล่าง)

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
document.addEventListener('DOMContentLoaded', () => {
  // เปิด modal สแกน (ไม่ auto-start กล้อง)
  const scanBtn = document.getElementById('btnScan');
  if (scanBtn) {
    scanBtn.addEventListener('click', () => {
      const m = document.getElementById('redeemModal'); // id modal ที่มี qr-reader
      if (m) new bootstrap.Modal(m).show();
      // อย่าเรียก startScanner() ที่นี่ ให้กดปุ่ม "เปิดกล้อง" ภายใน modal แทน
    });
  }

  // เปิดประวัติ (แยกจากสแกนโดยสิ้นเชิง)
  const histBtn = document.getElementById('btnHistory');
  if (histBtn) {
    histBtn.addEventListener('click', openHistoryModal);
  }

  // ปุ่ม start/stop กล้อง ภายใน modal สแกน
  document.getElementById('startScanBtn')?.addEventListener('click', startScanner);
  document.getElementById('stopScanBtn')?.addEventListener('click', stopScanner);
});

async function openHistoryModal() {
  try {
    const res = await fetch(`/api/score-history?uid=${encodeURIComponent(UID)}`);
    const j = await res.json();
    if (j.status !== 'success') throw new Error(j.message || 'โหลดประวัติไม่สำเร็จ');
    renderHistoryList(j.data || []); // เขียน render เองตามโครง modal ของคุณ
    new bootstrap.Modal(document.getElementById('historyModal')).show();
  } catch (e) {
    console.error(e);
    Swal.fire('ผิดพลาด', 'ไม่สามารถโหลดประวัติได้', 'error');
  }
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

/* ====== Level Track updater (กันพลาด element ไม่มี) ====== */
function updateLevelTrack(score){
  const track = els.levelTrack;
  const fill  = els.trackFill;
  if(!track || !fill) return;

  const max = TIERS[TIERS.length-1].min;       // 1200
  const pct = Math.max(0, Math.min(100, (score / max) * 100));
  fill.style.width = pct + "%";

  // milestone positions (0, 500, 1200)
  const stops = [0, 500, max];
  const marks = track.querySelectorAll(".rp-track-milestone");
  marks.forEach((m,i)=>{
    const left = (stops[i] / max) * 100;
    m.style.left = (i === stops.length-1 ? 100 : left) + "%";
  });

  // theme by level
  track.classList.remove("track-silver","track-gold","track-platinum");
  const map  = { silver:"track-silver", gold:"track-gold", platinum:"track-platinum" };
  const tier = getTier(score);
  track.classList.add(map[tier.key] || "track-silver");

  // pulse feedback เล็ก ๆ
  const rail = track.querySelector(".rp-track-rail");
  if(rail){
    rail.classList.remove("pulse"); // reset
    void rail.offsetWidth;           // reflow
    rail.classList.add("pulse");
    setTimeout(()=>rail.classList.remove("pulse"), 600);
  }
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

let _qr = null;

async function startScanner() {
  try {
    // ถ้ามีตัวเก่าอยู่ ให้ปิดก่อน
    if (_qr) { await stopScanner(); }

    // เช็คว่ามีกล้องไหม
    const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
    const cams = devices.filter(d => d.kind === 'videoinput');
    if (!cams.length) {
      Swal.fire('ผิดพลาด', 'ไม่พบอุปกรณ์กล้องบนเครื่องนี้', 'error');
      return;
    }

    // เลือกกล้องหลังก่อน (ถ้ามี)
    const back = cams.find(d => /back|rear|environment|facing back/i.test(d.label || ''));
    const deviceId = back?.deviceId || cams[cams.length - 1].deviceId;

    const el = document.getElementById('qr-reader');
    if (!el) {
      Swal.fire('ผิดพลาด', 'ไม่พบจุดแสดงกล้อง (qr-reader)', 'error');
      return;
    }

    _qr = new Html5Qrcode('qr-reader');
    await _qr.start(
      { deviceId },
      { fps: 10, qrbox: { width: 250, height: 250 } },
      onScanSuccess,
      (err) => { /* ignore scan errors */ }
    );
  } catch (err) {
    console.warn('Scanner start failed:', err);
    Swal.fire('ผิดพลาด', 'ไม่สามารถเปิดกล้องได้', 'error');
    await stopScanner(); // ให้แน่ใจว่าปิดตัวเดิมถ้ามี
  }
}

async function stopScanner() {
  try {
    if (_qr) { await _qr.stop(); await _qr.clear(); }
  } catch (_) { /* ignore */ }
  _qr = null;
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

/* ===== Rewards (STATIC) + Redeem flow ===== */

/** 1) ของรางวัลแบบเดิม (แก้ได้ตามต้องการ) */
const REWARDS = [
  { id: "COUPON_50",  name: "คูปองส่วนลด 50฿",  img: "https://placehold.co/640x480?text=Coupon+50",  cost: 50  },
  { id: "DRINK",      name: "เครื่องดื่ม 1 แก้ว", img: "https://placehold.co/640x480?text=Drink",     cost: 120 },
  { id: "T_SHIRT",    name: "เสื้อยืดสวยๆ",      img: "https://placehold.co/640x480?text=T-Shirt",   cost: 300 },
  { id: "PREMIUM",    name: "ของพรีเมียม",        img: "https://placehold.co/640x480?text=Premium",   cost: 500 }
];

/** 2) ฟังก์ชันเรนเดอร์การ์ดของรางวัล */
function renderRewards(currentScore){
  const rail = document.getElementById("rewardRail");
  if(!rail) return;
  rail.innerHTML = (REWARDS||[]).map(r=>{
    const locked = Number(currentScore||0) < Number(r.cost||0);
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
  // --- SHIM: ให้โค้ดเก่าเรียก loadRewards() ได้ ---
if (typeof window.loadRewards !== 'function') {
  window.loadRewards = function () {
    try {
      renderRewards(window.prevScore || 0);
    } catch (e) {
      console.error('loadRewards shim error:', e);
    }
  };
}
}

/** 3) Hook: ให้ของรางวัลอัปเดตทุกครั้งที่คะแนนถูกตั้งค่า */
(function hookSetPointsForRewards(){
  // ถ้ามีฟังก์ชัน setPoints ในระบบเดิม ให้ครอบไว้เพื่อเรียก renderRewards ต่อท้าย
  if (typeof window.setPoints === "function") {
    const _orig = window.setPoints;
    window.setPoints = function(score){
      try { _orig.call(this, score); } catch(_){}
      try { renderRewards(score); } catch(_){}
    };
  } else {
    // ถ้าไม่มี setPoints ให้ลองเรียกหลังโหลดหน้า
    document.addEventListener("DOMContentLoaded", ()=>{
      try { renderRewards(window.prevScore || 0); } catch(_){}
    });
  }
})();

/** 4) กดแลกรางวัล → เรียก /api/spend → หักคะแนน → รีเฟรชยอด */
let REDEEMING = false;
async function redeemReward(reward, btn) {
  if (REDEEMING) return;
  if (!window.UID) return toastErr && toastErr("ยังไม่พร้อมใช้งาน");

  const id   = reward?.id;
  const cost = Math.max(0, Number(reward?.cost) || 0);
  if (!id || !cost) return toastErr && toastErr("ข้อมูลรางวัลไม่ถูกต้อง");

  const scoreNow = Number(window.prevScore || 0);
  if (scoreNow < cost) {
    // โชว์ป้าย “คะแนนไม่พอ” อยู่แล้ว แต่กันคลิกซ้ำ
    return toastErr && toastErr("คะแนนไม่พอสำหรับรางวัลนี้");
  }

  // ยืนยันก่อน
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

  REDEEMING = true;
  const oldDisabled = btn?.disabled;
  if (btn) { btn.disabled = true; btn.classList.add("is-loading"); }

  try {
    const r = await fetch("/api/spend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid: window.UID, cost, rewardId: id })
    });
    const t = await r.text();
    let j; try { j = JSON.parse(t); } catch { j = { status: r.ok ? "success" : "error", message: t }; }
    if (j.status !== "success") throw new Error(j.message || "spend failed");

    // รีเฟรชคะแนน/บาร์/ปุ่มล็อก
    if (typeof window.refreshUserScore === "function") {
      await window.refreshUserScore();
    } else if (typeof window.setPoints === "function") {
      // fallback: ลดคะแนนในหน้า แล้วเรนเดอร์ใหม่
      const next = Math.max(0, scoreNow - cost);
      window.prevScore = next;
      window.setPoints(next);
    } else {
      window.prevScore = Math.max(0, scoreNow - cost);
      renderRewards(window.prevScore);
    }

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
    if (typeof toastErr === "function") toastErr(err.message || "แลกรางวัลไม่สำเร็จ");
  } finally {
    REDEEMING = false;
    if (btn) { btn.disabled = oldDisabled ?? false; btn.classList.remove("is-loading"); }
  }
}

/** 5) Delegation: จับคลิกปุ่มแลกบนรางของรางวัล */
(function bindRedeemClicks(){
  const rail = document.getElementById("rewardRail");
  if (!rail) return;
  rail.addEventListener("click", async (ev)=>{
    const btn  = ev.target.closest(".rp-redeem-btn");
    if (!btn) return;
    const card = btn.closest(".rp-reward-card");
    const id   = card?.dataset?.id;
    const cost = Number(card?.dataset?.cost || 0);
    await redeemReward({ id, cost }, btn);
  });
})();

/** 6) Helper เล็ก ๆ (ถ้าในโปรเจกต์คุณมีอยู่แล้ว ส่วนนี้จะไม่ชน) */
function escapeHtml(s){
  s = String(s||'');
  return s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

