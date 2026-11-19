#!/usr/bin/env python3
"""Oberflächen-Test: klickt/tippt sich wie ein Mensch mit Fernbedienung durch
Startseite, Profile, Editor, Einstellungen, Live-TV und Handy-Fernbedienung.
Voraussetzung: Dienst läuft auf :8770 mit frischem Datenordner, Playwright + Chrome.
Aufruf: python3 tests/ui_test.py [chrome-pfad]"""
import asyncio
import json
import sys
from playwright.async_api import async_playwright

CHROME = sys.argv[1] if len(sys.argv) > 1 else "/usr/bin/google-chrome"
BASE = "http://127.0.0.1:8770"
SHOTS = "/tmp/shots/ui_"
WEATHER = {"city": "Kiel", "current": {"temperature_2m": 6.4, "weather_code": 61, "is_day": 0},
           "daily": {"time": ["2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22"], "weather_code": [61, 3, 2, 71],
                     "temperature_2m_max": [8, 7, 9, 4], "temperature_2m_min": [3, 4, 2, -1]},
           "hourly": {}}
GEO = [{"name": "Elmshorn", "latitude": 53.75, "longitude": 9.65, "admin1": "Schleswig-Holstein", "country": "Deutschland"}]
VIDEO = "http://127.0.0.1:8771/video.webm"   # Testvideo (Server mit Range-Unterstützung)
NOW = __import__("time").time()
def item(i, ch, topic, title, mins, hue):
    return {"id": f"x{i}", "channel": ch, "topic": topic, "title": title, "description": f"Beschreibung zu {title}. Spannend und lehrreich.",
            "timestamp": int(NOW - i * 5400), "duration": mins * 60, "url": VIDEO, "urlSd": VIDEO, "website": f"https://www.ardmediathek.de/video/{i}", "hue": hue}
MEDIA = {"rows": [
    {"id": "m-neu", "title": "Neu in der Mediathek", "items": [item(i, ch, t, ti, m, hu) for i, (ch, t, ti, m, hu) in enumerate([
        ("ARD", "Tatort", "Borowski und der Sturm", 89, 215), ("ZDF", "Terra X", "Die Ostsee – Meer der Extreme", 44, 28),
        ("ARTE.DE", "Doku", "Wälder des Nordens", 52, 12), ("3Sat", "Wissen", "Was im Körper passiert", 30, 345), ("NDR", "Nordtour", "Mit dem Rad an der Schlei", 28, 205)])]},
    {"id": "m-tagesschau", "title": "tagesschau", "items": [item(10 + i, "ARD", "tagesschau", f"tagesschau 20:00 Uhr", 15, 215) for i in range(3)]},
]}
def epg_mock():
    t = int(__import__("time").time())
    def p(o, d, title, sub=""):
        return {"start": t + o * 60, "stop": t + (o + d) * 60, "title": title, "sub": sub, "desc": "Eine Sendung."}
    return {"now": t, "status": "ok", "channels": {
        "daserste": [p(-20, 35, "Tagesschau-Magazin"), p(15, 90, "Tatort", "Borowski und der Sturm"), p(105, 45, "Tagesthemen")],
        "zdf": [p(-5, 30, "heute journal"), p(25, 45, "Markus Lanz")],
        "ndrsh": [p(-10, 30, "Schleswig-Holstein Magazin"), p(20, 15, "NDR Info")]}}
results = []


def check(name, cond, info=""):
    results.append((name, bool(cond)))
    print(("OK  " if cond else "FAIL"), name, info, flush=True)


async def api(page, path, method="GET", body=None):
    return await page.evaluate("""async ([p, m, b]) => { const r = await fetch(p, {method: m, headers: {'Content-Type':'application/json'}, body: b ? JSON.stringify(b) : undefined}); return r.json(); }""", [path, method, body])


