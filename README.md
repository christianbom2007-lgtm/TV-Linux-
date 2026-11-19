# Lichtung TV – Installationsanleitung

Dein alter Lenovo-Laptop wird zum Fernseh-Gerät: Er startet ohne Anmeldung direkt in eine Oberfläche im Lichtung-Stil, mit Kacheln für YouTube, Brave, Live-TV, Mediatheken, Musikbox, Ambiente, Programme und beliebige eigene Websites.

> **Achtung:** Bei der Erst-Installation wird die Festplatte des Laptops **komplett gelöscht**. Ein **Update** (Abschnitt U) löscht nichts.

---

## U. Update auf Version 2 (bestehender Laptop)

Version 2 bringt Brave, den Fenstermanager sway (Brave bleibt im Hintergrund offen), reparierte Lautstärketasten, Musikbox, Ambiente, Mediathek-Rekorder, Design-Welten, Netzwerk-Dienste u. v. m. Deine Kacheln, Profile und Fotos bleiben erhalten.

**Weg A – USB-Stick (geht immer, auch bei privatem Repo)**
1. Am Galaxy Book auf GitHub: **Code → Download ZIP** → `TV-Linux--main.zip` auf einen USB-Stick kopieren.
2. Am Laptop: **Strg + Alt + F2**, als `root` anmelden (Passwort 123456), dann:
   ```bash
   mount /dev/sdb1 /mnt          # Stick (bei Bedarf mit lsblk nachsehen)
   cd /root && python3 -m zipfile -e /mnt/TV-Linux--main.zip . && umount /mnt
   cd TV-Linux--main && bash install.sh && reboot
   ```

**Weg B – direkt aus dem Internet (nur wenn das Repo öffentlich ist)**
```bash
cd /root && curl -L https://github.com/christianbom2007-lgtm/TV-Linux-/archive/refs/heads/main.tar.gz | tar xz && cd TV-Linux--main && bash install.sh && reboot
```

**Künftige Updates** gehen ohne Konsole: *Einstellungen → System & Updates → Nach Updates suchen* (braucht einmal einen GitHub-Token, einfügen über die Handy-Fernbedienung → System) **oder** Handy-Fernbedienung → System → „Update-Datei hochladen“ (die ZIP von GitHub).

Das Update dauert 10–25 Minuten (Brave, KDE Connect, Moonlight usw. werden geladen) und braucht ca. 2–3 GB Platz.

---

## 0. Neu installieren: fertige ISO (empfohlen)
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

Nach dem Lichtung-Bootbildschirm erscheint ein Assistent mit 9 Schritten: **Design** (Pakete mit Live-Vorschau – der Hintergrund ändert sich sofort), **Ort**, **Ton** (Testton), **Profile**, **Dienste als Kacheln**, **Brave** (einmalig uBlock einschalten), **Handy** (QR-Code, KDE Connect). Wiederholen: *Einstellungen → System & Updates → Einrichtung wiederholen*.

### Checkliste am echten Gerät
| # | Prüfen | Wenn nicht |
|---|---|---|
| 1 | Bootbildschirm erscheint | *Start & Boot* → andere Bootanimation |
| 2 | Ton über den Fernseher | *Ton* → HDMI |
| 3 | **Lautstärketasten** zeigen die Anzeige – auch in Brave (Balken oben rechts) | *System & Updates → Systeminfo → „Letzte Taste“* |
| 4 | Windows-Taste bringt dich aus Brave zur Startseite, Brave-Tabs bleiben offen | wie 3 |
| 5 | Kachel „YouTube“ öffnet das Kino-Fenster | *Browser & YouTube* |
| 6 | YouTube ohne Werbung | Brave → `brave://settings/extensions/v2` → uBlock Origin an |
| 7 | Live-TV mit „Jetzt / Danach“ | Programmführer lädt bis zu 1 Minute |
| 8 | Handy: Steuerkreuz und „Link aufs TV“ | gleiches WLAN? Code neu erzeugen |
| 9 | Musikbox: Handy findet „Lichtung Musik“ per Bluetooth | *Bluetooth* → Adapter an? |
| 10 | Terminal: Strg+Alt+T, dann `lichtung status` | – |

---

## 5. Bedienung

| Taste | Wirkung |
|---|---|
| ← ↑ → ↓ / Enter | bewegen / öffnen |
| Enter **lang**, ☰, **M**, Rechtsklick | Optionen zur Kachel |
| Esc / Zurück / Rücktaste | zurück |
| **Windows-Taste**, F1, Home | **von überall** zur Startseite – Brave & Programme laufen weiter |
| Windows + Tab | zwischen Startseite, Brave und Programmen wechseln |
| Windows + Q · Taste Q | Schnellmenü (Lautstärke, Tonausgang, Abendmodus, Bildschirm aus, Schlaf-Timer) |
| Windows + B · Taste B | Brave |
| Strg + Alt + T | Terminal |
| / | in die Suchleiste |
| 1–9 · S · T | Kachel direkt · Einstellungen · Schlaf-Timer |
| Lautstärketasten | überall, mit Anzeige |

