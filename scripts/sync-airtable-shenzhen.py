#!/usr/bin/env python3
"""
Pull all 6 tables of the Voyage Shenzhen 2026 Airtable base into a single
voyage-shenzhen-data.json file at the repo root. Called by the GitHub Action
in .github/workflows/sync-airtable-shenzhen.yml every 10 min.

The HTML voyage-shenzhen-2026.html falls back to this file when no PAT
is in localStorage, so squad members visiting without setup still see fresh data.
"""
import os
import json
import time
import sys
import urllib.request
import urllib.error

BASE = "appAa2GBfpF5ms7EA"
TABLES = {
    "squad":    "tblD3gGHRwSPagqQF",
    "contacts": "tblvrw6JveZrprL1w",
    "rdv":      "tblyZFiKmTW9W8gGj",
    "todo":     "tblJiwyiehKQ1BEgT",
    "notes":    "tblIgm9E0Trp4MWL2",
    "jours":    "tbls8fScIj213Cdxb",
}
OUT_FILE = "voyage-shenzhen-data.json"

PAT = os.environ.get("AT_PAT", "").strip()
if not PAT:
    print("ERROR: AT_PAT env var missing (set repo secret AIRTABLE_PAT)", file=sys.stderr)
    sys.exit(1)


def fetch_all(table_id):
    records = []
    offset = None
    while True:
        url = f"https://api.airtable.com/v0/{BASE}/{table_id}?pageSize=100"
        if offset:
            url += f"&offset={offset}"
        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {PAT}"})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                data = json.loads(r.read())
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="replace")
            print(f"ERROR fetching {table_id}: HTTP {e.code} — {body[:300]}", file=sys.stderr)
            sys.exit(2)
        records.extend(data.get("records", []))
        offset = data.get("offset")
        if not offset:
            break
        time.sleep(0.2)  # respect Airtable rate limit (5 req/s)
    return records


snapshot = {
    "syncedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    "baseId": BASE,
}
total = 0
for key, tid in TABLES.items():
    recs = fetch_all(tid)
    snapshot[key] = recs
    total += len(recs)
    print(f"  {key:10s} {len(recs):4d} records")

with open(OUT_FILE, "w", encoding="utf-8") as f:
    json.dump(snapshot, f, ensure_ascii=False, separators=(",", ":"))

# Print file size for visibility in CI logs
size_kb = os.path.getsize(OUT_FILE) / 1024
print(f"\nWrote {OUT_FILE} — {total} records, {size_kb:.1f} KB")
