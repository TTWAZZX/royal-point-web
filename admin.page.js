// ----- Global state (no ||= / optional chaining) -----
if (!window.state) window.state = {};
var state = window.state;

// ดึง UID แอดมินจาก: ?uid= / ?adminUid= → LIFF → localStorage → prompt
async function ensureAdminUid() {
  if (state.adminUid) return state.adminUid;

  try {
    var qs = new URLSearchParams(location.search);
    var uid = (qs.get('uid') || qs.get('adminUid') || '').trim();
    if (uid) {
      state.adminUid = uid;
      try { localStorage.setItem('rp_adminUid', uid); } catch(_){}
      return state.adminUid;
    }
  } catch(e) {}

  try {
    if (window.liff && typeof liff.getProfile === 'function') {
      if (!liff.isLoggedIn()) { try { await liff.login(); } catch(_){} }
      var pf = await liff.getProfile();
      if (pf && pf.userId) {
        state.adminUid = pf.userId;
        try { localStorage.setItem('rp_adminUid', state.adminUid); } catch(_){}
        return state.adminUid;
      }
    }
  } catch(e) { console.warn('LIFF profile error', e); }

  try {
    var stored = localStorage.getItem('rp_adminUid');
    if (stored) {
      state.adminUid = stored;
      return state.adminUid;
    }
  } catch(e){}

  var typed = prompt('ใส่ Admin UID เพื่อจัดการของรางวัล:', '');
  if (typed) {
    state.adminUid = typed.trim();
    try { localStorage.setItem('rp_adminUid', state.adminUid); } catch(_){}
    return state.adminUid;
  }
  return null;
}

/***********************
 * Admin Frontend (client-only)
 * - โหลดตารางคะแนน
 * - ค้นหา/กรอง/เรียง/แบ่งหน้า
 * - ปรับคะแนน +/–, ล้างคะแนน (quick actions)
 * - Export CSV
 ***********************/
/* ---------- วาง helper นี้ไว้ตอนต้นไฟล์ admin.page.js ---------- */
const overlay = {
  show(msg) {
    if (window.jQuery && window.jQuery.LoadingOverlay) {
      window.jQuery.LoadingOverlay("show", {
        image: "",
        fontawesome: "fa fa-spinner fa-spin",
        text: msg || "กำลังทำงาน..."
      });
    }
  },
  hide() {
    if (window.jQuery && window.jQuery.LoadingOverlay) {
      window.jQuery.LoadingOverlay("hide");
    }
  }
};

const ADMIN_UID = "Ucadb3c0f63ada96c0432a0aede267ff9";
const LIFF_ID   = "2007053300-QoEvbXyn";

// API endpoints (Vercel)
const API_LIST    = "/api/all-scores";     // ← ใช้อันนี้
const API_ADJUST  = "/api/admin-adjust";   // POST { adminUid, targetUid, delta, note }
const API_RESET   = "/api/admin-reset";    // POST { adminUid, targetUid, note }

const API_REWARDS_LIST   = "/api/rewards";
const API_REWARDS_UPSERT = "/api/rewards-upsert";
const API_REWARDS_DELETE = "/api/rewards-delete";

async function loadRewardsAdmin(){
  var tbody = document.querySelector("#tblRewards tbody");
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">กำลังโหลด…</td></tr>';

  try{
    var uid = state.adminUid || '';
    var r = await fetch(API_REWARDS_LIST + '?uid=' + encodeURIComponent(uid), { cache:'no-store' });
    var j = await r.json();
    var list = j.data || [];

    if (!list.length){
      tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">ไม่มีรายการ</td></tr>';
      return;
    }

    tbody.innerHTML = list.map(function(x){
      return (
        '<tr data-id="'+ escapeHtml(x.id||'') +'">' +
          '<td class="small">'+ escapeHtml(x.id||'') +'</td>' +
          '<td><input class="form-control form-control-sm in-name" value="'+ escapeHtml(x.name||'') +'"></td>' +
          '<td><input class="form-control form-control-sm in-img"  value="'+ escapeHtml(x.img||'')  +'"></td>' +
          '<td style="max-width:90px"><input type="number" min="0" class="form-control form-control-sm in-cost" value="'+ Number(x.cost||0) +'"></td>' +
          '<td class="text-center"><input type="checkbox" class="form-check-input in-active" '+ (String(x.active)!=='0'?'checked':'') +'></td>' +
          '<td class="text-center">' +
            '<button class="btn btn-primary btn-sm act-save"><i class="fa-regular fa-floppy-disk"></i></button> '+
            '<button class="btn btn-danger btn-sm act-del"><i class="fa-regular fa-trash-can"></i></button>'+
          '</td>' +
        '</tr>'
      );
    }).join('');

    // delegation สำหรับปุ่มบันทึก/ลบ
    tbody.onclick = async function(ev){
      var tr = ev.target.closest('tr[data-id]');
      if (!tr) return;
      var id = tr.getAttribute('data-id');

      if (ev.target.closest('.act-save')){
        var body = {
          adminUid: state.adminUid,
          id: id,
          name: tr.querySelector('.in-name').value.trim(),
          img:  tr.querySelector('.in-img').value.trim(),
          cost: Number(tr.querySelector('.in-cost').value||0),
          active: tr.querySelector('.in-active').checked ? 1 : 0
        };
        var rr = await fetch(API_REWARDS_UPSERT, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
        var jj = await rr.json();
        alert(jj.status==='success' ? 'บันทึกแล้ว' : ('บันทึกไม่สำเร็จ: '+(jj.message||'')));
        await loadRewardsAdmin();
      }

      if (ev.target.closest('.act-del')){
        if (!confirm('ลบ (ปิดการใช้งาน) รายการนี้?')) return;
        var rd = await fetch(API_REWARDS_DELETE, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ adminUid: state.adminUid, id: id }) });
        var jd = await rd.json();
        alert(jd.status==='success' ? 'ลบแล้ว' : ('ไม่สำเร็จ: '+(jd.message||'')));
        await loadRewardsAdmin();
      }
    };
  }catch(e){
    console.error(e);
    tbody.innerHTML = '<tr><td colspan="6" class="text-center text-danger">โหลดไม่สำเร็จ</td></tr>';
  }
}

