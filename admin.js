// ============ CONFIG ============
// LIFF / API (ให้ชื่อสอดคล้องกับ admin.html)
const LIFF_ID = "2007053300-QoEvbXyn";
const API_ALL_SCORES    = "/api/all-scores";     // GET  ?uid= (หรือ ?adminUid=)
const API_SCORE_HISTORY = "/api/score-history";  // GET  ?uid=
const API_ADMIN_ADJUST  = "/api/admin-adjust";   // POST { adminUid, targetUid, delta, note }
const API_ADMIN_RESET   = "/api/admin-reset";    // POST { adminUid, targetUid, note }
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
    if (window.$?.LoadingOverlay) $.LoadingOverlay("show",{image:"",fontawesome:"fa fa-spinner fa-spin",text});
    else { if(document.getElementById("admin-ovl"))return; const el=document.createElement("div"); el.id="admin-ovl"; el.style.cssText="position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:4000;color:#fff"; el.innerHTML=`<div class="bg-dark rounded-3 px-3 py-2"><i class="fa fa-spinner fa-spin me-2"></i>${text}</div>`; document.body.appendChild(el); }
  },
  hide:()=>{ if (window.$?.LoadingOverlay) $.LoadingOverlay("hide"); else document.getElementById("admin-ovl")?.remove(); }
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

    bindEvents();           // ✅ รวมศูนย์การ bind event
    await reloadAllUsers(); // ✅ ดึงรายชื่อครั้งแรก
  } catch (err){
    console.error(err);
    Swal.fire("ผิดพลาด","เริ่มต้นระบบไม่สำเร็จ","error");
  } finally {
    overlay.hide();
  }
}

function setAdminLoading(on){
  document.body.classList.toggle('loading', !!on);
  const sk = document.getElementById('adminSkeleton');
  const list = document.getElementById('listUsers');
  if (sk) sk.style.display = on ? 'block' : 'none';
  if (list && on) list.innerHTML = ""; // เคลียร์ก่อน
}

async function reloadAllUsers(){
  if (!ADMIN_UID) { ALL_USERS=[]; FILTERED=[]; renderList(FILTERED); return; }
  setAdminLoading(true);
  overlay.show("กำลังโหลดรายชื่อผู้ใช้...");
  try{
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
    document.body.classList.remove('loading'); document.body.classList.add('ready');
    setTimeout(()=>document.body.classList.remove('ready'), 1000);
  }
}

// ============ EVENTS ============
function bindEvents(){
  // รีโหลด / กลับหน้าผู้ใช้
  $id("btnReload")?.addEventListener("click", reloadAllUsers);
  $id("btnBackUser")?.addEventListener("click", ()=>location.href=USER_PAGE);

  // ค้นหาเรียลไทม์
  $id("txtSearch")?.addEventListener("input", function(){
    const q = (this.value||"").trim().toLowerCase();
    FILTERED = !q ? [...ALL_USERS] : ALL_USERS.filter(u =>
      (u.name||"").toLowerCase().includes(q) || String(u.uid||"").toLowerCase().includes(q)
    );
    renderList(FILTERED);
  });

  // ปุ่มใน bottom sheet (offcanvas)
  document.getElementById("sheetManage")?.addEventListener("click", async (ev)=>{
    const el = ev.target.closest("button[data-delta]");
    if (el) {
      const delta = Number(el.dataset.delta || 0);
      if (!delta) return;
      await doAdjust(CURRENT.uid, CURRENT.name, delta);
    }
  });

  $id("actPlus")?.addEventListener("click", ()=>doAdjust(CURRENT.uid, CURRENT.name, +1));
  $id("actMinus")?.addEventListener("click",()=>doAdjust(CURRENT.uid, CURRENT.name, -1));
  $id("actReset")?.addEventListener("click",()=>confirmReset(CURRENT.uid, CURRENT.name));
  $id("actHistory")?.addEventListener("click",()=>openHistory(CURRENT.uid, CURRENT.name));
}

