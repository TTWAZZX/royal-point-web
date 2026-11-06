// ===== Unified Loading Manager & apiFetch wrapper =====
(function (global) {
  const nativeFetch = global.fetch.bind(global);
  const RECOVERY_MODE_KEY = 'ROYAL_AUTH_RECOVERY_UNTIL';
  const RECOVERY_TICKET_KEY = 'ROYAL_AUTH_HELP_TICKET';
  const RECOVERY_CASE_KEY = 'ROYAL_AUTH_HELP_CASE';
  const RECOVERY_COMPLETE_KEY = 'ROYAL_AUTH_HELP_COMPLETED';
  let authHelpOpen = false;
  let completingRecovery = false;
  let bootTimer = null;
  let bootSlowTimer = null;

  function ensureSystemBoot() {
    if (!global.document?.body) return null;
    let overlay = global.document.getElementById('systemBootOverlay');

    if (!global.document.getElementById('systemBootStyles')) {
      const style = global.document.createElement('style');
      style.id = 'systemBootStyles';
      style.textContent = `
        #systemBootOverlay{box-sizing:border-box;position:fixed;inset:0;z-index:12000;display:flex;align-items:center;justify-content:center;padding:20px;background:linear-gradient(145deg,rgba(240,253,250,.98),rgba(239,246,255,.98));color:#0f172a;font-family:"Noto Sans Thai","Kanit",system-ui,sans-serif;transition:opacity .22s ease}
        #systemBootOverlay.is-leaving{opacity:0;pointer-events:none}
        #systemBootOverlay .system-boot-card{box-sizing:border-box;width:min(100%,420px);padding:28px 24px;text-align:center;background:rgba(255,255,255,.94);border:1px solid rgba(148,163,184,.24);border-radius:24px;box-shadow:0 24px 60px rgba(15,23,42,.12)}
        #systemBootOverlay .system-boot-spinner{width:52px;height:52px;margin:0 auto 18px;border:5px solid #dbeafe;border-top-color:#0ea5e9;border-radius:50%;animation:systemBootSpin .85s linear infinite}
        #systemBootOverlay .system-boot-title{font-size:1.18rem;font-weight:800;margin:0 0 6px}
        #systemBootOverlay .system-boot-message{min-height:48px;margin:0;color:#475569;font-size:.94rem;line-height:1.55;overflow-wrap:anywhere}
        #systemBootOverlay .system-boot-track{height:6px;margin-top:18px;overflow:hidden;border-radius:999px;background:#e2e8f0}
        #systemBootOverlay .system-boot-bar{width:42%;height:100%;border-radius:inherit;background:linear-gradient(90deg,#0ea5e9,#22c55e);animation:systemBootProgress 1.35s ease-in-out infinite}
        #systemBootOverlay .system-boot-hint{display:block;margin-top:12px;color:#64748b;font-size:.78rem}
        #systemBootOverlay .system-boot-retry{display:none;margin:16px auto 0;padding:9px 18px;border:0;border-radius:999px;background:#0ea5e9;color:#fff;font:inherit;font-weight:700}
        #systemBootOverlay.is-slow .system-boot-retry{display:inline-flex}
        @keyframes systemBootSpin{to{transform:rotate(360deg)}}
        @keyframes systemBootProgress{0%{transform:translateX(-110%)}50%{transform:translateX(95%)}100%{transform:translateX(240%)}}
        @media(max-width:480px){#systemBootOverlay{padding:14px}#systemBootOverlay .system-boot-card{padding:24px 18px;border-radius:20px}#systemBootOverlay .system-boot-title{font-size:1.05rem}}
        @media(prefers-reduced-motion:reduce){#systemBootOverlay .system-boot-spinner,#systemBootOverlay .system-boot-bar{animation-duration:2.5s}}
      `;
      global.document.head.appendChild(style);
    }

    if (overlay) {
      if (overlay.dataset.retryBound !== '1') {
        overlay.querySelector('.system-boot-retry')?.addEventListener('click', () => global.location.reload());
        overlay.dataset.retryBound = '1';
      }
      return overlay;
    }

    overlay = global.document.createElement('div');
    overlay.id = 'systemBootOverlay';
    overlay.setAttribute('role', 'status');
    overlay.setAttribute('aria-live', 'polite');
    overlay.setAttribute('aria-busy', 'true');
    overlay.innerHTML = `
      <div class="system-boot-card">
        <div class="system-boot-spinner" aria-hidden="true"></div>
        <h2 class="system-boot-title">กำลังเปิดระบบ Royal Point</h2>
        <p class="system-boot-message">กำลังโหลดทรัพยากรและเชื่อมต่อข้อมูล กรุณารอสักครู่</p>
        <div class="system-boot-track" aria-hidden="true"><div class="system-boot-bar"></div></div>
        <small class="system-boot-hint">กรุณาอย่าปิดหน้าต่างระหว่างกำลังโหลด</small>
        <button type="button" class="system-boot-retry">โหลดระบบใหม่</button>
      </div>`;
    overlay.querySelector('.system-boot-retry')?.addEventListener('click', () => global.location.reload());
    overlay.dataset.retryBound = '1';
    global.document.body.appendChild(overlay);
    return overlay;
  }

  function updateSystemBoot(message) {
    const overlay = ensureSystemBoot();
    const target = overlay?.querySelector('.system-boot-message');
    if (target && message) target.textContent = String(message);
  }

  function showSystemBoot(message = 'กำลังโหลดทรัพยากรและเชื่อมต่อข้อมูล กรุณารอสักครู่') {
    const overlay = ensureSystemBoot();
    if (!overlay) return;
    overlay.classList.remove('is-leaving', 'is-slow');
    overlay.setAttribute('aria-busy', 'true');
    updateSystemBoot(message);
    clearTimeout(bootTimer);
    clearTimeout(bootSlowTimer);
    bootTimer = setTimeout(() => updateSystemBoot('ระบบยังคงกำลังโหลดข้อมูล กรุณารอสักครู่อีกนิด'), 5000);
    bootSlowTimer = setTimeout(() => {
      overlay.classList.add('is-slow');
      updateSystemBoot('การเชื่อมต่อใช้เวลานานกว่าปกติ คุณสามารถรอต่อหรือลองโหลดระบบใหม่');
    }, 12000);
  }

  function hideSystemBoot() {
    clearTimeout(bootTimer);
    clearTimeout(bootSlowTimer);
    const overlay = global.document.getElementById('systemBootOverlay');
    if (!overlay) return;
    overlay.setAttribute('aria-busy', 'false');
    overlay.classList.add('is-leaving');
    setTimeout(() => overlay.remove(), 240);
  }

  global.SystemBoot = { show: showSystemBoot, update: updateSystemBoot, hide: hideSystemBoot };
  showSystemBoot();

  function isSameOriginApi(input) {
    try {
      const raw = typeof input === 'string' ? input : input?.url;
      const url = new URL(raw, global.location.href);
      return url.origin === global.location.origin && url.pathname.startsWith('/api/');
    } catch (_) {
      return false;
    }
  }

  function getLineAccessToken() {
    try {
      if (!global.liff || !global.liff.isLoggedIn()) return '';
      return String(global.liff.getAccessToken() || '').trim();
    } catch (_) {
      return '';
    }
  }

  function isRecoveryMode() {
    try {
      const until = Number(global.sessionStorage.getItem(RECOVERY_MODE_KEY) || 0);
      if (until > Date.now()) return true;
      global.sessionStorage.removeItem(RECOVERY_MODE_KEY);
      global.sessionStorage.removeItem(RECOVERY_TICKET_KEY);
      global.sessionStorage.removeItem(RECOVERY_CASE_KEY);
      global.sessionStorage.removeItem(RECOVERY_COMPLETE_KEY);
    } catch (_) {}
    return false;
  }

  function enableRecoveryMode(minutes = 30) {
    try {
      global.sessionStorage.setItem(RECOVERY_MODE_KEY, String(Date.now() + minutes * 60 * 1000));
    } catch (_) {}
  }

  function enableRecoveryUntil(value) {
    const until = new Date(value || 0).getTime();
    if (!Number.isFinite(until) || until <= Date.now()) return false;
    try { global.sessionStorage.setItem(RECOVERY_MODE_KEY, String(until)); } catch (_) {}
    return true;
  }

  function disableRecoveryMode() {
    try {
      global.sessionStorage.removeItem(RECOVERY_MODE_KEY);
      global.sessionStorage.removeItem(RECOVERY_TICKET_KEY);
      global.sessionStorage.removeItem(RECOVERY_CASE_KEY);
      global.sessionStorage.removeItem(RECOVERY_COMPLETE_KEY);
    } catch (_) {}
  }

  function getRecoveryProof() {
    if (!isRecoveryMode()) return '';
    try { return String(global.sessionStorage.getItem(RECOVERY_TICKET_KEY) || '').trim(); } catch (_) { return ''; }
  }

  function currentUid() {
    try {
      return String(global.__UID || global.sessionStorage.getItem('uid') || global.localStorage.getItem('uid') || '').trim();
    } catch (_) {
      return String(global.__UID || '').trim();
    }
  }

  function reloadFresh() {
    try {
      const url = new URL(global.location.href);
      url.searchParams.set('auth_refresh', String(Date.now()));
      if (typeof global.location.replace === 'function') global.location.replace(url.toString());
      else global.location.reload();
    } catch (_) {
      global.location.reload();
    }
  }

  function loginWithLineAgain() {
    disableRecoveryMode();
    try {
      if (global.liff?.isLoggedIn?.()) global.liff.logout();
      if (global.liff) {
        global.liff.login({ redirectUri: global.location.href });
        return;
      }
    } catch (_) {}
    reloadFresh();
  }

  async function sendHelpRequest(uid, errorCode) {
    const response = await nativeFetch('/api/auth-help', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Royal-Client': 'line-token-v1' },
      body: JSON.stringify({
        action: 'request',
        uid,
        errorCode,
        detail: `หน้า ${global.location?.pathname || '/'} ส่งคำขอจากระบบช่วยเหลืออัตโนมัติ`
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.status !== 'success') throw new Error(payload.message || 'ส่งคำขอไม่สำเร็จ');
    return payload.data;
  }

  async function contactAdmin(uid, canUseRecovery, errorCode) {
    if (!global.Swal) return;
    const safeUid = String(uid || '').replace(/[&<>"']/g, '');
    const result = await global.Swal.fire({
      title: 'ส่งคำขอให้ผู้ดูแล',
      html: safeUid
        ? `ระบบจะส่งเรื่องพร้อมสาเหตุไปยังผู้ดูแลโดยอัตโนมัติ<br><span class="d-inline-block mt-2 small text-muted">UID: <code>${safeUid}</code></span>`
        : 'ไม่พบ UID ในอุปกรณ์นี้ กรุณาแจ้งชื่อและเบอร์โทรที่ลงทะเบียนไว้แก่ผู้ดูแล',
      icon: 'info',
      showConfirmButton: Boolean(safeUid),
      showDenyButton: Boolean(canUseRecovery),
      showCancelButton: true,
      confirmButtonText: 'ส่งคำขอช่วยเหลือ',
      denyButtonText: 'ฉันได้รับสิทธิ์แล้ว',
      cancelButtonText: 'ปิด',
      allowOutsideClick: false
    });

    if (result.isConfirmed && safeUid) {
      try {
        global.Swal.fire({ title: 'กำลังส่งคำขอ...', allowOutsideClick: false, didOpen: () => global.Swal.showLoading() });
        const data = await sendHelpRequest(safeUid, errorCode);
        const deliveryNote = data.lineNotification === 'sent'
          ? 'ระบบแจ้งผู้ดูแลผ่าน LINE แล้ว'
          : 'ระบบบันทึกเรื่องแล้ว ผู้ดูแลสามารถเห็นคำขอในหน้าจัดการ';
        await global.Swal.fire({
          title: 'ส่งคำขอเรียบร้อย',
          html: `หมายเลขเรื่อง <b>${String(data.caseNo || '').replace(/[&<>"']/g, '')}</b><br><span class="small text-muted">${deliveryNote}</span>`,
          icon: 'success',
          confirmButtonText: 'รับทราบ'
        });
      } catch (error) {
        await global.Swal.fire('ส่งคำขอไม่สำเร็จ', error.message || 'กรุณาลองใหม่', 'error');
      }
    }
    if (result.isDenied) {
      enableRecoveryMode(30);
      reloadFresh();
    }
  }

  function authDialogConfig(code) {
    const configs = {
      AUTH_PROVIDER_UNAVAILABLE: {
        title: 'ไม่สามารถเชื่อมต่อ LINE ได้ชั่วคราว',
        detail: 'ระบบลองเชื่อมต่อให้อัตโนมัติแล้ว 2 ครั้ง แต่ยังไม่สำเร็จ',
        icon: 'warning',
        confirmText: 'ลองอีกครั้ง',
        confirmAction: 'reload',
        denyText: 'เข้าสู่ระบบ LINE ใหม่',
        denyAction: 'login',
        canUseRecovery: true
      },
      AUTH_TOKEN_INVALID: {
        title: 'ข้อมูลยืนยัน LINE หมดอายุหรือไม่ถูกต้อง',
        detail: 'กรุณาเข้าสู่ระบบ LINE ใหม่เพื่อยืนยันว่าเป็นเจ้าของบัญชี',
        icon: 'warning',
        confirmText: 'เข้าสู่ระบบ LINE ใหม่',
        confirmAction: 'login',
        denyText: 'ลองโหลดใหม่',
        denyAction: 'reload',
        canUseRecovery: true
      },
      AUTH_TOKEN_REQUIRED: {
        title: 'ต้องเข้าสู่ระบบ LINE',
        detail: 'ระบบไม่พบข้อมูลยืนยันตัวตนจาก LINE',
        icon: 'warning',
        confirmText: 'เข้าสู่ระบบ LINE',
        confirmAction: 'login',
        denyText: 'ลองโหลดใหม่',
        denyAction: 'reload',
        canUseRecovery: true
      },
      AUTH_UPGRADE_REQUIRED: {
        title: 'ต้องโหลดระบบเวอร์ชันใหม่',
        detail: 'บัญชีนี้เปลี่ยนมาใช้การยืนยันตัวตนผ่าน LINE แล้ว',
        icon: 'info',
        confirmText: 'โหลดระบบเวอร์ชันใหม่',
        confirmAction: 'reload',
        denyText: 'เข้าสู่ระบบ LINE ใหม่',
        denyAction: 'login',
        canUseRecovery: true
      },
      AUTH_UID_MISMATCH: {
        title: 'บัญชี LINE ไม่ตรงกับผู้ใช้',
        detail: 'กรุณาออกจากบัญชี LINE ปัจจุบันและเข้าสู่ระบบด้วยบัญชีที่ถูกต้อง',
        icon: 'error',
        confirmText: 'เข้าสู่ระบบ LINE ใหม่',
        confirmAction: 'login',
        canUseRecovery: false
      },
      AUTH_MIGRATION_NOT_READY: {
        title: 'ระบบกำลังปรับปรุง',
        detail: 'ระบบยืนยันตัวตนฝั่งผู้ดูแลยังติดตั้งไม่ครบ กรุณาติดต่อผู้ดูแลและลองใหม่ภายหลัง',
        icon: 'error',
        confirmText: 'ลองใหม่ภายหลัง',
        confirmAction: 'reload',
        canUseRecovery: false
      },
      AUTH_RECOVERY_TICKET_REQUIRED: {
        title: 'ต้องเปิดจากลิงก์ช่วยเหลือใน LINE',
        detail: 'สิทธิ์นี้ผูกกับลิงก์ที่ผู้ดูแลส่งให้ กรุณากลับไปกดปุ่ม “กลับเข้าสู่ระบบ” ใน LINE',
        icon: 'warning',
        confirmText: 'โหลดใหม่',
        confirmAction: 'reload',
        canUseRecovery: false
      },
      AUTH_RECOVERY_TICKET_INVALID: {
        title: 'ลิงก์ช่วยเหลือไม่ถูกต้อง',
        detail: 'ลิงก์อาจถูกใช้จากอุปกรณ์อื่นหรือข้อมูลใน session ไม่ครบ กรุณาส่งคำขอใหม่',
        icon: 'error',
        confirmText: 'โหลดใหม่',
        confirmAction: 'reload',
        canUseRecovery: false
      }
    };
    return configs[code] || {
      title: 'ยืนยันตัวตนไม่สำเร็จ',
      detail: 'กรุณาลองโหลดระบบใหม่ หรือติดต่อผู้ดูแล',
      icon: 'warning',
      confirmText: 'ลองอีกครั้ง',
      confirmAction: 'reload',
      canUseRecovery: false
    };
  }

  async function showAuthHelp(payload) {
    if (authHelpOpen || !payload?.code || !String(payload.code).startsWith('AUTH_')) return;
    authHelpOpen = true;
    const code = payload.code;
    const uid = currentUid();
    const config = authDialogConfig(code);
    const uidText = uid ? `<div class="mt-2 small text-muted">UID สำหรับแจ้งผู้ดูแล: <code>${uid.replace(/[&<>"']/g, '')}</code></div>` : '';

    try {
      if (!global.Swal) {
        global.alert?.(`${config.title}\n${config.detail}${uid ? `\nUID: ${uid}` : ''}`);
        return;
      }
      const result = await global.Swal.fire({
        title: config.title,
        html: `${config.detail}${uidText}`,
        icon: config.icon,
        showCancelButton: true,
        showDenyButton: Boolean(config.denyText),
        confirmButtonText: config.confirmText,
        denyButtonText: config.denyText || '',
        cancelButtonText: 'ติดต่อผู้ดูแล',
        allowOutsideClick: false,
        allowEscapeKey: false
      });

      if (result.isConfirmed) {
        if (config.confirmAction === 'login') loginWithLineAgain();
        else {
          disableRecoveryMode();
          reloadFresh();
        }
        return;
      }
      if (result.isDenied) {
        if (config.denyAction === 'login') loginWithLineAgain();
        else {
          disableRecoveryMode();
          reloadFresh();
        }
        return;
      }
      if (result.isDismissed) await contactAdmin(uid, config.canUseRecovery, code);
    } finally {
      authHelpOpen = false;
    }
  }

  function canReplayRequest(input, init = {}) {
    if (typeof Request !== 'undefined' && input instanceof Request) return false;
    const method = String(init.method || 'GET').toUpperCase();
    return ['GET', 'HEAD', 'OPTIONS'].includes(method) || typeof init.body === 'string';
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function readAuthPayload(response) {
    if (![401, 403, 503].includes(response?.status) || typeof response.clone !== 'function') return null;
    try {
      const payload = await response.clone().json();
      return String(payload?.code || '').startsWith('AUTH_') ? payload : null;
    } catch (_) {
      return null;
    }
  }

  async function consumeRecoveryLink() {
    let ticket = '';
    try {
      const url = new URL(global.location.href);
      ticket = String(url.searchParams.get('recovery_ticket') || '').trim();
      if (!ticket) return { consumed: false };

      const response = await nativeFetch('/api/auth-help', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Royal-Client': 'line-token-v1' },
        body: JSON.stringify({ action: 'consume', ticket })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.status !== 'success') throw new Error(payload.message || 'เปิดลิงก์ช่วยเหลือไม่สำเร็จ');
      const data = payload.data || {};
      if (!enableRecoveryUntil(data.recoveryUntil)) throw new Error('สิทธิ์ช่วยเหลือหมดอายุแล้ว');
      global.sessionStorage.setItem('uid', String(data.uid || ''));
      global.localStorage?.setItem('uid', String(data.uid || ''));
      global.sessionStorage.setItem(RECOVERY_TICKET_KEY, ticket);
      global.sessionStorage.setItem(RECOVERY_CASE_KEY, String(data.caseId || ''));
      global.sessionStorage.removeItem(RECOVERY_COMPLETE_KEY);
      global.__UID = String(data.uid || '');
      url.searchParams.delete('recovery_ticket');
      if (global.history?.replaceState) global.history.replaceState({}, '', url.toString());
      return { consumed: true, data };
    } catch (error) {
      try {
        const url = new URL(global.location.href);
        url.searchParams.delete('recovery_ticket');
        if (global.history?.replaceState) global.history.replaceState({}, '', url.toString());
      } catch (_) {}
      setTimeout(async () => {
        if (!global.Swal) return;
        const result = await global.Swal.fire({
          title: 'เปิดลิงก์ช่วยเหลือไม่ได้',
          text: error.message || 'กรุณาส่งคำขอใหม่',
          icon: 'error',
          showCancelButton: Boolean(currentUid()),
          confirmButtonText: 'ปิด',
          cancelButtonText: 'ส่งคำขอใหม่'
        });
        if (result.isDismissed && currentUid()) {
          await contactAdmin(currentUid(), false, 'AUTH_UPGRADE_REQUIRED');
        }
      }, 0);
      return { consumed: false, error };
    }
  }

  async function completeRecoveryIfNeeded() {
    if (completingRecovery || !isRecoveryMode()) return;
    let ticket = '';
    try {
      ticket = String(global.sessionStorage.getItem(RECOVERY_TICKET_KEY) || '');
      if (global.sessionStorage.getItem(RECOVERY_COMPLETE_KEY) === '1') return;
    } catch (_) {}
    if (!ticket) return;
    completingRecovery = true;
    try {
      const response = await nativeFetch('/api/auth-help', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Royal-Client': 'line-token-v1' },
        body: JSON.stringify({ action: 'complete', ticket })
      });
      if (response.ok) {
        global.sessionStorage.setItem(RECOVERY_COMPLETE_KEY, '1');
      }
    } catch (_) {
      // Keep the ticket in this browser session and retry after the next successful API call.
    } finally {
      completingRecovery = false;
    }
  }

  const recoveryReady = consumeRecoveryLink();

  // Attach the LIFF access token to every same-origin API request. Existing
  // pages without this bridge continue in legacy mode until their next reload.
  global.fetch = async function authenticatedFetch(input, init = {}) {
    if (!isSameOriginApi(input)) return nativeFetch(input, init);

    const token = isRecoveryMode() ? '' : getLineAccessToken();
    const requestHeaders = typeof Request !== 'undefined' && input instanceof Request
      ? input.headers
      : undefined;
    const headers = new Headers(requestHeaders || {});
    new Headers(init.headers || {}).forEach((value, key) => headers.set(key, value));
    headers.set('X-Royal-Client', 'line-token-v1');
    const recoveryProof = getRecoveryProof();
    if (recoveryProof) headers.set('X-Royal-Recovery', recoveryProof);
    if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);

    const requestInit = { ...init, headers };
    const replayable = canReplayRequest(input, init);
    let response;
    let authPayload = null;

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        response = await nativeFetch(input, requestInit);
      } catch (error) {
        const method = String(init.method || 'GET').toUpperCase();
        const safeNetworkRetry = ['GET', 'HEAD', 'OPTIONS'].includes(method) && replayable;
        if (safeNetworkRetry && attempt < 2) {
          await sleep(400 + attempt * 500);
          continue;
        }
        void showAuthHelp({ code: 'AUTH_PROVIDER_UNAVAILABLE' });
        throw error;
      }

      authPayload = await readAuthPayload(response);
      if (authPayload?.code === 'AUTH_PROVIDER_UNAVAILABLE' && replayable && attempt < 2) {
        await sleep(400 + attempt * 500);
        continue;
      }
      break;
    }

    if (authPayload) void showAuthHelp(authPayload);
    else if (response?.ok) {
      try {
        const raw = typeof input === 'string' ? input : input?.url;
        const path = new URL(raw, global.location.href).pathname;
        if (path !== '/api/auth-help') void completeRecoveryIfNeeded();
      } catch (_) {}
    }
    return response;
  };

  global.RoyalAuth = {
    getAccessToken: getLineAccessToken,
    hasToken: () => Boolean(getLineAccessToken()),
    isRecoveryMode,
    enableRecoveryMode,
    enableRecoveryUntil,
    disableRecoveryMode,
    ready: recoveryReady
  };

  const $ = (sel) => document.querySelector(sel);
  const topBar = $('#topProgressBar');
  const topWrap = $('#topProgress');
  const overlay = $('#appOverlay');
  const overlayMsg = $('#overlayMsg');

  let prog = 0, timer = null, activeCount = 0;

  function startTop() {
    if (!topWrap || !topBar) return;
    activeCount++;
    if (activeCount > 1) return;
    topWrap.style.display = 'block';
    prog = 0;
    topBar.style.transform = 'scaleX(0)';
    timer = setInterval(() => {
      prog += (1 - prog) * 0.2;
      topBar.style.transform = `scaleX(${prog})`;
    }, 200);
  }
  function doneTop() {
    if (!topWrap || !topBar) return;
    activeCount = Math.max(0, activeCount - 1);
    if (activeCount > 0) return;
    clearInterval(timer);
    topBar.style.transform = 'scaleX(1)';
    setTimeout(() => {
      topWrap.style.display = 'none';
      topBar.style.transform = 'scaleX(0)';
    }, 180);
  }

  function showOverlay(msg = 'กำลังดำเนินการ...') {
    if (!overlay || !overlayMsg) return startTop();
    overlayMsg.textContent = msg;
    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';
  }
  function hideOverlay() {
    if (!overlay) return doneTop();
    overlay.classList.remove('active');
    document.body.style.overflow = '';
  }

  function btnLoading(btn, on = true) {
    if (!btn) return;
    btn.classList.toggle('btn-loading', on);
    btn.disabled = !!on;
    btn.setAttribute('aria-busy', on ? 'true' : 'false');
  }

  function toggleSkeleton(container, on = true) {
    container?.querySelectorAll('.reward-skeleton,.history-skeleton,.skeleton-only')
      .forEach(el => el.style.display = on ? '' : 'none');
    container?.classList?.toggle('skeleton-hide-when-loading', !on);
  }

  async function apiFetch(input, init = {}, opts = { scope: 'page', btn: null, skeletonOf: null, msg: '' }) {
    const scope = opts.scope || 'page';
    try {
      if (scope === 'page') startTop();
      if (scope === 'overlay') showOverlay(opts.msg || 'กำลังโหลด...');
      if (scope === 'inline' && opts.btn) btnLoading(opts.btn, true);
      if (opts.skeletonOf) toggleSkeleton(opts.skeletonOf, true);

      const res = await fetch(input, init);
      let data = null;
      try { data = await res.json(); } catch { /* ignore */ }

      if (!res.ok) throw data || { status: 'error', message: 'network_error' };
      return data;
    } finally {
      if (scope === 'page') doneTop();
      if (scope === 'overlay') hideOverlay();
      if (scope === 'inline' && opts.btn) btnLoading(opts.btn, false);
      if (opts.skeletonOf) toggleSkeleton(opts.skeletonOf, false);
    }
  }

  global.Loading = { startTop, doneTop, showOverlay, hideOverlay, btnLoading, toggleSkeleton, apiFetch };
})(window);