function escapeHtml(s){
  s = String(s||'');
  return s.replace(/[&<>"']/g, function(m){return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]);});
}


function bindAddRewardButton(){
  const btn = document.getElementById("btnAddReward");
  if(!btn){ console.warn("btnAddReward not found"); return; }

  btn.addEventListener("click", async (e)=>{
    e.preventDefault();
    e.stopPropagation();

    // กันเผื่อ state ยังไม่พร้อม
    if (!state || !state.adminUid){
      alert("ยังไม่ได้ยืนยันสิทธิ์แอดมิน");
      return;
    }

    const name = prompt("ชื่อรางวัล:");
    if(!name) return;
    const img  = prompt("รูป (URL):","https://");
    const cost = Number(prompt("แต้มที่ใช้:","100") || 0);

    try{
      const r = await fetch("/api/rewards-upsert", {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({ adminUid: state.adminUid, name, img, cost, active: 1 })
      });
      const j = await r.json();
      if(j.status === "success"){
        alert("เพิ่มแล้ว");
        await loadRewardsAdmin();
      }else{
        alert("ไม่สำเร็จ: " + (j.message || ""));
      }
    }catch(err){
      console.error(err);
      alert("ไม่สามารถเพิ่มรายการได้");
    }
  });
}

async function initAdmin(){
  // ... login + ตรวจ isAdmin ...
  state.adminUid = profile.userId;      // ใส่ UID แอดมินที่ล็อกอิน
  bindAddRewardButton();                // <- bind ปุ่มเพิ่ม
  await loadRewardsAdmin();             // <- โหลดตารางรางวัล
}
document.addEventListener("DOMContentLoaded", initAdmin);


document.getElementById("btnAddReward")?.addEventListener("click", async ()=>{
  const name = prompt("ชื่อรางวัล:");
  if(!name) return;
  const img  = prompt("รูป (URL):","https://");
  const cost = Number(prompt("แต้มที่ใช้:", "100")||0);
  const body = { adminUid: state.adminUid, name, img, cost, active:1 };
  const r = await fetch(API_REWARDS_UPSERT, { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(body) });
  const j = await r.json();
  alert(j.status==="success" ? "เพิ่มแล้ว" : ("ไม่สำเร็จ: "+(j.message||"")));
  loadRewardsAdmin();
});

// เรียก loadRewardsAdmin() หลังจากที่ admin auth ผ่านแล้ว (จุดที่คุณโหลด all-scores เสร็จ)


// State
let MY_UID = null;
let rows = [];           // raw data [{uid,name,score}]
let view = [];           // after filter + sort
let sortKey = "score";   // 'score' | 'name' | 'uid' | 'rank'
let sortDir = "desc";    // 'asc' | 'desc'
let page = 1;
let pageSize = 20;

// Utils
const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
const fmt = (n) => Number(n||0).toLocaleString();

// Debounce
function debounce(fn, ms=300){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms);}}

