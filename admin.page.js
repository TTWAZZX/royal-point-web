/***********************
 * Admin Frontend (Table View)
 * แก้ไข: เปลี่ยนชื่อ overlay -> pageOverlay และลบ LIFF_ID ซ้ำ
 ***********************/

/* ---------- Overlay (เปลี่ยนชื่อเป็น pageOverlay กันชนกับ admin.js) ---------- */
const pageOverlay = {
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
// ❌ ลบ LIFF_ID ออก เพราะ admin.js ประกาศไว้แล้ว
// const LIFF_ID = "..."; 

const API_LIST    = "/api/all-scores";     
// ⭐ ใช้ API กลางที่เราเพิ่งรวมไฟล์
const API_ACTIONS = "/api/admin-actions";  
const API_HISTORY = "/api/score-history";

/* ---------- STATE ---------- */
let MY_UID_PAGE = null; // เปลี่ยนชื่อกันชน
let rows     = [];  
let view     = [];  
let sortKey  = "score";   
let sortDir  = "desc";    
let page     = 1;
let pageSize = 20;
let TARGET_USER = null; 

/* ---------- Utils ---------- */
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
      <tr><td colspan="4">
        <div class="d-flex flex-column gap-2 p-3">
           <div class="placeholder glow w-100" style="height:20px; background:#eee;"></div>
           <div class="placeholder glow w-75" style="height:20px; background:#eee;"></div>
        </div>
      </td></tr>
    `;
  }
}

/* ---------- Data Loading ---------- */
async function loadPageUsers() {
  renderSkeleton();
  try {
    const res = await fetch(`${API_LIST}?ts=${Date.now()}`, { cache: "no-store" });
    const json = await res.json();

    if (json.status !== "success" || !Array.isArray(json.data)) {
      throw new Error(json.message || "โหลดข้อมูลไม่สำเร็จ");
    }

    rows = json.data.map((r,i)=>({ 
        rank: i+1, 
        uid: r.uid, 
        name: r.name, 
        score: Number(r.score||0),
        tel: r.tel || '',
        room: r.room || ''
    }));

    applyFilterSortPaginate(true);
  } catch (e) {
    console.error(e);
    const body = qs("#adminTableBody");
    if (body) body.innerHTML = `<tr><td colspan="4" class="text-danger text-center py-3">โหลดข้อมูลไม่สำเร็จ: ${escapeHtml(e.message)}</td></tr>`;
  }
}

/* ---------- Filter / Sort / Paginate ---------- */
function applyFilterSortPaginate(resetPage=false) {
  const q = (qs("#searchInput")?.value || "").trim().toLowerCase();
  
  view = rows.filter(r => {
    return !q || (r.name||"").toLowerCase().includes(q) || 
                 String(r.uid||"").toLowerCase().includes(q) ||
                 String(r.tel||"").includes(q);
  });

  view.sort((a,b)=>{
    let va=a[sortKey], vb=b[sortKey];
    if (typeof va==='string') va=va.toLowerCase();
    if (typeof vb==='string') vb=vb.toLowerCase();
    if (va<vb) return sortDir==='asc' ? -1 : 1;
    if (va>vb) return sortDir==='asc' ?  1 : -1;
    return 0;
  });

  const total = view.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  
  if (resetPage) page = 1;
  if (page > totalPages) page = totalPages;
  if (page < 1) page = 1;

  renderTable(totalPages);
}

function renderTable(totalPages) {
  const start = (page-1)*pageSize;
  const end   = Math.min(start + pageSize, view.length);
  const slice = view.slice(start, end);

  const body = qs("#adminTableBody");
  if (body) {
    if (!slice.length) {
        body.innerHTML = `<tr><td colspan="4" class="text-center text-muted py-4">ไม่พบข้อมูล</td></tr>`;
    } else {
        body.innerHTML = slice.map(r => `
          <tr>
            <td class="ps-3"><div class="small fw-bold text-primary text-truncate" style="max-width:100px">${escapeHtml(r.uid)}</div></td>
            <td>
                <div class="fw-bold text-dark">${escapeHtml(r.name || '-')}</div>
                <div class="small text-muted">${escapeHtml(r.room || r.tel || '')}</div>
            </td>
            <td><span class="badge bg-secondary rounded-pill">${fmt(r.score)}</span></td>
            <td>
              <button class="btn btn-sm btn-outline-primary me-1" onclick="openActionModal('${r.uid}')">
                <i class="fa-solid fa-sliders"></i>
              </button>
              <button class="btn btn-sm btn-outline-secondary" onclick="openHistoryModal('${r.uid}')">
                <i class="fa-solid fa-clock-rotate-left"></i>
              </button>
            </td>
          </tr>
        `).join("");
    }
  }

  const info = qs("#pageInfo");
  if (info) info.textContent = `หน้า ${page} / ${totalPages} (รวม ${view.length})`;
  
  const btnPrev = qs("#btnPrev");
  const btnNext = qs("#btnNext");
  if (btnPrev) btnPrev.disabled = (page <= 1);
  if (btnNext) btnNext.disabled = (page >= totalPages);
}

/* ---------- Events Setup ---------- */
function bindEvents() {
  qs("#searchInput")?.addEventListener("input", debounce(()=>applyFilterSortPaginate(true), 300));
  qs("#btnRefreshPage")?.addEventListener("click", () => loadPageUsers());

  qs("#btnPrev")?.addEventListener("click", () => { if(page>1){ page--; renderTable(Math.ceil(view.length/pageSize)); }});
  qs("#btnNext")?.addEventListener("click", () => { 
      const max = Math.ceil(view.length/pageSize);
      if(page < max){ page++; renderTable(max); }
  });

  qs("#btnConfirmAdjust")?.addEventListener("click", submitAdjust);
}

/* ---------- Modal Logic (Action) ---------- */
window.openActionModal = (uid) => {
    const u = rows.find(x => x.uid === uid);
    if (!u) return;
    TARGET_USER = u;
    
    qs("#actionUserUID").textContent = u.uid;
    qs("#actionUserName").textContent = u.name;
    qs("#adjustAmount").value = "";
    qs("#adjustNote").value = "";
    qs("#radioAdd").checked = true;
  
    bootstrap.Modal.getOrCreateInstance(qs('#actionModal')).show();
};

async function submitAdjust() {
    const mode = qs('input[name="adjustType"]:checked')?.value; 
    const amount = Number(qs("#adjustAmount")?.value || 0);
    const note = qs("#adjustNote")?.value || "";

    if (!TARGET_USER) return;
    if (mode !== "reset" && amount <= 0) return Swal.fire("แจ้งเตือน","กรุณาระบุจำนวนแต้ม","warning");

    let action = "";
    let delta = 0;

    if (mode === "add") { action = "adjust"; delta = amount; }
    else if (mode === "del") { action = "adjust"; delta = -amount; }
    else if (mode === "reset") { action = "reset"; }

    bootstrap.Modal.getInstance(qs('#actionModal'))?.hide();
    
    // ใช้ pageOverlay
    pageOverlay.show("กำลังบันทึก...");
    try {
      // เรียก API admin-actions
      const res = await fetch(API_ACTIONS, {
        method: "POST",
        headers: { "Content-Type":"application/json" },
        body: JSON.stringify({
          adminUid: MY_UID_PAGE, // ส่ง UID แอดมิน
          action,
          targetUid: TARGET_USER.uid,
          delta, 
          note
        })
      });
      const j = await res.json();
      if (!res.ok || j.status !== "success") throw new Error(j.message||"Failed");

      Swal.fire("สำเร็จ", "บันทึกเรียบร้อย", "success");
      loadPageUsers();
    } catch (e) {
      console.error(e);
      Swal.fire("ผิดพลาด", e.message, "error");
    } finally {
      pageOverlay.hide();
    }
}

/* ---------- History Modal ---------- */
window.openHistoryModal = async (uid) => {
    pageOverlay.show("โหลดประวัติ...");
    try {
      const res = await fetch(`${API_HISTORY}?uid=${uid}&limit=50`);
      const j = await res.json();
      const tbody = qs("#historyTableBody");
      tbody.innerHTML = "";
  
      if (res.ok) {
        const items = (Array.isArray(j) ? j : j.data) || [];
        tbody.innerHTML = items.length 
          ? items.map(it => {
              const date = formatDateTime(it.created_at || it.ts);
              const amt = Number(it.amount||it.point||0);
              const badgeClass = amt >= 0 ? "bg-success" : "bg-danger";
              const signed = amt > 0 ? `+${amt}` : `${amt}`;
              return `
                <tr>
                  <td><small class="text-muted">${date}</small></td>
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
      pageOverlay.hide();
    }
  }

/* ---------- Boot / Init ---------- */
async function boot() {
    if (!qs("#adminTableBody")) return;

    try {
        // ใช้ LIFF_ID จาก Global context (ที่ admin.js ประกาศไว้)
        if (typeof liff !== 'undefined') {
            await liff.init({ liffId: window.LIFF_ID || "2007053300-QoEvbXyn" });
            if (!liff.isLoggedIn()) { liff.login(); return; }
            const profile = await liff.getProfile();
            MY_UID_PAGE = profile.userId;
        } else {
            MY_UID_PAGE = sessionStorage.getItem('uid') || localStorage.getItem('uid');
        }
        
        bindEvents();
        loadPageUsers();
    } catch (e) {
        console.warn("LIFF init warning:", e);
        bindEvents();
        loadPageUsers();
    }
}

document.addEventListener("DOMContentLoaded", boot);