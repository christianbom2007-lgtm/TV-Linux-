"""Lichtung TV – Ton: Reparatur beim Start, Klang, Laptop + Fernseher, Ton-Assistent.

Grundsatz: Die zentrale Konfiguration des Ton-Systems (PipeWire) wird NICHT
verändert. Alles Zusätzliche läuft nebenher und lässt sich jederzeit abschalten:

  • "Laptop + Fernseher": ein Kombi-Ausgang, zur Laufzeit geladen
    (pactl load-module module-combine-sink). Klappt das nicht, passiert nichts.
  • Klangregelung: ein eigenes kleines PipeWire-Programm (pipewire -c eq.conf)
    mit einem Filter. Stürzt es ab, läuft der Ton direkt weiter.
  • Start-Reparatur: findet das Ton-System keine Ausgänge, wird Schritt für
    Schritt repariert (alte Lichtung-Datei weg, neu starten, Zustand löschen).

Der Ton-Assistent probiert nacheinander Wege aus, die Laptop-Lautsprecher zum
Laufen zu bringen, spielt jeweils einen Testton und fragt: "Hörst du ihn?"
Ob wirklich Ton aus dem Laptop kommt, kann kein Programm messen – nur du.
"""
import json
import math
import os
import re
import shutil
import struct
import subprocess
import time
import wave

HOME = os.path.expanduser("~")
OLD_CONF = os.path.join(HOME, ".config/pipewire/pipewire.conf.d/60-lichtung-klang.conf")   # Altlast (vor 20.11. 21 Uhr)
NOUCM_RULE = os.path.join(HOME, ".config/wireplumber/wireplumber.conf.d/52-lichtung-noucm.conf")
WP_STATE = os.path.join(HOME, ".local/state/wireplumber")
EQ_CONF = os.path.join(HOME, ".config/lichtung/eq.conf")
LEGACY_FLAG = "/etc/modprobe.d/lichtung-audio.conf"
COMBINE, EQ = "lichtung_doppelt", "lichtung_klang"

PRESETS = {   # Vorverstärker, Bass (Hz, dB), Mitten (Hz, Güte, dB), Höhen (Hz, dB)
    "neutral": {"title": "Neutral", "pre": 1.0, "low": (150, 0.0), "mid": (3000, 1.0, 0.0), "high": (9000, 0.0)},
    "warm":    {"title": "Warm", "pre": 0.75, "low": (180, 5.0), "mid": (3000, 1.2, -4.0), "high": (8000, -2.0)},
    "klar":    {"title": "Sprache klar", "pre": 0.85, "low": (150, -3.0), "mid": (2500, 1.0, 3.0), "high": (9000, 0.0)},
    "bass":    {"title": "Mehr Bass", "pre": 0.6, "low": (120, 8.0), "mid": (3000, 1.0, -2.0), "high": (10000, 1.0)},
}
DEFAULTS = {"klang": "warm", "output": "auto", "sink": "", "speakerSink": "", "strategy": ""}
AUDIO_REV = 2   # 2 = "Automatisch" eingeführt (Musikanlage am Monitor, 23.11.2026)


def migrate(a):
    """Alte Einstellungen einmalig auf "Automatisch" umstellen. True = geändert."""
    if (a or {}).get("rev", 0) >= AUDIO_REV:
        return False
    a["output"], a["rev"] = "auto", AUDIO_REV
    return True


STRATEGIES = [
    ("mixer", "Lautsprecher im Mischpult freigeben"),
    ("noucm", "Andere Geräte-Erkennung (ohne UCM-Profile)"),
    ("legacy", "Älteren Soundtreiber verwenden (Neustart nötig)"),
]


def run(cmd, timeout=10):
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return r.returncode, r.stdout
    except Exception as e:
        return 1, str(e)


# ---------------------------------------------------------------- Ausgänge
def sinks():
    """Alle Ausgänge mit Name, Beschreibung, HDMI ja/nein und ob verbunden."""
    rc, out = run(["pactl", "-f", "json", "list", "sinks"])
    res = []
    if rc == 0:
        try:
            for s in json.loads(out or "[]"):
                ports = s.get("ports") or []
                act = next((p for p in ports if p.get("name") == s.get("active_port")), {})
                res.append({"name": s.get("name", ""), "description": s.get("description", ""),
                            "hdmi": "hdmi" in s.get("name", "").lower(),
                            "usb": ".usb-" in s.get("name", "").lower() or "usb" in s.get("description", "").lower(),
                            "available": act.get("availability", "unknown") != "not available",
                            "ports": [p.get("name") for p in ports]})
            return res
        except ValueError:
            pass
    rc, out = run(["pactl", "list", "short", "sinks"])     # ältere pactl ohne JSON
    for line in (out or "").splitlines() if rc == 0 else []:
        parts = line.split("\t")
        if len(parts) > 1:
            res.append({"name": parts[1], "description": parts[1], "hdmi": "hdmi" in parts[1].lower(), "usb": ".usb-" in parts[1].lower(),
                        "available": True, "ports": []})
    return res


