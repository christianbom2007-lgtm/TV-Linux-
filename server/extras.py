# -*- coding: utf-8 -*-
"""
Lichtung TV – Zusatzfunktionen
================================
  * Mediathek: aktuelle Sendungen von ARD, ZDF, arte, 3sat, NDR … über das
    offene Verzeichnis von MediathekViewWeb (https://mediathekviewweb.de)
  * Programmführer (EPG): "Jetzt / Danach" für die Live-Sender aus einer
    XMLTV-Datei (Standard: iptv-epg.org), täglich aktualisiert
  * Links aufs TV: YouTube-, Mediathek- oder Videolinks in die passende Ansicht umwandeln
"""

import gzip
import io
import json
import os
import re
import threading
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

UA = {"User-Agent": "LichtungTV/1.1 (+Heimgeraet)"}


def http_post_json(url, payload, timeout=10):
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={**UA, "Content-Type": "text/plain"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


# ==========================================================================
# Mediathek
# ==========================================================================

MVW_URL = "https://mediathekviewweb.de/api/query"
MEDIA_CACHE = {}          # Reihen-Schlüssel → (Zeitpunkt, Ergebnis)
CHANNEL_COLORS = {        # dezente Senderfarben für die Karten (Farbton)
    "ARD": 215, "DAS ERSTE": 215, "ZDF": 28, "ARTE.DE": 12, "ARTE.FR": 12, "3SAT": 345, "NDR": 205, "WDR": 210,
    "BR": 200, "HR": 195, "MDR": 225, "SWR": 230, "RBB": 0, "SR": 220, "KIKA": 120, "PHOENIX": 190,
    "ZDF-TIVI": 30, "FUNK.NET": 290, "DW": 200, "ORF": 0, "SRF": 0, "RADIO BREMEN TV": 205,
}


def build_query(row, size=30, offset=0):
    """Wandelt eine Reihen-Definition aus der Konfiguration in eine
    MediathekViewWeb-Abfrage um.
    row = {"channels": ["ARD","ZDF"], "topic": "Tatort", "text": "", "minMinutes": 20}"""
    queries = []
    for ch in row.get("channels") or []:
        # mehrere Sender: gleiche Felder → werden vom Server ODER-verknüpft
        queries.append({"fields": ["channel"], "query": ch.lower()})
    if row.get("topic"):
        queries.append({"fields": ["topic"], "query": row["topic"].lower()})
    if row.get("text"):
        queries.append({"fields": ["title", "topic", "description"] if row.get("everywhere") else ["title", "topic"], "query": row["text"].lower()})
    q = {"queries": queries, "sortBy": "timestamp", "sortOrder": "desc", "future": False, "offset": offset, "size": size}
    if row.get("minMinutes"):
        q["duration_min"] = int(row["minMinutes"]) * 60
    return q


def clean_item(e):
    """Nur die Felder, die die Oberfläche braucht. Bevorzugt HD, sonst normal."""
    url = e.get("url_video_hd") or e.get("url_video") or e.get("url_video_low")
    ch = (e.get("channel") or "").upper()
    return {
        "id": e.get("id") or (url or "")[-40:],
        "channel": e.get("channel") or "",
        "topic": e.get("topic") or "",
        "title": e.get("title") or "",
        "description": (e.get("description") or "")[:400],
        "timestamp": int(e.get("timestamp") or 0),
        "duration": int(e.get("duration") or 0),
        "url": url,
        "urlSd": e.get("url_video") or url,
        "website": e.get("url_website") or "",
        "hue": CHANNEL_COLORS.get(ch, 160),
    }


def mediathek_row(row, force=False):
    key = json.dumps(row, sort_keys=True)
    cached = MEDIA_CACHE.get(key)
    if cached and not force and time.time() - cached[0] < 15 * 60:
        return cached[1]
    try:
        res = http_post_json(MVW_URL, build_query(row, size=int(row.get("size") or 30)))
        items = [clean_item(e) for e in (res.get("result") or {}).get("results", []) if e.get("url_video") or e.get("url_video_hd")]
        # gleiche Sendung mehrfach (z. B. mit/ohne Gebärdensprache) → nur einmal zeigen
        seen, out = set(), []
        for it in items:
            sig = (it["topic"].lower(), re.sub(r"\s*\((Audiodeskription|mit Gebärdensprache|Gebärdensprache|AD|UT)\)\s*", "", it["title"], flags=re.I).lower())
            if sig in seen or re.search(r"Audiodeskription|Gebärdensprache|\(AD\)", it["title"], re.I):
                continue
            seen.add(sig)
            out.append(it)
        MEDIA_CACHE[key] = (time.time(), out)
        return out
    except Exception as e:  # offline oder Dienst nicht erreichbar → alte Daten zeigen
        print("Mediathek nicht erreichbar:", e, flush=True)
        return cached[1] if cached else []


def mediathek_search(text):
    return mediathek_row({"text": text, "everywhere": True, "minMinutes": 3, "size": 48}, force=False)


# ==========================================================================
# Programmführer (EPG)
# ==========================================================================

def norm(s):
    """'NDR Schleswig-Holstein HD' → 'ndrschleswigholstein'"""
    s = (s or "").lower().replace("ä", "ae").replace("ö", "oe").replace("ü", "ue").replace("ß", "ss")
    s = re.sub(r"\.(de|at|ch)$", "", s)
    s = re.sub(r"[^a-z0-9]", "", s)
    return re.sub(r"(hd|fernsehen)$", "", s)


def parse_xmltv_time(t):
    # Format: 20261119201500 +0100
    t = t.strip()
    dt = datetime.strptime(t[:14], "%Y%m%d%H%M%S")
    if len(t) > 15:
        sign = 1 if t[15] == "+" else -1
        off = int(t[16:18]) * 3600 + int(t[18:20]) * 60
        return int(dt.replace(tzinfo=timezone.utc).timestamp()) - sign * off
    return int(time.mktime(dt.timetuple()))


class EPG:
    """Lädt eine XMLTV-Datei (auch .gz), behält nur die eigenen Sender und
    die nächsten 30 Stunden. Läuft im Hintergrund, alle 6 Stunden neu."""

    def __init__(self, data_dir, get_config):
        self.path = os.path.join(data_dir, "epg.json")
        self.get_config = get_config
        self.data = {"updated": 0, "channels": {}}   # unsere Sender-ID → Liste von Sendungen
        self.status = "noch nicht geladen"
        try:
            with open(self.path, "r", encoding="utf-8") as f:
                self.data = json.load(f)
                self.status = "aus Zwischenspeicher"
        except Exception:
            pass

    def start(self):
        threading.Thread(target=self.loop, daemon=True).start()

    def loop(self):
        time.sleep(8)  # Start nicht ausbremsen
        while True:
            if time.time() - self.data.get("updated", 0) > 6 * 3600:
                self.refresh()
            time.sleep(900)

    def wanted(self):
        """Für jeden unserer Sender die möglichen Namen in der XMLTV-Datei."""
        cfg = self.get_config()
        out = {}
        for c in cfg.get("channels", []):
            names = set(norm(x) for x in (c.get("epg") or []))
            names.add(norm(c["name"]))
            out[c["id"]] = names
        return out

    def parse(self, stream):
        wanted = self.wanted()
        name_to_ours = {}
        for ours, names in wanted.items():
            for n in names:
                name_to_ours.setdefault(n, ours)
        id_map = {}                    # XMLTV-Kanal-ID → unsere ID
        now = time.time()
        result = {k: [] for k in wanted}
        for event, el in ET.iterparse(stream, events=("end",)):
            if el.tag == "channel":
                xid = el.get("id", "")
                cands = [norm(xid)] + [norm(d.text) for d in el.findall("display-name")]
                for c in cands:
                    if c in name_to_ours:
                        id_map[xid] = name_to_ours[c]
                        break
                el.clear()
            elif el.tag == "programme":
                ours = id_map.get(el.get("channel", ""))
                if ours is None:   # Kanal-Liste fehlte? Dann direkt über die ID versuchen
                    ours = name_to_ours.get(norm(el.get("channel", "")))
                if ours:
                    try:
                        start, stop = parse_xmltv_time(el.get("start")), parse_xmltv_time(el.get("stop"))
                    except Exception:
                        start = stop = 0
                    if stop > now - 3600 and start < now + 30 * 3600:
                        result[ours].append({
                            "start": start, "stop": stop,
                            "title": (el.findtext("title") or "").strip(),
                            "sub": (el.findtext("sub-title") or "").strip(),
                            "desc": (el.findtext("desc") or "").strip()[:300],
                        })
                el.clear()
        for k in result:
            result[k].sort(key=lambda p: p["start"])
        return result

    def refresh(self):
        url = self.get_config().get("general", {}).get("epgUrl") or "https://iptv-epg.org/files/epg-de.xml"
        try:
            self.status = "lädt …"
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=60) as r:
                raw = r.read()
            if raw[:2] == b"\x1f\x8b":
                raw = gzip.decompress(raw)
            chans = self.parse(io.BytesIO(raw))
            found = sum(1 for v in chans.values() if v)
            self.data = {"updated": time.time(), "channels": chans}
            with open(self.path, "w", encoding="utf-8") as f:
                json.dump(self.data, f, ensure_ascii=False)
            self.status = "%d von %d Sendern mit Programm" % (found, len(chans))
        except Exception as e:
            self.status = "nicht erreichbar (%s)" % e.__class__.__name__
            print("EPG:", e, flush=True)

    def now_next(self, hours=6):
        """Pro Sender: laufende Sendung + die nächsten Stunden."""
        now = time.time()
        out = {}
        for cid, progs in self.data.get("channels", {}).items():
            out[cid] = [p for p in progs if p["stop"] > now and p["start"] < now + hours * 3600][:12]
        return {"now": now, "channels": out, "status": self.status, "updated": self.data.get("updated", 0)}


# ==========================================================================
# Links aufs TV
# ==========================================================================

def normalize_link(url):
    """Macht aus einem geteilten Link die beste Ansicht für den Fernseher."""
    url = (url or "").strip()
    m = re.search(r"https?://\S+", url)        # auch "Schau mal: https://…" aus WhatsApp
    if m:
        url = m.group(0).rstrip(").,;!\"'")
    elif url and not url.startswith("http"):
        url = "https://" + url
    if not url:
        return None, None
    yt = re.search(r"(?:youtube\.com/(?:watch\?(?:.*&)?v=|shorts/|live/|embed/)|youtu\.be/)([\w-]{11})", url)
    if yt:
        t = re.search(r"[?&]t=(\d+)", url)
        return "https://www.youtube.com/watch?v=%s%s" % (yt.group(1), "&t=%ss" % t.group(1) if t else ""), "YouTube"
    path = urllib.parse.urlparse(url).path.lower()
    if re.search(r"\.(mp4|m3u8|webm|mkv|mov)$", path):
        return "/play.html?src=" + urllib.parse.quote(url, safe="") + "&title=" + urllib.parse.quote("Video"), "Video"
    host = urllib.parse.urlparse(url).hostname or ""
    return url, host.replace("www.", "")
