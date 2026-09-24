"""From a call to a checked document. (run_proposal.py's flow, ported.)

The model writes one thing, the deal JSON for one call, and code does
everything else: choosing the variant, building the document, measuring it,
checking it. That split is not a style preference. Scout's first version was
a free-running agent handed the skills; on 2026-07-22 it called zero tools and
delivered the narration as though it were real. Nothing here depends on the
model choosing to do the work.

Two model calls per proposal, not one. The first reads the transcript and
reports whether the client gave an average project value and a NET margin,
quoting the line each came from. The second writes the deal JSON. Between them
sits code, which derives the variant from those two answers, so the model
never picks the variant and cannot pick the wrong one. Then, while a sheet
overflows A4 and each round helps, the drafter is handed its own document back
and asked for a shorter one, up to three times.
"""
from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Optional

from . import build as build_mod
from . import model as model_mod
from . import offer as offer_mod
from . import prompt as prompt_mod
from . import render as render_mod
from . import validate as validate_mod
from .config import Config
from .errors import NotNow


def engine_name(renderer: Any) -> str:
    try:
        return str(renderer.engine())
    except Exception:  # noqa: BLE001
        return "unknown"


RECHECKED = ("The call's figures were checked against the transcript when this proposal was drafted; "
             "what the closer filled in since is the closer's own.")


@dataclass
class Call:
    transcript_text: str
    recording_id: str = ""
    recorded_at: str = ""
    closer: str = ""
    client_name: Optional[str] = None
    client_company: Optional[str] = None
    client_email: Optional[str] = None
    client_country: Optional[str] = None

    def known(self) -> dict[str, Any]:
        """What the CRM knows, for the drafter. Anything null comes from the call or is FILL."""
        return {
            "client_name": self.client_name or None,
            "client_company": self.client_company or None,
            "client_email": self.client_email or None,
            "client_country": self.client_country or None,
            "closer": self.closer or None,
            "recorded_at": self.recorded_at or None,
        }


@dataclass
class Outcome:
    deal: dict[str, Any]
    variant: str
    why: str
    found: Optional[dict[str, Any]]
    result: validate_mod.Result
    html_path: Path
    dom: Optional[str]
    model: str
    rounds: int = 0
    overflow_first: list[int] = field(default_factory=list)
    overflow_last: list[int] = field(default_factory=list)
    reference: Optional[dict[str, Any]] = None
    notes: list[str] = field(default_factory=list)
    seconds: float = 0.0


def choose_variant(found: Optional[dict[str, Any]], transcript_text: str) -> tuple[str, str]:
    """The gate. Code does this, not the model.

    The model reported two facts; the arithmetic on them is one line and it
    belongs here, where it is the same every time and can be read by anyone
    wondering why a given call produced a given document.
    """
    if not transcript_text:
        return "blind", "no recording"
    if not found:
        # No triage means no evidence, and a proposal with no evidence may not
        # put words in the client's mouth. Blind is the variant that asserts
        # nothing about the reader, which is what an unread call knows about him.
        return "blind", "the call could not be read"

    value = found.get("avg_project_value") or {}
    margin = found.get("net_margin") or {}
    has_value = bool(value.get("stated")) and bool(value.get("value"))
    # A margin that was stated but is not net is the same as no margin: the
    # cost page cannot be built from it without inventing the difference.
    has_margin = (bool(margin.get("stated")) and bool(margin.get("value"))
                  and margin.get("is_net") is not False)

    if has_value and has_margin:
        return "specific", "average project value and net margin both given"
    if has_value:
        # The common case: of sixty-seven calls read, forty gave a project
        # value and three a net margin.
        return "general", "project value given, margin not: " + (margin.get("note") or "never stated")
    return "general", "no average project value either"


def triage(call: Call, p: Any, cfg: Config, log: Callable[[str], None],
           beat: Optional[Callable[[], None]] = None) -> tuple[Optional[dict[str, Any]], str]:
    """Read one call for the two figures the gate turns on. None when the
    model read it and came back with nothing usable (the blind variant); an
    outage is raised, never mistaken for an unreadable call."""
    try:
        found, reply = model_mod.call_json(
            p, prompt_mod.TRIAGE_SYSTEM, prompt_mod.triage_user(call.transcript_text), temperature=0,
            attempts=cfg.model_attempts, timeout=cfg.model_timeout, expect=prompt_mod.is_triage,
            log=log, what="triage", beat=beat)
        return found, reply.model
    except NotNow:
        raise
    except model_mod.ModelError as e:
        log(f"    triage gave up: {e}")
        return None, ""


def stamp(deal: dict[str, Any], *, variant: str, resolved: dict[str, Any], lang: str) -> dict[str, Any]:
    """What the file must say whatever the model wrote. The variant is on the
    file because the file is what the validator reads; the offer stamp so the
    document can be checked against the offer it was written for; the logo and
    language because they are ours to set, not the drafter's."""
    if variant != "specific":
        deal["variant"] = variant
    else:
        deal.pop("variant", None)
    deal["offer"] = offer_mod.stamp(resolved)
    deal["logo"] = prompt_mod.LOGO
    deal["lang"] = "ar" if lang == "ar" else "en"
    return deal