async def focused(page):
    return await page.evaluate("(() => { const c = L.Nav.current; return c ? (c.dataset.id || c.textContent.trim().slice(0, 40)) : null })()")


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=CHROME, args=["--no-sandbox", "--autoplay-policy=no-user-gesture-required"])
        ctx = await b.new_context(viewport={"width": 1920, "height": 1080})
        errors = []

        async def mocks(route):
            url = route.request.url
            if "/api/weather" in url:
                return await route.fulfill(status=200, content_type="application/json", body=json.dumps(WEATHER))
            if "/api/mediathek/search" in url:
                return await route.fulfill(status=200, content_type="application/json", body=json.dumps({"items": MEDIA["rows"][0]["items"][:3]}))
            if "/api/mediathek" in url:
                return await route.fulfill(status=200, content_type="application/json", body=json.dumps(MEDIA))
            if "/api/epg" in url:
                return await route.fulfill(status=200, content_type="application/json", body=json.dumps(epg_mock()))
            if url.startswith("http://127.0.0.1:8771/"):
                return await route.continue_()
            if "/api/geocode" in url:
                return await route.fulfill(status=200, content_type="application/json", body=json.dumps(GEO))
            if not url.startswith(BASE):
                return await route.fulfill(status=200, content_type="text/html", body="<title>extern</title><h1>Externe Seite</h1>")
            return await route.continue_()
        await ctx.route("**/*", mocks)
        page = await ctx.new_page()
        page.on("pageerror", lambda e: errors.append(str(e)))

        # Testdaten: zweites Profil mit PIN, Weiterschauen-Eintrag
        await page.goto(BASE + "/api/state")

        # ---------- Einrichtungsassistent (erster Start) ----------
        await page.goto(BASE + "/")
        await page.wait_for_timeout(900)
        check("Erster Start → Einrichtungsassistent", await page.evaluate("S.view") == "setup")
        await page.screenshot(path=SHOTS + "00a_setup_welcome.png")
        await page.keyboard.press("Enter")                         # Los geht's
        await page.wait_for_timeout(300)
        await page.fill("#setup input", "Elmshorn"); await page.keyboard.press("Enter")
        await page.wait_for_timeout(500)
        await page.keyboard.press("Enter")                         # Treffer wählen
        await page.wait_for_timeout(200)
        await page.screenshot(path=SHOTS + "00b_setup_place.png")
        await page.keyboard.press("Enter")                         # Weiter (Fokus springt auf "Weiter")
        await page.wait_for_timeout(500)
        check("Assistent: Ort gespeichert", (await api(page, "/api/state"))["general"]["city"] == "Elmshorn")
        await page.wait_for_timeout(600)
        hd = page.locator("#setup .menu-list button", has_text="HDMI").first
        if await hd.count():
            await hd.click(); await page.wait_for_timeout(600)
        await page.screenshot(path=SHOTS + "00c_setup_sound.png")
        await page.click("#setup .btn.primary")                    # Ton passt
        await page.wait_for_timeout(300)
        await page.fill("#setup input", "Wohnzimmer TV")
        await page.click("#setup .btn.primary")
        await page.wait_for_timeout(700)
        check("Assistent: Profilname übernommen", any(p["name"] == "Wohnzimmer TV" for p in (await api(page, "/api/state"))["profiles"]))
        await page.click("#setup .setup-tile >> text=Netflix")
        await page.click("#setup .setup-tile >> text=arte")
        await page.screenshot(path=SHOTS + "00d_setup_tiles.png")
        await page.click("#setup .btn.primary")
        await page.wait_for_timeout(900)
        urls = [t["url"] for t in (await api(page, "/api/state"))["tiles"]]
        check("Assistent: Netflix hinzu, arte entfernt", any("netflix" in u for u in urls) and not any("arte.tv" in u for u in urls), str(urls))
        await page.screenshot(path=SHOTS + "00e_setup_phone.png")
        await page.click("#setup .btn.primary")
        await page.wait_for_timeout(300)
        await page.click("#setup .btn.primary")                    # Fernsehen
        await page.wait_for_timeout(900)
        check("Assistent abgeschlossen", (await api(page, "/api/state"))["general"]["setupDone"] is True and await page.evaluate("S.view") == "home")
        await api(page, "/api/general", "POST", {"city": "Kiel", "lat": 54.3233, "lon": 10.1228})
        await api(page, "/api/profiles", "POST", {"name": "Christian", "color": "#8fb3a0", "pin": "1234"})
        await api(page, "/api/continue", "POST", {"url": "https://www.ardmediathek.de/video/tatort", "title": "Tatort: Borowski", "time": 1200, "duration": 5400, "site": "www.ardmediathek.de"})

        # ---------- Profilauswahl ----------
        await page.evaluate("sessionStorage.clear()")   # wie ein frischer Start
        await page.goto(BASE + "/")
        await page.wait_for_timeout(700)
        check("Profilauswahl erscheint", await page.evaluate("S.view") == "profiles")
        await page.screenshot(path=SHOTS + "01_profiles.png")
        await page.wait_for_timeout(2600)
        check("Standardprofil startet nach 2 s automatisch", await page.evaluate("S.view") == "home")

        # PIN-Profil: falsch, dann richtig
        await page.evaluate("renderProfiles(false)")
        await page.wait_for_timeout(300)
        await page.keyboard.press("ArrowRight")
        check("Pfeil rechts → Profil Christian", "Christian" in (await focused(page) or ""))
        await page.keyboard.press("Enter")
        await page.wait_for_timeout(400)
        for k in "0000":
            await page.keyboard.press(k)
        await page.wait_for_timeout(500)
        check("Falsche PIN wird abgelehnt", await page.evaluate("S.modals.length") == 1)
        for k in "1234":
            await page.keyboard.press(k)
        await page.wait_for_timeout(800)
        st = await api(page, "/api/state")
        check("Richtige PIN → Profil aktiv", st["active"] != "standard" and await page.evaluate("S.view") == "home")
        check("Weiterschauen ist pro Profil getrennt", len(st["continue"]) == 0)
        await page.evaluate("chooseProfile(S.state.profiles[0])")
        await page.wait_for_timeout(600)

        # ---------- Startseite ----------
        check("Weiterschauen-Reihe sichtbar", await page.is_visible("#cw-row .tile"))
        check("Wetter mit Temperatur", "6°" in await page.inner_text("#weather"))
        await page.evaluate("Nav.focus(document.querySelector('#tile-row .tile'), {instant: true})")
        f = await focused(page)
        check("Fokus auf erster Kachel", f == (await page.evaluate("S.state.tiles[0].id")), f)
        await page.keyboard.press("ArrowRight")
        await page.keyboard.press("ArrowRight")
        t2 = await page.evaluate("S.state.tiles[2]")
        check("Pfeil rechts wandert durch Kacheln", await focused(page) == t2["id"])
        check("Info-Bereich zeigt Kachel", t2["title"] in await page.inner_text("#hero-title"))
        await page.keyboard.press("ArrowUp")
        check("Pfeil hoch → Weiterschauen", (await page.evaluate("L.Nav.current.dataset.kind")) == "cw")
        await page.keyboard.press("ArrowUp")
        f = await page.evaluate("L.Nav.current.id")
        check("Pfeil hoch → Knöpfe oben", f in ("btn-profile", "btn-settings", "btn-sleep"), f)
        await page.screenshot(path=SHOTS + "02_home.png")

        # Optionen-Menü + Verschieben
        await page.keyboard.press("ArrowDown")
        await page.keyboard.press("ArrowDown")
        await page.evaluate("if (!L.Nav.current.closest('#tile-row')) Nav.focus(document.querySelector('#tile-row .tile:nth-child(2)'))")
        f0 = await focused(page)
        await page.keyboard.press("m")
        await page.wait_for_timeout(350)
        check("M öffnet Optionen", await page.evaluate("S.modals.length") == 1)
        await page.screenshot(path=SHOTS + "03_menu.png")
        for _ in range(3):
            await page.keyboard.press("ArrowDown")
        await page.keyboard.press("Enter")   # "Nach rechts verschieben"
        await page.wait_for_timeout(700)
        order = [t["id"] for t in (await api(page, "/api/state"))["tiles"]]
        check("Kachel nach rechts verschoben", order.index(f0) >= 1, f"{f0} → {order}")
        check("Fokus bleibt auf verschobener Kachel", await focused(page) == f0)

        # Neue Kachel über den Editor
        await page.evaluate("editTile(null)")
        await page.wait_for_timeout(500)
        await page.screenshot(path=SHOTS + "04_editor.png")
        await page.keyboard.press("ArrowRight")   # Vorlage: YouTube (normal)
        await page.keyboard.press("Enter")
        await page.wait_for_timeout(200)
        name = page.locator(".modal input.inp").first
        await name.fill("Mein YouTube")
        await page.evaluate("document.querySelector('.modal .btn.primary').scrollIntoView()")
        await page.click(".modal .btn.primary")
        await page.wait_for_timeout(700)
        tiles = (await api(page, "/api/state"))["tiles"]
        new = [t for t in tiles if t["title"] == "Mein YouTube"]
        check("Neue Kachel gespeichert", len(new) == 1 and new[0]["url"] == "https://www.youtube.com/", str(new))

        # Ziffer öffnet Kachel (Navigation abfangen)
        await page.evaluate("chooseProfile(S.state.profiles[0])")
        await page.wait_for_timeout(500)
        idx = [t["id"] for t in tiles].index(new[0]["id"]) + 1
        if idx <= 9:
            await page.keyboard.press(str(idx))
            await page.wait_for_timeout(1200)
            check("Ziffer öffnet die richtige Kachel", "youtube.com" in page.url, page.url)
            await page.goto(BASE + "/")
            await page.wait_for_timeout(800)
            check("Zurück auf Startseite ohne erneute Profilauswahl", await page.evaluate("S.view") == "home")

        # Löschen über Menü
        await page.evaluate(f"tileMenu(S.state.tiles.find(t => t.id === '{new[0]['id']}'))")
        await page.wait_for_timeout(300)
        for _ in range(4):
            await page.keyboard.press("ArrowDown")
        await page.keyboard.press("Enter")
        await page.wait_for_timeout(300)
        await page.keyboard.press("ArrowLeft")
        await page.keyboard.press("Enter")   # "Ja"
        await page.wait_for_timeout(700)
        check("Kachel gelöscht", not any(t["title"] == "Mein YouTube" for t in (await api(page, "/api/state"))["tiles"]))

        # ---------- Einstellungen ----------
        await page.keyboard.press("s")
        await page.wait_for_timeout(500)
        check("S öffnet Einstellungen", await page.evaluate("S.view") == "settings")
        sections = await page.evaluate("SECTIONS.map(s => s[0])")
        bad = []
        for i, sec in enumerate(sections):
            await page.evaluate(f"S.section = '{sec}'; renderSection()")
            await page.wait_for_timeout(250)
            txt = await page.inner_text("#s-body")
            if len(txt) < 20:
                bad.append(sec)
            await page.screenshot(path=SHOTS + f"10_settings_{i:02d}_{sec}.png")
        check("Alle Einstellungs-Bereiche zeigen Inhalt", not bad, str(bad))

        # Ton: HDMI wählen
        await page.evaluate("S.section = 'audio'; renderSection()")
        await page.wait_for_timeout(800)
        btns = await page.locator("#s-body .menu-list button").all_inner_texts()
        check("Ton-Ausgänge werden gelistet", len(btns) >= 1, str(btns))
        hdmi = page.locator("#s-body .menu-list button", has_text="HDMI").first
        if await hdmi.count():
            await hdmi.click()
            await page.wait_for_timeout(800)
            a = await api(page, "/api/audio")
            check("HDMI als Ausgang gesetzt", any(s["default"] and s["hdmi"] for s in a["sinks"]), str(a))

        # Wetter-Ort suchen
        await page.evaluate("S.section = 'weather'; renderSection()")
        await page.wait_for_timeout(300)
        await page.fill("#s-body input", "Elmshorn")
        await page.keyboard.press("Enter")
        await page.wait_for_timeout(500)
        await page.keyboard.press("Enter")
        await page.wait_for_timeout(600)
        check("Ort gespeichert", (await api(page, "/api/state"))["general"]["city"] == "Elmshorn")
        await api(page, "/api/general", "POST", {"city": "Kiel", "lat": 54.3233, "lon": 10.1228})

        # Akzentfarbe
        await page.evaluate("S.section = 'look'; renderSection()")
        await page.wait_for_timeout(300)
        await page.locator("#s-body .swatch").nth(2).click()
        await page.wait_for_timeout(400)
        acc = await page.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()")
        check("Akzentfarbe wird sofort übernommen", acc == "#8fb3a0", acc)
        await api(page, "/api/general", "POST", {"accent": "#c8a26b"})

        # Neues Profil mit PIN über Bildschirm-Tastenfeld
        await page.evaluate("S.section = 'profiles'; renderSection(); editProfile(null)")
        await page.wait_for_timeout(400)
        await page.fill(".modal input.inp", "Papa")
        await page.click(".modal .btn >> text=PIN festlegen")
        await page.wait_for_timeout(300)
        for k in "4321":
            await page.click(f".modal-wrap:last-child .pinpad button >> text='{k}'")
        await page.wait_for_timeout(400)
        for k in "4321":
            await page.keyboard.press(k)
        await page.wait_for_timeout(500)
        await page.click(".modal .btn.primary")
        await page.wait_for_timeout(700)
        papa = [x for x in (await api(page, "/api/state"))["profiles"] if x["name"] == "Papa"]
        check("Profil mit PIN über Tastenfeld angelegt", papa and papa[0]["hasPin"], str(papa))

        # Zurück
        await page.keyboard.press("Escape")
        await page.wait_for_timeout(400)
        check("Esc → zurück zur Startseite", await page.evaluate("S.view") == "home")

        # ---------- Ereignisse vom Dienst ----------
        await page.evaluate("openSettings()")
        await page.wait_for_timeout(300)
        await api(page, "/api/key", "POST", {"key": "home"})
        await page.wait_for_timeout(600)
        check("Home-Ereignis → Startseite, erste Kachel", await page.evaluate("S.view") == "home" and await page.evaluate("L.Nav.current.dataset.kind") == "tile")
        await api(page, "/api/key", "POST", {"key": "volup"})
        await page.wait_for_timeout(400)
        check("Lautstärke-Anzeige erscheint", await page.evaluate("document.querySelector('#vol-osd')?.classList.contains('show')"))
        await page.screenshot(path=SHOTS + "05_volume.png")
        await page.evaluate("startSaver()")
        await page.wait_for_timeout(700)
        await page.screenshot(path=SHOTS + "06_saver.png")
        await page.keyboard.press("ArrowRight")
        await page.wait_for_timeout(300)
        check("Taste beendet Bildschirmschoner", not await page.evaluate("S.saverOn"))

        # Konfigurationsänderung vom Handy kommt live an
        await api(page, "/api/tiles", "POST", {"tile": {"title": "Vom Handy", "url": "https://example.org"}})
        await page.wait_for_timeout(800)
        check("Neue Kachel vom Handy erscheint sofort", "Vom Handy" in await page.inner_text("#tile-row"))

        # ---------- Lebendiger Hintergrund ----------
        check("Hintergrund-Animation läuft", await page.evaluate("S.scene.running === true"))
        d = await page.evaluate("S.scene.describe()")
        check("Himmel kennt Tageszeit + Mondphase", bool(d.get("tod")) and bool(d.get("moon")), str(d))
        await page.evaluate("S.scene.preview({hour: 12, kind: 'snow'})"); await page.wait_for_timeout(900)
        await page.screenshot(path=SHOTS + "11_scene_snow_day.png")
        await page.evaluate("S.scene.preview({hour: 22.5, kind: 'clear'})"); await page.wait_for_timeout(900)
        await page.screenshot(path=SHOTS + "12_scene_night.png")
        await page.evaluate("S.scene.preview(null)")

        # ---------- Mediathek ----------
        await page.wait_for_timeout(600)
        n = await page.locator("#media-blocks .tile.mk:not(.search)").count()
        check("Mediathek-Reihen mit Sendungen", n >= 8, str(n))
        await page.evaluate("Nav.focus(document.querySelector('#tile-row .tile'))")
        for _ in range(2):
            await page.keyboard.press("ArrowDown"); await page.wait_for_timeout(450)
        k = await page.evaluate("L.Nav.current.className")
        check("Pfeil runter → in die Mediathek-Reihe", "mk" in k, k)
        await page.keyboard.press("ArrowRight"); await page.wait_for_timeout(300)
        check("Info-Bereich zeigt Sendung", "Borowski" in await page.inner_text("#hero-title") or "Ostsee" in await page.inner_text("#hero-title"), await page.inner_text("#hero-title"))
        await page.screenshot(path=SHOTS + "13_mediathek_row.png")
        # Suche
        await page.evaluate("openSearch('')"); await page.wait_for_timeout(300)
        await page.keyboard.type("Tatort"); await page.keyboard.press("Enter"); await page.wait_for_timeout(800)
        check("Mediathek-Suche liefert Treffer", await page.locator(".search-grid .tile").count() == 3)
        check("Fokus springt in die Treffer", await page.evaluate("L.Nav.current.closest('.search-grid') !== null"))
        await page.screenshot(path=SHOTS + "14_search.png")
        await page.keyboard.press("Escape"); await page.wait_for_timeout(300)
        # Abspielen im eigenen Player
        await page.evaluate("document.querySelector('#media-blocks .tile.mk:not(.search)').click()")
        await page.wait_for_timeout(2500)
        check("Mediathek-Sendung öffnet den Lichtung-Player", "/play.html" in page.url)
        playing = await page.evaluate("!document.getElementById('v').paused || document.getElementById('v').readyState > 1")
        check("Player spielt das Video", playing)
        for _ in range(5):
            await page.keyboard.press("ArrowRight")
        await page.wait_for_timeout(400)
        tpos = await page.evaluate("document.getElementById('v').currentTime")
        check("Pfeil rechts spult vor", tpos >= 45, f"{tpos:.1f}")
        await page.mouse.move(300, 300); await page.mouse.move(320, 330); await page.wait_for_timeout(600)
        await page.screenshot(path=SHOTS + "15_player.png")
        await page.evaluate("save()"); await page.wait_for_timeout(500)
        await page.keyboard.press("Escape"); await page.wait_for_timeout(1500)
        st = await api(page, "/api/state")
        pl = [c for c in st["continue"] if c.get("player")]
        check("Weiterschauen merkt Mediathek-Sendung (mit Player)", len(pl) == 1, str(pl[:1]))
        check("Zurück aus dem Player → Startseite", page.url.rstrip("/").endswith(":8770") or page.url.endswith("/"), page.url)
        if pl:
            await page.wait_for_timeout(800)
            await page.evaluate("openContinue(S.state.continue.find(c => c.player))")
            await page.wait_for_timeout(2500)
            tpos = await page.evaluate("document.getElementById('v').currentTime")
            check("Weiterschauen setzt im Player fort", tpos > 40, f"{tpos:.1f}")
            await page.goto(BASE + "/"); await page.wait_for_timeout(1200)

        # ---------- Schlaf-Timer ----------
        await page.keyboard.press("t"); await page.wait_for_timeout(300)
        check("T öffnet Schlaf-Timer", "Schlaf-Timer" in await page.inner_text(".modal"))
        await page.screenshot(path=SHOTS + "16_sleep_menu.png")
        await page.keyboard.press("ArrowDown"); await page.keyboard.press("Enter"); await page.wait_for_timeout(600)
        check("Timer läuft, Anzeige oben", "30" in await page.inner_text("#sleep-left"), await page.inner_text("#sleep-left"))
        await api(page, "/api/sleep", "POST", {"minutes": 1, "action": "pause"})
        await page.wait_for_timeout(1800)
        check("Warnung 60 s vor Ablauf", await page.evaluate("document.querySelector('.sleep-warn')?.classList.contains('show')"))
        await page.screenshot(path=SHOTS + "17_sleep_warn.png")
        await page.keyboard.press("ArrowLeft"); await page.wait_for_timeout(700)
        sl = (await api(page, "/api/sleep"))
        check("Taste verlängert um 15 Minuten", sl["active"] and sl["left"] > 800, str(sl))
        await api(page, "/api/sleep", "POST", {"cancel": True})

        # ---------- Link aufs TV ----------
        await api(page, "/api/open", "POST", {"url": "Guck mal https://youtu.be/dQw4w9WgXcQ"})
        await page.wait_for_timeout(1500)
        check("Link vom Handy öffnet YouTube-TV-Ansicht", "youtube.com/tv#/watch?v=dQw4w9WgXcQ" in page.url, page.url)
        await page.goto(BASE + "/"); await page.wait_for_timeout(1000)

        # ---------- Live-TV ----------
        live = await ctx.new_page()
        live.on("pageerror", lambda e: errors.append("live: " + str(e)))
        await live.goto(BASE + "/live.html")
        await live.wait_for_timeout(1000)
        await live.wait_for_timeout(600)
        await live.evaluate("loadEpg()"); await live.wait_for_timeout(400)
        check("Live-TV zeigt „Jetzt“ mit Programm", "Tagesschau-Magazin" in await live.inner_text("#osd"), await live.inner_text("#osd"))
        check("Live-TV zeigt „Danach“", "Tatort" in await live.inner_text("#osd"))
        await live.screenshot(path=SHOTS + "07a_live_epg.png")
        n1 = await live.inner_text("#osd .nm")
        await live.keyboard.press("ArrowDown")
        await live.wait_for_timeout(500)
        n2 = await live.inner_text("#osd .nm")
        check("Live-TV: Pfeil runter wechselt Sender", n1 != n2, f"{n1} → {n2}")
        await live.keyboard.press("3")
        await live.wait_for_timeout(1500)
        check("Live-TV: Ziffer 3 → Programmplatz 3", (await live.inner_text("#osd .no")).strip() == "3")
        await live.keyboard.press("Enter")
        await live.wait_for_timeout(500)
        check("Live-TV: Enter öffnet Senderliste", await live.evaluate("document.getElementById('list').classList.contains('show')"))
        await live.keyboard.press("ArrowUp"); await live.keyboard.press("ArrowUp"); await live.wait_for_timeout(400)
        check("Senderliste zeigt Programmvorschau", await live.evaluate("document.getElementById('guide').classList.contains('show')"))
        await live.screenshot(path=SHOTS + "07_live.png")
        await live.keyboard.press("Escape")
        await live.keyboard.press("Escape")
        await live.wait_for_timeout(800)
        check("Live-TV: Esc → Startseite", live.url.rstrip("/") == BASE)
        await live.close()

        # ---------- Handy-Fernbedienung ----------
        m = await b.new_context(viewport={"width": 412, "height": 915}, device_scale_factor=2, is_mobile=True, has_touch=True)
        rp = await m.new_page()
        rp.on("pageerror", lambda e: errors.append("remote: " + str(e)))
        await rp.goto(BASE + "/remote")
        await rp.wait_for_timeout(700)
        await rp.click("nav.tabs button[data-tab=t-tiles]")
        await rp.wait_for_timeout(700)
        n = await rp.locator("#tile-list .item").count()
        check("Fernbedienung listet Kacheln", n >= 6, str(n))
        await rp.locator("#tile-list .item .icon", has_text="✎").first.click()
        await rp.wait_for_timeout(300)
        async with rp.expect_file_chooser() as fc:
            await rp.click("#sheet label.btn.p")
        chooser = await fc.value
        await chooser.set_files("/tmp/shots/ui_02_home.png")
        await rp.wait_for_timeout(1500)
        await rp.click("#sheet .btn.p >> text=Speichern")
        await rp.wait_for_timeout(800)
        t0 = (await api(rp, "/api/state"))["tiles"][0]
        check("Foto vom Handy als Kachelbild gespeichert", t0["image"].startswith("/data/images/"), t0["image"])
        await rp.screenshot(path=SHOTS + "08_remote_tiles.png")
        await rp.click("nav.tabs button[data-tab=t-text]"); await rp.wait_for_timeout(400)
        check("Fernbedienung: zuletzt geschickte Links", await rp.locator("#recent .item").count() >= 1)
        await rp.screenshot(path=SHOTS + "08b_remote_link.png")
        await m.close()

        check("Keine JavaScript-Fehler", not errors, str(errors[:5]))
        await page.goto(BASE + "/")
        await page.wait_for_timeout(1200)
        await page.screenshot(path=SHOTS + "09_home_final.png")
        await b.close()
    ok = sum(1 for _, c in results if c)
    print(f"\nERGEBNIS: {ok}/{len(results)} bestanden")
    sys.exit(0 if ok == len(results) else 1)

asyncio.run(main())
