# Hiring on Supabase: switching it on

Written 2026-10-11. The careers Typeforms stopped reaching the MaharaMedia Hiring
sub-account when Convex stopped on 2026-10-07, and the Hiring tab's buttons
(Pull the board, grade, the track switch) stopped with them. The replacement was
built on 2026-10-09 (`hiring-sync` and `hiring-api`, migration
`20261009c_hiring_native.sql`) but never switched on. These are the steps, in
order. Each one is a person's or the lead session's; no builder runs them.

The CEO's words this answers:

- "All the type form applications pull straight into GoHighLevel as well through
  the pipeline stages, and we can connect it to the CEO cockpit to make it as
  easy as possible."
- "For the sales rep, you should give me an option: … I make them a setter, and
  then they turn into a closer. … I just bring them straight to becoming a closer."

## What switching on cannot do

- **Message a candidate.** The schedule never sends. The engine only writes
  drafts, and stands down entirely while GoHighLevel is the sender (the
  default). A draft leaves only when the CEO presses Send and
  `HIRING_SEND_ENABLED` is exactly `true`. Leave `HIRING_SEND_ENABLED` unset.
  Imported cards land at Application, and none of the 36 hiring workflows
  triggers on Application (all 36 are drafts anyway).
- **File anyone twice.** Each form remembers the responses it filed
  (`cockpit_hiring_meta` `intake:<form>`, carried over from Convex), so the
  import resumes where Convex stopped. Contacts are matched on email or phone.
  The note carries its form response id, and a contact that already holds that
  response (or the same questionnaire word for word) gets no second note. A
  contact with a card on the role's board keeps that one card, and GoHighLevel
  refuses a duplicate card anyway. One run per job at a time (the run lock). A
  form that PR #31's importer files live is left to it; two importers must never
  run on one form, and PR #31 stays unmerged.
- **File anything on its first run.** The first intake run after the switch-on
  is a dry run on purpose, even with `HIRING_APPLY=true`: it lists what it would
  file in `cockpit_hiring_runs.result` and writes nothing. The run after it
  (30 minutes later) files. `{"job":"intake","dryRun":true}` asks for another
  dry run at any time.

## 1. Deploy the two functions (after the branch is merged)

First, before any secret: until step 2 the new code only answers "not connected", so the old
v4 code never runs with live writes and no first-run dry run.

From a throwaway worktree at merged main (the shared checkout is never moved):

```sh
python3 scripts/dev/deploy_composio.py hiring-sync --extra supabase/functions/_shared/hiring --verify-jwt off --dry
python3 scripts/dev/deploy_composio.py hiring-sync --extra supabase/functions/_shared/hiring --verify-jwt off
python3 scripts/dev/deploy_composio.py hiring-api  --extra supabase/functions/_shared/hiring --verify-jwt on --dry
python3 scripts/dev/deploy_composio.py hiring-api  --extra supabase/functions/_shared/hiring --verify-jwt on
```

`hiring-sync` must read `verify_jwt false` afterwards (the cron secret is its
only key) and `hiring-api` `verify_jwt true`. Both were v4 on 2026-10-11.

Then ship the portal, which carries the Hiring tab's "Find people for this
role" and the "One-to-one interview" label: `scripts/ship.sh media-buyer`, and
check the live bundle has the words "Find people for this role".

## 2. Secrets (Edge Functions, Creative Triage `bldgtotkfmhoxmlzowdx`)

| Name | Value | Where it comes from |
|---|---|---|
| `GHL_HIRING_PIT` | the hiring sub-account's private integration token (`pit-…`, 40 characters) | VPS `/home/hermes/.cockpit-native-state/runtime-<release>.json`, where `<release>` is the folder `~/cockpit-native-current` points at (`c3a9ex01` on 2026-10-11). Mode 600. |
| `GHL_HIRING_LOCATION` | `2FMeC6zxqelIG07OViBj` (MaharaMedia Hiring) | the same file |
| `HIRING_APPLY` | `true` | typed; without it every GoHighLevel write is a dry run |
| `TYPEFORM_TOKEN` | already set | nothing to do |
| `CRON_SECRET` | already set; pairs with the vault secret `cockpit_sync_secret` | nothing to do (onboarding-sync proves the pair) |
| `HIRING_SEND_ENABLED` | **leave unset** | |

The value never reaches the screen or the chat. From the Mac:

