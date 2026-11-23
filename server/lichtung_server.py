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
import glob
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
import android  # noqa: E402  (Android spiegeln mit scrcpy)
import system  # noqa: E402  (sway, Brave, Programme, Bluetooth, KDE Connect, Updates …)
import radio  # noqa: E402  (Internetradio über radio-browser.info + mpv)
import audio  # noqa: E402  (Ton: Start-Reparatur, Klang, Laptop + Fernseher, Ton-Assistent)
import diag  # noqa: E402  (Fehlersuche nach Themen)

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


RADIO_TILE = {"id": "t-radio", "title": "Radio", "subtitle": "Internetradio · italienische Musik & mehr",
              "url": "lichtung:radio", "image": "", "logo": "", "color": "", "size": "normal", "open": "lichtung", "hue": 35}


def load_config():
    """Liest config.json. Beim allerersten Start wird die Vorlage kopiert."""
    fresh_install = not os.path.exists(CONFIG_PATH)
    if fresh_install:
        shutil.copy(DEFAULTS, CONFIG_PATH)
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        cfg = json.load(f)
    old_version = int((cfg.get("general") or {}).get("version", 1) or 1)
    # Fehlende neue Felder aus der Vorlage ergänzen (wichtig nach Updates)
    with open(DEFAULTS, "r", encoding="utf-8") as f:
        defaults = json.load(f)
    for key, value in defaults["general"].items():
        cfg.setdefault("general", {}).setdefault(key, value)
    cfg.setdefault("remote", {"pin": ""})
    cfg["remote"].setdefault("recent", [])
    cfg.setdefault("channels", defaults["channels"])
    cfg.setdefault("mediathekRows", defaults.get("mediathekRows", []))
    cfg.setdefault("recorder", defaults.get("recorder", {"on": False, "rules": []}))
    # Programmführer-Namen für bekannte Sender nachtragen
    known = {c["id"]: c.get("epg") for c in defaults["channels"]}
    for c in cfg["channels"]:
        if not c.get("epg") and known.get(c.get("id")):
            c["epg"] = known[c["id"]]
    # Update auf Version 2 (Brave statt YouTube-TV-Ansicht): alte Kacheln umstellen
    if old_version < 2 and not fresh_install:
        for p in cfg.get("profiles", []):
            for t in p.get("tiles", []):
                if "youtube.com/tv" in t.get("url", ""):
                    t.update(url="https://www.youtube.com/", open="kino", subtitle="Kino-Fenster in Brave, ohne Werbung", size="gross")
                t.pop("tvMode", None)
            urls = {t.get("url") for t in p.get("tiles", [])}
            if "lichtung:browser" not in urls:
                p["tiles"].insert(1, {"id": "t-brave", "title": "Brave", "subtitle": "Normaler Browser · suchen & surfen", "url": "lichtung:browser",
                                      "image": "", "logo": "", "color": "", "size": "normal", "open": "tab", "hue": 20})
            if "lichtung:music" not in urls:
                p["tiles"].insert(3, {"id": "t-music", "title": "Musikbox", "subtitle": "Handy-Musik über den Fernseher", "url": "lichtung:music",
                                      "image": "", "logo": "", "color": "", "size": "normal", "open": "lichtung", "hue": 300})
            if "lichtung:ambient" not in urls:
                p["tiles"].insert(4, {"id": "t-ambient", "title": "Ambiente", "subtitle": "Kaminfeuer, Regen, Aquarium, Nordlicht", "url": "lichtung:ambient",
                                      "image": "", "logo": "", "color": "", "size": "normal", "open": "lichtung", "hue": 18})
            if "lichtung:apps" not in urls:
                p["tiles"].append({"id": "t-apps", "title": "Programme", "subtitle": "Terminal, App-Store, Spiele", "url": "lichtung:apps",
                                   "image": "", "logo": "", "color": "", "size": "normal", "open": "lichtung", "hue": 150})
        cfg["general"]["version"] = 2
    # Version 3: Internetradio – Kachel einmalig ergänzen
    if int(cfg["general"].get("version", 2) or 2) < 3 and not fresh_install:
        for p in cfg.get("profiles", []):
            if "lichtung:radio" not in {t.get("url") for t in p.get("tiles", [])}:
                p.setdefault("tiles", []).insert(min(4, len(p.get("tiles", []))), dict(RADIO_TILE))
        cfg["general"]["version"] = 3
    cfg.setdefault("radio", {"favorites": [], "last": None})
    cfg["general"].pop("tvUserAgent", None)
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
    "lastKey": None,           # zuletzt gedrückte Taste (für "Systeminfo" / Fehlersuche)
    "saverReturn": None,       # Ebene, zu der nach dem Bildschirmschoner zurückgekehrt wird
    "playingAt": 0,
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


VOLUME = {"backend": None, "error": ""}   # welches Programm die Lautstärke regelt (für Systeminfo)


def get_volume():
    out = run(["wpctl", "get-volume", "@DEFAULT_AUDIO_SINK@"])   # z. B. "Volume: 0.45 [MUTED]"
    m = re.search(r"([\d.]+)", out)
    if m:
        VOLUME["backend"] = "wpctl"
        return {"volume": int(round(float(m.group(1)) * 100)), "muted": "MUTED" in out}
    # Rückfall 1: pactl (PulseAudio-Befehle, gehen auch mit PipeWire)
    out = run(["pactl", "get-sink-volume", "@DEFAULT_SINK@"])
    m = re.search(r"(\d+)%", out)
    if m:
        VOLUME["backend"] = "pactl"
        muted = "yes" in run(["pactl", "get-sink-mute", "@DEFAULT_SINK@"])
        return {"volume": int(m.group(1)), "muted": muted}
    # Rückfall 2: ALSA direkt
    out = run(["amixer", "-M", "get", "Master"])
    m = re.search(r"\[(\d+)%\]", out)
    if m:
        VOLUME["backend"] = "amixer"
        return {"volume": int(m.group(1)), "muted": "[off]" in out}
    VOLUME["backend"] = None
    VOLUME["error"] = "Kein Tonsystem erreichbar (PipeWire läuft nicht?)"
    return {"volume": 50, "muted": False}


