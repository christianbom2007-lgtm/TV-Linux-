/* Lichtung TV – Startoberfläche
 * ------------------------------------------------------------
 * Aufbau:
 *   1. Zustand laden & Aussehen anwenden
 *   2. Profilauswahl (mit PIN und Auto-Start)
 *   3. Startseite: Uhr, Wetter, Weiterschauen, Kacheln, Info-Bereich
 *   4. Dialoge: Optionen, Kachel-Editor, PIN-Eingabe
 *   5. Einstellungen (alle Bereiche)
 *   6. Bildschirmschoner
 *   7. Tastatur, Maus und Live-Ereignisse
 */
'use strict';
const { $, $$, h, api, Nav } = L;

const S = {
  state: null,       // alles vom Server: Profile, Kacheln, Einstellungen ...
  weather: null,
  view: null,        // 'profiles' | 'home' | 'settings'
  modals: [],        // offene Dialoge (oberster zuletzt)
  section: 'tiles',  // gewählter Bereich in den Einstellungen
  lastFocus: {},     // merkt sich den Fokus je Ansicht
  saverOn: false,
  localIdle: Date.now(),
};

/* Vorlagen für neue Kacheln */
const PRESETS = [
  { title: 'YouTube', subtitle: 'TV-Ansicht, ohne Werbung', url: 'https://www.youtube.com/tv', tvMode: true, hue: 8 },
  { title: 'YouTube (normal)', subtitle: 'Klassische Ansicht', url: 'https://www.youtube.com/', tvMode: false, hue: 0 },
  { title: 'Live-TV', subtitle: 'ARD, ZDF, NDR und mehr', url: 'lichtung:live', tvMode: false, hue: 205 },
  { title: 'Handy spiegeln', subtitle: 'iPhone per AirPlay, YouTube per Code', url: 'lichtung:mirror', tvMode: false, hue: 265 },
  { title: 'ARD Mediathek', subtitle: 'Filme, Serien, Dokus', url: 'https://www.ardmediathek.de/', hue: 220 },
  { title: 'ZDF Mediathek', subtitle: 'Sendungen auf Abruf', url: 'https://www.zdf.de/', hue: 28 },
  { title: 'arte', subtitle: 'Kultur und Dokus', url: 'https://www.arte.tv/de/', hue: 18 },
  { title: '3sat', subtitle: 'Mediathek', url: 'https://www.3sat.de/', hue: 340 },
  { title: 'NDR Mediathek', subtitle: 'Aus dem Norden', url: 'https://www.ndr.de/mediathek/', hue: 200 },
  { title: 'Netflix', subtitle: 'Serien und Filme', url: 'https://www.netflix.com/browse', hue: 356 },
  { title: 'Prime Video', subtitle: 'Amazon', url: 'https://www.amazon.de/gp/video/storefront', hue: 195 },
  { title: 'Disney+', subtitle: 'Filme und Serien', url: 'https://www.disneyplus.com/', hue: 230 },
  { title: 'Joyn', subtitle: 'Live und auf Abruf', url: 'https://www.joyn.de/', hue: 280 },
  { title: 'RTL+', subtitle: 'Mediathek', url: 'https://plus.rtl.de/', hue: 10 },
  { title: 'Twitch', subtitle: 'Livestreams', url: 'https://www.twitch.tv/', hue: 265 },
  { title: 'Spotify', subtitle: 'Musik und Podcasts', url: 'https://open.spotify.com/', hue: 140 },
];
const ACCENTS = ['#c8a26b', '#d9b98c', '#8fb3a0', '#9bb5c9', '#c98f7a', '#b9a3c9', '#e0d3b8', '#a6b86f'];
const HUES = [8, 28, 48, 100, 150, 200, 225, 265, 300, 340];

/* ============================================================
 * 1. Laden & Aussehen
 * ============================================================ */
async function load() {
  S.state = await api('/api/state');
  applyLook();
}

function sceneOpts(g) {
  const photo = (g.background || '').startsWith('/');
  return { scene: photo ? 'nacht' : (g.background || 'nacht'), motion: g.motion || 'voll', weatherFx: g.weatherFx !== false, aurora: !!g.aurora };
}

function applyLook() {
  const g = S.state.general;
  document.documentElement.style.setProperty('--accent', g.accent || '#c8a26b');
  document.documentElement.style.setProperty('--dim', g.dim ?? 0.55);
  // Lebendiger Hintergrund: eine Szene, die Uhrzeit, Mond und Wetter folgt
  if (!S.scene) {
    S.scene = new L.Scene($('#bg'), sceneOpts(g));
    // Tagsüber den Hintergrund weniger abdunkeln, damit man den Tag auch sieht
    S.scene.onLight = (l) => document.documentElement.style.setProperty('--dim', Math.max(0.12, (S.state.general.dim ?? 0.55) - l * 0.32));
    S.scene.start();
  }
  S.scene.setLocation(g.lat, g.lon);
  S.scene.setPhoto((g.background || '').startsWith('/') ? g.background : null);
  S.scene.set(sceneOpts(g));
}

async function loadWeather() {
  try { S.weather = await api('/api/weather'); } catch (_) { S.weather = null; }
  renderWeather();
  if (S.weather && S.weather.current) { S.scene?.setWeather(S.weather); S.saverScene?.setWeather(S.weather); }
}

const profile = () => S.state.profiles.find((p) => p.id === S.state.active) || S.state.profiles[0];

/* ============================================================
 * Ansichten wechseln
 * ============================================================ */
function show(view) {
  if (S.view && Nav.current) S.lastFocus[S.view] = Nav.current;
  S.view = view;
  for (const v of ['profiles', 'home', 'settings', 'setup']) $('#' + v).classList.toggle('active', v === view);
  Nav.scope = $('#' + view);
  const remembered = S.lastFocus[view];
  if (remembered && document.contains(remembered)) Nav.focus(remembered, { instant: true });
  else Nav.first();
}

/* ============================================================
 * 2. Profilauswahl
 * ============================================================ */
const LOCK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';

function avatar(p, cls = 'av') {
  return h('div', { class: cls, style: { background: p.color } }, (p.name || '?').trim().charAt(0).toUpperCase(),
    p.hasPin ? h('span', { class: 'lock', html: LOCK_SVG }) : null);
}

function renderProfiles(auto) {
  const root = $('#profiles');
  root.innerHTML = '';
  const def = S.state.profiles.find((p) => p.isDefault && !p.hasPin);
  root.append(
    h('h2', {}, 'Wer schaut?'),
    h('div', { class: 'sub' }, L.dateStr()),
    h('div', { class: 'plist' }, S.state.profiles.map((p) =>
      h('button', { class: 'pcard', 'data-nav': true, 'data-nav-default': p.isDefault || null, onclick: () => chooseProfile(p) },
        avatar(p), h('div', { class: 'pn' }, p.name)))),
  );
  const secs = Number(S.state.general.profileAutoSeconds ?? 2);
  if (auto && def && secs > 0 && S.state.profiles.length > 1) {
    const bar = h('div', { class: 'auto-bar' }, h('i'));
    const hint = h('div', { class: 'auto-hint' }, `${def.name} startet automatisch · beliebige Taste zum Wählen`);
    root.append(bar, hint);
    requestAnimationFrame(() => { bar.querySelector('i').style.transitionDuration = secs + 's'; bar.classList.add('run'); });
    S.autoTimer = setTimeout(() => chooseProfile(def), secs * 1000);
    const cancel = () => {
      clearTimeout(S.autoTimer); bar.remove(); hint.remove();
      removeEventListener('keydown', cancel, true); removeEventListener('mousemove', cancel, true);
    };
    S.cancelAuto = cancel;
    addEventListener('keydown', cancel, true);
    setTimeout(() => addEventListener('mousemove', cancel, true), 400);
  }
  show('profiles');
}

async function chooseProfile(p) {
  S.cancelAuto?.();
  let pin = null;
  if (p.hasPin) {
    pin = await askPin(`PIN für ${p.name}`, async (value) => {
      try { await api('/api/profile/select', 'POST', { id: p.id, pin: value }); return true; } catch (_) { return false; }
    });
    if (pin == null) return;
  } else {
    await api('/api/profile/select', 'POST', { id: p.id });
  }
  sessionStorage.setItem('lichtung-profile', p.id);
  await load();
  renderHome();
  show('home');
}

