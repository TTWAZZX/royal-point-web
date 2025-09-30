// ==== ใส่ไว้ด้านบนไฟล์ app.js (ค่าคงที่) ====
const ADMIN_UIDS = ['Ucadb3c0f63ada96c0432a0aede267ff9'];
function isAdmin(uid){ return ADMIN_UIDS.includes(String(uid)); }

// ================== CONFIG ==================
const registerUrl    = "/api/register";
const scoreUpdateUrl = "/api/redeem";
const scoreFetchUrl  = "/api/get-score";
const scoreHistoryUrl  = "/api/score-history";   // GET ?uid=
const liffID         = "2007053300-QoEvbXyn"; // <- ใช้ LIFF ของคุณ

// เกณฑ์เลื่อนระดับ
const TIER = {
  GOLD: 100,
  DIAMOND: 350,
  SUPREME: 800,
  MAX: 1000 // เป้าหมายสูงสุด (ใช้ตอนคำนวณข้อความ)
};

// ================== UI: PROGRESS & TIER ==================
function setProgress(score) {
  // 1) อัปเดตครึ่งวง
  const totalLength = 126; // เท่ากับ stroke-dasharray ใน SVG
  const percent = Math.max(0, Math.min(1, score / 100)); // 100 คะแนน = เต็มครึ่งวง
  const offset = totalLength * (1 - percent);
  const curve = document.getElementById("progressCurve");
  if (curve) curve.style.strokeDashoffset = String(offset);

  // 2) คิด tier + next target
  let tierText = "ระดับ Silver";
  let bgClass  = "bg-silver";
  let nextTierScore = TIER.GOLD;

  if (score >= TIER.SUPREME) {
    tierText = "ระดับ Supreme"; bgClass = "bg-supreme"; nextTierScore = TIER.MAX;
  } else if (score >= TIER.DIAMOND) {
    tierText = "ระดับ Diamond"; bgClass = "bg-diamond"; nextTierScore = TIER.SUPREME;
  } else if (score >= TIER.GOLD) {
    tierText = "ระดับ Gold";    bgClass = "bg-gold";    nextTierScore = TIER.DIAMOND;
  }

  // 3) เปลี่ยน mood การ์ดผู้ใช้
  const userCard = document.getElementById('userCard');
  if (userCard) {
    userCard.classList.remove("bg-silver","bg-gold","bg-diamond","bg-supreme");
    userCard.classList.add(bgClass);
  }

  // 4) เปลี่ยนหัวข้อ tier ปัจจุบัน
  const tierLabel = document.getElementById('tier-label');
  if (tierLabel) tierLabel.textContent = tierText;

  // 5) อัปเดต Badge สี + ข้อความ
  const badge = document.getElementById('tierBadge');
  if (badge) {
    badge.textContent = tierText;
    badge.classList.remove('tier-silver','tier-gold','tier-diamond','tier-supreme');
    const classMap = {
      'ระดับ Silver':  'tier-silver',
      'ระดับ Gold':    'tier-gold',
      'ระดับ Diamond': 'tier-diamond',
      'ระดับ Supreme': 'tier-supreme'
    };
    badge.classList.add(classMap[tierText]);
  }

  // 6) เป้าหมายถัดไป
  const nextTierEl = document.getElementById('next-tier');
  if (nextTierEl) {
    if (score >= TIER.SUPREME) {
      nextTierEl.innerHTML = `คุณอยู่ในระดับสูงสุดแล้ว 🎉`;
    } else {
      const nextName =
        tierText === 'ระดับ Gold'    ? 'Diamond' :
        tierText === 'ระดับ Diamond' ? 'Supreme' : 'Gold';
      const remaining = Math.max(0, nextTierScore - score);
      nextTierEl.innerHTML =
        `สะสมอีก <strong>${remaining}</strong> พ้อยท์ ภายใน <strong>31/12/68</strong> เพื่อเลื่อนเป็น <strong>${nextName}</strong>`;
    }
  }
}

// ================== DATA FLOW ==================
function loadUserScore(uid) {
  return fetch(`${scoreFetchUrl}?uid=${encodeURIComponent(uid)}`)
    .then(res => res.json())
    .then(response => {
      $.LoadingOverlay("hide");

      if (response.status === 'success') {
        const userData = response.data || {};
        // เติมข้อมูล
        $('#username').text(userData.name || '—');
        $('#phone').html(`<i class="fa-solid fa-phone"></i> ${userData.tel || ''}`);
        $('#profilePic').attr('src', $('#profilePic').attr('src') || 'https://placehold.co/120x120');

        const score = parseInt(userData.score || "0", 10);
        $('#points').text(score);
        setProgress(score);

        // ซ่อนฟอร์มสมัคร
        $('#regSection').hide();
      }
      else if (response.status === 'not found') {
        // แสดงฟอร์มสมัคร ถ้ายังไม่เคยลงทะเบียน
        $('#regSection').show();
      }
      else {
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
  if (!uid) return;
  $.LoadingOverlay("show", { image:"", fontawesome:"fa fa-spinner fa-spin", text:"กำลังโหลดข้อมูล..." });
  loadUserScore(uid);
}


// ================== REDEEM ==================
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

// ================== QR SCAN (Modal) ==================
let html5QrcodeScanner = null;

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

$('#scoreModal').on('shown.bs.modal', function () {
  if (!html5QrcodeScanner) {
    html5QrcodeScanner = new Html5QrcodeScanner("qr-reader", { fps: 10, qrbox: 250 });
  }
  html5QrcodeScanner.render(onScanSuccess);
});
$('#scoreModal').on('hidden.bs.modal', function () {
  if (html5QrcodeScanner) html5QrcodeScanner.clear();
});

// ================== INIT (LIFF + First Load) ==================
$(document).ready(function () {
  // เริ่มต้นแสดงโหลด
  $.LoadingOverlay("show", { image:"", fontawesome:"fa fa-spinner fa-spin", text:"กำลังโหลดข้อมูล..." });

  liff.init({ liffId: liffID }).then(() => {
    if (liff.isLoggedIn()) {
      liff.getProfile().then(profile => {
        const uid = profile.userId;
        $('#uid').val(uid);
        $('#profilePic').attr('src', profile.pictureUrl || 'https://placehold.co/60x60');
        loadUserScore(uid);
        if (isAdmin(uid)) {
          $('#btnAdmin')
            .removeClass('d-none')
            .attr('href', '/admin.html?uid=' + encodeURIComponent(uid));
        }
      });
    } else {
      liff.login();
    }
  }).catch((e) => {
    console.error(e);
    $.LoadingOverlay("hide");
    Swal.fire("ผิดพลาด", "ไม่สามารถเริ่ม LIFF ได้", "error");
  });

  // สมัครใช้งาน
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
        $('#phone').html('<i class="fa-solid fa-phone"></i> ' + $('#telephone').val());
        $('#points').text('0');
        setProgress(0);
        $('#regSection').hide();
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