def change_volume(action):
    step = int(CONFIG["general"].get("volumeStep", 5))
    before = get_volume()
    be = VOLUME["backend"] or "wpctl"
    if be == "wpctl":
        sink = "@DEFAULT_AUDIO_SINK@"
        if action == "up":
            run(["wpctl", "set-mute", sink, "0"])
            run(["wpctl", "set-volume", "-l", "1.0", sink, "%d%%+" % step])
        elif action == "down":
            run(["wpctl", "set-volume", sink, "%d%%-" % step])
        elif action == "mute":
            run(["wpctl", "set-mute", sink, "toggle"])
    elif be == "pactl":
        sink = "@DEFAULT_SINK@"
        if action == "up":
            run(["pactl", "set-sink-mute", sink, "0"])
            run(["pactl", "set-sink-volume", sink, "+%d%%" % step if before["volume"] + step <= 100 else "100%"])
        elif action == "down":
            run(["pactl", "set-sink-volume", sink, "-%d%%" % step])
        elif action == "mute":
            run(["pactl", "set-sink-mute", sink, "toggle"])
    else:
        arg = {"up": "%d%%+" % step, "down": "%d%%-" % step, "mute": "toggle"}[action]
        run(["amixer", "-M", "set", "Master", arg] + (["unmute"] if action == "up" else []))
    v = get_volume()
    broadcast("volume", **v)
    show_wob(v)
    return v


def show_wob(v):
    """Lautstärke-Balken über allen Programmen (wob) – nur, wenn gerade NICHT
    die Lichtung-Startseite zu sehen ist (die hat ihre eigene Anzeige)."""
    path = os.path.join(system.runtime_dir(), "wob.sock")
    if not os.path.exists(path) or not SWAY.available or SWAY.focused_ws() == 1:
        return
    try:
        fd = os.open(path, os.O_WRONLY | os.O_NONBLOCK)
        os.write(fd, b"%d\n" % (0 if v["muted"] else min(100, v["volume"])))
        os.close(fd)
    except OSError:
        pass


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
                          "node": props.get("node.name") or "",
                          "hdmi": "hdmi" in (props.get("node.name") or "").lower(),
                          "virtual": (props.get("node.name") or "").startswith("lichtung_"),
                          "default": props.get("node.name") == default_name})
    return {"sinks": sinks}


def audio_settings():
    a = CONFIG.setdefault("audio", {})
    if audio.migrate(a):
        save_config()
    return dict(audio.DEFAULTS, **a)


def _save_audio(a):
    CONFIG["audio"] = a
    save_config()


AUDIO = audio.Audio(lambda: CONFIG.setdefault("audio", {}), _save_audio,
                    admin=lambda *a, **k: system.admin(*a, **k), log=lambda *a: log(*a))


def run_rc(cmd, timeout=15):
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return r.returncode, (r.stdout or "") + (r.stderr or "")
    except Exception as e:
        return 127, str(e)


def diag_context():
    return {"audio": audio, "audio_settings": audio_settings(), "eq_running": AUDIO.eq_running(),
            "lan_ip": lan_ip, "sway_ok": SWAY.available, "app_dir": APP_DIR, "img_dir": IMG_DIR,
            "updater": UPDATER, "auto_update": CONFIG["general"].get("autoUpdate", True)}


def apply_audio_async():
    """Ton-Einstellungen im Hintergrund anwenden und das Ergebnis melden."""
    def work():
        res = AUDIO.apply()
        broadcast("audiodone", **res)
        log("Ton angewendet:", res.get("report"))
    threading.Thread(target=work, daemon=True).start()


def audio_startup():
    """Beim Start: Ton reparieren falls nötig, Klang + Laptop/Fernseher einrichten."""
    if not shutil.which("pactl"):
        return
    time.sleep(8)                            # PipeWire erst hochfahren lassen
    res = AUDIO.apply()
    log("Ton beim Start:", res.get("report"))
    threading.Thread(target=AUDIO.watchdog, daemon=True).start()


def go_home():
    """Zurück zur Startseite: sway zeigt Ebene 1 (Brave & Programme laufen weiter)."""
    STATE["lastInput"] = time.time()
    try:
        ANDROID.stop_mirror()      # Android-Spiegeln beenden, falls aktiv
        if SWAY.available:
            SWAY.workspace(1)
    except NameError:
        pass
    STATE["saverReturn"] = None
    if CONFIG["general"].get("pauseOnHome", True):
        # Ton aus Brave anhalten – im Hintergrund, damit die Startseite sofort kommt
        threading.Thread(target=system.pause_browsers, daemon=True).start()
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
                handle_key(name, ev.value, dev.name)


KEYSTATE = {"meta_alone": False, "wm": set()}   # wm: Tasten, die sway schon selbst meldet


def handle_key(name, value, device=""):
    """Reagiert auf eine Taste. value: 1 = gedrückt, 2 = gehalten, 0 = losgelassen.
    Eigene Funktion, damit man sie ohne echte Tastatur testen kann.
    Läuft sway, kommen Home- und Lautstärketasten über dessen Tastenkürzel –
    dann hier nicht doppelt auswerten."""
    if value == 1 and name and name.startswith("KEY_"):
        STATE["lastKey"] = {"name": name, "device": device, "t": time.time(), "src": "evdev"}
    if name in ("KEY_VOLUMEUP", "KEY_VOLUMEDOWN", "KEY_MUTE") and "volume" in KEYSTATE["wm"]:
        return None
    if (name in HOME_KEYS or name in META_KEYS) and "home" in KEYSTATE["wm"]:
        return None
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


def wayland_env():
    """Umgebung, mit der Programme im Fernsehbild (cage) erscheinen."""
    env = dict(os.environ)
    rt = env.get("XDG_RUNTIME_DIR") or "/run/user/%d" % os.getuid()
    env["XDG_RUNTIME_DIR"] = rt
    if not env.get("WAYLAND_DISPLAY"):
        try:
            env["WAYLAND_DISPLAY"] = sorted(n for n in os.listdir(rt) if re.match(r"^wayland-\d+$", n))[-1]
        except Exception:
            pass
    return env


def screen(on):
    """Schaltet den Bildschirm (HDMI) über das Wayland-Protokoll an/aus."""
    env = wayland_env()
    if not env.get("WAYLAND_DISPLAY"):
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
        ret = STATE.get("saverReturn")
        STATE["saverReturn"] = None
        if ret and SWAY.available:
            SWAY.workspace(ret)     # zurück zu Brave/Programm, wo man vorher war
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
        if RADIO.playing:
            RADIO.stop()                                 # Radio läuft im Hintergrund → auch stoppen
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
ANDROID = android.Android(lambda t, **d: broadcast(t, **d), wayland_env)
SWAY = system.Sway(log)
BRAVE = system.Brave(SWAY, DATA_DIR, APP_DIR, log)
APPS = system.Apps(SWAY)
NIGHT = system.Night(wayland_env, log)
BT = system.Bluetooth()
UPDATER = system.Updater(DATA_DIR, APP_DIR, log)
REMOTES = {}   # verbundene Handys: Name → {"ip", "seen"}


