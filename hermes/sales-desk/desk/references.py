"""The reference deals, checked against today's rules.

The drafter copies the reference it is shown, faults included (prompt.shape_of).
On 4 October 2026 the VPS's general.json, a proposal written on 5 September,
failed the validator of the day: it promised results and free work
(investment_close, terms[2]), printed a split under paid in full
(investment.rows[1], terms[3]) and called its meetings target guaranteed
(solution_targets[0]). The rules had moved with offer.json on 2 and 3 October
and the reference had not, so every draft started from those faults and spent
its one repair round on them.

So every reference goes through the validator the way a draft does, against
offer.json as it stands and the closer's default choice, under the send gate.
Two things are not held against it. Its figures were checked against its own
call when it was written, and that call is not here, so there is no evidence
to ask for. And its dates are its own: shape_of hands the drafter today's
date instead, so a reference is judged as of the day it was written.

doctor shows the verdict on its "reference deals" line, and
tests/test_references.py fails when a reference on the machine breaks a rule.

Online, doctor renders each reference too, the way `validate --send` does. On
5 October 2026 B2B's margin-mode draft 180273419, its offer lines corrected,
passed every rule and still overflowed a sheet under today's template: a
reference whose copy no longer fits teaches every draft lengths that spend the
tightening rounds. Offline, and in the tests, nothing is rendered, and the
line says so.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import date, datetime
from pathlib import Path
from typing import Any, Callable, Optional

from . import offer as offer_mod
from . import validate as validate_mod
from .prompt import VARIANTS, variant_of

# Builds a deal and returns the rendered page, or None when no browser could.
DomOf = Callable[[dict[str, Any]], Optional[str]]

# Warnings that still fail a reference: the rules that move when offer.json
# does. A draft may carry a warning for a closer to judge; a reference teaches
# what it carries to every draft after it.
STRICT = ("offer", "guarantee")


@dataclass
class Verdict:
    file: str
    variant: str
    problems: list[str] = field(default_factory=list)
    # Whether its pages were rendered and measured, or only its data checked.
    rendered: bool = False

    @property
    def ok(self) -> bool:
        return not self.problems

    @property
    def checks(self) -> list[str]:
        """The failing checks by name, once each: what a log line may carry."""
        out: list[str] = []
        for p in self.problems:
            name = p.split(":", 1)[0]
            if name not in out:
                out.append(name)
        return out


def written_on(deal: dict[str, Any]) -> Optional[date]:
    """The day the reference was written, in any form check_dates reads."""
    raw = validate_mod.arabic_date(str(deal.get("date") or "").strip())
    for fmt in ("%d %B %Y", "%d %b %Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(raw, fmt).date()
        except ValueError:
            continue
    return None


def problems_in(deal: dict[str, Any], offer: dict[str, Any], dom: Optional[str] = None) -> list[str]:
    """What breaks today's rules, as the validator words it. Empty when nothing
    does. With the rendered page, the sheet count and overflow count too."""
    result = validate_mod.validate(deal, None, resolved=offer_mod.resolve(offer, {}), offer=offer, dom=dom,
                                   engine="rendered" if dom else "not rendered", today=written_on(deal))
    return [f"{r['check']}: {r['detail']}" for r in result.rows
            if r["send"] == validate_mod.FAIL or (r["check"] in STRICT and r["status"] == validate_mod.WARN)]


def check(ref_dir: Path, offer: Optional[dict[str, Any]] = None, dom_of: Optional[DomOf] = None) -> list[Verdict]:
    """One verdict per *.json in the folder, the files load_reference reads.
    dom_of renders one; a page it cannot render is checked on its data alone."""
    ref_dir = Path(ref_dir)
    paths = sorted(ref_dir.glob("*.json")) if ref_dir.is_dir() else []
    if not paths:
        return []
    offer = offer or offer_mod.load()
    out = []
    for path in paths:
        try:
            deal = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as e:
            out.append(Verdict(path.name, "unreadable", [f"read: it cannot be read ({type(e).__name__})"]))
            continue
        if not isinstance(deal, dict):
            out.append(Verdict(path.name, "unreadable", ["read: it holds no deal object"]))
            continue
        dom = None
        if dom_of is not None:
            try:
                dom = dom_of(deal)
            except Exception:  # noqa: BLE001 - a browser that fails says nothing about the reference
                dom = None
        out.append(Verdict(path.name, variant_of(deal), problems_in(deal, offer, dom), rendered=bool(dom)))
    return out


def doctor_row(ref_dir: Path, offer: Optional[dict[str, Any]] = None,
               dom_of: Optional[DomOf] = None) -> tuple[Optional[bool], str]:
    """doctor's "reference deals" line: each file, its variant and its verdict,
    and which variants have none of their own. File and check names only: a
    reference is a real client's proposal, and doctor writes to the cron log."""
    verdicts = check(ref_dir, offer, dom_of)
    if not verdicts:
        return None, (f"none in {ref_dir}: the drafter works from the rules and the template's outline, and "
                      "every proposal's notes say so. extract_reference.py makes one from a finished proposal")
    bad = [v for v in verdicts if not v.ok]
    good = [v for v in verdicts if v.ok]
    parts = []
    if bad:
        parts.append("; ".join(f"{v.file} ({v.variant}) breaks today's rules: {', '.join(v.checks)}" for v in bad)
                     + ". Every draft copies its reference's shape, faults included: replace it with a corrected "
                       "copy (python3 desk.py validate FILE --send names each field)")
    if good:
        unmeasured = [v.file for v in good if not v.rendered]
        if not unmeasured:
            how = ", and fit A4 when rendered"
        elif dom_of is None:
            how = " (pages not rendered here: doctor without --offline renders them)"
        else:
            how = f" (the browser could not render {', '.join(unmeasured)}, so overflow there is unchecked)"
        parts.append(", ".join(f"{v.file} ({v.variant})" for v in good) + " pass today's rules" + how)
    have = {v.variant for v in verdicts}
    missing = [x for x in VARIANTS if x not in have]
    stand_in = next((v.file for v in verdicts if v.variant != "unreadable"), None)
    if missing and stand_in:
        parts.append(f"no {' or '.join(missing)} reference, so those drafts copy {stand_in}'s shape")
    return (False if bad else True), "; ".join(parts)
