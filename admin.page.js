/* admin.page.js — minimal & safe (no rewards management) */
'use strict';

// =================== CONFIG ===================
const ADMIN_UID = "Ucadb3c0f63ada96c0432a0aede267ff9";   // uid แอดมินของคุณ
const LIFF_ID   = "2007053300-QoEvbXyn";

// API endpoints
const API_LIST   = "/api/all-scores";      // GET ?adminUid=...
const API_ADJUST = "/api/admin-adjust";    // POST {adminUid,targetUid,delta,note}
const API_RESET  = "/api/admin-reset";     // POST {adminUid,targetUid,note}
const API_HIST   = "/api/score-history";   // GET ?uid=...

// =================== STATE ====================
let MY_UID = null;
let rows = [];           // raw data [{uid,name,score}]
let view = [];           // filtered + sorted
let sortKey = "score";   // 'score' | 'name' | 'uid' | 'rank'
let sortDir = "desc";    // 'asc' | 'desc'
let page = 1;
let pageSize = 20;

// =================== UTILS ====================
function $(s, r=document)  { return r.querySelector(s); }
function $$(s, r=document) { return Array.from(r.querySelectorAll(s)); }
function fmt(n) { return Number(n||0).toLocaleString(); }
function debounce(fn, ms=300){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms);} }
function escapeHtml(s){ return String(s||"").replace(/[&<>"']/g, m=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" }[m])); }

// เล็ก ๆ สำหรับ overlay (ไม่มีก็ไม่เป็นไร)
const overlay = {
  show(msg="กำลังทำงาน..."){
    if ($("#rp-ovl")) return;
    const el = document.createElement("div");
    el.id = "rp-ovl";
    el.style.cssText = "position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.45);z-index:4000;color:#fff";
    el.innerHTML = `<div class="bg-dark px-3 py-2 rounded-3"><i class="fa fa-spinner fa-spin me-2"></i>${msg}</div>`;
    document.body.appendChild(el);
  },
  hide(){ const el=$("#rp-ovl"); if(el) el.remove(); }
};

// =================== RENDER (skeleton) ====================
function renderSkeleton() {
  const body = $("#adminTableBody");
  if (body) {
    body.innerHTML = `
      <tr><td colspan="3">
        <div class="skeleton skeleton-row"></div>
        <div class="skeleton skeleton-row"></div>
        <div class="skeleton skeleton-row"></div>
      </td></tr>`;
  }
  const info = $("#adminInfo"); if (info) info.textContent = "กำลังโหลด...";
  const range = $("#adminRange"); if (range) range.textContent = "";
  const pager = $("#adminPager"); if (pager) pager.innerHTML = "";
  const pagerInfo = $("#adminPagerInfo"); if (pagerInfo) pagerInfo.textContent = "";
}

// =================== DATA: LOAD ====================
async function loadList() {
  renderSkeleton();
  try {
    const url = `${API_LIST}?adminUid=${encodeURIComponent(MY_UID)}`;
    const res = await fetch(url, { cache:"no-store" });
    const data = await res.json();

    if (data.status !== "success" || !Array.isArray(data.data)) {
      throw new Error(data.message || "โหลดข้อมูลไม่สำเร็จ");
    }

    rows = data.data.map((r,i)=>({ rank:i+1, uid:r.uid, name:r.name, score:Number(r.score||0) }));
    const info = $("#adminInfo"); if (info) info.textContent = `ทั้งหมด ${fmt(rows.length)} รายการ`;
    applyFilterSortPaginate(true);
  } catch (e) {
    const body = $("#adminTableBody");
    if (body) body.innerHTML = `<tr><td colspan="3" class="text-danger">โหลดข้อมูลไม่สำเร็จ: ${e.message||e}</td></tr>`;
    const info = $("#adminInfo"); if (info) info.textContent = "เกิดข้อผิดพลาด";
  }
}