def on_call(event):
    """Handy klingelt (KDE Connect) → alles pausieren."""
    log("Anruf am Handy – pausiere")
    system.pause_all_media()
    RADIO.stop() if RADIO.playing else None   # bei Anruf auch das Radio stoppen
    broadcast("pause", reason="call")


KDEC = system.KDEConnect(on_call, log)
MUSIC = system.MusicBox(log)
RADIO = radio.Radio(lambda t, **d: broadcast(t, **d), log)
STATS = system.Stats()
REC_DIR = os.path.join(DATA_DIR, "aufnahmen")
REC = system.Recorder(REC_DIR, lambda: CONFIG, lambda: save_config(), extras.mediathek_row, lambda t, **d: broadcast(t, **d), log)


def update_due(now_ts, cfg, state, last_try_day, newer):
    """Entscheidet, ob JETZT automatisch aktualisiert wird (eigene Funktion, damit
    sie sich testen lässt). Bedingungen: Automatik an, ein neueres Release ist da,
    es ist zwischen 3 und 5 Uhr, heute noch nicht versucht, niemand schaut fern
    und seit 30 Minuten wurde nichts bedient."""
    lt = time.localtime(now_ts)
    if not cfg.get("autoUpdate", True) or not newer:
        return False
    if not (3 <= lt.tm_hour < 5) or last_try_day == time.strftime("%Y-%m-%d", lt):
        return False
    playing = state.get("playing") and now_ts - state.get("playingAt", 0) < 90
    return not playing and now_ts - state.get("lastInput", now_ts) > 30 * 60


def update_watcher():
    """Sucht 5 Minuten nach dem Start und dann alle 6 Stunden nach einem neuen
    getesteten Release. Meldet es einmal am Fernseher und spielt es nachts
    automatisch ein (das Einspielen selbst macht lichtung-admin als root)."""
    time.sleep(300)
    last_check, announced, last_try_day = 0, "", ""
    while True:
        now = time.time()
        if now - last_check > 6 * 3600 or (3 <= time.localtime(now).tm_hour < 5 and now - last_check > 1800):
            res = UPDATER.check()
            last_check = now
            if res.get("ok") and res.get("newer") and res.get("latest") != announced:
                announced = res["latest"]
                broadcast("update", latest=res["latest"], message=res.get("message", ""))
        newer = (UPDATER.last_check or {}).get("newer", False)
        if update_due(now, CONFIG["general"], STATE, last_try_day, newer):
            last_try_day = time.strftime("%Y-%m-%d")
            if not system.media_playing():
                log("Automatisches Update auf %s" % UPDATER.last_check.get("latest"))
                res = UPDATER.from_github()
                if res.get("ok"):
                    broadcast("updating")
                else:
                    log("Automatisches Update fehlgeschlagen: %s" % res.get("error"))
        time.sleep(60)


