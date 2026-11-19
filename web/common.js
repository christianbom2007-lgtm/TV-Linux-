/* Lichtung TV – gemeinsame Bausteine für Startseite und Live-TV
 * --------------------------------------------------------------
 * api()        – spricht mit dem Python-Hintergrunddienst
 * events()     – empfängt Live-Ereignisse (Lautstärke, Home, ...)
 * Nav          – Fernbedienungs-Steuerung: Pfeiltasten springen zum
 *                räumlich nächsten Element (wie bei echten TV-Oberflächen)
 * Clock/Weather-Helfer, Lautstärke-Anzeige, Hinweis-Toasts
 */
'use strict';

const L = window.L = {};

/* ---------- Server-Kommunikation ---------- */
L.api = async function (path, method = 'GET', body) {
  const opt = { method, headers: {} };
  if (body !== undefined) {
    opt.headers['Content-Type'] = 'application/json';
    opt.body = JSON.stringify(body);
  }
  const r = await fetch(path, opt);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || ('Fehler ' + r.status));
  return data;
};

L.events = function (handler) {
  // EventSource verbindet sich bei Abbruch automatisch neu
  const es = new EventSource('/api/events');
  es.onmessage = (e) => { try { handler(JSON.parse(e.data)); } catch (_) {} };
  return es;
};

