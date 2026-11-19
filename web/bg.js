/* Lichtung TV – Hintergründe
 * Erzeugt dunkle Naturlandschaften per Code (keine Bilddateien nötig).
 * Wird einmal pro Größenänderung gezeichnet – kostet im Betrieb keine Leistung.
 * Eigene Fotos (hochgeladen über Einstellungen oder Handy) werden als Bild gezeigt.
 */
'use strict';

L.BACKGROUNDS = [
  { id: 'nacht', name: 'Bergnacht' },
  { id: 'wald', name: 'Nebelwald' },
  { id: 'fjord', name: 'Fjord' },
  { id: 'duene', name: 'Dünen' },
];

L.renderBackground = function (container, bg) {
  container.innerHTML = '';
  if (bg && bg.startsWith('/')) {
    container.appendChild(L.h('div', { class: 'photo', style: { backgroundImage: `url("${bg}")` } }));
    return;
  }
  const c = document.createElement('canvas');
  const scale = 0.6; // halbe Auflösung reicht für weiche Landschaften und spart Leistung
  c.width = Math.round(innerWidth * 1.06 * scale);
  c.height = Math.round(innerHeight * 1.06 * scale);
  container.appendChild(c);
  L.paintScene(c.getContext('2d'), c.width, c.height, bg || 'nacht');
};

