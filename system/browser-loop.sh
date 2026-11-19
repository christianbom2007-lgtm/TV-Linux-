#!/bin/bash
# Läuft innerhalb von sway auf Ebene 1: wartet auf den Lichtung-Dienst und
# startet dann Firefox im Kiosk-Modus – NUR für die eigene Oberfläche
# (Startseite, Live-TV, Mediathek-Player). Websites öffnen sich in Brave.
# Stürzt Firefox ab oder wird beendet, startet er neu.
PROFILE="$HOME/.lichtung/firefox"
URL="http://127.0.0.1:8770/"

for _ in $(seq 1 40); do
  curl -fs -o /dev/null "${URL}api/state" && break
  sleep 0.5
done

while true; do
  firefox-esr --kiosk --profile "$PROFILE" --no-remote "$URL"
  sleep 1
done