def overflowing(deal: dict[str, Any], html_path: Path, renderer: Any) -> tuple[list[int], Optional[str]]:
    """Build the document, render it and return the sheet numbers that
    overflow, with the rendered page. The template marks an overflowing sheet
    itself, in the browser, which is the only place the question can actually
    be answered."""
    build_mod.build(deal, html_path)
    try:
        out = renderer.dom(html_path)
    except Exception:  # noqa: BLE001 - no browser is a warning, not a failure
        out = None
    if not out:
        return [], None
    live = validate_mod.live_dom(out)
    parts = re.split(r'(<section[^>]*class="sheet)', live)
    over = []
    for i in range(1, len(parts), 2):
        chunk = parts[i] + (parts[i + 1] if i + 1 < len(parts) else "")
        if re.search(r'class="sheet[^"]*\bover\b', chunk):
            over.append((i + 1) // 2)
    return over, out


def run(call: Call, *, lang: str, resolved: dict[str, Any], offer: dict[str, Any], p: Any, cfg: Config,
        log: Callable[[str], None], workdir: Path, renderer: Any = render_mod,
        beat: Optional[Callable[[], None]] = None, variant: Optional[str] = None,
        reference_dir: Optional[Path] = None) -> Outcome:
    started = time.time()
    beat = beat or (lambda: None)
    workdir = Path(workdir)
    workdir.mkdir(parents=True, exist_ok=True)
    # The evidence file: the validator checks every figure against it, and it
    # stays beside the draft so the document can be checked again by hand.
    (workdir / "call.txt").write_text(call.transcript_text, encoding="utf-8")
    notes: list[str] = []

    if variant:
        found, why = None, "chosen by hand"
    else:
        found, _triage_model = triage(call, p, cfg, log, beat)
        variant, why = choose_variant(found, call.transcript_text)
    log(f"    variant: {variant} ({why})")
    beat()

    reference, info = prompt_mod.load_reference(reference_dir or cfg.reference_dir, variant, log)
    if reference is None:
        notes.append(f"No reference deal on this machine ({reference_dir or cfg.reference_dir}); the draft was "
                     "written from the rules and the template's outline alone.")
    elif not info["matched"]:
        notes.append(f"No {variant} reference on this machine; the drafter copied the shape of {info['file']}, "
                     f"a {info['variant']} proposal.")
    system = prompt_mod.system_for(variant, resolved, offer, reference, info)
    user = prompt_mod.draft_user(call.known(), call.transcript_text, lang, variant, has_reference=reference is not None)

    deal, reply = model_mod.call_json(p, system, user, temperature=0.3, attempts=cfg.model_attempts,
                                      timeout=cfg.model_timeout, expect=prompt_mod.is_deal, log=log, what="draft",
                                      beat=beat)
    used = f"{p.name}:{reply.model or p.model}"
    stamp(deal, variant=variant, resolved=resolved, lang=lang)
    (workdir / "deal.json").write_text(json.dumps(deal, ensure_ascii=False, indent=2), encoding="utf-8")
    beat()

    # Overflow is the one fault the drafter cannot see, so it is measured here
    # and handed back, repeatedly, while it is helping. The stop condition is
    # a round that does not improve, not a round counter.
    best = deal
    best_html = workdir / "draft-1.html"
    best_over, best_dom = overflowing(best, best_html, renderer)
    first = list(best_over)
    rounds = 0
    if best_dom is None:
        notes.append("No browser on this machine could render the page, so the overflow was not measured "
                     f"and nothing was tightened ({engine_name(renderer)}).")
    for round_no in range(1, cfg.tighten_rounds + 1):
        if not best_over:
            break
        rounds = round_no
        log("    sheet(s) %s overflow; asking for a tighter draft (%d/%d)"
            % (", ".join(str(n) for n in best_over), round_no, cfg.tighten_rounds))
        still: Optional[list[int]] = None
        try:
            tighter, _r = model_mod.call_json(
                p, system, prompt_mod.tighten_user(best, best_over), temperature=0.2, attempts=1,
                timeout=cfg.model_timeout, expect=prompt_mod.is_deal, log=log, what="tighten", beat=beat)
            stamp(tighter, variant=variant, resolved=resolved, lang=lang)
            html_path = workdir / f"draft-{round_no + 1}.html"
            still, dom = overflowing(tighter, html_path, renderer)
        except NotNow:
            raise
        except Exception as e:  # noqa: BLE001
            log(f"    tightening failed ({e}); keeping the best draft so far")
        beat()
        if still is None or (still and len(still) >= len(best_over)):
            # No better, and possibly worse. Keep what we had: a draft written
            # under fewer instructions is the more faithful to the call.
            if still:
                log("    tighter draft still overflows %s; keeping the best" % ", ".join(str(n) for n in still))
            break
        best, best_over, best_dom, best_html = tighter, still, dom, html_path
        log("    better: now only sheet(s) %s overflow" % ", ".join(str(n) for n in still) if still else "    fits now")

    (workdir / "deal.json").write_text(json.dumps(best, ensure_ascii=False, indent=2), encoding="utf-8")
    result = validate_mod.validate(best, call.transcript_text, resolved=resolved, offer=offer, dom=best_dom,
                                   engine=engine_name(renderer))
    log("    gate: %s, %d placeholder(s)" % (result.status(), result.fills))
    return Outcome(
        deal=best, variant=variant, why=why, found=found, result=result, html_path=best_html, dom=best_dom,
        model=used, rounds=rounds, overflow_first=first, overflow_last=list(best_over),
        reference=info, notes=notes, seconds=round(time.time() - started, 1),
    )


def rebuild(deal: dict[str, Any], *, resolved: dict[str, Any], offer: dict[str, Any], html_path: Path,
            renderer: Any = render_mod) -> tuple[validate_mod.Result, Optional[str]]:
    """The same document again after the closer filled its gaps: no model, no
    Fathom. The build, the render and the gate, exactly as for a draft."""
    if "offer" not in deal:
        deal["offer"] = offer_mod.stamp(resolved)
    _over, dom = overflowing(deal, Path(html_path), renderer)
    result = validate_mod.validate(deal, None, resolved=resolved, offer=offer, dom=dom,
                                   engine=engine_name(renderer), checked_note=RECHECKED)
    return result, dom