```sh
umask 077; T=$(mktemp)
ssh -i ~/.ssh/faris-key hermes@187.77.156.166 'python3 -c "
import json, pathlib
r = pathlib.Path(\"/home/hermes/cockpit-native-current\").resolve().name
d = json.loads(pathlib.Path(f\"/home/hermes/.cockpit-native-state/runtime-{r}.json\").read_text())
print(json.dumps({\"ref\": \"bldgtotkfmhoxmlzowdx\", \"secrets\": [
  {\"name\": \"GHL_HIRING_PIT\", \"value\": d[\"GHL_HIRING_PIT\"]},
  {\"name\": \"GHL_HIRING_LOCATION\", \"value\": d[\"GHL_HIRING_LOCATION\"]},
  {\"name\": \"HIRING_APPLY\", \"value\": \"true\"}]}))
"' > "$T"
composio execute SUPABASE_CREATE_BULK_SECRETS -d @"$T" < /dev/null \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print("ok" if d.get("successful") else "refused", str(d.get("error") or "")[:200])'
rm -f "$T"
composio execute SUPABASE_LIST_SECRETS -d '{"ref":"bldgtotkfmhoxmlzowdx"}' < /dev/null \
  | python3 -c 'import json,sys; d=json.load(sys.stdin)["data"]; rows=d.get("details", d); names={r["name"] for r in rows}; print({n: n in names for n in ["GHL_HIRING_PIT","GHL_HIRING_LOCATION","HIRING_APPLY","TYPEFORM_TOKEN","CRON_SECRET","HIRING_SEND_ENABLED"]})'
```

The last line must print `HIRING_SEND_ENABLED: False` and the other five `True`.

## 3. Apply the migration (it holds the schedule)

`supabase/migrations/20261009c_hiring_native.sql` creates `cockpit_hiring_runs`
(the run ledger and lock), `cockpit_hiring_provider_health`,
`cockpit_hiring_sends`, the function `cockpit_hiring_claim_run`, the grants, and
the three pg_cron jobs. Additive and safe to run again. Apply it after steps 1
and 2, so the first scheduled runs find the new code and their keys.

```sh
python3 - <<'PY' > /tmp/hiring-migration.json
import json, re
sql = open("supabase/migrations/20261009c_hiring_native.sql").read()
sql = re.sub(r"(?im)^\s*begin;\s*$", "", sql); sql = re.sub(r"(?im)^\s*commit;\s*$", "", sql)
print(json.dumps({"ref": "bldgtotkfmhoxmlzowdx", "name": "20261009c_hiring_native", "query": sql}))
PY
composio execute SUPABASE_APPLY_A_MIGRATION -d @/tmp/hiring-migration.json < /dev/null | head -c 400; rm -f /tmp/hiring-migration.json
```

| Job | Schedule (UTC) | Body |
|---|---|---|
| `mahara-hiring-mirror` | `1-59/10 * * * *` | `{"job":"mirror"}`: the boards into `cockpit_hiring_candidates` |
| `mahara-hiring-engine` | `6-59/10 * * * *` | `{"job":"engine"}`: drafts only; stands down while GoHighLevel sends |
| `mahara-hiring-intake` | `8,38 * * * *` | `{"job":"intake"}`: the five careers Typeforms into the boards |

Each posts to `https://bldgtotkfmhoxmlzowdx.supabase.co/functions/v1/hiring-sync`
with `x-cron-secret` from the vault (`cockpit_sync_secret`), like
`mahara-onboarding-sync`.

## 4. The VPS (prepared; the crontab does not change)

"Find people for this role" is answered by the five-minute `radar.py pending`
run that already exists. Copy the two radar files from the merged worktree and
run the tests there:

```sh
rsync -a hermes/ideation-radar/radar/hiring.py hermes@187.77.156.166:~/mahara-cockpits/hermes/ideation-radar/radar/hiring.py -e "ssh -i ~/.ssh/faris-key"
rsync -a hermes/ideation-radar/radar.py hermes@187.77.156.166:~/mahara-cockpits/hermes/ideation-radar/radar.py -e "ssh -i ~/.ssh/faris-key"
rsync -a hermes/ideation-radar/tests/test_hiring.py hermes@187.77.156.166:~/mahara-cockpits/hermes/ideation-radar/tests/test_hiring.py -e "ssh -i ~/.ssh/faris-key"
ssh -i ~/.ssh/faris-key hermes@187.77.156.166 'cd ~/mahara-cockpits/hermes/ideation-radar && python3 -m unittest discover -s tests -t . 2>&1 | tail -3'
```

The CEO refresh reads `hermes/ceo-refresh/native/hiring/spec.js` for the stage
names; it ships with the next native release and reads both stage names until
then.

## 5. Rename the stage to "One-to-one interview" (his words)

Read the dry run, then apply, both with `--calendar`: "make everything extremely
neat: the custom values, the names, everything" covers the words a candidate
reads too. It renames the stage in place on the six boards and keeps every stage
id, so the 36 workflow triggers and every card stay where they are. It also
renames the score field ("Score 4, one-to-one", same id and key), changes
"after the one to one" to "after the one-to-one" in the custom value "Call
centre agent - Test project", and with `--calendar` renames the booking calendar
and its "Book your one to one" line. It touches no workflow, contact, card or
message, and reads every change back.

