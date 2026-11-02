#!/usr/bin/env python3
"""secrets.py NAME=value [NAME=value ...]: set Creative Triage Edge Function secrets through Composio. Prints names only."""
import json, os, subprocess, sys, tempfile
s = [dict(zip(("name", "value"), a.split("=", 1))) for a in sys.argv[1:]]
fd, p = tempfile.mkstemp(suffix=".json")
with os.fdopen(fd, "w") as f: json.dump({"ref": "bldgtotkfmhoxmlzowdx", "secrets": s}, f)
try:
    r = subprocess.run(["composio", "execute", "SUPABASE_CREATE_BULK_SECRETS", "-d", "@" + p], stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=120)
finally: os.unlink(p)
ok = '"successful": true' in r.stdout
print(json.dumps({"set": [x["name"] for x in s], "ok": ok}), "" if ok else r.stdout[:400])
sys.exit(0 if ok else 1)
