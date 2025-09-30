/* ===========================
 * Royal Point - app.js (final)
 * =========================== */

/* ---------- Config: API endpoints ---------- */
const API_GET_SCORE = "/api/get-score";
const API_HISTORY   = "/api/score-history";
const API_SPEND     = "/api/spend";
const API_REDEEM    = "/api/redeem";

/* ---------- Level / Tier ---------- */
const TIERS = [
  { key: "Silver",    min:   0 },
  { key: "Gold",      min: 500 },
  { key: "Platinum",  min:1200 }
];

/* ---------- State ---------- */
let UID = "";            // จะ resolve ใน initApp()
let prevScore = 0;       // คะแนนล่าสุดที่โหลดสำเร็จ
let _qr = null;          // instance ของ Html5Qrcode (สแกน)

/* ---------- Helpers ---------- */
const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));
function setText(idOrEl, text){
  const el = typeof idOrEl === 'string' ? document.getElementById(idOrEl) : idOrEl;
  if (el) el.textContent = String(text);
}
function escapeHtml(s){
  s = String(s||'');
  return s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}
function toastErr(msg){
  if (window.Swal) Swal.fire('ผิดพลาด', msg || 'เกิดข้อผิดพลาด', 'error');
  else alert(msg || 'เกิดข้อผิดพลาด');
}
function toastOk(msg){
  if (window.Swal) Swal.fire('สำเร็จ', msg || 'ทำรายการสำเร็จ', 'success');
  else alert(msg || 'ทำรายการสำเร็จ');
}

/* ---------- Resolve UID ---------- */
function resolveUID(){
  const fromUrl   = new URLSearchParams(location.search).get('uid');
  const fromCache = localStorage.getItem('rp_uid');
  const uid = (window.UID || fromUrl || fromCache || '').trim();
  if (uid) localStorage.setItem('rp_uid', uid);
  return uid;
}

// ถ้าไม่มี UID ให้ถามผู้ใช้ครั้งแรก แล้วจำไว้ใน localStorage
async function ensureUID() {
  UID = resolveUID();
  if (UID) return UID;

  if (window.Swal) {
    const { value } = await Swal.fire({
      title: 'กรอก UID',
      input: 'text',
      inputPlaceholder: 'Uxxxxxxxxxxxxxxxxxxxx',
      inputValidator: v => !String(v || '').trim() ? 'กรุณากรอก UID' : undefined,
      allowOutsideClick: false,
      allowEscapeKey: false,
      confirmButtonText: 'บันทึก'
    });
    UID = String(value || '').trim();
  } else {
    UID = String(prompt('กรุณากรอก UID')).trim();
  }

  if (!UID) throw new Error('UID is empty');

  localStorage.setItem('rp_uid', UID);
  window.UID = UID;
  return UID;
}

/* ---------- Tier utils ---------- */
function getTier(score){
  score = Number(score||0);
  let cur = TIERS[0], next = null;
  for (let i=0; i<TIERS.length; i++){
    if (score >= TIERS[i].min) cur = TIERS[i];
    if (i < TIERS.length-1 && score < TIERS[i+1].min){ next = TIERS[i+1]; break; }
  }
  if (!next) next = null; // ระดับสูงสุดแล้ว
  const base = cur.min;
  const top  = next ? next.min : Math.max(base+500, score); // กันหาร 0
  const pct  = Math.max(0, Math.min(100, ((score - base) * 100) / (top - base)));
  return { cur, next, base, top, pct, need: next ? Math.max(0, next.min - score) : 0 };
}

