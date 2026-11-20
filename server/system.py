# -*- coding: utf-8 -*-
"""
Lichtung TV – System-Bausteine
==============================

Alles, was über die Startseite hinausgeht und mit dem restlichen System
spricht. Jeder Teil prüft selbst, ob das benötigte Programm vorhanden ist –
fehlt etwas (z. B. beim Testen auf einem normalen PC), läuft der Rest weiter.

  Sway        Fenstermanager: Ebenen wechseln, Programme starten, Bildschirme
  Brave       Browser starten, Links öffnen, Profile, Verlauf, Lesezeichen
  Apps        Programme als Kacheln (Terminal, App-Store, Retro-Spiele, eigene)
  Night       Abendmodus (wärmeres Licht über wlsunset)
  Bluetooth   Kopfhörer, Lautsprecher, Gamepads koppeln (bluetoothctl)
  KDEConnect  Handy-Verbindung (kdeconnect-cli) + Pause bei Anruf
  sysinfo()   Temperatur, Speicher, WLAN, Versionen – für "Systeminfo"
  siteinfo()  Titel, Logo und Farbe einer Website – für "Kachel automatisch"
  Backup      Einstellungen + Bilder als ZIP sichern und wiederherstellen
  Updater     Update von GitHub oder per Datei einspielen
  admin()     ruft den Root-Helfer /usr/local/sbin/lichtung-admin auf
"""

import base64
import configparser
import glob
import html
import io
import hashlib
import json
import os
import re
import shlex
import shutil
import sqlite3
import subprocess
import tempfile
import threading
import time
import urllib.parse
import urllib.request
import zipfile

ADMIN = "/usr/local/sbin/lichtung-admin"


def run(args, timeout=6, env=None, input=None):
    """Programm ausführen → (Rückgabewert, Ausgabe). Nie eine Ausnahme."""
    try:
        r = subprocess.run(args, capture_output=True, text=True, timeout=timeout, env=env, input=input)
        return r.returncode, (r.stdout or "") + (r.stderr or "")
    except Exception as e:  # Programm fehlt, Zeitüberschreitung …
        return 127, str(e)


def admin(*args, input=None, timeout=20):
    """Root-Helfer über sudo (ohne Passwort, nur dieses eine Skript erlaubt)."""
    if not os.path.exists(ADMIN):
        return 127, "Root-Helfer fehlt (install.sh erneut ausführen)"
    return run(["sudo", "-n", ADMIN] + [str(a) for a in args], timeout=timeout, input=input)


def runtime_dir():
    return os.environ.get("XDG_RUNTIME_DIR") or "/run/user/%d" % os.getuid()


# ==========================================================================
# sway
# ==========================================================================

class Sway:
    """Spricht mit sway über swaymsg. Ebenen: 1 Lichtung, 2 Brave, 3 Programme, 4 Kino."""

    def __init__(self, log=print):
        self.log = log
        self.hello = False          # hat sway sich gemeldet (Tastenkürzel aktiv)?
        self._watch = None

    def sock(self):
        s = os.environ.get("SWAYSOCK")
        if s and os.path.exists(s):
            return s
        found = sorted(glob.glob(os.path.join(runtime_dir(), "sway-ipc.*.sock")), key=os.path.getmtime)
        return found[-1] if found else None

    @property
    def available(self):
        return bool(shutil.which("swaymsg") and self.sock())

    def msg(self, *args, kind=None):
        s = self.sock()
        if not s:
            return None
        cmd = ["swaymsg", "-s", s]
        if kind:
            cmd += ["-t", kind]
        cmd += list(args)
        rc, out = run(cmd, timeout=4)
        if kind:
            try:
                return json.loads(out)
            except Exception:
                return None
        return rc == 0

    def workspace(self, n):
        return self.msg("workspace", "number", str(int(n)))

    def focused_ws(self):
        ws = self.msg(kind="get_workspaces") or []
        for w in ws:
            if w.get("focused"):
                return w.get("num")
        return None

    def exec(self, args):
        """Programm innerhalb von sway starten (bekommt dort Bild und Ton)."""
        line = " ".join(shlex.quote(a) for a in args)
        return self.msg("exec", line)

    def windows(self):
        """Alle Fenster: [{app_id, name, ws, focused}]"""
        tree = self.msg(kind="get_tree")
        out = []

        def walk(node, ws=None):
            if node.get("type") == "workspace":
                ws = node.get("num")
            if node.get("pid") and node.get("type") in ("con", "floating_con"):
                app = node.get("app_id") or ((node.get("window_properties") or {}).get("class")) or ""
                out.append({"app_id": app, "name": node.get("name") or "", "ws": ws, "focused": node.get("focused", False), "id": node.get("id")})
            for c in node.get("nodes", []) + node.get("floating_nodes", []):
                walk(c, ws)
        if tree:
            walk(tree)
        return out

    def focus_app(self, pattern):
        """Vorhandenes Fenster nach vorne holen. True, wenn es eins gab."""
        for w in self.windows():
            if re.search(pattern, w["app_id"] or ""):
                self.msg("[con_id=%d]" % w["id"], "focus")
                return True
        return False

    def outputs(self):
        return self.msg(kind="get_outputs") or []

    def ensure_tv_output(self, mode="last"):
        """'Nur Fernseher': ist HDMI/DP angeschlossen, Laptop-Bildschirm aus."""
        if mode != "last":
            return
        outs = self.outputs()
        internal = [o for o in outs if re.match(r"^(eDP|LVDS|DSI)", o.get("name", ""))]
        external = [o for o in outs if not re.match(r"^(eDP|LVDS|DSI)", o.get("name", "")) and o.get("active")]
        for o in internal:
            if external and o.get("active"):
                self.msg("output", o["name"], "disable")
            elif not external and not o.get("active"):
                self.msg("output", o["name"], "enable")

    def start_watch(self, on_empty, mode_getter):
        """Hintergrund: leere Ebene → zurück zu Lichtung; Bildschirme prüfen."""
        if self._watch:
            return

        def loop():
            while True:
                try:
                    if self.available:
                        ws = self.focused_ws()
                        if ws and ws != 1:
                            busy = {w["ws"] for w in self.windows()}
                            if ws not in busy:
                                self.workspace(1)
                                on_empty()
                        self.ensure_tv_output(mode_getter())
                except Exception as e:
                    self.log("sway-Wächter:", e)
                time.sleep(2)
        self._watch = threading.Thread(target=loop, daemon=True)
        self._watch.start()


# ==========================================================================
# Brave
# ==========================================================================

