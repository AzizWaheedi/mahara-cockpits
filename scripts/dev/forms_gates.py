#!/usr/bin/env python3
"""The 1-1 notes cut-over gates, read only (docs/forms/STAGE2B-CONTRACT.md section 10).

    python3 scripts/dev/forms_gates.py [--env-file <file>] [--replay-dir <dir>] [--confirmed G2 G3 ...]

Reads the live database through the Management API with read_only true (the
Reader of scripts/check-cockpit-auth-config.py: the named token from the
environment or --env-file, else Composio's read-only SQL), runs each gate's
query of section 10 and prints one line per gate, G1 to G13:

    G1 green
    G6 waiting: day 3 of 7
    G9 waiting on people: 0 of 3 CSM shadow runs

It never writes, and never prints an address, a name or a secret: counts, days,
states and health keys only. A read that fails prints `unknown`, never a zero.

What only people can confirm (G2's approval of the DEFCON and priority text,
G3's five shadow runs, G8's answer to B6, G9's reading by the CEO, G10's A1) is
written in the session note; pass --confirmed for each gate the note confirms,
and that gate turns green only when its measured part holds as well.

Exit 0 when every gate is green, 1 when any waits, 2 when a read failed.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import math
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Optional, Sequence

ROOT = Path(__file__).resolve().parents[2]
REPLAY_DIR = Path.home() / "mahara-cockpits" / "notes" / "stage2" / "replay"
PLANS_TEST = "apps/media-buyer-cockpit/scripts/checkin-plans-supabase.test.ts"
# Built at run time, so this file never holds the marker it counts.
FAILING = "test." + "failing"
GATES = tuple(f"G{n}" for n in range(1, 14))
# The 2b migrations by their stems' names (the letter rule may move the date and letter, never the name).
MIGRATIONS = (
    "forms_registry",
    "forms_clickup_writeback",
    "forms_checkin_notices",
    "forms_client_messages",
    "forms_dispatch",
    "forms_late_typeform",
    "forms_records",
    "forms_move_recording",
)
# Health rows the dark deploy writes (section 3.11; D5, D8, D14).
DEPLOY_ROWS = ("clickup-writeback:forms", "forms-effects-kick", "client-messages")
PEOPLE = {"G2", "G3", "G8", "G9", "G10"}

Read = Callable[[str], List[Dict[str, Any]]]


def sql(gate: str, text: str) -> str:
    """One gate's read: a comment naming the gate, then a single SELECT."""
    return f"-- forms-gates:{gate}\n{' '.join(text.split())}"


