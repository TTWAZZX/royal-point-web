/**
 * admin.js - Core Admin Logic
 * หน้าที่หลัก:
 * 1. Init LIFF / Auth เพื่อหา ADMIN_UID
 * 2. จัดการแท็บคูปอง (Load, Generate, QR)
 * 3. จัดการฟังก์ชันพิเศษ (Giveaway แจกแต้มทุกคน)
 * * หมายเหตุ: ตารางรายชื่อสมาชิก (Users Table) ถูกแยกไปจัดการใน admin.page.js แล้ว
 */

// ============ CONFIG ============
const LIFF_ID_ADMIN     = "2007053300-QoEvbXyn"; // ตั้งชื่อไม่ให้ชนกับที่อื่น
const API_COUPON_LIST   = "/api/admin-coupons";
const API_COUPON_GEN    = "/api/admin-coupons-generate";
const API_ADMIN_ACTIONS = "/api/admin-actions";
const API_AUDIT_LOGS    = "/api/admin-audit-logs";

// ============ STATE ============
let ADMIN_UID = "";
let COUPON_ROWS = [];
let COUPON_FILTER = 'all';
let AUDIT_ROWS = [];
let SAFETY_PULSE = null;
let SAFETY_PULSE_TAB = 'action';
let SAFETY_PULSE_FILTER = { room: 'all', status: 'open', type: 'all' };
let SAFETY_QUESTIONS = [];
let MONTHLY_SAFETY = null;

function scrollSafetySubtabIntoView() {
    const anchor = document.querySelector('.safety-subnav-card');
    if (!anchor) return;
    const targetTop = Math.max(0, anchor.getBoundingClientRect().top + window.scrollY - 76);
    if (Math.abs(window.scrollY - targetTop) > 12) {
        window.scrollTo({ top: targetTop, behavior: 'smooth' });
    }
}

// ============ UI Helper ============
const $id = (x) => document.getElementById(x);

// Overlay (Reused from pageOverlay if available, else fallback)
const sysOverlay = window.pageOverlay || {
  show: (t) => console.log('Loading...', t),
  hide: () => console.log('Loaded')
};

function toastOk(message) {
  if (window.Swal) return Swal.fire('สำเร็จ', message || '', 'success');
  return alert(message || 'สำเร็จ');
}

function toastErr(message) {
  if (window.Swal) return Swal.fire('ผิดพลาด', message || '', 'error');
  return alert(message || 'ผิดพลาด');
}

// ============ INIT ============
document.addEventListener("DOMContentLoaded", async () => {
  await initAdminSystem();
  bindGlobalEvents();
});

async function initAdminSystem() {
  try {
    // 1. LIFF / Auth Check
    if (typeof liff !== 'undefined') {
      try {
        await liff.init({ liffId: LIFF_ID_ADMIN });
        if (liff.isLoggedIn()) {
          const profile = await liff.getProfile();
          ADMIN_UID = profile.userId;
          // แสดงชื่อแอดมิน (ถ้ามี Element)
          const nameEl = $id('adminName');
          if (nameEl) nameEl.textContent = profile.displayName;
        } else {
           // ถ้ายังไม่ล็อกอิน ให้ login ก่อน (หรือจะปล่อยผ่านถ้า test ในคอม)
           // liff.login(); 
        }
      } catch (e) {
        console.warn('LIFF Init failed:', e);
      }
    }

    // Fallback: ถ้า LIFF ไม่ได้ หรือ Test ในคอม ให้เอาจาก Storage
    if (!ADMIN_UID) {
      ADMIN_UID = sessionStorage.getItem('uid') || localStorage.getItem('uid');
    }

    // แสดง UID ที่ Navbar
    if (ADMIN_UID) {
      const uidEl = $id('adminUid');
      if (uidEl) uidEl.textContent = `UID: ${ADMIN_UID}`;
      // แชร์ให้ admin.page.js ใช้ด้วย (ถ้าจำเป็น)
      window.CURRENT_ADMIN_UID = ADMIN_UID; 
    } else {
      console.error('Admin UID not found');
      Swal.fire('Error', 'ไม่พบข้อมูลผู้ดูแลระบบ กรุณาเข้าสู่ระบบใหม่', 'error');
    }

    // 2. เริ่มโหลดข้อมูลส่วนคูปอง (ส่วน User ให้ admin.page.js ทำงานเอง)
    if ($id('couponList')) {
        await loadCoupons();
    }

  } catch (err) {
    console.error('Admin Init Error:', err);
  }
}

// ============ COUPONS LOGIC ============
async function loadCoupons() {
  const listEl = $id('couponList');
  if (!listEl) return;

  listEl.innerHTML = '<div class="text-center p-4 text-muted"><div class="spinner-border text-primary mb-2"></div><br>กำลังโหลดข้อมูลคูปอง...</div>';

  try {
    // เรียก API
    const res = await fetch(`${API_COUPON_LIST}?adminUid=${ADMIN_UID}&t=${Date.now()}`);
    if (!res.ok) throw new Error('Network response was not ok');
    
    const json = await res.json();
    COUPON_ROWS = Array.isArray(json.items) ? json.items : (json.data || []);
    
    renderCoupons();
  } catch (e) {
    console.error(e);
    listEl.innerHTML = `<div class="alert alert-danger m-3">โหลดข้อมูลไม่สำเร็จ: ${e.message}</div>`;
  }
}

