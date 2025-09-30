/* admin.page.js — stable build */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const overlay = {
  show(txt = 'กำลังโหลด...') {
    if ($('#overlay')) return;
    const div = document.createElement('div');
    div.id = 'overlay';
    div.style.cssText = `
      position:fixed;inset:0;display:flex;align-items:center;justify-content:center;
      background:rgba(0,0,0,.4);z-index:3000;color:#fff
    `;
    div.innerHTML = `<div class="p-3 rounded-3 bg-dark"><i class="fa fa-spinner fa-spin me-2"></i>${txt}</div>`;
    document.body.appendChild(div);
  },
  hide() { $('#overlay')?.remove(); }
};

// ---------- State ----------
const state = {
  uid: '',
  rows: [],
  q: '',
  page: 1,
  pageSize: 20
};

function getUid() {
  return localStorage.getItem('rp_uid') || new URLSearchParams(location.search).get('uid') || '';
}

// ---------- Render ----------
function renderTable() {
  const body = $('#tblBody');
  if (!body) return;

  // filter
  const q = state.q.toLowerCase();
  const list = state.rows.filter(r =>
    (r.name || '').toLowerCase().includes(q) || String(r.uid).includes(q)
  );

  // paginate
  const start = (state.page - 1) * state.pageSize;
  const pageList = list.slice(start, start + state.pageSize);

  body.innerHTML = pageList.map((r, i) => `
    <tr>
      <td class="text-truncate" style="max-width:220px">${r.name || '-'}</td>
      <td class="fw-bold">${r.score}</td>
      <td class="text-nowrap">
        <button class="btn btn-sm btn-warning me-1" data-act="adj" data-uid="${r.uid}" data-delta="-10"><i class="fa-solid fa-minus"></i></button>
        <button class="btn btn-sm btn-primary me-1" data-act="adj" data-uid="${r.uid}" data-delta="10"><i class="fa-solid fa-plus"></i></button>
        <button class="btn btn-sm btn-danger" data-act="reset" data-uid="${r.uid}"><i class="fa-solid fa-rotate-left"></i></button>
        <button class="btn btn-sm btn-secondary ms-1" data-act="hist" data-uid="${r.uid}"><i class="fa-solid fa-clock-rotate-left"></i></button>
      </td>
    </tr>
  `).join('');

  $('#totalRows')?.replaceChildren(document.createTextNode(list.length));
}

function bindTableButtons() {
  $('#tblBody')?.addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-act]');
    if (!b) return;
    const uid = b.dataset.uid;

    if (b.dataset.act === 'adj') {
      const delta = parseInt(b.dataset.delta, 10) || 0;
      await openAdjustModal(uid, delta);
    }
    if (b.dataset.act === 'reset') {
      await resetScore(uid);
    }
    if (b.dataset.act === 'hist') {
      await openHistoryModal(uid);
    }
  });
}

// ---------- API ----------
async function fetchAll() {
  overlay.show('กำลังโหลดข้อมูล...');
  try {
    const res = await fetch(`/api/all-scores?uid=${encodeURIComponent(state.uid)}`);
    const json = await res.json();
    overlay.hide();

    if (json.status !== 'success') {
      throw new Error(json.message || 'โหลดข้อมูลไม่สำเร็จ');
    }
    state.rows = json.data || [];
    renderTable();
  } catch (e) {
    overlay.hide();
    $('#errorText')?.replaceChildren(document.createTextNode('โหลดข้อมูลไม่สำเร็จ: Apps Script error'));
  }
}

async function adjustScore(targetUid, delta, note = '') {
  overlay.show('กำลังบันทึก...');
  try {
    const res = await fetch('/api/admin-adjust', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminUid: state.uid, targetUid, delta, note })
    });
    const json = await res.json();
    overlay.hide();
    if (json.status !== 'success') throw new Error(json.message || 'บันทึกไม่สำเร็จ');
    await fetchAll();
    Swal.fire('สำเร็จ', 'ปรับคะแนนแล้ว', 'success');
  } catch (e) {
    overlay.hide();
    Swal.fire('ผิดพลาด', e.message || 'ไม่สามารถบันทึกได้', 'error');
  }
}

async function resetScore(targetUid) {
  const ok = await Swal.fire({
    icon: 'warning',
    title: 'ยืนยันล้างคะแนน?',
    showCancelButton: true,
    confirmButtonText: 'ยืนยัน',
    cancelButtonText: 'ยกเลิก'
  });
  if (!ok.isConfirmed) return;

  overlay.show('กำลังล้างคะแนน...');
  try {
    const res = await fetch('/api/admin-reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminUid: state.uid, targetUid, note: 'RESET_BY_ADMIN' })
    });
    const json = await res.json();
    overlay.hide();
    if (json.status !== 'success') throw new Error(json.message || 'ล้างคะแนนไม่สำเร็จ');
    await fetchAll();
    Swal.fire('สำเร็จ', 'ล้างคะแนนเรียบร้อย', 'success');
  } catch (e) {
    overlay.hide();
    Swal.fire('ผิดพลาด', e.message || 'ล้างคะแนนไม่สำเร็จ', 'error');
  }
}

