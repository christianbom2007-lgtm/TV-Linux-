/* Lichtung TV – Mini-Fenster
 * ---------------------------------------------------------------
 * Ein YouTube-Video läuft klein unten rechts auf der Startseite weiter,
 * während man Kacheln durchstöbert. Ausgelöst in Brave: Zurück-Taste
 * gedrückt halten oder oben links "Mini-Fenster".
 *
 *   Brave (Erweiterung) ──POST /api/mini──▶ Dienst ──Ereignis "mini"──▶ hier
 *
 * Das Video läuft hier als YouTube-Einbettung (youtube-nocookie) ab der
 * Stelle, an der es in Brave war. "Groß" öffnet es wieder im Kino-Fenster –
 * an der aktuellen Stelle. Mit den Pfeiltasten erreicht man die zwei Knöpfe.
 */
(() => {
  'use strict';
  const M = { el: null, frame: null, yt: '', time: 0, title: '', sentAt: 0, failed: false };

  function build() {
    const frame = h('iframe', { allow: 'autoplay; encrypted-media; picture-in-picture', referrerpolicy: 'strict-origin-when-cross-origin' });
    const title = h('div', { class: 't' });
    const msg = h('div', { class: 'msg' });
    const big = h('button', { class: 'btn primary', 'data-nav': true, onclick: () => grow() }, '⤢ Groß');
    const close = h('button', { class: 'btn', 'data-nav': true, onclick: () => closeMini(true) }, '✕ Schließen');
    const el = h('div', { class: 'mini-win', id: 'mini-win' },
      h('div', { class: 'scr' }, frame, msg),
      h('div', { class: 'bar' }, h('span', { class: 'live' }), title, h('div', { class: 'acts' }, big, close)));
    ($('#home') || document.body).append(el);
    Object.assign(M, { el, frame, titleEl: title, msgEl: msg });
  }

  function src(id, start) {
    const q = new URLSearchParams({ autoplay: 1, start: Math.floor(start || 0), enablejsapi: 1, playsinline: 1, rel: 0, modestbranding: 1, iv_load_policy: 3, origin: location.origin });
    return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?${q}`;
  }

  function openMini(m) {
    if (!m || !m.yt) return closeMini(false);
    if (!M.el) build();
    const same = M.yt === m.yt;
    Object.assign(M, { yt: m.yt, time: m.time || 0, title: m.title || 'YouTube', failed: false });
    M.titleEl.textContent = M.title;
    M.msgEl.textContent = '';
    M.el.classList.remove('err');
    if (!same) M.frame.src = src(M.yt, M.time);
    requestAnimationFrame(() => M.el.classList.add('show'));
    L.toast('Mini-Fenster · mit den Pfeiltasten zu „Groß“ und „Schließen“', 4500);
  }

  function closeMini(tell) {
    if (M.el) {
      M.el.classList.remove('show');
      setTimeout(() => { if (!M.el.classList.contains('show')) M.frame.src = 'about:blank'; }, 400);
    }
    M.yt = '';
    if (tell) api('/api/mini', 'POST', { action: 'close' }).catch(() => {});
    if (M.el && M.el.contains(document.activeElement)) { const f = $('#tile-row .tile'); if (f) Nav.focus(f); }
  }

  function grow() {
    if (!M.yt) return;
    const url = `https://www.youtube.com/watch?v=${M.yt}&t=${Math.floor(M.time)}s`;
    const t = M.title;
    closeMini(true);
    _openWeb(url, 'kino', t);
  }

  // Antworten des YouTube-Players (aktuelle Zeit, Fehler wie "Einbetten verboten")
  addEventListener('message', (e) => {
    if (!M.frame || e.source !== M.frame.contentWindow) return;
    let d; try { d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; } catch (_) { return; }
    if (!d || !d.event) return;
    if (d.event === 'infoDelivery' && d.info && typeof d.info.currentTime === 'number') {
      M.time = d.info.currentTime;
      if (Date.now() - M.sentAt > 10000) { M.sentAt = Date.now(); api('/api/mini', 'POST', { action: 'time', time: M.time }).catch(() => {}); }
    }
    if (d.event === 'onError' && !M.failed) {
      M.failed = true;
      M.el.classList.add('err');
      M.msgEl.textContent = 'Dieses Video darf nicht klein abgespielt werden – „Groß“ öffnet es wieder.';
    }
  });
  function listen() {
    try { M.frame.contentWindow.postMessage(JSON.stringify({ event: 'listening', id: 'lichtung-mini', channel: 'widget' }), '*'); } catch (_) {}
  }
  setInterval(() => { if (M.yt && M.frame) listen(); }, 2000);

  // Wer etwas anderes startet, braucht kein Mini-Fenster mehr (sonst doppelter Ton)
  const _openWeb = window.openWeb;
  window.openWeb = function (...a) { if (M.yt) closeMini(true); return _openWeb.apply(this, a); };
  if (typeof window.launchApp === 'function') {
    const _launch = window.launchApp;
    window.launchApp = function (...a) { if (M.yt) closeMini(true); return _launch.apply(this, a); };
  }

  window.miniWindow = (ev) => (ev && ev.yt ? openMini(ev) : closeMini(false));
  window.miniActive = () => !!M.yt;
  // Nach einem Neuladen der Startseite: Mini-Fenster wiederherstellen
  const boot = setInterval(() => { if (typeof S !== 'undefined' && S.state) { clearInterval(boot); if (S.state.mini) openMini(S.state.mini); } }, 300);
})();