/* ============================================================
 * 3. Startseite
 * ============================================================ */
function clockHTML(d = new Date()) {
  return `${L.pad(d.getHours())}<span class="colon">:</span>${L.pad(d.getMinutes())}`;
}

function tick() {
  const d = new Date();
  $('#clock').innerHTML = clockHTML(d);
  $('#vdate').textContent = d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
  const g = $('#greet');
  const greet = L.greeting(d);
  if (g.dataset.v !== greet + S.state?.active) {
    g.dataset.v = greet + S.state?.active;
    g.innerHTML = `${greet}<small>${L.esc(L.dateStr(d))}</small>`;
  }
  if (S.saverOn) renderSaver();
}

function renderWeather() {
  const w = S.weather, el = $('#weather');
  if (!w || !w.current) { el.innerHTML = `<span class="c">${L.esc(S.state?.general.city || '')}<br>Wetter lädt …</span>`; return; }
  const c = w.current;
  el.innerHTML = `${L.weatherIcon(c.weather_code, c.is_day)}<span class="t">${Math.round(c.temperature_2m)}°</span>
    <span class="c">${L.esc(w.city)}<br>${L.weatherText(c.weather_code)}</span>`;
}

function tileArt(t) {
  if (t.image) return h('div', { class: 'art', style: { backgroundImage: `url("${t.image}")` } });
  const hue = t.hue ?? 200;
  return h('div', { class: 'art gen', style: { background: `linear-gradient(135deg, hsl(${hue} 32% 26%), hsl(${(hue + 25) % 360} 28% 11%))` } });
}

function tileEl(t, i) {
  const el = h('button', { class: 'tile', 'data-nav': true, 'data-kind': 'tile', 'data-id': t.id },
    tileArt(t), h('div', { class: 'shade' }),
    h('div', { class: 'num' }, L.pad(i + 1)),
    t.tvMode ? h('div', { class: 'tv' }, 'TV') : null,
    h('div', { class: 'name' }, h('b', {}, t.title), h('span', {}, t.subtitle || hostOf(t.url))));
  el.addEventListener('click', () => openTile(t));
  el.addEventListener('contextmenu', (e) => { e.preventDefault(); tileMenu(t); });
  el.addEventListener('navfocus', () => setHero(L.pad(i + 1) + ' · ' + (t.url === 'lichtung:live' ? 'Live-Fernsehen' : hostOf(t.url)), t.title, t.description || t.subtitle || ''));
  return el;
}

function hostOf(url) {
  if (url === 'lichtung:live') return 'Live-TV';
  if (url === 'lichtung:mirror') return 'Spiegeln';
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch (_) { return url || ''; }
}

function setHero(kicker, title, desc) {
  $('#hero-kicker').textContent = kicker;
  $('#hero-title').textContent = title;
  $('#hero-desc').textContent = desc;
}

function focusKey(el) {
  if (!el || !document.contains(el)) return null;
  if (el.dataset.id) return { id: el.dataset.id };
  if (el.id) return { elId: el.id };
  const row = el.closest('.row');
  return row && row.id ? { row: row.id, idx: [...row.children].indexOf(el) } : null;
}
function restoreFocus(k) {
  if (!k || S.view !== 'home' || S.modals.length) return;
  if (Nav.current && document.contains(Nav.current)) return;   // Fokus ist noch gültig → nichts tun
  let el = null;
  if (k.id) el = $(`#home [data-id="${k.id}"]`);
  else if (k.elId) el = document.getElementById(k.elId);
  else if (k.row) { const r = document.getElementById(k.row); el = r && (r.children[k.idx] || r.lastElementChild); }
  if (el && el.hasAttribute('data-nav')) Nav.focus(el, { instant: true, noScroll: true });
}

function renderHome() {
  // Fokus merken, damit ein Neuaufbau (z. B. Änderung vom Handy) ihn nicht verliert
  const keep = S.view === 'home' ? focusKey(Nav.current) : null;
  const p = profile();
  $('#btn-profile').innerHTML = '';
  $('#btn-profile').append(h('span', { class: 'dot', style: { background: p.color } }, p.name.charAt(0).toUpperCase()), p.name);
  $('#btn-profile').onclick = () => renderProfiles(false);
  $('#btn-settings').onclick = () => openSettings();

  // Weiterschauen
  const cw = S.state.continue || [];
  $('#cw-block').hidden = cw.length === 0;
  const cwRow = $('#cw-row');
  cwRow.innerHTML = '';
  cw.forEach((c) => {
    const pct = c.duration ? Math.min(100, (c.time / c.duration) * 100) : 0;
    const el = h('button', { class: 'tile cw', 'data-nav': true, 'data-kind': 'cw' },
      c.image ? h('div', { class: 'art', style: { backgroundImage: `url("${c.image}")` } }) : h('div', { class: 'art gen', style: { background: 'linear-gradient(135deg,#2b3330,#111514)' } }),
      h('div', { class: 'shade' }),
      h('div', { class: 'num' }, c.site.replace(/^www\./, '').toUpperCase()),
      h('div', { class: 'name' }, h('b', {}, c.title)),
      h('div', { class: 'progress' }, h('i', { style: { width: pct + '%' } })));
    el.addEventListener('click', () => openContinue(c));
    el.addEventListener('contextmenu', (e) => { e.preventDefault(); continueMenu(c); });
    el.addEventListener('navfocus', () => setHero('Weiterschauen · noch ' + L.fmtDur(c.duration - c.time), c.title, `${c.site.replace(/^www\./, '')} · bei ${L.fmtDur(c.time)} von ${L.fmtDur(c.duration)}`));
    cwRow.appendChild(el);
  });

  // Kacheln
  const row = $('#tile-row');
  row.innerHTML = '';
  S.state.tiles.forEach((t, i) => row.appendChild(tileEl(t, i)));
  const add = h('button', { class: 'tile add', 'data-nav': true },
    h('div', { class: 'plus' }, '+', h('small', {}, 'NEUE KACHEL')));
  add.addEventListener('click', () => editTile(null));
  add.addEventListener('navfocus', () => setHero('Neu', 'Kachel hinzufügen', 'Beliebige Website, Streaming-Dienst oder Mediathek mit eigenem Bild und Text.'));
  row.appendChild(add);
  // Erste Kachel hat standardmäßig den Fokus
  row.firstElementChild?.setAttribute('data-nav-default', '');
  tick();
  renderWeather();
  window.afterRenderHome?.();
  restoreFocus(keep);
}

function launching(title) {
  $('#launch-title').textContent = title;
  $('#launching').classList.add('show');
  setTimeout(() => $('#launching').classList.remove('show'), 8000);
}

function openTile(t) {
  if (!t.url) return editTile(t);
  if (t.url === 'lichtung:mirror') return mirrorHelp();
  launching(t.title);
  const url = t.url === 'lichtung:live' ? '/live.html' : t.url;
  setTimeout(() => { location.href = url; }, 250);
}

function openContinue(c, fromStart) {
  launching(c.title);
  let url = c.url;
  if (c.player) url = '/play.html?' + new URLSearchParams({ src: c.player, title: c.title, sub: c.site, key: c.url, dur: c.duration || 0, ...(fromStart ? { start: 0 } : {}) });
  else if (c.yt) url = `https://www.youtube.com/tv#/watch?v=${c.yt}${fromStart ? '' : '&t=' + Math.floor(c.time) + 's'}`;
  // "Von vorn": Eintrag löschen, damit die Erweiterung nicht automatisch vorspult
  const go = () => { location.href = url; };
  if (fromStart) api('/api/continue?key=' + encodeURIComponent(c.key), 'DELETE').finally(() => setTimeout(go, 150));
  else setTimeout(go, 250);
}