QUERIES: Dict[str, str] = {
    "G1": sql("G1", "select id, private, state from public.cockpit_slack_channels where id = 'C09SVG6FHGU'"),
    "G2": sql(
        "G2",
        """
        select (select state from public.cockpit_forms_keys where provider = 'anthropic') as anthropic,
               (select count(*) from public.cockpit_form_responses r
                 where r.form_key = 'checkin' and r.mode = 'shadow' and r.state = 'submitted'
                   and exists (select 1 from public.cockpit_form_drafts d
                                where d.kind = 'grade' and d.state = 'ready' and d.task_id = r.task_id
                                  and d.recording_id = r.answers->'call'->>'recordingId')
                   and exists (select 1 from public.cockpit_form_drafts d
                                where d.kind = 'defcon_priority' and d.state = 'ready' and d.task_id = r.task_id
                                  and d.recording_id = r.answers->'call'->>'recordingId')
                   and exists (select 1 from public.cockpit_form_drafts d
                                where d.kind = 'recap' and d.state = 'ready' and d.response_id = r.id)) as runs
        """,
    ),
    "G4": sql(
        "G4",
        """
        select (select coalesce(jsonb_agg(m.name order by m.name), '[]'::jsonb)
                  from supabase_migrations.schema_migrations m
                 where m.name ~ '^2026[0-9]{4}[a-z]_forms_(registry|clickup_writeback|checkin_notices|client_messages|dispatch|late_typeform|records|move_recording)$') as migrations,
               (select coalesce(jsonb_agg(jsonb_build_object('key', s.key, 'ok', s.ok) order by s.key), '[]'::jsonb)
                  from public.cockpit_sync_state s
                 where s.key in ('clickup-writeback:forms', 'forms-effects-kick', 'client-messages')) as rows
        """,
    ),
    "G5": sql("G5", "select ok, note from public.cockpit_sync_state where key = 'client-messages-g5'"),
    "G6": sql(
        "G6",
        """
        select count(*) as clients,
               count(*) filter (where data->>'notesFrom' = 'store') as store,
               count(*) filter (where data->'notesParity'->>'state' = 'differs') as differs,
               count(*) filter (where data->'notesParity'->>'state' = 'off') as off,
               floor(extract(epoch from now() - min((data->'notesParity'->>'cleanSince')::timestamptz)) / 86400) as days,
               coalesce(min((data->'notesParity'->>'cleanSince')::timestamptz) <= now() - interval '7 days', false) as seven,
               coalesce(max(source_snapshot_at) > now() - interval '1 hour', false) as fresh,
               (select count(*) from public.cockpit_guardian_incidents
                 where check_id = 'csm-notes-parity' and last_seen_at > now() - interval '7 days') as incidents
          from public.cockpit_csm_sources where table_name = 'clients'
        """,
    ),
    "G7": sql(
        "G7",
        """
        select kind, count(*) as n from public.cockpit_slack_notices
         where state = 'posted' and kind in ('kickoff', 'blueprint.close', 'blueprint.media') group by 1
        """,
    ),
    "G9": sql(
        "G9",
        """
        select count(*) as runs from public.cockpit_form_responses r
          join public.cockpit_members m on m.auth_user_id = r.created_by_id
         where r.form_key = 'checkin' and r.mode = 'shadow' and r.state = 'submitted' and m.active
           and 'csm' = any(m.roles) and not 'admin' = any(m.roles) and not 'ceo' = any(m.roles)
        """,
    ),
    "G10": sql(
        "G10",
        "select count(*) as done from public.cockpit_creative_outbox where kind = 'blueprintClose' and state = 'done'",
    ),
}


@dataclass(frozen=True)
class Gate:
    gate: str
    state: str  # green, waiting, people (waiting on people) or unknown
    detail: str = ""

    def line(self) -> str:
        label = {"green": "green", "waiting": "waiting", "people": "waiting on people", "unknown": "unknown"}[self.state]
        return f"{self.gate} {label}{': ' + self.detail if self.detail else ''}"


class ReadFailed(Exception):
    """A gate's read failed; the gate is unknown, never zero."""


def num(value: Any) -> Optional[int]:
    """An integer from a row value (sq.py and the API print numbers as numbers or text); None when missing."""
    if value is None or isinstance(value, bool):
        return None
    try:
        n = float(value)
    except (TypeError, ValueError):
        return None
    return int(n) if math.isfinite(n) else None


def truthy(value: Any) -> bool:
    return value is True or (isinstance(value, str) and value.lower() in ("t", "true"))


def one(read: Read, gate: str) -> Dict[str, Any]:
    rows = read(QUERIES[gate])
    if not isinstance(rows, list) or len(rows) != 1 or not isinstance(rows[0], dict):
        raise ReadFailed(f"{gate} expected one row")
    return rows[0]


def plural(n: int, one_: str, many: Optional[str] = None) -> str:
    return f"{n} {one_ if n == 1 else (many or one_ + 's')}"


def json_list(value: Any) -> list:
    if isinstance(value, str):
        value = json.loads(value)
    return value if isinstance(value, list) else []


# ---------------------------------------------------------------- each gate


def g1(read: Read) -> Gate:
    rows = read(QUERIES["G1"])
    if not rows:
        return Gate("G1", "waiting", "#client-call-feedback is not in the cockpit's Slack channels yet")
    row = rows[0]
    if truthy(row.get("private")) and row.get("state") == "ok":
        return Gate("G1", "green")
    return Gate("G1", "waiting", "#client-call-feedback must be private and ok in Notices and routing")


