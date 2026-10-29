#!/usr/bin/env python3
"""Fetch HA open-data AE waiting times, merge into rolling snapshot history.
Keeps aed_history.json (24h of ~15min snapshots) for the map's server-side trend.
"""
import json, urllib.request, ssl, sys
from datetime import datetime, timezone, timedelta

HKT = timezone(timedelta(hours=8))
API_URL = "https://www.ha.org.hk/opendata/aed/aedwtdata2-en.json"
HIST_FILE = "aed_history.json"
MAX_AGE_H = 24
MAX_POINTS = 110  # 24h @ ~13min cadence

ctx = ssl.create_default_context()
try:
    with urllib.request.urlopen(API_URL, timeout=15, context=ctx) as r:
        data = json.loads(r.read())
except Exception as e:
    print(f"FETCH_ERROR: {e}")
    sys.exit(1)

wait = data.get("waitTime", [])
if not wait:
    print("EMPTY_PAYLOAD")
    sys.exit(1)

now_ms = int(datetime.now(HKT).timestamp() * 1000)
snap = {
    "ts": now_ms,
    "updateTime": data.get("updateTime", ""),
    "hospitals": {
        w.get("hospName", ""): {
            "t1wt": w.get("t1wt", ""), "t2wt": w.get("t2wt", ""),
            "t3p50": w.get("t3p50", ""), "t3p95": w.get("t3p95", ""),
            "t45p50": w.get("t45p50", ""), "t45p95": w.get("t45p95", ""),
        } for w in wait
    },
}

try:
    hist = json.load(open(HIST_FILE))
except Exception:
    hist = {"points": []}

points = hist.get("points", [])
# skip if last snapshot < 10 min old (GitHub cron jitter)
if points and now_ms - points[-1]["ts"] < 10 * 60 * 1000:
    print("SKIP_TOO_SOON")
    sys.exit(0)

points.append(snap)
cutoff = now_ms - MAX_AGE_H * 3600 * 1000
points = [p for p in points if p["ts"] >= cutoff][-MAX_POINTS:]
hist = {"points": points, "lastUpdated": now_ms}

with open(HIST_FILE, "w") as f:
    json.dump(hist, f, ensure_ascii=False, separators=(",", ":"))

print(f"OK points={len(points)} updateTime={snap['updateTime']}")
