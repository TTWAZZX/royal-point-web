/* ================== CONFIG ================== */
const ADMIN_UID = "Ucadb3c0f63ada96c0432a0aede267ff9";

/* proxy endpoints */
const API = {
  allScores   : "/api/all-scores",
  adj         : "/api/admin-adjust",
  reset       : "/api/admin-reset",
  history     : "/api/score-history"
};

/* =========== Tiny overlay =========== */
const overlay = (() => {
  let el;
  return {
    show(msg="กำลังโหลด...") {
      if (el) return;
      el = document.createElement('div');
      el.style.cssText = `position:fixed;inset:0;background:rgba(4,8,15,.6);
                          display:flex;align-items:center;justify-content:center;z-index:2000`;
      el.innerHTML = `<div style="background:#101a2b;border:1px solid rgba(255,255,255,.08);
                       color:#e6f2ff;padding:18px 22px;border-radius:12px;
                       box-shadow:0 10px 30px rgba(0,0,0,.45)">
                       <i class="fa-solid fa-spinner fa-spin me-2"></i>${msg}</div>`;
      document.body.appendChild(el);
    },
    hide(){ if(el){ el.remove(); el=null; } }
  };
})();

/* =========== STATE/DOM =========== */
const $ = s => document.querySelector(s);
const $tbody   = $('#tbody');
const $q       = $('#q');
let rows = [];
let selected = null; // {uid,name,score}
const adjustModal  = new bootstrap.Modal(document.getElementById('adjustModal'));
const historyModal = new bootstrap.Modal(document.getElementById('historyModal'));

/* =========== Helpers =========== */
const fmt = n => Number(n||0).toLocaleString('th-TH');

function renderSkeleton(n=8){
  $tbody.innerHTML='';
  for(let i=0;i<n;i++){
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><div class="skeleton"></div></td>
                    <td class="text-end"><div class="skeleton"></div></td>
                    <td class="text-end"><div class="skeleton"></div></td>`;
    $tbody.appendChild(tr);
  }
}
function render(){
  const q = ($q.value||'').toLowerCase().trim();
  const list = rows.filter(r =>
    !q || (r.name && r.name.toLowerCase().includes(q)) || (r.uid && r.uid.toLowerCase().includes(q))
  );

  $tbody.innerHTML='';
  if (!list.length){
    const tr = document.createElement('tr');
    tr.innerHTML = `<td colspan="3" class="text-center py-4 text-secondary">ไม่พบข้อมูล</td>`;
    $tbody.appendChild(tr);
    return;
  }

  for(const r of list){
    const tr = document.createElement('tr');
    tr.dataset.uid   = r.uid;
    tr.dataset.name  = r.name||'';
    tr.dataset.score = Number(r.score||0);

    tr.innerHTML = `
      <td>
        <div class="fw-semibold">${r.name||'-'}</div>
        <div class="small text-secondary">${r.uid||''}</div>
      </td>
      <td class="text-end"><span class="badge bg-info-subtle text-info-emphasis border border-info">${fmt(r.score)}</span></td>
      <td class="text-end">
        <div class="btn-group">
          <button class="btn btn-ghost btn-sm" data-act="minus" title="ลบคะแนน"><i class="fa-solid fa-minus"></i></button>
          <button class="btn btn-primary btn-sm" data-act="plus" title="เพิ่มคะแนน"><i class="fa-solid fa-plus"></i></button>
          <button class="btn btn-warning btn-sm" data-act="reset" title="ล้างคะแนน"><i class="fa-solid fa-rotate-left"></i></button>
          <button class="btn btn-ghost btn-sm" data-act="history" title="ประวัติ"><i class="fa-solid fa-clock-rotate-left"></i></button>
        </div>
      </td>`;
    $tbody.appendChild(tr);
  }
}

async function loadAll(){
  renderSkeleton();
  try{
    const r = await fetch(`${API.allScores}?adminUid=${encodeURIComponent(ADMIN_UID)}`,{cache:'no-store'});
    const js = await r.json();
    if (js.status!=='success') throw new Error(js.message||'โหลดไม่สำเร็จ');
    rows = js.data || [];
    render();
  }catch(err){
    $tbody.innerHTML = `<tr><td colspan="3" class="text-danger">โหลดข้อมูลไม่สำเร็จ: ${err.message||err}</td></tr>`;
  }
}

/* =========== Adjust / Reset =========== */
function openAdjust(uid,name,score){
  selected = {uid,name,score};
  $('#ajUid').textContent = uid;
  $('#ajUid').href = `https://liff.line.me/2007053300-QoEvbXyn?uid=${encodeURIComponent(uid)}`;
  $('#ajDelta').value = 50;
  $('#ajNote').value  = '';
  adjustModal.show();
}
async function doAdjust(delta){
  if (!selected) return;
  overlay.show('กำลังบันทึก...');
  try{
    const r = await fetch(API.adj,{
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        adminUid:ADMIN_UID, targetUid:selected.uid,
        delta:Number(delta), note:$('#ajNote').value||''
      })
    });
    const js = await r.json();
    if (js.status!=='success') throw new Error(js.message||'ปรับคะแนนไม่สำเร็จ');
    await loadAll();
    adjustModal.hide();
  }catch(err){
    alert(err.message||err);
  }finally{ overlay.hide(); }
}
async function doReset(){
  if (!selected) return;
  if (!confirm(`ล้างคะแนนของ ${selected.name||selected.uid}?`)) return;
  overlay.show('กำลังล้างคะแนน...');
  try{
    const r = await fetch(API.reset,{
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        adminUid:ADMIN_UID, targetUid:selected.uid,
        note:$('#ajNote').value||''
      })
    });
    const js = await r.json();
    if (js.status!=='success') throw new Error(js.message||'ล้างคะแนนไม่สำเร็จ');
    await loadAll();
    adjustModal.hide();
  }catch(err){
    alert(err.message||err);
  }finally{ overlay.hide(); }
}

