# -*- coding: utf-8 -*-
"""
Lichtung TV – Android spiegeln (z. B. Galaxy S25 Ultra)
=========================================================
Nutzt scrcpy über "Wireless-Debugging" (ab Android 11):
  * Koppeln einmalig per QR-Code: Der Fernseher zeigt einen QR-Code, das Handy
    scannt ihn unter Entwickleroptionen → Wireless-Debugging → "Gerät mit
    QR-Code koppeln". adb findet das Handy dann per mDNS und koppelt sich.
  * Spiegeln: scrcpy zeigt das Handy im Vollbild – mit Ton (ab Android 12).
"""

import os
import random
import re
import shutil
import subprocess
import threading
import time

SCRCPY_DIR = "/opt/scrcpy"


def tool(name):
    p = os.path.join(SCRCPY_DIR, name)
    return p if os.path.exists(p) else shutil.which(name)


def run(args, timeout=10):
    try:
        r = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
        return r.stdout + r.stderr
    except Exception as e:
        return str(e)


class Android:
    def __init__(self, broadcast, wayland_env):
        self.broadcast = broadcast          # Ereignisse an die Oberfläche
        self.wayland_env = wayland_env      # Funktion → Umgebung mit WAYLAND_DISPLAY
        self.proc = None
        self.pair = None                    # {"name","password","qr","state","msg"}

    @property
    def available(self):
        return bool(tool("adb") and tool("scrcpy"))

    # ---------- Hilfen ----------
    def services(self):
        """Liste der per mDNS sichtbaren Android-Geräte: (name, typ, adresse)."""
        out = run([tool("adb"), "mdns", "services"], timeout=8)
        found = []
        for line in out.splitlines():
            m = re.match(r"^(\S+)\s+(_adb-tls-(?:pairing|connect)\._tcp)\.?\s+([\d.]+:\d+)", line.strip())
            if m:
                found.append(m.groups())
        return found

    def devices(self):
        out = run([tool("adb"), "devices"], timeout=8)
        return [l.split()[0] for l in out.splitlines()[1:] if l.strip().endswith("device")]

    def status(self):
        return {"available": self.available, "devices": self.devices() if self.available else [],
                "mirroring": bool(self.proc and self.proc.poll() is None), "pair": self.pair}

    # ---------- Koppeln per QR ----------
    def start_pairing(self):
        name = "lichtung-%04d" % random.randint(0, 9999)
        pw = "%06d" % random.randint(0, 999999)
        self.pair = {"name": name, "password": pw, "qr": "WIFI:T:ADB;S:%s;P:%s;;" % (name, pw), "state": "wartet", "msg": "QR-Code mit dem Handy scannen"}
        threading.Thread(target=self._pair_loop, args=(name, pw), daemon=True).start()
        return self.pair

    def _pair_loop(self, name, pw):
        end = time.time() + 180
        while time.time() < end and self.pair and self.pair["name"] == name:
            for svc, typ, addr in self.services():
                if svc == name and "pairing" in typ:
                    out = run([tool("adb"), "pair", addr, pw], timeout=20)
                    if "Successfully paired" in out:
                        self.pair.update(state="gekoppelt", msg="Gekoppelt! Verbinde …")
                        self.broadcast("android", **self.status())
                        self.auto_connect(wait=25)
                        self.pair.update(state="fertig", msg="Fertig – du kannst jetzt spiegeln")
                    else:
                        self.pair.update(state="fehler", msg="Koppeln fehlgeschlagen – bitte erneut scannen")
                    self.broadcast("android", **self.status())
                    return
            time.sleep(1.5)
        if self.pair and self.pair["name"] == name and self.pair["state"] == "wartet":
            self.pair.update(state="abgelaufen", msg="Zeit abgelaufen – bitte neu starten")
            self.broadcast("android", **self.status())

    # ---------- Verbinden & Spiegeln ----------
    def auto_connect(self, wait=10):
        """Bereits gekoppelte Handys mit eingeschaltetem Wireless-Debugging verbinden."""
        end = time.time() + wait
        while time.time() < end:
            if self.devices():
                return True
            for _, typ, addr in self.services():
                if "connect" in typ:
                    run([tool("adb"), "connect", addr], timeout=10)
            time.sleep(1.5)
        return bool(self.devices())

    def start_mirror(self):
        if not self.available:
            return {"ok": False, "msg": "scrcpy ist nicht installiert"}
        self.stop_mirror()
        if not self.auto_connect(wait=12):
            return {"ok": False, "msg": "Kein Handy gefunden – ist Wireless-Debugging am Handy an und das Handy im gleichen WLAN?"}
        env = self.wayland_env()
        env["SDL_VIDEODRIVER"] = "wayland"
        args = [tool("scrcpy"), "--fullscreen", "--window-title=Lichtung · Android", "--video-bit-rate=8M",
                "--max-size=1920", "--max-fps=60", "--audio-buffer=80", "--stay-awake", "--no-clipboard-autosync"]
        if os.path.exists(os.path.join(SCRCPY_DIR, "scrcpy-server")):
            env["SCRCPY_SERVER_PATH"] = os.path.join(SCRCPY_DIR, "scrcpy-server")
        env["ADB"] = tool("adb")
        try:
            self.proc = subprocess.Popen(args, env=env, stdout=open("/tmp/scrcpy.log", "w"), stderr=subprocess.STDOUT)
        except Exception as e:
            return {"ok": False, "msg": str(e)}
        self.broadcast("android", **self.status())
        return {"ok": True, "msg": "Spiegeln läuft"}

    def stop_mirror(self):
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(3)
            except Exception:
                self.proc.kill()
        self.proc = None
