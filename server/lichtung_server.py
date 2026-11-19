#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Lichtung TV – Hintergrunddienst
================================

Dieses Programm ist das "Gehirn" des Fernseh-Laptops. Es läuft die ganze Zeit
im Hintergrund und erledigt alles, was eine Webseite allein nicht kann:

  1. Webserver auf Port 8770: liefert die Startoberfläche (web/) aus und bietet
     eine kleine JSON-API (/api/...) für Kacheln, Profile, Einstellungen usw.
  2. Ereignis-Kanal (Server-Sent Events, /api/events): schickt Nachrichten wie
     "Lautstärke geändert" oder "Home gedrückt" sofort an Startseite und
     Firefox-Erweiterung.
  3. Tasten-Wächter (evdev): liest ALLE Tastaturen/Fernbedienungen mit und
     reagiert auf Home-Taste und Lautstärketasten – egal welche Seite offen ist.
  4. Virtuelle Tastatur/Maus (uinput): damit das Handy als Fernbedienung echte
     Tastendrücke und Mausbewegungen erzeugen kann.
  5. Lautstärke über PipeWire (wpctl) und Wetter über Open-Meteo (ohne API-Key).

Es wird nur die Python-Standardbibliothek benötigt. Optional (vom Installer
mitinstalliert): python3-evdev für Tasten/uinput, python3-pil zum Verkleinern
hochgeladener Bilder. Fehlt etwas, läuft der Rest trotzdem weiter.
"""

import base64
import hashlib
import json
import os
import queue
import random
import re
import secrets
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.parse
import urllib.request
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import extras  # noqa: E402  (Mediathek, Programmführer, Links)

# --------------------------------------------------------------------------
# Pfade und Grundeinstellungen
# --------------------------------------------------------------------------

# Ordner, in dem das Programm liegt (z. B. /opt/lichtung-tv). Daraus leiten
# wir die Orte für Weboberfläche und Standard-Konfiguration ab.
APP_DIR = os.environ.get("LICHTUNG_APP", os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
WEB_DIR = os.path.join(APP_DIR, "web")
DEFAULTS = os.path.join(APP_DIR, "defaults", "config.json")

# Hier liegen die persönlichen Daten (Kacheln, Profile, Bilder). Getrennt vom
# Programm, damit ein Update nichts überschreibt.
DATA_DIR = os.environ.get("LICHTUNG_DATA", os.path.expanduser("~/.local/share/lichtung-tv"))
CONFIG_PATH = os.path.join(DATA_DIR, "config.json")
IMG_DIR = os.path.join(DATA_DIR, "images")

PORT = int(os.environ.get("LICHTUNG_PORT", "8770"))
LAUNCHER_URL = "http://127.0.0.1:%d/" % PORT

os.makedirs(IMG_DIR, exist_ok=True)


def log(*args):
    """Kleine Hilfsfunktion: Ausgabe mit Uhrzeit, landet im systemd-Journal."""
    print(time.strftime("%H:%M:%S"), *args, flush=True)


# --------------------------------------------------------------------------
# Konfiguration laden/speichern
# --------------------------------------------------------------------------

CFG_LOCK = threading.RLock()  # verhindert, dass zwei Anfragen gleichzeitig schreiben


def load_config():
    """Liest config.json. Beim allerersten Start wird die Vorlage kopiert."""
    if not os.path.exists(CONFIG_PATH):
        shutil.copy(DEFAULTS, CONFIG_PATH)
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        cfg = json.load(f)
    # Fehlende neue Felder aus der Vorlage ergänzen (wichtig nach Updates)
    with open(DEFAULTS, "r", encoding="utf-8") as f:
        defaults = json.load(f)
    for key, value in defaults["general"].items():
        cfg.setdefault("general", {}).setdefault(key, value)
    cfg.setdefault("remote", {"pin": ""})
    cfg["remote"].setdefault("recent", [])
    cfg.setdefault("channels", defaults["channels"])
    cfg.setdefault("mediathekRows", defaults.get("mediathekRows", []))
    # Programmführer-Namen für bekannte Sender nachtragen
    known = {c["id"]: c.get("epg") for c in defaults["channels"]}
    for c in cfg["channels"]:
        if not c.get("epg") and known.get(c.get("id")):
            c["epg"] = known[c["id"]]
    # Fernbedienungs-Code einmalig zufällig erzeugen
    if not cfg["remote"].get("pin"):
        cfg["remote"]["pin"] = "%04d" % random.randint(0, 9999)
    return cfg


def save_config():
    """Schreibt die Konfiguration 'atomar': erst in eine Temp-Datei, dann
    umbenennen. So ist die Datei nie halb geschrieben, wenn der Strom ausfällt."""
    with CFG_LOCK:
        tmp = CONFIG_PATH + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(CONFIG, f, ensure_ascii=False, indent=2)
        os.replace(tmp, CONFIG_PATH)


CONFIG = load_config()
save_config()

# Welches Profil gerade aktiv ist (wird bei jedem Start neu gewählt)
STATE = {
    "active": next((p["id"] for p in CONFIG["profiles"] if p.get("isDefault")), CONFIG["profiles"][0]["id"]),
    "playing": False,          # spielt gerade irgendwo ein Video?
    "lastInput": time.time(),  # Zeitpunkt der letzten Eingabe (Taste/Maus)
    "saver": False,            # ist der Bildschirmschoner gerade an?
    "sleep": None,             # Schlaf-Timer: {"until": Zeitpunkt, "action": "pause"|"screen"|"poweroff", "warned": bool}
    "screenOff": False,
}


def find_profile(pid):
    return next((p for p in CONFIG["profiles"] if p["id"] == pid), None)


def active_profile():
    return find_profile(STATE["active"]) or CONFIG["profiles"][0]


def hash_pin(pin, salt=None):
    """PINs werden nie im Klartext gespeichert, sondern als SHA-256-Hash mit Salz."""
    salt = salt or secrets.token_hex(8)
    digest = hashlib.sha256((salt + str(pin)).encode()).hexdigest()
    return {"salt": salt, "hash": digest}


def check_pin(profile, pin):
    stored = profile.get("pin")
    if not stored:
        return True
    return hash_pin(pin or "", stored["salt"])["hash"] == stored["hash"]


def public_profile(p):
    """Profil ohne PIN-Hash – so darf es an den Browser gehen."""
    return {
        "id": p["id"], "name": p["name"], "color": p.get("color", "#c8a26b"),
        "hasPin": bool(p.get("pin")), "isDefault": bool(p.get("isDefault")),
    }


def new_id(prefix):
    return "%s-%s" % (prefix, secrets.token_hex(4))


# --------------------------------------------------------------------------
# Ereignisse an alle verbundenen Seiten schicken (Server-Sent Events)
# --------------------------------------------------------------------------

SSE_CLIENTS = []          # Liste von Warteschlangen, eine pro verbundener Seite
SSE_LOCK = threading.Lock()


def broadcast(event_type, **data):
    data["type"] = event_type
    payload = json.dumps(data, ensure_ascii=False)
    with SSE_LOCK:
        for q in list(SSE_CLIENTS):
            try:
                q.put_nowait(payload)
            except queue.Full:
                pass


# --------------------------------------------------------------------------
# Lautstärke (PipeWire über wpctl)
# --------------------------------------------------------------------------

def run(cmd):
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=3).stdout
    except Exception:
        return ""


def get_volume():
    out = run(["wpctl", "get-volume", "@DEFAULT_AUDIO_SINK@"])   # z. B. "Volume: 0.45 [MUTED]"
    m = re.search(r"([\d.]+)", out)
    vol = int(round(float(m.group(1)) * 100)) if m else 50
    return {"volume": vol, "muted": "MUTED" in out}


def change_volume(action):
    step = int(CONFIG["general"].get("volumeStep", 5))
    sink = "@DEFAULT_AUDIO_SINK@"
    if action == "up":
        run(["wpctl", "set-mute", sink, "0"])
        run(["wpctl", "set-volume", "-l", "1.0", sink, "%d%%+" % step])
    elif action == "down":
        run(["wpctl", "set-volume", sink, "%d%%-" % step])
    elif action == "mute":
        run(["wpctl", "set-mute", sink, "toggle"])
    v = get_volume()
    broadcast("volume", **v)
    return v


def audio_sinks():
    """Alle Tonausgänge (Laptop-Lautsprecher, HDMI, Kopfhörer …) über pw-dump."""
    try:
        objs = json.loads(run(["pw-dump"]) or "[]")
    except Exception:
        return {"sinks": [], "default": None}
    default_name = None
    for o in objs:
        if o.get("type") == "PipeWire:Interface:Metadata" and (o.get("props") or {}).get("metadata.name") == "default":
            for m in o.get("metadata", []):
                if m.get("key") == "default.audio.sink":
                    val = m.get("value")
                    if isinstance(val, str):
                        try:
                            val = json.loads(val)
                        except Exception:
                            val = {}
                    default_name = (val or {}).get("name")
    sinks = []
    for o in objs:
        props = ((o.get("info") or {}).get("props") or {})
        if o.get("type") == "PipeWire:Interface:Node" and props.get("media.class") == "Audio/Sink":
            sinks.append({"id": o["id"], "name": props.get("node.description") or props.get("node.name"),
                          "hdmi": "hdmi" in (props.get("node.name") or "").lower(),
                          "default": props.get("node.name") == default_name})
    return {"sinks": sinks}


def go_home():
    """Alle Seiten benachrichtigen: zurück zur Startseite."""
    STATE["lastInput"] = time.time()
    broadcast("home", url=LAUNCHER_URL)


# --------------------------------------------------------------------------
# Wetter (Open-Meteo, kostenlos, ohne Anmeldung)
# --------------------------------------------------------------------------

WEATHER_CACHE = {"t": 0, "data": None, "key": None}


def http_json(url, timeout=6):
    req = urllib.request.Request(url, headers={"User-Agent": "LichtungTV/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def get_weather():
    g = CONFIG["general"]
    key = (g["lat"], g["lon"])
    if WEATHER_CACHE["data"] and WEATHER_CACHE["key"] == key and time.time() - WEATHER_CACHE["t"] < 600:
        return WEATHER_CACHE["data"]
    url = ("https://api.open-meteo.com/v1/forecast?latitude=%s&longitude=%s"
           "&current=temperature_2m,weather_code,is_day,wind_speed_10m,cloud_cover,precipitation"
           "&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max"
           "&timezone=Europe%%2FBerlin&forecast_days=4") % key
    try:
        data = http_json(url)
        data["city"] = g.get("city", "")
        WEATHER_CACHE.update(t=time.time(), data=data, key=key)
    except Exception as e:
        log("Wetter nicht erreichbar:", e)
    return WEATHER_CACHE["data"] or {"error": "offline", "city": g.get("city", "")}


# --------------------------------------------------------------------------
# Tasten-Wächter und virtuelle Fernbedienung (evdev / uinput)
# --------------------------------------------------------------------------

try:
    import evdev
    from evdev import ecodes as E
    HAVE_EVDEV = True
except Exception:  # z. B. beim Testen auf einem normalen PC
    HAVE_EVDEV = False
    log("python3-evdev fehlt – Home-/Lautstärketasten und Handy-Tasten sind aus.")

UINPUT = None
UINPUT_NAME = "Lichtung Remote"

# Welche Tasten "Home" bedeuten (Namen wie in evdev)
HOME_KEYS = {"KEY_HOMEPAGE", "KEY_F1"}
META_KEYS = {"KEY_LEFTMETA", "KEY_RIGHTMETA"}   # Windows-Taste: nur wenn allein gedrückt


def setup_uinput():
    """Legt eine virtuelle Tastatur+Maus an, über die das Handy 'tippt'."""
    global UINPUT
    if not HAVE_EVDEV:
        return
    try:
        keys = [getattr(E, k) for k in dir(E) if k.startswith("KEY_") and isinstance(getattr(E, k), int)]
        keys = [k for k in set(keys) if 0 < k < 0x2ff]
        caps = {
            E.EV_KEY: keys + [E.BTN_LEFT, E.BTN_RIGHT, E.BTN_MIDDLE],
            E.EV_REL: [E.REL_X, E.REL_Y, E.REL_WHEEL],
        }
        UINPUT = evdev.UInput(caps, name=UINPUT_NAME)
        log("Virtuelle Fernbedienung bereit.")
    except Exception as e:
        log("uinput nicht verfügbar:", e)


def tap(key_name, mods=()):
    """Einen Tastendruck (mit optionalen Zusatztasten wie Shift) erzeugen."""
    if not UINPUT:
        return False
    code = getattr(E, key_name, None)
    if code is None:
        return False
    for m in mods:
        UINPUT.write(E.EV_KEY, getattr(E, m), 1)
    UINPUT.write(E.EV_KEY, code, 1)
    UINPUT.syn()
    UINPUT.write(E.EV_KEY, code, 0)
    for m in reversed(mods):
        UINPUT.write(E.EV_KEY, getattr(E, m), 0)
    UINPUT.syn()
    return True


def mouse(dx=0, dy=0, click=None, scroll=0):
    if not UINPUT:
        return False
    if dx:
        UINPUT.write(E.EV_REL, E.REL_X, int(dx))
    if dy:
        UINPUT.write(E.EV_REL, E.REL_Y, int(dy))
    if scroll:
        UINPUT.write(E.EV_REL, E.REL_WHEEL, int(scroll))
    UINPUT.syn()
    if click:
        btn = {"left": E.BTN_LEFT, "right": E.BTN_RIGHT}.get(click, E.BTN_LEFT)
        UINPUT.write(E.EV_KEY, btn, 1)
        UINPUT.syn()
        UINPUT.write(E.EV_KEY, btn, 0)
        UINPUT.syn()
    return True


def input_watcher():
    """Liest alle Eingabegeräte mit (ohne sie zu blockieren – Firefox bekommt
    die Tasten weiterhin). Neue Geräte (z. B. USB-Dongle der Fernbedienung)
    werden alle 5 Sekunden erkannt."""
    import selectors
    sel = selectors.DefaultSelector()
    devices = {}
    last_scan = 0

    while True:
        if time.time() - last_scan > 5:
            last_scan = time.time()
            for path in evdev.list_devices():
                if path in devices:
                    continue
                try:
                    d = evdev.InputDevice(path)
                    if d.name == UINPUT_NAME:          # eigene virtuelle Tastatur ignorieren
                        d.close()
                        continue
                    caps = d.capabilities()
                    if E.EV_KEY not in caps and E.EV_REL not in caps:
                        d.close()
                        continue
                    devices[path] = d
                    sel.register(d, selectors.EVENT_READ)
                    log("Eingabegerät:", d.name)
                except Exception:
                    pass

        for keyobj, _ in sel.select(timeout=1):
            dev = keyobj.fileobj
            try:
                events = list(dev.read())
            except OSError:  # Gerät wurde abgezogen
                sel.unregister(dev)
                devices.pop(dev.path, None)
                continue
            for ev in events:
                if ev.type in (E.EV_KEY, E.EV_REL):
                    wake()
                if ev.type != E.EV_KEY:
                    continue
                name = E.KEY.get(ev.code)
                if isinstance(name, list):
                    name = name[0]
                handle_key(name, ev.value)


KEYSTATE = {"meta_alone": False}


def handle_key(name, value):
    """Reagiert auf eine Taste. value: 1 = gedrückt, 2 = gehalten, 0 = losgelassen.
    Eigene Funktion, damit man sie ohne echte Tastatur testen kann."""
    if value == 1:
        if name in META_KEYS:
            KEYSTATE["meta_alone"] = True
            return "meta"
        KEYSTATE["meta_alone"] = False
        if name in HOME_KEYS:
            go_home()
            return "home"
        if name == "KEY_VOLUMEUP":
            change_volume("up")
            return "up"
        if name == "KEY_VOLUMEDOWN":
            change_volume("down")
            return "down"
        if name == "KEY_MUTE":
            change_volume("mute")
            return "mute"
    elif value == 2 and name in ("KEY_VOLUMEUP", "KEY_VOLUMEDOWN"):
        # Taste gedrückt halten → weiter lauter/leiser
        change_volume("up" if name == "KEY_VOLUMEUP" else "down")
        return "repeat"
    elif value == 0 and name in META_KEYS and KEYSTATE["meta_alone"]:
        KEYSTATE["meta_alone"] = False
        go_home()
        return "home"
    return None


def screen(on):
    """Schaltet den Bildschirm (HDMI) über das Wayland-Protokoll an/aus."""
    env = dict(os.environ)
    rt = env.get("XDG_RUNTIME_DIR") or "/run/user/%d" % os.getuid()
    if not env.get("WAYLAND_DISPLAY"):
        try:
            env["WAYLAND_DISPLAY"] = sorted(n for n in os.listdir(rt) if re.match(r"^wayland-\d+$", n))[-1]
        except Exception:
            return False
    try:
        out = subprocess.run(["wlr-randr"], capture_output=True, text=True, env=env, timeout=3).stdout
        outputs = re.findall(r"^(\S+) ", out, re.M)
        for o in outputs:
            subprocess.run(["wlr-randr", "--output", o, "--on" if on else "--off"], env=env, timeout=3)
        STATE["screenOff"] = not on
        return bool(outputs)
    except Exception as e:
        log("Bildschirm schalten nicht möglich:", e)
        return False


def wake():
    """Jede Eingabe: Bildschirmschoner aus, Bildschirm wieder an."""
    STATE["lastInput"] = time.time()
    if STATE["saver"]:
        STATE["saver"] = False
        broadcast("saver", on=False)
    if STATE["screenOff"]:
        screen(True)
        broadcast("screen", on=True)


def sleep_tick(pause=time.sleep):
    """Ein Prüfschritt des Schlaf-Timers (eigene Funktion → testbar)."""
    sl = STATE["sleep"]
    if not sl:
        return None
    left = sl["until"] - time.time()
    if left <= 60 and not sl.get("warned"):
        sl["warned"] = True
        broadcast("sleepwarn", seconds=int(max(0, left)))
    if left <= 0:
        STATE["sleep"] = None
        broadcast("sleep", action=sl["action"])        # Seiten pausieren Videos
        if sl["action"] in ("screen", "poweroff"):
            pause(3)
            screen(False)
        if sl["action"] == "poweroff":
            pause(5)
            subprocess.Popen(["systemctl", "poweroff"])
        return sl["action"]
    return "warned" if sl.get("warned") else "running"


def sleep_watcher():
    """Schlaf-Timer: 60 Sekunden vorher warnen, dann pausieren / Bildschirm aus / ausschalten."""
    while True:
        time.sleep(1)
        sleep_tick()


def sleep_info():
    sl = STATE["sleep"]
    return {"active": bool(sl), "left": int(sl["until"] - time.time()) if sl else 0, "action": sl["action"] if sl else None}


EPG = extras.EPG(DATA_DIR, lambda: CONFIG)


def idle_watcher():
    """Schaltet den Bildschirmschoner ein, wenn lange nichts passiert ist und
    kein Video läuft. Ausgeschaltet wird er bei der nächsten Eingabe."""
    while True:
        time.sleep(5)
        minutes = float(CONFIG["general"].get("screensaverMinutes", 5) or 0)
        if minutes <= 0:
            continue
        idle = time.time() - STATE["lastInput"]
        if not STATE["saver"] and not STATE["playing"] and idle > minutes * 60:
            STATE["saver"] = True
            broadcast("saver", on=True)


def lan_ip():
    """Ermittelt die IP-Adresse im Heimnetz (für die Handy-Fernbedienung)."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("192.168.0.1", 9))   # es wird nichts gesendet
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


