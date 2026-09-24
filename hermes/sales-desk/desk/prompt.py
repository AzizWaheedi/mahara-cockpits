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
        "currency": "SAR"|"USD"|"AED"|"KWD"|"QAR"|"BHD",
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
    5: ("solution", "program", "solution_close", "solution_targets", "proof"),
    6: ("investment", "roi", "guarantee"),
    7: ("start_steps", "terms", "acceptance"),
}

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


def load_reference(ref_dir: Path, variant: str, log: Callable[[str], None]) -> tuple[Optional[dict[str, Any]], Optional[dict[str, Any]]]:
    """(deal, where it came from). A file named for the variant wins, then any
    file of that variant, then whatever reference there is."""
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


def shape_of(deal: dict[str, Any]) -> dict[str, Any]:
    """The reference, with its identity fields turned into instructions.

    The drafter copies the shape it is shown, and it copies it exactly. On
    7 September a draft came back with "client_company": "FILL" for a call that
    had a company in it, because the reference carried that placeholder; blanking
    the field would teach an empty string just as faithfully, so each identity
    field is replaced by a sentence saying what belongs there (run_proposal.py).

    Three more things come out here. `quotes`, because the block no longer
    renders and the validator fails a deal that carries it. Embedded images,
    because a logo or photo as base64 is kilobytes the drafter would copy out
    character by character. And our own `offer` stamp, which is code's to write.
    """
    d = _no_embedded_files(copy.deepcopy(deal))
    d.pop("quotes", None)
    d.pop("offer", None)
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
    d["client_company"] = "<the company name as said on the call, never FILL>"
    d["client_contact"] = "<the person on the call>"
    if "client_role" in d:
        d["client_role"] = "<their role, or leave the key out if unsaid>"
    return d


def outline(resolved: dict[str, Any]) -> str:
    """Every key the template reads, for a drafter with no reference to copy."""
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
        "date": "the day it is written, e.g. 24 September 2026",
        "valid_until": "two weeks later, same format",
        "confidentiality": "one line",
        "kicker": "a few words", "headline": "the claim", "subhead": "two sentences",
        "cover_image": None,
        "gap_title": "...", "gap_close": "...",
        "gap_points": [{"v": "a figure from the call", "k": "what it is"}],
        "funnel": {"title": "...", "stages": [{"label": "Enquiries", "note": "...", "value": 0, "display": "0"}],
                   "note": "..."},
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
                "target_projects_month": "2 to 4"},
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
    if reference is not None and info and info.get("matched"):
        parts.append("# The exact shape to return, for the " + variant + " variant\n\n```json\n"
                     + json.dumps(shape_of(reference), ensure_ascii=False, indent=2) + "\n```")
    elif reference is not None and info:
        parts.append(
            f"# The shape to copy, from a {info['variant']} proposal\n\n"
            f"There is no {variant} reference on this machine, so the one below is a {info['variant']} "
            f"proposal. Copy its shape for every block the two share. Where they differ, follow the skill: "
            f"the {variant} variant {DIFFERS[variant]}.\n\n```json\n"
            + json.dumps(shape_of(reference), ensure_ascii=False, indent=2) + "\n```")
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


def draft_user(known: dict[str, Any], transcript_text: str, lang: str, variant: str, *, has_reference: bool) -> str:
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
        + ".\n\nThe call:\n\n" + transcript_text
        + "\n\nReturn only the deal JSON object."
    )


def tighten_user(deal: dict[str, Any], over: list[int]) -> str:
    """Ask for a shorter version of the pages that did not fit, named by sheet
    and by block rather than by character count, because the count was never
    the thing that decided it."""
    blocks = sorted({b for n in over for b in SHEET_BLOCKS.get(n, ())})
    one = len(over) == 1
    return (
        "This draft is correct and one thing is wrong with it: "
        + ("sheet " if one else "sheets ")
        + ", ".join(str(n) for n in over)
        + (" overflows" if one else " overflow")
        + " the page when rendered at A4.\n\n"
        "Return the same JSON object, unchanged except that the copy on "
        + ("that sheet" if one else "those sheets")
        + " is shorter. The blocks on "
        + ("it" if one else "them")
        + " are: " + ", ".join(blocks) + ".\n\n"
        "Shorten by removing whole sentences and whole clauses, not by "
        "abbreviating words or dropping articles. Cut the least load bearing "
        "sentence in each long field rather than shaving every field. Do not "
        "change any figure, any quote, any date or anything on a sheet that "
        "was not named. Do not add anything.\n\n"
        "Return only the JSON object.\n\n"
        + json.dumps(deal, ensure_ascii=False, indent=1)
    )


def is_triage(value: dict[str, Any]) -> bool:
    return "avg_project_value" in value or "net_margin" in value


DEAL_KEYS = ("reference", "client_company", "headline", "subhead", "investment", "solution", "roi",
             "tree", "program", "proof", "start_steps", "gap_title")


def is_deal(value: dict[str, Any]) -> bool:
    """Enough of a deal to be one, so a fragment of a reply cut short is never taken for the whole."""
    return sum(1 for k in DEAL_KEYS if k in value) >= 5
