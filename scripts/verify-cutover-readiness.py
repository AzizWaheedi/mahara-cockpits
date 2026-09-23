r"""
Production Cutover Readiness & Verification Tool.
Validates database schema, RLS policies, RPC endpoints, and build artifacts
for complete transition from Convex to Supabase.
"""

import sys
import os
import json
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
ENV_PATH = Path(r"D:\MaharaMedia\mahara-cockpits\.env.local")
PROJECT_REF = "bldgtotkfmhoxmlzowdx"
PROJECT_URL = f"https://{PROJECT_REF}.supabase.co"

print("=" * 70)
print("MAHARA COCKPITS -> SUPABASE PRODUCTION CUTOVER READINESS CHECK")
print("=" * 70)

# 1. Environment & Keys
service_key = None
mgmt_token = None
if ENV_PATH.exists():
    for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
        if line.startswith("SUPABASE_SERVICE_ROLE_KEY="):
            service_key = line.split("=", 1)[1].strip().strip("\"'")
        elif line.startswith("SUPABASE_ACCESS_TOKEN=") or line.startswith("supabase_token="):
            mgmt_token = line.split("=", 1)[1].strip().strip("\"'")

if not service_key:
    print("[FAIL] Missing SUPABASE_SERVICE_ROLE_KEY in .env.local")
    sys.exit(1)
print(f"[PASS] Environment loaded for project {PROJECT_REF}")

headers = {
    "apikey": service_key,
    "Authorization": f"Bearer {service_key}",
    "Content-Type": "application/json"
}

def query_sql(sql):
    url = f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query"
    req_headers = {"Authorization": f"Bearer {mgmt_token}", "Content-Type": "application/json"}
    body = json.dumps({"query": sql, "read_only": True}).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers=req_headers, method="POST")
    with urllib.request.urlopen(req) as resp:
        return json.load(resp)

# 2. Check Tables & Row Counts
tables = [
    "cockpit_members",
    "cockpit_daily_checks",
    "cockpit_issue_reports",
    "cockpit_eod_reports",
    "cockpit_campaigns",
    "cockpit_ads",
    "cockpit_decisions",
    "cockpit_client_profiles",
    "cockpit_plan_items",
]

print("\n--- 1. Domain Tables & Row Counts ---")
all_tables_ok = True
for t in tables:
    url = f"{PROJECT_URL}/rest/v1/{t}?select=*"
    req = urllib.request.Request(url, headers={**headers, "Prefer": "count=exact", "Range": "0-0"})
    try:
        with urllib.request.urlopen(req) as resp:
            content_range = resp.headers.get("Content-Range", "")
            count = content_range.split("/")[-1] if "/" in content_range else "0"
            print(f"  [PASS] {t:28}: {count} rows")
    except Exception as e:
        print(f"  [FAIL] {t:28}: {e}")
        all_tables_ok = False

# 3. Check RLS Enforcement
print("\n--- 2. Row Level Security (RLS) Status ---")
rls_sql = """
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('cockpit_members', 'cockpit_daily_checks', 'cockpit_issue_reports',
                    'cockpit_eod_reports', 'cockpit_campaigns', 'cockpit_ads',
                    'cockpit_decisions', 'cockpit_client_profiles', 'cockpit_plan_items');
"""
rls_results = query_sql(rls_sql)
all_rls_ok = True
for r in rls_results:
    status = "PASS" if r["rowsecurity"] else "FAIL"
    if not r["rowsecurity"]:
        all_rls_ok = False
    print(f"  [{status}] {r['tablename']:28}: RLS = {r['rowsecurity']}")

# 4. Check Stored Procedures (RPCs)
print("\n--- 3. Required Stored Procedures (RPCs) ---")
required_rpcs = [
    "cockpit_get_my_access",
    "cockpit_link_confirmed_member",
    "cockpit_admin_upsert_member",
    "cockpit_admin_remove_member",
    "cockpit_get_daily_checks",
    "cockpit_set_daily_check",
    "cockpit_save_eod",
    "cockpit_log_decision",
    "cockpit_remove_decision",
    "cockpit_update_client_profile",
    "cockpit_add_plan_item",
    "cockpit_remove_plan_item",
    "cockpit_get_dashboard_summary",
    "cockpit_submit_issue_report"
]
rpcs_sql = f"""
SELECT proname AS routine_name
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ({','.join(repr(r) for r in required_rpcs)});
"""
found_rpcs = {r["routine_name"] for r in query_sql(rpcs_sql)}
all_rpcs_ok = True
for rpc in required_rpcs:
    if rpc in found_rpcs:
        print(f"  [PASS] {rpc}")
    else:
        print(f"  [FAIL] {rpc} MISSING")
        all_rpcs_ok = False

# 5. Check Frontend Build Outputs
print("\n--- 4. Frontend Application Builds ---")
apps = [
    "media-buyer-cockpit",
    "client-success-cockpit",
    "creative-director-cockpit",
    "video-editor-cockpit"
]
all_builds_ok = True
for app in apps:
    dist_index = REPO_ROOT / "apps" / app / "dist" / "index.html"
    if dist_index.exists():
        size = dist_index.stat().st_size
        print(f"  [PASS] {app:28}: dist/index.html ({size} bytes)")
    else:
        print(f"  [FAIL] {app:28}: dist/index.html missing")
        all_builds_ok = False

print("\n" + "=" * 70)
if all_tables_ok and all_rls_ok and all_rpcs_ok and all_builds_ok:
    print("ALL VERIFICATION CHECKS PASSED: SYSTEM IS READY FOR CUTOVER.")
else:
    print("SOME CHECKS FAILED: Review the log output above.")
print("=" * 70)
