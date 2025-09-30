// ============ CONFIG ============
const LIFF_ID = "2007053300-QoEvbXyn";
const API_ALL_SCORES    = "/api/all-scores";     // GET  ?uid=
const API_SCORE_HISTORY = "/api/score-history";  // GET  ?uid=
const API_ADMIN_ADJUST  = "/api/admin-adjust";   // POST { adminUid, targetUid, delta, note }
const API_ADMIN_RESET   = "/api/admin-reset";    // POST { adminUid, targetUid, note }

// UI helpers
const overlay = {
  show: (text = "กำลังทำงาน...") => {
    if (window.$?.LoadingOverlay) {
      $.LoadingOverlay("show", { image: "", fontawesome: "fa fa-spinner fa-spin", text });
    } else {
      if (document.getElementById("admin-ovl")) return;
      const el = document.createElement("div");
      el.id = "admin-ovl";
      el.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:4000;color:#fff";
      el.innerHTML = `<div class="bg-dark rounded-3 px-3 py-2"><i class="fa fa-spinner fa-spin me-2"></i>${text}</div>`;
      document.body.appendChild(el);
    }
  },
  hide: () => {
    if (window.$?.LoadingOverlay) $.LoadingOverlay("hide");
    else document.getElementById("admin-ovl")?.remove();
  }
};

// ============ STATE ============
let ADMIN_UID = "";
let ALL_USERS = [];
let FILTERED  = [];

// ============ INIT ============
$(async function () {
  overlay.show("กำลังเริ่มระบบแอดมิน...");
  try {
    await liff.init({ liffId: LIFF_ID });
    if (!liff.isLoggedIn()) { liff.login(); return; }

      const prof = await liff.getProfile();
      UID = prof.userId;
      showAdminEntry(ADMIN_UIDS.includes(UID));

    ADMIN_UID = prof.userId || "";

    $("#adminUid").text(ADMIN_UID ? `UID: ${ADMIN_UID}` : "UID: —");
    $("#adminName").text(prof.displayName || "—");
    $("#adminAvatar").attr("src", prof.pictureUrl || "https://placehold.co/36x36");

    bindEvents();
    await reloadAllUsers();
  } catch (err) {
    console.error(err);
    Swal.fire("ผิดพลาด", "เริ่มต้นระบบ LIFF/โหลดข้อมูลไม่สำเร็จ", "error");
  } finally {
    overlay.hide();
  }
});

// ============ EVENTS ============
function bindEvents() {
  $("#btnLogout").on("click", () => { liff.logout(); location.reload(); });
  $("#btnReload").on("click", async () => { await reloadAllUsers(); });

  $("#txtSearch").on("input", function () {
    const q = ($(this).val() || "").trim().toLowerCase();
    FILTERED = !q ? [...ALL_USERS] : ALL_USERS.filter(u =>
      (u.name || "").toLowerCase().includes(q) || String(u.uid || "").toLowerCase().includes(q)
    );
    renderTable(FILTERED);
  });

  $("#tbodyUsers")
    .on("click", ".btn-history", async function () {
      const uid  = $(this).data("uid");
      const name = $(this).data("name") || uid;
      await openHistory(uid, name);
    })
    .on("click", ".btn-plus", async function () {
      const uid  = $(this).data("uid"); const name = $(this).data("name") || uid;
      await promptAdjust(uid, name, +1);
    })
    .on("click", ".btn-minus", async function () {
      const uid  = $(this).data("uid"); const name = $(this).data("name") || uid;
      await promptAdjust(uid, name, -1);
    })
    .on("click", ".btn-reset", async function () {
      const uid  = $(this).data("uid"); const name = $(this).data("name") || uid;
      await confirmReset(uid, name);
    });
}

