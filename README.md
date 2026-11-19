# Lichtung TV – Installationsanleitung

Dein alter Lenovo-Laptop wird zum Fernseh-Gerät: Er startet ohne Anmeldung direkt in eine Oberfläche im Lichtung-Stil, mit Kacheln für YouTube (TV-Ansicht, ohne Werbung), Live-TV, Mediatheken und beliebigen eigenen Websites.

> **Achtung:** Bei der Installation wird die Festplatte des Laptops **komplett gelöscht**. Sichere vorher alles, was du noch brauchst.

---

## 0. Der einfachste Weg: fertige ISO (empfohlen)

GitHub baut bei jeder Änderung automatisch eine fertige **lichtung-tv.iso**: offizielles Debian 13 mit Lichtung schon drin.

1. Im Repo auf **Releases** → neueste Version → `lichtung-tv.iso` herunterladen (~800 MB).
2. Mit **balenaEtcher** auf einen USB-Stick schreiben.
3. Lenovo starten, **F12** drücken, USB-Stick wählen.
4. Im Menü startet nach 8 Sekunden automatisch **„Lichtung TV installieren (automatisch)“**.
5. Ohne LAN-Kabel fragt der Installer einmal nach **WLAN und Passwort**.
6. **Sicherheitsabfrage:** „Änderungen auf die Festplatten schreiben?“ → **Ja**. Ab dann löscht er die interne Festplatte!
7. Nach 20–40 Minuten startet der Laptop von selbst neu: Lichtung-Bootbildschirm → Einrichtungsassistent.

**Zugangsdaten:** Benutzer `root` und `chris`, Passwort jeweils **123456**. Das reicht für ein Gerät im Wohnzimmer, weil von außen kein Login möglich ist (kein SSH installiert). Ändern kannst du es mit `passwd` auf der Konsole.

**Wenn etwas schiefgeht:** Das Protokoll der Lichtung-Installation liegt unter `/var/log/lichtung-install.log`. Notfalls `bash /root/lichtung-tv/install.sh` als root erneut ausführen.

Die Abschnitte 1–3 beschreiben den manuellen Weg ohne ISO.

---

## 1. Was du brauchst

| Was | Wofür |
|---|---|
| Lenovo-Laptop + Netzteil | wird das TV-Gerät |
| USB-Stick, mind. 2 GB | Debian-Installer (wird gelöscht) |
| Zweiter PC (z. B. dein Galaxy Book) | Stick vorbereiten |
| Internet, am besten **LAN-Kabel** | Die Installation lädt Pakete. WLAN geht auch. |
| HDMI-Kabel zum Fernseher/Monitor | |
| Optional: **Air-Mouse-Fernbedienung mit USB-Empfänger** (z. B. „G20S Pro“) | Steuerkreuz + Mauszeiger durch Bewegen. Läuft sofort ohne Einrichtung. |
| Lichtung-Paket `lichtung-tv.tar.gz` | auf einem USB-Stick (kann derselbe Stick sein, nach der Installation) |

---

## 2. Debian 13 installieren (ca. 20 Minuten)

1. **Debian herunterladen:** Auf debian.org → „Download“ → das kleine Image `debian-13.x.x-amd64-netinst.iso`.
2. **Stick erstellen:** Unter Windows mit **Rufus** oder **balenaEtcher** die ISO auf den Stick schreiben.
3. **Vom Stick starten:** Stick in den Lenovo, einschalten und sofort mehrfach **F12** drücken (Boot-Menü). Bei manchen Lenovos stattdessen **Fn+F12** oder das kleine **Novo-Knopfloch** neben dem Stromanschluss (mit Büroklammer drücken → „Boot Menu“). Den USB-Stick wählen.
4. Im Debian-Menü **„Install“** wählen (die Textvariante, ist schneller).
5. Die Fragen so beantworten:

| Frage | Antwort |
|---|---|
| Sprache / Land / Tastatur | Deutsch / Deutschland / Deutsch |
| Rechnername | `lichtung` |
| Domain | leer lassen |
| **Root-Passwort** | Ein Passwort ausdenken und **merken**. Brauchst du gleich. |
| Neuer Benutzer | z. B. `chris` mit eigenem Passwort (das ist dein Admin-Zugang für später) |
| Partitionierung | „Geführt – vollständige Festplatte verwenden“ → „Alle Dateien auf eine Partition“ → bestätigen |
| Paketmanager-Spiegel | Deutschland → deb.debian.org |
| **Softwareauswahl** | **Alles abwählen außer** „SSH-Server“ und „Standard-Systemwerkzeuge“. **Kein** Desktop, **kein** GNOME! |
| GRUB installieren | Ja, auf die Festplatte (`/dev/sda` bzw. `/dev/nvme0n1`) |