def hardware(lst):
    return [s for s in lst if s["name"].startswith("alsa_output")]


def laptop_candidates(lst):
    """Mögliche Laptop-Ausgänge, beste zuerst: Speaker > Headphones > analog > sonstige."""
    hw = [s for s in hardware(lst) if not s["hdmi"] and not s.get("usb")]
    rank = lambda s: (0 if "speaker" in s["name"].lower() else 1 if "headphone" in s["name"].lower() else 2 if "analog" in s["name"].lower() else 3)
    return sorted(hw, key=rank)


def tv_sinks(lst):
    hd = [s for s in hardware(lst) if s["hdmi"]]
    return [s for s in hd if s["available"]] or hd


def hdmi_connected(lst):
    """Nur HDMI-Ausgänge, an denen wirklich etwas hängt (Monitor an, Kabel steckt)."""
    return [s for s in hardware(lst) if s["hdmi"] and s["available"]]


def usb_sinks(lst):
    """USB-Tongeräte (z. B. Musikanlage mit USB-Eingang, USB-Soundkarte)."""
    return [s for s in hardware(lst) if s.get("usb")]


def plugged(lst):
    """Was gerade steckt – ändert sich das, schaltet "Automatisch" um."""
    return [x["name"] for x in usb_sinks(lst)] + [x["name"] for x in hdmi_connected(lst)]


def wait_sinks(seconds=12, name=None):
    end = time.time() + seconds
    while time.time() < end:
        lst = sinks()
        if (name and any(s["name"] == name for s in lst)) or (not name and hardware(lst)):
            return lst
        time.sleep(1)
    return None


def restart_stack():
    run(["systemctl", "--user", "restart", "pipewire.service", "pipewire-pulse.service", "wireplumber.service"], timeout=25)


def unmute_speakers():
    """Laptop-Lautsprecher im Mischpult der Soundkarte einschalten (bei manchen Lenovo stumm)."""
    try:
        cards = re.findall(r"^\s*(\d+)\s", open("/proc/asound/cards").read(), re.M)
    except OSError:
        cards = []
    for c in cards:
        for ctl in ("Master", "Speaker", "Headphone", "PCM"):
            run(["amixer", "-q", "-c", c, "sset", ctl, "100%", "unmute"], timeout=5)
        run(["amixer", "-q", "-c", c, "sset", "Auto-Mute Mode", "Disabled"], timeout=5)
    return bool(cards)


def repair_basic(log=print):
    """Ton-System reparieren, bis es wieder Ausgänge meldet. Gibt eine Liste
    der ausgeführten Schritte zurück (für die Fehlersuche)."""
    steps = []
    if os.path.exists(OLD_CONF):
        os.remove(OLD_CONF)
        restart_stack()
        steps.append("Alte Klang-Datei entfernt, Ton-System neu gestartet")
    if wait_sinks(8):
        return steps + ["Ausgänge vorhanden ✓"]
    restart_stack()
    steps.append("Ton-System neu gestartet")
    if wait_sinks(10):
        return steps + ["Ausgänge vorhanden ✓"]
    if os.path.isdir(WP_STATE):
        shutil.rmtree(WP_STATE, ignore_errors=True)      # gespeicherte (evtl. kaputte) Profile vergessen
        restart_stack()
        steps.append("Gespeicherte Ton-Profile zurückgesetzt")
        if wait_sinks(10):
            return steps + ["Ausgänge vorhanden ✓"]
    if os.path.exists(NOUCM_RULE):
        os.remove(NOUCM_RULE)
        restart_stack()
        steps.append("Regel 'ohne UCM' entfernt")
        if wait_sinks(10):
            return steps + ["Ausgänge vorhanden ✓"]
    log("Ton-Reparatur ohne Erfolg:", steps)
    return steps + ["Keine Ausgänge – Soundkarte/Treiber prüfen (Fehlersuche → Ton)"]


# ---------------------------------------------------------------- Kombi-Ausgang
def unload_combine():
    rc, out = run(["pactl", "list", "short", "modules"])
    for line in (out or "").splitlines():
        if "module-combine-sink" in line and COMBINE in line:
            run(["pactl", "unload-module", line.split("\t")[0]])