// Render skeleton
function renderSkeleton() {
  $("#adminTableBody").innerHTML = `
    <tr><td colspan="3">
      <div class="skeleton skeleton-row"></div>
      <div class="skeleton skeleton-row"></div>
      <div class="skeleton skeleton-row"></div>
    </td></tr>
  `;
  $("#adminInfo").textContent = "กำลังโหลด...";
  $("#adminRange").textContent = "";
  $("#adminPager").innerHTML = "";
  $("#adminPagerInfo").textContent = "";
}

// Fetch list
async function loadList() {
  renderSkeleton();
  try {
    const url = `${API_LIST}?adminUid=${encodeURIComponent(MY_UID)}`; // ← เปลี่ยนเป็น adminUid
    const res = await fetch(url, { cache: "no-store" });
    const data = await res.json();
    if (data.status !== "success" || !Array.isArray(data.data)) {
      throw new Error(data.message || "โหลดข้อมูลไม่สำเร็จ");
    }
    rows = data.data.map((r,i)=>({ rank:i+1, uid:r.uid, name:r.name, score:Number(r.score||0) }));
    $("#adminInfo").textContent = `ทั้งหมด ${fmt(rows.length)} รายการ`;
    applyFilterSortPaginate(true);
  } catch (e) {
    $("#adminTableBody").innerHTML = `<tr><td colspan="3" class="text-danger">โหลดข้อมูลไม่สำเร็จ: ${e.message||e}</td></tr>`;
    $("#adminInfo").textContent = "เกิดข้อผิดพลาด";
  }
}

// Filter + sort + paginate
function applyFilterSortPaginate(resetPage=false) {
  const q = ($("#adminSearch").value || "").trim().toLowerCase();
  const minScore = Number($("#adminMinScore").value || 0);
  pageSize = Number($("#adminPageSize").value || 20);

  // filter
  view = rows.filter(r => {
    const hitQ = !q || r.name?.toLowerCase().includes(q) || r.uid?.toLowerCase().includes(q);
    const hitMin = r.score >= minScore;
    return hitQ && hitMin;
  });

  // sort
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

// Render table & pager
function renderTable() {
  const total = view.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (page > totalPages) page = totalPages;

  const start = (page-1)*pageSize;
  const end   = Math.min(start + pageSize, total);
  const slice = view.slice(start, end);

  $("#adminRange").textContent = total ? `แสดง ${fmt(start+1)}–${fmt(end)} จาก ${fmt(total)}` : "";

  if (!slice.length) {
    $("#adminTableBody").innerHTML = `<tr><td colspan="3" class="text-center text-muted">ไม่พบข้อมูล</td></tr>`;
  } else {
    $("#adminTableBody").innerHTML = slice.map(r => `
      <tr data-uid="${r.uid}">
        <td>${escapeHtml(r.name || r.uid)}</td>
        <td class="text-end fw-semibold">${fmt(r.score)}</td>
        <td class="text-center">
          <button class="btn btn-warning btn-sm" data-action="adj" data-type="deduct"
                  data-uid="${r.uid}" data-name="${escapeAttr(r.name)}" title="หักคะแนน">
            <i class="fa-solid fa-minus"></i>
          </button>
          <button class="btn btn-primary btn-sm" data-action="adj" data-type="add"
                  data-uid="${r.uid}" data-name="${escapeAttr(r.name)}" title="เพิ่มคะแนน">
            <i class="fa-solid fa-plus"></i>
          </button>
          <button class="btn btn-danger btn-sm" data-action="reset"
                  data-uid="${r.uid}" data-name="${escapeAttr(r.name)}" title="ล้างคะแนน">
            <i class="fa-solid fa-rotate-left"></i>
          </button>
          <button class="btn btn-info btn-sm" data-action="history"
                  data-uid="${r.uid}" data-name="${escapeAttr(r.name)}" title="ประวัติ">
            <i class="fa-regular fa-clock"></i>
          </button>
        </td>
      </tr>
    `).join("");
  }

  $("#adminPagerInfo").textContent = `หน้า ${page}/${totalPages}`;
  $("#adminPager").innerHTML = makePager(totalPages);
}

// Pager HTML
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

// Events
function bindEvents() {
  // sort header
  $$("#admin .sort, thead .sort").forEach(th=>{
    th.addEventListener("click", ()=>{
      const key = th.dataset.key;
      if (sortKey === key) sortDir = (sortDir === "asc" ? "desc" : "asc");
      else { sortKey = key; sortDir = key === "name" ? "asc" : "desc"; }
      // update header state
      $$("thead .sort").forEach(h=>h.classList.remove("asc","desc"));
      th.classList.add(sortDir);
      applyFilterSortPaginate(true);
    });
  });

  // filters
  $("#adminSearch").addEventListener("input", debounce(()=>applyFilterSortPaginate(true), 200));
  $("#adminMinScore").addEventListener("input", debounce(()=>applyFilterSortPaginate(true), 200));
  $("#adminPageSize").addEventListener("change", ()=>applyFilterSortPaginate(true));

  // refresh
  $("#btnAdminRefresh").addEventListener("click", ()=>loadList());

  // pager click
  $("#adminPager").addEventListener("click", (e)=>{
    const a = e.target.closest("a[data-page]"); if (!a) return;
    e.preventDefault();
    page = Number(a.dataset.page);
    renderTable();
  });

  // row quick actions
  $("#adminTableBody").addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;

  const action = btn.dataset.action;
  const uid    = btn.dataset.uid;
  const name   = btn.dataset.name || '';

  if (action === 'adj') {
    // เปิดโมดัลปรับคะแนน
    openAdjustModal(uid, name);
    return;
  }

  if (action === 'reset') {
    // ยืนยันล้างคะแนน
    confirmReset(uid, name);
    return;
  }

  if (action === 'history') {
    // โหลดประวัติ + เปิดโมดัล
    overlay.show('กำลังโหลดประวัติ...');
    try {
      const items = await fetchHistory(uid);
      document.querySelector('#historyModal .modal-title').innerHTML =
        `<i class="fa-regular fa-clock me-2"></i>ประวัติพ้อยท์ — <span class="text-info">${escapeHtml(name)}</span>`;
      renderHistory(items);
      historyModal.show();
    } catch (err) {
      console.error(err);
      if (window.Toast?.show) Toast.show('โหลดประวัติไม่สำเร็จ');
      else Swal.fire("ผิดพลาด","โหลดประวัติไม่สำเร็จ","error");
    } finally {
      overlay.hide();
    }
    return;
  }
});

  // modal buttons
  $("#btnAdjAdd").addEventListener("click", () => submitAdjust(+1));
  $("#btnAdjDeduct").addEventListener("click", () => submitAdjust(-1));
  $("#btnAdjReset").addEventListener("click", ()=>submitReset());

  // Export CSV
  $("#btnAdminExport").addEventListener("click", (e)=>{
    e.preventDefault();
    window.location.href = `${API_LIST}?uid=${encodeURIComponent(MY_UID)}&format=csv`;
  });
}

