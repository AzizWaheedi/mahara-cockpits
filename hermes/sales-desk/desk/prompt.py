"""What the model is told: the triage prompt, the drafter's instructions and
the reference deal it copies the shape of.

The instructions are SKILL.md and PATTERNS.md beside this package, read on
every draft, with the offer for that one proposal written into SKILL.md and
the pitch figures into PATTERNS.md, both from offer.json. The reference deal
is a real proposal, so it lives on the VPS in ~/.sales-desk/reference and
never in git; without one the drafter works from the rules and an outline of
the keys the template reads, and the proposal's validation notes say so.
"""
from __future__ import annotations

import copy
import json
import re
from datetime import date, timedelta
from pathlib import Path
from typing import Any, Callable, Optional

from . import offer as offer_mod
from .config import ROOT

SKILL_FILE = ROOT / "SKILL.md"
PATTERNS_FILE = ROOT / "PATTERNS.md"
LOGO = "assets/mahara-logo.png"
VARIANTS = ("specific", "general", "blind")

_TOKEN = re.compile(r"\{\{\s*([A-Za-z0-9_.]+)\s*\}\}")

TRIAGE_SYSTEM = """You read one closing call and answer two questions of fact.
You do not write a proposal and you do not decide anything. Return one JSON
object and nothing else: no commentary, no markdown fence.

    {
      "avg_project_value": {
        "stated": true|false,
        "value": <number, in the currency below>,
        "currency": "SAR"|"USD"|"AED"|"KWD"|"QAR"|"BHD"|"OMR"|"unstated",
        "quote": "<the words they said it in, verbatim from the transcript>"
      },
      "net_margin": {
        "stated": true|false,
        "value": <number, percent>,
        "is_net": true|false,
        "quote": "<verbatim>",
        "note": "<if not stated, or not net, say why in one line>"
      },
      "suggested_variant": "specific"|"general",
      "why": "<one sentence>"
    }

**avg_project_value** is what one of their projects is typically worth to them
in revenue. A range counts: report the bottom of it. A single unusual project
they mention in passing does not count.

**currency** is the one the client named for that figure: riyals, dirhams,
dollars, a currency sign. If they never named one, answer "unstated", even
when the country suggests one: never assume dollars because a figure is round
or large. The closer is asked instead.

**net_margin** is the one that gets misread, so read it carefully. Many
contractors quote an overhead or a markup: "we price at cost plus 20 percent",
"our overhead is 20 percent". That is gross, and it usually carries their
admin and general expenses as well as profit. It is NOT a net margin. Set
stated: true only when they gave a figure that is genuinely what is left after
everything, and set is_net accordingly. If they said a number and then said it
was gross, report stated: false, is_net: false, and explain in note.

Quote verbatim, in the language they spoke. The quote is how a human checks
you, so a paraphrase is worse than no answer.

If a figure is absent, say so plainly. Absent is a normal and useful answer:
it selects a different document, not a worse one."""

# Which blocks land on which sheet, mirroring renderDoc's order. Used only to
# tell the drafter which fields to shorten when a page overflows, so an
# approximate mapping is fine; naming one block too many costs nothing.
SHEET_BLOCKS = {
    1: ("headline", "subhead", "kicker"),
    2: ("quotes", "gap_points", "funnel", "gap_title", "gap_close"),
    3: ("tree", "tree_intro", "tree_close", "tree_title"),
    4: ("arithmetic", "cost"),
    5: ("solution", "program", "solution_close", "solution_targets"),
    # The proof is printed above the price unless proof_on says "solution".
    6: ("investment", "roi", "guarantee", "proof"),
    7: ("start_steps", "terms", "acceptance"),
}


