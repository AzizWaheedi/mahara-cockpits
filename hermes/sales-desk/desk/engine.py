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


# Checks whose failures are a matter of words the drafter can change. Not
# here: schema (the shape is wrong), render (the tightening rounds), the
# arithmetic and the fee band (they follow from figures the client gave). The
# verdict is here: it is the arithmetic page's words against its own table,
# and so is rate, the "You sign" row the drafter filled with the target, and
# the timeline, the days to the first meeting told two ways.
REPAIRABLE = {"guarantee", "brand", "language", "echoes", "currency", "dates", "evidence", "prose", "offer",
              "proof", "verdict", "rate", "timeline"}


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
    # The provider and model that wrote it, and why when that was the fallback.
    route: dict[str, Any] = field(default_factory=dict)


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
        # value and three a net margin. Said as no net margin, because a gross
        # one may have been given and counted (176954619's notes said "margin
        # not" and then "gross", live check of 5 October 2026).
        return "general", "project value given, no net margin: " + (margin.get("note") or "never stated")
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


# What names a list item: the tile's label, the stage's, the row's item.
_ITEM_NAMES = ("k", "label", "item", "title", "problem", "name", "when")


def _same_item(was: Any, now: Any, leaf: Any) -> bool:
    """Whether a list item in a fresh draft is the one the closer filled in the
    last version: the same names, read loosely. An item with no name to go by
    is taken as the same."""
    if not (isinstance(was, dict) and isinstance(now, dict)):
        return True
    norm = (lambda v: re.sub(r"\s+", " ", str(v or "")).strip().lower())
    names = [k for k in _ITEM_NAMES if k != leaf and isinstance(was.get(k), str) and was.get(k).strip()
             and not validate_mod.FILL_RE.search(was[k])]
    return all(norm(was[k]) == norm(now.get(k)) for k in names)


def apply_fills(deal: dict[str, Any], fills: Optional[dict[str, Any]],
                prior: Optional[dict[str, Any]] = None) -> tuple[list[str], list[str]]:
    """The figures the closer typed into an earlier version's blanks, put into
    this one's blanks at the same place (a dotted path, as sales-api
    proposal.fill addresses them): (put back, no blank to go into). A whole
    FILL given a figure becomes a number, as proposal.fill makes it.

    A fresh draft may order its tiles, stages or rows differently, so a path
    through a list is only followed when the item there has the same label as
    in the version the closer filled (`prior`): "6" typed for projects signed
    never lands on the tile that now says meetings a month."""
    applied: list[str] = []
    missing: list[str] = []
    for path, raw in (fills or {}).items():
        value = str(raw if raw is not None else "").strip()
        if not value or validate_mod.FILL_RE.search(value):
            continue
        keys: list[Any] = [int(k) if k.isdigit() else k for k in str(path).split(".")]
        node: Any = deal
        was: Any = prior if isinstance(prior, dict) else None
        for n, k in enumerate(keys[:-1]):
            if isinstance(node, list) and isinstance(k, int) and k < len(node):
                then = was[k] if isinstance(was, list) and k < len(was) else None
                if prior is not None and not _same_item(then, node[k], keys[n + 1]):
                    node = None
                    break
                node, was = node[k], then
            elif isinstance(node, dict) and not isinstance(k, int) and k in node:
                node, was = node[k], (was.get(k) if isinstance(was, dict) else None)
            else:
                node = None
                break
        last = keys[-1]
        here = None
        if isinstance(node, list) and isinstance(last, int) and last < len(node):
            here = node[last]
        elif isinstance(node, dict) and not isinstance(last, int):
            here = node.get(last)
        if not isinstance(here, str) or not validate_mod.FILL_RE.search(here):
            missing.append(str(path))
            continue
        plain = value.replace(",", "")
        node[last] = float(plain) if (here.strip() == "FILL" and re.fullmatch(r"-?\d+\.\d+", plain)) else (
            int(plain) if here.strip() == "FILL" and re.fullmatch(r"-?\d+", plain) else value)
        applied.append(str(path))
    return applied, missing


