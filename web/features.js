/* Lichtung TV – Mediathek-Reihen, Suche, Schlaf-Timer, Links vom Handy
 * Ergänzt app.js (nutzt dessen S, h, api, Nav, openModal, menu …).
 */
'use strict';

const MEDIA = { rows: [], loaded: 0, loading: false };

/* ---------- Hilfen ---------- */
function fmtWhen(ts) {
  const d = new Date(ts * 1000), now = new Date();
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((today - day) / 864e5);
  const hm = L.timeStr(d);
  if (diff === 0) return 'heute ' + hm;
  if (diff === 1) return 'gestern ' + hm;
  if (diff < 7) return d.toLocaleDateString('de-DE', { weekday: 'short' }) + ' ' + hm;
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
}
const fmtMin = (s) => (s >= 3600 ? `${Math.floor(s / 3600)} Std. ${Math.round((s % 3600) / 60)} Min.` : `${Math.round(s / 60)} Min.`);
const channelName = (c) => ({ 'ARTE.DE': 'arte', 'ARTE.FR': 'arte', '3Sat': '3sat', 'PHOENIX': 'phoenix', 'KiKA': 'KiKA' }[c] || c);

function playUrl(it) {
  const q = new URLSearchParams({ src: it.url, title: it.title, sub: `${channelName(it.channel)} · ${it.topic}`, key: it.website || it.url, dur: it.duration || 0 });
  if (it.urlSd && it.urlSd !== it.url) q.set('sd', it.urlSd);
  return '/play.html?' + q.toString();
}

function mediaCard(it) {
  const el = h('button', { class: 'tile mk', 'data-nav': true, 'data-kind': 'media' },
    h('div', { class: 'art gen', style: { background: `linear-gradient(135deg, hsl(${it.hue} 30% 24%), hsl(${(it.hue + 30) % 360} 26% 10%))` } }),
    h('div', { class: 'wm' }, channelName(it.channel)),
    h('div', { class: 'shade' }),
    h('div', { class: 'num' }, `${channelName(it.channel).toUpperCase()} · ${fmtWhen(it.timestamp).toUpperCase()}`),
    h('div', { class: 'dur' }, fmtMin(it.duration)),
    h('div', { class: 'name' }, h('b', {}, it.title), h('span', {}, it.topic)));
  el.addEventListener('click', () => { launching(it.title); setTimeout(() => (location.href = playUrl(it)), 200); });
  el.addEventListener('navfocus', () => setHero(`${channelName(it.channel)} · ${it.topic} · ${fmtWhen(it.timestamp)} · ${fmtMin(it.duration)}`, it.title, it.description || ''));
  el.addEventListener('contextmenu', (e) => { e.preventDefault(); mediaMenu(it); });
  el._media = it;
  return el;
}

function mediaMenu(it) {
  menu(it.title, `${channelName(it.channel)} · ${it.topic}`, [
    { label: 'Abspielen', key: '↵', run: () => (location.href = playUrl(it)) },
    { label: 'Auf der Website öffnen', run: () => it.website && (location.href = it.website) },
    { label: `Mehr von „${it.topic.slice(0, 28)}“`, run: () => openSearch(it.topic) },
  ]);
}

