// ============ CONFIG ============
// LIFF / API (ให้ชื่อสอดคล้องกับ admin.html)
const LIFF_ID = "2007053300-QoEvbXyn";
const API_ALL_SCORES    = "/api/all-scores";     // GET  ?uid= (หรือ ?adminUid=)
const API_SCORE_HISTORY = "/api/score-history";  // GET  ?uid=
const API_ADMIN_ADJUST   = "/api/admin-actions"; 
const API_ADMIN_RESET    = "/api/admin-actions"; 
const API_ADMIN_GIVEAWAY = "/api/admin-actions";
const API_COUPON_LIST = "/api/admin-coupons";
const API_COUPON_GEN  = "/api/admin-coupons-generate";
const USER_PAGE = "/index.html";

// ============ STATE ============
let ADMIN_UID = "";
let ALL_USERS = [];
let FILTERED  = [];
let CURRENT   = { uid: "", name: "", score: 0 };

// ============ UI refs ============
const $id = (x)=>document.getElementById(x);

// overlay แบบ fallback หากไม่มี LoadingOverlay
const overlay = {
  show:(text="กำลังทำงาน...")=>{
    if (window.$?.LoadingOverlay) {
      $.LoadingOverlay("show",{image:"",fontawesome:"fa fa-spinner fa-spin",text});
    } else {
      if ($id("admin-ovl")) return;
      const el = document.createElement("div");
      el.id = "admin-ovl";
      el.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:4000;color:#fff";
      el.innerHTML = `<div class="bg-dark rounded-3 px-3 py-2"><i class="fa fa-spinner fa-spin me-2"></i>${text}</div>`;
      document.body.appendChild(el);
    }
  },
  hide:()=>{
    if (window.$?.LoadingOverlay) $.LoadingOverlay("hide");
    else $id("admin-ovl")?.remove();
  }
};

// ============ BOOT ============
document.addEventListener("DOMContentLoaded", init);

async function init(){
  overlay.show("กำลังเริ่มระบบแอดมิน...");
  try{
    await liff.init({ liffId: LIFF_ID });
    if (!liff.isLoggedIn()) { liff.login(); return; }

    const prof = await liff.getProfile();
    ADMIN_UID = prof.userId || "";

    // อัปเดตส่วนหัว
    $id("adminUid").textContent  = ADMIN_UID ? `UID: ${ADMIN_UID}` : "UID: —";
    $id("adminName").textContent = prof.displayName || "—";

    bindEvents();           // รวมศูนย์การ bind event
    await reloadAllUsers(); // ดึงรายชื่อครั้งแรก
  } catch (err){
    console.error(err);
    Swal.fire("ผิดพลาด","เริ่มต้นระบบไม่สำเร็จ","error");
  } finally {
    overlay.hide();
  }
  window.__UID = ADMIN_UID;
  try { localStorage.setItem('uid', ADMIN_UID); } catch {}
}

function setAdminLoading(on){
  document.body.classList.toggle('loading', !!on);
  const sk = $id('adminSkeleton');
  const list = $id('listUsers');
  if (sk) sk.style.display = on ? 'block' : 'none';
  if (list && on) list.innerHTML = ""; // เคลียร์ก่อน
}

// ============ LOAD & RENDER ============
async function reloadAllUsers(){
  if (!ADMIN_UID) { ALL_USERS=[]; FILTERED=[]; renderList(FILTERED); return; }
  setAdminLoading(true);
  overlay.show("กำลังโหลดรายชื่อผู้ใช้...");
  try{
    // GAS all-scores ต้องส่ง uid ผู้ร้องขอ + secret (ฝั่ง proxy ทำให้แล้ว)
    const res  = await fetch(`${API_ALL_SCORES}?uid=${encodeURIComponent(ADMIN_UID)}`, { cache:"no-store" });
    const json = await res.json();
    if (json.status === "success") {
      ALL_USERS = (json.data||[]).map(x => ({ uid:x.uid, name:x.name||"(ไม่ระบุ)", score:Number(x.score||0) }));
      ALL_USERS.sort((a,b)=>b.score-a.score);
      FILTERED = [...ALL_USERS];
      renderList(FILTERED);
    } else {
      Swal.fire("โหลดข้อมูลไม่สำเร็จ", json.message || "Apps Script error", "error");
      ALL_USERS=[]; FILTERED=[]; renderList(FILTERED);
    }
  }catch(e){
    console.error(e);
    Swal.fire("ผิดพลาด","ไม่สามารถดึงข้อมูลผู้ใช้ได้","error");
  }finally{
    overlay.hide();
    setAdminLoading(false);
    // วิ่งแถบ topbar ให้จบสวย ๆ (รองรับสไตล์ใน style.css)
    document.body.classList.remove('loading'); 
    document.body.classList.add('ready');
    setTimeout(()=>document.body.classList.remove('ready'), 1000);
  }
}

