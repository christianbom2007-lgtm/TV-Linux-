#!/bin/bash
# ==========================================================================
#  Lichtung TV – Installer für Debian 13 (Trixie)
#  Aufruf (als root, im entpackten Ordner):   bash install.sh
#  Kann jederzeit erneut ausgeführt werden – das ist auch das Update.
#  Deine Kacheln, Profile und Fotos bleiben dabei erhalten.
# ==========================================================================
set -euo pipefail

TV_USER="tv"                      # Benutzer, der automatisch angemeldet wird
APP=/opt/lichtung-tv              # Programmordner
ZOOM="${ZOOM:-1.2}"               # Zoom der Lichtung-Oberfläche (1.0 = normal)
SRC="$(cd "$(dirname "$0")" && pwd)"
STEPS=10

green() { printf '\033[1;32m%s\033[0m\n' "$*"; }
step()  { printf '\n\033[1;33m==> %s\033[0m\n' "$*"; }
warn()  { printf '\033[1;35mHinweis: %s\033[0m\n' "$*"; }
fail()  { printf '\033[1;31mFehler: %s\033[0m\n' "$*"; exit 1; }
# Pakete einzeln versuchen: fehlt eins in Debian, läuft der Rest trotzdem
try_install() { for p in "$@"; do apt-get install -y --no-install-recommends "$p" >/dev/null 2>&1 && echo "  ✓ $p" || echo "  – $p (nicht verfügbar, übersprungen)"; done; }