def sheet_plan(deal: dict[str, Any]) -> list[tuple[str, ...]]:
    """The blocks on each sheet this deal draws, in renderDoc's order and on
    its conditions (validate.expected_sheets counts the same sheets)."""
    from . import validate as validate_mod
    proof_on = "solution" if deal.get("proof_on") == "solution" else "investment"
    proof = ("proof",) if deal.get("proof") else ()
    arith = deal.get("arithmetic") if isinstance(deal.get("arithmetic"), dict) else {}
    arith_page = validate_mod.expected_sheets({"arithmetic": {**arith, "inline": False}}) > 1
    plan: list[tuple[str, ...]] = [SHEET_BLOCKS[1]]
    if (deal.get("funnel") or deal.get("gap_points") or deal.get("quotes")
            or deal.get("pattern") or deal.get("pattern_groups")):
        plan.append(("gap_points", "funnel", "gap_title", "gap_intro", "gap_close", "pattern", "pattern_groups",
                     "pattern_note"))
    if (deal.get("tree") or {}).get("branches"):
        plan.append(SHEET_BLOCKS[3])
    if (deal.get("cost") or {}).get("layers"):
        plan.append(("cost",))
    if arith_page and not arith.get("inline"):
        plan.append(("arithmetic",))
    if deal.get("problems"):
        plan.append(("problems", "problems_title", "problems_intro", "problems_close"))
    if deal.get("solution"):
        plan.append(SHEET_BLOCKS[5] + ("solution_title",) + (proof if proof_on == "solution" else ()))
    if deal.get("investment"):
        plan.append(("investment", "investment_title", "investment_close", "roi")
                    + (proof if proof_on == "investment" else ())
                    + (("arithmetic",) if arith_page and arith.get("inline") else ())
                    + (("cta",) if deal.get("cta") else ()))
    if deal.get("start_steps"):
        plan.append(("start_steps", "start_title", "start_note", "terms", "deposit_label", "deposit_amount"))
    return plan


def blocks_on(deal: dict[str, Any], n: int) -> tuple[str, ...]:
    """The blocks on sheet n of this deal; SHEET_BLOCKS, with the proof where
    proof_on puts it, for a sheet the deal's own plan does not reach."""
    plan = sheet_plan(deal)
    if 1 <= n <= len(plan):
        return plan[n - 1]
    blocks = tuple(b for b in SHEET_BLOCKS.get(n, ()) if b != "proof")
    proof_sheet = 5 if deal.get("proof_on") == "solution" else 6
    return blocks + (("proof",) if n == proof_sheet else ())

# What each variant has to carry and may not, for when the reference on the
# machine is of another variant or there is none (SKILL.md, Output).
DIFFERS = {
    "specific": "it carries `cost` (the three layers) and not `arithmetic`, `gap_points` and `funnel` both, "
                "and `roi.avg_project_value` and `roi.margin_pct` from the call; it has no `variant` key",
    "general": "it carries `arithmetic` and not `cost`, `gap_points` or a `funnel` on the first page, "
               "`roi.margin_pct` of 0, and `\"variant\": \"general\"`",
    "blind": "it carries `pattern`, `pattern_note`, `arithmetic` and a `cta`, never `gap_points`, `funnel` or "
             "`cost`, `roi.avg_project_value` and `roi.margin_pct` of 0, `\"sign\": false`, and "
             "`\"variant\": \"blind\"`",
}


def render(text: str, values: dict[str, str]) -> str:
    """Fill {{tokens}}. A token with no value is an error, never a blank."""
    missing = sorted({m.group(1) for m in _TOKEN.finditer(text) if m.group(1) not in values})
    if missing:
        raise ValueError("no value for " + ", ".join(missing))
    return _TOKEN.sub(lambda m: str(values[m.group(1)]), text)


def skill(resolved: dict[str, Any]) -> str:
    return render(SKILL_FILE.read_text(encoding="utf-8"), {"offer.block": offer_mod.prompt_block(resolved)})


def patterns(offer: dict[str, Any]) -> str:
    return render(PATTERNS_FILE.read_text(encoding="utf-8"), offer_mod.pitch_values(offer))


# ---- the reference deal -------------------------------------------------------

def variant_of(deal: dict[str, Any]) -> str:
    v = str(deal.get("variant") or "specific").strip().lower()
    return v if v in VARIANTS else "specific"