function sortCouponsNewestFirst(rows = []) {
  return [...rows].sort((a, b) => {
    const ad = +new Date(a.created_at || a.createdAt || a.time || 0);
    const bd = +new Date(b.created_at || b.createdAt || b.time || 0);
    if (ad && bd && ad !== bd) return bd - ad;      // ใหม่ก่อน
    // เผื่อหลังบ้านไม่ส่งเวลา: เรียงตาม id/code แบบ desc เป็นตัวสำรอง
    return String(b.id || b.code || '').localeCompare(String(a.id || a.code || ''));
  });
}

function renderList(rows){
  const box = $id("listUsers");
  if (!rows || rows.length===0){
    box.innerHTML = `<div class="text-center muted py-5">— ไม่พบข้อมูล —</div>`;
    return;
  }
  box.innerHTML = rows.map(r => `
    <div class="card user-card" data-uid="${attr(r.uid)}" data-name="${attr(r.name)}" data-score="${Number(r.score||0)}">
      <div class="card-body d-flex justify-content-between align-items-center">
        <div class="name">${escapeHtml(r.name||"(ไม่ระบุ)")}</div>
        <div class="d-flex align-items-center gap-2">
          <span class="score-chip">${Number(r.score||0)}</span>
          <button class="btn btn-soft btn-icon btn-manage" title="จัดการ" aria-label="จัดการ">
            <i class="fa-solid fa-ellipsis"></i>
          </button>
        </div>
      </div>
    </div>
  `).join("");

  // เปิดแผ่นจัดการเมื่อคลิกปุ่ม … ของการ์ด
  // ใช้ handler เดียวเพื่อกันการผูกซ้ำ
  box.onclick = (ev)=>{
    const btn = ev.target.closest(".btn-manage");
    if (!btn) return;
    const card = btn.closest(".user-card");
    if (!card) return;
    const uid   = card.dataset.uid;
    const name  = card.dataset.name;
    const score = Number(card.dataset.score||0);
    openSheet(uid, name, score);
  };

}

// ============ EVENTS ============
function bindEvents(){
  $id("btnReload")?.addEventListener("click", reloadAllUsers);
  $id("btnBackUser")?.addEventListener("click", ()=>location.href=USER_PAGE);

  $id("txtSearch")?.addEventListener("input", function(){
    const q = (this.value||"").trim().toLowerCase();
    FILTERED = !q ? [...ALL_USERS] : ALL_USERS.filter(u =>
      (u.name||"").toLowerCase().includes(q) || String(u.uid||"").toLowerCase().includes(q)
    );
    renderList(FILTERED);
  });

  // ปุ่ม quick delta ใน offcanvas (ใช้ data-delta)
  $id("sheetManage")?.addEventListener("click", async (ev)=>{
    const el = ev.target.closest("button[data-delta]");
    if (!el) return;
    const delta = Number(el.dataset.delta || 0);
    if (!delta) return;
    await doAdjust(CURRENT.uid, CURRENT.name, delta);
  });

  $id("actPlus")?.addEventListener("click", ()=>doAdjust(CURRENT.uid, CURRENT.name, +1));
  $id("actMinus")?.addEventListener("click",()=>doAdjust(CURRENT.uid, CURRENT.name, -1));
  $id("actReset")?.addEventListener("click",()=>confirmReset(CURRENT.uid, CURRENT.name));
  $id("actHistory")?.addEventListener("click",()=>openHistory(CURRENT.uid, CURRENT.name));

  // ปรับแต้มแบบกำหนดเอง (เปิดโมดัล)
  $id("actCustom")?.addEventListener("click", ()=>{
    if (!CURRENT?.uid) return Swal.fire("เลือกผู้ใช้ก่อน","แตะปุ่มจัดการในรายการผู้ใช้","info");
    openAdjustModal(CURRENT.uid, CURRENT.name);
  });

  // ปุ่มในโมดัลกำหนดเอง
  $id("btnAdjAdd")   ?.addEventListener("click", ()=>submitAdjust(+1));
  $id("btnAdjDeduct")?.addEventListener("click", ()=>submitAdjust(-1));
  $id("btnAdjReset") ?.addEventListener("click", ()=>submitReset(CURRENT.uid, CURRENT.name));
  $id("btnGlobalGive")?.addEventListener("click", confirmGlobalGiveaway);
}