/* Pseudo-Zufall mit festem Startwert → jedes Mal dieselbe Landschaft */
function rng(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* Bergkamm als weiche Linie aus überlagerten Wellen */
function ridge(ctx, w, h, base, amp, rough, color, r) {
  const p = [r() * 10, r() * 10, r() * 10];
  ctx.beginPath();
  ctx.moveTo(0, h);
  for (let x = 0; x <= w; x += 3) {
    const t = x / w;
    const y = base
      - Math.sin(t * 3.1 + p[0]) * amp * 0.55
      - Math.sin(t * 7.3 + p[1]) * amp * 0.25 * rough
      - Math.abs(Math.sin(t * 17 + p[2])) * amp * 0.12 * rough;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function fog(ctx, w, h, y, height, alpha) {
  const g = ctx.createLinearGradient(0, y - height, 0, y + height);
  g.addColorStop(0, `rgba(180,190,185,0)`);
  g.addColorStop(0.5, `rgba(180,190,185,${alpha})`);
  g.addColorStop(1, `rgba(180,190,185,0)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, y - height, w, height * 2);
}

function stars(ctx, w, h, n, r, maxY) {
  for (let i = 0; i < n; i++) {
    const x = r() * w, y = r() * maxY, s = r() * 1.3 + 0.2;
    ctx.globalAlpha = 0.25 + r() * 0.6;
    ctx.fillStyle = '#f4efe6';
    ctx.fillRect(x, y, s, s);
  }
  ctx.globalAlpha = 1;
}

function pines(ctx, w, h, base, size, count, color, r) {
  ctx.fillStyle = color;
  for (let i = 0; i < count; i++) {
    const x = r() * w, s = size * (0.6 + r() * 0.8), y = base + r() * size * 0.4;
    ctx.beginPath();
    ctx.moveTo(x, y - s * 2.2);
    for (let k = 0; k < 4; k++) {
      const yy = y - s * 2.2 + (k + 1) * s * 0.55;
      const ww = s * (0.25 + k * 0.17);
      ctx.lineTo(x + ww, yy);
      ctx.lineTo(x + ww * 0.45, yy);
    }
    ctx.lineTo(x + s * 0.08, y);
    ctx.lineTo(x - s * 0.08, y);
    for (let k = 3; k >= 0; k--) {
      const yy = y - s * 2.2 + (k + 1) * s * 0.55;
      const ww = s * (0.25 + k * 0.17);
      ctx.lineTo(x - ww * 0.45, yy);
      ctx.lineTo(x - ww, yy);
    }
    ctx.closePath();
    ctx.fill();
  }
}

L.paintScene = function (ctx, w, h, id) {
  const r = rng({ nacht: 7, wald: 21, fjord: 42, duene: 9 }[id] || 7);
  const sky = ctx.createLinearGradient(0, 0, 0, h);

  if (id === 'wald') {
    sky.addColorStop(0, '#141a19'); sky.addColorStop(0.55, '#2a3431'); sky.addColorStop(1, '#0c100f');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);
    ridge(ctx, w, h, h * 0.55, h * 0.12, 0.6, '#1d2624', r);
    fog(ctx, w, h, h * 0.58, h * 0.1, 0.16);
    pines(ctx, w, h, h * 0.68, h * 0.07, 70, '#141b19', r);
    fog(ctx, w, h, h * 0.72, h * 0.08, 0.14);
    pines(ctx, w, h, h * 0.86, h * 0.12, 40, '#0b0f0e', r);
    pines(ctx, w, h, h * 1.02, h * 0.2, 18, '#060908', r);
    return;
  }
  if (id === 'fjord') {
    sky.addColorStop(0, '#0f1622'); sky.addColorStop(0.45, '#3a3a45'); sky.addColorStop(0.58, '#8a6a52'); sky.addColorStop(0.6, '#2a2c33'); sky.addColorStop(1, '#0a0d12');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);
    stars(ctx, w, h, 120, r, h * 0.3);
    ridge(ctx, w, h, h * 0.52, h * 0.22, 1, '#1b1f27', r);
    ridge(ctx, w, h, h * 0.6, h * 0.1, 0.5, '#11141a', r);
    // Wasser mit Spiegelung
    const wg = ctx.createLinearGradient(0, h * 0.6, 0, h);
    wg.addColorStop(0, 'rgba(120,100,85,.35)'); wg.addColorStop(1, 'rgba(5,7,10,1)');
    ctx.fillStyle = wg; ctx.fillRect(0, h * 0.6, w, h * 0.4);
    ctx.strokeStyle = 'rgba(220,200,170,.07)';
    for (let i = 0; i < 60; i++) { const y = h * 0.62 + r() * h * 0.35, x = r() * w; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 20 + r() * 80, y); ctx.stroke(); }
    return;
  }
  if (id === 'duene') {
    sky.addColorStop(0, '#0d0f16'); sky.addColorStop(0.6, '#262330'); sky.addColorStop(1, '#141218');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);
    stars(ctx, w, h, 260, r, h * 0.6);
    ridge(ctx, w, h, h * 0.66, h * 0.08, 0.2, '#2b2530', r);
    ridge(ctx, w, h, h * 0.76, h * 0.1, 0.15, '#1d1922', r);
    ridge(ctx, w, h, h * 0.9, h * 0.12, 0.1, '#110f14', r);
    return;
  }
  // Standard: Bergnacht mit Mond
  sky.addColorStop(0, '#070a10'); sky.addColorStop(0.55, '#151d24'); sky.addColorStop(1, '#0c1113');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);
  stars(ctx, w, h, 320, r, h * 0.55);
  const mx = w * 0.74, my = h * 0.2, mr = h * 0.045;
  const glow = ctx.createRadialGradient(mx, my, mr, mx, my, mr * 8);
  glow.addColorStop(0, 'rgba(230,215,190,.18)'); glow.addColorStop(1, 'rgba(230,215,190,0)');
  ctx.fillStyle = glow; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#e9dfcc'; ctx.beginPath(); ctx.arc(mx, my, mr, 0, Math.PI * 2); ctx.fill();
  ridge(ctx, w, h, h * 0.55, h * 0.24, 1, '#1c252b', r);
  fog(ctx, w, h, h * 0.6, h * 0.08, 0.1);
  ridge(ctx, w, h, h * 0.68, h * 0.16, 0.8, '#131a1e', r);
  fog(ctx, w, h, h * 0.74, h * 0.07, 0.08);
  ridge(ctx, w, h, h * 0.82, h * 0.1, 0.6, '#0b1012', r);
  pines(ctx, w, h, h * 1.0, h * 0.13, 26, '#050807', r);
};