def idle_watcher():
    """Bildschirmschoner, wenn lange nichts passiert ist und kein Video läuft.
    Zusätzlich 'Auto-Aus': nach X Stunden ohne Eingabe Bildschirm aus oder ganz aus."""
    while True:
        time.sleep(5)
        g = CONFIG["general"]
        idle = time.time() - STATE["lastInput"]
        playing = STATE["playing"] and time.time() - STATE.get("playingAt", 0) < 90
        minutes = float(g.get("screensaverMinutes", 5) or 0)
        if minutes > 0 and not STATE["saver"] and idle > minutes * 60:
            if not playing and not system.media_playing():
                ws = SWAY.focused_ws() if SWAY.available else 1
                if ws in (None, 1) or g.get("screensaverOnPages", True):
                    if ws not in (None, 1):
                        STATE["saverReturn"] = ws
                        SWAY.workspace(1)
                    STATE["saver"] = True
                    broadcast("saver", on=True)
        hours = float(g.get("autoOffHours", 0) or 0)
        if hours > 0 and idle > hours * 3600 and not STATE.get("autoOffDone"):
            if not playing and not system.media_playing():
                STATE["autoOffDone"] = True
                log("Auto-Aus nach %.1f Std. ohne Eingabe" % hours)
                broadcast("sleep", action=g.get("autoOffAction", "screen"))
                if RADIO.playing:
                    RADIO.stop()
                time.sleep(3)
                if g.get("autoOffAction") == "poweroff":
                    subprocess.Popen(["systemctl", "poweroff"])
                else:
                    screen(False)
        if idle < 60:
            STATE["autoOffDone"] = False


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
        ok = pin == CONFIG["remote"]["pin"]
        if ok:
            # Mehrere Handys: jedes meldet seinen Namen mit → Liste "Verbundene Handys"
            name = urllib.parse.unquote(self.headers.get("X-Remote-Name") or "")[:30] or "Handy"
            REMOTES[name] = {"ip": self.client_address[0], "seen": time.time()}
        return ok

    def send_bytes(self, data, ctype, filename=None):
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Access-Control-Allow-Origin", "*")
        if filename:
            self.send_header("Content-Disposition", 'attachment; filename="%s"' % filename)
        self.end_headers()
        self.wfile.write(data)

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

    def send_range(self, path):
        """Videodatei mit 'Range'-Unterstützung (zum Spulen in Aufnahmen)."""
        if not os.path.isfile(path) or not path.endswith(".mp4"):
            return self.send_error(404)
        size = os.path.getsize(path)
        start, end = 0, size - 1
        m = re.match(r"bytes=(\d*)-(\d*)", self.headers.get("Range") or "")
        if m:
            if m.group(1):
                start = int(m.group(1))
                end = int(m.group(2)) if m.group(2) else size - 1
            elif m.group(2):
                start = max(0, size - int(m.group(2)))
            end = min(end, size - 1)
            self.send_response(206)
            self.send_header("Content-Range", "bytes %d-%d/%d" % (start, end, size))
        else:
            self.send_response(200)
        self.send_header("Content-Type", "video/mp4")
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(end - start + 1))
        self.end_headers()
        try:
            with open(path, "rb") as f:
                f.seek(start)
                left = end - start + 1
                while left > 0:
                    chunk = f.read(min(1 << 20, left))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    left -= len(chunk)
        except (BrokenPipeError, ConnectionResetError):
            pass

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
            if path.startswith("/data/rec/"):
                name = os.path.basename(urllib.parse.unquote(path))
                return self.send_range(os.path.join(REC_DIR, name))
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
            return self.send_json(dict(audio_sinks(), settings=audio_settings(),
                                       presets=[{"id": k, "title": v["title"]} for k, v in audio.PRESETS.items()],
                                       report=AUDIO.report, target=AUDIO.target, eq=AUDIO.eq_running(), legacy=AUDIO.legacy_active()))
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
        if path == "/api/android":
            return self.send_json(ANDROID.status())
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
        if path == "/api/brave/config":
            # Für die Brave-Erweiterung: Zoom, Kinomodus, Qualität, Lautstärke-Ausgleich
            g = CONFIG["general"]
            return self.send_json({"ytZoom": g.get("ytZoom", 1.25), "ytCinema": g.get("ytCinema", True),
                                   "ytQuality": g.get("ytQuality", "hd1080"), "normalize": g.get("normalize", True),
                                   "webZoom": g.get("webZoom", 1)})
        if path == "/api/browser/status":
            return self.send_json({"available": BRAVE.available, "running": bool(BRAVE.running_dirs()), "sway": SWAY.available, "hello": SWAY.hello})
        if path == "/api/recent":
            g = CONFIG["general"]
            return self.send_json({"items": BRAVE.history(g, STATE["active"], int(qs.get("n", ["16"])[0]))})
        if path == "/api/bookmarks":
            return self.send_json({"items": BRAVE.bookmarks(CONFIG["general"], STATE["active"])})
        if path == "/api/apps":
            return self.send_json({"apps": APPS.list()})
        if path == "/api/bt":
            return self.send_json(BT.status())
        if path == "/api/kdeconnect":
            return self.send_json({"available": KDEC.available, "devices": KDEC.devices()})
        if path == "/api/sysinfo":
            lk = STATE.get("lastKey")
            return self.send_json(system.sysinfo({
                "lichtung": UPDATER.installed(), "evdev": HAVE_EVDEV, "uinput": bool(UINPUT), "sway": SWAY.available,
                "wmKeys": sorted(KEYSTATE["wm"]), "volume": dict(get_volume(), **VOLUME),
                "lastKey": dict(lk, ago=int(time.time() - lk["t"])) if lk else None,
                "night": NIGHT.available, "bluetooth": BT.available, "kdeconnect": KDEC.available,
                "brave": BRAVE.version() if BRAVE.available else "", "ip": lan_ip()}))
        if path == "/api/siteinfo":
            return self.send_json(system.siteinfo(qs.get("url", [""])[0][:500]))
        if path == "/api/remotes":
            now = time.time()
            return self.send_json({"items": [{"name": n, "ip": r["ip"], "ago": int(now - r["seen"])} for n, r in sorted(REMOTES.items(), key=lambda x: -x[1]["seen"])]})
        if path == "/api/backup":
            stamp = time.strftime("%Y-%m-%d")
            return self.send_bytes(system.backup_zip(DATA_DIR), "application/zip", "lichtung-sicherung-%s.zip" % stamp)
        if path == "/api/update/status":
            return self.send_json({"installed": UPDATER.installed(), "status": UPDATER.status(), "token": bool(UPDATER.token()),
                                   "auto": CONFIG["general"].get("autoUpdate", True), "last": UPDATER.last_check})
        if path == "/api/boot":
            rc, menu = system.admin("grub-menu-status", timeout=5)
            rc2, ply = system.admin("plymouth-status", timeout=5)
            cur, _, job = ply.strip().partition("|")
            themes = sorted(os.path.basename(d) for d in glob.glob("/usr/share/plymouth/themes/*") if os.path.isdir(d))
            return self.send_json({"menu": menu.strip() == "on", "theme": cur.strip(), "job": job.strip(), "themes": themes, "admin": rc == 0})
        if path == "/api/music":
            return self.send_json(MUSIC.status())
        if path == "/api/diag":
            topic = qs.get("topic", [""])[0]
            if not topic:
                return self.send_json({"topics": [{"id": k, "title": v} for k, v in diag.TOPICS]})
            return self.send_json({"topic": topic, "items": diag.run_topic(topic, diag_context())})
        if path == "/api/radio":
            r = CONFIG.get("radio", {})
            return self.send_json(dict(RADIO.status(), favorites=r.get("favorites", []), last=r.get("last"),
                                       categories=[{"id": k, "title": v["title"]} for k, v in radio.CATEGORIES.items()]))
        if path == "/api/radio/search":
            cat, q = qs.get("cat", [""])[0], qs.get("q", [""])[0]
            try:
                if cat == "favoriten":
                    items = CONFIG.get("radio", {}).get("favorites", [])
                else:
                    items = RADIO.search(cat, q)
            except Exception as e:
                return self.send_json({"items": [], "error": str(e)}, 502)
            RADIO.list = items
            return self.send_json({"items": items})
        if path == "/api/services":
            rc, rs = system.admin("runner-status", timeout=8)
            st, job, url = (rs.strip().split("|") + ["", "", ""])[:3] if rc == 0 else ("fehlt", "", "")
            rc2, ag = system.admin("adguard", "status", timeout=8)
            ag_lines = ag.strip().splitlines()
            dienste = {}
            for n in ("tailscale", "vaultwarden", "syncthing", "kuma", "gitea"):
                rcd, out = system.admin("dienst", n, "status", timeout=8)
                dienste[n] = out.strip().splitlines()[-1] if rcd == 0 and out.strip() else "fehlt"
            ts = {}
            if shutil.which("tailscale"):
                rct, out = system.run(["tailscale", "status", "--json"], timeout=5)
                try:
                    j = json.loads(out)
                    ts = {"state": j.get("BackendState"), "name": ((j.get("Self") or {}).get("DNSName") or "").rstrip("."),
                          "ips": (j.get("Self") or {}).get("TailscaleIPs") or []}
                except Exception:
                    ts = {}
            return self.send_json({"runner": {"state": st, "job": job, "url": url}, "adguard": {"installed": rc2 == 0 or "inactive" in ag or "active" in ag,
                                   "active": bool(ag_lines) and ag_lines[0] == "active", "setup": "eingerichtet" in ag}, "ip": lan_ip(),
                                   "dienste": dienste, "tailscale": ts})
        if path == "/api/stats":
            return self.send_json(STATS.sample())
        if path == "/api/mediathek/random":
            # Zufallsdoku: lange Dokus aus Terra X, arte, ZDFinfo, ARD …
            pools = [{"topic": "Terra X", "minMinutes": 40}, {"channels": ["ARTE.DE"], "text": "doku", "minMinutes": 45},
                     {"channels": ["ZDFinfo"], "minMinutes": 40}, {"text": "dokumentation", "minMinutes": 40}, {"channels": ["3Sat"], "text": "doku", "minMinutes": 40},
                     {"topic": "Universum", "minMinutes": 40}, {"topic": "planet e.", "minMinutes": 25}, {"topic": "Abenteuer Erde", "minMinutes": 40}]
            random.shuffle(pools)
            for pool in pools[:3]:
                items = extras.mediathek_row(dict(pool, size=40))
                if items:
                    return self.send_json(random.choice(items))
            return self.send_json({"error": "Mediathek gerade nicht erreichbar"}, 503)
        if path == "/api/recorder":
            return self.send_json({"config": CONFIG.get("recorder", {}), "items": REC.list(), "busy": REC.busy,
                                   "progress": REC.progress, "freeGB": round(REC.free_gb(), 1)})
        if path == "/api/miracast":
            rc, out = system.admin("miracast", "status", timeout=5)
            return self.send_json({"installed": rc == 0, "state": out.strip()})
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
            "android": ANDROID.available,
            "mediathekRows": CONFIG.get("mediathekRows", []),
            "brave": BRAVE.available,
            "sway": SWAY.available,
            "kdeconnect": KDEC.available,
            "bluetooth": BT.available,
            "night": NIGHT.available,
            "version": UPDATER.installed().get("version", "?"),
            "radio": RADIO.status(),
            "audioWizardPending": bool(CONFIG.get("audio", {}).get("wizardPending")),
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
                clean = clean_tile(body.get("tile", {}))
                existing = next((x for x in prof["tiles"] if x["id"] == clean["id"]), None)
                if existing:
                    if existing.get("url") != clean.get("url"):
                        existing.pop("logoTried", None)     # neue Adresse → Logo neu suchen
                    existing.update(clean)
                else:
                    prof["tiles"].append(clean)
                save_config()
                broadcast("config")
                MEDIA_EVENT.set()                            # fehlendes Logo im Hintergrund holen
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
                           "profileAutoSeconds", "background", "volumeStep", "customBackgrounds",
                           "motion", "weatherFx", "aurora", "epgUrl", "setupDone", "mediathekOn", "theme",
                           "braveScale", "braveProfiles", "ytZoom", "ytCinema", "ytQuality", "normalize", "webZoom",
                           "nightMode", "nightFrom", "nightTo", "nightTemp", "season", "seasonFx", "saverStyle",
                           "autoOffHours", "autoOffAction", "bigWeather", "showRecent", "quickbar", "searchEngine",
                           "package", "dimEvening", "outputMode", "webcamBg", "webcams", "showStats", "autoUpdate", "pauseOnHome"}
                for k, v in body.items():
                    if k in allowed:
                        CONFIG["general"][k] = v
                WEATHER_CACHE["t"] = 0
                save_config()
                NIGHT.apply(CONFIG["general"])
                if "braveScale" in body:
                    BRAVE.restart()      # neue Größe greift beim nächsten Öffnen
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
                if body.get("asTile"):
                    broadcast("incoming", url=url, label=label, tile=True)
                elif url.startswith("http") and BRAVE.available:
                    BRAVE.open(CONFIG["general"], STATE["active"], url, "tab")   # Webseiten → Brave
                else:
                    if SWAY.available:
                        SWAY.workspace(1)
                    broadcast("open", url=url, label=label)          # Videodateien → Lichtung-Player
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
            STATE["playingAt"] = time.time()
            if body.get("input"):
                wake()
            return self.send_json({"ok": True})

        if path == "/api/key":
            key = body.get("key", "")
            if body.get("src") == "wm":
                # Tastenkürzel von sway: ab jetzt nicht mehr zusätzlich über evdev auswerten
                KEYSTATE["wm"].add("home" if key == "home" else "volume")
                STATE["lastKey"] = {"name": key, "device": "sway", "t": time.time(), "src": "wm"}
            wake()
            if key == "home":
                go_home()
            elif key in ("volup", "voldown", "mute"):
                return self.send_json(change_volume({"volup": "up", "voldown": "down"}.get(key, "mute")))
            elif key in REMOTE_KEYS:
                if not tap(REMOTE_KEYS[key]):
                    broadcast("remotekey", key=key)   # Fallback ohne uinput: Seite reagiert selbst
            return self.send_json({"ok": True})

        if path == "/api/wm":
            SWAY.hello = True
            KEYSTATE["wm"].update({"home", "volume"})
            NIGHT.apply(CONFIG["general"])
            log("sway meldet sich – Tasten kommen jetzt über sway")
            return self.send_json({"ok": True})

        if path == "/api/quick":
            if SWAY.available:
                SWAY.workspace(1)
            wake()
            broadcast("quick")
            return self.send_json({"ok": True})

        if path == "/api/browser/open":
            url = (body.get("url") or "").strip()
            if url and not re.match(r"^https?://", url):
                url = "https://" + url
            res = BRAVE.open(CONFIG["general"], STATE["active"], url, body.get("mode") or "tab")
            return self.send_json(res, 200 if res.get("ok") else 503)
        if path == "/api/browser/restart":
            return self.send_json(BRAVE.restart())

        if path == "/api/apps/launch":
            res = APPS.launch(body.get("id", ""))
            return self.send_json(res, 200 if res.get("ok") else 400)

        if path == "/api/incoming":
            # Link von außen (KDE Connect "Teilen", xdg-open) → Fernseher fragt: öffnen oder Kachel?
            url, label = extras.normalize_link(body.get("url", ""))
            if not url:
                return self.send_json({"error": "Kein Link"}, 400)
            if SWAY.available:
                SWAY.workspace(1)
            wake()
            broadcast("incoming", url=url, label=label)
            return self.send_json({"ok": True})

        if path == "/api/bt":
            if not BT.available:
                return self.send_json({"ok": False, "error": "Bluetooth ist nicht installiert"}, 503)
            return self.send_json(BT.action(body.get("action", ""), body.get("mac")))

        if path == "/api/kdeconnect":
            return self.send_json(KDEC.action(body.get("action", ""), body.get("id"), body.get("url")))

        if path == "/api/restore":
            raw = body.get("data", "")
            if "," in raw:
                raw = raw.split(",", 1)[1]
            try:
                system.restore_zip(base64.b64decode(raw), DATA_DIR)
            except Exception as e:
                return self.send_json({"ok": False, "error": str(e)[:200]}, 400)
            with CFG_LOCK:
                fresh = load_config()
                CONFIG.clear()
                CONFIG.update(fresh)
                save_config()
            broadcast("config")
            return self.send_json({"ok": True})

        if path == "/api/update/check":
            return self.send_json(UPDATER.check())
        if path == "/api/update/token":
            try:
                UPDATER.set_token(body.get("token", ""))
            except ValueError as e:
                return self.send_json({"ok": False, "error": str(e)}, 400)
            return self.send_json({"ok": True, "token": bool(UPDATER.token())})
        if path == "/api/update/run":
            if body.get("data"):
                raw = body["data"].split(",", 1)[1] if "," in body["data"] else body["data"]
                res = UPDATER.from_upload(base64.b64decode(raw))
            else:
                res = UPDATER.from_github()
            if res.get("ok"):
                broadcast("updating")
            return self.send_json(res, 200 if res.get("ok") else 400)

        if path == "/api/boot":
            if "menu" in body:
                rc, out = system.admin("grub-menu", "on" if body["menu"] else "off", timeout=60)
            elif body.get("theme"):
                rc, out = system.admin("plymouth", body["theme"], timeout=20)
            else:
                return self.send_json({"ok": False}, 400)
            return self.send_json({"ok": rc == 0, "msg": out.strip()[-200:]}, 200 if rc == 0 else 400)

        if path == "/api/miracast":
            rc, out = system.admin("miracast", "start" if body.get("on") else "stop", timeout=20)
            return self.send_json({"ok": rc == 0, "msg": out.strip()[-200:]})

        if path == "/api/radio/play":
            st = body.get("station") or CONFIG.get("radio", {}).get("last")
            res = RADIO.play(st)
            if res.get("ok"):
                CONFIG.setdefault("radio", {})["last"] = st
                save_config()
            return self.send_json(res, 200 if res.get("ok") else 400)
        if path == "/api/radio/show":
            # Radio-Bildschirm am Fernseher zeigen (von der Handy-Fernbedienung)
            if SWAY.available:
                SWAY.workspace(1)
            wake()
            broadcast("open", url="/radio.html", label="Radio")
            return self.send_json({"ok": True})
        if path == "/api/radio/stop":
            return self.send_json(RADIO.stop())
        if path == "/api/radio/step":
            return self.send_json(RADIO.step(1 if body.get("dir", 1) >= 0 else -1))
        if path == "/api/radio/toggle":
            if RADIO.playing:
                return self.send_json(RADIO.stop())
            return self.send_json(RADIO.play(CONFIG.get("radio", {}).get("last")))
        if path == "/api/radio/fav":
            st, r = body.get("station") or {}, CONFIG.setdefault("radio", {"favorites": []})
            favs = [f for f in r.setdefault("favorites", []) if f.get("id") != st.get("id")]
            if body.get("on") and st.get("url"):
                favs.insert(0, {k: st.get(k) for k in ("id", "name", "url", "logo", "tags", "country", "codec", "bitrate")})
            r["favorites"] = favs[:40]
            save_config()
            return self.send_json({"ok": True, "favorites": r["favorites"]})

        if path == "/api/music":
            a = body.get("action", "")
            if a == "on":
                res = MUSIC.start()
            elif a == "off":
                res = MUSIC.stop()
            else:
                res = MUSIC.control(a)
            return self.send_json(res)

        if path == "/api/recorder":
            r = CONFIG.setdefault("recorder", {"on": False, "rules": []})
            for k in ("on", "keepDays", "quality", "minFreeGB"):
                if k in body:
                    r[k] = body[k]
            if "rules" in body:
                rules = []
                for x in body["rules"][:20]:
                    if not (x.get("topic") or x.get("text")):
                        continue
                    rules.append({"id": x.get("id") or new_id("r"), "topic": (x.get("topic") or "")[:60], "text": (x.get("text") or "")[:60],
                                  "channels": [c for c in (x.get("channels") or []) if isinstance(c, str)][:8],
                                  "minMinutes": int(x.get("minMinutes") or 10), "max": max(1, min(5, int(x.get("max") or 2))), "on": x.get("on", True) is not False})
                r["rules"] = rules
            save_config()
            if r.get("on") and body.get("runNow"):
                threading.Thread(target=REC.tick, daemon=True).start()
            return self.send_json({"ok": True, "config": r})
        if path == "/api/recorder/delete":
            return self.send_json(REC.delete(str(body.get("id", ""))))

        if path == "/api/runner":
            if body.get("remove"):
                rc, out = system.admin("runner-remove", timeout=60)
            else:
                rc, out = system.admin("runner-setup", body.get("url", ""), input=(body.get("token", "") + "\n"), timeout=600)
            return self.send_json({"ok": rc == 0, "msg": out.strip()[-300:]}, 200 if rc == 0 else 400)
        if path == "/api/dienst":
            name = body.get("name", "")
            if name not in ("tailscale", "vaultwarden", "syncthing", "kuma", "gitea"):
                return self.send_json({"ok": False}, 400)
            rc, out = system.admin("dienst", name, "on" if body.get("on") else "off", timeout=60)
            return self.send_json({"ok": rc == 0, "msg": out.strip()[-200:]})
        if path == "/api/tailscale/login":
            rc, out = system.admin("tailscale-login", timeout=30)
            url = (re.findall(r"https://login\.tailscale\.com/\S+", out) or [""])[0]
            return self.send_json({"ok": bool(url), "url": url, "msg": out.strip()[-200:]})
        if path == "/api/vaultwarden/https":
            rc, out = system.admin("vaultwarden-https", timeout=30)
            return self.send_json({"ok": rc == 0, "msg": out.strip()[-300:]})
        if path == "/api/adguard":
            rc, out = system.admin("adguard", "on" if body.get("on") else "off", timeout=30)
            return self.send_json({"ok": rc == 0, "msg": out.strip()})

        if path == "/api/wol":
            rc, out = system.admin("wol", "on" if body.get("on") else "off", timeout=20)
            return self.send_json({"ok": rc == 0, "msg": out.strip()})

        if path == "/api/brave/extensions":
            ids = [i for i in body.get("ids", []) if re.match(r"^[a-p]{32}$", i)]
            CONFIG["general"]["braveExtensions"] = ids
            save_config()
            rc, out = system.admin("brave-extensions", ",".join(ids), timeout=10)
            return self.send_json({"ok": rc == 0, "msg": out.strip()})

        if path == "/api/siteinfo/logo":
            # Logo einer Website herunterladen und lokal speichern
            return self.send_json({"url": system.fetch_image(body.get("url", ""), IMG_DIR)})

        if path == "/api/tiles/import":
            with CFG_LOCK:
                prof = active_profile()
                n = 0
                for it in body.get("items", [])[:40]:
                    url = (it.get("url") or "").strip()
                    if not url.startswith("http") or any(t["url"] == url for t in prof["tiles"]):
                        continue
                    prof["tiles"].append(clean_tile({"title": it.get("title") or urllib.parse.urlparse(url).hostname, "url": url,
                                                     "logo": it.get("logo", ""), "color": it.get("color", ""), "hue": random.choice([8, 28, 100, 150, 200, 225, 265, 340])}))
                    n += 1
                save_config()
            broadcast("config")
            return self.send_json({"ok": True, "added": n})

        if path == "/api/audio":
            # Einen bestimmten Ausgang wählen → "Einzeln" mit diesem Ziel
            sid = int(body.get("id", 0))
            sink = next((x for x in audio_sinks()["sinks"] if x["id"] == sid), None)
            if sink and not sink["virtual"]:
                a = CONFIG.setdefault("audio", {})
                a["sink"], a["output"] = sink["node"], "einzeln"
                save_config()
                apply_audio_async()
                return self.send_json(dict(audio_sinks(), pending=True))
            run(["wpctl", "set-default", str(sid)])
            return self.send_json(audio_sinks())
        if path == "/api/audio/klang":
            a = CONFIG.setdefault("audio", {})
            if body.get("klang") in list(audio.PRESETS) + ["aus"]:
                a["klang"] = body["klang"]
            if body.get("output") in ("auto", "beide", "einzeln"):
                a["output"] = body["output"]
            save_config()
            apply_audio_async()
            return self.send_json({"ok": True, "pending": True, "settings": audio_settings()})
        if path == "/api/audio/repair":
            def work():
                steps = audio.repair_basic(log)
                res = AUDIO.apply()
                broadcast("audiodone", ok=res["ok"], report=steps + res.get("report", []), error=res.get("error"))
            threading.Thread(target=work, daemon=True).start()
            return self.send_json({"ok": True, "pending": True})
        if path == "/api/diag/fix":
            act = body.get("action", "")
            if act in ("audio-repair", "audio-apply"):
                if act == "audio-repair":
                    audio.repair_basic(log)
                apply_audio_async()
                return self.send_json({"ok": True, "msg": "Ton wird repariert …"})
            if act == "audio-sof":
                rc, out = system.admin("audio-driver", "sof", timeout=180)
                return self.send_json({"ok": rc == 0, "msg": "Neuer Treiber ab dem nächsten Neustart" if rc == 0 else out[:160]})
            if act == "bt-power":
                rc, out = run_rc(["bluetoothctl", "power", "on"])
                return self.send_json({"ok": rc == 0, "msg": "Bluetooth eingeschaltet" if rc == 0 else out[:160]})
            if act == "update-check":
                c = UPDATER.check()
                return self.send_json({"ok": c.get("ok", False), "msg": ("Neue Version: " + c["latest"]) if c.get("newer") else (c.get("error") or "Aktuell ✓")})
            return self.send_json({"ok": False, "msg": "unbekannte Reparatur"}, 400)
        if path == "/api/audio/wizard":
            # Ton-Assistent: start | heard | notheard | replay | reboot | cancel
            act = body.get("action", "")
            if act == "start":
                return self.send_json(AUDIO.wizard_start(body.get("from")))
            if act in ("heard", "notheard"):
                return self.send_json(AUDIO.wizard_answer(act == "heard"))
            if act == "replay":
                return self.send_json(AUDIO.wizard_replay())
            if act == "reboot":
                return self.send_json(AUDIO.wizard_reboot(body.get("legacy", True)))
            if act == "cancel":
                AUDIO.wizard = None
                a = CONFIG.setdefault("audio", {})
                a["wizardPending"] = False
                save_config()
                apply_audio_async()
                return self.send_json({"ok": True})
            return self.send_json({"error": "unbekannte Aktion"}, 400)

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

        if path == "/api/android/pair":
            return self.send_json(ANDROID.start_pairing() if ANDROID.available else {"state": "fehler", "msg": "scrcpy ist nicht installiert"})
        if path == "/api/android/mirror":
            res = {}
            t = threading.Thread(target=lambda: res.update(ANDROID.start_mirror()))
            t.start(); t.join(20)
            return self.send_json(res or {"ok": False, "msg": "Zeitüberschreitung"})
        if path == "/api/android/stop":
            ANDROID.stop_mirror()
            return self.send_json({"ok": True})

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
                BRAVE.restart()
            return self.send_json({"ok": True})

        return self.send_json({"error": "unbekannt"}, 404)


