#!/bin/bash
# ==========================================================================
#  Lichtung TV – Fehlersuche. Aufruf als root:  bash diagnose.sh
#  Prüft Brave/Kacheln, Bluetooth (Musikbox) und den Hintergrunddienst und
#  zeigt alles kompakt auf einem Bildschirm (zum Abfotografieren).
#  Ändert nichts am System, außer einen Test-Tab in Brave zu öffnen.
# ==========================================================================
TV=tv
UID_TV=$(id -u $TV 2>/dev/null)
RUN=/run/user/$UID_TV
SOCK=$(ls -t $RUN/sway-ipc.*.sock 2>/dev/null | head -1)
sw() {   # funktioniert als root und als Benutzer tv
  [ -n "$SOCK" ] || return
  if [ "$(id -u)" = "$UID_TV" ]; then SWAYSOCK="$SOCK" swaymsg "$@" 2>&1; else sudo -u $TV SWAYSOCK="$SOCK" swaymsg "$@" 2>&1; fi
}
asuser() { if [ "$(id -u)" = "$UID_TV" ]; then "$@"; else sudo -u $TV XDG_RUNTIME_DIR=$RUN "$@"; fi; }
ok()  { printf '\033[32mOK\033[0m   %s\n' "$*"; }
no()  { printf '\033[31mFEHLT\033[0m %s\n' "$*"; }
inf() { printf '     %s\n' "$*"; }

echo "== Lichtung Diagnose $(date '+%d.%m. %H:%M') =="
inf "Version: $(cat /opt/lichtung-tv/VERSION 2>/dev/null | head -c 120)"

# --- Oberfläche / sway
[ -n "$SOCK" ] && ok "sway läuft" || no "sway läuft nicht (Oberfläche mit cage/alt?)"
inf "Sitzung: $(pgrep -u $TV -a -f '^(sway|cage)' | head -1 | cut -c1-60)"
curl -fs -o /dev/null http://127.0.0.1:8770/api/state && ok "Lichtung-Dienst antwortet" || no "Lichtung-Dienst antwortet nicht"

# --- Brave
B=$(command -v brave-browser || command -v brave-browser-stable)
[ -n "$B" ] && ok "Brave: $($B --version 2>/dev/null | head -1)" || no "Brave ist nicht installiert"
inf "Brave-Prozesse: $(pgrep -u $TV -c -f brave)"
CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 https://www.ardmediathek.de/)
[ "$CODE" = "200" ] && ok "ARD-Seite erreichbar (Internet)" || no "ARD-Seite antwortet $CODE"

# --- Test: Kachel öffnen wie die Startseite es tut
R=$(curl -s --max-time 15 -X POST -H 'Content-Type: application/json' \
    -d '{"url":"https://www.ardmediathek.de/","mode":"tab"}' http://127.0.0.1:8770/api/browser/open)
inf "Test-Öffnen ARD: $R"
sleep 8
WIN=$(sw -t get_tree | python3 -c '
import json,sys
def walk(n,ws=None,out=[]):
    if n.get("type")=="workspace": ws=n.get("name")
    if n.get("pid") and n.get("type") in ("con","floating_con"):
        out.append("%s[ws %s]%s" % (n.get("app_id") or n.get("window_properties",{}).get("class","?"), ws, " sichtbar" if n.get("visible") else ""))
    for c in n.get("nodes",[])+n.get("floating_nodes",[]): walk(c,ws,out)
    return out
try: print(", ".join(walk(json.load(sys.stdin))) or "keine Fenster")
except Exception as e: print("?", e)' 2>/dev/null)
inf "Fenster: $WIN"
inf "Ebene jetzt: $(sw -t get_workspaces | python3 -c 'import json,sys; print([w["num"] for w in json.load(sys.stdin) if w["focused"]])' 2>/dev/null)"

# --- Fehler aus Sitzung und Dienst
echo "-- Sitzung (letzte Fehler):"
grep -iE 'error|fehler|fail|cannot|denied' /tmp/lichtung-session.log 2>/dev/null | grep -viE 'vaapi|gles|dbus' | tail -4 | cut -c1-110 | sed 's/^/     /'
echo "-- Dienst (letzte Fehler):"
journalctl _UID=$UID_TV --since "-30min" --no-pager -o cat 2>/dev/null | grep -iE 'error|fehler|traceback|exception' | tail -4 | cut -c1-110 | sed 's/^/     /'

# --- Bluetooth (Musikbox)
echo "-- Bluetooth:"
[ -d /sys/class/bluetooth ] && [ -n "$(ls /sys/class/bluetooth 2>/dev/null)" ] && ok "Bluetooth-Chip: $(ls /sys/class/bluetooth | tr '\n' ' ')" || no "kein Bluetooth-Chip erkannt (Treiber/Firmware?)"
for r in /sys/class/rfkill/rfkill*; do
  [ "$(cat $r/type 2>/dev/null)" = "bluetooth" ] && inf "Funk-Sperre $(cat $r/name): soft=$(cat $r/soft) hard=$(cat $r/hard)"
done
systemctl is-active --quiet bluetooth && ok "Bluetooth-Dienst läuft" || no "Bluetooth-Dienst läuft nicht"
command -v bluetoothctl >/dev/null && inf "$(bluetoothctl show 2>/dev/null | grep -E 'Name|Powered|Discoverable:' | tr -s ' \t' ' ' | tr '\n' '|' | cut -c1-110)"
dmesg 2>/dev/null | grep -iE 'bluetooth.*(fail|error|firmware)' | tail -2 | cut -c1-110 | sed 's/^/     /'
# --- Ton
echo "-- Ton:"
dpkg -s firmware-sof-signed >/dev/null 2>&1 && ok "Laptop-Ton-Firmware (SOF) installiert" || no "firmware-sof-signed fehlt (Laptop-Lautsprecher!)"
inf "Soundkarten: $(aplay -l 2>/dev/null | grep -E '^(card|Karte)' | sed -E 's/^(card|Karte) ([0-9]+): ([^ ]+).*\[(.*)\], (device|Gerät) ([0-9]+).*/\2:\4/' | sort -u | tr '\n' ' ' | cut -c1-110)"
asuser pactl list cards 2>/dev/null | grep -E 'Active Profile|Aktives Profil' | sed 's/^\s*/     Profil: /' | cut -c1-110
asuser pactl list short sinks 2>/dev/null | awk '{print "     Ausgang: "$2}' | cut -c1-110
dmesg 2>/dev/null | grep -iE 'sof|snd_hda|sound' | grep -iE 'error|fail|firmware' | tail -3 | cut -c1-110 | sed 's/^/     /'
echo "== Ende – bitte abfotografieren =="