def brave_bin():
    for b in ("brave-browser", "brave-browser-stable", "brave"):
        p = shutil.which(b)
        if p:
            return p
    return None


class Brave:
    DEFAULT_DIR = os.path.expanduser("~/.config/BraveSoftware/Brave-Browser")

    def __init__(self, sway, data_dir, app_dir, log=print):
        self.sway = sway
        self.data_dir = data_dir
        self.app_dir = app_dir
        self.log = log

    @property
    def available(self):
        return bool(brave_bin())

    def profile_dir(self, profile_id, separate=True):
        if not separate or profile_id in (None, "", "standard"):
            return self.DEFAULT_DIR
        safe = re.sub(r"[^\w-]", "", profile_id)
        return os.path.join(self.data_dir, "brave", safe)

    def base_args(self, g, profile_id):
        scale = float(g.get("braveScale") or 1.25)
        args = [brave_bin() or "brave-browser",
                "--ozone-platform=wayland",
                "--enable-features=VaapiVideoDecoder,VaapiVideoDecodeLinuxGL,AcceleratedVideoDecodeLinuxGL,AcceleratedVideoDecodeLinuxZeroCopyGL",
                "--disable-features=DisableLoadExtensionCommandLineSwitch",
                "--force-device-scale-factor=%.2f" % max(0.8, min(3.0, scale)),
                "--password-store=basic",
                "--no-default-browser-check",
                "--user-data-dir=" + self.profile_dir(profile_id, g.get("braveProfiles", True))]
        ext = os.path.join(self.app_dir, "brave-extension")
        if os.path.isdir(ext):
            args.append("--load-extension=" + ext)
        return args

    def running_dirs(self):
        rc, out = run(["pgrep", "-af", "brave"], timeout=3)
        return set(re.findall(r"--user-data-dir=(\S+)", out)) if rc == 0 else set()

    def stop_others(self, g, profile_id):
        """Beim Profilwechsel: Brave der anderen Profile sauber beenden (Tabs bleiben gespeichert)."""
        keep = self.profile_dir(profile_id, g.get("braveProfiles", True))
        for d in self.running_dirs():
            if d != keep:
                run(["pkill", "-TERM", "-f", "--user-data-dir=" + d], timeout=3)

    def open(self, g, profile_id, url="", mode="tab"):
        """mode: 'tab' = neuer Tab im normalen Fenster (Ebene 2)
                 'kino' = eigenes Fenster ohne Leisten (Ebene 4)"""
        if not self.available:
            return {"ok": False, "error": "Brave ist nicht installiert"}
        self.stop_others(g, profile_id)
        args = self.base_args(g, profile_id)
        if mode == "kino" and url:
            args.append("--app=" + url)
            ws = 4
        else:
            if url:
                args.append(url)       # läuft Brave schon, öffnet sich ein neuer Tab
            ws = 2
        if self.sway.available:
            self.sway.workspace(ws)
            if not url and mode != "kino" and self.sway.focus_app(r"^brave-browser$"):
                return {"ok": True, "ws": ws, "focused": True}
            self.sway.exec(args)
        else:
            subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        return {"ok": True, "ws": ws}

    def restart(self):
        run(["pkill", "-TERM", "-f", "brave"], timeout=3)
        return {"ok": True}

    def version(self):
        b = brave_bin()
        return run([b, "--version"], timeout=5)[1].strip() if b else ""

    # ---------- Verlauf & Lesezeichen (direkt aus Braves Dateien) ----------
    def history(self, g, profile_id, limit=16):
        """Zuletzt besuchte Seiten, eine pro Website (neueste zuerst)."""
        db = os.path.join(self.profile_dir(profile_id, g.get("braveProfiles", True)), "Default", "History")
        if not os.path.exists(db):
            return []
        tmp = tempfile.mktemp(suffix=".db")
        try:
            shutil.copy(db, tmp)          # Brave sperrt die Datei – Kopie lesen
            con = sqlite3.connect(tmp)
            rows = con.execute("SELECT url, title, last_visit_time FROM urls WHERE hidden = 0 ORDER BY last_visit_time DESC LIMIT 400").fetchall()
            con.close()
        except Exception as e:
            self.log("Verlauf nicht lesbar:", e)
            return []
        finally:
            try:
                os.remove(tmp)
            except OSError:
                pass
        seen, out = set(), []
        for url, title, t in rows:
            u = urllib.parse.urlparse(url)
            if u.scheme not in ("http", "https"):
                continue
            host = (u.hostname or "").replace("www.", "")
            if not host or host in seen or host in ("127.0.0.1", "localhost") or "accounts.google" in host:
                continue
            seen.add(host)
            # Chrome-Zeit: Mikrosekunden seit 1601
            ts = t / 1e6 - 11644473600 if t else 0
            out.append({"url": url, "title": (title or host)[:90], "host": host, "t": ts,
                        "icon": "https://icons.duckduckgo.com/ip3/%s.ico" % host})
            if len(out) >= limit:
                break
        return out

    def bookmarks(self, g, profile_id):
        path = os.path.join(self.profile_dir(profile_id, g.get("braveProfiles", True)), "Default", "Bookmarks")
        out = []

        def walk(node, folder=""):
            if node.get("type") == "url":
                out.append({"title": node.get("name", "")[:60], "url": node.get("url", ""), "folder": folder})
            for c in node.get("children", []) or []:
                walk(c, node.get("name", folder) if node.get("type") == "folder" else folder)
        try:
            with open(path, encoding="utf-8") as f:
                data = json.load(f)
            for root in (data.get("roots") or {}).values():
                if isinstance(root, dict):
                    walk(root)
        except Exception:
            pass
        return [b for b in out if b["url"].startswith("http")][:200]


# ==========================================================================
# Programme
# ==========================================================================

BUILTIN_APPS = {
    "terminal": {"name": "Terminal", "desc": "Befehle eingeben, Programme installieren", "cmd": ["foot", "-c", "/opt/lichtung-tv/system/foot.ini"], "app_id": r"^foot$", "need": "foot"},
    "store": {"name": "App-Store", "desc": "Programme aus Flathub installieren", "cmd": ["gnome-software"], "app_id": r"^org\.gnome\.Software$", "need": "gnome-software"},
    "retro": {"name": "Retro-Spiele", "desc": "RetroArch mit Gamepad", "cmd": ["retroarch", "--fullscreen"], "app_id": r"(?i)retroarch", "need": "retroarch"},
    "galaxy": {"name": "Galaxy Book-Bildschirm", "desc": "Moonlight: Bild vom PC (Sunshine) aufs TV", "cmd": ["flatpak", "run", "com.moonlight_stream.Moonlight"], "app_id": r"(?i)moonlight", "need": "flatpak"},
    "files": {"name": "Dateien", "desc": "Fotos, Videos und Downloads", "cmd": ["foot", "-c", "/opt/lichtung-tv/system/foot.ini", "-e", "mc"], "app_id": r"^foot$", "need": "mc"},
}


