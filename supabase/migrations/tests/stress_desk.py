#!/usr/bin/env python3
"""Stress round 1 on the live tables: the follow-up agent's rules as the
production database keeps them, proved without leaving a row behind.

    python3 supabase/migrations/tests/stress_desk.py

Each check is one DO block that ends by raising STRESS-RESULT with its
findings as JSON, so Postgres rolls every write in it back: nothing is ever
committed. Synthetic rows only: contact ids start with 'stress-', the wave's
made_by ends with '@stress.invalid'. Afterwards the script reads the tables to
prove no such row is left (it never deletes anything, because nothing was
kept). The pg_cron sweeps cannot see an uncommitted row.

What it pins (2026-10-03):
  1. The desk marks a member drafted with a draft id it made, then writes the
     draft (waves.py _draft_wave). The members' followup_id foreign key is not
     deferrable, so that first write fails with 23503 and the waves job dies.
  2. The other order (draft, then member, then meta) works, with the desk's
     own row shape.
  3. One open membership per lead across every wave: the desk's
     on_conflict=(wave_id,contact_id) ignore-duplicates insert still meets
     23505 from the partial index (the desk's per-row fallback reads it).
  4. One running or paused wave per pool; a done wave never moves again; a
     held-back member is never drafted.
  5. Postgres returns a time with its trailing zeros trimmed ('.12'), and the
     desk's followups._ts (Python 3.9 fromisoformat) must still read it.

The management token is read from SUPABASE_ACCESS_TOKEN or
~/.config/mahara/sb_mgmt_token and is never printed. Exit 0 only when every
check holds and nothing was left behind.
"""
import json
import os
import re
import sys
import urllib.error
import urllib.request

REF = "bldgtotkfmhoxmlzowdx"
HERE = os.path.dirname(os.path.abspath(__file__))
DESK = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(HERE))), "hermes", "sales-desk")


def token() -> str:
    t = os.environ.get("SUPABASE_ACCESS_TOKEN", "").strip()
    if t:
        return t
    path = os.path.expanduser("~/.config/mahara/sb_mgmt_token")
    if not os.path.exists(path):
        sys.exit("No management token: set SUPABASE_ACCESS_TOKEN or write it to ~/.config/mahara/sb_mgmt_token.")
    return open(path).read().strip()


