// ------------------ API endpoints (Vercel proxy) ------------------
const registerUrl    = "/api/register";
const scoreUpdateUrl = "/api/redeem";
const scoreFetchUrl  = "/api/get-score";
const historyUrl     = "/api/score-history"; // สำหรับ modal ประวัติ

// ------------------ LIFF ------------------
const liffID = "2007053300-QoEvbXyn"; // ใส่ LIFF ID ของคุณ

// ===== Admin config (อัปเดต/ทับของเดิมได้) =====
const ADMIN_UID = "Ucadb3c0f63ada96c0432a0aede267ff9";
const adminApiBase = "/api/admin";

let __ADMIN_CACHE__ = [];
let __ADMIN_SORT_KEY__ = "score";
let __ADMIN_SORT_DIR__ = "desc"; // 'asc' | 'desc'
let __ADMIN_PAGE__ = 1;
let __ADMIN_PAGE_SIZE__ = 20;
let __ADMIN_QUERY__ = "";
let __ADMIN_MIN_SCORE__ = 0;

const adminUserCanvas = new bootstrap.Offcanvas('#adminUserCanvas');
let __ADMIN_CURRENT_USER__ = null; // เก็บ uid ที่เปิดดูรายละเอียด
let MY_UID = null; // เก็บ uid ของแอดมิน/ผู้ใช้ที่ล็อกอินผ่าน LIFF

// ------------------ STATE ------------------
let html5QrcodeScanner;

// ------------------ Helpers ------------------
function setProgress(score) {
  const totalLength = 126;                         // ต้องตรงกับ stroke-dasharray
  const percent = Math.max(0, Math.min(1, score / 100)); // 100 = เต็มกราฟครึ่งวง
  const offset = totalLength * (1 - percent);
  document.getElementById("progressCurve").style.strokeDashoffset = offset;

  // Tier logic
  let tierText = "ระดับ Silver";
  let bgClass  = "bg-silver";
  let nextTierScore = 100;
  if (score >= 350 && score < 800)       { tierText = "ระดับ Diamond"; bgClass = "bg-diamond"; nextTierScore = 800; }
  else if (score >= 100 && score < 350)  { tierText = "ระดับ Gold";    bgClass = "bg-gold";    nextTierScore = 350; }
  else if (score >= 800)                 { tierText = "ระดับ Diamond"; bgClass = "bg-diamond"; nextTierScore = 800; }

  $('.d-flex').removeClass("bg-silver bg-gold bg-diamond").addClass(bgClass);
  $('#tier-label').text(tierText);

  const remaining = Math.max(0, nextTierScore - score);
  if (score >= 800) {
    $('#next-tier').html(`คุณอยู่ในระดับสูงสุดแล้ว 🎉`);
  } else {
    const nextName = (tierText === 'ระดับ Gold') ? 'Diamond' : 'Gold';
    $('#next-tier').html(`สะสมอีก <strong>${remaining}</strong> พ้อยท์ ภายใน <strong>31/12/68</strong><br />เพื่อเลื่อนสถานะเป็น <strong>${nextName}</strong> ในปี 2568`);
  }
}

function loadUserScore(uid) {
  fetch(`${scoreFetchUrl}?uid=${encodeURIComponent(uid)}`)
    .then(res => res.json())
    .then(response => {
      $.LoadingOverlay("hide");
      if (response.status === 'success') {
        const userData = response.data;
        $('#displaySection').show();
        $('#username').text(userData.name || '');
        $('#phone').html(`<i class="fas fa-phone"></i> ${userData.tel || ''}`);
        $('.text-muted span:first').text(`ส่วนงาน : ${userData.classroom || ''} | ${userData.passport || ''}`);

        const score = parseInt(userData.score || "0", 10);
        $('#points').text(score);
        setProgress(score);
      } else if (response.status === 'not found') {
        $('#regSection').show();
        $('#displaySection').hide();
      } else {
        Swal.fire("ผิดพลาด", response.message || "โหลดข้อมูลไม่สำเร็จ (API Error)", "error");
      }
    })
    .catch(() => {
      $.LoadingOverlay("hide");
      Swal.fire("ผิดพลาด", "ไม่สามารถติดต่อ Server ได้", "error");
    });
}

