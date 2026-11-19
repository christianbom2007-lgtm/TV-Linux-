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
        self.assertEqual(n("Schau mal https://youtu.be/dQw4w9WgXcQ?t=42 !")[0], "https://www.youtube.com/tv#/watch?v=dQw4w9WgXcQ&t=42s")
        self.assertEqual(n("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=x")[0], "https://www.youtube.com/tv#/watch?v=dQw4w9WgXcQ")
        self.assertEqual(n("https://youtube.com/shorts/dQw4w9WgXcQ")[0], "https://www.youtube.com/tv#/watch?v=dQw4w9WgXcQ")
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


if __name__ == "__main__":
    import urllib.parse  # noqa
    unittest.main(verbosity=2)
