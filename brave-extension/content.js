/* Lichtung TV – läuft in jeder Webseite in Brave
 * ---------------------------------------------
 *  - meldet, ob gerade ein Video läuft (dann kein Bildschirmschoner)
 *  - Weiterschauen: Fortschritt melden und beim erneuten Öffnen fortsetzen
 *  - Gleiche Lautstärke: sanfter Kompressor für Videos (laute Werbung/Intros
 *    werden leiser, leise Stimmen lauter) – nur bei Videos, bei denen das
 *    technisch sicher geht (YouTube, Twitch & Co.)
 *  - YouTube: Kinomodus-Schalter am <html>, Qualität an youtube-main.js
 */
(() => {
  'use strict';
  if (window.top !== window) return;
  const send = (m) => new Promise((res) => { try { chrome.runtime.sendMessage(m, (r) => { void chrome.runtime.lastError; res(r || {}); }); } catch (_) { res({}); } });
  let cfg = {};
  send({ type: 'config' }).then((c) => { cfg = c || {}; youtube(); });

  /* ---------- Hinweis unten (Shadow-DOM, damit die Seite nichts verändert) ---------- */
  const host = document.createElement('lichtung-toast');
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `<style>.t{position:fixed;left:50%;bottom:6vh;transform:translate(-50%,300%);opacity:0;z-index:2147483647;padding:1.4vh 2.6vh;border-radius:999px;background:rgba(14,17,16,.88);border:1px solid rgba(239,233,223,.14);color:#efe9df;font:1.8vh ui-monospace,monospace;transition:transform .35s,opacity .3s}.t.s{transform:translate(-50%,0);opacity:1}</style><div class="t"></div>`;
  let tT;
  const toast = (msg) => {
    if (!host.isConnected) (document.body || document.documentElement).appendChild(host);
    const t = root.querySelector('.t'); t.textContent = msg; t.classList.add('s');
    clearTimeout(tT); tT = setTimeout(() => t.classList.remove('s'), 3000);
  };

  /* ---------- Videos ---------- */
  const videos = () => Array.from(document.querySelectorAll('video'));
  function mainVideo() {
    let best = null, area = 0;
    for (const v of videos()) {
      const r = v.getBoundingClientRect(), a = r.width * r.height;
      if (a > area && v.duration) { best = v; area = a; }
    }
    return best;
  }
  const playing = () => videos().some((v) => !v.paused && !v.ended && v.readyState > 2);

  function meta() {
    const ms = navigator.mediaSession && navigator.mediaSession.metadata;
    let title = ms && ms.title ? ms.title : document.title;
    title = title.replace(/\s*[-|–]\s*(YouTube|ARD Mediathek|ZDFmediathek|ZDF|arte|Netflix|Prime Video|Disney\+|Twitch).*$/i, '').trim();
    let image = '';
    if (ms && ms.artwork && ms.artwork.length) image = ms.artwork[ms.artwork.length - 1].src;
    if (!image) image = document.querySelector('meta[property="og:image"]')?.content || '';
    return { title: title || location.hostname, image };
  }

  let lastReport = 0, lastPlaying = null, lastActivity = 0;
  setInterval(() => {
    const p = playing();
    if (p !== lastPlaying || Date.now() - lastActivity > 30000) {
      send({ type: 'activity', data: { playing: p, source: 'brave' } });
      lastPlaying = p; lastActivity = Date.now();
    }
    const v = mainVideo();
    if (!v || v.paused || !isFinite(v.duration) || v.duration < 120) return;
    if (Date.now() - lastReport < 10000) return;
    lastReport = Date.now();
    const m = meta();
    send({ type: 'progress', data: { url: location.href, title: m.title, image: m.image, site: location.hostname, time: v.currentTime, duration: v.duration } });
  }, 3000);

  // Fortsetzen an der gemerkten Stelle
  let resumeFor = null;
  async function checkResume() {
    if (resumeFor === location.href) return;
    resumeFor = location.href;
    if (/[?&#]t=\d/.test(location.href)) return;   // Link hat schon eine Startzeit
    const saved = await send({ type: 'lookup', url: location.href });
    if (!saved || !saved.time || saved.time < 30) return;
    let tries = 0;
    const iv = setInterval(() => {
      const v = mainVideo();
      if (v && isFinite(v.duration)) {
        clearInterval(iv);
        if (Math.abs(v.duration - saved.duration) > 8) return;
        if (v.currentTime < saved.time - 15) {
          v.currentTime = saved.time - 3;
          toast(`Fortgesetzt bei ${Math.floor(saved.time / 60)}:${String(Math.floor(saved.time % 60)).padStart(2, '0')}`);
        }
      } else if (++tries > 40) clearInterval(iv);
    }, 500);
  }
  document.addEventListener('play', checkResume, true);
  let lastUrl = location.href;
  setInterval(() => { if (location.href !== lastUrl) { lastUrl = location.href; resumeFor = null; youtube(); } }, 1000);

  /* ---------- Gleiche Lautstärke (Kompressor) ---------- */
  const done = new WeakSet();
  let actx = null;
  function normalize(v) {
    if (!cfg.normalize || done.has(v)) return;
    // Nur bei "blob:"-Videos (Streaming wie YouTube): bei fremden Dateien würde
    // der Browser den Ton aus Sicherheitsgründen stumm schalten.
    if (!String(v.currentSrc || v.src).startsWith('blob:')) return;
    try {
      actx = actx || new AudioContext();
      const src = actx.createMediaElementSource(v);
      const comp = actx.createDynamicsCompressor();
      comp.threshold.value = -24; comp.knee.value = 24; comp.ratio.value = 4; comp.attack.value = 0.01; comp.release.value = 0.3;
      const gain = actx.createGain(); gain.gain.value = 1.35;
      src.connect(comp).connect(gain).connect(actx.destination);
      done.add(v);
      if (actx.state === 'suspended') v.addEventListener('play', () => actx.resume(), { once: false });
    } catch (_) { done.add(v); }
  }
  document.addEventListener('playing', (e) => { if (e.target instanceof HTMLVideoElement) normalize(e.target); }, true);

  /* ---------- YouTube ---------- */
  function youtube() {
    if (!/(^|\.)youtube\.com$/.test(location.hostname)) return;
    document.documentElement.classList.toggle('lichtung-kino', !!cfg.ytCinema);
    // Einstellungen an das Seiten-Skript (youtube-main.js) weitergeben
    window.postMessage({ lichtung: 'yt-config', quality: cfg.ytQuality || 'hd1080', cinema: !!cfg.ytCinema }, location.origin);
  }
})();