function renderCoupons() {
  const listEl = $id('couponList');
  if (!listEl) return;

  // กรองข้อมูล
  const filtered = COUPON_ROWS.filter(c => {
    if (COUPON_FILTER === 'used') return c.status === 'used';
    if (COUPON_FILTER === 'unused') return c.status === 'unused';
    return true;
  });

  if (filtered.length === 0) {
    listEl.innerHTML = `
      <div class="text-center p-5 text-muted border rounded-4 bg-light dashed-border">
        <i class="fa-solid fa-ticket fa-2x mb-3 opacity-25"></i><br>
        ไม่พบรายการคูปอง
      </div>`;
    return;
  }

  // Render HTML
  listEl.innerHTML = filtered.map(c => {
    const isUsed = c.status === 'used';
    const badge = isUsed 
      ? `<span class="badge bg-secondary-subtle text-secondary border border-secondary-subtle"><i class="fa-solid fa-check"></i> ใช้แล้ว</span>` 
      : `<span class="badge bg-success-subtle text-success border border-success-subtle">พร้อมใช้</span>`;
    
    const usedInfo = isUsed 
      ? `<div class="small text-muted mt-1"><i class="fa-regular fa-user"></i> ${c.claimer || '?'} &bull; ${new Date(c.used_at).toLocaleDateString('th-TH')}</div>`
      : '';

    return `
      <div class="card shadow-sm border-0 mb-2 adm-card-coupon">
        <div class="card-body p-3 d-flex justify-content-between align-items-center">
          <div class="overflow-hidden">
            <div class="d-flex align-items-center gap-2 mb-1">
               <code class="fs-5 fw-bold text-primary">${c.code}</code>
               ${badge}
            </div>
            <div class="small text-muted">
               มูลค่า <b class="text-dark">${c.points}</b> แต้ม
            </div>
            ${usedInfo}
          </div>
          
          <div class="d-flex gap-2">
             ${!isUsed ? `
             <button class="btn btn-light border text-secondary" onclick="copyCode('${c.code}')" title="คัดลอก">
               <i class="fa-regular fa-copy"></i>
             </button>
             <button class="btn btn-primary-soft text-primary border-0" onclick="openQrModal('${c.code}')" title="QR Code">
               <i class="fa-solid fa-qrcode"></i>
             </button>
             <button class="btn btn-light border text-danger" onclick="deleteCoupon('${c.code}')" title="ลบคูปองที่ยังไม่ใช้">
               <i class="fa-regular fa-trash-can"></i>
             </button>` 
             : '<button class="btn btn-light disabled border-0"><i class="fa-solid fa-lock text-muted"></i></button>'}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

async function generateCoupons() {
  const pts = $id('genPoints')?.value || 100;
  const qty = $id('genCount')?.value || 1;

  if (qty > 50) return Swal.fire('แจ้งเตือน', 'สร้างได้สูงสุดครั้งละ 50 ใบครับ', 'warning');

  sysOverlay.show('กำลังสร้างคูปอง...');
  try {
    const res = await fetch(API_COUPON_GEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        adminUid: ADMIN_UID,
        points: Number(pts),
        count: Number(qty)
      })
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j.message || 'Error');
    
    await Swal.fire({
        icon: 'success',
        title: 'สำเร็จ',
        text: `สร้างคูปอง ${j.created || qty} ใบเรียบร้อยแล้ว`,
        timer: 2000,
        showConfirmButton: false
    });
    
    loadCoupons(); // รีโหลดรายการ
  } catch (e) {
    Swal.fire('ผิดพลาด', e.message, 'error');
  } finally {
    sysOverlay.hide();
  }
}

// ============ GIVEAWAY LOGIC (แจกทุกคน) ============
async function giveawayToAll() {
  // 1. ถามจำนวนแต้ม
  const { value: amount } = await Swal.fire({
    title: '🎁 แจกแต้มทุกคน',
    text: 'สมาชิกทุกคนในระบบจะได้รับแต้มนี้',
    input: 'number',
    inputLabel: 'ระบุจำนวนแต้ม',
    inputPlaceholder: 'เช่น 50',
    showCancelButton: true,
    confirmButtonText: 'ถัดไป',
    confirmButtonColor: '#0ea5e9'
  });

  if (!amount || amount <= 0) return;

  // 2. ถามเหตุผล (Note)
  const { value: note } = await Swal.fire({
    title: '📝 ระบุเหตุผล',
    input: 'text',
    inputLabel: 'เช่น กิจกรรมพิเศษ, ชดเชยระบบ',
    inputValue: 'Admin Giveaway',
    showCancelButton: true,
    confirmButtonText: 'ยืนยันการแจก',
    confirmButtonColor: '#22c55e'
  });

  if (!note) return;

  // 3. ส่ง API
  sysOverlay.show('กำลังแจกแต้มให้ทุกคน...');
  try {
    const res = await fetch(API_ADMIN_ACTIONS, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'giveaway',
        adminUid: ADMIN_UID,
        amount: Number(amount),
        note: note
      })
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j.message || 'Failed');

    Swal.fire('สำเร็จ!', 'แจกแต้มให้สมาชิกทุกคนเรียบร้อยแล้ว', 'success');
    
    // (Optional) ถ้าอยู่ในหน้า Users อาจจะรีโหลดตารางเพื่อให้เห็นยอดใหม่
    if (window.loadPageUsers) window.loadPageUsers();

  } catch (e) {
    Swal.fire('ผิดพลาด', e.message, 'error');
  } finally {
    sysOverlay.hide();
  }
}

// ============ UTILS & EVENTS ============

// ผูกฟังก์ชันเข้ากับ window เพื่อให้เรียกผ่าน onclick ใน HTML ได้
window.copyCode = (code) => {
  navigator.clipboard.writeText(code);
  const Toast = Swal.mixin({ toast: true, position: 'top-end', showConfirmButton: false, timer: 1500 });
  Toast.fire({ icon: 'success', title: 'คัดลอกรหัสแล้ว' });
};

window.openQrModal = (code) => {
  const modalEl = $id('qrModal');
  if(!modalEl) return;
  
  const modal = new bootstrap.Modal(modalEl);
  const canvasBox = $id('qrCanvas');
  
  // สร้าง QR Code ผ่าน API
  if(canvasBox) {
      canvasBox.innerHTML = ''; 
      const img = document.createElement('img');
      img.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${code}`;
      img.style.width = '100%';
      img.style.borderRadius = '8px';
      canvasBox.appendChild(img);
      
      // ตั้งค่าปุ่มดาวน์โหลด
      const dlBtn = $id('btnDownloadQR');
      if(dlBtn) {
          dlBtn.onclick = () => {
              fetch(img.src).then(r=>r.blob()).then(blob=>{
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `coupon-${code}.png`;
                  a.click();
              });
          };
      }
  }
  
  modal.show();
};

function bindGlobalEvents() {
  // ปุ่มส่วนคูปอง
  $id('btnGen')?.addEventListener('click', generateCoupons);
  $id('btnReload')?.addEventListener('click', loadCoupons);
  
  // ปุ่มแจกแต้มทุกคน (Giveaway)
  $id('btnGiveaway')?.addEventListener('click', giveawayToAll);

  // แท็บกรองคูปอง
  document.querySelectorAll('#couponTabs .nav-link').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      document.querySelectorAll('#couponTabs .nav-link').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      COUPON_FILTER = e.target.dataset.filter;
      renderCoupons();
    });
  });
}

// ==========================================
//ส่วนเสริม: ประวัติการแลกของรางวัล (History)
// ==========================================

let HISTORY_DATA = [];

// 1. ผูก Event เมื่อกด Tab "ประวัติ" ให้โหลดข้อมูลทันที
document.addEventListener("DOMContentLoaded", () => {
    const histBtn = document.getElementById('tabHistoryBtn');
    if(histBtn) {
        histBtn.addEventListener('shown.bs.tab', () => {
            // โหลดข้อมูลเมื่อกดแท็บครั้งแรก (ถ้ายังไม่มีข้อมูล)
            if(HISTORY_DATA.length === 0) loadRedemptionHistory();
        });
    }

    const auditBtn = document.getElementById('tabAuditBtn');
    if (auditBtn) {
        auditBtn.addEventListener('shown.bs.tab', () => {
            if (AUDIT_ROWS.length === 0) loadAuditLogs();
        });
    }

    const safetyBtn = document.getElementById('tabSafetyBtn');
    if (safetyBtn) {
        safetyBtn.addEventListener('shown.bs.tab', () => {
            if (!SAFETY_PULSE) loadSafetyPulse();
            if (!SAFETY_QUESTIONS.length) loadSafetyQuestions();
            loadSafetySettings();
        });
    }

    const safetyPulseSubBtn = document.getElementById('tabSafetyPulseSubBtn');
    if (safetyPulseSubBtn) {
        safetyPulseSubBtn.addEventListener('shown.bs.tab', () => {
            scrollSafetySubtabIntoView();
            if (!SAFETY_PULSE) loadSafetyPulse();
        });
    }

    const safetyQuestionsSubBtn = document.getElementById('tabSafetyQuestionsSubBtn');
    if (safetyQuestionsSubBtn) {
        safetyQuestionsSubBtn.addEventListener('shown.bs.tab', () => {
            scrollSafetySubtabIntoView();
            if (!SAFETY_QUESTIONS.length) loadSafetyQuestions();
        });
    }

    const safetySettingsSubBtn = document.getElementById('tabSafetySettingsSubBtn');
    if (safetySettingsSubBtn) {
        safetySettingsSubBtn.addEventListener('shown.bs.tab', () => {
            scrollSafetySubtabIntoView();
            loadSafetySettings();
        });
    }

    const safetyReportsSubBtn = document.getElementById('tabSafetyReportsSubBtn');
    if (safetyReportsSubBtn) {
        safetyReportsSubBtn.addEventListener('shown.bs.tab', () => {
            scrollSafetySubtabIntoView();
        });
    }
});

// ฟังก์ชันโหลดข้อมูล (แก้ใหม่: ตัดตัวแปลงที่ทำให้ข้อมูลเพี้ยนออก)
async function loadRedemptionHistory() {
    const area = document.getElementById('historyListArea');
    if(!area) return;

    area.innerHTML = `
      <div class="text-center py-5 text-muted">
        <div class="spinner-border text-primary spinner-border-sm mb-2"></div>
        <div>กำลังโหลดข้อมูล...</div>
      </div>`;

    try {
        const res = await fetch('/api/admin-actions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'get_history',
                adminUid: ADMIN_UID
            })
        });

        const json = await res.json();
        
        if (json.status !== 'success') throw new Error(json.message);

        // ⭐ ใช้ข้อมูลดิบจาก Server เลย (เพราะเราจัด Format มาดีแล้วจากข้อ 1)
        HISTORY_DATA = json.data || [];

        renderHistoryList(HISTORY_DATA);

    } catch (err) {
        console.error(err);
        area.innerHTML = `<div class="text-center text-danger py-5">
            <i class="fa-solid fa-triangle-exclamation mb-2"></i><br>
            โหลดข้อมูลไม่สำเร็จ: ${err.message}
        </div>`;
    }
}

