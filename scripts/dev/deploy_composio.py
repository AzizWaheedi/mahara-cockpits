#!/usr/bin/env python3
"""Deploy a Creative Triage Edge Function through the CEO's Composio Supabase connection.

The management token on this Mac is dead (2026-10-09), and Composio rewrites multipart bodies, so a
function is bundled to one file with bun from a git revision and sent as file_content.

  deploy_composio.py <slug> [--rev REV] [--extra PATH ...] [--verify-jwt on|off] [--dry]

  --rev        git revision to deploy from (default HEAD); the working tree is never read
  --extra      files or folders outside supabase/functions/<slug> that the function imports
  --verify-jwt set verify_jwt after the deploy (a new function otherwise gets the platform default)
  --dry        bundleOnly: builds a version without publishing it

Run from the repository root. Prints the live version and verify_jwt before and after; never prints a secret.
"""
import argparse, json, os, subprocess, sys, tempfile

REF = "bldgtotkfmhoxmlzowdx"
API = f"https://api.supabase.com/v1/projects/{REF}/functions"


def composio(args, data=None):
    cmd = ["composio", *args]
    if data is not None:
        fd, path = tempfile.mkstemp(suffix=".json")
        with os.fdopen(fd, "w") as f:
            json.dump(data, f)
        cmd += ["-d", "@" + path]
    try:
        r = subprocess.run(cmd, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=600)
    finally:
        if data is not None:
            os.unlink(path)
    out = r.stdout.strip()
    try:
        return json.loads(out)
    except ValueError:
        sys.exit(f"composio answered without JSON (exit {r.returncode}): {out[:300]} {r.stderr[:300]}")


def live(slug):
    d = composio(["proxy", f"{API}/{slug}", "--toolkit", "supabase"])
    if isinstance(d, dict) and d.get("slug") == slug:
        return {k: d.get(k) for k in ("version", "status", "verify_jwt")}
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("slug")
    ap.add_argument("--rev", default="HEAD")
    ap.add_argument("--extra", nargs="*", default=[])
    ap.add_argument("--verify-jwt", choices=["on", "off"])
    ap.add_argument("--dry", action="store_true")
    a = ap.parse_args()
    base = f"supabase/functions/{a.slug}"
    print("live before:", live(a.slug))
    with tempfile.TemporaryDirectory() as tmp:
        arch = subprocess.run(["git", "archive", a.rev, base, *a.extra], capture_output=True)
        if arch.returncode:
            sys.exit(arch.stderr.decode()[:400])
        subprocess.run(["tar", "-x", "-C", tmp], input=arch.stdout, check=True)
        bundle = os.path.join(tmp, "bundle.js")
        b = subprocess.run(["bun", "build", os.path.join(base, "index.ts"), "--target=browser", "--format=esm",
                            "--external", "npm:*", "--external", "jsr:*", "--external", "node:*", "--external", "https:*",
                            "--outfile", bundle], cwd=tmp, capture_output=True, text=True)
        if b.returncode:
            sys.exit("bundle failed: " + (b.stderr or b.stdout)[-800:])
        src = open(bundle).read()
    rev = subprocess.run(["git", "rev-parse", "--short", a.rev], capture_output=True, text=True).stdout.strip()
    print(f"bundle from {rev}: {len(src)} bytes")
    body = {"ref": REF, "slug": a.slug, "file_content": src}
    if a.dry:
        body["bundleOnly"] = True
    d = composio(["execute", "SUPABASE_DEPLOY_FUNCTION"], body)
    if not d.get("successful"):
        sys.exit("deploy refused: " + json.dumps(d.get("error"))[:600])
    data = d.get("data") or {}
    print("deploy:", {k: data.get(k) for k in ("version", "status", "verify_jwt")}, "(bundle only, not published)" if a.dry else "")
    if a.verify_jwt and not a.dry:
        want = a.verify_jwt == "on"
        now = live(a.slug)
        if now and now["verify_jwt"] != want:
            composio(["proxy", f"{API}/{a.slug}", "--toolkit", "supabase", "-X", "PATCH",
                      "-H", "Content-Type: application/json", "-d", json.dumps({"verify_jwt": want})])
    print("live after:", live(a.slug))


if __name__ == "__main__":
    main()
