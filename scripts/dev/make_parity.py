"""Stage 4's parity proof (docs/forms/WAVE56-CONTRACT.md 4.15.1, deploy step D-S4F). Runs ON THE VPS, read only,
like forms_legacy_backfill.py, where the keys and the saved blueprints live:

  ssh ... 187.77.156.166 'python3 - kickoff' < scripts/dev/make_parity.py
  ssh ... 187.77.156.166 'python3 - onboarding --last 5' < scripts/dev/make_parity.py

  kickoff [--last N]      Make 12 (8925654) on the newest N stored tG7dnxBn kickoffs (7 when not given)
  onboarding [--last N]   Make 13 (8922994) on the newest N stored KFRCXPFx answers (5 when not given)
  --blueprint-dir DIR     the saved Make blueprints (/home/hermes/make-backups, {id}-before-s40-20261102s40.json)
  --typeform-dir DIR      the saved Typeform definitions (/home/hermes/typeform-backups, the same names)

Make's API returns no module bundles (a log is a summary, an execution only its status), so the inputs are the
answers the cockpit stored: cockpit_client_onboarding forms.kickoff and forms.onboarding, and the
cockpit_form_responses onboarding rows. Make's side is a small evaluator of the expressions the two saved
blueprints use, run on those answers: what each module's input would have been, in the {id: {input, output,
module}} shape the comparisons read. The kickoff's hidden values are what Make 13 [29]'s Kickoff Form Link
prefilled from the card's onboarding answers, or what the cockpit's own kickoff link sent (since 2026-10-22; the
run says so when the card shows it was that one). The cockpit's side is cockpit_form_parity_plan (read only, writes
nothing) on the same answers. A fidelity check proves the evaluator on real data: the evaluated Make 12 [11]
handoff (or Make 13 [47] raw answers) comment must equal a comment ClickUp holds on the card, whitespace folded and
ClickUp's markdown marks ignored. One line per effect, then one line for each INTENDED name the run used:

  kickoff run 1: from response 6f0c9d2e-...
  kickoff run 1: handoff_comment equal
  kickoff run 1: card_fields differs: 924bba47
  kickoff run 1: onboarding_tasks equal + intended: task_name, dedupe, request_route, brief
  kickoff run 1: phase4_whatsapp setting missing
  kickoff run 1: card_facts intended: card_facts (receipt not read)
  kickoff run 1: fidelity equal
  intended brief: the two onboarding tasks' description carries the cockpit brief ...

plus one line for Make 12's [24] (or Make 13's [31]): "[24] search", or "[24] writes: {columns}", which stops Stage
4 until the write is its own effect. Pass = every effect equal or intended and the fidelity equal, on every run.

The parity rule: Make's output is the floor. Its part of each effect is graded byte for byte, always; the cockpit may
add to it only in a slot registered here, each under the CEO's words of 2026-11-02 (CEO_WORDS), and one effect gets
one verdict: "equal + intended: <names>" when Make's part is equal and every addition is registered, "differs" when
either is not (an addition never hides a difference). A text Make writes (the handoff, also posted on each onboarding
task by [18] and [23], the raw answers comment, the Client Profile, a phase text) is equal only byte for byte;
"differs: text, whitespace only" names a difference of spaces or new lines alone, and a block after Make's text
differs like any other text. The comments are graded as ClickUp receives them, not only as planned: the handoff on
the onboarding tasks differs while the request writer has no step that posts it (TASK_COMMENT_STEP), and a comment
differs while the writer posts it with a Cockpit ref line after Make's text (REF_LINE). A task description (details)
Make 12 [17], [22] and Make 13 [46] write none of: it is INTENDED 'brief' on the onboarding tasks and 'dna_brief' on
the Brand DNA task only with its exact first line (BRIEF_HEADER, DNA_BRIEF_HEADER), its detailsKind and BRIEF_MAX
characters at most, on a request type with a details field (else the brief would be dropped); any other details
differs. card_facts fills only CARD_FACTS' five fields, only while empty, with a plan clickup-writeback's factsStep
takes (onlyIfEmpty, a label, a value of the field's kind, a real day; no field only with its skip reason); the
writer's own receipt (progress.steps.card_facts.fields of its queue row, read only when the response has one) differs
when a field went "written" over a card value that was "set", and without one the verdict says "(receipt not read)"
and the summary counts it: only the plan was graded. The dispatch sends Make's two keys and nothing else (DISPATCH_EXTRA_KEYS). An effect key no entry
names differs. A phase text compares as a template ({map_link}, {content_folder}); while stage4.messages has no text for it,
it is "setting missing" and the run is not proven. oracle() is one stored answer's two inputs with no network (what
cockpit_form_parity_plan is sent, and Make's evaluated modules), so a branch's SQL can be planned and compared off
the VPS; plan_lines() and summary() print such a run as this one does. It prints ids, field ids, effect keys, run
numbers and verdicts only: never a name, an answer, a phone number, a token or a key. Every ClickUp read writes an
intent receipt before it and a response receipt after it into cockpit_csm_provider_health (provider clickup, run_key
make-parity:{uuid}); a call whose intent receipt cannot be saved is not made. Self-contained on purpose: the VPS
gets this one file on stdin.
"""
from __future__ import annotations

import json
import math
import pathlib
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timedelta
from typing import Any, Optional

NATIVE_CURRENT = "/home/hermes/cockpit-native-current"
NATIVE_STATE = "/home/hermes/.cockpit-native-state"
RELAY_CONFIG = "/home/hermes/.forms-relay/config.env"
BLUEPRINT_DIR = "/home/hermes/make-backups"
TYPEFORM_DIR = "/home/hermes/typeform-backups"
SAVED = "{}-before-s40-20261102s40.json"
TIMEOUT = 30
MAKE12, MAKE13 = 8925654, 8922994
KICKOFF_FORM, ONBOARDING_FORM = "tG7dnxBn", "KFRCXPFx"
SCENARIOS = {"kickoff": (MAKE12, 7, KICKOFF_FORM), "onboarding": (MAKE13, 5, ONBOARDING_FORM)}
FIELD = {
    "status": "9368ca9e-3549-4320-84ff-9abd0a2901cb",
    "blueprint": "1b7a4a74-d0e7-4a7f-9218-59c80a738186",
    "map": "51f49cb1-9f76-48be-b639-c42ca552d20a",
    "profile": "7755485f-74a8-496c-85d8-562588e77944",
    "kickoff_link": "87d7d889-afea-42f8-9485-6f3ead5b857f",
    "service": "bab9a58b-15af-4b0d-8e20-b8e5a4bee2cc",
}
# The CEO's words of 2026-11-02, after "Yes, match Make": what lets the cockpit add to Make's output. Make's output
# stays the floor, graded byte for byte; an addition is accepted only in a slot registered here (INTENDED, SLOTS,
# CARD_FACTS), and every such entry quotes these words.
CEO_WORDS = ("You can even improve what's already there with the data that you have. "
             "So you can add more if it gives us better data.")
UNDER_CEO = f'the CEO, 2026-11-02: "{CEO_WORDS}"'
# The two briefs' first lines; supabase/migrations/20261102p holds the same strings (test_make_parity.py reads it).
BRIEF_HEADER = "From the onboarding and kickoff forms (cockpit)"
DNA_BRIEF_HEADER = "For the Brand DNA doc (cockpit)"
BRIEF_MAX = 3600
INTENDED = {
    "blueprint": "the Blueprint link points at the cockpit Blueprint",
    "task_name": "the request names the task {client} - {type label}",
    "kickoff_link": "the kickoff link opens the cockpit sheet, not a prefilled Typeform",
    "approval": "waits for the CSM's approval (2b rule)",
    "no_group": "Make sent nothing this run (no group on Client Data)",
    "notice": "the cockpit's Stage 1 notice (Make posts none)",
    "new_mrr": "new (Q21)",
    "recap": "stays off (Q22)",
    "read_model": "the cockpit's own record (Make writes none)",
    "dedupe": "one task each per card (Make doubles them on a second submit)",
    # The request route (X38; listed as cannot match until 2026-11-02, contract 11.9).
    "request_route": ("each task gets what every request gives its task beyond Make's name, list and template or "
                      "assignee: the template's text and the Cockpit ref in its description (the marker that keeps a task "
                      "from being made twice), a due date, a priority, owners by rule, the client tag, the Request Type field "
                      f"and a link comment on the client card; under {UNDER_CEO}"),
    "brief": (f'the two onboarding tasks\' description carries the cockpit brief under the template\'s text ("{BRIEF_HEADER}" '
              f"first, detailsKind brief, {BRIEF_MAX:,} characters at most); Make's handoff stays each task's comment, alone; "
              f"under {UNDER_CEO}"),
    "dna_brief": (f'the Brand DNA task\'s description carries the cockpit brief ("{DNA_BRIEF_HEADER}" first, detailsKind '
                  f"dna_brief, {BRIEF_MAX:,} characters at most), where Make writes none; under {UNDER_CEO}"),
    "card_facts": ("fills a card field Make leaves alone, only Consultation Types, ADs Platform, Fathom, Onboarding Call Date "
                   "or Company Website and only while it is empty (onlyIfEmpty: the writer reads the card first and keeps a "
                   f"value the card holds); under {UNDER_CEO}"),
}
# The registered description slots: effect -> (INTENDED name and detailsKind, first line, request type). A plan's
# details anywhere else, or without its exact first line and kind, is a description Make does not write.
SLOTS = {"onboarding_tasks": ("brief", BRIEF_HEADER, "client_onboarding"),
         "brand_dna_task": ("dna_brief", DNA_BRIEF_HEADER, "brand_dna")}
DROPPED = "the brief would be dropped (the type has no details field)"
# card_facts (B8): the only card fields it may fill, by full id, with the kind each is written as. Make 12 [21] and
# Make 13 [29] write none of them. Country, Daily Budget and ADs Platforms (CARD_FACTS_NEVER) are not among them:
# billing reads Country, and the Blueprint never writes the other two.
CARD_FACTS = {
    "45fdd2ea-f83c-4721-bce7-2e6187a43541": ("labels", "Consultation Types"),
    "2de15aa5-7fe9-48bf-86a1-e4cfee1306c9": ("drop_down", "ADs Platform"),
    "abaa31ee-28ff-46f6-83bf-6c6d357a26d5": ("url", "Fathom"),
    "ee9bf855-e05b-4afc-addf-1063cb54d3f0": ("date", "Onboarding Call Date"),
    "5d57fdde-eb70-4610-a23b-88f718b4451d": ("url", "Company Website"),
}
CARD_FACTS_NEVER = {"e0ca65e7-7656-4113-9aae-9feda834c3f9": "Country", "539743c2-b6cd-4eeb-bf2f-abaf64769a5e": "Daily Budget",
                    "8db2aa82-cbad-4d26-8deb-ee0637e97512": "ADs Platforms"}
