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

/* ---------- Helpers ---------- */
const qs  = (sel) => document.querySelector(sel);
const fmt = (n) => Number(n||0).toLocaleString();
function debounce(fn, ms=300){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms);} }
function escapeHtml(s){ return String(s??"").replace(/[&<>"']/g, m=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" }[m])); }
function formatDateTime(ts) {
  const d = new Date(ts); if (isNaN(d)) return "";
  return d.toLocaleString('th-TH', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' });
}

// ⭐ Helper: พยายามหา UID แอดมินให้เจอไม่ว่าจะอยู่ที่ไหน
function getCurrentAdminUid() {
    if (MY_UID_PAGE) return MY_UID_PAGE;
    if (window.CURRENT_ADMIN_UID) return window.CURRENT_ADMIN_UID; // รับจาก admin.js
    if (sessionStorage.getItem('uid')) return sessionStorage.getItem('uid');
    if (localStorage.getItem('uid')) return localStorage.getItem('uid');
    return null;
}

/* ---------- Render List (Mobile Friendly) ---------- */
function renderTable(totalPages) {
  const start = (page-1)*pageSize;
  const end   = Math.min(start + pageSize, view.length);
  const slice = view.slice(start, end);

  const container = qs("#adminTableBody");
  if (!container) return;

  if (!slice.length) {
      container.innerHTML = `<div class="text-center text-muted py-5"><i class="fa-solid fa-user-slash fa-2x mb-2 opacity-25"></i><br>ไม่พบสมาชิก</div>`;
  } else {
      container.innerHTML = slice.map(r => `
        <div class="m-card p-3 mb-2 d-flex align-items-center justify-content-between shadow-sm border-0">
          <div style="min-width:0; flex-grow:1;">
             <div class="fw-bold text-dark text-truncate mb-1" style="font-size:1.05rem;">
                ${escapeHtml(r.name || 'ไม่ระบุชื่อ')}
             </div>
             <div class="text-muted small">
                <i class="fa-regular fa-id-card me-1 opacity-50"></i>${escapeHtml(r.room || r.tel || 'General User')}
             </div>
          </div>

          <div class="d-flex align-items-center gap-3 flex-shrink-0 ms-3">
             <div class="text-end">
                <div class="fw-bold text-primary" style="font-size:1.2rem; line-height:1;">${fmt(r.score)}</div>
                <div class="small text-muted" style="font-size:0.65rem;">POINTS</div>
             </div>
             <div class="d-flex gap-1 bg-light rounded-pill p-1 border">
                <button class="btn btn-sm text-secondary rounded-circle" style="width:34px; height:34px;" onclick="openHistoryModal('${r.uid}')">
                   <i class="fa-solid fa-clock-rotate-left"></i>
                </button>
                <button class="btn btn-sm btn-white text-primary shadow-sm rounded-circle" style="width:34px; height:34px;" onclick="openActionModal('${r.uid}')">
                   <i class="fa-solid fa-sliders"></i>
                </button>
             </div>
          </div>
        </div>
      `).join("");
  }

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
  if(container && !rows.length) container.innerHTML = '<div class="text-center py-5"><div class="spinner-border text-primary"></div><div class="mt-2 text-muted small">กำลังโหลดข้อมูล...</div></div>';
  
  try {
    const res = await fetch(`${API_LIST}?ts=${Date.now()}`, { cache: "no-store" });
    const json = await res.json();
    if (json.status !== "success") throw new Error(json.message || "Load failed");

    rows = json.data.map((r,i)=>({ 
        uid: r.uid, name: r.name, score: Number(r.score||0), tel: r.tel || '', room: r.room || ''
    }));
    applyFilterSortPaginate(true);
  } catch (e) {
    console.error("Load Error:", e);
    if(container) container.innerHTML = `<div class="text-center text-danger py-4"><i class="fa-solid fa-triangle-exclamation mb-2"></i><br>โหลดไม่สำเร็จ<br><small>${e.message}</small><br><button class="btn btn-sm btn-outline-danger mt-2" onclick="loadPageUsers()">ลองใหม่</button></div>`;
  }
}

function applyFilterSortPaginate(resetPage=false) {
  const q = (qs("#searchInput")?.value || "").trim().toLowerCase();
  view = rows.filter(r => !q || (r.name||"").toLowerCase().includes(q) || String(r.tel||"").includes(q)); 
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
    qs("#actionUserName").textContent = u.name;
    qs("#actionUserUID").textContent = ""; 
    qs("#adjustAmount").value = "";
    qs("#adjustNote").value = "";
    qs("#radioAdd").checked = true;
    new bootstrap.Modal(qs('#actionModal')).show();
};

// ⭐ แก้ไข: ฟังก์ชันบันทึกแต้ม (เพิ่มการเช็ค UID ให้ชัวร์)
async function submitAdjust() {
    const mode = document.querySelector('input[name="adjustType"]:checked')?.value; 
    const amount = Number(qs("#adjustAmount")?.value || 0);
    const note = qs("#adjustNote")?.value || "";
    
    // ดึง UID ล่าสุด ณ วินาทีที่กดปุ่ม
    const finalAdminUid = getCurrentAdminUid();

    if (!finalAdminUid) {
        return Swal.fire("ไม่พบสิทธิ์แอดมิน", "กรุณาลองรีเฟรชหน้าเว็บ หรือเปิดใหม่ผ่าน LINE", "error");
    }

    if (mode !== "reset" && amount <= 0) return Swal.fire("แจ้งเตือน","กรุณาระบุจำนวนแต้ม","warning");

    let action = "adjust";
    let delta = (mode === "add") ? amount : -amount;
    if (mode === "reset") action = "reset";

    bootstrap.Modal.getInstance(qs('#actionModal'))?.hide();
    pageOverlay.show("กำลังบันทึก...");
    
    try {
      const res = await fetch(API_ACTIONS, {
        method: "POST", headers: { "Content-Type":"application/json" },
        body: JSON.stringify({ 
            adminUid: finalAdminUid, // ใช้ค่าที่หามาได้ชัวร์ๆ
            action, 
            targetUid: TARGET_USER.uid, 
            delta, 
            note 
        })
      });
      const j = await res.json();
      if (!res.ok || j.status !== "success") throw new Error(j.message || "Failed");
      
      Swal.fire("สำเร็จ", "บันทึกเรียบร้อย", "success");
      loadPageUsers();
    } catch (e) { 
        console.error(e);
        Swal.fire("ผิดพลาด", `ทำรายการไม่สำเร็จ: ${e.message}`, "error"); 
    } 
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
    
    // ตั้งเวลา Timeout: ถ้า LIFF โหลดนานเกิน 1.5 วิ ให้ข้ามไปโหลดข้อมูลเลย
    const safetyTimer = setTimeout(() => {
        console.warn("LIFF init slow, forcing start...");
        bindEvents();
        loadPageUsers();
    }, 1500);

    try {
        if (typeof liff !== 'undefined') {
            await liff.init({ liffId: window.LIFF_ID || "2007053300-QoEvbXyn" });
            
            if (liff.isLoggedIn()) {
                const p = await liff.getProfile();
                MY_UID_PAGE = p.userId;
                // สำรองไว้ใน Storage เผื่อหลุด
                sessionStorage.setItem('uid', p.userId);
            }
        } else {
            MY_UID_PAGE = sessionStorage.getItem('uid');
        }
        
        clearTimeout(safetyTimer);
        bindEvents();
        loadPageUsers();

    } catch (e) { 
        clearTimeout(safetyTimer);
        console.error("Boot Error:", e);
        bindEvents(); 
        loadPageUsers(); 
    }
}

document.addEventListener("DOMContentLoaded", boot);