TILE_SIZES = ("klein", "normal", "gross", "banner")
TILE_OPEN = ("tab", "kino", "lichtung")


def clean_tile(t):
    """Kachel prüfen und nur erlaubte Felder übernehmen."""
    clean = {
        "id": t.get("id") or new_id("t"),
        "title": (t.get("title") or "Neue Kachel")[:40],
        "subtitle": (t.get("subtitle") or "")[:80],
        "description": (t.get("description") or "")[:400],
        "url": (t.get("url") or "").strip(),
        "image": t.get("image") or "",
        "logo": t.get("logo") or "",
        "color": t.get("color") if re.match(r"^#[0-9a-fA-F]{3,8}$", t.get("color") or "") else "",
        "size": t.get("size") if t.get("size") in TILE_SIZES else "normal",
        "open": t.get("open") if t.get("open") in TILE_OPEN else "tab",
        "hue": int(t["hue"] if t.get("hue") is not None else 200) % 360,
    }
    if clean["url"] and not re.match(r"^(https?://|lichtung:|app:)", clean["url"]):
        clean["url"] = "https://" + clean["url"]
    return clean


def norm_key(url):
    """Macht aus einer URL einen eindeutigen Schlüssel fürs Weiterschauen.
    Bei YouTube zählt nur die Video-ID."""
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
    old = next((c for c in items if c["key"] == key), None)
    items[:] = [c for c in items if c["key"] != key]
    # Fast fertig (>95 %) oder sehr kurz → nicht merken
    if d > 0 and (t / d > 0.95 or d < 120):
        save_config()
        broadcast("config")
        return {"ok": True, "removed": True}
    if t < 30:
        return {"ok": True}
    vid = key[3:] if key.startswith("yt:") else None
    # Vorschaubild: bei YouTube immer das offizielle Vorschaubild (die Seite meldet
    # nach einem Videowechsel oft noch das alte). Ein schon lokal gespeichertes
    # Bild wird behalten, damit es nicht bei jeder Fortschrittsmeldung neu lädt.
    src = ("https://i.ytimg.com/vi/%s/hqdefault.jpg" % vid) if vid else (body.get("image") or "")
    if src.startswith(("blob:", "data:")):
        src = ""
    image, image_src = src, src
    if old and old.get("image", "").startswith("/data/") and old.get("imageSrc", "") in (src, "") :
        image, image_src = old["image"], old.get("imageSrc", "")
    items.insert(0, {
        "key": key, "url": url, "title": (body.get("title") or url)[:120],
        "site": (body.get("site") or urllib.parse.urlparse(url).hostname or "")[:40],
        "image": image, "imageSrc": image_src,
        "time": t, "duration": d, "updated": time.time(), "yt": vid,
        "player": body.get("player") or None,   # direkte Videoadresse → im eigenen Player öffnen
    })
    del items[20:]   # maximal 20 Einträge
    save_config()
    broadcast("continue")
    MEDIA_EVENT.set()            # Vorschaubild im Hintergrund lokal speichern
    return {"ok": True}