/* ---------- Reihen auf der Startseite ---------- */
function renderMedia() {
  const box = $('#media-blocks');
  if (!box) return;
  if (S.state.general.mediathekOn === false) { box.innerHTML = ''; return; }
  const rows = (S.state.mediathekRows || []).filter((r) => r.on !== false);
  // Fokus merken, falls er in einer Mediathek-Reihe liegt
  const keep = Nav.current && box.contains(Nav.current) ? { row: Nav.current.closest('.block')?.dataset.row, idx: [...Nav.current.parentNode.children].indexOf(Nav.current) } : null;
  box.innerHTML = '';
  rows.forEach((r, ri) => {
    const data = MEDIA.rows.find((x) => x.id === r.id);
    const row = h('div', { class: 'row' });
    if (ri === 0) {
      const sb = h('button', { class: 'tile mk search', 'data-nav': true },
        h('div', {}, h('span', { html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>' }), h('span', {}, 'Mediathek durchsuchen')));
      sb.addEventListener('click', () => openSearch(''));
      sb.addEventListener('navfocus', () => setHero('Mediathek', 'Suchen', 'Alle Sendungen von ARD, ZDF, arte, 3sat, NDR und vielen mehr. Tippen per Tastatur oder Handy.'));
      row.append(sb);
    }
    if (!data) for (let i = 0; i < 5; i++) row.append(h('div', { class: 'tile mk skeleton' }));
    else if (!data.items.length) row.append(h('div', { class: 'media-empty' }, 'Gerade nichts gefunden – Internet weg oder Mediathek nicht erreichbar.'));
    else data.items.forEach((it) => row.append(mediaCard(it)));
    box.append(h('div', { class: 'block', 'data-row': r.id }, h('div', { class: 'row-label' }, r.title), row));
  });
  if (keep && !(Nav.current && document.contains(Nav.current))) {
    const b = box.querySelector(`.block[data-row="${keep.row}"] .row`);
    const el = b && (b.children[keep.idx] || b.lastElementChild);
    if (el && el.hasAttribute('data-nav')) Nav.focus(el, { instant: true, noScroll: true });
  }
}

async function loadMedia(force) {
  if (S.state?.general.mediathekOn === false || MEDIA.loading) return;
  if (!force && Date.now() - MEDIA.loaded < 15 * 60 * 1000 && MEDIA.rows.length) return renderMedia();
  MEDIA.loading = true;
  renderMedia();
  try {
    const r = await api('/api/mediathek');
    MEDIA.rows = r.rows;
    MEDIA.loaded = Date.now();
    sessionStorage.setItem('lichtung-media', JSON.stringify({ t: MEDIA.loaded, rows: MEDIA.rows }));
  } catch (_) {}
  MEDIA.loading = false;
  renderMedia();
}

/* ---------- Suche ---------- */
function openSearch(initial) {
  const input = h('input', { class: 'inp', 'data-nav': true, placeholder: 'z. B. Tatort, Terra X, Doku Nordsee …', value: initial || '' });
  const grid = h('div', { class: 'search-grid' });
  const info = h('div', { class: 'lead', style: { margin: 'calc(1.4*var(--u)) 0 0' } }, initial ? '' : 'Suchbegriff eingeben und Enter drücken – oder am Handy unter „Tippen“.');
  let timer;
  const run = async () => {
    const q = input.value.trim();
    if (q.length < 2 || q === grid.dataset.q) return;
    grid.dataset.q = q;
    info.textContent = 'Suche …';
    grid.innerHTML = '';
    try {
      const r = await api('/api/mediathek/search?q=' + encodeURIComponent(q));
      info.textContent = r.items.length ? `${r.items.length} Treffer für „${q}“` : `Nichts gefunden für „${q}“`;
      r.items.forEach((it) => { const c = mediaCard(it); c.addEventListener('navfocus', () => {}); grid.append(c); });
    } catch (_) { info.textContent = 'Mediathek gerade nicht erreichbar.'; }
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(timer); run().then(() => { const f = grid.querySelector('[data-nav]'); if (f) Nav.focus(f); }); } });
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 700); });
  openModal([h('h3', {}, 'Mediathek durchsuchen'), input, info, grid], 'search-modal');
  setTimeout(() => Nav.focus(input, { instant: true }), 40);
  if (initial) run();
}

/* ---------- Schlaf-Timer ---------- */
function renderSleep() {
  const sl = S.state?.sleep || {};
  const btn = $('#btn-sleep');
  if (!btn) return;
  btn.classList.toggle('on', !!sl.active);
  $('#sleep-left').textContent = sl.active ? Math.ceil(sl.left / 60) + ' Min.' : '';
}
setInterval(() => {
  const sl = S.state?.sleep;
  if (sl && sl.active) { sl.left = Math.max(0, sl.left - 15); renderSleep(); }
}, 15000);