// ฟังก์ชันแสดงผล (admin.js) - ฉบับ Clean (ซ่อนรูป user/UID)
function renderHistoryList(list) {
    const area = document.getElementById('historyListArea');
    if(!area) return;

    if (list.length === 0) {
        area.innerHTML = `
          <div class="text-center py-5 text-muted opacity-50">
            <i class="fa-solid fa-box-open fa-3x mb-2"></i>
            <div>ไม่พบประวัติการแลก</div>
          </div>`;
        return;
    }

    area.innerHTML = list.map(item => {
        // จัดรูปแบบวันที่
        let dateStr = '-';
        try {
            const d = new Date(item.date);
            if(!isNaN(d.getTime())) {
                dateStr = d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' }) + ' ' + d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
            }
        } catch(e) {}

        return `
        <div class="m-card mb-2">
            <div class="d-flex justify-content-between align-items-start mb-2">
                <div class="d-flex align-items-center gap-3">
                    
                    <div class="position-relative">
                        <img src="${item.reward_img}" class="rounded-3 border bg-light" 
                             style="width:55px; height:55px; object-fit:contain;"
                             onerror="this.src='https://placehold.co/100?text=Err'">
                    </div>

                    <div>
                        <div class="fw-bold text-dark" style="font-size:1rem;">${item.reward_name}</div>
                        
                        <div class="text-muted small mt-1">
                           <i class="fa-solid fa-user-check me-1 text-success"></i> ${item.user_name}
                        </div>
                    </div>
                </div>

                <div class="text-end">
                    <span class="badge bg-danger bg-opacity-10 text-danger rounded-pill px-2">-${item.cost} pt</span>
                    <div class="text-muted mt-1" style="font-size:0.7rem;">${dateStr}</div>
                </div>
            </div>
        </div>
        `;
    }).join('');
}

// 4. ฟังก์ชันค้นหา (Filter)
window.filterHistory = () => {
    const term = document.getElementById('historySearch').value.toLowerCase();
    const filtered = HISTORY_DATA.filter(x => 
        (x.user && x.user.toLowerCase().includes(term)) ||
        (x.reward && x.reward.toLowerCase().includes(term)) ||
        (x.uid && x.uid.toLowerCase().includes(term))
    );
    renderHistoryList(filtered);
};

function escapeAuditHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[ch]));
}

function formatAuditDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

async function loadAuditLogs() {
  const area = document.getElementById('auditListArea');
  if (!area) return;
  const riskItems = [];

  const riskWorkflowHtml = riskItems.length ? `
    <div class="fw-bold text-dark mt-3 mb-2"><i class="fa-solid fa-list-check me-1"></i> Risk Case Workflow</div>
    ${riskItems.map(item => {
      const riskStatus = item.riskStatus || 'new';
      return `
        <div class="m-card mb-2">
          <div class="d-flex justify-content-between gap-2 align-items-start">
            <div style="min-width:0;">
              <div class="fw-bold text-dark">${escapeAuditHtml(item.name || '')}</div>
              <div class="small text-muted">${escapeAuditHtml(item.room || '')} • ${escapeAuditHtml(riskStatus)}</div>
              ${item.note ? `<div class="small text-muted mt-1">${escapeAuditHtml(item.note)}</div>` : ''}
              ${item.riskAdminNote ? `<div class="small text-primary mt-1">Admin: ${escapeAuditHtml(item.riskAdminNote)}</div>` : ''}
            </div>
            <div class="d-flex gap-1 flex-shrink-0">
              ${riskStatus !== 'resolved' ? `<button class="btn btn-sm btn-outline-primary" onclick="updateRiskCase('${escapeAuditHtml(item.id)}','acknowledged')">รับทราบ</button><button class="btn btn-sm btn-outline-success" onclick="updateRiskCase('${escapeAuditHtml(item.id)}','resolved')">ปิดเคส</button>` : '<span class="badge bg-success-subtle text-success">Resolved</span>'}
            </div>
          </div>
        </div>
      `;
    }).join('')}
  ` : '';

  area.innerHTML = `
    <div class="text-center py-5 text-muted">
      <div class="spinner-border text-primary spinner-border-sm mb-2"></div>
      <div>กำลังโหลดบันทึกระบบ...</div>
    </div>`;

  try {
    const res = await fetch(`${API_AUDIT_LOGS}?adminUid=${encodeURIComponent(ADMIN_UID || '')}&limit=100&t=${Date.now()}`, { cache: 'no-store' });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.status !== 'success') throw new Error(json.message || 'load_failed');

    AUDIT_ROWS = Array.isArray(json.data) ? json.data : [];
    renderAuditLogs(AUDIT_ROWS, json.warning);
  } catch (err) {
    area.innerHTML = `<div class="alert alert-danger m-3">โหลดบันทึกระบบไม่สำเร็จ: ${escapeAuditHtml(err.message)}</div>`;
  }
}

function renderAuditLogs(list, warning = '') {
  const area = document.getElementById('auditListArea');
  if (!area) return;

  if (!list.length) {
    area.innerHTML = `
      <div class="text-center py-5 text-muted opacity-75">
        <i class="fa-solid fa-clipboard-list fa-2x mb-3 opacity-25"></i><br>
        ${warning ? 'ยังไม่ได้สร้างตาราง audit_logs' : 'ยังไม่มีบันทึกระบบ'}
      </div>`;
    return;
  }

  area.innerHTML = list.map(row => {
    const isError = row.status === 'error';
    const statusClass = isError ? 'bg-danger-subtle text-danger' : 'bg-success-subtle text-success';
    const actor = row.actor_uid || row.target_uid || '-';
    const detail = row.detail ? JSON.stringify(row.detail) : '';
    return `
      <div class="m-card p-3 mb-2">
        <div class="d-flex justify-content-between align-items-start gap-2">
          <div style="min-width:0;">
            <div class="fw-bold text-dark text-truncate">${escapeAuditHtml(row.event_type)}</div>
            <div class="small text-muted text-truncate">
              <i class="fa-regular fa-user me-1"></i>${escapeAuditHtml(actor)}
              ${row.entity_type ? ` • ${escapeAuditHtml(row.entity_type)}:${escapeAuditHtml(row.entity_id || '-')}` : ''}
            </div>
            ${detail ? `<div class="small text-muted text-truncate mt-1">${escapeAuditHtml(detail)}</div>` : ''}
          </div>
          <div class="text-end flex-shrink-0">
            <span class="badge ${statusClass} rounded-pill">${escapeAuditHtml(row.status || 'info')}</span>
            <div class="small text-muted mt-1" style="font-size:0.7rem;">${escapeAuditHtml(formatAuditDate(row.created_at))}</div>
          </div>
        </div>
      </div>`;
  }).join('');
}

window.loadAuditLogs = loadAuditLogs;
window.filterAuditLogs = () => {
  const term = (document.getElementById('auditSearch')?.value || '').toLowerCase();
  const filtered = AUDIT_ROWS.filter(row => {
    const haystack = [
      row.event_type,
      row.actor_uid,
      row.target_uid,
      row.entity_type,
      row.entity_id,
      row.status,
      row.detail ? JSON.stringify(row.detail) : ''
    ].join(' ').toLowerCase();
    return haystack.includes(term);
  });
  renderAuditLogs(filtered);
};

function todayBangkokInputValue() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
}

function currentMonthBangkokValue() {
  return todayBangkokInputValue().slice(0, 7);
}

async function adminAction(body) {
  const res = await fetch(API_ADMIN_ACTIONS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ adminUid: ADMIN_UID, ...body })
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.status !== 'success') throw new Error(json.message || 'request_failed');
  return json.data;
}

async function loadSafetySettings() {
  const enabled = document.getElementById('safetyTimeEnabled');
  if (!enabled) return;
  try {
    const url = `${API_ADMIN_ACTIONS}?action=safety_settings&adminUid=${encodeURIComponent(ADMIN_UID || '')}&t=${Date.now()}`;
    const res = await fetch(url, { cache: 'no-store' });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.status !== 'success') throw new Error(json.message || 'load_failed');
    enabled.checked = Boolean(json.data?.checkinTimeEnabled);
    const start = document.getElementById('safetyStartTime');
    const end = document.getElementById('safetyEndTime');
    const resetDate = document.getElementById('safetyStreakResetDate');
    const resetCurrent = document.getElementById('safetyStreakResetCurrent');
    if (start) start.value = json.data?.checkinStartTime || '06:00';
    if (end) end.value = json.data?.checkinEndTime || '18:00';
    if (resetDate && !resetDate.value) resetDate.value = json.data?.streakResetDate || todayBangkokInputValue();
    if (resetCurrent) {
      resetCurrent.textContent = json.data?.streakResetDate
        ? `เริ่มนับวันสะสมใหม่ตั้งแต่ ${json.data.streakResetDate}`
        : 'ยังไม่ตั้งค่าวันเริ่มนับใหม่';
    }
  } catch (err) {
    console.warn('[safety-settings] load failed', err);
  }
}

