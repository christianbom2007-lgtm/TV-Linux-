#!/bin/bash
# ==========================================================================
#  Lichtung TV – Installer für Debian 13 (Trixie)
#  Aufruf (als root, im entpackten Ordner):   bash install.sh
#  Kann jederzeit erneut ausgeführt werden – das ist auch das Update.
# ==========================================================================
set -euo pipefail

TV_USER="tv"                      # Benutzer, der automatisch angemeldet wird
APP=/opt/lichtung-tv              # Programmordner
ZOOM="${ZOOM:-1.2}"               # Webseiten-Zoom (1.0 = normal)
SRC="$(cd "$(dirname "$0")" && pwd)"

green() { printf '\033[1;32m%s\033[0m\n' "$*"; }
step()  { printf '\n\033[1;33m==> %s\033[0m\n' "$*"; }
fail()  { printf '\033[1;31mFehler: %s\033[0m\n' "$*"; exit 1; }

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
getent hosts deb.debian.org >/dev/null 2>&1 || fail "Keine Internetverbindung. Erst Netzwerk einrichten (LAN-Kabel oder WLAN)."

# --------------------------------------------------------------------------
step "1/9  Paketquellen prüfen (contrib, non-free-firmware für Treiber)"
# Den Installations-Stick als Paketquelle entfernen (sonst bricht apt ab, sobald der Stick fehlt)
[ -f /etc/apt/sources.list ] && sed -i -E '/cdrom:/s/^deb/# deb/' /etc/apt/sources.list
# WLAN beim Start immer einschalten (der Debian-Installer trägt es nur als "allow-hotplug" ein)
[ -f /etc/network/interfaces ] && sed -i -E 's/^allow-hotplug (wl[^ ]+)/auto \1/' /etc/network/interfaces
command -v rfkill >/dev/null && rfkill unblock all || true
# Debian 13 nutzt das neue Format in /etc/apt/sources.list.d/debian.sources
if [ -f /etc/apt/sources.list.d/debian.sources ]; then
  sed -i -E '/^Components:/ { /non-free-firmware/! s/$/ non-free-firmware/; /contrib/! s/$/ contrib/; /non-free( |$)/! s/$/ non-free/ }' /etc/apt/sources.list.d/debian.sources
elif [ -f /etc/apt/sources.list ]; then
  sed -i -E '/^deb / { / non-free-firmware/! s/$/ non-free-firmware/; / contrib/! s/$/ contrib/; / non-free( |$)/! s/$/ non-free/ }' /etc/apt/sources.list
fi
apt-get update

# --------------------------------------------------------------------------
step "2/9  Pakete installieren (dauert ein paar Minuten)"
export DEBIAN_FRONTEND=noninteractive
apt-get install -y --no-install-recommends \
  cage xwayland firefox-esr firefox-esr-l10n-de \
  pipewire pipewire-pulse pipewire-alsa wireplumber pipewire-bin rtkit dbus-user-session \
  python3 python3-evdev python3-pil \
  polkitd libpam-systemd curl zip ca-certificates pciutils \
  fonts-dejavu-core fonts-liberation2 fonts-noto-core fonts-noto-color-emoji \
  mesa-va-drivers mesa-vulkan-drivers libgl1-mesa-dri vainfo \
  network-manager rfkill unattended-upgrades wlr-randr plymouth plymouth-themes \
  uxplay avahi-daemon gstreamer1.0-plugins-base gstreamer1.0-plugins-good gstreamer1.0-plugins-bad gstreamer1.0-libav gstreamer1.0-pipewire \
  firmware-misc-nonfree firmware-linux-free
# Grafiktreiber für Intel (Videobeschleunigung) – nur wenn Intel-Grafik vorhanden
if lspci | grep -qi 'vga.*intel\|display.*intel'; then
  apt-get install -y intel-media-va-driver-non-free i965-va-driver || apt-get install -y intel-media-va-driver i965-va-driver || true
