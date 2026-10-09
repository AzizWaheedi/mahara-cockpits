#!/usr/bin/env python3
"""Apply one migration file to Creative Triage and record it in the migration history.
apply_migration.py <path to supabase/migrations/NNNN_name.sql> [--dry]
  Sends the file through the Management API migrations endpoint, the same route the Supabase MCP
  apply_migration tool uses, so the name lands in supabase_migrations.schema_migrations.
  A leading BEGIN; and trailing COMMIT; are stripped (the endpoint runs the file in one transaction).
  --dry prints the name and size and sends nothing.
The token is read from ~/.config/mahara/sb_mgmt_token, else SUPABASE_ACCESS_TOKEN, else supabase_token in
D:/MaharaMedia/mahara-cockpits/.env.local, and never printed. Only this project ref is accepted."""
import json, os, re, sys, urllib.request, urllib.error
REF = "bldgtotkfmhoxmlzowdx"


def token():
    f = os.path.expanduser("~/.config/mahara/sb_mgmt_token")
    if os.path.exists(f):
        return open(f).read().strip()
    if os.environ.get("SUPABASE_ACCESS_TOKEN"):
        return os.environ["SUPABASE_ACCESS_TOKEN"].strip()
    env = "D:/MaharaMedia/mahara-cockpits/.env.local"
    if os.path.exists(env):
        for line in open(env, encoding="utf-8", errors="ignore"):
            m = re.match(r"\s*supabase_token\s*=\s*(.+)", line)
            if m:
                return m.group(1).strip().strip('"').strip("'")
    return ""


args = [a for a in sys.argv[1:] if a != "--dry"]
dry = "--dry" in sys.argv[1:]
assert len(args) == 1, __doc__
path = args[0]
base = os.path.basename(path)
m = re.match(r"^(\d{8}[a-z]?)_([a-z0-9_]+)\.sql$", base)
assert m and "/supabase/migrations/" in path.replace("\\", "/"), "Pass a file from supabase/migrations named NNNNNNNN[x]_name.sql"
sql = open(path, encoding="utf-8").read()
sql = re.sub(r"^\s*BEGIN;\s*$", "", sql, count=1, flags=re.M)
sql = re.sub(r"^\s*COMMIT;\s*$(?![\s\S]*^\s*COMMIT;)", "", sql, count=1, flags=re.M)
name = base[:-4]
if dry:
    print(json.dumps({"would_apply": name, "bytes": len(sql)}))
    sys.exit(0)
tok = token()
assert tok, "No management token"
req = urllib.request.Request(
    f"https://api.supabase.com/v1/projects/{REF}/database/migrations",
    data=json.dumps({"name": name, "query": sql}).encode(),
    method="POST",
    headers={"Authorization": f"Bearer {tok}", "Content-Type": "application/json", "User-Agent": "mahara-migrate/1"},
)
try:
    with urllib.request.urlopen(req, timeout=300) as r:
        print(json.dumps({"applied": name, "status": r.status}))
except urllib.error.HTTPError as e:
    print(json.dumps({"failed": name, "status": e.code, "error": e.read().decode()[:1500]}))
    sys.exit(1)
