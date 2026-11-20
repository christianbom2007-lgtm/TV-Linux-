"""Lichtung TV – Internetradio.

Sender kommen aus dem freien Verzeichnis radio-browser.info (über 50 000
Sender weltweit, ohne Anmeldung). Gespielt wird mit mpv als eigenem
Hintergrundprogramm: Das Radio läuft so weiter, auch wenn man mit der
Windows-Taste zur Startseite geht oder Brave öffnet. Gestoppt wird es über
den Radio-Bildschirm, die Handy-Fernbedienung oder die Pause-Taste.

mpv wird über einen kleinen "IPC"-Kanal (eine Socket-Datei) gefragt, welcher
Titel gerade läuft – viele Sender schicken Interpret und Titel mit.
"""
import json
import os
import shutil
import socket
import subprocess
import threading
import time
import urllib.parse
import urllib.request

# Mehrere Spiegel-Server des Verzeichnisses – fällt einer aus, nehmen wir den nächsten
SERVERS = ["https://de1.api.radio-browser.info", "https://de2.api.radio-browser.info",
           "https://fi1.api.radio-browser.info", "https://at1.api.radio-browser.info"]
UA = "LichtungTV/2.0 (Wohnzimmer-Radio)"   # das Verzeichnis bittet um einen erkennbaren Namen

# Fertige Listen für den Radio-Bildschirm (Abfragen an das Verzeichnis)
CATEGORIES = {
    "italien":  {"title": "Italien · beliebt", "params": {"countrycode": "IT"}},
    "italo":    {"title": "Italienische Musik", "params": {"tag": "italian music"}},
    "italohits": {"title": "Italo-Hits & Pop", "params": {"countrycode": "IT", "tag": "pop"}},
    "deutsch":  {"title": "Deutschland · beliebt", "params": {"countrycode": "DE"}},
    "chill":    {"title": "Chill & Lounge", "params": {"tag": "chillout"}},
}


def clean_station(s):
    """Nur die Felder, die die Oberfläche braucht – in einheitlicher Form."""
    url = s.get("url_resolved") or s.get("url") or ""
    if not url.startswith(("http://", "https://")):
        return None
    tags = [t.strip() for t in (s.get("tags") or "").split(",") if t.strip()][:4]
    return {"id": s.get("stationuuid") or url, "name": (s.get("name") or "Radio").strip()[:60], "url": url,
            "logo": s.get("favicon") or "", "tags": tags, "country": s.get("countrycode") or "",
            "codec": s.get("codec") or "", "bitrate": int(s.get("bitrate") or 0)}


def dedupe(stations):
    """Viele Sender stehen mehrfach im Verzeichnis (verschiedene Streams) – einen behalten."""
    seen, out = set(), []
    for s in stations:
        key = "".join(ch for ch in s["name"].lower() if ch.isalnum())[:24]
        if key in seen:
            continue
        seen.add(key)
        out.append(s)
    return out


