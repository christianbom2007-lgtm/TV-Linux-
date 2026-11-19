/* Lichtung TV – Lebendige Hintergründe
 * ------------------------------------------------------------
 * Eine Landschaft, die mitlebt:
 *  - Himmel nach echtem Sonnenstand (Nacht, Blaue Stunde, Morgenrot, Tag, Abendrot)
 *  - Mond mit echter Mondphase und Position, Sonne mit Schein
 *  - Funkelnde Sterne, Sternschnuppen, auf Wunsch Polarlicht
 *  - Wolken nach echter Bewölkung, ziehend mit echtem Wind
 *  - Regen, Niesel, Schnee, Nebel, Gewitter mit Blitzen – nach echtem Wetter
 *  - Jahreszeit: Schneekappen im Winter, Glühwürmchen in Sommernächten, Vögel am Tag
 *
 * Leistung: Himmel + Landschaft werden nur einmal pro Minute neu gezeichnet
 * (statische Ebene). Animiert werden nur Partikel, Wolken und Funkeln – mit
 * höchstens 30 Bildern pro Sekunde und in reduzierter Auflösung.
 */
'use strict';

(function () {
  const RAD = Math.PI / 180;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const mix = (c1, c2, t) => c1.map((v, i) => Math.round(lerp(v, c2[i], t)));
  const rgb = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

  function rng(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------- Astronomie (vereinfacht, für Bilder völlig ausreichend) ---------- */
  function dayOfYear(d) { return Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 864e5); }
  function sunAltitude(d, lat, lon) {
    const decl = -23.44 * Math.cos((360 / 365) * (dayOfYear(d) + 10) * RAD);
    const utcH = d.getUTCHours() + d.getUTCMinutes() / 60;
    const H = (utcH + lon / 15 - 12) * 15;                       // Stundenwinkel
    const alt = Math.asin(Math.sin(lat * RAD) * Math.sin(decl * RAD) + Math.cos(lat * RAD) * Math.cos(decl * RAD) * Math.cos(H * RAD)) / RAD;
    return { alt, H, decl };
  }
  /** Mondphase 0..1 (0 = Neumond, 0.5 = Vollmond) */
  function moonPhase(d) {
    const days = (d - Date.UTC(2000, 0, 6, 18, 14)) / 864e5;
    const p = (days % 29.530588853) / 29.530588853;
    return p < 0 ? p + 1 : p;
  }
  function moonAltitude(d, lat, lon) {
    // Der Mond läuft der Sonne pro Tag ~12,2° hinterher
    const s = sunAltitude(d, lat, lon), H = s.H - moonPhase(d) * 360;
    const decl = s.decl * Math.cos(moonPhase(d) * 2 * Math.PI) * 0.9;
    const alt = Math.asin(Math.sin(lat * RAD) * Math.sin(decl * RAD) + Math.cos(lat * RAD) * Math.cos(decl * RAD) * Math.cos(H * RAD)) / RAD;
    return { alt, H: ((H % 360) + 540) % 360 - 180 };
  }

  /* ---------- Himmelsfarben je nach Sonnenhöhe (gedämpft, Lichtung bleibt dunkel) ---------- */
  const SKY = [
    // [Sonnenhöhe, oben, Mitte, Horizont, Umgebungslicht 0..1]
    [-18, [6, 9, 15], [12, 18, 26], [14, 20, 24], 0.0],
    [-10, [9, 13, 26], [24, 32, 52], [44, 44, 60], 0.08],
    [-4, [18, 26, 50], [62, 58, 86], [150, 96, 84], 0.2],
    [0, [30, 44, 74], [104, 92, 112], [214, 136, 92], 0.32],
    [6, [46, 70, 104], [112, 128, 150], [222, 178, 128], 0.5],
    [20, [52, 84, 120], [104, 132, 160], [168, 172, 170], 0.68],
    [60, [44, 82, 126], [94, 130, 166], [150, 168, 176], 0.78],
  ];
  function skyAt(alt) {
    if (alt <= SKY[0][0]) return SKY[0];
    for (let i = 1; i < SKY.length; i++) {
      if (alt <= SKY[i][0]) {
        const a = SKY[i - 1], b = SKY[i], t = (alt - a[0]) / (b[0] - a[0]);
        return [alt, mix(a[1], b[1], t), mix(a[2], b[2], t), mix(a[3], b[3], t), lerp(a[4], b[4], t)];
      }
    }
    return SKY[SKY.length - 1];
  }

  /* ---------- Wettercodes (Open-Meteo / WMO) ---------- */
  function weatherKind(code) {
    if (code == null) return 'clear';
    if (code <= 1) return 'clear';
    if (code === 2) return 'partly';
    if (code === 3) return 'overcast';
    if (code === 45 || code === 48) return 'fog';
    if (code >= 51 && code <= 57) return 'drizzle';
    if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
    if (code >= 95) return 'storm';
    return 'clear';
  }

  /* ---------- Landschaften ---------- */
  // Landschaften: layers = Bergketten [Höhe, Ausschlag, Rauheit], pines = Tannenreihen,
  // water = Wasserlinie, jag = schroffe Gipfel, extra = Besonderheiten (Stadt, Leuchtturm …)
  const SCENES = {
    nacht: { seed: 7, layers: [[0.55, 0.24, 1], [0.68, 0.16, 0.8], [0.82, 0.10, 0.6]], pines: [[1.0, 0.13, 26]], peaks: true },
    wald: { seed: 21, layers: [[0.56, 0.12, 0.6]], pines: [[0.68, 0.07, 70], [0.86, 0.12, 40], [1.02, 0.2, 18]] },
    fjord: { seed: 42, layers: [[0.52, 0.22, 1], [0.60, 0.10, 0.5]], water: 0.6, peaks: true },
    duene: { seed: 9, layers: [[0.66, 0.08, 0.2], [0.76, 0.10, 0.15], [0.90, 0.12, 0.1]] },
    see: { seed: 33, layers: [[0.54, 0.10, 0.5]], pines: [[0.62, 0.05, 90]], water: 0.64, reflect: true },
    kueste: { seed: 51, layers: [[0.72, 0.05, 0.2]], water: 0.6, sea: true, extra: 'leuchtturm' },
    gipfel: { seed: 64, layers: [[0.50, 0.30, 1], [0.64, 0.20, 0.9], [0.80, 0.10, 0.6]], peaks: true, jag: 2.2, pines: [[1.0, 0.1, 30]] },
    huegel: { seed: 77, layers: [[0.62, 0.07, 0.15], [0.72, 0.08, 0.15], [0.84, 0.09, 0.12]], trees: true },
    tundra: { seed: 88, layers: [[0.74, 0.04, 0.3], [0.84, 0.05, 0.2]], aurora: true },
    stadt: { seed: 95, layers: [[0.78, 0.04, 0.2]], water: 0.8, extra: 'stadt' },
    insel: { seed: 15, layers: [], water: 0.66, sea: true, extra: 'insel' },
    canyon: { seed: 27, layers: [[0.5, 0.18, 1.4], [0.62, 0.14, 1.2], [0.78, 0.1, 1]], jag: 1.6, warm: [120, 62, 40] },
    // Abstrakte Hintergründe für die Design-Welten (eigene Entwürfe, keine Original-Bilder)
    w_cupertino: { wall: [[18, 22, 52], [[120, 80, 230, 0.55, 0.25, 0.35, 0.7], [40, 140, 255, 0.5, 0.75, 0.55, 0.8], [255, 90, 160, 0.35, 0.55, 0.9, 0.6]]] },
    w_one: { wall: [[6, 12, 28], [[30, 120, 255, 0.45, 0.2, 0.2, 0.9], [20, 210, 200, 0.3, 0.85, 0.8, 0.7]]] },
    w_flamme: { wall: [[8, 14, 26], [[255, 140, 40, 0.38, 0.9, 0.95, 0.75], [40, 70, 140, 0.4, 0.15, 0.1, 0.8]]] },
    w_konsole: { wall: [[4, 6, 5], [[60, 200, 80, 0.4, 0.5, 1.15, 0.9], [20, 90, 40, 0.5, 0.15, 0.0, 0.6]]] },
    w_fenster: { wall: [[8, 14, 34], [[60, 130, 255, 0.6, 0.5, 0.55, 0.45], [120, 90, 255, 0.4, 0.42, 0.5, 0.7]]], bloom: true },
    w_adwaita: { wall: [[24, 26, 36], [[80, 110, 220, 0.45, 0.1, 0.9, 0.9], [150, 90, 200, 0.35, 0.9, 0.1, 0.8]]] },
    w_breeze: { wall: [[16, 20, 26], [[40, 140, 220, 0.4, 0.8, 0.3, 0.8]]], tri: true },
    w_aubergine: { wall: [[44, 0, 30], [[233, 84, 32, 0.55, 1.0, 1.0, 0.9], [119, 33, 111, 0.6, 0.1, 0.1, 0.9]]] },
    w_matrix: { wall: [[0, 4, 0], [[0, 120, 40, 0.25, 0.5, 0.5, 1]]], matrix: true },
  };
  const SEASON_SCENE = ['nacht', 'nacht', 'see', 'see', 'huegel', 'kueste', 'kueste', 'kueste', 'wald', 'wald', 'wald', 'nacht'];

  function ridgePath(w, h, base, amp, rough, r, jag = 0) {
    const p = [r() * 10, r() * 10, r() * 10, r() * 10], pts = [];
    for (let x = 0; x <= w; x += 3) {
      const t = x / w;
      let y = base - Math.sin(t * 3.1 + p[0]) * amp * 0.55 - Math.sin(t * 7.3 + p[1]) * amp * 0.25 * rough - Math.abs(Math.sin(t * 17 + p[2])) * amp * 0.12 * rough;
      if (jag) y -= Math.pow(Math.abs(Math.sin(t * 9 + p[3])), 6) * amp * 0.35 * jag - Math.abs(Math.sin(t * 41 + p[2])) * amp * 0.03 * jag;
      pts.push([x, y]);
    }
    return pts;
  }
  function fillPath(ctx, pts, w, h, style) {
    ctx.beginPath(); ctx.moveTo(0, h);
    for (const [x, y] of pts) ctx.lineTo(x, y);
    ctx.lineTo(w, h); ctx.closePath(); ctx.fillStyle = style; ctx.fill();
  }
  function pine(ctx, x, y, s) {
    ctx.beginPath(); ctx.moveTo(x, y - s * 2.2);
    for (let k = 0; k < 4; k++) { const yy = y - s * 2.2 + (k + 1) * s * 0.55, ww = s * (0.25 + k * 0.17); ctx.lineTo(x + ww, yy); ctx.lineTo(x + ww * 0.45, yy); }
    ctx.lineTo(x + s * 0.08, y); ctx.lineTo(x - s * 0.08, y);
    for (let k = 3; k >= 0; k--) { const yy = y - s * 2.2 + (k + 1) * s * 0.55, ww = s * (0.25 + k * 0.17); ctx.lineTo(x - ww * 0.45, yy); ctx.lineTo(x - ww, yy); }
    ctx.closePath(); ctx.fill();
  }

  /* Jahreszeit: 0 Winter, 1 Frühling, 2 Sommer, 3 Herbst */
  function season(d) { const m = d.getMonth(); return m <= 1 || m === 11 ? 0 : m <= 4 ? 1 : m <= 7 ? 2 : 3; }
  const SEASON_TINT = [[0, 0, 0], [6, 14, 0], [0, 6, 0], [22, 6, -8]];

  /* ======================================================================
   * Die Szene
   * ====================================================================== */
  class Scene {
    constructor(container, opts = {}) {
      this.container = container;
      this.opts = Object.assign({ scene: 'nacht', motion: 'voll', weatherFx: true, aurora: false, scale: 0.6, fps: 30, season: false, seasonFx: true }, opts);
      this.loc = { lat: 54.32, lon: 10.12 };
      this.weather = null;       // Open-Meteo-Antwort
      this.override = null;      // Vorschau: { hour, kind }
      this.photo = null;
      this.base = document.createElement('canvas');   // statisch: Himmel, Mond, Landschaft
      this.fx = document.createElement('canvas');     // animiert: Wolken, Partikel, Funkeln
      this.flash = document.createElement('div');     // Blitz-Aufhellung
      this.flash.style.cssText = 'position:absolute;inset:0;background:#dfe6ff;opacity:0;pointer-events:none;transition:opacity .08s';
      for (const c of [this.base, this.fx]) c.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
      container.innerHTML = '';
      this.photoEl = document.createElement('div');
      this.photoEl.className = 'photo';
      this.photoEl.style.display = 'none';
      container.append(this.base, this.photoEl, this.fx, this.flash);
      this.particles = []; this.clouds = []; this.stars = []; this.shooting = null; this.birds = null; this.bolt = null;
      this.running = false; this.last = 0; this.lastStatic = 0;
      this.resize();
      if (opts.static) return;     // Vorschaubild: keine Animation, keine Ereignisse
      this._onResize = () => { this.resize(); this.drawStatic(true); };
      addEventListener('resize', this._onResize);
      document.addEventListener('visibilitychange', () => (document.hidden ? this.stop() : this.start()));
    }
    /* Welche Landschaft gerade gilt (bei "Jahreszeiten" wechselt sie automatisch) */
    sceneId() { return this.opts.season ? SEASON_SCENE[new Date().getMonth()] : this.opts.scene; }

    /* ----- Konfiguration ----- */
    set(opts) {
      const before = JSON.stringify(this.opts);
      Object.assign(this.opts, opts);
      if (JSON.stringify(this.opts) !== before) { this.resize(); this.drawStatic(true); }
      this.start();
    }
    setLocation(lat, lon) {
      const loc = { lat: Number(lat) || 54.3, lon: Number(lon) || 10.1 };
      if (loc.lat === this.loc.lat && loc.lon === this.loc.lon) return;
      this.loc = loc; this.drawStatic(true);
    }
    setWeather(w) { this.weather = w; this.resetFx(); this.drawStatic(true); }
    setPhoto(url) {
      if ((url || null) === this.photo) return;
      this.photo = url || null;
      this.photoEl.style.display = url ? 'block' : 'none';
      if (url) this.photoEl.style.backgroundImage = `url("${url}")`;
      this.drawStatic(true);
    }
    preview(p) { this.override = p; this.resetFx(); this.drawStatic(true); }

    resize() {
      const s = this.opts.scale;
      this.w = this.opts.width || Math.max(320, Math.round(innerWidth * s));
      this.h = this.opts.height || Math.max(180, Math.round(innerHeight * s));
      for (const c of [this.base, this.fx]) { c.width = this.w; c.height = this.h; }
      this.resetFx();
    }

    /* ----- aktueller Zustand: Zeit, Sonne, Mond, Wetter ----- */
    state() {
      const now = new Date();
      let d = now;
      if (this.override && this.override.hour != null) {
        d = new Date(now); d.setHours(Math.floor(this.override.hour), (this.override.hour % 1) * 60, 0, 0);
      }
      const sun = sunAltitude(d, this.loc.lat, this.loc.lon);
      const moon = moonAltitude(d, this.loc.lat, this.loc.lon);
      const c = this.weather && this.weather.current || {};
      let kind = weatherKind(c.weather_code);
      if (this.override && this.override.kind) kind = this.override.kind;
      if (!this.opts.weatherFx && !this.override?.kind) kind = 'clear';
      const cover = this.override?.kind ? { clear: 5, partly: 45, overcast: 95, fog: 80, drizzle: 85, rain: 95, snow: 90, storm: 100 }[kind]
        : (c.cloud_cover ?? { clear: 5, partly: 45, overcast: 95, fog: 80, drizzle: 85, rain: 95, snow: 90, storm: 100 }[kind]);
      const wind = c.wind_speed_10m ?? 12;
      const month = d.getMonth();
      const temp = c.temperature_2m ?? 8;
      return { d, sunAlt: sun.alt, sunH: sun.H, moonAlt: moon.alt, moonH: moon.H, phase: moonPhase(d), kind, cover, wind,
        winter: month === 11 || month <= 1 || temp < 1, summer: month >= 4 && month <= 7, season: season(d) };
    }

    /* ----- statische Ebene ----- */
    drawStatic(force) {
      const st = this.state();
      this.st = st;
      const key = [Math.round(st.sunAlt * 2), st.kind, Math.round(st.cover / 10), this.sceneId(), this.photo, this.w, this.opts.season].join('|');
      if (!force && key === this._key) return;
      this._key = key;
      const ctx = this.base.getContext('2d'), w = this.w, h = this.h;
      const sky = skyAt(st.sunAlt);
      const gloom = clamp((st.cover - 40) / 60, 0, 1) * 0.55;          // dichte Wolken → grauer, dunkler
      const grey = [40, 44, 48];
      const top = mix(sky[1], mix(grey, [10, 12, 14], 1 - sky[4]), gloom);
      const mid = mix(sky[2], mix(grey, [16, 18, 20], 1 - sky[4]), gloom);
      const hor = mix(sky[3], mix([70, 72, 74], [20, 22, 24], 1 - sky[4]), gloom);
      this.light = sky[4] * (1 - gloom * 0.5);
      this.onLight && this.onLight(this.light);
      this.skyTop = top; this.skyHor = hor;
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, rgb(top)); g.addColorStop(0.55, rgb(mid)); g.addColorStop(0.75, rgb(hor)); g.addColorStop(1, rgb(mix(hor, [8, 10, 10], 0.6)));
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);

      const r = rng(SCENES[this.sceneId()]?.seed || 7);
      const wallScene = SCENES[this.sceneId()];
      if (wallScene && wallScene.wall && !this.photo) { this.drawWall(ctx, wallScene, r); return; }
      // Sterne (Positionen fest, Sichtbarkeit nach Dämmerung und Wolken)
      this.starAlpha = clamp((-st.sunAlt - 4) / 10, 0, 1) * clamp(1 - st.cover / 85, 0, 1);
      this.stars = [];
      for (let i = 0; i < 360; i++) this.stars.push({ x: r() * w, y: r() * h * 0.6, s: r() * 1.3 + 0.3, a: 0.25 + r() * 0.65, tw: r() < 0.25, ph: r() * 6.28 });
      if (this.starAlpha > 0) {
        for (const s of this.stars) if (!s.tw) { ctx.globalAlpha = s.a * this.starAlpha; ctx.fillStyle = '#f4efe6'; ctx.fillRect(s.x, s.y, s.s, s.s); }
        ctx.globalAlpha = 1;
      }

      // Sonne: Bahn von links nach rechts, Höhe nach Sonnenstand
      const arcX = (H) => w * (0.5 + clamp(H / 120, -0.6, 0.6) * 0.8);
      const arcY = (alt) => h * (0.62 - clamp(alt, -10, 60) / 60 * 0.5);
      const sunVis = clamp((st.sunAlt + 3) / 6, 0, 1) * clamp(1 - st.cover / 90, 0.15, 1);
      if (sunVis > 0) {
        const sx = arcX(st.sunH), sy = arcY(st.sunAlt), sr = h * 0.035;
        const warm = clamp(1 - st.sunAlt / 25, 0, 1);
        const col = mix([255, 244, 220], [255, 170, 110], warm);
        const glow = ctx.createRadialGradient(sx, sy, sr, sx, sy, sr * 12);
        glow.addColorStop(0, rgb(col, 0.35 * sunVis)); glow.addColorStop(0.3, rgb(col, 0.12 * sunVis)); glow.addColorStop(1, rgb(col, 0));
        ctx.fillStyle = glow; ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = rgb(col, 0.9 * sunVis); ctx.beginPath(); ctx.arc(sx, sy, sr, 0, 7); ctx.fill();
      }
      // Mond mit echter Phase
      const moonVis = clamp((st.moonAlt + 2) / 6, 0, 1) * clamp((-st.sunAlt + 8) / 12, 0.25, 1) * clamp(1 - st.cover / 95, 0.1, 1);
      this.moonPos = null;
      if (moonVis > 0.02) {
        const mx = arcX(st.moonH), my = arcY(st.moonAlt), mr = h * 0.04;
        this.moonPos = { x: mx, y: my, r: mr, vis: moonVis };
        const illum = (1 - Math.cos(st.phase * 2 * Math.PI)) / 2;      // 0 = Neumond, 1 = Vollmond
        const glow = ctx.createRadialGradient(mx, my, mr, mx, my, mr * 9);
        const ga = 0.2 * moonVis * illum + 0.03;
        glow.addColorStop(0, `rgba(230,215,190,${ga})`); glow.addColorStop(0.25, `rgba(230,215,190,${ga * 0.35})`); glow.addColorStop(0.6, `rgba(230,215,190,${ga * 0.08})`); glow.addColorStop(1, 'rgba(230,215,190,0)');
        ctx.fillStyle = glow; ctx.fillRect(0, 0, w, h);
        ctx.save();
        ctx.beginPath(); ctx.arc(mx, my, mr, 0, 7); ctx.clip();
        ctx.fillStyle = rgb(mix(top, [0, 0, 0], 0.2), 0.9 * moonVis); ctx.fillRect(mx - mr, my - mr, mr * 2, mr * 2);   // dunkle Seite
        // beleuchteter Teil: Halbkreis + Ellipse (Terminator)
        const waxing = st.phase < 0.5, k = Math.cos(st.phase * 2 * Math.PI);  // 1 → 0 → -1 → 0 → 1
        ctx.fillStyle = `rgba(236,226,206,${0.95 * moonVis})`;
        ctx.beginPath();
        ctx.arc(mx, my, mr, -Math.PI / 2, Math.PI / 2, !waxing);
        ctx.ellipse(mx, my, Math.abs(k) * mr, mr, 0, Math.PI / 2, -Math.PI / 2, (k > 0) === waxing);
        ctx.fill();
        // Krater-Andeutung
        ctx.fillStyle = `rgba(160,150,135,${0.18 * moonVis})`;
        [[-0.3, -0.2, 0.22], [0.25, 0.15, 0.16], [-0.05, 0.35, 0.12]].forEach(([dx, dy, rr]) => { ctx.beginPath(); ctx.arc(mx + dx * mr, my + dy * mr, rr * mr, 0, 7); ctx.fill(); });
        ctx.restore();
      }

      // Landschaft – Farbe hängt vom Umgebungslicht ab
      if (!this.photo) this.drawLand(ctx, st, r);
    }

    /* Abstrakter Hintergrund: Grundfarbe + weiche Farbflecken (+ Muster) */
    drawWall(ctx, sc, r) {
      const w = this.w, h = this.h, [base, blobs] = sc.wall;
      ctx.fillStyle = rgb(base); ctx.fillRect(0, 0, w, h);
      for (const [cr, cg, cb, a, x, y, rad] of blobs) {
        const g = ctx.createRadialGradient(w * x, h * y, 0, w * x, h * y, Math.max(w, h) * rad);
        g.addColorStop(0, `rgba(${cr},${cg},${cb},${a})`); g.addColorStop(0.5, `rgba(${cr},${cg},${cb},${a * 0.35})`); g.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      }
      if (sc.bloom) {   // weiche Blütenblätter in der Mitte
        ctx.save(); ctx.translate(w * 0.5, h * 0.55);
        for (let i = 0; i < 7; i++) {
          ctx.rotate(Math.PI * 2 / 7);
          const g = ctx.createLinearGradient(0, 0, 0, -h * 0.42);
          g.addColorStop(0, 'rgba(90,160,255,0.0)'); g.addColorStop(0.6, 'rgba(110,170,255,0.22)'); g.addColorStop(1, 'rgba(180,210,255,0.05)');
          ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(0, -h * 0.2, h * 0.09, h * 0.24, 0, 0, 7); ctx.fill();
        }
        ctx.restore();
      }
      if (sc.tri) {     // feine geometrische Dreiecke
        ctx.strokeStyle = 'rgba(120,180,230,0.07)'; ctx.lineWidth = 1;
        for (let i = 0; i < 40; i++) { const x = r() * w, y = r() * h, s = h * (0.05 + r() * 0.15); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + s, y + s * 0.3); ctx.lineTo(x + s * 0.3, y + s); ctx.closePath(); ctx.stroke(); }
      }
      this.light = 0.15; this.starAlpha = 0; this.moonPos = null; this.waterY = null; this.lighthouse = null; this.windows = null;
      this.onLight && this.onLight(0.1);
    }

    drawLand(ctx, st, r) {
      const w = this.w, h = this.h, sc = SCENES[this.sceneId()] || SCENES.nacht, L = this.light;
      const hor = this.skyHor;
      // Jahreszeit färbt die Landschaft leicht (Frühling grüner, Herbst wärmer)
      const tint = this.opts.season || this.opts.seasonFx ? SEASON_TINT[st.season] : [0, 0, 0];
      const landBase = sc.warm ? sc.warm : [28 + tint[0], 36 + tint[1], 40 + tint[2]];
      const base = (depth) => mix(mix(landBase, hor, 0.25 * (1 - depth)), sc.warm ? [150, 96, 70] : [70 + tint[0], 86 + tint[1], 82], L * (1 - depth * 0.6));
      sc.layers.forEach(([y, amp, rough], i) => {
        const depth = i / Math.max(1, sc.layers.length);
        const pts = ridgePath(w, h, h * y, h * amp, rough, r, sc.jag || 0);
        fillPath(ctx, pts, w, h, rgb(mix(base(depth), [6, 8, 8], depth * 0.75)));
        // Schneekappen im Winter auf den hohen Bergen
        if (st.winter && sc.peaks && i === 0) {
          ctx.save(); ctx.beginPath(); ctx.moveTo(0, h);
          for (const [x, yy] of pts) ctx.lineTo(x, yy); ctx.lineTo(w, h); ctx.closePath(); ctx.clip();
          const minY = Math.min(...pts.map((p) => p[1]));
          const sg = ctx.createLinearGradient(0, minY, 0, minY + h * 0.09);
          sg.addColorStop(0, `rgba(225,232,236,${0.35 + L * 0.4})`); sg.addColorStop(1, 'rgba(225,232,236,0)');
          ctx.fillStyle = sg; ctx.fillRect(0, minY, w, h * 0.1); ctx.restore();
        }
        if (i === 0 && (st.kind === 'fog' || st.kind === 'drizzle' || st.sunAlt < 2 && st.sunAlt > -6)) this.fogBand(ctx, h * (y + 0.04), h * 0.08, 0.12 + (st.kind === 'fog' ? 0.18 : 0));
      });
      if (sc.water) {
        const wy = h * sc.water;
        if (sc.reflect) {   // See: Spiegelbild der Landschaft
          ctx.save(); ctx.globalAlpha = 0.35; ctx.translate(0, wy * 2); ctx.scale(1, -1);
          ctx.drawImage(this.base, 0, 0, w, wy, 0, 0, w, wy); ctx.restore();
        }
        const wg = ctx.createLinearGradient(0, wy, 0, h);
        wg.addColorStop(0, rgb(mix(this.skyHor, [10, 14, 18], sc.sea ? 0.35 : 0.55), sc.reflect ? 0.7 : 0.95)); wg.addColorStop(1, 'rgba(5,7,10,1)');
        ctx.fillStyle = wg; ctx.fillRect(0, wy, w, h - wy);
        if (sc.sea) {     // Meer: Horizontlinie und Wellenstriche
          ctx.fillStyle = rgb(mix(this.skyHor, [255, 255, 255], 0.15), 0.35); ctx.fillRect(0, wy, w, 1);
          ctx.strokeStyle = rgb(mix(this.skyHor, [220, 220, 220], 0.3), 0.08);
          for (let i = 0; i < 70; i++) { const y = wy + Math.pow(r(), 1.6) * (h - wy), x = r() * w, l = 10 + (y - wy) / (h - wy) * 70; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + l, y); ctx.stroke(); }
        }
        this.waterY = wy;
      } else this.waterY = null;
      this.lighthouse = null;
      if (sc.extra === 'leuchtturm') {
        // Klippe rechts mit Leuchtturm (Lichtkegel dreht sich in der Animation)
        const cx = w * 0.78, cy = h * 0.6;
        ctx.fillStyle = rgb(mix(base(0.4), [4, 6, 6], 0.5));
        ctx.beginPath(); ctx.moveTo(w * 0.62, h); ctx.lineTo(w * 0.66, cy + h * 0.02); ctx.lineTo(w * 0.74, cy - h * 0.01); ctx.lineTo(w * 0.86, cy - h * 0.02); ctx.lineTo(w * 0.93, cy + h * 0.03); ctx.lineTo(w, cy + h * 0.06); ctx.lineTo(w, h); ctx.fill();
        const tw = h * 0.018, th = h * 0.11, tx = cx, ty = cy - h * 0.012;
        ctx.fillStyle = rgb(mix([200, 196, 188], [20, 22, 24], 1 - L * 0.8));
        ctx.beginPath(); ctx.moveTo(tx - tw, ty); ctx.lineTo(tx - tw * 0.7, ty - th); ctx.lineTo(tx + tw * 0.7, ty - th); ctx.lineTo(tx + tw, ty); ctx.fill();
        ctx.fillStyle = 'rgba(160,40,36,.75)'; ctx.fillRect(tx - tw * 0.85, ty - th * 0.55, tw * 1.7, th * 0.12);
        this.lighthouse = { x: tx, y: ty - th - h * 0.008 };
      }
      if (sc.extra === 'stadt') {
        // Skyline am Wasser mit Fensterlichtern (nachts mehr Lichter)
        const night = clamp(1 - L * 1.6, 0, 1), gy = h * 0.8;
        ctx.fillStyle = rgb(mix(base(0.3), [6, 8, 10], 0.65));
        let x = 0;
        this.windows = [];
        while (x < w) {
          const bw = w * (0.025 + r() * 0.045), bh = h * (0.06 + Math.pow(r(), 1.5) * 0.26);
          ctx.fillRect(x, gy - bh, bw, bh);
          if (r() < 0.12) ctx.fillRect(x + bw * 0.45, gy - bh - h * 0.03, bw * 0.08, h * 0.03);   // Antenne
          for (let yy = gy - bh + h * 0.012; yy < gy - h * 0.01; yy += h * 0.016)
            for (let xx = x + bw * 0.12; xx < x + bw - bw * 0.15; xx += bw * 0.2)
              if (r() < 0.32 * night + 0.03) this.windows.push([xx, yy, r()]);
          x += bw + w * 0.002;
        }
        for (const [wx, wy, k] of this.windows) { ctx.fillStyle = `rgba(255,${200 + k * 40},${120 + k * 60},${0.5 + k * 0.4})`; ctx.fillRect(wx, wy, Math.max(1, w * 0.003), Math.max(1, h * 0.005)); }
        // Spiegelung der Lichter im Hafen
        ctx.globalAlpha = 0.18;
        for (const [wx, wy, k] of this.windows) { ctx.fillStyle = 'rgba(255,210,150,1)'; ctx.fillRect(wx, gy + (gy - wy) * 0.4, w * 0.003, h * 0.002); }
        ctx.globalAlpha = 1;
      }
      if (sc.extra === 'insel') {
        const ix = w * 0.62, iy = h * 0.66;
        ctx.fillStyle = rgb(mix(base(0.3), [6, 8, 8], 0.6));
        ctx.beginPath(); ctx.ellipse(ix, iy, w * 0.16, h * 0.035, 0, Math.PI, 0); ctx.fill();
        for (let k = 0; k < 9; k++) pine(ctx, ix - w * 0.12 + r() * w * 0.24, iy - h * 0.008, h * (0.02 + r() * 0.025));
      }
      if (sc.trees) {     // Hügel: einzelne runde Laubbäume (Herbst: rötlich)
        const leaf = st.season === 3 ? [90, 52, 28] : st.season === 1 ? [46, 70, 40] : [30, 46, 36];
        ctx.fillStyle = rgb(mix(mix(leaf, [6, 8, 8], 0.5), [90, 110, 90], L * 0.4));
        for (let k = 0; k < 14; k++) {
          const tx = r() * w, ty = h * (0.66 + r() * 0.2), tr = h * (0.012 + r() * 0.02);
          ctx.fillRect(tx - tr * 0.08, ty, tr * 0.16, tr * 1.2);
          ctx.beginPath(); ctx.arc(tx, ty, tr, 0, 7); ctx.fill();
        }
      }
      (sc.pines || []).forEach(([y, size, n], i) => {
        ctx.fillStyle = rgb(mix(base(0.6 + i * 0.2), [4, 6, 5], 0.55 + i * 0.15));
        for (let k = 0; k < n; k++) pine(ctx, r() * w, h * y + r() * h * size * 0.4, h * size * (0.6 + r() * 0.8));
        if (st.winter && i === 0) { // Schnee auf dem Boden
          ctx.fillStyle = `rgba(210,220,226,${0.05 + L * 0.12})`; ctx.fillRect(0, h * (y + 0.02), w, h);
        }
      });
    }

    fogBand(ctx, y, height, alpha) {
      const g = ctx.createLinearGradient(0, y - height, 0, y + height);
      g.addColorStop(0, 'rgba(180,190,185,0)'); g.addColorStop(0.5, `rgba(180,190,185,${alpha})`); g.addColorStop(1, 'rgba(180,190,185,0)');
      ctx.fillStyle = g; ctx.fillRect(0, y - height, this.w, height * 2);
    }

    /* ----- animierte Ebene ----- */
    resetFx() {
      this.particles = []; this.clouds = []; this.fireflies = [];
      this._fxKey = null;
    }
    intensity() { return this.opts.motion === 'aus' ? 0 : this.opts.motion === 'sanft' ? 0.5 : 1; }

    ensureFx(st) {
      const key = st.kind + '|' + Math.round(st.cover / 10) + '|' + this.opts.motion + '|' + this.w;
      if (key === this._fxKey) return;
      this._fxKey = key;
      const w = this.w, h = this.h, I = this.intensity(), r = Math.random;
      // Wolken: Anzahl nach Bedeckung
      const nC = Math.round((st.cover / 100) * 16 * (0.5 + I * 0.5));
      this.clouds = Array.from({ length: nC }, () => this.newCloud(true));
      // Niederschlag
      const n = { rain: 420, drizzle: 260, storm: 520, snow: 260 }[st.kind] || 0;
      this.particles = Array.from({ length: Math.round(n * I) }, () => this.newDrop(st, true));
      // Glühwürmchen: Sommernacht im Wald, trocken
      this.fireflies = (['wald', 'see', 'huegel'].includes(this.sceneId()) && st.summer && st.sunAlt < -3 && ['clear', 'partly'].includes(st.kind))
        ? Array.from({ length: Math.round(28 * I) }, () => ({ x: r() * w, y: h * (0.7 + r() * 0.28), ph: r() * 6.28, sp: 0.3 + r() * 0.6 })) : [];
    }
    newCloud(anywhere) {
      const w = this.w, h = this.h, r = Math.random;
      const size = h * (0.06 + r() * 0.1);
      // Eine Wolke = viele flache, weiche Bällchen, unten flacher, oben bauschiger
      const n = 9 + Math.floor(r() * 7);
      const puffs = Array.from({ length: n }, (_, i) => {
        const t = i / (n - 1) - 0.5;
        return [t * 3.4 + (r() - 0.5) * 0.4, -Math.cos(t * Math.PI) * 0.45 * r() - 0.05, 0.55 + r() * 0.6 * Math.cos(t * Math.PI * 0.9)];
      });
      return { x: anywhere ? r() * w * 1.3 - w * 0.15 : -size * 3, y: h * (0.06 + r() * 0.38), size, puffs, a: 0.3 + r() * 0.35, sp: 0.4 + r() * 0.8 };
    }
    newDrop(st, anywhere) {
      const w = this.w, h = this.h, r = Math.random;
      if (st.kind === 'snow') return { x: r() * w, y: anywhere ? r() * h : -5, v: 0.4 + r() * 0.8, s: 0.8 + r() * 2, ph: r() * 6.28 };
      const fine = st.kind === 'drizzle';
      return { x: r() * w * 1.2 - w * 0.1, y: anywhere ? r() * h : -20, v: (fine ? 6 : 11) + r() * 6, l: fine ? 4 + r() * 4 : 10 + r() * 12, a: fine ? 0.18 : 0.28 + r() * 0.2 };
    }

    start() {
      if (this.running || document.hidden) return;
      this.running = true;
      const loop = (t) => {
        if (!this.running) return;
        requestAnimationFrame(loop);
        const minDt = 1000 / (this.opts.motion === 'sanft' ? 20 : this.opts.fps);
        if (t - this.last < minDt) return;
        const dt = Math.min(100, t - (this.last || t)) / 16.67;
        this.last = t;
        if (t - this.lastStatic > 60000) { this.lastStatic = t; this.drawStatic(); }
        this.frame(t, dt);
      };
      requestAnimationFrame(loop);
    }
    stop() { this.running = false; }

    frame(t, dt) {
      const st = this.st || this.state();
      const ctx = this.fx.getContext('2d'), w = this.w, h = this.h, I = this.intensity();
      ctx.clearRect(0, 0, w, h);
      if (!I) return;
      const sc0 = SCENES[this.sceneId()];
      if (sc0 && sc0.wall && !this.photo) {
        if (sc0.matrix) {   // fallende grüne Zeichen
          const fs = Math.max(8, Math.round(h / 45)), cols = Math.ceil(w / fs);
          if (!this.rain || this.rain.length !== cols) this.rain = Array.from({ length: cols }, () => Math.random() * h);
          ctx.font = fs + 'px monospace';
          for (let i = 0; i < cols; i++) {
            const y = this.rain[i];
            for (let k = 0; k < 14; k++) { ctx.fillStyle = `rgba(80,255,120,${(1 - k / 14) * (k ? 0.35 : 0.9)})`; ctx.fillText(String.fromCharCode(0x30A0 + Math.floor(Math.random() * 96)), i * fs, y - k * fs); }
            this.rain[i] = y > h + 14 * fs ? -Math.random() * h * 0.5 : y + fs * 0.35 * dt * I;
          }
        } else {            // ganz leichtes Schimmern
          const x = w * (0.5 + 0.3 * Math.sin(t / 9000)), y = h * (0.5 + 0.25 * Math.cos(t / 11000));
          const g = ctx.createRadialGradient(x, y, 0, x, y, h * 0.6);
          g.addColorStop(0, 'rgba(255,255,255,0.035)'); g.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
        }
        return;
      }
      this.ensureFx(st);
      const windX = clamp(st.wind / 25, 0.15, 2.5);

      // funkelnde Sterne
      if (this.starAlpha > 0) {
        ctx.fillStyle = '#f4efe6';
        for (const s of this.stars) if (s.tw) {
          ctx.globalAlpha = this.starAlpha * s.a * (0.45 + 0.55 * Math.sin(t / 700 + s.ph));
          ctx.fillRect(s.x, s.y, s.s + 0.4, s.s + 0.4);
        }
        ctx.globalAlpha = 1;
        // Sternschnuppe (bei klarer Nacht etwa jede Minute)
        if (!this.shooting && this.starAlpha > 0.6 && Math.random() < 0.0006 * dt * I) {
          this.shooting = { x: w * (0.2 + Math.random() * 0.6), y: h * (0.05 + Math.random() * 0.2), vx: (Math.random() < 0.5 ? -1 : 1) * (5 + Math.random() * 4), vy: 2 + Math.random() * 2, life: 1 };
        }
        if (this.shooting) {
          const s = this.shooting;
          const g = ctx.createLinearGradient(s.x, s.y, s.x - s.vx * 9, s.y - s.vy * 9);
          g.addColorStop(0, `rgba(255,250,240,${0.9 * s.life})`); g.addColorStop(1, 'rgba(255,250,240,0)');
          ctx.strokeStyle = g; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x - s.vx * 9, s.y - s.vy * 9); ctx.stroke();
          s.x += s.vx * dt; s.y += s.vy * dt; s.life -= 0.022 * dt;
          if (s.life <= 0) this.shooting = null;
        }
      }

      // Leuchtturm: drehender Lichtkegel
      if (this.lighthouse && this.light < 0.45) {
        const { x, y } = this.lighthouse, ang = (t / 2600) % (Math.PI * 2), len = w * 0.5;
        const dir = Math.cos(ang), a = 0.18 * (1 - this.light * 2) * (0.4 + 0.6 * Math.abs(dir));
        const g = ctx.createLinearGradient(x, y, x + dir * len, y);
        g.addColorStop(0, `rgba(255,236,190,${a})`); g.addColorStop(1, 'rgba(255,236,190,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + dir * len, y - h * 0.05); ctx.lineTo(x + dir * len, y + h * 0.05); ctx.fill();
        ctx.fillStyle = `rgba(255,240,200,${0.5 + 0.5 * Math.abs(dir)})`; ctx.beginPath(); ctx.arc(x, y, h * 0.006, 0, 7); ctx.fill();
      }
      // Stadt: einzelne Fenster gehen an und aus
      if (this.windows && this.windows.length && Math.random() < 0.05 * dt) {
        const wdw = this.windows[Math.floor(Math.random() * this.windows.length)];
        wdw[3] = !wdw[3];
      }
      if (this.windows) for (const wdw of this.windows) if (wdw[3]) { ctx.fillStyle = 'rgba(8,10,12,.9)'; ctx.fillRect(wdw[0], wdw[1], Math.max(1, w * 0.003), Math.max(1, h * 0.005)); }

      // Jahreszeit: fallende Blätter (Herbst) oder Blüten (Frühling), nur bei trockenem Wetter
      if (this.opts.seasonFx && (st.season === 3 || st.season === 1) && ['clear', 'partly', 'overcast'].includes(st.kind) && this.light > 0.1) {
        if (!this.leaves) this.leaves = Array.from({ length: Math.round(26 * I) }, () => ({ x: Math.random() * w, y: Math.random() * h, v: 0.3 + Math.random() * 0.6, s: 2 + Math.random() * 3, ph: Math.random() * 6.28, k: Math.random() }));
        for (const l of this.leaves) {
          l.y += l.v * dt; l.x += (Math.sin(t / 700 + l.ph) * 0.8 + windX * 0.4) * dt;
          if (l.y > h) { l.y = -5; l.x = Math.random() * w; }
          if (l.x > w) l.x -= w;
          ctx.save(); ctx.translate(l.x, l.y); ctx.rotate(Math.sin(t / 500 + l.ph) * 1.2);
          ctx.fillStyle = st.season === 3 ? `rgba(${180 + l.k * 50},${80 + l.k * 60},${30},.75)` : `rgba(250,${210 + l.k * 30},${225 + l.k * 20},.75)`;
          ctx.beginPath(); ctx.ellipse(0, 0, l.s, l.s * 0.55, 0, 0, 7); ctx.fill(); ctx.restore();
        }
      } else this.leaves = null;

      // Polarlicht (optional, nur in klaren Nächten; in der Tundra immer)
      if ((this.opts.aurora || SCENES[this.sceneId()]?.aurora) && this.starAlpha > 0.5) {
        for (let b = 0; b < 3; b++) {
          ctx.beginPath();
          for (let x = 0; x <= w; x += 8) {
            const y = h * (0.16 + b * 0.05) + Math.sin(x / w * 6 + t / 3000 + b) * h * 0.04 + Math.sin(x / w * 13 + t / 1700) * h * 0.015;
            x ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
          }
          const g = ctx.createLinearGradient(0, h * 0.05, 0, h * 0.45);
          const hue = b === 1 ? '120,220,170' : '90,200,150';
          g.addColorStop(0, `rgba(${hue},0)`); g.addColorStop(0.5, `rgba(${hue},${0.10 * this.starAlpha})`); g.addColorStop(1, `rgba(${hue},0)`);
          ctx.strokeStyle = g; ctx.lineWidth = h * 0.09; ctx.stroke();
        }
      }

      // Wolken
      const tint = mix(this.skyHor || [40, 40, 40], [210, 214, 218], clamp(this.light * 1.1, 0.05, 0.85));
      const dark = st.kind === 'storm' || st.kind === 'rain' ? 0.45 : 0;
      const ccol = mix(tint, [20, 22, 26], dark + (1 - this.light) * 0.35);
      for (const c of this.clouds) {
        c.x += c.sp * windX * 0.25 * dt * (I > 0.5 ? 1 : 0.6);
        if (c.x - c.size * 2.5 > w) Object.assign(c, this.newCloud(false));
        const top = mix(ccol, [235, 232, 225], 0.18 + this.light * 0.2);   // Oberseite heller (angestrahlt)
        for (const [dx, dy, s] of c.puffs) {
          const px = c.x + dx * c.size, py = c.y + dy * c.size, pr = c.size * s;
          ctx.save(); ctx.translate(px, py); ctx.scale(1.25, 0.62);
          const g = ctx.createRadialGradient(0, -pr * 0.25, 0, 0, 0, pr);
          g.addColorStop(0, rgb(top, c.a * 0.5)); g.addColorStop(0.55, rgb(ccol, c.a * 0.32)); g.addColorStop(1, rgb(ccol, 0));
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, pr, 0, 7); ctx.fill();
          ctx.restore();
        }
        // Mondlicht schimmert durch
        if (this.moonPos && Math.hypot(c.x - this.moonPos.x, c.y - this.moonPos.y) < c.size * 1.5) {
          ctx.fillStyle = `rgba(230,220,200,${0.04 * this.moonPos.vis})`;
          ctx.beginPath(); ctx.arc(this.moonPos.x, this.moonPos.y, c.size * 1.2, 0, 7); ctx.fill();
        }
      }

      // Nebel zieht
      if (st.kind === 'fog') {
        for (let i = 0; i < 3; i++) {
          const y = h * (0.55 + i * 0.12), off = ((t / (90 + i * 40)) % w);
          for (const x0 of [off - w, off]) {
            const g = ctx.createLinearGradient(x0, 0, x0 + w, 0);
            g.addColorStop(0, 'rgba(190,198,196,0)'); g.addColorStop(0.5, `rgba(190,198,196,${0.10 + i * 0.03})`); g.addColorStop(1, 'rgba(190,198,196,0)');
            ctx.fillStyle = g; ctx.fillRect(x0, y - h * 0.06, w, h * 0.12);
          }
        }
      }

      // Wasser glitzert (Fjord): Mond/Sonnen-Spiegelung
      if (this.waterY != null) {
        const src = this.moonPos || null;
        const x = src ? src.x : w * 0.5, strength = src ? src.vis * 0.5 : this.light * 0.4;
        for (let i = 0; i < 26; i++) {
          const y = this.waterY + (i / 26) * (h - this.waterY), wid = (8 + i * 2.2) * (0.6 + 0.4 * Math.sin(t / 500 + i * 1.7));
          ctx.fillStyle = `rgba(235,222,195,${strength * (1 - i / 30) * 0.35})`;
          ctx.fillRect(x - wid / 2 + Math.sin(t / 800 + i) * 4, y, wid, 1.2);
        }
      }

      // Regen / Niesel / Schnee
      if (this.particles.length) {
        if (st.kind === 'snow') {
          ctx.fillStyle = 'rgba(240,244,248,0.8)';
          for (const p of this.particles) {
            p.y += p.v * dt; p.x += (Math.sin(t / 900 + p.ph) * 0.4 + windX * 0.3) * dt;
            if (p.y > h) { p.y = -5; p.x = Math.random() * w; }
            if (p.x > w) p.x -= w;
            ctx.globalAlpha = 0.35 + p.s / 4; ctx.beginPath(); ctx.arc(p.x, p.y, p.s, 0, 7); ctx.fill();
          }
          ctx.globalAlpha = 1;
        } else {
          const slant = windX * 0.25;
          ctx.strokeStyle = 'rgba(200,210,220,1)'; ctx.lineWidth = 1;
          for (const p of this.particles) {
            p.y += p.v * dt; p.x += p.v * slant * dt;
            if (p.y > h) Object.assign(p, this.newDrop(st, false));
            ctx.globalAlpha = p.a; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.l * slant, p.y - p.l); ctx.stroke();
          }
          ctx.globalAlpha = 1;
        }
      }

      // Gewitter: Blitze
      if (st.kind === 'storm') {
        if (!this.bolt && Math.random() < 0.004 * dt * I) {
          const x = w * (0.15 + Math.random() * 0.7); const pts = [[x, 0]];
          let y = 0, xx = x;
          while (y < h * 0.6) { y += h * (0.04 + Math.random() * 0.06); xx += (Math.random() - 0.5) * w * 0.05; pts.push([xx, y]); }
          this.bolt = { pts, life: 1 };
          this.flash.style.opacity = 0.18 * I;
          setTimeout(() => (this.flash.style.opacity = 0), 90);
          setTimeout(() => { this.flash.style.opacity = 0.1 * I; setTimeout(() => (this.flash.style.opacity = 0), 70); }, 180);
        }
        if (this.bolt) {
          ctx.strokeStyle = `rgba(235,240,255,${this.bolt.life})`; ctx.lineWidth = 1.6;
          ctx.beginPath(); this.bolt.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
          this.bolt.life -= 0.08 * dt;
          if (this.bolt.life <= 0) this.bolt = null;
        }
      }

      // Glühwürmchen
      for (const f of this.fireflies) {
        f.x += Math.sin(t / 1500 + f.ph) * f.sp * dt * 0.5; f.y += Math.cos(t / 1900 + f.ph) * f.sp * dt * 0.3;
        const a = 0.5 + 0.5 * Math.sin(t / 400 + f.ph * 3);
        const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, 6);
        g.addColorStop(0, `rgba(230,240,140,${0.8 * a})`); g.addColorStop(1, 'rgba(230,240,140,0)');
        ctx.fillStyle = g; ctx.fillRect(f.x - 6, f.y - 6, 12, 12);
      }

      // Vögel am Tag (selten, ein kleiner Schwarm zieht vorbei)
      if (this.light > 0.35 && ['clear', 'partly'].includes(st.kind)) {
        if (!this.birds && Math.random() < 0.0004 * dt * I) {
          const y = h * (0.15 + Math.random() * 0.25);
          this.birds = { x: -40, y, list: Array.from({ length: 5 + Math.floor(Math.random() * 6) }, (_, i) => [-(i % 2 ? 1 : -1) * Math.ceil(i / 2) * 9, Math.ceil(i / 2) * 8, Math.random() * 6]) };
        }
        if (this.birds) {
          const b = this.birds; b.x += 1.2 * dt;
          ctx.strokeStyle = 'rgba(20,24,26,0.55)'; ctx.lineWidth = 1.2;
          for (const [dx, dy, ph] of b.list) {
            const x = b.x - dy, y = b.y + dx, f = Math.sin(t / 160 + ph) * 3;
            ctx.beginPath(); ctx.moveTo(x - 5, y - f); ctx.quadraticCurveTo(x - 2, y - 2, x, y); ctx.quadraticCurveTo(x + 2, y - 2, x + 5, y - f); ctx.stroke();
          }
          if (b.x > w + 80) this.birds = null;
        }
      }
    }

    /* Beschreibung des aktuellen Himmels (für Einstellungen/Debug) */
    describe() {
      const st = this.st || this.state();
      const tod = st.sunAlt > 12 ? 'Tag' : st.sunAlt > 0 ? (st.sunH < 0 ? 'Morgensonne' : 'Abendsonne') : st.sunAlt > -6 ? (st.sunH < 0 ? 'Morgendämmerung' : 'Abenddämmerung') : st.sunAlt > -12 ? 'Blaue Stunde' : 'Nacht';
      const ph = st.phase, names = ['Neumond', 'zunehmende Sichel', 'Halbmond (zunehmend)', 'zunehmender Mond', 'Vollmond', 'abnehmender Mond', 'Halbmond (abnehmend)', 'abnehmende Sichel'];
      return { tod, moon: names[Math.round(ph * 8) % 8], kind: st.kind, sunAlt: Math.round(st.sunAlt) };
    }
  }

  L.Scene = Scene;
  L.SCENE_IDS = Object.keys(SCENES);
  /* Vorschaubild einer Landschaft (für die Auswahl in den Einstellungen) */
  L.sceneThumb = function (id, w = 240, h = 140, opts = {}) {
    const sc = new Scene(document.createElement('div'), Object.assign({ scene: id, motion: 'aus', static: true, width: w, height: h, weatherFx: false }, opts));
    sc.setLocation(opts.lat ?? 54.3, opts.lon ?? 10.1);
    sc.drawStatic(true);
    return sc.base.toDataURL('image/jpeg', 0.8);
  };
  L.weatherKind = weatherKind;
  L.moonPhase = moonPhase;
  L.sunAltitude = sunAltitude;
})();