/* Anleitung: Handy aufs TV bringen */
function mirrorHelp() {
  const name = 'Lichtung';
  const step = (n, t, d) => h('div', { class: 'mirror-step' }, h('span', { class: 'n' }, n), h('div', {}, h('b', {}, t), h('span', {}, d)));
  const yt = S.state.tiles.find((t) => t.url.includes('youtube.com/tv'));
  openModal([
    h('h3', {}, 'Handy aufs TV'),
    h('div', { class: 'lead' }, S.state.airplay ? 'AirPlay-Empfänger ist bereit' : 'AirPlay ist auf diesem Gerät nicht installiert'),
    h('div', { class: 'mirror-cols' },
      h('div', {}, h('div', { class: 'mirror-h' }, 'iPhone & iPad – ganzer Bildschirm'),
        step('1', 'Gleiches WLAN', 'iPhone und Laptop im selben Netz.'),
        step('2', 'Kontrollzentrum öffnen', 'Oben rechts nach unten wischen.'),
        step('3', 'Bildschirmsynchronisierung', `„${name}“ antippen – das Bild erscheint sofort hier.`),
        step('4', 'Beenden', 'Am iPhone „Synchronisierung beenden“. Oder Home-Taste.')),
      h('div', {}, h('div', { class: 'mirror-h' }, 'YouTube – Android & iPhone'),
        step('1', 'YouTube-Kachel öffnen', 'In der TV-Ansicht links: Einstellungen.'),
        step('2', '„Mit Smartphone verbinden“', 'Dort steht ein TV-Code.'),
        step('3', 'Code in der YouTube-App eingeben', 'App → Profil → Einstellungen → Auf Fernseher ansehen → TV-Code.'),
        step('4', 'Cast-Symbol tippen', 'Videos laufen dann auf dem TV, das Handy ist die Fernbedienung.'))),
    h('div', { class: 'lead', style: { marginTop: 'calc(2*var(--u))', textTransform: 'none', letterSpacing: '.02em' } }, 'Links schicken geht immer: Handy-Fernbedienung → Text & Link. Android-Bildschirm spiegeln (Smart View) wird unter Linux leider nicht zuverlässig unterstützt.'),
    h('div', { class: 'btns' },
      yt ? h('button', { class: 'btn primary', 'data-nav': true, onclick: () => openTile(yt) }, 'YouTube öffnen') : null,
      h('button', { class: 'btn', 'data-nav': true, onclick: () => S.modals[S.modals.length - 1].close() }, 'Schließen')),
  ]);
}

/* ============================================================
 * 4. Dialoge
 * ============================================================ */
function openModal(content, cls = '') {
  const prevScope = Nav.scope, prevFocus = Nav.current;
  const wrap = h('div', { class: 'modal-wrap' }, h('div', { class: 'modal ' + cls }, content));
  document.body.appendChild(wrap);
  requestAnimationFrame(() => wrap.classList.add('show'));
  const m = {
    wrap,
    close() {
      wrap.classList.remove('show');
      setTimeout(() => wrap.remove(), 250);
      S.modals = S.modals.filter((x) => x !== m);
      Nav.scope = prevScope;
      if (prevFocus && document.contains(prevFocus)) Nav.focus(prevFocus, { instant: true }); else Nav.first();
      m.onclose?.();
    },
  };
  S.modals.push(m);
  Nav.scope = wrap;
  setTimeout(() => { if (!wrap.contains(Nav.current)) Nav.first(); }, 20);
  return m;
}

function menu(title, lead, items) {
  const m = openModal([
    h('h3', {}, title),
    lead ? h('div', { class: 'lead' }, lead) : null,
    h('div', { class: 'menu-list' }, items.map((it) =>
      h('button', { 'data-nav': true, class: it.danger ? 'danger' : '', onclick: () => { m.close(); setTimeout(it.run, 30); } },
        h('span', {}, it.label), it.key ? h('span', { class: 'k' }, it.key) : null))),
  ], 'small');
  return m;
}

function tileMenu(t) {
  const tiles = S.state.tiles, i = tiles.findIndex((x) => x.id === t.id);
  menu(t.title, hostOf(t.url), [
    { label: 'Öffnen', key: '↵', run: () => openTile(t) },
    { label: 'Bearbeiten', run: () => editTile(t) },
    { label: 'Nach links verschieben', run: () => moveTile(t.id, -1), key: i > 0 ? '←' : '' },
    { label: 'Nach rechts verschieben', run: () => moveTile(t.id, +1), key: i < tiles.length - 1 ? '→' : '' },
    { label: 'Löschen', danger: true, run: () => confirmBox(`„${t.title}“ löschen?`, async () => { await api('/api/tiles/' + t.id, 'DELETE'); await refresh(); }) },
  ]);
}

function continueMenu(c) {
  menu(c.title, c.site, [
    { label: 'Fortsetzen', key: L.fmtDur(c.time), run: () => openContinue(c) },
    { label: 'Von vorn beginnen', run: () => openContinue(c, true) },
    { label: 'Aus der Liste entfernen', danger: true, run: async () => { await api('/api/continue?key=' + encodeURIComponent(c.key), 'DELETE'); await refresh(); } },
  ]);
}

async function moveTile(id, dir) {
  const ids = S.state.tiles.map((t) => t.id);
  const i = ids.indexOf(id), j = i + dir;
  if (j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  await api('/api/tiles/order', 'POST', { ids });
  await refresh();
  const el = $(`.tile[data-id="${id}"]`);
  if (el) Nav.focus(el);
}

function confirmBox(text, onYes) {
  const m = openModal([
    h('h3', {}, text),
    h('div', { class: 'btns' },
      h('button', { class: 'btn danger', 'data-nav': true, onclick: async () => { m.close(); await onYes(); } }, 'Ja'),
      h('button', { class: 'btn', 'data-nav': true, 'data-nav-default': true, onclick: () => m.close() }, 'Abbrechen')),
  ], 'small');
}

/* PIN-Eingabe: Zifferntasten der Tastatur ODER Tastenfeld auf dem Bildschirm.
 * check(value) → true/false; bei 4 Ziffern wird automatisch geprüft. */
function askPin(title, check) {
  return new Promise((resolve) => {
    let value = '';
    const dots = h('div', { class: 'pin-dots' }, [0, 1, 2, 3].map(() => h('i')));
    const paint = () => $$('i', dots).forEach((d, i) => d.classList.toggle('on', i < value.length));
    const press = async (d) => {
      if (d === 'del') { value = value.slice(0, -1); paint(); return; }
      if (value.length >= 4) return;
      value += d; paint();
      if (value.length === 4) {
        const ok = check ? await check(value) : true;
        if (ok) { done = true; m.close(); resolve(value); }
        else { dots.classList.remove('err'); void dots.offsetWidth; dots.classList.add('err'); value = ''; setTimeout(paint, 300); }
      }
    };
    let done = false;
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'ok'];
    const pad = h('div', { class: 'pinpad' }, keys.map((k) =>
      h('button', { 'data-nav': true, 'data-nav-default': k === '5' || null, onclick: () => (k === 'ok' ? null : press(k)) }, k === 'del' ? '⌫' : k === 'ok' ? '✓' : k)));
    const m = openModal([h('h3', { style: { textAlign: 'center' } }, title), h('div', { class: 'lead', style: { textAlign: 'center' } }, 'Ziffern tippen oder auswählen'), dots, pad], 'small');
    m.onkey = (name) => {
      if (/^num\d$/.test(name)) { press(name.slice(3)); return true; }
      if (name === 'backspace') { press('del'); return true; }
      return false;
    };
    m.onclose = () => { if (!done) resolve(null); };
  });
}