def load_combine(slaves):
    unload_combine()
    if len(slaves) < 2:
        return False
    rc, _ = run(["pactl", "load-module", "module-combine-sink", "sink_name=" + COMBINE,
                 "slaves=" + ",".join(slaves), "sink_properties=device.description=Laptop+Fernseher"])
    return rc == 0 and bool(wait_sinks(5, COMBINE))


# ---------------------------------------------------------------- Klangregelung (eigener Prozess)
def eq_conf(preset, target):
    p = PRESETS[preset]
    tgt = re.sub(r"[^\w.:\-]", "", target or "")
    return """# Lichtung TV – Klangregelung (eigener PipeWire-Prozess, automatisch erzeugt)
context.properties = { log.level = 0 }
context.spa-libs = {
  audio.convert.* = audioconvert/libspa-audioconvert
  support.*       = support/libspa-support
}
context.modules = [
  { name = libpipewire-module-rt args = { nice.level = -11 } flags = [ ifexists nofail ] }
  { name = libpipewire-module-protocol-native }
  { name = libpipewire-module-client-node }
  { name = libpipewire-module-adapter }
  { name = libpipewire-module-filter-chain
    args = {
      node.description = "Lichtung Klang"
      media.name = "Lichtung Klang"
      filter.graph = {
        nodes = [
          { type = builtin name = pre  label = mixer        control = { "Gain 1" = %.2f } }
          { type = builtin name = low  label = bq_lowshelf  control = { "Freq" = %.1f "Q" = 0.7 "Gain" = %.1f } }
          { type = builtin name = mid  label = bq_peaking   control = { "Freq" = %.1f "Q" = %.2f "Gain" = %.1f } }
          { type = builtin name = high label = bq_highshelf control = { "Freq" = %.1f "Q" = 0.7 "Gain" = %.1f } }
        ]
        links = [
          { output = "pre:Out" input = "low:In" }
          { output = "low:Out" input = "mid:In" }
          { output = "mid:Out" input = "high:In" }
        ]
        inputs = [ "pre:In 1" ]
        outputs = [ "high:Out" ]
      }
      audio.channels = 2
      audio.position = [ FL FR ]
      capture.props = { node.name = "%s" media.class = "Audio/Sink" }
      playback.props = { node.name = "%s.out" node.passive = true stream.dont-remix = true %s }
    }
  }
]
""" % (p["pre"], p["low"][0], p["low"][1], p["mid"][0], p["mid"][1], p["mid"][2], p["high"][0], p["high"][1],
       EQ, EQ, ('target.object = "%s"' % tgt) if tgt else "")