class Apps:
    DIRS = ["/usr/share/applications", "/usr/local/share/applications",
            os.path.expanduser("~/.local/share/applications"),
            "/var/lib/flatpak/exports/share/applications",
            os.path.expanduser("~/.local/share/flatpak/exports/share/applications")]
    HIDE = re.compile(r"(?i)(^lichtung|foot|kdeconnect|display-im6|mimeinfo|^debian-|^xdg-|vim|^nm-|bluetooth-sendto|uxplay|texdoc|htop|btop|^mc$|mcedit|org\.gnome\.Software|retroarch|moonlight|scrcpy|syncthing|ibus|gcr-|polkit)")

    def __init__(self, sway):
        self.sway = sway

    def list(self):
        apps = []
        for key, a in BUILTIN_APPS.items():
            apps.append({"id": key, "name": a["name"], "desc": a["desc"], "builtin": True, "installed": bool(shutil.which(a["need"]))})
        seen = set()
        for d in self.DIRS:
            for f in sorted(glob.glob(os.path.join(d, "*.desktop"))):
                did = os.path.basename(f)[:-8]
                if did in seen or self.HIDE.match(did):
                    continue
                cp = configparser.RawConfigParser(strict=False, interpolation=None)
                try:
                    cp.read(f, encoding="utf-8")
                    e = cp["Desktop Entry"]
                except Exception:
                    continue
                if e.get("NoDisplay", "false").lower() == "true" or e.get("Type", "Application") != "Application" or e.get("Terminal", "false").lower() == "true":
                    continue
                name = e.get("Name[de]") or e.get("Name") or did
                seen.add(did)
                apps.append({"id": did, "name": name[:40], "desc": (e.get("Comment[de]") or e.get("Comment") or "")[:80], "builtin": False, "installed": True})
        return apps

    def exec_for(self, app_id):
        if app_id in BUILTIN_APPS:
            return BUILTIN_APPS[app_id]["cmd"], BUILTIN_APPS[app_id]["app_id"]
        for d in self.DIRS:
            f = os.path.join(d, app_id + ".desktop")
            if os.path.exists(f):
                cp = configparser.RawConfigParser(strict=False, interpolation=None)
                cp.read(f, encoding="utf-8")
                line = cp["Desktop Entry"].get("Exec", "")
                line = re.sub(r"\s%[a-zA-Z]", "", line)        # Platzhalter wie %U entfernen
                return shlex.split(line), None
        return None, None

    def launch(self, app_id):
        if not re.match(r"^[\w.-]+$", app_id or ""):
            return {"ok": False, "error": "ungültig"}
        cmd, pattern = self.exec_for(app_id)
        if not cmd:
            return {"ok": False, "error": "Programm nicht gefunden"}
        if not shutil.which(cmd[0]) and not os.path.exists(cmd[0]):
            return {"ok": False, "error": "%s ist nicht installiert" % cmd[0]}
        if self.sway.available:
            self.sway.workspace(3)
            if pattern and self.sway.focus_app(pattern):
                return {"ok": True, "focused": True}
            self.sway.exec(cmd)
        else:
            subprocess.Popen(cmd, start_new_session=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return {"ok": True}


# ==========================================================================
# Abendmodus (wlsunset: wärmere Farben am Abend, über ALLEN Programmen)
# ==========================================================================

class Night:
    def __init__(self, env_fn, log=print):
        self.env_fn = env_fn
        self.log = log
        self.proc = None
        self.key = None

    @property
    def available(self):
        return bool(shutil.which("wlsunset"))

    def apply(self, g):
        """mode: 'aus' | 'auto' (nach Sonnenuntergang am Ort) | 'zeit' (feste Uhrzeiten) | 'immer'"""
        mode = g.get("nightMode", "aus")
        temp = int(g.get("nightTemp", 3800))
        key = json.dumps([mode, temp, g.get("nightFrom"), g.get("nightTo"), round(float(g.get("lat", 0)), 2), round(float(g.get("lon", 0)), 2)])
        if key == self.key and (self.proc is None or self.proc.poll() is None):
            return
        self.key = key
        self.stop()
        if mode == "aus" or not self.available:
            return
        args = ["wlsunset", "-t", str(max(2500, min(6000, temp))), "-T", "6500"]
        if mode == "auto":
            args += ["-l", "%.3f" % float(g.get("lat", 54.3)), "-L", "%.3f" % float(g.get("lon", 10.1))]
        elif mode == "zeit":
            args += ["-S", g.get("nightTo", "06:30"), "-s", g.get("nightFrom", "21:00"), "-d", "1800"]
        else:   # immer: Sonnenuntergang "gerade eben"
            now = time.localtime()
            args += ["-s", "%02d:%02d" % (now.tm_hour, now.tm_min), "-S", "%02d:%02d" % ((now.tm_hour + 23) % 24, now.tm_min), "-d", "60"]
        env = self.env_fn()
        if not env.get("WAYLAND_DISPLAY"):
            return
        try:
            self.proc = subprocess.Popen(args, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception as e:
            self.log("Abendmodus:", e)

    def stop(self):
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()
        self.proc = None


# ==========================================================================
# Bluetooth
# ==========================================================================

class Bluetooth:
    @property
    def available(self):
        return bool(shutil.which("bluetoothctl"))

    def _ctl(self, *args, timeout=8):
        return run(["bluetoothctl"] + list(args), timeout=timeout)

    def status(self):
        if not self.available:
            return {"available": False, "devices": []}
        _, show = self._ctl("show")
        powered = "Powered: yes" in show
        devices = []
        _, out = self._ctl("devices")
        for mac, name in re.findall(r"Device ([0-9A-F:]{17}) (.+)", out):
            _, info = self._ctl("info", mac, timeout=4)
            icon = (re.search(r"Icon: (\S+)", info) or [None, ""])[1] if re.search(r"Icon: (\S+)", info) else ""
            devices.append({"mac": mac, "name": name.strip(), "paired": "Paired: yes" in info,
                            "connected": "Connected: yes" in info, "trusted": "Trusted: yes" in info, "icon": icon})
        return {"available": True, "powered": powered, "adapter": bool(show.strip()) and "No default controller" not in show, "devices": devices}

    def action(self, action, mac=None):
        if mac and not re.match(r"^[0-9A-F:]{17}$", mac):
            return {"ok": False, "error": "ungültig"}
        if action == "power":
            self._ctl("power", "on")
        elif action == "scan":
            self._ctl("power", "on")
            self._ctl("--timeout", "12", "scan", "on", timeout=16)
        elif action == "pair":
            self._ctl("pairable", "on")
            rc, out = self._ctl("pair", mac, timeout=25)
            self._ctl("trust", mac)
            rc2, out2 = self._ctl("connect", mac, timeout=15)
            return {"ok": rc2 == 0 or "Connection successful" in out2, "msg": (out2 or out).strip().splitlines()[-1:] }
        elif action == "connect":
            rc, out = self._ctl("connect", mac, timeout=15)
            return {"ok": "Connection successful" in out or rc == 0, "msg": out.strip().splitlines()[-1:]}
        elif action == "disconnect":
            self._ctl("disconnect", mac)
        elif action == "remove":
            self._ctl("remove", mac)
        return {"ok": True}


# ==========================================================================
# KDE Connect
# ==========================================================================

class KDEConnect:
    """Handy-Verbindung über KDE Connect (App fürs Handy: Play Store / F-Droid).
    Bringt: Medien steuern, Lautstärke, Links teilen, Pause bei Anruf."""

    def __init__(self, on_call, log=print):
        self.on_call = on_call      # Funktion(event) – bei Anruf
        self.log = log
        self._mon = None

    @property
    def available(self):
        return bool(shutil.which("kdeconnect-cli"))

    def devices(self):
        if not self.available:
            return []
        run(["kdeconnect-cli", "--refresh"], timeout=4)
        _, out = run(["kdeconnect-cli", "-l"], timeout=6)
        devs = []
        # Zeilen wie: "- Galaxy S26 Ultra: 1234abcd (paired and reachable)"
        for name, did, state in re.findall(r"^- (.+?): ([\w-]+) \((.+)\)$", out, re.M):
            devs.append({"id": did, "name": name, "paired": "paired" in state and "unpaired" not in state,
                         "reachable": "reachable" in state, "state": state})
        return devs

    def action(self, action, did, url=None):
        if not re.match(r"^[\w-]+$", did or ""):
            return {"ok": False, "error": "ungültig"}
        if action == "pair":
            rc, out = run(["kdeconnect-cli", "--pair", "-d", did], timeout=10)
            self.setup_device(did)
        elif action == "unpair":
            rc, out = run(["kdeconnect-cli", "--unpair", "-d", did], timeout=10)
        elif action == "ping":
            rc, out = run(["kdeconnect-cli", "--ping-msg", "Hallo vom Fernseher", "-d", did], timeout=10)
        elif action == "share" and url:
            rc, out = run(["kdeconnect-cli", "--share", url, "-d", did], timeout=10)
        elif action == "ring":
            rc, out = run(["kdeconnect-cli", "--ring", "-d", did], timeout=10)
        else:
            return {"ok": False}
        return {"ok": rc == 0, "msg": out.strip()[:200]}

    def setup_device(self, did):
        """Nach dem Koppeln: 'Pause bei Anruf' einschalten und Fernseh-Befehle
        anlegen, die man am Handy unter 'Befehle ausführen' antippen kann."""
        base = os.path.expanduser("~/.config/kdeconnect/%s" % did)
        try:
            os.makedirs(os.path.join(base, "kdeconnect_runcommand"), exist_ok=True)
            os.makedirs(os.path.join(base, "kdeconnect_pausemusic"), exist_ok=True)
            cmds = {
                "lichtung-home": {"name": "Fernseher: Startseite", "command": "/opt/lichtung-tv/system/lichtung-ctl home"},
                "lichtung-quick": {"name": "Fernseher: Schnellmenü", "command": "/opt/lichtung-tv/system/lichtung-ctl quick"},
                "lichtung-brave": {"name": "Fernseher: Brave öffnen", "command": "/opt/lichtung-tv/system/lichtung-ctl browser"},
                "lichtung-off": {"name": "Fernseher: Bildschirm aus", "command": "curl -s -X POST -d '{\"on\":false}' http://127.0.0.1:8770/api/screen"},
                "lichtung-on": {"name": "Fernseher: Bildschirm an", "command": "curl -s -X POST -d '{\"on\":true}' http://127.0.0.1:8770/api/screen"},
            }
            with open(os.path.join(base, "kdeconnect_runcommand", "config"), "w") as f:
                f.write("[General]\ncommands=@ByteArray(%s)\n" % json.dumps(cmds).replace("\\", "\\\\"))
            with open(os.path.join(base, "kdeconnect_pausemusic", "config"), "w") as f:
                f.write("[General]\nconditionTalking=false\nactionPause=true\nactionMute=false\n")
            cfg = os.path.join(base, "config")
            cp = configparser.RawConfigParser()
            cp.optionxform = str
            if os.path.exists(cfg):
                cp.read(cfg)
            if not cp.has_section("Plugins"):
                cp.add_section("Plugins")
            for p in ("kdeconnect_pausemusic", "kdeconnect_runcommand", "kdeconnect_mpriscontrol", "kdeconnect_share", "kdeconnect_mousepad", "kdeconnect_remotekeyboard", "kdeconnect_telephony"):
                cp.set("Plugins", p + "Enabled", "true")
            with open(cfg, "w") as f:
                cp.write(f)
        except Exception as e:
            self.log("KDE Connect einrichten:", e)

    def start_call_monitor(self):
        """Hört auf Anruf-Meldungen vom Handy (D-Bus) → Videos pausieren."""
        if self._mon or not shutil.which("dbus-monitor") or not self.available:
            return

        def loop():
            while True:
                try:
                    p = subprocess.Popen(["dbus-monitor", "--session", "type='signal',interface='org.kde.kdeconnect.device.telephony'"],
                                         stdout=subprocess.PIPE, text=True)
                    for line in p.stdout:
                        if "callReceived" in line or "member=callReceived" in line:
                            self.on_call("ringing")
                except Exception as e:
                    self.log("Anruf-Wächter:", e)
                time.sleep(10)
        self._mon = threading.Thread(target=loop, daemon=True)
        self._mon.start()


def pause_all_media():
    """Alles anhalten, was gerade spielt (Brave, Firefox, Spiele …) über MPRIS."""
    if shutil.which("playerctl"):
        run(["playerctl", "-a", "pause"], timeout=4)


def media_playing():
    """Spielt irgendwo ein Video/Ton? (Rückfall, falls die Brave-Erweiterung fehlt)"""
    if not shutil.which("playerctl"):
        return False
    rc, out = run(["playerctl", "-a", "status"], timeout=3)
    return "Playing" in out


# ==========================================================================
# Systeminfo
# ==========================================================================

def _read(path, default=""):
    try:
        with open(path) as f:
            return f.read().strip()
    except Exception:
        return default


def sysinfo(extra=None):
    info = {"host": _read("/etc/hostname", "lichtung")}
    # Temperatur: höchster Wert aller Sensoren
    temps = []
    for z in glob.glob("/sys/class/thermal/thermal_zone*/temp") + glob.glob("/sys/class/hwmon/hwmon*/temp*_input"):
        try:
            v = int(_read(z, "0")) / 1000
            if 5 < v < 120:
                temps.append(v)
        except ValueError:
            pass
    info["temp"] = round(max(temps), 1) if temps else None
    try:
        info["load"] = round(os.getloadavg()[0], 2)
    except OSError:
        info["load"] = None
    info["cpus"] = os.cpu_count()
    mem = dict(re.findall(r"^(\w+):\s+(\d+)", _read("/proc/meminfo"), re.M))
    if mem:
        total, avail = int(mem.get("MemTotal", 0)), int(mem.get("MemAvailable", 0))
        info["mem"] = {"total": round(total / 1048576, 1), "used": round((total - avail) / 1048576, 1)}
    try:
        du = shutil.disk_usage("/")
        info["disk"] = {"total": round(du.total / 1e9), "free": round(du.free / 1e9)}
    except Exception:
        pass
    up = _read("/proc/uptime", "0").split()[0]
    info["uptime"] = int(float(up or 0))
    cpu = re.search(r"model name\s*:\s*(.+)", _read("/proc/cpuinfo"))
    info["cpu"] = cpu.group(1).strip() if cpu else ""
    info["model"] = (_read("/sys/class/dmi/id/sys_vendor") + " " + _read("/sys/class/dmi/id/product_version") or _read("/sys/class/dmi/id/product_name")).strip()
    # WLAN
    rc, out = run(["nmcli", "-t", "-f", "ACTIVE,SSID,SIGNAL", "dev", "wifi"], timeout=4)
    act = [l.split(":") for l in out.splitlines() if l.startswith("yes:")]
    info["wifi"] = {"ssid": act[0][1], "signal": int(act[0][2] or 0)} if act and len(act[0]) >= 3 else None
    rc, out = run(["nmcli", "-t", "-f", "DEVICE,TYPE,STATE", "dev"], timeout=4)
    info["net"] = [l.split(":") for l in out.splitlines() if ":connected" in l]
    info["firefox"] = run(["firefox-esr", "--version"], timeout=5)[1].strip()[:60] if shutil.which("firefox-esr") else ""
    info["brave"] = run([brave_bin(), "--version"], timeout=5)[1].strip()[:60] if brave_bin() else ""
    info["kernel"] = os.uname().release
    info["debian"] = _read("/etc/debian_version")
    if extra:
        info.update(extra)
    return info


# ==========================================================================
# Website-Infos für "Kachel automatisch ausfüllen"
# ==========================================================================

class _Meta:
    def __init__(self, text):
        self.text = text

    def tag(self, pattern):
        m = re.search(pattern, self.text, re.I | re.S)
        return html.unescape(m.group(1)).strip() if m else ""

    def meta(self, key):
        # <meta property="og:title" content="…"> – Reihenfolge der Attribute egal
        for m in re.finditer(r"<meta\s+[^>]*>", self.text, re.I):
            t = m.group(0)
            if re.search(r'(?:property|name|itemprop)\s*=\s*["\']%s["\']' % re.escape(key), t, re.I):
                c = re.search(r'content\s*=\s*["\']([^"\']*)["\']', t, re.I)
                if c:
                    return html.unescape(c.group(1)).strip()
        return ""


def parse_siteinfo(text, url):
    """Aus dem HTML einer Seite: Titel, Name, Beschreibung, Logo, Farbe."""
    m = _Meta(text[:400000])
    title = m.meta("og:site_name") or m.meta("application-name") or m.meta("apple-mobile-web-app-title")
    page_title = m.meta("og:title") or m.tag(r"<title[^>]*>(.*?)</title>")
    host = (urllib.parse.urlparse(url).hostname or "").replace("www.", "")
    if not title:
        # "Startseite | ARD Mediathek" → "ARD Mediathek"
        parts = [p.strip() for p in re.split(r"\s[|–—-]\s", page_title) if p.strip()]
        title = parts[-1] if len(parts) > 1 and len(parts[-1]) < 30 else (parts[0] if parts else host)
    desc = m.meta("og:description") or m.meta("description")
    color = m.meta("theme-color")
    # Logo: bevorzugt große Symbole (apple-touch-icon, 192/512-px-Icons)
    icons = []
    for l in re.finditer(r"<link\s+[^>]*>", text[:400000], re.I):
        t = l.group(0)
        rel = re.search(r'rel\s*=\s*["\']([^"\']+)["\']', t, re.I)
        href = re.search(r'href\s*=\s*["\']([^"\']+)["\']', t, re.I)
        if not rel or not href or "icon" not in rel.group(1).lower():
            continue
        sizes = re.search(r'sizes\s*=\s*["\'](\d+)x', t, re.I)
        size = int(sizes.group(1)) if sizes else (180 if "apple" in rel.group(1).lower() else 32)
        if "mask-icon" in rel.group(1).lower():
            size = 0
        icons.append((size, urllib.parse.urljoin(url, html.unescape(href.group(1)))))
    icons.sort(reverse=True)
    logo = icons[0][1] if icons and icons[0][0] >= 64 else ""
    image = m.meta("og:image")
    if image:
        image = urllib.parse.urljoin(url, image)
    return {"title": title[:40], "pageTitle": page_title[:120], "description": desc[:300],
            "logo": logo, "image": image, "color": color if re.match(r"^#[0-9a-fA-F]{3,8}$", color or "") else "",
            "host": host, "fallbackIcon": "https://icons.duckduckgo.com/ip3/%s.ico" % host}


def siteinfo(url):
    if not re.match(r"^https?://", url or ""):
        url = "https://" + (url or "")
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36",
                                               "Accept-Language": "de-DE,de;q=0.9"})
    try:
        with urllib.request.urlopen(req, timeout=8) as r:
            final = r.geturl()
            text = r.read(600000).decode(r.headers.get_content_charset() or "utf-8", "replace")
    except Exception as e:
        host = (urllib.parse.urlparse(url).hostname or "").replace("www.", "")
        return {"title": host.split(".")[0].capitalize(), "host": host, "url": url, "error": str(e)[:120],
                "fallbackIcon": "https://icons.duckduckgo.com/ip3/%s.ico" % host}
    info = parse_siteinfo(text, final)
    info["url"] = url
    return info