# The writer's card_facts receipt (clickup-writeback/forms.ts FactReceipt), kept at its queue row's
# progress.steps.card_facts.fields: for each field id, `before` (what the first card read saw, a word, never the value)
# and `state`, plus `differs` and `note` on a kept field. A write over a set value is state "written" with before
# "set". test_make_parity.py reads these words from forms.ts.
FACT_STEP = "card_facts"
FACT_BEFORE = frozenset({"empty", "set"})
FACT_STATE = frozenset({"due", "written", "kept"})
FACT_KEYS = frozenset({"before", "state", "differs", "note"})
# A card_facts date as forms.ts factDay takes it: a real day (YYYY-MM-DD), an instant with its zone written out
# (FACT_ZONED, the writer's ZONED), or epoch milliseconds, read as its Kuwait day, which must fall in FACT_DAYS (seconds
# taken for milliseconds read as 1970). An instant whose day does not exist ("2026-02-31T08:00Z", which the writer's
# Date.parse rolls into March) is refused here too.
FACT_ZONED = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})$", re.ASCII)
FACT_DAYS = ("2020-01-01", "2099-12-31")
UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
# The dispatch: Make 13 [25] sends two keys, the cockpit plans them as client and taskId. Extra keys wait on the
# CEO's word (plan CEO-1): until then this stays empty and any other key differs, and a contact answer never goes.
DISPATCH_KEYS = frozenset({"client", "taskId"})
DISPATCH_EXTRA_KEYS: frozenset = frozenset()
CONTACT_REFS = frozenset({"533f14a0-712f-4de9-9ac7-67e1be6bc0c8", "64f2fb80-b074-4017-b8b7-b7d549947e52",
                          "7994f0d2-baeb-451b-983a-816290873a68", "282dac48-5031-4acb-96b6-ea469e8a5a8b",
                          "09d2e62a-51d4-4665-a3a9-30f5279b71bc"})
CONTACT_KEYS = frozenset({"fullName", "phone", "email", "frontDeskPhone", "personalPhone"})
# Every effect the planner may plan; any other key is an addition no entry registers.
KNOWN_EFFECTS = {
    "kickoff": frozenset({"handoff_comment", "native_status", "card_fields", "onboarding_tasks", "map_phase4",
                          "phase4_whatsapp", "kickoff_notice", "new_mrr", "recap", "card_facts"}),
    "onboarding": frozenset({"github_dispatch", "profile_fields", "raw_answers_comment", "client_data_row", "map_phase3",
                             "phase3_whatsapp", "brand_dna_task", "read_model", "card_facts"}),
}
NAME = re.compile(r"^[A-Za-z][A-Za-z0-9_]{0,39}$")
# The request writer's step that posts a request's taskComment once on the task it made (REQUEST_STEPS in
# supabase/functions/clickup-writeback/requests.ts): what carries the onboarding_tasks plan's comment_text to
# ClickUp, as Make 12 [18] and [23] post the handoff. None while the writer has no such step: then nothing posts it,
# whatever the plan says. test_make_parity.py fails while this and that file disagree.
TASK_COMMENT_STEP: Optional[str] = "task_comment"
NO_TASK_COMMENT = "nothing posts comment_text on the two tasks"
# The comments that mirror Make which the writer posts with a Cockpit ref line after the text (supabase/functions/
# clickup-writeback/forms.ts stage4Step for handoff_comment and raw_answers_comment; requests.ts's TASK_COMMENT_STEP
# for onboarding_tasks). Make posts the text alone, so while an effect is here ClickUp receives another comment than
# Make's, whatever the plan says. Empty while the writer posts each text alone; test_make_parity.py reads both files
# and fails while this and they disagree.
REF_LINE: frozenset = frozenset()
REF_ADDED = "the writer adds a Cockpit ref line Make does not post"
DESCRIPTION = "the cockpit writes a task description Make does not"
# What the fidelity check reads: the module whose comment ClickUp holds, and how that comment starts.
FIDELITY = {"kickoff": (11, "KICKOFF HANDOFF", "handoff"), "onboarding": (47, "Raw Onboarding Form Answers", "raw answers")}
COMMENT_PAGES = 8
USAGE = ("Name the form: kickoff or onboarding, then --last N for how many answers (7 and 5 when not given); "
         "--blueprint-dir and --typeform-dir point at the saved files.")
CARD_ID = re.compile(r"^[A-Za-z0-9_-]{1,40}$")
SEARCH = re.compile(r"(filterRows|searchRows|search|getRange|listRows|getCell)", re.I)
RULE = re.compile(r"\s*[_\-]{3,}\s*")
NUMBER = re.compile(r"^-?\d+(\.\d+)?$")
KEY_SHAPES = re.compile(r"sk-[A-Za-z0-9_-]{16,}|sb_secret_[A-Za-z0-9_-]{8,}|tfp_[A-Za-z0-9_-]{8,}|pk_\d+_[A-Za-z0-9]{16,}"
                        r"|gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,}"
                        r"|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}")


class Stop(Exception):
    """A plain sentence to print before exiting non-zero."""


class NoAnswer(Exception):
    """A request got no HTTP answer."""


class Unsupported(Exception):
    """A function, name, path, filter or module the evaluator does not know. Parity stops rather than guess."""


def http(method: str, url: str, headers: dict, body: Any = None) -> tuple[int, str]:
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        try:
            text = e.read().decode("utf-8", "replace")
        except Exception:  # noqa: BLE001 - the status is what counts
            text = ""
        return e.code, text
    except (urllib.error.URLError, OSError, ValueError) as e:
        raise NoAnswer(type(e).__name__) from None


def runtime_file() -> dict:
    release = pathlib.Path(NATIVE_CURRENT).resolve().name
    path = pathlib.Path(NATIVE_STATE) / f"runtime-{release}.json"
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        raise Stop("The native runtime file could not be read.") from None


def env_file(path: str) -> dict:
    out: dict = {}
    try:
        text = pathlib.Path(path).read_text()
    except OSError:
        return out
    for line in text.splitlines():
        m = re.match(r"^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$", line)
        if m and m.group(1) not in out:
            out[m.group(1)] = m.group(2).strip().strip("'\"")
    return out


def saved_file(directory: str, name: str) -> dict:
    path = pathlib.Path(directory) / SAVED.format(name)
    try:
        out = json.loads(path.read_text())
    except OSError:
        raise Stop(f"{path.name} is not in {directory}. Save it there first (D-S4.0).") from None
    except ValueError:
        raise Stop(f"{path.name} in {directory} is not JSON.") from None
    if not isinstance(out, dict):
        raise Stop(f"{path.name} in {directory} is not a saved blueprint or form.")
    return out


def blueprint_of(saved: Any) -> dict:
    """A saved blueprint as {flow}, whether Make's API wrapper ({response: {blueprint}}) is kept or not."""
    if not isinstance(saved, dict):
        return {}
    if isinstance(saved.get("response"), dict):
        saved = saved["response"]
    return saved.get("blueprint") if isinstance(saved.get("blueprint"), dict) else saved


# ---------------------------------------------------------------- pure: Make's expressions (the IML of the two blueprints)

TOKEN = re.compile(r'\s*(?:(?P<str>"[^"]*")|(?P<path>\d+(?:\.(?:`[^`]*`|[A-Za-z_][A-Za-z0-9_]*))+)'
                   r'|(?P<num>\d+(?:\.\d+)?)|(?P<name>[A-Za-z_][A-Za-z0-9_]*)|(?P<op>[();+*/-]))')
SEGMENT = re.compile(r"`([^`]*)`|([A-Za-z_][A-Za-z0-9_]*)")


class Synthetic(dict):
    """A module output the evaluator stands in for: a placeholder for each key the blueprints read, and Unsupported
    for any other key, so a blueprint that starts reading something new stops the parity."""


def tokens(src: str) -> list:
    out, pos = [], 0
    while src[pos:].strip():
        m = TOKEN.match(src, pos)
        if not m:
            raise Unsupported(f"the expression text at character {pos}")
        out.append((m.lastgroup, m.group(m.lastgroup)))
        pos = m.end()
    return out


def parse(src: str) -> tuple:
    """One {{...}} expression as a tree: ("lit", v), ("name", n), ("path", module id, [keys]),
    ("call", function, [args]) or ("op", sign, left, right)."""
    toks = tokens(src)
    pos = 0

    def peek() -> tuple:
        return toks[pos] if pos < len(toks) else (None, None)

    def take(kind: Optional[str] = None, text: Optional[str] = None) -> tuple:
        nonlocal pos
        tok = peek()
        if tok[0] is None or (kind and tok[0] != kind) or (text and tok[1] != text):
            raise Unsupported("an expression of this shape")
        pos += 1
        return tok

    def expr() -> tuple:
        node = term()
        while peek() in (("op", "+"), ("op", "-")):
            node = ("op", take()[1], node, term())
        return node

    def term() -> tuple:
        node = factor()
        while peek() in (("op", "*"), ("op", "/")):
            node = ("op", take()[1], node, factor())
        return node

    def factor() -> tuple:
        kind, text = take()
        if (kind, text) == ("op", "("):
            node = expr()
            take("op", ")")
            return node
        if kind == "str":
            return ("lit", text[1:-1])
        if kind == "num":
            return ("lit", float(text) if "." in text else int(text))
        if kind == "path":
            head, rest = text.split(".", 1)
            return ("path", int(head), [a or b for a, b in SEGMENT.findall(rest)])
        if kind == "name" and peek() == ("op", "("):
            take()
            args = []
            if peek() != ("op", ")"):
                args.append(expr())
                while peek() == ("op", ";"):
                    take()
                    args.append(expr())
            take("op", ")")
            return ("call", text, args)
        if kind == "name":
            return ("name", text)
        raise Unsupported("an expression of this shape")

    node = expr()
    if pos != len(toks):
        raise Unsupported("an expression of this shape")
    return node


def walk(node: tuple, kind: str) -> set:
    """The function names (kind "call") or bare names (kind "name") a parsed expression uses."""
    out = set()
    if node[0] == kind:
        out.add(node[1])
    if node[0] == "call":
        for a in node[2]:
            out |= walk(a, kind)
    if node[0] == "op":
        out |= walk(node[2], kind) | walk(node[3], kind)
    return out


def to_text(v: Any) -> str:
    """A value placed in text, as Make writes it."""
    if v is None:
        return ""
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    if isinstance(v, (int, float, str)):
        return str(v)
    if isinstance(v, list):
        return ", ".join(to_text(x) for x in v)
    raise Unsupported("a collection placed in text")


def is_empty(v: Any) -> bool:
    return v is None or (isinstance(v, str) and v == "") or (isinstance(v, list) and not v)


def same_value(a: Any, b: Any) -> bool:
    """switch()'s match: a boolean only equals a boolean, a number a number, a text the same text."""
    if isinstance(a, bool) or isinstance(b, bool):
        return isinstance(a, bool) and isinstance(b, bool) and a == b
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return a == b
    return type(a) is type(b) and a == b


def f_ifempty(value: Any = None, default: Any = None, *_: Any) -> Any:
    return default if is_empty(value) else value


def f_get(obj: Any = None, path: Any = None, *_: Any) -> Any:
    key = to_text(path)
    if isinstance(obj, dict):
        if isinstance(obj, Synthetic) and key not in obj:
            raise Unsupported(f"get() of {key}")
        if key in obj:
            return obj[key]
        cur: Any = obj
        for part in key.split("."):
            cur = cur.get(part) if isinstance(cur, dict) else None
        return cur
    if isinstance(obj, list) and key.isdigit() and 1 <= int(key) <= len(obj):
        return obj[int(key) - 1]
    return None


def f_switch(value: Any = None, *cases: Any) -> Any:
    for i in range(0, len(cases) - 1, 2):
        if same_value(value, cases[i]):
            return cases[i + 1]
    return cases[-1] if len(cases) % 2 else None