[ "$(id -u)" -eq 0 ] || fail "Bitte als root starten:  su -  und dann  bash install.sh"
grep -qi 'debian' /etc/os-release || fail "Das ist kein Debian."
. /etc/os-release
[ "${VERSION_ID:-0}" -ge 12 ] 2>/dev/null || echo "Hinweis: getestet für Debian 13, gefunden: ${PRETTY_NAME:-?}"
# Flugmodus (RF-kill) aufheben – auch ohne das Programm "rfkill"
for f in /sys/class/rfkill/*/soft; do [ -w "$f" ] && echo 0 > "$f" 2>/dev/null || true; done
if ! getent hosts deb.debian.org >/dev/null 2>&1; then
  for IF in $(ls /sys/class/net | grep -E '^(wl|en|eth)'); do ifdown --force "$IF" >/dev/null 2>&1; ifup "$IF" >/dev/null 2>&1 || true; done
  sleep 8
fi
getent hosts deb.debian.org >/dev/null 2>&1 || fail "Keine Internetverbindung. Erst Netzwerk einrichten (LAN-Kabel oder WLAN: nmtui)."

# --------------------------------------------------------------------------
step "1/$STEPS  Paketquellen (Debian + Brave)"
[ -f /etc/apt/sources.list ] && sed -i -E '/cdrom:/s/^deb/# deb/' /etc/apt/sources.list
[ -f /etc/network/interfaces ] && sed -i -E 's/^allow-hotplug (wl[^ ]+)/auto \1/' /etc/network/interfaces
command -v rfkill >/dev/null && rfkill unblock all || true
if [ -f /etc/apt/sources.list.d/debian.sources ]; then
  sed -i -E '/^Components:/ { /non-free-firmware/! s/$/ non-free-firmware/; /contrib/! s/$/ contrib/; /non-free( |$)/! s/$/ non-free/ }' /etc/apt/sources.list.d/debian.sources
elif [ -f /etc/apt/sources.list ]; then
  sed -i -E '/^deb / { / non-free-firmware/! s/$/ non-free-firmware/; / contrib/! s/$/ contrib/; / non-free( |$)/! s/$/ non-free/ }' /etc/apt/sources.list
fi
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends curl ca-certificates gnupg
# Brave – offizielle Paketquelle von brave.com
if [ ! -f /usr/share/keyrings/brave-browser-archive-keyring.gpg ]; then
  curl -fsSLo /usr/share/keyrings/brave-browser-archive-keyring.gpg https://brave-browser-apt-release.s3.brave.com/brave-browser-archive-keyring.gpg || warn "Brave-Schlüssel nicht ladbar"
fi
if [ -f /usr/share/keyrings/brave-browser-archive-keyring.gpg ] && [ ! -f /etc/apt/sources.list.d/brave-browser-release.sources ] && [ ! -f /etc/apt/sources.list.d/brave-browser-release.list ]; then
  curl -fsSLo /etc/apt/sources.list.d/brave-browser-release.sources https://brave-browser-apt-release.s3.brave.com/brave-browser.sources \
    || echo "deb [signed-by=/usr/share/keyrings/brave-browser-archive-keyring.gpg arch=amd64] https://brave-browser-apt-release.s3.brave.com/ stable main" > /etc/apt/sources.list.d/brave-browser-release.list
fi
apt-get update

# --------------------------------------------------------------------------
step "2/$STEPS  Pakete installieren (dauert ein paar Minuten)"
apt-get install -y --no-install-recommends \
  sway swaybg xwayland wob wlsunset foot wlr-randr firefox-esr firefox-esr-l10n-de \
  pipewire pipewire-pulse pipewire-alsa wireplumber pipewire-bin rtkit dbus-user-session dbus-bin pulseaudio-utils alsa-utils \
  python3 python3-evdev python3-pil playerctl \
  polkitd libpam-systemd zip unzip ca-certificates pciutils sudo xdg-utils mc \
  fonts-dejavu-core fonts-liberation2 fonts-noto-core fonts-noto-color-emoji \
  mesa-va-drivers mesa-vulkan-drivers libgl1-mesa-dri vainfo \
  network-manager rfkill iw ethtool unattended-upgrades plymouth plymouth-themes grub-common \
  uxplay avahi-daemon gstreamer1.0-plugins-base gstreamer1.0-plugins-good gstreamer1.0-plugins-bad gstreamer1.0-libav gstreamer1.0-pipewire \
  firmware-misc-nonfree firmware-linux-free
echo "Brave:"
apt-get install -y brave-browser || warn "Brave konnte nicht installiert werden – später erneut: bash install.sh"
echo "Bluetooth, Musikbox, KDE Connect:"
try_install bluez bluez-tools libspa-0.2-bluetooth kdeconnect
# Internetradio: mpv spielt die Sender im Hintergrund ab
try_install mpv
echo "Programme & App-Store:"
try_install flatpak gnome-software gnome-software-plugin-flatpak
echo "Terminal-Werkzeuge:"
try_install btop htop fastfetch ncdu tmux git nano
echo "Netzwerk-Dienste (bleiben aus, bis du sie einschaltest):"
try_install syncthing docker.io
systemctl disable --now syncthing@tv >/dev/null 2>&1 || true
# Tailscale (sicherer Fernzugriff) – offizielle Paketquelle
if ! command -v tailscale >/dev/null; then
  CODENAME="${VERSION_CODENAME:-trixie}"
  if curl -fsSL "https://pkgs.tailscale.com/stable/debian/$CODENAME.noarmor.gpg" -o /usr/share/keyrings/tailscale-archive-keyring.gpg; then
    curl -fsSL "https://pkgs.tailscale.com/stable/debian/$CODENAME.tailscale-keyring.list" -o /etc/apt/sources.list.d/tailscale.list && apt-get update >/dev/null 2>&1
    try_install tailscale
    systemctl disable --now tailscaled >/dev/null 2>&1 || true
  else
    warn "Tailscale-Paketquelle nicht erreichbar"
  fi
fi
echo "Retro-Spiele (RetroArch + Emulatoren):"
try_install retroarch libretro-nestopia libretro-snes9x libretro-mgba libretro-gambatte libretro-genesisplusgx libretro-beetle-pce-fast libretro-desmume
# Grafiktreiber für Intel (Videobeschleunigung)
if lspci | grep -qi 'vga.*intel\|display.*intel'; then
  apt-get install -y intel-media-va-driver-non-free i965-va-driver || apt-get install -y intel-media-va-driver i965-va-driver || true
fi
# Android spiegeln: offizielle scrcpy-Version
if [ ! -x /opt/scrcpy/scrcpy ]; then
  SCRCPY_URL=$(curl -fsSL https://api.github.com/repos/Genymobile/scrcpy/releases/latest | grep -oE 'https://[^"]+scrcpy-linux-x86_64-v[0-9.]+\.tar\.gz' | head -n1 || true)
  if [ -n "$SCRCPY_URL" ]; then
    mkdir -p /opt/scrcpy && curl -fsSL "$SCRCPY_URL" | tar xz -C /opt/scrcpy --strip-components=1 && green "scrcpy installiert"
  else
    warn "scrcpy konnte nicht geladen werden – Android-Spiegeln später über 'bash install.sh' nachholen."
  fi
fi
apt-get install -y firmware-iwlwifi firmware-realtek firmware-atheros 2>/dev/null || true
# Ton der Laptop-Lautsprecher: neuere Intel-Laptops (ab ca. 10. Generation) brauchen die
# "Sound Open Firmware" und die passenden Geräteprofile – sonst geht oft nur HDMI.
try_install firmware-sof-signed alsa-ucm-conf firmware-intel-sound

# --------------------------------------------------------------------------
step "3/$STEPS  Benutzer '$TV_USER' anlegen"
if ! id "$TV_USER" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "Lichtung TV" "$TV_USER"
fi
usermod -aG input,video,render,audio "$TV_USER"
getent group bluetooth >/dev/null && usermod -aG bluetooth "$TV_USER"
TV_HOME=$(getent passwd "$TV_USER" | cut -d: -f6)
touch "$TV_HOME/.hushlogin"
mkdir -p "$TV_HOME/Spiele" "$TV_HOME/Downloads"

# --------------------------------------------------------------------------
step "4/$STEPS  Programm nach $APP kopieren"
mkdir -p "$APP"
rm -rf "$APP/web" "$APP/server" "$APP/system" "$APP/extension" "$APP/brave-extension"
cp -r "$SRC/web" "$SRC/server" "$SRC/system" "$SRC/brave-extension" "$SRC/defaults" "$APP/"
cp "$SRC/README.md" "$APP/" 2>/dev/null || true
chmod +x "$APP/system/"*.sh "$APP/system/lichtung-ctl" "$APP/system/lichtung-open" "$APP/system/lichtung"
ln -sf "$APP/system/lichtung" /usr/local/bin/lichtung
# Versionsstand merken (Commit aus git oder aus dem GitHub-Ordnernamen)
COMMIT=$(git -C "$SRC" rev-parse HEAD 2>/dev/null || basename "$SRC" | grep -oE '[0-9a-f]{7,40}$' || echo "")
# RELEASE = Name des getesteten GitHub-Releases (z. B. iso-20261120-1700). Daran erkennt
# der Updater, ob es etwas Neueres gibt. Fehlt die Datei (Paket direkt aus git), bleibt es leer.
RELEASE=$(tr -cd 'a-zA-Z0-9._-' 2>/dev/null < "$SRC/RELEASE" || true)
printf '{"version": "2.0", "release": "%s", "commit": "%s", "installed": "%s", "installedISO": "%s"}\n' "$RELEASE" "$COMMIT" "$(date '+%d.%m.%Y %H:%M')" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" > "$APP/VERSION"
mkdir -p /etc/lichtung-tv
[ -f /etc/lichtung-tv/session.conf ] || cp "$APP/system/session.conf" /etc/lichtung-tv/session.conf
. /etc/lichtung-tv/session.conf
# Tastatur & Bildschirm für sway
cat > /etc/lichtung-tv/sway-local.conf <<EOP
# Vom Installer erzeugt – Änderungen in /etc/lichtung-tv/session.conf machen
input type:keyboard xkb_layout ${KEYBOARD_LAYOUT:-de}
seat * xcursor_theme default ${CURSOR_SIZE:-32}
EOP
mkdir -p /var/tmp/lichtung-update && chown "$TV_USER:$TV_USER" /var/tmp/lichtung-update

# --------------------------------------------------------------------------
step "5/$STEPS  Firefox (Lichtung-Oberfläche) und Brave (Websites) einrichten"
mkdir -p /usr/lib/firefox-esr/distribution
cp "$APP/system/policies.json" /usr/lib/firefox-esr/distribution/policies.json
FF="$TV_HOME/.lichtung/firefox"
mkdir -p "$FF"
rm -f "$FF/extensions/tv@lichtung.local.xpi"           # alte Firefox-Erweiterung (Version 1) entfernen
sed "s/__ZOOM__/$ZOOM/" "$APP/system/user.js" > "$FF/user.js"
# Brave: Einstellungen per Richtlinie (kein Wallet, keine Werbung von Brave, Lesezeichen)
mkdir -p /etc/brave/policies/managed
cp "$APP/system/brave-policies.json" /etc/brave/policies/managed/lichtung.json
if [ ! -f /etc/brave/policies/managed/lichtung-extensions.json ]; then
  # Erweiterungen: uBlock Origin, Return YouTube Dislike, Unhook, Dark Reader, Bonjourr
  bash "$APP/system/lichtung-admin" brave-extensions "cjpalhdlnbpafiamejdnhcphjbkeiagm,gebbhagfogifgggkldgodflihgfeippi,khncfooichmfjbepaaaebmommgaepoid,eimadpbcbfnmbkopoojfekhnkhdbieeh,dlnejlppicbjfcfcedcflplfjajinajd" >/dev/null
fi
chmod 644 /etc/brave/policies/managed/*.json

# --------------------------------------------------------------------------
step "6/$STEPS  Hintergrunddienst, Fenstermanager, Ton und automatischer Start"
mkdir -p "$TV_HOME/.config/systemd/user/default.target.wants"
cp "$APP/system/lichtung-tv.service" "$TV_HOME/.config/systemd/user/lichtung-tv.service"
ln -sf ../lichtung-tv.service "$TV_HOME/.config/systemd/user/default.target.wants/lichtung-tv.service"
mkdir -p "$TV_HOME/.config/wireplumber/wireplumber.conf.d"
cp "$APP/system/51-lichtung-hdmi.conf" "$TV_HOME/.config/wireplumber/wireplumber.conf.d/"
# Links von anderen Programmen (KDE Connect "Teilen") → Lichtung fragt: öffnen oder Kachel?
mkdir -p "$TV_HOME/.local/share/applications" "$TV_HOME/.config"
cp "$APP/system/lichtung-open.desktop" "$TV_HOME/.local/share/applications/"
cat > "$TV_HOME/.config/mimeapps.list" <<'EOP'
[Default Applications]
x-scheme-handler/http=lichtung-open.desktop
x-scheme-handler/https=lichtung-open.desktop
text/html=lichtung-open.desktop
EOP
# Terminal: Begrüßung mit Befehls-Tipps, schönere Eingabezeile
grep -q 'lichtung-bashrc' "$TV_HOME/.bashrc" 2>/dev/null || echo '[ -f /opt/lichtung-tv/system/bashrc ] && . /opt/lichtung-tv/system/bashrc  # lichtung-bashrc' >> "$TV_HOME/.bashrc"
cat > "$TV_HOME/.bash_profile" <<'EOP'
[ -f ~/.bashrc ] && . ~/.bashrc
# Lichtung TV: auf Konsole 1 direkt die Oberfläche starten
if [ "$(tty)" = "/dev/tty1" ]; then
  exec /opt/lichtung-tv/system/session.sh >/tmp/lichtung-session.log 2>&1
fi
EOP
chown -R "$TV_USER:$TV_USER" "$TV_HOME"
# App-Store: Flathub für den Benutzer (Installieren ohne Passwort)
if command -v flatpak >/dev/null; then
  runuser -u "$TV_USER" -- flatpak remote-add --user --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo >/dev/null 2>&1 || warn "Flathub später einrichten"
  # Moonlight: Bild vom Galaxy Book (Sunshine) auf den Fernseher – als zweiter Bildschirm
  if [ "${LICHTUNG_MOONLIGHT:-1}" = "1" ]; then
    echo "Moonlight (Galaxy Book als Bildschirm) – lädt einmalig ca. 400 MB …"
    runuser -u "$TV_USER" -- flatpak install --user -y --noninteractive flathub com.moonlight_stream.Moonlight >/dev/null 2>&1 && echo "  ✓ Moonlight" || warn "Moonlight später über den App-Store installieren"
  fi
fi
# WLAN-Werbeblocker: AdGuard Home (installiert, aber AUS – einschalten unter Einstellungen → Netzwerk-Dienste)
if [ "${LICHTUNG_ADGUARD:-1}" = "1" ] && [ ! -x /opt/AdGuardHome/AdGuardHome ]; then
  if curl -fsSL https://static.adguard.com/adguardhome/release/AdGuardHome_linux_amd64.tar.gz | tar xz -C /opt 2>/dev/null; then
    /opt/AdGuardHome/AdGuardHome -s install >/dev/null 2>&1 || true
    systemctl disable --now AdGuardHome >/dev/null 2>&1 || true
    echo "  ✓ AdGuard Home (aus)"
  else
    warn "AdGuard Home nicht ladbar – später erneut install.sh"
  fi
fi
mkdir -p /etc/systemd/system/getty@tty1.service.d
cat > /etc/systemd/system/getty@tty1.service.d/autologin.conf <<EOP
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin $TV_USER --noclear --skip-login --nonewline --noissue %I \$TERM
EOP
systemctl enable bluetooth >/dev/null 2>&1 || true

# --------------------------------------------------------------------------
step "7/$STEPS  Fernbedienung, Root-Helfer, Deckel, Energiesparen"
echo uinput > /etc/modules-load.d/lichtung.conf
modprobe uinput 2>/dev/null || true
echo 'KERNEL=="uinput", GROUP="input", MODE="0660", OPTIONS+="static_node=uinput"' > /etc/udev/rules.d/70-lichtung-uinput.rules
udevadm control --reload-rules || true
udevadm trigger || true
# Root-Helfer: genau dieses eine Skript darf "tv" ohne Passwort mit Root-Rechten starten
install -m 755 -o root -g root "$APP/system/lichtung-admin" /usr/local/sbin/lichtung-admin
echo "$TV_USER ALL=(root) NOPASSWD: /usr/local/sbin/lichtung-admin" > /etc/sudoers.d/lichtung
chmod 440 /etc/sudoers.d/lichtung
visudo -cf /etc/sudoers.d/lichtung >/dev/null || { rm -f /etc/sudoers.d/lichtung; warn "sudoers-Regel ungültig – entfernt"; }
mkdir -p /etc/systemd/logind.conf.d
cat > /etc/systemd/logind.conf.d/lichtung.conf <<'EOP'
[Login]
HandleLidSwitch=ignore
HandleLidSwitchExternalPower=ignore
HandleLidSwitchDocked=ignore
IdleAction=ignore
HandlePowerKey=poweroff
EOP
systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target >/dev/null 2>&1 || true

# --------------------------------------------------------------------------
step "8/$STEPS  Bootbildschirm & Bootmenü im Lichtung-Stil"
for T in lichtung lichtung-puls lichtung-sterne; do
  mkdir -p "/usr/share/plymouth/themes/$T"
  cp "$APP/system/plymouth/"*.png "/usr/share/plymouth/themes/$T/"
  cp "$APP/system/plymouth/$T.plymouth" "$APP/system/plymouth/$T.script" "/usr/share/plymouth/themes/$T/"
done
if [ -f /etc/default/grub ]; then
  # GRUB-Design: Hintergrund, Schriften aus DejaVu
  GT=/boot/grub/themes/lichtung
  mkdir -p "$GT"
  cp "$APP/system/grub/"* "$GT/"
  if command -v grub-mkfont >/dev/null; then
    grub-mkfont -s 16 -o "$GT/dejavu-sans-16.pf2" /usr/share/fonts/truetype/dejavu/DejaVuSans.ttf 2>/dev/null || true
    grub-mkfont -s 20 -o "$GT/dejavu-sans-20.pf2" /usr/share/fonts/truetype/dejavu/DejaVuSans.ttf 2>/dev/null || true
    grub-mkfont -s 24 -o "$GT/dejavu-sans-24.pf2" /usr/share/fonts/truetype/dejavu/DejaVuSans.ttf 2>/dev/null || true
    grub-mkfont -s 16 -o "$GT/dejavu-mono-16.pf2" /usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf 2>/dev/null || true
  fi
  grep -q '^GRUB_THEME=' /etc/default/grub && sed -i -E "s#^GRUB_THEME=.*#GRUB_THEME=$GT/theme.txt#" /etc/default/grub || echo "GRUB_THEME=$GT/theme.txt" >> /etc/default/grub
  grep -q '^GRUB_GFXMODE=' /etc/default/grub || echo 'GRUB_GFXMODE=1920x1080,1280x720,auto' >> /etc/default/grub
  # Bootmenü standardmäßig versteckt (Esc/Shift beim Start zeigt es) – umschaltbar unter Einstellungen → Start & Boot
  grep -q '^GRUB_TIMEOUT_STYLE=' /etc/default/grub || echo 'GRUB_TIMEOUT_STYLE=hidden' >> /etc/default/grub
  if ! grep -q '^GRUB_TIMEOUT_STYLE=menu' /etc/default/grub; then
    sed -i -E 's/^GRUB_TIMEOUT=.*/GRUB_TIMEOUT=0/; s/^GRUB_TIMEOUT_STYLE=.*/GRUB_TIMEOUT_STYLE=hidden/' /etc/default/grub
  fi
  grep -q '^GRUB_GFXPAYLOAD_LINUX=' /etc/default/grub || echo 'GRUB_GFXPAYLOAD_LINUX=keep' >> /etc/default/grub
  sed -i -E 's/^GRUB_CMDLINE_LINUX_DEFAULT=.*/GRUB_CMDLINE_LINUX_DEFAULT="quiet splash loglevel=3 rd.udev.log_level=3 systemd.show_status=false consoleblank=0 vt.global_cursor_default=0"/' /etc/default/grub
  update-grub >/dev/null 2>&1 || true
