"""Lichtung TV – Klang: Klangregelung (Equalizer) und "Beide Lautsprecher".

So funktioniert es (alles mit Bordmitteln von PipeWire, dem Ton-System):

  Programme ──▶ "Lichtung Klang" (Equalizer) ──▶ "Laptop + Fernseher" ──▶ HDMI
                                                       (verteilt)       └─▶ Laptop

- "Laptop + Fernseher" ist ein Kombi-Ausgang (combine-stream): Er spielt alles
  gleichzeitig auf allen echten Ausgängen der Soundkarte ab.
- "Lichtung Klang" ist ein Filter (filter-chain) mit drei Klangbändern
  (Bass, Mitten, Höhen) und einem Vorverstärker, der Übersteuern verhindert.
- Beides steht in einer Konfigurationsdatei, die PipeWire beim Start liest.
  Bei einer Änderung wird die Datei neu geschrieben und PipeWire neu gestartet
  (Ton ist ~2 Sekunden weg).
- Sicherheitsnetz: Taucht der neue Ausgang nicht auf, wird die Datei wieder
  gelöscht – der Ton läuft dann wie vorher direkt über die Soundkarte.
"""
import json
import os
import re
import subprocess
import time

CONF_DIR = os.path.expanduser("~/.config/pipewire/pipewire.conf.d")
CONF_FILE = os.path.join(CONF_DIR, "60-lichtung-klang.conf")
EQ_NODE, BOTH_NODE = "lichtung_klang", "lichtung_doppelt"

# Voreinstellungen: Vorverstärker (Faktor), Bass (Hz, dB), Mitten (Hz, Güte, dB), Höhen (Hz, dB)
PRESETS = {
    "neutral": {"title": "Neutral", "pre": 1.0, "low": (150, 0.0), "mid": (3000, 1.0, 0.0), "high": (9000, 0.0)},
    "warm":    {"title": "Warm", "pre": 0.75, "low": (180, 5.0), "mid": (3000, 1.2, -4.0), "high": (8000, -2.0)},
    "klar":    {"title": "Sprache klar", "pre": 0.85, "low": (150, -3.0), "mid": (2500, 1.0, 3.0), "high": (9000, 0.0)},
    "bass":    {"title": "Mehr Bass", "pre": 0.6, "low": (120, 8.0), "mid": (3000, 1.0, -2.0), "high": (10000, 1.0)},
}
DEFAULTS = {"klang": "warm", "output": "beide", "sink": ""}


def run(cmd, timeout=10):
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return r.returncode, r.stdout
    except Exception:
        return 1, ""


def _pw_string(s):
    return '"%s"' % re.sub(r'[^\w.:\-]', "", s or "")


def build_conf(klang, output, sink=""):
    """Erzeugt den Inhalt der PipeWire-Konfiguration (oder "" = keine Datei nötig)."""
    modules = []
    target = sink
    if output == "beide":
        target = BOTH_NODE
        modules.append("""  { name = libpipewire-module-combine-stream
    args = {
      combine.mode = sink
      node.name = "%s"
      node.description = "Laptop + Fernseher"
      combine.latency-compensate = false
      combine.props = { audio.position = [ FL FR ] }
      stream.props = { stream.dont-remix = true }
      stream.rules = [
        { matches = [ { media.class = "Audio/Sink" node.name = "~alsa_output.*" } ]
          actions = { create-stream = { } } }
      ]
    }
  }""" % BOTH_NODE)
    if klang in PRESETS:
        p = PRESETS[klang]
        target_line = ('target.object = %s' % _pw_string(target)) if target else ""
        modules.append("""  { name = libpipewire-module-filter-chain
    args = {
      node.description = "Lichtung Klang"
      media.name = "Lichtung Klang"
      filter.graph = {
        nodes = [
          { type = builtin name = pre  label = mixer       control = { "Gain 1" = %.2f } }
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
      capture.props = { node.name = "%s" media.class = "Audio/Sink" priority.session = 3000 }
      playback.props = { node.name = "%s.out" node.passive = true stream.dont-remix = true %s }
    }
  }""" % (p["pre"], p["low"][0], p["low"][1], p["mid"][0], p["mid"][1], p["mid"][2], p["high"][0], p["high"][1],
             EQ_NODE, EQ_NODE, target_line))
    if not modules:
        return ""
    return ("# Lichtung TV – automatisch erzeugt (Einstellungen → Ton). Nicht von Hand ändern.\n"
            "context.modules = [\n" + "\n".join(modules) + "\n]\n")


