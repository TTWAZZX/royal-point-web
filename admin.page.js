/***********************
 * Admin Frontend (Table View)
 * - โหลดตารางคะแนน
 * - ค้นหา/กรอง/เรียง/แบ่งหน้า
 * - ปรับคะแนน +/–, ล้างคะแนน (ผ่านโมดัล)
 * - ดูประวัติ (โมดัล)
 * - Export CSV
 * * สคริปต์นี้จะรันเฉพาะเมื่อมี #adminTableBody อยู่บนหน้าเท่านั้น
 ***********************/

/* ---------- Overlay (jQuery LoadingOverlay ถ้ามี, ไม่มีก็ fallback) ---------- */
const overlay = {
  show(text = "กำลังทำงาน...") {
    if (window.jQuery?.LoadingOverlay) {
      window.jQuery.LoadingOverlay("show", { image:"", fontawesome:"fa fa-spinner fa-spin", text });
    } else {
      if (document.getElementById("apg-ovl")) return;
      const el = document.createElement("div");
      el.id = "apg-ovl";
      el.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:4000;color:#fff";
      el.innerHTML = `<div class="bg-dark rounded-3 px-3 py-2"><i class="fa fa-spinner fa-spin me-2"></i>${text}</div>`;
      document.body.appendChild(el);
    }
  },
  hide() {
    if (window.jQuery?.LoadingOverlay) window.jQuery.LoadingOverlay("hide");
    else document.getElementById("apg-ovl")?.remove();
  },
};

/* ---------- CONFIG ---------- */
const ADMIN_UID   = "Ucadb3c0f63ada96c0432a0aede267ff9";
const LIFF_ID     = "2007053300-QoEvbXyn";
const API_LIST    = "/api/all-scores";     // GET  ?adminUid=
const API_ADJUST  = "/api/admin-adjust";   // POST { adminUid, targetUid, delta, note }
const API_RESET   = "/api/admin-reset";    // POST { adminUid, targetUid, note }
const API_HISTORY = "/api/score-history";  // GET  ?uid=

/* ---------- STATE ---------- */
let MY_UID   = null;
let rows     = [];  // raw [{uid,name,score}]
let view     = [];  // filtered/sorted
let sortKey  = "score";   // 'score' | 'name' | 'uid' | 'rank'
let sortDir  = "desc";    // 'asc' | 'desc'
let page     = 1;
let pageSize = 20;

/* ---------- Utils (อย่าทับ jQuery: ใช้ qs/qsa แทน $/$$) ---------- */
const qs  = (sel, root=document) => root.querySelector(sel);
const qsa = (sel, root=document) => Array.from(root.querySelectorAll(sel));
const fmt = (n) => Number(n||0).toLocaleString();

