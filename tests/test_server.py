#!/usr/bin/env python3
"""Automatische Tests für den Lichtung-Dienst.
Aufruf:  python3 tests/test_server.py
Startet den Dienst auf einem Test-Port mit leerem Datenordner und prüft
API, Profile/PIN, Kacheln, Weiterschauen, Tasten-Logik und Fernbedienung."""
import importlib.util
import json
import os
import sys
import tempfile
import threading
import time
import unittest
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.environ["LICHTUNG_DATA"] = tempfile.mkdtemp(prefix="lichtung-test-")
os.environ["LICHTUNG_PORT"] = "8799"
os.environ["LICHTUNG_APP"] = ROOT

spec = importlib.util.spec_from_file_location("srv", os.path.join(ROOT, "server", "lichtung_server.py"))
srv = importlib.util.module_from_spec(spec)
spec.loader.exec_module(srv)

# Lautstärke-Befehle abfangen statt wirklich wpctl aufzurufen
CALLS = []
srv.run = lambda cmd: (CALLS.append(cmd), "Volume: 0.40")[1]

server = srv.ThreadingHTTPServer(("127.0.0.1", 8799), srv.Handler)
server.daemon_threads = True
threading.Thread(target=server.serve_forever, daemon=True).start()
BASE = "http://127.0.0.1:8799"


