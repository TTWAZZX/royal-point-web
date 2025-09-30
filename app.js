// ===== Royal Point – App (Recovery Build) =====

// LIFF
const LIFF_ID = "2007053300-QoEvbXyn";

// APIs (Vercel)
const API_GET_SCORE = "/api/get-score";       // GET  ?uid=...
const API_REDEEM    = "/api/redeem";          // POST { uid, code, type } -> proxy to GAS
const API_HISTORY   = "/api/score-history";   // GET  ?uid=...

// ===== Admin gate for user page =====
const ADMIN_UIDS = ["Ucadb3c0f63ada96c0432a0aede267ff9"]; // ใส่ UID แอดมินของคุณ
function showAdminEntry(isAdmin) {
  const btn = document.getElementById("btnAdmin");
  if (!btn) return;
  btn.classList.toggle("d-none", !isAdmin);
}

// DOM refs
const el = {
  username:    document.getElementById("username"),
  phone:       document.getElementById("phone"),
  profilePic:  document.getElementById("profilePic"),
  points:      document.getElementById("points"),
  tierBadge:   document.getElementById("tierBadge"),
  progress:    document.getElementById("progressCurve"),
  nextTier:    document.getElementById("next-tier"),
  refreshBtn:  document.querySelector('[onclick="refreshUserScore()"]') || document.getElementById("refreshBtn"),
  // modal/scan
  scoreModal:  document.getElementById("scoreModal"),
  qrReader:    document.getElementById("qr-reader"),
  secretInput: document.getElementById("secretCode"),
  submitBtn:   document.getElementById("submitCodeBtn")
};

// state
let UID = "";
let html5qrcode = null;    // instance
let lastVideoDeviceId = null;

// ---------- helpers ----------
function toastOk(msg) {
  if (window.Swal) return Swal.fire("สำเร็จ", msg || "", "success");
  alert(msg || "สำเร็จ");
}
function toastErr(msg) {
  if (window.Swal) return Swal.fire("ผิดพลาด", msg || "", "error");
  alert(msg || "ผิดพลาด");
}
function setPoints(n) {
  el.points && (el.points.textContent = Number(n || 0));
  // progress ring ~126 length (ตาม index.html)
  if (el.progress) {
    const total = 126, max = 1000; // ปรับสูตรตาม tier จริงภายหลัง
    const pct = Math.max(0, Math.min(1, Number(n || 0) / max));
    el.progress.setAttribute("stroke-dashoffset", String(total * (1 - pct)));
  }
}

// ---------- LIFF + Profile ----------
async function initApp() {
  try {
    await liff.init({ liffId: LIFF_ID });
    if (!liff.isLoggedIn()) { liff.login(); return; }

      const prof = await liff.getProfile();
      UID = prof.userId;
      + showAdminEntry(ADMIN_UIDS.includes(UID));

    // fill UI
    if (el.username)   el.username.textContent = prof.displayName || "—";
    if (el.profilePic) el.profilePic.src = prof.pictureUrl || "https://placehold.co/120x120";

    await refreshUserScore();
    bindUI();
  } catch (e) {
    console.error(e);
    toastErr("เริ่มต้นระบบ LIFF ไม่สำเร็จ");
  }
}

// ---------- UI bindings ----------
function bindUI() {
  // manual redeem
  if (el.submitBtn) {
    el.submitBtn.addEventListener("click", async () => {
      const code = (el.secretInput?.value || "").trim();
      if (!code) return toastErr("กรอกรหัสลับก่อน");
      await redeemCode(code, "MANUAL");
    });
  }

  // open/close modal -> start/stop html5-qrcode
  if (el.scoreModal) {
    el.scoreModal.addEventListener("shown.bs.modal", startScanner);
    el.scoreModal.addEventListener("hidden.bs.modal", stopScanner);
  }

  // refresh button (ไอคอนรีเฟรชบนการ์ด)
  if (el.refreshBtn) {
    el.refreshBtn.addEventListener("click", refreshUserScore);
  }
}

// ---------- Score / History ----------
async function refreshUserScore() {
  if (!UID) return;
  try {
    const url = `${API_GET_SCORE}?uid=${encodeURIComponent(UID)}`;
    const r = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
    const data = await safeJson(r);
    if (data.status === "success" && data.data) {
      setPoints(data.data.score || 0);
      // คุณมี field name/tel ใน GAS -> จะใช้เมื่อพร้อม
      // el.username.textContent = data.data.name || el.username.textContent;
      // el.phone.textContent    = data.data.tel ? `📞 ${data.data.tel}` : "";
    } else {
      setPoints(0);
    }
  } catch (e) {
    console.error(e);
    setPoints(0);
  }
}

async function safeJson(resp) {
  const t = await resp.text();
  try { return JSON.parse(t); } catch { return { status: resp.ok ? "success" : "error", message: t }; }
}

// ---------- Redeem ----------
async function redeemCode(code, type) {
  try {
    const r = await fetch(API_REDEEM, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid: UID, code, type })
    });
    const j = await safeJson(r);
    if (j.status === "success") {
      toastOk(`รับคะแนนแล้ว +${j.point || 0}`);
      await refreshUserScore();
      // ปิด modal และล้างค่า
      stopScanner();
      if (el.secretInput) el.secretInput.value = "";
      if (window.bootstrap?.Modal.getInstance(el.scoreModal)) {
        window.bootstrap.Modal.getInstance(el.scoreModal).hide();
      }
    } else {
      toastErr(j.message || "คูปองไม่ถูกต้องหรือถูกใช้ไปแล้ว");
    }
  } catch (e) {
    console.error(e);
    toastErr("ไม่สามารถยืนยันรับคะแนนได้");
  }
}

// ---------- Scanner (html5-qrcode) ----------
async function startScanner() {
  if (!el.qrReader) return;

  try {
    // หาอุปกรณ์กล้อง
    const devices = await Html5Qrcode.getCameras();
    const camId = lastVideoDeviceId || (devices[0] && devices[0].id);
    if (!camId) {
      console.warn("no camera");
      return;
    }

    html5qrcode = new Html5Qrcode(el.qrReader.id);
    await html5qrcode.start(
      camId,
      { fps: 10, qrbox: { width: 260, height: 260 } },
      async (decoded) => {
        // เมื่อสแกนเจอ
        try {
          await redeemCode(String(decoded || "").trim(), "SCAN");
        } finally {
          // ป้องกันยิงซ้ำ
          stopScanner();
        }
      },
      (e) => { /* onScanFailure: เงียบไว้ */ }
    );
    lastVideoDeviceId = camId;
  } catch (e) {
    console.error("startScanner error:", e);
  }
}

async function stopScanner() {
  try {
    if (html5qrcode) {
      await html5qrcode.stop();
      await html5qrcode.clear();
      html5qrcode = null;
    }
    // เคลียร์ container เผื่อ library ค้าง DOM ไว้
    if (el.qrReader) el.qrReader.innerHTML = "";
  } catch {}
}

// ---------- start ----------
document.addEventListener("DOMContentLoaded", initApp);