// ============ LOAD & RENDER ============
async function reloadAllUsers(){
  if (!ADMIN_UID) { ALL_USERS=[]; FILTERED=[]; renderList(FILTERED); return; }
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
  }finally{ overlay.hide(); }
}

function renderList(rows){
  const box = $id("listUsers");
  box.innerHTML = rows.map(r => `
    <div class="card user-card p-2" data-uid="${r.uid}" data-name="${escapeHtml(r.name)}" data-score="${r.score}">
      <div class="d-flex align-items-center gap-2">
        ...
        <div class="btn-group">
          <button class="btn btn-soft btn-icon act-history" title="ประวัติ"><i class="fa-regular fa-clock"></i></button>
          <button class="btn btn-soft btn-icon act-minus"   title="หักคะแนน"><i class="fa-solid fa-circle-minus"></i></button>
          <button class="btn btn-soft btn-icon act-plus"    title="เพิ่มคะแนน"><i class="fa-solid fa-circle-plus"></i></button>
          <button class="btn btn-danger btn-icon  act-reset" title="ล้างคะแนน"><i class="fa-solid fa-broom"></i></button>
        </div>
      </div>
    </div>
  `).join("");

  // delegate ครั้งเดียวที่ container
  box.addEventListener("click", (ev)=>{
    const card = ev.target.closest(".user-card"); if(!card) return;
    const uid  = card.dataset.uid;
    const name = card.dataset.name;
    const score= Number(card.dataset.score||0);

    if (ev.target.closest(".act-history")) return openHistory(uid, name);
    if (ev.target.closest(".act-plus"))    return doAdjust(uid, name, +1);
    if (ev.target.closest(".act-minus"))   return doAdjust(uid, name, -1);
    if (ev.target.closest(".act-reset"))   return confirmReset(uid, name);
  }, { once:true }); // ผูกครั้งเดียวพอ
}

function attr(s){ return String(s||"").replaceAll(`"`,`&quot;`).replaceAll(`'`,`&#39;`); }
function escapeHtml(s){ return String(s||"").replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }

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
      ? `<div class="text-center text-muted py-3">— ไม่มีประวัติ —</div>`
      : list.map(it => `
        <div class="list-group-item">
          <div class="d-flex justify-content-between">
            <div>
              <div class="fw-semibold">${escapeHtml(it.type||"-")}</div>
              <div class="small text-muted">${escapeHtml(it.code||"")}</div>
            </div>
            <div class="text-end ${Number(it.point||0)>=0?'text-success':'text-danger'} fw-bold">
              ${Number(it.point||0)>=0?'+':''}${Number(it.point||0)}
            </div>
          </div>
          <div class="small text-muted">${new Date(it.ts).toLocaleString()}</div>
        </div>
      `).join("");
    const modal = new bootstrap.Modal($id("historyModal"));
    modal.show();
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
    // อัปเดตในรายการ
    const row = ALL_USERS.find(x=>x.uid===uid);
    if (row) row.score = Number(row.score||0)+Number(delta||0);
    renderList(FILTERED);
    // เปิดแผ่นจัดการคนล่าสุด
    openSheet(uid, name, row?.score||0);
    Swal.fire("สำเร็จ", `${delta>0?'+':''}${delta} คะแนน`, "success");
  }catch(e){
    console.error(e);
    Swal.fire("ผิดพลาด", String(e.message||e), "error");
  }finally{ overlay.hide(); }
}