def closer_evidence(transcript_text: str, fills: Optional[dict[str, Any]]) -> str:
    """The call, and the figures the closer typed, which are the closer's own
    to vouch for: the evidence a draft that took them back is checked against."""
    typed = [str(v) for v in (fills or {}).values() if str(v or "").strip()]
    return transcript_text + ("\n\nFigures the closer typed: " + "; ".join(typed) if typed else "")


# ---- the contact's name ------------------------------------------------------
# A name copied from a Fathom speaker label keeps the label's typing: the proof
# run of 176954619 printed the surname in lower case on the cover (5 October
# 2026), where the live draft had it capitalised. The CRM mirror stores every
# Latin name in lower case (2,018 of 2,018 on 5 October 2026), and the drafter
# reads it too. Code puts a name taken from either in title case. A word with
# a capital inside it (McLean, AlSaud) is left alone, the CRM's own capitals
# win where it has any, and a name the closer typed is the closer's spelling.
# A name typed in one case throughout chose none of its capitals, so the
# Arabic article takes the capital the Gulf gives it (Al-Harbi, Al Saud: the
# speaker labels that capitalise anything write it so 18 times in 21) and
# the other particles go lower case (bin, ibn, van der) unless they open the
# name; in a name with capitals of its own, a particle stays as written.
NAME_PARTICLES = {"al", "el", "bin", "bint", "ibn", "bn", "de", "da", "di", "del", "della", "der", "den", "van",
                  "von", "la", "le", "du", "dos", "das", "ter"}
ARTICLES = {"al", "el"}
HONORIFICS = {"mr", "mrs", "ms", "dr", "eng", "engr", "sheikh", "shaikh", "prof"}
# "Name: words" as fathom.flatten writes a turn, or the vault's "**Name** (00:01:02): words".
_LABEL = re.compile(r"^\s*(?:\*\*(?P<vault>[^*]+)\*\*\s*\([^)]*\)|(?P<plain>[^:\n]{1,80}?))\s*:\s")


def speaker_labels(transcript_text: str) -> list[str]:
    """The names the call's turns are spoken under, each once."""
    seen: list[str] = []
    for line in str(transcript_text or "").splitlines():
        m = _LABEL.match(line)
        who = (m.group("vault") or m.group("plain") or "").strip() if m else ""
        if who and re.search(r"[^\W\d_]", who) and who not in seen:
            seen.append(who)
    return seen


def _latin_words(text: str) -> list[str]:
    return [w.lower() for w in re.findall(r"[A-Za-z][A-Za-z'’-]*", text)]


def from_a_label(name: str, labels: Any) -> bool:
    """Every Latin word of the name (a title such as Eng. aside) is in one of
    the call's speaker labels (or the CRM's name): the drafter took it from there."""
    words = [w for w in _latin_words(name) if w.strip("'’-") not in HONORIFICS]
    return bool(words) and any(set(words) <= set(_latin_words(label)) for label in labels or () if label)


def _capitalised(piece: str) -> str:
    """The first letter upper case, after any mark, quote or bracket before
    it, and the rest lower; Mc keeps the capital after it (McDonald)."""
    at = re.search(r"[A-Za-z]", piece)
    if not at:
        return piece
    low = piece[at.start():].lower()
    if low.startswith("mc") and len(low) > 3 and low[2].isalpha():
        body = "Mc" + low[2].upper() + low[3:]
    else:
        body = low[:1].upper() + low[1:]
    return piece[:at.start()] + body