function refreshUserScore() {
  const uid = $('#uid').val();
  if (uid) {
    $.LoadingOverlay("show", {
      image: "",
      fontawesome: "fa fa-spinner fa-spin",
      text: "กำลังโหลดข้อมูล..."
    });
    loadUserScore(uid);
  }
}

// ------------------ INIT ------------------
$(document).ready(function () {
  $('#regSection').hide();

  liff.init({ liffId: liffID }).then(() => {
    if (liff.isLoggedIn()) {
      $.LoadingOverlay("show", { image: "", fontawesome: "fa fa-spinner fa-spin", text: "กำลังโหลดข้อมูล..." });
      liff.getProfile().then(profile => {
        const uid = profile.userId;
        MY_UID = uid; // <<< เพิ่มบรรทัดนี้
        $('#uid').val(uid);
        $('#profilePic').attr('src', profile.pictureUrl || 'https://placehold.co/60x60');
        loadUserScore(uid);
        setupAdminIfNeeded(uid);
      });
    } else {
      liff.login();
    }
  }).catch((e) => {
    console.error(e);
    Swal.fire("ผิดพลาด", "ไม่สามารถเริ่ม LIFF ได้", "error");
  });

  // Registration submit
  $('#dataForm').ajaxForm({
    url: registerUrl,
    type: 'POST',
    dataType: 'json',
    beforeSubmit: function () {
      Swal.fire({ title: 'กำลังบันทึก...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    },
    success: function (response) {
      if (response.status === 'success') {
        Swal.fire({ icon: 'success', title: 'ลงทะเบียนสำเร็จ!', text: 'ข้อมูลของคุณถูกบันทึกแล้ว' });
        $('#username').text($('#name').val());
        $('#phone').html('<i class="fas fa-phone"></i> ' + $('#telephone').val());
        $('.text-muted span:first').text(`ส่วนงาน : ${$('#room').val()} | ${$('#passport').val()}`);
        $('#points').text('0');
        $('#regSection').hide();
        $('#displaySection').show();
        document.getElementById("progressCurve").style.strokeDashoffset = 126; // เริ่มต้น
      } else if (response.status === 'error' && response.message === 'User already registered') {
        Swal.fire({ icon: 'warning', title: 'ลงทะเบียนซ้ำ!', text: 'ผู้ใช้รายนี้ลงทะเบียนไว้แล้ว' });
      } else {
        Swal.fire({ icon: 'error', title: 'เกิดข้อผิดพลาด!', text: response.message || 'ไม่สามารถส่งข้อมูลได้' });
      }
    },
    error: function () {
      Swal.fire({ icon: 'error', title: 'เกิดข้อผิดพลาด!', text: 'ไม่สามารถติดต่อเซิร์ฟเวอร์ได้' });
    }
  });
});

// ------------------ REDEEM: manual code ------------------
function submitSecretCode() {
  const code = $('#secretCode').val().trim();
  if (!code) return Swal.fire("กรุณากรอกรหัสลับ");

  $.LoadingOverlay("show");
  fetch(scoreUpdateUrl, {
    method: "POST",
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uid: $('#uid').val(), code: code, type: 'MANUAL' })
  })
  .then(res => res.json())
  .then(data => {
    $.LoadingOverlay("hide");
    if (data.status === "success") {
      Swal.fire("สำเร็จ", `คุณได้รับคะแนนแล้ว (+${data.point})`, "success");
      $('#scoreModal').modal('hide');
      refreshUserScore();
    } else if (data.status === "used") {
      Swal.fire("รหัสถูกใช้แล้ว", data.message || "รหัสนี้ถูกใช้ไปแล้ว", "warning");
    } else if (data.status === "invalid") {
      Swal.fire("รหัสไม่ถูกต้อง", data.message || "ตรวจสอบรหัสอีกครั้ง", "error");
    } else {
      Swal.fire("เกิดข้อผิดพลาด", data.message || "โปรดลองใหม่ภายหลัง", "error");
    }
  })
  .catch(() => {
    $.LoadingOverlay("hide");
    Swal.fire("ผิดพลาด", "ไม่สามารถติดต่อเซิร์ฟเวอร์ได้", "error");
  });
}

// ------------------ REDEEM: scan QR ------------------
function onScanSuccess(decodedText) {
  if (html5QrcodeScanner) html5QrcodeScanner.clear();
  $('#scoreModal').modal('hide');
  $.LoadingOverlay("show");

  fetch(scoreUpdateUrl, {
    method: "POST",
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uid: $('#uid').val(), code: decodedText, type: 'SCAN' })
  })
  .then(res => res.json())
  .then(data => {
    $.LoadingOverlay("hide");
    if (data.status === "success") {
      Swal.fire("สำเร็จ", `คุณได้รับคะแนนจาก QR แล้ว (+${data.point})`, "success");
      refreshUserScore();
    } else if (data.status === "used") {
      Swal.fire("รหัสถูกใช้แล้ว", data.message || "QR นี้ถูกใช้ไปแล้ว", "warning");
    } else if (data.status === "invalid") {
      Swal.fire("ไม่สามารถใช้ QR นี้ได้", data.message || "QR ไม่ถูกต้อง", "error");
    } else {
      Swal.fire("เกิดข้อผิดพลาด", data.message || "โปรดลองใหม่ภายหลัง", "error");
    }
  })
  .catch(() => {
    $.LoadingOverlay("hide");
    Swal.fire("ผิดพลาด", "เกิดข้อผิดพลาดในการสแกน", "error");
  });
}

