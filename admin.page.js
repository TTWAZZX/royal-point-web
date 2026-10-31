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
let POINT_ADJUST_REQUEST_ID = '';
let AUTH_HELP_CASES = [];
let AUTH_HELP_DEEP_LINK_OPENED = false;

/* ---------- Helpers ---------- */
const qs  = (sel) => document.querySelector(sel);
const fmt = (n) => Number(n||0).toLocaleString();
function debounce(fn, ms=300){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms);} }
function escapeHtml(s){ return String(s??"").replace(/[&<>"']/g, m=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" }[m])); }
function formatDateTime(ts) {
  const d = new Date(ts); if (isNaN(d)) return "";
  return d.toLocaleString('th-TH', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' });
}

function isRecoveryActive(auth) {
  const until = new Date(auth?.recoveryUntil || 0).getTime();
  return Number.isFinite(until) && until > Date.now();
}

function authBadge(auth) {
  if (isRecoveryActive(auth)) return '<span class="badge bg-warning-subtle text-warning-emphasis ms-1">โหมดช่วยเหลือ</span>';
  if (auth?.tokenRequired) return '<span class="badge bg-success-subtle text-success ms-1">ยืนยันผ่าน LINE แล้ว</span>';
  return '<span class="badge bg-secondary-subtle text-secondary ms-1">รอย้ายระบบ</span>';
}

const AUTH_HELP_STATUS = {
  open: { label:'รอดำเนินการ', tone:'warning' },
  approved: { label:'เปิดช่วยเหลือแล้ว', tone:'primary' },
  resolved: { label:'แก้ไขแล้ว', tone:'success' },
  expired: { label:'หมดอายุ', tone:'secondary' },
  closed: { label:'ปิดเรื่อง', tone:'dark' }
};

const AUTH_ERROR_LABEL = {
  AUTH_PROVIDER_UNAVAILABLE: 'เชื่อมต่อ LINE ไม่ได้ชั่วคราว',
  AUTH_TOKEN_INVALID: 'ข้อมูลยืนยัน LINE หมดอายุ',
  AUTH_TOKEN_REQUIRED: 'ไม่พบข้อมูลยืนยัน LINE',
  AUTH_UPGRADE_REQUIRED: 'หน้าเดิมยังไม่ส่งข้อมูลยืนยัน',
  AUTH_MIGRATION_NOT_READY: 'ระบบย้ายบัญชียังไม่พร้อม'
};

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
                ${authBadge(r.auth)}
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
    const adminUid = getCurrentAdminUid();
    const res = await fetch(`${API_LIST}?adminUid=${encodeURIComponent(adminUid || '')}&ts=${Date.now()}`, { cache: "no-store" });
    const json = await res.json();
    if (json.status !== "success") throw new Error(json.message || "Load failed");

    rows = json.data.map((r,i)=>({ 
        uid: r.uid, name: r.name, score: Number(r.score||0), tel: r.tel || '', room: r.room || '',
        auth: r.auth || { tokenRequired:false, migratedAt:null, lastVerifiedAt:null, recoveryUntil:null, recoveryReason:null, recoveryBy:null }
    }));
    applyFilterSortPaginate(true);
  } catch (e) {
    console.error("Load Error:", e);
    if(container) container.innerHTML = `<div class="text-center text-danger py-4"><i class="fa-solid fa-triangle-exclamation mb-2"></i><br>โหลดไม่สำเร็จ<br><small>${e.message}</small><br><button class="btn btn-sm btn-outline-danger mt-2" onclick="loadPageUsers()">ลองใหม่</button></div>`;
  }
}

function applyFilterSortPaginate(resetPage=false) {
  const q = (qs("#searchInput")?.value || "").trim().toLowerCase();
  view = rows.filter(r => !q ||
    (r.name||"").toLowerCase().includes(q) ||
    String(r.tel||"").includes(q) ||
    String(r.uid||"").toLowerCase().includes(q)
  );
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
  qs("#btnOpenAuthRecovery")?.addEventListener("click", openAuthRecovery);
  qs("#btnCloseAuthRecovery")?.addEventListener("click", closeAuthRecovery);
  qs("#authHelpSearch")?.addEventListener("input", debounce(renderAuthHelpCases, 250));
  qs("#authHelpStatusFilter")?.addEventListener("change", renderAuthHelpCases);
  qs("#btnRefreshAuthHelp")?.addEventListener("click", loadAuthHelpCases);
  qs("#tabAuthHelpBtn")?.addEventListener("shown.bs.tab", loadAuthHelpCases);
}