/* ---------- Kachel-Editor ---------- */
function editTile(t) {
  const isNew = !t;
  const d = Object.assign({ id: '', title: '', subtitle: '', description: '', url: '', tvMode: false, image: '', hue: HUES[Math.floor(Math.random() * HUES.length)] }, t || {});
  const preview = h('div', { style: { display: 'flex', justifyContent: 'center', margin: '0 0 calc(2.6*var(--u))' } });
  const paintPreview = () => { preview.innerHTML = ''; const el = tileEl(d, S.state.tiles.findIndex((x) => x.id === d.id) >= 0 ? S.state.tiles.findIndex((x) => x.id === d.id) : S.state.tiles.length); el.classList.add('preview-tile'); el.removeAttribute('data-nav'); preview.appendChild(el); };

  const inp = (key, ph, type = 'text') => {
    const el = h('input', { class: 'inp', type, placeholder: ph, 'data-nav': true, value: d[key] || '' });
    el.addEventListener('input', () => { d[key] = el.value; paintPreview(); });
    return el;
  };
  const ta = h('textarea', { class: 'inp', placeholder: 'Wird im Info-Bereich angezeigt, wenn die Kachel ausgewählt ist', 'data-nav': true }, d.description || '');
  ta.addEventListener('input', () => { d.description = ta.value; });
  const urlInp = inp('url', 'z. B. https://www.ardmediathek.de');
  const titleInp = inp('title', 'Name der Kachel');
  const subInp = inp('subtitle', 'Kurzer Untertitel');
  const imgInp = inp('image', 'Bild-Adresse (https://…) – oder per Handy hochladen', 'url');
  const tv = h('button', { class: 'toggle' + (d.tvMode ? ' on' : ''), 'data-nav': true, onclick: () => { d.tvMode = !d.tvMode; tv.classList.toggle('on', d.tvMode); paintPreview(); } });
  const hues = h('div', { class: 'swatches' }, HUES.map((hu) => {
    const b = h('button', { class: 'swatch' + (hu === d.hue ? ' sel' : ''), 'data-nav': true, style: { background: `linear-gradient(135deg, hsl(${hu} 32% 34%), hsl(${(hu + 25) % 360} 28% 14%))` },
      onclick: () => { d.hue = hu; $$('.swatch', hues).forEach((s) => s.classList.remove('sel')); b.classList.add('sel'); paintPreview(); } });
    return b;
  }));
  const presets = h('div', { class: 'swatches', style: { gap: 'calc(.8*var(--u))' } }, PRESETS.map((p) =>
    h('button', { class: 'btn', 'data-nav': true, onclick: () => {
      Object.assign(d, { title: p.title, subtitle: p.subtitle, url: p.url, tvMode: !!p.tvMode, hue: p.hue });
      titleInp.value = d.title; subInp.value = d.subtitle; urlInp.value = d.url; tv.classList.toggle('on', d.tvMode); paintPreview();
    } }, p.title)));

  const field = (label, ctl, small) => h('div', { class: 'field' }, h('label', {}, label, small ? h('small', {}, small) : null), ctl);
  const m = openModal([
    h('h3', {}, isNew ? 'Neue Kachel' : 'Kachel bearbeiten'),
    h('div', { class: 'lead' }, 'Vorschau'),
    preview,
    field('Vorlage', presets, 'Füllt Name und Adresse aus'),
    field('Name', titleInp),
    field('Untertitel', subInp),
    field('Beschreibung', ta),
    field('Adresse', urlInp, 'Website oder lichtung:live'),
    field('TV-Ansicht', tv, 'Seite hält uns für einen Fernseher (für youtube.com/tv)'),
    field('Farbe', hues, 'Falls kein Bild gesetzt ist'),
    field('Bild', h('div', { style: { display: 'flex', gap: '1em' } }, imgInp,
      h('button', { class: 'btn', 'data-nav': true, onclick: () => { d.image = ''; imgInp.value = ''; paintPreview(); } }, 'Entfernen')), 'Eigene Fotos am einfachsten über die Handy-Fernbedienung → Kacheln'),
    h('div', { class: 'btns' },
      h('button', { class: 'btn primary', 'data-nav': true, onclick: async () => {
        if (!d.title.trim()) { L.toast('Bitte einen Namen eingeben'); return; }
        await api('/api/tiles', 'POST', { tile: d });
        m.close(); await refresh(); L.toast('Gespeichert');
      } }, 'Speichern'),
      !isNew ? h('button', { class: 'btn danger', 'data-nav': true, onclick: () => { m.close(); confirmBox(`„${d.title}“ löschen?`, async () => { await api('/api/tiles/' + d.id, 'DELETE'); await refresh(); }); } }, 'Löschen') : null,
      h('button', { class: 'btn', 'data-nav': true, onclick: () => m.close() }, 'Abbrechen')),
  ]);
  paintPreview();
  // Fokus auf den Namen (neue Kachel) bzw. die Vorlagen
  setTimeout(() => Nav.focus(isNew ? presets.firstElementChild : titleInp, { instant: true }), 30);
}

/* ============================================================
 * 5. Einstellungen
 * ============================================================ */
const SECTIONS = [
  ['tiles', 'Kacheln'], ['profiles', 'Profile'], ['channels', 'Live-TV-Sender'], ['look', 'Aussehen'],
  ['weather', 'Wetter & Ort'], ['audio', 'Ton'], ['saver', 'Bildschirmschoner'], ['remote', 'Handy-Fernbedienung'],
  ['advanced', 'Erweitert'], ['system', 'System'], ['help', 'Tasten & Hilfe'],
];

function openSettings(section) {
  if (section) S.section = section;
  const nav = $('#s-nav');
  nav.innerHTML = '';
  nav.append(h('h2', {}, 'Einstellungen'));
  SECTIONS.forEach(([id, label], i) => {
    const b = h('button', { 'data-nav': true, 'data-sec': id, class: id === S.section ? 'sel' : '', 'data-nav-default': id === S.section || null },
      h('span', { class: 'n' }, L.pad(i + 1)), label);
    b.addEventListener('click', () => { S.section = id; renderSection(); $$('.s-nav button').forEach((x) => x.classList.toggle('sel', x === b)); setTimeout(() => focusBody(), 10); });
    b.addEventListener('navfocus', () => { if (S.section !== id) { S.section = id; renderSection(); $$('.s-nav button').forEach((x) => x.classList.toggle('sel', x === b)); } });
    nav.append(b);
  });
  nav.append(h('div', { style: { flex: 1 } }), h('button', { 'data-nav': true, onclick: () => closeSettings() }, h('span', { class: 'n' }, '←'), 'Zurück zur Startseite'));
  renderSection();
  S.lastFocus.settings = null;
  show('settings');
}

function focusBody() { const f = Nav.items().find((el) => $('#s-body').contains(el)); if (f) Nav.focus(f); }
async function closeSettings() { if (S.preview) { S.preview = null; S.scene?.preview(null); } await refresh(); show('home'); }

async function refresh() {
  await load();
  if (S.view === 'settings') renderSection(true);
  renderHome();
  if (S.view === 'home') Nav.ensure();
}

function field(label, ctl, small) {
  return h('div', { class: 'field' }, h('label', {}, label, small ? h('small', {}, small) : null), ctl);
}
function toggle(on, onChange) {
  const b = h('button', { class: 'toggle' + (on ? ' on' : ''), 'data-nav': true });
  b.addEventListener('click', () => { on = !on; b.classList.toggle('on', on); onChange(on); });
  return b;
}
function stepper(value, { min, max, step, fmt }, onChange) {
  const val = h('span', { class: 'val' }, fmt(value));
  const set = (v) => { value = Math.max(min, Math.min(max, Math.round(v / step) * step)); val.textContent = fmt(value); onChange(value); };
  return h('div', { class: 'stepper' },
    h('button', { class: 'btn', 'data-nav': true, onclick: () => set(value - step) }, '−'), val,
    h('button', { class: 'btn', 'data-nav': true, onclick: () => set(value + step) }, '+'));
}
async function saveGeneral(patch) {
  S.state.general = await api('/api/general', 'POST', patch);
  applyLook();
}