// Init scanner when modal open/close
$('#scoreModal').on('shown.bs.modal', function () {
  if (!html5QrcodeScanner) {
    html5QrcodeScanner = new Html5QrcodeScanner("qr-reader", { fps: 10, qrbox: 250 });
  }
  html5QrcodeScanner.render(onScanSuccess);
});
$('#scoreModal').on('hidden.bs.modal', function () {
  if (html5QrcodeScanner) html5QrcodeScanner.clear();
});

function setupAdminIfNeeded(currentUid) {
  if (currentUid === ADMIN_UID) {
    $("#adminPanel").show();

    // Export CSV link
    const csvUrl = `${adminApiBase}?uid=${encodeURIComponent(currentUid)}&format=csv`;
    $("#btnAdminExport").attr("href", csvUrl);

    // Bind controls
    $("#btnAdminRefresh").off("click").on("click", () => fetchAllScores(currentUid));
    $("#adminSearch").off("input").on("input", function() {
      __ADMIN_QUERY__ = $(this).val().toLowerCase().trim();
      __ADMIN_PAGE__ = 1;
      renderAdminTablePaged();
    });
    $("#adminMinScore").off("input").on("input", function() {
      __ADMIN_MIN_SCORE__ = parseInt($(this).val() || "0", 10) || 0;
      __ADMIN_PAGE__ = 1;
      renderAdminTablePaged();
    });
    $("#adminPageSize").off("change").on("change", function() {
      __ADMIN_PAGE_SIZE__ = parseInt($(this).val(), 10) || 20;
      __ADMIN_PAGE__ = 1;
      renderAdminTablePaged();
    });

    // Sort header click
    $("thead th.sort").off("click").on("click", function() {
      const key = $(this).data("key");
      if (__ADMIN_SORT_KEY__ === key) {
        __ADMIN_SORT_DIR__ = (__ADMIN_SORT_DIR__ === "asc" ? "desc" : "asc");
      } else {
        __ADMIN_SORT_KEY__ = key;
        __ADMIN_SORT_DIR__ = (key === "score" ? "desc" : "asc");
      }
      updateSortIndicators();
      renderAdminTablePaged();
    });

    updateSortIndicators();
    fetchAllScores(currentUid);
  } else {
    $("#adminPanel").hide();
  }
}

