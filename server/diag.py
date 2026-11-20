"""Lichtung TV – Fehlersuche nach Themen (Einstellungen → Fehlersuche).

Jede Prüfung liefert: Name, Zustand (ok / warn / fail), eine kurze Erklärung
und – wo möglich – eine Reparatur ("fix"), die die Oberfläche als Knopf zeigt.
Die Prüfungen ändern nichts am System; nur die Reparatur-Knöpfe tun etwas.
"""
import json
import os
import re
import shutil
import socket
import subprocess
import time
import urllib.request

TOPICS = [
    ("ton", "Ton"), ("internet", "Internet & WLAN"), ("bluetooth", "Bluetooth & Musikbox"),
    ("brave", "Brave & Kacheln"), ("updates", "Updates"), ("system", "System"),
]


def run(cmd, timeout=8):
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return r.returncode, (r.stdout or "") + (r.stderr or "")
    except Exception as e:
        return 127, str(e)


def item(name, ok, detail="", fix=None, warn=False):
    return {"name": name, "state": "ok" if ok else ("warn" if warn else "fail"), "detail": detail, "fix": fix}


def user_active(unit):
    return run(["systemctl", "--user", "is-active", unit])[1].strip() == "active"


def http_ok(url, timeout=6):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "LichtungTV-Diagnose"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status < 400
    except Exception:
        return False


# ---------------------------------------------------------------- Themen
def check_ton(ctx):
    audio = ctx["audio"]
    out = []
    out.append(item("Ton-System (PipeWire) läuft", user_active("pipewire.service"), fix="audio-repair"))
    out.append(item("Ton-Verwaltung (WirePlumber) läuft", user_active("wireplumber.service"), fix="audio-repair"))
    old = os.path.exists(audio.OLD_CONF)
    out.append(item("Keine fehlerhafte Klang-Datei von früher", not old,
                    "Datei aus einer älteren Lichtung-Version – kann den Ton blockieren" if old else "", fix="audio-repair" if old else None))
    lst = audio.sinks()
    hw = audio.hardware(lst)
    out.append(item("Ausgänge gefunden", bool(hw), ", ".join(s["description"] for s in hw)[:160] or "keine", fix=None if hw else "audio-repair"))
    tv = audio.tv_sinks(lst)
    out.append(item("Fernseher/Monitor (HDMI)", bool(tv), tv[0]["description"] if tv else "kein HDMI-Ausgang"))
    lap = audio.laptop_candidates(lst)
    s = ctx["audio_settings"]
    confirmed = bool(s.get("speakerSink"))
    out.append(item("Laptop-Lautsprecher", confirmed,
                    ("bestätigt: " + s["speakerSink"]) if confirmed else
                    ("möglicher Ausgang: %s – noch nicht bestätigt" % lap[0]["description"] if lap else "kein Laptop-Ausgang gefunden"),
                    fix=None if confirmed else "audio-wizard", warn=not confirmed))
    rc, _ = run(["dpkg", "-s", "firmware-sof-signed"])
    out.append(item("Treiber-Datei für Laptop-Ton (SOF)", rc == 0, "" if rc == 0 else "Update einspielen", warn=rc != 0))
    names = {x["name"] for x in lst}
    if s.get("output") == "beide":
        out.append(item("Laptop + Fernseher gleichzeitig", audio.COMBINE in names, "" if audio.COMBINE in names else "nicht aktiv", fix="audio-apply", warn=True))
    if s.get("klang") in audio.PRESETS:
        out.append(item("Klangregelung „%s“" % audio.PRESETS[s["klang"]]["title"], ctx["eq_running"],
                        "" if ctx["eq_running"] else "läuft nicht – Ton geht direkt raus", fix="audio-apply", warn=True))
    rc, default = run(["pactl", "get-default-sink"])
    out.append(item("Standard-Ausgang", rc == 0 and bool(default.strip()), default.strip()[:120]))
    if os.path.exists(audio.LEGACY_FLAG):
        out.append(item("Älterer Soundtreiber aktiv", True, "vom Ton-Assistenten eingeschaltet", fix="audio-sof", warn=True))
    return out


def check_internet(ctx):
    out = []
    ip = ctx["lan_ip"]()
    out.append(item("Netzwerk-Adresse", bool(ip) and not ip.startswith("127."), ip or "keine"))
    try:
        socket.getaddrinfo("deb.debian.org", 443)
        dns = True
    except OSError:
        dns = False
    out.append(item("Namensauflösung (DNS)", dns, "" if dns else "Router/WLAN prüfen"))
    out.append(item("Internet erreichbar", http_ok("https://www.google.com/generate_204") or http_ok("https://deb.debian.org/"), ""))
    out.append(item("YouTube erreichbar", http_ok("https://www.youtube.com/"), ""))
    out.append(item("ARD-Mediathek erreichbar", http_ok("https://www.ardmediathek.de/"), ""))
    rc, o = run(["nmcli", "-t", "-f", "ACTIVE,SSID,SIGNAL", "dev", "wifi"])
    act = [l for l in o.splitlines() if l.startswith("yes:")] if rc == 0 else []
    if act:
        parts = act[0].split(":")
        sig = int(parts[-1] or 0)
        out.append(item("WLAN-Signal", sig >= 40, "%s %%" % sig, warn=True))
    return out


