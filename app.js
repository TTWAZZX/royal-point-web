/* ============ Royal Point — User App (Horizontal Profile Card, FIX) ============ */

/** LIFF / API */
const LIFF_ID = "2007053300-QoEvbXyn";
const API_GET_SCORE = "/api/get-score";
const API_REDEEM    = "/api/redeem";
const API_HISTORY   = "/api/score-history";

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
  }catch(e){ console.error(e); toastErr("เริ่มต้นระบบไม่สำเร็จ"); }
}

/* ================= UI Helpers ================= */
function bindUI(){
  els.btnRefresh && els.btnRefresh.addEventListener("click", refreshUserScore);
  els.btnHistory && els.btnHistory.addEventListener("click", openHistory);

  if (els.modal){
    els.modal.addEventListener("shown.bs.modal", startScanner);
    els.modal.addEventListener("hidden.bs.modal", stopScanner);
  }
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

async function refreshUserScore(){
  if(!UID) return;
  try{
    const r = await fetch(`${API_GET_SCORE}?uid=${encodeURIComponent(UID)}`, { cache:"no-store" });
    const j = await safeJson(r);
    if(j.status === "success" && j.data){
      const sc = Number(j.data.score || 0);
      setPoints(sc);
      localStorage.setItem("lastScore", String(sc));
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

/* ================= History (FIX: pad hoist) ================= */
async function openHistory(){
  if(!UID) return;
  try{
    const r = await fetch(`${API_HISTORY}?uid=${encodeURIComponent(UID)}`);
    const j = await safeJson(r);
    if(j.status!=="success") return toastErr("ไม่สามารถโหลดประวัติได้");
    if(els.historyUser) els.historyUser.textContent = els.username?.textContent || "—";
    if(!els.historyList) return;

    const list = j.data || [];
    if(!list.length){
      els.historyList.innerHTML = `<div class="list-group-item bg-transparent text-center text-muted">ไม่มีรายการ</div>`;
    }else{
      els.historyList.innerHTML = list.map(i=>{
        const ts = fmtDT(i.ts);
        const p = Number(i.point||0);
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
      }).join("");
    }
    new bootstrap.Modal(els.historyModal).show();
  }catch(e){ console.error(e); toastErr("ไม่สามารถโหลดประวัติได้"); }
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