# Zeichen → Taste(n) bei DEUTSCHER Tastaturbelegung (QWERTZ!).
# Wird genutzt, wenn Text nicht direkt in ein Eingabefeld eingesetzt werden kann
# (z. B. YouTube-TV-Suche). Format: Zeichen → (Taste, Zusatztasten)
S_, A_ = ("KEY_LEFTSHIFT",), ("KEY_RIGHTALT",)
CHAR_KEYS = {" ": ("KEY_SPACE", ()), "\n": ("KEY_ENTER", ()),
             ".": ("KEY_DOT", ()), ",": ("KEY_COMMA", ()), "-": ("KEY_SLASH", ()),
             "ä": ("KEY_APOSTROPHE", ()), "ö": ("KEY_SEMICOLON", ()), "ü": ("KEY_LEFTBRACE", ()), "ß": ("KEY_MINUS", ()),
             "Ä": ("KEY_APOSTROPHE", S_), "Ö": ("KEY_SEMICOLON", S_), "Ü": ("KEY_LEFTBRACE", S_),
             "!": ("KEY_1", S_), '"': ("KEY_2", S_), "$": ("KEY_4", S_), "%": ("KEY_5", S_), "&": ("KEY_6", S_),
             "/": ("KEY_7", S_), "(": ("KEY_8", S_), ")": ("KEY_9", S_), "=": ("KEY_0", S_), "?": ("KEY_MINUS", S_),
             ":": ("KEY_DOT", S_), ";": ("KEY_COMMA", S_), "_": ("KEY_SLASH", S_), "+": ("KEY_RIGHTBRACE", ()),
             "*": ("KEY_RIGHTBRACE", S_), "#": ("KEY_BACKSLASH", ()), "'": ("KEY_BACKSLASH", S_), "@": ("KEY_Q", A_)}