/* =========== History =========== */
async function openHistory(uid,name){
  $('#histUser').textContent = `${name||'-'} · ${uid}`;
  const body = $('#histBody'); body.innerHTML='';
  body.innerHTML = `<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>`;
  historyModal.show();
  try{
    const r = await fetch(`${API.history}?uid=${encodeURIComponent(uid)}`,{cache:'no-store'});
    const js = await r.json();
    if (js.status!=='success') throw new Error(js.message||'โหลดประวัติไม่สำเร็จ');
    body.innerHTML='';
    if (!js.data || !js.data.length) {
      body.innerHTML = `<div class="text-secondary">— ไม่มีรายการ —</div>`;
      return;
    }
    for(const h of js.data){
      const card = document.createElement('div');
      const ts = new Date(h.ts);
      const sign = h.point>=0?'+':'';
      card.className = 'card-pane';
      card.innerHTML = `
        <div class="d-flex justify-content-between">
          <div>
            <div class="fw-semibold">${h.type||'-'}</div>
            <div class="small text-secondary">${h.code||''}</div>
          </div>
          <div class="text-end">
            <div class="${h.point>=0?'text-success':'text-danger'} fw-bold">${sign}${h.point}</div>
            <div class="small text-secondary">${ts.toLocaleString('th-TH')}</div>
          </div>
        </div>`;
      body.appendChild(card);
    }
  }catch(err){
    body.innerHTML = `<div class="text-danger">ผิดพลาด: ${err.message||err}</div>`;
  }
}

/* =========== Export CSV =========== */
function exportCsv(){
  const data = [['name','uid','score'], ...rows.map(r=>[r.name||'', r.uid||'', r.score||0])];
  const csv = data.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv],{type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url; a.download=`royal-scores-${Date.now()}.csv`; a.click();
  URL.revokeObjectURL(url);
}

/* =========== Events =========== */
document.addEventListener('click', e=>{
  const btn = e.target.closest('button'); if (!btn) return;

  if (btn.id==='btnReload') return loadAll();
  if (btn.id==='btnExport') return exportCsv();

  if (btn.id==='btnAdjAdd')    return doAdjust(Math.abs(Number($('#ajDelta').value||0)));
  if (btn.id==='btnAdjDeduct') return doAdjust(-Math.abs(Number($('#ajDelta').value||0)));
  if (btn.id==='btnAdjReset')  return doReset();

  // row actions
  if (btn.dataset.act){
    const tr = btn.closest('tr');
    const uid = tr.dataset.uid, name = tr.dataset.name, score = Number(tr.dataset.score||0);
    if (btn.dataset.act==='plus'){ openAdjust(uid,name,score); $('#ajDelta').value=50;  return; }
    if (btn.dataset.act==='minus'){openAdjust(uid,name,score); $('#ajDelta').value=-50; return; }
    if (btn.dataset.act==='reset'){openAdjust(uid,name,score); $('#ajDelta').value=0;   return; }
    if (btn.dataset.act==='history') return openHistory(uid,name);
  }
});
$q.addEventListener('input', render);

/* =========== INIT =========== */
loadAll();
