#!/bin/bash
# Läuft INNERHALB von cage: wartet auf den Lichtung-Dienst und startet dann
# Firefox im Kiosk-Modus. Stürzt Firefox ab oder wird beendet, startet er neu.
PROFILE="$HOME/.lichtung/firefox"
URL="http://127.0.0.1:8770/"

# Bis zu 20 Sekunden warten, bis der Dienst antwortet
for _ in $(seq 1 40); do
  curl -fs -o /dev/null "${URL}api/state" && break
  sleep 0.5
done

# iPhone-Spiegeln (AirPlay): UxPlay läuft still im Hintergrund und öffnet
# erst dann ein Vollbild-Fenster, wenn sich ein iPhone verbindet.
if command -v uxplay >/dev/null; then
  ( while true; do
      uxplay -n "${AIRPLAY_NAME:-Lichtung}" -nh -fs -vs waylandsink -as pulsesink >/tmp/uxplay.log 2>&1
      sleep 3
    done ) &
fi

while true; do
  firefox-esr --kiosk --profile "$PROFILE" --no-remote "$URL"
  sleep 1
done