function fetchAllScores(currentUid) {
  $("#adminTableBody").html(`
    <tr><td colspan="4">
      <div class="skeleton skeleton-row"></div>
      <div class="skeleton skeleton-row"></div>
      <div class="skeleton skeleton-row"></div>
    </td></tr>
  `);
  $("#adminInfo").text("");
  $("#adminRange").text("");

  const url = `${adminApiBase}?uid=${encodeURIComponent(currentUid)}`;
  fetch(url)
    .then(res => res.json())
    .then(data => {
      if (data.status === "success" && Array.isArray(data.data)) {
        __ADMIN_CACHE__ = data.data.map((v, idx) => ({
          rank: idx + 1,
          uid: v.uid || "",
          name: v.name || "",
          score: Number(v.score || 0)
        }));
        __ADMIN_PAGE__ = 1;
        renderAdminTablePaged();
      } else {
        $("#adminTableBody").html(`<tr><td colspan="4" class="text-danger">โหลดไม่สำเร็จ: ${data.message || "Unknown error"}</td></tr>`);
      }
    })
    .catch(err => {
      $("#adminTableBody").html(`<tr><td colspan="4" class="text-danger">เกิดข้อผิดพลาด: ${err}</td></tr>`);
    });
}

function filteredSortedData() {
  // filter
  let rows = __ADMIN_CACHE__.filter(r => {
    const q = __ADMIN_QUERY__;
    const passQ = !q || r.uid.toLowerCase().includes(q) || r.name.toLowerCase().includes(q);
    const passMin = r.score >= __ADMIN_MIN_SCORE__;
    return passQ && passMin;
  });

  // sort
  rows.sort((a,b) => {
    const k = __ADMIN_SORT_KEY__;
    let A = a[k], B = b[k];
    if (k === "name" || k === "uid") {
      A = String(A || "").toLowerCase(); B = String(B || "").toLowerCase();
      if (A < B) return __ADMIN_SORT_DIR__ === "asc" ? -1 : 1;
      if (A > B) return __ADMIN_SORT_DIR__ === "asc" ? 1 : -1;
      return 0;
    } else {
      // rank/score numeric
      const cmp = Number(A) - Number(B);
      return __ADMIN_SORT_DIR__ === "asc" ? cmp : -cmp;
    }
  });

  return rows;
}

