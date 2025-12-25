/* ---------- Overlay ---------- */
const pageOverlay = {
  show(text = "กำลังทำงาน...") {
    if (window.jQuery?.LoadingOverlay) window.jQuery.LoadingOverlay("show", { image:"", fontawesome:"fa fa-spinner fa-spin", text });
    else {
      if (document.getElementById("apg-ovl")) return;
      const el = document.createElement("div"); el.id = "apg-ovl";
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
const API_LIST    = "/api/all-scores";     
const API_ACTIONS = "/api/admin-actions";  
const API_HISTORY = "/api/score-history";

let MY_UID_PAGE = null;
let rows     = [];  
let view     = [];  
let sortKey  = "score";   
let sortDir  = "desc";    
let page     = 1;
let pageSize = 20;
let TARGET_USER = null; 

const qs  = (sel) => document.querySelector(sel);
const fmt = (n) => Number(n||0).toLocaleString();
function debounce(fn, ms=300){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms);} }
function escapeHtml(s){ return String(s??"").replace(/[&<>"']/g, m=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" }[m])); }
function formatDateTime(ts) {
  const d = new Date(ts); if (isNaN(d)) return "";
  return d.toLocaleString('th-TH', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' });
}

/* ---------- Render List (Mobile Friendly - No Avatar) ---------- */
function renderTable(totalPages) {
  const start = (page-1)*pageSize;
  const end   = Math.min(start + pageSize, view.length);
  const slice = view.slice(start, end);

  const container = qs("#adminTableBody");
  if (!container) return;

  if (!slice.length) {
      container.innerHTML = `<div class="text-center text-muted py-5"><i class="fa-solid fa-user-slash fa-2x mb-2 opacity-25"></i><br>ไม่พบสมาชิก</div>`;
  } else {
      // แก้ไข: เอา Avatar ออก, ปรับ Layout ให้ชื่ออยู่ซ้ายสุด
      container.innerHTML = slice.map(r => `
        <div class="m-card p-3 mb-2 d-flex align-items-center justify-content-between shadow-sm border-0">
          <div style="min-width:0; flex-grow:1;">
             <div class="d-flex align-items-center gap-2">
                <div class="fw-bold text-dark text-truncate" style="font-size:1rem;">${escapeHtml(r.name || 'ไม่ระบุชื่อ')}</div>
                <div class="badge bg-light text-secondary border fw-normal" style="font-size:0.75rem;">${escapeHtml(r.room || r.tel || 'User')}</div>
             </div>
             </div>

          <div class="d-flex align-items-center gap-3 flex-shrink-0 ms-2">
             <div class="text-end">
                <div class="fw-bold text-primary" style="font-size:1.1rem;">${fmt(r.score)}</div>
                <div class="small text-muted" style="font-size:0.7rem; margin-top:-2px;">POINTS</div>
             </div>
             
             <div class="d-flex gap-1">
                <button class="btn btn-light btn-sm text-secondary border rounded-3" style="width:36px; height:36px;" onclick="openHistoryModal('${r.uid}')">
                   <i class="fa-solid fa-clock-rotate-left"></i>
                </button>
                <button class="btn btn-primary btn-sm text-white rounded-3 shadow-sm" style="width:36px; height:36px;" onclick="openActionModal('${r.uid}')">
                   <i class="fa-solid fa-sliders"></i>
                </button>
             </div>
          </div>
        </div>
      `).join("");
  }

  // Update Pagination
  const info = qs("#pageInfo");
  if (info) info.textContent = `${page} / ${totalPages}`;
  const btnPrev = qs("#btnPrev");
  const btnNext = qs("#btnNext");
  if (btnPrev) btnPrev.disabled = (page <= 1);
  if (btnNext) btnNext.disabled = (page >= totalPages);
}

/* ---------- Data Loading ---------- */
async function loadPageUsers() {
  const container = qs("#adminTableBody");
  if(container) container.innerHTML = '<div class="text-center py-5"><div class="spinner-border text-primary"></div></div>';
  
  try {
    const res = await fetch(`${API_LIST}?ts=${Date.now()}`, { cache: "no-store" });
    const json = await res.json();
    if (json.status !== "success") throw new Error("Load failed");

    rows = json.data.map((r,i)=>({ 
        uid: r.uid, name: r.name, score: Number(r.score||0), tel: r.tel || '', room: r.room || ''
    }));
    applyFilterSortPaginate(true);
  } catch (e) {
    if(container) container.innerHTML = `<div class="text-center text-danger py-4">โหลดไม่สำเร็จ</div>`;
  }
}

function applyFilterSortPaginate(resetPage=false) {
  const q = (qs("#searchInput")?.value || "").trim().toLowerCase();
  view = rows.filter(r => !q || (r.name||"").toLowerCase().includes(q) || String(r.uid||"").toLowerCase().includes(q));
  view.sort((a,b)=> b.score - a.score);

  const totalPages = Math.max(1, Math.ceil(view.length / pageSize));
  if (resetPage) page = 1;
  if (page > totalPages) page = totalPages;
  renderTable(totalPages);
}

/* ---------- Events & Modals ---------- */
function bindEvents() {
  qs("#searchInput")?.addEventListener("input", debounce(()=>applyFilterSortPaginate(true), 300));
  qs("#btnRefreshPage")?.addEventListener("click", () => loadPageUsers());
  qs("#btnPrev")?.addEventListener("click", () => { if(page>1){ page--; applyFilterSortPaginate(); }});
  qs("#btnNext")?.addEventListener("click", () => { 
      const max = Math.ceil(view.length/pageSize);
      if(page < max){ page++; applyFilterSortPaginate(); }
  });
  qs("#btnConfirmAdjust")?.addEventListener("click", submitAdjust);
}

window.openActionModal = (uid) => {
    const u = rows.find(x => x.uid === uid);
    if (!u) return;
    TARGET_USER = u;
    qs("#actionUserUID").textContent = u.uid;
    qs("#actionUserName").textContent = u.name;
    qs("#adjustAmount").value = "";
    qs("#adjustNote").value = "";
    qs("#radioAdd").checked = true;
    new bootstrap.Modal(qs('#actionModal')).show();
};

async function submitAdjust() {
    const mode = document.querySelector('input[name="adjustType"]:checked')?.value; 
    const amount = Number(qs("#adjustAmount")?.value || 0);
    const note = qs("#adjustNote")?.value || "";
    if (mode !== "reset" && amount <= 0) return Swal.fire("แจ้งเตือน","กรุณาระบุจำนวนแต้ม","warning");

    let action = "adjust";
    let delta = (mode === "add") ? amount : -amount;
    if (mode === "reset") action = "reset";

    bootstrap.Modal.getInstance(qs('#actionModal'))?.hide();
    pageOverlay.show("กำลังบันทึก...");
    
    try {
      const res = await fetch(API_ACTIONS, {
        method: "POST", headers: { "Content-Type":"application/json" },
        body: JSON.stringify({ adminUid: MY_UID_PAGE, action, targetUid: TARGET_USER.uid, delta, note })
      });
      const j = await res.json();
      if (!res.ok || j.status !== "success") throw new Error("Failed");
      Swal.fire("สำเร็จ", "บันทึกเรียบร้อย", "success");
      loadPageUsers();
    } catch (e) { Swal.fire("ผิดพลาด", "ทำรายการไม่สำเร็จ", "error"); } 
    finally { pageOverlay.hide(); }
}

window.openHistoryModal = async (uid) => {
    const tbody = qs("#historyTableBody");
    tbody.innerHTML = '<tr><td colspan="3" class="text-center py-3">กำลังโหลด...</td></tr>';
    new bootstrap.Modal(qs('#historyModal')).show();

    try {
      const res = await fetch(`${API_HISTORY}?uid=${uid}&limit=20`);
      const j = await res.json();
      const items = (Array.isArray(j) ? j : j.data) || [];
      
      tbody.innerHTML = items.length ? items.map(it => {
          const amt = Number(it.amount||it.point||0);
          const cls = amt >= 0 ? "text-success fw-bold" : "text-danger fw-bold";
          const sgn = amt > 0 ? "+" : "";
          return `
            <tr>
              <td class="ps-3 text-muted" style="font-size:0.8rem;">${formatDateTime(it.created_at || it.ts)}</td>
              <td style="font-size:0.9rem;">${escapeHtml(it.type||it.activity||'-')}</td>
              <td class="text-end pe-3 ${cls}">${sgn}${amt}</td>
            </tr>`;
      }).join("") : `<tr><td colspan="3" class="text-center text-muted py-3">ไม่มีประวัติ</td></tr>`;
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="3" class="text-center text-danger">โหลดไม่สำเร็จ</td></tr>`;
    }
}

async function boot() {
    if (!qs("#adminTableBody")) return;
    try {
        if (typeof liff !== 'undefined') {
            await liff.init({ liffId: window.LIFF_ID || "2007053300-QoEvbXyn" });
            if (!liff.isLoggedIn()) { liff.login(); return; }
            const p = await liff.getProfile();
            MY_UID_PAGE = p.userId;
        } else {
            MY_UID_PAGE = sessionStorage.getItem('uid');
        }
        bindEvents();
        loadPageUsers();
    } catch (e) { bindEvents(); loadPageUsers(); }
}
document.addEventListener("DOMContentLoaded", boot);