def f_join(items: Any = None, sep: Any = "", *_: Any) -> str:
    if not isinstance(items, list):
        return to_text(items)
    return to_text(sep).join(to_text(x) for x in items)


def f_flatten(items: Any = None, *_: Any) -> Any:
    if not isinstance(items, list):
        return items
    out: list = []
    for x in items:
        out.extend(x) if isinstance(x, list) else out.append(x)
    return out


def f_add(items: Any = None, *values: Any) -> list:
    return (list(items) if isinstance(items, list) else []) + list(values)


def f_first(items: Any = None, *_: Any) -> Any:
    if isinstance(items, list):
        return items[0] if items else None
    return items


def f_encode_url(text: Any = None, *_: Any) -> str:
    """encodeURIComponent. A list joins with "," and no space, as the kickoff links Make 13 [29] prefilled show on
    real cards."""
    return urllib.parse.quote(",".join(to_text(x) for x in text) if isinstance(text, list) else to_text(text), safe="-_.!~*'()")


def f_floor(n: Any = None, *_: Any) -> Any:
    return math.floor(n) if isinstance(n, (int, float)) and not isinstance(n, bool) else None


FUNCTIONS = {"ifempty": f_ifempty, "get": f_get, "switch": f_switch, "join": f_join, "flatten": f_flatten,
             "add": f_add, "first": f_first, "encodeURL": f_encode_url, "floor": f_floor}
NAMES = ("true", "false", "null", "emptyarray", "random")


def lookup(ctx: dict, mid: int, keys: list) -> Any:
    outputs = ctx["outputs"]
    if mid not in outputs:
        raise Unsupported(f"[{mid}]'s output, which no earlier module gives")
    cur = outputs[mid]
    for key in keys:
        if isinstance(cur, Synthetic):
            if key not in cur:
                raise Unsupported(f"[{mid}] output {key}")
            cur = cur[key]
        elif isinstance(cur, dict):
            cur = cur.get(key)
        else:
            return None
    return cur


def evaluate(node: tuple, ctx: dict) -> Any:
    kind = node[0]
    if kind == "lit":
        return node[1]
    if kind == "path":
        return lookup(ctx, node[1], node[2])
    if kind == "name":
        if node[1] not in NAMES:
            raise Unsupported(f"the name {node[1]}")
        return {"true": True, "false": False, "null": None, "emptyarray": [], "random": ctx.get("random", 0.5)}[node[1]]
    if kind == "op":
        a, b = evaluate(node[2], ctx), evaluate(node[3], ctx)
        if not all(isinstance(x, (int, float)) and not isinstance(x, bool) for x in (a, b)):
            raise Unsupported(f"{node[1]} on something that is not a number")
        if node[1] == "/":
            return a / b if b else None
        return a + b if node[1] == "+" else a - b if node[1] == "-" else a * b
    if kind == "call":
        fn = FUNCTIONS.get(node[1])
        if fn is None:
            raise Unsupported(f"the function {node[1]}()")
        return fn(*[evaluate(a, ctx) for a in node[2]])
    raise Unsupported("an expression of this shape")


def pieces(text: str) -> list:
    """A mapper text as [("text", s) | ("expr", source)]: each {{...}} is one expression; a "}}" inside quotes is text."""
    out, pos = [], 0
    while True:
        start = text.find("{{", pos)
        if start < 0:
            if pos < len(text):
                out.append(("text", text[pos:]))
            return out
        if start > pos:
            out.append(("text", text[pos:start]))
        i, quoted = start + 2, False
        while i < len(text) and (quoted or not text.startswith("}}", i)):
            quoted = quoted != (text[i] == '"')
            i += 1
        if i >= len(text):
            raise Unsupported("an unclosed {{")
        out.append(("expr", text[start + 2:i]))
        pos = i + 2


def render(value: Any, ctx: dict) -> Any:
    """A mapper value with its expressions evaluated. A text that is one expression keeps the value's type, as in Make."""
    if isinstance(value, str):
        parts = pieces(value)
        if len(parts) == 1 and parts[0][0] == "expr":
            return evaluate(parse(parts[0][1]), ctx)
        return "".join(p if k == "text" else to_text(evaluate(parse(p), ctx)) for k, p in parts)
    if isinstance(value, dict):
        return {k: render(v, ctx) for k, v in value.items()}
    if isinstance(value, list):
        return [render(v, ctx) for v in value]
    return value


OPERATORS = {
    "text:equal": lambda a, b: to_text(a) == to_text(b),
    "text:equal:ci": lambda a, b: to_text(a).lower() == to_text(b).lower(),
    "text:notequal": lambda a, b: to_text(a) != to_text(b),
    "exist": lambda a, b: a is not None,
    "notexist": lambda a, b: a is None,
}


def passes(flt: Any, ctx: dict) -> bool:
    """A route filter: any group of conditions that all hold lets the bundle through; no conditions let it through."""
    groups = (flt or {}).get("conditions") if isinstance(flt, dict) else None
    if not groups:
        return True
    for group in groups:
        ok = True
        for c in group or []:
            op = OPERATORS.get(str((c or {}).get("o")))
            if op is None:
                raise Unsupported(f"the filter operator {(c or {}).get('o')}")
            ok = ok and op(render(c.get("a"), ctx), render(c.get("b"), ctx))
        if ok:
            return True
    return False


# Every module type of the two blueprints; any other stops the parity until the evaluator learns it.
KNOWN_MODULES = {
    "typeform:WatchEventsWithResponses", "builtin:BasicRouter", "builtin:BasicFeeder", "util:TextAggregator",
    "util:FunctionSleep", "clickup:postATaskComment", "clickup:editATask", "clickup:editATaskAdvanced",
    "clickup:createATaskFromATemplate", "clickup:createTaskInList", "clickup:getATask", "google-sheets:filterRows",
    "whapi-cloud:text", "http:MakeRequest",
}
# Outputs later modules read. The map link and the Client Data cells stay placeholders, so the phase texts compare
# as templates; the WhatsApp group id never leaves its placeholder.
OUTPUTS = {
    "clickup:getATask": lambda mid: Synthetic({"custom_fields": Synthetic({"Onboarding Map": "{map_link}"})}),
    "google-sheets:filterRows": lambda mid: Synthetic({"5": "{wa_group}", "7": "{content_folder}"}),
    "clickup:createATaskFromATemplate": lambda mid: Synthetic({"id": "{task:%d}" % mid}),
    "clickup:createTaskInList": lambda mid: Synthetic({"id": "{task:%d}" % mid}),
}
# Mapper keys the evaluator never reads: the dispatch's headers hold a token.
UNREAD = {"http:MakeRequest": ("headers",)}


def trigger_id(blueprint: dict) -> int:
    """The Typeform trigger's module id (1 in Make 12, 24 in Make 13)."""
    for m in flat_modules(blueprint.get("flow")):
        if str(m.get("module") or "").startswith("typeform:"):
            return int(m.get("id"))
    raise Unsupported("a blueprint with no Typeform trigger")


def make_modules(blueprint: dict, trigger: dict, rnd: float = 0.5) -> dict:
    """What each module's input would have been for one Typeform answer: {id: {input, output, module}}."""
    tid = trigger_id(blueprint)
    ctx = {"outputs": {tid: trigger}, "random": rnd}
    mods: dict = {}
    run_flow(blueprint.get("flow"), ctx, mods, tid)
    return mods


def run_flow(flow: Any, ctx: dict, mods: dict, tid: int) -> None:
    feeder: Optional[tuple] = None
    for m in flow or []:
        if not isinstance(m, dict):
            continue
        mid, kind = int(m.get("id")), str(m.get("module") or "")
        if kind not in KNOWN_MODULES:
            raise Unsupported(f"[{mid}] {kind}")
        if mid == tid:
            mods[mid] = {"input": {}, "output": ctx["outputs"][mid], "module": kind}
            continue
        if not passes(m.get("filter"), ctx):
            return  # Make stops this route at a filter that does not pass
        if feeder is not None and kind != "util:TextAggregator":
            raise Unsupported(f"[{mid}] between an iterator and its aggregator")
        mapper = {k: v for k, v in (m.get("mapper") or {}).items() if k not in UNREAD.get(kind, ())}
        params = m.get("parameters") or {}
        if kind == "builtin:BasicRouter":
            mods[mid] = {"input": {}, "output": {}, "module": kind}
            for route in m.get("routes") or []:
                run_flow((route or {}).get("flow"), ctx, mods, tid)
            continue
        if kind == "builtin:BasicFeeder":
            items = render(mapper.get("array"), ctx)
            items = items if isinstance(items, list) else ([] if items is None else [items])
            feeder = (mid, items)
            mods[mid] = {"input": {"array": items}, "output": {}, "module": kind}
            continue
        if kind == "util:TextAggregator":
            if feeder is None or str(feeder[0]) != str(params.get("feeder")):
                raise Unsupported(f"[{mid}] without its iterator")
            sep = params.get("rowSeparator", "\n")
            if sep == "other":
                sep = str(params.get("customRowSeparator") or "")
            rows = []
            for item in feeder[1]:
                ctx["outputs"][feeder[0]] = item
                rows.append(to_text(render(mapper.get("value"), ctx)))
            ctx["outputs"].pop(feeder[0], None)
            feeder = None
            out = Synthetic({"text": str(sep).join(rows)})
            ctx["outputs"][mid] = out
            mods[mid] = {"input": {"value": rows}, "output": out, "module": kind}
            continue
        out = OUTPUTS.get(kind, lambda _mid: Synthetic())(mid)
        mods[mid] = {"input": render(mapper, ctx), "output": out, "module": kind}
        ctx["outputs"][mid] = out


# ---------------------------------------------------------------- pure: the stored answers as Make's trigger

def question_fields(definition: Any) -> list:
    """A form's questions in order, groups opened and statements left out."""
    out: list = []
    fields = definition.get("fields") if isinstance(definition, dict) else None
    for f in fields or []:
        if not isinstance(f, dict):
            continue
        if f.get("type") in ("inline_group", "group"):
            out.extend(question_fields(f.get("properties") or {}))
        elif f.get("type") != "statement":
            out.append(f)
    return out


def typed(value: Any, kind: Any, multi: bool) -> Any:
    """A stored answer (always text) as Typeform hands it to Make: yes/no a boolean, a number a number, a list a list.
    A number 0 arrives empty: on real cards Make wrote "Not provided", a blank link value and a blank comment line
    for it."""
    s = str(value)
    if kind == "yes_no" and s.strip().lower() in ("yes", "true", "no", "false"):
        return s.strip().lower() in ("yes", "true")
    if kind == "number" and NUMBER.match(s.strip()):
        n = float(s) if "." in s else int(s)
        return None if n == 0 else n
    if multi:
        return s.split(", ")
    return s


def clean(answers: Any) -> list:
    """Stored answers as [{ref, title, value}], blanks left out."""
    out = []
    for a in answers or []:
        if isinstance(a, dict) and a.get("ref") and a.get("value") not in (None, ""):
            out.append({"ref": str(a["ref"]), "title": str(a.get("title") or ""), "value": str(a["value"])})
    return out


