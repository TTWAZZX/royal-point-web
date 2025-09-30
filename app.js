/* ============ Royal Point — User App (Horizontal Profile Bar) ============ */

/** LIFF / API */
const LIFF_ID = "2007053300-QoEvbXyn";
const API_GET_SCORE = "/api/get-score";       // GET  ?uid=...
const API_REDEEM    = "/api/redeem";          // POST { uid, code, type }
const API_HISTORY   = "/api/score-history";   // GET  ?uid=...

/** Admin gate */
const ADMIN_UIDS = ["Ucadb3c0f63ada96c0432a0aede267ff9"];

/** Elements */
const $id = (x)=>document.getElementById(x);
const els = {
  username: $id("username"),
  profilePic: $id("profilePic"),
  points: $id("points"),
  progressFill: $id("progressFill"), // NEW
  nextTier: $id("next-tier"),
  levelBadge: $id("levelBadge"),

  btnRefresh: $id("refreshBtn"),
  btnAdmin: $id("btnAdmin"),
  btnHistory: $id("historyBtn"),

  modal: $id("scoreModal"),
  qrReader: $id("qr-reader"),
  secretInput: $id("secretCode"),
  submitBtn: $id("submitCodeBtn"),

  historyModal: $id("historyModal"),
  historyList: $id("historyList"),
  historyUser: $id("historyUser"),
};

/** State */
let UID = "";
let html5qrcode = null;
let lastCamera = null;

let prevScore = 0;
let prevLevel = "";

/* ============ Boot ============ */
document.addEventListener("DOMContentLoaded", initApp);

async function initApp(){
  try{
    await liff.init({ liffId: LIFF_ID });
    if(!liff.isLoggedIn()){ liff.login(); return; }

    const prof = await liff.getProfile();
    UID = prof.userId;

    els.username && (els.username.textContent = prof.displayName || "—");
    els.profilePic && (els.profilePic.src = prof.pictureUrl || "https://placehold.co/120x120");

    showAdminEntry(ADMIN_UIDS.includes(UID));
    bindUI();
    await refreshUserScore();
  }catch(e){ console.error(e); toastErr("เริ่มต้นระบบไม่สำเร็จ"); }
}

/* ============ UI Helpers ============ */
function bindUI(){
  els.btnRefresh && els.btnRefresh.addEventListener("click", refreshUserScore);
  els.btnHistory && els.btnHistory.addEventListener("click", openHistory);

  // Modal start/stop camera
  if (els.modal){
    els.modal.addEventListener("shown.bs.modal", startScanner);
    els.modal.addEventListener("hidden.bs.modal", stopScanner);
  }
  // Manual redeem
  els.submitBtn && els.submitBtn.addEventListener("click", async()=>{
    const code = (els.secretInput?.value || "").trim();
    if(!code) return toastErr("กรอกรหัสลับก่อน");
    await redeemCode(code, "MANUAL");
  });
}
function showAdminEntry(isAdmin){ const b=$id("btnAdmin"); if(b) b.classList.toggle("d-none", !isAdmin); }
function toastOk(msg){ return window.Swal ? Swal.fire("สำเร็จ", msg || "", "success") : alert(msg || "สำเร็จ"); }
function toastErr(msg){ return window.Swal ? Swal.fire("ผิดพลาด", msg || "", "error") : alert(msg || "ผิดพลาด"); }

/* ============ Score / Level / Progress ============ */
/** กำหนดช่วงระดับ (ปรับได้ตามจริง) */
const TIERS = [
  { key: "silver",   name: "Silver",   min: 0,    next: 500,     class: "rp-level-silver"   },
  { key: "gold",     name: "Gold",     min: 500,  next: 1200,    class: "rp-level-gold"     },
  { key: "platinum", name: "Platinum", min: 1200, next: Infinity, class: "rp-level-platinum" },
];

function getTier(score){
  for(const t of TIERS){ if(score >= t.min && score < t.next) return t; }
  return TIERS[TIERS.length-1]; // platinum
}

async function refreshUserScore(){
  if(!UID) return;
  try{
    const r = await fetch(`${API_GET_SCORE}?uid=${encodeURIComponent(UID)}`, { cache:"no-store" });
    const j = await safeJson(r);
    if(j.status === "success" && j.data){
      const score = Number(j.data.score || 0);
      setPoints(score);
      localStorage.setItem("lastScore", String(score));
    }else{
      const cached = Number(localStorage.getItem("lastScore") || "0");
      setPoints(cached);
    }
  }catch(e){
    console.error(e);
    const cached = Number(localStorage.getItem("lastScore") || "0");
    setPoints(cached);
  }
}

