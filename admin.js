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

// ============ STATE ============
let ADMIN_UID = "";
let COUPON_ROWS = [];
let COUPON_FILTER = 'all';

// ============ UI Helper ============
const $id = (x) => document.getElementById(x);

// Overlay (Reused from pageOverlay if available, else fallback)
const sysOverlay = window.pageOverlay || {
  show: (t) => console.log('Loading...', t),
  hide: () => console.log('Loaded')
};

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

// ฟังก์ชันแสดงผล (แก้ใหม่: โชว์รูปรางวัล + ชื่อผู้ใช้ตัวใหญ่)
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
        // แปลงวันที่
        const d = new Date(item.date);
        const dateStr = d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' }) + ' ' + d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });

        return `
        <div class="m-card mb-2">
            <div class="d-flex justify-content-between align-items-start mb-2">
                <div class="d-flex align-items-center gap-3">
                    
                    <div class="position-relative">
                        <img src="${item.reward_img}" class="rounded-3 border bg-light" 
                             style="width:55px; height:55px; object-fit:contain;">
                    </div>

                    <div>
                        <div class="fw-bold text-dark" style="font-size:1rem;">${item.reward_name}</div>
                        
                        <div class="text-primary small fw-semibold">
                           <i class="fa-regular fa-user me-1"></i>${item.user_name}
                        </div>
                        
                        <div class="text-muted" style="font-size:0.65rem;">UID: ${item.user_uid.substring(0, 10)}...</div>
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