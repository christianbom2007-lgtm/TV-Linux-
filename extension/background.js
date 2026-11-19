/* Lichtung TV – Hintergrundskript der Firefox-Erweiterung
 * --------------------------------------------------------
 * Verbindet den Browser mit dem Lichtung-Dienst (http://127.0.0.1:8770):
 *  - "Home" vom Dienst  → aktuelle Seite durch die Startseite ersetzen
 *  - Lautstärke/Text/Bildschirmschoner → an die offene Webseite weiterreichen
 *  - Weiterschauen-Fortschritt von Webseiten → an den Dienst melden
 *  - TV-Ansicht: für bestimmte Seiten (z. B. youtube.com/tv) als Fernseher ausgeben
 */
'use strict';

const BASE = 'http://127.0.0.1:8770';
const LAUNCHER = BASE + '/';
let cfg = { tvHosts: [], ua: '', saverOnPages: true };
let uaScript = null;

const isOwnPage = (url) => (url || '').startsWith(BASE);

async function activeTab() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab;
}

/* ---------- Konfiguration holen und TV-Kennung einrichten ---------- */
async function loadConfig() {
  try {
    cfg = await (await fetch(BASE + '/api/ext-config')).json();
  } catch (_) {
    setTimeout(loadConfig, 3000); // Dienst startet evtl. gerade noch
    return;
  }
  // 1) HTTP-Kopfzeile "User-Agent" für TV-Seiten ändern
  browser.webRequest.onBeforeSendHeaders.removeListener(rewriteUA);
  if (cfg.tvHosts.length && cfg.ua) {
    browser.webRequest.onBeforeSendHeaders.addListener(rewriteUA,
      { urls: cfg.tvHosts.map((h) => `*://${h}/*`) }, ['blocking', 'requestHeaders']);
  }
  // 2) navigator.userAgent in der Seite selbst ändern (YouTube prüft beides)
  if (uaScript) { await uaScript.unregister(); uaScript = null; }
  if (cfg.tvHosts.length && cfg.ua) {
    uaScript = await browser.contentScripts.register({
      matches: cfg.tvHosts.map((h) => `*://${h}/*`),
      runAt: 'document_start',
      allFrames: true,
      js: [{ code: `(() => { const UA = ${JSON.stringify(cfg.ua)};
        try {
          const proto = window.wrappedJSObject.Navigator.prototype;
          const get = exportFunction(function () { return UA; }, window);
          Object.defineProperty(proto, 'userAgent', { get, configurable: true });
          Object.defineProperty(proto, 'appVersion', { get: exportFunction(function () { return UA.replace(/^Mozilla\\//, ''); }, window), configurable: true });
        } catch (e) {}
      })();` }],
    });
  }
}

function rewriteUA(details) {
  for (const header of details.requestHeaders) {
    if (header.name.toLowerCase() === 'user-agent') header.value = cfg.ua;
  }
  return { requestHeaders: details.requestHeaders };
}

/* ---------- Live-Ereignisse vom Dienst ---------- */
function connect() {
  const es = new EventSource(BASE + '/api/events');
  es.onmessage = async (e) => {
    let ev;
    try { ev = JSON.parse(e.data); } catch (_) { return; }
    const tab = await activeTab();
    if (!tab) return;

    if (ev.type === 'home') {
      // Alle zusätzlichen Fenster/Tabs schließen, Haupttab zur Startseite
      const tabs = await browser.tabs.query({});
      for (const t of tabs) if (t.id !== tab.id) browser.tabs.remove(t.id).catch(() => {});
      // Eigene Seiten (Startseite, Live-TV) reagieren selbst; alle anderen ersetzen wir
      if (!isOwnPage(tab.url)) browser.tabs.update(tab.id, { url: LAUNCHER });
      return;
    }
    if (ev.type === 'config') { loadConfig(); return; }
    if (isOwnPage(tab.url)) return; // eigene Seiten hören selbst zu
    if (ev.type === 'open') { browser.tabs.update(tab.id, { url: ev.url.startsWith('/') ? BASE + ev.url : ev.url }); return; }
    if (ev.type === 'saver' && !cfg.saverOnPages && ev.on) return;
    if (ev.type === 'text') {
      // Erst ins Eingabefeld einsetzen; klappt das nicht, tippt der Dienst Taste für Taste
      const ok = await browser.tabs.sendMessage(tab.id, ev).catch(() => false);
      if (!ok) fetch(BASE + '/api/type', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: ev.text, enter: ev.enter }) }).catch(() => {});
      return;
    }
    if (['volume', 'saver', 'sleep', 'sleepwarn'].includes(ev.type)) {
      browser.tabs.sendMessage(tab.id, ev).catch(() => {});
    }
  };
  es.onerror = () => { /* EventSource verbindet sich automatisch neu */ };
}

/* ---------- Nachrichten von den Webseiten (content.js) ---------- */
browser.runtime.onMessage.addListener(async (msg) => {
  const post = (path, body) => fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json()).catch(() => ({}));
  switch (msg.type) {
    case 'progress': return post('/api/continue', msg.data);
    case 'activity': return post('/api/activity', msg.data);
    case 'lookup': return fetch(BASE + '/api/continue/lookup?url=' + encodeURIComponent(msg.url)).then((r) => r.json()).catch(() => ({}));
    case 'weather': return fetch(BASE + '/api/weather').then((r) => r.json()).catch(() => ({}));
    case 'home': { const t = await activeTab(); if (t) browser.tabs.update(t.id, { url: LAUNCHER }); return {}; }
    case 'config': return cfg;
    case 'extendSleep': return post('/api/sleep', { minutes: 15, action: msg.action || 'screen' });
  }
});

loadConfig();
connect();