def trigger_bundle(definition: dict, answers: list, hidden: dict) -> dict:
    """The Typeform trigger's output for one stored answer: hidden, mappable_answers by ref, and definition.fields
    as the fidelity check found them on real cards: the answered questions only, in the form's order, under the
    saved form's titles (the cockpit stores shorter ones). An answer to a question the form no longer has comes last
    under its stored title."""
    fields = question_fields(definition)
    types = {str(f.get("ref")): (f.get("type"), bool((f.get("properties") or {}).get("allow_multiple_selection")))
             for f in fields if f.get("ref")}
    answered = {a["ref"]: a for a in answers}
    listed = [{"id": f.get("id"), "ref": f.get("ref"), "type": f.get("type"), "title": f.get("title")}
              for f in fields if str(f.get("ref")) in answered]
    known = {str(f["ref"]) for f in listed}
    listed += [{"id": None, "ref": a["ref"], "type": None, "title": a["title"]} for a in answers if a["ref"] not in known]
    return {"hidden": dict(hidden),
            "mappable_answers": {a["ref"]: typed(a["value"], *types.get(a["ref"], ("", False))) for a in answers},
            "definition": {"fields": listed}}


def hidden_of(link: Any) -> dict:
    """A prefilled Typeform link's hidden values (the part after #), decoded."""
    frag = str(link or "").split("#", 1)[1] if "#" in str(link or "") else ""
    out = {}
    for part in frag.split("&"):
        k, _, v = part.partition("=")
        if k:
            out[k] = urllib.parse.unquote(v)
    return out


def kickoff_hidden(make13: dict, definition: dict, task: str, onboarding: list) -> dict:
    """The kickoff's hidden values: Make 13 [29]'s Kickoff Form Link on the card's onboarding answers."""
    mods = make_modules(make13, trigger_bundle(definition, onboarding, {"onboarding_client_id": task}))
    link = custom_fields((mods.get(29) or {}).get("input") or {}).get(FIELD["kickoff_link"])
    if not link:
        raise Unsupported("[29] without its Kickoff Form Link")
    return hidden_of(link)


def cockpit_hidden(make13: dict, task: str, onboarding: list, card_name: Optional[str]) -> dict:
    """The kickoff's hidden values as the cockpit's own kickoff link sends them (prefill.ts buildHidden, since
    2026-10-22): each onboarding answer as stored, and the card's name when there is no business name. The keys and
    refs are [29]'s."""
    mod = next((m for m in flat_modules(make13.get("flow")) if m.get("id") == 29), {})
    template = str(((mod.get("mapper") or {}).get("custom_fields") or {}).get(FIELD["kickoff_link"]) or "")
    by_ref = {a["ref"]: a["value"] for a in onboarding}
    out = {"onboarding_client_id": task}
    for key, ref in re.findall(r"[#&]([A-Za-z0-9_]+)=\{\{encodeURL\(\d+\.mappable_answers\.`([^`]+)`\)\}\}", template):
        if by_ref.get(ref, "").strip():
            out[key] = by_ref[ref]
    if not out.get("legal_name") and card_name and card_name.strip():
        out["legal_name"] = card_name.strip()
    return out


def ms_of(ts: Any) -> int:
    s = str(ts or "").strip().replace(" ", "T").replace("Z", "+00:00")
    s = re.sub(r"\.(\d+)", lambda m: "." + (m.group(1) + "000000")[:6], s)
    if re.search(r"[+-]\d\d$", s):
        s += ":00"
    try:
        return int(datetime.fromisoformat(s).timestamp() * 1000)
    except ValueError:
        return 0


def newest(rows: list, last: int) -> list:
    return sorted(rows, key=lambda r: ms_of(r.get("submittedAt")), reverse=True)[:last]


def kickoff_runs(readmodel: list, responses: list, last: int) -> list:
    """The newest stored tG7dnxBn kickoffs (the read model), each with its pointer row in cockpit_form_responses."""
    pointers = {str(r.get("external_id")): r for r in responses if r.get("form_key") == "kickoff" and r.get("external_id")}
    out = []
    for row in readmodel:
        k = row.get("kickoff")
        if not isinstance(k, dict) or k.get("form_id") != KICKOFF_FORM or not isinstance(k.get("answers"), list):
            continue
        p = pointers.get(str(k.get("response_id") or "")) or {}
        out.append({"task": row.get("clickup_task_id"), "token": str(k.get("response_id") or ""),
                    "submittedAt": k.get("submitted_at"), "answers": clean(k["answers"]), "responseId": p.get("id"),
                    "names": [p.get("client_name"), row.get("client_name")], "cardName": row.get("client_name")})
    return newest(out, last)


def onboarding_runs(readmodel: list, responses: list, last: int) -> list:
    """The newest stored KFRCXPFx answers: the cockpit_form_responses rows, then any read model entry they lack."""
    names = {r.get("clickup_task_id"): r.get("client_name") for r in readmodel}
    out, seen = [], set()
    for r in responses:
        fields = r.get("answers", {}).get("fields") if isinstance(r.get("answers"), dict) else None
        task = r.get("task_id") or (r.get("hidden") or {}).get("onboarding_client_id")
        if r.get("form_key") != "onboarding" or not isinstance(fields, list) or not task:
            continue
        seen.add(str(r.get("external_id") or ""))
        out.append({"task": task, "token": str(r.get("external_id") or ""), "submittedAt": r.get("submitted_at"),
                    "answers": clean(fields), "responseId": r.get("id"), "names": [r.get("client_name"), names.get(task)]})
    for row in readmodel:
        o = row.get("onboarding")
        if (isinstance(o, dict) and o.get("form_id") == ONBOARDING_FORM and isinstance(o.get("answers"), list)
                and str(o.get("response_id") or "") not in seen and row.get("clickup_task_id")):
            out.append({"task": row.get("clickup_task_id"), "token": str(o.get("response_id") or ""),
                        "submittedAt": o.get("submitted_at"), "answers": clean(o["answers"]), "responseId": None,
                        "names": [row.get("client_name")]})
    return newest(out, last)


def card_onboarding(task: str, readmodel: list, responses: list) -> list:
    """The card's onboarding answers, as the cockpit holds them now (the read model, else the newest response)."""
    for row in readmodel:
        o = row.get("onboarding")
        if row.get("clickup_task_id") == task and isinstance(o, dict) and isinstance(o.get("answers"), list):
            return clean(o["answers"])
    rows = [r for r in onboarding_runs([], responses, 1000) if r["task"] == task]
    return rows[0]["answers"] if rows else []


def native_input(rec: dict, client: Optional[str], hidden: dict) -> dict:
    """The parity plan's input, as cockpit_form_stage4_input gives it for the same answer: the card's name as client."""
    return {"taskId": rec["task"], "client": client, "submittedAt": rec["submittedAt"], "token": rec["token"] or None,
            "hidden": {k: v for k, v in hidden.items() if v}, "answers": rec["answers"], "cardOnSheet": True}


# ---------------------------------------------------------------- pure: one stored answer, both sides' inputs

# Where a kickoff's hidden values came from: Make 13 [29]'s Kickoff Form Link, or the cockpit's own kickoff link.
SOURCES = {"make13": "", "cockpit": "the cockpit's kickoff link"}
# The cockpit's own kickoff link went out from this day; without ClickUp's comments it is the one assumed after it.
COCKPIT_LINK_SINCE = "2026-10-22T00:00:00+03:00"


def saved_set(blueprint_dir: str, typeform_dir: str) -> dict:
    """The two saved blueprints and the two saved Typeform definitions the evaluator reads."""
    return {"make12": blueprint_of(saved_file(blueprint_dir, str(MAKE12))),
            "make13": blueprint_of(saved_file(blueprint_dir, str(MAKE13))),
            "kickoff": saved_file(typeform_dir, KICKOFF_FORM), "onboarding": saved_file(typeform_dir, ONBOARDING_FORM)}


def client_of(rec: dict, names: dict) -> Optional[str]:
    """The card's name as the cockpit plans it: the billing sheet's, else the stored answer's."""
    return next((x for x in [names.get(rec["task"])] + rec["names"] if isinstance(x, str) and x.strip()), None)


def kickoff_hidden_from(source: str, saved: dict, rec: dict, readmodel: list, responses: list) -> dict:
    """A kickoff's hidden values from one source (SOURCES), on the card's onboarding answers as the cockpit holds them."""
    onboarding = card_onboarding(rec["task"], readmodel, responses)
    if source == "cockpit":
        return cockpit_hidden(saved["make13"], rec["task"], onboarding, rec.get("cardName"))
    return kickoff_hidden(saved["make13"], saved["onboarding"], rec["task"], onboarding)


def make_side(form: str, saved: dict, rec: dict, hidden: dict) -> dict:
    """Make's module inputs for one stored answer: Make 12 on a kickoff (with its hidden values), Make 13 on an
    onboarding answer."""
    if form == "kickoff":
        return make_modules(saved["make12"], trigger_bundle(saved["kickoff"], rec["answers"], hidden))
    return make_modules(saved["make13"], trigger_bundle(saved["onboarding"], rec["answers"], {"onboarding_client_id": rec["task"]}))


def oracle(form: str, saved: dict, rec: dict, readmodel: list, responses: list, names: dict,
           source: Optional[str] = None) -> dict:
    """One stored answer with no network: {input, mods, source}. input is what parity() sends to
    cockpit_form_parity_plan; mods is Make's evaluated modules. A kickoff's hidden values come from source (SOURCES);
    when none is given, from the cockpit's link on or after COCKPIT_LINK_SINCE and Make 13 [29]'s link before it (on the
    VPS the fidelity check decides instead)."""
    hidden: dict = {}
    if form == "kickoff":
        if source is None:
            source = "cockpit" if ms_of(rec["submittedAt"]) >= ms_of(COCKPIT_LINK_SINCE) else "make13"
        if source not in SOURCES:
            raise Unsupported(f"the hidden value source {source}")
        hidden = kickoff_hidden_from(source, saved, rec, readmodel, responses)
    else:
        source = None
    return {"input": native_input(rec, client_of(rec, names), hidden), "mods": make_side(form, saved, rec, hidden),
            "source": source}


def relay_of(m25: Optional[dict], task: str) -> dict:
    """What ~/.forms-relay/config.env holds for the dispatch (D-S4F), read from one evaluated Make 13 [25] input:
    the repository from its URL, the event and the two client_payload keys from its body (the id key is the one
    holding the card id). Never its headers: the evaluator leaves them out."""
    m = re.match(r"^https://api\.github\.com/repos/([^/]+)/([^/]+)/dispatches$", str((m25 or {}).get("url") or ""))
    try:
        body = json.loads(str((m25 or {}).get("jsonStringBodyContent") or "{}"))
    except ValueError:
        body = {}
    sent = body.get("client_payload") if isinstance(body, dict) and isinstance(body.get("client_payload"), dict) else {}
    ids = [k for k, v in sent.items() if str(v) == task]
    names = [k for k in sent if k not in ids]
    if not m or len(ids) != 1 or len(names) != 1:
        return {}
    return {"DISPATCH_OWNER": m.group(1), "DISPATCH_REPO": m.group(2), "DISPATCH_EVENT": str(body.get("event_type") or ""),
            "DISPATCH_NAME_KEY": names[0], "DISPATCH_ID_KEY": ids[0]}


# ---------------------------------------------------------------- pure: comparing