async function openHistoryModal(uid) {
  overlay.show('กำลังโหลดประวัติ...');
  try {
    const res = await fetch(`/api/score-history?uid=${encodeURIComponent(uid)}`);
    const json = await res.json();
    overlay.hide();
    if (json.status !== 'success') throw new Error(json.message || 'โหลดประวัติไม่สำเร็จ');

    const list = $('#adminHistoryList');
    list.innerHTML = '';
    if (!json.data.length) {
      list.innerHTML = `<li class="list-group-item text-center text-secondary">ยังไม่มีรายการ</li>`;
    } else {
      json.data.forEach(h => {
        const li = document.createElement('li');
        li.className = 'list-group-item d-flex justify-content-between';
        li.innerHTML = `
          <div>
            <div class="small text-secondary">${new Date(h.ts).toLocaleString()}</div>
            <div class="fw-semibold">${h.type}</div>
            <div class="small">${h.code || '-'}</div>
          </div>
          <div class="${h.point>=0?'text-success':'text-danger'} fw-bold">${h.point>=0?'+':''}${h.point}</div>
        `;
        list.appendChild(li);
      });
    }
    new bootstrap.Modal($('#adminHistoryModal')).show();
  } catch (e) {
    overlay.hide();
    Swal.fire('ผิดพลาด', e.message || 'ไม่สามารถโหลดประวัติได้', 'error');
  }
}

async function openAdjustModal(uid, seedDelta = 0) {
  $('#adjUid').value = uid;
  $('#adjDelta').value = seedDelta || 0;
  $('#adjNote').value = '';
  new bootstrap.Modal($('#adjustModal')).show();
}

function wireAdjustForm() {
  $('#btnAdjAdd')?.addEventListener('click', async () => {
    const uid = $('#adjUid').value.trim();
    const delta = parseInt($('#adjDelta').value, 10) || 0;
    const note = $('#adjNote').value.trim();
    if (!uid || !delta) return;
    await adjustScore(uid, Math.abs(delta), note);
    bootstrap.Modal.getInstance($('#adjustModal')).hide();
  });
  $('#btnAdjDeduct')?.addEventListener('click', async () => {
    const uid = $('#adjUid').value.trim();
    const delta = parseInt($('#adjDelta').value, 10) || 0;
    const note = $('#adjNote').value.trim();
    if (!uid || !delta) return;
    await adjustScore(uid, -Math.abs(delta), note);
    bootstrap.Modal.getInstance($('#adjustModal')).hide();
  });
  $('#btnAdjReset')?.addEventListener('click', async () => {
    const uid = $('#adjUid').value.trim();
    if (!uid) return;
    await resetScore(uid);
    bootstrap.Modal.getInstance($('#adjustModal')).hide();
  });
}

// ---------- Init ----------
function initControls() {
  // กล่องค้นหา
  $('#searchBox')?.addEventListener('input', (e) => {
    state.q = e.target.value || '';
    state.page = 1;
    renderTable();
  });
  // รีเฟรช
  $('#btnRefresh')?.addEventListener('click', fetchAll);

  bindTableButtons();
  wireAdjustForm();
}

document.addEventListener('DOMContentLoaded', async () => {
  state.uid = getUid();
  initControls();
  await fetchAll();
});

/* -----------------------------
 * RP_ User Patch (no jQuery)
 * ----------------------------- */

// safe query helpers (ไม่ทับตัวแปร $ เดิมของคุณถ้ามีอยู่)
const RP_$  = (sel, root=document) => root.querySelector(sel);
const RP_$$ = (sel, root=document) => [...root.querySelectorAll(sel)];

// lightweight overlay แทน $.LoadingOverlay
const RP_overlay = {
  show(msg='กำลังทำงาน...') {
    if (RP_$('#rp-overlay')) return;
    const el = document.createElement('div');
    el.id = 'rp-overlay';
    el.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:3000;color:#fff';
    el.innerHTML = `<div class="bg-dark rounded-3 px-3 py-2"><i class="fa fa-spinner fa-spin me-2"></i>${msg}</div>`;
    document.body.appendChild(el);
  },
  hide() { RP_$('#rp-overlay')?.remove(); }
};

// ใช้ UID เดิมถ้ามี
function RP_getUid() {
  return (RP_$('#uid')?.value || localStorage.getItem('rp_uid') || '').trim();
}
function RP_rememberUid(uid) {
  if (RP_$('#uid')) RP_$('#uid').value = uid;
  if (uid) localStorage.setItem('rp_uid', uid);
}