fi
mkdir -p /etc/systemd/system/plymouth-quit.service.d
cat > /etc/systemd/system/plymouth-quit.service.d/lichtung.conf <<'EOP'
[Service]
ExecStart=
ExecStart=-/usr/bin/plymouth quit --retain-splash
EOP
mkdir -p /etc/plymouth
CUR_THEME=$(plymouth-set-default-theme 2>/dev/null || echo lichtung)
case "$CUR_THEME" in ""|text|details) CUR_THEME=lichtung ;; esac
printf '[Daemon]\nTheme=%s\nShowDelay=0\n' "$CUR_THEME" > /etc/plymouth/plymouthd.conf
if command -v plymouth-set-default-theme >/dev/null; then
  plymouth-set-default-theme -R "$CUR_THEME" >/dev/null 2>&1 || update-initramfs -u
else
  update-initramfs -u
fi
echo 'APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";' > /etc/apt/apt.conf.d/20auto-upgrades
# Brave-Updates mit einspielen (eigene Paketquelle)
echo 'Unattended-Upgrade::Origins-Pattern { "origin=Brave Software"; };' > /etc/apt/apt.conf.d/52lichtung-brave
systemctl enable NetworkManager >/dev/null 2>&1 || true
systemctl enable avahi-daemon >/dev/null 2>&1 || true

