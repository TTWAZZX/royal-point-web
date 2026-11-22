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
  return d.toLocaleString('th-TH', { timeZone:'Asia/Bangkok', day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' });
}

function isRecoveryActive(auth) {
  const until = new Date(auth?.recoveryUntil || 0).getTime();
  return Number.isFinite(until) && until > Date.now();
}

function memberAuthStatus(auth) {
  if (!auth?.tokenRequired) return 'legacy';
  return isRecoveryActive(auth) ? 'recovery' : 'verified';
}

function helpOutcomeSummary(helpCase) {
    if (helpCase?.status === 'resolved') {
        const viaRecovery = helpCase.resolution_method === 'recovery_completed';
        return {
            label: viaRecovery ? 'เข้าใช้งานผ่านโหมดช่วยเหลือสำเร็จ' : RoyalStatus.get('migration', 'verified').label,
            tone: 'success',
            icon: 'fa-circle-check',
            time: helpCase.resolved_at || null
        };
    }
    if (helpCase?.status === 'expired') {
        return { label:'ยังไม่พบการยืนยันสำเร็จก่อนหมดเวลา', tone:'secondary', icon:'fa-clock', time:null };
    }
    if (helpCase?.status === 'approved') {
        return { label:'รอผู้ใช้กดลิงก์และกลับเข้าสู่ระบบ', tone:'primary', icon:'fa-hourglass-half', time:null };
    }
    if (helpCase?.status === 'open') {
        return { label:'รอผู้ดูแลดำเนินการ', tone:'warning', icon:'fa-headset', time:null };
    }
    return { label:'ปิดเรื่องโดยยังไม่มีผลยืนยัน', tone:'dark', icon:'fa-circle-minus', time:null };
}

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
             <div class="text-muted small d-flex flex-wrap align-items-center gap-1 text-break">
                <span><i class="fa-regular fa-id-card me-1 opacity-50"></i>${escapeHtml(r.room || r.tel || 'สมาชิกทั่วไป')}</span>
                ${RoyalStatus.badge('migration', memberAuthStatus(r.auth))}
             </div>
          </div>

          <div class="d-flex align-items-center gap-3 flex-shrink-0 ms-3">
             <div class="text-end">
                <div class="fw-bold text-primary" style="font-size:1.2rem; line-height:1;">${fmt(r.score)}</div>
                <div class="small text-muted" style="font-size:0.75rem;">คะแนน</div>
             </div>
             <div class="d-flex gap-1 bg-light rounded-pill p-1 border">
                <button class="btn btn-sm text-secondary rounded-circle" style="width:44px; height:44px;" aria-label="ดูประวัติกิจกรรม" onclick="openHistoryModal(${escapeHtml(JSON.stringify(r.uid))})">
                   <i class="fa-solid fa-clock-rotate-left"></i>
                </button>
                <button class="btn btn-sm btn-white text-primary shadow-sm rounded-circle" style="width:44px; height:44px;" aria-label="จัดการสมาชิก" onclick="openActionModal(${escapeHtml(JSON.stringify(r.uid))})">
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
  qs('#btnRecoverSafetyPoints')?.addEventListener('click', recoverSafetyCheckinPoints);
  qs('#memberProfileToggle').parentElement.addEventListener('toggle', event => {
    if (event.currentTarget.open && !memberProfileSnapshot) void loadMemberProfile();
  });
  qs('#memberProfileReload').addEventListener('click', loadMemberProfile);
  qs('#memberProfileForm').addEventListener('submit', saveMemberProfile);
  qs('#actionModal').addEventListener('hidden.bs.modal', resetMemberProfile);
  qs('#memberHistoryCategory').addEventListener('change', () => loadMemberHistory());
  qs('#memberHistoryMore').addEventListener('click', () => loadMemberHistory(true));
  qs('#birthdayRunDate').addEventListener('change', () => loadBirthdayRuns());
  qs('#birthdayRunToday').addEventListener('click', () => {
    qs('#birthdayRunDate').value = todayBangkokInputValue();
    void loadBirthdayRuns();
  });
  qs('#birthdayRunRefresh').addEventListener('click', loadBirthdayOverview);
  qs('#birthdayRunMore').addEventListener('click', () => loadBirthdayRuns(true));
  qs('#birthdayUpcomingList').addEventListener('click', event => {
    const day = event.target.closest('button[data-birthday-date]')?.dataset.birthdayDate;
    if (!day) return;
    qs('#birthdayRunDate').value = day;
    void loadBirthdayRuns();
  });
  qs('#birthdayRunResult').addEventListener('click', retryBirthdayNotification);
  qs('#birthdayRunLine').addEventListener('click', () => {
    qs('#lineNotificationKind').value = 'birthday_reward';
    qs('#lineNotificationStatus').value = 'all';
    qs('#lineNotificationSearch').value = '';
    const dateFilter = qs('#lineNotificationDate');
    if (dateFilter) dateFilter.value = '';
    bootstrap.Tab.getOrCreateInstance(qs('#tabLineNotificationsBtn')).show();
  });
  qs("#authHelpSearch")?.addEventListener("input", debounce(renderAuthHelpCases, 250));
  qs("#authHelpStatusFilter")?.addEventListener("change", () => loadAdminTabData('#pills-auth-help'));
  qs("#btnRefreshAuthHelp")?.addEventListener("click", loadAuthHelpCases);
}

