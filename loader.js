// ===== Unified Loading Manager & apiFetch wrapper =====
(function (global) {
  const $ = (sel) => document.querySelector(sel);
  const topBar = $('#topProgressBar');
  const topWrap = $('#topProgress');
  const overlay = $('#appOverlay');
  const overlayMsg = $('#overlayMsg');

  let prog = 0, timer = null, activeCount = 0;

  function startTop() {
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
    overlayMsg.textContent = msg;
    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';
  }
  function hideOverlay() {
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
