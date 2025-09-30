// ============ CONFIG ============
const liffID = "2007053300-QoEvbXyn"; // ใช้ LIFF เดียวกับหน้า user

// API endpoints (Vercel proxies)
const allScoresUrl     = "/api/all-scores";      // GET  ?adminUid=
const scoreHistoryUrl  = "/api/score-history";   // GET  ?uid=
const adminAdjustUrl   = "/api/admin-adjust";    // POST { adminUid, targetUid, delta, note }
const adminResetUrl    = "/api/admin-reset";     // POST { adminUid, targetUid, note }

// UI helpers (overlay)
const overlay = {
  show: (opts={}) => $.LoadingOverlay("show", { image:"", fontawesome:"fa fa-spinner fa-spin", text:"กำลังโหลด...", ...opts }),
  hide: () => $.LoadingOverlay("hide")
};

// ============ STATE ============
let ADMIN_UID = "";          // จาก LIFF
let ALL_USERS = [];          // [{uid,name,score}]
let FILTERED  = [];          // สำหรับ render

// ============ INIT ============
$(async function(){
  overlay.show({text:"กำลังเริ่มระบบแอดมิน..."});

  try{
    await liff.init({ liffId: liffID });
    if (!liff.isLoggedIn()) { liff.login(); return; }

    const prof = await liff.getProfile();
    ADMIN_UID = prof.userId;

    // header admin info
    $("#adminUid").text(`UID: ${ADMIN_UID}`);
    $("#adminName").text(prof.displayName || "—");
    $("#adminAvatar").attr("src", prof.pictureUrl || "https://placehold.co/36x36");

    // bind events
    bindEvents();

    // load data
    await reloadAllUsers();

  } catch(err){
    console.error(err);
    overlay.hide();
    Swal.fire("ผิดพลาด", "เริ่มต้นระบบ LIFF/โหลดข้อมูลไม่สำเร็จ", "error");
  }
});

// ============ EVENTS ============
function bindEvents(){
  $("#btnLogout").on("click", () => {
    liff.logout();
    location.reload();
  });

  $("#btnReload").on("click", async () => {
    await reloadAllUsers();
  });

  $("#txtSearch").on("input", function(){
    const q = $(this).val().trim().toLowerCase();
    if (!q){
      FILTERED = [...ALL_USERS];
    } else {
      FILTERED = ALL_USERS.filter(u =>
        (u.name||"").toLowerCase().includes(q) ||
        String(u.uid||"").toLowerCase().includes(q)
      );
    }
    renderTable(FILTERED);
  });

  // delegate row actions
  $("#tbodyUsers")
    .on("click", ".btn-history", async function(){
      const uid = $(this).data("uid");
      const name = $(this).data("name") || uid;
      await openHistory(uid, name);
    })
    .on("click", ".btn-plus", async function(){
      const uid  = $(this).data("uid");
      const name = $(this).data("name") || uid;
      await promptAdjust(uid, name, +1);
    })
    .on("click", ".btn-minus", async function(){
      const uid  = $(this).data("uid");
      const name = $(this).data("name") || uid;
      await promptAdjust(uid, name, -1);
    })
    .on("click", ".btn-reset", async function(){
      const uid  = $(this).data("uid");
      const name = $(this).data("name") || uid;
      await confirmReset(uid, name);
    });
}

// ============ LOAD & RENDER ============
async function reloadAllUsers(){
  overlay.show({text:"กำลังโหลดรายชื่อผู้ใช้..."});
  try{
    const res = await fetch(`${allScoresUrl}?adminUid=${encodeURIComponent(ADMIN_UID)}`);
    const json = await res.json();
    overlay.hide();

    if (json.status === "success"){
      ALL_USERS = (json.data || []).map(x => ({
        uid: x.uid,
        name: x.name || "(ไม่ระบุ)",
        score: Number(x.score||0)
      }));
      // sort by score desc by default
      ALL_USERS.sort((a,b) => b.score - a.score);
      FILTERED = [...ALL_USERS];
      renderTable(FILTERED);
    } else {
      Swal.fire("โหลดข้อมูลไม่สำเร็จ", json.message || "Apps Script error", "error");
    }
  }catch(e){
    overlay.hide();
    Swal.fire("ผิดพลาด", "ไม่สามารถดึงข้อมูลผู้ใช้ได้", "error");
  }
}