6. Stick abziehen, wenn der Neustart kommt. Danach siehst du nur eine schwarze Konsole mit `lichtung login:`. Das ist richtig so.

---

## 3. Lichtung installieren (ca. 5–10 Minuten)

Am Laptop als **root** anmelden (Benutzername `root`, dein Root-Passwort).

### Paket auf den Laptop holen

**Variante A: USB-Stick** (am einfachsten)
1. `lichtung-tv.tar.gz` am PC auf einen USB-Stick kopieren (FAT32 oder exFAT).
2. Am Laptop:
   ```bash
   lsblk                         # Stick suchen, z. B. sdb1 (ca. Größe deines Sticks)
   mount /dev/sdb1 /mnt
   cp /mnt/lichtung-tv.tar.gz /root/
   umount /mnt
   ```

**Variante B: über das Netzwerk vom Galaxy Book** (wenn du im Installer „SSH-Server“ angehakt hast)
1. Am Laptop die IP herausfinden: `ip -4 addr | grep inet`
2. In der Windows-Eingabeaufforderung:
   ```
   scp lichtung-tv.tar.gz chris@192.168.x.x:/home/chris/
   ```
3. Am Laptop: `cp /home/chris/lichtung-tv.tar.gz /root/`

### Installer starten
```bash
cd /root
tar xzf lichtung-tv.tar.gz
cd lichtung-tv
bash install.sh
```
Der Installer zeigt 9 Schritte an. Am Ende steht „Installation abgeschlossen“. Dann:
```bash
reboot
```

Der Laptop startet jetzt direkt in Lichtung. Ab hier brauchst du keine Konsole mehr.

> **Webseiten zu klein oder zu groß?** Den Installer mit anderem Zoom erneut starten, z. B. `ZOOM=1.4 bash install.sh` (Standard ist 1.2).

---

## 4. Erster Start: der Einrichtungsassistent

Beim allerersten Start erscheint nach dem Lichtung-Bootbildschirm ein Assistent mit 7 Schritten. Er fragt nach dem **Ort** (Wetter und Himmel), lässt dich den **Ton** testen (HDMI wählen, es ertönt ein kurzer Testton), richtet die **Profile** ein (auf Wunsch eins mit PIN), fragt, welche **Dienste** Kacheln werden sollen, und koppelt das **Handy** per QR-Code. Wiederholen kannst du ihn jederzeit über *Einstellungen → System → Einrichtung wiederholen*.

Danach:
1. **Profilauswahl:** Nach 2 Sekunden startet automatisch das Standardprofil (ohne PIN).
2. **YouTube testen:** Kachel 01. Die erste Seite kann ein paar Sekunden brauchen, weil uBlock Origin beim allerersten Start noch heruntergeladen wird.
3. **Netflix/Prime/Disney+** (falls gewünscht): Beim ersten Öffnen lädt Firefox automatisch das DRM-Modul (Widevine). Wenn ein Hinweis kommt, „DRM aktivieren“ bestätigen.
4. **Handy als App:** Nach dem QR-Scan im Browser-Menü „Zum Startbildschirm hinzufügen“.

### Checkliste: 10 Punkte am echten Gerät prüfen
Diese Punkte konnte ich ohne deinen Laptop nicht testen. Hake sie einmal ab:

| # | Prüfen | Wenn nicht |
|---|---|---|
| 1 | Bootbildschirm mit „Lichtung“-Schriftzug erscheint | egal für die Funktion, siehe Abschnitt 7 |
| 2 | Ton kommt über den Fernseher | *Einstellungen → Ton* → HDMI |
| 3 | Windows-Taste bringt dich aus YouTube zurück zur Startseite | *Einstellungen → Erweitert*: „Tasten-Dienst aktiv“? |
| 4 | Lautstärketasten zeigen die Anzeige rechts | wie 3 |
| 5 | YouTube öffnet in der **TV-Ansicht** | *Erweitert → TV-Kennung* eine andere Konsole wählen |
| 6 | YouTube ohne Werbung | ein paar Minuten warten (uBlock lädt Filter) |
| 7 | Live-TV: Das Erste läuft, darunter steht „Jetzt / Danach“ | Programmführer lädt beim ersten Start bis zu 1 Minute |
| 8 | Mediathek-Reihen zeigen Sendungen und spielen ab | Internet prüfen |
| 9 | Handy: Steuerkreuz und „Link aufs TV“ funktionieren | gleiches WLAN? Code neu erzeugen |
| 10 | Schlaf-Timer 1 Minute über Handy → Bildschirm geht aus, Taste weckt ihn | Aktion „Pausieren“ wählen |

