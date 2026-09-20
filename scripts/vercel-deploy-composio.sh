#!/usr/bin/env bash
# Deploy one cockpit's source to Vercel through Composio's Vercel connection,
# for the days the Vercel CLI has no login on this Mac (first needed
# 2026-09-20). ship.sh calls it on its own when `vercel whoami` fails.
#
#   scripts/vercel-deploy-composio.sh apps/media-buyer-cockpit
#
# Vercel builds from the same source the CLI would send, under the project's
# own settings, straight to production. How the bytes get there: the Composio
# CLI JSON-encodes every request body, so a file cannot be uploaded byte-exact
# through `composio proxy`. Vercel keeps files by content hash, though, and an
# upload whose hash it already holds is accepted without reading the body. So
# every unchanged file goes by hash, and the files whose hash is new go inline
# in the deployment request as base64, which survives JSON. A first deploy of
# a brand-new project would inline everything; use the CLI for that.
set -euo pipefail
cd "$(dirname "$0")/.."
dir="${1:?usage: scripts/vercel-deploy-composio.sh <app dir>}"
[ -f "$dir/.vercel/project.json" ] || { echo "$dir is not linked to a Vercel project (.vercel/project.json missing)"; exit 2; }
command -v composio >/dev/null || { echo "the composio CLI is not installed (npm i -g composio)"; exit 2; }
command -v python3 >/dev/null || { echo "python3 is needed"; exit 2; }

read -r PROJECT NAME TEAM < <(python3 -c "import json;d=json.load(open('$dir/.vercel/project.json'));print(d['projectId'],d['projectName'],d['orgId'])")
export TEAM
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# The files the CLI would send: everything under the app except what
# .vercelignore names (or .gitignore when there is none), plus the folders
# nobody ever wants uploaded.
python3 - "$dir" > "$work/files.txt" <<'PY'
import fnmatch, os, sys
root = sys.argv[1]
rules = []
for name in (".vercelignore", ".gitignore"):
    p = os.path.join(root, name)
    if os.path.exists(p):
        rules = [l.strip() for l in open(p) if l.strip() and not l.startswith("#") and not l.startswith("!")]
        break
rules += ["node_modules/", ".git/", ".vercel/", "dist/", ".env*", ".DS_Store"]

def ignored(rel, is_dir):
    base = os.path.basename(rel)
    for r in rules:
        dir_only = r.endswith("/")
        pat = r.strip("/")
        if dir_only and not is_dir:
            continue
        if "/" in pat:
            if fnmatch.fnmatch(rel, pat) or rel.startswith(pat + "/"):
                return True
        elif fnmatch.fnmatch(base, pat):
            return True
    return False

out = []
for dp, dns, fns in os.walk(root):
    rel_dp = os.path.relpath(dp, root)
    rel_dp = "" if rel_dp == "." else rel_dp
    dns[:] = [d for d in dns if not ignored(os.path.join(rel_dp, d), True)]
    for f in fns:
        rel = os.path.join(rel_dp, f)
        if not ignored(rel, False):
            out.append(rel)
print("\n".join(sorted(out)))
PY
echo "  files: $(wc -l < "$work/files.txt" | tr -d ' ')"
# DRY=1 prints the list and stops: the way to check what would go up.
if [ "${DRY:-}" = 1 ]; then cat "$work/files.txt"; exit 0; fi

# One file: by hash when Vercel already holds it, inline when the hash is new.
cat > "$work/one.sh" <<'ONE'
#!/usr/bin/env bash
f="$1"
sha=$(shasum -a 1 "$f" | cut -d' ' -f1)
size=$(stat -f%z "$f" 2>/dev/null || stat -c%s "$f")
res=""
for attempt in 1 2 3; do
  res=$(composio proxy "https://api.vercel.com/v2/files?teamId=$TEAM" --toolkit vercel --skip-connection-check \
        -X POST -H "x-vercel-digest: $sha" -H "Content-Type: application/octet-stream" -d @"$f" 2>&1) || true
  if echo "$res" | grep -q sha1sum_mismatch; then
    printf '{"file":"%s","data":"%s","encoding":"base64"}\n' "$f" "$(base64 < "$f" | tr -d '\n')"
    exit 0
  fi
  if ! echo "$res" | grep -Eq '"error"|ProxyRequestError|"successful": *false'; then
    printf '{"file":"%s","sha":"%s","size":%s}\n' "$f" "$sha" "$size"
    exit 0
  fi
  sleep 2