def call(method, path, body=None, headers=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method, headers={"Content-Type": "application/json", **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


class Events:
    """Fängt broadcast()-Ereignisse mit."""
    def __init__(self):
        self.items = []
        srv.broadcast = lambda t, **d: self.items.append((t, d))

    def types(self):
        return [t for t, _ in self.items]


class TestApi(unittest.TestCase):
    def setUp(self):
        self.ev = Events()

    def test_01_state(self):
        st, s = call("GET", "/api/state")
        self.assertEqual(st, 200)
        self.assertEqual(len(s["profiles"]), 1)
        self.assertTrue(s["profiles"][0]["isDefault"])
        self.assertNotIn("pin", s["profiles"][0])          # kein PIN-Hash nach außen
        self.assertGreaterEqual(len(s["tiles"]), 5)
        self.assertEqual(len(s["channels"]), 12)

    def test_02_static(self):
        for p in ["/", "/remote", "/live.html", "/app.js", "/fonts/fraunces-latin-full-normal.woff2"]:
            with urllib.request.urlopen(BASE + p) as r:
                self.assertEqual(r.status, 200, p)
        with self.assertRaises(urllib.error.HTTPError):
            urllib.request.urlopen(BASE + "/../server/lichtung_server.py")

    def test_03_profiles_pin(self):
        st, p = call("POST", "/api/profiles", {"name": "Christian", "pin": "1234"})
        self.assertTrue(p["hasPin"])
        self.assertEqual(call("POST", "/api/profile/select", {"id": p["id"], "pin": "0000"})[0], 403)
        self.assertEqual(call("POST", "/api/profile/select", {"id": p["id"], "pin": "1234"})[0], 200)
        self.assertEqual(srv.STATE["active"], p["id"])
        # PIN-Profil darf nicht Standard werden
        self.assertEqual(call("PUT", "/api/profiles/" + p["id"], {"isDefault": True})[0], 400)
        # Standardprofil bekommt PIN → Standard wandert zu einem Profil ohne PIN
        call("POST", "/api/profiles", {"name": "Papa"})
        call("PUT", "/api/profiles/standard", {"pin": "5555"})
        st, s = call("GET", "/api/state")
        defaults = [x for x in s["profiles"] if x["isDefault"]]
        self.assertEqual(len(defaults), 1)
        self.assertFalse(defaults[0]["hasPin"])
        call("PUT", "/api/profiles/standard", {"removePin": True, "isDefault": True})
        call("POST", "/api/profile/select", {"id": "standard"})

    def test_04_tiles(self):
        st, t = call("POST", "/api/tiles", {"tile": {"title": "Test", "url": "example.org", "hue": 400}})
        self.assertEqual(t["url"], "https://example.org")   # https wird ergänzt
        self.assertEqual(t["hue"], 40)
        st, s = call("GET", "/api/state")
        ids = [x["id"] for x in s["tiles"]]
        self.assertIn(t["id"], ids)
        call("POST", "/api/tiles/order", {"ids": [t["id"]] + [i for i in ids if i != t["id"]]})
        self.assertEqual(call("GET", "/api/state")[1]["tiles"][0]["id"], t["id"])
        call("DELETE", "/api/tiles/" + t["id"])
        self.assertNotIn(t["id"], [x["id"] for x in call("GET", "/api/state")[1]["tiles"]])
        self.assertIn("config", self.ev.types())

    def test_05_continue(self):
        url = "https://www.youtube.com/tv#/watch?v=abcdefghijk"
        call("POST", "/api/continue", {"url": url, "title": "X", "time": 10, "duration": 600})
        self.assertEqual(call("GET", "/api/continue/lookup?url=" + urllib.parse.quote(url))[1], {})  # < 30 s
        call("POST", "/api/continue", {"url": url, "title": "X", "time": 200, "duration": 600})
        # gleiche Video-ID über normale YouTube-Adresse finden
        st, item = call("GET", "/api/continue/lookup?url=" + urllib.parse.quote("https://www.youtube.com/watch?v=abcdefghijk&t=3"))
        self.assertEqual(item["time"], 200)
        self.assertIn("ytimg", item["image"])
        call("POST", "/api/continue", {"url": url, "title": "X", "time": 590, "duration": 600})   # fertig
        self.assertEqual(call("GET", "/api/continue/lookup?url=" + urllib.parse.quote(url))[1], {})

    def test_06_remote_auth(self):
        # Von "außen" simulieren: is_local auf False zwingen
        orig = srv.Handler.is_local
        srv.Handler.is_local = lambda self: False
        try:
            self.assertEqual(call("GET", "/api/state")[0], 401)
            pin = srv.CONFIG["remote"]["pin"]
            self.assertEqual(call("GET", "/api/state", headers={"X-Remote-Pin": pin})[0], 200)
            self.assertIsNone(call("GET", "/api/netinfo", headers={"X-Remote-Pin": pin})[1]["pin"])  # Code nie nach außen
        finally:
            srv.Handler.is_local = orig

    def test_07_keys(self):
        CALLS.clear()
        self.assertEqual(srv.handle_key("KEY_HOMEPAGE", 1), "home")
        self.assertEqual(srv.handle_key("KEY_VOLUMEUP", 1), "up")
        self.assertEqual(srv.handle_key("KEY_VOLUMEUP", 2), "repeat")
        self.assertEqual(srv.handle_key("KEY_MUTE", 1), "mute")
        # Windows-Taste allein = Home, Windows+E = nichts
        srv.handle_key("KEY_LEFTMETA", 1)
        self.assertEqual(srv.handle_key("KEY_LEFTMETA", 0), "home")
        srv.handle_key("KEY_LEFTMETA", 1)
        srv.handle_key("KEY_E", 1)
        self.assertIsNone(srv.handle_key("KEY_LEFTMETA", 0))
        self.assertIn("home", self.ev.types())
        self.assertIn("volume", self.ev.types())
        self.assertTrue(any("set-volume" in c for c in CALLS))

    def test_08_uinput_tap(self):
        class FakeUI:
            def __init__(self): self.log = []
            def write(self, t, c, v): self.log.append((c, v))
            def syn(self): self.log.append("syn")
        if not srv.HAVE_EVDEV:
            self.skipTest("python3-evdev nicht installiert")
        srv.UINPUT = FakeUI()
        self.assertTrue(srv.tap("KEY_UP"))
        E = srv.E
        self.assertEqual([x for x in srv.UINPUT.log if x != "syn"], [(E.KEY_UP, 1), (E.KEY_UP, 0)])
        srv.UINPUT.log.clear()
        srv.mouse(5, -3, "left")
        self.assertIn((E.REL_X, 5), srv.UINPUT.log)
        self.assertIn((E.BTN_LEFT, 1), srv.UINPUT.log)
        srv.UINPUT = None

    def test_08b_type_german(self):
        if not srv.HAVE_EVDEV:
            self.skipTest("python3-evdev nicht installiert")
        pressed = []
        srv.tap = lambda k, mods=(): (pressed.append((k, tuple(mods))), True)[1]
        srv.time.sleep = lambda s: None
        n = srv.type_text("Zy Äß?@")
        self.assertEqual(n, 7)
        self.assertEqual(pressed[0], ("KEY_Y", ("KEY_LEFTSHIFT",)))   # Z liegt auf KEY_Y (QWERTZ)
        self.assertEqual(pressed[1], ("KEY_Z", ()))
        self.assertEqual(pressed[3], ("KEY_APOSTROPHE", ("KEY_LEFTSHIFT",)))
        self.assertEqual(pressed[6], ("KEY_Q", ("KEY_RIGHTALT",)))

    def test_09_upload(self):
        png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
        st, r = call("POST", "/api/upload", {"data": png})
        self.assertTrue(r["url"].startswith("/data/images/"))
        with urllib.request.urlopen(BASE + r["url"]) as resp:
            self.assertEqual(resp.status, 200)

    def test_10_general_whitelist(self):
        call("POST", "/api/general", {"city": "Elmshorn", "evil": 1})
        self.assertEqual(srv.CONFIG["general"]["city"], "Elmshorn")
        self.assertNotIn("evil", srv.CONFIG["general"])
        call("POST", "/api/general", {"city": "Kiel"})


class TestExtras(unittest.TestCase):
    def test_links(self):
        n = srv.extras.normalize_link
        self.assertEqual(n("Schau mal https://youtu.be/dQw4w9WgXcQ?t=42 !")[0], "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s")
        self.assertEqual(n("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=x")[0], "https://www.youtube.com/watch?v=dQw4w9WgXcQ")
        self.assertEqual(n("https://youtube.com/shorts/dQw4w9WgXcQ")[0], "https://www.youtube.com/watch?v=dQw4w9WgXcQ")
        self.assertTrue(n("https://cdn.example.org/film.mp4")[0].startswith("/play.html?src="))
        self.assertEqual(n("ardmediathek.de/video/abc"), ("https://ardmediathek.de/video/abc", "ardmediathek.de"))
        self.assertEqual(n("   ")[0], None)

    def test_query(self):
        q = srv.extras.build_query({"channels": ["ARD", "ZDF"], "topic": "Tatort", "minMinutes": 80})
        self.assertEqual([x["fields"] for x in q["queries"]], [["channel"], ["channel"], ["topic"]])
        self.assertEqual(q["duration_min"], 4800)
        self.assertFalse(q["future"])

    def test_mediathek_dedupe(self):
        fake = {"result": {"results": [
            {"channel": "ARD", "topic": "Tatort", "title": "Borowski und das Meer", "url_video": "https://x/a.mp4", "url_video_hd": "https://x/a_hd.mp4", "duration": 5300, "timestamp": 1},
            {"channel": "ARD", "topic": "Tatort", "title": "Borowski und das Meer (Audiodeskription)", "url_video": "https://x/b.mp4", "duration": 5300, "timestamp": 1},
            {"channel": "ARD", "topic": "Tatort", "title": "Ohne Video", "duration": 5300, "timestamp": 1}]}}
        orig = srv.extras.http_post_json
        srv.extras.http_post_json = lambda url, payload, timeout=10: fake
        try:
            items = srv.extras.mediathek_row({"topic": "Tatort", "test": 1}, force=True)
        finally:
            srv.extras.http_post_json = orig
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["url"], "https://x/a_hd.mp4")
        self.assertEqual(items[0]["hue"], 215)

    def test_epg_parse(self):
        now = time.time()
        def ts(o):
            return time.strftime("%Y%m%d%H%M%S +0000", time.gmtime(now + o))
        xml = ("<tv><channel id='DasErste.de'><display-name>Das Erste HD</display-name></channel>"
               "<channel id='NDR.SH.de'><display-name>NDR Fernsehen Schleswig-Holstein</display-name></channel>"
               f"<programme channel='DasErste.de' start='{ts(-600)}' stop='{ts(1800)}'><title>Tagesschau</title></programme>"
               f"<programme channel='DasErste.de' start='{ts(1800)}' stop='{ts(7200)}'><title>Tatort</title><sub-title>Borowski</sub-title></programme>"
               f"<programme channel='NDR.SH.de' start='{ts(-60)}' stop='{ts(600)}'><title>SH Magazin</title></programme>"
               f"<programme channel='ZDF.de' start='{ts(-60)}' stop='{ts(600)}'><title>heute</title></programme>"
               f"<programme channel='DasErste.de' start='{ts(-90000)}' stop='{ts(-86000)}'><title>Alt</title></programme></tv>")
        e = srv.extras.EPG(tempfile.mkdtemp(), lambda: srv.CONFIG)
        res = e.parse(__import__("io").BytesIO(xml.encode()))
        self.assertEqual([p["title"] for p in res["daserste"]], ["Tagesschau", "Tatort"])
        self.assertEqual(res["ndrsh"][0]["title"], "SH Magazin")
        self.assertEqual(res["zdf"][0]["title"], "heute")     # ohne <channel>-Eintrag über die ID gefunden
        self.assertEqual(srv.extras.parse_xmltv_time("20261119201500 +0100"), int(__import__("datetime").datetime(2026, 11, 19, 19, 15, tzinfo=__import__("datetime").timezone.utc).timestamp()))

    def test_sleep_timer(self):
        st, r = call("POST", "/api/sleep", {"minutes": 30, "action": "screen"})
        self.assertTrue(r["active"])
        self.assertGreater(r["left"], 1790)
        st, r = call("POST", "/api/sleep", {"cancel": True})
        self.assertFalse(r["active"])

    def test_sleep_tick(self):
        ev = Events()
        calls = []
        srv.screen = lambda on: calls.append(on) or True
        srv.STATE["sleep"] = {"until": time.time() + 30, "action": "screen", "warned": False}
        self.assertEqual(srv.sleep_tick(lambda s: None), "warned")
        self.assertIn("sleepwarn", ev.types())
        srv.STATE["sleep"]["until"] = time.time() - 1
        self.assertEqual(srv.sleep_tick(lambda s: None), "screen")
        self.assertIn("sleep", ev.types())
        self.assertEqual(calls, [False])          # Bildschirm wurde ausgeschaltet
        self.assertIsNone(srv.STATE["sleep"])

    def test_open_link(self):
        ev = Events()
        st, r = call("POST", "/api/open", {"url": "https://youtu.be/dQw4w9WgXcQ"})
        self.assertEqual(r["label"], "YouTube")
        self.assertIn("open", ev.types())
        self.assertEqual(call("GET", "/api/links")[1]["recent"][0]["label"], "YouTube")


class TestMiniSaver(unittest.TestCase):
    """Mini-Fenster, Bildschirmschoner-Grund, stille Eingabegeräte (23.11.2026)."""

    def test_quiet_devices(self):
        self.assertFalse(srv.counts_as_input("HDA Intel PCH HDMI/DP,pcm=3"))
        self.assertFalse(srv.counts_as_input("Video Bus"))
        self.assertFalse(srv.counts_as_input("DENON USB Audio Consumer Control"))
        self.assertTrue(srv.counts_as_input("AT Translated Set 2 keyboard"))
        self.assertTrue(srv.counts_as_input("2.4G Wireless Remote"))

    def test_mini_flow(self):
        old = srv.go_home
        srv.go_home = lambda: None
        try:
            self.assertEqual(call("POST", "/api/mini", {"action": "open", "yt": ""})[0], 400)
            r = call("POST", "/api/mini", {"action": "open", "yt": "dQw4w9WgXcQ<x>", "time": 83.6, "title": "Test"})[1]
            self.assertEqual(r["mini"], {"yt": "dQw4w9WgXcQx", "time": 83, "title": "Test"})
            call("POST", "/api/mini", {"action": "time", "time": 120})
            self.assertEqual(call("GET", "/api/state")[1]["mini"]["time"], 120)
            g = {"screensaverMinutes": 5}
            self.assertIn("Mini", srv.saver_block_reason(g, 9999, False))
            call("POST", "/api/mini", {"action": "close"})
            self.assertIsNone(call("GET", "/api/state")[1]["mini"])
        finally:
            srv.go_home = old

    def test_saver_reason(self):
        g = {"screensaverMinutes": 5}
        self.assertIn("Video", srv.saver_block_reason(g, 9999, True))
        self.assertIn("Startet in", srv.saver_block_reason(g, 60, False))
        self.assertIn("Aus", srv.saver_block_reason({"screensaverMinutes": 0}, 9999, False))
        st, r = call("GET", "/api/saver/status")
        self.assertEqual(st, 200)
        self.assertIn("why", r)


class TestVersion2(unittest.TestCase):
    """Neue Funktionen aus Version 2 (Brave, sway, Systeminfo, Sicherung …)."""
    def setUp(self):
        self.ev = Events()

    def test_wm_keys_learned(self):
        srv.KEYSTATE["wm"].clear()
        self.assertEqual(srv.handle_key("KEY_VOLUMEUP", 1), "up")      # ohne sway: evdev regelt
        code, _ = call("POST", "/api/key", {"key": "volup", "src": "wm"})
        self.assertEqual(code, 200)
        self.assertEqual(srv.STATE["lastKey"]["src"], "wm")
        self.assertIsNone(srv.handle_key("KEY_VOLUMEUP", 1))           # jetzt nicht doppelt
        srv.KEYSTATE["wm"].clear()

    def test_tile_fields(self):
        code, t = call("POST", "/api/tiles", {"tile": {"title": "ZDF", "url": "zdf.de", "size": "gross", "open": "kino", "color": "#ff8800", "logo": "/data/images/x.png", "tvMode": True}})
        self.assertEqual(code, 200)
        self.assertEqual((t["url"], t["size"], t["open"], t["color"]), ("https://zdf.de", "gross", "kino", "#ff8800"))
        self.assertNotIn("tvMode", t)
        code, t2 = call("POST", "/api/tiles", {"tile": {"title": "X", "url": "app:terminal", "size": "riesig", "open": "egal", "color": "red;"}})
        self.assertEqual((t2["size"], t2["open"], t2["color"], t2["url"]), ("normal", "tab", "", "app:terminal"))

    def test_siteinfo_parse(self):
        html = """<html><head><title>Startseite | ARD Mediathek</title>
        <meta name="theme-color" content="#001a4b"><meta content="Filme, Serien und Dokus." property="og:description">
        <link rel="icon" href="/fav.ico"><link rel="apple-touch-icon" sizes="180x180" href="/apple.png"></head></html>"""
        i = srv.system.parse_siteinfo(html, "https://www.ardmediathek.de/")
        self.assertEqual(i["title"], "ARD Mediathek")
        self.assertEqual(i["logo"], "https://www.ardmediathek.de/apple.png")
        self.assertEqual(i["color"], "#001a4b")
        self.assertTrue(i["description"].startswith("Filme"))

    def test_backup_roundtrip(self):
        data = srv.system.backup_zip(srv.DATA_DIR)
        import zipfile, io
        self.assertIn("config.json", zipfile.ZipFile(io.BytesIO(data)).namelist())
        import base64
        code, r = call("POST", "/api/restore", {"data": base64.b64encode(data).decode()})
        self.assertEqual(code, 200)
        code, r = call("POST", "/api/restore", {"data": base64.b64encode(b"kein zip").decode()})
        self.assertEqual(code, 400)

    def test_general_v2_keys(self):
        code, g = call("POST", "/api/general", {"ytZoom": 1.5, "nightMode": "auto", "saverStyle": "analog", "evil": 1})
        self.assertEqual((g["ytZoom"], g["nightMode"], g["saverStyle"]), (1.5, "auto", "analog"))
        self.assertNotIn("evil", g)
        code, c = call("GET", "/api/brave/config")
        self.assertEqual(c["ytZoom"], 1.5)

    def test_recorder_rules(self):
        code, r = call("POST", "/api/recorder", {"on": False, "rules": [{"topic": "Tatort", "max": 9}, {"topic": ""}]})
        self.assertEqual(code, 200)
        self.assertEqual(len(r["config"]["rules"]), 1)
        self.assertEqual(r["config"]["rules"][0]["max"], 5)
        code, r = call("GET", "/api/recorder")
        self.assertIn("items", r)

    def test_remote_name(self):
        pin = srv.CONFIG["remote"]["pin"]
        call("GET", "/api/state", headers={"X-Remote-Pin": pin, "X-Remote-Name": "S26"})
        # Anfragen von 127.0.0.1 gelten als "lokal" – Handy-Liste nur bei echten Handys
        code, r = call("GET", "/api/remotes")
        self.assertEqual(code, 200)

    def test_incoming_and_quick(self):
        code, _ = call("POST", "/api/incoming", {"url": "Guck mal https://www.arte.tv/de/videos/123/"})
        self.assertEqual(code, 200)
        self.assertIn("incoming", self.ev.types())
        call("POST", "/api/quick", {})
        self.assertIn("quick", self.ev.types())

    def test_static_v2(self):
        for f in ("/extra.js", "/ambient.html", "/remote"):
            req = urllib.request.urlopen(BASE + f, timeout=5)
            self.assertEqual(req.status, 200)

    def test_pause_browsers_only(self):
        calls = []
        def fake_run(cmd, timeout=None):
            calls.append(cmd)
            return (0, "brave.instance1234\nbluez_player /org/bluez/hci0\nfirefox.instance99\n") if cmd[1] == "-l" else (0, "")
        old_run, old_which = srv.system.run, srv.system.shutil.which
        srv.system.run, srv.system.shutil.which = fake_run, lambda n: "/usr/bin/" + n
        try:
            paused = srv.system.pause_browsers()
        finally:
            srv.system.run, srv.system.shutil.which = old_run, old_which
        self.assertEqual(paused, ["brave.instance1234", "firefox.instance99"])   # Musikbox läuft weiter
        self.assertNotIn(["playerctl", "-p", "bluez_player", "pause"], calls)

    def test_kino_window_reused(self):
        class FakeSway:
            available = True
            def __init__(self): self.wins, self.cmds, self.execs = [], [], []
            def windows(self): return self.wins
            def workspace(self, n): self.cmds.append(("ws", n))
            def msg(self, *a, kind=None): self.cmds.append(a)
            def focus_app(self, p): return False
            def exec(self, args): self.execs.append(args)
        sw = FakeSway()
        b = srv.system.Brave(sw, tempfile.mkdtemp(), ROOT, log=lambda *a: None)
        b.stop_others = lambda g, p: None
        old = srv.system.brave_bin
        srv.system.brave_bin = lambda: "/usr/bin/brave-browser"
        try:
            b.open({}, "standard", "https://www.youtube.com/", "kino")
            self.assertEqual(len(sw.execs), 1)                          # erstes Mal: öffnen
            sw.wins = [{"app_id": "brave-www.youtube.com__-Default", "id": 7, "ws": 4}]
            r = b.open({}, "standard", "https://www.youtube.com/", "kino")
            self.assertTrue(r.get("focused"))                           # zweites Mal: nach vorne holen
            self.assertEqual(len(sw.execs), 1)
            b.open({}, "standard", "https://www.youtube.com/watch?v=abc", "kino")
            self.assertIn(("[con_id=7]", "kill"), sw.cmds)               # andere Adresse: ersetzen
            self.assertEqual(len(sw.execs), 2)
        finally:
            srv.system.brave_bin = old
        self.assertFalse(srv.system.Brave.kino_window_for("brave-browser", "www.youtube.com"))

    def test_sway_exec_keeps_commas(self):
        # Regression: sway trennt Befehle an Kommas – die Brave-Adresse ging verloren
        line = srv.system.Sway.exec_line(["brave-browser", "--enable-features=A,B,C", "https://www.ardmediathek.de/"])
        self.assertEqual(line, "'brave-browser' '--enable-features=A,B,C' 'https://www.ardmediathek.de/'")
        # außerhalb von Anführungszeichen darf kein Komma stehen
        outside = "".join(part for i, part in enumerate(line.split("'")) if i % 2 == 0)
        self.assertNotIn(",", outside)


class TestUpdate(unittest.TestCase):
    """Updates nur aus getesteten Releases, Prüfsumme, Nacht-Automatik."""

    def setUp(self):
        import hashlib
        import http.server
        self.tmp = tempfile.mkdtemp(prefix="lichtung-upd-")
        self.pkg = b"\x1f\x8b-ein-test-paket"
        with open(os.path.join(self.tmp, "lichtung-tv.tar.gz"), "wb") as f:
            f.write(self.pkg)
        with open(os.path.join(self.tmp, "lichtung-tv.tar.gz.sha256"), "w") as f:
            f.write(hashlib.sha256(self.pkg).hexdigest() + "  lichtung-tv.tar.gz\n")
        handler = lambda *a, **k: http.server.SimpleHTTPRequestHandler(*a, directory=self.tmp, **k)
        http.server.SimpleHTTPRequestHandler.log_message = lambda *a: None
        self.httpd = srv.ThreadingHTTPServer(("127.0.0.1", 0), handler)
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        base = "http://127.0.0.1:%d/" % self.httpd.server_address[1]
        self.app = tempfile.mkdtemp(prefix="lichtung-app-")
        self.up = srv.system.Updater(self.tmp, self.app, log=lambda *a: None)
        self.up.UPD_DIR = os.path.join(self.tmp, "upd")
        self.rel = {"tag": "iso-20990101-0000", "title": "Test", "date": "2099-01-01T00:00:00Z",
                    "package": base + "lichtung-tv.tar.gz", "sha256": base + "lichtung-tv.tar.gz.sha256"}
        self.up.latest_release = lambda: dict(self.rel)
        self.installed_with = []
        self.up.install = lambda path: (self.installed_with.append(path), {"ok": True, "msg": "gestartet"})[1]

    def tearDown(self):
        self.httpd.shutdown()

    def write_version(self, release):
        with open(os.path.join(self.app, "VERSION"), "w") as f:
            json.dump({"version": "2.0", "release": release, "commit": ""}, f)

    def test_newer_compare(self):
        U = srv.system.Updater
        self.assertTrue(U.is_newer("iso-20261121-0300", "iso-20261120-1700"))
        self.assertFalse(U.is_newer("iso-20261120-1700", "iso-20261120-1700"))
        self.assertFalse(U.is_newer("iso-20261119-1700", "iso-20261120-1700"))   # nie zurück
        self.assertTrue(U.is_newer("iso-20261120-1700", ""))                      # alte ISO ohne Release-Namen
        self.assertFalse(U.is_newer("", "iso-20261120-1700"))

    def test_check(self):
        self.write_version("iso-20000101-0000")
        c = self.up.check()
        self.assertTrue(c["ok"] and c["newer"])
        self.assertEqual(c["latest"], "iso-20990101-0000")
        self.write_version("iso-20990101-0000")
        self.assertFalse(self.up.check()["newer"])
        self.rel["package"] = None                     # altes Release ohne Update-Paket
        self.write_version("iso-20000101-0000")
        c = self.up.check()
        self.assertFalse(c["newer"])
        self.assertIn("kein Update-Paket", c["hint"])

    def test_download_and_checksum(self):
        r = self.up.from_github()
        self.assertTrue(r["ok"], r)
        with open(self.installed_with[0], "rb") as f:
            self.assertEqual(f.read(), self.pkg)
        # Prüfsumme manipuliert → kein Einspielen
        with open(os.path.join(self.tmp, "lichtung-tv.tar.gz.sha256"), "w") as f:
            f.write("0" * 64 + "  lichtung-tv.tar.gz\n")
        self.installed_with.clear()
        r = self.up.from_github()
        self.assertFalse(r["ok"])
        self.assertIn("Prüfsumme", r["error"])
        self.assertEqual(self.installed_with, [])

    def test_auto_update_window(self):
        night = time.mktime((2026, 11, 21, 3, 40, 0, 0, 0, -1))
        day = time.mktime((2026, 11, 21, 15, 0, 0, 0, 0, -1))
        idle = {"playing": False, "lastInput": night - 3600}
        self.assertTrue(srv.update_due(night, {}, idle, "", True))
        self.assertFalse(srv.update_due(day, {}, idle, "", True))                       # tagsüber nie
        self.assertFalse(srv.update_due(night, {}, idle, "", False))                    # nichts Neues
        self.assertFalse(srv.update_due(night, {"autoUpdate": False}, idle, "", True))  # abgeschaltet
        self.assertFalse(srv.update_due(night, {}, idle, "2026-11-21", True))           # heute schon versucht
        self.assertFalse(srv.update_due(night, {}, {"playing": True, "playingAt": night, "lastInput": night - 3600}, "", True))
        self.assertFalse(srv.update_due(night, {}, {"playing": False, "lastInput": night - 60}, "", True))

    def test_status_endpoint(self):
        st, u = call("GET", "/api/update/status")
        self.assertEqual(st, 200)
        self.assertIn("auto", u)
        self.assertIn("last", u)
        self.assertEqual(call("POST", "/api/general", {"autoUpdate": False})[0], 200)
        self.assertFalse(call("GET", "/api/update/status")[1]["auto"])
        call("POST", "/api/general", {"autoUpdate": True})


class TestRadioAndImages(unittest.TestCase):
    """Internetradio (Verzeichnis, Favoriten, mpv) und lokal gespeicherte Bilder."""

    RAW = [
        {"stationuuid": "11111111-1111-1111-1111-111111111111", "name": "RTL 102.5", "url_resolved": "https://example.org/rtl.mp3",
         "favicon": "https://example.org/rtl.png", "tags": "pop,italian music", "countrycode": "IT", "codec": "MP3", "bitrate": 128},
        {"stationuuid": "22222222-2222-2222-2222-222222222222", "name": "RTL 102.5 ", "url_resolved": "https://example.org/rtl2.aac",
         "favicon": "", "tags": "", "countrycode": "IT", "codec": "AAC", "bitrate": 64},
        {"stationuuid": "33333333-3333-3333-3333-333333333333", "name": "Radio Italia", "url_resolved": "http://example.org/ri",
         "favicon": "", "tags": "italian", "countrycode": "IT", "codec": "MP3", "bitrate": 128},
        {"stationuuid": "44444444-4444-4444-4444-444444444444", "name": "Kaputt", "url_resolved": "ftp://nope", "tags": ""},
    ]

    def setUp(self):
        self.ev = Events()
        self.calls = []
        srv.RADIO.cache.clear()
        srv.RADIO.fetch = lambda path, params: (self.calls.append((path, params)), self.RAW if "search" in path else {})[1]

    def test_search_clean_and_dedupe(self):
        items = srv.RADIO.search("italien")
        self.assertEqual([i["name"] for i in items], ["RTL 102.5", "Radio Italia"])   # doppelt + kaputt raus
        self.assertEqual(self.calls[0][1]["countrycode"], "IT")
        srv.RADIO.search("italien")
        self.assertEqual(len(self.calls), 1)                                          # zweites Mal aus dem Zwischenspeicher

    def test_endpoints_and_favorites(self):
        st, r = call("GET", "/api/radio")
        self.assertEqual(st, 200)
        self.assertIn("italien", [c["id"] for c in r["categories"]])
        st, r = call("GET", "/api/radio/search?cat=italo")
        self.assertEqual(len(r["items"]), 2)
        station = r["items"][1]
        r = call("POST", "/api/radio/fav", {"station": station, "on": True})[1]
        self.assertEqual(r["favorites"][0]["name"], "Radio Italia")
        self.assertEqual(call("GET", "/api/radio/search?cat=favoriten")[1]["items"][0]["id"], station["id"])
        call("POST", "/api/radio/fav", {"station": station, "on": False})
        self.assertEqual(call("GET", "/api/radio/search?cat=favoriten")[1]["items"], [])

    def test_directory_offline(self):
        def boom(path, params):
            raise RuntimeError("Senderverzeichnis nicht erreichbar")
        srv.RADIO.fetch = boom
        st, r = call("GET", "/api/radio/search?q=zzz-offline")
        self.assertEqual(st, 502)
        self.assertIn("nicht erreichbar", r["error"])

    def test_play_with_fake_mpv_and_title(self):
        import socket as so
        tmp = tempfile.mkdtemp()
        fake = os.path.join(tmp, "mpv")
        with open(fake, "w") as f:   # Ersatz für mpv: läuft einfach weiter
            f.write("#!/bin/sh\nexec sleep 30\n")
        os.chmod(fake, 0o755)
        old_path = os.environ["PATH"]
        os.environ["PATH"] = tmp + os.pathsep + old_path
        r = srv.radio.Radio(lambda t, **d: self.ev.items.append((t, d)), runtime_dir=tmp)
        r.fetch = lambda *a: {}
        try:
            self.assertTrue(r.play({"id": "x", "name": "Test FM", "url": "https://example.org/s"})["ok"])
            self.assertTrue(r.playing)
            self.assertEqual(r.status()["station"]["name"], "Test FM")
            # mpv-IPC nachstellen: antwortet mit ICY-Titel
            srv_sock = so.socket(so.AF_UNIX, so.SOCK_STREAM)
            srv_sock.bind(r.sock_path)
            srv_sock.listen(1)
            def answer():
                c, _ = srv_sock.accept()
                c.recv(1024)
                c.sendall(b'{"data": {"icy-title": "Eros Ramazzotti - Cose della vita"}, "error": "success"}\n')
                c.close()
            threading.Thread(target=answer, daemon=True).start()
            self.assertEqual(r.current_title(), "Eros Ramazzotti - Cose della vita")
            srv_sock.close()
            r.list = [{"id": "x", "name": "Test FM", "url": "https://example.org/s"}, {"id": "y", "name": "Zwei", "url": "https://example.org/2"}]
            r.step(1)
            self.assertEqual(r.station["name"], "Zwei")
            r.stop()
            self.assertFalse(r.playing)
            self.assertIn("radio", [t for t, _ in self.ev.items])
        finally:
            os.environ["PATH"] = old_path
            r.stop()

    def test_play_rejects_bad_url(self):
        self.assertFalse(srv.RADIO.play({"name": "x", "url": "file:///etc/passwd"})["ok"])

    def test_radio_tile_migration(self):
        cfg_path = srv.CONFIG_PATH
        with open(cfg_path) as f:
            saved = f.read()
        cfg = json.loads(saved)
        cfg["general"]["version"] = 2
        for p in cfg["profiles"]:
            p["tiles"] = [t for t in p["tiles"] if t.get("url") != "lichtung:radio"]
        with open(cfg_path, "w") as f:
            json.dump(cfg, f)
        try:
            new = srv.load_config()
            self.assertTrue(all(any(t["url"] == "lichtung:radio" for t in p["tiles"]) for p in new["profiles"]))
            self.assertEqual(new["general"]["version"], 3)
            again = srv.load_config()                     # zweites Laden: keine doppelte Kachel
            self.assertEqual(sum(t["url"] == "lichtung:radio" for t in again["profiles"][0]["tiles"]), 1)
        finally:
            with open(cfg_path, "w") as f:
                f.write(saved)

    def test_image_cache(self):
        import http.server
        from PIL import Image
        import io
        d = tempfile.mkdtemp()
        buf = io.BytesIO()
        Image.new("RGB", (800, 450), (200, 120, 40)).save(buf, "JPEG")
        with open(os.path.join(d, "bild.jpg"), "wb") as f:
            f.write(buf.getvalue())
        with open(os.path.join(d, "kein-bild.html"), "w") as f:
            f.write("<html>404</html>")
        handler = lambda *a, **k: http.server.SimpleHTTPRequestHandler(*a, directory=d, **k)
        http.server.SimpleHTTPRequestHandler.log_message = lambda *a: None
        hs = srv.ThreadingHTTPServer(("127.0.0.1", 0), handler)
        threading.Thread(target=hs.serve_forever, daemon=True).start()
        base = "http://127.0.0.1:%d/" % hs.server_address[1]
        try:
            local = srv.cache_image(base + "bild.jpg")
            self.assertTrue(local.startswith("/data/images/thumb-") and local.endswith(".jpg"))
            self.assertEqual(srv.cache_image(base + "bild.jpg"), local)              # gleiche Adresse → gleiche Datei
            with Image.open(os.path.join(srv.IMG_DIR, os.path.basename(local))) as im:
                self.assertLessEqual(im.size[0], 640)                                   # verkleinert
            self.assertEqual(srv.cache_image(base + "kein-bild.html"), "")             # Fehlerseite ist kein Bild
            # Weiterschauen-Eintrag + Kachel ohne Logo → beides wird lokal
            prof = srv.active_profile()
            prof.setdefault("continue", []).insert(0, {"key": "u:test", "url": "https://example.org/v", "title": "T", "site": "example.org",
                                                       "image": base + "bild.jpg", "time": 100, "duration": 1000})
            prof["tiles"].append({"id": "t-logo-test", "title": "X", "url": "https://example.org/", "image": "", "logo": ""})
            old_logo = srv.site_logo
            srv.site_logo = lambda url: srv.cache_image(base + "bild.jpg", prefix="logo", max_px=256)
            try:
                self.assertTrue(srv.media_cache_pass())
            finally:
                srv.site_logo = old_logo
            self.assertTrue(prof["continue"][0]["image"].startswith("/data/images/"))
            tile = next(t for t in prof["tiles"] if t["id"] == "t-logo-test")
            self.assertTrue(tile["logo"].startswith("/data/images/logo-"))
            self.assertTrue(tile["logoTried"])
            self.assertEqual(urllib.request.urlopen(BASE + local, timeout=5).status, 200)  # wird ausgeliefert
        finally:
            hs.shutdown()
            prof["continue"] = [c for c in prof.get("continue", []) if c["key"] != "u:test"]
            prof["tiles"] = [t for t in prof["tiles"] if t["id"] != "t-logo-test"]

    def test_continue_keeps_local_thumb(self):
        prof = srv.active_profile()
        body = {"url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "title": "Video", "time": 60, "duration": 600,
                "image": "https://i.ytimg.com/vi/ALTESVIDEO/hqdefault.jpg"}
        srv.update_continue(prof, body)
        c = prof["continue"][0]
        self.assertEqual(c["image"], "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg")   # immer das richtige YouTube-Bild
        c["image"] = "/data/images/thumb-abc.jpg"                                          # inzwischen lokal gespeichert
        srv.update_continue(prof, dict(body, time=90))
        self.assertEqual(prof["continue"][0]["image"], "/data/images/thumb-abc.jpg")       # bleibt lokal
        srv.update_continue(prof, dict(body, url="https://www.ardmediathek.de/video/x", image="blob:https://x/123"))
        self.assertEqual(prof["continue"][0]["image"], "")                                  # blob: ist kein Bild
        prof["continue"] = []


class TestAudio(unittest.TestCase):
    """Ton: Start-Reparatur, Kombi + Klang mit Rückfall, Ton-Assistent, Fehlersuche."""
    A = None

    HDMI = {"name": "alsa_output.pci.HiFi__HDMI1__sink", "description": "HDMI 1", "hdmi": True, "available": True, "ports": []}
    HDMI2 = {"name": "alsa_output.pci.HiFi__HDMI2__sink", "description": "HDMI 2", "hdmi": True, "available": False, "ports": []}
    HP = {"name": "alsa_output.pci.HiFi__Headphones__sink", "description": "Headphones", "hdmi": False, "available": True, "ports": []}
    SPK = {"name": "alsa_output.pci.analog-stereo", "description": "Lautsprecher", "hdmi": False, "available": True, "ports": ["analog-output-headphones", "analog-output-speaker"]}

    def setUp(self):
        self.A = srv.audio
        self.saved = {n: getattr(self.A, n) for n in ("run", "sinks", "wait_sinks", "restart_stack", "unmute_speakers", "load_combine", "unload_combine", "OLD_CONF", "NOUCM_RULE", "WP_STATE", "LEGACY_FLAG", "EQ_CONF")}
        tmp = tempfile.mkdtemp()
        self.A.OLD_CONF, self.A.NOUCM_RULE = os.path.join(tmp, "old.conf"), os.path.join(tmp, "wp", "noucm.conf")
        self.A.WP_STATE, self.A.LEGACY_FLAG, self.A.EQ_CONF = os.path.join(tmp, "wpstate"), os.path.join(tmp, "legacy"), os.path.join(tmp, "eq.conf")
        self.calls, self.restarts = [], []
        self.current = [self.HDMI, self.HDMI2, self.HP]
        self.A.run = lambda cmd, timeout=10: (self.calls.append(cmd), (0, ""))[1]
        self.A.sinks = lambda: list(self.current)
        self.A.wait_sinks = lambda seconds=12, name=None: (list(self.current) if (name in [s["name"] for s in self.current] if name else self.A.hardware(self.current)) else None)
        self.A.restart_stack = lambda: self.restarts.append(1)
        self.A.unmute_speakers = lambda: True
        self.combine_ok = True
        def lc(slaves):
            self.combine_slaves = slaves
            if self.combine_ok:
                self.current = self.current + [{"name": self.A.COMBINE, "description": "Kombi", "hdmi": False, "available": True, "ports": []}]
            return self.combine_ok
        self.A.load_combine = lc
        self.A.unload_combine = lambda: None
        self.store = {}
        self.audio = self.A.Audio(lambda: self.store, lambda a: self.store.update(a), log=lambda *a: None)
        self.eq_ok = True
        self.audio.eq_start = lambda preset, target: (setattr(self, "eq_target", target), self.eq_ok)[1]
        self.audio.eq_stop = lambda: None
        self.audio.play_tone = lambda sink: self.calls.append(["TON", sink])

    def tearDown(self):
        for n, v in self.saved.items():
            setattr(self.A, n, v)

    def defaults_set(self):
        return [c[2] for c in self.calls if c[:2] == ["pactl", "set-default-sink"]]

    def test_candidates(self):
        self.assertEqual([s["name"] for s in self.A.laptop_candidates([self.HDMI, self.HP, self.SPK])], [self.HP["name"], self.SPK["name"]])
        self.assertEqual(self.A.tv_sinks([self.HDMI, self.HDMI2]), [self.HDMI])       # nur verbundenes HDMI

    def test_auto_hdmi(self):
        r = self.audio.apply()                                     # Standard: Automatisch → nur HDMI
        self.assertTrue(r["ok"])
        self.assertEqual(self.store.get("output"), "auto")         # alte Einstellung einmalig umgestellt
        self.assertEqual(self.eq_target, self.HDMI["name"])        # verbundenes HDMI, nicht HDMI2
        self.assertEqual(self.audio.target, self.HDMI["name"])
        self.assertFalse(self.audio.hdmi_changed())
        self.current = [dict(self.HDMI, available=False), self.HDMI2, self.HP]   # Monitor aus
        self.assertTrue(self.audio.hdmi_changed())
        self.audio.apply()
        self.assertEqual(self.audio.target, self.HP["name"])       # Laptop übernimmt
        self.current = [self.HDMI, self.HDMI2, self.HP]             # Monitor wieder an
        self.assertTrue(self.audio.hdmi_changed())
        self.audio.apply()
        self.assertEqual(self.audio.target, self.HDMI["name"])
        usb = {"name": "alsa_output.usb-Denon_DAC-00.analog-stereo", "description": "USB Audio DAC", "hdmi": False, "usb": True, "available": True, "ports": []}
        self.current = [self.HDMI, self.HDMI2, self.HP, usb]        # Musikanlage per USB eingesteckt
        self.assertNotIn(usb["name"], [x["name"] for x in self.A.laptop_candidates(self.current)])
        self.assertTrue(self.audio.hdmi_changed())
        self.audio.apply()
        self.assertEqual(self.audio.target, usb["name"])            # USB hat Vorrang vor HDMI

    def test_apply_full(self):
        self.store.update({"rev": 2, "output": "beide"})
        r = self.audio.apply()                                     # Warm + Laptop/Fernseher
        self.assertTrue(r["ok"])
        self.assertEqual(self.combine_slaves, [self.HP["name"], self.HDMI["name"]])
        self.assertEqual(self.eq_target, self.A.COMBINE)
        self.assertEqual(self.defaults_set()[-1], self.A.EQ)

    def test_apply_fallbacks(self):
        self.store.update({"rev": 2, "output": "beide"})
        self.eq_ok = False                                         # Klangregelung startet nicht
        self.audio.apply()
        self.assertEqual(self.defaults_set()[-1], self.A.COMBINE)
        self.combine_ok, self.current = False, [self.HDMI, self.HP]   # Kombi klappt auch nicht
        self.audio.apply()
        self.assertEqual(self.defaults_set()[-1], self.HDMI["name"])
        self.store.update({"klang": "aus", "output": "einzeln", "sink": self.HP["name"]})
        self.audio.apply()
        self.assertEqual(self.defaults_set()[-1], self.HP["name"])

    def test_repair_when_no_outputs(self):
        open(self.A.OLD_CONF, "w").write("kaputt")
        self.current = []
        r = self.audio.apply()
        self.assertFalse(r["ok"])
        self.assertFalse(os.path.exists(self.A.OLD_CONF))         # Altlast entfernt
        self.assertGreaterEqual(len(self.restarts), 2)
        self.current = [self.HDMI]
        steps = self.A.repair_basic(lambda *a: None)
        self.assertIn("Ausgänge vorhanden ✓", steps)

    def test_wizard_flow(self):
        r = self.audio.wizard_start()
        self.assertEqual((r["kind"], r["strategy"], r["sink"]), ("listen", "mixer", self.HP["name"]))
        self.assertIn(["TON", self.HP["name"]], self.calls)
        self.current = [self.HDMI, self.SPK]                       # ohne UCM erscheint ein Analog-Ausgang
        r = self.audio.wizard_answer(False)
        self.assertEqual((r["kind"], r["strategy"], r["sink"]), ("listen", "noucm", self.SPK["name"]))
        self.assertTrue(os.path.exists(self.A.NOUCM_RULE))
        self.assertIn(["pactl", "set-sink-port", self.SPK["name"], "analog-output-speaker"], self.calls)
        r = self.audio.wizard_answer(True)
        self.assertEqual(r["kind"], "done")
        self.assertEqual(self.store["speakerSink"], self.SPK["name"])
        self.assertEqual(self.store["strategy"], "noucm")
        self.assertIsNone(self.audio.wizard)

    def test_wizard_reaches_reboot_then_fails(self):
        self.current = [self.HDMI, self.HP]
        self.audio.wizard_start()
        self.current = [self.HDMI]                                 # ohne UCM: kein Laptop-Ausgang
        r = self.audio.wizard_answer(False)
        self.assertEqual(r["kind"], "reboot")                      # nächster Schritt braucht Neustart
        open(self.A.LEGACY_FLAG, "w").write("x")                   # … nach dem Neustart
        self.current = [self.HDMI, self.HP]
        r = self.audio.wizard_start("legacy")
        self.assertEqual((r["kind"], r["strategy"]), ("listen", "legacy"))
        r = self.audio.wizard_answer(False)
        self.assertEqual(r["kind"], "failed")
        self.assertTrue(r["legacy"])
        self.assertFalse(os.path.exists(self.A.NOUCM_RULE))       # aufgeräumt
        self.assertFalse(self.store.get("wizardPending"))

    def test_eq_conf_and_tone(self):
        c = self.A.eq_conf("warm", 'x"; rm -rf /')
        self.assertIn('inputs = [ "pre:In 1" ]', c)
        self.assertEqual(c.count("{"), c.count("}"))
        self.assertEqual(c.count("["), c.count("]"))
        self.assertNotIn('"; rm', c)                               # keine Einschleusung
        a = self.saved["run"]                                      # echte Funktion für den Testton nicht nötig
        self.audio.tone = os.path.join(tempfile.mkdtemp(), "ton.wav")
        import wave as wv
        with wv.open(self.audio.make_tone()) as w:
            self.assertEqual((w.getnchannels(), w.getframerate()), (2, 48000))
            self.assertGreater(w.getnframes(), 48000)

    def test_endpoints(self):
        st, a = call("GET", "/api/audio")
        self.assertEqual(st, 200)
        self.assertEqual(a["settings"]["klang"], "warm")
        self.assertIn("report", a)
        old = srv.apply_audio_async
        srv.apply_audio_async = lambda: None
        try:
            r = call("POST", "/api/audio/klang", {"klang": "klar", "output": "einzeln"})[1]
            self.assertEqual(r["settings"]["klang"], "klar")
            call("POST", "/api/audio/klang", {"klang": "quatsch"})
            self.assertEqual(srv.audio_settings()["klang"], "klar")
            self.assertEqual(call("POST", "/api/audio/wizard", {"action": "quatsch"})[0], 400)
            self.assertTrue(call("POST", "/api/audio/wizard", {"action": "cancel"})[1]["ok"])
        finally:
            srv.apply_audio_async = old
            srv.CONFIG["audio"] = {}

    def test_diagnose(self):
        st, r = call("GET", "/api/diag")
        self.assertIn("ton", [t["id"] for t in r["topics"]])
        for t in r["topics"]:
            st, d = call("GET", "/api/diag?topic=" + t["id"])
            self.assertEqual(st, 200)
            for it in d["items"]:
                self.assertIn(it["state"], ("ok", "warn", "fail"))
        boom = srv.diag.run_topic("system", {})            # fehlender Kontext → Fehlermeldung statt Absturz
        self.assertTrue(isinstance(boom, list))
        self.assertEqual(call("POST", "/api/diag/fix", {"action": "quatsch"})[0], 400)


if __name__ == "__main__":
    import urllib.parse  # noqa
    unittest.main(verbosity=2)
