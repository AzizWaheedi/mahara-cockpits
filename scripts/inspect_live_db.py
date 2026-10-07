#!/usr/bin/env python3
"""
Inspect live database in target Supabase project bldgtotkfmhoxmlzowdx.
Reads:
- All tables in schema public and row counts
- All functions/RPCs in pg_proc
- All RLS policies
"""

import sys
import json
import urllib.request
from pathlib import Path

ENV_PATH = Path(r"D:\MaharaMedia\mahara-cockpits\.env.local")
PROJECT_REF = "bldgtotkfmhoxmlzowdx"

mgmt_token = None
if ENV_PATH.exists():
    for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
        if line.startswith("SUPABASE_ACCESS_TOKEN=") or line.startswith("supabase_token="):
            mgmt_token = line.split("=", 1)[1].strip().strip("\"'")

if not mgmt_token:
    print("Missing mgmt token")
    sys.exit(1)

def query_sql(sql, timeout=30):
    url = f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query"
    req_headers = {"Authorization": f"Bearer {mgmt_token}", "Content-Type": "application/json"}
    body = json.dumps({"query": sql, "read_only": True}).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers=req_headers, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.load(resp)

print("Querying all tables in public schema...")
tables_sql = """
SELECT 
    t.table_name,
    c.reltuples::bigint as estimated_count
FROM information_schema.tables t
LEFT JOIN pg_class c ON c.relname = t.table_name
LEFT JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
ORDER BY t.table_name;
"""

tables = query_sql(tables_sql)
print(f"Total tables: {len(tables)}")
for r in tables:
    print(f"  {r['table_name']:40} est: {r['estimated_count']}")

print("\nQuerying all RPCs / functions in public schema...")
funcs_sql = """
SELECT 
    p.proname,
    pg_get_function_identity_arguments(p.oid) as args,
    pg_get_function_result(p.oid) as return_type,
    p.prosecdef as is_security_definer
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
ORDER BY p.proname;
"""
funcs = query_sql(funcs_sql)
print(f"Total functions: {len(funcs)}")
for f in funcs:
    sec = "SECDEF" if f['is_security_definer'] else "INVOKER"
    print(f"  {f['proname']:35} ({f['args']}) -> {f['return_type']} [{sec}]")

# Write to file
res = {
    "tables": tables,
    "functions": funcs
}
out_path = Path(__file__).parent / "live_db_inventory.json"
out_path.write_text(json.dumps(res, indent=2), encoding="utf-8")
print(f"\nWrote live DB inventory to {out_path}")
