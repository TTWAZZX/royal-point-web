// ============ CONFIG ============
// LIFF / API (ให้ชื่อสอดคล้องกับ admin.html)
const LIFF_ID = "2007053300-QoEvbXyn";
const API_ALL_SCORES    = "/api/all-scores";     // GET  ?uid= (หรือ ?adminUid=)
const API_SCORE_HISTORY = "/api/score-history";  // GET  ?uid=
const API_ADMIN_ADJUST  = "/api/admin-adjust";   // POST { adminUid, targetUid, delta, note }
const API_ADMIN_RESET   = "/api/admin-reset";    // POST { adminUid, targetUid, note }
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
      body: JSON.stringify({ adminUid: ADMIN_UID, targetUid: uid, delta, note: "" })
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
      body: JSON.stringify({ adminUid: ADMIN_UID, targetUid: uid, note:"admin reset" })
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
      body: JSON.stringify({ adminUid: ADMIN_UID, targetUid: uid, delta, note })
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

/* =====================  COUPONS – ADMIN (HTML-compatible)  ===================== */
/** รองรับหลาย endpoint */
const COUPON_LIST_ENDPOINTS = [
  '/api/admin/coupons',
  '/api/admin-coupons',
  '/api/coupons',
  '/api/list-coupons'
];
const COUPON_GENERATE_ENDPOINTS = [
  '/api/admin/coupons/generate',
  '/api/admin-coupons-generate',
  '/api/coupons/generate'
];

/** utils */
function htmlEscape(s){ return String(s ?? '').replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;', "'":'&#39;' }[m])); }
async function fetchJsonSafe(url, opts){
  const res = await fetch(url, opts);
  const text = await res.text();
  let json; try{ json = JSON.parse(text);}catch{ json = {status:res.ok?'success':'error', message:text||res.statusText};}
  if(!res.ok || json?.status==='error'){ const e=new Error(json?.message||`HTTP ${res.status}`); e.response=res; e.body=text; e.json=json; throw e; }
  return json;
}
async function tryMany(endpoints, opts, {label=''}={}) {
  let lastErr;
  for (const url of endpoints){
    try { const data = await fetchJsonSafe(url, opts); console.info(`[COUPON] OK ${label}:`, url); return {url, data}; }
    catch(e){ console.warn(`[COUPON] FAIL ${label}:`, url, e); lastErr=e; }
  }
  throw lastErr || new Error('all_endpoints_failed');
}
function pickCouponArray(payload){
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data))  return payload.data;
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
}
function getAdminUid(){
  return window.__UID || localStorage.getItem('uid') || document.querySelector('[data-uid]')?.dataset.uid || '';
}

/** DOM (ให้ตรงกับ admin.html) */
const couponUI = {
  wrap:     document.getElementById('couponAdmin'),
  list:     document.getElementById('couponList'),
  empty:    document.getElementById('couponEmpty'),
  filter:   document.getElementById('couponFilter'),
  search:   document.getElementById('couponSearch'),
  reload:   document.getElementById('btnReloadCoupons'),
  genOpen:  document.getElementById('btnGenCoupons'),
  genForm:  document.getElementById('genForm'),
  genCount: document.getElementById('genCount'),
  genPoints:document.getElementById('genPoints'),
  genPrefix:document.getElementById('genPrefix'),
  qrModal:  document.getElementById('qrModal'),
  qrBox:    document.getElementById('qrBox'),
  qrText:   document.getElementById('qrText'),
  qrCopy:   document.getElementById('btnCopyCode'),
  qrDown:   document.getElementById('btnDownloadQR'),
};

/** โหลดคูปองทั้งหมด */
async function loadCoupons(){
  if (!couponUI.list) return;
  couponUI.list.innerHTML = `<div class="text-muted py-3 text-center">กำลังโหลด…</div>`;
  couponUI.empty.classList.add('d-none');

  try{
    const adminUid = getAdminUid();
    const { data } = await tryMany(
      COUPON_LIST_ENDPOINTS.map(u => `${u}?adminUid=${encodeURIComponent(adminUid)}`),
      { cache:'no-store' },
      { label:'list' }
    );
    let rows = pickCouponArray(data);

    // filter/search (ถ้ามีค่า)
    const f = couponUI.filter?.value || 'all';
    const q = (couponUI.search?.value || '').trim().toLowerCase();
    if (f !== 'all') rows = rows.filter(r => !!(r.used ?? r.is_used ?? r.redeemed) === (f==='used'));
    if (q) rows = rows.filter(r => String(r.code || r.coupon || r.coupon_code || r.id || '').toLowerCase().includes(q));

    renderCouponList(rows);
  }catch(e){
    console.error('loadCoupons error', e);
    couponUI.list.innerHTML = '';
    couponUI.empty.classList.remove('d-none');
    Swal.fire('โหลดคูปองไม่สำเร็จ', e.message || 'server error', 'error');
  }
}