function renderSection(keepFocus) {
  const body = $('#s-body');
  const focusedIndex = keepFocus ? Nav.items().filter((el) => body.contains(el)).indexOf(Nav.current) : -1;
  body.innerHTML = '';
  const g = S.state.general;
  const add = (...els) => body.append(...els.flat().filter(Boolean));
  const head = (t, lead) => add(h('h3', {}, t), h('div', { class: 'lead' }, lead));

  switch (S.section) {
    case 'tiles': {
      head('Kacheln', `Kacheln des Profils „${profile().name}“. Reihenfolge = Nummer auf der Startseite (Tasten 1–9 öffnen direkt).`);
      S.state.tiles.forEach((t, i) => add(h('div', { class: 'list-row' },
        h('div', { class: 'mini', style: { background: t.image ? `center/cover url("${t.image}")` : `linear-gradient(135deg, hsl(${t.hue} 32% 30%), hsl(${(t.hue + 25) % 360} 28% 12%))` } }),
        h('div', { class: 'grow' }, h('b', {}, `${L.pad(i + 1)}  ${t.title}`), h('span', {}, t.url)),
        h('button', { class: 'btn', 'data-nav': true, onclick: () => editTile(t) }, 'Bearbeiten'),
        h('button', { class: 'btn', 'data-nav': true, onclick: () => moveTile(t.id, -1) }, '↑'),
        h('button', { class: 'btn', 'data-nav': true, onclick: () => moveTile(t.id, 1) }, '↓'),
        h('button', { class: 'btn danger', 'data-nav': true, onclick: () => confirmBox(`„${t.title}“ löschen?`, async () => { await api('/api/tiles/' + t.id, 'DELETE'); await refresh(); }) }, 'Löschen'))));
      add(h('div', { class: 'btns' }, h('button', { class: 'btn primary', 'data-nav': true, onclick: () => editTile(null) }, '+ Neue Kachel')));
      break;
    }
    case 'profiles': {
      head('Profile', 'Jedes Profil hat eigene Kacheln und eine eigene Weiterschauen-Liste. Profile mit PIN starten nie automatisch – das Standardprofil (ohne PIN) startet nach kurzer Wartezeit von selbst.');
      S.state.profiles.forEach((p) => {
        const isActive = p.id === S.state.active;
        add(h('div', { class: 'list-row' },
          h('div', { style: { width: 'calc(6*var(--u))' } }, avatar(p, 'av')),
          h('div', { class: 'grow' }, h('b', {}, p.name), h('span', {}, [isActive ? 'Aktiv' : '', p.isDefault ? 'Standard (startet automatisch)' : '', p.hasPin ? 'mit PIN' : 'ohne PIN'].filter(Boolean).join(' · '))),
          isActive || !p.hasPin ? h('button', { class: 'btn', 'data-nav': true, onclick: () => editProfile(p) }, 'Bearbeiten') : h('span', { class: 'lead', style: { margin: 0 } }, 'gesperrt'),
          !isActive ? h('button', { class: 'btn', 'data-nav': true, onclick: () => chooseProfile(p) }, 'Wechseln') : null));
      });
      $$('.list-row .av', body).forEach((a) => Object.assign(a.style, { width: 'calc(5*var(--u))', height: 'calc(5*var(--u))', fontSize: 'calc(2.4*var(--u))' }));
      add(h('div', { class: 'btns' }, h('button', { class: 'btn primary', 'data-nav': true, onclick: () => editProfile(null) }, '+ Neues Profil')));
      break;
    }
    case 'channels': {
      head('Live-TV-Sender', 'Offizielle, frei empfangbare Livestreams der öffentlich-rechtlichen Sender. Reihenfolge = Programmplatz. Eigene Sender: Name + Adresse eines HLS-Streams (.m3u8).');
      S.state.channels.forEach((c, i) => add(h('div', { class: 'list-row' },
        h('div', { class: 'grow' }, h('b', {}, `${i + 1}  ${c.name}`), h('span', {}, c.url)),
        h('button', { class: 'btn', 'data-nav': true, onclick: () => editChannel(i) }, 'Bearbeiten'),
        h('button', { class: 'btn', 'data-nav': true, onclick: () => moveChannel(i, -1) }, '↑'),
        h('button', { class: 'btn', 'data-nav': true, onclick: () => moveChannel(i, 1) }, '↓'),
        h('button', { class: 'btn danger', 'data-nav': true, onclick: () => saveChannels(S.state.channels.filter((_, j) => j !== i)) }, 'Entfernen'))));
      add(h('div', { class: 'btns' }, h('button', { class: 'btn primary', 'data-nav': true, onclick: () => editChannel(-1) }, '+ Sender hinzufügen')));
      break;
    }
    case 'look': {
      head('Aussehen', 'Hintergrund, Akzentfarbe und wie stark der Hintergrund abgedunkelt wird.');
      const choices = h('div', { class: 'bg-choices' });
      const customs = (S.state.general.customBackgrounds || []);
      [...L.BACKGROUNDS.map((b) => ({ id: b.id, name: b.name })), ...customs.map((u, i) => ({ id: u, name: 'Foto ' + (i + 1) }))].forEach((b) => {
        const el = h('button', { class: 'bg-choice' + (g.background === b.id ? ' sel' : ''), 'data-nav': true, onclick: async () => { await saveGeneral({ background: b.id }); renderSection(true); } }, h('span', {}, b.name));
        if (b.id.startsWith('/')) el.style.backgroundImage = `url("${b.id}")`;
        else { const c = document.createElement('canvas'); c.width = 240; c.height = 140; L.paintScene(c.getContext('2d'), 240, 140, b.id); el.style.backgroundImage = `url(${c.toDataURL()})`; }
        choices.append(el);
      });
      add(field('Hintergrund', choices, 'Eigene Fotos: Handy-Fernbedienung → Aussehen'));
      add(field('Akzentfarbe', h('div', { class: 'swatches' }, ACCENTS.map((a) => h('button', { class: 'swatch' + (g.accent === a ? ' sel' : ''), style: { background: a }, 'data-nav': true, onclick: async () => { await saveGeneral({ accent: a }); renderSection(true); } })))));
      add(field('Abdunkeln', stepper(Math.round((g.dim ?? .55) * 100), { min: 10, max: 90, step: 5, fmt: (v) => v + ' %' }, (v) => saveGeneral({ dim: v / 100 }))));
      const seg = (opts, cur, onPick) => h('div', { class: 'swatches', style: { gap: 'calc(.8*var(--u))' } }, opts.map(([v, n]) =>
        h('button', { class: 'btn' + (cur === v ? ' primary' : ''), 'data-nav': true, onclick: async () => { await onPick(v); renderSection(true); } }, n)));
      add(field('Animation', seg([['aus', 'Aus'], ['sanft', 'Sanft'], ['voll', 'Voll']], g.motion || 'voll', (v) => saveGeneral({ motion: v })), 'Sanft spart Leistung'));
      add(field('Wetter-Effekte', toggle(g.weatherFx !== false, (v) => saveGeneral({ weatherFx: v })), 'Regen, Schnee, Nebel, Gewitter – nach echtem Wetter'));
      add(field('Polarlicht', toggle(!!g.aurora, (v) => saveGeneral({ aurora: v })), 'In klaren Nächten'));
      const d = S.scene?.describe();
      const P = S.preview || {};
      const setP = (patch) => { S.preview = Object.assign({}, S.preview || {}, patch); S.scene.preview(S.preview); renderSection(true); };
      add(field('Vorschau Wetter', seg([[null, 'Echt'], ['clear', 'Klar'], ['partly', 'Wolkig'], ['rain', 'Regen'], ['snow', 'Schnee'], ['fog', 'Nebel'], ['storm', 'Gewitter']], P.kind ?? null, (v) => setP({ kind: v })),
        d ? `Gerade: ${d.tod} · ${d.moon} · Sonne ${d.sunAlt}°` : ''));
      add(field('Vorschau Tageszeit', seg([[null, 'Echt'], [6.5, 'Morgen'], [12, 'Mittag'], [17, 'Abend'], [23, 'Nacht']], P.hour ?? null, (v) => setP({ hour: v })), 'Nur zum Ausprobieren – beim Verlassen wieder echt'));
      break;
    }
    case 'weather': {
      head('Wetter & Ort', `Aktuell: ${g.city} (${Number(g.lat).toFixed(2)}, ${Number(g.lon).toFixed(2)}). Daten von Open-Meteo, ohne Anmeldung.`);
      const q = h('input', { class: 'inp', 'data-nav': true, placeholder: 'Ort suchen, z. B. Kiel', value: '' });
      const results = h('div', { class: 'menu-list' });
      const search = async () => {
        results.innerHTML = '<div class="lead">Suche …</div>';
        const list = await api('/api/geocode?q=' + encodeURIComponent(q.value));
        results.innerHTML = '';
        if (!list.length) results.append(h('div', { class: 'lead' }, 'Nichts gefunden.'));
        list.forEach((r) => results.append(h('button', { 'data-nav': true, onclick: async () => {
          await saveGeneral({ city: r.name, lat: r.latitude, lon: r.longitude }); await loadWeather(); renderSection(); L.toast('Ort gespeichert');
        } }, h('span', {}, r.name), h('span', { class: 'k' }, [r.admin1, r.country].filter(Boolean).join(', ')))));
        if (list.length) Nav.focus(results.firstElementChild);
      };
      q.addEventListener('keydown', (e) => { if (e.key === 'Enter') search(); });
      add(field('Ort', h('div', { style: { display: 'flex', gap: '1em' } }, q, h('button', { class: 'btn primary', 'data-nav': true, onclick: search }, 'Suchen'))), results);
      break;
    }
    case 'audio': {
      head('Ton', 'Wohin der Ton geht. Beim Fernseher am HDMI-Kabel meist „HDMI“ oder „Digital Stereo (HDMI)“. HDMI wird automatisch bevorzugt, sobald es angeschlossen ist.');
      const box = h('div', { class: 'menu-list', style: { maxWidth: 'calc(80*var(--u))' } }, h('div', { class: 'lead' }, 'Lade …'));
      add(box);
      api('/api/audio').then((a) => {
        box.innerHTML = '';
        if (!a.sinks.length) box.append(h('div', { class: 'lead' }, 'Keine Ausgänge gefunden (PipeWire läuft nicht?).'));
        a.sinks.forEach((sk) => box.append(h('button', { 'data-nav': true, onclick: async () => { await api('/api/audio', 'POST', { id: sk.id }); L.toast('Ton über ' + sk.name); renderSection(true); } },
          h('span', {}, sk.name), h('span', { class: 'k' }, (sk.default ? 'aktiv ✓ ' : '') + (sk.hdmi ? 'HDMI' : '')))));
        if (S.view === 'settings' && !$('#s-body').contains(Nav.current)) return;
        if (a.sinks.length) Nav.focus(box.firstElementChild, { instant: true });
      });
      break;
    }
    case 'saver': {
      head('Bildschirmschoner', 'Zeigt Uhr, Datum und Wetter, wenn eine Weile nichts passiert und kein Video läuft. Jede Taste beendet ihn.');
      add(field('Starten nach', stepper(Number(g.screensaverMinutes ?? 5), { min: 0, max: 60, step: 1, fmt: (v) => v ? v + ' Min.' : 'Aus' }, (v) => saveGeneral({ screensaverMinutes: v }))));
      add(field('Auch auf Webseiten', toggle(g.screensaverOnPages !== false, (v) => saveGeneral({ screensaverOnPages: v })), 'z. B. in der Mediathek, wenn nichts abgespielt wird'));
      add(h('div', { class: 'btns' }, h('button', { class: 'btn', 'data-nav': true, onclick: () => startSaver() }, 'Jetzt anzeigen')));
      break;
    }
    case 'remote': {
      head('Handy-Fernbedienung', 'Handy ins gleiche WLAN, QR-Code scannen, Code eingeben. Dann kannst du steuern, tippen, Kacheln bearbeiten und eigene Fotos hochladen.');
      const box = h('div', { class: 'remote-box' }, h('div', { class: 'qr', id: 'qr' }), h('div', {},
        h('div', { class: 'lead', style: { marginBottom: '.4em' } }, 'Adresse'), h('div', { id: 'remote-url', style: { fontSize: 'calc(2.2*var(--u))' } }, '…'),
        h('div', { class: 'lead', style: { margin: '2em 0 0' } }, 'Code'), h('div', { class: 'big-code', id: 'remote-pin' }, '····'),
        h('div', { class: 'btns' }, h('button', { class: 'btn', 'data-nav': true, onclick: async () => { await api('/api/remote/newpin', 'POST', {}); renderSection(true); } }, 'Neuen Code erzeugen'))));
      add(box);
      api('/api/netinfo').then((n) => {
        const url = `http://${n.ip}:${n.port}/remote`;
        $('#remote-url').textContent = url;
        $('#remote-pin').textContent = n.pin;
        try { const qr = qrcode(0, 'M'); qr.addData(url + '#' + n.pin); qr.make(); $('#qr').innerHTML = qr.createSvgTag({ cellSize: 6, margin: 0, scalable: true }); } catch (_) {}
      });
      break;
    }
    case 'advanced': {
      head('Erweitert', 'Nur ändern, wenn etwas nicht funktioniert.');
      // Falls YouTube eine Kennung sperrt: einfach eine andere Konsole/TV probieren
      const UAS = [
        ['PlayStation 4', 'Mozilla/5.0 (PS4; Leanback Shell) Gecko/20100101 Firefox/65.0 LeanbackShell/01.00.01.75 Sony PS4/ (PS4, , no, CH)'],
        ['Xbox Series X', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; Xbox; Xbox Series X) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/48.0.2564.82 Safari/537.36 Edge/20.02'],
        ['Nintendo Switch', 'Mozilla/5.0 (Nintendo Switch; WifiWebAuthApplet) AppleWebKit/606.4 (KHTML, like Gecko) NF/6.0.1.15.4 NintendoBrowser/5.1.0.20393'],
        ['Samsung-TV', 'Mozilla/5.0 (SMART-TV; LINUX; Tizen 6.0) AppleWebKit/537.36 (KHTML, like Gecko) 85.0.4183.93/6.0 TV Safari/537.36'],
      ];
      const ua = h('input', { class: 'inp', 'data-nav': true, value: g.tvUserAgent || '' });
      add(field('TV-Kennung', h('div', { class: 'swatches', style: { gap: 'calc(.8*var(--u))' } }, UAS.map(([n, v]) =>
        h('button', { class: 'btn' + (g.tvUserAgent === v ? ' primary' : ''), 'data-nav': true, onclick: async () => { await saveGeneral({ tvUserAgent: v }); L.toast(n + ' gewählt – greift beim nächsten Öffnen'); renderSection(true); } }, n))),
        'Als welches Gerät sich die TV-Ansicht ausgibt. Klappt YouTube TV nicht mehr: andere probieren.'));
      add(field('Eigene Kennung', h('div', { style: { display: 'flex', gap: '1em' } }, ua, h('button', { class: 'btn', 'data-nav': true, onclick: async () => { await saveGeneral({ tvUserAgent: ua.value }); L.toast('Gespeichert'); } }, 'Speichern'))));
      add(field('Lautstärke-Schritt', stepper(Number(g.volumeStep || 5), { min: 1, max: 20, step: 1, fmt: (v) => v + ' %' }, (v) => saveGeneral({ volumeStep: v }))));
      add(field('Profil-Autostart', stepper(Number(g.profileAutoSeconds ?? 2), { min: 0, max: 10, step: 1, fmt: (v) => v ? v + ' Sek.' : 'Aus' }, (v) => saveGeneral({ profileAutoSeconds: v })), 'Wartezeit bis zum Standardprofil'));
      add(field('Tasten-Dienst', h('span', {}, S.state.evdev ? 'aktiv ✓' : 'nicht aktiv – Home-/Lautstärketasten gehen nur auf der Startseite'), ''));
      add(field('Handy-Tasten', h('span', {}, S.state.uinput ? 'aktiv ✓' : 'nicht aktiv'), ''));
      break;
    }
    case 'system': {
      head('System', 'Neustarts und Ausschalten.');
      add(h('div', { class: 'menu-list', style: { maxWidth: 'calc(60*var(--u))' } },
        h('button', { 'data-nav': true, onclick: () => runSetup(() => { renderHome(); show('home'); }) }, h('span', {}, 'Einrichtung wiederholen'), h('span', { class: 'k' }, 'Assistent vom ersten Start')),
        h('button', { 'data-nav': true, onclick: () => api('/api/system', 'POST', { action: 'restart-browser' }) }, h('span', {}, 'Browser neu starten'), h('span', { class: 'k' }, 'falls etwas hängt')),
        h('button', { 'data-nav': true, onclick: () => confirmBox('Laptop neu starten?', () => api('/api/system', 'POST', { action: 'reboot' })) }, h('span', {}, 'Neu starten')),
        h('button', { 'data-nav': true, class: 'danger', onclick: () => confirmBox('Laptop ausschalten?', () => api('/api/system', 'POST', { action: 'poweroff' })) }, h('span', {}, 'Ausschalten'))));
      break;
    }
    case 'help': {
      head('Tasten & Hilfe', 'Alles geht mit Laptop-Tastatur, Funk-Fernbedienung, Maus oder Handy.');
      const rows = [
        ['← ↑ → ↓', 'Bewegen'], ['Enter / OK', 'Öffnen, bestätigen'], ['☰ / Menü-Taste, M, Rechtsklick', 'Optionen zur Kachel'],
        ['Esc / Zurück / Rücktaste', 'Zurück'], ['Windows-Taste, F1, Home', 'Von überall zur Startseite'], ['1 – 9', 'Kachel direkt öffnen'],
        ['S', 'Einstellungen'], ['Lautstärketasten, F-Tasten', 'Lautstärke mit Anzeige'], ['Live-TV: ↑ ↓ / Bild ↑↓ / Ziffern', 'Sender wechseln'],
        ['Live-TV: Enter', 'Senderliste'], ['F11 (auf Webseiten)', 'Vollbild für Videos, falls nötig'], ['Strg + / Strg −', 'Webseite größer/kleiner'],
      ];
      add(h('div', { class: 'keytable' }, rows.map(([k, v]) => [h('kbd', {}, k), h('span', {}, v)])));
      break;
    }
  }
  if (keepFocus && focusedIndex >= 0) {
    const list = Nav.items().filter((el) => body.contains(el));
    if (list[focusedIndex]) Nav.focus(list[Math.min(focusedIndex, list.length - 1)], { instant: true });
  }
}