for _c in "abcdefghijklmnopqrstuvwxyz":
    _k = {"y": "Z", "z": "Y"}.get(_c, _c.upper())   # Y und Z sind auf deutschen Tastaturen vertauscht
    CHAR_KEYS[_c] = ("KEY_" + _k, ())
    CHAR_KEYS[_c.upper()] = ("KEY_" + _k, S_)
for _d in "0123456789":
    CHAR_KEYS[_d] = ("KEY_" + _d, ())


def type_text(text, enter=False):
    """Tippt Text Zeichen für Zeichen über die virtuelle Tastatur."""
    typed = 0
    for ch in text:
        key = CHAR_KEYS.get(ch)
        if key and tap(key[0], key[1]):
            typed += 1
            time.sleep(0.012)
    if enter:
        tap("KEY_ENTER")
    return typed

# Tasten, die das Handy senden darf → evdev-Namen
REMOTE_KEYS = {
    "up": "KEY_UP", "down": "KEY_DOWN", "left": "KEY_LEFT", "right": "KEY_RIGHT",
    "ok": "KEY_ENTER", "back": "KEY_ESC", "space": "KEY_SPACE", "backspace": "KEY_BACKSPACE",
    "tab": "KEY_TAB", "menu": "KEY_COMPOSE", "f": "KEY_F", "pageup": "KEY_PAGEUP",
    "pagedown": "KEY_PAGEDOWN", "playpause": "KEY_PLAYPAUSE", "browserback": "KEY_BACK",
}


