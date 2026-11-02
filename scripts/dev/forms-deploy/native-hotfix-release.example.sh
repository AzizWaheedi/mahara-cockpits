#!/bin/bash
# Release w56money of the native workers (Claude for Aziz, 2026-11-02): waves 5-6 D-H2/D-J2, wins, upsell ties and LTV in the money and growth sections.
# Base: live release w34voice. Four files from main 6e00077b (metrics.ts) and forms-w56 b7ab2d11: churnCore.ts, growth.js, money.js, metrics.ts.
#   hermes/ceo-refresh/native/adapters/money.js, .../growth.js, hermes/ceo-refresh/native/metrics.ts
# What it does: cash, LTV, pay and the deal ledger count hand-logged payments only once checked against the bank
# (20261101n is live); logged money shows apart (rails.manualLogged). Same base/staged checks as n4store1.
# The CEO dry run must compute every section, money included. Rollback: point the link back at pf1forms.
set -u
R=/home/hermes/.cockpit-native-releases; ST=/home/hermes/.cockpit-native-state; ID=w56monx2; BASE=w34voice
P=$R/$ID.partial; F=$R/$ID; U=$ST/upload-$ID
FILES="apps/client-success-cockpit/src/lib/churnCore.ts hermes/ceo-refresh/native/adapters/growth.js hermes/ceo-refresh/native/adapters/money.js hermes/ceo-refresh/native/metrics.ts"
step(){ echo "$(date -u +%FT%TZ) $*"; }
fail(){ step "RELEASE FAILED: $*"; echo "failed" > $ST/release-$ID.status; exit 1; }
echo "running" > $ST/release-$ID.status
check_base(){
  [ "$(readlink -f /home/hermes/cockpit-native-current)" = "$R/$BASE" ] || fail "live release is $(readlink -f /home/hermes/cockpit-native-current), not $BASE; not building on a moved base"
  while read -r want path; do
    have=$(md5sum "$R/$BASE/$path" | cut -c1-32)
    [ -n "$have" ] && [ "$have" = "$want" ] || fail "live $path is $have, not the version this release was written against ($want)"
  done <<'BASES'
074551f21d0581fd929efe7a6a3dc638 apps/client-success-cockpit/src/lib/churnCore.ts
a7943ef8956f724b3e27ef501699614f hermes/ceo-refresh/native/adapters/growth.js
1376f017fe26d7e3f8c0b52da535548a hermes/ceo-refresh/native/adapters/money.js
6b7134a41f9511e5aa66edf727e5c382 hermes/ceo-refresh/native/metrics.ts
BASES
}
check_staged(){
  (cd "$U" && sha256sum -c --quiet SUMS) || fail "uploaded file hashes do not match"
  (cd "$F" && sha256sum -c --quiet "$U/SUMS") || fail "staged file hashes do not match"
  extra=$(diff -rq -x __pycache__ "$R/$BASE" "$F" 2>&1 | grep -v -x -F -e "Files $R/$BASE/apps/client-success-cockpit/src/lib/churnCore.ts and $F/apps/client-success-cockpit/src/lib/churnCore.ts differ" -e "Files $R/$BASE/hermes/ceo-refresh/native/adapters/growth.js and $F/hermes/ceo-refresh/native/adapters/growth.js differ" -e "Files $R/$BASE/hermes/ceo-refresh/native/adapters/money.js and $F/hermes/ceo-refresh/native/adapters/money.js differ" -e "Files $R/$BASE/hermes/ceo-refresh/native/metrics.ts and $F/hermes/ceo-refresh/native/metrics.ts differ" -e "Files $R/$BASE/release-note.json and $F/release-note.json differ")
  [ -z "$extra" ] || fail "staged folder differs from $BASE beyond the replaced files: $(echo "$extra" | head -5)"
}
step "check the base and the files this release replaces"
check_base
if [ ! -d "$F" ]; then
  step "stage $ID from $BASE"
  rm -rf "$P"
  cp -a "$R/$BASE" "$P" || fail "copy of $BASE"
  (cd "$U" && sha256sum -c --quiet SUMS) || fail "uploaded file hashes do not match"
  for f in $FILES; do chmod u+w "$P/$f" "$(dirname "$P/$f")" || fail "unlock $f"; done
  for f in $FILES; do cp "$U/$f" "$P/$f" || fail "copy $f"; done
  (cd "$P" && sha256sum -c --quiet "$U/SUMS") || fail "staged file hashes do not match"
  chmod u+w "$P/release-note.json" "$P" 2>/dev/null
  cat > "$P/release-note.json" <<'NOTE'
{"release":"w56monx2","commit":"b7ab2d11 on forms-w56 (PR to come)","base_release":"w34voice",
 "replaced":["apps/client-success-cockpit/src/lib/churnCore.ts", "hermes/ceo-refresh/native/adapters/growth.js", "hermes/ceo-refresh/native/adapters/money.js", "hermes/ceo-refresh/native/metrics.ts"],
 "why":"Waves 5-6: win ties as back-end money, LTV and wins in the money and growth sections, the churn roll-up with reactivation. Rollback: point the link back at w34voice. (Claude for Aziz, 2026-11-02)"}
