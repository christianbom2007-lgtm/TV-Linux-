/* Lichtung TV – Einrichtungsassistent (erscheint beim allerersten Start)
 * Schritte: Willkommen → Ort → Ton → Profile → Kacheln → Handy → Fertig
 * Kann jederzeit über Einstellungen → System → Einrichtung wiederholen neu gestartet werden.
 */
'use strict';

const SETUP = { step: 0, data: {} };

function runSetup(onDone) {
  SETUP.step = 0;
  SETUP.onDone = onDone;
  SETUP.data = { city: S.state.general.city, lat: S.state.general.lat, lon: S.state.general.lon, profileName: S.state.profiles.find((p) => p.isDefault)?.name || 'Wohnzimmer', extra: null, tiles: new Set(S.state.tiles.map((t) => t.url)) };
  paintSetup();
}

const SETUP_STEPS = ['welcome', 'place', 'sound', 'profiles', 'tiles', 'phone', 'done'];

function setupShell(title, lead, body, buttons) {
  const root = $('#setup');
  root.innerHTML = '';
  const n = SETUP.step;
  root.append(h('div', { class: 'setup-card' },
    h('div', { class: 'setup-steps' }, SETUP_STEPS.map((_, i) => h('i', { class: i < n ? 'done' : i === n ? 'on' : '' }))),
    h('div', { class: 'setup-kicker' }, `Einrichtung · ${L.pad(n + 1)} / ${L.pad(SETUP_STEPS.length)}`),
    h('h2', {}, title),
    lead ? h('p', { class: 'setup-lead' }, lead) : null,
    h('div', { class: 'setup-body' }, body),
    h('div', { class: 'btns setup-btns' }, buttons)));
  show('setup');
  const def = root.querySelector('[data-nav-default]') || root.querySelector('.btn.primary');
  if (def) setTimeout(() => Nav.focus(def, { instant: true }), 30);
}

const next = () => { SETUP.step++; paintSetup(); };
const prev = () => { if (SETUP.step > 0) { SETUP.step--; paintSetup(); } };
const btn = (label, onclick, primary) => h('button', { class: 'btn' + (primary ? ' primary' : ''), 'data-nav': true, onclick }, label);

