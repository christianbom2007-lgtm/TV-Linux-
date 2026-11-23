/* Lichtung TV – Erweiterungen der Startoberfläche (Version 2)
 * ------------------------------------------------------------
 *  1. Startseite: Such- und Knopfleiste, "Zuletzt besucht"
 *  2. Programme-Auswahl, Schnellmenü, Link vom Handy empfangen
 *  3. Design-Pakete
 *  4. Einstellungsbereiche: Browser & YouTube, Programme, Aussehen,
 *     Start & Boot, Bildschirmschoner, Handy & Verbindung, Bluetooth,
 *     Energie, System & Updates, Tasten & Hilfe
 * Nutzt die Bausteine aus app.js (S, h, api, Nav, openModal, menu, field …).
 */
'use strict';

/* ============================================================
 * 1. Startseite
 * ============================================================ */
const SEARCHES = {
  brave: ['Brave Search', (q) => 'https://search.brave.com/search?q=' + encodeURIComponent(q)],
  youtube: ['YouTube', (q) => 'https://www.youtube.com/results?search_query=' + encodeURIComponent(q)],
  duck: ['DuckDuckGo', (q) => 'https://duckduckgo.com/?q=' + encodeURIComponent(q)],
  google: ['Google', (q) => 'https://www.google.de/search?q=' + encodeURIComponent(q)],
};

function runSearch(q, where) {
  q = (q || '').trim();
  if (!q) return;
  if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(q) || /^https?:\/\//.test(q)) return openWeb(/^https?:/.test(q) ? q : 'https://' + q, 'tab', q);
  if (where === 'mediathek') return openSearch(q);
  const eng = SEARCHES[where] || SEARCHES[S.state.general.searchEngine || 'brave'] || SEARCHES.brave;
  openWeb(eng[1](q), where === 'youtube' ? 'kino' : 'tab', eng[0] + ': ' + q);
}

function quickBtn(label, icon, onclick, hero) {
  const b = h('button', { class: 'qbtn', 'data-nav': true, onclick }, h('span', { class: 'ic', html: icon }), label);
  if (hero) b.addEventListener('navfocus', () => setHero(...hero));
  return b;
}

const IC = {
  brave: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z"/></svg>',
  yt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="6" width="18" height="12" rx="3"/><path d="M10.5 9.5l4 2.5-4 2.5z"/></svg>',
  apps: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="4" width="6" height="6" rx="1.5"/><rect x="4" y="14" width="6" height="6" rx="1.5"/><rect x="14" y="14" width="6" height="6" rx="1.5"/></svg>',
  quick: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>',
};

function renderQuick() {
  const row = $('#quick-row');
  const block = $('#quick-block');
  if (!row) return;
  block.hidden = S.state.general.quickbar === false;
  if (block.hidden) return;
  const keepSearch = document.activeElement && document.activeElement.id === 'search-inp' ? document.activeElement.value : null;
  row.innerHTML = '';
  const inp = h('input', { class: 'inp search-inp', id: 'search-inp', 'data-nav': true, placeholder: 'Suchen oder Adresse eingeben …', autocomplete: 'off' });
  if (keepSearch != null) inp.value = keepSearch;
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); runSearch(inp.value); }
  });
  inp.addEventListener('navfocus', () => setHero('Suchen', 'Im Web suchen', 'Tippen per Tastatur oder Handy („Tippen“). Enter sucht mit ' + (SEARCHES[S.state.general.searchEngine || 'brave'] || SEARCHES.brave)[0] + '. Eine Adresse wie zdf.de öffnet direkt.'));
  const wrap = h('div', { class: 'search-box' }, h('span', { class: 'ic', html: IC.search }), inp);
  row.append(wrap,
    quickBtn('Brave', IC.brave, () => openWeb('', 'tab', 'Brave'), ['Browser', 'Brave', 'Normaler Browser mit Tabs, Adressleiste und Lesezeichen. Mit der Windows-Taste kommst du jederzeit zurück – die Tabs bleiben offen.']),
    quickBtn('YouTube', IC.yt, () => openWeb('https://www.youtube.com/', 'kino', 'YouTube'), ['YouTube', 'YouTube im Kino-Fenster', 'Ohne Werbung, in groß. Größe und Qualität: Einstellungen → Browser & YouTube.']),
    quickBtn('Mediathek', IC.search, () => openSearch(inp.value || ''), ['Mediathek', 'Mediathek durchsuchen', 'Sucht in ARD, ZDF, arte, 3sat, NDR … – das Suchwort von links wird übernommen.']),
    quickBtn('Programme', IC.apps, () => appsPicker(), ['Programme', 'Programme', 'Terminal, App-Store, Retro-Spiele und alles, was du installiert hast.']),
    quickBtn('Schnellmenü', IC.quick, () => quickMenu(), ['Schnellmenü', 'Ton, Licht & Co.', 'Lautstärke, Tonausgang, Abendmodus, Bildschirm aus, Schlaf-Timer. Taste Q – oder Windows+Q von überall.']));
}

const RECENT = { items: [], t: 0 };
async function renderRecent(force) {
  const block = $('#recent-block'), row = $('#recent-row');
  if (!row) return;
  if (S.state.general.showRecent === false || !S.state.brave) { block.hidden = true; return; }
  if (force || Date.now() - RECENT.t > 60000) {
    try { RECENT.items = (await api('/api/recent?n=14')).items; RECENT.t = Date.now(); } catch (_) {}
  }
  const keep = Nav.current && row.contains(Nav.current) ? [...row.children].indexOf(Nav.current) : -1;
  row.innerHTML = '';
  block.hidden = !RECENT.items.length;
  RECENT.items.forEach((it) => {
    const el = h('button', { class: 'tile rc', 'data-nav': true },
      h('div', { class: 'art gen', style: { background: `linear-gradient(135deg, hsl(${hashHue(it.host)} 26% 22%), hsl(${(hashHue(it.host) + 30) % 360} 22% 10%))` } },
        h('img', { class: 'logo small', src: it.icon, alt: '', onerror: function () { this.remove(); } })),
      h('div', { class: 'shade' }),
      h('div', { class: 'name' }, h('b', {}, it.host), h('span', {}, it.title)));
    el.addEventListener('click', () => openWeb(it.url, 'tab', it.host));
    el.addEventListener('navfocus', () => setHero('Zuletzt besucht · ' + it.host, it.title, it.url));
    el.addEventListener('contextmenu', (e) => { e.preventDefault(); recentMenu(it); });
    el._recent = it;
    row.append(el);
  });
  if (keep >= 0 && row.children[keep]) Nav.focus(row.children[keep], { instant: true, noScroll: true });
}
function hashHue(s) { let x = 0; for (const c of String(s)) x = (x * 31 + c.charCodeAt(0)) % 360; return x; }
function recentMenu(it) {
  menu(it.host, it.title, [
    { label: 'Öffnen', key: '↵', run: () => openWeb(it.url, 'tab', it.host) },
    { label: 'Im Kino-Fenster öffnen', run: () => openWeb(it.url, 'kino', it.host) },
    { label: 'Als Kachel speichern', run: () => editTile(null, { url: 'https://' + it.host + '/' }) },
  ]);
}

// Menü-Taste auf "Zuletzt besucht"
const _contextFor = contextFor;
contextFor = function (el) { if (el && el._recent) return recentMenu(el._recent); return _contextFor(el); };

const _afterRenderHome = window.afterRenderHome;
window.afterRenderHome = function () {
  _afterRenderHome && _afterRenderHome();
  renderQuick();
  renderRecent();
};
// Wenn man aus Brave zurückkommt: Verlauf auffrischen
L.events((ev) => { if (ev.type === 'home') setTimeout(() => renderRecent(true), 600); });

/* ============================================================
 * 2. Programme, Schnellmenü, Links vom Handy
 * ============================================================ */
async function appsPicker(onPick) {
  const list = h('div', { class: 'apps-grid' }, h('div', { class: 'lead' }, 'Lade Programme …'));
  const m = openModal([h('h3', {}, onPick ? 'Programm als Kachel' : 'Programme'),
    h('div', { class: 'lead' }, onPick ? 'Welches Programm soll eine Kachel bekommen?' : 'Öffnet auf einer eigenen Ebene · Windows-Taste = zurück'), list], 'apps-modal');
  let apps = [];
  try { apps = (await api('/api/apps')).apps; } catch (_) {}
  list.innerHTML = '';
  if (!apps.length) list.append(h('div', { class: 'lead' }, 'Keine Programme gefunden.'));
  apps.forEach((a) => {
    const b = h('button', { class: 'app-card' + (a.installed ? '' : ' off'), 'data-nav': true },
      h('b', {}, a.name), h('span', {}, a.installed ? (a.desc || (a.builtin ? '' : 'Installiertes Programm')) : 'nicht installiert'));
    b.addEventListener('click', () => {
      if (!a.installed) { L.toast(a.name + ' ist nicht installiert – über den App-Store oder install.sh'); return; }
      m.close();
      if (onPick) onPick(a); else launchApp(a.id, a.name);
    });
    list.append(b);
  });
  if (!onPick) list.append(h('button', { class: 'app-card add', 'data-nav': true, onclick: () => { m.close(); launchApp('store', 'App-Store'); } }, h('b', {}, '+ Programme installieren'), h('span', {}, 'App-Store (Flathub)')));
  setTimeout(() => Nav.first(), 30);
}

async function quickMenu() {
  if (S.modals.some((x) => x.quick)) return;
  const g = S.state.general;
  const vol = h('span', { class: 'val' }, '…');
  const paintVol = (v) => { vol.textContent = v.muted ? 'stumm' : v.volume + ' %'; };
  api('/api/volume').then(paintVol).catch(() => {});
  const vbtn = (label, key) => h('button', { class: 'btn', 'data-nav': true, onclick: async () => paintVol(await api('/api/key', 'POST', { key })) }, label);
  const nightLabel = { aus: 'Aus', auto: 'Automatisch', zeit: 'Nach Uhrzeit', immer: 'Jetzt an' };
  const night = h('button', { class: 'btn', 'data-nav': true, onclick: async () => {
    const order = ['aus', 'immer', 'auto', 'zeit'];
    const next = order[(order.indexOf(g.nightMode || 'aus') + 1) % order.length];
    await saveGeneral({ nightMode: next });
    night.textContent = 'Abendmodus: ' + nightLabel[next];
    if (!S.state.night) L.toast('Abendmodus braucht wlsunset (kommt mit dem Update)');
  } }, 'Abendmodus: ' + nightLabel[g.nightMode || 'aus']);
  const sinks = h('div', { class: 'menu-list' });
  api('/api/audio').then((a) => a.sinks.filter((sk) => !sk.virtual).forEach((sk) => sinks.append(h('button', { 'data-nav': true, onclick: async () => { await api('/api/audio', 'POST', { id: sk.id }); L.toast('Ton über ' + sk.name); m.close(); } },
    h('span', {}, sk.name), h('span', { class: 'k' }, sk.default ? 'aktiv ✓' : ''))))).catch(() => {});
  const m = openModal([
    h('h3', {}, 'Schnellmenü'),
    h('div', { class: 'quick-grid' },
      field('Lautstärke', h('div', { class: 'stepper' }, vbtn('−', 'voldown'), vol, vbtn('+', 'volup'), vbtn('Stumm', 'mute'))),
      field('Licht', h('div', { class: 'swatches', style: { gap: 'calc(.8*var(--u))' } }, night,
        h('button', { class: 'btn', 'data-nav': true, onclick: () => { m.close(); api('/api/screen', 'POST', { on: false }); } }, 'Bildschirm aus'))),
      field('Schlaf', h('div', { class: 'swatches', style: { gap: 'calc(.8*var(--u))' } },
        h('button', { class: 'btn', 'data-nav': true, onclick: () => { m.close(); sleepMenu(); } }, 'Schlaf-Timer …'),
        h('button', { class: 'btn', 'data-nav': true, onclick: () => { m.close(); openSettings('bluetooth'); } }, 'Bluetooth …'))),
      field('Tonausgang', sinks),
      field('Hängt etwas?', h('div', { class: 'swatches', style: { gap: 'calc(.8*var(--u))' } },
        h('button', { class: 'btn', 'data-nav': true, onclick: () => { m.close(); api('/api/browser/restart', 'POST', {}); L.toast('Brave wird beendet – nächstes Öffnen startet frisch'); } }, 'Brave neu starten'),
        h('button', { class: 'btn', 'data-nav': true, onclick: () => { m.close(); openSettings('system'); } }, 'System & Neustart')))),
  ], 'quick-modal');
  m.quick = true;
}
window.quickMenu = quickMenu;