NOTE
  for f in $FILES; do chmod a-w "$P/$f"; done
  mv "$P" "$F" || fail "could not finalize the release folder"
fi
[ -d "$F" ] || fail "no release folder"
check_staged
step "staged folder ok: only the four money files and the note differ from $BASE"
if [ -f $ST/runtime-$ID.json ]; then cmp -s $ST/runtime-$ID.json $ST/runtime-$BASE.json || fail "runtime-$ID.json differs from runtime-$BASE.json"; else cp -p $ST/runtime-$BASE.json $ST/runtime-$ID.json || fail "runtime copy"; fi
run(){ python3 -c 'import json,os,sys;e=dict(os.environ);e.update(json.load(open(sys.argv[1])));e["PATH"]=sys.argv[2]+"/tools:"+e["PATH"];os.chdir(sys.argv[2]);os.execvpe(sys.argv[3],sys.argv[3:],e)' $ST/runtime-$ID.json $F $F/tools/bun "$@"; }
step "doctors"
run hermes/cockpit-sync/worker.ts doctor --sources > $ST/doctor-$ID-sync.log 2>&1 || fail "sync doctor, see doctor-$ID-sync.log"
run hermes/ceo-refresh/worker.ts doctor > $ST/doctor-$ID-ceo.log 2>&1 || fail "CEO doctor, see doctor-$ID-ceo.log"
step "doctors ok"
step "sync dry run (no --apply)"
mkdir -p $ST/dry-$ID; DRY=$ST/dry-$ID/sync-plan-$(date -u +%Y%m%dT%H%M%SZ).json
/usr/bin/flock -w 1500 $ST/native-source-ceo.lock bash -c "$(declare -f run); ST=$ST; ID=$ID; F=$F; run hermes/cockpit-sync/worker.ts --report $DRY" > $ST/sync-$ID-dry.log 2>&1 || fail "sync dry run, see sync-$ID-dry.log"
python3 - $DRY $ST/latest-native-cycle.json <<'PY2' || fail "sync dry run plan check"
import json, sys
plan = json.load(open(sys.argv[1]))
if plan.get('dry_run') is not True: print('not a dry run plan'); sys.exit(1)
p = plan['plan']; counts = p.get('counts') or {}
latest = json.load(open(sys.argv[2])); receipt = json.load(open(latest['receipt']))
live = next((j.get('publication', {}).get('counts') for j in receipt.get('jobs', []) if j.get('job') == 'sync'), None) or {}
missing = sorted(k for k in live if k not in counts)
dropped = sorted(k for k in live if live[k] > 0 and counts.get(k) == 0)
cl = (p.get('csm') or {}).get('clients') or []
print(json.dumps({'tables': len(counts), 'live_tables': len(live), 'missing': missing, 'dropped_to_zero': dropped, 'csm_clients': len(cl)}))
sys.exit(1 if (missing or dropped or not cl) else 0)
PY2
step "sync dry run ok"
step "CEO dry run (no --apply)"
/usr/bin/flock -w 1500 $ST/native-source-ceo.lock bash -c "$(declare -f run); ST=$ST; ID=$ID; F=$F; run hermes/ceo-refresh/worker.ts run --dry-run" > $ST/ceo-$ID-dry.log 2>&1
python3 - $ST/ceo-$ID-dry.log <<'PY' || fail "CEO dry run, see ceo-$ID-dry.log"
import json, sys
lines = [l for l in open(sys.argv[1]).read().splitlines() if l.startswith('{')]
report = json.loads(lines[-1])
secs = report.get('sections', [])
failed = [(s.get('key'), (s.get('error') or '')[:300]) for s in secs if s.get('status') == 'failed']
money = [s for s in secs if s.get('key') == 'money']
print(json.dumps({'status': report.get('status'), 'sections': [(s.get('key'), s.get('status')) for s in secs], 'failed': failed}))
sys.exit(1 if (failed or not money) else 0)
PY
step "CEO dry run ok"
python3 - $ST <<'PY' || fail "the latest regular cycles are not ceo_safe; a canary would be refused"
import json, pathlib, sys
st = pathlib.Path(sys.argv[1]); rows = []
for line in (st / 'native-cron.log').read_text().splitlines()[-12:]:
    try: rows.append(json.loads(line))
    except ValueError: pass
reached = [r for r in rows if r.get('source_published')]
last = reached[-1] if reached else None
print(json.dumps({'last_cycle_with_ceo': last and last.get('cycle'), 'ceo_safe': last and last.get('ceo_safe')}))
sys.exit(0 if last and last.get('ceo_safe') else 1)
PY
step "base and staged files again, right before the canary"
check_base
check_staged
echo "canary" > $ST/release-$ID.status
step "canary: one real cycle from $ID, the link switches only if it is ok"
/usr/bin/flock -w 1500 $ST/native-source-ceo.lock python3 $ST/canary-765e28f8.py $ID > $ST/canary-$ID.log 2>&1 || fail "canary, see canary-$ID.log"
tail -1 $ST/canary-$ID.log
grep -q '"activated": true' $ST/canary-$ID.log || fail "canary cycle not ok, link not switched (still on $BASE)"
step "RELEASE DONE: $(readlink -f /home/hermes/cockpit-native-current)"
echo "done" > $ST/release-$ID.status