// =================== FILTER + SORT + PAGINATE ====================
function applyFilterSortPaginate(resetPage=false) {
  const q        = ( $("#adminSearch")?.value || "" ).trim().toLowerCase();
  const minScore = Number( $("#adminMinScore")?.value || 0 );
  const psEl = $("#adminPageSize"); pageSize = psEl ? Number(psEl.value || 20) : 20;

  view = rows.filter(r=>{
    const hitQ   = !q || (r.name||"").toLowerCase().includes(q) || (r.uid||"").toLowerCase().includes(q);
    const hitMin = r.score >= minScore;
    return hitQ && hitMin;
  });

  view.sort((a,b)=>{
    let va=a[sortKey], vb=b[sortKey];
    if (typeof va==='string') va=va.toLowerCase();
    if (typeof vb==='string') vb=vb.toLowerCase();
    if (va<vb) return sortDir==='asc' ? -1 : 1;
    if (va>vb) return sortDir==='asc' ?  1 : -1;
    return 0;
  });

  if (resetPage) page = 1;
  renderTable();
}

// =================== TABLE + PAGER ====================
function renderTable() {
  const total = view.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (page > totalPages) page = totalPages;

  const start = (page-1)*pageSize;
  const end   = Math.min(start+pageSize, total);
  const slice = view.slice(start,end);

  const range = $("#adminRange");
  if (range) range.textContent = total ? `แสดง ${fmt(start+1)}–${fmt(end)} จาก ${fmt(total)}` : "";

  const body = $("#adminTableBody");
  if (!slice.length) {
    if (body) body.innerHTML = `<tr><td colspan="3" class="text-center text-muted">ไม่พบข้อมูล</td></tr>`;
  } else if (body) {
    body.innerHTML = slice.map(r=>`
      <tr data-uid="${r.uid}">
        <td>${escapeHtml(r.name || r.uid)}</td>
        <td class="text-end fw-semibold">${fmt(r.score)}</td>
        <td class="text-center">
          <button class="btn btn-warning btn-sm" data-action="adj" data-type="deduct"
                  data-uid="${r.uid}" data-name="${escapeHtml(r.name||'')}" title="หักคะแนน">
            <i class="fa-solid fa-minus"></i>
          </button>
          <button class="btn btn-primary btn-sm" data-action="adj" data-type="add"
                  data-uid="${r.uid}" data-name="${escapeHtml(r.name||'')}" title="เพิ่มคะแนน">
            <i class="fa-solid fa-plus"></i>
          </button>
          <button class="btn btn-danger btn-sm" data-action="reset"
                  data-uid="${r.uid}" data-name="${escapeHtml(r.name||'')}" title="ล้างคะแนน">
            <i class="fa-solid fa-rotate-left"></i>
          </button>
          <button class="btn btn-info btn-sm" data-action="history"
                  data-uid="${r.uid}" data-name="${escapeHtml(r.name||'')}" title="ประวัติ">
            <i class="fa-regular fa-clock"></i>
          </button>
        </td>
      </tr>
    `).join("");
  }

  const pagerInfo = $("#adminPagerInfo"); if (pagerInfo) pagerInfo.textContent = `หน้า ${page}/${totalPages}`;
  const pager = $("#adminPager"); if (pager) pager.innerHTML = makePager(totalPages);
}

function makePager(totalPages){
  const mk = (label, p, disabled=false, active=false)=>`
    <li class="page-item ${disabled?'disabled':''} ${active?'active':''}">
      <a class="page-link" href="#" data-page="${p}">${label}</a>
    </li>`;
  let html = mk("&laquo;", 1, page===1);
  html += mk("&lsaquo;", page-1, page===1);
  const windowSize = 5;
  let start = Math.max(1, page - Math.floor(windowSize/2));
  let end   = Math.min(totalPages, start + windowSize - 1);
  if (end-start+1 < windowSize) start = Math.max(1, end - windowSize + 1);
  for (let p=start; p<=end; p++) html += mk(p, p, false, p===page);
  html += mk("&rsaquo;", page+1, page===totalPages);
  html += mk("&raquo;", totalPages, page===totalPages);
  return html;
}