function renderAdminTablePaged() {
  const rows = filteredSortedData();
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / __ADMIN_PAGE_SIZE__));
  if (__ADMIN_PAGE__ > pages) __ADMIN_PAGE__ = pages;

  const start = (__ADMIN_PAGE__ - 1) * __ADMIN_PAGE_SIZE__;
  const end = Math.min(total, start + __ADMIN_PAGE_SIZE__);
  const pageRows = rows.slice(start, end);

  const $tb = $("#adminTableBody");
  if (!pageRows.length) {
    $tb.html(`<tr><td colspan="4" class="text-muted">ไม่พบข้อมูล</td></tr>`);
  } else {
    const html = pageRows.map(r => `
      <tr class="admin-row" data-uid="${r.uid}">
        <td>${r.rank}</td>
        <td>${escapeHtml(r.name)}</td>
        <td class="text-break"><code>${escapeHtml(r.uid)}</code></td>
        <td class="text-end"><span class="badge bg-primary">${r.score}</span></td>
      </tr>
    `).join("");
    $tb.html(html);

    // click → user detail
    $(".admin-row").off("click").on("click", function() {
      const uid = $(this).data("uid");
      openUserDetail(uid);
    });
  }

  function bindAdminUserButtons(targetUid) {
  $('#btnAdminAdd').off('click').on('click', async () => {
    const amt = parseInt($('#adminAmount').val() || '0', 10);
    if (!amt || amt <= 0) return Swal.fire('กรุณากรอกจำนวนคะแนนมากกว่า 0','','info');
    const note = $('#adminNote').val() || '';
    const resp = await adminAdjustScore(targetUid, +amt, note);
    if (resp.status === 'success') {
      Swal.fire('สำเร็จ', `เพิ่มคะแนน +${amt}`, 'success');
      // รีโหลดโปรไฟล์ & ประวัติ และตารางรวม
      openUserDetail(targetUid);
      fetchAllScores(MY_UID);
    } else {
      Swal.fire('ล้มเหลว', resp.message || 'ปรับคะแนนไม่สำเร็จ', 'error');
    }
  });

  $('#btnAdminDeduct').off('click').on('click', async () => {
    const amt = parseInt($('#adminAmount').val() || '0', 10);
    if (!amt || amt <= 0) return Swal.fire('กรุณากรอกจำนวนคะแนนมากกว่า 0','','info');
    const note = $('#adminNote').val() || '';
    const resp = await adminAdjustScore(targetUid, -amt, note);
    if (resp.status === 'success') {
      Swal.fire('สำเร็จ', `หักคะแนน -${amt}`, 'success');
      openUserDetail(targetUid);
      fetchAllScores(MY_UID);
    } else {
      Swal.fire('ล้มเหลว', resp.message || 'ปรับคะแนนไม่สำเร็จ', 'error');
    }
  });

  $('#btnAdminReset').off('click').on('click', async () => {
    const note = $('#adminNote').val() || '';
    const ok = await Swal.fire({
      icon: 'warning',
      title: 'ยืนยันล้างคะแนน?',
      text: 'การล้างคะแนนจะตั้งเป็น 0 และบันทึกประวัติ',
      showCancelButton: true,
      confirmButtonText: 'ยืนยัน',
      cancelButtonText: 'ยกเลิก'
    });
    if (!ok.isConfirmed) return;

    const resp = await adminResetScore(targetUid, note);
    if (resp.status === 'success') {
      Swal.fire('สำเร็จ', 'ล้างคะแนนเรียบร้อย', 'success');
      openUserDetail(targetUid);
      fetchAllScores(MY_UID);
    } else {
      Swal.fire('ล้มเหลว', resp.message || 'ล้างคะแนนไม่สำเร็จ', 'error');
    }
  });
}

  // info + range + pager
  $("#adminInfo").text(`ทั้งหมด ${total} รายการ`);
  $("#adminRange").text(total ? `แสดง ${start+1}–${end} จาก ${total}` : "");
  renderPager(pages);
}

function renderPager(pages) {
  const $pg = $("#adminPager");
  const p = __ADMIN_PAGE__;
  if (pages <= 1) { $pg.html(""); return; }
  const make = (label, page, disabled=false, active=false) =>
    `<li class="page-item ${disabled?'disabled':''} ${active?'active':''}">
      <a class="page-link" href="#" data-page="${page}">${label}</a>
    </li>`;

  let html = "";
  html += make("&laquo;", 1, p===1);
  html += make("&lsaquo;", Math.max(1, p-1), p===1);

  // window of pages
  const window = 2;
  const from = Math.max(1, p - window);
  const to = Math.min(pages, p + window);
  for (let i=from; i<=to; i++) html += make(i, i, false, i===p);

  html += make("&rsaquo;", Math.min(pages, p+1), p===pages);
  html += make("&raquo;", pages, p===pages);
  $pg.html(html);

  $pg.find("a.page-link").off("click").on("click", function(e){
    e.preventDefault();
    const target = parseInt($(this).data("page"), 10);
    if (!isNaN(target) && target>=1 && target<=pages) {
      __ADMIN_PAGE__ = target;
      renderAdminTablePaged();
    }
  });
}

function updateSortIndicators() {
  $("thead th.sort").removeClass("asc desc");
  const $th = $(`thead th.sort[data-key="${__ADMIN_SORT_KEY__}"]`);
  $th.addClass(__ADMIN_SORT_DIR__);
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"'`=\/]/g,function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','/':'&#x2F;','`':'&#x60;','=':'&#x3D;'}[c];
  });
}