function editProfile(p) {
  const isNew = !p;
  const d = { name: p?.name || '', color: p?.color || ACCENTS[(S.state.profiles.length + 2) % ACCENTS.length] };
  const name = h('input', { class: 'inp', 'data-nav': true, value: d.name, placeholder: 'Name' });
  name.addEventListener('input', () => { d.name = name.value; });
  const colors = h('div', { class: 'swatches' }, ACCENTS.map((a) => {
    const b = h('button', { class: 'swatch' + (a === d.color ? ' sel' : ''), style: { background: a }, 'data-nav': true, onclick: () => { d.color = a; $$('.swatch', colors).forEach((x) => x.classList.remove('sel')); b.classList.add('sel'); } });
    return b;
  }));
  let newPin = null, removePin = false;
  const pinState = h('span', { class: 'lead', style: { margin: 0 } }, p?.hasPin ? 'PIN gesetzt' : 'keine PIN');
  const pinBtns = h('div', { style: { display: 'flex', gap: '1em', alignItems: 'center' } },
    h('button', { class: 'btn', 'data-nav': true, onclick: async () => {
      const a = await askPin('Neue PIN (4 Ziffern)'); if (!a) return;
      const b = await askPin('PIN wiederholen', async (v) => v === a); if (!b) return;
      newPin = a; removePin = false; pinState.textContent = 'neue PIN wird gespeichert';
    } }, p?.hasPin ? 'PIN ändern' : 'PIN festlegen'),
    p?.hasPin ? h('button', { class: 'btn', 'data-nav': true, onclick: () => { removePin = true; newPin = null; pinState.textContent = 'PIN wird entfernt'; } }, 'PIN entfernen') : null,
    pinState);
  const m = openModal([
    h('h3', {}, isNew ? 'Neues Profil' : 'Profil bearbeiten'),
    h('div', { class: 'lead' }, isNew ? 'Startet mit einer Kopie der Standard-Kacheln' : ''),
    field('Name', name), field('Farbe', colors), field('PIN', pinBtns, 'Schützt das Profil; Profile mit PIN starten nie automatisch'),
    !isNew && !p.isDefault ? field('Standardprofil', h('button', { class: 'btn', 'data-nav': true, onclick: async () => {
      try { await api('/api/profiles/' + p.id, 'PUT', { isDefault: true }); L.toast('Ist jetzt Standard'); m.close(); await refresh(); } catch (e) { L.toast(e.message); }
    } }, 'Als Standard festlegen'), 'Startet automatisch nach der Wartezeit') : null,
    h('div', { class: 'btns' },
      h('button', { class: 'btn primary', 'data-nav': true, onclick: async () => {
        if (!d.name.trim()) { L.toast('Bitte einen Namen eingeben'); return; }
        try {
          if (isNew) await api('/api/profiles', 'POST', { name: d.name, color: d.color, pin: newPin });
          else await api('/api/profiles/' + p.id, 'PUT', { name: d.name, color: d.color, pin: newPin, removePin });
          m.close(); await refresh(); L.toast('Gespeichert');
        } catch (e) { L.toast(e.message); }
      } }, 'Speichern'),
      !isNew ? h('button', { class: 'btn danger', 'data-nav': true, onclick: () => { m.close(); confirmBox(`Profil „${p.name}“ mit allen Kacheln löschen?`, async () => { try { await api('/api/profiles/' + p.id, 'DELETE'); await refresh(); } catch (e) { L.toast(e.message); } }); } }, 'Löschen') : null,
      h('button', { class: 'btn', 'data-nav': true, onclick: () => m.close() }, 'Abbrechen')),
  ]);
  setTimeout(() => Nav.focus(name, { instant: true }), 30);
}