function notificationSummary(helpCase) {
    const items = Array.isArray(helpCase?.notifications) ? helpCase.notifications : [];
    if (!items.length) return { label:'ยังไม่มีการส่ง LINE', tone:'secondary', failed:null };
    const failed = items.find(item => item.status === 'failed');
    if (failed) return { label:'ส่ง LINE ไม่สำเร็จ', tone:'danger', failed };
    const pending = items.find(item => item.status === 'pending');
    if (pending) return { label:'รอส่ง LINE', tone:'warning', failed:null };
    return { label:'ส่ง LINE แล้ว', tone:'success', failed:null };
}

async function loadAuthHelpCases() {
    const area = qs('#authHelpListArea');
    if (!area) return;
    area.innerHTML = '<div class="text-center py-5"><div class="spinner-border spinner-border-sm text-primary"></div><div class="small text-muted mt-2">กำลังโหลดเรื่องช่วยเหลือ...</div></div>';
    try {
        const adminUid = getCurrentAdminUid();
        const response = await fetch(`${API_ACTIONS}?action=auth_help_cases&adminUid=${encodeURIComponent(adminUid || '')}&ts=${Date.now()}`, { cache:'no-store' });
        const payload = await response.json();
        if (!response.ok || payload.status !== 'success') throw new Error(payload.message || 'โหลดเรื่องช่วยเหลือไม่สำเร็จ');
        AUTH_HELP_CASES = Array.isArray(payload.data) ? payload.data : [];
        const openCount = AUTH_HELP_CASES.filter(item => item.status === 'open').length;
        const count = qs('#authHelpOpenCount');
        if (count) {
            count.textContent = String(openCount);
            count.classList.toggle('d-none', openCount === 0);
        }
        renderAuthHelpCases();
        openDeepLinkedHelpCase();
    } catch (error) {
        area.innerHTML = `<div class="m-card text-center py-4 text-danger"><i class="fa-solid fa-triangle-exclamation mb-2"></i><br>${escapeHtml(error.message || 'โหลดไม่สำเร็จ')}<br><button class="btn btn-sm btn-outline-danger rounded-pill mt-3" onclick="loadAuthHelpCases()">ลองใหม่</button></div>`;
    }
}

