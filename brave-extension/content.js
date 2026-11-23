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
  // Zählt nur, was man wirklich schaut: hörbar und groß genug. Stumme Vorschau-Videos
  // (YouTube spielt auf der Startseite kleine Clips ab) blockieren sonst den Bildschirmschoner.
  const watched = (v) => {
    if (v.paused || v.ended || v.readyState <= 2 || v.muted || v.volume === 0) return false;
    const r = v.getBoundingClientRect();
    return r.width * r.height > innerWidth * innerHeight * 0.06 || document.pictureInPictureElement === v;
  };
  const playing = () => videos().some(watched);

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

  /* ---------- Zurück-Taste, Startseite, Mini-Fenster ----------
   * Im Kino-Fenster (ohne Adressleiste) gibt es keinen Zurück-Knopf. Darum:
   *   Zurück-Taste der Fernbedienung (Esc), Browser-Zurück, Rücktaste → eine Seite zurück;
   *   ist man schon auf der ersten Seite → zurück zur Lichtung-Startseite.
   *   Zurück GEDRÜCKT HALTEN bei einem YouTube-Video → Mini-Fenster auf der Startseite.
   * Dazu eine kleine Leiste oben links (erscheint bei Maus/Tasten, verschwindet wieder). */
  const isYT = /(^|\.)youtube\.com$/.test(location.hostname);
  const appWindow = matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches;
  const ytId = () => {
    const u = new URL(location.href);
    return u.searchParams.get('v') || (u.pathname.match(/^\/(?:shorts|live)\/([\w-]{6,})/) || [])[1] || '';
  };
  const typingNow = () => {
    const a = document.activeElement;
    return !!a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName));
  };
  // Ist WIRKLICH ein Menü/Dialog sichtbar? (YouTube hält viele versteckte Menüs dauerhaft im Code –
  // nur die zählen, die gerade sichtbar auf dem Bildschirm sind)
  const shown = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.05;
  };
  const popupOpen = () => [...document.querySelectorAll('tp-yt-iron-dropdown, tp-yt-paper-dialog, dialog[open], [role="dialog"], [role="listbox"]')].some(shown);

  function goBack() {
    if (history.length > 1 && sessionStorage.getItem('lichtungStart') !== location.href) history.back();
    else send({ type: 'home' });
  }
  function goMini() {
    const id = ytId(), v = mainVideo();
    if (!isYT || !id) { toast('Mini-Fenster geht bei YouTube-Videos'); return; }
    const time = v ? v.currentTime : 0;
    if (v) v.pause();
    send({ type: 'mini', data: { action: 'open', yt: id, time, title: meta().title } });
  }
  if (!sessionStorage.getItem('lichtungStart')) sessionStorage.setItem('lichtungStart', location.href);

  let holdT = null, held = false;
  addEventListener('keydown', (e) => {
    const k = e.key;
    const isBack = k === 'Escape' || k === 'BrowserBack' || k === 'GoBack' || (k === 'Backspace' && !typingNow());
    if (!isBack || document.fullscreenElement) return;
    if (k === 'Escape' && popupOpen()) return;                    // erst Menüs schließen lassen
    if (k === 'Escape' && typingNow()) {                          // im Suchfeld: nur raus aus dem Feld
      e.preventDefault(); e.stopImmediatePropagation(); document.activeElement.blur(); return;
    }
    e.preventDefault(); e.stopImmediatePropagation();
    bar.show();
    if (e.repeat) return;
    held = false;
    clearTimeout(holdT);
    holdT = setTimeout(() => { holdT = null; held = true; if (isYT && ytId()) goMini(); }, 650);
  }, true);
  addEventListener('mouseup', (e) => { if (e.button === 3) { e.preventDefault(); goBack(); } }, true);
  addEventListener('keyup', (e) => {
    const k = e.key;
    if (!(k === 'Escape' || k === 'BrowserBack' || k === 'GoBack' || k === 'Backspace')) return;
    if (holdT) { clearTimeout(holdT); holdT = null; if (!held) goBack(); e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);

  // Leiste oben links
  const bar = (() => {
    const hostEl = document.createElement('lichtung-bar');
    const r = hostEl.attachShadow({ mode: 'closed' });
    r.innerHTML = `<style>
      .b{position:fixed;left:2.4vh;top:2.4vh;z-index:2147483647;display:flex;gap:1vh;opacity:0;transform:translateY(-140%);transition:opacity .25s,transform .35s cubic-bezier(.2,.8,.2,1);pointer-events:none}
      .b.s{opacity:1;transform:none;pointer-events:auto}
      button{all:unset;cursor:pointer;display:flex;align-items:center;gap:.9vh;padding:1.2vh 2vh;border-radius:999px;background:rgba(10,12,11,.82);backdrop-filter:blur(14px);border:1px solid rgba(239,233,223,.16);color:#efe9df;font:600 1.8vh system-ui,sans-serif;box-shadow:0 1vh 3vh rgba(0,0,0,.35)}
      button:hover,button:focus-visible{background:rgba(239,233,223,.92);color:#0b0d0c}
      svg{width:2.2vh;height:2.2vh;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
      .h{align-self:center;color:rgba(239,233,223,.6);font:1.5vh system-ui,sans-serif;text-shadow:0 1px 4px #000;margin-left:.6vh}
    </style><div class="b">
      <button class="back"><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>Zurück</button>
      <button class="home"><svg viewBox="0 0 24 24"><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/></svg>Start</button>
      <button class="mini"><svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><rect x="12" y="11" width="7" height="6" rx="1" fill="currentColor"/></svg>Mini-Fenster</button>
      <span class="h">Zurück-Taste halten = Mini-Fenster</span></div>`;
    const b = r.querySelector('.b');
    r.querySelector('.back').onclick = goBack;
    r.querySelector('.home').onclick = () => send({ type: 'home' });
    r.querySelector('.mini').onclick = goMini;
    let t;
    return {
      show() {
        if (!(isYT || appWindow)) return;
        if (!hostEl.isConnected) (document.body || document.documentElement).appendChild(hostEl);
        const mini = isYT && !!ytId();
        r.querySelector('.mini').style.display = mini ? '' : 'none';
        r.querySelector('.h').style.display = mini ? '' : 'none';
        b.classList.add('s');
        clearTimeout(t); t = setTimeout(() => b.classList.remove('s'), 3500);
      },
    };
  })();
  let lastMove = 0;
  addEventListener('mousemove', (e) => { if (e.clientY < innerHeight * 0.25 && Date.now() - lastMove > 400) { lastMove = Date.now(); bar.show(); } }, { passive: true });

  /* ---------- YouTube ---------- */
  function youtube() {
    if (!/(^|\.)youtube\.com$/.test(location.hostname)) return;
    document.documentElement.classList.toggle('lichtung-kino', !!cfg.ytCinema);
    // Einstellungen an das Seiten-Skript (youtube-main.js) weitergeben
    window.postMessage({ lichtung: 'yt-config', quality: cfg.ytQuality || 'hd1080', cinema: !!cfg.ytCinema }, location.origin);
  }
})();