---

## 5. Bedienung

| Taste | Wirkung |
|---|---|
| ← ↑ → ↓ | bewegen |
| Enter / OK | öffnen |
| Enter **lang drücken**, ☰-Taste, **M** oder Rechtsklick | Optionen zur Kachel (bearbeiten, verschieben, löschen) |
| Esc / Zurück / Rücktaste | zurück |
| **Windows-Taste**, **F1** oder Home-Taste der Fernbedienung | **von überall zurück zur Startseite** |
| 1–9 | Kachel direkt öffnen |
| S | Einstellungen |
| T | Schlaf-Timer |
| Lautstärketasten | Lautstärke + Anzeige rechts |
| Live-TV: ↑ ↓ / Bild↑ Bild↓ / Ziffern | Sender wechseln |
| Live-TV: Enter | Senderliste |
| Auf Webseiten: Strg + / Strg − | Seite größer/kleiner |

**Maus / Air-Mouse / Touchpad funktionieren überall.** Normale Webseiten wie die Mediatheken sind nicht für Pfeiltasten gebaut. Dort ist eine Air-Mouse oder das Handy-Touchpad am angenehmsten.

### Mediathek auf der Startseite
Unter den Kacheln stehen Reihen mit aktuellen Sendungen: **Neu in der Mediathek**, **tagesschau** (20 Uhr), **Tatort & Krimi**, **Terra X & Dokus**. Ganz vorn ist **Mediathek durchsuchen**. Sendungen laufen im eigenen **Lichtung-Player**, ohne Webseite, also komplett per Fernbedienung (OK = Pause, ← → = 10 s, gedrückt halten = schneller, ↑ ↓ = 5 Min.). Was du anfängst, landet in *Weiterschauen*. Die Daten kommen aus dem offenen Verzeichnis von MediathekViewWeb.

### Lebendiger Hintergrund
Der Himmel folgt dem echten Sonnenstand in deinem Ort (Nacht, Blaue Stunde, Abendrot, Tag), zeigt den Mond mit echter Mondphase, Sterne und gelegentlich Sternschnuppen. Dazu kommt das echte Wetter: Wolken nach Bewölkung, die mit dem Wind ziehen, Regen, Niesel, Schnee, Nebel, Gewitter mit Blitzen. Im Winter liegen Schneekappen auf den Bergen, in Sommernächten fliegen im Nebelwald Glühwürmchen, tagsüber ziehen manchmal Vögel vorbei. Unter *Einstellungen → Aussehen* gibt es Animation (Aus/Sanft/Voll), Wetter-Effekte, Polarlicht und eine **Vorschau**, mit der du jedes Wetter und jede Tageszeit ausprobieren kannst.

### Schlaf-Timer
Taste **T** (oder der Mond-Knopf oben): 15 bis 120 Minuten. Danach wird pausiert und, je nach Einstellung, der Bildschirm ausgeschaltet oder der Laptop heruntergefahren. 60 Sekunden vorher kommt eine Warnung. Eine beliebige Taste verlängert um 15 Minuten.

### Handy spiegeln
- **iPhone/iPad:** Kontrollzentrum → Bildschirmsynchronisierung → „Lichtung“. Der ganze Bildschirm erscheint im Vollbild (AirPlay über UxPlay).
- **YouTube (Android & iPhone):** In der YouTube-TV-Ansicht unter Einstellungen „Mit Smartphone verbinden“ den TV-Code anzeigen, in der YouTube-App eingeben, dann per Cast-Symbol Videos schicken.
- **Android-Bildschirm** (Smart View/Miracast) wird unter Linux nicht zuverlässig unterstützt. Links schickst du stattdessen über die Handy-Fernbedienung.
- Die Kachel **„Handy spiegeln“** zeigt diese Anleitung auch am Fernseher.