def name_in_title_case(name: str) -> str:
    """Each word of a name in lower case (or the whole name in capitals) with
    its first letter capitalised, and the parts of "al-harbi" or "o'neil"
    after a hyphen or apostrophe too. Arabic script and a word with a capital
    inside it are left as they are; particles as the note above says."""
    latin = re.findall(r"[A-Za-z]+", name)
    shouted = bool(latin) and all(w.isupper() for w in latin) and any(len(w) > 2 for w in latin)
    one_case = shouted or (bool(latin) and all(w.islower() for w in latin))
    first_word = [True]

    def part(p: str, opening: bool) -> str:
        bare = re.sub(r"[^A-Za-z]", "", p).lower()
        if bare in NAME_PARTICLES:
            if not one_case:
                return p
            return _capitalised(p) if opening or bare in ARTICLES else p.lower()
        return _capitalised(p)

    def word(tok: str) -> str:
        letters = re.sub(r"[^A-Za-z]", "", tok)
        if not letters:
            return tok
        opening, first_word[0] = first_word[0], False
        if not (letters.islower() or (shouted and letters.isupper())):
            return tok
        if shouted and len(letters) <= 2 and letters.lower() not in NAME_PARTICLES:
            return tok
        pieces = re.split(r"([-'’])", tok)
        return "".join(p if re.fullmatch(r"[-'’]", p) else part(p, opening and j == 0) for j, p in enumerate(pieces))

    return "".join(tok if tok.isspace() else word(tok) for tok in re.split(r"(\s+)", name))


def tidy_contact(deal: dict[str, Any], speakers: Any, crm_name: Optional[str] = None,
                 typed: Any = None) -> None:
    """client_contact in title case when the drafter copied it from a speaker
    label or the CRM. `typed` is the closer's own spelling (a string), or True
    when the closer typed the name without it being known here: the closer's
    spelling of the same name is used, and a name the closer typed is never
    otherwise touched."""
    name = deal.get("client_contact")
    if not isinstance(name, str) or validate_mod.FILL_RE.search(name):
        return
    if typed:
        spelled = " ".join(str(typed).split()) if isinstance(typed, str) else ""
        if spelled and spelled.casefold() == " ".join(name.split()).casefold() \
                and not validate_mod.FILL_RE.search(spelled):
            deal["client_contact"] = spelled
        return
    crm = " ".join(str(crm_name or "").split())
    if not from_a_label(name, list(speakers or ()) + ([crm] if crm else [])):
        return
    # The CRM's own capitals, word by word, where it has any: "McSample",
    # "al-Harbi". A word it has in lower case (or all in capitals) is not a spelling.
    spelled_by_crm = {w.casefold(): w for w in crm.split()
                      if re.search(r"[A-Z]", w) and not (re.sub(r"[^A-Za-z]", "", w).isupper() and len(w) > 2)}
    titled = name_in_title_case(name)
    deal["client_contact"] = re.sub(r"\S+", lambda m: spelled_by_crm.get(m.group(0).casefold(), m.group(0)), titled)


def stamp(deal: dict[str, Any], *, variant: str, resolved: dict[str, Any], lang: str,
          currency_unstated: bool = False, closer_figures: Optional[dict[str, Any]] = None,
          prior: Optional[dict[str, Any]] = None, speakers: Any = (),
          crm_name: Optional[str] = None) -> dict[str, Any]:
    """What the file must say whatever the model wrote. The variant is on the
    file because the file is what the validator reads; the offer stamp so the
    document can be checked against the offer it was written for; the logo and
    language because they are ours to set, not the drafter's. And a currency
    the client never named is a blank for the closer, never a guess. A name
    copied from a speaker label or the CRM is put in title case (`speakers`,
    the call's labels; `crm_name`, the lead's name in the CRM), and a name the
    closer typed keeps the closer's spelling."""
    figures = closer_figures or {}
    tidy_contact(deal, speakers, crm_name, typed=figures.get("client_contact") or "client_contact" in figures)
    if currency_unstated and isinstance(deal.get("arithmetic"), dict):
        deal["arithmetic"]["currency"] = "FILL"
    # A reference's instruction copied as it stands ("<the client's gross
    # margin ...>") is no figure and no label: the key goes.
    if isinstance(deal.get("arithmetic"), dict):
        for key in ("gross_margin", "project_label"):
            if str(deal["arithmetic"].get(key) or "").lstrip().startswith("<"):
                deal["arithmetic"].pop(key)
    # A funnel stage counting other people than the one above (another period
    # or source) draws no "lost here" its own note contradicts.
    validate_mod.separate_pools(deal)
    if closer_figures:
        # Kept through every round, so a figure a later round turned back
        # into a blank is put back, and a draft after this one has them too.
        apply_fills(deal, closer_figures, prior)
        deal["closer_figures"] = dict(closer_figures)
        # A currency the closer typed is priced in as on a rebuild.
        if "arithmetic.currency" in closer_figures:
            follow_currency(deal)
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