// ============ ACTIONS ============
async function openHistory(uid, name){
  CURRENT.uid = uid; CURRENT.name = name;
  overlay.show("กำลังโหลดประวัติ...");
  try{
    const r = await fetch(`${API_SCORE_HISTORY}?uid=${encodeURIComponent(uid)}`, { cache:"no-store" });
    const j = await r.json();
    const list = (j.status==="success" ? (j.data||[]) : []);
    $id("historyUser").textContent = name || uid;
    const box = $id("historyList");
    box.innerHTML = !list.length
      ? `<div class="list-group-item bg-transparent text-center text-muted py-3">ไม่มีรายการ</div>`
      : list.map(it => {
          const p = Number(it.point||0);
          const sign = p>=0?"+":"";
          const color = p>=0?"text-success":"text-danger";
          return `
            <div class="list-group-item d-flex justify-content-between align-items-center">
              <div>
                <div class="fw-bold">${escapeHtml(it.type||"-")}</div>
                <div class="small text-muted">${escapeHtml(it.code||"")}</div>
              </div>
              <div class="text-end ${color} fw-bold">
                ${sign}${p}<div class="small text-muted">${formatDateTime(it.ts)}</div>
              </div>
            </div>`;
        }).join("");
    new bootstrap.Modal($id("historyModal")).show();
  }catch(e){
    console.error(e);
    Swal.fire("ผิดพลาด","โหลดประวัติไม่สำเร็จ","error");
  }finally{ overlay.hide(); }
}

async function doAdjust(uid, name, delta){
  if (!uid || !delta) return;
  overlay.show("กำลังอัปเดตคะแนน...");
  try{
    const res = await fetch(API_ADMIN_ADJUST, {
      method: "POST",
      headers: { "Content-Type":"application/json" },
      // 👇 เพิ่ม action: 'adjust'
      body: JSON.stringify({ action: 'adjust', adminUid: ADMIN_UID, targetUid: uid, delta, note: "" })
    });
    const j = await res.json();
    if (j.status !== "success") throw new Error(j.message || "ปรับคะแนนไม่สำเร็จ");

    // อัปเดตในรายการ (ในหน่วยความจำ)
    const row = ALL_USERS.find(x=>x.uid===uid);
    if (row) row.score = Number(row.score||0) + Number(delta||0);

    // อัปเดตการ์ดบนหน้า
    updateRowScore(uid, row?.score ?? getLocalScore(uid));

    // เปิดแผ่นจัดการคนล่าสุดด้วยคะแนนใหม่
    openSheet(uid, name, row?.score||0);

    Swal.fire("สำเร็จ", `${delta>0?'+':''}${delta} คะแนน`, "success");
  }catch(e){
    console.error(e);
    Swal.fire("ผิดพลาด", String(e.message||e), "error");
  }finally{ overlay.hide(); }
}

function confirmReset(uid, name){
  Swal.fire({
    icon:"warning",
    title:`ล้างคะแนนของ ${escapeHtml(name||uid)}?`,
    showCancelButton:true, confirmButtonText:"ล้างคะแนน", cancelButtonText:"ยกเลิก"
  }).then(r=>{ if (r.isConfirmed) submitReset(uid, name); });
}