// ============ LOAD & RENDER ============
async function reloadAllUsers() {
  if (!ADMIN_UID) { ALL_USERS = []; FILTERED = []; renderTable(FILTERED); return; }
  overlay.show("กำลังโหลดรายชื่อผู้ใช้...");
  try {
    // ต้องใช้ ?uid= กับ /api/all-scores (ฝั่ง API คาดหวังแบบนี้):contentReference[oaicite:0]{index=0}
    const res  = await fetch(`${API_ALL_SCORES}?uid=${encodeURIComponent(ADMIN_UID)}`, { cache: "no-store" });
    const json = await res.json();
    if (json.status === "success") {
      ALL_USERS = (json.data || []).map(x => ({ uid: x.uid, name: x.name || "(ไม่ระบุ)", score: Number(x.score || 0) }));
      ALL_USERS.sort((a,b) => b.score - a.score);
      FILTERED = [...ALL_USERS];
      renderTable(FILTERED);
    } else {
      Swal.fire("โหลดข้อมูลไม่สำเร็จ", json.message || "Apps Script error", "error");
      ALL_USERS = []; FILTERED = []; renderTable(FILTERED);
    }
  } catch (e) {
    console.error(e);
    Swal.fire("ผิดพลาด", "ไม่สามารถดึงข้อมูลผู้ใช้ได้", "error");
  } finally { overlay.hide(); }
}

function renderTable(rows) {
  const $tbody = $("#tbodyUsers");
  if (!rows || rows.length === 0) {
    $tbody.html(`<tr><td colspan="4" class="text-center text-muted py-4">— ไม่พบข้อมูล —</td></tr>`); return;
  }
  let html = "";
  for (const r of rows) {
    html += `
      <tr>
        <td><div class="fw-bold">${escapeHtml(r.name || "(ไม่ระบุ)")}</div></td>
        <td class="small text-break">${escapeHtml(r.uid)}</td>
        <td class="text-end"><span class="score-chip">${Number(r.score || 0)}</span></td>
        <td class="text-end">
          <div class="btn-group">
            <button class="btn btn-soft btn-sm btn-history" data-uid="${attr(r.uid)}" data-name="${attr(r.name)}" title="ประวัติ"><i class="fa-regular fa-clock"></i></button>
            <button class="btn btn-soft btn-sm btn-minus"   data-uid="${attr(r.uid)}" data-name="${attr(r.name)}" title="หักคะแนน"><i class="fa-solid fa-circle-minus"></i></button>
            <button class="btn btn-soft btn-sm btn-plus"    data-uid="${attr(r.uid)}" data-name="${attr(r.name)}" title="เพิ่มคะแนน"><i class="fa-solid fa-circle-plus"></i></button>
            <button class="btn btn-danger btn-sm btn-reset" data-uid="${attr(r.uid)}" data-name="${attr(r.name)}" title="ล้างคะแนนทั้งหมด"><i class="fa-solid fa-broom"></i></button>
          </div>
        </td>
      </tr>`;
  }
  $tbody.html(html);
}

// ============ ACTIONS ============
async function openHistory(uid, name) {
  overlay.show("กำลังโหลดประวัติ...");
  try {
    const res  = await fetch(`${API_SCORE_HISTORY}?uid=${encodeURIComponent(uid)}`);
    const json = await res.json();
    if (json.status === "success") {
      const list = json.data || [];
      $("#historyUser").text(name || uid);
      if (!list.length) {
        $("#historyList").html(`<div class="list-group-item bg-transparent text-center text-muted">ไม่มีรายการ</div>`);
      } else {
        $("#historyList").html(list.map(i => {
          const ts = formatDateTime(i.ts), p = Number(i.point || 0);
          const sign = p >= 0 ? "+" : "", color = p >= 0 ? "#22c55e" : "#ef4444";
          return `<div class="list-group-item bg-transparent d-flex justify-content-between align-items-center">
                    <div><div class="fw-bold">${escapeHtml(i.type || "—")}</div><div class="small muted">${escapeHtml(i.code || "")}</div></div>
                    <div class="text-end"><div style="color:${color};font-weight:800">${sign}${p}</div><div class="small muted">${ts}</div></div>
                  </div>`;
        }).join(""));
      }
      new bootstrap.Modal(document.getElementById("historyModal")).show();
    } else {
      Swal.fire("ผิดพลาด", json.message || "โหลดประวัติไม่สำเร็จ", "error");
    }
  } catch (e) {
    console.error(e); Swal.fire("ผิดพลาด", "ไม่สามารถโหลดประวัติได้", "error");
  } finally { overlay.hide(); }
}