function openUserDetail(uid) {
  __ADMIN_CURRENT_USER__ = uid;

  // สร้าง skeleton ระหว่างโหลด
  $("#adminUserBox").html(`
    <div class="skeleton skeleton-card"></div>
    <div class="skeleton skeleton-card"></div>
  `);
  $("#adminUserHistory").html(`
    <li class="list-group-item"><div class="skeleton skeleton-row"></div></li>
    <li class="list-group-item"><div class="skeleton skeleton-row"></div></li>
  `);

  // เปิด offcanvas
  adminUserCanvas.show();

  // ⬅️ เรียก bind ตรงนี้ เพื่อให้ปุ่มใน offcanvas ทำงานกับ uid นี้
  bindAdminUserButtons(uid);

  // โหลดโปรไฟล์ผู้ใช้
  fetch(`/api/get-score?uid=${encodeURIComponent(uid)}`)
    .then(r => r.json())
    .then(data => {
      if (data.status === "success" && data.data) {
        const u = data.data;
        $("#adminUserBox").html(`
          <div class="card border-0 shadow-sm mb-2">
            <div class="card-body">
              <div class="d-flex align-items-center justify-content-between">
                <div>
                  <div class="fw-bold">${escapeHtml(u.name || "(ไม่มีชื่อ)")}</div>
                  <div class="text-muted small">UID: <code>${escapeHtml(u.uid)}</code></div>
                </div>
                <div class="text-end">
                  <div class="small text-muted">คะแนน</div>
                  <div class="h5 mb-0"><span class="badge bg-primary">${Number(u.score||0)}</span></div>
                </div>
              </div>
            </div>
          </div>

          <div class="card border-0 shadow-sm">
            <div class="card-body">
              <div class="row g-2 small">
                <div class="col-6"><span class="text-muted">ส่วนงาน</span><br>${escapeHtml(u.classroom||"-")}</div>
                <div class="col-6"><span class="text-muted">เบอร์</span><br>${escapeHtml(u.tel||"-")}</div>
                <div class="col-12"><span class="text-muted">Passport/EmpID</span><br>${escapeHtml(u.passport||"-")}</div>
              </div>
            </div>
          </div>
        `);

        // ปุ่มคัดลอก UID
        $("#btnCopyUid").off("click").on("click", async ()=>{
          try {
            await navigator.clipboard.writeText(String(u.uid||""));
            Swal.fire({icon:'success',title:'คัดลอกแล้ว',timer:1200,showConfirmButton:false});
          } catch {
            Swal.fire('คัดลอกไม่สำเร็จ','','error');
          }
        });
      } else {
        $("#adminUserBox").html(`<div class="alert alert-warning">ไม่พบข้อมูลผู้ใช้</div>`);
      }
    })
    .catch(()=>{
      $("#adminUserBox").html(`<div class="alert alert-danger">โหลดข้อมูลผู้ใช้ล้มเหลว</div>`);
    });

  // โหลดประวัติพ้อยท์
  fetch(`/api/score-history?uid=${encodeURIComponent(uid)}`)
    .then(r => r.json())
    .then(data => {
      if (data.status === "success" && Array.isArray(data.data)) {
        if (!data.data.length) {
          $("#adminUserHistory").html(`<li class="list-group-item text-muted">ไม่มีประวัติ</li>`);
          return;
        }
        $("#adminUserHistory").html(
          data.data.slice(0,50).map(item => `
            <li class="list-group-item d-flex justify-content-between align-items-center">
              <div>
                <div><b>${escapeHtml(item.code)}</b> <span class="text-muted">(${escapeHtml(item.type)})</span></div>
                <small class="text-muted">${new Date(item.ts).toLocaleString()}</small>
              </div>
              <span class="badge ${Number(item.point||0) >= 0 ? 'bg-success' : 'bg-danger'}">
                ${Number(item.point||0) > 0 ? '+' : ''}${Number(item.point||0)}
              </span>
            </li>
          `).join("")
        );
      } else {
        $("#adminUserHistory").html(`<li class="list-group-item text-danger">โหลดประวัติไม่สำเร็จ</li>`);
      }
    })
    .catch(()=>{
      $("#adminUserHistory").html(`<li class="list-group-item text-danger">เกิดข้อผิดพลาด</li>`);
    });
}

