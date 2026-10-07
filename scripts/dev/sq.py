#!/usr/bin/env python3
"""Run SQL through the Supabase management API. Usage: sq.py triage|b2b [--write] "SQL" (or SQL on stdin).
B2B is always read-only. Triage is read-only unless --write. The token is read from ~/.config/mahara/sb_mgmt_token and never printed."""
import json, os, sys, urllib.request
REFS = {"triage": "bldgtotkfmhoxmlzowdx", "b2b": "flwboeijllbtrufxkhts"}
args = sys.argv[1:]
target = args.pop(0)
write = False
if args and args[0] == "--write":
    write = True; args.pop(0)
sql = args[0] if args else sys.stdin.read()
if target == "b2b":
    write = False
tok = open(os.path.expanduser("~/.config/mahara/sb_mgmt_token")).read().strip()
req = urllib.request.Request(
    f"https://api.supabase.com/v1/projects/{REFS[target]}/database/query",
    data=json.dumps({"query": sql, "read_only": not write}).encode(),
    headers={"Authorization": f"Bearer {tok}", "Content-Type": "application/json", "User-Agent": "mahara-sales/1"},
    method="POST",
)
try:
    with urllib.request.urlopen(req, timeout=120) as r:
        out = json.loads(r.read() or b"null")
except urllib.error.HTTPError as e:
    print(f"HTTP {e.code}: {e.read().decode()[:800]}"); sys.exit(1)
print(json.dumps(out, indent=1, default=str))