// =================== EVENTS ====================
function bindEvents(){
  // sort header
  $$("#admin .sort, thead .sort").forEach(th=>{
    th.addEventListener("click", ()=>{
      const key = th.dataset.key;
      if (sortKey === key) sortDir = (sortDir === "asc" ? "desc" : "asc");
      else { sortKey = key; sortDir = key === "name" ? "asc" : "desc"; }
      $$("#admin thead .sort, thead .sort").forEach(h=>h.classList.remove("asc","desc"));
      th.classList.add(sortDir);
      applyFilterSortPaginate(true);
    });
  });

  const s = $("#adminSearch");     if (s)  s.addEventListener("input", debounce(()=>applyFilterSortPaginate(true), 200));
  const m = $("#adminMinScore");   if (m)  m.addEventListener("input", debounce(()=>applyFilterSortPaginate(true), 200));
  const ps = $("#adminPageSize");  if (ps) ps.addEventListener("change", ()=>applyFilterSortPaginate(true));
  const btnRefresh = $("#btnAdminRefresh"); if (btnRefresh) btnRefresh.addEventListener("click", ()=>loadList());

  const pager = $("#adminPager");
  if (pager) pager.addEventListener("click", (e)=>{
    const a = e.target.closest("a[data-page]"); if (!a) return;
    e.preventDefault();
    page = Number(a.dataset.page);
    renderTable();
  });

  // row quick actions
  const body = $("#adminTableBody");
  if (body) body.addEventListener('click', async (e)=>{
    const btn  = e.target.closest('[data-action]');
    if (!btn) return;
    const act  = btn.dataset.action;
    const uid  = btn.dataset.uid;
    const name = btn.dataset.name || '';

    if (act === 'adj') { openAdjustModal(uid, name); return; }
    if (act === 'reset') { confirmReset(uid, name); return; }
    if (act === 'history') { openHistory(uid, name); return; }
  });

  // modal buttons
  const bAdd = $("#btnAdjAdd");     if (bAdd) bAdd.addEventListener("click", ()=>submitAdjust(+1));
  const bDed = $("#btnAdjDeduct");  if (bDed) bDed.addEventListener("click", ()=>submitAdjust(-1));
  const bRes = $("#btnAdjReset");   if (bRes) bRes.addEventListener("click", ()=>submitReset());
}

// =================== ADJUST / RESET ====================
function openAdjustModal(uid, name){
  const ajUid = $("#ajUid"); if (ajUid) { ajUid.textContent = uid; ajUid.setAttribute('href', `#${encodeURIComponent(uid)}`); }
  const ajDelta = $("#ajDelta"); if (ajDelta) ajDelta.value = 50;
  const ajNote  = $("#ajNote");  if (ajNote)  ajNote.value  = "";
  const el = $("#adjustModal"); if (el) new bootstrap.Modal(el).show();
}

async function submitAdjust(sign){
  const uid  = $("#ajUid")?.textContent || "";
  const note = $("#ajNote")?.value || "";
  let amt = parseInt($("#ajDelta")?.value || "0", 10);
  if (isNaN(amt) || amt <= 0) return Swal.fire("กรอกจำนวนแต้ม", "จำนวนต้องมากกว่า 0", "warning");
  const delta = sign===1 ? amt : -amt;

  try{
    overlay.show("กำลังบันทึก...");
    const res = await fetch(API_ADJUST, {
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({ adminUid: MY_UID, targetUid: uid, delta, note })
    });
    const data = await res.json();
    overlay.hide();
    if (data.status !== "success") return Swal.fire("ไม่สำเร็จ", data.message || "ปรับคะแนนไม่สำเร็จ", "error");
    const row = rows.find(r=>r.uid===uid); if (row) row.score = Number(row.score||0) + delta;
    applyFilterSortPaginate(false);
    Swal.fire("สำเร็จ", `อัปเดตคะแนน (${delta>0?'+':''}${delta})`, "success");
    const inst = bootstrap.Modal.getInstance($("#adjustModal")); if (inst) inst.hide();
  }catch(e){
    overlay.hide();
    Swal.fire("ผิดพลาด", String(e), "error");
  }
}

function confirmReset(uid, name){
  Swal.fire({ icon:"warning", title:`ล้างคะแนนของ ${name||uid}?`,
    showCancelButton:true, confirmButtonText:"ล้างคะแนน", cancelButtonText:"ยกเลิก"
  }).then(r=>{ if (r.isConfirmed) submitReset(uid); });
}

