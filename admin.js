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

/* =====================  COUPONS – ADMIN (FIXED MATCH HTML)  ===================== */
// endpoints ที่ลองเรียกหลายแบบ
// ใช้แค่ 2 endpoint นี้พอ
const COUPON_LIST_ENDPOINTS = ['/api/admin-coupons'];
const COUPON_GENERATE_ENDPOINTS = ['/api/admin-coupons-generate'];
const genBtn = document.getElementById('btnGenCoupons') || document.getElementById('btnGenerateCoupons');
genBtn?.addEventListener('click', generateCoupons);
document.getElementById('btnReloadCoupons')?.addEventListener('click', loadCoupons);

// อ่าน uid แอดมินจากค่าที่ตั้งไว้ตอน init()
function getAdminUid(){
  return window.__UID || localStorage.getItem('uid') ||
         document.querySelector('[data-uid]')?.dataset.uid || '';
}

// ป้องกันข้อความแตกเวลาฝังใน HTML
function htmlEscape(s){ return String(s ?? '').replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;', "'":'&#39;' }[m])); }

// fetch ที่ทนทาน: ถ้าไม่ใช่ JSON จะโยน error พร้อมข้อความดิบ
async function fetchJsonSafe(url, opts){
  const res = await fetch(url, opts);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); }
  catch { json = { status: res.ok ? 'success' : 'error', message: text || res.statusText }; }
  if (!res.ok || json?.status === 'error'){
    const err = new Error(json?.message || `HTTP ${res.status}`);
    err.response = res; err.body = text; err.json = json;
    throw err;
  }
  return json;
}

// คืน array คูปองจาก payload รูปแบบต่าง ๆ
function pickCouponArray(p){
  if (Array.isArray(p)) return p;
  if (Array.isArray(p?.data)) return p.data;
  if (Array.isArray(p?.items)) return p.items;
  return [];
}

// ←← ตรงกับ admin.html
const couponEls = {
  wrap: document.getElementById('couponPanel'),
  list: document.getElementById('couponList'),
  empty: document.getElementById('couponEmpty'),
  btnReload: document.getElementById('btnReloadCoupons'),

  // ปุ่มสร้างคูปองแบบกดตรง ๆ (ไม่มี modal/form)
  btnGen: document.getElementById('btnGenerateCoupons'),
  inputQty: document.getElementById('genQty'),
  inputPts: document.getElementById('genPoints'),
  inputPrefix: document.getElementById('genPrefix'),

  // QR modal แบบรูปภาพ
  qrModal: document.getElementById('qrModal'),
  qrImage: document.getElementById('qrImage'),
  qrText: document.getElementById('qrText'),
};

// สร้าง url สำหรับทั้ง ?adminUid= และ ?uid=
function buildListUrls(adminUid){
  const qs = [
    (base)=>`${base}?adminUid=${encodeURIComponent(adminUid)}`,
    (base)=>`${base}?uid=${encodeURIComponent(adminUid)}`
  ];
  const out = [];
  for (const base of COUPON_LIST_ENDPOINTS) for (const mk of qs) out.push(mk(base));
  return out;
}

/** โหลดรายการคูปอง */
async function loadCoupons(){
  if (!couponEls.list) return;
  couponEls.list.innerHTML = `<div class="text-muted text-center py-3">กำลังโหลด…</div>`;
  couponEls.empty.classList.add('d-none');

  const adminUid = getAdminUid();
  if (!adminUid){ couponEls.list.innerHTML=''; couponEls.empty.classList.remove('d-none'); return; }

  let lastErr;
  try{
    for (const url of buildListUrls(adminUid)){
      try{
        const data = await fetchJsonSafe(url, { cache:'no-store' });
        const rows = pickCouponArray(data);
        renderCouponList(rows);
        return;
      }catch(e){ lastErr = e; }
    }
    throw lastErr || new Error('ไม่พบ endpoint รายการคูปอง');
  }catch(e){
    console.warn('loadCoupons error:', e);
    couponEls.list.innerHTML = '';
    couponEls.empty.classList.remove('d-none');
    Swal.fire('โหลดคูปองไม่สำเร็จ', String(e.message||e), 'error');
  }
}