### Was es alles gibt
- **Brave** – ganz normaler Browser mit Tabs, Adressleiste, Lesezeichenleiste (Mediatheken). Erweiterungen automatisch: uBlock Origin, Return YouTube Dislike, Unhook, Dark Reader, Bonjourr (+ SponsorBlock, DeArrow wählbar). Eigene Lichtung-Erweiterung: Weiterschauen, **YouTube-Kinomodus**, **Auto-HD**, **TV-Zoom**, **gleiche Lautstärke**. Pro Lichtung-Profil eigene Brave-Logins.
- **Kacheln** – Adresse eintippen → „Automatisch“ holt Titel, Text, Logo und Farbe. Größen Klein/Normal/Groß/Banner. Öffnen als Brave-Tab oder Kino-Fenster. Programme als Kacheln. Lesezeichen → Kacheln.
- **Startseite** – Suchleiste, Knöpfe (Brave, YouTube, Mediathek, Zufallsdoku, Webcams, Programme, Terminal, Schnellmenü), **Zuletzt besucht**, **Aufnahmen**, Wetter mit 3-Tage-Vorhersage, **Systemwerte** (CPU, RAM, Temperatur, Netz).
- **Musikbox** – Handy per Bluetooth mit „Lichtung Musik“ verbinden, Titel & Fortschritt groß am TV. iPhone per AirPlay.
- **Ambiente** – Kaminfeuer, Regen am Fenster, Aquarium, Nordlicht, Meeresrauschen, Waldsee – mit Klang (← → wechseln, ↑ ↓ Klang).
- **Live-Webcams** – Kieler Förde & Co. ansehen oder (YouTube-Live/.m3u8) als Hintergrund.
- **Zufallsdoku** – lange Doku aus Terra X, arte, ZDFinfo, 3sat …
- **Mediathek-Rekorder** – lädt neue Folgen deiner Sendungen (z. B. Tatort) automatisch herunter, offline abspielbar, löscht alte selbst.
- **Design** – 19 Design-Pakete: Lichtung-Landschaften (Bergnacht, Waldsee, Leuchtturm, Hafenstadt, Tundra & Nordlicht, Alpen …) und eigene **Design-Welten** im Stil von Apple TV (*Cupertino*), Samsung (*One*), Fire TV (*Flamme*), Xbox (*Konsole*), Windows 11 (*Fenster*), GNOME (*Adwaita*), KDE (*Breeze*), Ubuntu (*Aubergine*) und *Terminal* (Code-Regen). Alles dunkel. Jahreszeiten-Modus, Abendmodus (wärmeres Licht über allem), 4 Bildschirmschoner-Stile.
- **Start & Boot** – 3 Lichtung-Bootanimationen (+ Lenovo-Logo u. a.), Bootmenü im Lichtung-Design an/aus.
- **Programme** – Terminal (`lichtung`-Menü, `btop`), App-Store (Flathub, ohne Passwort), Retro-Spiele (RetroArch), **Galaxy Book als Bildschirm** (Moonlight ↔ Sunshine).
- **Handy** – Fernbedienung im Browser (mehrere Handys, Musikbox-Steuerung, Sicherung, Update-Upload), **KDE Connect** (Medien, Lautstärke, „Teilen → lichtung“, Pause bei Anruf), Android-/iPhone-Spiegeln, Samsung Smart View (experimentell), Wake-on-LAN.
- **Netzwerk-Dienste** (alle aus, bis du sie einschaltest): AdGuard Home (Werbeblocker fürs WLAN), Tailscale, Vaultwarden (Bitwarden, HTTPS über Tailscale), Syncthing, Uptime Kuma, Gitea-Spiegel, **Bau-Station** (GitHub-Actions-Runner für deine Apps).
- **Energie** – Auto-Aus nach X Stunden ohne Eingabe (Bildschirm aus oder ganz aus), Schlaf-Timer.

---

## 6. Worauf du achten solltest (ehrlich)

- **uBlock Origin in Brave** läuft über Braves eigene Manifest-V2-Unterstützung. Einmalig unter `brave://settings/extensions/v2` einschalten. Brave blockt auch ohne uBlock schon viel Werbung (Schutzschild auf „Aggressiv“).
- **Samsung Smart View (Miracast)** ist unter Linux wackelig und geht nur mit WLAN-Chips, die „Wi-Fi Direct“ können. Solange der Empfänger läuft, ist das WLAN-Internet weg. Zuverlässig: KDE Connect bzw. Spiegeln per scrcpy.
- **Bluetooth-Musikbox** braucht einen Bluetooth-Chip im Laptop.
- **Galaxy Book als zweiter Bildschirm** braucht Sunshine + „Virtual Display Driver“ auf Windows (einmal selbst installieren).
- **Bau-Station**: Während eines Flutter-Builds ist der Laptop 2–5 Minuten voll ausgelastet; Android-SDK & Flutter brauchen 5–8 GB.
- **Vaultwarden** nur über Tailscale-HTTPS nutzen (in der Tailscale-Verwaltung „HTTPS Certificates“ aktivieren). Zusätzlich Zwei-Faktor in Bitwarden einschalten.
- **Netflix & Co.** laufen unter Linux nur bis 720p–1080p (Sperre der Anbieter).
- **Live-TV-Streams / Programmführer / Mediathek** hängen an freien Quellen, die sich ändern können.
- **Die PIN ist eine Familien-Sperre, kein Hochsicherheitsschloss.**