# --------------------------------------------------------------------------
step "9/$STEPS  Samsung Smart View (Miracast-Empfänger, experimentell)"
if [ "${LICHTUNG_MIRACAST:-1}" = "1" ] && ! command -v miracle-wifid >/dev/null; then
  if iw list 2>/dev/null | grep -q 'P2P-GO'; then
    echo "WLAN-Chip kann Wi-Fi Direct – versuche MiracleCast zu bauen (ca. 3 Minuten) …"
    apt-get install -y --no-install-recommends git meson ninja-build gcc pkg-config libglib2.0-dev libudev-dev libsystemd-dev libreadline-dev >/dev/null 2>&1 || true
    ( set +e
      rm -rf /tmp/miraclecast && git clone --depth 1 https://github.com/albfan/miraclecast /tmp/miraclecast >/dev/null 2>&1 \
        && cd /tmp/miraclecast && meson setup build --prefix=/usr/local >/dev/null 2>&1 && ninja -C build install >/dev/null 2>&1 \
        && cp res/org.freedesktop.miracle.conf /etc/dbus-1/system.d/ 2>/dev/null
    ) && command -v miracle-wifid >/dev/null && green "Smart View-Empfänger installiert" || warn "MiracleCast ließ sich nicht bauen – Smart View bleibt aus"
  else
    warn "WLAN-Chip kann kein Wi-Fi Direct – Smart View nicht möglich (KDE Connect & Spiegeln per scrcpy gehen trotzdem)"
  fi