async function saveSafetySettings() {
  try {
    await adminAction({
      action: 'safety_settings_update',
      checkinTimeEnabled: Boolean(document.getElementById('safetyTimeEnabled')?.checked),
      checkinStartTime: document.getElementById('safetyStartTime')?.value || '06:00',
      checkinEndTime: document.getElementById('safetyEndTime')?.value || '18:00'
    });
    toastOk('บันทึกเวลาเช็คอินแล้ว');
  } catch (err) {
    toastErr(err.message || 'save_failed');
  }
}

async function resetSafetyStreak() {
  const resetDate = document.getElementById('safetyStreakResetDate')?.value || todayBangkokInputValue();
  const result = await Swal.fire({
    title: 'รีเซตวันสะสม Safety Streak?',
    html: `
      <div class="text-start small">
        ระบบจะเริ่มนับวันสะสมใหม่ตั้งแต่ <b>${escapeAuditHtml(resetDate)}</b><br>
        ประวัติ check-in และคะแนนเดิมจะไม่ถูกลบ
      </div>
    `,
    input: 'textarea',
    inputPlaceholder: 'เหตุผล เช่น reset ก่อน Go-live',
    showCancelButton: true,
    confirmButtonText: 'ยืนยันรีเซต',
    cancelButtonText: 'ยกเลิก',
    confirmButtonColor: '#d97706'
  });
  if (!result.isConfirmed) return;
  try {
    const data = await adminAction({
      action: 'safety_streak_reset',
      resetDate,
      note: result.value || 'reset-before-go-live'
    });
    await loadSafetySettings();
    await loadSafetyPulse();
    toastOk(`รีเซตวันสะสมแล้ว (${Number(data?.affectedRows || 0)} รายการที่ปรับ)`);
  } catch (err) {
    toastErr(err.message || 'reset_failed');
  }
}

async function loadSafetyQuestions() {
  const area = document.getElementById('safetyQuestionsArea');
  if (!area) return;
  area.innerHTML = '<div class="small text-muted">Loading questions...</div>';
  try {
    const url = `${API_ADMIN_ACTIONS}?action=safety_questions&includeInactive=1&adminUid=${encodeURIComponent(ADMIN_UID || '')}&t=${Date.now()}`;
    const res = await fetch(url, { cache: 'no-store' });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.status !== 'success') throw new Error(json.message || 'load_failed');
    SAFETY_QUESTIONS = Array.isArray(json.data) ? json.data : [];
    renderSafetyQuestions();
  } catch (err) {
    area.innerHTML = `<div class="alert alert-danger py-2">Load questions failed: ${escapeAuditHtml(err.message)}</div>`;
  }
}

function renderSafetyQuestions() {
  const area = document.getElementById('safetyQuestionsArea');
  if (!area) return;
  if (!SAFETY_QUESTIONS.length) {
    area.innerHTML = '<div class="small text-muted">ยังไม่มีคำถาม แอดมินเพิ่มเองหรือให้ AI ช่วยคิดได้</div>';
    return;
  }
  area.innerHTML = SAFETY_QUESTIONS.map(item => `
    <div class="border rounded-3 p-2 mb-2 ${item.active ? '' : 'opacity-50'}">
      <div class="d-flex justify-content-between gap-2">
        <div style="min-width:0;">
          <div class="small text-muted d-flex align-items-center gap-2 flex-wrap">
            <span>${escapeAuditHtml(item.category || 'general')} • ${escapeAuditHtml(item.source || 'admin')}</span>
            <span class="badge ${item.active ? 'bg-success-subtle text-success' : 'bg-secondary-subtle text-secondary'}">${item.active ? 'ใช้งานอยู่' : 'ปิดใช้งาน'}</span>
          </div>
          <div class="fw-bold text-dark">${escapeAuditHtml(item.question || '')}</div>
          ${renderSafetyOptionPreview(item.options)}
        </div>
        <div class="d-grid gap-1 flex-shrink-0" style="min-width:44px;">
          <button class="btn btn-sm ${item.active ? 'btn-outline-warning' : 'btn-outline-success'}" onclick="toggleSafetyQuestion('${escapeAuditHtml(item.id)}', ${item.active ? 'false' : 'true'})" title="${item.active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}">
            <i class="fa-solid ${item.active ? 'fa-eye-slash' : 'fa-eye'}"></i>
          </button>
          <button class="btn btn-sm btn-outline-danger" onclick="deleteSafetyQuestion('${escapeAuditHtml(item.id)}')" title="ลบถาวร">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </div>
    </div>
  `).join('');
}

function renderSafetyOptionPreview(options = []) {
  if (!Array.isArray(options) || !options.length) return '';
  const answerMeta = {
    ready: { label: 'คำตอบ: พร้อม/ปลอดภัย', tone: 'success' },
    minor_risk: { label: 'คำตอบ: พบความเสี่ยง', tone: 'warning' },
    need_support: { label: 'คำตอบ: ต้องติดตาม', tone: 'danger' }
  };
  return `
    <div class="mt-2 d-grid gap-1">
      ${options.map(option => {
        const meta = answerMeta[option.answer] || { label: `คำตอบ: ${option.answer || '-'}`, tone: 'secondary' };
        return `
        <div class="small border rounded-2 px-2 py-1 bg-light">
          <div class="d-flex justify-content-between gap-2 align-items-start">
            <span class="fw-bold">${escapeAuditHtml(option.label || '')}</span>
            <span class="badge bg-${meta.tone}-subtle text-${meta.tone} flex-shrink-0">${escapeAuditHtml(meta.label)}</span>
          </div>
          ${option.description ? `<div class="text-muted">${escapeAuditHtml(option.description)}</div>` : ''}
          ${option.answerText ? `<div class="text-dark mt-1"><i class="fa-solid fa-check me-1 text-success"></i>${escapeAuditHtml(option.answerText)}</div>` : ''}
        </div>
      `}).join('')}
    </div>
  `;
}

async function saveSafetyQuestion() {
  const text = (document.getElementById('safetyQuestionText')?.value || '').trim();
  if (!text) return toastErr('กรุณาใส่คำถาม');
  try {
    await adminAction({
      action: 'safety_question_create',
      category: document.getElementById('safetyQuestionCategory')?.value || 'general',
      question: text,
      options: window.__SELECTED_AI_OPTIONS || undefined
    });
    window.__SELECTED_AI_OPTIONS = null;
    document.getElementById('safetyQuestionText').value = '';
    await loadSafetyQuestions();
    toastOk('เพิ่มคำถามแล้ว');
  } catch (err) {
    toastErr(err.message || 'save_failed');
  }
}

async function deleteSafetyQuestion(id) {
  if (!id) return;
  const confirm = await Swal.fire({
    title: 'ลบคำถามนี้ถาวร?',
    text: 'คำถามจะหายจากรายการแอดมินและจะไม่ถูกใช้ตอนเช็คอินอีก',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: 'ลบถาวร',
    confirmButtonColor: '#dc2626',
    cancelButtonText: 'ยกเลิก'
  });
  if (!confirm.isConfirmed) return;
  try {
    await adminAction({ action: 'safety_question_hard_delete', id });
    await loadSafetyQuestions();
    toastOk('ลบคำถามแล้ว');
  } catch (err) {
    toastErr(err.message || 'delete_failed');
  }
}

async function toggleSafetyQuestion(id, active) {
  if (!id) return;
  try {
    await adminAction({ action: 'safety_question_update', id, active: Boolean(active) });
    await loadSafetyQuestions();
    toastOk(active ? 'เปิดใช้งานคำถามแล้ว' : 'ปิดใช้งานคำถามแล้ว');
  } catch (err) {
    toastErr(err.message || 'update_failed');
  }
}

async function generateSafetyQuestions() {
  const area = document.getElementById('aiQuestionSuggestions');
  if (!area) return;
  area.innerHTML = '<div class="small text-muted">AI is generating...</div>';
  try {
    const data = await adminAction({
      action: 'safety_generate_questions',
      category: document.getElementById('safetyQuestionCategory')?.value || 'general',
      tone: 'enterprise practical',
      count: 10
    });
    const questions = Array.isArray(data?.questions) ? data.questions : [];
    window.__AI_SAFETY_QUESTIONS = questions;
    window.__AI_SAFETY_MODEL = data.model || '';
    renderAiSafetyQuestionSuggestions();
  } catch (err) {
    area.innerHTML = `<div class="alert alert-warning py-2">${err.message === 'gemini_key_missing' ? 'ต้องเพิ่ม GEMINI_API_KEY ใน .env.local และ Vercel Environment Variables ก่อนใช้ AI' : escapeAuditHtml(err.message)}</div>`;
  }
}