def query(sql: str, write: bool) -> tuple[int, str]:
    req = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{REF}/database/query",
        data=json.dumps({"query": sql, "read_only": not write}).encode(),
        headers={"Authorization": f"Bearer {token()}", "Content-Type": "application/json", "User-Agent": "mahara-stress/1"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


def rolled_back(body: str) -> dict:
    """Run a DO block whose last statement raises STRESS-RESULT <json>; return the json."""
    assert re.search(r"\b(commit|rollback)\b", body, re.I) is None, "a check never ends its own transaction"
    sql = "do $stress$\ndeclare r jsonb := '{}'::jsonb;\n" + body + "\nend $stress$;"
    status, text = query(sql, write=True)
    try:
        msg = str(json.loads(text).get("message", ""))
    except (ValueError, AttributeError):
        msg = text
    m = re.search(r"STRESS-RESULT (\{.*\})\s*(?:CONTEXT|$)", msg, re.S)
    if not m:
        raise SystemExit(f"the check did not report (HTTP {status}): {text[:400]}")
    return json.loads(m.group(1))


TRY = """
  begin
    {stmt}
    r := r || jsonb_build_object('{name}', 'ok');
  exception when others then
    r := r || jsonb_build_object('{name}', sqlstate || ' ' || left(sqlerrm, 160));
  end;"""


def attempt(name: str, stmt: str) -> str:
    return TRY.format(name=name, stmt=stmt)


CHECKS = [
    ("member_first", "The old order (member drafted with a desk-made id, then the draft) is refused by production's "
                     "foreign key, which is why the desk now writes the draft first (waves.py _draft_wave)",
     "  wid uuid; fid uuid := gen_random_uuid();\nbegin\n"
     "  insert into cockpit_sales_followup_waves (pool, state, made_by) values ('never_booked','running','stress@stress.invalid') returning id into wid;\n"
     "  insert into cockpit_sales_followup_wave_members (wave_id, contact_id, arm, state) values (wid, 'stress-desk-1', 'wave', 'waiting');\n"
     + attempt("member_first", "update cockpit_sales_followup_wave_members set state='drafted', followup_id=fid, drafted_at=now() "
                               "where wave_id=wid and contact_id='stress-desk-1' and state='waiting';")
     + "\n  raise exception 'STRESS-RESULT %', r::text;",
     lambda r: str(r.get("member_first", "")).startswith("23503")),
    ("draft_first", "The desk's order: the draft first (the desk's row shape), then the member and the meta row",
     "  wid uuid; fid uuid := gen_random_uuid();\nbegin\n"
     "  insert into cockpit_sales_followup_waves (pool, state, made_by) values ('never_booked','running','stress@stress.invalid') returning id into wid;\n"
     "  insert into cockpit_sales_followup_wave_members (wave_id, contact_id, arm, state) values (wid, 'stress-desk-2', 'wave', 'waiting');\n"
     + attempt("draft", "insert into cockpit_sales_followups (id, contact_id, owner_ghl, owner_email, segment, channel, template_key, "
                        "touch, heat, appointment_id, subject, body, why, context, model, status, created_at, expires_at) values "
                        "(fid, 'stress-desk-2', null, null, 'reactivate', 'whatsapp_template', 'opener_ar', 1, 10, null, null, "
                        "'Hi Omar', 'Backlog wave, stress test.', jsonb_build_object('wave_id', wid::text, 'arm', 'wave'), null, "
                        "'draft', now(), now() + interval '48 hours');")
     + attempt("member", "update cockpit_sales_followup_wave_members set state='drafted', followup_id=fid, drafted_at=now() "
                         "where wave_id=wid and contact_id='stress-desk-2' and state='waiting';")
     + attempt("meta", "insert into cockpit_sales_followup_meta (followup_id, kind_key, wave_id) values "
                       "(fid, 'reactivate.ar.whatsapp_template', wid) on conflict (followup_id) do nothing;")
     + "\n  raise exception 'STRESS-RESULT %', r::text;",
     lambda r: (r.get("draft"), r.get("member"), r.get("meta")) == ("ok", "ok", "ok")),
    ("one_open_membership", "One open membership per lead across waves, through the desk's own insert",
     "  a uuid; b uuid;\nbegin\n"
     "  insert into cockpit_sales_followup_waves (pool, state, made_by) values ('never_booked','running','stress@stress.invalid') returning id into a;\n"
     "  insert into cockpit_sales_followup_waves (pool, state, made_by) values ('good_intro','running','stress@stress.invalid') returning id into b;\n"
     "  insert into cockpit_sales_followup_wave_members (wave_id, contact_id, arm, state) values (a, 'stress-desk-3', 'wave', 'waiting');\n"
     + attempt("other_wave", "insert into cockpit_sales_followup_wave_members (wave_id, contact_id, arm, state) values "
                             "(b, 'stress-desk-3', 'wave', 'waiting') on conflict (wave_id, contact_id) do nothing;")
     + attempt("same_wave_again", "insert into cockpit_sales_followup_wave_members (wave_id, contact_id, arm, state) values "
                                  "(a, 'stress-desk-3', 'wave', 'waiting') on conflict (wave_id, contact_id) do nothing;")
     + "\n  raise exception 'STRESS-RESULT %', r::text;",
     lambda r: str(r.get("other_wave", "")).startswith("23505") and r.get("same_wave_again") == "ok"),
    ("waves_rules", "One running or paused wave per pool; a done wave never resumes; a held-back member is never drafted",
     "  a uuid;\nbegin\n"
     "  insert into cockpit_sales_followup_waves (pool, state, made_by) values ('unclosed_demo','paused','stress@stress.invalid') returning id into a;\n"
     + attempt("second_on_pool", "insert into cockpit_sales_followup_waves (pool, state, made_by) values "
                                 "('unclosed_demo','running','stress@stress.invalid');")
     + "\n  update cockpit_sales_followup_waves set state='done', done_reason='Stopped by a manager.' where id=a;"
     + attempt("resume_done", "update cockpit_sales_followup_waves set state='running' where id=a;")
     + "\n  insert into cockpit_sales_followup_wave_members (wave_id, contact_id, arm, state) values (a, 'stress-desk-4', 'holdout', 'held_out');"
     + attempt("holdout_drafted", "update cockpit_sales_followup_wave_members set state='drafted' where wave_id=a and contact_id='stress-desk-4';")
     + "\n  raise exception 'STRESS-RESULT %', r::text;",
     lambda r: str(r.get("second_on_pool", "")).startswith("23505") and str(r.get("resume_done", "")).startswith("P0001")
     and str(r.get("holdout_drafted", "")).startswith("23514")),
    ("trimmed_time", "A stored time comes back with its trailing zeros trimmed, and the desk reads it",
     "  v text;\nbegin\n"
     "  insert into cockpit_sales_followup_stops (contact_id, said_at, kind, state, paused_until, created_by) values "
     "('stress-desk-5', '2026-10-02 08:00:00.12+00', 'manual', 'paused', '2026-11-01 08:00:00.12+00', 'stress@stress.invalid');\n"
     "  select to_json(paused_until)::text into v from cockpit_sales_followup_stops where contact_id='stress-desk-5';\n"
     "  r := r || jsonb_build_object('paused_until', trim(both '\"' from v));\n"
     "  raise exception 'STRESS-RESULT %', r::text;",
     None),
]


def desk_reads(value: str) -> bool:
    sys.path.insert(0, DESK)
    os.environ.setdefault("SALES_NO_KEY_FILES", "1")
    from desk import followups as fu  # noqa: E402
    return fu._ts(value) is not None


def main() -> int:
    failed = 0
    for name, words, body, ok in CHECKS:
        r = rolled_back(body)
        if ok is None:  # the trimmed time: the desk must read what Postgres returns
            v = str(r.get("paused_until", ""))
            good = bool(re.search(r"\.\d{1,5}[+-]", v)) and desk_reads(v)
            detail = f"Postgres returned {v!r}; the desk's _ts reads it: {desk_reads(v)}"
        else:
            good, detail = ok(r), json.dumps(r)
        failed += not good
        print(f"{'ok  ' if good else 'FAIL'} {name}: {words}\n     {detail}")
    status, text = query(
        "select (select count(*) from cockpit_sales_followup_waves where made_by like '%@stress.invalid') as waves,"
        " (select count(*) from cockpit_sales_followup_wave_members where contact_id like 'stress-%') as members,"
        " (select count(*) from cockpit_sales_followups where contact_id like 'stress-%') as drafts,"
        " (select count(*) from cockpit_sales_followup_stops where contact_id like 'stress-%') as stops", write=False)
    left = json.loads(text)[0] if status in (200, 201) else {"error": text[:200]}
    clean = all(v == 0 for v in left.values()) if "error" not in left else False
    print(f"{'ok  ' if clean else 'FAIL'} nothing left behind: {left}")
    return 0 if failed == 0 and clean else 1


if __name__ == "__main__":
    sys.exit(main())