def check_bluetooth(ctx):
    out = []
    chips = os.listdir("/sys/class/bluetooth") if os.path.isdir("/sys/class/bluetooth") else []
    out.append(item("Bluetooth-Chip", bool(chips), " ".join(chips) or "keiner erkannt"))
    blocked = []
    for r in (os.listdir("/sys/class/rfkill") if os.path.isdir("/sys/class/rfkill") else []):
        try:
            base = "/sys/class/rfkill/" + r
            if open(base + "/type").read().strip() == "bluetooth" and open(base + "/soft").read().strip() == "1":
                blocked.append(open(base + "/name").read().strip())
        except OSError:
            pass
    out.append(item("Keine Funk-Sperre", not blocked, ", ".join(blocked)))
    act = run(["systemctl", "is-active", "bluetooth"])[1].strip() == "active"
    out.append(item("Bluetooth-Dienst läuft", act))
    rc, o = run(["bluetoothctl", "show"])
    out.append(item("Bluetooth eingeschaltet", "Powered: yes" in o, "", fix="bt-power"))
    return out


def check_brave(ctx):
    out = []
    out.append(item("Brave installiert", bool(shutil.which("brave-browser") or shutil.which("brave-browser-stable"))))
    out.append(item("Fenster-Verwaltung (sway) erreichbar", ctx["sway_ok"]))
    ext = os.path.join(ctx["app_dir"], "brave-extension", "manifest.json")
    out.append(item("Lichtung-Erweiterung vorhanden", os.path.exists(ext), "für Weiterschauen und Werbefilter"))
    out.append(item("Logos/Vorschaubilder gespeichert", True, "%d Bilder" % len([f for f in os.listdir(ctx["img_dir"]) if f.startswith(("logo-", "thumb-"))]) if os.path.isdir(ctx["img_dir"]) else "0 Bilder"))
    return out


def check_updates(ctx):
    up = ctx["updater"]
    inst = up.installed()
    out = [item("Installierte Version", True, inst.get("release") or inst.get("version", "?"))]
    last = getattr(up, "last_check", {}) or {}
    if last:
        out.append(item("Neuere Version", not last.get("newer"), ("verfügbar: " + last.get("latest", "")) if last.get("newer") else "aktuell", fix="update-check", warn=True))
    out.append(item("GitHub erreichbar", http_ok("https://api.github.com/"), "", fix="update-check"))
    out.append(item("Automatische Updates", ctx["auto_update"], "nachts 3–5 Uhr" if ctx["auto_update"] else "aus", warn=True))
    return out


def check_system(ctx):
    out = []
    st = os.statvfs("/")
    free = st.f_bavail * st.f_frsize / 1e9
    out.append(item("Freier Speicher", free > 5, "%.0f GB frei" % free, warn=free > 1))
    try:
        mem = dict(re.findall(r"^(\w+):\s+(\d+)", open("/proc/meminfo").read(), re.M))
        avail = int(mem.get("MemAvailable", 0)) / 1e6
        out.append(item("Freier Arbeitsspeicher", avail > 0.8, "%.1f GB" % avail, warn=True))
    except OSError:
        pass
    temps = []
    for z in (os.listdir("/sys/class/thermal") if os.path.isdir("/sys/class/thermal") else []):
        try:
            temps.append(int(open("/sys/class/thermal/%s/temp" % z).read()) / 1000)
        except (OSError, ValueError):
            pass
    if temps:
        t = max(temps)
        out.append(item("Temperatur", t < 85, "%.0f °C" % t, warn=t < 95))
    try:
        up = float(open("/proc/uptime").read().split()[0])
        out.append(item("Läuft seit", True, "%d Std. %d Min." % (up // 3600, up % 3600 // 60)))
    except OSError:
        pass
    return out


CHECKS = {"ton": check_ton, "internet": check_internet, "bluetooth": check_bluetooth,
          "brave": check_brave, "updates": check_updates, "system": check_system}


def run_topic(topic, ctx):
    fn = CHECKS.get(topic)
    if not fn:
        return []
    try:
        return fn(ctx)
    except Exception as e:      # eine kaputte Prüfung soll nie die ganze Seite sprengen
        return [item("Prüfung selbst fehlgeschlagen", False, str(e)[:160])]
