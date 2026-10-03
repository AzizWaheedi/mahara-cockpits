#!/usr/bin/env python3
"""Run the review's adversarial checks (20261003_rooms_adversarial.sql) the same
safe way run_checks.py runs the lane's own checks: the three migrations and the
checks in ONE transaction that ends in rollback, lock_timeout 5 s, then a
read-only leftovers query.

    python3 supabase/migrations/tests/run_adversarial.py

Each check states the behaviour the specs or another lane expect, so a FAIL is
a confirmed finding. Exit code 0 when the run completed and nothing persisted
(FAILs are reported, not fatal); 1 when something was left behind or the run
could not finish.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import run_checks  # noqa: E402

run_checks.CHECKS = os.path.join(HERE, "20261003_rooms_adversarial.sql")
LEFTOVERS = run_checks.LEFTOVERS + r"""
union all
select 'auth user ' || email from auth.users where email like 'lc-test-%'
"""


def leftovers():
    return run_checks.query(LEFTOVERS, write=False) or []


def main():
    before = leftovers()
    rows = run_checks.query(run_checks.compose(applied=False), write=True) or []
    failed = [r for r in rows if not r.get("ok")]
    for r in rows:
        print(f"{'PASS' if r.get('ok') else 'FAIL'}  {r.get('name')}" + (f"  ({r.get('detail')})" if r.get("detail") else ""))
    print(f"\n{len(rows) - len(failed)} passed, {len(failed)} failed (each FAIL is a confirmed finding), {len(rows)} checks.")
    after = leftovers()
    new = [r["what"] for r in after if r not in before]
    if new:
        print("LEFT BEHIND after the rollback:", new)
        sys.exit(1)
    print("Nothing persisted.")
    sys.exit(0 if rows else 1)


if __name__ == "__main__":
    main()
