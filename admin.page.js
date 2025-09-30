// =============== Admin Page Script (v3) ===============

// ---- tiny overlay (ไม่พึ่ง jQuery) ----
const overlay = (() => {
  let el;
  return {
    show(text = 'กำลังโหลด...') {
      if (!el) {
        el = document.createElement('div');
        el.style.cssText = `
          position:fixed;inset:0;background:rgba(0,0,0,.35);
          display:flex;align-items:center;justify-content:center;
          z-index:2000;backdrop-filter:saturate(120%) blur(2px);
        `;
        el.innerHTML = `
          <div style="padding:14px 18px;border-radius:12px;background:#111;color:#fff;display:flex;gap:10px;align-items:center">
            <span class="spinner-border spinner-border-sm"></span>
            <span>${text}</span>
          </div>`;
        document.body.appendChild(el);
      } else {
        el.querySelector('span:last-child').textContent = text;
        el.style.display = 'flex';
      }
    },
    hide(){ if (el) el.style.display = 'none'; }
  };
})();

// ---- utils ----
const ADMIN_UID = window.ADMIN_UID || ''; // ถ้าคุณฝัง uid แอดมินจากฝั่ง client
const qs = sel => document.querySelector(sel);
const qsa = sel => Array.from(document.querySelectorAll(sel));

// debounce ที่ “ถูกต้อง”
function debounce(fn, ms = 300) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// ---- element refs (ต้องมีใน admin.html) ----
const $search      = qs('#q');
const $reload      = qs('#btnReload');
const $exportCsv   = qs('#btnExportCsv');
const $tbody       = qs('#adminTableBody');
const $pager       = qs('#adminPager');
const $info        = qs('#adminInfo');      // แสดงสรุป/จำนวนรายการ (optional แต่แนะนำ)

// modal: ปรับคะแนน
const $mAdj        = qs('#adjustModal');
const $ajUid       = qs('#ajUid');
const $ajDelta     = qs('#ajDelta');
const $ajNote      = qs('#ajNote');
const $btnAdjAdd   = qs('#btnAdjAdd');
const $btnAdjDed   = qs('#btnAdjDeduct');
const $btnAdjReset = qs('#btnAdjReset');
const adjModal     = $mAdj ? new bootstrap.Modal($mAdj) : null;

// modal: ประวัติ
const $mHist       = qs('#historyModal');
const $histBody    = qs('#historyTableBody');
const histModal    = $mHist ? new bootstrap.Modal($mHist) : null;

// ---- state ----
let raw = [];        // ข้อมูลทั้งหมดจาก /api/all-scores
let view = [];       // หลัง filter/search แล้ว
let page = 1;
let pageSize = 20;   // คุณจะทำ dropdown ก็ได้

// ---- data accessors ----
async function apiGetAllScores() {
  // เรียกผ่าน Vercel API ที่คุณมีอยู่แล้ว (ฝั่ง server จะเติม secret ให้)
  const url = `/api/all-scores?uid=${encodeURIComponent(ADMIN_UID || '')}`;
  const r = await fetch(url);
  return r.json();
}

async function apiAdjustScore(targetUid, delta, note='') {
  const r = await fetch('/api/admin-adjust', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ targetUid, delta, note })
  });
  return r.json();
}

async function apiResetScore(targetUid, note='') {
  const r = await fetch('/api/admin-reset', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ targetUid, note })
  });
  return r.json();
}

async function apiHistory(uid) {
  const r = await fetch(`/api/score-history?uid=${encodeURIComponent(uid)}`);
  return r.json();
}

// ---- renderers ----
function renderTable() {
  if (!$tbody) return;

  // pagination ง่ายๆ
  const total = view.length;
  const start = (page - 1) * pageSize;
  const end   = Math.min(start + pageSize, total);
  const rows  = view.slice(start, end);

  $tbody.innerHTML = rows.map((u, idx) => `
    <tr>
      <td>
        <div class="d-flex align-items-center gap-2">
          <div class="avatar avatar-sm bg-secondary-subtle text-white rounded-circle">
            <i class="fa-regular fa-user"></i>
          </div>
          <div class="fw-medium">${u.name || '-'}</div>
        </div>
      </td>
      <td><span class="badge bg-primary-subtle text-white fs-6">${u.score ?? 0}</span></td>
      <td>
        <div class="btn-group btn-group-sm">
          <button class="btn btn-outline-light" data-action="minus" data-uid="${u.uid}" title="หักคะแนน">
            <i class="fa-solid fa-minus"></i>
          </button>
          <button class="btn btn-outline-light" data-action="plus" data-uid="${u.uid}" title="เพิ่มคะแนน">
            <i class="fa-solid fa-plus"></i>
          </button>
          <button class="btn btn-outline-warning" data-action="reset" data-uid="${u.uid}" title="ล้างคะแนน">
            <i class="fa-solid fa-rotate-left"></i>
          </button>
          <button class="btn btn-outline-info" data-action="history" data-uid="${u.uid}" title="ประวัติ">
            <i class="fa-regular fa-clock"></i>
          </button>
        </div>
      </td>
    </tr>
  `).join('');

  // info + pager
  if ($info) {
    $info.textContent = total
      ? `แสดง ${start+1}–${end} จากทั้งหมด ${total} รายการ`
      : 'ไม่พบข้อมูล';
  }
  renderPager(total);
}