def fold(text: Any) -> str:
    """Whitespace folded, the way 4.13.3 compares a text: runs of spaces and new lines are one space."""
    return re.sub(r"\s+", " ", str(text or "")).strip()


def unmarked(text: Any) -> str:
    """A comment as ClickUp may hand it back: markdown marks (* and rule lines) dropped, whitespace folded."""
    lines = [line for line in str(text or "").splitlines() if not RULE.fullmatch(line)]
    return fold("\n".join(lines).replace("*", ""))


def same_text(a: Any, b: Any) -> bool:
    return fold(a) == fold(b) or unmarked(a) == unmarked(b)


def text_verdict(made: Any, planned: Any, what: str = "text") -> str:
    """A text Make writes against the cockpit's: equal only byte for byte (the CEO's rule, 2026-11-02); a difference
    in spaces or new lines alone is named as that."""
    if made is None or planned is None:
        return "equal" if made is None and planned is None else f"differs: {what}"
    if str(made) == str(planned):
        return "equal"
    return f"differs: {what}, whitespace only" if fold(made) == fold(planned) else f"differs: {what}"


def custom_fields(bundle: dict) -> dict:
    """A ClickUp module's custom field writes by field id, whatever shape the mapper uses."""
    out: dict = {}
    for key in ("customFields", "custom_fields", "fields"):
        v = bundle.get(key)
        if isinstance(v, list):
            for f in v:
                if isinstance(f, dict) and (f.get("id") or f.get("field_id")):
                    out[str(f.get("id") or f.get("field_id"))] = f.get("value")
        elif isinstance(v, dict):
            out.update({str(k): val for k, val in v.items()})
    for k, v in bundle.items():
        m = re.match(r"^(?:customField_|cf_)?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$", str(k))
        if m:
            out.setdefault(m.group(1), v)
    return out


def option_name(field_options: dict, field_id: str, value: Any) -> Optional[str]:
    """A dropdown's value (option id, orderindex or name) as its option name."""
    opts = field_options.get(field_id) or []
    for o in opts:
        if str(o.get("id")) == str(value) or str(o.get("orderindex")) == str(value) or str(o.get("name")) == str(value):
            return str(o.get("name"))
    return None


def text_of(bundle: dict, *keys: str) -> Optional[str]:
    for k in keys:
        if isinstance(bundle.get(k), str):
            return bundle[k]
    return None


def flat_modules(flow: Any) -> list:
    """Every module of a blueprint's flow, routes included."""
    out: list = []
    for m in flow or []:
        if not isinstance(m, dict):
            continue
        out.append(m)
        for route in m.get("routes") or []:
            out.extend(flat_modules((route or {}).get("flow")))
    return out


def line_of(blueprint: Any, mid: int) -> str:
    """A Client Data module ([24] in Make 12, [31] in Make 13): a search (fine), or a write of some columns (D-S4.0
    stops until it is its own effect)."""
    mod = next((m for m in flat_modules(blueprint_of(blueprint).get("flow")) if m.get("id") == mid), None)
    if mod is None:
        return f"[{mid}] not found in the blueprint"
    if SEARCH.search(str(mod.get("module") or "")):
        return f"[{mid}] search"
    values = (mod.get("mapper") or {}).get("values")
    cols = sorted(str(k) for k in values) if isinstance(values, dict) else sorted(str(k) for k in (mod.get("mapper") or {}))
    return f"[{mid}] writes: {', '.join(cols)}"


def relay_row(config: dict, payload: dict) -> dict:
    """The Client Data row a relay would write, by column letter (CLIENT_DATA_COLUMNS of the relay config)."""
    try:
        columns = json.loads(config.get("CLIENT_DATA_COLUMNS") or "{}")
    except ValueError:
        return {}
    answers = payload.get("answers") or {}
    out: dict = {}
    for letter, source in columns.items():
        if source == "task":
            v = payload.get("taskId")
        elif source == "client":
            v = payload.get("client")
        elif source == "submittedAt":
            v = payload.get("submittedAt")
        elif source.startswith("answer:"):
            v = answers.get(source[7:])
        elif source.startswith("const:"):
            v = source[6:]
        else:
            v = ""
        out[letter.upper()] = "" if v is None else str(v)
    return out


def equal_plus(*names: Optional[str]) -> str:
    """One effect's verdict when Make's part is equal: "equal", or "equal + intended: <names>" for its registered
    additions (names of INTENDED). An addition is named only once Make's part is equal; it never hides a difference."""
    named = [n for n in names if n]
    for n in named:
        if n not in INTENDED:
            raise KeyError(f"{n} is not an INTENDED entry")
    return f"equal + intended: {', '.join(named)}" if named else "equal"


def only_intended(name: str) -> str:
    """The verdict of an effect Make has no part in: "intended: <name>"."""
    if name not in INTENDED:
        raise KeyError(f"{name} is not an INTENDED entry")
    return f"intended: {name}"


def intended_names(verdict: str) -> list:
    """The INTENDED names a verdict gives ("equal + intended: a, b" or "intended: a", with or without a note in
    brackets after it, as card_facts' "(receipt not read)")."""
    m = re.match(r"^(?:equal \+ )?intended: ([^(]+?)(?: \(.*\))?$", verdict)
    return [n.strip() for n in m.group(1).split(",")] if m else []


def legend(verdicts: list) -> list:
    """One line per INTENDED name the verdicts use, in first-use order: "intended <name>: <why>"."""
    seen: list = []
    for v in verdicts:
        seen += [n for n in intended_names(v) if n in INTENDED and n not in seen]
    return [f"intended {n}: {INTENDED[n]}" for n in seen]


def short_id(value: Any) -> str:
    """A field id as its first 8 characters, or "a field" for anything that is not an id (never a value)."""
    s = str(value or "")
    return s[:8] if re.fullmatch(r"[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}", s) else "a field"


def safe_name(value: Any) -> str:
    """A key or effect name as it is, or "a key" when it is not a plain identifier (never a value)."""
    return str(value) if NAME.match(str(value)) else "a key"


def phase_verdict(phase: str, made: Optional[dict], effect: Optional[dict], ctx: dict) -> str:
    """A phase text compares as a template: stage4.messages.<phase> against Make's body with its map link and
    content folder as {map_link} and {content_folder}."""
    text = (ctx.get("messages") or {}).get(phase)
    if not isinstance(text, str) or not text.strip():
        return "setting missing"
    if made is None:
        return only_intended("no_group")
    same = text_verdict(text_of(made, "body", "text", "message"), text)
    if same != "equal":
        return same
    if not ((effect or {}).get("plan") or {}).get("body") or (effect or {}).get("missing"):
        return f"differs: the cockpit drafts no {phase.replace('phase', 'phase ')} message"
    return equal_plus("approval")


def task_comment(m18: Optional[dict], m23: Optional[dict], planned: dict) -> Optional[str]:
    """Make 12 [18] and [23] post the handoff as a comment on each onboarding task; the cockpit's onboarding_tasks plan
    must carry the same text as comment_text, byte for byte, and the request writer must post it (TASK_COMMENT_STEP),
    alone (REF_LINE). None when all hold. The request's details (the task description, 4,000 characters at most) is not
    a comment."""
    texts = [text_of(m or {}, "comment_text") for m in (m18, m23)]
    if "comment_text" not in planned:
        cut = any(isinstance(t, str) and len(t) > 4000 for t in texts)
        return ("Make posts the handoff on each task as a comment, the cockpit only in the task description"
                + (" (4,000 characters at most, and Make's is longer)" if cut else ""))
    verdicts = [text_verdict(t, planned.get("comment_text"), "the handoff on the tasks") for t in texts]
    what = [x for x in [next((v[len("differs: "):] for v in verdicts if v != "equal"), None),
                        NO_TASK_COMMENT if TASK_COMMENT_STEP is None
                        else REF_ADDED if "onboarding_tasks" in REF_LINE else None] if x]
    return "; ".join(what) or None


def delivered(effect: str, verdict: str) -> str:
    """A comment's text verdict as ClickUp receives it: the writer's Cockpit ref line differs from Make's comment even
    where the plan's text equals it (REF_LINE)."""
    if effect not in REF_LINE:
        return verdict
    return f"{verdict}; {REF_ADDED}" if verdict.startswith("differs") else f"differs: {REF_ADDED}"


def has_details_field(ctx: dict, type_key: str) -> bool:
    """Whether the request type puts a details answer in the task description: cockpit_request_create_system drops
    details silently unless a field is keyed details (20261102o), and cockpit_request_plan writes into the description
    the field of kind details (20261026r). Unknown (no field list read) counts as none."""
    fields = (ctx.get("fields") or {}).get(type_key)
    return isinstance(fields, list) and any(isinstance(f, dict) and f.get("key") == "details" and f.get("kind") == "details"
                                            for f in fields)


def details_slot(effect: str, planned: dict, ctx: dict) -> tuple:
    """A plan's details (the task description; Make 12 [17], [22] and Make 13 [46] write none) as (difference,
    intended name). Accepted only in the effect's registered slot (SLOTS): its exact first line, its detailsKind and
    BRIEF_MAX characters at most, on a request type that keeps details. Any other details is a description Make does
    not write. The template's text and the Cockpit ref the writer puts above and below it are INTENDED['request_route']."""
    details = planned.get("details")
    if details is None or not str(details).strip():
        return None, None
    name, header, type_key = SLOTS[effect]
    if not isinstance(details, str) or details.split("\n", 1)[0] != header or planned.get("detailsKind") != name:
        return DESCRIPTION, None
    if len(details) > BRIEF_MAX:
        return f"the {name} is {len(details):,} characters, over {BRIEF_MAX:,}", None
    if not has_details_field(ctx, type_key):
        return DROPPED, None
    return None, name


def real_day(d: Any) -> Optional[str]:
    """A calendar day as written, when it is one (forms.ts realDay: "2026-02-31" is not)."""
    if not isinstance(d, str) or not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", d):
        return None
    try:
        datetime.strptime(d, "%Y-%m-%d")
    except ValueError:
        return None
    return d


def kuwait_day(ms: Any) -> Optional[str]:
    """An instant in epoch milliseconds as its Kuwait day (UTC+3), as requests.ts kuwaitDay reads it; None for none."""
    try:
        n = float(ms)
        return (datetime(1970, 1, 1) + timedelta(milliseconds=n + 3 * 3_600_000)).date().isoformat() \
            if math.isfinite(n) and n > 0 else None
    except (TypeError, ValueError, OverflowError):
        return None


def zoned_day(v: str) -> Optional[str]:
    """An instant with its zone written out (FACT_ZONED) as its Kuwait day; None when its day or time does not exist."""
    m = re.fullmatch(r"([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2})(?::([0-9]{2})(?:\.([0-9]{1,6}))?)?"
                     r"(?:Z|([+-])([0-9]{2}):?([0-9]{2}))", v)
    if not m:
        return None
    y, mo, d, h, mi, s, frac, sign, oh, om = m.groups()
    try:
        at = datetime(int(y), int(mo), int(d), int(h), int(mi), int(s or 0), int((frac or "0").ljust(6, "0")))
        if sign:
            if int(oh) > 23 or int(om) > 59:
                return None
            shift = timedelta(hours=int(oh), minutes=int(om))
            at = at - shift if sign == "+" else at + shift
        return (at + timedelta(hours=3)).date().isoformat()
    except (ValueError, OverflowError):
        return None


