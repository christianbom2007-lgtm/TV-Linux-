/* Lichtung TV – läuft direkt in der YouTube-Seite ("MAIN world")
 * - Auto-HD: stellt die gewählte Qualität ein (z. B. 1080p), sobald ein Video lädt
 * - Kinomodus: schaltet die breite "Kino"-Ansicht von YouTube ein
 * Bekommt die Einstellungen per postMessage von content.js.
 */
(() => {
  'use strict';
  let want = { quality: 'hd1080', cinema: true };
  const ORDER = ['tiny', 'small', 'medium', 'large', 'hd720', 'hd1080', 'hd1440', 'hd2160', 'highres'];

  addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.lichtung !== 'yt-config') return;
    want = { quality: e.data.quality, cinema: e.data.cinema };
    apply();
  });

  function setQuality(p) {
    if (!p || !p.getAvailableQualityLevels || want.quality === 'auto') return;
    const levels = p.getAvailableQualityLevels() || [];
    if (!levels.length) return;
    let target = want.quality;
    if (target === 'max') target = levels[0];
    else if (!levels.includes(target)) {
      // nächstniedrigere verfügbare Stufe nehmen
      const idx = ORDER.indexOf(target);
      target = levels.filter((l) => ORDER.indexOf(l) <= idx).sort((a, b) => ORDER.indexOf(b) - ORDER.indexOf(a))[0] || levels[0];
    }
    try { p.setPlaybackQualityRange(target, target); } catch (_) {}
    try { p.setPlaybackQuality(target); } catch (_) {}
  }

  function setCinema() {
    if (!want.cinema || !location.pathname.startsWith('/watch')) return;
    const flexy = document.querySelector('ytd-watch-flexy');
    if (flexy && !flexy.hasAttribute('theater') && !flexy.hasAttribute('fullscreen')) {
      document.querySelector('.ytp-size-button')?.click();
    }
  }

  function apply() {
    const p = document.getElementById('movie_player');
    setQuality(p);
    setCinema();
  }

  // YouTube lädt neue Videos ohne Seitenwechsel → bei jedem Wechsel erneut anwenden
  document.addEventListener('yt-navigate-finish', () => setTimeout(apply, 800));
  document.addEventListener('yt-player-updated', () => setTimeout(apply, 300));
  let tries = 0;
  const iv = setInterval(() => { apply(); if (++tries > 20) clearInterval(iv); }, 1500);
})();
