#!/usr/bin/env python3
"""Deploy a Creative Triage Edge Function through the management API.
deploy_fn.py <slug> <dir> [--no-verify-jwt]   (uploads every .ts file in dir except *.test.ts; entrypoint index.ts)
  verify_jwt is ON unless --no-verify-jwt is passed (only sales-live, the door Zoom, Slack and pg_cron reach
  with no key, takes it; any other slug is warned). --verify-jwt is still accepted and changes nothing (m1 round 1, forged-service-role-desk).
deploy_fn.py --info <slug>                  (the deployed version, read only)
The token is read from ~/.config/mahara/sb_mgmt_token and never printed."""
import json, os, sys, uuid, urllib.request, urllib.error
REF = "bldgtotkfmhoxmlzowdx"
TOK = open(os.path.expanduser("~/.config/mahara/sb_mgmt_token")).read().strip()
API = f"https://api.supabase.com/v1/projects/{REF}"
H = {"Authorization": f"Bearer {TOK}", "User-Agent": "mahara-sales/1"}

def call(req):
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            t = r.read().decode()
            return r.status, (json.loads(t) if t.strip() else None)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:600]

args = sys.argv[1:]
if args[0] == "--info":
    st, out = call(urllib.request.Request(f"{API}/functions/{args[1]}", headers=H))
    print(st, {k: out.get(k) for k in ("slug", "version", "status", "verify_jwt", "updated_at")} if isinstance(out, dict) else out)
    sys.exit(0)
slug, folder = args[0], args[1]
verify = "--no-verify-jwt" not in args
if not verify and slug != "sales-live":
    print(f"warning: {slug} is deployed with verify_jwt OFF; only sales-live (the door) is meant to be", file=sys.stderr)
files = sorted(f for f in os.listdir(folder) if f.endswith(".ts") and not f.endswith(".test.ts"))
if "index.ts" not in files:
    sys.exit("no index.ts in " + folder)
boundary = uuid.uuid4().hex
meta = {"name": slug, "entrypoint_path": "index.ts", "verify_jwt": verify}
parts = [f'--{boundary}\r\nContent-Disposition: form-data; name="metadata"\r\nContent-Type: application/json\r\n\r\n{json.dumps(meta)}\r\n'.encode()]
for f in files:
    data = open(os.path.join(folder, f), "rb").read()
    parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{f}"\r\nContent-Type: application/typescript\r\n\r\n'.encode() + data + b"\r\n")
parts.append(f"--{boundary}--\r\n".encode())
req = urllib.request.Request(f"{API}/functions/deploy?slug={slug}", data=b"".join(parts), method="POST",
                             headers={**H, "Content-Type": f"multipart/form-data; boundary={boundary}"})
st, out = call(req)
print("deploy", slug, st, {k: out.get(k) for k in ("slug", "version", "status", "verify_jwt")} if isinstance(out, dict) else out, "files:", files)