function renderAiSafetyQuestionSuggestions() {
  const area = document.getElementById('aiQuestionSuggestions');
  if (!area) return;
  const questions = Array.isArray(window.__AI_SAFETY_QUESTIONS) ? window.__AI_SAFETY_QUESTIONS : [];
  const model = window.__AI_SAFETY_MODEL || '';
  if (!questions.length) {
    area.innerHTML = '<div class="small text-muted">No suggestion</div>';
    return;
  }
  area.innerHTML = `
    <div class="border rounded-3 p-2 mb-2 bg-light">
      <div class="d-flex justify-content-between align-items-center gap-2">
        <div style="min-width:0;">
          <div class="fw-bold text-dark">AI Question Pack</div>
          <div class="small text-muted">${questions.length} ข้อพร้อมช้อยส์และคำตอบ • ${escapeAuditHtml(model)}</div>
        </div>
        <button class="btn btn-sm btn-success flex-shrink-0" onclick="saveAllAiSafetyQuestions()">
          <i class="fa-solid fa-floppy-disk me-1"></i> บันทึกทั้งหมด
        </button>
      </div>
    </div>
    ${questions.map((item, index) => `
      <div class="border rounded-3 p-2 mb-2">
        <div class="small text-muted">AI suggestion ${index + 1}</div>
        <div class="fw-bold mb-2">${escapeAuditHtml(item.question || '')}</div>
        ${renderSafetyOptionPreview(item.options)}
        <div class="d-flex flex-wrap gap-1 mt-2">
          <button class="btn btn-sm btn-success" onclick="saveAiSafetyQuestion(${index})">บันทึกข้อนี้</button>
          <button class="btn btn-sm btn-outline-success" onclick="useAiSafetyQuestion(${index})">ใช้ไปแก้ก่อน</button>
        </div>
      </div>
    `).join('')}
  `;
}

function useAiSafetyQuestion(index) {
  const item = window.__AI_SAFETY_QUESTIONS?.[index];
  if (!item) return;
  const text = document.getElementById('safetyQuestionText');
  const category = document.getElementById('safetyQuestionCategory');
  if (text) text.value = item.question || '';
  if (category && item.category) category.value = item.category;
  window.__SELECTED_AI_OPTIONS = item.options || null;
  window.__AI_SAFETY_QUESTIONS.splice(index, 1);
  renderAiSafetyQuestionSuggestions();
  toastOk('เลือกคำถาม AI แล้ว กดเพิ่มคำถามเพื่อบันทึกพร้อมช้อยส์');
}

async function saveAiSafetyQuestion(index) {
  const item = window.__AI_SAFETY_QUESTIONS?.[index];
  if (!item?.question) return toastErr('ไม่พบคำถาม AI');
  try {
    await adminAction({
      action: 'safety_question_create',
      category: item.category || document.getElementById('safetyQuestionCategory')?.value || 'general',
      question: item.question,
      options: item.options || undefined
    });
    await loadSafetyQuestions();
    window.__AI_SAFETY_QUESTIONS.splice(index, 1);
    renderAiSafetyQuestionSuggestions();
    toastOk('บันทึกคำถาม AI พร้อมช้อยส์แล้ว');
  } catch (err) {
    toastErr(err.message || 'save_failed');
  }
}

async function saveAllAiSafetyQuestions() {
  const questions = Array.isArray(window.__AI_SAFETY_QUESTIONS) ? window.__AI_SAFETY_QUESTIONS.filter(item => item?.question) : [];
  if (!questions.length) return toastErr('ไม่พบชุดคำถาม AI');
  try {
    for (const item of questions) {
      await adminAction({
        action: 'safety_question_create',
        category: item.category || document.getElementById('safetyQuestionCategory')?.value || 'general',
        question: item.question,
        options: item.options || undefined
      });
    }
    window.__AI_SAFETY_QUESTIONS = [];
    renderAiSafetyQuestionSuggestions();
    await loadSafetyQuestions();
    toastOk(`บันทึกชุดคำถาม AI แล้ว ${questions.length} ข้อ`);
  } catch (err) {
    toastErr(err.message || 'save_failed');
  }
}

async function loadSafetyPulse() {
  const area = document.getElementById('safetyPulseArea');
  if (!area) return;

  const dateInput = document.getElementById('safetyPulseDate');
  if (dateInput && !dateInput.value) dateInput.value = todayBangkokInputValue();
  const date = dateInput?.value || todayBangkokInputValue();

  area.innerHTML = `
    <div class="text-center py-5 text-muted">
      <div class="spinner-border text-primary spinner-border-sm mb-2"></div>
      <div>กำลังโหลด Safety Pulse...</div>
    </div>`;

  try {
    const url = `${API_ADMIN_ACTIONS}?action=safety_pulse&adminUid=${encodeURIComponent(ADMIN_UID || '')}&date=${encodeURIComponent(date)}&t=${Date.now()}`;
    const res = await fetch(url, { cache: 'no-store' });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.status !== 'success') throw new Error(json.message || 'load_failed');

    SAFETY_PULSE = json.data || null;
    renderSafetyPulse(SAFETY_PULSE);
  } catch (err) {
    area.innerHTML = `<div class="alert alert-danger m-3">โหลด Safety Pulse ไม่สำเร็จ: ${escapeAuditHtml(err.message)}</div>`;
  }
}

