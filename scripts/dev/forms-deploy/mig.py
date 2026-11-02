#!/usr/bin/env python3
"""Apply a Creative Triage migration through the CEO's Composio Supabase connection (memory: supabase-via-composio).
  mig.py dry <file> [<file> ...]   BEGIN; <files, own BEGIN/COMMIT stripped>; a probe select; ROLLBACK (via SUPABASE_BETA_RUN_SQL_QUERY)
  mig.py apply <file>              SUPABASE_APPLY_A_MIGRATION {ref, name: <stem>, query}; prints the file's sha256
Dry-run the whole chain first. Never prints a secret. Used for waves 1-6 of the forms plan (2026-11-01/02)."""
import hashlib, json, os, re, subprocess, sys, tempfile
REF = "bldgtotkfmhoxmlzowdx"
def strip(sql):
    sql = re.sub(r"^\s*BEGIN;\s*$", "", sql, count=1, flags=re.M)
    return re.sub(r"^\s*COMMIT;\s*$(?![\s\S]*^\s*COMMIT;)", "", sql, count=1, flags=re.M)
def call(tool, body):
    fd, path = tempfile.mkstemp(suffix=".json")
    with os.fdopen(fd, "w") as f: json.dump(body, f)
    try:
        p = subprocess.run(["composio", "execute", tool, "-d", "@" + path], stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=600)
    finally:
        os.unlink(path)
    return p.returncode, p.stdout.strip(), p.stderr.strip()
mode, files = sys.argv[1], sys.argv[2:]
assert mode in ("dry", "apply") and files
for f in files: assert re.search(r"/supabase/migrations/2026\d{4}[a-z]+_[a-z0-9_]+\.sql$", f), f
ok_of = lambda rc, out: rc == 0 and '"successful": true' in out.replace('"successful":true', '"successful": true')
if mode == "dry":
    q = "BEGIN;\n" + "\n".join(strip(open(f).read()) for f in files) + "\nselect 'end' as probe;\nROLLBACK;"
    rc, out, err = call("SUPABASE_BETA_RUN_SQL_QUERY", {"ref": REF, "query": q, "read_only": False})
    print(json.dumps({"dry": [os.path.basename(f) for f in files], "ok": ok_of(rc, out), "out": out[:1500], "err": err[:400]}))
    sys.exit(0 if ok_of(rc, out) else 1)
assert len(files) == 1
raw = open(files[0], "rb").read(); name = os.path.basename(files[0])[:-4]
rc, out, err = call("SUPABASE_APPLY_A_MIGRATION", {"ref": REF, "name": name, "query": strip(raw.decode())})
print(json.dumps({"applied": name, "sha256": hashlib.sha256(raw).hexdigest(), "ok": ok_of(rc, out), "out": out[:800], "err": err[:400]}))
sys.exit(0 if ok_of(rc, out) else 1)