### Handy-Fernbedienung
- **Steuern:** Steuerkreuz, OK, Zurück, Start, Lautstärke, Pause, Vollbild
- **Maus:** Touchpad (wischen = Zeiger, tippen = Klick, rechter Streifen = scrollen)
- **Steuern:** zusätzlich Schlaf-Timer (30/60/90 Min.) und „Bildschirm aus“
- **Text & Link:** Text am Handy schreiben, er erscheint im aktiven Feld am Fernseher (z. B. YouTube-Suche, Passwörter). Darüber: **Link aufs TV**. Einen Link einfügen (z. B. aus WhatsApp) und auf Öffnen tippen. YouTube-Links öffnen in der TV-Ansicht, Videodateien im Lichtung-Player, alles andere als Webseite. Die letzten 8 Links bleiben gespeichert.
- **Kacheln:** bearbeiten, neue anlegen, **eigene Fotos als Kachelbild hochladen**, Profil wechseln
- **Aussehen:** eigene Fotos als Hintergrund (lange drücken = entfernen)

---

## 6. Worauf du achten solltest (ehrlich)

- **YouTube ohne Werbung** läuft über uBlock Origin. YouTube kämpft aktiv gegen Werbeblocker. Es kann also mal ein paar Tage Werbung oder Fehlermeldungen geben, bis uBlock ein Update hat (kommt automatisch).
- **YouTube-TV-Ansicht** (`youtube.com/tv`) zeigt sich nur, wenn der Browser sich als Fernseher ausgibt. Falls YouTube das irgendwann blockiert: Unter *Einstellungen → Erweitert → TV-Kennung* eine andere Kennung eintragen oder die Kachel auf „YouTube (normal)“ umstellen.
- **Netflix & Co.** laufen unter Linux in Firefox nur in **max. 720p–1080p**, nicht in 4K. Das ist eine Sperre der Anbieter.
- **Logins sind für alle Profile gleich.** Profile trennen Kacheln und Weiterschauen, aber nicht die Browser-Anmeldungen (YouTube-Konto, Netflix …).
- **Die PIN ist eine Familien-Sperre, kein Hochsicherheitsschloss.**
- **Programmführer (Jetzt/Danach)** kommt aus einer freien XMLTV-Quelle (iptv-epg.org). Solche Quellen können ausfallen. Dann läuft Live-TV normal weiter, nur ohne Programmzeile. Eine andere Quelle kannst du in der Konfiguration (`epgUrl`) eintragen.
- **Mediathek-Reihen** hängen am Dienst MediathekViewWeb. Ist er nicht erreichbar, siehst du einen Hinweis statt Sendungen. Die Mediathek-Kacheln funktionieren trotzdem.
- **Live-TV-Streams** sind die offiziellen Streams der Sender. Sie funktionieren nur in Deutschland, und die Sender ändern ihre Adressen gelegentlich. Neue Adressen kannst du unter *Live-TV-Sender* eintragen.
- **Weiterschauen** merkt sich Videos ab 2 Minuten Länge, sobald du mehr als 30 Sekunden geschaut hast. Bei über 95 % gilt das Video als fertig.
- **Deckel zuklappen** ist erlaubt. Der Laptop geht nicht in den Ruhezustand. Zum Ausschalten: *Einstellungen → System → Ausschalten* oder kurz den Einschaltknopf drücken.
- **Updates:** Sicherheitsupdates (inkl. Firefox) installiert Debian automatisch. Für ein neues Lichtung-Paket einfach `bash install.sh` aus dem neuen Ordner erneut ausführen. Deine Kacheln und Profile bleiben erhalten.

---

## 7. Wartung & Fehlersuche

**An die Konsole kommen:** `Strg + Alt + F2` → als `root` oder `chris` anmelden. **Zurück zum Fernseher:** `Strg + Alt + F1`.

**Bootmenü** (z. B. für Notfälle oder einen älteren Kernel): beim Einschalten **Esc** oder **Shift** gedrückt halten.

| Problem | Lösung |
|---|---|
| Schwarzer Bildschirm nach dem Start | `Strg+Alt+F2`, anmelden, `cat /tmp/lichtung-session.log` ansehen. Oft hilft `reboot`. |
| Kein Ton | *Einstellungen → Ton* → HDMI wählen. Am Fernseher den richtigen Eingang/Lautstärke prüfen. |
| Video ruckelt | Konsole: `vainfo` muss Profile wie `VAProfileH264` zeigen. Sonst ist die Videobeschleunigung aus. Bei älteren Intel-Chips hilft die Firefox-Erweiterung „enhanced-h264ify“. |
| Home-/Lautstärketasten gehen nicht | *Einstellungen → Erweitert* zeigt, ob der Tasten-Dienst läuft. Neustart probieren. |
| Handy verbindet nicht | Gleiches WLAN? Adresse und Code stehen unter *Handy-Fernbedienung*. „Neuen Code erzeugen“ und QR neu scannen. |
| WLAN später ändern | Konsole als root: `nmtui` |
| Alles auf Anfang | Konsole als root: `rm /home/tv/.local/share/lichtung-tv/config.json` und `reboot` |
| Dienst-Protokoll | `journalctl _UID=$(id -u tv) -n 80` |