function renderSafetyPulse(data) {
  const area = document.getElementById('safetyPulseArea');
  if (!area) return;
  if (!data) {
    area.innerHTML = '<div class="text-center py-5 text-muted">ยังไม่มีข้อมูล Safety Pulse</div>';
    return;
  }

  const total = Number(data.totalUsers || 0);
  const checkedIn = Number(data.checkedIn || 0);
  const rate = Number(data.participationRate || 0);
  const ready = Number(data.ready || 0);
  const risk = Number(data.risk || 0);
  const support = Number(data.support || 0);
  const departments = Array.isArray(data.departments) ? data.departments : [];
  const riskItems = Array.isArray(data.riskItems) ? data.riskItems : [];
  const pendingItems = Array.isArray(data.pendingItems) ? data.pendingItems : [];
  const pending = Math.max(total - checkedIn, 0);
  const activeTab = SAFETY_PULSE_TAB || 'action';
  const filters = SAFETY_PULSE_FILTER || { room: 'all', status: 'open', type: 'all' };
  const rooms = Array.from(new Set([
    ...departments.map(dep => dep.room || 'ไม่ระบุ'),
    ...riskItems.map(item => item.room || 'ไม่ระบุ'),
    ...pendingItems.map(item => item.room || 'ไม่ระบุ')
  ])).sort((a, b) => String(a).localeCompare(String(b)));
  const filterByRoom = item => filters.room === 'all' || (item.room || 'ไม่ระบุ') === filters.room;
  const filterByStatus = item => {
    const status = item.riskStatus || 'new';
    if (filters.status === 'all') return true;
    if (filters.status === 'open') return status !== 'resolved';
    return status === filters.status;
  };
  const filterByType = item => {
    if (filters.type === 'all') return true;
    const isSupport = item.answer === 'need_support' || item.mood === 'support';
    const isRisk = item.riskFlag || item.answer === 'minor_risk' || item.mood === 'risk';
    return filters.type === 'support' ? isSupport : isRisk;
  };
  const visibleRiskItems = riskItems.filter(item => filterByRoom(item) && filterByStatus(item) && filterByType(item));
  const visiblePendingItems = pendingItems.filter(filterByRoom);
  const actionItems = visibleRiskItems.filter(item => (item.riskStatus || 'new') !== 'resolved');
  const rawActionCount = riskItems.filter(item => (item.riskStatus || 'new') !== 'resolved').length;

  const statusMeta = (status = 'new') => ({
    new: { label: 'New', tone: 'danger' },
    acknowledged: { label: 'Acknowledged', tone: 'primary' },
    resolved: { label: 'Resolved', tone: 'success' },
    none: { label: 'Review', tone: 'secondary' }
  }[status] || { label: status, tone: 'secondary' });

  const metric = (label, value, tone = 'primary', icon = 'fa-circle') => `
    <div class="col-6 col-lg-3">
      <div class="border rounded-3 p-2 h-100 bg-white">
        <div class="d-flex justify-content-between align-items-center gap-2">
          <div class="small text-muted text-truncate">${escapeAuditHtml(label)}</div>
          <i class="fa-solid ${icon} text-${tone}"></i>
        </div>
        <div class="fs-4 fw-bold text-${tone}">${escapeAuditHtml(value)}</div>
      </div>
    </div>`;

  const departmentHtml = departments.length ? departments.map((dep) => {
    const depRate = Number(dep.participationRate || 0);
    const depTotal = Number(dep.totalUsers || 0);
    const depCheckins = Number(dep.checkins || 0);
    return `
      <div class="border rounded-3 p-2 mb-2 bg-white">
        <div class="d-flex justify-content-between align-items-start gap-2 mb-2">
          <div style="min-width:0;">
            <div class="fw-bold text-dark">${escapeAuditHtml(dep.room || 'ไม่ระบุ')}</div>
            <div class="small text-muted">เช็คอิน ${depCheckins}/${depTotal} คน | ค้าง ${Number(dep.pending || 0)} | เสี่ยง ${Number(dep.risk || 0)}</div>
          </div>
          <span class="badge bg-primary-subtle text-primary rounded-pill">${depRate}%</span>
        </div>
        <div class="progress" style="height:7px;">
          <div class="progress-bar ${depRate >= 80 ? 'bg-success' : depRate >= 50 ? 'bg-primary' : 'bg-warning'}" style="width:${Math.max(0, Math.min(depRate, 100))}%"></div>
        </div>
      </div>`;
  }).join('') : '<div class="text-center text-muted py-3">ยังไม่มีข้อมูลแผนกวันนี้</div>';

  const riskCard = (item) => {
    const isSupport = item.answer === 'need_support' || item.mood === 'support';
    const statusText = isSupport ? 'ต้องติดตาม' : 'พบจุดเสี่ยง';
    const workflowStatus = item.riskStatus || 'new';
    const meta = statusMeta(workflowStatus);
    return `
      <div class="border rounded-3 p-2 mb-2 bg-white ${isSupport ? 'border-danger' : 'border-warning'}">
        <div class="d-flex justify-content-between gap-2 align-items-start">
          <div style="min-width:0;">
            <div class="fw-bold text-dark text-truncate">${escapeAuditHtml(item.name)}</div>
            <div class="small text-muted">${escapeAuditHtml(item.room)} | ${escapeAuditHtml(statusText)} | ${formatAuditDate(item.created_at)}</div>
            ${item.note ? `<div class="small text-muted mt-1">${escapeAuditHtml(item.note)}</div>` : ''}
            ${item.riskAdminNote ? `<div class="small text-primary mt-1">Admin: ${escapeAuditHtml(item.riskAdminNote)}</div>` : ''}
          </div>
          <div class="d-flex flex-column gap-1 flex-shrink-0 align-items-end">
            <span class="badge bg-${meta.tone}-subtle text-${meta.tone}">${escapeAuditHtml(meta.label)}</span>
            <div class="d-flex gap-1">
              <button class="btn btn-sm btn-outline-secondary" onclick="showSafetyRiskCase('${escapeAuditHtml(item.id)}')"><i class="fa-solid fa-eye"></i></button>
              ${workflowStatus !== 'resolved' ? `<button class="btn btn-sm btn-outline-primary" onclick="updateRiskCase('${escapeAuditHtml(item.id)}','acknowledged')">รับทราบ</button><button class="btn btn-sm btn-outline-success" onclick="updateRiskCase('${escapeAuditHtml(item.id)}','resolved')">ปิดเคส</button>` : ''}
            </div>
          </div>
        </div>
      </div>`;
  };

  const actionHtml = actionItems.length ? actionItems.map(riskCard).join('') : '<div class="text-center text-muted py-4">ไม่มีเคสที่รอติดตามตอนนี้</div>';
  const riskHtml = visibleRiskItems.length ? visibleRiskItems.map(riskCard).join('') : '<div class="text-center text-muted py-4">ไม่พบเคสตามตัวกรองนี้</div>';
  const pendingHtml = visiblePendingItems.length ? visiblePendingItems.map(item => `
    <div class="border rounded-3 p-2 mb-2 bg-white">
      <div class="fw-bold text-dark">${escapeAuditHtml(item.name || '')}</div>
      <div class="small text-muted">${escapeAuditHtml(item.room || 'ไม่ระบุ')}</div>
    </div>
  `).join('') : '<div class="text-center text-muted py-4">ทุกคนเช็คอินครบแล้ว</div>';

  const overviewHtml = `
    <div class="row g-2 mb-3">
      ${metric('เช็คอินแล้ว', `${checkedIn}/${total}`, 'primary', 'fa-user-check')}
      ${metric('ยังไม่เช็คอิน', pending, pending > 0 ? 'warning' : 'secondary', 'fa-user-clock')}
      ${metric('พบจุดเสี่ยง', risk, risk > 0 ? 'warning' : 'secondary', 'fa-triangle-exclamation')}
      ${metric('ต้องติดตาม', support, support > 0 ? 'danger' : 'secondary', 'fa-headset')}
    </div>
    <div class="border rounded-3 p-3 bg-white">
      <div class="d-flex justify-content-between align-items-center mb-2">
        <div class="fw-bold text-dark">Participation</div>
        <div class="fw-bold text-primary">${rate}%</div>
      </div>
      <div class="progress" style="height:8px;">
        <div class="progress-bar bg-primary" style="width:${Math.max(0, Math.min(rate, 100))}%"></div>
      </div>
      <div class="small text-muted mt-2">พร้อมทำงาน ${ready} คน จากผู้เช็คอิน ${checkedIn} คน</div>
    </div>`;

  const tabButton = (key, label, count, icon, tone = 'primary') => `
    <button type="button" class="btn btn-sm ${activeTab === key ? `btn-${tone}` : 'btn-outline-secondary'}" onclick="setSafetyPulseTab('${key}')">
      <i class="fa-solid ${icon} me-1"></i>${escapeAuditHtml(label)}
      <span class="badge ${activeTab === key ? 'bg-white text-dark' : 'bg-light text-dark'} ms-1">${escapeAuditHtml(count)}</span>
    </button>`;

  const filterPanel = ['action', 'risk', 'pending'].includes(activeTab) ? `
    <div class="border rounded-3 p-2 mb-3 bg-light">
      <div class="row g-2">
        <div class="col-12 col-sm-4">
          <select class="form-select form-select-sm" onchange="setSafetyPulseFilter('room', this.value)">
            <option value="all"${filters.room === 'all' ? ' selected' : ''}>ทุกแผนก</option>
            ${rooms.map(room => `<option value="${escapeAuditHtml(room)}"${filters.room === room ? ' selected' : ''}>${escapeAuditHtml(room)}</option>`).join('')}
          </select>
        </div>
        ${activeTab !== 'pending' ? `
          <div class="col-6 col-sm-4">
            <select class="form-select form-select-sm" onchange="setSafetyPulseFilter('status', this.value)">
              <option value="open"${filters.status === 'open' ? ' selected' : ''}>ยังไม่ปิดเคส</option>
              <option value="new"${filters.status === 'new' ? ' selected' : ''}>New</option>
              <option value="acknowledged"${filters.status === 'acknowledged' ? ' selected' : ''}>Acknowledged</option>
              <option value="resolved"${filters.status === 'resolved' ? ' selected' : ''}>Resolved</option>
              <option value="all"${filters.status === 'all' ? ' selected' : ''}>ทุกสถานะ</option>
            </select>
          </div>
          <div class="col-6 col-sm-4">
            <select class="form-select form-select-sm" onchange="setSafetyPulseFilter('type', this.value)">
              <option value="all"${filters.type === 'all' ? ' selected' : ''}>ทุกประเภท</option>
              <option value="risk"${filters.type === 'risk' ? ' selected' : ''}>พบความเสี่ยง</option>
              <option value="support"${filters.type === 'support' ? ' selected' : ''}>ต้องติดตาม</option>
            </select>
          </div>
        ` : ''}
      </div>
    </div>
  ` : '';

  const tabContent = activeTab === 'overview' ? overviewHtml
    : activeTab === 'pending' ? pendingHtml
    : activeTab === 'risk' ? riskHtml
    : activeTab === 'departments' ? departmentHtml
    : actionHtml;

  area.innerHTML = `
    <div class="m-card mb-3">
      <div class="d-flex justify-content-between align-items-start gap-2 mb-3">
        <div style="min-width:0;">
          <div class="small text-muted">Safety Pulse</div>
          <div class="fs-5 fw-bold text-dark">${escapeAuditHtml(data.date)}</div>
        </div>
        <span class="badge ${actionItems.length ? 'bg-danger-subtle text-danger' : 'bg-success-subtle text-success'} rounded-pill">
          ${actionItems.length ? `${actionItems.length} ต้องดูแล` : 'ปกติ'}
        </span>
      </div>
      <div class="d-flex flex-wrap gap-2 mb-3">
        ${tabButton('action', 'รอติดตาม', rawActionCount, 'fa-list-check', rawActionCount ? 'danger' : 'success')}
        ${tabButton('pending', 'ยังไม่เช็คอิน', pendingItems.length || pending, 'fa-user-clock', pending > 0 ? 'warning' : 'secondary')}
        ${tabButton('risk', 'ความเสี่ยง', riskItems.length, 'fa-triangle-exclamation', riskItems.length ? 'warning' : 'secondary')}
        ${tabButton('departments', 'แผนก', departments.length, 'fa-ranking-star', 'primary')}
        ${tabButton('overview', 'ภาพรวม', `${rate}%`, 'fa-chart-simple', 'primary')}
      </div>
      ${filterPanel}
      <div>${tabContent}</div>
    </div>
  `;
}