async function saveChannels(list) { await api('/api/channels', 'POST', { channels: list }); await refresh(); }
function moveChannel(i, dir) {
  const list = [...S.state.channels], j = i + dir;
  if (j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  saveChannels(list);
}
function editChannel(i) {
  const c = i >= 0 ? { ...S.state.channels[i] } : { name: '', url: '' };
  const name = h('input', { class: 'inp', 'data-nav': true, value: c.name, placeholder: 'Sendername' });
  const url = h('input', { class: 'inp', 'data-nav': true, value: c.url, placeholder: 'https://…/master.m3u8' });
  const m = openModal([
    h('h3', {}, i >= 0 ? 'Sender bearbeiten' : 'Neuer Sender'),
    field('Name', name), field('Stream-Adresse', url, 'HLS (.m3u8)'),
    h('div', { class: 'btns' },
      h('button', { class: 'btn primary', 'data-nav': true, onclick: async () => {
        const list = [...S.state.channels];
        const item = { ...c, name: name.value.trim() || 'Sender', url: url.value.trim() };
        if (!item.url) { L.toast('Bitte eine Adresse eingeben'); return; }
        if (i >= 0) list[i] = item; else list.push(item);
        m.close(); await saveChannels(list);
      } }, 'Speichern'),
      h('button', { class: 'btn', 'data-nav': true, onclick: () => m.close() }, 'Abbrechen')),
  ], 'small');
}

/* ============================================================
 * 6. Bildschirmschoner
 * ============================================================ */
function startSaver() {
  if (S.saverOn) return;
  S.saverOn = true;
  const g = S.state.general;
  if (!S.saverScene) S.saverScene = new L.Scene($('#saver-bg'), Object.assign(sceneOpts(g), { scale: 0.5 }));
  S.saverScene.setLocation(g.lat, g.lon);
  S.saverScene.setPhoto((g.background || '').startsWith('/') ? g.background : null);
  if (S.weather?.current) S.saverScene.setWeather(S.weather);
  S.saverScene.set(Object.assign(sceneOpts(g), { scale: 0.5 }));
  S.scene?.stop();
  $('#saver').classList.add('active');
  renderSaver(true);
}
function stopSaver() {
  if (!S.saverOn) return false;
  S.saverOn = false;
  $('#saver').classList.remove('active');
  S.saverScene?.stop();
  S.scene?.start();
  return true;
}
function renderSaver(move) {
  const d = new Date(), w = S.weather;
  const el = $('#saver-content');
  let wx = '';
  if (w && w.current) {
    const days = (w.daily?.time || []).slice(1, 4).map((t, i) => `<div>${new Date(t).toLocaleDateString('de-DE', { weekday: 'short' })}${L.weatherIcon(w.daily.weather_code[i + 1], 1)}<b>${Math.round(w.daily.temperature_2m_max[i + 1])}° / ${Math.round(w.daily.temperature_2m_min[i + 1])}°</b></div>`).join('');
    wx = `<div class="w">${L.weatherIcon(w.current.weather_code, w.current.is_day)}<span class="t">${Math.round(w.current.temperature_2m)}°</span><span>${L.esc(w.city)} · ${L.weatherText(w.current.weather_code)}</span></div><div class="fc">${days}</div>`;
  }
  el.innerHTML = `<div class="digits">${clockHTML(d)}</div><div class="meta"><div class="d">${L.esc(L.dateStr(d))}</div>${wx}</div>`;
  // Position jede Minute leicht ändern → kein Einbrennen bei OLED/Plasma
  if (move || d.getSeconds() < 1) {
    el.style.left = (6 + Math.random() * 30) + 'vw';
    el.style.top = (12 + Math.random() * 30) + 'vh';
  }
}

/* ============================================================
 * 7. Tastatur, Maus, Ereignisse
 * ============================================================ */
function handleKey(name, e) {
  // Bildschirmschoner: erste Taste weckt nur auf
  if (stopSaver()) { S.localIdle = Date.now(); return true; }
  S.localIdle = Date.now();
  const top = S.modals[S.modals.length - 1];
  if (top?.onkey && top.onkey(name, e)) return true;
  const typing = L.isTyping();

  switch (name) {
    case 'up': case 'down': Nav.move(name); return true;
    case 'left': case 'right': {
      if (typing) {
        const a = document.activeElement;
        const atStart = a.selectionStart === 0 && a.selectionEnd === 0;
        const atEnd = a.selectionStart === a.value.length;
        if ((name === 'left' && !atStart) || (name === 'right' && !atEnd)) return false;
      }
      Nav.move(name); return true;
    }
    case 'back':
      if (top) { top.close(); return true; }
      if (S.view === 'setup') { prev(); return true; }
      if (S.view === 'settings') { closeSettings(); return true; }
      if (S.view === 'profiles' && sessionStorage.getItem('lichtung-profile')) { show('home'); return true; }
      return true;
    case 'backspace':
      if (typing) return false;
      return handleKey('back', e);
    case 'home': goHome(); return true;
    case 'menu': case 'm': case 'M':
      if (typing && name !== 'menu') return false;
      contextFor(Nav.current); return true;
    case 's': case 'S':
      if (typing || top) return false;
      if (S.view === 'home') { openSettings(); return true; }
      return false;
    case 'play':
      if (typing) return false;
      Nav.activate(); return true;
  }
  if (/^num\d$/.test(name) && !typing && !top && S.view === 'home') {
    const n = Number(name.slice(3)) || 10;
    const t = S.state.tiles[n - 1];
    if (t) openTile(t);
    return true;
  }
  return false;
}

function contextFor(el) {
  if (!el || S.view !== 'home') return;
  if (el.dataset.kind === 'tile') { const t = S.state.tiles.find((x) => x.id === el.dataset.id); if (t) tileMenu(t); }
  if (el.dataset.kind === 'media' && el._media) mediaMenu(el._media);
  if (el.dataset.kind === 'cw') { const i = $$('#cw-row .tile').indexOf(el); const c = S.state.continue[i]; if (c) continueMenu(c); }
}

function goHome() {
  stopSaver();
  while (S.modals.length) S.modals[S.modals.length - 1].close();
  if (S.view === 'profiles' && !sessionStorage.getItem('lichtung-profile')) return;
  if (S.view !== 'home') show('home');
  const first = $('#tile-row .tile');
  if (first) Nav.focus(first);
}

addEventListener('keydown', (e) => {
  const name = L.keyName(e);
  // OK/Enter reagiert sofort beim Drücken (außer in Eingabefeldern)
  if (name === 'ok' && !L.isTyping()) {
    e.preventDefault();
    if (stopSaver()) { S.localIdle = Date.now(); return; }
    if (e.repeat) return;
    S.localIdle = Date.now();
    const top = S.modals[S.modals.length - 1];
    if (top?.onkey && top.onkey('ok', e)) return;
    Nav.activate();
    return;
  }
  if (handleKey(name, e)) e.preventDefault();
}, true);

// Maus: Fokus folgt dem Zeiger; Zeiger verschwindet nach 3 Sekunden Ruhe
let mouseT;
addEventListener('mousemove', () => {
  document.body.classList.remove('hide-cursor');
  clearTimeout(mouseT);
  mouseT = setTimeout(() => document.body.classList.add('hide-cursor'), 3000);
  S.localIdle = Date.now();
  if (S.saverOn) stopSaver();
});
addEventListener('mouseover', (e) => {
  const el = e.target.closest('[data-nav]');
  if (el && Nav.scope.contains(el) && el !== Nav.current) Nav.focus(el, { noScroll: true });
});
addEventListener('wheel', (e) => {
  const row = e.target.closest('.row');
  if (row && Math.abs(e.deltaY) > Math.abs(e.deltaX)) { row.scrollLeft += e.deltaY; e.preventDefault(); }
}, { passive: false });

// Info-Bereich für die beiden Knöpfe oben rechts
document.addEventListener('navfocus', (e) => {
  if (e.target.id === 'btn-profile') setHero('Profil', profile().name, 'Profil wechseln oder ein anderes Profil wählen.');
  if (e.target.id === 'btn-settings') setHero('System', 'Einstellungen', 'Kacheln, Profile, Sender, Aussehen, Wetter, Handy-Fernbedienung.');
});

// Live-Ereignisse vom Hintergrunddienst
L.events(async (ev) => {
  if (ev.type === 'volume') L.showVolume(ev);
  else if (ev.type === 'home') goHome();
  else if (ev.type === 'saver') { if (ev.on && S.view !== 'profiles') startSaver(); else if (!ev.on) stopSaver(); }
  else if (ev.type === 'config' || ev.type === 'continue' || ev.type === 'profile') {
    // Änderungen vom Handy sofort übernehmen (aber nicht mitten in einem Dialog)
    if (!S.modals.length) await refresh();
  } else if (ev.type === 'remotekey') {
    const map = { up: 'up', down: 'down', left: 'left', right: 'right', ok: 'ok', back: 'back', menu: 'menu' };
    if (map[ev.key] === 'ok') Nav.activate(); else if (map[ev.key]) handleKey(map[ev.key]);
  } else if (ev.type === 'text') {
    const a = document.activeElement;
    if (a && a.matches('input, textarea')) {
      a.value += ev.text; a.dispatchEvent(new Event('input', { bubbles: true }));
      if (ev.enter) a.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    }
  }
});

// Fallback-Bildschirmschoner, falls der Tasten-Dienst nicht läuft
setInterval(() => {
  const mins = Number(S.state?.general.screensaverMinutes || 0);
  if (!S.state?.evdev && mins > 0 && S.view === 'home' && !S.saverOn && Date.now() - S.localIdle > mins * 60000) startSaver();
}, 5000);

/* ---------- Start ---------- */
(async function init() {
  try { await load(); } catch (e) {
    document.body.innerHTML = '<div style="padding:10vh;font-family:serif;font-size:4vh">Lichtung startet …</div>';
    setTimeout(() => location.reload(), 2000);
    return;
  }
  renderHome();
  loadWeather();
  setInterval(loadWeather, 10 * 60 * 1000);
  setInterval(tick, 1000);


  // Erster Start überhaupt → Einrichtungsassistent
  const start = () => {
    // Profilauswahl nur beim ersten Start – nach einem Video geht es direkt zur Startseite
    const chosen = sessionStorage.getItem('lichtung-profile');
    renderHome();
    if (chosen && chosen === S.state.active) show('home');
    else if (S.state.profiles.length === 1 && !S.state.profiles[0].hasPin) { sessionStorage.setItem('lichtung-profile', S.state.profiles[0].id); show('home'); }
    else renderProfiles(true);
  };
  if (!S.state.general.setupDone) runSetup(start);
  else start();
  // sanftes Einblenden nach dem Bootbildschirm
  requestAnimationFrame(() => document.body.classList.add('ready'));
})();