async function submitReset(uid, name){
  overlay.show("กำลังล้างคะแนน...");
  try{
    const res = await fetch(API_ADMIN_RESET, {
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      // 👇 เพิ่ม action: 'reset'
      body: JSON.stringify({ action: 'reset', adminUid: ADMIN_UID, targetUid: uid, note:"admin reset" })
    });
    const j = await res.json();
    if (j.status !== "success") throw new Error(j.message || "ล้างคะแนนไม่สำเร็จ");

    const row = ALL_USERS.find(x=>x.uid===uid);
    if (row) row.score = 0;

    updateRowScore(uid, 0);
    openSheet(uid, name, 0);

    Swal.fire("สำเร็จ","ล้างคะแนนเรียบร้อย","success");
  }catch(e){
    console.error(e);
    Swal.fire("ผิดพลาด", String(e.message||e), "error");
  }finally{ overlay.hide(); }
}

// เปิดแผ่นจัดการ (offcanvas)
function openSheet(uid, name, score){
  CURRENT = { uid, name, score:Number(score||0) };
  $id("sheetName").textContent = name || uid;
  $id("sheetScore").textContent = Number(score||0);
  new bootstrap.Offcanvas($id("sheetManage")).show();
}

// เปิดโมดัลกำหนดแต้มเอง
function openAdjustModal(uid, name){
  $id("ajUid").textContent = uid;
  $id("ajTitle").textContent = name || uid;
  $id("ajDelta").value = 50;
  $id("ajNote").value  = "";
  new bootstrap.Modal($id("adjustModal")).show();
}

// ฟังก์ชันส่งคำสั่งปรับแต้ม (จากโมดัล)
async function submitAdjust(sign){
  const uid  = $id("ajUid").textContent;
  const note = $id("ajNote").value || "";
  let amt = parseInt($id("ajDelta").value, 10);
  if (isNaN(amt) || amt <= 0) return Swal.fire("กรอกจำนวนแต้ม", "จำนวนต้องมากกว่า 0", "warning");
  const delta = sign === 1 ? amt : -amt;

  overlay.show("กำลังอัปเดตคะแนน...");
  try{
    const res = await fetch(API_ADMIN_ADJUST, {
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      // 👇 เพิ่ม action: 'adjust'
      body: JSON.stringify({ action: 'adjust', adminUid: ADMIN_UID, targetUid: uid, delta, note })
    });
    const j = await res.json();
    if (j.status !== "success") throw new Error(j.message || "ปรับคะแนนไม่สำเร็จ");

    const row = ALL_USERS.find(r=>r.uid===uid);
    if (row) row.score = Number(row.score||0) + delta;
    updateRowScore(uid, row?.score ?? getLocalScore(uid));

    Swal.fire("สำเร็จ", `${delta>0?'+':''}${delta} คะแนน`, "success");
    bootstrap.Modal.getInstance($id("adjustModal"))?.hide();
  }catch(e){
    console.error(e);
    Swal.fire("ผิดพลาด", String(e.message||e), "error");
  }finally{ overlay.hide(); }
}

// [เพิ่มใหม่ทั้งก้อน] ฟังก์ชันแจกคะแนนทุกคน
function confirmGlobalGiveaway() {
  const amtStr = $id("globalAmount").value;
  const note   = ($id("globalNote").value || "").trim();
  const amount = parseInt(amtStr, 10);

  // Validation
  if (isNaN(amount) || amount <= 0) {
    return Swal.fire("แจ้งเตือน", "กรุณาระบุจำนวนแต้มที่ถูกต้อง (ต้องมากกว่า 0)", "warning");
  }
  if (!note) {
    return Swal.fire("แจ้งเตือน", "กรุณาระบุเหตุผล/เนื่องในโอกาส เพื่อบันทึกประวัติ", "warning");
  }

  // ถามยืนยัน
  Swal.fire({
    title: `ยืนยันแจก ${amount} แต้ม?`,
    html: `ให้สมาชิก <b>ทุกคน</b> ในระบบ<br>เนื่องในโอกาส: <span class="text-primary">${escapeHtml(note)}</span><br><br><small class="text-danger">การกระทำนี้ไม่สามารถยกเลิกได้</small>`,
    icon: "question",
    showCancelButton: true,
    confirmButtonText: "ยืนยัน, แจกเลย!",
    confirmButtonColor: "#f59e0b",
    cancelButtonText: "ยกเลิก"
  }).then((result) => {
    if (result.isConfirmed) {
      submitGlobalGiveaway(amount, note);
    }
  });
}

