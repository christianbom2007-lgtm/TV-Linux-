/* Lichtung TV – läuft in jeder Webseite (außer den eigenen Lichtung-Seiten)
 * ------------------------------------------------------------------------
 *  - Lautstärke-Anzeige und Bildschirmschoner als Einblendung
 *  - Text vom Handy ins aktive Eingabefeld schreiben
 *  - Videos beobachten: Fortschritt fürs "Weiterschauen" melden und beim
 *    erneuten Öffnen automatisch an der letzten Stelle fortsetzen
 *  - Rücktaste = Seite zurück (Firefox hat das standardmäßig abgeschaltet)
 * Alle Einblendungen liegen in einem Shadow-DOM, damit die Webseite sie nicht verändert.
 */
(() => {
  'use strict';
  if (location.origin === 'http://127.0.0.1:8770') return;
  if (window.top !== window) return;

  let cfg = { tvHosts: [] };
  browser.runtime.sendMessage({ type: 'config' }).then((c) => { if (c) cfg = c; }).catch(() => {});
  const isTvHost = () => (cfg.tvHosts || []).includes(location.hostname);

  /* ---------- Einblendungs-Ebene ---------- */
  const host = document.createElement('lichtung-overlay');
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `
  <style>
    :host { all: initial; }
    * { box-sizing: border-box; margin: 0; }
    .vol { position: fixed; right: 4vh; top: 50%; transform: translate(170%, -50%); opacity: 0; z-index: 2147483647; display: flex; flex-direction: column; align-items: center; gap: 1.4vh; padding: 2vh 1.6vh; border-radius: 999px; background: rgba(14,17,16,.78); backdrop-filter: blur(16px); border: 1px solid rgba(239,233,223,.12); color: #efe9df; font-family: Georgia, serif; transition: transform .35s cubic-bezier(.2,.8,.2,1), opacity .3s; }
    .vol.show { transform: translate(0, -50%); opacity: 1; }
    .vol .n { font-size: 3vh; }
    .vol .tr { width: 4px; height: 24vh; border-radius: 4px; background: rgba(255,255,255,.15); position: relative; overflow: hidden; }
    .vol .fi { position: absolute; left: 0; right: 0; bottom: 0; background: #c8a26b; transition: height .15s; }
    .saver { position: fixed; inset: 0; z-index: 2147483646; background: radial-gradient(120% 90% at 70% 20%, #18201f, #050706 70%); color: #efe9df; display: none; cursor: none; font-family: Georgia, serif; }
    .saver.show { display: block; }
    .saver .box { position: absolute; transition: left 2s, top 2s; }
    .saver .t { font-size: 20vh; font-weight: 200; line-height: 1; }
    .saver .t i { font-style: normal; color: #c8a26b; }
    .saver .d { font-style: italic; font-size: 4vh; margin-top: 1vh; color: rgba(239,233,223,.8); }
    .saver .w { font-family: ui-monospace, monospace; font-size: 1.8vh; letter-spacing: .15em; text-transform: uppercase; color: rgba(239,233,223,.5); margin-top: 3vh; }
    .toast { position: fixed; left: 50%; bottom: 6vh; transform: translate(-50%, 300%); opacity: 0; z-index: 2147483647; padding: 1.4vh 2.6vh; border-radius: 999px; background: rgba(14,17,16,.85); border: 1px solid rgba(239,233,223,.12); color: #efe9df; font: 1.8vh ui-monospace, monospace; transition: transform .35s, opacity .3s; }
    .toast.show { transform: translate(-50%, 0); opacity: 1; }
  </style>
  <div class="vol"><div class="n"></div><div class="tr"><div class="fi"></div></div></div>
  <div class="saver"><div class="box"><div class="t"></div><div class="d"></div><div class="w"></div></div></div>
  <div class="toast"></div>`;
  const attach = () => { if (!host.isConnected) (document.body || document.documentElement).appendChild(host); };
  attach();
  new MutationObserver(attach).observe(document.documentElement, { childList: true });

  const $ = (s) => root.querySelector(s);
  let volT, toastT, saverT;
  const toast = (msg) => { attach(); const t = $('.toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 3000); };

  function showVolume(v) {
    attach();
    $('.vol .n').textContent = v.muted ? '—' : v.volume;
    $('.vol .fi').style.height = (v.muted ? 0 : Math.min(100, v.volume)) + '%';
    $('.vol').classList.add('show');
    clearTimeout(volT);
    volT = setTimeout(() => $('.vol').classList.remove('show'), 1800);
  }

  async function saver(on) {
    const el = $('.saver');
    if (!on) { el.classList.remove('show'); clearInterval(saverT); return; }
    if (document.fullscreenElement || playingVideo()) return;
    attach();
    let wtxt = '';
    try {
      const w = await browser.runtime.sendMessage({ type: 'weather' });
      if (w && w.current) wtxt = `${Math.round(w.current.temperature_2m)}° · ${w.city}`;
    } catch (_) {}
    const paint = (move) => {
      const d = new Date();
      const t = $('.saver .t'), colon = document.createElement('i');
      colon.textContent = ':';
      t.replaceChildren(String(d.getHours()).padStart(2, '0'), colon, String(d.getMinutes()).padStart(2, '0'));
      $('.saver .d').textContent = d.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
      $('.saver .w').textContent = wtxt;
      if (move) { const b = $('.saver .box'); b.style.left = (8 + Math.random() * 40) + 'vw'; b.style.top = (15 + Math.random() * 35) + 'vh'; }
    };
    paint(true);
    el.classList.add('show');
    clearInterval(saverT);
    saverT = setInterval(() => paint(new Date().getSeconds() < 2), 1000);
  }
  // Jede Eingabe beendet den Bildschirmschoner auch lokal
  ['keydown', 'mousemove', 'mousedown'].forEach((e) => addEventListener(e, () => { if ($('.saver').classList.contains('show')) saver(false); }, true));

  /* ---------- Text vom Handy ---------- */
  function insertText(text, enter) {
    let el = document.activeElement;
    while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
    // Kein echtes Eingabefeld (z. B. YouTube-TV-Suche mit eigener Bildschirmtastatur)?
    // → false: dann tippt der Dienst die Buchstaben über die virtuelle Tastatur.
    if (!el || !(el.isContentEditable || /^(INPUT|TEXTAREA)$/.test(el.tagName))) return false;
    el.focus();
    // execCommand löst die Ereignisse aus, auf die moderne Seiten (React usw.) hören
    const ok = document.execCommand && document.execCommand('insertText', false, text);
    if (!ok && 'value' in el) {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
      setter ? setter.call(el, (el.value || '') + text) : (el.value += text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (enter) {
      const opts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true };
      el.dispatchEvent(new KeyboardEvent('keydown', opts));
      el.dispatchEvent(new KeyboardEvent('keyup', opts));
      if (el.form) el.form.requestSubmit ? el.form.requestSubmit() : el.form.submit();
    }
    return true;
  }

  browser.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'volume') showVolume(msg);
    else if (msg.type === 'saver') saver(msg.on);
    else if (msg.type === 'text') return Promise.resolve(insertText(msg.text, msg.enter));
    else if (msg.type === 'sleep') videos().forEach((v) => v.pause());
    else if (msg.type === 'sleepwarn') {
      toast(`Schlaf-Timer: noch ${msg.seconds} s · Taste = 15 Min. länger`);
      const extend = () => { removeEventListener('keydown', extend, true); browser.runtime.sendMessage({ type: 'extendSleep' }); toast('15 Minuten verlängert'); };
      addEventListener('keydown', extend, true);
      setTimeout(() => removeEventListener('keydown', extend, true), msg.seconds * 1000);
    }
  });

  /* ---------- Videos beobachten ---------- */
  function videos() { return Array.from(document.querySelectorAll('video')); }
  function mainVideo() {
    // Das größte Video auf der Seite ist meist das, was man schaut
    let best = null, area = 0;
    for (const v of videos()) {
      const r = v.getBoundingClientRect(), a = r.width * r.height;
      if (a > area && v.duration) { best = v; area = a; }
    }
    return best;
  }
  function playingVideo() { return videos().some((v) => !v.paused && !v.ended && v.readyState > 2); }

  function meta() {
    const ms = navigator.mediaSession && navigator.mediaSession.metadata;
    let title = ms && ms.title ? ms.title : document.title;
    title = title.replace(/\s*[-|–]\s*(YouTube|ARD Mediathek|ZDFmediathek|ZDF|arte|Netflix|Prime Video|Disney\+).*$/i, '').trim();
    let image = '';
    if (ms && ms.artwork && ms.artwork.length) image = ms.artwork[ms.artwork.length - 1].src;
    if (!image) image = document.querySelector('meta[property="og:image"]')?.content || '';
    return { title: title || location.hostname, image };
  }

  let lastReport = 0, lastPlaying = null, lastActivity = 0;
  setInterval(() => {
    // Dem Dienst sagen, ob gerade etwas läuft (dann kein Bildschirmschoner)
    const playing = playingVideo();
    if (playing !== lastPlaying || Date.now() - lastActivity > 30000) {
      browser.runtime.sendMessage({ type: 'activity', data: { playing } }).catch(() => {});
      lastPlaying = playing;
      lastActivity = Date.now();
    }
    const v = mainVideo();
    if (!v || v.paused || !isFinite(v.duration) || v.duration < 120) return;
    if (Date.now() - lastReport < 10000) return;
    lastReport = Date.now();
    const m = meta();
    browser.runtime.sendMessage({ type: 'progress', data: {
      url: location.href, title: m.title, image: m.image, site: location.hostname,
      time: v.currentTime, duration: v.duration,
    } }).catch(() => {});
  }, 3000);

  // Fortsetzen: Beim ersten Abspielen an die gemerkte Stelle springen
  let resumeFor = null;
  async function checkResume() {
    if (resumeFor === location.href) return;
    resumeFor = location.href;
    const saved = await browser.runtime.sendMessage({ type: 'lookup', url: location.href }).catch(() => ({}));
    if (!saved || !saved.time || saved.time < 30) return;
    const tryResume = () => {
      const v = mainVideo();
      if (!v || !isFinite(v.duration)) return false;
      if (Math.abs(v.duration - saved.duration) > 8) return true;  // anderes Video
      if (v.currentTime < saved.time - 15) {
        v.currentTime = saved.time - 3;
        const mm = Math.floor(saved.time / 60), ss = Math.floor(saved.time % 60);
        toast(`Fortgesetzt bei ${mm}:${String(ss).padStart(2, '0')}`);
      }
      return true;
    };
    let tries = 0;
    const iv = setInterval(() => { if (tryResume() || ++tries > 40) clearInterval(iv); }, 500);
  }
  document.addEventListener('play', checkResume, true);
  // Viele Seiten wechseln die Adresse ohne neu zu laden (YouTube, Mediatheken)
  let lastUrl = location.href;
  setInterval(() => { if (location.href !== lastUrl) { lastUrl = location.href; resumeFor = null; } }, 1000);

  /* ---------- Tasten ---------- */
  const typing = () => { const a = document.activeElement; return a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)); };
  addEventListener('keydown', (e) => {
    if (e.defaultPrevented || typing() || isTvHost()) return; // TV-Seiten haben eigene Zurück-Logik
    if (e.key === 'Backspace' && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      if (history.length > 1) history.back(); else browser.runtime.sendMessage({ type: 'home' });
    }
  });
  addEventListener('keydown', (e) => {
    if (e.defaultPrevented || typing()) return;
    // "f" = Vollbild für das Hauptvideo, falls die Seite das nicht selbst macht
    if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !isTvHost()) {
      const v = mainVideo();
      setTimeout(() => {
        if (e.defaultPrevented || !v) return;
        if (document.fullscreenElement) document.exitFullscreen();
        else (v.closest('[class*="player" i]') || v).requestFullscreen().catch(() => {});
      }, 50);
    }
  });
})();