/* Link kam vom Handy (KDE Connect „Teilen“ oder Fernbedienung „Als Kachel“) */
window.incomingLink = function (ev) {
  if (ev.tile) return editTile(null, { url: ev.url });
  goHome();
  menu('Vom Handy empfangen', ev.label || ev.url, [
    { label: 'In Brave öffnen', key: '↵', run: () => openWeb(ev.url, 'tab', ev.label) },
    { label: 'Im Kino-Fenster öffnen', run: () => openWeb(ev.url, 'kino', ev.label) },
    { label: 'Als Kachel speichern', run: () => editTile(null, { url: ev.url }) },
  ]);
};
L.events((ev) => { if (ev.type === 'pause') L.toast('Anruf am Handy – alles pausiert'); });

/* ============================================================
 * 3. Design-Pakete: Designart + Landschaft + Farbe + Stimmung mit einem Klick
 * ============================================================ */
const PACKAGES = [
  { id: 'klar', name: 'Klar', desc: 'Schlicht, ruhig, ohne Effekte', theme: 'klar', background: 'nacht', accent: '#ececec', motion: 'aus', aurora: false, saverStyle: 'aurora', dim: 0.55 },
  { id: 'klassik', name: 'Lichtung Klassik', desc: 'Serif, Bergnacht, warmes Gold', theme: 'lichtung', background: 'nacht', accent: '#c8a26b', motion: 'voll', aurora: false, saverStyle: 'landschaft' },
  { id: 'nordlicht', name: 'Nordlicht', desc: 'Tundra, Polarlicht, kühles Grün', theme: 'lichtung', background: 'tundra', accent: '#8fb3a0', motion: 'voll', aurora: true, saverStyle: 'landschaft' },
  { id: 'hafen', name: 'Hafenstadt', desc: 'Lichter am Wasser, Glas-Optik', theme: 'glas', background: 'stadt', accent: '#e9edf2', motion: 'voll', aurora: false, saverStyle: 'minimal' },
  { id: 'kino', name: 'Kino-Abend', desc: 'Tiefschwarz, große Kacheln, Rot', theme: 'kino', background: 'nacht', accent: '#d9463b', motion: 'sanft', aurora: false, saverStyle: 'minimal', dim: 0.75 },
  { id: 'kueste', name: 'Küstenwind', desc: 'Leuchtturm, Meer, Salz-Blau', theme: 'lichtung', background: 'kueste', accent: '#9bb5c9', motion: 'voll', aurora: false, saverStyle: 'landschaft' },
  { id: 'waldhuette', name: 'Waldhütte', desc: 'Waldsee, Glühwürmchen, Moos', theme: 'lichtung', background: 'see', accent: '#a6b86f', motion: 'voll', aurora: false, saverStyle: 'analog' },
  { id: 'alpen', name: 'Alpenglühen', desc: 'Schroffe Gipfel, Abendrot', theme: 'lichtung', background: 'gipfel', accent: '#c98f7a', motion: 'voll', aurora: false, saverStyle: 'landschaft' },
  { id: 'neon', name: 'Neon-Stadt', desc: 'Leuchtende Farben bei Nacht', theme: 'neon', background: 'stadt', accent: '#7cf3ff', motion: 'voll', aurora: false, saverStyle: 'analog' },
  { id: 'p_cupertino', name: 'Cupertino', desc: 'Apple-TV-Stil · Glas & große Karten', theme: 'cupertino', background: 'w_cupertino', accent: '#ffffff', motion: 'sanft', aurora: false, saverStyle: 'minimal', dim: 0.35 },
  { id: 'p_one', name: 'One', desc: 'Samsung-Stil · Blau & weich', theme: 'one', background: 'w_one', accent: '#3e8bff', motion: 'sanft', aurora: false, saverStyle: 'analog', dim: 0.35 },
  { id: 'p_flamme', name: 'Flamme', desc: 'Fire-TV-Stil · Nachtblau & Orange', theme: 'flamme', background: 'w_flamme', accent: '#ff9900', motion: 'sanft', aurora: false, saverStyle: 'minimal', dim: 0.35 },
  { id: 'p_konsole', name: 'Konsole', desc: 'Xbox-Stil · Schwarz & Grün', theme: 'konsole', background: 'w_konsole', accent: '#3fd65b', motion: 'sanft', aurora: false, saverStyle: 'minimal', dim: 0.3 },
  { id: 'p_fenster', name: 'Fenster', desc: 'Windows-11-Stil · Mica & Blüte', theme: 'fenster', background: 'w_fenster', accent: '#60a5fa', motion: 'sanft', aurora: false, saverStyle: 'landschaft', dim: 0.3 },
  { id: 'p_adwaita', name: 'Adwaita', desc: 'GNOME-Stil · ruhig & rund', theme: 'adwaita', background: 'w_adwaita', accent: '#7aa2f7', motion: 'sanft', aurora: false, saverStyle: 'analog', dim: 0.35 },
  { id: 'p_breeze', name: 'Breeze', desc: 'KDE-Stil · klar & blau', theme: 'breeze', background: 'w_breeze', accent: '#3daee9', motion: 'sanft', aurora: false, saverStyle: 'minimal', dim: 0.35 },
  { id: 'p_aubergine', name: 'Aubergine', desc: 'Ubuntu-Stil · Lila & Orange', theme: 'aubergine', background: 'w_aubergine', accent: '#e95420', motion: 'sanft', aurora: false, saverStyle: 'analog', dim: 0.3 },
  { id: 'p_matrix', name: 'Terminal', desc: 'Hacker-Look · grüner Code-Regen', theme: 'matrix', background: 'w_matrix', accent: '#3cff6e', motion: 'voll', aurora: false, saverStyle: 'minimal', dim: 0.45 },
  { id: 'jahr', name: 'Jahreszeiten', desc: 'Landschaft wechselt mit dem Jahr', theme: 'lichtung', background: 'nacht', season: true, accent: '#c8a26b', motion: 'voll', aurora: false, saverStyle: 'landschaft' },
];

async function applyPackage(p) {
  await saveGeneral({ package: p.id, theme: p.theme, background: p.background, accent: p.accent, motion: p.motion, aurora: !!p.aurora,
    saverStyle: p.saverStyle, dim: p.dim ?? 0.55, season: !!p.season, seasonFx: true });
}

const THUMBS = {};
function thumb(id) {
  if (!THUMBS[id]) {
    try { THUMBS[id] = L.sceneThumb(id, 240, 136, { lat: S.state.general.lat, lon: S.state.general.lon }); } catch (_) { THUMBS[id] = ''; }
  }
  return THUMBS[id];
}

function packageChoices(onDone) {
  const g = S.state.general;
  return h('div', { class: 'pkg-choices' }, PACKAGES.map((p) => {
    const t = THEMES.find((x) => x[0] === p.theme);
    const b = h('button', { class: 'pkg' + (g.package === p.id ? ' sel' : ''), 'data-nav': true, style: { backgroundImage: `url(${thumb(p.background)})` } },
      h('i', { style: { background: p.accent } }), h('b', { style: { fontFamily: t ? t[3][4] : '' } }, p.name), h('span', {}, p.desc));
    b.addEventListener('click', async () => { await applyPackage(p); L.toast('Design: ' + p.name); onDone && onDone(); });
    return b;
  }));
}
window.packageChoices = packageChoices;

/* ============================================================
 * 4. Einstellungsbereiche
 * ============================================================ */
const BRAVE_EXT = [
  ['cjpalhdlnbpafiamejdnhcphjbkeiagm', 'uBlock Origin', 'Werbeblocker (einmal in Brave unter brave://settings/extensions/v2 einschalten)'],
  ['gebbhagfogifgggkldgodflihgfeippi', 'Return YouTube Dislike', 'Zeigt wieder Dislikes'],
  ['khncfooichmfjbepaaaebmommgaepoid', 'Unhook', 'Shorts & Empfehlungen ausblenden (Einstellung im Erweiterungs-Menü)'],
  ['eimadpbcbfnmbkopoojfekhnkhdbieeh', 'Dark Reader', 'Alle Websites dunkel'],
  ['dlnejlppicbjfcfcedcflplfjajinajd', 'Bonjourr', 'Schöne Startseite für neue Tabs'],
  ['mnjggcdmjocbbbhaepdhchncahnbgone', 'SponsorBlock', 'Sponsor-Abschnitte in Videos überspringen'],
  ['enamippconapkdmgfgjchkhakpfinmaj', 'DeArrow', 'Ehrlichere Titel & Vorschaubilder'],
];

function seg(opts, cur, onPick) {
  return h('div', { class: 'swatches', style: { gap: 'calc(.8*var(--u))' } }, opts.map(([v, n]) =>
    h('button', { class: 'btn' + (cur === v ? ' primary' : ''), 'data-nav': true, onclick: async () => { await onPick(v); renderSection(true); } }, n)));
}
function infoRow(label, value) { return h('div', { class: 'list-row' }, h('div', { class: 'grow' }, h('b', {}, label), h('span', {}, value ?? '–'))); }
function ago(s) { return s < 60 ? 'gerade eben' : s < 3600 ? `vor ${Math.round(s / 60)} Min.` : `vor ${Math.round(s / 3600)} Std.`; }
const fmtUp = (s) => { const d = Math.floor(s / 86400), hh = Math.floor((s % 86400) / 3600), mm = Math.floor((s % 3600) / 60); return (d ? d + ' T. ' : '') + hh + ' Std. ' + mm + ' Min.'; };