def fact_day(f: dict) -> Optional[str]:
    """A card_facts date's Kuwait day as forms.ts factDay takes it, else None: a real day, an instant with its zone, or
    epoch milliseconds (a number or up to 16 digits), inside FACT_DAYS; with the `day` the plan names, both one day."""
    v = f.get("value")
    day = None
    if isinstance(v, str) and re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", v):
        day = real_day(v)
    elif isinstance(v, str) and FACT_ZONED.fullmatch(v):
        day = zoned_day(v)
    elif (isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) and float(v).is_integer()) \
            or (isinstance(v, str) and re.fullmatch(r"[0-9]{1,16}", v)):
        day = kuwait_day(v)
    if not day or not FACT_DAYS[0] <= day <= FACT_DAYS[1]:
        return None
    return day if "day" not in f or real_day(f["day"]) == day else None


def fact_receipt(value: Any) -> Any:
    """The writer's card_facts receipt as {fieldId: {before, state, differs?, note?}}, from wherever it is handed over:
    the fields alone, the step (progress.steps.card_facts: {state, at, fields, note?}), the queue row's progress
    ({steps: {card_facts: ...}}) or the effect row's receipt ({table, id, state, at, step}). None when there is none;
    False when there is one that is not the writer's shape (FactReceipt in forms.ts: `before` "empty" or "set", never a
    value; `state` "due", "written" or "kept"), so a receipt in another shape is never passed over in silence."""
    if isinstance(value, dict) and "table" in value and "step" in value:
        value = value["step"]
    if isinstance(value, dict) and "steps" in value:
        value = value["steps"].get(FACT_STEP) if isinstance(value["steps"], dict) else False
    if value is None:
        return None
    if isinstance(value, dict) and "fields" in value:
        value = value["fields"]
    if not isinstance(value, dict) or not value:
        return False
    for fid, r in value.items():
        if not (isinstance(fid, str) and isinstance(r, dict) and set(r) <= FACT_KEYS
                and r.get("before") in FACT_BEFORE and r.get("state") in FACT_STATE):
            return False
    return value


def card_facts_verdict(effect: dict, made: dict, ctx: dict) -> str:
    """card_facts (B8), an effect Make has no part in, graded as clickup-writeback's factsStep takes its plan and by the
    writer's own receipt. "intended: card_facts" only when every planned field is one of CARD_FACTS, written as its
    kind, with a label, a value of that kind (an https link; a date fact_day reads) or options the field has, each
    once, a source and onlyIfEmpty, and Make writes none of them itself (made: Make's custom field writes on the card).
    A plan of no field carries its skip reason: the runner skips only that, and the writer refuses an empty list. The
    receipt (effect["receipt"], or "receipts", in any shape fact_receipt reads) differs when a field went "written"
    over a card value that was "set", when the writer wrote a field the plan does not name, or when it is not the
    writer's shape. With no receipt the verdict says "(receipt not read)": only the plan was graded."""
    fields = (effect.get("plan") or {}).get("fields")
    if not isinstance(fields, list):
        return "differs: card_facts plans no list of fields"
    if not fields and not (isinstance(effect.get("skip"), str) and effect["skip"].strip()):
        return "differs: card_facts plans no field and no skip (the writer refuses an empty list)"
    found: dict = {k: [] for k in ("over", "unplanned", "outside", "twice", "unguarded", "kind", "label", "value",
                                   "repeat", "option", "source", "make")}
    seen: set = set()
    for f in fields:
        fid = str((f or {}).get("fieldId") or "") if isinstance(f, dict) else ""
        if fid not in CARD_FACTS:
            found["outside"].append(short_id(fid))
            continue
        short, kind = fid[:8], CARD_FACTS[fid][0]
        if fid in seen:
            found["twice"].append(short)
        seen.add(fid)
        if f.get("onlyIfEmpty") is not True:
            found["unguarded"].append(short)
        if f.get("kind") != kind:
            found["kind"].append(short)
        if not isinstance(f.get("label"), str):
            found["label"].append(short)
        if not isinstance(f.get("source"), str) or not f["source"].strip():
            found["source"].append(short)
        if kind == "url":
            v = f.get("value")
            if not (isinstance(v, str) and re.fullmatch(r"https://\S+\.\S+", v)):
                found["value"].append(short)
        elif kind == "date":
            if fact_day(f) is None:
                found["value"].append(short)
        else:
            picked = [f.get("optionId")] if kind == "drop_down" else f.get("optionIds")
            if not isinstance(picked, list) or not picked or not all(isinstance(x, str) and x for x in picked):
                found["value"].append(short)
            else:
                if len(set(picked)) != len(picked):
                    found["repeat"].append(short)
                known = {str(o.get("id")) for o in (ctx.get("options") or {}).get(fid) or [] if isinstance(o, dict)}
                if not set(picked) <= known:
                    found["option"].append(short)
        if not is_empty(made.get(fid)):
            found["make"].append(short)
    receipt = fact_receipt(effect.get("receipt", effect.get("receipts")))
    planned = {str(f.get("fieldId")) for f in fields if isinstance(f, dict)}
    for fid, r in (receipt or {}).items():
        if r["state"] != "written":
            continue
        if r["before"] != "empty":
            found["over"].append(short_id(fid))
        elif fid not in planned:
            found["unplanned"].append(short_id(fid))
    said = {"over": "overwrote a card value ({})",
            "unplanned": "the writer wrote a field the plan does not name ({})",
            "outside": "card_facts plans a field outside the five ({})",
            "twice": "card_facts plans a field twice ({})",
            "unguarded": "card_facts could overwrite a card value: no onlyIfEmpty on {}",
            "kind": "card_facts plans the wrong kind for {}",
            "label": "card_facts plans no label for {}",
            "value": "card_facts plans no usable value for {}",
            "repeat": "card_facts plans an option twice on {}",
            "option": "card_facts plans an option the field does not have on {}",
            "source": "card_facts names no source for {}",
            "make": "Make writes {} itself"}
    what = [said[k].format(", ".join(sorted(set(v)))) for k, v in found.items() if v]
    if receipt is False:
        what.append("the writer's receipt is not in its shape ({fieldId: {before, state}})")
    if what:
        return f"differs: {'; '.join(what)}"
    return only_intended("card_facts") + ("" if receipt else " (receipt not read)")


def contact_in(value: Any) -> bool:
    """Whether a payload holds a contact answer anywhere: one of the five contact refs or keys, as a key or a ref."""
    if isinstance(value, dict):
        return any(str(k) in CONTACT_REFS or str(k) in CONTACT_KEYS or contact_in(v) for k, v in value.items()) \
            or str(value.get("ref") or "") in CONTACT_REFS
    if isinstance(value, list):
        return any(contact_in(v) for v in value)
    return False


def dispatch_extras(payload: dict) -> list:
    """What the cockpit's dispatch payload holds beyond Make 13 [25]'s two keys (client, taskId): any key not
    allowed by DISPATCH_EXTRA_KEYS (empty until the CEO's word on CEO-1), and any contact answer."""
    what = []
    extra = sorted(safe_name(k) for k in payload if k not in DISPATCH_KEYS and k not in DISPATCH_EXTRA_KEYS)
    if extra:
        what.append(f"the cockpit sends keys Make does not ({', '.join(extra)})")
    if contact_in(payload):
        what.append("the cockpit sends a contact answer")
    return what


def compare_kickoff(plan: list, mods: dict, ctx: dict) -> list:
    """One (effect, verdict) per effect of Make 12, and one for card_facts when it is planned; verdict is equal,
    equal + intended: {names}, intended: {name}, differs: {what} or setting missing."""
    fx = {e["key"]: e for e in plan}
    out = []
    p = lambda k: (fx.get(k) or {}).get("plan") or {}  # noqa: E731

    def need(mid: int) -> Optional[dict]:
        return mods.get(mid, {}).get("input") or None

    m11 = need(11)
    out.append(("handoff_comment", "differs: module [11] not in the run" if m11 is None
                else delivered("handoff_comment", text_verdict(text_of(m11, "comment_text", "commentText", "comment"),
                                                               p("handoff_comment").get("comment_text")))))
    m20 = need(20)
    status = text_of(m20 or {}, "status") or ""
    out.append(("native_status", "differs: module [20] not in the run" if m20 is None
                else "equal" if status.strip().lower() == "in progress" else "differs: status"))
    m21 = need(21)
    if m21 is None:
        out.append(("card_fields", "differs: module [21] not in the run"))
    else:
        made = custom_fields(m21)
        fields = p("card_fields").get("fields") or []
        diffs = []
        for f in fields:
            fid = f["fieldId"]
            if fid == FIELD["blueprint"]:
                continue
            raw = made.get(fid)
            if fid not in made:
                diffs.append(short_id(fid))  # a field Make 12 [21] never writes
            elif f.get("kind") == "drop_down" or "optionName" in f:
                # Service Advertised too (X37): Make 12 [21] writes switch(first(list)), so a service the cockpit
                # writes where Make writes none differs.
                got = option_name(ctx.get("options", {}), fid, raw) if raw not in (None, "") else None
                if got != f.get("optionName"):
                    diffs.append(fid[:8])
            elif to_text(raw) != to_text(f.get("value")):
                diffs.append(fid[:8])
        for fid, value in made.items():
            if fid == FIELD["blueprint"] or value in (None, ""):
                continue
            if not any(f["fieldId"] == fid for f in fields):
                diffs.append(fid[:8])
        out.append(("card_fields", f"differs: {', '.join(sorted(set(diffs)))}" if diffs else equal_plus("blueprint")))
    targets = ctx.get("targets", {}).get("client_onboarding") or []
    m17, m22 = need(17), need(22)
    if m17 is None or m22 is None:
        out.append(("onboarding_tasks", "differs: module [17] or [22] not in the run"))
    elif not targets:
        out.append(("onboarding_tasks", "differs: the client_onboarding request type is not set up"))
    else:
        made = {(str(m.get("list_id") or ""), str(m.get("template_id") or "")) for m in (m17, m22)}
        want = {(str(t.get("list_id") or ""), str(t.get("template_id") or "")) for t in targets}
        what = [] if made == want else ["lists or templates"]
        slot, brief = details_slot("onboarding_tasks", p("onboarding_tasks"), ctx)
        what += [x for x in [task_comment(need(18), need(23), p("onboarding_tasks")), slot] if x]
        out.append(("onboarding_tasks", f"differs: {'; '.join(what)}" if what
                    else equal_plus("task_name", "dedupe", "request_route", brief)))
    m26 = need(26)
    want_map = p("map_phase4").get("value")
    url = custom_fields(m26).get(FIELD["map"]) if m26 else None
    out.append(("map_phase4", "differs: module [26] not in the run" if m26 is None
                else "differs: the phase 4 map link is not set up" if not want_map
                else "equal" if str(url or "").strip() == want_map else "differs: value"))
    out.append(("phase4_whatsapp", phase_verdict("phase4", need(25), fx.get("phase4_whatsapp"), ctx)))
    out.append(("kickoff_notice", only_intended("notice")))
    out.append(("new_mrr", only_intended("new_mrr")))
    out.append(("recap", only_intended("recap")))
    if "card_facts" in fx:
        out.append(("card_facts", card_facts_verdict(fx["card_facts"], custom_fields(m21 or {}), ctx)))
    return out


