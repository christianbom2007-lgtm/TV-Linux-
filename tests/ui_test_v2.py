#!/usr/bin/env python3
"""Oberflächen-Test Version 2: Design-Welten, Schnellmenü, Programme, Musikbox,
Ambiente, Webcams, Rekorder, Dienste, Handy-Fernbedienung.
Voraussetzung wie ui_test.py: Dienst läuft auf :8770 (Einrichtung erledigt)."""
import asyncio, json, sys
from playwright.async_api import async_playwright
BASE = "http://127.0.0.1:8770"
SHOTS = "/tmp/shots/v2_"
WEATHER = {"city": "Kiel", "current": {"temperature_2m": 4.1, "weather_code": 2, "is_day": 0, "cloud_cover": 40, "wind_speed_10m": 14},
           "daily": {"time": ["2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22"], "weather_code": [2, 3, 61, 71],
                     "temperature_2m_max": [7, 8, 6, 3], "temperature_2m_min": [2, 3, 1, -2]}}
results = []
def check(name, cond, info=""):
    results.append(bool(cond)); print(("OK  " if cond else "FAIL"), name, info, flush=True)

async def api(page, path, method="GET", body=None):
    return await page.evaluate("""async ([p, m, b]) => { const r = await fetch(p, {method: m, headers: {'Content-Type':'application/json'}, body: b ? JSON.stringify(b) : undefined}); return r.json(); }""", [path, method, body])

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox", "--autoplay-policy=no-user-gesture-required"])
        ctx = await b.new_context(viewport={"width": 1920, "height": 1080})
        async def mocks(route):
            u = route.request.url
            if "/api/weather" in u: return await route.fulfill(status=200, content_type="application/json", body=json.dumps(WEATHER))
            if "/api/mediathek" in u and "random" not in u: return await route.fulfill(status=200, content_type="application/json", body=json.dumps({"rows": []}))
            if not u.startswith(BASE): return await route.fulfill(status=200, content_type="text/html", body="<h1>extern</h1>")
            return await route.continue_()
        await ctx.route("**/*", mocks)
        page = await ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        await page.goto(BASE + "/"); await page.wait_for_timeout(1500)
        await page.evaluate("chooseProfile(S.state.profiles.find(p=>p.isDefault))"); await page.wait_for_timeout(900)

        # Design-Welten
        pk = await page.evaluate("PACKAGES.map(p=>p.id)")
        check("Design-Pakete vorhanden", len(pk) >= 18, str(len(pk)))
        for pid in ["p_cupertino", "p_one", "p_flamme", "p_konsole", "p_fenster", "p_adwaita", "p_breeze", "p_aubergine", "p_matrix", "nordlicht", "hafen", "kueste"]:
            await page.evaluate(f"applyPackage(PACKAGES.find(p=>p.id==='{pid}'))"); await page.wait_for_timeout(900)
            th = await page.evaluate("S.state.general.theme")
            await page.evaluate("Nav.focus(document.querySelector('#tile-row .tile'))"); await page.wait_for_timeout(300)
            await page.screenshot(path=SHOTS + f"theme_{pid}.png")
            check(f"Paket {pid} → Designart {th}", await page.evaluate(f"document.body.classList.contains('theme-{th}')"))
        await page.evaluate("applyPackage(PACKAGES.find(p=>p.id==='klassik'))"); await page.wait_for_timeout(600)

        # Suchleiste & Knöpfe
        check("Suchleiste da", await page.locator("#search-inp").count() == 1)
        n = await page.locator("#quick-row .qbtn").count()
        check("Schnellknöpfe da (Brave, YouTube, Terminal …)", n >= 8, str(n))
        check("Systemwerte oben rechts", "CPU" in await page.inner_text("#stats"))

        # Schnellmenü
        await page.keyboard.press("q"); await page.wait_for_timeout(600)
        check("Q öffnet Schnellmenü", await page.locator(".quick-modal").count() == 1)
        await page.screenshot(path=SHOTS + "quick.png")
        await page.keyboard.press("Escape"); await page.wait_for_timeout(300)

        # Programme
        await page.evaluate("appsPicker()"); await page.wait_for_timeout(800)
        names = await page.locator(".app-card b").all_inner_texts()
        check("Programme-Auswahl listet Terminal & App-Store", "Terminal" in names and "App-Store" in names, str(names[:6]))
        await page.screenshot(path=SHOTS + "apps.png")
        await page.keyboard.press("Escape"); await page.wait_for_timeout(300)

        # Musikbox
        await page.evaluate("musicBox()"); await page.wait_for_timeout(1200)
        check("Musikbox öffnet", await page.locator(".musicbox").count() == 1)
        await page.screenshot(path=SHOTS + "musicbox.png")
        await page.keyboard.press("Escape"); await page.wait_for_timeout(300)

        # Webcams
        await page.evaluate("webcamPicker()"); await page.wait_for_timeout(500)
        check("Webcam-Liste mit Kiel", "Kiel" in await page.inner_text(".modal"))
        await page.screenshot(path=SHOTS + "webcams.png")
        await page.keyboard.press("Escape"); await page.wait_for_timeout(300)

        # Kachel-Editor: Automatisch (Seite nicht erreichbar → Name aus Adresse)
        await page.evaluate("editTile(null)"); await page.wait_for_timeout(400)
        await page.locator(".modal input.inp").nth(0).fill("example.org")
        await page.click(".modal .btn >> text=Automatisch"); await page.wait_for_timeout(2500)
        check("Automatisch füllt einen Namen", len(await page.locator(".modal input.inp").nth(1).input_value()) > 0)
        await page.screenshot(path=SHOTS + "editor_auto.png")
        await page.keyboard.press("Escape"); await page.wait_for_timeout(300)

        # Einstellungen: neue Bereiche
        for sec in ["browser", "apps", "recorder", "look", "boot", "remote", "bluetooth", "services", "power", "system", "help"]:
            await page.evaluate(f"openSettings('{sec}')"); await page.wait_for_timeout(1300)
            txt = await page.inner_text("#s-body")
            check(f"Einstellungen: {sec}", len(txt) > 80, str(len(txt)))
            await page.screenshot(path=SHOTS + f"set_{sec}.png")
        await page.evaluate("closeSettings()"); await page.wait_for_timeout(400)

        # Ambiente
        amb = await ctx.new_page()
        amb.on("pageerror", lambda e: errors.append("ambient: " + str(e)))
        await amb.goto(BASE + "/ambient.html"); await amb.wait_for_timeout(2500)
        await amb.screenshot(path=SHOTS + "ambient_kamin.png")
        for i, nm in enumerate(["regen", "aquarium", "nordlicht", "meer"]):
            await amb.keyboard.press("ArrowRight"); await amb.wait_for_timeout(2200)
            await amb.screenshot(path=SHOTS + f"ambient_{nm}.png")
        check("Ambiente wechselt Szenen", "s=meer" in amb.url, amb.url)
        await amb.close()

        # Fernbedienung
        pin = (await api(page, "/api/netinfo"))["pin"]
        phone = await b.new_page(viewport={"width": 412, "height": 915}, device_scale_factor=2)
        phone.on("pageerror", lambda e: errors.append("remote: " + str(e)))
        await phone.goto(BASE + "/remote#" + pin); await phone.wait_for_timeout(1500)
        await phone.screenshot(path=SHOTS + "remote_ctrl.png", full_page=True)
        await phone.click("nav.tabs button[data-tab=t-sys]"); await phone.wait_for_timeout(800)
        check("Fernbedienung: System-Reiter", "Sicherung" in await phone.inner_text("#t-sys"))
        await phone.screenshot(path=SHOTS + "remote_sys.png", full_page=True)

        check("Keine JavaScript-Fehler", not errors, str(errors[:3]))
        await b.close()
    print(f"\nERGEBNIS: {sum(results)}/{len(results)} bestanden")
    sys.exit(0 if all(results) else 1)
asyncio.run(main())