def g2(read: Read, confirmed: bool) -> Gate:
    row = one(read, "G2")
    if row.get("anthropic") != "connected":
        return Gate("G2", "waiting", "the Anthropic key is not connected (CEO > Connections)")
    runs = num(row.get("runs"))
    if runs is None:
        raise ReadFailed("G2 runs")
    if runs < 3:
        return Gate("G2", "people", f"{min(runs, 3)} of 3 shadow runs with the grade, DEFCON and priority, and recap drafts ready")
    if not confirmed:
        return Gate("G2", "people", "3 of 3 shadow runs ready; the CSM's or the CEO's approval of the DEFCON and priority text goes in the session note")
    return Gate("G2", "green")


def explained_differences(replay_dir: Path) -> Optional[Dict[str, Any]]:
    """The live replay's "every to-do comment difference explained" pass, or None with no report."""
    path = replay_dir / "replay-report.json"
    if not path.is_file():
        return None
    report = json.loads(path.read_text(encoding="utf-8"))
    for p in report.get("passes") or []:
        if p.get("check") == "every to-do comment difference explained":
            return p
    return {"count": 0, "of": len(report.get("responses") or []), "pass": False}


def shadow_runs(replay_dir: Path) -> Dict[str, int]:
    """Shadow runs compared with Make (shadow-report.json): those with a Typeform row to compare, and how many of
    them still carry a difference no sentence explains (a person explains those in the session note)."""
    path = replay_dir / "shadow-report.json"
    if not path.is_file():
        return {"compared": 0, "open": 0}
    report = json.loads(path.read_text(encoding="utf-8"))
    compared = 0
    open_ = 0
    for r in report.get("responses") or []:
        if not r.get("planned") or (r.get("pick") or {}).get("verdict") == "missing":
            continue
        compared += 1
        verdicts = [r.get("pick") or {}] + list(r.get("effects") or [])
        if any(v.get("verdict") == "differs" and v.get("explained") is not True for v in verdicts):
            open_ += 1
    return {"compared": compared, "open": open_}


def g3(replay_dir: Path, confirmed: bool) -> Gate:
    replay = explained_differences(replay_dir)
    if replay is None:
        return Gate("G3", "waiting", "no replay report yet (checkin-replay.ts --live, 4.13)")
    if not replay.get("pass"):
        return Gate("G3", "waiting", f"the replay explains {num(replay.get('count')) or 0} of {num(replay.get('of')) or 0} to-do comment differences")
    runs = shadow_runs(replay_dir)
    if runs["compared"] < 5:
        return Gate("G3", "people", f"{runs['compared']} of 5 shadow runs compared with Make (checkin-replay.ts --shadow)")
    if not confirmed:
        left = f"; {plural(runs['open'], 'run')} with a difference to explain" if runs["open"] else ""
        return Gate("G3", "people", f"{runs['compared']} shadow runs compared{left}; the session note confirms the five runs")
    return Gate("G3", "green")


def g4(read: Read) -> Gate:
    row = one(read, "G4")
    names = {str(n).split("_", 1)[1] for n in json_list(row.get("migrations")) if "_" in str(n)}
    applied = sum(1 for m in MIGRATIONS if m in names)
    if applied < len(MIGRATIONS):
        return Gate("G4", "waiting", f"{applied} of {len(MIGRATIONS)} 2b migrations applied")
    seen = {r.get("key"): truthy(r.get("ok")) for r in json_list(row.get("rows")) if isinstance(r, dict)}
    missing = [k for k in DEPLOY_ROWS if k not in seen]
    if missing:
        return Gate("G4", "waiting", "no health row yet for " + ", ".join(missing))
    failing = [k for k in DEPLOY_ROWS if not seen[k]]
    if failing:
        return Gate("G4", "waiting", "not ok: " + ", ".join(failing))
    return Gate("G4", "green")


