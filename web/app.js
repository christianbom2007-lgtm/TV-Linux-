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
  { title: 'YouTube', subtitle: 'Kino-Fenster in Brave, ohne Werbung', url: 'https://www.youtube.com/', open: 'kino', size: 'gross', hue: 8 },
  { title: 'Brave', subtitle: 'Normaler Browser · suchen & surfen', url: 'lichtung:browser', open: 'tab', hue: 20 },
  { title: 'Live-TV', subtitle: 'ARD, ZDF, NDR und mehr', url: 'lichtung:live', open: 'lichtung', hue: 205 },
  { title: 'Handy spiegeln', subtitle: 'iPhone, Android, Samsung', url: 'lichtung:mirror', open: 'lichtung', hue: 265 },
  { title: 'Programme', subtitle: 'Terminal, App-Store, Spiele', url: 'lichtung:apps', open: 'lichtung', hue: 150 },
  { title: 'Musikbox', subtitle: 'Handy-Musik über den Fernseher', url: 'lichtung:music', open: 'lichtung', hue: 300 },
  { title: 'Ambiente', subtitle: 'Kaminfeuer, Regen, Aquarium, Nordlicht', url: 'lichtung:ambient', open: 'lichtung', hue: 18 },
  { title: 'ARD Mediathek', subtitle: 'Filme, Serien, Dokus', url: 'https://www.ardmediathek.de/', hue: 220 },
  { title: 'ZDF Mediathek', subtitle: 'Sendungen auf Abruf', url: 'https://www.zdf.de/', hue: 28 },
  { title: 'arte', subtitle: 'Kultur und Dokus', url: 'https://www.arte.tv/de/', hue: 18 },
  { title: '3sat', subtitle: 'Mediathek', url: 'https://www.3sat.de/', hue: 340 },
  { title: 'NDR Mediathek', subtitle: 'Aus dem Norden', url: 'https://www.ndr.de/mediathek/', hue: 200 },
  { title: 'Netflix', subtitle: 'Serien und Filme', url: 'https://www.netflix.com/browse', open: 'kino', hue: 356 },
  { title: 'Prime Video', subtitle: 'Amazon', url: 'https://www.amazon.de/gp/video/storefront', open: 'kino', hue: 195 },
  { title: 'Disney+', subtitle: 'Filme und Serien', url: 'https://www.disneyplus.com/', open: 'kino', hue: 230 },
  { title: 'Joyn', subtitle: 'Live und auf Abruf', url: 'https://www.joyn.de/', hue: 280 },
  { title: 'RTL+', subtitle: 'Mediathek', url: 'https://plus.rtl.de/', hue: 10 },
  { title: 'Twitch', subtitle: 'Livestreams', url: 'https://www.twitch.tv/', open: 'kino', hue: 265 },
  { title: 'Spotify', subtitle: 'Musik und Podcasts', url: 'https://open.spotify.com/', hue: 140 },
  { title: 'Terminal', subtitle: 'Befehle & Programme installieren', url: 'app:terminal', open: 'lichtung', hue: 100 },
  { title: 'App-Store', subtitle: 'Programme aus Flathub', url: 'app:store', open: 'lichtung', hue: 48 },
  { title: 'Retro-Spiele', subtitle: 'RetroArch mit Gamepad', url: 'app:retro', open: 'lichtung', hue: 300 },
  { title: 'Galaxy Book', subtitle: 'PC-Bildschirm aufs TV (Moonlight)', url: 'app:galaxy', open: 'lichtung', hue: 225 },
  { title: 'Zufallsdoku', subtitle: 'Überrasch mich', url: 'lichtung:doku', open: 'lichtung', hue: 100 },
];
/* Designarten der Oberfläche: id, Name, Beschreibung, Vorschau-Farben [Hintergrund, Text, Kachel, Akzent, Schrift] */
const THEMES = [
  ['klar', 'Klar', 'Schlicht & ruhig', ['#101112', '#ececec', '#1d1e20', '#ececec', "'Noto Sans', sans-serif"]],
  ['lichtung', 'Lichtung', 'Serif & Natur', ['#0c110f', '#efe9df', '#2b3a33', '#c8a26b', "'Fraunces', serif"]],
  ['kino', 'Kino', 'Schwarz & groß', ['#000', '#fff', '#2a1210', '#d9463b', "'Noto Sans', sans-serif"]],
  ['glas', 'Glas', 'Rund & hell', ['#2a3440', '#fff', 'rgba(255,255,255,.25)', '#e9edf2', "'Noto Sans', sans-serif"]],
  ['hell', 'Hell', 'Für tagsüber', ['#efe9df', '#1b1d1c', '#3b4a43', '#9a6b2f', "'Fraunces', serif"]],
  ['neon', 'Neon', 'Leuchtend', ['#12062a', '#e9e6ff', '#2a0f45', '#7cf3ff', "'JB Mono', monospace"]],
  ['cupertino', 'Cupertino', 'Wie Apple TV', ['#12142e', '#fff', 'rgba(255,255,255,.18)', '#ffffff', "'Noto Sans', sans-serif"]],
  ['one', 'One', 'Wie Samsung TV', ['#060c1c', '#eef3ff', '#14254a', '#3e8bff', "'Noto Sans', sans-serif"]],
  ['flamme', 'Flamme', 'Wie Fire TV', ['#0a1220', '#f4f6fa', '#16243a', '#ff9900', "'Noto Sans', sans-serif"]],
  ['konsole', 'Konsole', 'Wie Xbox', ['#050605', '#fff', '#1c2a1e', '#3fd65b', "'Noto Sans', sans-serif"]],
  ['fenster', 'Fenster', 'Wie Windows 11', ['#0b1226', '#fff', 'rgba(255,255,255,.08)', '#60a5fa', "'Noto Sans', sans-serif"]],
  ['adwaita', 'Adwaita', 'Wie GNOME', ['#1e1f29', '#fff', '#2e3040', '#7aa2f7', "'Noto Sans', sans-serif"]],
  ['breeze', 'Breeze', 'Wie KDE Plasma', ['#141a20', '#eff0f1', '#232a32', '#3daee9', "'Noto Sans', sans-serif"]],
  ['aubergine', 'Aubergine', 'Wie Ubuntu', ['#2c001e', '#fff', '#4a1a3c', '#e95420', "'Noto Sans', sans-serif"]],
  ['matrix', 'Terminal', 'Hacker-Look', ['#000', '#7dff9a', '#061a0b', '#3cff6e', "'JB Mono', monospace"]],
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
  return { scene: photo ? 'nacht' : (g.background || 'nacht'), motion: g.motion || 'voll', weatherFx: g.weatherFx !== false, aurora: !!g.aurora,
    season: !!g.season && !photo, seasonFx: g.seasonFx !== false };
}