# --------------------------------------------------------------------------
# Bilder lokal speichern: Vorschaubilder fürs Weiterschauen und Kachel-Logos.
# Fremde Bilder brechen sonst gern weg (Adresse läuft ab, Seite sperrt das
# Einbinden). Lokal gespeichert laden sie immer und sofort.
# --------------------------------------------------------------------------
MEDIA_EVENT = threading.Event()


def cache_image(src, prefix="thumb", max_px=640):
    """Lädt ein Bild herunter und speichert es unter /data/images/. Gleiche
    Adresse → gleicher Dateiname (wird nicht doppelt geladen)."""
    if not src.startswith(("http://", "https://")):
        return ""
    name = "%s-%s" % (prefix, hashlib.sha1(src.encode()).hexdigest()[:16])
    for ext in (".jpg", ".png"):
        if os.path.exists(os.path.join(IMG_DIR, name + ext)):
            return "/data/images/" + name + ext
    try:
        req = urllib.request.Request(src, headers={"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) LichtungTV",
                                                   "Accept": "image/*"})
        with urllib.request.urlopen(req, timeout=10) as r:
            data = r.read(6 * 1024 * 1024)
    except Exception:
        return ""
    os.makedirs(IMG_DIR, exist_ok=True)
    try:
        from PIL import Image
        import io
        img = Image.open(io.BytesIO(data))
        img.thumbnail((max_px, max_px))
        if prefix == "logo":          # Logos: Transparenz behalten
            img.convert("RGBA").save(os.path.join(IMG_DIR, name + ".png"), "PNG")
            return "/data/images/" + name + ".png"
        img.convert("RGB").save(os.path.join(IMG_DIR, name + ".jpg"), "JPEG", quality=85)
        return "/data/images/" + name + ".jpg"
    except Exception:
        if data[:4] == b"\x89PNG":
            ext = ".png"
        elif data[:3] == b"\xff\xd8\xff":
            ext = ".jpg"
        else:
            return ""                 # kein Bild (z. B. Fehlerseite)
        with open(os.path.join(IMG_DIR, name + ext), "wb") as f:
            f.write(data)
        return "/data/images/" + name + ext


