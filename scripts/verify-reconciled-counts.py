import urllib.request
import json
from pathlib import Path

env_path = Path(r"D:\MaharaMedia\mahara-cockpits\.env.local")
service_key = None
for line in env_path.read_text(encoding="utf-8").splitlines():
    if line.startswith("SUPABASE_SERVICE_ROLE_KEY="):
        service_key = line.split("=", 1)[1].strip().strip("\"'")
        break

if not service_key:
    raise SystemExit("Missing SUPABASE_SERVICE_ROLE_KEY")

headers = {
    "apikey": service_key,
    "Authorization": f"Bearer {service_key}",
    "Prefer": "count=exact",
    "Range": "0-0"
}

tables = [
    "cockpit_members",
    "cockpit_daily_checks",
    "cockpit_issue_reports",
    "cockpit_eod_reports",
    "cockpit_campaigns",
    "cockpit_ads",
    "cockpit_decisions",
    "cockpit_client_profiles"
]

print("=== Supabase Reconciled Table Row Counts ===")
for t in tables:
    url = f"https://bldgtotkfmhoxmlzowdx.supabase.co/rest/v1/{t}?select=*"
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req) as resp:
            content_range = resp.headers.get("Content-Range", "")
            count = content_range.split("/")[-1] if "/" in content_range else "0"
            print(f"{t:30}: {count} rows")
    except Exception as e:
        print(f"{t:30}: ERROR: {e}")
