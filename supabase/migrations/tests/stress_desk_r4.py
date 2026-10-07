#!/usr/bin/env python3
"""Stress round 4 on the live tables: the follow-up agent's claim on an
approved opener, raced for real on production's Postgres (2026-10-03).

    python3 supabase/migrations/tests/stress_desk_r4.py

A rep's Hold (followupAgent.ts hold: held_by set where it is null) and
followup.send_due's claim (held_by sales-desk:sending where it is null), and
two send_due claims from two desk runs, are each one conditional UPDATE. The
waves job and sales-api lean on Postgres re-reading the row after the first
writer commits, so exactly one of two such writes lands. Here each pair runs
as two concurrent requests, the first holding its row lock for two seconds,
on synthetic rows only:

  * one draft wave (made_by ends with @stress.invalid; state draft, so the
    one-running-wave-per-pool index is never touched),
  * backlog openers whose contact_id starts with 'stress-r4-' and their meta.

Every row this script makes is committed (a race needs two transactions) and
then deleted by its own id, and the script proves none is left. The pg_cron
sweeps read rooms and status rows, never these tables.

The management token is read from SUPABASE_ACCESS_TOKEN or
~/.config/mahara/sb_mgmt_token and is never printed. Exit 0 only when every
check holds and nothing was left behind.
"""
import json
import os
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid

REF = "bldgtotkfmhoxmlzowdx"
RUN = uuid.uuid4().hex[:8]
CONTACT = f"stress-r4-{RUN}"
MADE_BY = f"desk-r4-{RUN}@stress.invalid"


def token() -> str:
    t = os.environ.get("SUPABASE_ACCESS_TOKEN", "").strip()
    if t:
        return t
    path = os.path.expanduser("~/.config/mahara/sb_mgmt_token")
    if not os.path.exists(path):
        sys.exit("No management token: set SUPABASE_ACCESS_TOKEN or write it to ~/.config/mahara/sb_mgmt_token.")
    return open(path).read().strip()


def query(sql: str, write: bool = True) -> list:
    req = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{REF}/database/query",
        data=json.dumps({"query": sql, "read_only": not write}).encode(),
        headers={"Authorization": f"Bearer {token()}", "Content-Type": "application/json", "User-Agent": "mahara-stress/1"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.loads(r.read() or b"null") or []
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"HTTP {e.code}: {e.read().decode()[:400]}") from None


def q(v: str) -> str:
    return "'" + v.replace("'", "''") + "'"


def setup() -> tuple[str, list[str]]:
    wave = str(uuid.uuid4())
    query(f"insert into cockpit_sales_followup_waves (id, pool, state, made_by) values ({q(wave)}, 'never_booked', 'draft', {q(MADE_BY)})")
    ids = []
    for i in range(2):
        fid = str(uuid.uuid4())
        ids.append(fid)
        # One open draft per lead (cockpit_sales_followups_one_open): one contact each.
        query("insert into cockpit_sales_followups (id, contact_id, segment, channel, template_key, touch, body, why, context, "
              f"status, created_at, expires_at) values ({q(fid)}, {q(f'{CONTACT}-{i}')}, 'reactivate', 'whatsapp_template', "
              "'opener_ar', 1, 'Hi Omar', 'Stress round 4: a claim raced on production.', "
              f"jsonb_build_object('wave_id', {q(wave)}, 'language', 'ar'), 'draft', now(), now() + interval '48 hours')")
        query(f"insert into cockpit_sales_followup_meta (followup_id, wave_id, kind_key, send_after, approved_by) values "
              f"({q(fid)}, {q(wave)}, 'reactivate.ar.whatsapp_template', now() - interval '1 minute', {q(MADE_BY)})")
    return wave, ids


def claim(fid: str, held_by: str, hold_s: float) -> int:
    """One conditional write (held_by where it is null), keeping its row lock hold_s seconds before it commits."""
    sleep = f", pg_sleep({hold_s})" if hold_s else ""
    rows = query(f"with u as (update cockpit_sales_followup_meta set held_by = {q(held_by)}, held_at = now() "
                 f"where followup_id = {q(fid)} and held_by is null returning 1) select (select count(*) from u) as n{sleep}")
    return int(rows[0]["n"])


def race(fid: str, first: str, second: str) -> dict:
    got: dict = {}

    def go(name: str, who: str, hold: float, delay: float) -> None:
        time.sleep(delay)
        try:
            got[name] = claim(fid, who, hold)
        except Exception as e:  # noqa: BLE001 - reported as the check's result
            got[name] = f"error: {e}"

    a = threading.Thread(target=go, args=("first", first, 2.0, 0.0))
    b = threading.Thread(target=go, args=("second", second, 0.0, 0.7))
    a.start()
    b.start()
    a.join()
    b.join()
    after = query(f"select held_by from cockpit_sales_followup_meta where followup_id = {q(fid)}", write=False)
    got["held_by"] = after[0]["held_by"] if after else None
    return got


def cleanup(wave: str, ids: list[str]) -> None:
    for fid in ids:
        query(f"delete from cockpit_sales_followup_meta where followup_id = {q(fid)}")
        query(f"delete from cockpit_sales_followups where id = {q(fid)} and contact_id like 'stress-r4-%'")
    query(f"delete from cockpit_sales_followup_waves where id = {q(wave)} and made_by = {q(MADE_BY)}")


def main() -> int:
    wave, ids = setup()
    failed = 0
    try:
        checks = [
            ("hold_then_claim", "A rep's Hold holding its lock while send_due claims: the Hold stands, the claim lands nowhere",
             ids[0], f"setter-{RUN}@stress.invalid", "sales-desk:sending",
             lambda r: r.get("first") == 1 and r.get("second") == 0 and str(r.get("held_by", "")).startswith("setter-")),
            ("two_claims", "Two desk runs' send_due claims at once: one lands, the other finds the opener taken",
             ids[1], "sales-desk:sending", "sales-desk:sending",
             lambda r: sorted([r.get("first"), r.get("second")]) == [0, 1]),
        ]
        for name, words, fid, first, second, ok in checks:
            r = race(fid, first, second)
            good = ok(r)
            failed += not good
            print(f"{'ok  ' if good else 'FAIL'} {name}: {words}\n     {json.dumps(r)}")
    finally:
        cleanup(wave, ids)
    left = query("select (select count(*) from cockpit_sales_followup_waves where made_by like '%@stress.invalid') as waves,"
                 " (select count(*) from cockpit_sales_followups where contact_id like 'stress-r4-%') as drafts,"
                 f" (select count(*) from cockpit_sales_followup_meta where followup_id in ({','.join(q(i) for i in ids)})) as meta",
                 write=False)[0]
    mine = query(f"select count(*) as n from cockpit_sales_followup_waves where made_by = {q(MADE_BY)}", write=False)[0]["n"]
    clean = int(mine) == 0 and int(left["drafts"]) == 0 and int(left["meta"]) == 0
    print(f"{'ok  ' if clean else 'FAIL'} nothing left behind: {json.dumps({**left, 'this_run_waves': mine})}")
    return 0 if failed == 0 and clean else 1


if __name__ == "__main__":
    sys.exit(main())