/* ---------- Update Level UI ---------- */
function updateLevelTrack(score){
  const t = getTier(score);

  // แสดงคะแนนรวม
  // รองรับหลาย id ที่อาจมีอยู่ในหน้า
  ['pointValue','pointNumber','scorePoint','score'].forEach(id => setText(id, score));

  // ป้ายระดับ
  setText('levelBadge', t.cur.key);
  setText('levelBadgeText', t.cur.key);

  // ข้อความความก้าวหน้า
  if (t.next){
    setText('levelNext', t.next.key);
    setText('levelNeed', t.need);
  } else {
    setText('levelNext', '—');
    setText('levelNeed', '0');
  }

  // แถบ progress: รองรับทั้ง input[type=range] และ div.fill
  const range = document.getElementById('levelProgressRange');
  if (range){
    // ถ้าเป็น range เราจะโชว์ตัวบ่งตำแหน่ง (ค่า range ไม่ได้เปลี่ยนจริง แต่ใช้แค่ UI)
    range.value = t.pct;
  }
  const fill = document.getElementById('levelBarFill');
  if (fill){
    fill.style.width = `${t.pct}%`;
  }

  // บริเวณตัวเลขจุดยึด (0 / 500 / 1200+)
  setText('tierBase', t.base);
  setText('tierNext', t.top);
}

/* ---------- Rewards (STATIC) ---------- */
const REWARDS = [
  { id:'COUPON_50', name:'คูปองส่วนลด 50฿',  img:'https://placehold.co/640x480?text=Coupon+50', cost:50 },
  { id:'DRINK',     name:'เครื่องดื่ม 1 แก้ว', img:'https://placehold.co/640x480?text=Drink',     cost:120 },
  { id:'T_SHIRT',   name:'เสื้อยืดสวยๆ',      img:'https://placehold.co/640x480?text=T-Shirt',   cost:300 },
  { id:'PREMIUM',   name:'ของพรีเมียม',        img:'https://placehold.co/640x480?text=Premium',   cost:500 }
];

function renderRewards(currentScore){
  const rail = document.getElementById('rewardRail');
  if (!rail) return;
  rail.innerHTML = (REWARDS||[]).map(r=>{
    const locked = Number(currentScore||0) < Number(r.cost||0);
    return `
      <div class="rp-reward-card ${locked?'locked':''}" data-id="${r.id}" data-cost="${r.cost}">
        <div class="rp-reward-img">
          <img src="${r.img || 'https://placehold.co/640x480?text=Reward'}" alt="${escapeHtml(r.name||r.id)}">
        </div>
        <div class="rp-reward-body p-2">
          <div class="d-flex justify-content-between align-items-center">
            <div class="fw-bold text-truncate">${escapeHtml(r.name||r.id)}</div>
            <span class="rp-reward-cost">${Number(r.cost||0)} pt</span>
          </div>
        </div>
        <button class="rp-redeem-btn" title="แลกรางวัล" aria-label="แลกรางวัล" ${locked?"disabled":""}>
          <i class="fa-solid fa-gift"></i>
        </button>
      </div>
    `;
  }).join("");
}

function bindRedeemClicks(){
  const rail = document.getElementById('rewardRail');
  if (!rail || rail.dataset.bound) return;
  rail.dataset.bound = "1";
  rail.addEventListener('click', async (ev)=>{
    const btn = ev.target.closest('.rp-redeem-btn');
    if (!btn) return;
    const card = btn.closest('.rp-reward-card');
    const id   = card?.dataset?.id;
    const cost = Number(card?.dataset?.cost || 0);
    await redeemReward({ id, cost }, btn);
  });
}

// SHIM: รองรับโค้ดเก่าที่เรียก loadRewards()
if (typeof window.loadRewards !== 'function') {
  window.loadRewards = function(){
    try { renderRewards(prevScore || 0); } catch(e){ console.error(e); }
  };
}

/* ---------- คะแนน & Level ---------- */
function setPoints(score){
  score = Math.max(0, Number(score||0));
  prevScore = score;
  updateLevelTrack(score);
  // อัปเดตสถานะการล็อก/ปลดล็อคของรางวัล
  renderRewards(score);
}

async function refreshUserScore(){
  if (!UID){
    setPoints(0);
    throw new Error('UID is empty');
  }
  const url = `${API_GET_SCORE}?uid=${encodeURIComponent(UID)}`;
  const r   = await fetch(url);
  const t   = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = { status:r.ok?'success':'error', message:t }; }
  if (j.status !== 'success') throw new Error(j.message || 'load score failed');

  const sc = Number(j.data?.score || 0);
  setPoints(sc);
}