window.renderExtraSection = function (sec, { add, head, body, g }) {
  switch (sec) {
    /* ---------- Browser & YouTube ---------- */
    case 'browser': {
      head('Browser & YouTube', S.state.brave ? 'Websites öffnen sich in Brave – ein ganz normaler Browser mit Tabs. Die Windows-Taste bringt dich zurück, die Tabs bleiben offen.' : 'Brave ist noch nicht installiert. Das passiert mit dem Update (install.sh).');
      const zoom = (v) => Math.round(v * 100) + ' %';
      add(field('Brave-Größe', stepper(Number(g.braveScale || 1.25), { min: 1, max: 2.5, step: 0.05, fmt: zoom }, (v) => saveGeneral({ braveScale: Math.round(v * 100) / 100 })), 'Schrift, Tabs und Knöpfe – fürs Sofa größer. Brave startet dafür neu.'));
      add(field('YouTube-Zoom', stepper(Number(g.ytZoom || 1.25), { min: 0.8, max: 2, step: 0.05, fmt: zoom }, (v) => saveGeneral({ ytZoom: Math.round(v * 100) / 100 })), 'Nur YouTube – Vorschaubilder und Titel größer'));
      add(field('Kinomodus', toggle(g.ytCinema !== false, (v) => saveGeneral({ ytCinema: v })), 'Breites Video, dunkler Hintergrund, Werbebanner weg'));
      add(field('Qualität', seg([['auto', 'Automatisch'], ['hd720', '720p'], ['hd1080', '1080p'], ['hd1440', '1440p'], ['max', 'Maximum']], g.ytQuality || 'hd1080', (v) => saveGeneral({ ytQuality: v })), 'Auto-HD – ältere Laptops schaffen 1080p meist gut'));
      add(field('Gleiche Lautstärke', toggle(g.normalize !== false, (v) => saveGeneral({ normalize: v })), 'Laute Stellen leiser, leise Stimmen lauter (YouTube, Twitch …)'));
      add(field('Suchmaschine', seg(Object.entries(SEARCHES).map(([k, [n]]) => [k, n]), g.searchEngine || 'brave', (v) => saveGeneral({ searchEngine: v })), 'Für die Suchleiste auf der Startseite'));
      add(field('Suchleiste & Knöpfe', toggle(g.quickbar !== false, (v) => saveGeneral({ quickbar: v })), 'Oben auf der Startseite'));
      add(field('„Zuletzt besucht“', toggle(g.showRecent !== false, (v) => saveGeneral({ showRecent: v })), 'Reihe mit den zuletzt geöffneten Websites'));
      const chosen = new Set(g.braveExtensions || BRAVE_EXT.slice(0, 5).map((x) => x[0]));
      const extBox = h('div', { class: 'menu-list' }, BRAVE_EXT.map(([id, n, d]) => {
        const b = h('button', { 'data-nav': true, onclick: async () => {
          chosen.has(id) ? chosen.delete(id) : chosen.add(id);
          const r = await api('/api/brave/extensions', 'POST', { ids: [...chosen] }).catch((e) => ({ ok: false, msg: e.message }));
          S.state.general.braveExtensions = [...chosen];
          L.toast(r.ok ? 'Gespeichert – greift beim nächsten Brave-Start' : 'Nicht gespeichert: ' + (r.msg || 'Root-Helfer fehlt'));
          renderSection(true);
        } }, h('span', {}, n + ' · ' + d), h('span', { class: 'k' }, chosen.has(id) ? 'an ✓' : 'aus'));
        return b;
      }));
      add(field('Erweiterungen', extBox, 'Werden automatisch installiert. Weitere gehen ganz normal über den Chrome Web Store.'));
      add(h('div', { class: 'btns' },
        h('button', { class: 'btn primary', 'data-nav': true, onclick: () => openWeb('', 'tab', 'Brave') }, 'Brave öffnen'),
        h('button', { class: 'btn', 'data-nav': true, onclick: () => openWeb('brave://settings/extensions/v2', 'tab', 'uBlock einschalten') }, 'uBlock einschalten'),
        h('button', { class: 'btn', 'data-nav': true, onclick: async () => { await api('/api/browser/restart', 'POST', {}); L.toast('Brave beendet'); } }, 'Brave neu starten'),
        h('button', { class: 'btn', 'data-nav': true, onclick: () => importBookmarks() }, 'Lesezeichen → Kacheln')));
      add(h('div', { class: 'lead', style: { textTransform: 'none', letterSpacing: '.02em', marginTop: 'calc(2*var(--u))' } },
        'Bonjourr im Lichtung-Stil: neuen Tab öffnen → Zahnrad unten rechts → Hintergrund „Farbe“ #0c110f, Schrift „Fraunces“, Uhr „analog“ oder groß, Begrüßung an, Akzent #c8a26b.'));
      break;
    }
    /* ---------- Programme ---------- */
    case 'apps': {
      head('Programme', 'Programme laufen auf einer eigenen Ebene. Windows-Taste = zurück zur Startseite, Windows+Tab = zwischen offenen Programmen wechseln.');
      const box = h('div', { class: 'menu-list' }, h('div', { class: 'lead' }, 'Lade …'));
      add(box);
      api('/api/apps').then((r) => {
        box.innerHTML = '';
        r.apps.forEach((a) => box.append(h('div', { class: 'list-row' },
          h('div', { class: 'grow' }, h('b', {}, a.name), h('span', {}, a.installed ? (a.desc || 'installiert') : 'nicht installiert')),
          a.installed ? h('button', { class: 'btn', 'data-nav': true, onclick: () => launchApp(a.id, a.name) }, 'Öffnen') : null,
          a.installed ? h('button', { class: 'btn', 'data-nav': true, onclick: async () => { await api('/api/tiles', 'POST', { tile: { title: a.name, subtitle: a.desc || 'Programm', url: 'app:' + a.id, open: 'lichtung', hue: hashHue(a.id) } }); L.toast('Kachel angelegt'); refresh(); } }, '+ Kachel') : null)));
      });
      add(h('div', { class: 'lead', style: { textTransform: 'none', letterSpacing: '.02em', marginTop: 'calc(2*var(--u))' } },
        'Terminal: Strg+Alt+T. Für System-Programme (apt) im Terminal „su -“ eingeben (Root-Passwort). Programme aus dem App-Store brauchen kein Passwort. Retro-Spiele: eigene Spieldateien (ROMs) nach /home/tv/Spiele kopieren.'));
      break;
    }
    /* ---------- Aussehen ---------- */
    case 'look': {
      head('Aussehen', 'Design-Paket mit einem Klick – oder alles einzeln. Die Startseite ändert sich sofort.');
      add(field('Design-Pakete', packageChoices(() => renderSection(true)), 'Designart + Landschaft + Farbe + Bildschirmschoner'));
      add(field('Designart', h('div', { class: 'theme-choices' }, THEMES.map(([id, name, sub, c]) =>
        h('button', { class: 'theme-choice' + ((g.theme || 'lichtung') === id ? ' sel' : ''), 'data-nav': true, style: { background: c[0], color: c[1] },
          onclick: async () => { await saveGeneral({ theme: id, package: '' }); renderSection(true); L.toast('Designart: ' + name); } },
          h('b', { style: { fontFamily: c[4] } }, name), h('span', {}, sub), h('i', {}, h('em', { style: { background: c[2] } }), h('em', { style: { background: c[2], outline: '2px solid ' + c[3] } }), h('em', { style: { background: c[2] } }))))),
        'Ändert Schriften, Formen und Farben'));
      add(field('Kachel-Symbole', seg([['einheitlich', 'Einheitlich'], ['logos', 'Original-Logos']], g.tileIcons || 'einheitlich', async (v) => { await saveGeneral({ tileIcons: v }); renderHome?.(); }),
        'Einheitlich: alle Kacheln mit gleichem Symbol-Ring (Websites mit Anfangsbuchstaben) · Original: Logos der Websites'));
      const choices = h('div', { class: 'bg-choices' });
      const customs = g.customBackgrounds || [];
      [...L.BACKGROUNDS.map((b) => ({ id: b.id, name: b.name })), ...customs.map((u, i) => ({ id: u, name: 'Foto ' + (i + 1) }))].forEach((b) => {
        const el = h('button', { class: 'bg-choice' + (g.background === b.id && !g.season ? ' sel' : ''), 'data-nav': true, onclick: async () => { await saveGeneral({ background: b.id, season: false, package: '' }); renderSection(true); } }, h('span', {}, b.name));
        el.style.backgroundImage = b.id.startsWith('/') ? `url("${b.id}")` : `url(${thumb(b.id)})`;
        choices.append(el);
      });
      add(field('Landschaft', choices, 'Lebt mit Uhrzeit, Mond und echtem Wetter · eigene Fotos: Handy → Aussehen'));
      add(field('Live-Webcam', h('div', { class: 'btns', style: { margin: 0 } },
        h('button', { class: 'btn' + (g.webcamBg ? ' primary' : ''), 'data-nav': true, onclick: () => webcamPicker() }, g.webcamBg ? 'Webcam läuft – ändern …' : 'Webcam als Hintergrund …')),
        'Kieler Förde, Hafen, Nordlicht, ISS – statt der gezeichneten Landschaft'));
      add(field('Jahreszeiten', toggle(!!g.season, (v) => saveGeneral({ season: v })), 'Landschaft wechselt mit dem Jahr: Winter Bergnacht, Frühling Waldsee, Sommer Küste, Herbst Nebelwald'));
      add(field('Blätter & Blüten', toggle(g.seasonFx !== false, (v) => saveGeneral({ seasonFx: v })), 'Im Herbst fallen Blätter, im Frühling Blüten – Landschaft färbt sich passend'));
      add(field('Akzentfarbe', h('div', { class: 'swatches' }, ACCENTS.map((a) => h('button', { class: 'swatch' + (g.accent === a ? ' sel' : ''), style: { background: a }, 'data-nav': true, onclick: async () => { await saveGeneral({ accent: a }); renderSection(true); } })))));
      add(field('Abdunkeln', stepper(Math.round((g.dim ?? .55) * 100), { min: 10, max: 90, step: 5, fmt: (v) => v + ' %' }, (v) => saveGeneral({ dim: v / 100 }))));
      add(field('Animation', seg([['aus', 'Aus'], ['sanft', 'Sanft'], ['voll', 'Voll']], g.motion || 'voll', (v) => saveGeneral({ motion: v })), 'Sanft spart Leistung'));
      add(field('Wetter-Effekte', toggle(g.weatherFx !== false, (v) => saveGeneral({ weatherFx: v })), 'Regen, Schnee, Nebel, Gewitter – nach echtem Wetter'));
      add(field('Polarlicht', toggle(!!g.aurora, (v) => saveGeneral({ aurora: v })), 'In klaren Nächten'));
      add(field('Systemwerte', toggle(g.showStats !== false, (v) => saveGeneral({ showStats: v }).then(paintStats)), 'CPU, RAM, Temperatur und Netz oben rechts auf der Startseite'));
      add(field('Wetter groß', toggle(g.bigWeather !== false, (v) => saveGeneral({ bigWeather: v }).then(renderWeather)), 'Oben rechts mit 3-Tage-Vorhersage'));
      add(field('Abendmodus', seg([['aus', 'Aus'], ['auto', 'Nach Sonnenuntergang'], ['zeit', 'Nach Uhrzeit'], ['immer', 'Immer an']], g.nightMode || 'aus', (v) => saveGeneral({ nightMode: v })),
        S.state.night ? 'Wärmeres, augenschonendes Licht über allem – auch in Brave' : 'Kommt mit dem Update (wlsunset)'));
      if ((g.nightMode || 'aus') === 'zeit') {
        const times = ['19:00', '20:00', '21:00', '22:00', '23:00'];
        add(field('Ab', seg(times.map((t) => [t, t]), g.nightFrom || '21:00', (v) => saveGeneral({ nightFrom: v }))));
        add(field('Bis', seg(['05:30', '06:30', '07:30', '08:30'].map((t) => [t, t]), g.nightTo || '06:30', (v) => saveGeneral({ nightTo: v }))));
      }
      if ((g.nightMode || 'aus') !== 'aus') add(field('Stärke', seg([[4500, 'Leicht'], [3800, 'Mittel'], [3200, 'Stark'], [2700, 'Sehr warm']], Number(g.nightTemp || 3800), (v) => saveGeneral({ nightTemp: v }))));
      const d = S.scene?.describe();
      const P = S.preview || {};
      const setP = (patch) => { S.preview = Object.assign({}, S.preview || {}, patch); S.scene.preview(S.preview); renderSection(true); };
      add(field('Vorschau Wetter', seg([[null, 'Echt'], ['clear', 'Klar'], ['partly', 'Wolkig'], ['rain', 'Regen'], ['snow', 'Schnee'], ['fog', 'Nebel'], ['storm', 'Gewitter']], P.kind ?? null, (v) => setP({ kind: v })),
        d ? `Gerade: ${d.tod} · ${d.moon} · Sonne ${d.sunAlt}°` : ''));
      add(field('Vorschau Tageszeit', seg([[null, 'Echt'], [6.5, 'Morgen'], [12, 'Mittag'], [17, 'Abend'], [23, 'Nacht']], P.hour ?? null, (v) => setP({ hour: v })), 'Nur zum Ausprobieren – beim Verlassen wieder echt'));
      break;
    }
    /* ---------- Start & Boot ---------- */
    case 'boot': {
      head('Start & Boot', 'Was beim Einschalten zu sehen ist. Änderungen brauchen etwa 30 Sekunden und greifen beim nächsten Start.');
      const box = h('div', {}, h('div', { class: 'lead' }, 'Lade …'));
      add(box);
      api('/api/boot').then((b) => {
        box.innerHTML = '';
        if (!b.admin) box.append(h('div', { class: 'lead', style: { textTransform: 'none' } }, 'Der Root-Helfer fehlt noch – kommt mit dem Update.'));
        const NAMES = { lichtung: 'Lichtung (Lichtpunkt)', 'lichtung-puls': 'Lichtung Puls', 'lichtung-sterne': 'Lichtung Sterne', bgrt: 'Lenovo-Logo', spinner: 'Kreisel', solar: 'Sonne', 'fade-in': 'Einblenden', glow: 'Glühen', tribar: 'Balken', script: '', text: '', details: 'Textausgabe (Fehlersuche)', spinfinity: 'Unendlich' };
        const list = h('div', { class: 'menu-list' }, (b.themes || []).filter((t) => NAMES[t] !== '').map((t) =>
          h('button', { 'data-nav': true, onclick: async () => { const r = await api('/api/boot', 'POST', { theme: t }).catch((e) => ({ msg: e.message })); L.toast(r.ok ? 'Wird eingerichtet (ca. 30 s) …' : 'Fehler: ' + (r.msg || '')); } },
            h('span', {}, NAMES[t] || t), h('span', { class: 'k' }, b.theme === t ? 'aktiv ✓' : ''))));
        box.append(field('Bootanimation', list, b.job ? 'Stand: ' + b.job : ''));
        box.append(field('Bootmenü zeigen', toggle(!!b.menu, async (v) => { const r = await api('/api/boot', 'POST', { menu: v }).catch((e) => ({ msg: e.message })); L.toast(r.ok ? (v ? 'Bootmenü erscheint 3 Sekunden' : 'Bootmenü versteckt') : 'Fehler'); }),
          'Im Lichtung-Design. Versteckt geht es trotzdem: beim Start Esc oder Shift halten.'));
      });
      add(h('div', { class: 'btns' }, h('button', { class: 'btn primary', 'data-nav': true, onclick: () => runSetup(() => { renderHome(); show('home'); }) }, 'Einrichtungsassistent starten')));
      break;
    }
    /* ---------- Bildschirmschoner ---------- */
    case 'saver': {
      head('Bildschirmschoner', 'Erscheint, wenn eine Weile nichts passiert und nichts läuft – auch über Brave. Jede Taste bringt dich genau dahin zurück, wo du warst.');
      add(field('Stil', seg([['aurora', 'Aurora (neu)'], ['landschaft', 'Landschaft & Uhr'], ['analog', 'Analoge Uhr'], ['minimal', 'Minimal (schwarz)'], ['fotos', 'Eigene Fotos']], g.saverStyle || 'aurora', (v) => saveGeneral({ saverStyle: v })),
        'Minimal schont OLED-Fernseher · Fotos: über die Handy-Fernbedienung hochladen'));
      add(field('Starten nach', stepper(Number(g.screensaverMinutes ?? 5), { min: 0, max: 60, step: 1, fmt: (v) => v ? v + ' Min.' : 'Aus' }, (v) => saveGeneral({ screensaverMinutes: v }))));
      add(field('Auch über Brave & Programmen', toggle(g.screensaverOnPages !== false, (v) => saveGeneral({ screensaverOnPages: v })), 'Nie, während ein Video läuft'));
      add(h('div', { class: 'btns' }, h('button', { class: 'btn', 'data-nav': true, onclick: () => startSaver() }, 'Jetzt anzeigen')));
      const why = h('div', { class: 'lead', style: { textTransform: 'none', marginTop: 'calc(1.6*var(--u))' } }, 'Status: …');
      add(why);
      const upd = () => api('/api/saver/status').then((r) => { why.textContent = 'Status: ' + (r.why || '–'); }).catch(() => {});
      upd(); const iv = setInterval(() => { if (!why.isConnected) return clearInterval(iv); upd(); }, 3000);
      break;
    }
    /* ---------- Handy & Verbindung ---------- */
    case 'remote': {
      head('Handy & Verbindung', 'Handy ins gleiche WLAN, QR-Code scannen, Code eingeben. Mehrere Handys gleichzeitig gehen.');
      const qrBox = h('div', { class: 'qr', id: 'qr' });
      add(h('div', { class: 'remote-box' }, qrBox, h('div', {},
        h('div', { class: 'lead', style: { marginBottom: '.4em' } }, 'Adresse'), h('div', { id: 'remote-url', style: { fontSize: 'calc(2.2*var(--u))' } }, '…'),
        h('div', { class: 'lead', style: { margin: '2em 0 0' } }, 'Code'), h('div', { class: 'big-code', id: 'remote-pin' }, '····'),
        h('div', { class: 'btns' }, h('button', { class: 'btn', 'data-nav': true, onclick: async () => { await api('/api/remote/newpin', 'POST', {}); renderSection(true); } }, 'Neuen Code (alle Handys abmelden)')))));
      api('/api/netinfo').then((n) => {
        const url = `http://${n.ip}:${n.port}/remote`;
        $('#remote-url').textContent = url; $('#remote-pin').textContent = n.pin;
        try { const qr = qrcode(0, 'M'); qr.addData(url + '#' + n.pin); qr.make(); qrBox.innerHTML = qr.createSvgTag({ cellSize: 6, margin: 0, scalable: true }); } catch (_) {}
      });
      const rem = h('div', { class: 'menu-list' });
      add(field('Verbundene Handys', rem));
      api('/api/remotes').then((r) => { if (!r.items.length) rem.append(h('div', { class: 'lead' }, 'Noch keins.')); r.items.forEach((x) => rem.append(infoRow(x.name, `${x.ip} · ${ago(x.ago)}`))); });
      // KDE Connect
      const kd = h('div', { class: 'menu-list' }, h('div', { class: 'lead' }, S.state.kdeconnect ? 'Suche Handys …' : 'KDE Connect kommt mit dem Update.'));
      add(field('KDE Connect', kd, 'App „KDE Connect“ aufs Handy → hier koppeln → am Handy bestätigen. Dann: Medien steuern, Lautstärke, „Teilen → lichtung“, Pause bei Anruf.'));
      if (S.state.kdeconnect) {
        const qr2 = h('div', { class: 'qr', style: { width: 'calc(16*var(--u))', height: 'calc(16*var(--u))' } });
        try { const q = qrcode(0, 'M'); q.addData('https://play.google.com/store/apps/details?id=org.kde.kdeconnect_tp'); q.make(); qr2.innerHTML = q.createSvgTag({ cellSize: 4, margin: 0, scalable: true }); } catch (_) {}
        api('/api/kdeconnect').then((r) => {
          kd.innerHTML = '';
          if (!r.devices.length) kd.append(h('div', { class: 'lead', style: { textTransform: 'none' } }, 'Kein Handy gefunden. App installieren (QR-Code), gleiches WLAN, App öffnen.'));
          r.devices.forEach((dv) => kd.append(h('div', { class: 'list-row' },
            h('div', { class: 'grow' }, h('b', {}, dv.name), h('span', {}, dv.paired ? (dv.reachable ? 'gekoppelt · verbunden' : 'gekoppelt · nicht erreichbar') : 'nicht gekoppelt')),
            !dv.paired ? h('button', { class: 'btn primary', 'data-nav': true, onclick: async () => { await api('/api/kdeconnect', 'POST', { action: 'pair', id: dv.id }); L.toast('Am Handy bestätigen'); setTimeout(() => renderSection(true), 6000); } }, 'Koppeln') : null,
            dv.paired ? h('button', { class: 'btn', 'data-nav': true, onclick: () => api('/api/kdeconnect', 'POST', { action: 'ping', id: dv.id }) }, 'Testen') : null,
            dv.paired ? h('button', { class: 'btn', 'data-nav': true, onclick: () => api('/api/kdeconnect', 'POST', { action: 'ring', id: dv.id }) }, 'Handy suchen') : null,
            dv.paired ? h('button', { class: 'btn danger', 'data-nav': true, onclick: async () => { await api('/api/kdeconnect', 'POST', { action: 'unpair', id: dv.id }); renderSection(true); } }, 'Entkoppeln') : null)));
          kd.append(h('div', { class: 'list-row' }, qr2, h('div', { class: 'grow' }, h('b', {}, 'App fürs Handy'), h('span', {}, 'QR-Code scannen → Play Store'))));
        });
      }
      // Smart View / Miracast
      const mc = h('div', {}, h('div', { class: 'lead' }, '…'));
      add(field('Samsung Smart View', mc, 'Experimentell: braucht „Wi-Fi Direct“ im WLAN-Chip. Solange der Empfänger läuft, ist WLAN-Internet weg (LAN geht).'));
      api('/api/miracast').then((r) => {
        mc.innerHTML = '';
        if (!r.installed) { mc.append(h('div', { class: 'lead', style: { textTransform: 'none' } }, 'Nicht installiert (wird beim Update versucht, klappt nicht bei jedem Laptop).')); return; }
        const on = /läuft/.test(r.state);
        mc.append(h('div', { class: 'btns' }, h('button', { class: 'btn' + (on ? '' : ' primary'), 'data-nav': true, onclick: async () => { await api('/api/miracast', 'POST', { on: !on }); L.toast(on ? 'Empfänger aus – WLAN kommt zurück' : 'Empfänger läuft – am Handy Smart View → „lichtung“'); renderSection(true); } }, on ? 'Empfänger beenden' : 'Empfänger starten')));
      });
      // Einschalten übers Netz
      add(field('Per Handy einschalten', h('div', { class: 'btns', style: { margin: 0 } },
        h('button', { class: 'btn', 'data-nav': true, onclick: async () => { const r = await api('/api/wol', 'POST', { on: true }).catch((e) => ({ msg: e.message })); L.toast(r.ok ? 'Wake-on-LAN an: ' + r.msg : (r.msg || 'Geht nur mit LAN-Kabel')); } }, 'Wake-on-LAN einschalten')),
        'Nur mit LAN-Kabel: App „Wake On Lan“ aufs Handy, MAC-Adresse eintragen. Läuft der Laptop, weckt „TV an“ in der Fernbedienung den Bildschirm.'));
      break;
    }
    /* ---------- Bluetooth ---------- */
    case 'bluetooth': {
      head('Bluetooth', 'Kopfhörer, Lautsprecher, Gamepads und Tastaturen. Gerät in den Kopplungsmodus bringen, dann „Suchen“.');
      const box = h('div', { class: 'menu-list' }, h('div', { class: 'lead' }, 'Lade …'));
      add(box);
      const paint = (st) => {
        box.innerHTML = '';
        if (!st.available) { box.append(h('div', { class: 'lead' }, 'Bluetooth kommt mit dem Update.')); return; }
        if (!st.adapter) { box.append(h('div', { class: 'lead' }, 'Kein Bluetooth-Chip gefunden (oder ausgeschaltet).')); }
        st.devices.forEach((dv) => box.append(h('div', { class: 'list-row' },
          h('div', { class: 'grow' }, h('b', {}, dv.name), h('span', {}, [dv.connected ? 'verbunden' : dv.paired ? 'gekoppelt' : 'gefunden', dv.icon].filter(Boolean).join(' · '))),
          !dv.paired ? h('button', { class: 'btn primary', 'data-nav': true, onclick: async () => { L.toast('Kopple …'); const r = await api('/api/bt', 'POST', { action: 'pair', mac: dv.mac }); L.toast(r.ok ? 'Verbunden' : 'Hat nicht geklappt'); load2(); } }, 'Koppeln') : null,
          dv.paired && !dv.connected ? h('button', { class: 'btn', 'data-nav': true, onclick: async () => { await api('/api/bt', 'POST', { action: 'connect', mac: dv.mac }); load2(); } }, 'Verbinden') : null,
          dv.connected ? h('button', { class: 'btn', 'data-nav': true, onclick: async () => { await api('/api/bt', 'POST', { action: 'disconnect', mac: dv.mac }); load2(); } }, 'Trennen') : null,
          dv.paired ? h('button', { class: 'btn danger', 'data-nav': true, onclick: async () => { await api('/api/bt', 'POST', { action: 'remove', mac: dv.mac }); load2(); } }, 'Entfernen') : null)));
        box.append(h('div', { class: 'btns' }, h('button', { class: 'btn primary', 'data-nav': true, onclick: async () => { box.prepend(h('div', { class: 'lead' }, 'Suche 12 Sekunden …')); await api('/api/bt', 'POST', { action: 'scan' }); load2(); } }, 'Suchen')));
      };
      const load2 = () => api('/api/bt').then(paint).catch(() => paint({ available: false }));
      load2();
      add(h('div', { class: 'lead', style: { textTransform: 'none', letterSpacing: '.02em', marginTop: 'calc(2*var(--u))' } }, 'Kopfhörer verbunden? Unter Ton bzw. im Schnellmenü als Tonausgang wählen.'));
      break;
    }
    /* ---------- Energie ---------- */
    case 'power': {
      head('Energie', 'Damit der Laptop nicht die ganze Nacht läuft, wenn jemand vergisst auszuschalten.');
      add(field('Auto-Aus', seg([[0, 'Nie'], [2, '2 Std.'], [3, '3 Std.'], [4, '4 Std.'], [6, '6 Std.']], Number(g.autoOffHours || 0), (v) => saveGeneral({ autoOffHours: v })), 'Nach so langer Zeit ohne Tastendruck – nie, während ein Video läuft'));
      add(field('Danach', seg([['screen', 'Bildschirm aus'], ['poweroff', 'Laptop ausschalten']], g.autoOffAction || 'screen', (v) => saveGeneral({ autoOffAction: v })), 'Bildschirm aus = sofort wieder da per Taste oder Handy'));
      add(h('div', { class: 'btns' },
        h('button', { class: 'btn', 'data-nav': true, onclick: () => sleepMenu() }, 'Schlaf-Timer …'),
        h('button', { class: 'btn', 'data-nav': true, onclick: () => api('/api/screen', 'POST', { on: false }) }, 'Bildschirm jetzt aus')));
      break;
    }
    /* ---------- System & Updates ---------- */
    case 'system': {
      head('System & Updates', 'Version, Updates, Sicherung, Systeminfo und Neustart.');
      const upd = h('div', {}, h('div', { class: 'lead' }, 'Lade …'));
      add(field('Updates', upd));
      add(field('Automatisch', toggle(g.autoUpdate !== false, (v) => saveGeneral({ autoUpdate: v })), 'Nachts zwischen 3 und 5 Uhr, nur wenn nichts läuft und 30 Min. nichts bedient wurde'));
      api('/api/update/status').then((u) => {
        upd.innerHTML = '';
        const inst = u.installed || {};
        const ver = inst.release || ((inst.version || '?') + (inst.commit ? ' (' + inst.commit.slice(0, 7) + ')' : ''));
        upd.append(h('div', { class: 'lead', style: { textTransform: 'none', margin: 0 } }, `Installiert: ${ver} · Letztes Update: ${u.status || '–'}`));
        const last = u.last || {};
        const res = h('div', { class: 'lead', style: { textTransform: 'none' } },
          last.newer ? `Neue Version verfügbar: ${last.latest}` : 'Updates kommen nur aus getesteten GitHub-Releases.');
        const runBtn = h('button', { class: 'btn primary upd', hidden: !last.newer, 'data-nav': true, onclick: () => confirmBox('Update jetzt einspielen? Der Fernseher startet danach neu.', async () => {
          L.toast('Update wird geladen …', 8000);
          const r = await api('/api/update/run', 'POST', {}).catch((e) => ({ ok: false, error: e.message }));
          L.toast(r.ok ? 'Update läuft – dauert einige Minuten' : 'Fehler: ' + (r.error || r.msg), 8000);
        }) }, 'Jetzt aktualisieren');
        upd.append(res, h('div', { class: 'btns' },
          h('button', { class: 'btn', 'data-nav': true, onclick: async () => {
            res.textContent = 'Prüfe GitHub …';
            const c = await api('/api/update/check', 'POST', {}).catch((e) => ({ ok: false, error: e.message }));
            res.textContent = c.ok ? (c.newer ? `Neue Version verfügbar: ${c.latest}` : (c.hint || 'Du bist auf dem neuesten Stand ✓')) : `${c.error}. ${c.hint || ''}`;
            runBtn.hidden = !(c.ok && c.newer);
          } }, 'Nach Updates suchen'), runBtn));
      });
      const si = h('div', { class: 'menu-list' }, h('div', { class: 'lead' }, 'Lade …'));
      add(field('Systeminfo', si));
      const paintInfo = async () => {
        const i = await api('/api/sysinfo').catch(() => null);
        if (!i) return;
        si.innerHTML = '';
        const lk = i.lastKey;
        [['Gerät', i.model || i.host], ['Prozessor', `${i.cpu} · Last ${i.load}`], ['Temperatur', i.temp != null ? i.temp + ' °C' : '–'],
          ['Arbeitsspeicher', i.mem ? `${i.mem.used} von ${i.mem.total} GB belegt` : '–'], ['Festplatte', i.disk ? `${i.disk.free} von ${i.disk.total} GB frei` : '–'],
          ['WLAN', i.wifi ? `${i.wifi.ssid} · Signal ${i.wifi.signal} %` : (i.net || []).map((n) => n[0]).join(', ') || 'nicht verbunden'], ['Adresse', i.ip],
          ['Läuft seit', fmtUp(i.uptime)], ['Lautstärke', `${i.volume.volume} %${i.volume.muted ? ' (stumm)' : ''} · über ${i.volume.backend || 'nichts gefunden!'}`],
          ['Tasten', `${i.sway ? 'sway' : 'kein sway'} · ${i.wmKeys.length ? 'Kürzel aktiv: ' + i.wmKeys.join(', ') : 'evdev'} · Handy-Tasten ${i.uinput ? 'an' : 'aus'}`],
          ['Letzte Taste', lk ? `${lk.name} · ${lk.device || lk.src} · ${ago(lk.ago)}` : 'noch keine – drück mal eine Lautstärketaste'],
          ['Versionen', [i.lichtung && 'Lichtung ' + (i.lichtung.version || '?'), i.brave, i.firefox, 'Debian ' + i.debian, 'Kernel ' + i.kernel].filter(Boolean).join(' · ')],
        ].forEach(([k, v]) => si.append(infoRow(k, v)));
      };
      paintInfo();
      const iv = setInterval(() => { if (!document.contains(si)) return clearInterval(iv); paintInfo(); }, 4000);
      add(field('Sicherung', h('div', { class: 'lead', style: { textTransform: 'none', margin: 0 } }, 'Kacheln, Profile, Fotos und Einstellungen sichern: Handy-Fernbedienung → System → „Sicherung herunterladen“. Dort auch wiederherstellen.')));
      add(h('div', { class: 'menu-list', style: { maxWidth: 'calc(60*var(--u))', marginTop: 'calc(2*var(--u))' } },
        h('button', { 'data-nav': true, onclick: () => runSetup(() => { renderHome(); show('home'); }) }, h('span', {}, 'Einrichtung wiederholen'), h('span', { class: 'k' }, 'Assistent vom ersten Start')),
        h('button', { 'data-nav': true, onclick: () => api('/api/system', 'POST', { action: 'restart-browser' }) }, h('span', {}, 'Oberfläche & Brave neu starten'), h('span', { class: 'k' }, 'falls etwas hängt')),
        h('button', { 'data-nav': true, onclick: () => launchApp('terminal', 'Terminal') }, h('span', {}, 'Terminal öffnen'), h('span', { class: 'k' }, 'Strg+Alt+T')),
        h('button', { 'data-nav': true, onclick: () => confirmBox('Laptop neu starten?', () => api('/api/system', 'POST', { action: 'reboot' })) }, h('span', {}, 'Neu starten')),
        h('button', { 'data-nav': true, class: 'danger', onclick: () => confirmBox('Laptop ausschalten?', () => api('/api/system', 'POST', { action: 'poweroff' })) }, h('span', {}, 'Ausschalten'))));
      break;
    }
    /* ---------- Tasten & Hilfe ---------- */
    case 'help': {
      head('Tasten & Hilfe', 'Alles geht mit Laptop-Tastatur, Funk-Fernbedienung, Maus oder Handy.');
      const rows = [
        ['← ↑ → ↓', 'Bewegen'], ['Enter / OK', 'Öffnen, bestätigen'], ['☰ / Menü-Taste, M, Rechtsklick', 'Optionen zur Kachel'],
        ['Esc / Zurück / Rücktaste', 'Zurück'], ['Windows-Taste, F1, Home', 'Von überall zur Startseite (Brave bleibt offen)'],
        ['Windows + Tab', 'Zwischen Brave, Programmen und Startseite wechseln'], ['Windows + Q', 'Schnellmenü – von überall'],
        ['Windows + B / Taste B', 'Brave öffnen'], ['Strg + Alt + T', 'Terminal'], ['1 – 9', 'Kachel direkt öffnen'], ['/', 'In die Suchleiste'],
        ['S', 'Einstellungen'], ['T', 'Schlaf-Timer'], ['Lautstärketasten', 'Lautstärke mit Anzeige – überall'],
        ['Live-TV: ↑ ↓ / Bild ↑↓ / Ziffern', 'Sender wechseln'], ['In Brave: Strg + / Strg −', 'Seite größer/kleiner'], ['In Brave: F11', 'Vollbild'],
      ];
      add(h('div', { class: 'keytable' }, rows.map(([k, v]) => [h('kbd', {}, k), h('span', {}, v)])));
      const TOPICS = [
        ['Tasten reagieren nicht', 'Einstellungen → System → Systeminfo zeigt die „Letzte Taste“. Steht dort nichts, kommt die Taste nicht an (Fn-Taste probieren). Hilft nichts: Ein-/Aus-Knopf kurz drücken und neu einschalten.'],
        ['Kein Ton', 'Ton bzw. Schnellmenü → Tonausgang „HDMI“ wählen. Am Fernseher Lautstärke und Eingang prüfen. Systeminfo zeigt, ob das Tonsystem läuft.'],
        ['YouTube hat Werbung', 'Einmalig in Brave brave://settings/extensions/v2 öffnen und uBlock Origin einschalten (Knopf unter Browser & YouTube). Brave-Schutzschild auf „Aggressiv“ stellen.'],
        ['Brave zu klein/groß', 'Browser & YouTube → Brave-Größe. In Brave selbst: Strg + / Strg −.'],
        ['Video ruckelt', 'Browser & YouTube → Qualität 720p. Animation unter Aussehen auf „Sanft“.'],
        ['Handy verbindet nicht', 'Gleiches WLAN? Code neu erzeugen und QR neu scannen. Für KDE Connect: App öffnen, Fernseher erscheint als „lichtung“.'],
        ['Programm hängt', 'Windows-Taste → Startseite. Programme → nochmal öffnen holt das Fenster nach vorn. Notfall: Strg+Alt+F2, anmelden, „reboot“.'],
        ['Update einspielen', 'System & Updates → Nach Updates suchen. Privates Repo: Token oder ZIP per Handy-Fernbedienung → System.'],
      ];
      const tb = h('div', { class: 'menu-list' }, TOPICS.map(([t, txt]) => h('button', { 'data-nav': true, onclick: () => menu(t, '', [{ label: txt, run: () => {} }]) }, h('span', {}, t), h('span', { class: 'k' }, '?'))));
      add(field('Hilfe-Themen', tb));
      break;
    }
  }
};

