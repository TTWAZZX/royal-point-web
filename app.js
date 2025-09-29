// ------------------ API endpoints (Vercel proxy) ------------------
const registerUrl    = "/api/register";
const scoreUpdateUrl = "/api/redeem";
const scoreFetchUrl  = "/api/get-score";
const historyUrl     = "/api/score-history"; // สำหรับ modal ประวัติ

// ------------------ LIFF ------------------
const liffID = "2007053300-QoEvbXyn"; // ใส่ LIFF ID ของคุณ

// ===== Admin config =====
const ADMIN_UID = "Ucadb3c0f63ada96c0432a0aede267ff9";  // UID แอดมินของคุณ
const adminApiBase = "/api/admin";
let __ADMIN_CACHE__ = []; // เก็บข้อมูลล่าสุดสำหรับ filter

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
    // แสดง panel
    $("#adminPanel").show();

    // ตั้งลิงก์ Export CSV
    const csvUrl = `${adminApiBase}?uid=${encodeURIComponent(currentUid)}&format=csv`;
    $("#btnAdminExport").attr("href", csvUrl);

    // bind ปุ่ม refresh
    $("#btnAdminRefresh").off("click").on("click", () => fetchAllScores(currentUid));

    // bind ค้นหา
    $("#adminSearch").off("input").on("input", function () {
      const q = $(this).val().toLowerCase().trim();
      renderAdminTable(filterAdminData(q));
    });

    // โหลดครั้งแรก
    fetchAllScores(currentUid);
  } else {
    $("#adminPanel").hide();
  }
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