async function submitGlobalGiveaway(amount, note) {
  overlay.show("กำลังแจกแต้มให้ทุกคน...");
  try {
    const res = await fetch(API_ADMIN_GIVEAWAY, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // 👇 เพิ่ม action: 'giveaway'
      body: JSON.stringify({
        action: 'giveaway', // <--- สำคัญ
        adminUid: ADMIN_UID,
        amount: amount,
        note: note
      })
    });
    const j = await res.json();
    
    if (j.status !== "success") throw new Error(j.message || "ทำรายการไม่สำเร็จ");

    // สำเร็จ
    Swal.fire({
      title: "เรียบร้อย!",
      text: `แจก ${amount} แต้ม ให้สมาชิกทุกคนแล้ว`,
      icon: "success",
      timer: 2000,
      showConfirmButton: false
    });
    
    // เคลียร์ค่า
    $id("globalAmount").value = "";
    $id("globalNote").value = "";

    // รีโหลดลิสต์รายชื่อ (หน่วงเวลานิดนึงเพื่อให้ DB อัปเดตทัน)
    setTimeout(reloadAllUsers, 1000);

  } catch (e) {
    console.error(e);
    Swal.fire("ผิดพลาด", String(e.message || e), "error");
  } finally {
    overlay.hide();
  }
}