function fetchAllScores(currentUid) {
  $("#adminTableBody").html(`<tr><td colspan="3" class="text-muted">กำลังโหลด...</td></tr>`);
  $("#adminInfo").text("");

  const url = `${adminApiBase}?uid=${encodeURIComponent(currentUid)}`;
  fetch(url)
    .then(res => res.json())
    .then(data => {
      if (data.status === "success" && Array.isArray(data.data)) {
        __ADMIN_CACHE__ = data.data;
        renderAdminTable(__ADMIN_CACHE__);
        $("#adminInfo").text(`ทั้งหมด ${__ADMIN_CACHE__.length} รายการ`);
      } else {
        $("#adminTableBody").html(`<tr><td colspan="3" class="text-danger">โหลดไม่สำเร็จ: ${data.message || "Unknown error"}</td></tr>`);
      }
    })
    .catch(err => {
      $("#adminTableBody").html(`<tr><td colspan="3" class="text-danger">เกิดข้อผิดพลาด: ${err}</td></tr>`);
    });
}

function renderAdminTable(rows) {
  const $tb = $("#adminTableBody");
  if (!rows || !rows.length) {
    $tb.html(`<tr><td colspan="3" class="text-muted">ไม่พบข้อมูล</td></tr>`);
    return;
  }
  const html = rows.map(r => {
    const uid = r.uid ?? "";
    const name = r.name ?? "";
    const score = Number(r.score ?? 0);
    return `<tr>
      <td class="text-break">${uid}</td>
      <td>${name}</td>
      <td><span class="badge bg-primary">${score}</span></td>
    </tr>`;
  }).join("");
  $tb.html(html);
}

function filterAdminData(q) {
  if (!q) return __ADMIN_CACHE__;
  return __ADMIN_CACHE__.filter(r => {
    const uid = (r.uid ?? "").toLowerCase();
    const name = (r.name ?? "").toLowerCase();
    return uid.includes(q) || name.includes(q);
  });
}

function adminAdjustScore(targetUid, delta, note) {
  if (!MY_UID) return Swal.fire('ยังไม่ได้ล็อกอิน LIFF','','error');
  return fetch('/api/admin-adjust', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ adminUid: MY_UID, targetUid, delta, note })
  }).then(r => r.json());
}

function adminResetScore(targetUid, note) {
  if (!MY_UID) return Swal.fire('ยังไม่ได้ล็อกอิน LIFF','','error');
  return fetch('/api/admin-reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ adminUid: MY_UID, targetUid, note })
  }).then(r => r.json());
}

// ------------------ HISTORY Modal ------------------
function loadHistory() {
  const uid = $('#uid').val();
  $('#historyList').html('<li class="list-group-item">กำลังโหลด...</li>');
  fetch(`${historyUrl}?uid=${encodeURIComponent(uid)}`)
    .then(res => res.json())
    .then(data => {
      if (data.status === 'success') {
        const list = data.data || [];
        if (!list.length) {
          $('#historyList').html('<li class="list-group-item">ไม่มีประวัติ</li>');
          return;
        }
        $('#historyList').html('');
        list.forEach(item => {
          $('#historyList').append(
            `<li class="list-group-item d-flex justify-content-between align-items-center">
              <div>
                <div><b>${item.code}</b> (${item.type})</div>
                <small class="text-muted">${new Date(item.ts).toLocaleString()}</small>
              </div>
              <span class="badge bg-success">+${item.point}</span>
            </li>`
          );
        });
      } else {
        $('#historyList').html(`<li class="list-group-item text-danger">${data.message || 'โหลดไม่สำเร็จ'}</li>`);
      }
    })
    .catch(() => {
      $('#historyList').html('<li class="list-group-item text-danger">เกิดข้อผิดพลาด</li>');
    });
}
$('#historyModal').on('shown.bs.modal', loadHistory);