/* Lesezeichen aus Brave als Kacheln übernehmen */
async function importBookmarks() {
  const r = await api('/api/bookmarks').catch(() => ({ items: [] }));
  if (!r.items.length) { L.toast('Keine Lesezeichen in Brave gefunden'); return; }
  const chosen = new Set();
  const list = h('div', { class: 'menu-list' }, r.items.map((b) => {
    const el = h('button', { 'data-nav': true }, h('span', {}, b.title || b.url), h('span', { class: 'k' }, ''));
    el.addEventListener('click', () => { chosen.has(b) ? chosen.delete(b) : chosen.add(b); el.querySelector('.k').textContent = chosen.has(b) ? '✓' : ''; });
    return el;
  }));
  const m = openModal([h('h3', {}, 'Lesezeichen → Kacheln'), h('div', { class: 'lead' }, 'Auswählen, dann übernehmen – Logos holt Lichtung automatisch'), list,
    h('div', { class: 'btns' }, h('button', { class: 'btn primary', 'data-nav': true, onclick: async () => {
      m.close();
      L.toast('Hole Logos …');
      const items = [];
      for (const b of chosen) {
        const i = await api('/api/siteinfo?url=' + encodeURIComponent(b.url)).catch(() => ({}));
        const logo = (i.logo || i.fallbackIcon) ? (await api('/api/siteinfo/logo', 'POST', { url: i.logo || i.fallbackIcon }).catch(() => ({}))).url : '';
        items.push({ title: b.title.slice(0, 40) || i.title, url: b.url, logo: logo || '', color: i.color || '' });
      }
      const res = await api('/api/tiles/import', 'POST', { items });
      L.toast(`${res.added} Kacheln angelegt`); refresh();
    } }, 'Übernehmen'), h('button', { class: 'btn', 'data-nav': true, onclick: () => m.close() }, 'Abbrechen'))]);
}