/* ---------- ประวัติคะแนน ---------- */
async function openHistory(){
  try{
    if (!UID) throw new Error('UID is empty');
    const url = `${API_HISTORY}?uid=${encodeURIComponent(UID)}`;
    const r   = await fetch(url);
    const t   = await r.text();
    let j; try { j = JSON.parse(t); } catch { j = { status:r.ok?'success':'error', message:t }; }
    if (j.status !== 'success') throw new Error(j.message || 'load history failed');

    const rows = j.data || [];
    const listEl = document.getElementById('historyList');
    if (listEl){
      listEl.innerHTML = rows.map(x=>{
        const ts = x.ts ? new Date(x.ts) : null;
        const time = ts ? ts.toLocaleString() : '-';
        const p = Number(x.point||0);
        const sign = p>0?'+':'';
        return `
          <div class="d-flex justify-content-between border-bottom py-2">
            <div>
              <div class="fw-semibold">${escapeHtml(x.type||'-')}</div>
              <div class="small text-muted">${escapeHtml(x.code||'')}</div>
            </div>
            <div class="fw-bold ${p>=0?'text-success':'text-danger'}">${sign}${p}</div>
          </div>
        `;
      }).join('') || `<div class="text-center text-muted py-4">ยังไม่มีประวัติ</div>`;
      new bootstrap.Modal(document.getElementById('historyModal')).show();
    }else{
      // fallback
      alert('ประวัติ\n' + rows.map(x => `${x.type||''} ${x.point||0}`).join('\n'));
    }
  }catch(e){
    console.error(e);
    toastErr('ไม่สามารถโหลดประวัติได้');
  }
}

/* ---------- แลกรางวัล (หักคะแนน) ---------- */
let REDEEMING = false;
async function redeemReward(reward, btn){
  if (REDEEMING) return;
  if (!UID) return toastErr('ยังไม่พร้อมใช้งาน');

  const id   = reward?.id;
  const cost = Math.max(0, Number(reward?.cost||0));
  if (!id || !cost) return toastErr('ข้อมูลรางวัลไม่ถูกต้อง');

  const scoreNow = Number(prevScore||0);
  if (scoreNow < cost) return toastErr('คะแนนไม่พอสำหรับรางวัลนี้');

  const ok = window.Swal
    ? (await Swal.fire({
        title:'ยืนยันการแลก?',
        html:`จะใช้ <b>${cost} pt</b> แลกรางวัล <b>${escapeHtml(id)}</b>`,
        icon:'question', showCancelButton:true, confirmButtonText:'แลกเลย'
      })).isConfirmed
    : confirm(`ใช้ ${cost} pt แลกรางวัล ${id}?`);
  if (!ok) return;

  REDEEMING = true;
  const oldDis = btn?.disabled;
  if (btn){ btn.disabled = true; btn.classList.add('is-loading'); }

  try{
    const r = await fetch(API_SPEND, {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ uid: UID, cost, rewardId: id })
    });
    const t = await r.text();
    let j; try { j = JSON.parse(t); } catch { j = { status:r.ok?'success':'error', message:t }; }
    if (j.status !== 'success') throw new Error(j.message || 'spend failed');

    await refreshUserScore();
    if (window.Swal){
      await Swal.fire({
        title:'แลกสำเร็จ ✅',
        html:`ใช้ไป <b>${cost} pt</b><br><small>กรุณาแคปหน้าจอนี้ไว้เพื่อนำไปแสดงรับรางวัล</small>`,
        icon:'success'
      });
    }else{
      alert('แลกสำเร็จ! กรุณาแคปหน้าจอไว้เพื่อนำไปแสดงรับรางวัล');
    }
  }catch(e){
    console.error(e);
    toastErr('แลกรางวัลไม่สำเร็จ');
  }finally{
    REDEEMING = false;
    if (btn){ btn.disabled = oldDis ?? false; btn.classList.remove('is-loading'); }
  }
}