function renderRiskWorkflow(riskItems = []) {
  if (!riskItems.length) return '';
  return `
    <div class="fw-bold text-dark mt-3 mb-2"><i class="fa-solid fa-list-check me-1"></i> Risk Case Workflow</div>
    ${riskItems.map(item => {
      const riskStatus = item.riskStatus || 'new';
      return `
        <div class="m-card mb-2">
          <div class="d-flex justify-content-between gap-2 align-items-start">
            <div style="min-width:0;">
              <div class="fw-bold text-dark">${escapeAuditHtml(item.name || '')}</div>
              <div class="small text-muted">${escapeAuditHtml(item.room || '')} • ${escapeAuditHtml(riskStatus)}</div>
              ${item.note ? `<div class="small text-muted mt-1">${escapeAuditHtml(item.note)}</div>` : ''}
              ${item.riskAdminNote ? `<div class="small text-primary mt-1">Admin: ${escapeAuditHtml(item.riskAdminNote)}</div>` : ''}
            </div>
            <div class="d-flex gap-1 flex-shrink-0">
              ${riskStatus !== 'resolved' ? `<button class="btn btn-sm btn-outline-primary" onclick="updateRiskCase('${escapeAuditHtml(item.id)}','acknowledged')">รับทราบ</button><button class="btn btn-sm btn-outline-success" onclick="updateRiskCase('${escapeAuditHtml(item.id)}','resolved')">ปิดเคส</button>` : '<span class="badge bg-success-subtle text-success">Resolved</span>'}
            </div>
          </div>
        </div>
      `;
    }).join('')}
  `;
}

function setSafetyPulseTab(tab) {
  SAFETY_PULSE_TAB = tab || 'action';
  renderSafetyPulse(SAFETY_PULSE);
}

function setSafetyPulseFilter(key, value) {
  SAFETY_PULSE_FILTER = {
    ...(SAFETY_PULSE_FILTER || { room: 'all', status: 'open', type: 'all' }),
    [key]: value || 'all'
  };
  renderSafetyPulse(SAFETY_PULSE);
}

function showSafetyRiskCase(id) {
  const item = (SAFETY_PULSE?.riskItems || []).find(row => String(row.id) === String(id));
  if (!item) return toastErr('ไม่พบเคสนี้');
  const status = item.riskStatus || 'new';
  const isSupport = item.answer === 'need_support' || item.mood === 'support';
  const typeText = isSupport ? 'ต้องติดตาม' : 'พบความเสี่ยง';
  const timeline = [
    { label: 'พนักงานบันทึกสถานะ', time: item.created_at, detail: item.note || typeText, tone: isSupport ? 'danger' : 'warning' },
    item.riskAckAt ? { label: 'แอดมินรับทราบ', time: item.riskAckAt, detail: item.riskAckBy || '', tone: 'primary' } : null,
    item.riskResolvedAt ? { label: 'ปิดเคสแล้ว', time: item.riskResolvedAt, detail: item.riskResolvedBy || '', tone: 'success' } : null
  ].filter(Boolean);

  const timelineHtml = timeline.map(step => `
    <div class="d-flex gap-2 mb-2">
      <div class="flex-shrink-0 mt-1">
        <span class="d-inline-block rounded-circle bg-${step.tone}" style="width:10px;height:10px;"></span>
      </div>
      <div style="min-width:0;">
        <div class="fw-bold small text-dark">${escapeAuditHtml(step.label)}</div>
        <div class="small text-muted">${escapeAuditHtml(formatAuditDate(step.time) || '-')}</div>
        ${step.detail ? `<div class="small text-muted">${escapeAuditHtml(step.detail)}</div>` : ''}
      </div>
    </div>
  `).join('');

  Swal.fire({
    title: 'Safety Case Detail',
    html: `
      <div class="text-start">
        <div class="border rounded-3 p-2 mb-2 bg-light">
          <div class="fw-bold text-dark">${escapeAuditHtml(item.name || '')}</div>
          <div class="small text-muted">${escapeAuditHtml(item.room || '')} | ${escapeAuditHtml(typeText)} | ${escapeAuditHtml(status)}</div>
        </div>
        ${item.note ? `<div class="mb-2"><div class="small fw-bold text-dark">User note</div><div class="small text-muted">${escapeAuditHtml(item.note)}</div></div>` : ''}
        ${item.riskAdminNote ? `<div class="mb-2"><div class="small fw-bold text-dark">Admin note</div><div class="small text-primary">${escapeAuditHtml(item.riskAdminNote)}</div></div>` : ''}
        <div class="small fw-bold text-dark mb-2">Timeline</div>
        ${timelineHtml || '<div class="small text-muted">ยังไม่มี timeline</div>'}
      </div>
    `,
    confirmButtonText: 'ปิด',
    showCancelButton: status !== 'resolved',
    cancelButtonText: status === 'new' ? 'รับทราบ' : 'ปิดเคส',
    reverseButtons: true
  }).then(result => {
    if (result.dismiss === Swal.DismissReason.cancel) {
      updateRiskCase(item.id, status === 'new' ? 'acknowledged' : 'resolved');
    }
  });
}

async function updateRiskCase(id, status) {
  if (!id) return;
  const noteResult = await Swal.fire({
    title: status === 'resolved' ? 'ปิดเคสความเสี่ยง' : 'รับทราบเคสความเสี่ยง',
    input: 'textarea',
    inputPlaceholder: 'บันทึกของแอดมิน (ถ้ามี)',
    showCancelButton: true,
    confirmButtonText: 'บันทึก',
    cancelButtonText: 'ยกเลิก'
  });
  if (!noteResult.isConfirmed) return;
  try {
    await adminAction({ action: 'safety_risk_update', id, status, note: noteResult.value || '' });
    await loadSafetyPulse();
    toastOk('อัปเดตเคสแล้ว');
  } catch (err) {
    toastErr(err.message || 'update_failed');
  }
}

async function loadMonthlySafetySummary() {
  const area = document.getElementById('monthlySafetyArea');
  const monthInput = document.getElementById('safetyMonth');
  if (!area) return;
  if (monthInput && !monthInput.value) monthInput.value = currentMonthBangkokValue();
  const month = monthInput?.value || currentMonthBangkokValue();
  area.innerHTML = '<div class="small text-muted">Loading monthly summary...</div>';
  try {
    const url = `${API_ADMIN_ACTIONS}?action=safety_monthly_summary&adminUid=${encodeURIComponent(ADMIN_UID || '')}&month=${encodeURIComponent(month)}&t=${Date.now()}`;
    const res = await fetch(url, { cache: 'no-store' });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.status !== 'success') throw new Error(json.message || 'load_failed');
    MONTHLY_SAFETY = json.data || null;
    const data = MONTHLY_SAFETY || {};
    renderMonthlySafetySummary(data);
  } catch (err) {
    area.innerHTML = `<div class="alert alert-danger py-2">Monthly summary failed: ${escapeAuditHtml(err.message)}</div>`;
  }
}