/* ============================================================
 * 5. Musikbox: Handy spielt per Bluetooth über den Fernseher
 * ============================================================ */
window.musicBox = async function () {
  await api('/api/music', 'POST', { action: 'on' }).catch((e) => L.toast(e.message));
  const art = h('div', { class: 'mb-art' }), title = h('div', { class: 'mb-title' }, 'Bereit für Musik'), artist = h('div', { class: 'mb-artist' }, '');
  const bar = h('i'), hint = h('div', { class: 'mb-hint' }, '');
  const btn = (label, action) => h('button', { class: 'btn', 'data-nav': true, onclick: () => api('/api/music', 'POST', { action }) }, label);
  const m = openModal([h('div', { class: 'musicbox' },
    art, h('div', { class: 'mb-info' }, h('div', { class: 'setup-kicker' }, 'Musikbox'), title, artist, h('div', { class: 'mb-bar' }, bar),
      h('div', { class: 'btns' }, btn('⏮', 'previous'), btn('⏯', 'play-pause'), btn('⏭', 'next'),
        h('button', { class: 'btn', 'data-nav': true, onclick: () => api('/api/key', 'POST', { key: 'voldown' }) }, '−'),
        h('button', { class: 'btn', 'data-nav': true, onclick: () => api('/api/key', 'POST', { key: 'volup' }) }, '+'),
        h('button', { class: 'btn danger', 'data-nav': true, onclick: () => m.close() }, 'Beenden')), hint))], 'music-modal');
  m.onclose = () => { clearInterval(iv); api('/api/music', 'POST', { action: 'off' }).catch(() => {}); };
  const paint = async () => {
    const st = await api('/api/music').catch(() => null);
    if (!st) return;
    if (!st.available) { hint.textContent = 'Bluetooth fehlt noch – kommt mit dem Update.'; return; }
    if (!st.player) {
      title.textContent = 'Bereit für Musik';
      artist.textContent = '';
      hint.innerHTML = 'Am Handy: Bluetooth → <b>„Lichtung Musik“</b> wählen und Musik abspielen.<br>iPhone: Kontrollzentrum → AirPlay → „Lichtung“.';
      return;
    }
    hint.textContent = st.playing ? '' : 'Pausiert';
    title.textContent = st.title || 'Unbekannter Titel';
    artist.textContent = [st.artist, st.album].filter(Boolean).join(' · ');
    bar.style.width = st.length ? Math.min(100, (st.position / st.length) * 100) + '%' : '0';
    art.style.backgroundImage = st.art ? `url("${st.art}")` : '';
    art.style.setProperty('--hue', hashHue(st.artist + st.album));
    $('.musicbox')?.classList.toggle('playing', !!st.playing);
  };
  paint();
  const iv = setInterval(paint, 1500);
  S.scene?.set({ motion: 'sanft' });
};