def is_grid(deal: dict[str, Any]) -> bool:
    """A general deal whose arithmetic page is the grid of illustrative project values."""
    arith = deal.get("arithmetic") if isinstance(deal.get("arithmetic"), dict) else {}
    return bool(arith.get("project_values")) and str(arith.get("mode") or "grid").lower() == "grid"


def load_reference(ref_dir: Path, variant: str, log: Callable[[str], None], *,
                   project_value: Optional[bool] = None) -> tuple[Optional[dict[str, Any]], Optional[dict[str, Any]]]:
    """(deal, where it came from). A file named for the variant wins, then any
    file of that variant, then whatever reference there is.

    A general draft for a call that gave no project value copies the grid:
    general-grid.json, else any general reference with a grid page. On
    5 October 2026 such a draft copied the margin-mode general.json and lost
    the grid page's summary sentence and its total label."""
    ref_dir = Path(ref_dir)
    if not ref_dir.is_dir():
        return None, None
    found: list[tuple[Path, dict[str, Any]]] = []
    for path in sorted(ref_dir.glob("*.json")):
        try:
            deal = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as e:
            log(f"reference {path.name} could not be read ({e}); skipped")
            continue
        if isinstance(deal, dict):
            found.append((path, deal))
    if not found:
        return None, None
    exact = [f for f in found if f[0].stem.lower() == variant] or [f for f in found if variant_of(f[1]) == variant]
    if variant == "general" and project_value is False:
        grid = ([f for f in found if f[0].stem.lower() == "general-grid"]
                or [f for f in found if variant_of(f[1]) == "general" and is_grid(f[1])])
        exact = grid or exact
    path, deal = (exact or found)[0]
    return deal, {"file": path.name, "variant": variant_of(deal), "matched": bool(exact)}