function notificationSummary(helpCase) {
    const items = Array.isArray(helpCase?.notifications) ? helpCase.notifications : [];
    if (!items.length) return { status: 'missing', failed: null };
    const failed = items.find(item => item.status === 'failed');
    if (failed) return { status: 'failed', failed };
    const pending = items.find(item => item.status === 'pending');
    return { status: pending ? 'pending' : items[0].status, failed: null };
}

let latestAuthHelpRequest;
async function loadAuthHelpCases() {
    const area = qs('#authHelpListArea');
    if (!area) return;
    const request = latestAuthHelpRequest = Symbol();
    const openOnly = qs('#authHelpStatusFilter')?.value === 'open';
    area.innerHTML = '<div class="text-center py-5"><div class="spinner-border spinner-border-sm text-primary"></div><div class="small text-muted mt-2">กำลังโหลดเรื่องช่วยเหลือ...</div></div>';
    try {
        const adminUid = getCurrentAdminUid();
        const query = new URLSearchParams({ action: 'auth_help_cases', adminUid: adminUid || '', status: openOnly ? 'open' : 'all' });
        const response = await fetch(`${API_ACTIONS}?${query}`, { cache:'no-store' });
        const payload = await response.json();
        if (request !== latestAuthHelpRequest) return;
        if (!response.ok || payload.status !== 'success') throw new Error(payload.message || 'โหลดเรื่องช่วยเหลือไม่สำเร็จ');
        AUTH_HELP_CASES = Array.isArray(payload.data) ? payload.data : [];
        const openCount = AUTH_HELP_CASES.filter(item => item.status === 'open').length;
        const count = qs('#authHelpOpenCount');
        if (count && !openOnly) {
            count.textContent = String(openCount);
            count.classList.toggle('d-none', openCount === 0);
        }
        renderAuthHelpCases();
        openDeepLinkedHelpCase();
    } catch (error) {
        if (request !== latestAuthHelpRequest) return;
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
        const empty = statusFilter === 'open' && !term ? 'ไม่มีเรื่องช่วยเหลือรอดำเนินการ' : 'ไม่พบเรื่องช่วยเหลือ';
        area.innerHTML = `<div class="m-card text-center py-5 text-muted"><i class="fa-solid fa-headset fa-2x mb-3 opacity-25"></i><br>${empty}</div>`;
        return;
    }
    area.innerHTML = filtered.map(item => {
        const delivery = notificationSummary(item);
        const outcome = helpOutcomeSummary(item);
        const canApprove = item.status === 'open';
        return `<div class="m-card" id="auth-help-case-${escapeHtml(item.id)}">
          <div class="d-flex flex-wrap align-items-start justify-content-between gap-2">
            <div style="min-width:0">
              <div class="fw-bold text-dark">${escapeHtml(item.case_no)}</div>
              <div class="text-muted small text-truncate">${escapeHtml(item.user?.name || 'ไม่ระบุชื่อ')} · ${escapeHtml(item.target_uid || '')}</div>
            </div>
            ${RoyalStatus.badge('help', item.status)}
          </div>
          <div class="small mt-3"><span class="text-muted">สาเหตุ:</span> ${escapeHtml(AUTH_ERROR_LABEL[item.error_code] || 'ยืนยันตัวตนไม่สำเร็จ')}</div>
          <div class="small text-muted mt-1">แจ้งล่าสุด ${escapeHtml(formatDateTime(item.last_requested_at))} · ${Number(item.request_count || 1)} ครั้ง</div>
          <div class="small mt-2 text-${outcome.tone}-emphasis"><i class="fa-solid ${outcome.icon} me-1"></i><b>ผลผู้ใช้:</b> ${escapeHtml(outcome.label)}${outcome.time ? ` · ${escapeHtml(formatDateTime(outcome.time))}` : ''}</div>
          <div class="d-flex flex-wrap align-items-center justify-content-between gap-2 mt-3 pt-2 border-top">
            ${RoyalStatus.badge('delivery', delivery.status)}
            <div class="d-flex gap-1 rp-status-actions">
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
    const delivery = notificationSummary(item);
    const outcome = helpOutcomeSummary(item);
    const recoveryText = item.recovery_until ? `<br><span class="small text-muted">สิทธิ์ถึง ${escapeHtml(formatDateTime(item.recovery_until))}</span>` : '';
    const result = await Swal.fire({
        title: item.case_no,
        html: `<div class="text-start small">
          <div><b>ผู้ใช้:</b> ${escapeHtml(item.user?.name || 'ไม่ระบุชื่อ')}</div>
          <div><b>UID:</b> <code>${escapeHtml(item.target_uid)}</code></div>
          <div><b>สาเหตุ:</b> ${escapeHtml(AUTH_ERROR_LABEL[item.error_code] || item.error_code)}</div>
          <div><b>สถานะ:</b> ${RoyalStatus.badge('help', item.status)}${recoveryText}</div>
          <div><b>ผลผู้ใช้:</b> <span class="text-${outcome.tone}-emphasis">${escapeHtml(outcome.label)}</span>${outcome.time ? ` เมื่อ ${escapeHtml(formatDateTime(outcome.time))}` : ''}</div>
          <div>${RoyalStatus.badge('delivery', delivery.status)}</div>
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
    const authState = memberAuthStatus(auth);
    const { label, tone } = RoyalStatus.get('migration', authState);
    const status = qs('#actionAuthStatus');
    status.textContent = label;
    status.className = `rp-status rp-status--${tone}`;
    const detail = qs('#actionAuthDetail');
    const openBtn = qs('#btnOpenAuthRecovery');
    const closeBtn = qs('#btnCloseAuthRecovery');

    if (authState === 'legacy') {
        detail.textContent = 'ผู้ใช้ยังเข้าแบบเดิมได้อยู่ จึงยังไม่ต้องเปิดโหมดช่วยเหลือ';
        openBtn?.classList.add('d-none');
        closeBtn?.classList.add('d-none');
        return;
    }

    if (authState === 'recovery') {
        detail.textContent = `เข้าแบบเดิมได้ถึง ${formatDateTime(auth.recoveryUntil)} · ${auth.recoveryReason || 'ไม่ระบุเหตุผล'}`;
        openBtn?.classList.add('d-none');
        closeBtn?.classList.remove('d-none');
        return;
    }

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
    resetMemberProfile();
    qs("#actionUserName").textContent = u.name;
    qs("#actionUserUID").textContent = u.uid;
    renderAuthRecoveryState(u);
    qs("#adjustAmount").value = "";
    qs("#adjustNote").value = "";
    qs("#radioAdd").checked = true;
    const recoveryDate = qs('#safetyRecoveryDate');
    recoveryDate.value = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Bangkok' }).format(new Date());
    recoveryDate.max = recoveryDate.value;
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

async function recoverSafetyCheckinPoints(event) {
    const member = TARGET_USER;
    const checkinDate = qs('#safetyRecoveryDate').value;
    if (!member?.uid || !checkinDate) {
      return Swal.fire('กรุณาเลือกวันที่เช็กอิน', '', 'warning');
    }

    const button = event.currentTarget;
    button.disabled = true;
    try {
      const confirmation = await Swal.fire({
        title: 'ตรวจและเติมคะแนนเช็กอิน',
        text: `${member.name || member.uid} · ${checkinDate} ระบบจะเติมเฉพาะคะแนนเช็กอินหรือโบนัสสัปดาห์นั้นที่ยังขาด`,
        icon: 'question', showCancelButton: true, confirmButtonText: 'ตรวจและเติมคะแนน', cancelButtonText: 'ยกเลิก'
      });
      if (!confirmation.isConfirmed) return;

      const result = await adminAction({ action: 'safety_checkin_points_recover', targetUid: member.uid, checkinDate });
      if (!result.dailyAdded && !result.weeklyAdded) {
        return Swal.fire('ตรวจสอบแล้ว', 'คะแนนที่มีสิทธิ์ได้รับในวันที่เลือกครบแล้ว', 'info');
      }
      void loadPageUsers();
      return Swal.fire('เติมคะแนนเรียบร้อย', `คะแนนเช็กอิน ${result.dailyAdded} คะแนน · โบนัสรายสัปดาห์ ${result.weeklyAdded} คะแนน`, 'success');
    } catch (error) {
      const text = [error.message, error.correlationId && `เลขอ้างอิง ${error.correlationId}`].filter(Boolean).join('\n');
      return Swal.fire('ตรวจคะแนนไม่สำเร็จ', text, 'error');
    } finally {
      button.disabled = false;
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

async function readMemberOperation(action, params = {}) {
    const query = new URLSearchParams({ action, adminUid: getCurrentAdminUid(), ...params });
    const response = await fetch(`${API_ACTIONS}?${query}`, { cache: 'no-store' });
    const result = await response.json();
    if (!response.ok || result.status !== 'success') throw new Error('read_failed');
    return result;
}

const MEMBER_PROFILE_LABELS = {
    name: 'ชื่อ–นามสกุล', room: 'หน่วยงาน / ห้อง', dob: 'วันเกิด', tel: 'เบอร์โทรศัพท์', passport: 'เลขพาสปอร์ต / เลขประจำตัว'
};

function formatMemberProfileFields(fields) {
    return Array.isArray(fields) ? fields.filter(key => Object.hasOwn(MEMBER_PROFILE_LABELS, key)).map(key => MEMBER_PROFILE_LABELS[key]).join(' · ') : '';
}

let memberProfileSnapshot;
let memberProfileVersion = 0;

function resetMemberProfile() {
    memberProfileVersion++;
    memberProfileSnapshot = null;
    qs('#memberProfileToggle').parentElement.open = false;
    qs('#memberProfileForm').reset();
    qs('#memberProfileForm').hidden = true;
    qs('#memberProfileFields').disabled = false;
    qs('#memberProfileReload').hidden = true;
    qs('#memberProfileStatus').textContent = '';
    qs('#memberLegacyDob').textContent = '';
}

async function loadMemberProfile() {
    if (!TARGET_USER) return;
    const version = ++memberProfileVersion;
    const form = qs('#memberProfileForm');
    const status = qs('#memberProfileStatus');
    const reload = qs('#memberProfileReload');
    form.hidden = true;
    qs('#memberProfileFields').disabled = false;
    status.textContent = 'กำลังโหลดข้อมูลส่วนตัว';
    reload.hidden = true;
    try {
        const { data } = await readMemberOperation('member_profile', { targetUid: TARGET_USER.uid });
        if (version !== memberProfileVersion) return;
        RoyalRooms.fill(form.elements.namedItem('room'), data.room || '');
        const shown = {};
        for (const field of Object.keys(MEMBER_PROFILE_LABELS)) {
            const input = form.elements.namedItem(field);
            input.value = data[field] || '';
            shown[field] = input.value;
        }
        const dob = form.elements.namedItem('dob');
        dob.max = todayBangkokInputValue();
        qs('#memberLegacyDob').textContent = data.dob && !dob.value ? `ข้อมูลเดิม: ${data.dob} หากต้องการแก้ไข ให้เลือกวันเกิดจากปฏิทิน` : '';
        memberProfileSnapshot = { data, shown };
        status.textContent = '';
        form.hidden = false;
    } catch {
        if (version !== memberProfileVersion) return;
        status.textContent = 'โหลดข้อมูลส่วนตัวไม่สำเร็จ กรุณาลองใหม่';
        reload.hidden = false;
    }
}

async function saveMemberProfile(event) {
    event.preventDefault();
    if (!memberProfileSnapshot || !TARGET_USER) return;
    const form = event.currentTarget;
    const fields = qs('#memberProfileFields');
    if (fields.disabled) return;
    const { data, shown } = memberProfileSnapshot;
    const patch = Object.fromEntries([...new FormData(form)].filter(([key, value]) => value !== shown[key] && value.trim() !== shown[key]));
    const status = qs('#memberProfileStatus');
    if (!Object.keys(patch).length) {
        status.textContent = 'ยังไม่มีข้อมูลที่เปลี่ยนแปลง';
        return;
    }
    const version = memberProfileVersion;
    fields.disabled = true;
    status.textContent = 'กำลังบันทึกข้อมูลส่วนตัว';
    try {
        const response = await fetch(API_ACTIONS, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'member_profile_update', adminUid: getCurrentAdminUid(),
                targetUid: TARGET_USER.uid, profile: patch,
                expected: Object.fromEntries(Object.keys(patch).map(key => [key, data[key]])) })
        });
        const result = await response.json();
        if (version !== memberProfileVersion) return;
        if (!response.ok || result.status !== 'success') {
            status.textContent = result.message || 'บันทึกข้อมูลไม่สำเร็จ กรุณาลองใหม่';
            if (response.status === 409) qs('#memberProfileReload').hidden = false;
            return;
        }
        if (patch.name) qs('#actionUserName').textContent = patch.name.trim();
        void loadPageUsers();
        const refreshVersion = memberProfileVersion + 1;
        await loadMemberProfile();
        if (memberProfileVersion === refreshVersion && !form.hidden) status.textContent = 'บันทึกข้อมูลส่วนตัวแล้ว';
    } catch {
        if (version === memberProfileVersion) status.textContent = 'ยังยืนยันผลการบันทึกไม่ได้ กรุณาลองบันทึกอีกครั้ง';
    } finally {
        if (version === memberProfileVersion) fields.disabled = false;
    }
}

const MEMBER_ACTIVITY_LABELS = {
    BIRTHDAY_REWARD: 'คะแนนวันเกิด', DAILY_CHECKIN: 'คะแนนเช็กอิน', WEEKLY_SAFETY_MISSION: 'โบนัสเช็กอินรายสัปดาห์',
    COUPON_REDEEM: 'คะแนนจากคูปอง', SPEND_REWARD: 'ใช้คะแนนแลกรางวัล', REDEMPTION_REFUND: 'คืนคะแนนจากการแลกรางวัล',
    ADMIN_ADJUST: 'ผู้ดูแลปรับคะแนน', ADMIN_GIVE: 'แจกคะแนน', reward_redemption: 'แลกรางวัล',
    coupon_assigned: 'ได้รับคูปอง', coupon_redeemed: 'ใช้คูปอง', coupon_cancelled: 'ยกเลิกคูปอง', safety_checkin: 'เช็กอินความปลอดภัย'
};
let memberHistory = { uid: '', offset: 0, before: '', version: 0 };

window.openHistoryModal = (uid) => {
    const member = rows.find(row => row.uid === uid);
    qs('#memberHistoryTitle').textContent = member?.name ? `ประวัติกิจกรรม · ${member.name}` : 'ประวัติกิจกรรมสมาชิก';
    qs('#memberHistoryCategory').value = 'all';
    memberHistory.uid = uid;
    new bootstrap.Modal(qs('#historyModal')).show();
    return loadMemberHistory();
};

async function loadMemberHistory(append = false) {
    if (!memberHistory.uid) return;
    const version = ++memberHistory.version;
    const items = qs('#memberHistoryItems');
    const status = qs('#memberHistoryStatus');
    const more = qs('#memberHistoryMore');
    if (!append) {
        items.replaceChildren();
        memberHistory.offset = 0;
        memberHistory.before = '';
    }
    more.hidden = true;
    status.textContent = 'กำลังโหลดประวัติกิจกรรม';
    try {
        const result = await readMemberOperation('member_activity', {
            targetUid: memberHistory.uid, category: qs('#memberHistoryCategory').value,
            offset: memberHistory.offset, before: memberHistory.before
        });
        if (version !== memberHistory.version) return;
        items.insertAdjacentHTML('beforeend', result.data.map(item => {
            const title = MEMBER_ACTIVITY_LABELS[item.activity] || AUDIT_EVENT_META[item.activity]?.label || (item.category === 'points' ? 'เปลี่ยนแปลงคะแนน' : 'กิจกรรมในระบบ');
            const state = item.category === 'rewards' ? RoyalStatus.badge('redemption', item.state)
                : item.category === 'safety' && item.state && item.state !== 'none' ? RoyalStatus.badge('safety', item.state) : '';
            const detail = [item.label, formatMemberProfileFields(item.fields)].filter(Boolean).join(' · ');
            const points = item.points === null ? '' : `${Number(item.points) > 0 ? '+' : ''}${fmt(item.points)} คะแนน`;
            return `<article class="list-group-item px-0 d-flex align-items-start justify-content-between flex-wrap gap-2">
                <div class="text-break"><div class="fw-bold">${escapeHtml(title)}</div>
                  <div class="small text-muted">${escapeHtml(formatDateTime(item.happened_at))}</div>
                  ${detail ? `<div class="small">${escapeHtml(detail)}</div>` : ''}
                </div><div>${state}${points ? `<span class="fw-bold">${points}</span>` : ''}</div>
              </article>`;
        }).join(''));
        memberHistory.before = result.before;
        memberHistory.offset += result.data.length;
        status.textContent = memberHistory.offset ? '' : 'ไม่มีประวัติกิจกรรมในหมวดนี้';
        more.textContent = 'โหลดเพิ่มเติม';
        more.hidden = !result.hasMore;
    } catch {
        if (version !== memberHistory.version) return;
        status.textContent = 'โหลดประวัติไม่สำเร็จ กรุณาลองใหม่';
        more.textContent = 'ลองใหม่';
        more.hidden = false;
    }
}

let birthdayReportOffset = 0;
let birthdayReportVersion = 0;
const birthdayDateFormat = new Intl.DateTimeFormat('th-TH', {
    day: 'numeric', month: 'long', year: 'numeric', era: 'short', timeZone: 'UTC'
});
const birthdayRunDayFormat = new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const birthdayDeliveryTimeFormat = new Intl.DateTimeFormat('th-TH', {
    dateStyle: 'short', timeStyle: 'medium', timeZone: 'Asia/Bangkok'
});

async function loadBirthdayOverview() {
    const upcoming = qs('#birthdayUpcomingList');
    upcoming.textContent = 'กำลังโหลดคิวล่วงหน้า';
    await Promise.all([loadBirthdayRuns(), (async () => {
        try {
            const { data } = await readMemberOperation('birthday_upcoming');
            upcoming.innerHTML = data.map(day => `<button type="button" class="btn btn-sm btn-outline-primary" data-birthday-date="${escapeHtml(day.run_date)}">${birthdayRunDayFormat.format(new Date(`${day.run_date}T00:00:00Z`))} · รอแจก ${fmt(day.scheduled_members)} คน</button>`).join('');
        } catch {
            upcoming.textContent = 'โหลดคิวล่วงหน้าไม่สำเร็จ กรุณากดโหลดผลวันที่เลือกอีกครั้ง';
        }
    })()]);
}

function birthdayDeliveryMarkup(delivery) {
    if (!delivery) return RoyalStatus.badge('delivery', 'missing');
    if (delivery.line_status === 'sent') {
        const confirmed = delivery.line_confirmed_at && new Date(delivery.line_confirmed_at);
        const recovered = delivery.line_acceptance_recovered;
        const timeLabel = recovered === false ? 'เวลาที่ LINE ตอบรับ' : recovered ? 'เวลาที่ระบบยืนยันผล' : 'เวลาที่บันทึกไว้';
        return `<div class="small">
          <span class="rp-status rp-status--success">${recovered == null ? 'บันทึกว่าส่ง LINE แล้ว' : 'LINE รับคำขอแล้ว'}</span>
          ${confirmed && Number.isFinite(confirmed.getTime()) ? `<div class="mt-1">${timeLabel} ${birthdayDeliveryTimeFormat.format(confirmed)} น.</div>` : ''}
          ${delivery.line_request_id ? `<div class="text-muted text-break">เลขอ้างอิง LINE ${escapeHtml(delivery.line_request_id)}</div>` : ''}
        </div>`;
    }
    const retryable = ['pending', 'failed'].includes(delivery.line_status) && delivery.notification_id;
    const expired = Date.now() - Date.parse(delivery.line_queued_at) >= 86400000;
    return `<div class="small">
      ${RoyalStatus.badge('delivery', delivery.line_status || 'missing')}
      ${delivery.line_last_error ? `<div class="text-danger mt-1">${escapeHtml(delivery.line_last_error)}</div>` : ''}
      ${retryable && expired ? '<div class="text-muted mt-1">เกินช่วงส่งซ้ำ 24 ชั่วโมง กรุณาตรวจสอบกับผู้รับ</div>' : ''}
      ${retryable && !expired ? `<div class="rp-status-actions"><button type="button" class="btn btn-sm btn-outline-danger mt-1" data-birthday-retry="${escapeHtml(delivery.notification_id)}">${delivery.line_status === 'failed' ? 'ส่ง LINE ซ้ำ' : 'ส่ง LINE ตอนนี้'}</button></div>` : ''}
    </div>`;
}

async function retryBirthdayNotification(event) {
    const button = event.target.closest('button[data-birthday-retry]');
    if (!button || button.disabled) return;
    const date = qs('#birthdayRunDate').value;
    const notice = qs('#birthdayRetryStatus');
    button.disabled = true;
    notice.textContent = 'กำลังส่งข้อความไปที่ LINE';
    try {
        const data = await adminAction({ action: 'birthday_notification_retry', notificationId: button.dataset.birthdayRetry });
        if (qs('#birthdayRunDate').value !== date) return;
        await loadBirthdayRuns();
        if (qs('#birthdayRunDate').value === date) notice.textContent = data.status === 'sent' ? 'LINE รับคำขอแล้ว' : data.last_error || 'ส่ง LINE ไม่สำเร็จ';
    } catch {
        if (qs('#birthdayRunDate').value === date) notice.textContent = 'ยังยืนยันผลการส่งไม่ได้ กรุณาโหลดผลวันที่เลือกอีกครั้ง';
    } finally {
        button.disabled = false;
    }
}

function formatMemberBirthday(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'ไม่ระบุวันเกิด';
    const date = new Date(`${value}T00:00:00Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return 'ไม่ระบุวันเกิด';
    return `วันเกิด ${birthdayDateFormat.format(date)}`;
}

async function loadBirthdayRuns(append = false) {
    const date = qs('#birthdayRunDate');
    const today = todayBangkokInputValue();
    const latest = new Date(`${today}T00:00:00Z`);
    latest.setUTCDate(latest.getUTCDate() + 30);
    date.max = latest.toISOString().slice(0, 10);
    if (!date.value) date.value = today;
    const resultArea = qs('#birthdayRunResult');
    const more = qs('#birthdayRunMore');
    const version = ++birthdayReportVersion;
    if (!append) {
        qs('#birthdayRetryStatus').textContent = '';
        birthdayReportOffset = 0;
        resultArea.textContent = 'กำลังโหลดผลรอบวันเกิด';
    }
    more.hidden = true;
    try {
        const { data } = await readMemberOperation('birthday_runs', { date: date.value, offset: birthdayReportOffset });
        if (version !== birthdayReportVersion) return;
        if (!append) {
            const attempt = data.lastAttempt;
            const heading = data.upcoming ? 'ยังไม่ถึงวันแจกคะแนน' : data.run ? 'รอบแจกคะแนนทำงานสำเร็จ'
                : attempt?.event_type === 'birthday_reward_failed' ? 'ระบบแจกคะแนนรอบนี้ไม่สำเร็จ' : 'ยังไม่มีบันทึกผลรอบนี้';
            const tone = data.run ? 'success' : attempt?.event_type === 'birthday_reward_failed' ? 'danger' : 'waiting';
            resultArea.innerHTML = `<section class="m-card mb-3">
              <span class="rp-status rp-status--${tone}">${heading}</span>
              ${attempt ? `<p class="small mt-2 mb-0">บันทึกผลรอบแจกคะแนนล่าสุด ${escapeHtml(formatDateTime(attempt.created_at))} น.${attempt.event_type === 'birthday_reward_failed' ? ' · พบข้อผิดพลาด' : ''}${attempt.correlation_id ? ` · เลขอ้างอิง ${escapeHtml(attempt.correlation_id)}` : ''}</p>` : ''}
              <dl class="row g-2 mt-2 mb-0">
                <div class="col-6 col-md-3"><dt>สมาชิกในรายงาน</dt><dd>${fmt(data.total)} คน</dd></div>
                <div class="col-6 col-md-3"><dt>ได้รับคะแนนในรอบนี้</dt><dd>${data.run ? `${fmt(data.run.reward_count)} คน` : '—'}</dd></div>
                <div class="col-6 col-md-3"><dt>ได้รับคะแนนวันเกิดไปแล้วในปีนี้</dt><dd>${fmt(data.previouslyAwarded)} คน</dd></div>
                <div class="col-6 col-md-3"><dt>${data.upcoming ? 'รอแจกคะแนน' : 'ยังไม่มีบันทึกว่าได้รับคะแนน'}</dt><dd>${fmt(data.notAwarded)} คน</dd></div>
              </dl>
              ${data.awarded ? `<p class="small mb-0">บันทึกว่าส่ง LINE แล้ว ${fmt(data.lineSent)} จาก ${fmt(data.awarded)} รายการ</p>` : ''}
            </section><div id="birthdayRunMembers"></div>`;
        }
        const members = qs('#birthdayRunMembers');
        members.insertAdjacentHTML('beforeend', data.items.map(member => {
            const awarded = member.state === 'awarded';
            const history = member.state === 'previously_awarded';
            return `<article class="m-card d-flex flex-wrap align-items-center justify-content-between gap-2 text-break">
                <div>
                  <div class="fw-bold">${escapeHtml(member.name || 'ไม่ระบุชื่อ')}</div>
                  <div class="small text-muted">${escapeHtml(member.room || 'ไม่ระบุหน่วยงาน')}</div>
                  <div class="small mt-1">${escapeHtml(formatMemberBirthday(member.dob))}</div>
                </div>
                <div class="d-flex flex-wrap align-items-start gap-2"><span class="rp-status rp-status--${awarded ? 'success' : history ? 'info' : 'waiting'}">${awarded ? 'ได้รับคะแนนในรอบนี้' : history ? 'ได้รับคะแนนวันเกิดไปแล้วในปีนี้' : data.upcoming ? 'รอแจกคะแนน' : 'ยังไม่มีบันทึกว่าได้รับคะแนน'}</span>
                ${awarded ? birthdayDeliveryMarkup(member.delivery) : ''}</div></article>`;
        }).join(''));
        birthdayReportOffset += data.items.length;
        if (!birthdayReportOffset) members.textContent = 'ไม่พบสมาชิกที่มีวันเกิดหรือได้รับคะแนนในรอบนี้';
        more.textContent = 'โหลดสมาชิกเพิ่มเติม';
        more.hidden = birthdayReportOffset >= data.total;
    } catch {
        if (version !== birthdayReportVersion) return;
        if (!append) resultArea.textContent = 'โหลดผลรอบวันเกิดไม่สำเร็จ กรุณากดโหลดผลวันที่เลือกอีกครั้ง';
        else {
            more.textContent = 'ลองโหลดสมาชิกเพิ่มเติมอีกครั้ง';
            more.hidden = false;
        }
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
        window.SystemBoot?.hide?.();
        if (typeof window.RoyalAdminInitialTabReady === 'function') {
          await window.RoyalAdminInitialTabReady();
        }

    } catch (e) { 
        console.error("Boot Error:", e);
        window.SystemBoot?.hide?.();
        Swal.fire('เริ่มหน้าผู้ดูแลไม่สำเร็จ', 'กรุณาปิดหน้านี้แล้วเปิดจาก LINE อีกครั้ง', 'error');
    }
}

document.addEventListener("DOMContentLoaded", boot);
