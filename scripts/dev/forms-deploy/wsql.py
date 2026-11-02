#!/usr/bin/env python3
"""wsql.py "<sql>": one owner-level SQL statement through Composio (read_only false). Prints the result rows."""
import json, subprocess, sys, tempfile, os
fd, p = tempfile.mkstemp(suffix='.json')
with os.fdopen(fd, 'w') as f: json.dump({"ref": "bldgtotkfmhoxmlzowdx", "query": sys.argv[1], "read_only": False}, f)
try:
    r = subprocess.run(["composio", "execute", "SUPABASE_BETA_RUN_SQL_QUERY", "-d", "@" + p], stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=300)
finally:
    os.unlink(p)
try:
    d = json.loads(r.stdout); print(json.dumps(d.get("data", {}).get("result", d), default=str)); sys.exit(0 if d.get("successful") else 1)
except Exception:
    print(r.stdout[:2000], r.stderr[:500]); sys.exit(1)
