#!/bin/bash
# Baut lichtung-tv.iso aus der offiziellen Debian-13-Netinst-ISO.
# Läuft in GitHub Actions (siehe .github/workflows/iso.yml) oder auf jedem
# Debian/Ubuntu mit:  sudo apt install xorriso curl  &&  bash iso/build-iso.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${WORK:-$ROOT/build}"
MIRROR="https://cdimage.debian.org/debian-cd/current/amd64/iso-cd"
mkdir -p "$WORK"
cd "$WORK"

echo "==> Aktuelle Debian-13-ISO ermitteln"
curl -fsSL "$MIRROR/SHA256SUMS" -o SHA256SUMS
ISO=$(grep -oE 'debian-1[3-9]\.[0-9.]+-amd64-netinst\.iso' SHA256SUMS | head -n1)
[ -n "$ISO" ] || { echo "Keine Netinst-ISO gefunden"; exit 1; }
echo "    $ISO"
[ -f "$ISO" ] || curl -fL --retry 3 "$MIRROR/$ISO" -o "$ISO"
grep " $ISO\$" SHA256SUMS | sha256sum -c -

echo "==> Bootmenüs anpassen"
rm -rf iso-files && mkdir iso-files
xorriso -osirrox on -indev "$ISO" -extract /boot/grub/grub.cfg iso-files/grub.cfg -extract /isolinux/txt.cfg iso-files/txt.cfg -extract /isolinux/isolinux.cfg iso-files/isolinux.cfg 2>/dev/null
chmod u+w iso-files/*
# GRUB (UEFI): unser Eintrag vor den ersten Original-Eintrag
awk -v f="$ROOT/iso/grub-entry.cfg" 'BEGIN{while((getline l < f)>0) e=e l "\n"} /^menuentry/ && !done {printf "%s", e; done=1} {print}' iso-files/grub.cfg > iso-files/grub.new
mv iso-files/grub.new iso-files/grub.cfg
# ISOLINUX (alte BIOS-Rechner): Eintrag oben, als Standard, 8 Sekunden
{ cat "$ROOT/iso/isolinux-entry.cfg"; sed 's/^\s*menu default//' iso-files/txt.cfg; } > iso-files/txt.new && mv iso-files/txt.new iso-files/txt.cfg
sed -i 's/^timeout .*/timeout 80/' iso-files/isolinux.cfg

echo "==> Lichtung-Dateien einpacken"
rm -rf lichtung && mkdir lichtung
( cd "$ROOT" && cp -r install.sh README.md web server system extension defaults "$WORK/lichtung/" )

OUT="$WORK/lichtung-tv.iso"
rm -f "$OUT"
echo "==> ISO bauen (Bootfähigkeit der Original-ISO wird übernommen)"
xorriso -indev "$ISO" -outdev "$OUT" \
  -map "$ROOT/iso/preseed.cfg" /preseed.cfg \
  -map lichtung /lichtung \
  -map iso-files/grub.cfg /boot/grub/grub.cfg \
  -map iso-files/txt.cfg /isolinux/txt.cfg \
  -map iso-files/isolinux.cfg /isolinux/isolinux.cfg \
  -boot_image any replay

sha256sum "$(basename "$OUT")" > lichtung-tv.iso.sha256
ls -lh "$OUT"
echo "Fertig: $OUT"
