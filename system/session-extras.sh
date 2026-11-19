#!/bin/bash
# Lichtung TV – Hintergrundprogramme der sway-Sitzung
#  * wob: Lautstärke-Anzeige, die über ALLEN Programmen erscheint (auch Brave)
#  * UxPlay: iPhone-Spiegeln (AirPlay), wartet still im Hintergrund
#  * KDE Connect: Handy-Verbindung (Medien steuern, Links teilen, Anruf-Pause)
[ -f /etc/lichtung-tv/session.conf ] && . /etc/lichtung-tv/session.conf
RT="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"

# Umgebung (WAYLAND_DISPLAY, SWAYSOCK …) an den Lichtung-Dienst weitergeben
systemctl --user import-environment WAYLAND_DISPLAY SWAYSOCK XDG_CURRENT_DESKTOP 2>/dev/null
dbus-update-activation-environment --systemd WAYLAND_DISPLAY SWAYSOCK XDG_CURRENT_DESKTOP 2>/dev/null

# ---------- Lautstärke-Anzeige ----------
if command -v wob >/dev/null; then
  rm -f "$RT/wob.sock"
  mkfifo "$RT/wob.sock"
  ( while true; do tail -f "$RT/wob.sock" | wob -c /opt/lichtung-tv/system/wob.ini; sleep 2; done ) &
fi

# ---------- iPhone-Spiegeln (AirPlay) ----------
if command -v uxplay >/dev/null; then
  ( while true; do
      uxplay -n "${AIRPLAY_NAME:-Lichtung}" -nh -fs -vs waylandsink -as pulsesink >/tmp/uxplay.log 2>&1
      sleep 3
    done ) &
fi

# ---------- KDE Connect ----------
for d in /usr/lib/x86_64-linux-gnu/libexec/kdeconnectd /usr/libexec/kdeconnectd /usr/lib/kdeconnectd; do
  if [ -x "$d" ]; then ( while true; do "$d" >/tmp/kdeconnect.log 2>&1; sleep 5; done ) & break; fi
done

wait