function renderPager(total) {
  if (!$pager) return;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (page > pages) page = pages;

  const mk = (p, txt = p, disabled=false, active=false) =>
    `<li class="page-item ${disabled?'disabled':''} ${active?'active':''}">
      <a class="page-link" href="#" data-page="${p}">${txt}</a>
    </li>`;

  let html = '';
  html += mk(page-1,'«', page<=1);
  for (let p=1; p<=pages; p++) {
    if (p===1 || p===pages || Math.abs(p-page)<=1) {
      html += mk(p, String(p), false, p===page);
    } else if (Math.abs(p-page)===2) {
      html += `<li class="page-item disabled"><span class="page-link">…</span></li>`;
    }
  }
  html += mk(page+1,'»', page>=pages);
  $pager.innerHTML = html;
}

// ---- filtering ----
function applyFilter() {
  const q = ($search?.value || '').trim().toLowerCase();
  view = raw.filter(x => {
    const hit = (x.name||'').toLowerCase().includes(q) || (x.uid||'').toLowerCase().includes(q);
    return hit;
  });
  page = 1;
  renderTable();
}

// ---- events ----
$search?.addEventListener('input', debounce(applyFilter, 250));

$reload?.addEventListener('click', async () => {
  await loadData();
});

$pager?.addEventListener('click', e => {
  const a = e.target.closest('a[data-page]');
  if (!a) return;
  e.preventDefault();
  page = Number(a.dataset.page) || 1;
  renderTable();
});

// export CSV ง่ายๆ
$exportCsv?.addEventListener('click', () => {
  const rows = [['ชื่อ','คะแนน']];
  view.forEach(u => rows.push([u.name||'', String(u.score??0)]));
  const csv = rows.map(r => r.map(x => `"${String(x).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
  const url  = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'scores.csv';
  document.body.appendChild(a); a.click();
  a.remove(); URL.revokeObjectURL(url);
});

// delegate ปุ่มจัดการ (ในตาราง)
$tbody?.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const uid = btn.dataset.uid;
  const action = btn.dataset.action;

  if (action === 'plus' || action === 'minus') {
    if (!adjModal) return;
    $ajUid.value = uid;
    $ajDelta.value = (action === 'plus') ? 10 : -10;
    $ajNote.value = '';
    adjModal.show();
  }

  if (action === 'reset') {
    if (!confirm('ยืนยันการล้างคะแนนผู้ใช้นี้?')) return;
    overlay.show('กำลังล้างคะแนน...');
    const res = await apiResetScore(uid, 'admin reset');
    overlay.hide();
    if (res.status === 'success') { await loadData(); }
    else alert(res.message || 'ล้างคะแนนไม่สำเร็จ');
  }

  if (action === 'history') {
    overlay.show('กำลังโหลดประวัติ...');
    const res = await apiHistory(uid);
    overlay.hide();
    if (res.status === 'success' && Array.isArray(res.data)) {
      $histBody.innerHTML = res.data.map((h,i)=>`
        <tr>
          <td>${i+1}</td>
          <td>${new Date(h.ts).toLocaleString('th-TH')}</td>
          <td>${h.code||'-'}</td>
          <td>${h.type||'-'}</td>
          <td class="text-end">${h.point>=0? '+'+h.point : h.point}</td>
        </tr>
      `).join('') || `<tr><td colspan="5" class="text-center text-muted">ไม่มีประวัติ</td></tr>`;
      histModal?.show();
    } else {
      alert(res.message || 'โหลดประวัติไม่สำเร็จ');
    }
  }
});

// ปุ่มใน modal ปรับคะแนน
$btnAdjAdd?.addEventListener('click', async () => {
  const uid = $ajUid.value.trim();
  const delta = Number($ajDelta.value || 0);
  const note = $ajNote.value || '';
  if (!uid || !delta) return;
  overlay.show('กำลังปรับคะแนน...');
  const res = await apiAdjustScore(uid, delta, note);
  overlay.hide();
  if (res.status === 'success') { adjModal.hide(); await loadData(); }
  else alert(res.message || 'ปรับคะแนนไม่สำเร็จ');
});

$btnAdjDed?.addEventListener('click', async () => {
  const uid = $ajUid.value.trim();
  const delta = -Math.abs(Number($ajDelta.value || 0));
  const note = $ajNote.value || '';
  if (!uid || !delta) return;
  overlay.show('กำลังปรับคะแนน...');
  const res = await apiAdjustScore(uid, delta, note);
  overlay.hide();
  if (res.status === 'success') { adjModal.hide(); await loadData(); }
  else alert(res.message || 'ปรับคะแนนไม่สำเร็จ');
});

$btnAdjReset?.addEventListener('click', async () => {
  const uid = $ajUid.value.trim();
  const note = $ajNote.value || '';
  if (!uid) return;
  overlay.show('กำลังล้างคะแนน...');
  const res = await apiResetScore(uid, note);
  overlay.hide();
  if (res.status === 'success') { adjModal.hide(); await loadData(); }
  else alert(res.message || 'ล้างคะแนนไม่สำเร็จ');
});

// ---- load ----
async function loadData() {
  overlay.show('กำลังโหลดข้อมูล...');
  try {
    const res = await apiGetAllScores();
    if (res.status === 'success' && Array.isArray(res.data)) {
      raw = res.data;
      // sort คะแนนมาก -> น้อย
      raw.sort((a,b)=> (b.score||0) - (a.score||0));
      view = raw.slice();
      page = 1;
      renderTable();
    } else {
      raw = []; view = [];
      renderTable();
      alert(res.message || 'โหลดข้อมูลไม่สำเร็จ');
    }
  } catch (e) {
    raw = []; view = [];
    renderTable();
    alert('เชื่อมต่อ API ไม่ได้');
  } finally {
    overlay.hide();
  }
}
document.addEventListener('DOMContentLoaded', loadData);