def g5(read: Read) -> Gate:
    rows = read(QUERIES["G5"])
    if not rows:
        return Gate("G5", "waiting", "no WhatsApp phone check yet (D16)")
    row = rows[0]
    note = str(row.get("note") or "")
    if truthy(row.get("ok")) and note.startswith("same number"):
        return Gate("G5", "green")
    return Gate("G5", "waiting", "the WhatsApp phone check does not read same number; B5 goes to the CEO")


def g6(read: Read) -> Gate:
    row = one(read, "G6")
    clients, store, differs, off = (num(row.get(k)) for k in ("clients", "store", "differs", "off"))
    incidents = num(row.get("incidents"))
    if None in (clients, store, differs, off, incidents):
        raise ReadFailed("G6 counts")
    if clients <= 0:
        # No client row at all is a feed that published nothing, never "every client reads the store".
        raise ReadFailed("G6 no client rows")
    if not store:
        return Gate("G6", "waiting", "N4 is not live: the native feed still reads the 1-1 notes from Typeform")
    # Section 10: every client `store`. One row still on Typeform holds the gate, whatever the comparison says.
    if store < clients:
        return Gate("G6", "waiting", f"{clients - store} of {clients} clients do not read their 1-1 notes from the store")
    if off and off == clients:
        return Gate("G6", "green", "the 1-1 notes are native; the Typeform comparison is off")
    # cleanSince only moves when the feed publishes, so a stopped feed would let the days run on with
    # nothing compared. csm-notes-parity watches only the notes (its incidents restart G6); a stopped feed is
    # native-source-producer's (fail after 90 min). This clause holds G6 meanwhile. No publish time at all reads as not fresh.
    if not truthy(row.get("fresh")):
        return Gate("G6", "waiting", "the native feed has not published for over an hour; hours without a comparison do not count")
    if differs:
        return Gate("G6", "waiting", f"{plural(differs, 'client')} read differently from Typeform; the 7 days restart when they agree")
    if incidents:
        return Gate("G6", "waiting", f"{plural(incidents, 'csm-notes-parity incident')} in the last 7 days")
    days = num(row.get("days"))
    if days is None:
        return Gate("G6", "waiting", "day 0 of 7")
    if truthy(row.get("seven")):
        return Gate("G6", "green")
    return Gate("G6", "waiting", f"day {max(0, min(days, 6))} of 7")


def g7(read: Read) -> Gate:
    counts = {r.get("kind"): num(r.get("n")) or 0 for r in read(QUERIES["G7"])}
    kickoff = counts.get("kickoff", 0)
    blueprint = counts.get("blueprint.close", 0) + counts.get("blueprint.media", 0)
    if kickoff and blueprint:
        return Gate("G7", "green")
    waiting = [w for w, n in (("a kickoff notice", kickoff), ("a Brand Blueprint notice", blueprint)) if not n]
    return Gate("G7", "people", " and ".join(waiting) + " posted from a real client event")


def g8(confirmed: bool) -> Gate:
    if confirmed:
        return Gate("G8", "green")
    return Gate("G8", "people", "the CEO's answer to B6 (check-in calendar auto-confirm) goes in the session note")


def g9(read: Read, confirmed: bool) -> Gate:
    runs = num(one(read, "G9").get("runs"))
    if runs is None:
        raise ReadFailed("G9 runs")
    if runs < 3:
        return Gate("G9", "people", f"{runs} of 3 CSM shadow runs")
    if not confirmed:
        return Gate("G9", "people", f"{runs} of 3 CSM shadow runs; the CEO's reading goes in the session note")
    return Gate("G9", "green")


def g10(read: Read, confirmed: bool) -> Gate:
    done = num(one(read, "G10").get("done"))
    if done is None:
        raise ReadFailed("G10 done")
    if done < 1:
        return Gate("G10", "people", "no native Brand Blueprint close has settled done yet")
    if not confirmed:
        return Gate("G10", "people", "the first native Blueprint close is done; A1 (Typeform oYZKtogO webhooks off, Make 9748311 off) goes in the session note")
    return Gate("G10", "green")