def fetch_image(url, img_dir, max_px=512):
    """Bild (z. B. Logo) herunterladen und lokal speichern → /data/images/…"""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 LichtungTV"})
        with urllib.request.urlopen(req, timeout=8) as r:
            data = r.read(5 * 1024 * 1024)
    except Exception:
        return ""
    name = "logo-" + base64.urlsafe_b64encode(os.urandom(6)).decode().rstrip("=")
    try:
        from PIL import Image
        img = Image.open(io.BytesIO(data))
        img = img.convert("RGBA")
        img.thumbnail((max_px, max_px))
        name += ".png"
        img.save(os.path.join(img_dir, name), "PNG")
    except Exception:
        if data[:4] == b"\x89PNG":
            name += ".png"
        elif data[:5] in (b"<?xml", b"<svg ") or b"<svg" in data[:200]:
            name += ".svg"
        else:
            name += ".jpg"
        with open(os.path.join(img_dir, name), "wb") as f:
            f.write(data)
    return "/data/images/" + name


# ==========================================================================
# Sichern & Wiederherstellen
# ==========================================================================

def backup_zip(data_dir):
    """config.json + alle Bilder als ZIP (Bytes)."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for root, _, files in os.walk(data_dir):
            if "/brave" in root or root.endswith("/brave"):
                continue       # Browser-Daten (Logins) gehören nicht in die Sicherung
            for f in files:
                p = os.path.join(root, f)
                rel = os.path.relpath(p, data_dir)
                if rel.startswith("brave") or f.endswith(".tmp") or f == "github-token":
                    continue
                z.write(p, rel)
        z.writestr("LICHTUNG-BACKUP.txt", "Lichtung TV Sicherung vom %s\n" % time.strftime("%d.%m.%Y %H:%M"))
    return buf.getvalue()


def restore_zip(data, data_dir):
    """Sicherung einspielen. Prüft Inhalt, schreibt nur bekannte Dateien."""
    z = zipfile.ZipFile(io.BytesIO(data))
    names = z.namelist()
    if "config.json" not in names:
        raise ValueError("Keine Lichtung-Sicherung (config.json fehlt)")
    json.loads(z.read("config.json").decode("utf-8"))     # muss gültiges JSON sein
    for n in names:
        if n.startswith("/") or ".." in n:
            continue
        if n == "config.json" or n.startswith("images/") or n == "epg-cache.json":
            target = os.path.join(data_dir, n)
            os.makedirs(os.path.dirname(target), exist_ok=True)
            with open(target, "wb") as f:
                f.write(z.read(n))
    return True


# ==========================================================================
# Updates
# ==========================================================================

class Updater:
    REPO = "christianbom2007-lgtm/TV-Linux-"
    UPD_DIR = "/var/tmp/lichtung-update"

    def __init__(self, data_dir, app_dir, log=print):
        self.data_dir = data_dir
        self.app_dir = app_dir
        self.log = log
        self.token_path = os.path.join(data_dir, "github-token")
        self.last_check = {}

    def installed(self):
        try:
            with open(os.path.join(self.app_dir, "VERSION")) as f:
                return json.load(f)
        except Exception:
            return {"version": "?", "commit": ""}

    def token(self):
        try:
            with open(self.token_path) as f:
                return f.read().strip()
        except Exception:
            return ""

    def set_token(self, token):
        token = (token or "").strip()
        if token and not re.match(r"^[\w-]{20,255}$", token):
            raise ValueError("Das sieht nicht nach einem GitHub-Token aus")
        if not token:
            if os.path.exists(self.token_path):
                os.remove(self.token_path)
            return
        with open(self.token_path, "w") as f:
            f.write(token)
        os.chmod(self.token_path, 0o600)

    def _req(self, url, raw=False):
        h = {"User-Agent": "LichtungTV", "Accept": "application/vnd.github+json"}
        if self.token():
            h["Authorization"] = "Bearer " + self.token()
        return urllib.request.Request(url, headers=h)

    def latest_release(self):
        """Neuestes Release auf GitHub. Releases entstehen nur, wenn alle Tests
        bestanden haben (siehe .github/workflows/iso.yml) – ungetestete
        Zwischenstände auf main kommen so nie auf den Fernseher."""
        with urllib.request.urlopen(self._req("https://api.github.com/repos/%s/releases/latest" % self.REPO), timeout=15) as r:
            rel = json.loads(r.read().decode())
        assets = {a.get("name"): a.get("browser_download_url") for a in rel.get("assets", [])}
        return {"tag": rel.get("tag_name", ""), "title": rel.get("name") or rel.get("tag_name", ""),
                "date": rel.get("published_at", ""), "package": assets.get("lichtung-tv.tar.gz"),
                "sha256": assets.get("lichtung-tv.tar.gz.sha256")}

    @staticmethod
    def is_newer(tag, installed_release):
        """Release-Namen sind iso-JJJJMMTT-HHMM, also nach Zeit sortierbar.
        Ohne gespeichertes Release (Installation von einer alten ISO) gilt
        jedes Release als neu, damit der Laptop einmal auf Stand kommt."""
        if not tag:
            return False
        if not installed_release:
            return True
        return tag > installed_release

    def check(self):
        """Gibt es ein neueres getestetes Release als das installierte?"""
        try:
            rel = self.latest_release()
            inst = self.installed().get("release", "")
            res = {"ok": True, "latest": rel["tag"], "message": rel["title"], "date": rel["date"],
                   "installed": inst, "newer": self.is_newer(rel["tag"], inst) and bool(rel["package"])}
            if not rel["package"]:
                res["hint"] = "Dieses Release enthält noch kein Update-Paket."
            self.last_check = dict(res, time=time.time())
            return res
        except urllib.error.HTTPError as e:
            hint = "Repo nicht erreichbar oder privat – GitHub-Zugang (Token) hinterlegen oder Paket per Handy hochladen." if e.code in (401, 403, 404) else ""
            return {"ok": False, "error": "GitHub antwortet %d" % e.code, "hint": hint}
        except Exception as e:
            return {"ok": False, "error": "Kein Internet? %s" % str(e)[:80]}

    def _prepare_dir(self):
        os.makedirs(self.UPD_DIR, exist_ok=True)
        try:
            os.chmod(self.UPD_DIR, 0o755)
        except OSError:
            pass

    def _download(self, url, path):
        with urllib.request.urlopen(self._req(url), timeout=300) as r, open(path, "wb") as f:
            shutil.copyfileobj(r, f)

    def from_github(self):
        """Neuestes Release laden, Prüfsumme kontrollieren, einspielen."""
        self._prepare_dir()
        try:
            rel = self.latest_release()
        except Exception as e:
            return {"ok": False, "error": "GitHub nicht erreichbar: %s" % str(e)[:100]}
        if not rel["package"]:
            return {"ok": False, "error": "Das neueste Release hat kein Update-Paket"}
        path = os.path.join(self.UPD_DIR, "lichtung-%s.tar.gz" % re.sub(r"[^\w.-]", "", rel["tag"]))
        try:
            self._download(rel["package"], path)
            if rel["sha256"]:
                sums = os.path.join(self.UPD_DIR, "lichtung.sha256")
                self._download(rel["sha256"], sums)
                with open(sums) as f:
                    expected = f.read().split()[0].lower()
                h = hashlib.sha256()
                with open(path, "rb") as f:
                    for block in iter(lambda: f.read(1 << 20), b""):
                        h.update(block)
                if h.hexdigest() != expected:
                    os.remove(path)
                    return {"ok": False, "error": "Prüfsumme stimmt nicht – Update abgebrochen"}
        except Exception as e:
            return {"ok": False, "error": "Download fehlgeschlagen: %s" % str(e)[:100]}
        return self.install(path)

    def from_upload(self, data):
        self._prepare_dir()
        if not (data[:2] == b"PK" or data[:2] == b"\x1f\x8b"):
            return {"ok": False, "error": "Bitte die ZIP- oder .tar.gz-Datei von GitHub hochladen"}
        path = os.path.join(self.UPD_DIR, "lichtung-upload" + (".zip" if data[:2] == b"PK" else ".tar.gz"))
        with open(path, "wb") as f:
            f.write(data)
        return self.install(path)

    def install(self, path):
        rc, out = admin("update", path, timeout=30)
        return {"ok": rc == 0, "msg": out.strip()[-300:]}

    def status(self):
        return admin("update-status", timeout=5)[1].strip()


# ==========================================================================
# Musikbox: der Fernseher wird zum Bluetooth-Lautsprecher
# ==========================================================================

class MusicBox:
    """Handy verbindet sich per Bluetooth mit "Lichtung Musik" und spielt
    Musik über die Fernseh-Lautsprecher. Der Bildschirm zeigt Titel, Künstler
    und Fortschritt; Steuern geht per Fernbedienung (über MPRIS/playerctl).
    Ein iPhone geht auch per AirPlay (UxPlay spielt Ton ebenfalls ab)."""

    def __init__(self, log=print):
        self.log = log
        self.agent = None
        self.proxy = None
        self.on = False

    @property
    def available(self):
        return bool(shutil.which("bluetoothctl"))

    def start(self, name="Lichtung Musik"):
        if not self.available:
            return {"ok": False, "error": "Bluetooth ist nicht installiert"}
        for cmd in (["power", "on"], ["system-alias", name], ["discoverable-timeout", "0"], ["discoverable", "on"], ["pairable", "on"]):
            run(["bluetoothctl"] + cmd, timeout=6)
        # Automatisch koppeln ohne PIN-Abfrage (wie ein echter Lautsprecher)
        if shutil.which("bt-agent") and not (self.agent and self.agent.poll() is None):
            self.agent = subprocess.Popen(["bt-agent", "-c", "NoInputNoOutput"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        # Titel/Künstler vom Handy als MPRIS-Player sichtbar machen
        if shutil.which("mpris-proxy") and not (self.proxy and self.proxy.poll() is None):
            self.proxy = subprocess.Popen(["mpris-proxy"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.on = True
        return {"ok": True}

    def stop(self):
        run(["bluetoothctl", "discoverable", "off"], timeout=5)
        run(["bluetoothctl", "system-alias", "lichtung"], timeout=5)
        for p in (self.agent, self.proxy):
            if p and p.poll() is None:
                p.terminate()
        self.agent = self.proxy = None
        self.on = False
        return {"ok": True}

    def status(self):
        info = {"on": self.on, "available": self.available, "playing": False}
        if not shutil.which("playerctl"):
            return info
        rc, players = run(["playerctl", "-l"], timeout=3)
        names = [p.strip() for p in players.splitlines() if p.strip()]
        # Bluetooth-Handy bevorzugen, sonst irgendein Player (z. B. AirPlay)
        pick = next((p for p in names if "bluez" in p.lower()), None) or next((p for p in names if not re.search(r"firefox|brave|chromium", p, re.I)), None)
        if not pick:
            return info
        fmt = "{{status}}\t{{artist}}\t{{title}}\t{{album}}\t{{mpris:length}}\t{{position}}\t{{mpris:artUrl}}"
        rc, out = run(["playerctl", "-p", pick, "metadata", "--format", fmt], timeout=3)
        parts = (out.strip().split("\t") + [""] * 7)[:7]
        st, artist, title, album, length, pos, art = parts
        def num(x):
            try:
                return int(x) / 1e6
            except ValueError:
                return 0
        info.update(player=pick, status=st, playing=st == "Playing", artist=artist, title=title, album=album,
                    length=num(length), position=num(pos), art=art if art.startswith("http") else "")
        return info

    def control(self, action):
        if action not in ("play-pause", "next", "previous", "play", "pause"):
            return {"ok": False}
        st = self.status()
        if not st.get("player"):
            return {"ok": False, "error": "Kein Handy verbunden"}
        run(["playerctl", "-p", st["player"], action], timeout=3)
        return {"ok": True}


# ==========================================================================
# Mediathek-Rekorder: Sendungen automatisch herunterladen
# ==========================================================================

class Recorder:
    """Regeln wie "jeder neue Tatort" oder "Terra X". Einmal pro Stunde wird in
    der Mediathek nachgesehen; neue Folgen werden heruntergeladen und sind
    dann offline und ruckelfrei abspielbar. Alte Aufnahmen werden nach der
    eingestellten Zeit automatisch gelöscht."""

    def __init__(self, rec_dir, get_config, save_config, query_fn, broadcast, log=print):
        self.dir = rec_dir
        self.get_config = get_config
        self.save_config = save_config
        self.query = query_fn                  # extras.mediathek_row
        self.broadcast = broadcast
        self.log = log
        self.busy = None                       # gerade laufender Download
        self.progress = 0
        os.makedirs(self.dir, exist_ok=True)
        self._t = None

    def index_path(self):
        return os.path.join(self.dir, "aufnahmen.json")

    def load(self):
        try:
            with open(self.index_path()) as f:
                return json.load(f)
        except Exception:
            return []

    def store(self, items):
        tmp = self.index_path() + ".tmp"
        with open(tmp, "w") as f:
            json.dump(items, f, ensure_ascii=False, indent=1)
        os.replace(tmp, self.index_path())

    def list(self):
        items = [i for i in self.load() if os.path.exists(os.path.join(self.dir, i["file"]))]
        return sorted(items, key=lambda i: -i.get("recorded", 0))

    def free_gb(self):
        try:
            return shutil.disk_usage(self.dir).free / 1e9
        except Exception:
            return 0

    def start(self):
        if self._t:
            return

        def loop():
            time.sleep(60)
            while True:
                try:
                    self.tick()
                except Exception as e:
                    self.log("Rekorder:", e)
                time.sleep(3600)
        self._t = threading.Thread(target=loop, daemon=True)
        self._t.start()

    def tick(self):
        cfg = self.get_config().get("recorder") or {}
        if not cfg.get("on"):
            return
        keep_days = int(cfg.get("keepDays", 14))
        items = self.load()
        # Alte Aufnahmen löschen
        now = time.time()
        for it in list(items):
            if keep_days and now - it.get("recorded", now) > keep_days * 86400 and not it.get("keep"):
                self.delete(it["id"], items)
        for rule in cfg.get("rules", []):
            if not rule.get("on", True):
                continue
            found = self.query({"topic": rule.get("topic", ""), "text": rule.get("text", ""), "channels": rule.get("channels") or [],
                                "minMinutes": int(rule.get("minMinutes") or 10), "size": 10}, True) or []
            have = {i["id"] for i in items}
            for e in found[: int(rule.get("max", 2))]:
                if e["id"] in have or not e.get("url"):
                    continue
                if now - e.get("timestamp", now) > 7 * 86400:
                    continue     # nur Neues der letzten Woche
                if self.free_gb() < float(cfg.get("minFreeGB", 5)):
                    self.log("Rekorder: zu wenig Speicher frei")
                    return
                self.download(e, rule, items)

    def download(self, e, rule, items):
        url = e["url"] if self.get_config().get("recorder", {}).get("quality", "hd") == "hd" else (e.get("urlSd") or e["url"])
        safe = re.sub(r"[^\w-]+", "-", "%s-%s" % (e.get("topic", ""), e.get("title", "")))[:80].strip("-") or "aufnahme"
        name = "%s-%s.mp4" % (time.strftime("%Y%m%d", time.localtime(e.get("timestamp") or time.time())), safe)
        path = os.path.join(self.dir, name)
        self.busy = e.get("title")
        self.progress = 0
        self.log("Rekorder lädt:", e.get("title"))
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "LichtungTV/2"})
            with urllib.request.urlopen(req, timeout=30) as r, open(path + ".part", "wb") as f:
                total = int(r.headers.get("Content-Length") or 0)
                done = 0
                while True:
                    chunk = r.read(1 << 20)
                    if not chunk:
                        break
                    f.write(chunk)
                    done += len(chunk)
                    self.progress = round(done / total * 100) if total else 0
            os.replace(path + ".part", path)
            items.append({"id": e["id"], "file": name, "title": e.get("title"), "topic": e.get("topic"), "channel": e.get("channel"),
                          "duration": e.get("duration"), "description": e.get("description", ""), "timestamp": e.get("timestamp"),
                          "hue": e.get("hue", 160), "recorded": time.time(), "rule": rule.get("id"), "size": os.path.getsize(path)})
            self.store(items)
            self.broadcast("recorded", title=e.get("title"))
        except Exception as ex:
            self.log("Rekorder: Download fehlgeschlagen", ex)
            try:
                os.remove(path + ".part")
            except OSError:
                pass
        finally:
            self.busy = None

    def delete(self, rid, items=None):
        own = items is None
        items = self.load() if own else items
        for it in list(items):
            if it["id"] == rid:
                try:
                    os.remove(os.path.join(self.dir, it["file"]))
                except OSError:
                    pass
                items.remove(it)
        self.store(items)
        return {"ok": True}


# ==========================================================================
# Live-Systemwerte für die Startseite (CPU, RAM, Temperatur, Netz)
# ==========================================================================

class Stats:
    def __init__(self):
        self.prev = None

    @staticmethod
    def _cpu():
        f = _read("/proc/stat").splitlines()
        if not f:
            return 0, 0
        v = [int(x) for x in f[0].split()[1:]]
        idle = v[3] + (v[4] if len(v) > 4 else 0)
        return sum(v), idle

    @staticmethod
    def _net():
        rx = tx = 0
        for line in _read("/proc/net/dev").splitlines()[2:]:
            name, _, data = line.partition(":")
            if name.strip() == "lo" or not data:
                continue
            d = data.split()
            rx += int(d[0]); tx += int(d[8])
        return rx, tx

    def sample(self):
        now = time.time()
        tot, idle = self._cpu()
        rx, tx = self._net()
        out = {"cpu": None, "down": 0, "up": 0}
        if self.prev:
            pt, pt_tot, pt_idle, prx, ptx = self.prev
            dt = max(0.1, now - pt)
            if tot - pt_tot > 0:
                out["cpu"] = round(100 * (1 - (idle - pt_idle) / (tot - pt_tot)))
            out["down"] = max(0, round((rx - prx) / dt))
            out["up"] = max(0, round((tx - ptx) / dt))
        self.prev = (now, tot, idle, rx, tx)
        mem = dict(re.findall(r"^(\w+):\s+(\d+)", _read("/proc/meminfo"), re.M))
        if mem:
            t, a = int(mem.get("MemTotal", 0)), int(mem.get("MemAvailable", 0))
            out["mem"] = round((t - a) / 1048576, 1)
            out["memTotal"] = round(t / 1048576, 1)
        temps = []
        for z in glob.glob("/sys/class/thermal/thermal_zone*/temp"):
            try:
                v = int(_read(z, "0")) / 1000
                if 5 < v < 120:
                    temps.append(v)
            except ValueError:
                pass
        out["temp"] = round(max(temps)) if temps else None
        return out
