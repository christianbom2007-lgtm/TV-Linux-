/* Lichtung TV – Brave-Erweiterung (Hintergrund)
 * ----------------------------------------------
 * - holt die Einstellungen vom Lichtung-Dienst (Zoom, Kinomodus, Qualität …)
 * - stellt YouTube-Tabs automatisch auf den gewählten TV-Zoom
 * - reicht Meldungen der Webseiten (Fortschritt, "spielt gerade") an den Dienst weiter
 * Der Dienst läuft auf diesem Laptop: http://127.0.0.1:8770
 */
'use strict';
const BASE = 'http://127.0.0.1:8770';
let cfg = { ytZoom: 1.25, ytCinema: true, ytQuality: 'hd1080', normalize: true, webZoom: 1 };
let cfgAt = 0;

async function config() {
  if (Date.now() - cfgAt < 20000) return cfg;
  try {
    cfg = Object.assign(cfg, await (await fetch(BASE + '/api/brave/config')).json());
    cfgAt = Date.now();
  } catch (_) { /* Dienst gerade nicht da – alte Werte behalten */ }
  return cfg;
}

const isYouTube = (url) => /^https:\/\/(www|m)\.youtube\.com\//.test(url || '');

async function applyZoom(tabId, url) {
  const c = await config();
  const want = isYouTube(url) ? Number(c.ytZoom || 1) : Number(c.webZoom || 1);
  if (!want || want === 1 && !isYouTube(url)) return;
  try {
    const cur = await chrome.tabs.getZoom(tabId);
    if (Math.abs(cur - want) > 0.01) await chrome.tabs.setZoom(tabId, want);
  } catch (_) {}
}

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === 'loading' && tab.url) applyZoom(tabId, tab.url);
});

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  const post = (path, body) => fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then((r) => r.json()).catch(() => ({}));
  (async () => {
    switch (msg.type) {
      case 'config': return reply(await config());
      case 'progress': return reply(await post('/api/continue', msg.data));
      case 'activity': return reply(await post('/api/activity', msg.data));
      case 'mini': return reply(await post('/api/mini', msg.data));
      case 'home': return reply(await post('/api/home', {}));
      case 'lookup': return reply(await fetch(BASE + '/api/continue/lookup?url=' + encodeURIComponent(msg.url)).then((r) => r.json()).catch(() => ({})));
      default: return reply({});
    }
  })();
  return true; // Antwort kommt asynchron
});

// Nach einem Lichtung-Update: neuere Erweiterung auf der Platte → sofort neu laden (ohne Brave-Neustart)
async function selfUpdate() {
  try {
    const m = await (await fetch(chrome.runtime.getURL('manifest.json') + '?t=' + Date.now(), { cache: 'no-store' })).json();
    if (m.version && m.version !== chrome.runtime.getManifest().version) chrome.runtime.reload();
  } catch (_) {}
}
setInterval(selfUpdate, 60000);

config();