function renderMonthlySafetySummary(data = {}) {
  const area = document.getElementById('monthlySafetyArea');
  if (!area) return;
  const daily = Array.isArray(data.daily) ? data.daily : [];
  const departments = Array.isArray(data.departments) ? data.departments : [];
  const maxDailyCheckins = Math.max(1, ...daily.map(day => Number(day.checkins || 0)));

  const metric = (label, value, tone = 'primary') => `
    <div class="col-6">
      <div class="border rounded-3 p-2 bg-white h-100">
        <div class="small text-muted">${escapeAuditHtml(label)}</div>
        <div class="fs-5 fw-bold text-${tone}">${escapeAuditHtml(value)}</div>
      </div>
    </div>`;

  const trendHtml = daily.length ? daily.map(day => {
    const width = Math.max(4, Math.round((Number(day.checkins || 0) / maxDailyCheckins) * 100));
    return `
      <div class="mb-2">
        <div class="d-flex justify-content-between small mb-1">
          <span class="text-muted">${escapeAuditHtml(day.date || '')}</span>
          <span class="fw-bold">${Number(day.checkins || 0)} | Risk ${Number(day.risk || 0)}</span>
        </div>
        <div class="progress" style="height:7px;">
          <div class="progress-bar ${Number(day.risk || 0) ? 'bg-warning' : 'bg-primary'}" style="width:${width}%"></div>
        </div>
      </div>`;
  }).join('') : '<div class="text-center text-muted py-3">ยังไม่มีข้อมูลรายวันในเดือนนี้</div>';

  const departmentHtml = departments.length ? departments.map(dep => `
    <div class="border rounded-3 p-2 mb-2 bg-white">
      <div class="d-flex justify-content-between align-items-start gap-2">
        <div style="min-width:0;">
          <div class="fw-bold text-dark">${escapeAuditHtml(dep.room || 'ไม่ระบุ')}</div>
          <div class="small text-muted">Check-ins ${Number(dep.checkins || 0)} | Risk ${Number(dep.risk || 0)} | Support ${Number(dep.support || 0)}</div>
        </div>
        <div class="text-end flex-shrink-0">
          <span class="badge bg-primary-subtle text-primary">${Number(dep.participationRate || 0)}%</span>
          ${Number(dep.riskRate || 0) ? `<div class="small text-warning mt-1">Risk ${Number(dep.riskRate || 0)}%</div>` : ''}
        </div>
      </div>
    </div>
  `).join('') : '<div class="text-center text-muted py-3">ยังไม่มีข้อมูลแผนก</div>';

  area.innerHTML = `
    <div class="border rounded-3 p-2 mb-2 bg-light">
      <div class="d-flex justify-content-between align-items-start gap-2">
        <div>
          <div class="fw-bold text-dark">Monthly Safety Report</div>
          <div class="small text-muted">${escapeAuditHtml(data.start || '')} - ${escapeAuditHtml(data.periodEnd || data.end || '')}</div>
        </div>
        <button class="btn btn-sm btn-outline-secondary" onclick="exportMonthlySafetyCsv()">
          <i class="fa-solid fa-file-csv me-1"></i> Export
        </button>
      </div>
    </div>
    <div class="row g-2 mb-3">
      ${metric('Check-ins', Number(data.totalCheckins || 0), 'primary')}
      ${metric('Avg participation', `${Number(data.averageParticipationRate || 0)}%`, 'success')}
      ${metric('Risk cases', `${Number(data.risk || 0)} (${Number(data.riskRate || 0)}%)`, Number(data.risk || 0) ? 'warning' : 'secondary')}
      ${metric('Support cases', `${Number(data.support || 0)} (${Number(data.supportRate || 0)}%)`, Number(data.support || 0) ? 'danger' : 'secondary')}
    </div>
    <div class="fw-bold text-dark mb-2"><i class="fa-solid fa-chart-line me-1"></i> Daily Trend</div>
    <div class="mb-3">${trendHtml}</div>
    <div class="fw-bold text-dark mb-2"><i class="fa-solid fa-building me-1"></i> Department Comparison</div>
    ${departmentHtml}
  `;
}

function exportSafetyPulseCsv() {
  if (!SAFETY_PULSE) return toastErr('ยังไม่มีข้อมูล Safety Pulse ให้ export');
  const rows = [
    ['type', 'date', 'name', 'room', 'checked_in', 'total_users', 'risk', 'support', 'status', 'note'],
    ['summary', SAFETY_PULSE.date, '', '', SAFETY_PULSE.checkedIn, SAFETY_PULSE.totalUsers, SAFETY_PULSE.risk, SAFETY_PULSE.support, '', ''],
    ...(SAFETY_PULSE.departments || []).map(dep => ['department', SAFETY_PULSE.date, '', dep.room, dep.checkins, dep.totalUsers, dep.risk, dep.support, '', '']),
    ...(SAFETY_PULSE.riskItems || []).map(item => ['risk', SAFETY_PULSE.date, item.name, item.room, '', '', item.riskFlag ? 1 : 0, item.answer === 'need_support' ? 1 : 0, item.riskStatus || 'new', item.note || '']),
    ...(SAFETY_PULSE.pendingItems || []).map(item => ['pending', SAFETY_PULSE.date, item.name, item.room, 0, '', '', '', 'not_checked_in', ''])
  ];
  const csv = rows.map(row => row.map(value => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `safety-pulse-${SAFETY_PULSE.date || todayBangkokInputValue()}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function exportMonthlySafetyCsv() {
  if (!MONTHLY_SAFETY) return toastErr('ยังไม่มีข้อมูล Monthly Safety ให้ export');
  const rows = [
    ['type', 'month', 'date', 'room', 'checkins', 'total_users', 'participation_rate', 'risk', 'risk_rate', 'support', 'support_rate'],
    ['summary', MONTHLY_SAFETY.month, '', '', MONTHLY_SAFETY.totalCheckins, MONTHLY_SAFETY.totalUsers, MONTHLY_SAFETY.averageParticipationRate, MONTHLY_SAFETY.risk, MONTHLY_SAFETY.riskRate, MONTHLY_SAFETY.support, MONTHLY_SAFETY.supportRate],
    ...(MONTHLY_SAFETY.daily || []).map(day => ['daily', MONTHLY_SAFETY.month, day.date, '', day.checkins, MONTHLY_SAFETY.totalUsers, day.participationRate, day.risk, day.riskRate, day.support, '']),
    ...(MONTHLY_SAFETY.departments || []).map(dep => ['department', MONTHLY_SAFETY.month, '', dep.room, dep.checkins, dep.totalUsers, dep.participationRate, dep.risk, dep.riskRate, dep.support, ''])
  ];
  const csv = rows.map(row => row.map(value => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `monthly-safety-${MONTHLY_SAFETY.month || currentMonthBangkokValue()}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

window.loadSafetyPulse = loadSafetyPulse;
window.saveSafetySettings = saveSafetySettings;
window.resetSafetyStreak = resetSafetyStreak;
window.loadSafetyQuestions = loadSafetyQuestions;
window.saveSafetyQuestion = saveSafetyQuestion;
window.deleteSafetyQuestion = deleteSafetyQuestion;
window.toggleSafetyQuestion = toggleSafetyQuestion;
window.generateSafetyQuestions = generateSafetyQuestions;
window.useAiSafetyQuestion = useAiSafetyQuestion;
window.saveAiSafetyQuestion = saveAiSafetyQuestion;
window.saveAllAiSafetyQuestions = saveAllAiSafetyQuestions;
window.setSafetyPulseTab = setSafetyPulseTab;
window.setSafetyPulseFilter = setSafetyPulseFilter;
window.showSafetyRiskCase = showSafetyRiskCase;
window.updateRiskCase = updateRiskCase;
window.loadMonthlySafetySummary = loadMonthlySafetySummary;
window.exportSafetyPulseCsv = exportSafetyPulseCsv;
window.exportMonthlySafetyCsv = exportMonthlySafetyCsv;

window.deleteCoupon = async (code) => {
  const cleanCode = String(code || '').trim();
  if (!cleanCode) return;
  const safeCode = cleanCode.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[ch]));

  const confirm = await Swal.fire({
    title: 'ลบคูปองนี้?',
    html: `ลบคูปอง <code>${safeCode}</code><br><span class="text-muted small">ลบได้เฉพาะคูปองที่ยังไม่ใช้</span>`,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: 'ลบ',
    cancelButtonText: 'ยกเลิก',
    confirmButtonColor: '#dc2626'
  });
  if (!confirm.isConfirmed) return;

  sysOverlay.show('กำลังลบคูปอง...');
  try {
    const res = await fetch(API_COUPON_LIST, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminUid: ADMIN_UID, code: cleanCode })
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.status !== 'success') throw new Error(json.message || 'delete_failed');
    if (!json.deleted) throw new Error('ไม่พบคูปองที่ยังไม่ใช้ หรือคูปองถูกใช้ไปแล้ว');

    COUPON_ROWS = COUPON_ROWS.filter(row => row.code !== cleanCode);
    renderCoupons();
    Swal.fire('ลบแล้ว', 'ลบคูปองเรียบร้อย', 'success');
  } catch (err) {
    Swal.fire('ลบไม่สำเร็จ', err.message || 'กรุณาลองใหม่', 'error');
  } finally {
    sysOverlay.hide();
  }
};