```sh
ssh -i ~/.ssh/faris-key hermes@187.77.156.166 'python3 - --calendar' < scripts/hiring/ghl_hiring_stages.py           # dry run: reads only
ssh -i ~/.ssh/faris-key hermes@187.77.156.166 'python3 - --apply --calendar' < scripts/hiring/ghl_hiring_stages.py
```

The 2026-10-11 dry run listed 6 stages, field `y0WMaKmIFg9FAMlpXnc0`, custom value
`HZTUIxzh1uUPSHAZG58z` and calendar `YZ9oJi9KJJga9coMHoeK`; exit 0 after
`--apply` means every read-back matched.

Undo: the same with `--undo --apply --calendar`. Stage colours: a HighLevel
stage has no colour (the API's stage record holds only its id, name, position,
the two funnel flags and the win probability), so there is nothing to set.

## 6. WhatsApp as the backup (the CEO's browser)

`docs/hiring/ghl-hiring-phase-b.js` (v4) runs in his signed-in GoHighLevel tab,
as the third run did. It stops before writing anything if WhatsApp is not
connected on MaharaMedia Hiring. Otherwise it submits 36 WhatsApp templates to
Meta and, once Meta approves each, adds a WhatsApp step after the SMS (a second
run, a day later). GoHighLevel cannot branch on "the SMS failed", so the backup
is WhatsApp sent after the SMS. It publishes nothing and keeps each workflow's
status. Dry run: `node docs/hiring/ghl-hiring-phase-b.test.mjs`.

## Checks, after steps 1 to 3

```sql
-- the three jobs, active
select jobname, schedule, active from cron.job where jobname like 'mahara-hiring-%' order by 1;
-- fresh, ok runs (mirror within 15 minutes; intake within 35)
select key, ok, last_run_at, last_ok_at, note from public.cockpit_sync_state where key like 'hiring-sync:%' order by 1;
select max(synced_at) from public.cockpit_hiring_candidates;
-- the first intake run is a dry run on purpose; the second files
select job, trigger, status, apply, started_at, result->>'read' read, result->>'added' added,
       result->>'firstRun' first_run, result->>'dryRun' dry_run, error
  from public.cockpit_hiring_runs order by started_at desc limit 10;
-- the first run's plan, read before the next run files it (within 30 minutes): when each was sent, newest
-- filed before was 2026-10-05, so nothing much older should be listed; if it is, unschedule mahara-hiring-intake
select p->>'submittedAt' sent, r->>'role' role, p->>'name' name, p->>'would' would
  from public.cockpit_hiring_runs h, jsonb_array_elements(h.result->'results') r, jsonb_array_elements(r->'planned') p
 where h.job = 'intake' and h.apply = false and h.status = 'ok' order by h.started_at desc, 1 limit 100;
-- the forms move on after a live run
select key, updated_at, jsonb_array_length(value->'seen') seen from public.cockpit_hiring_meta where key like 'intake:%' order by 1;
-- no failed provider calls
select provider, method, resource, http_status, error, created_at from public.cockpit_hiring_provider_health
 where phase = 'failed' or http_status >= 400 order by created_at desc limit 20;
```

GoHighLevel (GET only): new contacts and cards dated after 2026-10-07 in
MaharaMedia Hiring; still 36 workflows, all draft; the stages read
"One-to-one interview" with the same ids.

The Hiring tab: "Pull the board" answers; a grade or the track switch saves
(they answered "Dry run" before `HIRING_APPLY`); "Find people for this role"
says "Asked at …" and the answer appears within five minutes, with
`headhunt:<role>` updated:

```sql
select key, updated_at, value->>'status' status, value->>'error' error from public.cockpit_hiring_meta where key like 'headhunt%' order by updated_at desc;
```

Ask for a dry run of the import at any time (it files nothing):

```sql
select net.http_post(url := 'https://bldgtotkfmhoxmlzowdx.supabase.co/functions/v1/hiring-sync',
  headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='cockpit_sync_secret')),
  body := '{"job":"intake","dryRun":true}'::jsonb, timeout_milliseconds := 150000);
```

## Rollback

```sql
select cron.unschedule(jobid) from cron.job where jobname like 'mahara-hiring-%';
```

Then delete the `HIRING_APPLY` secret (Composio `SUPABASE_DELETE_SECRETS`) so
every GoHighLevel write is a dry run again. The tables stay; nothing reads them
until the jobs come back. The stage rename undoes with `--undo --apply --calendar`.