/** เรนเดอร์รายการ */
function renderCouponList(rows=[]){
  if (!rows.length){
    couponUI.list.innerHTML = '';
    couponUI.empty.classList.remove('d-none');
    return;
  }
  couponUI.empty.classList.add('d-none');

  couponUI.list.innerHTML = rows.map(r=>{
    const code   = r.code || r.coupon || r.coupon_code || r.id || '';
    const points = Number(r.points ?? r.point ?? r.amount ?? r.value ?? 0);
    const used   = !!(r.used ?? r.is_used ?? r.redeemed);
    const ts     = r.created_at || r.createdAt || r.time || '';
    const when   = ts ? new Date(ts).toLocaleString('th-TH',{hour12:false}) : '';
    const badge  = used
      ? `<span class="badge bg-danger"><i class="fa-solid fa-xmark"></i> ใช้แล้ว</span>`
      : `<span class="badge bg-success"><i class="fa-solid fa-check"></i> ยังไม่ใช้</span>`;
    return `
      <div class="card mb-2 shadow-sm">
        <div class="card-body d-flex align-items-center gap-3">
          <div class="flex-grow-1">
            <div class="fw-semibold fs-6">${htmlEscape(code)}</div>
            <div class="text-muted small">+${points} คะแนน ${when?`• ${htmlEscape(when)}`:''}</div>
          </div>
          <div class="me-2">${badge}</div>
          <button class="btn btn-outline-secondary btn-sm" data-act="copy" data-code="${htmlEscape(code)}" title="คัดลอกรหัส">
            <i class="fa-regular fa-copy"></i>
          </button>
          <button class="btn btn-primary btn-sm" data-act="qr" data-code="${htmlEscape(code)}" title="แสดง QR">
            <i class="fa-solid fa-qrcode"></i>
          </button>
        </div>
      </div>`;
  }).join('');
}

/** คลิกคัดลอก/QR */
couponUI.list?.addEventListener('click', (ev)=>{
  const btn = ev.target.closest('button[data-act]');
  if (!btn) return;
  const code = btn.dataset.code || '';
  if (!code) return;

  if (btn.dataset.act === 'copy'){
    navigator.clipboard?.writeText(code).then(
      ()=> Swal.fire({icon:'success',title:'คัดลอกแล้ว',timer:900,showConfirmButton:false}),
      ()=> Swal.fire({icon:'success',title:'คัดลอกแล้ว',timer:900,showConfirmButton:false}),
    );
  }else if (btn.dataset.act === 'qr'){
    openQrModal(code);
  }
});

/** แสดง QR ด้วย qrcodejs (ตาม HTML ของคุณ) */
function openQrModal(code){
  if (!couponUI.qrModal || !couponUI.qrBox) return;
  couponUI.qrBox.innerHTML = '';            // เคลียร์ของเก่า
  couponUI.qrText.textContent = code || '';
  try{
    // qrcodejs สร้าง <canvas> หรือ <img> ภายใน qrBox
    new QRCode(couponUI.qrBox, { text: String(code||''), width: 240, height: 240 });
    setTimeout(()=>{                         // ทำปุ่มดาวน์โหลดให้ใช้ dataURL จาก canvas/img ที่สร้าง
      const cv = couponUI.qrBox.querySelector('canvas');
      const im = couponUI.qrBox.querySelector('img');
      const dataUrl = cv ? cv.toDataURL('image/png') : (im?.src || '');
      if (dataUrl) {
        couponUI.qrDown?.classList.remove('disabled');
        couponUI.qrDown?.setAttribute('href', dataUrl);
      } else {
        couponUI.qrDown?.classList.add('disabled');
        couponUI.qrDown?.removeAttribute('href');
      }
    }, 50);
  }catch(e){
    console.warn('QRCode render failed', e);
  }

  // คัดลอกโค้ด
  couponUI.qrCopy?.addEventListener('click', ()=>{
    navigator.clipboard?.writeText(code);
  }, {once:true});

  new bootstrap.Modal(couponUI.qrModal).show();
}

/** สร้างคูปอง (modal submit) */
async function generateCoupons(ev){
  ev?.preventDefault?.();
  const adminUid = getAdminUid();
  const qty  = Math.max(1, Number(couponUI.genCount?.value || 1));
  const pts  = Math.max(1, Number(couponUI.genPoints?.value || 1));
  const pref = (couponUI.genPrefix?.value || '').trim();

  const payload = {
    adminUid,
    amount: qty, qty, count: qty,
    points: pts, point: pts, value: pts,
    prefix: pref || undefined
  };

  try{
    couponUI.genForm?.querySelector('button[type="submit"]')?.setAttribute('disabled','disabled');
    await tryMany(
      COUPON_GENERATE_ENDPOINTS,
      { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) },
      { label:'generate' }
    );
    Swal.fire('สำเร็จ','สร้างคูปองเรียบร้อย','success');
    bootstrap.Modal.getInstance(document.getElementById('genModal'))?.hide();
    await loadCoupons();
  }catch(e){
    console.error('generateCoupons error', e);
    Swal.fire('สร้างคูปองไม่สำเร็จ', e.message || 'server error', 'error');
  }finally{
    couponUI.genForm?.querySelector('button[type="submit"]')?.removeAttribute('disabled');
  }
}

/** ปุ่ม/อีเวนต์ */
couponUI.reload?.addEventListener('click', loadCoupons);
couponUI.genOpen?.addEventListener('click', ()=> new bootstrap.Modal(document.getElementById('genModal')).show());
couponUI.genForm?.addEventListener('submit', generateCoupons);
couponUI.filter?.addEventListener('change', loadCoupons);
couponUI.search?.addEventListener('keydown', (e)=>{ if(e.key==='Enter') loadCoupons(); });

/** โหลดคูปองเมื่อหน้าแอดมินพร้อม */
document.addEventListener('DOMContentLoaded', ()=>{ if (couponUI.wrap) loadCoupons(); });
/* =====================  END COUPONS – ADMIN  ===================== */
