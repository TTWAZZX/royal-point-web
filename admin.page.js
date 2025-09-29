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
    if (window.jQuery && $.LoadingOverlay) {
      $.LoadingOverlay("show", {
        image: "",
        fontawesome: "fa fa-spinner fa-spin",
        text: msg || "กำลังทำงาน..."
      });
    }
  },
  hide() {
    if (window.jQuery && $.LoadingOverlay) {
      $.LoadingOverlay("hide");
    }
  }
};

const ADMIN_UID = "Ucadb3c0f63ada96c0432a0aede267ff9";
const LIFF_ID   = "2007053300-QoEvbXyn";

// API endpoints (Vercel)
const API_LIST    = "/api/admin";          // GET ?uid=... [&format=csv]
const API_ADJUST  = "/api/admin-adjust";   // POST { adminUid, targetUid, delta, note }
const API_RESET   = "/api/admin-reset";    // POST { adminUid, targetUid, note }

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
    <tr><td colspan="5">
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
    const url = `${API_LIST}?uid=${encodeURIComponent(MY_UID)}`;
    const res = await fetch(url, { cache: "no-store" });
    const data = await res.json();
    if (data.status !== "success" || !Array.isArray(data.data)) {
      throw new Error(data.message || "โหลดข้อมูลไม่สำเร็จ");
    }
    rows = data.data.map((r,i)=>({ rank:i+1, uid:r.uid, name:r.name, score:Number(r.score||0) }));
    $("#adminInfo").textContent = `ทั้งหมด ${fmt(rows.length)} รายการ`;
    applyFilterSortPaginate(true);
  } catch (e) {
    $("#adminTableBody").innerHTML = `<tr><td colspan="5" class="text-danger">โหลดข้อมูลไม่สำเร็จ: ${e.message||e}</td></tr>`;
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
    $("#adminTableBody").innerHTML = `<tr><td colspan="5" class="text-center text-muted">ไม่พบข้อมูล</td></tr>`;
  } else {
    $("#adminTableBody").innerHTML = slice.map(r => `
      <tr data-uid="${r.uid}">
        <td>${r.rank}</td>
        <td>${escapeHtml(r.name||"")}</td>
        <td><code class="uid-code">${r.uid}</code></td>
        <td class="text-end"><span class="badge bg-primary badge-score">${fmt(r.score)}</span></td>
        <td class="quick-btns">
          <button class="btn btn-warning btn-sm" data-action="adj" data-type="deduct" data-uid="${r.uid}" data-name="${escapeAttr(r.name)}" title="หักคะแนน"><i class="fa-solid fa-minus"></i></button>
          <button class="btn btn-primary btn-sm" data-action="adj" data-type="add"    data-uid="${r.uid}" data-name="${escapeAttr(r.name)}" title="เพิ่มคะแนน"><i class="fa-solid fa-plus"></i></button>
          <button class="btn btn-danger btn-sm"  data-action="reset"                  data-uid="${r.uid}" data-name="${escapeAttr(r.name)}" title="ล้างคะแนน"><i class="fa-solid fa-rotate-left"></i></button>
        </td>
      </tr>
    `).join("");
  }

  // pager
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
  $("#adminTableBody").addEventListener("click", (e)=>{
    const btn = e.target.closest("button[data-action]"); if (!btn) return;
    const action = btn.dataset.action;
    const uid    = btn.dataset.uid;
    const name   = btn.dataset.name || "";

    if (action === "adj") {
      const isAdd = btn.dataset.type === "add";
      openAdjustModal(uid, name, isAdd ? 1 : -1);
    } else if (action === "reset") {
      confirmReset(uid, name);
    }
  });

  // modal buttons
  $("#btnAdjAdd").addEventListener("click", ()=>submitAdjust(+1));
  $("#btnAdjDeduct").addEventListener("click", ()=>submitAdjust(-1));
  $("#btnAdjReset").addEventListener("click", ()=>submitReset());

  // Export CSV
  $("#btnAdminExport").addEventListener("click", (e)=>{
    e.preventDefault();
    window.location.href = `${API_LIST}?uid=${encodeURIComponent(MY_UID)}&format=csv`;
  });
}

// Adjust modal
function openAdjustModal(uid, name, sign){
  $("#adjUid").textContent = uid;
  $("#adjName").textContent = name || "";
  $("#adjAmount").value = 10 * sign; // default
  $("#adjNote").value = "";
  const modal = new bootstrap.Modal($("#adjustModal"));
  modal.show();
}

/* ---------- แทนที่ฟังก์ชันเดิมด้วยเวอร์ชันนี้ ---------- */
async function submitAdjust(sign) {
  const uid  = $("#adjUid").textContent;
  const note = $("#adjNote").value || "";
  const raw  = Number($("#adjAmount").value || 0);
  const delta = Math.round(raw) * sign;  // บังคับเครื่องหมายตามปุ่ม (+/-)

  if (!delta) {
    return Swal.fire("กรอกจำนวนแต้ม", "จำนวนต้องไม่เป็นศูนย์", "warning");
  }

  try {
    overlay.show();
    const res = await fetch("/api/admin-adjust", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adminUid: MY_UID, targetUid: uid, delta, note })
    });
    const data = await res.json();
    overlay.hide();

    if (data.status !== "success") {
      return Swal.fire("ไม่สำเร็จ", data.message || "ปรับคะแนนไม่สำเร็จ", "error");
    }

    // optimistic update บนตาราง
    const row = rows.find(r => r.uid === uid);
    if (row) row.score = Number(row.score || 0) + delta;

    applyFilterSortPaginate(false);
    Swal.fire("สำเร็จ", `อัปเดตคะแนนเรียบร้อย (${delta > 0 ? "+" : ""}${delta})`, "success");
    bootstrap.Modal.getInstance($("#adjustModal"))?.hide();

  } catch (e) {
    overlay.hide();
    Swal.fire("ผิดพลาด", String(e), "error");
  }
}

function confirmReset(uid, name){
  Swal.fire({
    icon:"warning",
    title:`ล้างคะแนนของ ${name||uid}?`,
    showCancelButton:true,
    confirmButtonText:"ล้างคะแนน",
    cancelButtonText:"ยกเลิก"
  }).then(r=>{
    if (r.isConfirmed) submitReset(uid);
  });
}

/* ---------- แทนที่ฟังก์ชันเดิมด้วยเวอร์ชันนี้ ---------- */
async function submitReset(forceUid) {
  const uid  = forceUid || $("#adjUid").textContent;
  const note = $("#adjNote").value || "admin reset";

  try {
    overlay.show();
    const res = await fetch("/api/admin-reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adminUid: MY_UID, targetUid: uid, note })
    });
    const data = await res.json();
    overlay.hide();

    if (data.status !== "success") {
      return Swal.fire("ไม่สำเร็จ", data.message || "ล้างคะแนนไม่สำเร็จ", "error");
    }

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

document.addEventListener("DOMContentLoaded", init);
