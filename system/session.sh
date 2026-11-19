#!/bin/bash
# Wird nach dem automatischen Login auf tty1 gestartet (aus ~/.bash_profile).
# Startet cage – ein "Kiosk-Compositor", der genau EIN Programm im Vollbild zeigt.
[ -f /etc/lichtung-tv/session.conf ] && . /etc/lichtung-tv/session.conf

export XKB_DEFAULT_LAYOUT="${KEYBOARD_LAYOUT:-de}"
export MOZ_ENABLE_WAYLAND=1
export MOZ_DBUS_REMOTE=1
export XCURSOR_SIZE="${CURSOR_SIZE:-32}"
export AIRPLAY_NAME="${AIRPLAY_NAME:-Lichtung}"

# Dienst sicherheitshalber starten (läuft normalerweise schon)
systemctl --user start lichtung-tv.service 2>/dev/null

# -d: keine Fensterrahmen, -s: Wechsel auf andere Konsolen erlauben (Strg+Alt+F2)
# -m last: nur den zuletzt angeschlossenen Bildschirm nutzen (= HDMI-Fernseher)
while true; do
  cage -d -s -m "${OUTPUT_MODE:-last}" -- /opt/lichtung-tv/system/browser-loop.sh
  sleep 2
done