**Wichtige Orte:**
- Programm: `/opt/lichtung-tv/`
- Deine Daten (Kacheln, Profile, Fotos): `/home/tv/.local/share/lichtung-tv/`
- Sitzungs-Einstellungen (Tastatur, Bildschirm): `/etc/lichtung-tv/session.conf`

---

## 8. Wie das Ganze aufgebaut ist (zum Verstehen und Weiterbauen)

```
Einschalten
  └─ GRUB (1 s) → Debian
       └─ automatische Anmeldung als Benutzer „tv“ auf Konsole 1
            ├─ lichtung-tv.service   Python-Dienst (Port 8770)
            │     Kacheln/Profile speichern, Wetter, Lautstärke,
            │     Home-/Lautstärketasten mitlesen (evdev),
            │     virtuelle Tastatur fürs Handy (uinput)
            └─ session.sh → cage (zeigt EIN Programm im Vollbild)
                  └─ Firefox ESR im Kiosk-Modus
                        ├─ Startseite  http://127.0.0.1:8770/
                        ├─ uBlock Origin (Werbung weg)
                        └─ Lichtung-Erweiterung: Home-Taste, Lautstärke-Anzeige,
                           Weiterschauen, TV-Kennung für youtube.com/tv
```

| Datei | Was sie macht |
|---|---|
| `server/lichtung_server.py` | Hintergrunddienst: Webserver + API, Profile, Weiterschauen, Wetter, Tasten, Lautstärke, Ton-Ausgang |
| `web/index.html`, `app.js`, `app.css` | Startoberfläche: Profilauswahl, Kacheln, Einstellungen, Bildschirmschoner |
| `web/common.js` | Gemeinsame Bausteine, v. a. die **Pfeiltasten-Navigation** (springt zum räumlich nächsten Element) |
| `web/bg.js` | Zeichnet die Naturhintergründe per Code |
| `web/live.html` | Live-TV-Player (hls.js) mit Jetzt/Danach |
| `web/play.html` | Lichtung-Player für Mediathek und Links |
| `web/scene.js` | Lebendiger Hintergrund (Sonne, Mond, Wetter, Animation) |
| `web/features.js` | Mediathek-Reihen, Suche, Schlaf-Timer, Links |
| `web/setup.js` | Einrichtungsassistent |
| `server/extras.py` | Mediathek-Abfragen, Programmführer, Link-Erkennung |
| `system/plymouth/` | Bootbildschirm |
| `tests/` | automatische Tests (Dienst + Oberfläche) |
| `iso/` | Bau der fertigen Installations-ISO (Antwortdatei, Bootmenü, Bauskript) |
| `.github/workflows/iso.yml` | GitHub baut die ISO automatisch und stellt sie unter Releases bereit |
| `web/remote.html` | Handy-Fernbedienung (inkl. Link aufs TV, Schlaf-Timer) |
| `extension/` | Firefox-Erweiterung (Brücke zwischen Webseiten und Dienst) |
| `system/` | Startskripte, Firefox-Einstellungen, Ton-Regel |
| `install.sh` | richtet alles ein |
| `defaults/config.json` | Startkonfiguration (Kacheln, Sender, Kiel als Ort) |

Alle Dateien sind ausführlich auf Deutsch kommentiert.

### Tests selbst laufen lassen
```bash
python3 tests/test_server.py      # 18 Tests: API, Profile/PIN, Weiterschauen, Tasten, Tippen, Mediathek, Programmführer, Schlaf-Timer, Links
python3 tests/ui_test.py          # 66 Oberflächen-Tests (braucht Playwright + Chrome und einen laufenden Dienst)
```

Schriften: Fraunces und JetBrains Mono (SIL Open Font License). Live-TV: hls.js (Apache-2.0). QR-Codes: qrcode-generator (MIT). Wetter: Open-Meteo.