def wanted_default(klang, output, sink=""):
    """Welcher Ausgang soll Standard sein, damit alle Programme durch den Filter laufen?"""
    if klang in PRESETS:
        return EQ_NODE
    if output == "beide":
        return BOTH_NODE
    return sink


def node_ids():
    """Name → Nummer aller Ton-Ausgänge (über pw-dump)."""
    rc, out = run(["pw-dump"], timeout=8)
    try:
        objs = json.loads(out or "[]")
    except ValueError:
        return {}
    res = {}
    for o in objs:
        props = ((o.get("info") or {}).get("props") or {})
        if o.get("type") == "PipeWire:Interface:Node" and props.get("media.class") == "Audio/Sink":
            res[props.get("node.name")] = o["id"]
    return res


def unmute_speakers():
    """Laptop-Lautsprecher im Mischpult der Soundkarte einschalten. Bei manchen
    Lenovo-Modellen sind sie nach der Installation stumm (Regler "Speaker")."""
    try:
        cards = re.findall(r"^\s*(\d+)\s", open("/proc/asound/cards").read(), re.M)
    except OSError:
        cards = []
    for c in cards:
        for ctl in ("Speaker", "Master", "Headphone"):
            run(["amixer", "-q", "-c", c, "sset", ctl, "100%", "unmute"], timeout=5)
        run(["amixer", "-q", "-c", c, "sset", "Auto-Mute Mode", "Disabled"], timeout=5)


def restart_pipewire():
    run(["systemctl", "--user", "restart", "pipewire.service", "pipewire-pulse.service", "wireplumber.service"], timeout=20)


def wait_for(name, seconds=12):
    end = time.time() + seconds
    while time.time() < end:
        ids = node_ids()
        if name in ids:
            return ids
        time.sleep(1)
    return None


def apply(settings, log=print, restart=restart_pipewire, waiter=wait_for, setter=None):
    """Schreibt die Konfiguration, startet PipeWire neu und setzt den Standard-Ausgang.
    Gibt {"ok": bool, "error": ...} zurück. Bei Fehlern wird alles zurückgerollt."""
    s = dict(DEFAULTS, **(settings or {}))
    if s["output"] != "beide" and not s["sink"]:
        # Einzeln, aber noch kein Ausgang gewählt: HDMI (Fernseher) nehmen, sonst den ersten echten
        hw = sorted(n for n in node_ids() if n and n.startswith("alsa_output"))
        s["sink"] = next((n for n in hw if "hdmi1" in n.lower()), next((n for n in hw if "hdmi" in n.lower()), hw[0] if hw else ""))
    if s["klang"] in PRESETS and s["output"] != "beide" and not s["sink"]:
        s["klang"] = "aus"            # ohne Ziel kein Filter (sonst Rückkopplung)
    conf = build_conf(s["klang"], s["output"], s["sink"])
    old = open(CONF_FILE).read() if os.path.exists(CONF_FILE) else ""
    setter = setter or (lambda nid: run(["wpctl", "set-default", str(nid)]))
    unmute_speakers()
    if conf != old:
        os.makedirs(CONF_DIR, exist_ok=True)
        if conf:
            with open(CONF_FILE + ".tmp", "w") as f:
                f.write(conf)
            os.replace(CONF_FILE + ".tmp", CONF_FILE)
        elif os.path.exists(CONF_FILE):
            os.remove(CONF_FILE)
        restart()
    target = wanted_default(s["klang"], s["output"], s["sink"])
    if not target:
        return {"ok": True}
    ids = waiter(target)
    if not ids:
        # Sicherheitsnetz: zurück zum direkten Ton über die Soundkarte
        log("Klang: Ausgang %s erscheint nicht – schalte zurück" % target)
        if os.path.exists(CONF_FILE):
            os.remove(CONF_FILE)
            restart()
        return {"ok": False, "error": "Klang konnte nicht aktiviert werden – Ton läuft wieder direkt"}
    setter(ids[target])
    # echte Ausgänge auf volle Lautstärke: geregelt wird am Filter/Kombi-Ausgang
    if target in (EQ_NODE, BOTH_NODE):
        for name, nid in ids.items():
            if name and name.startswith("alsa_output"):
                run(["wpctl", "set-volume", str(nid), "1.0"])
    return {"ok": True}