done
echo "FAIL $f :: $(echo "$res" | tr '\n' ' ' | head -c 200)" >&2
exit 1
ONE
chmod +x "$work/one.sh"

(cd "$dir" && xargs -P 8 -I{} "$work/one.sh" {} < "$work/files.txt" > "$work/parts.jsonl" 2> "$work/failures.txt") || true
fails=$(grep -c '^FAIL' "$work/failures.txt" || true)
if [ "$fails" != "0" ]; then
  echo "  $fails file(s) could not be sent:"; grep '^FAIL' "$work/failures.txt" | head -5; exit 1
fi
echo "  by hash: $(grep -c '"sha"' "$work/parts.jsonl" || true), inline: $(grep -c '"encoding"' "$work/parts.jsonl" || true)"

framework=$(composio proxy "https://api.vercel.com/v9/projects/$PROJECT?teamId=$TEAM" --toolkit vercel --skip-connection-check -X GET 2>/dev/null \
  | python3 -c "import json,sys; d=json.load(sys.stdin); b=d.get('data') if isinstance(d,dict) and 'data' in d else d; print(b.get('framework') or '')" 2>/dev/null || true)
commit=$(git rev-parse --short HEAD 2>/dev/null || echo unknown)
python3 - "$work" "$NAME" "$PROJECT" "$framework" "$commit" <<'PY'
import json, sys
work, name, project, framework, commit = sys.argv[1:6]
files = [json.loads(l) for l in open(f"{work}/parts.jsonl") if l.strip()]
body = {"name": name, "project": project, "target": "production", "files": files,
        "meta": {"shippedBy": "scripts/vercel-deploy-composio.sh", "commit": commit}}
if framework:
    body["projectSettings"] = {"framework": framework}
json.dump(body, open(f"{work}/body.json", "w"))
PY

# forceNew without withCache is what the CLI's --force sends: a fresh build,
# no restored output (see ship.sh for the day the cache served last week's).
res=$(composio proxy "https://api.vercel.com/v13/deployments?teamId=$TEAM&forceNew=1" --toolkit vercel --skip-connection-check \
      -X POST -H "Content-Type: application/json" -d @"$work/body.json" 2>&1) || true
id=$(echo "$res" | python3 -c "
import json,sys
raw=sys.stdin.read()
try:
    d=json.loads(raw); b=d.get('data') if isinstance(d,dict) and 'data' in d else d
    if b.get('error'): sys.stderr.write('vercel refused the deployment: '+json.dumps(b['error'])[:400]+'\n')
    print(b.get('id') or '')
except Exception:
    sys.stderr.write('unexpected answer: '+raw[:400]+'\n')
")
[ -n "$id" ] || exit 1
echo "  deployment: $id"

for _ in $(seq 1 90); do
  state=$(composio proxy "https://api.vercel.com/v13/deployments/$id?teamId=$TEAM" --toolkit vercel --skip-connection-check -X GET 2>&1 \
    | python3 -c "
import json,sys
raw=sys.stdin.read()
try:
    d=json.loads(raw); b=d.get('data') if isinstance(d,dict) and 'data' in d else d
    print(b.get('readyState') or '?', b.get('readySubstate') or '', b.get('url') or '', ','.join(b.get('alias') or []), (b.get('errorMessage') or '')[:300])
except Exception: print('?')")
  set -- $state
  case "$1" in
    READY)    echo "  \"readyState\": \"READY\" ($2) https://$3"; echo "  aliases: $4"; exit 0 ;;
    ERROR|CANCELED) echo "  deployment $1: $5"; exit 1 ;;
  esac
  sleep 10
done
echo "  still building after 15 minutes: https://vercel.com/$TEAM/$NAME/$id"; exit 1