/* ============================================================
 * 6. Mediathek-Rekorder: Aufnahmen-Reihe + Einstellungen
 * ============================================================ */
const _renderMedia = renderMedia;
renderMedia = function () {
  _renderMedia();
  const box = $('#media-blocks');
  if (!box || !S.recordings?.length) return;
  const row = h('div', { class: 'row' });
  S.recordings.forEach((it) => {
    const el = h('button', { class: 'tile mk', 'data-nav': true },
      h('div', { class: 'art gen', style: { background: `linear-gradient(135deg, hsl(${it.hue} 30% 24%), hsl(${(it.hue + 30) % 360} 26% 10%))` } }),
      h('div', { class: 'wm' }, '●'), h('div', { class: 'shade' }),
      h('div', { class: 'num' }, `AUFNAHME · ${(it.channel || '').toUpperCase()}`),
      h('div', { class: 'dur' }, Math.round((it.duration || 0) / 60) + ' Min.'),
      h('div', { class: 'name' }, h('b', {}, it.title), h('span', {}, it.topic)));
    const url = '/play.html?' + new URLSearchParams({ src: '/data/rec/' + encodeURIComponent(it.file), title: it.title, sub: `Aufnahme · ${it.topic}`, key: 'rec:' + it.id, dur: it.duration || 0 });
    el.addEventListener('click', () => { launching(it.title); setTimeout(() => (location.href = url), 200); });
    el.addEventListener('navfocus', () => setHero(`Aufnahme · ${it.channel} · ${it.topic}`, it.title, it.description || 'Offline gespeichert – läuft ohne Internet.'));
    el.addEventListener('contextmenu', (e) => { e.preventDefault(); recMenu(it); });
    el._rec = it;
    row.append(el);
  });
  box.prepend(h('div', { class: 'block', 'data-row': 'aufnahmen' }, h('div', { class: 'row-label' }, 'Aufnahmen'), row));
};
function recMenu(it) {
  menu(it.title, it.topic, [
    { label: 'Abspielen', key: '↵', run: () => (location.href = '/play.html?' + new URLSearchParams({ src: '/data/rec/' + encodeURIComponent(it.file), title: it.title, sub: 'Aufnahme', key: 'rec:' + it.id })) },
    { label: 'Löschen', danger: true, run: async () => { await api('/api/recorder/delete', 'POST', { id: it.id }); loadRecordings(); } },
  ]);
}
const _contextFor2 = contextFor;
contextFor = function (el) { if (el && el._rec) return recMenu(el._rec); return _contextFor2(el); };
async function loadRecordings() {
  try { const r = await api('/api/recorder'); S.recordings = r.items; } catch (_) { S.recordings = []; }
  renderMedia();
}
const _afterRenderHome2 = window.afterRenderHome;
window.afterRenderHome = function () { _afterRenderHome2(); if (!S.recordings) loadRecordings(); };
L.events((ev) => { if (ev.type === 'recorded') { L.toast('Neue Aufnahme: ' + ev.title); loadRecordings(); } });