class Audio:
    def __init__(self, get_settings, save_settings, admin=None, log=print, broadcast=lambda *a, **k: None):
        self.get, self.save = get_settings, save_settings
        self.admin = admin or (lambda *a, **k: (1, "kein Root-Helfer"))
        self.log, self.broadcast = log, broadcast
        self.eq_proc = None
        self.report = []                  # letzte Schritte (für die Fehlersuche)
        self.wizard = None                # laufender Ton-Assistent
        self.target = ""                  # echter Ausgang, auf dem der Ton gerade landet
        self.last_hdmi = None             # welche HDMI-Ausgänge beim letzten Anwenden verbunden waren
        self.tone = os.path.join(os.environ.get("XDG_RUNTIME_DIR") or "/tmp", "lichtung-testton.wav")

    def settings(self):
        raw = self.get() or {}
        if migrate(raw):
            self.save(raw)
        return dict(DEFAULTS, **raw)

    # ---------- Klangregelung
    def eq_stop(self):
        if self.eq_proc and self.eq_proc.poll() is None:
            self.eq_proc.terminate()
            try:
                self.eq_proc.wait(timeout=3)
            except Exception:
                self.eq_proc.kill()
        self.eq_proc = None

    def eq_start(self, preset, target):
        self.eq_stop()
        if preset not in PRESETS or not shutil.which("pipewire"):
            return False
        os.makedirs(os.path.dirname(EQ_CONF), exist_ok=True)
        with open(EQ_CONF, "w") as f:
            f.write(eq_conf(preset, target))
        self.eq_proc = subprocess.Popen(["pipewire", "-c", EQ_CONF], stdout=subprocess.DEVNULL,
                                        stderr=subprocess.DEVNULL, start_new_session=True)
        if wait_sinks(6, EQ) and self.eq_proc.poll() is None:
            return True
        self.eq_stop()
        return False

    def eq_running(self):
        return bool(self.eq_proc and self.eq_proc.poll() is None)

    # ---------- alles anwenden (beim Start und bei jeder Änderung)
    def apply(self):
        s, rep = self.settings(), []
        if os.path.exists(OLD_CONF) or not wait_sinks(4):
            rep += repair_basic(self.log)
        lst = sinks()
        if not hardware(lst):
            self.report = rep + ["Keine Ausgänge gefunden"]
            return {"ok": False, "report": self.report, "error": "Ton-System meldet keine Ausgänge"}
        unmute_speakers()
        names = {x["name"] for x in lst}
        laptop = s["speakerSink"] if s["speakerSink"] in names else (laptop_candidates(lst)[0]["name"] if laptop_candidates(lst) else "")
        tvs = [x["name"] for x in tv_sinks(lst)]
        target = ""
        self.last_hdmi = plugged(lst)
        if s["output"] == "auto":
            # Automatisch: Musikanlage per USB > Monitor per HDMI > Laptop. Immer nur EIN Ausgang.
            unload_combine()
            usb, hd = usb_sinks(lst), hdmi_connected(lst)
            if usb:
                target = usb[0]["name"]
                rep.append("Automatisch: Ton über USB (%s)" % (usb[0]["description"] or "Musikanlage"))
            elif hd:
                target = hd[0]["name"]
                rep.append("Automatisch: Ton über Monitor/Musikanlage (HDMI)")
            elif laptop:
                target = laptop
                rep.append("Automatisch: kein HDMI – Ton über den Laptop")
        elif s["output"] == "beide" and laptop and tvs:
            if load_combine([laptop] + tvs):
                target = COMBINE
                rep.append("Laptop + Fernseher aktiv")
            else:
                rep.append("Kombi-Ausgang klappt nicht – nur ein Ausgang")
        else:
            unload_combine()
        if not target:
            target = s["sink"] if s["sink"] in names else (tvs[0] if tvs else hardware(lst)[0]["name"])
        default = target
        if s["klang"] in PRESETS:
            if self.eq_start(s["klang"], target):
                default = EQ
                rep.append("Klang „%s“ aktiv" % PRESETS[s["klang"]]["title"])
            else:
                rep.append("Klangregelung startet nicht – Ton läuft ohne")
        else:
            self.eq_stop()
        run(["pactl", "set-default-sink", default])
        if default != target or target == COMBINE:            # echte Ausgänge voll, geregelt wird vorne
            for x in hardware(lst):
                run(["pactl", "set-sink-volume", x["name"], "100%"])
                run(["pactl", "set-sink-mute", x["name"], "0"])
        rep.append("Standard-Ausgang: " + default)
        self.target = target
        self.report = rep
        return {"ok": True, "report": rep}

    def hdmi_changed(self):
        """Hat sich seit dem letzten Anwenden geändert, ob HDMI verbunden ist?"""
        if self.last_hdmi is None or self.wizard:
            return False
        return plugged(sinks()) != self.last_hdmi

    def watchdog(self):
        """Läuft im Hintergrund: Klangregelung abgestürzt → neu starten.
        Bei "Automatisch": Monitor/HDMI an- oder abgesteckt → Ton umschalten."""
        while True:
            time.sleep(5)
            s = self.settings()
            if s["klang"] in PRESETS and self.eq_proc and self.eq_proc.poll() is not None:
                self.log("Klangregelung beendet – starte neu")
                self.apply()
            elif s["output"] == "auto" and self.hdmi_changed():
                self.log("HDMI geändert – Ton wird umgeschaltet")
                self.broadcast("audiodone", **self.apply())

    # ---------- Testton
    def make_tone(self):
        if os.path.exists(self.tone):
            return self.tone
        rate, out = 48000, bytearray()
        for freq in (523.25, 659.25, 783.99, 1046.5):          # C-E-G-C, freundlicher Gong
            n = int(rate * 0.32)
            for i in range(n):
                env = min(1.0, i / 800) * min(1.0, (n - i) / 3000)
                v = int(0.45 * 32767 * env * math.sin(2 * math.pi * freq * i / rate))
                out += struct.pack("<hh", v, v)
        with wave.open(self.tone, "wb") as w:
            w.setnchannels(2)
            w.setsampwidth(2)
            w.setframerate(rate)
            w.writeframes(bytes(out))
        return self.tone

    def play_tone(self, sink):
        run(["pactl", "set-sink-mute", sink, "0"])
        run(["pactl", "set-sink-volume", sink, "85%"])
        run(["paplay", "--device=" + sink, self.make_tone()], timeout=8)
        run(["paplay", "--device=" + sink, self.make_tone()], timeout=8)

    # ---------- Ton-Assistent
    def legacy_active(self):
        return os.path.exists(LEGACY_FLAG)

    def _prepare(self, strategy):
        """Einen Weg vorbereiten und die Ausgänge liefern, die danach zu testen sind."""
        if strategy == "mixer":
            if os.path.exists(NOUCM_RULE):
                os.remove(NOUCM_RULE)
                restart_stack()
                wait_sinks(10)
        elif strategy == "noucm":
            os.makedirs(os.path.dirname(NOUCM_RULE), exist_ok=True)
            with open(NOUCM_RULE, "w") as f:
                f.write('# Lichtung Ton-Assistent: Soundkarte ohne UCM-Profile ansprechen\n'
                        'monitor.alsa.rules = [\n  { matches = [ { device.name = "~alsa_card.*" } ]\n'
                        '    actions = { update-props = { api.alsa.use-ucm = false } } }\n]\n')
            restart_stack()
            if not wait_sinks(12):                           # macht es schlimmer → sofort zurück
                os.remove(NOUCM_RULE)
                restart_stack()
                wait_sinks(10)
                return []
        unmute_speakers()
        cands = laptop_candidates(sinks())
        for c in cands:                                       # wenn es einen "Speaker"-Anschluss gibt: den nehmen
            sp = next((p for p in c["ports"] if "speaker" in (p or "").lower()), None)
            if sp:
                run(["pactl", "set-sink-port", c["name"], sp])
        return [c["name"] for c in cands]

    def _next(self):
        w = self.wizard
        while True:
            if w["queue"]:
                sink = w["queue"].pop(0)
                w["sink"] = sink
                self.play_tone(sink)
                return {"kind": "listen", "strategy": w["strategy"], "title": dict(STRATEGIES)[w["strategy"]],
                        "sink": sink, "step": w["index"] + 1, "total": len(STRATEGIES)}
            w["index"] += 1
            if w["index"] >= len(STRATEGIES):
                return self._failed()
            w["strategy"] = STRATEGIES[w["index"]][0]
            if w["strategy"] == "legacy" and not self.legacy_active():
                return {"kind": "reboot", "title": dict(STRATEGIES)["legacy"], "step": w["index"] + 1, "total": len(STRATEGIES)}
            w["queue"] = self._prepare(w["strategy"])

    def _failed(self):
        if os.path.exists(NOUCM_RULE):
            os.remove(NOUCM_RULE)
            restart_stack()
            wait_sinks(10)
        legacy = self.legacy_active()
        self.wizard = None
        st = self.get() or {}
        st["wizardPending"] = False
        self.save(st)
        self.apply()
        return {"kind": "failed", "legacy": legacy}

    def wizard_start(self, from_strategy=None):
        names = [k for k, _ in STRATEGIES]
        idx = names.index(from_strategy) if from_strategy in names else 0
        if not from_strategy and self.legacy_active():
            idx = names.index("legacy")                       # nach dem Neustart mit dem alten Treiber weitermachen
        self.eq_stop()
        unload_combine()
        self.wizard = {"index": idx, "strategy": names[idx], "queue": [], "sink": ""}
        self.wizard["queue"] = self._prepare(names[idx]) if names[idx] != "legacy" or self.legacy_active() else []
        if names[idx] == "legacy" and not self.legacy_active():
            return {"kind": "reboot", "title": dict(STRATEGIES)["legacy"], "step": idx + 1, "total": len(STRATEGIES)}
        return self._next()

    def wizard_answer(self, heard):
        w = self.wizard
        if not w:
            return {"kind": "idle"}
        if heard:
            s = self.get() or {}
            s.update({"speakerSink": w["sink"], "strategy": w["strategy"], "output": "beide", "wizardPending": False})
            self.save(s)
            self.wizard = None
            res = self.apply()
            return {"kind": "done", "sink": w["sink"], "strategy": w["strategy"], "report": res.get("report", [])}
        return self._next()

    def wizard_replay(self):
        if self.wizard and self.wizard.get("sink"):
            self.play_tone(self.wizard["sink"])
        return {"ok": True}

    def wizard_reboot(self, use_legacy=True):
        """Älteren Treiber ein-/ausschalten (Root-Helfer) und neu starten."""
        rc, out = self.admin("audio-driver", "legacy" if use_legacy else "sof", timeout=180)
        if rc != 0:
            return {"ok": False, "error": (out or "Root-Helfer fehlgeschlagen").strip()[:200]}
        s = self.get() or {}
        s["wizardPending"] = bool(use_legacy)
        self.save(s)
        subprocess.Popen(["systemctl", "reboot"])
        return {"ok": True}