# --------------------------------------------------------------------------
# HTTP-Server
# --------------------------------------------------------------------------

MIME = {
    ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".webp": "image/webp", ".woff2": "font/woff2", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8",
}


class Handler(BaseHTTPRequestHandler):
    server_version = "LichtungTV/1.0"

    # ---------- Hilfsfunktionen ----------
    def log_message(self, fmt, *args):  # Standard-Log ist zu gesprächig
        pass

    def is_local(self):
        return self.client_address[0] in ("127.0.0.1", "::1", "::ffff:127.0.0.1")

    def authorized(self):
        """Vom Laptop selbst ist alles erlaubt. Aus dem WLAN (Handy) nur mit
        dem 4-stelligen Fernbedienungs-Code."""
        if self.is_local():
            return True
        pin = self.headers.get("X-Remote-Pin") or urllib.parse.parse_qs(
            urllib.parse.urlparse(self.path).query).get("pin", [""])[0]
        return pin == CONFIG["remote"]["pin"]

    def send_json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length > 25 * 1024 * 1024:
            raise ValueError("zu groß")
        raw = self.rfile.read(length) if length else b"{}"
        return json.loads(raw.decode("utf-8") or "{}")

    def send_file(self, path):
        if not os.path.isfile(path):
            return self.send_error(404)
        ext = os.path.splitext(path)[1].lower()
        with open(path, "rb") as f:
            data = f.read()
        self.send_response(200)
        self.send_header("Content-Type", MIME.get(ext, "application/octet-stream"))
        self.send_header("Content-Length", str(len(data)))
        # Schriften/Bilder dürfen gecacht werden, HTML/JS nicht (sonst sieht man Updates nicht)
        cache = "max-age=86400" if ext in (".woff2", ".png", ".jpg", ".jpeg", ".webp") else "no-cache"
        self.send_header("Cache-Control", cache)
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Remote-Pin")
        self.end_headers()

    # ---------- GET ----------
    def do_GET(self):
        url = urllib.parse.urlparse(self.path)
        path = url.path
        qs = urllib.parse.parse_qs(url.query)

        if not path.startswith("/api/"):
            # Statische Dateien: Weboberfläche und hochgeladene Bilder
            if path.startswith("/data/images/"):
                name = os.path.basename(path)
                return self.send_file(os.path.join(IMG_DIR, name))
            if path in ("/", ""):
                path = "/index.html"
            if path == "/remote":
                path = "/remote.html"
            safe = os.path.normpath(path).lstrip("/")
            if safe.startswith(".."):
                return self.send_error(403)
            return self.send_file(os.path.join(WEB_DIR, safe))

        if path == "/api/events":
            return self.sse()
        if not self.authorized():
            return self.send_json({"error": "Code falsch"}, 401)

        if path == "/api/state":
            return self.send_json(self.state_payload())
        if path == "/api/weather":
            return self.send_json(get_weather())
        if path == "/api/volume":
            return self.send_json(get_volume())
        if path == "/api/audio":
            return self.send_json(audio_sinks())
        if path == "/api/mediathek":
            # Alle Reihen parallel laden (jede Reihe = eine Abfrage)
            rows = [r for r in CONFIG.get("mediathekRows", []) if r.get("on", True)]
            results = [None] * len(rows)

            def load(i, r):
                results[i] = extras.mediathek_row(r)
            threads = [threading.Thread(target=load, args=(i, r)) for i, r in enumerate(rows)]
            [t.start() for t in threads]
            [t.join(15) for t in threads]
            return self.send_json({"rows": [{"id": r["id"], "title": r["title"], "items": results[i] or []} for i, r in enumerate(rows)]})
        if path == "/api/mediathek/search":
            return self.send_json({"items": extras.mediathek_search(qs.get("q", [""])[0][:80])})
        if path == "/api/epg":
            return self.send_json(EPG.now_next(int(qs.get("hours", ["6"])[0])))
        if path == "/api/sleep":
            return self.send_json(sleep_info())
        if path == "/api/links":
            return self.send_json({"recent": CONFIG["remote"].get("recent", [])})
        if path == "/api/netinfo":
            return self.send_json({"ip": lan_ip(), "port": PORT, "pin": CONFIG["remote"]["pin"] if self.is_local() else None})
        if path == "/api/geocode":
            q = qs.get("q", [""])[0]
            try:
                data = http_json("https://geocoding-api.open-meteo.com/v1/search?count=5&language=de&name=" + urllib.parse.quote(q))
                return self.send_json(data.get("results", []))
            except Exception:
                return self.send_json([])
        if path == "/api/ext-config":
            # Für die Firefox-Erweiterung: welche Seiten sollen sich als Fernseher ausgeben?
            matches = []
            for p in CONFIG["profiles"]:
                for t in p["tiles"]:
                    if t.get("tvMode") and t["url"].startswith("http"):
                        host = urllib.parse.urlparse(t["url"]).hostname or ""
                        if host and host not in matches:
                            matches.append(host)
            g = CONFIG["general"]
            return self.send_json({"launcher": LAUNCHER_URL, "tvHosts": matches, "ua": g["tvUserAgent"],
                                   "saverOnPages": g.get("screensaverOnPages", True)})
        if path == "/api/continue/lookup":
            key = norm_key(qs.get("url", [""])[0])
            item = next((c for c in active_profile().get("continue", []) if c["key"] == key), None)
            return self.send_json(item or {})
        return self.send_json({"error": "unbekannt"}, 404)

    def state_payload(self):
        p = active_profile()
        return {
            "general": CONFIG["general"],
            "channels": CONFIG["channels"],
            "profiles": [public_profile(x) for x in CONFIG["profiles"]],
            "active": p["id"],
            "tiles": p["tiles"],
            "continue": p.get("continue", []),
            "evdev": HAVE_EVDEV,
            "uinput": bool(UINPUT),
            "sleep": sleep_info(),
            "airplay": bool(shutil.which("uxplay")),
            "mediathekRows": CONFIG.get("mediathekRows", []),
        }

    def sse(self):
        """Hält die Verbindung offen und schickt Ereignisse, sobald sie passieren."""
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        q = queue.Queue(maxsize=100)
        with SSE_LOCK:
            SSE_CLIENTS.append(q)
        try:
            self.wfile.write(b"retry: 2000\n\n")
            self.wfile.flush()
            while True:
                try:
                    msg = q.get(timeout=15)
                    self.wfile.write(("data: %s\n\n" % msg).encode("utf-8"))
                except queue.Empty:
                    self.wfile.write(b": ping\n\n")  # hält die Verbindung am Leben
                self.wfile.flush()
        except Exception:
            pass
        finally:
            with SSE_LOCK:
                if q in SSE_CLIENTS:
                    SSE_CLIENTS.remove(q)

    # ---------- POST / PUT / DELETE ----------
    def do_POST(self):
        return self.mutate("POST")

    def do_PUT(self):
        return self.mutate("PUT")

    def do_DELETE(self):
        return self.mutate("DELETE")

    def mutate(self, method):
        url = urllib.parse.urlparse(self.path)
        path = url.path
        qs = urllib.parse.parse_qs(url.query)
        if not self.authorized():
            return self.send_json({"error": "Code falsch"}, 401)
        try:
            body = self.read_json() if method != "DELETE" else {}
        except Exception:
            return self.send_json({"error": "ungültige Daten"}, 400)

        with CFG_LOCK:
            prof = active_profile()

            # ----- Profile -----
            if path == "/api/profile/select":
                p = find_profile(body.get("id"))
                if not p:
                    return self.send_json({"error": "Profil fehlt"}, 404)
                if not check_pin(p, body.get("pin")):
                    return self.send_json({"error": "PIN falsch"}, 403)
                STATE["active"] = p["id"]
                broadcast("profile", id=p["id"])
                return self.send_json({"ok": True})

            if path == "/api/profiles" and method == "POST":
                p = {"id": new_id("p"), "name": body.get("name", "Profil")[:30],
                     "color": body.get("color", "#8fb3a0"), "pin": None, "isDefault": False,
                     "tiles": json.loads(json.dumps(find_profile("standard")["tiles"] if find_profile("standard") else [])),
                     "continue": []}
                if body.get("pin"):
                    p["pin"] = hash_pin(body["pin"])
                CONFIG["profiles"].append(p)
                save_config()
                broadcast("config")
                return self.send_json(public_profile(p))

            m = re.match(r"^/api/profiles/([\w-]+)$", path)
            if m:
                p = find_profile(m.group(1))
                if not p:
                    return self.send_json({"error": "Profil fehlt"}, 404)
                if method == "DELETE":
                    if len(CONFIG["profiles"]) <= 1:
                        return self.send_json({"error": "Das letzte Profil kann nicht gelöscht werden"}, 400)
                    CONFIG["profiles"].remove(p)
                    if p.get("isDefault"):
                        CONFIG["profiles"][0]["isDefault"] = True
                    if STATE["active"] == p["id"]:
                        STATE["active"] = CONFIG["profiles"][0]["id"]
                else:
                    if "name" in body:
                        p["name"] = body["name"][:30]
                    if "color" in body:
                        p["color"] = body["color"]
                    if body.get("removePin"):
                        p["pin"] = None
                    elif body.get("pin"):
                        p["pin"] = hash_pin(body["pin"])
                        if p.get("isDefault"):
                            # Standardprofil startet automatisch – das geht nur ohne PIN
                            p["isDefault"] = False
                            other = next((x for x in CONFIG["profiles"] if not x.get("pin")), None)
                            if other:
                                other["isDefault"] = True
                    if body.get("isDefault"):
                        if p.get("pin"):
                            return self.send_json({"error": "Das Standardprofil darf keine PIN haben"}, 400)
                        for x in CONFIG["profiles"]:
                            x["isDefault"] = (x is p)
                save_config()
                broadcast("config")
                return self.send_json({"ok": True})

            # ----- Kacheln -----
            if path == "/api/tiles" and method == "POST":
                t = body.get("tile", {})
                clean = {
                    "id": t.get("id") or new_id("t"),
                    "title": (t.get("title") or "Neue Kachel")[:40],
                    "subtitle": (t.get("subtitle") or "")[:80],
                    "description": (t.get("description") or "")[:400],
                    "url": (t.get("url") or "").strip(),
                    "tvMode": bool(t.get("tvMode")),
                    "image": t.get("image") or "",
                    "hue": int(t["hue"] if t.get("hue") is not None else 200) % 360,
                }
                if clean["url"] and not re.match(r"^(https?://|lichtung:)", clean["url"]):
                    clean["url"] = "https://" + clean["url"]
                existing = next((x for x in prof["tiles"] if x["id"] == clean["id"]), None)
                if existing:
                    existing.update(clean)
                else:
                    prof["tiles"].append(clean)
                save_config()
                broadcast("config")
                return self.send_json(clean)

            m = re.match(r"^/api/tiles/([\w-]+)$", path)
            if m and method == "DELETE":
                prof["tiles"] = [x for x in prof["tiles"] if x["id"] != m.group(1)]
                save_config()
                broadcast("config")
                return self.send_json({"ok": True})

            if path == "/api/tiles/order":
                order = body.get("ids", [])
                prof["tiles"].sort(key=lambda x: order.index(x["id"]) if x["id"] in order else 999)
                save_config()
                broadcast("config")
                return self.send_json({"ok": True})

            # ----- Allgemeine Einstellungen & Sender -----
            if path == "/api/general":
                allowed = {"city", "lat", "lon", "accent", "dim", "screensaverMinutes", "screensaverOnPages",
                           "profileAutoSeconds", "tvUserAgent", "background", "volumeStep", "customBackgrounds",
                           "motion", "weatherFx", "aurora", "epgUrl", "setupDone", "mediathekOn"}
                for k, v in body.items():
                    if k in allowed:
                        CONFIG["general"][k] = v
                WEATHER_CACHE["t"] = 0
                save_config()
                broadcast("config")
                return self.send_json(CONFIG["general"])

            if path == "/api/channels":
                chans = []
                for c in body.get("channels", []):
                    if c.get("url"):
                        chans.append({"id": c.get("id") or new_id("c"), "name": c.get("name", "Sender")[:40], "url": c["url"]})
                CONFIG["channels"] = chans
                save_config()
                broadcast("config")
                return self.send_json({"ok": True})

            if path == "/api/mediathek/rows":
                rows = []
                for r in body.get("rows", []):
                    rows.append({"id": r.get("id") or new_id("m"), "title": (r.get("title") or "Mediathek")[:40],
                                 "channels": [c for c in (r.get("channels") or []) if isinstance(c, str)][:12],
                                 "topic": (r.get("topic") or "")[:60], "text": (r.get("text") or "")[:60],
                                 "minMinutes": int(r.get("minMinutes") or 0), "on": r.get("on", True) is not False})
                CONFIG["mediathekRows"] = rows
                save_config()
                broadcast("config")
                return self.send_json({"ok": True, "rows": rows})

            if path == "/api/open":
                url, label = extras.normalize_link(body.get("url", ""))
                if not url:
                    return self.send_json({"error": "Kein Link erkannt"}, 400)
                rec = CONFIG["remote"].setdefault("recent", [])
                raw = body.get("url", "").strip()[:500]
                rec[:] = [x for x in rec if x["url"] != url]
                rec.insert(0, {"url": url, "raw": raw, "label": label, "t": time.time()})
                del rec[8:]
                save_config()
                wake()
                broadcast("open", url=url, label=label)
                return self.send_json({"ok": True, "url": url, "label": label})

            if path == "/api/remote/newpin":
                CONFIG["remote"]["pin"] = "%04d" % random.randint(0, 9999)
                save_config()
                return self.send_json({"pin": CONFIG["remote"]["pin"]})

            # ----- Bilder hochladen -----
            if path == "/api/upload":
                return self.send_json(save_upload(body))

            # ----- Weiterschauen -----
            if path == "/api/continue" and method == "POST":
                return self.send_json(update_continue(prof, body))
            if path == "/api/continue" and method == "DELETE":
                key = qs.get("key", [""])[0]
                prof["continue"] = [c for c in prof.get("continue", []) if c["key"] != key]
                save_config()
                broadcast("config")
                return self.send_json({"ok": True})

        # ----- Dinge ohne Konfigurationsänderung -----
        if path == "/api/activity":
            STATE["playing"] = bool(body.get("playing"))
            if body.get("input"):
                wake()
            return self.send_json({"ok": True})

        if path == "/api/key":
            key = body.get("key", "")
            wake()
            if key == "home":
                go_home()
            elif key in ("volup", "voldown", "mute"):
                return self.send_json(change_volume({"volup": "up", "voldown": "down"}.get(key, "mute")))
            elif key in REMOTE_KEYS:
                if not tap(REMOTE_KEYS[key]):
                    broadcast("remotekey", key=key)   # Fallback ohne uinput: Seite reagiert selbst
            return self.send_json({"ok": True})

        if path == "/api/audio":
            run(["wpctl", "set-default", str(int(body.get("id", 0)))])
            return self.send_json(audio_sinks())

        if path == "/api/sleep":
            if body.get("cancel"):
                STATE["sleep"] = None
            else:
                minutes = max(1, min(240, int(body.get("minutes", 30))))
                action = body.get("action") if body.get("action") in ("pause", "screen", "poweroff") else "screen"
                STATE["sleep"] = {"until": time.time() + minutes * 60, "action": action, "warned": False}
            broadcast("sleepinfo", **sleep_info())
            return self.send_json(sleep_info())

        if path == "/api/screen":
            ok = screen(bool(body.get("on", True)))
            return self.send_json({"ok": ok})

        if path == "/api/epg/refresh":
            threading.Thread(target=EPG.refresh, daemon=True).start()
            return self.send_json({"ok": True})

        if path == "/api/type":
            n = type_text(str(body.get("text", ""))[:300], bool(body.get("enter")))
            return self.send_json({"ok": True, "typed": n})

        if path == "/api/mouse":
            STATE["lastInput"] = time.time()
            ok = mouse(body.get("dx", 0), body.get("dy", 0), body.get("click"), body.get("scroll", 0))
            return self.send_json({"ok": ok})

        if path == "/api/text":
            # Text geht an die Firefox-Erweiterung, die ihn ins aktive Feld schreibt
            broadcast("text", text=str(body.get("text", ""))[:500], enter=bool(body.get("enter")))
            return self.send_json({"ok": True})

        if path == "/api/system":
            action = body.get("action")
            if action == "poweroff":
                subprocess.Popen(["systemctl", "poweroff"])
            elif action == "reboot":
                subprocess.Popen(["systemctl", "reboot"])
            elif action == "restart-browser":
                subprocess.Popen(["pkill", "-f", "firefox"])
            return self.send_json({"ok": True})

        return self.send_json({"error": "unbekannt"}, 404)