fi
# Android spiegeln: offizielle scrcpy-Version (enthält adb und den Handy-Teil)
if [ ! -x /opt/scrcpy/scrcpy ]; then
  SCRCPY_URL=$(curl -fsSL https://api.github.com/repos/Genymobile/scrcpy/releases/latest | grep -oE 'https://[^"]+scrcpy-linux-x86_64-v[0-9.]+\.tar\.gz' | head -n1 || true)
  if [ -n "$SCRCPY_URL" ]; then
    mkdir -p /opt/scrcpy && curl -fsSL "$SCRCPY_URL" | tar xz -C /opt/scrcpy --strip-components=1 && green "scrcpy installiert: $SCRCPY_URL"
  else
    echo "Hinweis: scrcpy konnte nicht geladen werden – Android-Spiegeln später über 'bash install.sh' nachholen."
  fi
fi
# WLAN-Firmware (Intel/Realtek/Atheros sind in Lenovo-Laptops häufig)
apt-get install -y firmware-iwlwifi firmware-realtek firmware-atheros 2>/dev/null || true

# --------------------------------------------------------------------------
step "3/9  Benutzer '$TV_USER' anlegen"
if ! id "$TV_USER" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "Lichtung TV" "$TV_USER"
fi
usermod -aG input,video,render,audio "$TV_USER"
TV_HOME=$(getent passwd "$TV_USER" | cut -d: -f6)
touch "$TV_HOME/.hushlogin"   # keine Begrüßungstexte beim Login

# --------------------------------------------------------------------------
step "4/9  Programm nach $APP kopieren"
mkdir -p "$APP"
rm -rf "$APP/web" "$APP/server" "$APP/system" "$APP/extension"
cp -r "$SRC/web" "$SRC/server" "$SRC/system" "$SRC/extension" "$SRC/defaults" "$APP/"
cp "$SRC/README.md" "$APP/" 2>/dev/null || true
chmod +x "$APP/system/"*.sh
# Firefox-Erweiterung packen (.xpi = ZIP-Datei)
( cd "$APP/extension" && rm -f ../lichtung-tv.xpi && zip -qr ../lichtung-tv.xpi . )
mkdir -p /etc/lichtung-tv
[ -f /etc/lichtung-tv/session.conf ] || cp "$APP/system/session.conf" /etc/lichtung-tv/session.conf

# --------------------------------------------------------------------------
step "5/9  Firefox einrichten (Kiosk, uBlock Origin, Lichtung-Erweiterung)"
mkdir -p /usr/lib/firefox-esr/distribution
cp "$APP/system/policies.json" /usr/lib/firefox-esr/distribution/policies.json
FF="$TV_HOME/.lichtung/firefox"
mkdir -p "$FF/extensions"
sed "s/__ZOOM__/$ZOOM/" "$APP/system/user.js" > "$FF/user.js"
cp "$APP/lichtung-tv.xpi" "$FF/extensions/tv@lichtung.local.xpi"

# --------------------------------------------------------------------------
step "6/9  Hintergrunddienst, Ton und automatischer Start"
# Dienst als Benutzer-Dienst (läuft in der Sitzung von '$TV_USER')
mkdir -p "$TV_HOME/.config/systemd/user/default.target.wants"
cp "$APP/system/lichtung-tv.service" "$TV_HOME/.config/systemd/user/lichtung-tv.service"
ln -sf ../lichtung-tv.service "$TV_HOME/.config/systemd/user/default.target.wants/lichtung-tv.service"
# HDMI-Ton bevorzugen
mkdir -p "$TV_HOME/.config/wireplumber/wireplumber.conf.d"
cp "$APP/system/51-lichtung-hdmi.conf" "$TV_HOME/.config/wireplumber/wireplumber.conf.d/"
# Nach dem Login auf tty1 sofort die Fernseh-Oberfläche starten
cat > "$TV_HOME/.bash_profile" <<'EOP'
# Lichtung TV: auf Konsole 1 direkt die Oberfläche starten
if [ "$(tty)" = "/dev/tty1" ]; then
  exec /opt/lichtung-tv/system/session.sh >/tmp/lichtung-session.log 2>&1
fi
EOP
chown -R "$TV_USER:$TV_USER" "$TV_HOME"

# Automatische Anmeldung auf tty1 – ohne Passwort, ohne Login-Bildschirm
mkdir -p /etc/systemd/system/getty@tty1.service.d
cat > /etc/systemd/system/getty@tty1.service.d/autologin.conf <<EOP
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin $TV_USER --noclear --skip-login --nonewline --noissue %I \$TERM
EOP

# --------------------------------------------------------------------------
step "7/9  Fernbedienung, Deckel, Energiesparen"
# Virtuelle Tastatur (für die Handy-Fernbedienung)
echo uinput > /etc/modules-load.d/lichtung.conf
modprobe uinput 2>/dev/null || true
echo 'KERNEL=="uinput", GROUP="input", MODE="0660", OPTIONS+="static_node=uinput"' > /etc/udev/rules.d/70-lichtung-uinput.rules
udevadm control --reload-rules || true
udevadm trigger || true
# Deckel zuklappen darf den Laptop NICHT in den Ruhezustand schicken (HDMI läuft weiter)
mkdir -p /etc/systemd/logind.conf.d
cat > /etc/systemd/logind.conf.d/lichtung.conf <<'EOP'
[Login]
HandleLidSwitch=ignore
HandleLidSwitchExternalPower=ignore
HandleLidSwitchDocked=ignore
IdleAction=ignore
HandlePowerKey=poweroff
EOP
# Ein Fernseher schläft nicht ein
systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target >/dev/null 2>&1 || true

# --------------------------------------------------------------------------
step "8/9  Eigener Bootbildschirm (Lichtung-Logo statt Textausgaben)"
mkdir -p /usr/share/plymouth/themes/lichtung
cp "$APP/system/plymouth/"* /usr/share/plymouth/themes/lichtung/
# Bootmenü verstecken (zum Anzeigen beim Start Esc oder Shift gedrückt halten)
if [ -f /etc/default/grub ]; then
  sed -i -E 's/^GRUB_TIMEOUT=.*/GRUB_TIMEOUT=0/' /etc/default/grub
  grep -q '^GRUB_TIMEOUT_STYLE=' /etc/default/grub && sed -i -E 's/^GRUB_TIMEOUT_STYLE=.*/GRUB_TIMEOUT_STYLE=hidden/' /etc/default/grub || echo 'GRUB_TIMEOUT_STYLE=hidden' >> /etc/default/grub
  grep -q '^GRUB_GFXPAYLOAD_LINUX=' /etc/default/grub || echo 'GRUB_GFXPAYLOAD_LINUX=keep' >> /etc/default/grub
  sed -i -E 's/^GRUB_CMDLINE_LINUX_DEFAULT=.*/GRUB_CMDLINE_LINUX_DEFAULT="quiet splash loglevel=3 rd.udev.log_level=3 systemd.show_status=false consoleblank=0 vt.global_cursor_default=0"/' /etc/default/grub
  update-grub >/dev/null 2>&1 || true
fi
# Logo bleibt stehen, bis die Oberfläche da ist (kein Text-Flackern dazwischen)
mkdir -p /etc/systemd/system/plymouth-quit.service.d
cat > /etc/systemd/system/plymouth-quit.service.d/lichtung.conf <<'EOP'
[Service]
ExecStart=
ExecStart=-/usr/bin/plymouth quit --retain-splash
EOP
# Theme festlegen (Debian: plymouth-set-default-theme; Rückfall: Konfigurationsdatei)
mkdir -p /etc/plymouth
printf '[Daemon]\nTheme=lichtung\nShowDelay=0\n' > /etc/plymouth/plymouthd.conf
if command -v plymouth-set-default-theme >/dev/null; then
  plymouth-set-default-theme -R lichtung >/dev/null 2>&1 || update-initramfs -u
else
  update-initramfs -u
fi
# Sicherheitsupdates automatisch einspielen
echo 'APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";' > /etc/apt/apt.conf.d/20auto-upgrades
systemctl enable NetworkManager >/dev/null 2>&1 || true
systemctl enable avahi-daemon >/dev/null 2>&1 || true   # damit iPhones den Laptop für AirPlay finden

# --------------------------------------------------------------------------
step "9/9  Fertig prüfen"
python3 -m py_compile "$APP/server/lichtung_server.py" && green "Dienst: OK"
command -v cage >/dev/null && green "cage: OK"
command -v firefox-esr >/dev/null && green "Firefox ESR: OK"
lsmod | grep -q uinput && green "uinput (Handy-Tasten): OK" || echo "uinput wird nach dem Neustart geladen"
echo
echo "Videobeschleunigung (VA-API):"
vainfo 2>/dev/null | grep -E 'Driver version|VAProfileH264|VAProfileVP9|VAProfileAV1' | head -6 || echo "  vainfo ohne Ausgabe – nach dem Neustart erneut prüfen"
echo
green "Installation abgeschlossen. Jetzt neu starten mit:   reboot"
echo "Wartung später: Strg+Alt+F2 → mit deinem Admin-Benutzer anmelden. Zurück zum TV: Strg+Alt+F1"
echo "Bootmenü (z. B. für Notfälle): beim Einschalten Esc oder Shift gedrückt halten."