def site_logo(url):
    """Bestes Symbol einer Website: großes Logo aus der Seite, sonst
    apple-touch-icon, sonst Favicon in 128 px (über Google)."""
    host = urllib.parse.urlparse(url).hostname or ""
    if not host:
        return ""
    candidates = []
    try:
        info = system.siteinfo(url)
        if info.get("logo"):
            candidates.append(info["logo"])
    except Exception:
        pass
    candidates += ["https://%s/apple-touch-icon.png" % host,
                   "https://www.google.com/s2/favicons?domain=%s&sz=128" % host]
    for c in candidates:
        local = cache_image(c, prefix="logo", max_px=256)
        if local:
            return local
    return ""


def media_cache_pass():
    """Ein Durchgang: fehlende Vorschaubilder und Kachel-Logos holen.
    Gibt True zurück, wenn sich etwas geändert hat."""
    changed = False
    for prof in CONFIG.get("profiles", []):
        for c in list(prof.get("continue", [])):
            if (c.get("image") or "").startswith("/data/"):
                continue
            if time.time() - c.get("imageTried", 0) < 3600:
                continue
            src = c.get("image") or c.get("imageSrc") or ""
            if not src and c.get("yt"):
                src = "https://i.ytimg.com/vi/%s/hqdefault.jpg" % c["yt"]
            if not src and c.get("url", "").startswith("http"):
                try:
                    src = system.siteinfo(c["url"]).get("image") or ""
                except Exception:
                    src = ""
            local = cache_image(src) if src else ""
            if local:
                c["image"], c["imageSrc"] = local, src
                c.pop("imageTried", None)
            else:
                c["imageTried"] = time.time()
            changed = True
        for t in prof.get("tiles", []):
            url = t.get("url", "")
            if t.get("image") or t.get("logo") or t.get("logoTried") or not url.startswith(("http://", "https://")):
                continue
            t["logo"] = site_logo(url)
            t["logoTried"] = True
            changed = True
    return changed


def media_cache_worker():
    time.sleep(20)                   # erst den Start in Ruhe lassen
    while True:
        try:
            if media_cache_pass():
                save_config()
                broadcast("config")
        except Exception as e:
            log("Bilder speichern:", e)
        MEDIA_EVENT.wait(600)        # spätestens alle 10 Minuten, sonst sobald etwas Neues da ist
        MEDIA_EVENT.clear()


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
    threading.Thread(target=update_watcher, daemon=True).start()
    threading.Thread(target=RADIO.watch, daemon=True).start()
    threading.Thread(target=audio_startup, daemon=True).start()
    threading.Thread(target=media_cache_worker, daemon=True).start()
    EPG.start()
    SWAY.start_watch(lambda: broadcast("home", url=LAUNCHER_URL), lambda: CONFIG["general"].get("outputMode", "last"))
    KDEC.start_call_monitor()
    REC.start()
    threading.Timer(8, lambda: NIGHT.apply(CONFIG["general"])).start()
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    server.daemon_threads = True
    log("Lichtung TV läuft auf http://%s:%d  (Handy: /remote, Code %s)" % (lan_ip(), PORT, CONFIG["remote"]["pin"]))
    server.serve_forever()


if __name__ == "__main__":
    main()