function sleepMenu() {
  const sl = S.state.sleep || {};
  const set = (minutes, action) => api('/api/sleep', 'POST', { minutes, action }).then((r) => { S.state.sleep = r; renderSleep(); L.toast(`Schlaf-Timer: ${minutes} Min. – ${({ pause: 'dann pausieren', screen: 'dann Bildschirm aus', poweroff: 'dann ausschalten' })[action]}`); });
  const action = localStorage.getItem('lichtung-sleep-action') || 'screen';
  const items = [15, 30, 45, 60, 90, 120].map((m) => ({ label: `${m} Minuten`, key: m === 30 ? 'häufig' : '', run: () => set(m, action) }));
  items.push({ label: `Danach: ${({ pause: 'Pausieren', screen: 'Bildschirm aus', poweroff: 'Laptop ausschalten' })[action]}`, key: 'ändern', run: () => {
    const next = { pause: 'screen', screen: 'poweroff', poweroff: 'pause' }[action];
    localStorage.setItem('lichtung-sleep-action', next); setTimeout(sleepMenu, 50);
  } });
  if (sl.active) items.unshift({ label: 'Timer beenden', key: `noch ${Math.ceil(sl.left / 60)} Min.`, danger: true, run: () => api('/api/sleep', 'POST', { cancel: true }).then((r) => { S.state.sleep = r; renderSleep(); L.toast('Schlaf-Timer aus'); }) });
  menu('Schlaf-Timer', 'Danach wird alles pausiert', items);
}

function sleepWarn(seconds) {
  let el = $('.sleep-warn');
  if (!el) { el = h('div', { class: 'sleep-warn' }); document.body.append(el); }
  el.innerHTML = '';
  el.append(h('b', {}, `Noch ${seconds} Sekunden`), h('span', {}, 'Schlaf-Timer · beliebige Taste = 15 Minuten länger'));
  el.classList.add('show');
  const extend = () => {
    el.classList.remove('show');
    removeEventListener('keydown', extend, true);
    api('/api/sleep', 'POST', { minutes: 15, action: S.state.sleep?.action || localStorage.getItem('lichtung-sleep-action') || 'screen' }).then((r) => { S.state.sleep = r; renderSleep(); L.toast('15 Minuten verlängert'); });
  };
  addEventListener('keydown', extend, true);
  setTimeout(() => { el.classList.remove('show'); removeEventListener('keydown', extend, true); }, seconds * 1000);
}

function goodnight(on) {
  let el = $('#goodnight');
  if (!el) { el = h('div', { id: 'goodnight' }, h('div', {}, 'Gute Nacht.')); document.body.append(el); }
  el.classList.toggle('show', on);
}

/* ---------- Ereignisse ---------- */
L.events((ev) => {
  if (ev.type === 'sleepinfo') { S.state.sleep = ev; renderSleep(); }
  else if (ev.type === 'sleepwarn') sleepWarn(ev.seconds);
  else if (ev.type === 'sleep') { if (S.state) S.state.sleep = { active: false }; renderSleep(); goodnight(true); }
  else if (ev.type === 'screen' && ev.on) goodnight(false);
  else if (ev.type === 'open') { launching(ev.label || 'Link'); setTimeout(() => (location.href = ev.url), 300); }
});
addEventListener('keydown', () => { if ($('#goodnight')?.classList.contains('show')) goodnight(false); }, true);

/* ---------- Taste T + Knopf ---------- */
addEventListener('keydown', (e) => {
  if ((e.key === 't' || e.key === 'T') && !L.isTyping() && !S.modals.length && S.view === 'home') { e.preventDefault(); sleepMenu(); }
});
document.addEventListener('navfocus', (e) => {
  if (e.target.id === 'btn-sleep') {
    const sl = S.state.sleep || {};
    setHero('Schlaf-Timer', sl.active ? `Noch ${Math.ceil(sl.left / 60)} Minuten` : 'Schlaf-Timer', 'Nach Ablauf wird pausiert und der Bildschirm ausgeschaltet – oder der Laptop ganz aus.');
  }
});

/* Wird von app.js nach jedem Neuaufbau der Startseite aufgerufen */
window.afterRenderHome = function () {
  $('#btn-sleep').onclick = sleepMenu;
  renderSleep();
  if (!MEDIA.rows.length) {
    try { const c = JSON.parse(sessionStorage.getItem('lichtung-media') || 'null'); if (c && Date.now() - c.t < 15 * 60000) { MEDIA.rows = c.rows; MEDIA.loaded = c.t; } } catch (_) {}
  }
  renderMedia();
  loadMedia();
};
setInterval(() => loadMedia(true), 30 * 60 * 1000);