// Adjust modal
function openAdjustModal(uid, name) {
  $("#ajUid").textContent = uid;
  $("#ajUid").setAttribute('href', `https://line.me/R/ti/p/~${encodeURIComponent(uid)}`); // หรือจะไม่ลิงก์ก็ได้
  $("#ajDelta").value = 50;
  $("#ajNote").value  = "";
  const modal = new bootstrap.Modal($("#adjustModal"));
  modal.show();
}

async function submitAdjust(sign) {
  const uid  = $("#ajUid").textContent;
  const note = $("#ajNote").value || "";
  let amt = parseInt($("#ajDelta").value, 10);
  if (isNaN(amt) || amt <= 0) return Swal.fire("กรอกจำนวนแต้ม", "จำนวนต้องมากกว่า 0", "warning");
  const delta = sign === 1 ? amt : -amt;

  try {
    overlay.show();
    const res  = await fetch(API_ADJUST, {
      method: "POST", headers: { "Content-Type":"application/json" },
      body: JSON.stringify({ adminUid: MY_UID, targetUid: uid, delta, note })
    });
    const data = await res.json();
    overlay.hide();
    if (data.status !== "success") return Swal.fire("ไม่สำเร็จ", data.message || "ปรับคะแนนไม่สำเร็จ", "error");

    const row = rows.find(r => r.uid === uid);
    if (row) row.score = Number(row.score||0) + delta;
    applyFilterSortPaginate(false);
    Swal.fire("สำเร็จ", `อัปเดตคะแนน (${delta>0?'+':''}${delta})`, "success");
    bootstrap.Modal.getInstance($("#adjustModal"))?.hide();
  } catch (e) {
    overlay.hide();
    Swal.fire("ผิดพลาด", String(e), "error");
  }
}

function confirmReset(uid, name){
  Swal.fire({ icon:"warning", title:`ล้างคะแนนของ ${name||uid}?`,
    showCancelButton:true, confirmButtonText:"ล้างคะแนน", cancelButtonText:"ยกเลิก"
  }).then(r=>{ if (r.isConfirmed) submitReset(uid); });
}

async function submitReset(forceUid) {
  const uid  = forceUid || $("#ajUid").textContent;
  const note = $("#ajNote").value || "admin reset";
  try {
    overlay.show();
    const res  = await fetch(API_RESET, {
      method:"POST", headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({ adminUid: MY_UID, targetUid: uid, note })
    });
    const data = await res.json();
    overlay.hide();
    if (data.status !== "success") return Swal.fire("ไม่สำเร็จ", data.message || "ล้างคะแนนไม่สำเร็จ", "error");

    const row = rows.find(r => r.uid === uid);
    if (row) row.score = 0;
    applyFilterSortPaginate(false);
    Swal.fire("สำเร็จ", "ล้างคะแนนเรียบร้อย", "success");
    bootstrap.Modal.getInstance($("#adjustModal"))?.hide();
  } catch (e) {
    overlay.hide();
    Swal.fire("ผิดพลาด", String(e), "error");
  }
}