---

## 7. Wartung & Fehlersuche

**Terminal**: Strg+Alt+T (oder Kachel/Knopf „Terminal“). Befehl `lichtung` zeigt ein Menü: Status, btop, Programme suchen/installieren, Logs, Neustart, Update. Root für `apt`: `su -`.

**Konsole ohne Oberfläche**: Strg+Alt+F2 → `root`/`chris`. Zurück: Strg+Alt+F1.

| Problem | Lösung |
|---|---|
| Schwarzer Bildschirm | Strg+Alt+F2, `cat /tmp/lichtung-session.log`, `reboot` |
| Lautstärke-/Windows-Taste geht nicht | *Systeminfo* → „Letzte Taste“ und „Lautstärke über …“. Kommt die Taste nicht an: Fn-Taste mit drücken. |
| Kein Ton | Schnellmenü → Tonausgang HDMI |
| Brave hängt | Schnellmenü → „Brave neu starten“ |
| Update-Protokoll | `/var/log/lichtung-update.log` |
| Dienst-Protokoll | `lichtung logs` |
| Alles auf Anfang | als root: `rm /home/tv/.local/share/lichtung-tv/config.json && reboot` |

**Wichtige Orte:** Programm `/opt/lichtung-tv/` · Daten `/home/tv/.local/share/lichtung-tv/` (Aufnahmen in `aufnahmen/`) · Sitzung `/etc/lichtung-tv/session.conf` · Brave-Richtlinien `/etc/brave/policies/managed/` · Root-Helfer `/usr/local/sbin/lichtung-admin`

---

## 8. Wie das Ganze aufgebaut ist

```
Einschalten → GRUB (Lichtung-Design, versteckt) → Plymouth-Bootanimation
  └─ automatische Anmeldung als „tv“ auf Konsole 1
       ├─ lichtung-tv.service   Python-Dienst (Port 8770): API, Kacheln, Wetter, Lautstärke,
       │                        Tasten, Brave/sway-Steuerung, Bluetooth, KDE Connect, Rekorder …
       └─ session.sh → sway (Fenstermanager ohne sichtbare Fenster)
             ├─ Ebene 1: Firefox-Kiosk → Lichtung-Startseite, Live-TV, Player, Ambiente
             ├─ Ebene 2: Brave (normaler Browser, Tabs bleiben offen)
             ├─ Ebene 3: Programme (Terminal, App-Store, Spiele, Moonlight)
             ├─ Ebene 4: Brave-Kinofenster (YouTube ohne Leisten)
             └─ wob (Lautstärke-Anzeige), wlsunset (Abendmodus), UxPlay, KDE Connect
```

| Datei | Was sie macht |
|---|---|
| `server/lichtung_server.py` | Dienst: Webserver + API, Profile, Weiterschauen, Tasten, Lautstärke |
| `server/system.py` | sway, Brave, Programme, Abendmodus, Bluetooth, KDE Connect, Musikbox, Rekorder, Systeminfo, Updates |
| `server/extras.py` | Mediathek, Programmführer, Link-Erkennung |
| `web/app.js`, `extra.js` | Startseite, Einstellungen, Schnellmenü, Design-Pakete |
| `web/scene.js` | lebendige Landschaften + Design-Welt-Hintergründe |
| `web/ambient.html` | Ambiente (Kamin, Regen, Aquarium …) |
| `web/remote.html` | Handy-Fernbedienung |
| `brave-extension/` | Brave-Erweiterung (Weiterschauen, Kinomodus, Auto-HD, Zoom, Lautstärke) |
| `system/sway.conf` | Ebenen und Tastenkürzel |
| `system/lichtung-admin` | Root-Helfer (Update, Boot, Dienste) – per sudo nur dieses Skript |
| `system/lichtung` | Terminal-Befehl |
| `system/grub/`, `system/plymouth/` | Bootmenü und Bootanimationen |
| `install.sh` | richtet alles ein (= Update) |

### Tests
```bash
python3 tests/test_server.py      # 27 Tests: API, Profile, Kacheln, Tasten, Sicherung, Rekorder, Version 2
python3 tests/ui_test.py          # 66 Oberflächen-Tests (Playwright + Chrome, Dienst auf :8770)
python3 tests/ui_test_v2.py       # 35 Tests für Version 2 (Design-Welten, Musikbox, Ambiente …)
```

Schriften: Fraunces und JetBrains Mono (SIL OFL). hls.js (Apache-2.0), qrcode-generator (MIT), Wetter: Open-Meteo.