/* ---------- kleine DOM-Helfer ---------- */
L.$ = (sel, root = document) => root.querySelector(sel);
L.$$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
L.h = function (tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  return el;
};
L.esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- Uhrzeit & Datum ---------- */
L.pad = (n) => String(n).padStart(2, '0');
L.timeStr = (d = new Date()) => L.pad(d.getHours()) + ':' + L.pad(d.getMinutes());
L.dateStr = (d = new Date()) => d.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
L.greeting = (d = new Date()) => {
  const h = d.getHours();
  if (h < 5) return 'Gute Nacht.';
  if (h < 11) return 'Guten Morgen.';
  if (h < 14) return 'Hallo.';
  if (h < 18) return 'Guten Tag.';
  if (h < 22) return 'Guten Abend.';
  return 'Gute Nacht.';
};
L.fmtDur = (s) => {
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h} Std. ${m} Min.` : `${m} Min.`;
};

/* ---------- Wetter: Codes von Open-Meteo → Text und Strich-Symbol ---------- */
L.weatherText = function (code) {
  if (code === 0) return 'Klar';
  if (code === 1) return 'Überwiegend klar';
  if (code === 2) return 'Teils bewölkt';
  if (code === 3) return 'Bedeckt';
  if (code === 45 || code === 48) return 'Nebel';
  if (code >= 51 && code <= 57) return 'Nieselregen';
  if (code >= 61 && code <= 67) return 'Regen';
  if (code >= 71 && code <= 77) return 'Schnee';
  if (code >= 80 && code <= 82) return 'Schauer';
  if (code >= 85 && code <= 86) return 'Schneeschauer';
  if (code >= 95) return 'Gewitter';
  return '–';
};
L.weatherIcon = function (code, isDay = 1) {
  // Minimalistische Linien-Icons, passend zum Lichtung-Stil
  const s = 'fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"';
  const cloud = '<path d="M7 18h10a4 4 0 0 0 .4-8 6 6 0 0 0-11.6 1.5A3.3 3.3 0 0 0 7 18z"/>';
  let inner;
  if (code === 0 || code === 1) inner = isDay
    ? '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'
    : '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>';
  else if (code === 2 || code === 3) inner = cloud;
  else if (code === 45 || code === 48) inner = '<path d="M4 9h16M3 13h18M5 17h14"/>';
  else if ((code >= 71 && code <= 77) || code === 85 || code === 86) inner = cloud.replace('18h10', '15h10').replace('M7 18', 'M7 15').replace('7 18z', '7 15z') + '<path d="M9 19h.01M12 21h.01M15 19h.01"/>';
  else if (code >= 95) inner = cloud.replace(/18/g, '15') + '<path d="M12 16l-2 4h4l-2 3"/>';
  else inner = cloud.replace(/18/g, '15') + '<path d="M9 18l-1 3M13 18l-1 3M17 18l-1 3"/>';
  return `<svg viewBox="0 0 24 24" ${s}>${inner}</svg>`;
};

/* ---------- Lautstärke-Anzeige (OSD) ---------- */
L.showVolume = function (v) {
  let el = L.$('#vol-osd');
  if (!el) {
    el = L.h('div', { id: 'vol-osd' },
      L.h('div', { class: 'vol-num' }),
      L.h('div', { class: 'vol-track' }, L.h('div', { class: 'vol-fill' })),
      L.h('div', { class: 'vol-label' }));
    document.body.appendChild(el);
  }
  L.$('.vol-num', el).textContent = v.muted ? '—' : v.volume;
  L.$('.vol-fill', el).style.height = (v.muted ? 0 : Math.min(100, v.volume)) + '%';
  L.$('.vol-label', el).textContent = v.muted ? 'STUMM' : 'LAUTSTÄRKE';
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 1800);
};

/* ---------- kurze Hinweise unten ---------- */
L.toast = function (msg, ms = 2600) {
  let el = L.$('#toast');
  if (!el) { el = L.h('div', { id: 'toast' }); document.body.appendChild(el); }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), ms);
};

/* ---------- Fernbedienungs-Navigation ----------
 * Jedes bedienbare Element bekommt das Attribut data-nav.
 * Nav.scope ist der aktuell aktive Bereich (Seite oder Dialog) –
 * so springt der Fokus nie "hinter" einen offenen Dialog.
 */
L.Nav = {
  scope: document,
  current: null,

  items() {
    return L.$$('[data-nav]', this.scope).filter((el) => {
      if (el.disabled || el.closest('[hidden]')) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
  },

  focus(el, opts = {}) {
    if (!el) return;
    if (this.current && this.current !== el) this.current.classList.remove('focused');
    this.current = el;
    el.classList.add('focused');
    if (el.matches('input, textarea, select')) el.focus({ preventScroll: true });
    else { if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur(); el.focus?.({ preventScroll: true }); }
    if (!opts.noScroll) el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: opts.instant ? 'auto' : 'smooth' });
    el.dispatchEvent(new CustomEvent('navfocus', { bubbles: true }));
  },

  first() {
    const list = this.items();
    const pref = list.find((e) => e.hasAttribute('data-nav-default')) || list[0];
    this.focus(pref, { instant: true });
  },

  ensure() {
    if (!this.current || !this.scope.contains(this.current) || !this.items().includes(this.current)) this.first();
  },

  move(dir) {
    this.ensure();
    const cur = this.current;
    if (!cur) return;
    const a = cur.getBoundingClientRect();
    const ax = a.left + a.width / 2, ay = a.top + a.height / 2;
    let best = null, bestScore = Infinity;
    // Erst Elemente in derselben Gruppe (z. B. gleiche Kachelreihe) bevorzugen
    for (const el of this.items()) {
      if (el === cur) continue;
      const b = el.getBoundingClientRect();
      const bx = b.left + b.width / 2, by = b.top + b.height / 2;
      const dx = bx - ax, dy = by - ay;
      let primary, secondary;
      if (dir === 'left') { if (b.right > a.left + 4 && dx >= -4) continue; primary = -dx; secondary = Math.abs(dy); }
      if (dir === 'right') { if (b.left < a.right - 4 && dx <= 4) continue; primary = dx; secondary = Math.abs(dy); }
      if (dir === 'up') { if (b.bottom > a.top + 4 && dy >= -4) continue; primary = -dy; secondary = Math.abs(dx); }
      if (dir === 'down') { if (b.top < a.bottom - 4 && dy <= 4) continue; primary = dy; secondary = Math.abs(dx); }
      if (primary <= 0) continue;
      // Waagerecht: gleiche Zeile stark bevorzugen; senkrecht: Spalte weniger streng
      const score = (dir === 'left' || dir === 'right') ? primary + secondary * 3 : primary + secondary * 0.6;
      if (score < bestScore) { bestScore = score; best = el; }
    }
    if (best) this.focus(best);
    return !!best;
  },

  activate() {
    this.ensure();
    const el = this.current;
    if (!el) return;
    if (el.matches('input[type=checkbox]')) { el.checked = !el.checked; el.dispatchEvent(new Event('change', { bubbles: true })); return; }
    if (el.matches('input, textarea')) return; // Eingabefeld: einfach tippen
    el.click();
  },
};

/* Tastencodes vereinheitlichen – Fernbedienungen senden teils exotische Namen */
L.keyName = function (e) {
  const k = e.key;
  if (k === 'ArrowUp' || k === 'Up') return 'up';
  if (k === 'ArrowDown' || k === 'Down') return 'down';
  if (k === 'ArrowLeft' || k === 'Left') return 'left';
  if (k === 'ArrowRight' || k === 'Right') return 'right';
  if (k === 'Enter' || k === 'Select' || k === 'Accept') return 'ok';
  if (k === 'Escape' || k === 'BrowserBack' || k === 'GoBack') return 'back';
  if (k === 'Backspace') return 'backspace';
  if (k === 'ContextMenu' || k === 'Menu' || k === 'F10') return 'menu';
  if (k === 'BrowserHome' || k === 'F1' || k === 'Home' && e.altKey) return 'home';
  if (k === 'PageUp' || k === 'ChannelUp') return 'chup';
  if (k === 'PageDown' || k === 'ChannelDown') return 'chdown';
  if (k === 'MediaPlayPause' || k === ' ' ) return 'play';
  if (/^[0-9]$/.test(k)) return 'num' + k;
  return k;
};

L.isTyping = () => {
  const a = document.activeElement;
  return a && (a.matches('input[type=text], input[type=url], input[type=search], input[type=password], input:not([type]), textarea'));
};
