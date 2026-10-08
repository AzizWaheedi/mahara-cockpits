#!/usr/bin/env python3
"""Deploy a Creative Triage Edge Function whose files sit in subfolders or import outside its folder.
deploy_tree.py <repo root> <slug> <extra file relative to root>...
  Uploads every .ts under supabase/functions/<slug>/ (not *.test.ts) plus the extra files, with paths
  relative to the repository root, the layout the deployed bundles already use (source/supabase/...).
  verify_jwt is read from the deployed function and kept. DRY=1 lists the files and sends nothing.
  cockpit-ceo-api (2026-10-08, v6): deploy_tree.py . cockpit-ceo-api apps/media-buyer-cockpit/src/lib/kpi.ts
deploy_fn.py stays the tool for flat functions such as sales-api and sales-live.
The token is read from ~/.config/mahara/sb_mgmt_token and never printed."""
import json, os, sys, uuid, urllib.request, urllib.error
REF = "bldgtotkfmhoxmlzowdx"
TOK = open(os.path.expanduser("~/.config/mahara/sb_mgmt_token")).read().strip()
API = f"https://api.supabase.com/v1/projects/{REF}"
H = {"Authorization": f"Bearer {TOK}", "User-Agent": "mahara-sales/1"}
def call(req):
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            t = r.read().decode(); return r.status, (json.loads(t) if t.strip() else None)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:800]
root, slug, extra = sys.argv[1], sys.argv[2], sys.argv[3:]
st, cur = call(urllib.request.Request(f"{API}/functions/{slug}", headers=H))
assert st == 200, (st, cur)
verify = bool(cur["verify_jwt"])
base = f"supabase/functions/{slug}"
files = []
for d, _, fs in os.walk(os.path.join(root, base)):
    for f in fs:
        if f.endswith(".ts") and not f.endswith(".test.ts"):
            files.append(os.path.relpath(os.path.join(d, f), root))
files = sorted(files) + extra
boundary = uuid.uuid4().hex
meta = {"name": slug, "entrypoint_path": f"{base}/index.ts", "verify_jwt": verify}
parts = [f'--{boundary}\r\nContent-Disposition: form-data; name="metadata"\r\nContent-Type: application/json\r\n\r\n{json.dumps(meta)}\r\n'.encode()]
for f in files:
    data = open(os.path.join(root, f), "rb").read()
    parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{f}"\r\nContent-Type: application/typescript\r\n\r\n'.encode() + data + b"\r\n")
parts.append(f"--{boundary}--\r\n".encode())
if os.environ.get("DRY"):
    print("would deploy", slug, "verify_jwt", verify, len(files), "files"); print("\n".join(files)); sys.exit(0)
req = urllib.request.Request(f"{API}/functions/deploy?slug={slug}", data=b"".join(parts), method="POST",
                             headers={**H, "Content-Type": f"multipart/form-data; boundary={boundary}"})
st, out = call(req)
print("deploy", slug, st, {k: out.get(k) for k in ("slug", "version", "status", "verify_jwt")} if isinstance(out, dict) else out, len(files), "files")