// ============ UTIL ============
function getLocalScore(uid){ const f = ALL_USERS.find(x=>x.uid===uid); return f? Number(f.score||0):0; }
function updateRowScore(uid, newScore){
  // อัปเดต state
  for (const arr of [ALL_USERS, FILTERED]) {
    const i = arr.findIndex(x=>x.uid===uid);
    if (i!==-1) arr[i].score = Number(newScore||0);
  }
  // อัปเดตการ์ดใน DOM
  const cards = document.querySelectorAll("#listUsers .user-card");
  let cardEl = null;
  cards.forEach(c => { if (String(c.dataset.uid) === String(uid)) cardEl = c; });
  if (cardEl) {
    cardEl.dataset.score = String(Number(newScore||0));
    const chip = cardEl.querySelector(".score-chip");
    if (chip) chip.textContent = Number(newScore||0);
    // ไฮไลต์สั้น ๆ
    cardEl.classList.add("border","border-success");
    setTimeout(()=>cardEl.classList.remove("border","border-success"), 700);
  }
  // อัปเดตตัวเลขใน offcanvas ถ้ากำลังเปิดของ user เดียวกัน
  if (CURRENT?.uid === uid) {
    $id("sheetScore").textContent = Number(newScore||0);
  }
}
function escapeHtml(s){ return String(s||"").replace(/[&<>"'`=\/]/g, a=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','/':'&#47;','`':'&#x60;','=':'&#x3D;'}[a])); }
function attr(s){ return String(s||"").replace(/"/g,"&quot;"); }
function pad(n){ return n<10? "0"+n : String(n); }
function formatDateTime(ts){ const d=new Date(ts); if(isNaN(d)) return String(ts||""); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; }

// ทำให้เรียกได้จาก onclick ใน HTML (ถ้าคุณยังมีใช้อยู่ที่อื่น)
window.openHistory = openHistory;
window.doAdjust    = doAdjust;
window.confirmReset= confirmReset;
window.openSheet   = openSheet;

/* =====================  COUPONS – ADMIN (tabs + live tracking)  ===================== */
(() => {

  // ===== helper: สรุปสถานะคูปอง “ใช้แล้วหรือยัง” ให้ชัวร์ =====
  function isUsed(row) {
    const s = String(row.status || '').toLowerCase();
    if (s === 'used' || s === 'redeemed') return true;
    if (row.used === true || row.is_used === true || row.redeemed === true) return true;
    if (row.used_at) return true;
    if (row.claimer && String(row.claimer).trim() !== '') return true;
    return false;
  }

  // อัปเดตตัวนับ (ห้ามใช้ ?. ฝั่งซ้ายของ =)
  function updateCouponCounters(rows){
    const all    = rows.length;
    const used   = rows.filter(isUsed).length;
    const unused = all - used;

    const elAll    = document.getElementById('countAll');
    const elUsed   = document.getElementById('countUsed');
    const elUnused = document.getElementById('countUnused');
    if (elAll)    elAll.textContent    = all;
    if (elUsed)   elUsed.textContent   = used;
    if (elUnused) elUnused.textContent = unused;

    // เผื่อคุณใช้ badge ในแท็บ
    if (els.badgeAll)    els.badgeAll.textContent    = all;
    if (els.badgeUsed)   els.badgeUsed.textContent   = used;
    if (els.badgeUnused) els.badgeUnused.textContent = unused;
  }

  // รองรับหลาย endpoint เผื่อ API อยู่คนละ path
  const ENDPOINT_LIST = [
    '/api/admin-coupons',
    '/api/admin/coupons',
    '/api/list-coupons',
  ];
  const ENDPOINT_GEN = [
    '/api/admin-coupons-generate',
    '/api/admin/coupons/generate',
    '/api/coupons/generate',
  ];

  // refs ของโซนคูปอง (ไม่ชนกับตัวอื่นในไฟล์ เพราะอยู่ใน IIFE)
  const els = {
    list:         document.getElementById('couponList'),
    empty:        document.getElementById('couponEmpty'),
    btnReload:    document.getElementById('btnReloadCoupons'),
    btnGen:       document.getElementById('btnGenerateCoupons'),
    qty:          document.getElementById('genQty'),
    pts:          document.getElementById('genPoints'),
    prefix:       document.getElementById('genPrefix'),
    tabs:         document.getElementById('couponTabs'),
    badgeAll:     document.getElementById('badgeAll'),
    badgeUnused:  document.getElementById('badgeUnused'),
    badgeUsed:    document.getElementById('badgeUsed'),
    // QR modal parts
    qrBox:        document.getElementById('qrBox'),
    qrText:       document.getElementById('qrText'),
    qrStatus:     document.getElementById('qrStatus'),
    qrModal:      document.getElementById('qrModal'),
    btnCopyCode:  document.getElementById('btnCopyCode'),
    btnDownloadQR:document.getElementById('btnDownloadQR'),
  };

  let COUPON_ROWS   = [];               // เก็บรายการทั้งหมดไว้สำหรับ render/กรอง
  let COUPON_FILTER = 'all';            // 'all' | 'unused' | 'used'
  let trackTimer    = null;             // สำหรับติดตามสถานะใน QR modal
  const TRACK_INTERVAL_MS = 1500;
  const TRACK_TIMEOUT_MS  = 90_000;

  const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;', "'":'&#39;'
  }[m]));
  const escAttr = s => esc(s).replace(/"/g,'&quot;');

  const getAdminUid = () =>
    (typeof ADMIN_UID !== 'undefined' && ADMIN_UID) ||
    window.__UID ||
    localStorage.getItem('uid') || '';

  function pickRows(p) {
    if (Array.isArray(p?.data))  return p.data;
    if (Array.isArray(p))        return p;
    if (Array.isArray(p?.items)) return p.items;
    return [];
  }

  async function fetchJson(url, opts) {
    const res  = await fetch(url, opts);
    const text = await res.text();
    try {
      const j = JSON.parse(text);
      if (!res.ok || j?.status === 'error') throw new Error(j?.message || res.statusText);
      return j;
    } catch {
      if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
      return { status: 'success', data: [] };
    }
  }

  async function tryMany(endpoints, opts) {
    let lastErr;
    for (const u of endpoints) {
      try { return await fetchJson(u, opts); }
      catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('all_endpoints_failed');
  }

  // วาดรายการ (คัดกรองด้วย COUPON_FILTER + เรียงใหม่ก่อน)
  function render(rows = []) {
    if (!els.list) return;

    const filtered = rows.filter(r => {
      const u = isUsed(r);
      if (COUPON_FILTER === 'used')   return u;
      if (COUPON_FILTER === 'unused') return !u;
      return true;
    });

    // เรียง “ใหม่ก่อน” ถ้ามี created_at/createdAt/time
    const sorted = filtered.slice().sort((a,b) => {
      const ta = Date.parse(a.created_at || a.createdAt || a.time || 0) || 0;
      const tb = Date.parse(b.created_at || b.createdAt || b.time || 0) || 0;
      if (tb !== ta) return tb - ta;
      return String(b.code || b.coupon || b.id || '')
             .localeCompare(String(a.code || a.coupon || a.id || ''));
    });

    if (!sorted.length) {
      els.list.innerHTML = '';
      if (els.empty) els.empty.classList.remove('d-none');
      return;
    }
    if (els.empty) els.empty.classList.add('d-none');

    els.list.innerHTML = sorted.map(r => {
      const code   = r.code || r.coupon || r.coupon_code || r.id || '';
      const points = Number(r.points ?? r.point ?? r.amount ?? r.value ?? 0);
      const used   = isUsed(r);
      const badge  = used
        ? `<span class="badge rp-badge-used"><i class="fa-solid fa-xmark"></i> ใช้แล้ว</span>`
        : `<span class="badge rp-badge-unused"><i class="fa-solid fa-check"></i> ยังไม่ใช้</span>`;
      return `
        <div class="card mb-2">
          <div class="card-body d-flex align-items-center gap-3">
            <div class="flex-grow-1">
              <div class="fw-semibold">${esc(code)}</div>
              <div class="small text-muted">+${points} คะแนน</div>
            </div>
            <div class="me-2">${badge}</div>
            <button class="btn btn-outline-secondary btn-sm" data-act="copy" data-code="${escAttr(code)}">
              <i class="fa-regular fa-copy"></i>
            </button>
            <button class="btn btn-primary btn-sm" data-act="qr" data-code="${escAttr(code)}">
              <i class="fa-solid fa-qrcode"></i>
            </button>
          </div>
        </div>`;
    }).join('');
  }

  async function loadCoupons() {
    if (!els.list) return;
    els.list.innerHTML = `<div class="text-center text-muted py-3">กำลังโหลด…</div>`;
    try {
      const adminUid = getAdminUid();
      const resp = await tryMany(
        ENDPOINT_LIST.map(u => `${u}?adminUid=${encodeURIComponent(adminUid)}`),
        { cache: 'no-store' }
      );
      // เก็บไว้ใช้กับการกดแท็บภายหลัง
      COUPON_ROWS = pickRows(resp.data) || [];

      // อัปเดตตัวนับในแท็บ/ชิป
      updateCouponCounters(COUPON_ROWS);

      // วาดรายการตามฟิลเตอร์ปัจจุบัน
      render(COUPON_ROWS);

    } catch (e) {
      console.error('loadCoupons error', e);
      els.list.innerHTML = '';
      if (els.empty) els.empty.classList.remove('d-none');
      window.Swal?.fire('โหลดคูปองไม่สำเร็จ', e.message || 'server error', 'error');
    }
  }

  async function generateCoupons() {
    const adminUid = getAdminUid();
    const qty  = Math.max(1, Number(els.qty?.value || 1));
    const pts  = Math.max(1, Number(els.pts?.value || 1));
    const pref = (els.prefix?.value || '').trim();

    const body = {
      adminUid,
      amount: qty, qty, count: qty,
      points: pts, point: pts, value: pts,
      prefix: pref || undefined
    };

    try {
      els.btnGen?.setAttribute('disabled','disabled');
      await tryMany(ENDPOINT_GEN, {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify(body)
      });
      window.Swal?.fire('สำเร็จ','สร้างคูปองแล้ว','success');
      await loadCoupons(); // refresh
    } catch (e) {
      console.error('generateCoupons error', e);
      window.Swal?.fire('สร้างคูปองไม่สำเร็จ', e.message || 'server error', 'error');
    } finally {
      els.btnGen?.removeAttribute('disabled');
    }
  }

  // ===== QR Modal helpers =====
  function setQrStatus(html) {
    if (els.qrStatus) els.qrStatus.innerHTML = html;
  }

  function openQrModal(code) {
    // แสดงภาพ QR
    if (els.qrBox) {
      els.qrBox.innerHTML = '';
      const img = new Image();
      img.alt = 'QR code';
      img.className = 'img-fluid';
      img.src = `https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(code)}`;
      els.qrBox.appendChild(img);
      if (els.btnDownloadQR) els.btnDownloadQR.href = img.src.replace('260x260','1024x1024');
    }
    if (els.qrText) els.qrText.textContent = code;
    setQrStatus(`<div class="text-muted small"><i class="fa-solid fa-spinner fa-spin me-1"></i> กำลังรอการใช้คูปอง…</div>`);

    // ปุ่มคัดลอก
    els.btnCopyCode?.addEventListener('click', () => navigator.clipboard?.writeText(code), { once:true });

    // เริ่มติดตามสถานะ (polling)
    startTrack(code);

    // แสดง modal
    bootstrap.Modal.getOrCreateInstance(els.qrModal).show();
  }

  function stopTrack() {
    if (trackTimer) clearInterval(trackTimer);
    trackTimer = null;
  }

  async function pollOnce(code) {
    const adminUid = getAdminUid();
    const resp = await tryMany(
      ENDPOINT_LIST.map(u => `${u}?adminUid=${encodeURIComponent(adminUid)}`),
      { cache: 'no-store' }
    );
    const rows = pickRows(resp.data);
    const row  = rows.find(r => (r.code || r.coupon || r.coupon_code || r.id || '') === code);
    return row ? isUsed(row) : false;
  }

  function startTrack(code) {
    stopTrack();
    const t0 = Date.now();

    const tick = async () => {
      try {
        const used = await pollOnce(code);
        if (used) {
          setQrStatus(`<div class="text-success small"><i class="fa-solid fa-circle-check me-1"></i> ใช้แล้ว — อัปเดตรายการ…</div>`);
          navigator?.vibrate?.(80);
          stopTrack();
          await loadCoupons(); // รีเฟรชสถานะในลิสต์
        } else {
          const elapsed = Math.floor((Date.now()-t0)/1000);
          setQrStatus(`<div class="text-muted small"><i class="fa-solid fa-spinner fa-spin me-1"></i> รอการใช้คูปอง… (${elapsed}s)</div>`);
        }
        if (Date.now() - t0 > TRACK_TIMEOUT_MS) {
          setQrStatus(`<div class="text-warning small"><i class="fa-regular fa-clock me-1"></i> หมดเวลารอ กรุณาปิดหน้าต่างนี้หรือสแกนใหม่</div>`);
          stopTrack();
        }
      } catch (e) {
        console.warn('track error', e);
      }
    };

    tick(); // ยิงทันที 1 ครั้ง
    trackTimer = setInterval(tick, TRACK_INTERVAL_MS);
  }

  // ==== Events =========================================================
  // copy/QR
  els.list?.addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-act]');
    if (!btn) return;
    const code = btn.dataset.code || '';
    if (!code) return;

    if (btn.dataset.act === 'copy') {
      navigator.clipboard?.writeText(code);
      window.Swal?.fire({ toast:true, position:'top', timer:1200, showConfirmButton:false,
                          icon:'success', title:'คัดลอกแล้ว' });
    } else if (btn.dataset.act === 'qr') {
      openQrModal(code);
    }
  });

  // reload / generate
  els.btnReload?.addEventListener('click', loadCoupons);
  els.btnGen   ?.addEventListener('click', generateCoupons);

  // เปลี่ยนแท็บกรอง
  els.tabs?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-filter]');
    if (!btn) return;
    // active UI
    els.tabs.querySelectorAll('.nav-link').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    // set filter & render
    COUPON_FILTER = btn.dataset.filter || 'all';
    render(COUPON_ROWS);
  });

  // ปิด QR modal แล้วหยุดติดตาม + reload อีกครั้ง
  els.qrModal?.addEventListener('hidden.bs.modal', () => {
    stopTrack();
    setTimeout(() => { if (typeof loadCoupons === 'function') loadCoupons(); }, 200);
  });

  // โหลดอัตโนมัติเมื่อ element พร้อม
  if (els.list) loadCoupons();

})();