def g11(root: Path) -> Gate:
    path = root / PLANS_TEST
    if not path.is_file():
        return Gate("G11", "unknown", "checkin-plans-supabase.test.ts is not in this checkout")
    left = sum(1 for line in path.read_text(encoding="utf-8").splitlines() if FAILING in line)
    if left:
        return Gate("G11", "waiting", f"{plural(left, 'line')} in checkin-plans-supabase.test.ts still mark a case as failing")
    return Gate("G11", "green")


def gates(read: Read, root: Path = ROOT, replay_dir: Path = REPLAY_DIR, confirmed: Iterable[str] = ()) -> List[Gate]:
    """Every gate, G1 to G13, in order; a failed read is that gate's unknown, never a zero."""
    yes = {c.strip().upper() for c in confirmed}
    steps: Dict[str, Callable[[], Gate]] = {
        "G1": lambda: g1(read),
        "G2": lambda: g2(read, "G2" in yes),
        "G3": lambda: g3(replay_dir, "G3" in yes),
        "G4": lambda: g4(read),
        "G5": lambda: g5(read),
        "G6": lambda: g6(read),
        "G7": lambda: g7(read),
        "G8": lambda: g8("G8" in yes),
        "G9": lambda: g9(read, "G9" in yes),
        "G10": lambda: g10(read, "G10" in yes),
        "G11": lambda: g11(root),
        "G12": lambda: Gate("G12", "green", "decided in Stage 2a (A7.17)"),
        "G13": lambda: Gate("G13", "green", "decided in Stage 2a (A7.18)"),
    }
    out: List[Gate] = []
    for gate in GATES:
        try:
            out.append(steps[gate]())
        except Exception as error:  # a read or a report that cannot be read
            out.append(Gate(gate, "unknown", f"the read failed ({type(error).__name__}); missing is never zero"))
    return out


def exit_code(result: Sequence[Gate]) -> int:
    if any(g.state == "unknown" for g in result):
        return 2
    return 0 if all(g.state == "green" for g in result) else 1


def live_reader(env_file: Optional[str]) -> Read:
    """The Reader of scripts/check-cockpit-auth-config.py, every query read only."""
    path = ROOT / "scripts" / "check-cockpit-auth-config.py"
    spec = importlib.util.spec_from_file_location("check_cockpit_auth_config", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("scripts/check-cockpit-auth-config.py is missing")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return guarded(module.Reader(env_file))


def guarded(reader: Callable[[str, Dict[str, Any]], Any]) -> Read:
    """Each gate query through the Reader as one read-only SELECT; anything else is refused before it leaves."""

    def read(query: str) -> List[Dict[str, Any]]:
        body = "\n".join(line for line in query.splitlines() if not line.lstrip().startswith("--")).strip()
        if not body.lower().startswith("select ") or ";" in body:
            raise ValueError("forms_gates.py only reads")
        rows = reader("database/query", {"read_only": True, "query": query})
        if not isinstance(rows, list):
            raise ValueError("the read answered no rows")
        return rows

    return read


def main(argv: Optional[Sequence[str]] = None, read: Optional[Read] = None) -> int:
    parser = argparse.ArgumentParser(description="Print the 1-1 notes cut-over gates G1 to G13, read only.")
    parser.add_argument("--env-file", help="read the named management token locally; never printed")
    parser.add_argument("--replay-dir", default=str(REPLAY_DIR), help="the folder holding replay-report.json and shadow-report.json")
    parser.add_argument("--confirmed", action="extend", nargs="+", default=[], choices=sorted(PEOPLE, key=lambda g: int(g[1:])),
                        help="the gates whose human part the session note confirms (G2 G3 G8 G9 G10)")
    args = parser.parse_args(argv)
    if read is None:
        try:
            read = live_reader(args.env_file)
        except Exception as error:
            print(f"The gate report cannot read the database ({type(error).__name__}). Set COCKPIT_MANAGEMENT_TOKEN or pass --env-file, or connect Composio's Supabase.")
            return 2
    result = gates(read, ROOT, Path(args.replay_dir), args.confirmed)
    for g in result:
        print(g.line())
    return exit_code(result)


if __name__ == "__main__":
    sys.exit(main())