function debounce(fn, ms=300){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms);} }
function escapeHtml(s){ return String(s??"").replace(/[&<>"']/g, m=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" }[m])); }
function escapeAttr(s){ return escapeHtml(s).replace(/"/g,"&quot;"); }
function formatDateTime(ts) {
  const d = new Date(ts);
  if (isNaN(d)) return String(ts || "");
  return d.toLocaleString('th-TH', { hour12: false });
}

/* ---------- Skeleton ---------- */
function renderSkeleton() {
  const body = qs("#adminTableBody");
  if (body) {
    body.innerHTML = `
      <tr><td colspan="3">
        <div class="skeleton skeleton-row"></div>
        <div class="skeleton skeleton-row"></div>
        <div class="skeleton skeleton-row"></div>
      </td></tr>
    `;
  }
  qs("#adminInfo")?.replaceChildren(document.createTextNode("กำลังโหลด..."));
  qs("#adminRange")?.replaceChildren(document.createTextNode(""));
  const pager = qs("#adminPager"); if (pager) pager.innerHTML = "";
  qs("#adminPagerInfo")?.replaceChildren(document.createTextNode(""));
}

/* ---------- Data ---------- */
async function loadList() {
  renderSkeleton();
  try {
    const q1 = `${API_LIST}?uid=${encodeURIComponent(MY_UID)}`;
    const q2 = `${API_LIST}?adminUid=${encodeURIComponent(MY_UID)}`;

    let res  = await fetch(q1, { cache: "no-store" });
    let data = await res.json().catch(()=>({}));

    if (data?.status !== "success" || !Array.isArray(data.data)) {
      res  = await fetch(q2, { cache: "no-store" });
      data = await res.json().catch(()=>({}));
    }
    if (data?.status !== "success" || !Array.isArray(data.data)) {
      throw new Error(data?.message || "โหลดข้อมูลไม่สำเร็จ");
    }

    rows = data.data.map((r,i)=>({ rank:i+1, uid:r.uid, name:r.name, score:Number(r.score||0) }));
    qs("#adminInfo")?.replaceChildren(document.createTextNode(`ทั้งหมด ${fmt(rows.length)} รายการ`));
    applyFilterSortPaginate(true);
  } catch (e) {
    const body = qs("#adminTableBody");
    if (body) body.innerHTML = `<tr><td colspan="3" class="text-danger">โหลดข้อมูลไม่สำเร็จ: ${escapeHtml(e.message||String(e))}</td></tr>`;
    qs("#adminInfo")?.replaceChildren(document.createTextNode("เกิดข้อผิดพลาด"));
  }
}

function applyFilterSortPaginate(resetPage=false) {
  const q = (qs("#adminSearch")?.value || "").trim().toLowerCase();
  const minScore = Number(qs("#adminMinScore")?.value || 0);
  pageSize = Number(qs("#adminPageSize")?.value || 20);

  // filter
  view = rows.filter(r => {
    const hitQ = !q || (r.name||"").toLowerCase().includes(q) || String(r.uid||"").toLowerCase().includes(q);
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

function renderTable() {
  const total = view.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (page > totalPages) page = totalPages;

  const start = (page-1)*pageSize;
  const end   = Math.min(start + pageSize, total);
  const slice = view.slice(start, end);

  qs("#adminRange")?.replaceChildren(document.createTextNode(total ? `แสดง ${fmt(start+1)}–${fmt(end)} จาก ${fmt(total)}` : ""));

  const body = qs("#adminTableBody");
  if (body) {
    body.innerHTML = slice.length ? slice.map(r => `
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
    `).join("") : `<tr><td colspan="3" class="text-center text-muted">ไม่พบข้อมูล</td></tr>`;
  }

  qs("#adminPagerInfo")?.replaceChildren(document.createTextNode(`หน้า ${page}/${totalPages}`));
  const pager = qs("#adminPager");
  if (pager) pager.innerHTML = makePager(totalPages);
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

/* ---------- Actions ---------- */
function bindEvents() {
  // sort header
  qsa("#admin thead .sort").forEach(th=>{
    th.addEventListener("click", ()=>{
      const key = th.dataset.key;
      if (!key) return;
      if (sortKey === key) sortDir = (sortDir === "asc" ? "desc" : "asc");
      else { sortKey = key; sortDir = key === "name" ? "asc" : "desc"; }
      qsa("#admin thead .sort").forEach(h=>h.classList.remove("asc","desc"));
      th.classList.add(sortDir);
      applyFilterSortPaginate(true);
    });
  });

  // filters
  qs("#adminSearch")?.addEventListener("input", debounce(()=>applyFilterSortPaginate(true), 200));
  qs("#adminMinScore")?.addEventListener("input", debounce(()=>applyFilterSortPaginate(true), 200));
  qs("#adminPageSize")?.addEventListener("change", ()=>applyFilterSortPaginate(true));

  // refresh
  qs("#btnAdminRefresh")?.addEventListener("click", ()=>loadList());

  // pager click
  qs("#adminPager")?.addEventListener("click", (e)=>{
    const a = e.target.closest("a[data-page]"); if (!a) return;
    e.preventDefault();
    page = Number(a.dataset.page);
    renderTable();
  });

  // row quick actions
  qs("#adminTableBody")?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;

    const action = btn.dataset.action;
    const uid    = btn.dataset.uid;
    const name   = btn.dataset.name || '';

    if (action === 'adj') {
      openAdjustModal(uid, name);             // เปิดโมดัลกำหนดแต้ม
      return;
    }
    if (action === 'reset') {
      confirmReset(uid, name);                // โมดัลยืนยันล้าง
      return;
    }
    if (action === 'history') {
      await openHistory(uid, name);           // โหลด+แสดงประวัติ
      return;
    }
  });

  // modal buttons
  qs("#btnAdjAdd")?.addEventListener("click", () => submitAdjust(+1));
  qs("#btnAdjDeduct")?.addEventListener("click", () => submitAdjust(-1));
  qs("#btnAdjReset")?.addEventListener("click", ()=>submitReset());

  // Export CSV
  qs("#btnAdminExport")?.addEventListener("click", (e)=>{
    e.preventDefault();
    // ใช้ adminUid ให้ตรงกับ API
    window.location.href = `${API_LIST}?adminUid=${encodeURIComponent(MY_UID)}&format=csv`;
  });
}

/* ---------- Adjust modal ---------- */
function openAdjustModal(uid, name) {
  qs("#ajUid")?.replaceChildren(document.createTextNode(uid || ""));
  const ajUidHref = qs("#ajUidLink");
  if (ajUidHref) ajUidHref.href = `https://line.me/R/ti/p/~${encodeURIComponent(uid)}`; // ถ้าไม่ต้องการลิงก์ ให้ลบสองบรรทัดนี้
  const deltaEl = qs("#ajDelta"); if (deltaEl) deltaEl.value = 50;
  const noteEl  = qs("#ajNote");  if (noteEl) noteEl.value  = "";
  const modal = bootstrap.Modal.getOrCreateInstance(qs("#adjustModal"));
  modal.show();
}

async function submitAdjust(sign) {
  const uid  = (qs("#ajUid")?.textContent || "").trim();
  const note = qs("#ajNote")?.value || "";
  let amt = parseInt(qs("#ajDelta")?.value || "0", 10);
  if (isNaN(amt) || amt <= 0) return Swal.fire("กรอกจำนวนแต้ม", "จำนวนต้องมากกว่า 0", "warning");
  const delta = sign === 1 ? amt : -amt;

  try {
    overlay.show("กำลังบันทึก...");
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
    bootstrap.Modal.getInstance(qs("#adjustModal"))?.hide();
  } catch (e) {
    overlay.hide();
    Swal.fire("ผิดพลาด", String(e.message||e), "error");
  }
}

function confirmReset(uid, name){
  Swal.fire({ icon:"warning", title:`ล้างคะแนนของ ${escapeHtml(name||uid)}?`,
    showCancelButton:true, confirmButtonText:"ล้างคะแนน", cancelButtonText:"ยกเลิก"
  }).then(r=>{ if (r.isConfirmed) submitReset(uid); });
}

async function submitReset(forceUid) {
  const uid  = forceUid || (qs("#ajUid")?.textContent || "").trim();
  const note = qs("#ajNote")?.value || "admin reset";
  try {
    overlay.show("กำลังล้างคะแนน...");
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
    bootstrap.Modal.getInstance(qs("#adjustModal"))?.hide();
  } catch (e) {
    overlay.hide();
    Swal.fire("ผิดพลาด", String(e.message||e), "error");
  }
}

/* ---------- History ---------- */
async function openHistory(uid, name){
  overlay.show("กำลังโหลดประวัติ...");
  try{
    const res = await fetch(`${API_HISTORY}?uid=${encodeURIComponent(uid)}`, { cache:"no-store" });
    const json = await res.json();
    if (json.status !== 'success') throw new Error(json.message || 'Fetch history error');

    // รองรับทั้งแบบ list-group (#historyList) และแบบตาราง (#historyTableBody)
    const listEl  = qs('#historyList');
    const tableEl = qs('#historyTableBody');

    const items = Array.isArray(json.data) ? json.data : [];

    // ตั้งหัวข้อ
    const titleEl = qs('#historyModal .modal-title');
    if (titleEl) {
      titleEl.innerHTML = `<i class="fa-regular fa-clock me-2"></i>ประวัติพ้อยท์ — <span class="text-info">${escapeHtml(name||uid)}</span>`;
    }

    if (listEl) {
      listEl.innerHTML = items.length
        ? items.slice(0,100).map(it=>{
            const dt = formatDateTime(it.ts);
            const p  = Number(it.point)||0;
            const sign = p>=0?"+":"−";
            const cls  = p>=0?'bg-success':'bg-warning';
            const abs  = Math.abs(p);
            const type = escapeHtml(it.type||'');
            const code = it.code ? ` • ${escapeHtml(it.code)}` : '';
            return `
              <div class="list-group-item d-flex justify-content-between align-items-center bg-transparent">
                <div>
                  <div class="small text-muted">${dt}</div>
                  <div class="fw-semibold">${type}${code}</div>
                </div>
                <span class="badge ${cls} rounded-pill">${sign}${abs}</span>
              </div>`;
          }).join("")
        : `<div class="p-4 text-center text-muted">ไม่มีรายการ</div>`;
    } else if (tableEl) {
      tableEl.innerHTML = items.length
        ? items.slice(0,100).map(it=>{
            const dt = formatDateTime(it.ts);
            const p  = Number(it.point)||0;
            const badgeClass = p>=0? 'bg-success' : 'bg-danger';
            const signed = p>0? `+${p}` : `${p}`;
            return `
              <tr>
                <td class="text-muted">${escapeHtml(dt)}</td>
                <td><span class="badge ${badgeClass}">${signed}</span></td>
                <td>${escapeHtml(it.type||'-')}</td>
                <td class="text-nowrap">${escapeHtml(it.code||'-')}</td>
              </tr>`;
          }).join("")
        : `<tr><td colspan="4" class="text-center text-muted py-4">ไม่มีประวัติ</td></tr>`;
    }

    bootstrap.Modal.getOrCreateInstance(qs('#historyModal')).show();
  } catch (err) {
    console.error(err);
    Swal.fire("ผิดพลาด", err.message || "โหลดประวัติไม่สำเร็จ", "error");
  } finally {
    overlay.hide();
  }
}

/* ---------- LIFF init & page guard ---------- */
async function boot() {
  // รันเฉพาะหน้า table (กันชนกับ admin.html)
  if (!qs("#adminTableBody")) return;

  try {
    await liff.init({ liffId: LIFF_ID });
    if (!liff.isLoggedIn()) return liff.login();
    const profile = await liff.getProfile();
    MY_UID = profile.userId;

    // Gate ฝั่ง UI (ฝั่ง API ยังตรวจสิทธิ์จริง)
    if (MY_UID !== ADMIN_UID) {
      Swal.fire("เฉพาะผู้ดูแลระบบ", "บัญชีของคุณไม่มีสิทธิ์เข้าถึงหน้านี้", "error");
      setTimeout(()=>location.href="/", 1200);
      return;
    }

    // โชว์ UID ที่หัว (ถ้ามี element)
    const adminUidHost = qs('#adminUid');
    if (adminUidHost) adminUidHost.textContent = MY_UID;

    bindEvents();
    loadList();
  } catch (e) {
    Swal.fire("ผิดพลาด", "ไม่สามารถเริ่มระบบ LIFF ได้", "error");
    console.error(e);
  }
}

document.addEventListener("DOMContentLoaded", boot);