function setPoints(score){
  score = Number(score||0);

  // 1) Count-up animation
  if(els.points){
    const from = prevScore || Number(els.points.textContent || 0);
    animateCount(els.points, from, score, 600);
  }

  // 2) Level + badge (with sparkle on change)
  const tier = getTier(score);
  const nextNeed = tier.next === Infinity ? 0 : Math.max(0, tier.next - score);
  const pct = tier.next === Infinity ? 1 : (score - tier.min) / (tier.next - tier.min);

  if(els.levelBadge){
    els.levelBadge.textContent = tier.name;
    els.levelBadge.classList.remove("rp-level-silver","rp-level-gold","rp-level-platinum","sparkle");
    els.levelBadge.classList.add(tier.class);
    if(prevLevel && prevLevel !== tier.key){
      // sparkle!
      setTimeout(()=> els.levelBadge.classList.add("sparkle"), 30);
      setTimeout(()=> els.levelBadge.classList.remove("sparkle"), 1300);
    }
  }

  // 3) Progress bar (horizontal)
if (els.progressFill) {
  const pct = tier.next === Infinity ? 1 : (score - tier.min) / (tier.next - tier.min);
  els.progressFill.style.width = `${Math.max(0, Math.min(100, pct * 100))}%`;
}

// 4) Helper text (ระบุเลเวลถัดไปอัตโนมัติ)
const TIER_EMOJI = { Silver: "🥈", Gold: "🥇", Platinum: "💎" };
if (els.nextTier) {
  const idx = TIERS.findIndex(t => t.key === tier.key);
  const nextTierObj = TIERS[idx + 1] || null;
  if (!nextTierObj) {
    els.nextTier.textContent = "คุณถึงระดับสูงสุดแล้ว ✨";
  } else {
    const need = Math.max(0, nextTierObj.min - score);
    els.nextTier.textContent = `สะสมอีก ${need} คะแนน → เลื่อนไประดับ ${nextTierObj.name} ${TIER_EMOJI[nextTierObj.name] || ""}`;
  }
}


  prevLevel = tier.key;
  prevScore = score;
}

/* Count-up utility */
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

async function safeJson(resp){ const t=await resp.text(); try{ return JSON.parse(t); }catch{ return {status: resp.ok?"success":"error", message:t}; } }

/* ============ Redeem / Scanner ============ */
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
      if(els.secretInput) els.secretInput.value = "";
      if(els.modal){ const m = bootstrap.Modal.getInstance(els.modal); m && m.hide(); }
    }else{
      toastErr(j.message || "คูปองไม่ถูกต้องหรือถูกใช้ไปแล้ว");
    }
  }catch(e){ console.error(e); toastErr("ไม่สามารถยืนยันรับคะแนนได้"); }
}

async function startScanner(){
  if(!els.qrReader) return;
  try{
    const devices = await Html5Qrcode.getCameras();
    const camId = (devices[0] && devices[0].id);
    if(!camId) return;
    html5qrcode = new Html5Qrcode(els.qrReader.id);
    await html5qrcode.start(
      camId,
      { fps:10, qrbox:{ width:260, height:260 } },
      async (decoded)=>{ try{ await redeemCode(String(decoded||"").trim(), "SCAN"); } finally{ stopScanner(); } }
    );
  }catch(e){ console.warn("Scanner start failed:", e); }
}
async function stopScanner(){
  try{
    if(html5qrcode){ await html5qrcode.stop(); await html5qrcode.clear(); html5qrcode=null; }
    if(els.qrReader) els.qrReader.innerHTML="";
  }catch{}
}

/* ============ History ============ */
async function openHistory(){
  if(!UID) return;
  try{
    const r = await fetch(`${API_HISTORY}?uid=${encodeURIComponent(UID)}`);
    const j = await safeJson(r);
    if(j.status!=="success") return toastErr("โหลดประวัติไม่สำเร็จ");
    els.historyUser && (els.historyUser.textContent = els.username?.textContent || "—");
    if(!els.historyList) return;

    const list = j.data || [];
    if(!list.length){
      els.historyList.innerHTML = `<div class="list-group-item bg-transparent text-center text-muted">ไม่มีรายการ</div>`;
    }else{
      els.historyList.innerHTML = list.map(i=>{
        const ts = fmtDT(i.ts), p = Number(i.point||0), sign = p>=0?"+":"", color = p>=0?"#16a34a":"#dc2626";
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
      }).join("");
    }
    new bootstrap.Modal(els.historyModal).show();
  }catch(e){ console.error(e); toastErr("ไม่สามารถโหลดประวัติได้"); }
}

/* Utils */
function escapeHtml(s){return String(s||"").replace(/[&<>"'`=\/]/g,a=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','/':'&#47;','`':'&#x60;','=':'&#x3D;'}[a]))}
const pad=n=>n<10?("0"+n):String(n);
function fmtDT(ts){const d=new Date(ts);if(isNaN(d))return String(ts||"");return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;}