/* ---------- Redeem code (สแกน/กรอก) ---------- */
async function redeemCode(code, type){
  try{
    const body = { uid: UID, code: String(code||'').trim(), type: type || 'MANUAL' };
    if (!body.code) return toastErr('กรุณากรอกรหัส');
    const r = await fetch(API_REDEEM, {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify(body)
    });
    const t = await r.text();
    let j; try { j = JSON.parse(t); } catch { j = { status:r.ok?'success':'error', message:t }; }
    if (j.status !== 'success') throw new Error(j.message || 'redeem failed');

    await refreshUserScore();
    toastOk('รับคะแนนสำเร็จ');
  }catch(e){
    console.error(e);
    toastErr('ไม่สามารถรับคะแนนได้');
  }
}

/* ---------- Scanner (html5-qrcode) ---------- */
async function startScanner(){
  try{
    if (typeof Html5Qrcode === 'undefined'){
      toastErr('ไม่พบตัวสแกน (html5-qrcode)'); return;
    }
    if (_qr){ await stopScanner(); }

    // ตรวจอุปกรณ์กล้อง
    const devices = await navigator.mediaDevices.enumerateDevices().catch(()=>[]);
    const cams = devices.filter(d => d.kind === 'videoinput');
    if (!cams.length){ toastErr('ไม่พบอุปกรณ์กล้องบนเครื่องนี้'); return; }

    // เลือกกล้องหลังถ้ามี
    const back = cams.find(d => /back|rear|environment|facing back/i.test(d.label||''));
    const deviceId = back?.deviceId || cams[cams.length - 1].deviceId;

    const el = document.getElementById('qr-reader');
    if (!el){ toastErr('ไม่พบจุดแสดงกล้อง (qr-reader)'); return; }

    _qr = new Html5Qrcode('qr-reader');
    await _qr.start(
      { deviceId },
      { fps: 10, qrbox: { width: 250, height: 250 } },
      onScanSuccess,
      () => {} // ignore scan errors
    );
  }catch(err){
    console.warn('Scanner start failed:', err);
    toastErr('ไม่สามารถเปิดกล้องได้');
    await stopScanner();
  }
}

async function stopScanner(){
  try{
    if (_qr){ await _qr.stop(); await _qr.clear(); }
  }catch(_){}
  _qr = null;
}

function onScanSuccess(text){
  const code = (text||'').trim();
  if (!code) return;
  stopScanner();
  redeemCode(code, 'SCAN');
}

/* ---------- Bind UI ---------- */
function bindUI(){
  // ปุ่มสแกน: เปิด modal อย่างเดียว (กดเปิดกล้องใน modal เอง)
  document.getElementById('btnScan')?.addEventListener('click', () => {
    const m = document.getElementById('redeemModal');
    if (m) new bootstrap.Modal(m).show();
  });

  // ปุ่มประวัติ
  document.getElementById('btnHistory')?.addEventListener('click', openHistory);

  // ปุ่มในโมดัลสแกน
  document.getElementById('startScanBtn')?.addEventListener('click', startScanner);
  document.getElementById('stopScanBtn')?.addEventListener('click', stopScanner);
  document.getElementById('submitCodeBtn')?.addEventListener('click', () => {
    const v = document.getElementById('secretCode')?.value || '';
    redeemCode(v, 'MANUAL');
  });
}

/* ---------- Init ---------- */
async function initApp(){
  // 1) ให้แน่ใจก่อนว่าเรามี UID
  await ensureUID();          // <— เพิ่มบรรทัดนี้

  // 2) bind ปุ่ม/อีเวนต์
  bindUI();
  bindRedeemClicks();

  // 3) โหลดคะแนน + render rewards
  try{
    await refreshUserScore(); // setPoints() -> updateLevelTrack + renderRewards
  }catch(e){
    console.error(e);
    if (window.Swal) Swal.fire('ผิดพลาด','โหลดข้อมูลไม่สำเร็จ','error');
  }
}

document.getElementById('btnSwitchUser')?.addEventListener('click', async () => {
  localStorage.removeItem('rp_uid');
  window.UID = '';
  await ensureUID();
  await refreshUserScore();
});


document.addEventListener('DOMContentLoaded', initApp);
