/* ============ Royal Point — User App (UX Pack) ============ */

/** LIFF / API */
const LIFF_ID = "2007053300-QoEvbXyn";
const API_GET_SCORE = "/api/get-score";       // GET  ?uid=...
const API_REDEEM    = "/api/redeem";          // POST { uid, code, type }
const API_HISTORY   = "/api/score-history";   // GET  ?uid=...

/** Admin gate (โชว์ปุ่มเฉพาะแอดมิน) */
const ADMIN_UIDS = ["Ucadb3c0f63ada96c0432a0aede267ff9"];

/** Elements (มีตัวไหนไม่มีในหน้า ก็จะ no-op ไม่ error) */
const $ = (id) => document.getElementById(id);
const els = {
  // header
  username: $("username"),
  profilePic: $("profilePic"),
  points: $("points"),
  progress: $("progressCurve"),
  nextTier: $("next-tier"),

  // buttons
  btnRefresh: $("refreshBtn"),
  btnAdmin: $("btnAdmin"),
  btnOpenHistory: $("historyBtn"), // ถ้ามีปุ่มดูประวัติ

  // scanner modal + manual
  modal: $("scoreModal"),
  qrReader: $("qr-reader"),
  secretInput: $("secretCode"),
  submitBtn: $("submitCodeBtn"),

  // history modal
  historyModal: $("historyModal"),
  historyList: $("historyList"),
  historyUser: $("historyUser"),
};

/** State */
let UID = "";
let html5qrcode = null;
let lastCamera = null;

/* ============ Boot ============ */
document.addEventListener("DOMContentLoaded", initApp);

async function initApp() {
  try {
    await liff.init({ liffId: LIFF_ID });
    if (!liff.isLoggedIn()) { liff.login(); return; }

    const prof = await liff.getProfile();
    UID = prof.userId;

    // Header fill
    if (els.username)   els.username.textContent = prof.displayName || "—";
    if (els.profilePic) els.profilePic.src = prof.pictureUrl || "https://placehold.co/120x120";

    // Show admin entry only for admin UIDs
    showAdminEntry(ADMIN_UIDS.includes(UID));

    // Bind events
    bindUI();

    // First load
    await refreshUserScore();
  } catch (e) {
    console.error(e);
    toastErr("เริ่มต้นระบบไม่สำเร็จ");
  }
}

/* ============ UI & Helpers ============ */
function bindUI() {
  if (els.btnRefresh) els.btnRefresh.addEventListener("click", refreshUserScore);

  // History (ถ้าหน้าคุณมีปุ่ม id="historyBtn")
  if (els.btnOpenHistory) els.btnOpenHistory.addEventListener("click", openHistory);

  // Modal events -> start/stop camera
  if (els.modal) {
    els.modal.addEventListener("shown.bs.modal", startScanner);
    els.modal.addEventListener("hidden.bs.modal", stopScanner);
  }

  // Manual redeem
  if (els.submitBtn) {
    els.submitBtn.addEventListener("click", async () => {
      const code = (els.secretInput?.value || "").trim();
      if (!code) return toastErr("กรอกรหัสลับก่อน");
      await redeemCode(code, "MANUAL");
    });
  }
}

function showAdminEntry(isAdmin) {
  if (!els.btnAdmin) return;
  els.btnAdmin.classList.toggle("d-none", !isAdmin);
}

function toastOk(msg) {
  if (window.Swal) return Swal.fire("สำเร็จ", msg || "", "success");
  alert(msg || "สำเร็จ");
}
function toastErr(msg) {
  if (window.Swal) return Swal.fire("ผิดพลาด", msg || "", "error");
  alert(msg || "ผิดพลาด");
}

/* ============ Score / Progress ============ */
async function refreshUserScore() {
  if (!UID) return;
  try {
    const r = await fetch(`${API_GET_SCORE}?uid=${encodeURIComponent(UID)}`, { cache: "no-store" });
    const j = await safeJson(r);

    if (j.status === "success" && j.data) {
      const score = Number(j.data.score || 0);
      setPoints(score);
      localStorage.setItem("lastScore", String(score));
    } else {
      // fallback from cache (ถ้ามี)
      const cached = Number(localStorage.getItem("lastScore") || "0");
      setPoints(cached);
    }
  } catch (e) {
    console.error(e);
    const cached = Number(localStorage.getItem("lastScore") || "0");
    setPoints(cached);
  }
}