// ---------- History ----------
async function RP_openHistory() {
  const uid = RP_getUid();
  if (!uid) return;

  try {
    RP_overlay.show('กำลังโหลดประวัติ...');
    const res  = await fetch(`/api/score-history?uid=${encodeURIComponent(uid)}`);
    const json = await res.json();
    RP_overlay.hide();

    if (json.status !== 'success') {
      return Swal.fire('ผิดพลาด', json.message || 'ไม่สามารถโหลดประวัติได้', 'error');
    }

    const list = RP_$('#historyList');
    if (!list) return; // ยังไม่ได้วาง modal ก็เงียบๆไป
    list.innerHTML = '';

    if (!json.data.length) {
      list.innerHTML = `<li class="list-group-item bg-transparent text-center text-secondary py-4">ยังไม่มีประวัติ</li>`;
    } else {
      json.data.forEach(h => {
        const li = document.createElement('li');
        li.className = 'list-group-item bg-transparent d-flex justify-content-between text-white';
        li.innerHTML = `
          <div>
            <div class="small opacity-75">${new Date(h.ts).toLocaleString()}</div>
            <div class="fw-semibold">${h.type}</div>
            <div class="small text-secondary">${h.code || '-'}</div>
          </div>
          <div class="fw-bold ${h.point>=0?'text-success':'text-danger'}">${h.point>=0?'+':''}${h.point}</div>
        `;
        list.appendChild(li);
      });
    }

    // เปิด modal
    const m = bootstrap.Modal.getOrCreateInstance(RP_$('#historyModal'));
    m.show();
  } catch (err) {
    RP_overlay.hide();
    Swal.fire('ผิดพลาด', 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้', 'error');
  }
}

// ---------- Scan / Redeem ----------
let RP_scanner = null;

function RP_startScanner() {
  if (RP_scanner) return;
  if (!window.Html5QrcodeScanner) {
    return Swal.fire('ขาดไฟล์สแกน', 'ยังไม่ได้โหลด html5-qrcode', 'warning');
  }
  RP_scanner = new Html5QrcodeScanner('qr-reader', { fps: 10, qrbox: 250 });
  RP_scanner.render(RP_onScanSuccess);
}
function RP_stopScanner() {
  if (RP_scanner) {
    RP_scanner.clear();
    RP_scanner = null;
  }
}
function RP_onScanSuccess(decodedText) {
  RP_stopScanner();
  bootstrap.Modal.getOrCreateInstance(RP_$('#scoreModal')).hide();
  RP_redeem(decodedText, 'SCAN');
}

async function RP_redeem(code, type) {
  const uid = RP_getUid();
  if (!uid || !code) return;

  try {
    RP_overlay.show('กำลังบันทึก...');
    const res = await fetch('/api/redeem', {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({ uid, code, type })
    });
    const json = await res.json();
    RP_overlay.hide();

    if (json.status === 'success') {
      Swal.fire('สำเร็จ', `รับคะแนนแล้ว (+${json.point})`, 'success');
      // ถ้าคุณมีฟังก์ชันเดิมชื่อ refreshUserScore ก็จะเรียกให้
      try { typeof refreshUserScore === 'function' && refreshUserScore(); } catch {}
    } else if (json.status === 'invalid') {
      Swal.fire('ไม่สำเร็จ', json.message || 'คูปองไม่ถูกต้อง/ถูกใช้แล้ว', 'warning');
    } else {
      Swal.fire('ผิดพลาด', json.message || 'โปรดลองใหม่ภายหลัง', 'error');
    }
  } catch (err) {
    RP_overlay.hide();
    Swal.fire('ผิดพลาด', 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้', 'error');
  }
}

// ---------- Bind UX ----------
function RP_bindUserUX() {
  // ปุ่มที่หน้าแรกให้ใส่ data-action
  // - เปิดสแกน: data-action="open-scan"
  // - ประวัติ:   data-action="open-history"
  // - ยืนยันโค้ดลับใน modal: id="btnSubmitSecret"
  // - ปุ่มย้อนใน modal สแกน: id="btnCloseScan"

  document.addEventListener('click', (ev) => {
    const t = ev.target.closest('[data-action]');
    if (!t) return;

    switch (t.dataset.action) {
      case 'open-scan':
        bootstrap.Modal.getOrCreateInstance(RP_$('#scoreModal')).show();
        setTimeout(RP_startScanner, 150);
        break;
      case 'open-history':
        RP_openHistory();
        break;
    }
  });

  RP_$('#btnSubmitSecret')?.addEventListener('click', () => {
    const code = (RP_$('#secretCode')?.value || '').trim();
    if (!code) return Swal.fire('กรอกรหัสลับ', 'โปรดกรอกรหัสเพื่อรับคะแนน', 'info');
    RP_redeem(code, 'MANUAL');
  });

  RP_$('#btnCloseScan')?.addEventListener('click', () => {
    RP_stopScanner();
    bootstrap.Modal.getOrCreateInstance(RP_$('#scoreModal')).hide();
  });

  // กันลืม: ถ้ามีการ set uid ที่อื่นแล้ว ให้จำไว้ใน localStorage ด้วย
  const uidNow = RP_$('#uid')?.value?.trim();
  if (uidNow) RP_rememberUid(uidNow);
}

document.addEventListener('DOMContentLoaded', RP_bindUserUX);