async function submitReset(forceUid){
  const uid  = forceUid || ($("#ajUid")?.textContent || "");
  const note = $("#ajNote")?.value || "admin reset";
  try{
    overlay.show("กำลังล้างคะแนน...");
    const res = await fetch(API_RESET, {
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({ adminUid: MY_UID, targetUid: uid, note })
    });
    const data = await res.json();
    overlay.hide();
    if (data.status !== "success") return Swal.fire("ไม่สำเร็จ", data.message || "ล้างคะแนนไม่สำเร็จ", "error");
    const row = rows.find(r=>r.uid===uid); if (row) row.score = 0;
    applyFilterSortPaginate(false);
    Swal.fire("สำเร็จ", "ล้างคะแนนเรียบร้อย", "success");
    const inst = bootstrap.Modal.getInstance($("#adjustModal")); if (inst) inst.hide();
  }catch(e){
    overlay.hide();
    Swal.fire("ผิดพลาด", String(e), "error");
  }
}

// =================== HISTORY ====================
async function fetchHistory(uid){
  const url = `${API_HIST}?uid=${encodeURIComponent(uid)}`;
  const res = await fetch(url);
  const json = await res.json();
  if (json.status !== 'success') throw new Error(json.message || 'fetch error');
  return Array.isArray(json.data) ? json.data : [];
}

function renderHistory(items){
  const list = document.getElementById('historyList');
  const counter = document.getElementById('historyCount');
  if (!list) return;

  if (!items.length){
    list.innerHTML = `<div class="p-4 text-center text-muted">ไม่มีรายการ</div>`;
    if (counter) counter.textContent = '0 รายการ';
    return;
  }
  const rowsHtml = items.slice(0,100).map(it=>{
    const dt = new Date(it.ts);
    const time = isNaN(dt) ? String(it.ts||'') : dt.toLocaleString('th-TH',{hour12:false});
    const p = Number(it.point)||0;
    const sign = p>=0?'+':'−';
    const cls  = p>=0?'bg-success':'bg-warning';
    const abs  = Math.abs(p);
    const type = escapeHtml(it.type||'');
    const code = it.code ? ` • ${escapeHtml(it.code)}` : '';
    return `
      <div class="list-group-item d-flex justify-content-between align-items-center bg-transparent">
        <div>
          <div class="fw-semibold">${time}</div>
          <div class="small text-muted">${type}${code}</div>
        </div>
        <span class="badge ${cls} rounded-pill">${sign}${abs}</span>
      </div>`;
  }).join('');
  list.innerHTML = rowsHtml;
  if (counter) counter.textContent = `${items.length} รายการ`;
}

async function openHistory(uid, name){
  overlay.show('กำลังโหลดประวัติ...');
  try{
    const items = await fetchHistory(uid);
    const title = document.querySelector('#historyModal .modal-title');
    if (title) title.innerHTML = `<i class="fa-regular fa-clock me-2"></i>ประวัติพ้อยท์ — <span class="text-info">${escapeHtml(name||uid)}</span>`;
    renderHistory(items);
    const el = $("#historyModal"); if (el) new bootstrap.Modal(el).show();
  }catch(err){
    console.error(err);
    Swal.fire("ผิดพลาด","โหลดประวัติไม่สำเร็จ","error");
  }finally{
    overlay.hide();
  }
}

// =================== INIT (LIFF) ====================
async function init(){
  try{
    await liff.init({ liffId: LIFF_ID });
    if (!liff.isLoggedIn()) return liff.login();
    const profile = await liff.getProfile();
    MY_UID = profile.userId;

    if (MY_UID !== ADMIN_UID){
      Swal.fire("เฉพาะผู้ดูแลระบบ", "บัญชีของคุณไม่มีสิทธิ์เข้าถึงหน้านี้", "error");
      setTimeout(()=>location.href="/", 1200);
      return;
    }

    bindEvents();
    loadList();
  }catch(e){
    Swal.fire("ผิดพลาด", "ไม่สามารถเริ่มระบบได้", "error");
    console.error(e);
  }
}

// โมดัลประวัติ (สร้าง instance ครั้งเดียว)
document.addEventListener('DOMContentLoaded', ()=>{
  const el = document.getElementById('historyModal');
  if (el && !bootstrap.Modal.getInstance(el)) new bootstrap.Modal(el); // เผื่อถูกเรียกใช้ทันที
  // แสดง uid แอดมิน (ถ้าต้องการ)
  const elUid = document.getElementById('adminUid');
  if (elUid) elUid.innerText = ADMIN_UID || '—';
  init();
});