function setPoints(n) {
  if (els.points) els.points.textContent = Number(n || 0);
  // วาด progress (สมมติ Max 1000 – ปรับตามระบบจริงได้)
  if (els.progress) {
    const total = 126, max = 1000;
    const pct = Math.max(0, Math.min(1, Number(n || 0) / max));
    els.progress.setAttribute("stroke-dashoffset", String(total * (1 - pct)));
  }
  // ข้อความไป tier ถัดไป (ตัวอย่าง)
  if (els.nextTier) {
    const need = Math.max(0, 100 - (Number(n || 0) % 100));
    els.nextTier.textContent = need === 0 ? "ถึงเป้าหมายรอบนี้แล้ว!" : `สะสมอีก ${need} พ้อยท์ เพื่อเลื่อนไปขั้นถัดไป`;
  }
}

async function safeJson(resp) {
  const t = await resp.text();
  try { return JSON.parse(t); } catch { return { status: resp.ok ? "success" : "error", message: t }; }
}

/* ============ Redeem / Scanner ============ */
async function redeemCode(code, type) {
  try {
    const r = await fetch(API_REDEEM, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid: UID, code, type })
    });
    const j = await safeJson(r);
    if (j.status === "success") {
      navigator.vibrate?.(12);
      toastOk(`รับคะแนนแล้ว +${j.point || 0}`);
      await refreshUserScore();
      // close modal + reset
      stopScanner();
      if (els.secretInput) els.secretInput.value = "";
      if (els.modal) {
        const m = window.bootstrap?.Modal.getInstance(els.modal);
        m && m.hide();
      }
    } else {
      toastErr(j.message || "คูปองไม่ถูกต้องหรือถูกใช้ไปแล้ว");
    }
  } catch (e) {
    console.error(e);
    toastErr("ไม่สามารถยืนยันรับคะแนนได้");
  }
}

async function startScanner() {
  if (!els.qrReader) return;
  try {
    // ใช้ html5-qrcode ในเบราว์เซอร์ทั่วไป / LINE in-app browser
    const devices = await Html5Qrcode.getCameras();
    const camId = lastCamera || (devices[0] && devices[0].id);
    if (!camId) return;

    html5qrcode = new Html5Qrcode(els.qrReader.id);
    await html5qrcode.start(
      camId,
      { fps: 10, qrbox: { width: 260, height: 260 } },
      async (decoded) => {
        try { await redeemCode(String(decoded || "").trim(), "SCAN"); }
        finally { stopScanner(); }
      },
      () => {}
    );
    lastCamera = camId;
  } catch (e) {
    console.warn("Scanner start failed:", e);
  }
}

async function stopScanner() {
  try {
    if (html5qrcode) {
      await html5qrcode.stop(); await html5qrcode.clear(); html5qrcode = null;
    }
    if (els.qrReader) els.qrReader.innerHTML = "";
  } catch {}
}

/* ============ History ============ */
async function openHistory() {
  if (!UID) return;
  try {
    const r = await fetch(`${API_HISTORY}?uid=${encodeURIComponent(UID)}`);
    const j = await safeJson(r);
    if (j.status !== "success") return toastErr("โหลดประวัติไม่สำเร็จ");
    if (els.historyUser) els.historyUser.textContent = els.username?.textContent || "—";
    if (!els.historyList) return;

    const list = j.data || [];
    if (!list.length) {
      els.historyList.innerHTML = `<div class="list-group-item bg-transparent text-center text-muted">ไม่มีรายการ</div>`;
    } else {
      els.historyList.innerHTML = list.map(i => {
        const ts = formatDateTime(i.ts);
        const p  = Number(i.point || 0);
        const sign = p >= 0 ? "+" : "";
        const color = p >= 0 ? "#22c55e" : "#ef4444";
        return `<div class="list-group-item bg-transparent d-flex justify-content-between align-items-center">
                  <div><div class="fw-bold">${escapeHtml(i.type || "—")}</div><div class="small text-muted">${escapeHtml(i.code || "")}</div></div>
                  <div class="text-end"><div style="color:${color};font-weight:800">${sign}${p}</div><div class="small text-muted">${ts}</div></div>
                </div>`;
      }).join("");
    }
    if (els.historyModal) new bootstrap.Modal(els.historyModal).show();
  } catch (e) {
    console.error(e); toastErr("ไม่สามารถโหลดประวัติได้");
  }
}

/* ============ Utils ============ */
function escapeHtml(s){ return String(s||"").replace(/[&<>"'`=\/]/g, a => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','/':'&#47;','`':'&#x60;','=':'&#x3D;'}[a])); }
function pad(n){ return n<10? "0"+n : String(n); }
function formatDateTime(ts){ const d=new Date(ts); if(isNaN(d)) return String(ts||""); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; }