def px_over(dom: Optional[str]) -> dict[int, int]:
    """By how many pixels each overflowing sheet is over, as the template
    measured it (data-over-px), by sheet number."""
    if not dom:
        return {}
    parts = re.split(r'(<section[^>]*class="sheet)', validate_mod.live_dom(dom))
    out = {}
    for i in range(1, len(parts), 2):
        chunk = parts[i] + (parts[i + 1] if i + 1 < len(parts) else "")
        head = chunk.split(">", 1)[0]
        m = re.search(r'data-over-px="(\d+)"', head)
        if m and re.search(r'class="sheet[^"]*\bover\b', head):
            out[(i + 1) // 2] = int(m.group(1))
    return out


# Lists a shorter version may not lose: a tightening round that drops a step
# or a target is not shorter copy, it is a thinner proposal. Nor a line of the
# price, a term or a step to start: those are what the client signs (5 October
# 2026 review: only the steps and the targets were held).
KEPT_LISTS = ("solution", "solution_targets", "investment.rows", "terms", "start_steps")
# And when the sheet is only a few lines over, the drafter is told to keep
# every list item, so none may go.
KEPT_WHEN_SMALL = ("proof", "gap_points", "funnel.stages", "tree.branches", "problems", "pattern", "program")


def _list_at(deal: dict[str, Any], path: str) -> Optional[list[Any]]:
    node: Any = deal
    for part in path.split("."):
        node = node.get(part) if isinstance(node, dict) else None
    return node if isinstance(node, list) else None


def lost_items(before: dict[str, Any], after: dict[str, Any], small: bool = False) -> list[str]:
    """The lists that came back shorter than they went."""
    out = []
    for k in KEPT_LISTS + (KEPT_WHEN_SMALL if small else ()):
        was, now = _list_at(before, k), _list_at(after, k)
        if was is not None and len(now or []) < len(was):
            out.append(k)
    return out


def run(call: Call, *, lang: str, resolved: dict[str, Any], offer: dict[str, Any], p: Any, cfg: Config,
        log: Callable[[str], None], workdir: Path, renderer: Any = render_mod,
        beat: Optional[Callable[[], None]] = None, variant: Optional[str] = None,
        reference_dir: Optional[Path] = None, fills: Optional[dict[str, Any]] = None,
        prior: Optional[dict[str, Any]] = None) -> Outcome:
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

    unstated = prompt_mod.currency_unstated(found)
    facts = [prompt_mod.UNSTATED_CURRENCY] if unstated else []
    if unstated:
        notes.append("The client never named a currency for their figures, so the arithmetic page's currency is "
                     "left for the closer to fill.")
    value = (found or {}).get("avg_project_value") or {}
    has_value = None if found is None else bool(value.get("stated") and value.get("value"))
    reference, info = prompt_mod.load_reference(reference_dir or cfg.reference_dir, variant, log,
                                                project_value=has_value)
    if reference is None:
        notes.append(f"No reference deal on this machine ({reference_dir or cfg.reference_dir}); the draft was "
                     "written from the rules and the template's outline alone.")
    elif not info["matched"]:
        notes.append(f"No {variant} reference on this machine; the drafter copied the shape of {info['file']}, "
                     f"a {info['variant']} proposal.")
    system = prompt_mod.system_for(variant, resolved, offer, reference, info)
    user = prompt_mod.draft_user(call.known(), call.transcript_text, lang, variant, has_reference=reference is not None,
                                 facts=facts)

    deal, reply = model_mod.call_json(p, system, user, temperature=0.3, attempts=cfg.model_attempts,
                                      timeout=cfg.model_timeout, expect=prompt_mod.is_deal, log=log, what="draft",
                                      beat=beat)
    used = f"{p.name}:{reply.model or p.model}"
    # Settled now: the triage and the draft went through one provider, and the
    # tightening and repair rounds stay on it (model.Failover).
    route = model_mod.route_of(p, reply.model or p.model)
    if route.get("note"):
        notes.insert(0, route["note"])
    if fills:
        # Drafted again after the closer had typed figures into the last
        # version's blanks: they go back into this one's (5 October 2026).
        put, nowhere = apply_fills(deal, fills, prior)
        line = f"{len(put)} of the figures you typed went back into this draft"
        if nowhere:
            line += (f"; {', '.join(nowhere[:6])} had no blank on the same line here to go into, so type them "
                     "again where they belong")
        notes.append(line + ".")
    evidence = closer_evidence(call.transcript_text, fills)
    # The call's speaker labels and the CRM's name, for a name the drafter
    # copied from a label (stamp puts it in title case on every round).
    named = {"speakers": speaker_labels(call.transcript_text), "crm_name": call.client_name}
    stamp(deal, variant=variant, resolved=resolved, lang=lang, currency_unstated=unstated, closer_figures=fills,
          prior=prior, **named)
    (workdir / "deal.json").write_text(json.dumps(deal, ensure_ascii=False, indent=2), encoding="utf-8")
    beat()

    # Overflow is the one fault the drafter cannot see, so it is measured here
    # and handed back. Each round asks for a larger cut than the one before
    # (prompt.tighten_user); a round that does not help is set aside and the
    # next, harder round starts again from the best draft so far. Tested on a
    # real demo on 2026-09-24: one gentle round left sheet 5 a few lines long
    # and the old rule (stop at the first round that does not help) gave up.
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
                p, system, prompt_mod.tighten_user(best, best_over, round_no, px=px_over(best_dom)),
                temperature=0.2, attempts=1, timeout=cfg.model_timeout, expect=prompt_mod.is_deal, log=log,
                what="tighten", beat=beat)
            stamp(tighter, variant=variant, resolved=resolved, lang=lang, currency_unstated=unstated,
                  closer_figures=fills, prior=prior, **named)
            lost = lost_items(best, tighter, small=prompt_mod.small_overflow(best_over, px_over(best_dom)))
            if lost:
                log("    the shorter draft dropped items from %s; not taken" % ", ".join(lost))
            else:
                html_path = workdir / f"draft-{round_no + 1}.html"
                still, dom = overflowing(tighter, html_path, renderer)
        except NotNow:
            raise
        except Exception as e:  # noqa: BLE001
            log(f"    tightening failed ({e}); keeping the best draft so far")
        beat()
        if still is None or (still and len(still) >= len(best_over)):
            # No better, and possibly worse. Keep what we had (a draft written
            # under fewer instructions is the more faithful to the call) and
            # let the next, harder round try from it.
            if still:
                log("    tighter draft still overflows %s; keeping the best" % ", ".join(str(n) for n in still))
            continue
        best, best_over, best_dom, best_html = tighter, still, dom, html_path
        log("    better: now only sheet(s) %s overflow" % ", ".join(str(n) for n in still) if still else "    fits now")

    (workdir / "deal.json").write_text(json.dumps(best, ensure_ascii=False, indent=2), encoding="utf-8")
    result = validate_mod.validate(best, evidence, resolved=resolved, offer=offer, dom=best_dom,
                                   engine=engine_name(renderer))
    log("    gate: %s, %d placeholder(s)" % (result.status(), result.fills))

    # One repair round for the faults the drafter can fix by editing words:
    # a guarantee nobody chose, a figure the client never said, the brand,
    # the language, a date, an echo. The checker's own sentences go back to
    # the model; the repaired draft is kept only if it is measurably better
    # and still fits the page. (A real demo on 2026-09-24 copied a guarantee
    # line into `terms` from the reference deal although none was chosen.)
    fixable = [e for e in result.errors() if e.split(":", 1)[0].strip() in REPAIRABLE]
    if fixable and cfg.repair_rounds > 0:
        log("    asking the drafter to fix: %s" % "; ".join(e.split(":", 1)[0] for e in fixable))
        try:
            fixed, _r = model_mod.call_json(
                p, system, prompt_mod.repair_user(best, fixable), temperature=0.2, attempts=1,
                timeout=cfg.model_timeout, expect=prompt_mod.is_deal, log=log, what="repair", beat=beat)
            stamp(fixed, variant=variant, resolved=resolved, lang=lang, currency_unstated=unstated,
                  closer_figures=fills, prior=prior, **named)
            fixed_html = workdir / "draft-repaired.html"
            fixed_over, fixed_dom = overflowing(fixed, fixed_html, renderer)
            fixed_result = validate_mod.validate(fixed, evidence, resolved=resolved, offer=offer,
                                                 dom=fixed_dom if fixed_dom is not None else best_dom,
                                                 engine=engine_name(renderer))
            better = len(fixed_result.errors()) < len(result.errors()) and len(fixed_over) <= len(best_over)
            if better:
                best, best_over, best_dom, best_html, result = fixed, fixed_over, fixed_dom, fixed_html, fixed_result
                (workdir / "deal.json").write_text(json.dumps(best, ensure_ascii=False, indent=2), encoding="utf-8")
                notes.append("The checker's findings were handed back once and fixed: " + "; ".join(
                    e.split(":", 1)[0] for e in fixable) + ".")
                log("    repaired: gate now %s" % result.status())
            else:
                log("    the repair did not help; keeping the draft as it was")
        except NotNow:
            raise
        except Exception as e:  # noqa: BLE001
            log(f"    repair failed ({e}); keeping the draft as it was")
        beat()
    return Outcome(
        deal=best, variant=variant, why=why, found=found, result=result, html_path=best_html, dom=best_dom,
        model=used, rounds=rounds, overflow_first=first, overflow_last=list(best_over),
        reference=info, notes=notes, seconds=round(time.time() - started, 1), route=route,
    )