def compare_onboarding(plan: list, mods: dict, ctx: dict) -> list:
    fx = {e["key"]: e for e in plan}
    out = []
    p = lambda k: (fx.get(k) or {}).get("plan") or {}  # noqa: E731

    def need(mid: int) -> Optional[dict]:
        return mods.get(mid, {}).get("input") or None

    relay = ctx.get("relay", {})
    m25 = need(25)
    if m25 is None:
        out.append(("github_dispatch", "differs: module [25] not in the run"))
    elif not all(relay.get(k) for k in ("DISPATCH_OWNER", "DISPATCH_REPO", "DISPATCH_NAME_KEY", "DISPATCH_ID_KEY")):
        out.append(("github_dispatch", "differs: the relay's dispatch settings are not filled (~/.forms-relay/config.env)"))
    else:
        raw = m25.get("jsonStringBodyContent") or m25.get("data") or m25.get("body") or "{}"
        try:
            made = json.loads(raw) if isinstance(raw, str) else raw
        except ValueError:
            made = {}
        made = made if isinstance(made, dict) else {}
        sent = made.get("client_payload") if isinstance(made.get("client_payload"), dict) else {}
        payload = p("github_dispatch").get("payload") or {}
        name_key, id_key = relay["DISPATCH_NAME_KEY"], relay["DISPATCH_ID_KEY"]
        what = []
        if str(m25.get("url") or "") != f"https://api.github.com/repos/{relay['DISPATCH_OWNER']}/{relay['DISPATCH_REPO']}/dispatches":
            what.append("repository")
        if made.get("event_type") != (relay.get("DISPATCH_EVENT") or "market_intel"):
            what.append("event")
        if set(sent) != {name_key, id_key}:
            what.append("payload keys")
        else:
            if str(sent[name_key]) != str(payload.get("client") or ""):
                what.append("client name")
            if str(sent[id_key]) != str(payload.get("taskId") or ""):
                what.append("card id")
        what += dispatch_extras(payload if isinstance(payload, dict) else {})
        out.append(("github_dispatch", f"differs: {', '.join(what)}" if what else "equal"))
    m29 = need(29)
    if m29 is None:
        out.append(("profile_fields", "differs: module [29] not in the run"))
    else:
        made = custom_fields(m29)
        fields = p("profile_fields").get("fields") or []
        profile = next((f.get("value") for f in fields if f["fieldId"] == FIELD["profile"]), None)
        same = text_verdict(made.get(FIELD["profile"]), profile, FIELD["profile"][:8])
        # Make 13 [29] writes the Client Profile and the kickoff link only; any other field here is not Make's.
        other = sorted({short_id(f.get("fieldId")) for f in fields if f.get("fieldId") not in made})
        what = [same[len("differs: "):]] if same != "equal" else []
        what += [f"Make 13 [29] writes no {', '.join(other)}"] if other else []
        out.append(("profile_fields", f"differs: {'; '.join(what)}" if what else equal_plus("kickoff_link")))
    m47 = need(47)
    out.append(("raw_answers_comment", "differs: module [47] not in the run" if m47 is None
                else delivered("raw_answers_comment", text_verdict(text_of(m47, "comment_text", "commentText", "comment"),
                                                                   p("raw_answers_comment").get("comment_text")))))
    kind31 = str(mods.get(31, {}).get("module") or "")
    if "client_data_row" in fx:
        m31 = need(31)
        if SEARCH.search(kind31):
            out.append(("client_data_row", "differs: Make 13 [31] only searches Client Data, so Make writes no row"))
        elif m31 is None:
            out.append(("client_data_row", "differs: module [31] not in the run"))
        else:
            values = m31.get("values") if isinstance(m31.get("values"), dict) else {}
            made = {}
            for k, v in values.items():
                letter = k if re.match(r"^[A-Z]{1,2}$", str(k)) else (chr(65 + int(k)) if str(k).isdigit() and int(k) < 26 else str(k))
                made[letter] = "" if v is None else str(v)
            want = relay_row(relay, p("client_data_row").get("payload") or {})
            diff = sorted({k for k in set(made) | set(want) if made.get(k, "") != want.get(k, "")})
            out.append(("client_data_row", f"differs: columns {', '.join(diff)}" if diff else "equal"))
    elif kind31 and not SEARCH.search(kind31):
        out.append(("client_data_row", "differs: Make 13 [31] writes a Client Data row the cockpit does not plan"))
    m49 = need(49)
    want_map = p("map_phase3").get("value")
    url = custom_fields(m49).get(FIELD["map"]) if m49 else None
    out.append(("map_phase3", "differs: module [49] not in the run" if m49 is None
                else "differs: the phase 3 map link is not set up" if not want_map
                else "equal" if str(url or "").strip() == want_map else "differs: value"))
    out.append(("phase3_whatsapp", phase_verdict("phase3", need(48), fx.get("phase3_whatsapp"), ctx)))
    m46 = need(46)
    targets = ctx.get("targets", {}).get("brand_dna") or []
    if m46 is None:
        out.append(("brand_dna_task", "differs: module [46] not in the run"))
    elif not targets:
        out.append(("brand_dna_task", "differs: the brand_dna request type is not set up"))
    else:
        t = targets[0]
        assignees = m46.get("assignees") if isinstance(m46.get("assignees"), list) else []
        what = [name for name, made, want in (
            ("list", m46.get("list_id"), t.get("list_id")),
            ("template", m46.get("template_id"), t.get("template_id")),
            ("assignee", assignees[0] if assignees else None, t.get("owner_clickup_id")))
            if str(made or "") != str(want or "")]
        slot, brief = details_slot("brand_dna_task", p("brand_dna_task"), ctx)
        what += [x for x in [slot] if x]
        out.append(("brand_dna_task", f"differs: {', '.join(what)}" if what
                    else equal_plus("task_name", "dedupe", "request_route", brief)))
    out.append(("read_model", only_intended("read_model")))
    if "card_facts" in fx:
        out.append(("card_facts", card_facts_verdict(fx["card_facts"], custom_fields(m29 or {}), ctx)))
    return out


def plan_lines(form: str, out: dict, mods: dict, ctx: dict) -> list:
    """Every (effect, verdict) of one run: the comparison of the cockpit's parity plan (out) with Make's modules, and
    the answers the cockpit maps no option for. The fidelity line is the caller's."""
    lines = compare_kickoff(out["effects"], mods, ctx) if form == "kickoff" else compare_onboarding(out["effects"], mods, ctx)
    # An effect the planner plans that is neither Make's nor registered is an addition no INTENDED entry names.
    for key in sorted({str(e.get("key")) for e in out["effects"] if isinstance(e, dict)} - KNOWN_EFFECTS[form]):
        lines.append((key if NAME.match(key) else "effect", "differs: an addition no INTENDED entry registers"))
    # Full refs: the kickoff's own questions all start c0000001, so a cut ref cannot say which map to fix. An answer
    # Make prints that the cockpit cannot map also loses its line in the cockpit's texts: KFRCXPFx's fifth Meta choice
    # ("My Account is restricted", ddf2767d) was one until 20261103b (finding F3).
    unmapped = sorted({str(u) for u in out.get("unmapped") or []})
    if unmapped:
        lines.append(("answers", f"differs: the cockpit maps no option for {', '.join(unmapped)}"))
    return lines


def summary(form: str, runs: int, failures: int, missing: set, unread: int = 0) -> tuple:
    """The last line and the exit code: PASS, FAIL or NOT PROVEN. unread: the runs whose card_facts was graded on its
    plan alone, with no writer receipt to read (none is written before the go-live), said so rather than counted as
    proven."""
    plural = lambda k, word: f"{k} {word}{'' if k == 1 else 's'}"  # noqa: E731
    gap = (f"; stage4.messages has no {' or '.join(p.replace('phase', 'phase ') for p in sorted(missing))} text, "
           f"so it was not compared") if missing else ""
    if unread:
        gap += f"; card_facts' writer receipt not read on {plural(unread, 'run')}, so only its plan was graded"
    verdict = "PASS" if not failures and not missing else "FAIL" if failures else "NOT PROVEN"
    return f"{verdict}: {plural(runs, 'run')} of {SCENARIOS[form][0]}, {plural(failures, 'difference')}{gap}.", 0 if verdict == "PASS" else 1


def comment_labels(form: str, make12: dict, definition: dict) -> dict:
    """The fixed words a comment line can be named by when the fidelity check finds it different: the handoff's
    labels from Make 12 [11]'s text, or each question's ref for its title in the raw answers comment. Never a value."""
    if form == "kickoff":
        mod = next((m for m in flat_modules(make12.get("flow")) if m.get("id") == 11), {})
        prefixes = {}
        for line in str((mod.get("mapper") or {}).get("comment_text") or "").splitlines():
            head = unmarked(line.split("{{", 1)[0])
            if head and not RULE.fullmatch(line):
                prefixes[head] = head.rstrip(":").strip()
        return {"prefix": prefixes, "exact": {}}
    return {"prefix": {}, "exact": {unmarked(f.get("title")): str(f.get("ref")) for f in question_fields(definition)}}


def line_name(lines: list, i: int, labels: dict) -> str:
    for k in range(min(i, len(lines) - 1), -1, -1):
        line = lines[k]
        name = labels["exact"].get(line) or next((n for pre, n in labels["prefix"].items() if line.startswith(pre)), None)
        if name:
            return name if k == i else f"the answer under {name}"
    return "an unnamed line"


def fidelity(made: Optional[str], held: list, form: str, labels: dict, since_ms: int) -> str:
    """The evaluated comment against the comments ClickUp holds on the card: equal when one matches."""
    _, prefix, what = FIDELITY[form]
    if made is None:
        return f"differs: the evaluated {what} comment is empty"
    cands = [c for c in held if isinstance(c, dict) and unmarked(c.get("comment_text")).startswith(prefix)]
    if any(same_text(made, c.get("comment_text")) for c in cands):
        return "equal"
    if not cands:
        return f"differs: no {what} comment on the card"
    date = lambda c: int(str(c.get("date"))) if str(c.get("date") or "").isdigit() else 0  # noqa: E731
    near = min(cands, key=lambda c: abs(date(c) - since_ms))
    a = [unmarked(x) for x in str(made).splitlines() if unmarked(x)]
    b = [unmarked(x) for x in str(near.get("comment_text") or "").splitlines() if unmarked(x)]
    i = next((k for k in range(max(len(a), len(b))) if k >= len(a) or k >= len(b) or a[k] != b[k]), max(len(a), len(b)) - 1)
    return f"differs: line {i + 1} ({line_name(a, i, labels)}); {len(a)} lines evaluated, {len(b)} on the card"


# ---------------------------------------------------------------- the run