def norm_key(url):
    """Macht aus einer URL einen eindeutigen Schlüssel fürs Weiterschauen.
    Bei YouTube zählt nur die Video-ID (egal ob normale oder TV-Ansicht)."""
    m = re.search(r"[?&#/]v=([\w-]{6,})", url) or re.search(r"youtu\.be/([\w-]{6,})", url)
    if m and "youtu" in url:
        return "yt:" + m.group(1)
    u = urllib.parse.urlparse(url)
    return (u.hostname or "") + u.path.rstrip("/")


def update_continue(prof, body):
    url = body.get("url", "")
    if not url.startswith("http"):
        return {"ok": False}
    key = norm_key(url)
    t, d = float(body.get("time") or 0), float(body.get("duration") or 0)
    items = prof.setdefault("continue", [])
    items[:] = [c for c in items if c["key"] != key]
    # Fast fertig (>95 %) oder sehr kurz → nicht merken
    if d > 0 and (t / d > 0.95 or d < 120):
        save_config()
        broadcast("config")
        return {"ok": True, "removed": True}
    if t < 30:
        return {"ok": True}
    vid = key[3:] if key.startswith("yt:") else None
    items.insert(0, {
        "key": key, "url": url, "title": (body.get("title") or url)[:120],
        "site": (body.get("site") or urllib.parse.urlparse(url).hostname or "")[:40],
        "image": body.get("image") or ("https://i.ytimg.com/vi/%s/hqdefault.jpg" % vid if vid else ""),
        "time": t, "duration": d, "updated": time.time(), "yt": vid,
        "player": body.get("player") or None,   # direkte Videoadresse → im eigenen Player öffnen
    })
    del items[20:]   # maximal 20 Einträge
    save_config()
    broadcast("continue")
    return {"ok": True}