function applyLook() {
  const g = S.state.general;
  document.documentElement.style.setProperty('--accent', g.accent || '#c8a26b');
  // Designart: eine Klasse am <body> schaltet Farben, Schriften und Formen um
  THEMES.forEach(([id]) => document.body.classList.toggle('theme-' + id, (g.theme || 'lichtung') === id));
  document.documentElement.style.setProperty('--dim', g.dim ?? 0.55);
  // Lebendiger Hintergrund: eine Szene, die Uhrzeit, Mond und Wetter folgt
  if (!S.scene) {
    S.scene = new L.Scene($('#bg'), sceneOpts(g));
    // Tagsüber den Hintergrund weniger abdunkeln, damit man den Tag auch sieht
    S.scene.onLight = (l) => document.documentElement.style.setProperty('--dim', Math.max(0.12, (S.state.general.dim ?? 0.55) - l * 0.32));
    S.scene.start();
  }
  S.scene.setLocation(g.lat, g.lon);
  // „Klar“: ruhiger, einfarbiger Hintergrund – keine Landschaft, keine Effekte
  if ((g.theme || 'lichtung') === 'klar') { S.scene.stop(); S.klarStopped = true; }
  else if (S.klarStopped) { S.klarStopped = false; S.scene.start(); }
  S.scene.setPhoto((g.background || '').startsWith('/') ? g.background : null);
  S.scene.set(sceneOpts(g));
  window.applyWebcam?.(g);   // Live-Webcam als Hintergrund (über der Landschaft)
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
  const tc = $('#tclock'); if (tc) tc.textContent = L.pad(d.getHours()) + ':' + L.pad(d.getMinutes());
  $('#vdate').textContent = d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
  const g = $('#greet');
  const greet = L.greeting(d);
  if (g.dataset.v !== greet + S.state?.active) {
    g.dataset.v = greet + S.state?.active;
    g.innerHTML = `${greet.replace(/[.!]+$/, '')}<small>${L.esc(L.dateStr(d))}</small>`;
  }
  if (S.saverOn) renderSaver();
}

function renderWeather() {
  const w = S.weather, el = $('#weather');
  if (!w || !w.current) { el.innerHTML = `<span class="c">${L.esc(S.state?.general.city || '')}<br>Wetter lädt …</span>`; return; }
  const c = w.current;
  const big = S.state?.general.bigWeather !== false && w.daily && w.daily.time;
  const fc = big ? `<span class="fc">${w.daily.time.slice(1, 4).map((t, i) => `<i>${new Date(t).toLocaleDateString('de-DE', { weekday: 'short' }).replace('.', '')}${L.weatherIcon(w.daily.weather_code[i + 1], 1)}<b>${Math.round(w.daily.temperature_2m_max[i + 1])}°</b><small>${Math.round(w.daily.temperature_2m_min[i + 1])}°</small></i>`).join('')}</span>` : '';
  el.classList.toggle('big', !!big);
  el.innerHTML = `${L.weatherIcon(c.weather_code, c.is_day)}<span class="t">${Math.round(c.temperature_2m)}°</span>
    <span class="c">${L.esc(w.city)}<br>${L.weatherText(c.weather_code)}</span>${fc}`;
}

