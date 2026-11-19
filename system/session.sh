#!/bin/bash
# Wird nach dem automatischen Login auf tty1 gestartet (aus ~/.bash_profile).
# Startet sway – den Fenstermanager, der Lichtung, Brave und Programme ohne
# sichtbare Fenster verwaltet (Aufbau: siehe system/sway.conf).
[ -f /etc/lichtung-tv/session.conf ] && . /etc/lichtung-tv/session.conf

export XKB_DEFAULT_LAYOUT="${KEYBOARD_LAYOUT:-de}"
export MOZ_ENABLE_WAYLAND=1
export MOZ_DBUS_REMOTE=1
export XCURSOR_SIZE="${CURSOR_SIZE:-32}"
export AIRPLAY_NAME="${AIRPLAY_NAME:-Lichtung}"
export XDG_CURRENT_DESKTOP=sway
export XDG_SESSION_TYPE=wayland
export QT_QPA_PLATFORM="wayland;xcb"
export SDL_VIDEODRIVER=wayland
export _JAVA_AWT_WM_NONREPARENTING=1

# Dienst sicherheitshalber starten (läuft normalerweise schon)
systemctl --user start lichtung-tv.service 2>/dev/null
# Umgebung an systemd/D-Bus weitergeben (damit Dienst und Programme das Bild finden)
systemctl --user import-environment XDG_CURRENT_DESKTOP XDG_SESSION_TYPE 2>/dev/null

while true; do
  if command -v sway >/dev/null; then
    sway --unsupported-gpu -c /opt/lichtung-tv/system/sway.conf
  else
    # Rückfall, falls sway fehlt: alter Kiosk-Modus mit cage
    cage -d -s -m "${OUTPUT_MODE:-last}" -- /opt/lichtung-tv/system/browser-loop.sh
  fi
  sleep 2
done
