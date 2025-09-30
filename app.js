/**********************
 * Royal Point - app.js (User page)
 **********************/
const registerUrl    = "/api/register";
const scoreUpdateUrl = "/api/redeem";
const scoreFetchUrl  = "/api/get-score";
const liffID         = "2007053300-QoEvbXyn";
const ADMIN_UID      = "Ucadb3c0f63ada96c0432a0aede267ff9";

let html5QrcodeScanner = null;
let MY_UID = null;

/** Progress & Tier **/
function setProgress(score) {
  const totalLength = 126;
  const percent = Math.max(0, Math.min(1, Number(score || 0) / 100));
  const offset = totalLength * (1 - percent);
  const curve = document.getElementById("progressCurve");
  if (curve) curve.style.strokeDashoffset = offset;

  let tierText = "ระดับ Silver";
  let bgClass  = "bg-silver";
  let nextTierScore = 100;
  let nextText = "";

  if (score >= 800) {
    tierText = "ระดับ Diamond";
    bgClass  = "bg-diamond";
    nextText = "คุณอยู่ในระดับสูงสุดแล้ว 🎉";
  } else if (score >= 350) {
    tierText = "ระดับ Diamond";
    bgClass  = "bg-diamond";
    nextTierScore = 800;
    const remaining = 800 - score;
    nextText = `สะสมอีก <strong>${remaining}</strong> พ้อยท์ ภายใน <strong>31/12/68</strong><br />เพื่อให้ <strong>ครบระดับ Diamond (800)</strong>`;
  } else if (score >= 100) {
    tierText = "ระดับ Gold";
    bgClass  = "bg-gold";
    nextTierScore = 350;
    const remaining = 350 - score;
    nextText = `สะสมอีก <strong>${remaining}</strong> พ้อยท์ ภายใน <strong>31/12/68</strong><br />เพื่อเลื่อนเป็น <strong>Diamond</strong>`;
  } else {
    const remaining = 100 - score;
    nextText = `สะสมอีก <strong>${remaining}</strong> พ้อยท์ ภายใน <strong>31/12/68</strong><br />เพื่อเลื่อนเป็น <strong>Gold</strong>`;
  }

  const headerRow = document.querySelector(".d-flex.align-items-center");
  if (headerRow) {
    headerRow.classList.remove("bg-silver","bg-gold","bg-diamond");
    headerRow.classList.add(bgClass);
  }
  const tierLabelEl = document.getElementById("tier-label");
  if (tierLabelEl) tierLabelEl.textContent = tierText;

  const nextEl = document.getElementById("next-tier");
  if (nextEl) nextEl.innerHTML = nextText;
}

/** Load user score **/
function loadUserScore(uid) {
  return fetch(`${scoreFetchUrl}?uid=${encodeURIComponent(uid)}`)
    .then(res => res.json())
    .then(response => {
      $.LoadingOverlay("hide");
      if (response.status === 'success') {
        const userData = response.data || {};
        $('#displaySection').show();
        $('#regSection').hide();
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

window.refreshUserScore = function refreshUserScore() {
  const uid = $('#uid').val();
  if (!uid) return;
  $.LoadingOverlay("show", { image: "", fontawesome: "fa fa-spinner fa-spin", text: "กำลังโหลดข้อมูล..." });
  loadUserScore(uid);
};

/** LIFF Init **/
$(document).ready(function () {
  $('#regSection').hide();

  liff.init({ liffId: liffID }).then(() => {
    if (liff.isLoggedIn()) {
      $.LoadingOverlay("show", { image: "", fontawesome: "fa fa-spinner fa-spin", text: "กำลังโหลดข้อมูล..." });
      liff.getProfile().then(profile => {
        const uid = profile.userId;
        MY_UID = uid;
        $('#uid').val(uid);
        $('#profilePic').attr('src', profile.pictureUrl || 'https://placehold.co/60x60');

        // Show admin button if admin
        const goAdminBtn = document.getElementById('goAdminBtn');
        if (goAdminBtn && uid === ADMIN_UID) goAdminBtn.classList.remove('d-none');

        loadUserScore(uid);
      });
    } else {
      liff.login();
    }
  }).catch(err => {
    console.error(err);
    Swal.fire("ผิดพลาด", "ไม่สามารถเริ่ม LIFF ได้", "error");
  });

  // Register submit
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
        $('#regSection').hide(); $('#displaySection').show();
        const curve = document.getElementById("progressCurve");
        if (curve) curve.style.strokeDashoffset = 126;
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

/** Redeem: manual **/
window.submitSecretCode = function submitSecretCode() {
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
      Swal.fire("สำเร็จ", `คุณได้รับคะแนนแล้ว (+${data.point ?? ''})`, "success");
      $('#scoreModal').modal('hide');
      window.refreshUserScore();
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
};

/** Redeem: QR **/
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
      Swal.fire("สำเร็จ", `คุณได้รับคะแนนจาก QR แล้ว (+${data.point ?? ''})`, "success");
      window.refreshUserScore();
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

$('#scoreModal').on('shown.bs.modal', function () {
  if (!html5QrcodeScanner) {
    html5QrcodeScanner = new Html5QrcodeScanner("qr-reader", { fps: 10, qrbox: 250 });
  }
  html5QrcodeScanner.render(onScanSuccess);
});
$('#scoreModal').on('hidden.bs.modal', function () {
  if (html5QrcodeScanner) { html5QrcodeScanner.clear(); }
});

/** History modal: load logs **/
$('#historyModal').on('show.bs.modal', function () {
  const uid = $('#uid').val();
  if (!uid) return;
  $('#historyList').html('<li class="list-group-item text-muted">กำลังโหลด…</li>');
  fetch(`/api/score-history?uid=${encodeURIComponent(uid)}`)
    .then(r => r.json())
    .then(d => {
      if (d.status !== 'success' || !Array.isArray(d.data) || d.data.length === 0) {
        $('#historyList').html('<li class="list-group-item text-muted">ยังไม่มีประวัติ</li>');
        return;
      }
      const items = d.data.map(h => `
        <li class="list-group-item d-flex justify-content-between align-items-center">
          <div>
            <div class="fw-bold">${(h.type || 'LOG')}</div>
            <div class="small text-muted">${h.code || ''}</div>
            <div class="small text-muted">${new Date(h.ts).toLocaleString()}</div>
          </div>
          <span class="badge ${h.point >= 0 ? 'bg-primary' : 'bg-warning'}">${h.point > 0 ? '+' : ''}${h.point}</span>
        </li>
      `).join('');
      $('#historyList').html(items);
    })
    .catch(() => $('#historyList').html('<li class="list-group-item text-danger">โหลดประวัติไม่สำเร็จ</li>'));
});