function renderAuthHelpCases() {
    const area = qs('#authHelpListArea');
    if (!area) return;
    const term = String(qs('#authHelpSearch')?.value || '').trim().toLowerCase();
    const statusFilter = String(qs('#authHelpStatusFilter')?.value || 'all');
    const filtered = AUTH_HELP_CASES.filter(item => {
        const matchesStatus = statusFilter === 'all' || item.status === statusFilter;
        const haystack = [item.case_no, item.target_uid, item.user?.name, item.user?.tel, item.error_code].join(' ').toLowerCase();
        return matchesStatus && (!term || haystack.includes(term));
    });
    if (!filtered.length) {
        area.innerHTML = '<div class="m-card text-center py-5 text-muted"><i class="fa-solid fa-headset fa-2x mb-3 opacity-25"></i><br>ไม่พบเรื่องช่วยเหลือ</div>';
        return;
    }
    area.innerHTML = filtered.map(item => {
        const meta = AUTH_HELP_STATUS[item.status] || AUTH_HELP_STATUS.open;
        const delivery = notificationSummary(item);
        const canApprove = item.status === 'open';
        return `<div class="m-card" id="auth-help-case-${escapeHtml(item.id)}">
          <div class="d-flex align-items-start justify-content-between gap-2">
            <div style="min-width:0">
              <div class="fw-bold text-dark">${escapeHtml(item.case_no)}</div>
              <div class="text-muted small text-truncate">${escapeHtml(item.user?.name || 'ไม่ระบุชื่อ')} · ${escapeHtml(item.target_uid || '')}</div>
            </div>
            <span class="badge bg-${meta.tone}-subtle text-${meta.tone}-emphasis rounded-pill">${meta.label}</span>
          </div>
          <div class="small mt-3"><span class="text-muted">สาเหตุ:</span> ${escapeHtml(AUTH_ERROR_LABEL[item.error_code] || 'ยืนยันตัวตนไม่สำเร็จ')}</div>
          <div class="small text-muted mt-1">แจ้งล่าสุด ${escapeHtml(formatDateTime(item.last_requested_at))} · ${Number(item.request_count || 1)} ครั้ง</div>
          <div class="d-flex align-items-center justify-content-between gap-2 mt-3 pt-2 border-top">
            <span class="badge bg-${delivery.tone}-subtle text-${delivery.tone}-emphasis"><i class="fa-brands fa-line me-1"></i>${delivery.label}</span>
            <div class="d-flex gap-1">
              ${delivery.failed ? `<button class="btn btn-sm btn-outline-danger rounded-pill" onclick="retryAuthHelpNotification('${escapeHtml(delivery.failed.id)}')">ส่ง LINE ใหม่</button>` : ''}
              <button class="btn btn-sm ${canApprove ? 'btn-primary' : 'btn-outline-primary'} rounded-pill" onclick="openAuthHelpCase('${escapeHtml(item.id)}')">${canApprove ? 'ดำเนินการ' : 'ดูรายละเอียด'}</button>
            </div>
          </div>
        </div>`;
    }).join('');
}

window.openAuthHelpCase = async (caseId) => {
    const item = AUTH_HELP_CASES.find(row => String(row.id) === String(caseId));
    if (!item) return;
    const meta = AUTH_HELP_STATUS[item.status] || AUTH_HELP_STATUS.open;
    const delivery = notificationSummary(item);
    const recoveryText = item.recovery_until ? `<br><span class="small text-muted">สิทธิ์ถึง ${escapeHtml(formatDateTime(item.recovery_until))}</span>` : '';
    const result = await Swal.fire({
        title: item.case_no,
        html: `<div class="text-start small">
          <div><b>ผู้ใช้:</b> ${escapeHtml(item.user?.name || 'ไม่ระบุชื่อ')}</div>
          <div><b>UID:</b> <code>${escapeHtml(item.target_uid)}</code></div>
          <div><b>สาเหตุ:</b> ${escapeHtml(AUTH_ERROR_LABEL[item.error_code] || item.error_code)}</div>
          <div><b>สถานะ:</b> ${meta.label}${recoveryText}</div>
          <div><b>LINE:</b> ${delivery.label}</div>
          ${delivery.failed?.last_error ? `<div class="text-danger mt-2">${escapeHtml(delivery.failed.last_error)}</div>` : ''}
        </div>`,
        icon: item.status === 'open' ? 'question' : 'info',
        showCancelButton: item.status === 'open',
        confirmButtonText: item.status === 'open' ? 'เปิดช่วยเหลือ 30 นาที' : 'ปิด',
        cancelButtonText: 'ยกเลิก',
        confirmButtonColor: item.status === 'open' ? '#2563eb' : '#64748b'
    });
    if (item.status === 'open' && result.isConfirmed) await approveAuthHelpCase(item);
};