fi

# --------------------------------------------------------------------------
step "10/$STEPS  Fertig prüfen"
python3 -m py_compile "$APP/server/lichtung_server.py" "$APP/server/system.py" && green "Dienst: OK"
command -v sway >/dev/null && sway -C -c "$APP/system/sway.conf" >/dev/null 2>&1 && green "sway: OK" || warn "sway-Konfiguration prüfen: sway -C -c $APP/system/sway.conf"
command -v firefox-esr >/dev/null && green "Firefox ESR (Oberfläche): OK"
command -v brave-browser >/dev/null && green "Brave: OK" || warn "Brave fehlt"
command -v wob >/dev/null && green "Lautstärke-Anzeige (wob): OK"
command -v kdeconnect-cli >/dev/null && green "KDE Connect: OK"
command -v bluetoothctl >/dev/null && green "Bluetooth: OK"
lsmod | grep -q uinput && green "uinput (Handy-Tasten): OK" || echo "uinput wird nach dem Neustart geladen"
echo
echo "Videobeschleunigung (VA-API):"
vainfo 2>/dev/null | grep -E 'Driver version|VAProfileH264|VAProfileVP9|VAProfileAV1' | head -6 || echo "  vainfo ohne Ausgabe – nach dem Neustart erneut prüfen"
echo
green "Installation abgeschlossen. Jetzt neu starten mit:   reboot"
echo "Wartung später: Strg+Alt+F2 → mit deinem Admin-Benutzer anmelden. Zurück zum TV: Strg+Alt+F1"
echo "Bootmenü (z. B. für Notfälle): beim Einschalten Esc oder Shift gedrückt halten."