function confirmReset(uid, name){
  Swal.fire({ icon:"warning", title:`ล้างคะแนนของ ${name||uid}?`,
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
    renderList(FILTERED);
    openSheet(uid, name, 0);
    Swal.fire("สำเร็จ","ล้างคะแนนเรียบร้อย","success");
  }catch(e){
    console.error(e);
    Swal.fire("ผิดพลาด", String(e.message||e), "error");
  }finally{ overlay.hide(); }
}

// เปิดแผ่นจัดการ (offcanvas)
// เปิดแผ่นจัดการ (offcanvas)
function openSheet(uid, name, score){
  CURRENT = { uid, name, score:Number(score||0) };
  $id("sheetName").textContent = name || uid;
  $id("sheetScore").textContent = Number(score||0);
  new bootstrap.Offcanvas("#sheetManage").show();
}

// เปิดโมดัลกำหนดแต้มเอง
function openAdjustModal(uid, name){
  document.getElementById("ajUid").textContent = uid;
  document.getElementById("ajTitle").textContent = name || uid;
  document.getElementById("ajDelta").value = 50;
  document.getElementById("ajNote").value  = "";
  new bootstrap.Modal(document.getElementById("adjustModal")).show();
}

// bind ปุ่มเปิดโมดัลใน offcanvas
document.getElementById("actCustom")?.addEventListener("click", ()=>{
  if (!CURRENT?.uid) return Swal.fire("เลือกผู้ใช้ก่อน","แตะปุ่มจัดการในรายการผู้ใช้","info");
  openAdjustModal(CURRENT.uid, CURRENT.name);
});

// ปุ่มในโมดัล
document.getElementById("btnAdjAdd")?.addEventListener("click", ()=>submitAdjust(+1));
document.getElementById("btnAdjDeduct")?.addEventListener("click", ()=>submitAdjust(-1));
document.getElementById("btnAdjReset")?.addEventListener("click", ()=>submitReset());

// ฟังก์ชันส่งคำสั่งปรับแต้ม
async function submitAdjust(sign){
  const uid  = document.getElementById("ajUid").textContent;
  const note = document.getElementById("ajNote").value || "";
  let amt = parseInt(document.getElementById("ajDelta").value, 10);
  if (isNaN(amt) || amt <= 0) return Swal.fire("กรอกจำนวนแต้ม", "จำนวนต้องมากกว่า 0", "warning");
  const delta = sign === 1 ? amt : -amt;

  overlay.show("กำลังอัปเดตคะแนน...");
  try{
    const res = await fetch(API_ADMIN_ADJUST, { method:"POST", headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({ adminUid: ADMIN_UID, targetUid: uid, delta, note }) });
    const j = await res.json();
    if (j.status !== "success") throw new Error(j.message || "ปรับคะแนนไม่สำเร็จ");

    const row = ALL_USERS.find(r=>r.uid===uid);
    if (row) row.score = Number(row.score||0) + delta;
    renderList(FILTERED);

    Swal.fire("สำเร็จ", `${delta>0?'+':''}${delta} คะแนน`, "success");
    bootstrap.Modal.getInstance(document.getElementById("adjustModal"))?.hide();
  }catch(e){
    console.error(e);
    Swal.fire("ผิดพลาด", String(e.message||e), "error");
  }finally{ overlay.hide(); }
}

// ============ UTIL ============
function getLocalScore(uid) { const f = ALL_USERS.find(x => x.uid === uid); return f ? Number(f.score || 0) : 0; }
function updateRowScore(uid, newScore) {
  for (const arr of [ALL_USERS, FILTERED]) { const i = arr.findIndex(x => x.uid === uid); if (i !== -1) arr[i].score = Number(newScore || 0); }
  const $rows = $("#tbodyUsers tr"); let $row = null;
  $rows.each(function(){ const uidCell = $(this).find("td:eq(1)").text().trim(); if (uidCell === uid) { $row = $(this); return false; } });
  if ($row) { $row.find(".score-chip").text(Number(newScore || 0)); $row.addClass("table-success"); setTimeout(() => $row.removeClass("table-success"), 800); }
}
function escapeHtml(s){ return String(s||"").replace(/[&<>"'`=\/]/g, a => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','/':'&#47;','`':'&#x60;','=':'&#x3D;'}[a])); }
function attr(s){ return String(s||"").replace(/"/g,"&quot;"); }
function pad(n){ return n<10? "0"+n : String(n); }
function formatDateTime(ts){ const d=new Date(ts); if(isNaN(d)) return String(ts||""); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; }

// ทำให้เรียกได้จาก onclick ใน HTML
window.openHistory = openHistory;
window.doAdjust    = doAdjust;
window.confirmReset= confirmReset;
window.openSheet   = openSheet;