async function promptAdjust(uid, name, direction) {
  const title = direction > 0 ? "เพิ่มคะแนน" : "หักคะแนน";
  const { value: formValues } = await Swal.fire({
    title, icon: direction > 0 ? "success" : "warning",
    html:'<input id="adj-amount" type="number" class="swal2-input" placeholder="จำนวนคะแนน" />' +
         '<input id="adj-note"   type="text"   class="swal2-input" placeholder="หมายเหตุ (ถ้ามี)" />',
    showCancelButton: true, confirmButtonText: "ยืนยัน", cancelButtonText: "ยกเลิก",
    preConfirm: () => {
      const amt = Number(document.getElementById("adj-amount").value || "0");
      const note = document.getElementById("adj-note").value || "";
      if (!amt || amt <= 0) { Swal.showValidationMessage("กรอกจำนวนคะแนน (>0)"); return false; }
      return { amt, note };
    }
  });
  if (!formValues) return;
  const delta = direction > 0 ? formValues.amt : -formValues.amt;

  overlay.show("กำลังอัปเดตคะแนน...");
  try {
    const res  = await fetch(API_ADMIN_ADJUST, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adminUid: ADMIN_UID, targetUid: uid, delta, note: formValues.note || "" })
    });
    const json = await res.json();
    if (json.status === "success") {
      Swal.fire("สำเร็จ", `${title}ให้ ${escapeHtml(name)} จำนวน ${Math.abs(delta)} คะแนนแล้ว`, "success");
      const newScore = typeof json.to !== "undefined" ? Number(json.to) : (getLocalScore(uid) + delta);
      updateRowScore(uid, newScore);
    } else {
      Swal.fire("ไม่สำเร็จ", json.message || "ไม่สามารถปรับคะแนนได้", "error");
    }
  } catch (e) {
    console.error(e); Swal.fire("ผิดพลาด", "ติดต่อเซิร์ฟเวอร์ไม่สำเร็จ", "error");
  } finally { overlay.hide(); }
}

async function confirmReset(uid, name) {
  const ok = await Swal.fire({
    title: "ล้างคะแนนทั้งหมด?", html: `คุณกำลังจะล้างคะแนนของ <b>${escapeHtml(name)}</b> เป็น <b>0</b>`,
    icon: "warning", showCancelButton: true, confirmButtonText: "ยืนยัน", cancelButtonText: "ยกเลิก"
  });
  if (!ok.isConfirmed) return;

  overlay.show("กำลังล้างคะแนน...");
  try {
    const res  = await fetch(API_ADMIN_RESET, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adminUid: ADMIN_UID, targetUid: uid, note: "Admin reset via UI" })
    });
    const json = await res.json();
    if (json.status === "success") { Swal.fire("สำเร็จ", `ล้างคะแนนของ ${escapeHtml(name)} แล้ว`, "success"); updateRowScore(uid, 0); }
    else { Swal.fire("ไม่สำเร็จ", json.message || "ไม่สามารถล้างคะแนนได้", "error"); }
  } catch (e) { console.error(e); Swal.fire("ผิดพลาด", "ติดต่อเซิร์ฟเวอร์ไม่สำเร็จ", "error"); }
  finally { overlay.hide(); }
}

// ============ UTIL ============
function getLocalScore(uid) { const f = ALL_USERS.find(x => x.uid === uid); return f ? Number(f.score || 0) : 0; }
function updateRowScore(uid, newScore) {
  for (const arr of [ALL_USERS, FILTERED]) { const i = arr.findIndex(x => x.uid === uid); if (i !== -1) arr[i].score = Number(newScore || 0); }
  const $rows = $("#tbodyUsers tr"); let $row = null;
  $rows.each(function(){ const uidCell = $(this).find("td:eq(1)").text().trim(); if (uidCell === uid) { $row = $(this); return false; } });
  if ($row) { $row.find(".score-chip").text(Number(newScore || 0)); $row.addClass("table-success"); setTimeout(() => $row.removeClass("table-success"), 800); }
}
function escapeHtml(s){ return String(s||"").replace(/[&<>"'`=\/]/g, a => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','/':'&#47;','`':'&#x60;','=':'&#x3D;'}[a])); }
function attr(s){ return String(s||"").replace(/"/g,"&quot;"); }
function pad(n){ return n<10? "0"+n : String(n); }
function formatDateTime(ts){ const d=new Date(ts); if(isNaN(d)) return String(ts||""); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; }