function renderTable(rows){
  const $tbody = $("#tbodyUsers");
  if (!rows || rows.length === 0){
    $tbody.html(`
      <tr><td colspan="4" class="text-center text-muted py-4">— ไม่พบข้อมูล —</td></tr>
    `);
    return;
  }

  let html = "";
  for (const r of rows){
    html += `
      <tr>
        <td><div class="fw-bold">${escapeHtml(r.name || "(ไม่ระบุ)")}</div></td>
        <td class="small text-break">${escapeHtml(r.uid)}</td>
        <td class="text-end"><span class="score-chip">${r.score}</span></td>
        <td class="text-end row-actions">
          <div class="btn-group">
            <button class="btn btn-soft btn-sm btn-history" data-uid="${attr(r.uid)}" data-name="${attr(r.name)}" title="ประวัติ">
              <i class="fa-regular fa-clock"></i>
            </button>
            <button class="btn btn-soft btn-sm btn-minus" data-uid="${attr(r.uid)}" data-name="${attr(r.name)}" title="หักคะแนน">
              <i class="fa-solid fa-circle-minus"></i>
            </button>
            <button class="btn btn-soft btn-sm btn-plus" data-uid="${attr(r.uid)}" data-name="${attr(r.name)}" title="เพิ่มคะแนน">
              <i class="fa-solid fa-circle-plus"></i>
            </button>
            <button class="btn btn-danger btn-sm btn-reset" data-uid="${attr(r.uid)}" data-name="${attr(r.name)}" title="ล้างคะแนนทั้งหมด">
              <i class="fa-solid fa-broom"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }
  $tbody.html(html);
}

// ============ ACTIONS ============
async function openHistory(uid, name){
  overlay.show({text:"กำลังโหลดประวัติ..."});
  try{
    const res = await fetch(`${scoreHistoryUrl}?uid=${encodeURIComponent(uid)}`);
    const json = await res.json();
    overlay.hide();

    if (json.status === "success"){
      const list = json.data || [];
      $("#historyUser").text(name || uid);

      if (!list.length){
        $("#historyList").html(`<div class="list-group-item bg-transparent text-center text-muted">ไม่มีรายการ</div>`);
      }else{
        const items = list.map(i => {
          const ts = formatDateTime(i.ts);
          const sign = Number(i.point||0) >= 0 ? "+" : "";
          const color = Number(i.point||0) >= 0 ? "#22c55e" : "#ef4444";
          return `
            <div class="list-group-item bg-transparent d-flex justify-content-between align-items-center">
              <div>
                <div class="fw-bold">${escapeHtml(i.type || "—")}</div>
                <div class="small muted">${escapeHtml(i.code || "")}</div>
              </div>
              <div class="text-end">
                <div style="color:${color}; font-weight:800">${sign}${i.point}</div>
                <div class="small muted">${ts}</div>
              </div>
            </div>
          `;
        }).join("");
        $("#historyList").html(items);
      }

      const m = new bootstrap.Modal(document.getElementById('historyModal'));
      m.show();
    } else {
      Swal.fire("ผิดพลาด", json.message || "โหลดประวัติไม่สำเร็จ", "error");
    }
  }catch(e){
    overlay.hide();
    Swal.fire("ผิดพลาด", "ไม่สามารถโหลดประวัติได้", "error");
  }
}

async function promptAdjust(uid, name, direction){
  // direction: +1 (add) หรือ -1 (deduct)
  const title = direction > 0 ? "เพิ่มคะแนน" : "หักคะแนน";
  const icon  = direction > 0 ? "success" : "warning";

  const { value: formValues } = await Swal.fire({
    title,
    icon,
    html:
      '<input id="adj-amount" type="number" class="swal2-input" placeholder="จำนวนคะแนน" />' +
      '<input id="adj-note" type="text" class="swal2-input" placeholder="หมายเหตุ (ถ้ามี)" />',
    focusConfirm: false,
    confirmButtonText: 'ยืนยัน',
    cancelButtonText: 'ยกเลิก',
    showCancelButton: true,
    preConfirm: () => {
      const amt = Number(document.getElementById('adj-amount').value || "0");
      const note = document.getElementById('adj-note').value || "";
      if (!amt || amt <= 0) {
        Swal.showValidationMessage("กรอกจำนวนคะแนน (>0)");
        return false;
      }
      return { amt, note };
    }
  });

  if (!formValues) return;

  const delta = direction > 0 ? formValues.amt : -formValues.amt;
  overlay.show({text:"กำลังอัปเดตคะแนน..."});
  try{
    const res = await fetch(adminAdjustUrl, {
      method: "POST",
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({
        adminUid: ADMIN_UID,
        targetUid: uid,
        delta,
        note: formValues.note || ""
      })
    });
    const json = await res.json();
    overlay.hide();

    if (json.status === "success"){
      Swal.fire("สำเร็จ", `${title}ให้ ${name} จำนวน ${Math.abs(delta)} คะแนนแล้ว`, "success");
      // อัปเดตแถวในตารางแบบเร็ว ๆ
      updateRowScore(uid, json.to);
    } else {
      Swal.fire("ไม่สำเร็จ", json.message || "ไม่สามารถปรับคะแนนได้", "error");
    }
  }catch(e){
    overlay.hide();
    Swal.fire("ผิดพลาด", "ติดต่อเซิร์ฟเวอร์ไม่สำเร็จ", "error");
  }
}

async function confirmReset(uid, name){
  const ok = await Swal.fire({
    title: "ล้างคะแนนทั้งหมด?",
    html: `คุณกำลังจะล้างคะแนนของ <b>${escapeHtml(name)}</b> เป็น <b>0</b>`,
    icon: "warning",
    showCancelButton: true,
    confirmButtonText: 'ยืนยัน',
    cancelButtonText: 'ยกเลิก'
  });
  if (!ok.isConfirmed) return;

  overlay.show({text:"กำลังล้างคะแนน..."});
  try{
    const res = await fetch(adminResetUrl, {
      method: "POST",
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({
        adminUid: ADMIN_UID,
        targetUid: uid,
        note: "Admin reset via UI"
      })
    });
    const json = await res.json();
    overlay.hide();

    if (json.status === "success"){
      Swal.fire("สำเร็จ", `ล้างคะแนนของ ${name} แล้ว`, "success");
      updateRowScore(uid, 0);
    } else {
      Swal.fire("ไม่สำเร็จ", json.message || "ไม่สามารถล้างคะแนนได้", "error");
    }
  }catch(e){
    overlay.hide();
    Swal.fire("ผิดพลาด", "ติดต่อเซิร์ฟเวอร์ไม่สำเร็จ", "error");
  }
}

// ============ UTIL ============
function updateRowScore(uid, newScore){
  // อัปเดตใน ALL_USERS / FILTERED
  for (const arr of [ALL_USERS, FILTERED]){
    const idx = arr.findIndex(x => x.uid === uid);
    if (idx !== -1) arr[idx].score = Number(newScore||0);
  }
  // อัปเดต UI เฉพาะแถว (เร็ว)
  const $row = $(`#tbodyUsers tr`).filter(function(){
    return $(this).find('td:eq(1)').text().trim() === uid;
  });
  $row.find('.score-chip').text(newScore);

  // ใส่เอฟเฟ็กต์วิ๊ง
  $row.addClass('table-success');
  setTimeout(()=> $row.removeClass('table-success'), 800);
}

function escapeHtml(s){
  return String(s||"").replace(/[&<>"'`=\/]/g, a => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','/':'&#47;','`':'&#x60;','=':'&#x3D;'
  }[a]));
}
function attr(s){ return String(s||"").replace(/"/g,'&quot;'); }
function pad(n){ return n<10? "0"+n : n; }
function formatDateTime(ts){
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