def follow_currency(deal: dict[str, Any]) -> bool:
    """When the arithmetic page's currency is one the roi block is not in (the
    closer filled a currency the call never named), the roi block follows it,
    at that currency's dollar peg, so the engagement is printed in it. True
    when it changed anything."""
    arith = deal.get("arithmetic") if isinstance(deal.get("arithmetic"), dict) else {}
    roi = deal.get("roi") if isinstance(deal.get("roi"), dict) else None
    typed = arith.get("currency")
    if typed in (None, "") or validate_mod.FILL_RE.search(str(typed)):
        return False
    # Typed as the closer says it ("dirhams", "sar", "ريال"): the code. A
    # currency the page cannot price in goes back to a blank to type again,
    # since a filled field can no longer be filled and the engagement would
    # print in dollars under that name.
    cur = validate_mod.currency_code(typed)
    if cur is None:
        arith["currency"] = "FILL"
        return True
    if cur != typed:
        arith["currency"] = cur
    if roi is None:
        return cur != typed
    if str(roi.get("local_currency") or "").upper() == cur and roi.get("usd_rate") == validate_mod.USD_PEGS[cur]:
        return False
    if str(roi.get("local_currency") or "").upper() == cur and isinstance(roi.get("usd_rate"), (int, float)) \
            and not validate_mod.rate_off(cur, roi["usd_rate"]):
        return False
    arith["currency"] = cur
    roi["local_currency"] = cur
    roi["usd_rate"] = validate_mod.USD_PEGS[cur]
    return True


def rebuild(deal: dict[str, Any], *, resolved: dict[str, Any], offer: dict[str, Any], html_path: Path,
            renderer: Any = render_mod) -> tuple[validate_mod.Result, Optional[str]]:
    """The same document again after the closer filled its gaps: no model, no
    Fathom. The build, the render and the gate, exactly as for a draft."""
    if "offer" not in deal:
        deal["offer"] = offer_mod.stamp(resolved)
    follow_currency(deal)
    _over, dom = overflowing(deal, Path(html_path), renderer)
    result = validate_mod.validate(deal, None, resolved=resolved, offer=offer, dom=dom,
                                   engine=engine_name(renderer), checked_note=RECHECKED)
    return result, dom