async function approveAuthHelpCase(item) {
    const noteResult = await Swal.fire({
        title: 'ระบุเหตุผลการอนุมัติ',
        input: 'textarea',
        inputPlaceholder: 'เช่น ผู้ใช้ยืนยันตัวตนผ่าน LINE ไม่สำเร็จและตรวจสอบข้อมูลแล้ว',
        inputAttributes: { maxlength:'300' },
        showCancelButton: true,
        confirmButtonText: 'อนุมัติและส่ง LINE',
        cancelButtonText: 'ยกเลิก',
        inputValidator: value => String(value || '').trim().length < 3 ? 'กรุณาระบุเหตุผลอย่างน้อย 3 ตัวอักษร' : undefined
    });
    if (!noteResult.isConfirmed) return;
    try {
        Swal.fire({ title:'กำลังเปิดโหมดช่วยเหลือ...', allowOutsideClick:false, didOpen:() => Swal.showLoading() });
        const response = await fetch(API_ACTIONS, {
            method:'POST', headers:{ 'Content-Type':'application/json' },
            body:JSON.stringify({
                action:'auth_recovery_open',
                adminUid:getCurrentAdminUid(),
                targetUid:item.target_uid,
                caseId:item.id,
                durationMinutes:30,
                note:String(noteResult.value || '').trim()
            })
        });
        const payload = await response.json();
        if (!response.ok || payload.status !== 'success') throw new Error(payload.message || 'อนุมัติไม่สำเร็จ');
        const lineStatus = payload.data?.lineNotification?.status;
        await Swal.fire({
            title:'เปิดโหมดช่วยเหลือแล้ว',
            text:lineStatus === 'sent' ? 'ส่งลิงก์กลับเข้าสู่ระบบให้ผู้ใช้ทาง LINE แล้ว' : 'เปิดสิทธิ์แล้ว แต่ส่ง LINE ไม่สำเร็จ สามารถกดส่งใหม่จากรายการได้',
            icon:lineStatus === 'sent' ? 'success' : 'warning'
        });
        await Promise.all([loadAuthHelpCases(), loadPageUsers()]);
    } catch (error) {
        Swal.fire('ดำเนินการไม่สำเร็จ', error.message || 'กรุณาลองใหม่', 'error');
    }
}

window.retryAuthHelpNotification = async (notificationId) => {
    try {
        Swal.fire({ title:'กำลังส่ง LINE ใหม่...', allowOutsideClick:false, didOpen:() => Swal.showLoading() });
        const response = await fetch(API_ACTIONS, {
            method:'POST', headers:{ 'Content-Type':'application/json' },
            body:JSON.stringify({ action:'auth_notification_retry', adminUid:getCurrentAdminUid(), notificationId })
        });
        const payload = await response.json();
        if (!response.ok || payload.status !== 'success') throw new Error(payload.message || 'ส่ง LINE ไม่สำเร็จ');
        if (payload.data?.status !== 'sent') throw new Error(payload.data?.last_error || 'LINE ยังรับข้อความไม่ได้');
        await Swal.fire('ส่งแล้ว', 'ส่งข้อความ LINE เรียบร้อย', 'success');
        loadAuthHelpCases();
    } catch (error) {
        Swal.fire('ส่ง LINE ไม่สำเร็จ', error.message || 'กรุณาลองใหม่', 'error');
        loadAuthHelpCases();
    }
};

function openDeepLinkedHelpCase() {
    if (AUTH_HELP_DEEP_LINK_OPENED) return;
    const caseId = new URLSearchParams(window.location.search).get('helpCase');
    if (!caseId) return;
    const item = AUTH_HELP_CASES.find(row => String(row.id) === String(caseId));
    if (!item) return;
    AUTH_HELP_DEEP_LINK_OPENED = true;
    const tabButton = qs('#tabAuthHelpBtn');
    if (tabButton && window.bootstrap?.Tab) bootstrap.Tab.getOrCreateInstance(tabButton).show();
    setTimeout(() => window.openAuthHelpCase(caseId), 200);
}