class Radio:
    def __init__(self, broadcast, log=print, runtime_dir=None):
        self.broadcast = broadcast
        self.log = log
        self.proc = None
        self.station = None
        self.title = ""
        self.list = []                      # zuletzt angezeigte Liste (für "nächster Sender")
        self.cache = {}                     # Abfrage → (Zeit, Ergebnis)
        rt = runtime_dir or os.environ.get("XDG_RUNTIME_DIR") or "/tmp"
        self.sock_path = os.path.join(rt, "lichtung-radio.sock")
        self.lock = threading.Lock()
        self.fetch = self._fetch            # austauschbar für Tests

    @property
    def available(self):
        return bool(shutil.which("mpv"))

    # ---------- Senderverzeichnis ----------
    def _fetch(self, path, params):
        query = urllib.parse.urlencode(params)
        last = None
        for base in SERVERS:
            try:
                req = urllib.request.Request("%s%s?%s" % (base, path, query), headers={"User-Agent": UA})
                with urllib.request.urlopen(req, timeout=8) as r:
                    return json.loads(r.read().decode("utf-8"))
            except Exception as e:          # nächsten Spiegel probieren
                last = e
        raise RuntimeError("Senderverzeichnis nicht erreichbar (%s)" % str(last)[:80])

    def search(self, category="", q="", limit=60):
        params = {"hidebroken": "true", "order": "clickcount", "reverse": "true", "limit": str(limit)}
        if category in CATEGORIES:
            params.update(CATEGORIES[category]["params"])
        if q:
            params["name"] = q[:60]
        key = json.dumps(params, sort_keys=True)
        hit = self.cache.get(key)
        if hit and time.time() - hit[0] < 3600:
            return hit[1]
        raw = self.fetch("/json/stations/search", params)
        stations = dedupe([s for s in (clean_station(x) for x in raw) if s])
        self.cache[key] = (time.time(), stations)
        return stations

    # ---------- Abspielen ----------
    def play(self, station, env=None):
        if not self.available:
            return {"ok": False, "error": "mpv fehlt – Update einspielen (install.sh)"}
        if not station or not str(station.get("url", "")).startswith(("http://", "https://")):
            return {"ok": False, "error": "Sender ohne gültige Adresse"}
        with self.lock:
            self._kill()
            try:
                os.remove(self.sock_path)
            except OSError:
                pass
            cmd = ["mpv", "--no-video", "--no-terminal", "--idle=no", "--cache=yes", "--demuxer-max-bytes=4MiB",
                   "--input-ipc-server=" + self.sock_path, "--user-agent=" + UA, station["url"]]
            self.proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                         env=env or os.environ.copy(), start_new_session=True)
            self.station, self.title = station, ""
        # dem Verzeichnis einen "Klick" melden (hilft bei der Beliebtheits-Sortierung)
        threading.Thread(target=self._count_click, args=(station.get("id"),), daemon=True).start()
        self.broadcast("radio", **self.status())
        return {"ok": True}

    def _count_click(self, uuid):
        if uuid and len(uuid) == 36:
            try:
                self.fetch("/json/url/" + uuid, {})
            except Exception:
                pass

    def _kill(self):
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=3)
            except Exception:
                self.proc.kill()
        self.proc = None

    def stop(self):
        with self.lock:
            self._kill()
            self.station, self.title = None, ""
        self.broadcast("radio", **self.status())
        return {"ok": True}

    def step(self, direction):
        """Nächster/vorheriger Sender aus der zuletzt angezeigten Liste."""
        if not self.list:
            return {"ok": False, "error": "Keine Senderliste"}
        ids = [s["id"] for s in self.list]
        cur = ids.index(self.station["id"]) if self.station and self.station["id"] in ids else -1
        nxt = self.list[(cur + (1 if direction > 0 else -1)) % len(self.list)]
        return self.play(nxt)

    @property
    def playing(self):
        return bool(self.proc and self.proc.poll() is None)

    def status(self):
        return {"playing": self.playing, "station": self.station if self.playing else None,
                "title": self.title if self.playing else "", "available": self.available}

    # ---------- Laufender Titel (ICY-Metadaten) über mpv-IPC ----------
    def _ipc(self, command):
        s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        s.settimeout(1.5)
        try:
            s.connect(self.sock_path)
            s.sendall((json.dumps({"command": command}) + "\n").encode())
            data = b""
            while b"\n" not in data:
                chunk = s.recv(4096)
                if not chunk:
                    break
                data += chunk
            return json.loads(data.split(b"\n")[0] or b"{}").get("data")
        finally:
            s.close()

    def current_title(self):
        try:
            meta = self._ipc(["get_property", "metadata"]) or {}
        except Exception:
            return ""
        meta = {k.lower(): v for k, v in meta.items()}
        title = meta.get("icy-title") or meta.get("title") or ""
        if meta.get("artist") and title and meta["artist"] not in title:
            title = "%s – %s" % (meta["artist"], title)
        return str(title)[:120]

    def watch(self):
        """Läuft im Hintergrund: meldet neue Titel und ob der Sender abgebrochen ist."""
        was = False
        while True:
            time.sleep(5)
            now = self.playing
            if now:
                t = self.current_title()
                if t != self.title:
                    self.title = t
                    self.broadcast("radio", **self.status())
            elif was:                       # Stream abgerissen
                self.broadcast("radio", **self.status())
            was = now