class Run:
    def __init__(self, env: dict):
        self.url = str(env.get("SUPABASE_URL") or "").rstrip("/")
        self.service = str(env.get("SUPABASE_SERVICE_ROLE_KEY") or "")
        self.clickup_key = str(env.get("CLICKUP_API_TOKEN") or env.get("CLICKUP_API_KEY") or "")
        if not self.url or not self.service:
            raise Stop("The native runtime file has no SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.")
        if not self.clickup_key:
            raise Stop("The native runtime file has no CLICKUP_API_TOKEN, so the card comments cannot be read.")
        self.run_key = f"make-parity:{uuid.uuid4()}"
        self.missed = 0

    def redact(self, text: Any) -> str:
        s = str(text)
        for v in (self.service, self.clickup_key):
            if v:
                s = s.replace(v, "[key]")
        return KEY_SHAPES.sub("[key]", s)

    def supabase(self, method: str, path: str, body: Any = None, prefer: Optional[str] = None) -> tuple[int, str]:
        headers = {"apikey": self.service, "Authorization": "Bearer " + self.service,
                   "Content-Type": "application/json", "Accept": "application/json"}
        if prefer:
            headers["Prefer"] = prefer
        return http(method, self.url + path, headers, body)

    def receipt(self, provider: str, resource: str, phase: str, status: Optional[int] = None) -> bool:
        row = {"provider": provider, "method": "GET", "resource": resource, "phase": phase, "http_status": status,
               "run_key": self.run_key, "action_id": None}
        try:
            code, _ = self.supabase("POST", "/rest/v1/cockpit_csm_provider_health", row, prefer="return=minimal")
        except NoAnswer:
            return False
        return 200 <= code < 300

    def clickup(self, path: str, resource: str) -> Any:
        if not self.receipt("clickup", resource, "intent"):
            raise Stop(f"The receipt for GET {resource} could not be saved, so the call was not made.")
        headers = {"Authorization": self.clickup_key, "Accept": "application/json"}
        try:
            status, text = http("GET", "https://api.clickup.com" + path, headers)
        except NoAnswer:
            if not self.receipt("clickup", resource, "unknown"):
                self.missed += 1
            raise Stop("ClickUp did not answer. Run this again.") from None
        if not self.receipt("clickup", resource, "response", status):
            self.missed += 1
        if status != 200:
            raise Stop(f"ClickUp refused the comment read: HTTP {status}.")
        try:
            return json.loads(text)
        except ValueError:
            raise Stop("ClickUp answered without JSON.") from None

    def comments(self, task: str, since_ms: int) -> list:
        """The card's comments, newest first, paged back to an hour before the answer (Make comments within minutes)."""
        out: list = []
        start: Optional[tuple] = None
        for _ in range(COMMENT_PAGES):
            query = "" if start is None else "?" + urllib.parse.urlencode({"start": start[0], "start_id": start[1]})
            page = self.clickup(f"/api/v2/task/{task}/comment{query}", "api.clickup.com/api/v2/task/:id/comment")
            items = [c for c in (page.get("comments") or [] if isinstance(page, dict) else []) if isinstance(c, dict)]
            out.extend(items)
            if len(items) < 25:
                break
            oldest = items[-1]
            date = str(oldest.get("date") or "")
            if not date.isdigit() or not oldest.get("id") or int(date) < since_ms - 3_600_000:
                break
            start = (date, oldest.get("id"))
        return out

    def rows(self, path: str, what: str) -> list:
        try:
            status, text = self.supabase("GET", path)
            rows = json.loads(text) if status == 200 else None
        except (NoAnswer, ValueError):
            rows = None
        if not isinstance(rows, list):
            raise Stop(f"{what} could not be read, so nothing is compared.")
        return rows

    def plan(self, form: str, inp: dict) -> dict:
        try:
            status, text = self.supabase("POST", "/rest/v1/rpc/cockpit_form_parity_plan", {"p_form_key": form, "p_input": inp})
            out = json.loads(text) if text else None
        except (NoAnswer, ValueError):
            status, out = 0, None
        if status != 200 or not isinstance(out, dict) or not isinstance(out.get("effects"), list):
            raise Stop(f"The cockpit's parity plan could not be read (HTTP {status}). Apply 20261102j first.")
        return out

    def card_facts_step(self, response_id: Any) -> Any:
        """The writer's card_facts step for one stored response, read only: the response's card_facts effect row
        (cockpit_form_effects) and its queue row's progress.steps.card_facts ({state, fields}). None when the response
        has no such row yet, or the writer has not reached the step."""
        rid = str(response_id or "")
        if not UUID.fullmatch(rid):
            return None
        rows = self.rows(f"/rest/v1/cockpit_form_effects?select=delivery_ref&response_id=eq.{rid}&effect_key=eq.{FACT_STEP}",
                         "The card_facts effect row")
        ref = next((str(r.get("delivery_ref")) for r in rows if isinstance(r, dict) and r.get("delivery_ref")), "")
        if not UUID.fullmatch(ref):
            return None
        rows = self.rows(f"/rest/v1/cockpit_clickup_writeback_queue?select=progress&id=eq.{ref}", "The card_facts writer row")
        progress = next((r.get("progress") for r in rows if isinstance(r, dict)), None)
        steps = progress.get("steps") if isinstance(progress, dict) else None
        return steps.get(FACT_STEP) if isinstance(steps, dict) else None

    def card_names(self, tasks: list) -> dict:
        ids = sorted({t for t in tasks if isinstance(t, str) and CARD_ID.match(t)})
        if not ids:
            return {}
        rows = self.rows(f"/rest/v1/cockpit_billing_accounts?select=clickup_task_id,client_name&clickup_task_id=in.({','.join(ids)})",
                         "The billing sheet's card names")
        return {r.get("clickup_task_id"): r.get("client_name") for r in rows if isinstance(r, dict)}


def context(run: Run) -> dict:
    """What the comparisons read from the cockpit: dropdown options, the request types' targets and fields (a brief
    needs a details field), the phase texts, the relay's settings."""
    options = {}
    for f in run.rows("/rest/v1/cockpit_clickup_fields?select=field_id,options", "The ClickUp field map"):
        if isinstance(f, dict) and isinstance(f.get("options"), list):
            options[str(f.get("field_id"))] = f["options"]
    targets, fields = {}, {}
    for t in run.rows("/rest/v1/cockpit_request_types?select=key,targets,fields&key=in.(client_onboarding,brand_dna)",
                      "The request types"):
        if isinstance(t, dict):
            targets[str(t.get("key"))] = t.get("targets") or []
            fields[str(t.get("key"))] = t.get("fields") if isinstance(t.get("fields"), list) else []
    messages = {}
    for s in run.rows("/rest/v1/cockpit_settings?select=key,value&key=eq.stage4.messages", "The phase texts"):
        if isinstance(s, dict) and isinstance(s.get("value"), dict):
            messages = s["value"]
    return {"options": options, "targets": targets, "fields": fields, "messages": messages, "relay": env_file(RELAY_CONFIG)}


def parity(run: Run, form: str, last: int, blueprint_dir: str, typeform_dir: str) -> int:
    saved = saved_set(blueprint_dir, typeform_dir)
    print(f"kickoff {line_of(saved['make12'], 24)}" if form == "kickoff" else f"onboarding {line_of(saved['make13'], 31)}")
    readmodel = run.rows("/rest/v1/cockpit_client_onboarding?select=clickup_task_id,client_name,"
                         "kickoff:forms->kickoff,onboarding:forms->onboarding", "The stored kickoff and onboarding answers")
    responses = run.rows("/rest/v1/cockpit_form_responses?select=id,form_key,task_id,client_name,external_id,submitted_at,"
                         "answers,hidden&form_key=in.(kickoff,onboarding)&mode=eq.live&state=not.in.(draft,void)",
                         "The stored form responses")
    runs = kickoff_runs(readmodel, responses, last) if form == "kickoff" else onboarding_runs(readmodel, responses, last)
    if not runs:
        raise Stop(f"The cockpit holds no stored {form} answer to compare.")
    ctx = context(run)
    names = run.card_names([r["task"] for r in runs])
    labels = comment_labels(form, saved["make12"], saved["onboarding"])
    failures, missing, verdicts, unread = 0, set(), [], 0
    for n, rec in enumerate(runs, start=1):
        head = f"{form} run {n}:"
        print(f"{head} from response {rec['responseId']}" if rec.get("responseId") else f"{head} from the read model")
        if not CARD_ID.match(str(rec["task"])):
            print(f"{head} card differs: the stored answer names no readable card")
            failures += 1
            continue
        since = ms_of(rec["submittedAt"])
        held = run.comments(rec["task"], since)
        # The kickoff's hidden values came from Make 13 [29]'s link or, since 2026-10-22, the cockpit's own link: the
        # one whose handoff ClickUp holds is the one the CSM opened; [29]'s when neither is.
        tries = []
        for source in (SOURCES if form == "kickoff" else (None,)):
            side = oracle(form, saved, rec, readmodel, responses, names, source)
            mods = side["mods"]
            made = text_of(mods[FIDELITY[form][0]]["input"], "comment_text") if FIDELITY[form][0] in mods else None
            tries.append((side, fidelity(made, held, form, labels, since)))
        side, proof = next((t for t in tries if t[1] == "equal"), tries[0])
        if side["source"] and SOURCES[side["source"]]:
            print(f"{head} hidden values from {SOURCES[side['source']]}, not Make 13 [29]'s")
        out = run.plan(form, side["input"])
        # card_facts is graded by the writer's own receipt as well, when this response has a card_facts row.
        facts = [e for e in out["effects"] if isinstance(e, dict) and e.get("key") == FACT_STEP]
        if facts:
            step = run.card_facts_step(rec.get("responseId"))
            for e in facts:
                e["receipt"] = step
        lines = plan_lines(form, out, side["mods"], ctx) + [("fidelity", proof)]
        for key, verdict in lines:
            print(f"{head} {key} {verdict}")
            verdicts.append(verdict)
            if verdict.startswith("differs"):
                failures += 1
            if verdict == "setting missing":
                missing.add(key.split("_")[0])
            if key == FACT_STEP and verdict.endswith("(receipt not read)"):
                unread += 1
    for line in legend(verdicts):
        print(line)
    text, code = summary(form, len(runs), failures, missing, unread)
    print(text)
    return code


def main(argv: Optional[list] = None) -> int:
    args = sys.argv[1:] if argv is None else list(argv)
    form = args[0] if args else ""
    rest = args[1:]
    opts = {"--last": None, "--blueprint-dir": BLUEPRINT_DIR, "--typeform-dir": TYPEFORM_DIR}
    ok = form in SCENARIOS and len(rest) % 2 == 0
    seen: set = set()
    for flag, value in zip(rest[::2], rest[1::2]):
        if flag not in opts or flag in seen or not value:
            ok = False
            break
        seen.add(flag)
        opts[flag] = value
    last = SCENARIOS.get(form, (0, 0, ""))[1]
    if ok and opts["--last"] is not None:
        ok = opts["--last"].isdigit() and 1 <= int(opts["--last"]) <= 50
        last = int(opts["--last"]) if ok else last
    if not ok:
        print(USAGE)
        return 2
    run = None
    try:
        run = Run(runtime_file())
        code = parity(run, form, last, opts["--blueprint-dir"], opts["--typeform-dir"])
    except Stop as e:
        print(run.redact(e) if run else KEY_SHAPES.sub("[key]", str(e)))
        code = 1
    except Unsupported as e:
        print(f"make parity stopped: the evaluator does not know {e}. Teach it before trusting a verdict.")
        code = 1
    except Exception as e:  # noqa: BLE001 - one plain line, never a traceback that could hold a value
        print(f"make parity stopped: {type(e).__name__}")
        code = 1
    if run and run.missed:
        print(f"{run.missed} receipt(s) after a ClickUp call could not be saved.")
        code = code or 1
    return code


if __name__ == "__main__":
    sys.exit(main())