const _renderExtra = window.renderExtraSection;
window.renderExtraSection = function (sec, ctx) {
  if (sec !== 'recorder') return _renderExtra(sec, ctx);
  const { add, head, g } = ctx;
  head('Mediathek-Rekorder', 'Lädt neue Folgen deiner Lieblingssendungen automatisch herunter – dann laufen sie offline und ruckelfrei. Erscheinen auf der Startseite unter „Aufnahmen“.');
  const box = h('div', {}, h('div', { class: 'lead' }, 'Lade …'));
  add(box);
  api('/api/recorder').then((r) => {
    const c = r.config || { rules: [] };
    box.innerHTML = '';
    const save = async (patch) => { await api('/api/recorder', 'POST', patch); renderSection(true); };
    box.append(
      field('Rekorder', toggle(!!c.on, (v) => save({ on: v, runNow: v })), `Prüft stündlich · ${r.freeGB} GB frei${r.busy ? ` · lädt gerade „${r.busy}“ (${r.progress} %)` : ''}`),
      field('Aufbewahren', seg([[7, '1 Woche'], [14, '2 Wochen'], [30, '1 Monat'], [0, 'Für immer']], Number(c.keepDays ?? 14), (v) => save({ keepDays: v }))),
      field('Qualität', seg([['hd', 'HD (ca. 2 GB/Std.)'], ['sd', 'Normal (ca. 1 GB/Std.)']], c.quality || 'hd', (v) => save({ quality: v }))));
    const list = h('div', { class: 'menu-list' });
    (c.rules || []).forEach((rule, i) => list.append(h('div', { class: 'list-row' },
      h('div', { class: 'grow' }, h('b', {}, rule.topic || rule.text), h('span', {}, [(rule.channels || []).join(', ') || 'alle Sender', `ab ${rule.minMinutes} Min.`, `max. ${rule.max} Folgen`].join(' · '))),
      h('button', { class: 'btn', 'data-nav': true, onclick: () => save({ rules: c.rules.map((x, j) => (j === i ? { ...x, on: !x.on } : x)) }) }, rule.on ? 'an ✓' : 'aus'),
      h('button', { class: 'btn danger', 'data-nav': true, onclick: () => save({ rules: c.rules.filter((_, j) => j !== i) }) }, 'Entfernen'))));
    box.append(field('Sendungen', list, 'Sendungsname wie in der Mediathek, z. B. „Tatort“, „Terra X“, „Die Anstalt“'));
    const q = h('input', { class: 'inp', 'data-nav': true, placeholder: 'Neue Sendung, z. B. Polizeiruf 110' });
    box.append(h('div', { style: { display: 'flex', gap: '1em', marginTop: '1em' } }, q,
      h('button', { class: 'btn primary', 'data-nav': true, onclick: () => { if (q.value.trim()) save({ rules: [...(c.rules || []), { topic: q.value.trim(), minMinutes: 15, max: 2, on: true }], runNow: true }); } }, '+ Hinzufügen')));
    if (r.items.length) {
      const rec = h('div', { class: 'menu-list' }, r.items.map((it) => h('div', { class: 'list-row' },
        h('div', { class: 'grow' }, h('b', {}, it.title), h('span', {}, `${it.topic} · ${Math.round((it.size || 0) / 1e9 * 10) / 10} GB`)),
        h('button', { class: 'btn danger', 'data-nav': true, onclick: async () => { await api('/api/recorder/delete', 'POST', { id: it.id }); loadRecordings(); renderSection(true); } }, 'Löschen'))));
      box.append(field('Aufnahmen', rec));
    }
  });
};

/* ============================================================
 * 7. Zufallsdoku, Live-Webcams, Netzwerk-Dienste
 * ============================================================ */
window.randomDoc = async function () {
  launching('Suche eine Doku …');
  try {
    const it = await api('/api/mediathek/random');
    launching(it.title);
    setTimeout(() => (location.href = playUrl(it)), 900);
  } catch (e) { $('#launching').classList.remove('show'); L.toast(e.message); }
};

/* Webcam-Adresse → einbettbar? (YouTube-Video, HLS-Stream, Bild) */
function webcamEmbed(url) {
  const yt = (url || '').match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|live\/|embed\/)|youtu\.be\/)([\w-]{11})/);
  if (yt) return { kind: 'iframe', src: `https://www.youtube-nocookie.com/embed/${yt[1]}?autoplay=1&mute=1&controls=0&loop=1&playlist=${yt[1]}&playsinline=1&modestbranding=1` };
  if (/\.m3u8(\?|$)/.test(url)) return { kind: 'hls', src: url };
  if (/\.(jpe?g|png|webp)(\?|$)/i.test(url)) return { kind: 'image', src: url };
  return null;   // normale Webseite: nur im Kino-Fenster
}
window.applyWebcam = function (g) {
  let box = $('#webcam-bg');
  const emb = g.webcamBg ? webcamEmbed(g.webcamBg) : null;
  if (!emb) { box?.remove(); return; }
  if (box && box.dataset.src === emb.src) return;
  box?.remove();
  box = h('div', { id: 'webcam-bg', 'data-src': emb.src });
  if (emb.kind === 'iframe') box.append(h('iframe', { src: emb.src, allow: 'autoplay; encrypted-media', tabindex: '-1' }));
  else if (emb.kind === 'image') {
    const img = h('img', { src: emb.src });
    box.append(img);
    box._t = setInterval(() => { if (!document.contains(img)) return clearInterval(box._t); img.src = emb.src + (emb.src.includes('?') ? '&' : '?') + 't=' + Date.now(); }, 60000);
  } else {
    const v = h('video', { autoplay: true, muted: true, playsinline: true, loop: true });
    box.append(v);
    const s = document.createElement('script'); s.src = 'vendor/hls.light.min.js';
    s.onload = () => { if (window.Hls && Hls.isSupported()) { const hl = new Hls(); hl.loadSource(emb.src); hl.attachMedia(v); } else v.src = emb.src; };
    document.head.append(s);
  }
  $('#bg').append(box);
};

function webcamPicker() {
  const g = S.state.general, cams = g.webcams || [];
  const inp = h('input', { class: 'inp', 'data-nav': true, placeholder: 'Webcam-Link: YouTube-Live, .m3u8-Stream, Bild oder Webseite' });
  const name = h('input', { class: 'inp', 'data-nav': true, placeholder: 'Name, z. B. Kiel · Schwedenkai' });
  const list = h('div', { class: 'menu-list' }, cams.map((c, i) => {
    const emb = webcamEmbed(c.url);
    return h('div', { class: 'list-row' },
      h('div', { class: 'grow' }, h('b', {}, c.name), h('span', {}, emb ? 'geht als Hintergrund' : 'Webseite – öffnet im Kino-Fenster')),
      h('button', { class: 'btn', 'data-nav': true, onclick: () => { m.close(); openWeb(c.url, 'kino', c.name); } }, 'Ansehen'),
      emb ? h('button', { class: 'btn primary', 'data-nav': true, onclick: async () => { await saveGeneral({ webcamBg: c.url }); m.close(); L.toast('Webcam ist jetzt der Hintergrund'); } }, 'Als Hintergrund') : null,
      h('button', { class: 'btn danger', 'data-nav': true, onclick: async () => { await saveGeneral({ webcams: cams.filter((_, j) => j !== i) }); m.close(); webcamPicker(); } }, '×'));
  }));
  const m = openModal([h('h3', {}, 'Live-Webcams'),
    h('div', { class: 'lead' }, 'YouTube-Livestreams und .m3u8-Streams gehen als Hintergrund · Tipp: Auf YouTube „Kiel live“ suchen, Link per Handy schicken'),
    g.webcamBg ? h('div', { class: 'btns', style: { marginTop: 0 } }, h('button', { class: 'btn', 'data-nav': true, onclick: async () => { await saveGeneral({ webcamBg: '' }); m.close(); L.toast('Wieder Landschaft'); } }, 'Webcam-Hintergrund ausschalten')) : null,
    list,
    h('div', { style: { display: 'flex', gap: '1em', marginTop: '1.4em' } }, name, inp,
      h('button', { class: 'btn primary', 'data-nav': true, onclick: async () => {
        const u = inp.value.trim(); if (!u) return;
        await saveGeneral({ webcams: [...cams, { name: name.value.trim() || 'Webcam', url: /^https?:/.test(u) ? u : 'https://' + u }] }); m.close(); webcamPicker();
      } }, '+'))], 'apps-modal');
}
window.webcamPicker = webcamPicker;

// Knopf "Zufallsdoku" und "Webcams" in die Suchleiste
const _renderQuick = renderQuick;
renderQuick = function () {
  _renderQuick();
  const row = $('#quick-row');
  if (!row || $('#quick-block').hidden) return;
  const ref = row.children[4];
  row.insertBefore(quickBtn('Zufallsdoku', IC.yt, () => window.randomDoc(), ['Mediathek', 'Zufallsdoku', 'Eine zufällige, längere Doku aus Terra X, arte, ZDFinfo, 3sat … – einfach überraschen lassen.']), ref);
  row.insertBefore(quickBtn('Webcams', IC.brave, () => webcamPicker(), ['Live', 'Webcams', 'Kieler Förde, Hafen, Nordlicht, ISS – ansehen oder als lebendigen Hintergrund.']), ref);
};

const _renderExtra2 = window.renderExtraSection;
window.renderExtraSection = function (sec, ctx) {
  if (sec !== 'services') return _renderExtra2(sec, ctx);
  const { add, head } = ctx;
  head('Netzwerk-Dienste', 'Dinge, die der Laptop leise im Hintergrund für dein ganzes Zuhause erledigt.');
  const box = h('div', {}, h('div', { class: 'lead' }, 'Lade …'));
  add(box);
  api('/api/services').then((sv) => {
    box.innerHTML = '';
    // WLAN-Werbeblocker
    const ag = sv.adguard;
    box.append(field('WLAN-Werbeblocker', ag.installed ? toggle(ag.active, async (v) => { const r = await api('/api/adguard', 'POST', { on: v }); L.toast(r.ok ? (v ? 'AdGuard läuft' : 'AdGuard aus') : r.msg); renderSection(true); })
      : h('span', {}, 'nicht installiert (kommt mit dem Update)'), 'AdGuard Home blockt Werbung & Tracker für alle Geräte im WLAN'));
    if (ag.active) {
      box.append(h('div', { class: 'lead', style: { textTransform: 'none', letterSpacing: '.02em' } },
        (ag.setup ? 'Eingerichtet. ' : 'Einmal einrichten: Knopf „Einrichten“ (Benutzer + Passwort festlegen, Port 53 lassen). ') +
        `Dann am Router (z. B. FRITZ!Box: Heimnetz → Netzwerk → Netzwerkeinstellungen → IPv4 → Lokaler DNS-Server) ${sv.ip} eintragen. Tipp: dem Laptop im Router eine feste IP geben.`),
        h('div', { class: 'btns' }, h('button', { class: 'btn primary', 'data-nav': true, onclick: () => openWeb(`http://${sv.ip}:${ag.setup ? 80 : 3000}`, 'tab', 'AdGuard Home') }, ag.setup ? 'AdGuard öffnen' : 'Einrichten')));
    }
    // Bau-Station
    const rn = sv.runner;
    const url = h('input', { class: 'inp', 'data-nav': true, placeholder: 'https://github.com/christianbom2007-lgtm/Android_Launcher' });
    const tok = h('input', { class: 'inp', 'data-nav': true, type: 'password', placeholder: 'Runner-Token (Repo → Settings → Actions → Runners → New self-hosted runner)' });
    const msg = h('div', { class: 'lead', style: { textTransform: 'none', letterSpacing: '.02em' } },
      rn.state === 'active' ? `Läuft für ${rn.url} · ${rn.job === 'baut' ? 'baut gerade …' : 'wartet auf Aufträge'}` : rn.state === 'fehlt' ? 'Root-Helfer fehlt – kommt mit dem Update.' : 'Noch nicht eingerichtet.');
    box.append(field('Bau-Station (GitHub Actions)', h('div', {}, msg,
      h('div', { style: { display: 'flex', gap: '1em', marginTop: '.8em' } }, url, tok),
      h('div', { class: 'btns' },
        h('button', { class: 'btn primary', 'data-nav': true, onclick: async () => {
          msg.textContent = 'Richte ein – lädt den Runner (ca. 1–2 Minuten) …';
          const r = await api('/api/runner', 'POST', { url: url.value.trim(), token: tok.value.trim() }).catch((e) => ({ msg: e.message }));
          msg.textContent = r.msg || (r.ok ? 'Fertig' : 'Fehler');
        } }, 'Einrichten'),
        rn.state === 'active' ? h('button', { class: 'btn danger', 'data-nav': true, onclick: async () => { const r = await api('/api/runner', 'POST', { remove: true }); L.toast(r.msg); renderSection(true); } }, 'Stoppen') : null)),
      'Dein Laptop baut deine Flutter-APKs selbst. Im Workflow: runs-on: [self-hosted, lichtung]. Token & Adresse am bequemsten per Handy → Text tippen.'));
    // Galaxy Book
    box.append(field('Galaxy Book als Bildschirm', h('div', { class: 'lead', style: { textTransform: 'none', letterSpacing: '.02em', margin: 0 } },
      '1) Auf dem Galaxy Book „Sunshine“ installieren (github.com/LizardByte/Sunshine). 2) Für einen echten zweiten Bildschirm zusätzlich den „Virtual Display Driver“ (github.com/VirtualDrivers/Virtual-Display-Driver). 3) Hier Kachel „Galaxy Book“ öffnen → PC wählen → PIN in Sunshine bestätigen. Tastatur & Maus des Laptops steuern dann den PC.'),
      'Moonlight-Streaming: sehr wenig Verzögerung, auch für Spiele'));
  });
};