def save_upload(body):
    """Speichert ein hochgeladenes Bild (als Base64 vom Browser geschickt).
    Wenn Pillow da ist, wird es auf max. 1920 px verkleinert – spart Ladezeit."""
    raw = body.get("data", "")
    if "," in raw:
        raw = raw.split(",", 1)[1]
    data = base64.b64decode(raw)
    name = secrets.token_hex(6)
    try:
        from PIL import Image
        import io
        img = Image.open(io.BytesIO(data))
        img = img.convert("RGB")
        img.thumbnail((1920, 1920))
        name += ".jpg"
        img.save(os.path.join(IMG_DIR, name), "JPEG", quality=85)
    except Exception:
        ext = ".png" if data[:4] == b"\x89PNG" else ".jpg"
        name += ext
        with open(os.path.join(IMG_DIR, name), "wb") as f:
            f.write(data)
    return {"url": "/data/images/" + name}


def main():
    setup_uinput()
    if HAVE_EVDEV:
        threading.Thread(target=input_watcher, daemon=True).start()
    threading.Thread(target=idle_watcher, daemon=True).start()
    threading.Thread(target=sleep_watcher, daemon=True).start()
    EPG.start()
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    server.daemon_threads = True
    log("Lichtung TV läuft auf http://%s:%d  (Handy: /remote, Code %s)" % (lan_ip(), PORT, CONFIG["remote"]["pin"]))
    server.serve_forever()


if __name__ == "__main__":
    main()