// ---- History: fetch + render ----
async function fetchHistory(uid) {
  const url = `/api/score-history?uid=${encodeURIComponent(uid)}`;
  const res = await fetch(url);
  const json = await res.json();
  if (json.status !== 'success') throw new Error(json.message || 'Fetch history error');
  return Array.isArray(json.data) ? json.data : [];
}

function formatDateTime(ts) {
  const d = new Date(ts);
  if (isNaN(d)) return String(ts || '');
  return d.toLocaleString('th-TH', { hour12: false });
}

function renderHistory(items) {
  const list = document.getElementById('historyList');
  const counter = document.getElementById('historyCount');

  if (!items.length) {
    list.innerHTML = `<div class="p-4 text-center text-muted">ไม่มีรายการ</div>`;
    counter.textContent = '0 รายการ';
    return;
  }

  // แสดงล่าสุดก่อน (Server.gs คืนล่าสุดมาก่อนอยู่แล้ว; เผื่อไว้)
  const rows = items.slice(0, 100).map(it => {
    const dt = formatDateTime(it.ts);
    const p = Number(it.point) || 0;
    const sign = p >= 0 ? '+' : '−';
    const cls  = p >= 0 ? 'bg-success' : 'bg-warning';
    const abs  = Math.abs(p);

    const type = escapeHtml(it.type || '');
    const code = it.code ? ` • ${escapeHtml(it.code)}` : '';

    return `
      <div class="list-group-item d-flex justify-content-between align-items-center bg-transparent text-light">
        <div>
          <div class="fw-semibold">${dt}</div>
          <div class="small text-muted">${type}${code}</div>
        </div>
        <span class="badge ${cls} rounded-pill">${sign}${abs}</span>
      </div>
    `;
  }).join('');

  list.innerHTML = rows;
  counter.textContent = `${items.length} รายการ`;
}

