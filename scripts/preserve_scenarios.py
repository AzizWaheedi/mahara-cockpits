#!/usr/bin/env python3
"""Dry simulations of what the Supabase cutover could do to the preserved work, judged by verify-preserved.py.

Each scenario takes a recording of the sources (by default one built from docs/preserve/: everything exactly
as recorded on 2026-10-07), changes it the way one cutover action would, and replays it through the verifier.
Nothing live is read or touched; with --tape, a real recording made with
`python3 scripts/verify-preserved.py --record FILE` (read-only) is the starting point instead.

    python3 scripts/preserve_scenarios.py                 every scenario against the manifests
    python3 scripts/preserve_scenarios.py --tape FILE     against a live recording
    python3 scripts/preserve_scenarios.py --only c1,d     some of them
    python3 scripts/preserve_scenarios.py --json

What a scenario changes is a model of the action's effect on what the verifier reads (for a crontab put back
from an older copy: the lines it lacks, and the status rows of those jobs half an hour later). The guardian's
side of each action is in docs/PRESERVE-DURING-MIGRATION.md, section 7. Standard library only.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import importlib.util
import json
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

ROOT = Path(__file__).resolve().parents[1]
OLD_BRANCH = "1bccb34"   # codex/supabase-completion-20261004, 138 commits behind main on 2026-10-07
NEW_PROJECT = "newprojectref0000000"
STALE = 30               # minutes: each scenario is read half an hour after the action


def load_verifier():
    spec = importlib.util.spec_from_file_location("verify_preserved", ROOT / "scripts" / "verify-preserved.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules["verify_preserved"] = mod
    spec.loader.exec_module(mod)
    return mod


VP = load_verifier()


def sha(text: Any) -> str:
    return hashlib.sha256(text if isinstance(text, bytes) else str(text).encode("utf-8")).hexdigest()


def git(*args: str) -> str:
    return subprocess.run(["git", "-C", str(ROOT), *args], capture_output=True, text=True, timeout=120).stdout


# ---- a recording built from the manifests ---------------------------------------------------------------

def perfect_tape(sman: Dict[str, Any], vman: Dict[str, Any], ref: str = "origin/main") -> Dict[str, Any]:
    """What every source would answer if everything were exactly as recorded (backups left out: their
    sums live in the bucket, not in the manifests)."""
    t: Dict[str, Any] = {}
    base = sman["source"]["main_sha"]
    project = sman["project"]
    t["git tag on origin"] = f"{'0' * 40}\trefs/tags/{VP.TAG}\n{base}\trefs/tags/{VP.TAG}^{{}}\n"
    rel_rows, counts = [], []
    for r in sman["relations"]:
        rel_rows.append({
            "name": r["name"], "relkind": "v" if r.get("kind") == "view" else "r", "rls": r.get("rls"),
            "columns": [{"name": c["name"], "type": c["type"]} for c in r.get("columns") or []],
            "grants": r.get("grants") or {},
            "triggers": [{"name": x["name"], "function": x.get("function"), "enabled": x["enabled"], "md5": x["def_md5"]}
                         for x in r.get("triggers") or []],
            "policies": [{"name": p["policyname"], "cmd": p["cmd"], "roles": p["roles"], "qual_md5": p["qual_md5"],
                          "with_check_md5": p["with_check_md5"]} for p in r.get("policies") or []],
            "indexes": [{"name": i["name"], "md5": i["def_md5"]} for i in r.get("indexes") or []],
            "constraints": [{"name": k["name"], "md5": k["def_md5"]} for k in r.get("constraints") or []],
            "view_md5": r.get("view_def_md5"), "publications": r.get("realtime_publications") or [],
        })
        if r.get("kind", "table") == "table":
            counts.append({"name": r["name"], "n": r.get("row_count")})
    t["sql relations"], t["sql row_counts"] = rel_rows, counts
    fns = {}
    for group in ("created", "dependencies", "other_sales_and_guardian"):
        for f in sman["functions"].get(group) or []:
            fns.setdefault((f["name"], f.get("args", "")), {"name": f["name"], "args": f.get("args", ""),
                                                            "md5": f["def_md5"], "grants": f.get("grants") or {}})
    t["sql functions"] = list(fns.values())
    jobs = {j["jobname"]: dict(j) for j in sman["pg_cron"]["all_jobs"]}
    for j in sman["pg_cron"]["ours"]:
        jobs[j["jobname"]] = dict(jobs.get(j["jobname"], {}), **j)
    t["sql cron"] = [{"jobname": n, "schedule": j["schedule"], "active": j["active"], "command_md5": j["command_md5"]}
                     for n, j in jobs.items()]
    sets = sman["cockpit_sales_settings"]
    t["sql settings_rows"] = [{"key": s["key"], "updated_by": s["updated_by"], "updated_at": s["updated_at"]} for s in sets]
    t["sql switches"] = [{"key": s["key"], "path": p, "is_on": v} for s in sets if s["key"] in VP.SWITCH_KEYS
                         for p, v in (s.get("switches") or {}).items()]
    t["sql settings_age"] = [{"key": s["key"], "older": False, "at": s["updated_at"]} for s in sets]
    t["sql status_rows"] = [{"worker": w, "job": j, "ok": True, "age_min": 1} for w, j in VP.STATUS_ROWS]
    t["sql templates"] = [{"key": r["key"], "active": r["active"]} for r in sman["cockpit_sales_wa_templates"]["rows"]]
    t["sql vault"] = [{"name": v["name"]} for v in sman["vault_secret_names"]]
    t["sql extensions"] = [{"extname": e["extname"]} for e in sman["extensions"]]
    t["sql bucket"] = [{"id": VP.BUCKET, "public": False}]
    t["api functions"] = [{k: f.get(k) for k in ("slug", "status", "version", "verify_jwt", "ezbr_sha256", "updated_at")}
                          for f in sman["edge_functions"]]
    # Team hours: absent before its deploy, then present exactly as the manifest's team_hours block says (2026-10-10).
    th = sman.get("team_hours") or {}
    if th.get("state") == "deployed":
        rows = [{"kind": "table", "name": n, "rls": True, "browser": False, "service": n not in th.get("no_grant_tables", [])}
                for n in th["tables"]]
        rows += [{"kind": "function", "name": n, "rls": None, "browser": n in th.get("ceo_functions", []), "service": True}
                 for n in th["functions"]]
        rows += [{"kind": "trigger", "name": n, "rls": None, "browser": None, "service": None} for n in th["triggers"]]
        t["sql team_hours"] = rows
        t["sql cron"] = t["sql cron"] + [{"jobname": j["jobname"], "schedule": j["schedule"], "active": True, "command_md5": "recorded"}
                                         for j in th.get("pg_cron", [])]
        t["api functions"] = t["api functions"] + [{"slug": e["slug"], "status": "ACTIVE", "version": 1, "verify_jwt": e["verify_jwt"],
                                                    "ezbr_sha256": None, "updated_at": None} for e in th.get("edge_functions", [])]
    else:
        t["sql team_hours"] = []
    t["api secrets"] = [{"name": n, "updated_at": "2026-10-07T01:12:34.068Z"} for n in sman["edge_function_secret_names"]]
    t["pair cron_secret"] = {"function_secret": True, "vault_secret": True, "same": True}
    for slug, names in VP.RECORDED_SOURCES.items():
        at = VP.git_files(base, [f"supabase/functions/{slug}"], flat=True)
        t["fnsrc " + slug] = {"files": {n: at[n] for n in names}, "bytes": 0}
    t["bundle"] = {"entry": "index-recorded.js", "chunks": 49,
                   "found": {w: True for w in VP.ROOM_STRINGS + VP.PROPOSAL_STRINGS}, "projects": [project]}
    t["vps"] = perfect_vps(vman, project, ref)
    return t


def cron_row(text: str) -> Dict[str, Any]:
    body = text.strip()
    sched, cmd_sha = VP.cron_parts(body)
    return {"sha": sha(text), "body_sha": sha(body), "commented": False, "schedule": sched, "cmd_sha": cmd_sha}


def perfect_vps(vman: Dict[str, Any], project: str, ref: str) -> Dict[str, Any]:
    now = time.time()
    rec_files = {f["path"]: f for f in vman["repo_files"]["files"]}
    paths = sorted(set(VP.git_files(ref)) | set(rec_files))
    env = {}
    for path, e in vman["env_files"].items():
        if not e.get("exists"):
            continue
        empty = set(e.get("empty_keys") or [])
        env[path] = {"exists": True, "mode": e.get("mode", "0o600"), "count": len(e["key_names"]),
                     "names": {n: "empty" if n in empty else "set" for n in e["key_names"]},
                     "equal": {n: True for n in (e.get("non_secret_values") or {})},
                     "projects": {"DESK_SUPABASE_URL": project} if "DESK_SUPABASE_URL" in e["key_names"] else {}}
    vince = vman["sales_desk_state"]["vince"]["files"]
    at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now - 120))
    return {
        "host": vman["host"]["hostname"], "now": now,
        "crontab": {"sha256": vman["crontab"]["sha256"],
                    "lines": [cron_row(l["text"]) for l in vman["crontab"]["lines"] if l["kind"] == "job"]},
        "files": {"head": vman["checkout"]["head"], "sha": {p: (rec_files.get(p) or {}).get("vps_sha256") for p in paths}},
        "env": env,
        "reference": {n: f["sha256"] for n, f in vman["reference_deals"]["files"].items()},
        "vince": {"exists": True, "files": vince, "bytes": 0,
                  "backup": {"files": vince, "same": vince, "changed": 0, "gone": 0, "new": 0}},
        "playwright": {"path_is_recorded": True, "exists": True, "bytes": vman["playwright"]["bytes"]},
        "guardian": {"exists": True, "dir": True, "at": at, "mode": "report-only", "full": True, "mtime": now - 120,
                     "seen_deployed": ["live-alerts", "live-cron", "live-function", "live-rooms-worker", "live-tables"]},
        "fixer": {"entry": True, "repo": vman["fixer_projects"]["cockpit-guardian"]["repo"],
                  "fix_policy": vman["fixer_projects"]["cockpit-guardian"]["fix_policy"]},
        "backup_dir": {"exists": True, "sums": True, "listed": 35, "bad": [], "gone": []},
        "supplement_dir": {"exists": True, "sums": True, "listed": 3, "bad": [], "gone": []},
        "doctor": {"rc": 0, "blockers": [], "rows": 27, "required": 7, "required_ok": 7},
        "deploy_check": {"rc": 0, "rows": 78, "blockers": [],
                         "switches": [{"check": n, "ok": True, "detail": ""} for n in
                                      ("rooms.enabled", "rooms.test_only", "live.enabled", "followups.agent")],
                         "doctor_row": {"ok": True, "detail": "the hourly doctor reported 10 minutes ago: ready"},
                         "sales_live": {"ok": True, "detail": "it answers, with verify_jwt off"},
                         "installed": {"rooms": True, "room-hosts": True, "doctor": True, "followups": True}},
    }


# ---- the scenarios ------------------------------------------------------------------------------------------

class Ctx:
    def __init__(self, sman: Dict[str, Any], vman: Dict[str, Any], ref: str) -> None:
        self.sman, self.vman, self.ref = sman, vman, ref

    def our_paths(self, t: Dict[str, Any], folder: Optional[str] = None) -> List[str]:
        folders = (folder,) if folder else VP.OUR_FOLDERS
        return [p for p in t["vps"]["files"]["sha"] if any(p.startswith(f + "/") for f in folders)]


def stale_rows(t: Dict[str, Any], jobs: Tuple[Tuple[str, str], ...], minutes: int = STALE) -> None:
    for r in t["sql status_rows"]:
        if (r["worker"], r["job"]) in jobs:
            r["age_min"] = int(r.get("age_min") or 0) + minutes


def guardian_stopped(t: Dict[str, Any], minutes: int = STALE) -> None:
    g = t["vps"]["guardian"]
    if g.get("exists"):
        g["at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(float(t["vps"]["now"]) - 60 * minutes))


def drop_cron(t: Dict[str, Any], ctx: Ctx, numbers: Tuple[int, ...]) -> None:
    gone = {l["sha256"] for l in ctx.vman["crontab"]["lines"] if l["n"] in numbers}
    tab = t["vps"]["crontab"]
    tab["lines"] = [l for l in tab["lines"] if l["sha"] not in gone]
    tab["sha256"] = sha(json.dumps(tab["lines"]))


DESK_ROWS = (("sales-desk", "rooms"), ("sales-desk", "room-hosts"), ("sales-desk", "requests"),
             ("sales-desk", "followups"), ("sales-desk", "doctor"))
NO_DESK = {"rc": 2, "error": "python3: can't open file 'desk.py': [Errno 2] No such file or directory"}


def a1(t, ctx):
    for p in ctx.our_paths(t):
        t["vps"]["files"]["sha"][p] = None
    t["vps"]["doctor"] = dict(NO_DESK)
    t["vps"]["deploy_check"] = dict(NO_DESK)
    stale_rows(t, DESK_ROWS)
    guardian_stopped(t)


def a2(t, ctx):
    main = VP.git_files(ctx.ref)
    for p in ctx.our_paths(t):
        t["vps"]["files"]["sha"][p] = main.get(p)


def b1(t, ctx):
    drop_cron(t, ctx, (62, 63, 64))
    stale_rows(t, (("sales-desk", "rooms"), ("sales-desk", "room-hosts")))


def b2(t, ctx):
    drop_cron(t, ctx, (44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 59, 62, 63, 64))
    stale_rows(t, DESK_ROWS)
    guardian_stopped(t)


def old_branch_files(slug: str) -> Dict[str, str]:
    at = VP.git_files(OLD_BRANCH, [f"supabase/functions/{slug}"], flat=True)
    return {n: s for n, s in at.items() if n.endswith(".ts") and not n.endswith(".test.ts") and n != "testfakes.ts"}


def c1(t, ctx):
    f = next(f for f in t["api functions"] if f["slug"] == "sales-api")
    f["version"] = int(f["version"]) + 1
    t["fnsrc sales-api"] = {"files": old_branch_files("sales-api"), "bytes": 0}


def c2(t, ctx):
    for w in t["bundle"]["found"]:
        hit = subprocess.run(["git", "-C", str(ROOT), "grep", "-q", "-F", w, OLD_BRANCH, "--", "apps/sales-cockpit/src"],
                             capture_output=True).returncode == 0
        t["bundle"]["found"][w] = hit


def d(t, ctx):
    f = next(f for f in t["api functions"] if f["slug"] == "sales-live")
    f["version"], f["verify_jwt"] = int(f["version"]) + 1, True
    dc = t["vps"]["deploy_check"]
    if "error" not in dc:
        dc["sales_live"] = {"ok": False, "detail": "it answers 401: verify_jwt is on"}
        dc["blockers"] = ["sales-live answers 401 without a key: redeploy it with verify_jwt off"]


def functions_in(path: str) -> List[str]:
    text = git("show", f"e166a0b:{path}")
    return sorted(set(re.findall(r"create\s+or\s+replace\s+function\s+public\.(\w+)\s*\(", text, re.I)))


def e1(t, ctx):
    for f in t["sql functions"]:
        if f["name"] == "cockpit_sales_setter_deals":
            f["md5"] = sha("20260927a")[:32]


def e2(t, ctx):
    for r in t["sql relations"]:
        if r["name"] == "cockpit_sales_settings":
            r["triggers"] = [x for x in r["triggers"] if x["name"] != "cockpit_sales_settings_guard"]


def e3(t, ctx):
    for r in t["sql settings_age"]:
        if r["key"] in ("rooms", "live", "followups", "b2b_sources", "mirror_state", "client_form"):
            r["older"], r["at"] = True, "2026-10-01 09:00:00+03"
    for r in t["sql switches"]:
        if r["key"] == "followups" and r["path"] in ("enabled", "email_fallback.new"):
            r["is_on"] = False


def e5(t, ctx):
    e1(t, ctx)
    t["__later__"] = {"supabase/migrations/20261010a_cutover_sales.sql":
                      git("show", "e166a0b:supabase/migrations/20260927a_sales_setter_pay.sql")}


def body_md5(text: str, name: str) -> str:
    return hashlib.md5(VP.Later.bodies(text, name)[-1].encode("utf-8")).hexdigest()


def e6(t, ctx):
    e1(t, ctx)
    sql = ("create or replace function public.cockpit_sales_setter_deals(p_rep_id text, p_from timestamptz, "
           "p_to timestamptz) returns jsonb language sql as $$ select '{}'::jsonb $$;")
    t["__later__"] = {"supabase/migrations/20261010b_cutover_sales.sql": sql}
    for f in t["sql functions"]:
        if f["name"] == "cockpit_sales_setter_deals":
            f["body_md5"] = body_md5(sql, f["name"])


AUTH_CONTRACT = "supabase/migrations/20261007b_cockpit_auth_contract.sql"


def k(t, ctx):
    """A cutover migration on origin/main redefines a function the rooms depend on, and the live body is its
    body: modelled with 20261007b_cockpit_auth_contract (on main and applied on 2026-10-07, before the inventory),
    as if it had come after."""
    sql = git("show", f"{ctx.ref}:{AUTH_CONTRACT}")
    for f in t["sql functions"]:
        if f["name"] == "cockpit_get_my_access":
            f["md5"] = sha("20261007b " + f["name"])[:32]
            f["body_md5"] = body_md5(sql, f["name"])


def l(t, ctx):
    """cockpit_get_my_access() edited by hand after the cutover migration: 20261007b on main defines it, but
    the live body is not its body."""
    for f in t["sql functions"]:
        if f["name"] == "cockpit_get_my_access":
            f["md5"] = sha("by hand " + f["name"])[:32]
            f["body_md5"] = sha("by hand body")[:32]


def e4(t, ctx):
    for r in t["sql row_counts"]:
        if r["name"] == "cockpit_sales_alerts":
            r["n"] = 0


def f1(t, ctx):
    for s in t["api secrets"]:
        if s["name"] in ("CRON_SECRET", "IP_SALT"):
            s["updated_at"] = "2026-10-08T09:00:00.000Z"
    t["pair cron_secret"] = {"function_secret": True, "vault_secret": True, "same": False}


def f2(t, ctx):
    t["api secrets"] = [s for s in t["api secrets"] if s["name"].startswith("SUPABASE_")]
    t["pair cron_secret"] = {"function_secret": False, "vault_secret": True, "same": None}


def g(t, ctx):
    e = t["vps"]["env"]["~/.sales-desk/env"]
    for n in ("SALES_MODEL_FALLBACK", "SALES_FALLBACK_MODEL", "SALES_FALLBACK_JOBS"):
        e["names"][n], e["equal"][n] = "absent", False


def h(t, ctx):
    t["vps"]["reference"] = {n: None for n in t["vps"]["reference"]}


def i1(t, ctx):
    for p in ctx.our_paths(t, "hermes/cockpit-guardian"):
        t["vps"]["files"]["sha"][p] = None
    guardian_stopped(t)


def i2(t, ctx):
    t["vps"]["guardian"] = {"exists": False, "dir": False}
    t["vps"]["env"]["~/.cockpit-guardian/env"] = {"exists": False}


def j1(t, ctx):
    for e in t["vps"]["env"].values():
        if "DESK_SUPABASE_URL" in (e.get("projects") or {}):
            e["projects"]["DESK_SUPABASE_URL"] = NEW_PROJECT
    t["bundle"]["projects"] = [NEW_PROJECT]


def j2(t, ctx):
    newer = set(functions_in("supabase/migrations/20261004a_live_calls_hardening_2.sql"))
    for f in t["sql functions"]:
        if f["name"] in newer:
            f["md5"] = sha("as on 2026-10-04 " + f["name"])[:32]
    for r in t["sql relations"]:
        if r["name"] == "cockpit_sales_ai_usage":
            r["columns"] = [c for c in r["columns"] if c["name"] != "provider"]
    recorded = {s["key"]: s["updated_at"] for s in ctx.sman["cockpit_sales_settings"]}
    for r in t["sql settings_age"]:
        if str(recorded.get(r["key"], "")) > "2026-10-04 12":
            r["older"], r["at"] = True, "2026-10-04 11:00:00+03"
    for r in t["sql row_counts"]:
        if r["name"] in ("cockpit_guardian_incidents", "cockpit_sales_ai_usage") and r["n"]:
            r["n"] = int(r["n"]) * 2 // 3


def j3(t, ctx):
    made = {r["name"] for r in ctx.sman["relations"] if r["role"] == "created"}
    t["sql relations"] = [r for r in t["sql relations"] if r["name"] not in made]
    t["sql row_counts"] = [dict(r, n=None) if r["name"] in made else r for r in t["sql row_counts"]]
    created = {f["name"] for f in ctx.sman["functions"]["created"]}
    t["sql functions"] = [f for f in t["sql functions"] if f["name"] not in created]
    t["sql cron"] = [j for j in t["sql cron"] if j["jobname"] not in ("mahara-sales-rooms-sweep", "mahara-sales-watchdog")]
    gone = {"rooms", "live", "whatsapp_guard", "wa_fields", "contracts"}
    t["sql settings_rows"] = [s for s in t["sql settings_rows"] if s["key"] not in gone]
    t["sql switches"] = [s for s in t["sql switches"] if s["key"] not in gone]
    t["sql status_rows"] = [r for r in t["sql status_rows"] if r["worker"] != "sales-api"]


# Actions after which the run passes: nothing done; the checkout reset to current main (it carries both folders);
# a function changed on purpose by a migration the verifier can read (in its checkout, or on the ref: k needs
# origin/main to hold 20261007b, as it does since 2026-10-07).
PASSING = ("baseline", "a2", "e6", "k")

SCENARIOS: List[Tuple[str, str, Callable[[Dict[str, Any], Ctx], None]]] = [
    ("a1", "VPS checkout cleaned (git clean -fd, or re-cloned at its September commit): copied desk and guardian gone", a1),
    ("a2", "VPS checkout cleaned, then reset to the current origin/main", a2),
    ("b1", "crontab put back from the copy taken just before live calls (guardian backups, 2026-10-07 10:19)", b1),
    ("b2", "crontab put back from ~/.crontab.backup (2026-09-23)", b2),
    ("c1", f"sales-api redeployed from codex/supabase-completion-20261004 ({OLD_BRANCH})", c1),
    ("c2", f"the sales cockpit shipped from the same branch ({OLD_BRANCH})", c2),
    ("d", "sales-live redeployed with a plain `supabase functions deploy` (verify_jwt on)", d),
    ("e1", "an old migration re-run (20260927a_sales_setter_pay replaces cockpit_sales_setter_deals)", e1),
    ("e2", "a migration drops the trigger cockpit_sales_settings_guard", e2),
    ("e3", "cockpit_sales_settings reloaded from an older export (followups switched off)", e3),
    ("e4", "a cockpit_sales_ table dropped and made again, empty (cockpit_sales_alerts)", e4),
    ("e5", "e1 done by a new migration in the cutover branch that copies 20260927a's SQL", e5),
    ("e6", "cockpit_sales_setter_deals changed on purpose by a new migration in the cutover branch", e6),
    ("f1", "function secrets reset: CRON_SECRET and IP_SALT set to new values", f1),
    ("f2", "function secrets wiped (every name but the platform's own)", f2),
    ("g", "~/.sales-desk/env rewritten from env.bak-20260927 (the three fallback lines lost)", g),
    ("h", "the reference deals deleted from ~/.sales-desk/reference", h),
    ("i1", "the guardian's folder hermes/cockpit-guardian removed", i1),
    ("i2", "~/.cockpit-guardian removed (state, env, lock)", i2),
    ("j1", f"the cockpits and workers moved to a new Supabase project ({NEW_PROJECT}); the old one left as it was", j1),
    ("j2", "the database restored to 2026-10-04 12:00 (before 20261004a and 20261004p)", j2),
    ("j3", "the database restored to 2026-10-02 (before live calls)", j3),
    ("k", "a cutover migration on origin/main redefines cockpit_get_my_access() (as 20261007b does)", k),
    ("l", "cockpit_get_my_access() then edited by hand (20261007b on main defines it, the live body is not its)", l),
]


def run(tape: Dict[str, Any], skip: str, ref: str) -> Dict[str, Any]:
    """Replay a recording through the verifier. `__later__` in it: migration files the scenario puts in the
    checkout the verifier runs from (what explains a changed object)."""
    import contextlib
    import io
    later = tape.pop("__later__", None)
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as fh:
        json.dump(tape, fh)
        path = fh.name
    argv = ["--replay", path, "--json", "--ref", ref] + (["--skip", skip] if skip else [])
    real = VP.Later

    class WithLater(real):
        def __init__(self, *a: Any, **k: Any) -> None:
            super().__init__(*a, **k)
            for f, text in (later or {}).items():
                self.files[f] = text.lower()

    VP.Later = WithLater
    buf = io.StringIO()
    try:
        with contextlib.redirect_stdout(buf):
            code = VP.main(argv)
    finally:
        VP.Later = real
        Path(path).unlink()
    out = json.loads(buf.getvalue())
    out["exit_code"] = code
    return out


def problems(out: Dict[str, Any]) -> List[Dict[str, Any]]:
    """The lines that fail a run, without the ones a synthetic run leaves out on purpose."""
    return [r for r in out["checks"] if r["status"] != "ok" and not (r["status"] == "CHANGED" and r["explained"])
            and not str(r["detail"]).startswith("left out with --skip")]


def explained(out: Dict[str, Any]) -> List[Dict[str, Any]]:
    return [r for r in out["checks"] if r["status"] == "CHANGED" and r["explained"]]


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--tape", help="a recording made with verify-preserved.py --record (default: built from the manifests)")
    ap.add_argument("--only", default="", help="comma list of scenario ids")
    ap.add_argument("--ref", default="origin/main")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args(argv)
    sman = json.loads(VP.SB_MANIFEST.read_text(encoding="utf-8"))
    vman = json.loads(VP.VPS_MANIFEST.read_text(encoding="utf-8"))
    if args.tape:
        base, skip = json.loads(Path(args.tape).read_text(encoding="utf-8")), ""
    else:
        base, skip = perfect_tape(sman, vman, args.ref), "backups"
    ctx = Ctx(sman, vman, args.ref)
    only = {s.strip() for s in args.only.split(",") if s.strip()}
    results = []
    for sid, action, fn in [("baseline", "nothing done", lambda t, c: None)] + SCENARIOS:
        if only and sid not in only and sid != "baseline":
            continue
        t = copy.deepcopy(base)
        fn(t, ctx)
        out = run(t, skip, args.ref)
        bad = problems(out)
        results.append({"id": sid, "action": action, "caught": bool(bad), "problems": bad, "explained": explained(out)})
    if args.json:
        print(json.dumps(results, indent=1))
    else:
        for r in results:
            head = "CAUGHT" if r["caught"] else "passes"
            print(f"[{r['id']}] {r['action']}\n    {head}: {len(r['problems'])} line(s) fail the run")
            for p in r["problems"][:12]:
                print(f"      {p['status']:<8} {p['area']}: {p['check']}: {VP.scrub(p['detail'], 170)}")
            if len(r["problems"]) > 12:
                print(f"      ... and {len(r['problems']) - 12} more")
    # Every scenario but the baseline and a clean reset to current main must fail the run.
    wrong = [r["id"] for r in results if r["caught"] != (r["id"] not in PASSING)]
    if wrong:
        print(f"not as expected: {', '.join(wrong)}", file=sys.stderr)
    return 1 if wrong else 0


if __name__ == "__main__":
    sys.exit(main())
