#!/usr/bin/env bash
# Make a fresh worktree ready for scripts/ship.sh. Git leaves out three kinds
# of files a ship needs: installed dependencies, the generated Convex types
# that some tests still import, and each app's Vercel link. This reports what
# is missing, and with --apply it adds it. It never copies a secret:
# scripts/ship.ps1 loads those for each run.
#
#   scripts/prepare-worktree.sh             report only (exit 1 if anything is missing)
#   scripts/prepare-worktree.sh --apply     install, copy and link
#
# SOURCE_CHECKOUT is the first clone the generated types are copied from. It
# defaults to the main worktree (the first one `git worktree list` names).
# When it has no full copy, the other worktrees are tried in turn.
set -uo pipefail
cd "$(dirname "$0")/.."

apply=""
case "${1:-}" in
  --apply) apply=1 ;;
  "") ;;
  *) echo "usage: scripts/prepare-worktree.sh [--apply]"; exit 2 ;;
esac

py_bin="python"
command -v python >/dev/null 2>&1 || py_bin="python3"

source_checkout="${SOURCE_CHECKOUT:-$(git worktree list --porcelain | sed -n '1s/^worktree //p')}"

# The folders ship.sh and the readiness check run code in.
dep_dirs=(. apps/media-buyer-cockpit apps/client-success-cockpit apps/creative-director-cockpit
          apps/video-editor-cockpit apps/sales-cockpit hermes/media-native)
# The apps whose ship tests still import convex/_generated (2026-10-11). The
# types are git-ignored and Convex is retired, so they are copied, not built.
generated_dirs=(apps/media-buyer-cockpit apps/creative-director-cockpit)

missing=()
failed=()

for d in "${dep_dirs[@]}"; do
  [ -f "$d/package.json" ] || continue
  if [ -n "$apply" ]; then
    # Run even when node_modules exists: a lockfile that moved since the last
    # install fails tests the same way a missing folder does.
    if log=$(cd "$d" && bun install --frozen-lockfile 2>&1); then
      echo "dependencies installed in $d"
    else
      failed+=("bun install failed in $d: $(printf '%s' "$log" | tail -3 | tr '\n' ' ')")
    fi
  elif [ ! -d "$d/node_modules" ]; then
    missing+=("dependencies in $d (bun install --frozen-lockfile)")
  fi
done

# A copy counts only when it holds api.js. On 2026-10-12 the main checkout's
# creative folder was empty, so an empty folder was copied and the ship
# stopped at the creative retention test. The first clone with a full copy
# is used: SOURCE_CHECKOUT, then every other worktree of this repository.
sources=("$source_checkout")
while IFS= read -r w; do sources+=("$w"); done \
  < <(git worktree list --porcelain | sed -n 's/^worktree //p')
for d in "${generated_dirs[@]}"; do
  [ -d "$d/convex" ] || continue
  [ -f "$d/convex/_generated/api.js" ] && continue
  from=""
  for s in "${sources[@]}"; do
    if [ -f "$s/$d/convex/_generated/api.js" ]; then from="$s"; break; fi
  done
  if [ -z "$from" ]; then
    failed+=("$d/convex/_generated has no api.js, and no worktree of this repository has a full copy. Set SOURCE_CHECKOUT to a clone that has one")
  elif [ -n "$apply" ]; then
    if mkdir -p "$d/convex/_generated" \
       && cp -r "$from/$d/convex/_generated/." "$d/convex/_generated/"; then
      echo "generated types copied into $d/convex/_generated from $from"
    else
      failed+=("could not copy $from/$d/convex/_generated")
    fi
  else
    missing+=("generated Convex types in $d/convex/_generated (copied from $from)")
  fi
done

# Each app's link must name the project config/vercel-projects.json names, or
# the CLI deploys to a new project and the site keeps its old bundle
# (2026-10-05). The ids are not secret.
while IFS= read -r line; do
  case "$line" in
    ok:*) echo "${line#ok:}" ;;
    missing:*) missing+=("${line#missing:}") ;;
    failed:*) failed+=("${line#failed:}") ;;
  esac
done < <(APPLY="$apply" "$py_bin" - <<'PY'
import json, os, pathlib
config = json.loads(pathlib.Path("config/vercel-projects.json").read_text(encoding="utf-8"))
apply = bool(os.environ.get("APPLY"))
for app_dir, project in config.items():
    if not pathlib.Path(app_dir).is_dir():
        continue
    link = pathlib.Path(app_dir) / ".vercel" / "project.json"
    want = {k: project[k] for k in ("projectId", "orgId", "projectName")}
    try:
        have = json.loads(link.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        have = None
    if have and have.get("projectId") == want["projectId"] and have.get("orgId") == want["orgId"]:
        continue
    what = "Vercel link %s (written from config/vercel-projects.json)" % link.as_posix()
    if not apply:
        print("missing:" + what)
        continue
    try:
        link.parent.mkdir(exist_ok=True)
        link.write_text(json.dumps(want, separators=(",", ":")), encoding="utf-8")
        print("ok:%s linked to %s" % (app_dir, want["projectName"]))
    except OSError as exc:
        print("failed:could not write %s: %s" % (link.as_posix(), exc))
PY
)

if [ ${#failed[@]} -gt 0 ]; then
  echo "Could not prepare this worktree:"
  printf '  - %s\n' "${failed[@]}"
fi
if [ ${#missing[@]} -gt 0 ]; then
  echo "Missing in this worktree (scripts/prepare-worktree.sh --apply adds them):"
  printf '  - %s\n' "${missing[@]}"
fi
if [ ${#failed[@]} -gt 0 ] || [ ${#missing[@]} -gt 0 ]; then
  exit 1
fi
echo "This worktree has its dependencies, generated types and Vercel links."