function renderAuthRecoveryState(user) {
    const auth = user?.auth || {};
    const active = isRecoveryActive(auth);
    const status = qs('#actionAuthStatus');
    const detail = qs('#actionAuthDetail');
    const openBtn = qs('#btnOpenAuthRecovery');
    const closeBtn = qs('#btnCloseAuthRecovery');

    if (!auth.tokenRequired) {
        status.textContent = 'รอย้ายระบบ';
        status.className = 'badge bg-secondary';
        detail.textContent = 'ผู้ใช้ยังเข้าแบบเดิมได้อยู่ จึงยังไม่ต้องเปิดโหมดช่วยเหลือ';
        openBtn?.classList.add('d-none');
        closeBtn?.classList.add('d-none');
        return;
    }

    if (active) {
        status.textContent = 'ช่วยเหลือชั่วคราว';
        status.className = 'badge bg-warning text-dark';
        detail.textContent = `เข้าแบบเดิมได้ถึง ${formatDateTime(auth.recoveryUntil)} · ${auth.recoveryReason || 'ไม่ระบุเหตุผล'}`;
        openBtn?.classList.add('d-none');
        closeBtn?.classList.remove('d-none');
        return;
    }

    status.textContent = 'ยืนยันผ่าน LINE';
    status.className = 'badge bg-success';
    detail.textContent = auth.lastVerifiedAt
      ? `ยืนยันล่าสุด ${formatDateTime(auth.lastVerifiedAt)}`
      : 'ผู้ใช้นี้ต้องยืนยันตัวตนผ่าน LINE';
    openBtn?.classList.remove('d-none');
    closeBtn?.classList.add('d-none');
}

window.openActionModal = (uid) => {
    const u = rows.find(x => x.uid === uid);
    if (!u) return;
    TARGET_USER = u;
    qs("#actionUserName").textContent = u.name;
    qs("#actionUserUID").textContent = u.uid;
    renderAuthRecoveryState(u);
    qs("#adjustAmount").value = "";
    qs("#adjustNote").value = "";
    qs("#radioAdd").checked = true;
    POINT_ADJUST_REQUEST_ID = window.crypto?.randomUUID ? window.crypto.randomUUID() : '';
    new bootstrap.Modal(qs('#actionModal')).show();
};

async function openAuthRecovery() {
    if (!TARGET_USER?.uid || !TARGET_USER.auth?.tokenRequired) return;
    const result = await Swal.fire({
        title: 'เปิดโหมดช่วยเหลือ 30 นาที?',
        html: `ผู้ใช้ <b>${escapeHtml(TARGET_USER.name || TARGET_USER.uid)}</b> จะสามารถเข้าแบบเดิมได้ชั่วคราว<br><span class="text-danger small">ใช้เฉพาะกรณียืนยันตัวตนผ่าน LINE ไม่สำเร็จ</span>`,
        input: 'textarea',
        inputLabel: 'เหตุผลที่เปิดสิทธิ์ชั่วคราว',
        inputPlaceholder: 'เช่น โทรศัพท์เครื่องเดิมยืนยันตัวตนผ่าน LINE ไม่ผ่าน',
        inputAttributes: { maxlength: '300' },
        showCancelButton: true,
        confirmButtonText: 'เปิด 30 นาที',
        cancelButtonText: 'ยกเลิก',
        confirmButtonColor: '#d97706',
        preConfirm: value => {
          const reason = String(value || '').trim();
          if (reason.length < 3) return Swal.showValidationMessage('กรุณาระบุเหตุผลอย่างน้อย 3 ตัวอักษร');
          return reason;
        }
    });
    if (!result.isConfirmed) return;

    try {
      const res = await fetch(API_ACTIONS, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'auth_recovery_open',
          adminUid: getCurrentAdminUid(),
          targetUid: TARGET_USER.uid,
          durationMinutes: 30,
          note: result.value
        })
      });
      const json = await res.json();
      if (!res.ok || json.status !== 'success') throw new Error(json.message || 'recovery_open_failed');
      TARGET_USER.auth = {
        ...TARGET_USER.auth,
        recoveryUntil: json.data.recovery_until,
        recoveryReason: json.data.recovery_reason,
        recoveryBy: json.data.recovery_by
      };
      renderAuthRecoveryState(TARGET_USER);
      applyFilterSortPaginate();
      Swal.fire('เปิดแล้ว', 'แจ้งให้ผู้ใช้กด “เข้าโหมดช่วยเหลือ” ภายใน 30 นาที', 'success');
    } catch (error) {
      Swal.fire('เปิดสิทธิ์ไม่สำเร็จ', error.message || 'กรุณาลองใหม่', 'error');
    }
}