async function paintSetup() {
  const step = SETUP_STEPS[SETUP.step], d = SETUP.data;
  if (step === 'welcome') {
    setupShell('Willkommen bei Lichtung.', 'Dein Laptop ist jetzt ein Fernseher. Ein paar Fragen, dann geht es los – alles lässt sich später unter Einstellungen ändern.',
      h('div', { class: 'setup-keys' },
        h('div', {}, h('kbd', {}, '← ↑ → ↓'), ' bewegen'), h('div', {}, h('kbd', {}, 'Enter / OK'), ' auswählen'), h('div', {}, h('kbd', {}, 'Esc / Zurück'), ' einen Schritt zurück')),
      [btn('Los geht’s', next, true)]);
  }
  if (step === 'place') {
    const q = h('input', { class: 'inp', 'data-nav': true, placeholder: 'Ort suchen, z. B. Kiel', value: '' });
    const list = h('div', { class: 'menu-list' });
    const cur = h('p', { class: 'setup-lead', style: { margin: 0 } }, `Aktuell: ${d.city}`);
    const search = async () => {
      list.innerHTML = '<div class="lead">Suche …</div>';
      const r = await api('/api/geocode?q=' + encodeURIComponent(q.value)).catch(() => []);
      list.innerHTML = '';
      if (!r.length) list.append(h('div', { class: 'lead' }, 'Nichts gefunden – oder kein Internet.'));
      r.forEach((x) => list.append(h('button', { 'data-nav': true, onclick: () => { Object.assign(d, { city: x.name, lat: x.latitude, lon: x.longitude }); cur.textContent = `Gewählt: ${x.name}`; Nav.focus($('#setup .btn.primary')); } },
        h('span', {}, x.name), h('span', { class: 'k' }, [x.admin1, x.country].filter(Boolean).join(', ')))));
      if (r.length) Nav.focus(list.firstElementChild);
    };
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter') search(); });
    setupShell('Wo steht der Fernseher?', 'Für Wetter, Bildschirmschoner und den Himmel im Hintergrund (Sonne, Mond, Regen …).',
      [h('div', { style: { display: 'flex', gap: '1em' } }, q, btn('Suchen', search)), cur, list],
      [btn('Zurück', prev), btn('Weiter', async () => { await api('/api/general', 'POST', { city: d.city, lat: d.lat, lon: d.lon }); next(); }, true)]);
  }
  if (step === 'sound') {
    const list = h('div', { class: 'menu-list' }, h('div', { class: 'lead' }, 'Suche Tonausgänge …'));
    const paint = async () => {
      const a = await api('/api/audio').catch(() => ({ sinks: [] }));
      list.innerHTML = '';
      if (!a.sinks.length) list.append(h('div', { class: 'lead' }, 'Keine Ausgänge gefunden – das passt meistens trotzdem.'));
      a.sinks.forEach((sk) => list.append(h('button', { 'data-nav': true, onclick: async () => { await api('/api/audio', 'POST', { id: sk.id }); beep(); paint(); } },
        h('span', {}, sk.name), h('span', { class: 'k' }, (sk.default ? 'aktiv ✓ ' : '') + (sk.hdmi ? 'HDMI' : '')))));
    };
    paint();
    setupShell('Kommt der Ton richtig?', 'Wähle den Ausgang – beim Fernseher am HDMI-Kabel meist „HDMI“. Beim Auswählen ertönt ein kurzer Ton.',
      list, [btn('Zurück', prev), btn('Testton', beep), btn('Ton passt', next, true)]);
  }
  if (step === 'profiles') {
    const name = h('input', { class: 'inp', 'data-nav': true, value: d.profileName });
    name.addEventListener('input', () => (d.profileName = name.value));
    const extraInfo = h('p', { class: 'setup-lead', style: { margin: 0 } }, d.extra ? `Zusätzlich: ${d.extra.name}${d.extra.pin ? ' (mit PIN)' : ''}` : '');
    const addExtra = async () => {
      const m = openModal([h('h3', {}, 'Weiteres Profil'), h('div', { class: 'lead' }, 'Eigene Kacheln & Weiterschauen, auf Wunsch mit PIN'),
        h('input', { class: 'inp', 'data-nav': true, id: 'xname', placeholder: 'Name, z. B. Christian' }),
        h('div', { class: 'btns' }, h('button', { class: 'btn primary', 'data-nav': true, onclick: async () => {
          const nm = $('#xname').value.trim(); if (!nm) return;
          m.close();
          const pin = await askPin('PIN festlegen (oder Zurück = ohne PIN)');
          d.extra = { name: nm, pin }; extraInfo.textContent = `Zusätzlich: ${nm}${pin ? ' (mit PIN)' : ''}`;
        } }, 'Weiter'), h('button', { class: 'btn', 'data-nav': true, onclick: () => m.close() }, 'Abbrechen'))], 'small');
      setTimeout(() => Nav.focus($('#xname')), 40);
    };
    setupShell('Wer schaut hier?', 'Das Standardprofil startet automatisch ohne PIN. Weitere Profile (z. B. mit PIN) kannst du jetzt oder später anlegen.',
      [field('Standardprofil', name), extraInfo],
      [btn('Zurück', prev), btn('+ Weiteres Profil', addExtra), btn('Weiter', async () => {
        const def = S.state.profiles.find((p) => p.isDefault) || S.state.profiles[0];
        await api('/api/profiles/' + def.id, 'PUT', { name: d.profileName.trim() || 'Wohnzimmer' });
        if (d.extra && !S.state.profiles.some((p) => p.name === d.extra.name)) await api('/api/profiles', 'POST', { name: d.extra.name, pin: d.extra.pin || undefined });
        await load(); next();
      }, true)]);
  }
  if (step === 'tiles') {
    const grid = h('div', { class: 'setup-tiles' }, PRESETS.map((p) => {
      const on = d.tiles.has(p.url);
      const b = h('button', { class: 'setup-tile' + (on ? ' on' : ''), 'data-nav': true, style: { background: `linear-gradient(135deg, hsl(${p.hue} 30% 26%), hsl(${(p.hue + 25) % 360} 26% 11%))` } },
        h('b', {}, p.title), h('span', {}, p.subtitle), h('i', {}, '✓'));
      b.addEventListener('click', () => { d.tiles.has(p.url) ? d.tiles.delete(p.url) : d.tiles.add(p.url); b.classList.toggle('on', d.tiles.has(p.url)); });
      return b;
    }));
    setupShell('Was willst du schauen?', 'Ausgewählte Dienste werden Kacheln auf der Startseite. Eigene Websites mit Bild und Text kannst du später jederzeit anlegen.',
      grid, [btn('Zurück', prev), btn('Übernehmen', async () => {
        // Kacheln des Standardprofils an die Auswahl anpassen (eigene Kacheln bleiben)
        const presetUrls = new Set(PRESETS.map((p) => p.url));
        for (const t of S.state.tiles) if (presetUrls.has(t.url) && !d.tiles.has(t.url)) await api('/api/tiles/' + t.id, 'DELETE');
        for (const p of PRESETS) if (d.tiles.has(p.url) && !S.state.tiles.some((t) => t.url === p.url)) await api('/api/tiles', 'POST', { tile: p });
        await load(); next();
      }, true)]);
  }
  if (step === 'phone') {
    const qrBox = h('div', { class: 'qr' }), code = h('div', { class: 'big-code' }, '····'), addr = h('div', { style: { fontSize: 'calc(2*var(--u))' } }, '…');
    api('/api/netinfo').then((n) => {
      const url = `http://${n.ip}:${n.port}/remote`;
      addr.textContent = url; code.textContent = n.pin;
      try { const qr = qrcode(0, 'M'); qr.addData(url + '#' + n.pin); qr.make(); qrBox.innerHTML = qr.createSvgTag({ cellSize: 6, margin: 0, scalable: true }); } catch (_) {}
    });
    setupShell('Dein Handy als Fernbedienung', 'Handy ins gleiche WLAN, QR-Code mit der Kamera scannen. Dann: steuern, tippen, Links schicken, eigene Fotos hochladen.',
      h('div', { class: 'remote-box' }, qrBox, h('div', {}, h('div', { class: 'lead', style: { marginBottom: '.4em' } }, 'Adresse'), addr, h('div', { class: 'lead', style: { margin: '2em 0 .2em' } }, 'Code'), code)),
      [btn('Zurück', prev), btn('Später', next), btn('Erledigt', next, true)]);
  }
  if (step === 'done') {
    setupShell('Alles bereit.', 'Viel Spaß beim Schauen. Die wichtigsten Tasten:',
      h('div', { class: 'setup-keys' },
        h('div', {}, h('kbd', {}, 'Windows / F1 / Home'), ' von überall zur Startseite'),
        h('div', {}, h('kbd', {}, '☰ / M'), ' Optionen zur Kachel'),
        h('div', {}, h('kbd', {}, 'S'), ' Einstellungen'), h('div', {}, h('kbd', {}, 'T'), ' Schlaf-Timer'),
        h('div', {}, h('kbd', {}, '1 – 9'), ' Kachel direkt öffnen')),
      [btn('Zurück', prev), btn('Fernsehen', async () => {
        await api('/api/general', 'POST', { setupDone: true });
        await load();
        SETUP.onDone && SETUP.onDone();
      }, true)]);
  }
}

/* Kurzer, sanfter Testton (zwei Töne) über WebAudio */
function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [523.25, 783.99].forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = f; o.type = 'sine';
      g.gain.setValueAtTime(0, ctx.currentTime + i * 0.25);
      g.gain.linearRampToValueAtTime(0.25, ctx.currentTime + i * 0.25 + 0.03);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.25 + 0.6);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + i * 0.25); o.stop(ctx.currentTime + i * 0.25 + 0.65);
    });
    setTimeout(() => ctx.close(), 1500);
  } catch (_) {}
}
