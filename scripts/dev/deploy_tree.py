#!/usr/bin/env python3
"""Deploy a Creative Triage Edge Function whose files sit in subfolders or import outside its folder.
deploy_tree.py <repo root> <slug> <extra file relative to root>...
  Uploads every .ts under supabase/functions/<slug>/ (not *.test.ts) plus the extra files, with paths
  relative to the repository root, the layout the deployed bundles already use (source/supabase/...).
  verify_jwt is read from the deployed function and kept. DRY=1 lists the files and sends nothing.
  cockpit-ceo-api (2026-10-08, v6): deploy_tree.py . cockpit-ceo-api apps/media-buyer-cockpit/src/lib/kpi.ts
  A function that does not exist yet needs --verify-jwt=true or --verify-jwt=false (or VERIFY_JWT in the environment).
  A deno.json in the function folder is uploaded and used as its import map.
deploy_fn.py stays the tool for flat functions such as sales-api and sales-live.
The token is read from ~/.config/mahara/sb_mgmt_token, else SUPABASE_ACCESS_TOKEN, else supabase_token in
D:/MaharaMedia/mahara-cockpits/.env.local, and never printed."""
import json, os, re, sys, uuid, urllib.request, urllib.error
REF = "bldgtotkfmhoxmlzowdx"
def _token():
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
TOK = _token()
assert TOK, "No management token: create ~/.config/mahara/sb_mgmt_token or set SUPABASE_ACCESS_TOKEN"
_flags = [a for a in sys.argv[1:] if a.startswith("--verify-jwt=")]
sys.argv = [sys.argv[0]] + [a for a in sys.argv[1:] if not a.startswith("--verify-jwt=")]
if _flags:
    os.environ["VERIFY_JWT"] = _flags[-1].split("=", 1)[1]
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
if st == 404:
    flag = os.environ.get("VERIFY_JWT", "").lower()
    assert flag in ("true", "false"), "New function: set VERIFY_JWT=true or VERIFY_JWT=false"
    verify = flag == "true"
else:
    assert st == 200, (st, cur)
    verify = bool(cur["verify_jwt"])
base = f"supabase/functions/{slug}"
files = []
for d, _, fs in os.walk(os.path.join(root, base)):
    for f in fs:
        if f.endswith(".ts") and not f.endswith(".test.ts"):
            files.append(os.path.relpath(os.path.join(d, f), root).replace(os.sep, "/"))
files = sorted(files) + extra
meta = {"name": slug, "entrypoint_path": f"{base}/index.ts", "verify_jwt": verify}
if os.path.exists(os.path.join(root, base, "deno.json")):
    files.append(f"{base}/deno.json")
    meta["import_map_path"] = f"{base}/deno.json"
boundary = uuid.uuid4().hex
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