async function closeAuthRecovery() {
    if (!TARGET_USER?.uid) return;
    const confirm = await Swal.fire({
      title: 'ปิดโหมดช่วยเหลือ?',
      text: 'ผู้ใช้จะต้องกลับไปยืนยันตัวตนผ่าน LINE ตามปกติ',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'ปิดทันที',
      cancelButtonText: 'ยกเลิก'
    });
    if (!confirm.isConfirmed) return;

    try {
      const res = await fetch(API_ACTIONS, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'auth_recovery_close',
          adminUid: getCurrentAdminUid(),
          targetUid: TARGET_USER.uid,
          note: 'admin-manual-close'
        })
      });
      const json = await res.json();
      if (!res.ok || json.status !== 'success') throw new Error(json.message || 'recovery_close_failed');
      TARGET_USER.auth = { ...TARGET_USER.auth, recoveryUntil:null, recoveryReason:null, recoveryBy:null };
      renderAuthRecoveryState(TARGET_USER);
      applyFilterSortPaginate();
      Swal.fire('ปิดแล้ว', 'ผู้ใช้ต้องยืนยันตัวตนผ่าน LINE ตามปกติ', 'success');
    } catch (error) {
      Swal.fire('ปิดสิทธิ์ไม่สำเร็จ', error.message || 'กรุณาลองใหม่', 'error');
    }
}

// ⭐ แก้ไข: ฟังก์ชันบันทึกแต้ม (เพิ่มการเช็ค UID ให้ชัวร์)
async function submitAdjust() {
    const mode = document.querySelector('input[name="adjustType"]:checked')?.value; 
    const amount = Number(qs("#adjustAmount")?.value || 0);
    const note = String(qs("#adjustNote")?.value || "").trim();
    
    // ดึง UID ล่าสุด ณ วินาทีที่กดปุ่ม
    const finalAdminUid = getCurrentAdminUid();

    if (!finalAdminUid) {
        return Swal.fire("ไม่พบสิทธิ์แอดมิน", "กรุณาลองรีเฟรชหน้าเว็บ หรือเปิดใหม่ผ่าน LINE", "error");
    }

    if (mode !== "reset" && amount <= 0) return Swal.fire("แจ้งเตือน","กรุณาระบุจำนวนแต้ม","warning");
    if (note.length < 3) return Swal.fire("กรุณาระบุเหตุผล", "เหตุผลต้องมีอย่างน้อย 3 ตัวอักษร เพื่อใช้ตรวจสอบย้อนหลัง", "warning");
    if (!POINT_ADJUST_REQUEST_ID && window.crypto?.randomUUID) POINT_ADJUST_REQUEST_ID = window.crypto.randomUUID();

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
            note,
            requestId: POINT_ADJUST_REQUEST_ID
        })
      });
      const j = await res.json();
      if (!res.ok || j.status !== "success") throw new Error(j.message || "Failed");
      
      const lineSent = j.data?.lineNotification?.status === 'sent';
      POINT_ADJUST_REQUEST_ID = '';
      Swal.fire({
        icon: lineSent ? 'success' : 'warning',
        title: 'บันทึกคะแนนเรียบร้อย',
        text: lineSent ? 'ส่ง Flex Message แจ้งผู้ใช้ทาง LINE แล้ว' : 'ปรับคะแนนสำเร็จ แต่ส่ง LINE ไม่สำเร็จ สามารถส่งใหม่ได้จากเมนูสถานะ LINE'
      });
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

    try {
        const ready = typeof window.RoyalAdminReady === 'function'
          ? await window.RoyalAdminReady()
          : Boolean(getCurrentAdminUid());
        if (!ready) return;
        MY_UID_PAGE = window.CURRENT_ADMIN_UID || sessionStorage.getItem('uid');
        if (!MY_UID_PAGE) return;
        bindEvents();
        loadPageUsers();
        if (new URLSearchParams(window.location.search).has('helpCase')) loadAuthHelpCases();

    } catch (e) { 
        console.error("Boot Error:", e);
        Swal.fire('เริ่มหน้าผู้ดูแลไม่สำเร็จ', 'กรุณาปิดหน้านี้แล้วเปิดจาก LINE อีกครั้ง', 'error');
    }
}

document.addEventListener("DOMContentLoaded", boot);