// Escape helpers
function escapeHtml(s){ return String(s??"").replace(/[&<>"']/g, m=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" }[m]));}
function escapeAttr(s){ return escapeHtml(s).replace(/"/g,"&quot;"); }

// LIFF guard (optional UI gate; สิทธิ์จริงตรวจฝั่ง API อยู่แล้ว)
async function init() {
  try {
    await liff.init({ liffId: LIFF_ID });
    if (!liff.isLoggedIn()) return liff.login();
    const profile = await liff.getProfile();
    MY_UID = profile.userId;

    if (MY_UID !== ADMIN_UID) {
      // ป้องกันคนหลงมา
      Swal.fire("เฉพาะผู้ดูแลระบบ", "บัญชีของคุณไม่มีสิทธิ์เข้าถึงหน้านี้", "error");
      setTimeout(()=>location.href="/", 1200);
      return;
    }
    bindEvents();
    loadList();
  } catch (e) {
    Swal.fire("ผิดพลาด", "ไม่สามารถเริ่มระบบ LIFF ได้", "error");
    console.error(e);
  }
}

// ---------- History Modal: วิธี A (DOMContentLoaded) ----------
document.addEventListener('DOMContentLoaded', () => {
  // 1) สร้างอินสแตนซ์โมดัล (ทำครั้งเดียวเมื่อ DOM พร้อม)
  const historyModalEl = document.getElementById('historyModal');
  const historyModal   = new bootstrap.Modal(historyModalEl);
  // ถ้าต้องการเรียกจากฟังก์ชันอื่น ๆ
  window.historyModal = historyModal;

  // 2) ตัวช่วยเล็กน้อย
  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[m]));
  }

  // 3) ดึงประวัติจาก API (ปรับ endpoint ได้หากคุณตั้งค่าแตกต่าง)
  async function fetchHistory(uid) {
    const url = `/api/score-history?uid=${encodeURIComponent(uid)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('network error');
    const json = await res.json();
    if (json.status !== 'success') throw new Error(json.message || 'fetch error');
    return json.data || [];
  }

  // 4) วาดข้อมูลประวัติลงในตารางของโมดัล
  function renderHistory(items) {
    const body = document.getElementById('historyTableBody');
    if (!body) return;

    if (!items.length) {
      body.innerHTML = `<tr><td colspan="4" class="text-center text-muted py-4">ไม่มีประวัติ</td></tr>`;
      return;
    }

    body.innerHTML = items.map(it => {
      const ts   = it.ts ? new Date(it.ts) : null;
      const time = ts ? ts.toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }) : '-';
      const p    = Number(it.point) || 0;
      const badgeClass = p >= 0 ? 'bg-success' : 'bg-danger';
      const signed = p > 0 ? `+${p}` : `${p}`;

      return `
        <tr>
          <td class="text-muted">${escapeHtml(time)}</td>
          <td><span class="badge ${badgeClass}">${signed}</span></td>
          <td>${escapeHtml(it.type || '-')}</td>
          <td class="text-nowrap">${escapeHtml(it.code || '-')}</td>
        </tr>`;
    }).join('');
  }

  // 5) ผูก event ให้ตารางหลัก (ปุ่ม data-action="history")
  //    ถ้าคุณใช้ id อื่นแทน adminTableBody ให้แก้ตรงนี้
  const tableBody = document.getElementById('adminTableBody');
  if (tableBody) {
    tableBody.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-action="history"]');
      if (!btn) return;

      const uid  = btn.dataset.uid || '';
      const name = btn.dataset.name || '';

      try {
        // ถ้าคุณมี overlay ของตัวเองจะไม่ error (ถ้าไม่มีไม่เป็นไร)
        if (window.overlay?.show) overlay.show('กำลังโหลดประวัติ…');

        const items = await fetchHistory(uid);

        // ตั้งหัวข้อให้โชว์ชื่อผู้ใช้
        const title = historyModalEl.querySelector('.modal-title');
        if (title) {
          title.innerHTML =
            `<i class="fa-regular fa-clock me-2"></i>ประวัติพ้อยท์ — <span class="text-info">${escapeHtml(name)}</span>`;
        }

        renderHistory(items);
        historyModal.show();
      } catch (err) {
        console.error(err);
        if (window.Toast?.show) Toast.show('โหลดประวัติไม่สำเร็จ');
        else alert('โหลดประวัติไม่สำเร็จ');
      } finally {
        if (window.overlay?.hide) overlay.hide();
      }
    });
  }
});

function getAdminUid() {
  const q = new URLSearchParams(location.search);
  const uid = (q.get('uid') || localStorage.getItem('ADMIN_UID') || '').trim();
  if (uid) localStorage.setItem('ADMIN_UID', uid);
  return uid;
}
// แสดง UID ถ้ามี (ไม่บังคับ)
document.getElementById('adminUid')?.innerText = getAdminUid() || '—';


async function loadAllScores() {
  if (!ADMIN_UID) {
    renderUsersTable([]);
    return;
  }
  const url = `/api/all-scores?adminUid=${encodeURIComponent(ADMIN_UID)}`;
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));

  if (data.status === 'success' && Array.isArray(data.data)) {
    renderUsersTable(data.data);
  } else {
    renderUsersTable([]);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const historyModalEl = document.getElementById('historyModal');
  window.historyModal  = new bootstrap.Modal(historyModalEl);
});

/* -----------------------------
 * RP_ Admin Patch (safe add-on)
 * ----------------------------- */

const RP_A$  = (sel, root=document) => root.querySelector(sel);
const RP_A$$ = (sel, root=document) => [...root.querySelectorAll(sel)];

const RP_A_overlay = {
  show(msg='กำลังโหลด...') {
    if (RP_A$('#rp-admin-ovl')) return;
    const el = document.createElement('div');
    el.id = 'rp-admin-ovl';
    el.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:4000;color:#fff';
    el.innerHTML = `<div class="bg-dark rounded-3 px-3 py-2"><i class="fa fa-spinner fa-spin me-2"></i>${msg}</div>`;
    document.body.appendChild(el);
  },
  hide(){ RP_A$('#rp-admin-ovl')?.remove(); }
};

const RP_adminState = {
  uid: '',
  rows: [],
  q: '',
  page: 1,
  pageSize: 20,
};

function RP_adminGetUid() {
  // ใช้ uid จาก localStorage หรือ query ?uid=
  const qUid = new URLSearchParams(location.search).get('uid');
  return (qUid || localStorage.getItem('rp_uid') || '').trim();
}

function RP_adminRenderTable() {
  const body = RP_A$('#tblBody');
  if (!body) return;

  const q = RP_adminState.q.toLowerCase();
  const filtered = RP_adminState.rows.filter(r =>
    (r.name || '').toLowerCase().includes(q) || String(r.uid).includes(q)
  );

  const start = (RP_adminState.page - 1) * RP_adminState.pageSize;
  const pageRows = filtered.slice(start, start + RP_adminState.pageSize);

  body.innerHTML = pageRows.map(r => `
    <tr>
      <td class="text-truncate" style="max-width:220px">${r.name || '-'}</td>
      <td class="fw-bold">${r.score}</td>
      <td class="text-nowrap">
        <button class="btn btn-sm btn-warning me-1" data-rp-act="adj" data-uid="${r.uid}" data-delta="-10"><i class="fa-solid fa-minus"></i></button>
        <button class="btn btn-sm btn-primary me-1" data-rp-act="adj" data-uid="${r.uid}" data-delta="10"><i class="fa-solid fa-plus"></i></button>
        <button class="btn btn-sm btn-danger" data-rp-act="reset" data-uid="${r.uid}"><i class="fa-solid fa-rotate-left"></i></button>
        <button class="btn btn-sm btn-secondary ms-1" data-rp-act="hist" data-uid="${r.uid}"><i class="fa-solid fa-clock-rotate-left"></i></button>
      </td>
    </tr>
  `).join('');

  RP_A$('#totalRows')?.replaceChildren(document.createTextNode(filtered.length));
}

async function RP_adminFetchAll() {
  RP_A_overlay.show('กำลังโหลดข้อมูล...');
  try {
    const res = await fetch(`/api/all-scores?uid=${encodeURIComponent(RP_adminState.uid)}`);
    const json = await res.json();
    RP_A_overlay.hide();

    if (json.status !== 'success') throw new Error(json.message || 'โหลดข้อมูลไม่สำเร็จ');
    RP_adminState.rows = json.data || [];
    RP_adminRenderTable();
  } catch (e) {
    RP_A_overlay.hide();
    RP_A$('#errorText')?.replaceChildren(document.createTextNode('โหลดข้อมูลไม่สำเร็จ: Apps Script error'));
    console.error(e);
  }
}

async function RP_adminAdjust(targetUid, delta, note='') {
  RP_A_overlay.show('กำลังบันทึก...');
  try {
    const res = await fetch('/api/admin-adjust', {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({ adminUid: RP_adminState.uid, targetUid, delta, note })
    });
    const json = await res.json();
    RP_A_overlay.hide();

    if (json.status !== 'success') throw new Error(json.message || 'บันทึกไม่สำเร็จ');
    await RP_adminFetchAll();
    Swal.fire('สำเร็จ', 'ปรับคะแนนแล้ว', 'success');
  } catch (e) {
    RP_A_overlay.hide();
    Swal.fire('ผิดพลาด', e.message || 'บันทึกไม่สำเร็จ', 'error');
  }
}

async function RP_adminReset(targetUid) {
  const ok = await Swal.fire({ icon:'warning', title:'ยืนยันล้างคะแนน?', showCancelButton:true, confirmButtonText:'ยืนยัน', cancelButtonText:'ยกเลิก' });
  if (!ok.isConfirmed) return;

  RP_A_overlay.show('กำลังล้างคะแนน...');
  try {
    const res = await fetch('/api/admin-reset', {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({ adminUid: RP_adminState.uid, targetUid, note: 'RESET_BY_ADMIN' })
    });
    const json = await res.json();
    RP_A_overlay.hide();

    if (json.status !== 'success') throw new Error(json.message || 'ล้างคะแนนไม่สำเร็จ');
    await RP_adminFetchAll();
    Swal.fire('สำเร็จ', 'ล้างคะแนนเรียบร้อย', 'success');
  } catch (e) {
    RP_A_overlay.hide();
    Swal.fire('ผิดพลาด', e.message || 'ล้างคะแนนไม่สำเร็จ', 'error');
  }
}

async function RP_adminHistory(uid) {
  RP_A_overlay.show('กำลังโหลดประวัติ...');
  try {
    const res = await fetch(`/api/score-history?uid=${encodeURIComponent(uid)}`);
    const json = await res.json();
    RP_A_overlay.hide();

    if (json.status !== 'success') throw new Error(json.message || 'โหลดประวัติไม่สำเร็จ');

    const list = RP_A$('#adminHistoryList');
    if (!list) return;
    list.innerHTML = '';

    if (!json.data.length) {
      list.innerHTML = `<li class="list-group-item text-center text-secondary">ยังไม่มีรายการ</li>`;
    } else {
      json.data.forEach(h => {
        const li = document.createElement('li');
        li.className = 'list-group-item d-flex justify-content-between';
        li.innerHTML = `
          <div>
            <div class="small text-secondary">${new Date(h.ts).toLocaleString()}</div>
            <div class="fw-semibold">${h.type}</div>
            <div class="small">${h.code || '-'}</div>
          </div>
          <div class="${h.point>=0?'text-success':'text-danger'} fw-bold">${h.point>=0?'+':''}${h.point}</div>
        `;
        list.appendChild(li);
      });
    }

    bootstrap.Modal.getOrCreateInstance(RP_A$('#adminHistoryModal')).show();
  } catch (e) {
    RP_A_overlay.hide();
    Swal.fire('ผิดพลาด', e.message || 'โหลดประวัติไม่สำเร็จ', 'error');
  }
}

function RP_adminBind() {
  // ค้นหา
  RP_A$('#searchBox')?.addEventListener('input', (e) => {
    RP_adminState.q = e.target.value || '';
    RP_adminState.page = 1;
    RP_adminRenderTable();
  });
  // รีเฟรช
  RP_A$('#btnRefresh')?.addEventListener('click', RP_adminFetchAll);

  // ปุ่ม table
  RP_A$('#tblBody')?.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-rp-act]');
    if (!b) return;
    const uid = b.dataset.uid;

    if (b.dataset.rpAct === 'adj') {
      const delta = parseInt(b.dataset.delta, 10) || 0;
      RP_adminOpenAdjust(uid, delta);
    }
    if (b.dataset.rpAct === 'reset') RP_adminReset(uid);
    if (b.dataset.rpAct === 'hist')  RP_adminHistory(uid);
  });

  // ฟอร์มปรับคะแนนในโมดัล
  RP_A$('#btnAdjAdd')?.addEventListener('click', () => {
    const uid   = RP_A$('#adjUid')?.value?.trim();
    const delta = Math.abs(parseInt(RP_A$('#adjDelta')?.value || '0', 10));
    const note  = RP_A$('#adjNote')?.value || '';
    if (!uid || !delta) return;
    RP_adminAdjust(uid, delta, note);
    bootstrap.Modal.getInstance(RP_A$('#adjustModal'))?.hide();
  });
  RP_A$('#btnAdjDeduct')?.addEventListener('click', () => {
    const uid   = RP_A$('#adjUid')?.value?.trim();
    const delta = Math.abs(parseInt(RP_A$('#adjDelta')?.value || '0', 10));
    const note  = RP_A$('#adjNote')?.value || '';
    if (!uid || !delta) return;
    RP_adminAdjust(uid, -delta, note);
    bootstrap.Modal.getInstance(RP_A$('#adjustModal'))?.hide();
  });
  RP_A$('#btnAdjReset')?.addEventListener('click', () => {
    const uid = RP_A$('#adjUid')?.value?.trim();
    if (!uid) return;
    RP_adminReset(uid);
    bootstrap.Modal.getInstance(RP_A$('#adjustModal'))?.hide();
  });
}

function RP_adminOpenAdjust(uid, seed=0) {
  if (RP_A$('#adjUid'))   RP_A$('#adjUid').value = uid || '';
  if (RP_A$('#adjDelta')) RP_A$('#adjDelta').value = seed || 0;
  if (RP_A$('#adjNote'))  RP_A$('#adjNote').value = '';
  bootstrap.Modal.getOrCreateInstance(RP_A$('#adjustModal')).show();
}

function RP_adminSafeInit() {
  RP_adminState.uid = RP_adminGetUid();
  RP_adminBind();
  RP_adminFetchAll();
}

document.addEventListener('DOMContentLoaded', RP_adminSafeInit);

(function bindAddRewardButton(){
  if (window.__bindAddRewardButton) return;
  window.__bindAddRewardButton = true;

  document.addEventListener('click', async function(ev){
    var btn = ev.target.closest('#btnAddReward,[data-action="add-reward"]');
    if (!btn) return;

    ev.preventDefault(); ev.stopPropagation();

    if (!state.adminUid) {
      alert('ยังไม่ได้ยืนยันสิทธิ์แอดมิน (adminUid ว่าง)');
      return;
    }

    var name = prompt('ชื่อรางวัล:'); if (!name) return;
    var img  = prompt('รูป (URL):','https://');
    var cost = Number(prompt('แต้มที่ใช้:','100')||0);

    try{
      var r = await fetch('/api/rewards-upsert', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ adminUid: state.adminUid, name:name, img:img, cost:cost, active:1 })
      });
      var j = await r.json();
      if (j.status==='success'){
        alert('เพิ่มแล้ว');
        await loadRewardsAdmin();
      } else {
        alert('ไม่สำเร็จ: '+(j.message||''));
      }
    }catch(err){
      console.error(err);
      alert('ไม่สามารถเพิ่มรายการได้');
    }
  });
})();

document.addEventListener('DOMContentLoaded', async function(){
  await ensureAdminUid();                 // ตั้ง adminUid ให้ได้ก่อน
  if (!state.adminUid) {
    alert('ยังไม่ได้ยืนยันสิทธิ์แอดมิน (adminUid ว่าง)');
    return;
  }
  await loadRewardsAdmin();               // แล้วค่อยโหลดตาราง
});