/** เรนเดอร์รายการคูปอง */
function renderCouponList(rows=[]){
  if (!rows.length){
    couponEls.list.innerHTML = '';
    couponEls.empty.classList.remove('d-none');
    return;
  }
  couponEls.empty.classList.add('d-none');

  couponEls.list.innerHTML = rows.map(r=>{
    const code   = r.code || r.coupon || r.coupon_code || r.id || '';
    const points = Number(r.points ?? r.point ?? r.amount ?? r.value ?? 0);
    const used   = !!(r.used ?? r.is_used ?? r.redeemed);
    const ts     = r.created_at || r.createdAt || r.time || '';
    const when   = ts ? new Date(ts).toLocaleString('th-TH', { hour12:false }) : '';
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

/** คลิกคัดลอก/เปิด QR */
couponEls.list?.addEventListener('click', (ev)=>{
  const btn = ev.target.closest('button[data-act]');
  if (!btn) return;
  const code = btn.dataset.code || '';
  if (!code) return;

  if (btn.dataset.act === 'copy'){
    navigator.clipboard?.writeText(code).then(
      ()=>Swal.fire('คัดลอกแล้ว','','success'),
      ()=>Swal.fire('คัดลอกแล้ว','','success')
    );
  }else if (btn.dataset.act === 'qr'){
    openQrModal(code);
  }
});

/** QR modal แบบรูปภาพ (ให้ตรงกับ HTML) */
function openQrModal(code){
  if (!couponEls.qrModal) return;
  const url = `https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(code)}`;
  if (couponEls.qrImage) couponEls.qrImage.src = url;
  if (couponEls.qrText)  couponEls.qrText.textContent = code;
  bootstrap.Modal.getOrCreateInstance(couponEls.qrModal).show();
}

/** สร้างคูปอง (ผูกกับปุ่มกดตรงๆ) */
async function handleGenerateCoupons(e){
  e?.preventDefault();

  const adminUid = getAdminUid();
  const qty  = Math.max(1, Number(couponEls.inputQty?.value || 1));
  const pts  = Math.max(1, Number(couponEls.inputPts?.value || 1));
  const pref = (couponEls.inputPrefix?.value || '').trim();

  // ใส่หลายชื่อฟิลด์ เพื่อให้เข้ากับแบ็กเอนด์หลายแบบ
  const payload = {
    adminUid, uid: adminUid,
    amount: qty, qty, count: qty, quantity: qty,
    points: pts, point: pts, value: pts,
    prefix: pref || undefined
  };

  try{
    let lastErr;
    for (const url of COUPON_GENERATE_ENDPOINTS){
      try{
        await fetchJsonSafe(url, {
          method:'POST',
          headers:{ 'Content-Type':'application/json' },
          body: JSON.stringify(payload)
        });
        Swal.fire('สำเร็จ','สร้างคูปองเรียบร้อย','success');
        await loadCoupons();
        return;
      }catch(e){ lastErr = e; }
    }
    throw lastErr || new Error('ไม่พบ endpoint สร้างคูปอง');
  }catch(e){
    console.error('generateCoupons error:', e);
    Swal.fire('สร้างคูปองไม่สำเร็จ', String(e.message||e), 'error');
  }
}

couponEls.btnGen?.addEventListener('click', handleGenerateCoupons);
couponEls.btnReload?.addEventListener('click', loadCoupons);

// โหลดอัตโนมัติเมื่อมี panel คูปองอยู่บนหน้า
document.addEventListener('DOMContentLoaded', ()=>{ if (couponEls.wrap) loadCoupons(); });
/* =====================  END COUPONS – ADMIN  ===================== */

/* ===== Wire old inline handlers & IDs for Coupons ===== */
// รองรับทั้งแบบ onclick และแบบผูกด้วย id
window.generateCoupons = generateCoupons;   // ให้ปุ่ม onclick ใช้ได้
window.loadCoupons     = loadCoupons;       // ถ้ามี onclick="loadCoupons()"

document.getElementById('btnGenerateCoupons')?.addEventListener('click', generateCoupons);
document.getElementById('btnReloadCoupons')  ?.addEventListener('click', loadCoupons);

// เผื่อ id ช่องกรอกไม่ตรงกัน ให้หาทั้งคู่
const pick = (a,b)=> document.getElementById(a) || document.getElementById(b);
couponEls.inputQty    = pick('genQty','qty');
couponEls.inputPts    = pick('genPoints','points');
couponEls.inputPrefix = pick('genPrefix','prefix');

// โหลดรายการคูปองอัตโนมัติเมื่อหน้า/แท็บพร้อม
document.addEventListener('DOMContentLoaded', ()=>{
  // ต้องมี container รายการคูปองอยู่ก่อน
  if (document.getElementById('couponList')) loadCoupons();
});

/* ==== COUPON: wire UI + expose globals ==== */
(function setupCouponUI () {
  const btnGen    = document.getElementById('btnGenerateCoupons');
  const btnReload = document.getElementById('btnReloadCoupons');

  if (btnGen)    btnGen.addEventListener('click', () => generateCoupons());
  if (btnReload) btnReload.addEventListener('click', () => loadCoupons());

  // โหลดรายการทันทีเมื่อมีแผงคูปองอยู่บนหน้า
  if (document.getElementById('couponPanel')) {
    loadCoupons();
  }
})();

// เผื่อมี inline/สคริปต์อื่นเรียก ฟังก์ชันแบบ global
window.generateCoupons = generateCoupons;
window.loadCoupons     = loadCoupons;