/* ============================================================
 * 8. Systemüberwachung auf der Startseite + weitere Netzwerk-Dienste
 * ============================================================ */
const fmtRate = (b) => b > 1e6 ? (b / 1e6).toFixed(1).replace('.', ',') + ' MB/s' : Math.round(b / 1e3) + ' kB/s';
function statBar(label, pct) { return `<span class="st"><i>${label}</i><b style="--p:${Math.max(2, Math.min(100, pct || 0))}%"></b>`; }
async function paintStats() {
  const el = $('#stats');
  if (!el) return;
  if (S.state?.general.showStats === false || S.view !== 'home' || document.hidden) { if (S.state?.general.showStats === false) el.innerHTML = ''; return; }
  const st = await api('/api/stats').catch(() => null);
  if (!st || st.cpu == null) return;
  const memPct = st.memTotal ? (st.mem / st.memTotal) * 100 : 0;
  el.innerHTML = `${statBar('CPU', st.cpu)}<em>${st.cpu} %</em></span>${statBar('RAM', memPct)}<em>${String(st.mem).replace('.', ',')} / ${Math.round(st.memTotal)} GB</em></span>` +
    (st.temp != null ? `${statBar('TEMP', ((st.temp - 30) / 60) * 100)}<em class="${st.temp > 80 ? 'hot' : ''}">${st.temp} °C</em></span>` : '') +
    `<span class="st"><i>NETZ</i><em>↓ ${fmtRate(st.down)} · ↑ ${fmtRate(st.up)}</em></span>`;
}
setInterval(paintStats, 2500);
setTimeout(paintStats, 800);

const SERVICES = [
  ['tailscale', 'Tailscale', 'Sicherer Zugriff von überall – auch die Handy-Fernbedienung unterwegs', null],
  ['vaultwarden', 'Vaultwarden (Bitwarden)', 'Eigener Passwort-Tresor für die Bitwarden-App · HTTPS über Tailscale', null],
  ['syncthing', 'Syncthing', 'Handy-Fotos & Obsidian-Vault automatisch sichern (App „Syncthing-Fork“)', 'http://127.0.0.1:8384'],
  ['kuma', 'Uptime Kuma', 'Überwacht Websites & Dienste, meldet Ausfälle aufs Handy', 'http://127.0.0.1:3002'],
  ['gitea', 'Gitea-Spiegel', 'Sicherungskopie deiner GitHub-Repos (Neue Migration → GitHub → Spiegel)', 'http://127.0.0.1:3001'],
];
const _renderExtra3 = window.renderExtraSection;
window.renderExtraSection = function (sec, ctx) {
  _renderExtra3(sec, ctx);
  if (sec !== 'services') return;
  const box = h('div', {}, h('div', { class: 'lead' }, 'Lade Dienste …'));
  ctx.add(box);
  api('/api/services').then((sv) => {
    box.innerHTML = '';
    const ts = sv.tailscale || {};
    SERVICES.forEach(([id, name, desc, url]) => {
      const st = (sv.dienste || {})[id] || 'fehlt';
      const on = st === 'läuft';
      const row = h('div', { class: 'list-row' },
        h('div', { class: 'grow' }, h('b', {}, name), h('span', {}, `${desc} · ${st === 'fehlt' ? 'kommt mit dem Update' : st}`)),
        st !== 'fehlt' ? h('button', { class: 'btn' + (on ? '' : ' primary'), 'data-nav': true, onclick: async () => {
          L.toast(on ? 'Stoppe …' : 'Starte … (beim ersten Mal lädt der Dienst einige Minuten)');
          const r = await api('/api/dienst', 'POST', { name: id, on: !on }).catch((e) => ({ msg: e.message }));
          if (r.msg) L.toast(r.msg);
          setTimeout(() => renderSection(true), 2500);
        } }, on ? 'Ausschalten' : 'Einschalten') : null,
        on && url ? h('button', { class: 'btn', 'data-nav': true, onclick: () => openWeb(url, 'tab', name) }, 'Öffnen') : null,
        on && id === 'tailscale' && ts.state !== 'Running' ? h('button', { class: 'btn primary', 'data-nav': true, onclick: () => tailscaleLogin() }, 'Anmelden') : null,
        on && id === 'vaultwarden' ? h('button', { class: 'btn', 'data-nav': true, onclick: async () => {
          const r = await api('/api/vaultwarden/https', 'POST', {});
          menu('Vaultwarden mit HTTPS', ts.name ? `https://${ts.name}` : 'Erst Tailscale anmelden', [{ label: r.msg || 'Fertig', run: () => {} },
            { label: 'Bitwarden-App: Einstellungen → Server → selbst gehostet → diese Adresse', run: () => {} }]);
        } }, 'HTTPS einrichten') : null);
      box.append(row);
    });
    if (ts.state === 'Running') box.append(h('div', { class: 'lead', style: { textTransform: 'none', letterSpacing: '.02em', marginTop: '1em' } },
      `Tailscale verbunden: ${ts.name} · ${(ts.ips || []).join(', ')}. Unterwegs: Tailscale-App am Handy an, dann http://${(ts.ips || [])[0]}:8770/remote`));
    box.append(h('div', { class: 'lead', style: { textTransform: 'none', letterSpacing: '.02em', marginTop: '1em' } },
      'Vaultwarden: beim ersten Öffnen ein Konto anlegen. Bitwarden-Apps brauchen HTTPS – deshalb läuft der Tresor über Tailscale (in der Tailscale-Verwaltung einmal „HTTPS Certificates“ einschalten). Zusätzlich sicher: in Bitwarden Zwei-Faktor aktivieren.'));
  });
};

async function tailscaleLogin() {
  const qrBox = h('div', { class: 'qr' });
  const msg = h('div', { class: 'lead', style: { textTransform: 'none' } }, 'Hole Anmelde-Link …');
  const m = openModal([h('h3', {}, 'Tailscale anmelden'), h('div', { class: 'remote-box' }, qrBox, h('div', {}, msg,
    h('p', { class: 'setup-lead' }, 'QR-Code mit dem Handy scannen und mit Google/GitHub anmelden. Danach ist der Fernseher in deinem privaten Netz.'))),
    h('div', { class: 'btns' }, h('button', { class: 'btn', 'data-nav': true, onclick: () => { m.close(); renderSection(true); } }, 'Fertig'))]);
  const r = await api('/api/tailscale/login', 'POST', {}).catch((e) => ({ msg: e.message }));
  if (r.url) {
    msg.textContent = r.url;
    try { const q = qrcode(0, 'M'); q.addData(r.url); q.make(); qrBox.innerHTML = q.createSvgTag({ cellSize: 6, margin: 0, scalable: true }); } catch (_) {}
  } else msg.textContent = r.msg || 'Schon angemeldet – oder Tailscale fehlt.';
}

/* Terminal-Knopf in der Suchleiste */
const _renderQuick2 = renderQuick;
renderQuick = function () {
  _renderQuick2();
  const row = $('#quick-row');
  if (!row || $('#quick-block').hidden) return;
  row.insertBefore(quickBtn('Terminal', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9l3 3-3 3M12 15h5"/></svg>',
    () => launchApp('terminal', 'Terminal'), ['Programme', 'Terminal', 'Befehl „lichtung“ zeigt ein Menü: Status, Update, Programme installieren, Logs. btop = Systemüberwachung. Strg+Alt+T geht von überall.']), row.lastElementChild);
};

/* ============================================================
 * Einmalige Frage nach dem Update (23.11.2026): neues schlichtes Design „Klar“
 * → übernehmen und direkt anpassen, nur anpassen, oder alles so lassen.
 * ============================================================ */
(() => {
  const wait = setInterval(() => {
    if (typeof S === 'undefined' || !S.state || S.view !== 'home' || S.modals.length || S.saverOn) return;
    clearInterval(wait);
    const g = S.state.general;
    if (!g.setupDone || g.designAsked) return;
    const done = (m) => { m.close(); return api('/api/general', 'POST', { designAsked: 1 }).then((r) => { S.state.general = r; }); };
    const klar = PACKAGES.find((p) => p.id === 'klar');
    const m = openModal([
      h('h3', {}, 'Neues Design: Klar'),
      h('p', { class: 'note', style: { maxWidth: '60ch', lineHeight: 1.55, margin: '0 0 calc(2.4*var(--u))' } },
        'Schlichter und ruhiger: einfarbiger Hintergrund, klare Schrift, keine Leucht-Effekte. Du kannst es übernehmen und danach direkt Farben, Hintergrund und Symbole anpassen.'),
      h('div', { class: 'btns' },
        h('button', { class: 'btn primary', 'data-nav': true, onclick: async () => { await done(m); await applyPackage(klar); openSettings('look'); L.toast('Design: Klar – jetzt nach Wunsch anpassen'); } }, 'Klar übernehmen & anpassen'),
        h('button', { class: 'btn', 'data-nav': true, onclick: async () => { await done(m); openSettings('look'); } }, 'Nur anpassen'),
        h('button', { class: 'btn', 'data-nav': true, onclick: () => done(m) }, 'So lassen')),
    ]);
  }, 1500);
})();