// Eigene, schlichte Symbole für Lichtung-Kacheln (Websites bekommen ihr echtes Logo automatisch)
const TILE_ICONS = {
  'lichtung:live': '<rect x="2.5" y="5" width="19" height="13" rx="2"/><path d="M8 21h8M12 18v3M9 2.5l3 2.5 3-2.5"/>',
  'lichtung:mirror': '<rect x="7" y="2.5" width="10" height="19" rx="2.2"/><path d="M11 18.5h2M2.5 9a6 6 0 0 1 0 6M21.5 9a6 6 0 0 0 0 6"/>',
  'lichtung:apps': '<rect x="3" y="3" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="2"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2"/>',
  'lichtung:music': '<path d="M9 18V5.5l11-2.5v12.5"/><circle cx="6.5" cy="18" r="2.7"/><circle cx="17.5" cy="15.5" r="2.7"/>',
  'lichtung:ambient': '<path d="M12 21.5c-4 0-7-2.8-7-6.6 0-3.3 2.2-5.3 3.6-7.4.5 1.6 1.3 2.6 2.4 3.1C11 7 12.6 4.4 15 2.5c.3 3.4 4 5.8 4 11.4 0 4.6-3.1 7.6-7 7.6z"/><path d="M12 21.5c-1.7 0-3-1.3-3-3 0-2 1.5-3 3-4.8 1.5 1.8 3 2.8 3 4.8 0 1.7-1.3 3-3 3z"/>',
  'lichtung:radio': '<rect x="2.5" y="8" width="19" height="13" rx="2.2"/><path d="M6 8l11-5.5"/><circle cx="15.5" cy="14.5" r="3"/><path d="M5.5 12.5h4M5.5 16.5h4"/>',
  'lichtung:browser': '<circle cx="12" cy="12" r="9.5"/><path d="M15.8 8.2l-2.2 5.4-5.4 2.2 2.2-5.4z"/>',
  'lichtung:doku': '<rect x="2.5" y="4" width="19" height="16" rx="2"/><path d="M2.5 9h19M7 4l2.5 5M12.5 4l2.5 5M18 4l2.5 5"/><path d="M10 12.5v5l4.5-2.5z"/>',
  'app:terminal': '<rect x="2.5" y="3.5" width="19" height="17" rx="2.2"/><path d="M6.5 9l3.5 3-3.5 3M12.5 15.5h5"/>',
  app: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M8 12h8M12 8v8"/>',
};
// Einheitliche Symbole: jede Kachel bekommt denselben Glas-Ring. Lichtung-Kacheln mit Strich-Symbol,
// Websites mit ihrem Anfangsbuchstaben (gleich groß, gleiche Farbe – nicht bunt durcheinander).
const uniformIcons = () => (S.state?.general?.tileIcons || 'einheitlich') === 'einheitlich';
function tileIcon(t) {
  const u = t.url || '';
  const svg = TILE_ICONS[u] || (u.startsWith('app:') ? TILE_ICONS.app : '');
  const el = h('div', { class: 'logo ring' });
  if (svg) el.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${svg}</svg>`;
  else el.append(h('span', { class: 'mono' }, (t.title || hostOf(u) || '?').trim().charAt(0).toUpperCase()));
  return el;
}

function tileArt(t) {
  if (t.image) return h('div', { class: 'art', style: { backgroundImage: `url("${t.image}")` } });
  const hue = t.hue ?? 200;
  const bg = t.color ? `linear-gradient(135deg, ${t.color}, color-mix(in srgb, ${t.color} 35%, #060807))`
    : `linear-gradient(135deg, hsl(${hue} 32% 26%), hsl(${(hue + 25) % 360} 28% 11%))`;
  const art = h('div', { class: 'art gen', style: { background: bg } });
  if (t.logo && !uniformIcons()) art.append(h('img', { class: 'logo', src: t.logo, alt: '', onload: function () { if (this.naturalWidth && this.naturalWidth < 96) this.classList.add('lowres'); }, onerror: function () { this.remove(); } }));
  else art.append(tileIcon(t));
  return art;
}

const OPEN_BADGE = { kino: 'KINO', tab: '', lichtung: '' };
function tileEl(t, i) {
  const el = h('button', { class: `tile size-${t.size || 'normal'}${!t.image ? ' has-logo' : ''}`, 'data-nav': true, 'data-kind': 'tile', 'data-id': t.id },
    tileArt(t), h('div', { class: 'shade' }),
    h('div', { class: 'num' }, L.pad(i + 1)),
    OPEN_BADGE[t.open] ? h('div', { class: 'tv' }, OPEN_BADGE[t.open]) : null,
    h('div', { class: 'name' }, h('b', {}, t.title), h('span', {}, radioLine(t) || t.subtitle || hostOf(t.url))));
  el.addEventListener('click', () => openTile(t));
  el.addEventListener('contextmenu', (e) => { e.preventDefault(); tileMenu(t); });
  el.addEventListener('navfocus', () => setHero(L.pad(i + 1) + ' · ' + hostOf(t.url), t.title, t.description || t.subtitle || ''));
  return el;
}

// Radio-Kachel zeigt, was gerade läuft
function radioLine(t) {
  const r = S.state?.radio;
  return t.url === 'lichtung:radio' && r && r.playing && r.station ? '▶ ' + r.station.name + (r.title ? ' · ' + r.title : '') : '';
}

function hostOf(url) {
  if (url === 'lichtung:live') return 'Live-Fernsehen';
  if (url === 'lichtung:mirror') return 'Spiegeln';
  if (url === 'lichtung:browser') return 'Brave';
  if (url === 'lichtung:radio') return 'Internetradio';
  if (url === 'lichtung:apps') return 'Programme';
  if (url === 'lichtung:music') return 'Musikbox';
  if (url === 'lichtung:doku') return 'Mediathek';
  if (url === 'lichtung:ambient') return 'Ambiente';
  if ((url || '').startsWith('app:')) return 'Programm';
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
  clearTimeout(S.launchT);
  S.launchT = setTimeout(() => $('#launching').classList.remove('show'), 6000);
}

/* Website in Brave öffnen (mode: 'tab' = normaler Browser, 'kino' = Fenster ohne Leisten).
 * Fehlt Brave (z. B. beim Testen), öffnet sich die Seite hier im Fenster. */
async function openWeb(url, mode = 'tab', title = '') {
  launching(title || hostOf(url) || 'Brave');
  try {
    await api('/api/browser/open', 'POST', { url, mode });
    setTimeout(() => $('#launching').classList.remove('show'), 2500);
  } catch (e) {
    if (url) setTimeout(() => { location.href = url; }, 250);
    else { $('#launching').classList.remove('show'); L.toast(e.message); }
  }
}

async function launchApp(id, title) {
  launching(title || 'Programm');
  try { await api('/api/apps/launch', 'POST', { id }); setTimeout(() => $('#launching').classList.remove('show'), 2500); }
  catch (e) { $('#launching').classList.remove('show'); L.toast(e.message); }
}

function openTile(t) {
  if (!t.url) return editTile(t);
  if (t.url === 'lichtung:mirror') return mirrorHelp();
  if (t.url === 'lichtung:apps') return appsPicker();
  if (t.url === 'lichtung:music') return window.musicBox?.();
  if (t.url === 'lichtung:doku') return window.randomDoc?.();
  if (t.url === 'lichtung:radio') { launching(t.title); setTimeout(() => { location.href = '/radio.html'; }, 250); return; }
  if (t.url === 'lichtung:ambient') { launching(t.title); setTimeout(() => { location.href = '/ambient.html'; }, 250); return; }
  if (t.url === 'lichtung:browser') return openWeb('', 'tab', t.title);
  if (t.url.startsWith('app:')) return launchApp(t.url.slice(4), t.title);
  if (t.url === 'lichtung:live' || t.url.startsWith('/') || t.open === 'lichtung') {
    launching(t.title);
    const url = t.url === 'lichtung:live' ? '/live.html' : t.url;
    setTimeout(() => { location.href = url; }, 250);
    return;
  }
  return openWeb(t.url, t.open || 'tab', t.title);
}

function openContinue(c, fromStart) {
  if (c.player) {
    launching(c.title);
    const url = '/play.html?' + new URLSearchParams({ src: c.player, title: c.title, sub: c.site, key: c.url, dur: c.duration || 0, ...(fromStart ? { start: 0 } : {}) });
    const go = () => { location.href = url; };
    if (fromStart) api('/api/continue?key=' + encodeURIComponent(c.key), 'DELETE').finally(() => setTimeout(go, 150));
    else setTimeout(go, 250);
    return;
  }
  let url = c.url;
  if (c.yt) url = `https://www.youtube.com/watch?v=${c.yt}${fromStart ? '' : '&t=' + Math.floor(c.time) + 's'}`;
  // "Von vorn": Eintrag löschen, damit die Erweiterung nicht automatisch vorspult
  if (fromStart) api('/api/continue?key=' + encodeURIComponent(c.key), 'DELETE').finally(() => openWeb(url, 'tab', c.title));
  else openWeb(url, /youtube\.com/.test(url) ? 'kino' : 'tab', c.title);
}

/* Anleitung: Handy aufs TV bringen (iPhone, Android, YouTube) */
function mirrorHelp(tab) {
  tab = tab || 'android';
  const step = (n, t, d) => h('div', { class: 'mirror-step' }, h('span', { class: 'n' }, n), h('div', {}, h('b', {}, t), h('span', {}, d)));
  const tabs = [['android', 'Android (S26 & Co.)'], ['samsung', 'Samsung & KDE Connect'], ['iphone', 'iPhone & iPad'], ['stream', 'Ohne Entwickler­modus']];
  const body = h('div', {});
  const m = openModal([
    h('h3', {}, 'Handy aufs TV'),
    h('div', { class: 'swatches', style: { gap: 'calc(.8*var(--u))', margin: 'calc(1*var(--u)) 0 calc(2*var(--u))' } }, tabs.map(([id, label]) =>
      h('button', { class: 'btn' + (id === tab ? ' primary' : ''), 'data-nav': true, onclick: () => { m.close(); setTimeout(() => mirrorHelp(id), 60); } }, label))),
    body,
  ]);
  if (tab === 'android') {
    body.append(
      h('div', { class: 'lead', style: { textTransform: 'none', letterSpacing: '.02em' } }, S.state.android ? 'Beste Qualität, mit Ton. Einmal koppeln, danach reicht ein Knopfdruck.' : 'scrcpy ist (noch) nicht installiert – Einstellungen → System → Einrichtung bzw. install.sh erneut ausführen.'),
      h('div', { class: 'mirror-cols' },
        h('div', {}, h('div', { class: 'mirror-h' }, 'Einmalig am Handy'),
          step('1', 'Entwickleroptionen an', 'Einstellungen → Telefoninfo → Softwareinformationen → 7× auf „Buildnummer“ tippen.'),
          step('2', 'Wireless-Debugging an', 'Einstellungen → Entwickleroptionen → Wireless-Debugging einschalten.'),
          step('3', 'Koppeln', '„Gerät mit QR-Code koppeln“ antippen und den Code vom Fernseher scannen.')),
        h('div', {}, h('div', { class: 'mirror-h' }, 'Jedes Mal'),
          step('1', 'Wireless-Debugging an', 'Tipp: Kachel „Wireless-Debugging“ in die Schnelleinstellungen legen.'),
          step('2', 'Spiegeln starten', 'Hier unten – oder in der Handy-Fernbedienung.'),
          step('3', 'Beenden', 'Home-Taste am Fernseher oder „Spiegeln beenden“.'))),
      h('div', { class: 'btns' },
        h('button', { class: 'btn primary', 'data-nav': true, onclick: async () => { m.close(); L.toast('Suche Handy …'); const r = await api('/api/android/mirror', 'POST', {}); L.toast(r.msg || ''); } }, 'Spiegeln starten'),
        h('button', { class: 'btn', 'data-nav': true, onclick: () => { m.close(); androidPair(); } }, 'Handy koppeln (QR)')));
  }
  if (tab === 'iphone') {
    body.append(h('div', { class: 'lead', style: { textTransform: 'none', letterSpacing: '.02em' } }, S.state.airplay ? 'AirPlay-Empfänger „Lichtung“ ist bereit.' : 'AirPlay ist auf diesem Gerät nicht installiert.'),
      step('1', 'Gleiches WLAN', 'iPhone und Laptop im selben Netz.'),
      step('2', 'Kontrollzentrum', 'Oben rechts nach unten wischen.'),
      step('3', 'Bildschirmsynchronisierung → „Lichtung“', 'Das Bild erscheint sofort im Vollbild, mit Ton.'),
      step('4', 'Beenden', 'Am iPhone „Synchronisierung beenden“.'));
  }
  if (tab === 'samsung') {
    body.append(
      h('div', { class: 'lead', style: { textTransform: 'none', letterSpacing: '.02em' } }, 'Ehrlich gesagt: Samsung „Smart View“ (Miracast) ist unter Linux wackelig. Zuverlässig ist KDE Connect – damit steuerst du Videos, Lautstärke und schickst Links vom Handy.'),
      h('div', { class: 'mirror-cols' },
        h('div', {}, h('div', { class: 'mirror-h' }, 'KDE Connect (empfohlen)'),
          step('1', 'App installieren', '„KDE Connect“ aus dem Play Store auf dem Handy.'),
          step('2', 'Gleiches WLAN', 'Der Fernseher erscheint in der App als „lichtung“.'),
          step('3', 'Koppeln', 'Einstellungen → Handy & Verbindung → KDE Connect → Koppeln, dann am Handy bestätigen.'),
          step('4', 'Nutzen', 'Medien steuern, Lautstärke, „Teilen → lichtung“ für Links, Pause bei Anruf.')),
        h('div', {}, h('div', { class: 'mirror-h' }, 'Smart View (experimentell)'),
          step('1', 'Nur mit passendem WLAN-Chip', 'Der Laptop muss „Wi-Fi Direct“ können.'),
          step('2', 'WLAN-Internet ist dabei weg', 'Solange der Empfänger läuft – LAN-Kabel hilft.'),
          step('3', 'Starten', 'Einstellungen → Handy & Verbindung → Smart View-Empfänger.'))),
      h('div', { class: 'btns' }, h('button', { class: 'btn primary', 'data-nav': true, onclick: () => { m.close(); openSettings('remote'); } }, 'Zu den Einstellungen')));
  }
  if (tab === 'stream') {
    const inp = h('input', { class: 'inp', 'data-nav': true, placeholder: 'Adresse aus der App, z. B. 192.168.178.23:8080' });
    body.append(h('div', { class: 'lead', style: { textTransform: 'none', letterSpacing: '.02em' } }, 'Mit der kostenlosen App „ScreenStream“ (Play Store / F-Droid). Kein Entwicklermodus nötig, dafür nur Bild ohne Ton und etwas Verzögerung.'),
      step('1', 'ScreenStream öffnen', 'Modus „Lokal (MJPEG)“ wählen und Stream starten.'),
      step('2', 'Adresse ablesen', 'Die App zeigt eine Adresse wie http://192.168.178.23:8080.'),
      step('3', 'Hier eingeben oder per Handy-Fernbedienung „Link aufs TV“ schicken', ''),
      h('div', { style: { display: 'flex', gap: '1em', marginTop: '1em' } }, inp, h('button', { class: 'btn primary', 'data-nav': true, onclick: () => { let u = inp.value.trim(); if (!u) return; if (!/^https?:/.test(u)) u = 'http://' + u; m.close(); openWeb(u, 'kino', 'Handy-Bild'); } }, 'Öffnen')));
  }
}

/* QR-Code zum Koppeln eines Android-Handys (Wireless-Debugging) */
async function androidPair() {
  const qrBox = h('div', { class: 'qr', style: { width: 'calc(30*var(--u))', height: 'calc(30*var(--u))' } });
  const msg = h('div', { class: 'lead', style: { textTransform: 'none', letterSpacing: '.02em', fontSize: 'calc(1.8*var(--u))' } }, 'Starte …');
  const m = openModal([h('h3', {}, 'Android koppeln'),
    h('div', { class: 'remote-box' }, qrBox, h('div', {}, msg,
      h('p', { class: 'setup-lead' }, 'Am Handy: Entwickleroptionen → Wireless-Debugging → „Gerät mit QR-Code koppeln“ → diesen Code scannen. Handy und Laptop müssen im gleichen WLAN sein.'))),
    h('div', { class: 'btns' }, h('button', { class: 'btn', 'data-nav': true, onclick: () => m.close() }, 'Schließen'))], '');
  const r = await api('/api/android/pair', 'POST', {});
  msg.textContent = r.msg;
  if (r.qr) { try { const qr = qrcode(0, 'M'); qr.addData(r.qr); qr.make(); qrBox.innerHTML = qr.createSvgTag({ cellSize: 6, margin: 0, scalable: true }); } catch (_) {} }
  const poll = setInterval(async () => {
    if (!document.contains(msg)) return clearInterval(poll);
    const st = await api('/api/android').catch(() => null);
    if (st && st.pair) {
      msg.textContent = st.pair.msg;
      if (['fertig', 'fehler', 'abgelaufen'].includes(st.pair.state)) clearInterval(poll);
      if (st.pair.state === 'fertig') L.toast('Android gekoppelt – Spiegeln jetzt per Knopfdruck');
    }
  }, 1500);
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
const SIZES = [['klein', 'Klein'], ['normal', 'Normal'], ['gross', 'Groß'], ['banner', 'Banner']];
const OPENS = [['tab', 'Brave-Tab', 'Normaler Browser mit Adressleiste'], ['kino', 'Kino-Fenster', 'Ohne Leisten, wie eine TV-App'], ['lichtung', 'Lichtung', 'Eigene Seiten (Live-TV, Player)']];

function segmented(opts, cur, onPick) {
  const box = h('div', { class: 'swatches', style: { gap: 'calc(.8*var(--u))' } });
  opts.forEach(([v, n]) => {
    const b = h('button', { class: 'btn' + (cur === v ? ' primary' : ''), 'data-nav': true, onclick: () => { $$('.btn', box).forEach((x) => x.classList.remove('primary')); b.classList.add('primary'); onPick(v); } }, n);
    box.append(b);
  });
  return box;
}

function editTile(t, prefill) {
  const isNew = !t;
  const d = Object.assign({ id: '', title: '', subtitle: '', description: '', url: '', image: '', logo: '', color: '', size: 'normal', open: 'tab', hue: HUES[Math.floor(Math.random() * HUES.length)] }, t || {}, prefill || {});
  const preview = h('div', { class: 'tile-preview' });
  const idx = () => { const i = S.state.tiles.findIndex((x) => x.id === d.id); return i >= 0 ? i : S.state.tiles.length; };
  const paintPreview = () => { preview.innerHTML = ''; const el = tileEl(d, idx()); el.classList.add('preview-tile'); el.removeAttribute('data-nav'); preview.appendChild(el); };

  const inp = (key, ph, type = 'text') => {
    const el = h('input', { class: 'inp', type, placeholder: ph, 'data-nav': true, value: d[key] || '' });
    el.addEventListener('input', () => { d[key] = el.value; paintPreview(); });
    return el;
  };
  const ta = h('textarea', { class: 'inp', placeholder: 'Wird im Info-Bereich angezeigt, wenn die Kachel ausgewählt ist', 'data-nav': true }, d.description || '');
  ta.addEventListener('input', () => { d.description = ta.value; });
  const urlInp = inp('url', 'Website eintippen, z. B. ardmediathek.de – dann „Automatisch“');
  const titleInp = inp('title', 'Name der Kachel');
  const subInp = inp('subtitle', 'Kurzer Untertitel');
  const imgInp = inp('image', 'Bild-Adresse (https://…) – oder per Handy hochladen', 'url');
  const status = h('span', { class: 'lead', style: { margin: 0 } }, '');

  // Automatisch: Titel, Beschreibung, Logo und Farbe von der Website holen
  const auto = async () => {
    let u = urlInp.value.trim();
    if (!u || /^(lichtung|app):/.test(u)) { L.toast('Erst eine Website-Adresse eintippen'); return; }
    if (!/^https?:/.test(u)) u = 'https://' + u;
    status.textContent = 'Hole Titel und Logo …';
    try {
      const i = await api('/api/siteinfo?url=' + encodeURIComponent(u));
      d.url = u; urlInp.value = u;
      if (i.title) { d.title = i.title; titleInp.value = i.title; }
      const sub = (i.description || '').split(/(?<=[.!?])\s/)[0].slice(0, 70);
      if (sub && !d.subtitle) { d.subtitle = sub; subInp.value = sub; }
      if (i.description && !d.description) { d.description = i.description.slice(0, 300); ta.value = d.description; }
      if (i.color) d.color = i.color;
      const logoSrc = i.logo || i.fallbackIcon;
      if (logoSrc) {
        const saved = await api('/api/siteinfo/logo', 'POST', { url: logoSrc }).catch(() => ({}));
        d.logo = saved.url || '';
      }
      status.textContent = i.error ? 'Seite nicht erreichbar – Name aus der Adresse übernommen' : 'Übernommen ✓';
      paintPreview();
    } catch (e) { status.textContent = 'Klappt gerade nicht: ' + e.message; }
  };

  const hues = h('div', { class: 'swatches' }, HUES.map((hu) => {
    const b = h('button', { class: 'swatch' + (hu === d.hue && !d.color ? ' sel' : ''), 'data-nav': true, style: { background: `linear-gradient(135deg, hsl(${hu} 32% 34%), hsl(${(hu + 25) % 360} 28% 14%))` },
      onclick: () => { d.hue = hu; d.color = ''; $$('.swatch', hues).forEach((s) => s.classList.remove('sel')); b.classList.add('sel'); paintPreview(); } });
    return b;
  }));
  const presets = h('div', { class: 'swatches', style: { gap: 'calc(.8*var(--u))' } }, PRESETS.map((p) =>
    h('button', { class: 'btn', 'data-nav': true, onclick: () => {
      Object.assign(d, { title: p.title, subtitle: p.subtitle, url: p.url, open: p.open || 'tab', size: p.size || d.size, hue: p.hue, logo: '', color: '' });
      titleInp.value = d.title; subInp.value = d.subtitle; urlInp.value = d.url; paintPreview();
    } }, p.title)));
  const sizes = segmented(SIZES, d.size, (v) => { d.size = v; paintPreview(); });
  const opens = segmented(OPENS.map(([v, n]) => [v, n]), d.open, (v) => { d.open = v; paintPreview(); });

  const field = (label, ctl, small) => h('div', { class: 'field' }, h('label', {}, label, small ? h('small', {}, small) : null), ctl);
  const m = openModal([
    h('h3', {}, isNew ? 'Neue Kachel' : 'Kachel bearbeiten'),
    h('div', { class: 'lead' }, 'Vorschau'),
    preview,
    field('Adresse', h('div', { style: { display: 'flex', gap: '1em', alignItems: 'center' } }, urlInp,
      h('button', { class: 'btn primary', 'data-nav': true, onclick: auto }, 'Automatisch')), 'Titel, Text, Logo & Farbe holt Lichtung selbst'),
    status,
    field('Name', titleInp),
    field('Untertitel', subInp),
    field('Beschreibung', ta),
    field('Öffnen als', opens, 'Brave-Tab = normaler Browser · Kino = ohne Leisten'),
    field('Größe', sizes),
    field('Vorlage', presets, 'Füllt alles mit einem Klick'),
    field('Programm', h('button', { class: 'btn', 'data-nav': true, onclick: () => appsPicker((a) => {
      Object.assign(d, { title: a.name, subtitle: a.desc || 'Programm', url: 'app:' + a.id, open: 'lichtung', logo: '' });
      titleInp.value = d.title; subInp.value = d.subtitle; urlInp.value = d.url; paintPreview();
    }) }, 'Programm als Kachel wählen …'), 'Terminal, App-Store, Spiele oder installierte Apps'),
    field('Farbe', hues, 'Falls kein Bild gesetzt ist'),
    field('Logo', h('div', { style: { display: 'flex', gap: '1em' } },
      h('button', { class: 'btn', 'data-nav': true, onclick: () => { d.logo = ''; paintPreview(); } }, 'Logo entfernen')), ''),
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
  setTimeout(() => Nav.focus(urlInp, { instant: true }), 30);
  if (prefill && prefill.url && !prefill.title) setTimeout(auto, 100);
}

/* ============================================================
 * 5. Einstellungen
 * ============================================================ */
const SECTIONS = [
  ['tiles', 'Kacheln'], ['profiles', 'Profile'], ['browser', 'Browser & YouTube'], ['apps', 'Programme'],
  ['channels', 'Live-TV-Sender'], ['recorder', 'Mediathek-Rekorder'], ['look', 'Aussehen'], ['boot', 'Start & Boot'], ['weather', 'Wetter & Ort'],
  ['audio', 'Ton'], ['saver', 'Bildschirmschoner'], ['remote', 'Handy & Verbindung'], ['bluetooth', 'Bluetooth'],
  ['services', 'Netzwerk-Dienste'], ['power', 'Energie'], ['system', 'System & Updates'], ['diagnose', 'Fehlersuche'], ['help', 'Tasten & Hilfe'],
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


/* ---------- Ton-Assistent ----------
 * Probiert nacheinander Wege aus, die Laptop-Lautsprecher zum Laufen zu bringen.
 * Bei jedem Versuch spielt der Laptop einen Testton und fragt: Hörst du ihn?
 * Startet nur auf Knopfdruck – oder einmal nach einem Neustart, den er selbst
 * ausgelöst hat (älterer Treiber). */
async function audioWizard(from) {
  const body = h('div', {});
  const m = openModal([h('h3', {}, 'Ton-Assistent'), body], 'small');
  const step = (title, text, buttons) => {
    body.innerHTML = '';
    body.append(h('div', { class: 'lead', style: { textTransform: 'none' } }, title), h('p', { style: { fontSize: 'calc(2*var(--u))', lineHeight: 1.5 } }, text),
      h('div', { class: 'btns' }, buttons.map((b, i) => h('button', { class: 'btn' + (b.primary ? ' primary' : '') + (b.danger ? ' danger' : ''), 'data-nav': true, 'data-nav-default': i === 0 || null, onclick: b.run }, b.label))));
    setTimeout(() => Nav.first(), 30);
  };
  const busy = (t) => { body.innerHTML = ''; body.append(h('p', { style: { fontSize: 'calc(2*var(--u))' } }, t)); };
  const call = async (action, extra = {}) => { busy('Einen Moment, ich probiere etwas aus … (bis zu 20 Sekunden)'); show(await api('/api/audio/wizard', 'POST', Object.assign({ action }, extra)).catch((e) => ({ kind: 'error', error: e.message }))); };
  const cancel = async () => { await api('/api/audio/wizard', 'POST', { action: 'cancel' }).catch(() => {}); m.close(); };
  function show(r) {
    if (r.kind === 'listen') step(`Versuch ${r.step} von ${r.total}: ${r.title}`, 'Der Laptop spielt gerade einen Gong. Hörst du ihn aus den Lautsprechern des LAPTOPS (nicht aus dem Monitor)?', [
      { label: 'Ja, höre ich', primary: true, run: () => call('heard') },
      { label: 'Nein', run: () => call('notheard') },
      { label: 'Nochmal abspielen', run: () => { api('/api/audio/wizard', 'POST', { action: 'replay' }); L.toast('Gong …'); } },
      { label: 'Abbrechen', run: cancel }]);
    else if (r.kind === 'reboot') step(`Versuch ${r.step} von ${r.total}: ${r.title}`, 'Die einfachen Wege haben nicht geklappt. Als Nächstes probiere ich den älteren Soundtreiber. Dafür startet der Laptop neu – danach geht der Assistent automatisch weiter. Lässt sich jederzeit zurückstellen (Fehlersuche → Ton).', [
      { label: 'Neu starten und probieren', primary: true, run: () => call('reboot', { legacy: true }) },
      { label: 'Abbrechen', run: cancel }]);
    else if (r.kind === 'done') { step('Geschafft ✓', 'Die Laptop-Lautsprecher funktionieren. Ab jetzt spielt der Ton über Laptop und Fernseher gleichzeitig – das wird bei jedem Start so eingerichtet. Umstellen unter Einstellungen → Ton.', [{ label: 'Fertig', primary: true, run: () => { m.close(); if (S.view === 'settings') renderSection(true); } }]); }
    else if (r.kind === 'failed') step('Leider nicht geklappt', 'Ich habe alles ausprobiert, was ohne Bastelei geht. Die Laptop-Lautsprecher werden auf diesem Modell von Linux vermutlich (noch) nicht unterstützt. Der Ton läuft weiter über den Monitor. ' + (r.legacy ? 'Der ältere Treiber ist noch aktiv – zurückstellen unter Fehlersuche → Ton.' : '') + ' Tipp: Eine kleine Bluetooth-Box oder Soundbar klingt deutlich besser als Monitor-Lautsprecher.', [{ label: 'Schließen', primary: true, run: () => m.close() }]);
    else if (r.ok) m.close();
    else step('Fehler', r.error || 'Unbekannter Fehler', [{ label: 'Schließen', run: () => m.close() }]);
  }
  call('start', from ? { from } : {});
}

/* ---------- Fehlersuche ---------- */
async function renderDiagnose(add, head) {
  head('Fehlersuche', 'Prüft Lichtung nach Themen. Grün = in Ordnung, gelb = Hinweis, rot = Problem. Wo es geht, gibt es einen Knopf zum Reparieren.');
  const out = h('div', {});
  const topics = (await api('/api/diag').catch(() => ({ topics: [] }))).topics || [];
  const bar = h('div', { class: 'btns', style: { flexWrap: 'wrap' } });
  const FIX = { 'audio-repair': 'Ton reparieren', 'audio-apply': 'Neu einrichten', 'audio-wizard': 'Ton-Assistent', 'audio-sof': 'Neuen Treiber zurück', 'bt-power': 'Einschalten', 'update-check': 'Jetzt prüfen' };
  async function runTopic(t, keep) {
    const sec = h('div', { style: { marginTop: 'calc(2*var(--u))' } }, h('div', { class: 'lead' }, t.title + ' – prüfe …'));
    if (!keep) out.innerHTML = '';
    out.append(sec);
    const r = await api('/api/diag?topic=' + t.id).catch((e) => ({ items: [{ name: 'Fehler', state: 'fail', detail: e.message }] }));
    sec.innerHTML = '';
    sec.append(h('div', { class: 'lead' }, t.title));
    r.items.forEach((it) => {
      const color = it.state === 'ok' ? '#7fbf8e' : it.state === 'warn' ? '#e0b45c' : '#e0705c';
      sec.append(h('div', { class: 'list-row', style: { alignItems: 'center', gap: 'calc(1.6*var(--u))' } },
        h('span', { style: { width: 'calc(1.4*var(--u))', height: 'calc(1.4*var(--u))', borderRadius: '50%', background: color, flex: 'none' } }),
        h('div', { style: { flex: 1 } }, h('div', {}, it.name), it.detail ? h('div', { class: 'lead', style: { textTransform: 'none', margin: 0 } }, it.detail) : null),
        it.fix ? h('button', { class: 'btn', 'data-nav': true, onclick: async () => {
          if (it.fix === 'audio-wizard') return audioWizard();
          const f = await api('/api/diag/fix', 'POST', { action: it.fix }).catch((e) => ({ msg: e.message }));
          L.toast(f.msg || 'Erledigt', 5000);
          setTimeout(() => runTopic(t), 4000);
        } }, FIX[it.fix] || 'Reparieren') : null));
    });
  }
  bar.append(h('button', { class: 'btn primary', 'data-nav': true, onclick: async () => { out.innerHTML = ''; for (const t of topics) await runTopic(t, true); } }, 'Alles prüfen'));
  topics.forEach((t) => bar.append(h('button', { class: 'btn', 'data-nav': true, onclick: () => runTopic(t) }, t.title)));
  add(bar, out);
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
      add(field('Profil-Autostart', stepper(Number(g.profileAutoSeconds ?? 2), { min: 0, max: 10, step: 1, fmt: (v) => v ? v + ' Sek.' : 'Aus' }, (v) => saveGeneral({ profileAutoSeconds: v })), 'Wartezeit bis zum Standardprofil'));
      add(field('Eigene Brave-Logins je Profil', toggle(g.braveProfiles !== false, (v) => saveGeneral({ braveProfiles: v })), 'Jedes Profil hat eigene Anmeldungen (YouTube, Netflix …), Verlauf und Lesezeichen'));
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
      head('Ton', 'Klang und wohin der Ton geht. „Automatisch“: Musikanlage per USB zuerst, dann der Monitor per HDMI, sonst der Laptop.');
      const box = h('div', { class: 'menu-list', style: { maxWidth: 'calc(80*var(--u))' } }, h('div', { class: 'lead' }, 'Lade …'));
      const klangBox = h('div');
      add(klangBox, h('div', { class: 'lead', style: { marginTop: 'calc(2*var(--u))' } }, 'Einzelner Ausgang'), box);
      api('/api/audio').then((a) => {
        const st = a.settings || {};
        const setK = async (patch, msg) => { L.toast(msg + ' – Ton ist kurz weg …', 4000); await api('/api/audio/klang', 'POST', patch); };
        klangBox.innerHTML = '';
        klangBox.append(
          field('Klang', segmented([['aus', 'Aus'], ...(a.presets || []).map((p) => [p.id, p.title])], st.klang || 'aus', (v) => setK({ klang: v }, 'Klang: ' + (((a.presets || []).find((p) => p.id === v) || {}).title || 'Aus'))),
            '„Warm“ nimmt kleinen Monitor-Lautsprechern das Blecherne, „Sprache klar“ hilft bei Nachrichten und Filmen'),
          field('Ausgabe', segmented([['auto', 'Automatisch'], ['beide', 'Laptop + Fernseher'], ['einzeln', 'Einzeln']], st.output || 'auto', (v) => setK({ output: v }, v === 'auto' ? 'Automatisch (HDMI zuerst)' : v === 'beide' ? 'Beide Lautsprecher' : 'Einzelner Ausgang')),
            '„Automatisch“: USB-Musikanlage oder Monitor wird sofort genommen, Laptop bleibt still. Bei „Beide“ kann der Fernseher minimal nachhallen'));
        klangBox.append(h('div', { class: 'btns', style: { margin: 'calc(1.6*var(--u)) 0' } },
          h('button', { class: 'btn primary', 'data-nav': true, onclick: () => audioWizard() }, st.speakerSink ? 'Ton-Assistent erneut starten' : 'Ton-Assistent: Laptop-Lautsprecher einrichten'),
          h('button', { class: 'btn', 'data-nav': true, onclick: async () => { await api('/api/audio/repair', 'POST', {}); L.toast('Ton wird repariert …', 5000); } }, 'Ton reparieren'),
          h('button', { class: 'btn', 'data-nav': true, onclick: () => openSettings('diagnose') }, 'Fehlersuche')));
        if (a.report && a.report.length) klangBox.append(h('div', { class: 'lead', style: { textTransform: 'none' } }, 'Zuletzt: ' + a.report.join(' · ')));
        box.innerHTML = '';
        const real = (a.sinks || []).filter((sk) => !sk.virtual);
        if (!real.length) box.append(h('div', { class: 'lead' }, 'Keine Ausgänge gefunden (PipeWire läuft nicht?).'));
        real.forEach((sk) => {
          const on = st.output === 'einzeln' ? st.sink === sk.node : st.output === 'auto' ? (a.target ? a.target === sk.node : sk.default) : (!st.klang || st.klang === 'aus') && st.output !== 'beide' && sk.default;
          box.append(h('button', { 'data-nav': true, onclick: async () => { await api('/api/audio', 'POST', { id: sk.id }); L.toast('Ton über ' + sk.name); renderSection(true); } },
            h('span', {}, sk.name.replace(/Headphones|Kopfhörer/i, 'Laptop (Lautsprecher/Kopfhörer)')), h('span', { class: 'k' }, (on ? 'aktiv ✓ ' : '') + (sk.hdmi ? 'HDMI' : sk.usb ? 'USB' : ''))));
        });
        if (S.view === 'settings' && !$('#s-body').contains(Nav.current)) return;
        const f = klangBox.querySelector('[data-nav]') || box.firstElementChild;
        if (f) Nav.focus(f, { instant: true });
      });
      add(field('Lautstärke-Schritt', stepper(Number(g.volumeStep || 5), { min: 1, max: 20, step: 1, fmt: (v) => v + ' %' }, (v) => saveGeneral({ volumeStep: v })), 'Pro Tastendruck'));
      add(h('div', { class: 'btns' }, h('button', { class: 'btn', 'data-nav': true, onclick: () => api('/api/key', 'POST', { key: 'voldown' }) }, 'Leiser'),
        h('button', { class: 'btn', 'data-nav': true, onclick: () => api('/api/key', 'POST', { key: 'volup' }) }, 'Lauter'),
        h('button', { class: 'btn', 'data-nav': true, onclick: () => openSettings('system') }, 'Tasten testen (Systeminfo)')));
      break;
    }
    case 'diagnose':
      renderDiagnose(add, head);
      break;
    default:
      window.renderExtraSection?.(S.section, { add, head, body, g, field, toggle, stepper, saveGeneral });
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
  S.saverPhoto = -1;
  const g = S.state.general;
  if (!S.saverScene) S.saverScene = new L.Scene($('#saver-bg'), Object.assign(sceneOpts(g), { scale: 0.5 }));
  S.saverScene.setLocation(g.lat, g.lon);
  S.saverScene.setPhoto((g.background || '').startsWith('/') ? g.background : null);
  if (S.weather?.current) S.saverScene.setWeather(S.weather);
  S.saverScene.set(Object.assign(sceneOpts(g), { scale: 0.5 }));
  S.scene?.stop();
  if (g.saverStyle === 'minimal' || (g.saverStyle || 'aurora') === 'aurora') S.saverScene.stop();
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
  const d = new Date(), w = S.weather, style = S.state.general.saverStyle || 'aurora';
  const el = $('#saver-content');
  $('#saver').dataset.style = style;
  $('#saver').classList.toggle('night', d.getHours() >= 23 || d.getHours() < 6);
  if (style === 'aurora') return renderAurora(d, w, el, move);
  let wx = '';
  if (w && w.current && style !== 'minimal') {
    const days = (w.daily?.time || []).slice(1, 4).map((t, i) => `<div>${new Date(t).toLocaleDateString('de-DE', { weekday: 'short' })}${L.weatherIcon(w.daily.weather_code[i + 1], 1)}<b>${Math.round(w.daily.temperature_2m_max[i + 1])}° / ${Math.round(w.daily.temperature_2m_min[i + 1])}°</b></div>`).join('');
    wx = `<div class="w">${L.weatherIcon(w.current.weather_code, w.current.is_day)}<span class="t">${Math.round(w.current.temperature_2m)}°</span><span>${L.esc(w.city)} · ${L.weatherText(w.current.weather_code)}</span></div><div class="fc">${days}</div>`;
  }
  if (style === 'analog') {
    const hh = (d.getHours() % 12) * 30 + d.getMinutes() * 0.5, mm = d.getMinutes() * 6, ss = d.getSeconds() * 6;
    el.innerHTML = `<svg class="analog" viewBox="-50 -50 100 100">${Array.from({ length: 12 }, (_, i) => `<line x1="0" y1="-44" x2="0" y2="${i % 3 ? -41 : -38}" transform="rotate(${i * 30})"/>`).join('')}
      <line class="hh" x1="0" y1="4" x2="0" y2="-24" transform="rotate(${hh})"/><line class="mm" x1="0" y1="6" x2="0" y2="-36" transform="rotate(${mm})"/>
      <line class="ss" x1="0" y1="8" x2="0" y2="-40" transform="rotate(${ss})"/><circle r="1.6"/></svg><div class="meta"><div class="d">${L.esc(L.dateStr(d))}</div>${wx}</div>`;
  } else {
    el.innerHTML = `<div class="digits">${clockHTML(d)}</div><div class="meta"><div class="d">${L.esc(L.dateStr(d))}</div>${wx}</div>`;
  }
  // Fotos: alle 20 Sekunden das nächste eigene Foto
  if (style === 'fotos') {
    const photos = S.state.general.customBackgrounds || [];
    if (photos.length && (move || d.getSeconds() % 20 === 0)) {
      S.saverPhoto = ((S.saverPhoto ?? -1) + 1) % photos.length;
      S.saverScene?.setPhoto(photos[S.saverPhoto]);
    }
  }
  // Position jede Minute leicht ändern → kein Einbrennen bei OLED/Plasma
  if (move || d.getSeconds() < 1) {
    el.style.left = (6 + Math.random() * 30) + 'vw';
    el.style.top = (12 + Math.random() * 30) + 'vh';
  }
}

/* Stil „Aurora“: wandernde Farbschleier, große Uhr mit Sekunden-Linie,
   Wetter in Glas-Karten, „Zuletzt geschaut“ und ein Gruß. Das Gerüst wird
   nur einmal pro Minute neu gebaut, jede Sekunde ändern sich nur Zahlen. */
function renderAurora(d, w, el, move) {
  const sec = d.getSeconds();
  if (!el.querySelector('.au') || move || sec === 0) {
    let wx = '';
    if (w && w.current) {
      const days = (w.daily?.time || []).slice(1, 4).map((t, i) => `<div class="au-day"><span>${new Date(t).toLocaleDateString('de-DE', { weekday: 'short' })}</span>${L.weatherIcon(w.daily.weather_code[i + 1], 1)}<b>${Math.round(w.daily.temperature_2m_max[i + 1])}°</b><small>${Math.round(w.daily.temperature_2m_min[i + 1])}°</small></div>`).join('');
      wx = `<div class="au-wx"><div class="au-now">${L.weatherIcon(w.current.weather_code, w.current.is_day)}<b>${Math.round(w.current.temperature_2m)}°</b><span>${L.esc(L.weatherText(w.current.weather_code))}<small>${L.esc(w.city || '')}</small></span></div>${days}</div>`;
    }
    const c = (S.state.continue || [])[0];
    const cw = c ? `<div class="au-cw">${c.image ? `<img src="${L.esc(c.image)}" alt="">` : ''}<div><small>Zuletzt geschaut</small><b>${L.esc(c.title || '')}</b>${c.duration ? `<i><em style="width:${Math.min(100, Math.round((c.time / c.duration) * 100))}%"></em></i>` : ''}</div></div>` : '';
    const name = (typeof profile === 'function' && profile()?.name) || '';
    el.innerHTML = `<div class="au">
      <div class="au-greet">${L.esc(L.greeting(d).replace(/[.!]+$/, ''))}${name ? ', ' + L.esc(name) : ''}</div>
      <div class="au-clock"><span class="hh">${L.pad(d.getHours())}</span><span class="colon">:</span><span class="mm">${L.pad(d.getMinutes())}</span></div>
      <div class="au-sec"><i></i></div>
      <div class="au-date">${L.esc(L.dateStr(d))}</div>
      ${wx}${cw}</div>`;
    if (move || sec === 0) {   // leicht wandern → kein Einbrennen
      el.style.left = (5 + Math.random() * 8) + 'vw';
      el.style.top = (8 + Math.random() * 10) + 'vh';
    }
  }
  const bar = el.querySelector('.au-sec i');
  if (bar) bar.style.transform = `scaleX(${(sec + 1) / 60})`;
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
    case 'q': case 'Q':
      if (typing || top) return false;
      window.quickMenu?.(); return true;
    case 'b': case 'B':
      if (typing || top || S.view !== 'home') return false;
      openWeb('', 'tab', 'Brave'); return true;
    case '/':
      if (typing || top || S.view !== 'home') return false;
      { const q = $('#search-inp'); if (q) Nav.focus(q); } return true;
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
  else if (ev.type === 'home') { $('#launching').classList.remove('show'); goHome(); }
  else if (ev.type === 'quick') { goHome(); window.quickMenu?.(); }
  else if (ev.type === 'mini') window.miniWindow?.(ev);
  else if (ev.type === 'incoming') window.incomingLink?.(ev);
  else if (ev.type === 'updating') L.toast('Update wird eingespielt – der Fernseher startet gleich neu …', 15000);
  else if (ev.type === 'audiodone') {
    L.toast(ev.ok ? 'Ton-Einstellung aktiv ✓' : (ev.error || 'Ton: Fehler'), 5000);
    if (S.view === 'settings' && S.section === 'audio') renderSection(true);
  } else if (ev.type === 'radio') {
    S.state.radio = ev;
    document.querySelectorAll('.tile[data-kind="tile"]').forEach((el) => {
      const t = (S.state.tiles || []).find((x) => x.id === el.dataset.id);
      if (t && t.url === 'lichtung:radio') el.querySelector('.name span').textContent = radioLine(t) || t.subtitle || hostOf(t.url);
    });
  } else if (ev.type === 'update') L.toast('Update verfügbar (' + ev.latest + ') – Einstellungen → System & Updates', 8000);
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
  // Nur wenn der Ton-Assistent selbst neu gestartet hat (älterer Treiber): einmal weitermachen.
  // Sonst erscheint er nie von allein.
  if (S.state.general.setupDone && S.state.audioWizardPending && !sessionStorage.getItem('lichtung-audiowiz')) {
    sessionStorage.setItem('lichtung-audiowiz', '1');
    setTimeout(() => audioWizard('legacy'), 12000);     // Ton-System braucht nach dem Start ein paar Sekunden
  }
  // sanftes Einblenden nach dem Bootbildschirm
  requestAnimationFrame(() => document.body.classList.add('ready'));
})();