def _no_embedded_files(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: _no_embedded_files(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_no_embedded_files(v) for v in value]
    if isinstance(value, str) and value.startswith("data:"):
        return None
    return value


def day_words(day: date) -> str:
    """A date the way the template prints one: 4 October 2026."""
    return f"{day.day} {day:%B %Y}"


GROSS_MARGIN_SHAPE = ("<the client's gross margin in percent, as a number, the bottom of their range, only when "
                      "this call gave one; otherwise leave the key out>")
# general-grid.json (the old 180279552) has no gap_points, and a draft that
# copied it drew the gap page as the funnel alone, about 430 px blank
# (175832813 on 5 October 2026). The tiles are the call's own figures.
GAP_POINTS_SHAPE = [
    {"v": "<a figure the client said plainly on this call>", "k": "<what it is, in a few words>"},
    {"v": "<another; two or three tiles in all, or leave gap_points out when the call gave no figures>",
     "k": "<what it is>"},
]

# Paid in full there is no first payment; the references' deposit_label says
# "comes off the first payment", and the drafter copies it (5 October 2026).
DEPOSIT_IN_FULL_SHAPE = ("<the deposit reserves the start date and comes off the payment at the start, in the "
                         "document's language>")
PROJECT_LABEL_SHAPE = ("<what the project value is when it is not an average, such as Your minimum ticket; otherwise "
                       "leave the key out>")


def shape_of(deal: dict[str, Any], today: Optional[date] = None) -> dict[str, Any]:
    """The reference, with its identity fields turned into instructions.

    The drafter copies the shape it is shown, and it copies it exactly. On
    7 September a draft came back with "client_company": "FILL" for a call that
    had a company in it, because the reference carried that placeholder; blanking
    the field would teach an empty string just as faithfully, so each identity
    field is replaced by a sentence saying what belongs there (run_proposal.py).

    The dates go the same way, with today's in them. The drafter is told the
    date nowhere else, so it kept the reference's: the proposal drafted on
    24 September was valid until the reference's 30 September, and from
    1 October every draft would have failed the send gate on a date it could
    not have known was wrong. So a reference is judged as of the day it was
    written (references.py), and does not go bad on a calendar.

    Three more things come out here. `quotes`, because the block no longer
    renders and the validator fails a deal that carries it. Embedded images,
    because a logo or photo as base64 is kilobytes the drafter would copy out
    character by character. And our own `offer` stamp, which is code's to write.
    """
    today = today or date.today()
    d = _no_embedded_files(copy.deepcopy(deal))
    d["date"] = f"<today, {day_words(today)}, in the document's language>"
    d["valid_until"] = f"<two weeks later, {day_words(today + timedelta(days=14))}, in the same format>"
    d.pop("quotes", None)
    d.pop("offer", None)
    d.pop("closer_figures", None)
    if "logo" in d:
        d["logo"] = LOGO
    # A general or blind proposal never carries a margin, and a blind one no
    # project value either; a reference that does would teach the one figure
    # the validator fails.
    roi = d.get("roi")
    if isinstance(roi, dict) and variant_of(d) in ("general", "blind"):
        roi["margin_pct"] = 0
        if variant_of(d) == "blind":
            roi["avg_project_value"] = 0
    # The reference client's own gross margin, and what its project value was,
    # are that client's: copied as they stand they would count another
    # client's projects at a margin nobody on this call gave (5 October 2026
    # review, general.json's 20).
    arith = d.get("arithmetic")
    if isinstance(arith, dict):
        if "gross_margin" in arith:
            arith["gross_margin"] = GROSS_MARGIN_SHAPE
        if "project_label" in arith:
            arith["project_label"] = PROJECT_LABEL_SHAPE
    if variant_of(d) == "general" and "gap_points" not in d:
        d = _with_after(d, "gap_title", "gap_points", copy.deepcopy(GAP_POINTS_SHAPE))
    d["client_company"] = "<the company name as said on the call, never FILL>"
    d["client_contact"] = "<the person on the call>"
    if "client_role" in d:
        d["client_role"] = "<their role, or leave the key out if unsaid>"
    return d


def _with_after(d: dict[str, Any], after: str, key: str, value: Any) -> dict[str, Any]:
    """The dict with key put right after another, or at the end when that one is missing."""
    if after not in d:
        return {**d, key: value}
    out: dict[str, Any] = {}
    for k, v in d.items():
        out[k] = v
        if k == after:
            out[key] = value
    return out


def outline(resolved: dict[str, Any], today: Optional[date] = None) -> str:
    """Every key the template reads, for a drafter with no reference to copy."""
    today = today or date.today()
    shape = {
        "lang": "en, or ar for an Arabic proposal",
        "reference": "a reference code such as MM-2026-0924-ABC",
        "doc_type": "Proposal",
        "logo": LOGO,
        "client_company": "<the company name as said on the call, never FILL>",
        "client_contact": "<the person on the call>",
        "client_role": "<their role, or leave the key out if unsaid>",
        "city": "City, country",
        "prepared_by": "the closer",
        "prepared_by_role": "their role",
        "date": f"today, {day_words(today)}, in the document's language",
        "valid_until": f"two weeks later, {day_words(today + timedelta(days=14))}, in the same format",
        "confidentiality": "one line",
        "kicker": "a few words", "headline": "the claim", "subhead": "two sentences",
        "cover_image": None,
        "gap_title": "...", "gap_close": "...",
        "gap_points": [{"v": "a figure from the call", "k": "what it is"}],
        "funnel": {"title": "...", "stages": [{"label": "Enquiries", "note": "...", "value": 0, "display": "0"}],
                   "note": "...",
                   "pool": "only on a stage that counts other people than the stage above it (another period "
                           "or source), so no loss is drawn into it; leave the key out otherwise"},
        "pattern": [{"title": "...", "body": "..."}], "pattern_note": "...",
        "tree_title": "...", "tree_intro": "...", "tree_close": "...",
        "tree": {"goal_label": "...", "goal": "...", "goal_note": "...",
                 "branches": [{"title": "...", "note": "...", "subs": [{"title": "...", "note": "..."}]}],
                 "note": "..."},
        "cost": {"title": "...", "intro": "...", "local_currency": "SAR",
                 "layers": [{"name": "...", "note": "...", "monthly": 0, "instead": "Not counted"}],
                 "total_label": "...", "note": "...", "verdict_label": "...", "verdict": "...", "close": "..."},
        "arithmetic": {"currency": "SAR", "months": resolved["months"], "project_values": [], "margins": [10, 20],
                       "mode": "margin, volume or threshold, or leave the key out for the grid",
                       "gross_margin": "the client's gross margin in percent, the bottom of their range, only when "
                                       "the call gave one; the projects are counted at it and labelled gross",
                       "project_label": "what the project value is when it is not an average, such as Your "
                                        "minimum ticket; leave the key out otherwise",
                       "title": "...", "intro": "...", "table_title": "...", "note": "...",
                       "total_label": "...", "verdict_label": "...", "verdict": "...", "close": "..."},
        "solution_title": "...", "solution_close": "...",
        "program": [{"title": "...", "note": "..."}],
        "solution": [{"problem": "...", "detail": "...", "fix": "..."}],
        "solution_targets": [{"v": "...", "k": "..."}],
        "proof": [{"v": "...", "k": "...", "src": "..."}],
        "investment_title": "...", "investment_close": "...",
        "investment": {"rows": [{"item": "...", "detail": "...", "amount": "..."}],
                       "total_label": "...", "total_amount": offer_mod.money(resolved["instalments"][0]["amount"]),
                       "note": "..."},
        "terms": ["one line each"],
        "roi": {"local_currency": "SAR", "usd_rate": 3.75, "months": resolved["months"],
                "fee_usd": resolved["price"], "ad_monthly_usd": resolved["ads_max"],
                "avg_project_value": 0, "margin_pct": 0, "project_note": "...", "margin_note": "...",
                "target_projects_month": "the plan's target in the plan's words, with its period (2 to 4 a "
                                         "month, or 1 to 3 over three months); a target, never a promise"},
        "start_title": "...", "deposit_label": "...", "deposit_amount": offer_mod.money(resolved["deposit"]),
        "start_steps": [{"when": "...", "title": "...", "body": "..."}],
        "start_note": "...",
        "cta": {"title": "...", "body": "...", "action": "..."},
        "company_line": "Mahara Media",
        "company_contact": "hello@maharamedia.com",
    }
    return json.dumps(shape, ensure_ascii=False, indent=2)


def system_for(variant: str, resolved: dict[str, Any], offer: dict[str, Any],
               reference: Optional[dict[str, Any]], info: Optional[dict[str, Any]]) -> str:
    """The drafter sees one reference, the one it is about to be judged against."""
    parts = [skill(resolved), "# The patterns behind the template\n\n" + patterns(offer)]
    shape = shape_of(reference) if reference is not None else None
    if shape is not None and "deposit_label" in shape and len(resolved.get("instalments") or []) == 1:
        shape["deposit_label"] = DEPOSIT_IN_FULL_SHAPE
    if reference is not None and info and info.get("matched"):
        parts.append("# The exact shape to return, for the " + variant + " variant\n\n```json\n"
                     + json.dumps(shape, ensure_ascii=False, indent=2) + "\n```")
    elif reference is not None and info:
        parts.append(
            f"# The shape to copy, from a {info['variant']} proposal\n\n"
            f"There is no {variant} reference on this machine, so the one below is a {info['variant']} "
            f"proposal. Copy its shape for every block the two share. Where they differ, follow the skill: "
            f"the {variant} variant {DIFFERS[variant]}.\n\n```json\n"
            + json.dumps(shape, ensure_ascii=False, indent=2) + "\n```")
    else:
        parts.append(
            f"# There is no reference deal on this machine\n\nWrite the {variant} variant from the rules above: "
            f"{DIFFERS[variant]}. Below is every key the template reads, with the shape of each. The values "
            "are descriptions of what goes there, never text to copy; leave out any block your variant does "
            "not carry.\n\n```json\n" + outline(resolved) + "\n```")
    return "\n\n".join(parts)


# ---- the messages -----------------------------------------------------------

def triage_user(transcript_text: str) -> str:
    return "The call:\n\n" + transcript_text


# The triage found a project value and no currency for it (5 October 2026: a
# floor of "1M" was printed as dollars; B2B's own triage read it as dirhams).
UNSTATED_CURRENCY = ("The client never named a currency for their figures. Write FILL in arithmetic.currency so "
                     "the closer is asked, and write the client's own figures without a currency anywhere else. "
                     "Do not write that no currency was named: the closer settles it before the page is sent, "
                     "and the page then prints it.")


def currency_unstated(found: Optional[dict[str, Any]]) -> bool:
    """A project value was given, in no currency the client named."""
    value = (found or {}).get("avg_project_value") or {}
    if not (value.get("stated") and value.get("value")):
        return False
    return str(value.get("currency") or "").strip().lower() in ("", "unstated", "unknown", "none", "fill")


def draft_user(known: dict[str, Any], transcript_text: str, lang: str, variant: str, *, has_reference: bool,
               facts: Optional[list[str]] = None) -> str:
    where = ("The exact shape to return is the reference at the end of your instructions."
             if has_reference else
             "There is no reference on this machine: the keys to use are outlined at the end of your instructions.")
    return (
        "Write the " + variant + " variant of the proposal. " + where + "\n\n"
        "Known from the CRM (may be incomplete: anything null must come from the "
        "call or be marked FILL):\n"
        + json.dumps(known, ensure_ascii=False, indent=1)
        + "\n\nWrite the proposal in "
        + ("Arabic, with lang set to ar" if lang == "ar" else "English")
        + ".\n\nA figure the client said only in passing, or in a stretch of the call that is garbled or "
        "unclear, is FILL or left out, never a headline: the headline, the gap and the tree carry only figures "
        "said plainly. Write each count the same way wherever it appears."
        + "".join("\n\n" + f for f in (facts or []))
        + "\n\nThe call:\n\n" + transcript_text
        + "\n\nReturn only the deal JSON object."
    )


# How hard each tightening round cuts. A first round that trims a sentence
# here and there often leaves the sheet a line too long, so later rounds ask
# for a set share of the named sheet's words to go.
_CUT = {
    1: "",
    2: "The last shorter version still did not fit. Cut about a third of the words on "
       "the named sheet this time. ",
    3: "Two shorter versions still did not fit. Cut about half of the words on the named "
       "sheet, keeping only the sentences the argument needs, and drop whole list items "
       "that repeat a point made elsewhere. ",
}


# Under this many pixels a sheet is two or three lines long (5 October 2026: a
# sheet 8 px over lost two of its five solution steps and a target tile to the
# rounds that cut a third, then half).
SMALL_OVERFLOW_PX = 40

_SMALL = ("That is two or three lines. Cut two or three lines from the copy on {it} and nothing more: keep "
          "every list item (every step, target, proof, row and branch) and shorten a sentence inside one "
          "instead of removing it. ")


def small_overflow(over: list[int], px: Optional[dict[int, int]]) -> bool:
    """Every overflowing sheet measured, and each a few lines over."""
    px = {int(k): int(v) for k, v in (px or {}).items() if int(k) in over}
    return bool(over) and len(px) == len(over) and max(px.values()) < SMALL_OVERFLOW_PX


def tighten_user(deal: dict[str, Any], over: list[int], round_no: int = 1,
                 px: Optional[dict[int, int]] = None) -> str:
    """Ask for a shorter version of the pages that did not fit, named by sheet
    and by block, and by how many pixels each one is over when the browser
    measured it. A sheet a few lines over is asked for a few lines, whatever
    the round; only a long overflow is asked, round by round, for more."""
    blocks = sorted({b for n in over for b in blocks_on(deal, n)})
    one = len(over) == 1
    px = {int(k): int(v) for k, v in (px or {}).items() if int(k) in over}
    small = small_overflow(over, px)
    harder = (_SMALL.format(it="that sheet" if one else "each of them") if small
              else _CUT.get(max(1, min(3, round_no)), ""))
    by = ""
    if px:
        by = " (" + ", ".join(f"sheet {n} by {px[n]} px" for n in over if n in px) + ")"
    return (
        "This draft is correct and one thing is wrong with it: "
        + ("sheet " if one else "sheets ")
        + ", ".join(str(n) for n in over)
        + (" overflows" if one else " overflow")
        + " the page when rendered at A4" + by + ".\n\n"
        "Return the same JSON object, unchanged except that the copy on "
        + ("that sheet" if one else "those sheets")
        + " is shorter. The blocks on "
        + ("it" if one else "them")
        + " are: " + ", ".join(blocks) + ".\n\n"
        + harder
        + "Shorten by removing whole sentences and whole clauses, not by "
        "abbreviating words or dropping articles. Cut the least load bearing "
        "sentence in each long field rather than shaving every field. Do not "
        "change any figure, any quote, any date or anything on a sheet that "
        "was not named. Do not add anything.\n\n"
        "Return only the JSON object.\n\n"
        + json.dumps(deal, ensure_ascii=False, indent=1)
    )


def repair_user(deal: dict[str, Any], problems: list[str]) -> str:
    """Hand the checker's findings back, word for word, and ask for exactly
    those to be fixed. The checker names the field; the drafter fixes it."""
    listed = "\n".join(f"- {p}" for p in problems)
    # A proof figure is ours, from the record: FILL would hand the closer a
    # blank to type the case from memory, which is how it went wrong.
    proof = ("A proof figure is copied exactly from PATTERNS.md's \"Numbers quoted as proof\", never FILL; "
             "drop the case if the record does not have it. " if any(p.startswith("proof") for p in problems) else "")
    # The arithmetic page's words state the table's own figures, which are
    # never a gap for the closer (5 October 2026 judge).
    verdict = ("The arithmetic page's words use the figures its table prints (the whole engagement, the share "
               "of one project, the count at the gross margin), never FILL. "
               if any(p.startswith("verdict") for p in problems) else "")
    # The repair has the draft and not the call: the rate the client signs at
    # today is in the draft's own gap tiles, funnel or tree, or it is the
    # closer's to give (176954619, 5 October 2026).
    rate = ("arithmetic.rate_display is the rate the client signs at today, never the target: take it from what "
            "this draft already says the client signs (a gap tile, the funnel, the tree), or write FILL. "
            if any(p.startswith("rate") for p in problems) else "")
    # An absolute outcome ("so small jobs never arrive") keeps its line and
    # loses its certainty (180273419, 5 October 2026).
    certain = ("An outcome stated as certain is reworded, not removed: \"fewer small jobs arrive\", \"filtered out "
               "before they reach you\", keeping the rest of the line. "
               if any(p.startswith("guarantee") and "as certain" in p for p in problems) else "")
    return (
        "The checker found these problems in this draft:\n\n"
        + listed
        + "\n\nReturn the same JSON object with each problem fixed and nothing else changed. "
        "Remove a promise rather than rewording it. Where a figure was never said on the "
        "call, write FILL in its place. " + proof + verdict + rate + certain
        + "Keep every other field exactly as it is, and add nothing new.\n\nReturn only the JSON object.\n\n"
        + json.dumps(deal, ensure_ascii=False, indent=1)
    )


def is_triage(value: dict[str, Any]) -> bool:
    return "avg_project_value" in value or "net_margin" in value


DEAL_KEYS = ("reference", "client_company", "headline", "subhead", "investment", "solution", "roi",
             "tree", "program", "proof", "start_steps", "gap_title")


def is_deal(value: dict[str, Any]) -> bool:
    """Enough of a deal to be one, so a fragment of a reply cut short is never taken for the whole."""
    return sum(1 for k in DEAL_KEYS if k in value) >= 5
