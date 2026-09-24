"""Check a proposal before it goes near a client. (Ported from Mahara-B2B
proposals/validate.py; the checks are the same, the offer checks now read the
option the closer chose instead of one fixed offer.)

Four checks, in the order they matter:

    schema     the keys the template reads are present and the right shape
    evidence   every client number in the document was actually said on the call
    fee band   the engagement is 10-30% of the annual gap it is priced against
    render     the built document has the sheets it should, nothing overflowing

A deal file carrying `variant: "general"` is checked differently, because it
argues differently. It has no cost page to measure a fee band against, so that
check is replaced by one on the break-even table. Its own failure mode is the
opposite of the specific one: a general proposal must assert *nothing* about
the client's margin, so a non-zero margin fails it.

Evidence is the one that earns its place. The whole argument of a proposal is
that the figures are the client's own, so a number that appears nowhere in the
transcript is the failure mode worth automating against: it is also the one a
human proofreader is worst at catching, because an invented figure reads
exactly like a real one.

Two gates, not one. The first asks whether a draft is fit for a closer to open:
gaps are expected, and a FILL is a note rather than a fault. The send gate asks
whether the document is fit to leave the building, and then a gap is a
failure, because the next person to see it is the client. Every row carries
its verdict under both, so one run answers both questions.
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any, Iterable, Optional

from . import offer as offer_mod

REQUIRED = [
    "reference", "client_company", "client_contact", "date", "headline", "subhead",
    "gap_title", "gap_points", "funnel", "tree", "cost", "program", "solution",
    "proof", "investment", "terms", "roi", "start_steps",
]

# The same document with two pages swapped: what the client said stands in for
# what he earns, and arithmetic on our own fee stands in for the cost of his
# gap. `funnel` is not required: a company that gave no numbers usually has
# none to put in one.
REQUIRED_GENERAL = [
    "reference", "client_company", "client_contact", "date", "headline", "subhead",
    "gap_title", "tree", "arithmetic", "program", "solution",
    "proof", "investment", "terms", "roi", "start_steps",
]

# For a company nobody has spoken to. It rests on nothing about them at all, so
# the pattern recorded across the firms we do know stands in for the client,
# stated as a pattern and offered to be corrected. It may not assert one fact
# about the reader. A cold document carries a call to action, not a signature.
REQUIRED_BLIND = [
    "reference", "client_company", "date", "headline", "subhead",
    "gap_title", "arithmetic", "solution",
    "proof", "investment", "roi", "cta",
]

# Blocks that can only be filled from a call. Their presence in a blind deal
# file means a figure or a sentence about the client got in.
BLIND_FORBIDDEN = ("quotes", "gap_points", "funnel", "cost")

# Digits, and the two separators that go with them. An Arabic proposal writes
# thirty-nine thousand as ٣٩٬٣٧٥, with U+066C between the groups rather than a
# comma. Without that mapping the figure splits into 39 and 375, and the second
# half gets reported as a number nobody ever said.
ARABIC_DIGITS = str.maketrans(
    "٠١٢٣٤٥٦٧٨٩"
    "۰۱۲۳۴۵۶۷۸۹٬٫",
    "01234567890123456789,.")

# Spoken numbers. A closing call in Arabic says "تسع مشاريع", not "9 مشاريع", so
# a digits-only check reports every small count as invented. Standard and
# dialectal forms both, because the calls run in Gulf and Levantine Arabic.
NUMBER_WORDS = {
    1: ["واحد", "واحدة", "وحدة", "one", "a single"],
    2: ["اثنين", "اثنان", "إثنين", "اتنين", "ثنين", "two"],
    3: ["ثلاثة", "ثلاث", "تلاتة", "تلات", "three"],
    4: ["أربعة", "اربعة", "أربع", "اربع", "four"],
    5: ["خمسة", "خمس", "خمسه", "five"],
    6: ["ستة", "ست", "سته", "six"],
    7: ["سبعة", "سبع", "سبعه", "seven"],
    8: ["ثمانية", "ثمان", "تمانية", "تمان", "eight"],
    9: ["تسعة", "تسع", "تسعه", "nine"],
    10: ["عشرة", "عشر", "عشره", "ten"],
    11: ["احدعش", "أحد عشر", "eleven"],
    12: ["اثنعش", "اثنا عشر", "twelve"],
    15: ["خمستعش", "خمسة عشر", "fifteen"],
    20: ["عشرين", "twenty"],
    25: ["خمسة وعشرين", "خمسه وعشرين", "twenty five", "twenty-five"],
    30: ["ثلاثين", "تلاتين", "thirty"],
    40: ["أربعين", "اربعين", "forty"],
    50: ["خمسين", "fifty"],
    60: ["ستين", "sixty"],
    70: ["سبعين", "seventy"],
    80: ["ثمانين", "تمانين", "eighty"],
    90: ["تسعين", "ninety"],
    100: ["مئة", "مائة", "مية", "ميه", "hundred"],
}

# Below this, a figure is a count (one project, five meetings) and is as
# likely to be spoken as a word as a digit, in any of a dozen dialect spellings.
# Above it, a figure is a price, a volume or a percentage: specific, said
# deliberately, and the kind of number that gets invented. The hard gate belongs
# there; small counts are reported for a human to eyeball instead.
HARD_EVIDENCE_FLOOR = 100

PASS, FAIL, WARN = "PASS", "FAIL", "WARN"

# Fields a client reads that describe the client. Their figures have to come
# from the call. Everything not listed here is ours (the offer, the proof, the
# five steps, the terms) and is checked against what we quote instead.
CLIENT_PROSE = (
    "headline", "subhead", "gap_title", "gap_intro", "gap_close",
    "tree_title", "tree_intro", "tree_close",
)
CLIENT_PROSE_BLOCKS = {
    "funnel": ("title", "note"),
    "tree": ("title", "goal", "goal_note", "note"),
    "cost": ("title", "intro", "note", "verdict", "close"),
    "arithmetic": ("intro", "note", "verdict", "close"),
}

# Mahara writes without either. An em dash in a client document is the clearest
# tell that nobody read it back, and the brand has no emoji anywhere.
EM_DASH = "—"
EMOJI = re.compile(
    "[\U0001F300-\U0001FAFF\U00002600-\U000027BF\U0001F1E6-\U0001F1FF←-⇿⬀-⯿]")
ARABIC = re.compile("[؀-ۿݐ-ݿ]")

CURRENCIES = ("USD", "SAR", "AED", "QAR", "KWD", "BHD", "OMR")

# Keys that are machine data rather than anything a reader reads: images, and
# the offer stamp the desk writes so a deal can be checked again later.
NOT_CONTENT = ("logo", "cover_image", "offer")

FILL_RE = re.compile(r"\bFILL\b")


# --------------------------------------------------------------- the report ---
@dataclass
class Result:
    rows: list[dict[str, str]]
    expected_sheets: int
    fills: int
    fill_fields: list[str]
    fee_band_pct: Optional[float] = None
    rendered_sheets: Optional[int] = None
    notes: list[str] = field(default_factory=list)

    def failed(self, send: bool = False) -> bool:
        key = "send" if send else "status"
        return any(r[key] == FAIL for r in self.rows)

    def errors(self) -> list[str]:
        """What makes the draft unusable. A missing company name is not here:
        it is a gap the closer fills, like any FILL (see check_identity)."""
        return [f"{r['check']}: {r['detail']}" for r in self.rows if r["status"] == FAIL and r["check"] != "identity"]

    def warnings(self) -> list[str]:
        out = [f"{r['check']}: {r['detail']}" for r in self.rows if r["status"] == FAIL and r["check"] == "identity"]
        return out + [f"{r['check']}: {r['detail']}" for r in self.rows if r["status"] == WARN]

    @property
    def ok(self) -> bool:
        return not self.errors()

    @property
    def send_ready(self) -> bool:
        return not self.failed(send=True)

    def status(self) -> str:
        """ready when it passes the send gate; failed when the draft itself is
        wrong; needs_input when all that is left is for the closer to supply."""
        if self.send_ready:
            return "ready"
        return "needs_input" if self.ok else "failed"

    def text(self, send: bool = False) -> str:
        width = max((len(r["check"]) for r in self.rows), default=6) + 2
        key = "send" if send else "status"
        mark = {PASS: "  ok  ", FAIL: " FAIL ", WARN: " warn "}
        return "\n".join(f"[{mark[r[key]]}] {r['check']:<{width}} {r['detail']}" for r in self.rows)


class Report:
    def __init__(self) -> None:
        self.rows: list[dict[str, str]] = []

    def add(self, status: str, check: str, detail: str, send: Optional[str] = None) -> None:
        """One verdict, and the verdict under the send gate when it differs."""
        self.rows.append({"status": status, "send": send or status, "check": check, "detail": detail})


# ----------------------------------------------------------------- schema ----
def check_schema(data: dict[str, Any], rep: Report, general: bool = False, blind: bool = False) -> int:
    required = REQUIRED_BLIND if blind else (REQUIRED_GENERAL if general else REQUIRED)
    missing = [k for k in required if k not in data or data[k] in (None, "", [], {})]
    if missing:
        rep.add(FAIL, "schema", "missing or empty: " + ", ".join(missing))
    else:
        rep.add(PASS, "schema", f"all {len(required)} required blocks present")

    roi = data.get("roi") or {}
    keys = ("fee_usd", "months", "usd_rate") if (general or blind) else \
           ("avg_project_value", "margin_pct", "fee_usd", "months", "usd_rate")
    for key in keys:
        if not isinstance(roi.get(key), (int, float)) or isinstance(roi.get(key), bool):
            rep.add(FAIL, "schema roi", f"roi.{key} must be a number, got {roi.get(key)!r}")

    # A funnel counts. The rule exists so the first page is carried by
    # something that came out of the call, and a funnel with real counts is
    # exactly that.
    if general and not (data.get("gap_points") or data.get("funnel")
                        or data.get("pattern") or data.get("pattern_groups")):
        rep.add(FAIL, "schema", "a general proposal needs gap_points, a funnel or the "
                                "pattern to carry the first page")

    if blind and not (data.get("pattern") or data.get("pattern_groups")):
        rep.add(FAIL, "schema", "missing or empty: pattern (or pattern_groups)")

    if blind:
        present = [k for k in BLIND_FORBIDDEN if data.get(k)]
        if present:
            rep.add(FAIL, "blind", "no call happened, so these cannot have been filled "
                                   "from one: " + ", ".join(present))
        else:
            rep.add(PASS, "blind", "states no fact about the client, as it must")
        for key in ("avg_project_value", "margin_pct"):
            v = roi.get(key)
            if v:
                rep.add(FAIL, "blind", f"roi.{key} is {v}; nobody has spoken to this "
                                       "client, so any figure about their money is invented.")

    # A general proposal may carry the project value, because the call gave it
    # and check_evidence tests it against the transcript like any other figure.
    # It may never carry a margin: that is the number the client would not say.
    if general and roi.get("margin_pct"):
        rep.add(FAIL, "general",
                "roi.margin_pct is set; a general proposal is the one written because "
                "the margin was never given. Use the specific template, or set it to 0.")
        if data.get("cost"):
            rep.add(FAIL, "general", "a general proposal carries `arithmetic`, not `cost`; "
                                     "both would print eight sheets")

    if blind and data.get("sign") is not False and data.get("start_steps"):
        rep.add(WARN, "blind", "this document carries a signature block. Nothing has been "
                               "discussed yet, so the reader is being asked to countersign a "
                               "guess; set sign: false and end on the cta instead.")

    sheets = expected_sheets(data)
    if len(data.get("solution") or []) != 5:
        rep.add(WARN, "schema solution",
                f"{len(data.get('solution') or [])} fixes, not the five steps PATTERNS.md describes")
    if sheets > 7:
        rep.add(WARN, "schema", f"{sheets} sheets; seven is the ceiling")
    return sheets


def expected_sheets(data: dict[str, Any]) -> int:
    """How many sheets this data file should produce, mirroring the
    conditions in renderDoc one for one."""
    n = 1                                              # the cover, always
    if (data.get("funnel") or data.get("gap_points") or data.get("quotes")
            or data.get("pattern") or data.get("pattern_groups")):
        n += 1
    if (data.get("tree") or {}).get("branches"):
        n += 1
    if (data.get("cost") or {}).get("layers"):
        n += 1
    arith = data.get("arithmetic") or {}
    has_arith = (bool(arith.get("project_values")) or bool(arith.get("project_value"))
                 or bool(arith.get("project_value_low")))
    if has_arith and not arith.get("inline"):
        n += 1
    if data.get("problems"):
        n += 1
    for key in ("solution", "investment", "start_steps"):
        if data.get(key):
            n += 1
    return n


def client_strings(data: dict[str, Any]) -> list[tuple[str, str]]:
    """Every client-facing string, with the path it came from. Deliberately not
    a walk of the whole file: the proof block, the terms and the five steps are
    ours and say the same thing to everybody."""
    out: list[tuple[str, str]] = []
    for key in CLIENT_PROSE:
        if isinstance(data.get(key), str):
            out.append((key, data[key]))

    for block, fields in CLIENT_PROSE_BLOCKS.items():
        b = data.get(block) or {}
        if not isinstance(b, dict):
            continue
        for f in fields:
            if isinstance(b.get(f), str):
                out.append((block + "." + f, b[f]))

    for i, st in enumerate((data.get("funnel") or {}).get("stages") or []):
        for f in ("label", "note", "display"):
            if isinstance(st.get(f), str):
                out.append(("funnel.stages[%d].%s" % (i, f), st[f]))

    for i, g in enumerate(data.get("gap_points") or []):
        for f in ("v", "k"):
            if isinstance(g.get(f), str):
                out.append(("gap_points[%d].%s" % (i, f), g[f]))

    for i, br in enumerate((data.get("tree") or {}).get("branches") or []):
        for f in ("title", "note"):
            if isinstance(br.get(f), str):
                out.append(("tree.branches[%d].%s" % (i, f), br[f]))
        for j, sb in enumerate(br.get("subs") or []):
            for f in ("title", "note"):
                if isinstance(sb.get(f), str):
                    out.append(("tree.branches[%d].subs[%d].%s" % (i, j, f), sb[f]))

    for i, lay in enumerate((data.get("cost") or {}).get("layers") or []):
        for f in ("name", "note", "instead"):
            if isinstance(lay.get(f), str):
                out.append(("cost.layers[%d].%s" % (i, f), lay[f]))
    return out


def every_string(data: Any, path: str = "") -> Iterable[tuple[str, str]]:
    """Every string anywhere, for the checks that do not care whose words."""
    if isinstance(data, dict):
        for k, v in data.items():
            yield from every_string(v, path + "." + k if path else k)
    elif isinstance(data, list):
        for i, v in enumerate(data):
            yield from every_string(v, "%s[%d]" % (path, i))
    elif isinstance(data, str):
        yield path, data


def content_strings(data: dict[str, Any]) -> Iterable[tuple[str, str]]:
    """Every string a reader could read: not the images, not the offer stamp."""
    for path, text in every_string(data):
        top = re.split(r"[.\[]", path, 1)[0]
        if top in NOT_CONTENT or text.startswith("data:"):
            continue
        yield path, text


def our_numbers(data: dict[str, Any], resolved: dict[str, Any], offer: Optional[dict[str, Any]] = None) -> set[int]:
    """Figures that are ours, not the client's, so evidence does not apply:
    the chosen offer in dollars and in the local currency, the engagement,
    and the arithmetic page's own inputs and outputs."""
    roi = data.get("roi") or {}
    arith = data.get("arithmetic") or {}
    fee = roi.get("fee_usd") or 0
    ads = roi.get("ad_monthly_usd") or 0
    months = roi.get("months") or 3
    rate = roi.get("usd_rate") or 1

    base = offer_mod.figures(resolved, offer)
    ours = set(base) | {int(round(n * rate)) for n in base}
    ours |= {
        # the standing funnel arithmetic
        75, 30, 25, 20, 15, 10,
        # the engagement, in both currencies it can be quoted in
        int(fee + ads * months), int((fee + ads * months) * rate),
        int(ads * months), int(fee * rate), int(ads * rate),
    }
    total = (fee + ads * months) * rate
    for m in (arith.get("margins") or []):
        if m:
            ours.add(int(round(total / (m / 100.0))))
    for v in (arith.get("project_values") or []):
        if v:
            ours.add(int(v))
    if arith.get("project_value"):
        ours.add(int(arith["project_value"]))
    return {n for n in ours if n}


# ----------------------------------------------------------- prose figures ---
def check_prose(data: dict[str, Any], said: Optional[set[int]], rep: Report, resolved: dict[str, Any],
                offer: Optional[dict[str, Any]], checked_note: str = "") -> None:
    """Every figure in client-facing text, not only the five in the schema. A
    number in the headline, the subhead or the verdict block reached the client
    unexamined, and those are the lines a reader believes first."""
    if said is None:
        if checked_note:
            rep.add(PASS, "prose", checked_note)
        else:
            rep.add(WARN, "prose", "no transcript; figures in the copy are unverified")
        return

    ours = our_numbers(data, resolved, offer)
    derived: set[int] = set()
    roi = data.get("roi") or {}
    avg, margin = roi.get("avg_project_value"), roi.get("margin_pct")
    if isinstance(avg, (int, float)) and isinstance(margin, (int, float)) and avg and margin:
        per = avg * margin / 100.0
        for mult in range(1, 6):
            for every in (1, 2, 3, 4, 6, 12):
                derived.add(int(round(per * mult / every)))
                derived.add(int(round(per * mult / every * 12)))

    bad = []
    for path, text in client_strings(data):
        for raw in re.findall(r"\d[\d,]*", text.translate(ARABIC_DIGITS)):
            n = int(raw.replace(",", "") or 0)
            if n < HARD_EVIDENCE_FLOOR:
                continue
            if n in said or n in ours or n in derived:
                continue
            bad.append("%s: %s" % (path, raw))

    if bad:
        rep.add(FAIL, "prose",
                "%d figure(s) in the copy were never said on the call: %s"
                % (len(bad), "; ".join(bad[:6]) + (" ..." if len(bad) > 6 else "")))
    else:
        rep.add(PASS, "prose", "every figure in the copy is the client's or ours")


# ------------------------------------------------------------------ brand ---
def check_brand(data: dict[str, Any], rep: Report) -> None:
    """The house rules, which are absolute and cost nothing to hold."""
    dashes, emoji = [], []
    for path, text in content_strings(data):
        if EM_DASH in text:
            dashes.append(path)
        if EMOJI.search(text):
            emoji.append(path)
    if dashes:
        rep.add(FAIL, "brand", "em dash in %d field(s), which Mahara does not use: %s"
                % (len(dashes), ", ".join(dashes[:5])))
    if emoji:
        rep.add(FAIL, "brand", "emoji in %d field(s): %s" % (len(emoji), ", ".join(emoji[:5])))
    if not dashes and not emoji:
        rep.add(PASS, "brand", "no em dashes, no emoji")


# Fields that are never prose, so never translated. The language check exists
# to catch a half-translated document; a file path, an email address and the
# word "general" are none of them.
NON_PROSE_KEYS = {
    "logo", "cover_image", "image", "url", "src_url",
    "lang", "dir", "variant", "reference", "proof_on", "mode",
}

# And values that are self-evidently machine-shaped wherever they appear: one
# token, no spaces, carrying an @, a scheme, a path separator, or the shape of
# a reference code like MM-2026-0905-BAN. (The original's path alternative had
# an unescaped class that swallowed the line after it; fixed here.)
MACHINE_VALUE = re.compile(
    r"""^(?:
          [^\s@]+@[^\s@]+\.[^\s@]+          # an email
        | [a-z][a-z0-9+.-]*://\S+            # a URL
        | [.~]?[/\\]\S*                      # a path
        | [A-Z0-9][A-Z0-9._-]{3,}            # a code: MM-2026-0905-BAN
        )$""", re.X)


def prose(path: str, text: str) -> bool:
    """Whether this string is something a reader reads, and so translatable."""
    leaf = path.rsplit(".", 1)[-1].split("[")[0]
    if leaf in NON_PROSE_KEYS:
        return False
    if text.startswith("data:"):
        return False
    return not MACHINE_VALUE.match(text.strip())


def check_language(data: dict[str, Any], rep: Report) -> None:
    """A half-translated document is worse than one in either language."""
    arabic_doc = (data.get("lang") or "en") == "ar"
    stray = []
    for path, text in content_strings(data):
        if not prose(path, text):
            continue
        has_arabic = bool(ARABIC.search(text))
        if has_arabic != arabic_doc and has_arabic:
            stray.append(path)
        elif arabic_doc and not has_arabic and re.search(r"[A-Za-z]{6,}", text):
            stray.append(path)
    if stray:
        rep.add(WARN, "language",
                "%d field(s) are not in the document's language: %s"
                % (len(stray), ", ".join(stray[:6])))
    else:
        rep.add(PASS, "language", "one language throughout")


# ------------------------------------------------------------- the offer ---
AD_WORDS = re.compile(r"advertis|\bads?\b|ad budget|ad spend|media budget"
                      r"|إعلان|اعلان|الإعلانات|الاعلانات", re.I)
# A schedule asserted, not merely mentioned: "2 x USD 3,000", "two payments",
# "the second payment", "half at the start", and the Arabic for the same.
SPLIT = re.compile(
    r"(?<![\d,.])\b(?:[1-9]|1[0-2])\s*[x×]\s*(?:[A-Z]{3}\s*)?\d[\d,]{2,}"
    r"|\b(?:two|three|four|2|3|4)\s+(?:equal\s+)?(?:payments|instal+ments|parts)\b"
    r"|\bsecond\s+(?:payment|instal+ment|half)\b"
    r"|\bhalf\s+(?:at|up)\s*(?:the\s+)?(?:start|front|signing)\b"
    r"|\b(?:monthly|quarterly)\s+(?:payments|instal+ments)\b"
    r"|دفعتين|على دفعات|(?:ثلاث|أربع|اربع)\s+دفعات|الدفعة الثانية|القسط الثاني|أقساط شهرية|اقساط شهرية|نصف المبلغ",
    re.I)
N_TIMES = re.compile(r"(?<![\d,.])\b([1-9]|1[0-2])\s*[x×]\s*(?:([A-Z]{3})\s*)?(\d[\d,]{2,})")


def price_page(data: dict[str, Any]) -> list[tuple[str, str]]:
    """The strings where the money is printed: the fee table, its total and
    note, the deposit and the terms."""
    inv = data.get("investment") or {}
    out: list[tuple[str, str]] = []
    for i, r in enumerate(inv.get("rows") or []):
        if isinstance(r, dict):
            for f in ("item", "detail", "amount"):
                out.append((f"investment.rows[{i}].{f}", str(r.get(f) or "")))
    for f in ("total_label", "total_amount", "note"):
        out.append((f"investment.{f}", str(inv.get(f) or "")))
    for f in ("deposit_label", "deposit_amount"):
        out.append((f, str(data.get(f) or "")))
    for i, t in enumerate(data.get("terms") or []):
        out.append((f"terms[{i}]", str(t)))
    return [(p, t.translate(ARABIC_DIGITS)) for p, t in out if t]


def _figures(text: str) -> list[int]:
    return [int(x.replace(",", "")) for x in re.findall(r"\d[\d,]*", text) if x.replace(",", "").isdigit()]


def check_offer(data: dict[str, Any], resolved: dict[str, Any], offer: Optional[dict[str, Any]], rep: Report) -> None:
    """The offer, as the closer chose it: price, term, deposit, the payment
    structure with instalments that add up to the price, and the advertising
    on a line of its own. The drafter must not invent a schedule, and must not
    quote a price nobody offered."""
    roi = data.get("roi") or {}
    rate = roi.get("usd_rate") or 1
    cur = resolved["currency"]
    price, months = resolved["price"], resolved["months"]
    before = len(rep.rows)

    def local(n: float) -> int:
        return int(round(n * rate))

    def same(n: int, target: int) -> bool:
        return n == target or (rate != 1 and abs(n - local(target)) <= 1)

    # The roi block drives the computed pages, so it has to be the offer.
    if roi.get("fee_usd") != price:
        rep.add(FAIL, "offer", f"roi.fee_usd is {roi.get('fee_usd')!r}; the offer for this proposal is "
                               f"{offer_mod.money(price, cur)}")
    if roi.get("months") != months:
        rep.add(FAIL, "offer", f"roi.months is {roi.get('months')!r}; the offer for this proposal is "
                               f"{offer_mod.months_words(months)}")
    ads = roi.get("ad_monthly_usd")
    if isinstance(ads, (int, float)) and not (resolved["ads_min"] <= ads <= resolved["ads_max"]):
        rep.add(WARN, "offer", f"roi.ad_monthly_usd is {ads}; the offer's advertising is "
                               f"{resolved['ads_min']:,} to {resolved['ads_max']:,} a month")

    page = price_page(data)
    printed = {n for _p, t in page for n in _figures(t) if n >= 100}

    def shown(amount: int) -> bool:
        return any(same(n, amount) for n in printed)

    if page and not shown(price):
        rep.add(WARN, "offer", f"the price for this proposal, {offer_mod.money(price, cur)}, is not printed on the price page")

    dep = str(data.get("deposit_amount") or "").translate(ARABIC_DIGITS)
    dep_figs = [n for n in _figures(dep) if n >= 100]
    if not dep:
        rep.add(WARN, "offer", f"no deposit_amount; the offer's deposit is {offer_mod.money(resolved['deposit'], cur)}")
    elif dep_figs and not any(same(n, resolved["deposit"]) for n in dep_figs):
        rep.add(FAIL, "offer", f"the deposit printed is {data.get('deposit_amount')}; the offer's is "
                               f"{offer_mod.money(resolved['deposit'], cur)}")

    rows_all = list((data.get("investment") or {}).get("rows") or [])
    rows = [r for r in rows_all if isinstance(r, dict)]
    ad_rows = [r for r in rows if AD_WORDS.search(f"{r.get('item') or ''} {r.get('detail') or ''}")]
    if rows and not ad_rows:
        rep.add(FAIL, "offer", "the advertising budget is not its own line on the price page; it is always "
                               "separate from the fee")
    for r in ad_rows:
        for n in _figures(str(r.get("amount") or "").translate(ARABIC_DIGITS)):
            if n < 100:
                continue
            lo, hi = resolved["ads_min"], resolved["ads_max"]
            if not (lo <= n <= hi or (rate != 1 and local(lo) - 1 <= n <= local(hi) + 1)):
                rep.add(WARN, "offer", f"the advertising line says {r.get('amount')}; the offer's range is "
                                       f"{cur} {lo:,} to {hi:,} a month")

    instalments = [int(p["amount"]) for p in resolved["instalments"]]
    # The split rule is about our fee. The advertising line is paid monthly to
    # the platforms, and saying so is not a payment plan.
    ad_paths = {f"investment.rows[{i}]." for i, r in enumerate(rows_all) if r in ad_rows}
    fee_page = [(p, t) for p, t in page if not any(p.startswith(a) for a in ad_paths)]
    if len(instalments) == 1:
        hits = [p for p, t in fee_page if SPLIT.search(t)]
        if hits:
            rep.add(FAIL, "offer", "the closer chose payment in full, and the price page prints a split in "
                                   + ", ".join(hits[:4]) + ". Print no schedule nobody chose.")
    else:
        missing = [a for a in sorted(set(instalments)) if not shown(a)]
        if missing:
            rep.add(FAIL, "offer", "the plan the closer chose pays " + ", ".join(offer_mod.money(a, cur) for a in instalments)
                                   + "; not printed: " + ", ".join(offer_mod.money(a, cur) for a in missing))
    for p, t in fee_page:
        for m in N_TIMES.finditer(t):
            n, amount = int(m.group(1)), int(m.group(3).replace(",", ""))
            if amount >= 100 and not same(n * amount, price):
                rep.add(FAIL, "offer", f"{p} prints '{m.group(0)}', which adds up to {n * amount:,}, "
                                       f"not the price of {offer_mod.money(price, cur)}")

    amounts = " ".join(str(r.get("amount") or "") for r in rows)
    amounts += " " + str((data.get("investment") or {}).get("total_amount") or "") + " " + str(data.get("deposit_amount") or "")
    found = set(_figures(amounts.translate(ARABIC_DIGITS)))
    allowed = our_numbers(data, resolved, offer) | {3, 2, 6, 12}
    odd = sorted(n for n in found if n >= 100 and n not in allowed)
    if odd:
        rep.add(WARN, "offer", "figures on the price page that are not in the chosen offer: %s"
                % ", ".join("{:,}".format(n) for n in odd[:5]))

    if len(rep.rows) == before:
        plan = ("paid in full" if len(instalments) == 1 else
                " + ".join(offer_mod.money(a, cur) for a in instalments))
        rep.add(PASS, "offer", f"{offer_mod.money(price, cur)} over {offer_mod.months_words(months)}, {plan}, "
                               f"deposit {offer_mod.money(resolved['deposit'], cur)}, advertising on its own line")


# The guarantee. A promise of free work or money back is what the guarantee
# is, so printing one nobody chose fails; the word alone, which Arabic also
# uses for "to ensure", only warns.
PROMISE = re.compile(
    r"\bno\s+(?:further|extra|additional)\s+fees?\b|money[- ]back|\brefund(?:s|ed)?\b"
    r"|\bkeep\s+working\b[^.]{0,60}\b(?:free|no\s+(?:further|extra|additional))"
    r"|\bwork(?:ing)?\s+for\s+free\b|\bfor\s+free\s+until\b"
    r"|(?:نعمل|نشتغل|نستمر)[^.]{0,40}(?:مجانا|ببلاش|بلاش)"
    r"|بدون رسوم إضافية|دون رسوم إضافية|بلا رسوم إضافية|بدون أي رسوم إضافية|استرداد|نسترد"
    r"|نعيد (?:لك )?المبلغ|إعادة المبلغ|نستمر[^.]{0,60}(?:مجانا|بدون مقابل|دون مقابل|بدون رسوم|دون رسوم)",
    re.I)
MENTION = re.compile(r"\bguarantee[ds]?\b|free of charge|\bat no (?:extra|further|additional) cost\b"
                     r"|ضمان|نضمن|مضمون|مجانا|بدون مقابل|دون مقابل", re.I)
_TASHKEEL = re.compile("[ً-ْٰـ]")


def _plain(text: str) -> str:
    return _TASHKEEL.sub("", unicodedata.normalize("NFC", text))


def check_guarantee(data: dict[str, Any], resolved: dict[str, Any], rep: Report) -> None:
    promised = [p for p, t in content_strings(data) if PROMISE.search(_plain(t))]
    mentioned = [p for p, t in content_strings(data) if MENTION.search(_plain(t))]
    if resolved["guarantee"]:
        if promised or mentioned:
            rep.add(PASS, "guarantee", "the guarantee the closer chose is stated (" + ", ".join((promised or mentioned)[:2]) + ")")
        else:
            rep.add(WARN, "guarantee", "the closer chose the guarantee and the document does not state it; "
                                       "add it as one line in the terms")
        return
    if promised:
        rep.add(FAIL, "guarantee", "the closer chose no guarantee, and the document promises one in "
                                   + ", ".join(promised[:4]) + ". Take it out.")
    elif mentioned:
        rep.add(WARN, "guarantee", "no guarantee was chosen, and " + ", ".join(mentioned[:4])
                                   + " reads like one. Check it promises nothing.")
    else:
        rep.add(PASS, "guarantee", "no guarantee was chosen and none is promised")


# Arabic month names, so an Arabic proposal's expiry date is checked like any
# other. Both naming systems: the Levant and Iraq use كانون الثاني and شباط,
# the Gulf and Egypt the transliterated يناير and فبراير.
ARABIC_MONTHS = {
    "يناير": 1, "فبراير": 2, "مارس": 3, "أبريل": 4, "ابريل": 4,
    "مايو": 5, "يونيو": 6, "يوليو": 7, "أغسطس": 8, "اغسطس": 8,
    "سبتمبر": 9, "أكتوبر": 10, "اكتوبر": 10,
    "نوفمبر": 11, "ديسمبر": 12,
    "كانون الثاني": 1, "شباط": 2, "آذار": 3, "اذار": 3,
    "نيسان": 4, "أيار": 5, "ايار": 5, "حزيران": 6, "تموز": 7,
    "آب": 8, "اب": 8, "أيلول": 9, "ايلول": 9,
    "تشرين الأول": 10, "تشرين الاول": 10,
    "تشرين الثاني": 11, "كانون الأول": 12, "كانون الاول": 12,
}


def arabic_date(raw: str) -> str:
    """An Arabic date in the English shape strptime already reads. Longest
    month name first, so كانون الثاني is not matched as كانون."""
    text = raw.translate(ARABIC_DIGITS).replace("،", " ")
    for name in sorted(ARABIC_MONTHS, key=len, reverse=True):
        if name in text:
            text = text.replace(name, datetime(2000, ARABIC_MONTHS[name], 1).strftime("%B"))
            break
    return " ".join(text.split())


# ------------------------------------------------------------------ dates ---
def check_dates(data: dict[str, Any], rep: Report, today: Optional[date] = None) -> None:
    raw = str(data.get("valid_until") or "").strip()
    if not raw:
        rep.add(WARN, "dates", "no valid_until on the cover")
        return
    when = None
    for fmt in ("%d %B %Y", "%d %b %Y", "%Y-%m-%d"):
        try:
            when = datetime.strptime(arabic_date(raw), fmt).date()
            break
        except ValueError:
            continue
    if when is None:
        rep.add(WARN, "dates", "valid_until %r is not a date this can read" % raw)
        return
    if when < (today or date.today()):
        rep.add(WARN, "dates", "valid until %s, which has passed" % raw, send=FAIL)
    else:
        rep.add(PASS, "dates", "valid until %s" % raw)


# ----------------------------------------------------------------- echoes ---
def check_echoes(data: dict[str, Any], rep: Report) -> None:
    """The same sentence twice on a page reads as a mistake, because it is one."""
    tree = data.get("tree") or {}
    arith = data.get("arithmetic") or {}
    cand = {
        "headline": data.get("headline"), "subhead": data.get("subhead"),
        "gap_title": data.get("gap_title"), "gap_close": data.get("gap_close"),
        "tree_title": data.get("tree_title"), "tree.title": tree.get("title"),
        "tree.goal": tree.get("goal"), "solution_title": data.get("solution_title"),
        "solution_close": data.get("solution_close"),
        "arithmetic.title": arith.get("title"),
        "arithmetic.table_title": arith.get("table_title"),
        "arithmetic.close": arith.get("close"),
    }
    seen: dict[str, str] = {}
    dupes = []
    for k, v in cand.items():
        if not isinstance(v, str) or len(v.strip()) < 12:
            continue
        key = re.sub(r"\s+", " ", v.strip().lower())
        if key in seen:
            dupes.append("%s repeats %s" % (k, seen[key]))
        seen[key] = k
    if dupes:
        rep.add(WARN, "echoes", "; ".join(dupes))
    else:
        rep.add(PASS, "echoes", "nothing printed twice")


# --------------------------------------------------------------- currency ---
def check_currency(data: dict[str, Any], rep: Report) -> None:
    used = set()
    for block in ("cost", "arithmetic", "roi"):
        b = data.get(block) or {}
        for key in ("local_currency", "currency"):
            if b.get(key):
                used.add(str(b[key]).upper())
    for _path, text in client_strings(data):
        for c in CURRENCIES:
            if re.search(r"\b%s\b" % c, text):
                used.add(c)
    if len(used) > 1:
        rep.add(WARN, "currency", "the money is quoted in more than one currency: %s" % ", ".join(sorted(used)))
    elif used:
        rep.add(PASS, "currency", "priced throughout in %s" % used.pop())


# --------------------------------------------------------------- evidence ----
def transcript_numbers(text: str) -> set[int]:
    """Every number the client could have said, in the forms they say them.
    "400 ألف" and "أربعمائة ألف" are the same figure; only the first survives as
    digits, so 400000 has to match a spoken 400."""
    text = text.translate(ARABIC_DIGITS)
    found: set[int] = set()
    for raw in re.findall(r"\d[\d,،.]*", text):
        cleaned = raw.replace(",", "").replace("،", "").rstrip(".")
        if not cleaned:
            continue
        for part in cleaned.split("."):
            if part.isdigit():
                n = int(part)
                found.add(n)
                for scale in (1_000, 10_000, 100_000, 1_000_000):
                    found.add(n * scale)

    lowered = text.lower()
    for n, words in NUMBER_WORDS.items():
        if any(w in lowered for w in words):
            found.add(n)
            for scale in (1_000, 100_000, 1_000_000):
                found.add(n * scale)
    return found


def numbers_in(value: Any) -> list[int]:
    """Pull the numbers out of a field, whether it is a number or prose."""
    if isinstance(value, bool) or value is None:
        return []
    if isinstance(value, (int, float)):
        return [int(value)] if float(value).is_integer() else []
    out = []
    for raw in re.findall(r"\d[\d,]*", str(value).translate(ARABIC_DIGITS)):
        cleaned = raw.replace(",", "")
        if cleaned.isdigit():
            out.append(int(cleaned))
    return out


def check_evidence(data: dict[str, Any], said: Optional[set[int]], rep: Report, checked_note: str = "") -> None:
    if said is None:
        if checked_note:
            rep.add(PASS, "evidence", checked_note)
        else:
            rep.add(WARN, "evidence", "no transcript; every number is unverified")
        return

    roi = data.get("roi") or {}
    derived: set[int] = set()
    avg, margin = roi.get("avg_project_value"), roi.get("margin_pct")
    if isinstance(avg, (int, float)) and isinstance(margin, (int, float)):
        per_project = avg * margin / 100
        for mult in range(1, 6):                       # one to five projects
            # The cost page is monthly, but a million-riyal contract signs
            # quarterly. "One more project every N months" is a modelling
            # choice the page has to be able to state.
            for every in (1, 2, 3, 4, 6, 12):
                monthly = per_project * mult / every
                derived.add(int(round(monthly)))
                derived.add(int(round(monthly * 12)))

    claims = []
    for i, p in enumerate(data.get("gap_points") or []):
        claims.append((f"gap_points[{i}].v", p.get("v")))
    for i, s in enumerate((data.get("funnel") or {}).get("stages") or []):
        claims.append((f"funnel.stages[{i}].display", s.get("display")))
    for i, layer in enumerate((data.get("cost") or {}).get("layers") or []):
        claims.append((f"cost.layers[{i}].monthly", layer.get("monthly")))
    for key in ("avg_project_value", "margin_pct"):
        claims.append((f"roi.{key}", roi.get(key)))

    unverified, soft, ok, drv = [], [], 0, 0
    for path, value in claims:
        for n in [n for n in numbers_in(value) if n != 0]:
            if n in said:
                ok += 1
            elif n in derived:
                drv += 1
            elif n >= HARD_EVIDENCE_FLOOR:
                unverified.append(f"{path}={n:,}")
            else:
                soft.append(f"{path}={n}")

    if unverified:
        rep.add(FAIL, "evidence", f"{len(unverified)} figure(s) never said on the call: " + "; ".join(unverified))
    else:
        rep.add(PASS, "evidence", f"{ok} figure(s) quoted from the call, {drv} derived from them")
    if soft:
        rep.add(WARN, "evidence counts",
                "not found as digits or words, and small enough that the check cannot be sure: "
                "read them back against the call: " + "; ".join(soft))


# ----------------------------------------------------------- the quotes ----
def check_quotes(data: dict[str, Any], rep: Report) -> None:
    """There is no quotes block, so carrying one is the failure. It was the
    general variant's first page until 7 September 2026, and three drafts
    running filled it with speech-recognition wreckage in quotation marks."""
    quotes = data.get("quotes") or []
    if quotes:
        rep.add(FAIL, "quotes",
                "%d quote(s) in the deal file. The \"In their words\" block was "
                "removed on 7 September 2026 and renders nothing: delete the key. "
                "The page is carried by the funnel, the three figures, or the "
                "pattern." % len(quotes))


# --------------------------------------------------------- the arithmetic ----
def check_arithmetic(data: dict[str, Any], rep: Report) -> None:
    """The general variant's fee band: the table divides the real engagement,
    and it is not rigged. A table whose every row says "less than one project"
    has had its cheapest row quietly removed."""
    a = data.get("arithmetic") or {}
    roi = data.get("roi") or {}
    threshold = a.get("mode") == "threshold"
    margin_mode = a.get("mode") == "margin"
    volume_mode = a.get("mode") == "volume"
    values = [v for v in (a.get("project_values") or []) if v]
    margins = [m for m in (a.get("margins") or [10, 20]) if m]
    grid = list(values)
    if margin_mode:
        values = [a.get("project_value")] if a.get("project_value") else []
    if volume_mode:
        values = [a.get("project_value_low")] if a.get("project_value_low") else []

    # A grid wearing the wrong label is still a grid: the renderer tests
    # project_values first and draws the grid whatever the mode says.
    if not values and grid:
        rep.add(WARN, "arithmetic",
                "mode is %r but the table is a %d-value grid, so it is read as a "
                "grid. Drop the mode key, or give it the single project_value "
                "that mode means." % (a.get("mode"), len(grid)))
        values, margin_mode, volume_mode = grid, False, False

    if not values and not (threshold and margins):
        rep.add(FAIL, "arithmetic",
                "the break-even table has no rows: no project_values, and mode "
                "%r has no single value either" % (a.get("mode") or "grid"))
        return

    months = a.get("months") or roi.get("months") or 3
    from_roi = ((roi.get("fee_usd") or 0)
                + (roi.get("ad_monthly_usd") or 0) * months) * (roi.get("usd_rate") or 1)
    total = a.get("engagement_total") or from_roi
    if from_roi and abs(total - from_roi) > 1:
        rep.add(FAIL, "arithmetic",
                f"engagement_total {total:,.0f} is not what the roi block adds up to "
                f"({from_roi:,.0f}); the two pages would contradict each other")
        return
    if not total:
        rep.add(FAIL, "arithmetic", "no engagement total, so the table divides into nothing")
        return

    cur = a.get("currency") or "USD"
    if volume_mode:
        add_low = a.get("target_additional_low")
        add_high = a.get("target_additional_high") or add_low
        if not add_low:
            rep.add(FAIL, "arithmetic",
                    "volume mode needs target_additional_low: the whole page is the "
                    "engagement against the projects the term is meant to add")
            return
        need = total / values[0]
        detail = ("%s %s over %s months needs %.1f of a %s %s project, against %s to %s "
                  "additional projects targeted"
                  % (cur, f"{total:,.0f}", months, need, cur, f"{values[0]:,.0f}", add_low, add_high))
        if need <= add_low:
            rep.add(PASS, "arithmetic", detail)
        elif need <= add_high:
            rep.add(WARN, "arithmetic", detail + ": only the upper end of the target covers it")
        else:
            rep.add(FAIL, "arithmetic", detail + ": even the whole target does not cover the engagement")
        return

    if margin_mode:
        need = total / values[0] * 100
        detail = ("one project of %s %s covers %s %s at %.1f%% kept"
                  % (cur, f"{values[0]:,.0f}", cur, f"{total:,.0f}", need))
        if need > 33:
            rep.add(FAIL, "arithmetic", detail + ": more than a third of one project, which no contractor will accept")
        elif need > 20:
            rep.add(WARN, "arithmetic", detail + ": high; check the project value is the average")
        else:
            rep.add(PASS, "arithmetic", detail)
        return

    if threshold:
        needed = sorted(total / (m / 100) for m in margins)
        rep.add(PASS, "arithmetic",
                f"{len(margins)} margins against {cur} {total:,.0f}, "
                f"one project from {needed[0]:,.0f} to {needed[-1]:,.0f}")
        if needed[-1] / needed[0] < 2:
            rep.add(WARN, "arithmetic",
                    "the margins are too close together for the table to be worth printing; "
                    "spread them so a reader can actually find his own")
        return

    counts = [[total / (v * m / 100) for m in margins] for v in values]
    under = sum(1 for row in counts if all(c < 1 for c in row))
    over = sum(1 for row in counts if any(c >= 1 for c in row))
    best, worst = min(min(r) for r in counts), max(max(r) for r in counts)
    detail = (f"{len(values)} rows x {len(margins)} margins against "
              f"{cur} {total:,.0f}, {best:.1f} to {worst:.1f} projects")
    if not under:
        rep.add(FAIL, "arithmetic", detail + ": not one row breaks even inside a single "
                                             "project, so the table argues against the fee")
    else:
        rep.add(PASS, "arithmetic", detail + f", {under} row(s) under one project")
    if not over:
        rep.add(WARN, "arithmetic",
                "every row breaks even inside one project. Add a lower project value so "
                "the reader can see the table was not built to flatter us.")


# --------------------------------------------------------------- fee band ----
def check_fee_band(data: dict[str, Any], rep: Report) -> Optional[float]:
    roi = data.get("roi") or {}
    cost = data.get("cost") or {}
    rate = roi.get("usd_rate") or 1
    fee = roi.get("fee_usd") or 0
    months = roi.get("months") or 0
    ads = roi.get("ad_monthly_usd") or 0

    engagement_local = (fee + ads * months) * rate
    annual_gap = sum((layer.get("monthly") or 0) for layer in (cost.get("layers") or [])
                     if isinstance(layer.get("monthly") or 0, (int, float))) * 12
    cur = cost.get("local_currency") or roi.get("local_currency") or ""

    if annual_gap <= 0:
        rep.add(FAIL, "fee band", "no priced layer on the cost page, so the fee is measured against nothing")
        return None

    pct = engagement_local / annual_gap * 100
    detail = (f"{cur} {engagement_local:,.0f} engagement against {cur} {annual_gap:,.0f} a year "
              f"= {pct:.1f}%")
    if pct > 30:
        rep.add(FAIL, "fee band", detail + ": above 30%, the case is being stretched")
    elif pct < 10:
        rep.add(FAIL, "fee band", detail + ": below 10%, so the gap is priced larger than the "
                                           "argument needs; re-derive it or the reader will")
    else:
        rep.add(PASS, "fee band", detail)
    return pct


# ---------------------------------------------------------------- who for ---
def check_identity(data: dict[str, Any], rep: Report) -> None:
    """A missing company name is a gap of its own kind: the name is on the
    cover and in every running head. It fails both gates, and the fix needs no
    re-draft: the closer sets the field and the document is rebuilt."""
    name = str(data.get("client_company") or "").strip()
    if name.upper() in ("", "FILL"):
        rep.add(FAIL, "identity",
                "client_company is %r, so the cover and every running head say "
                "FILL. Set it and rebuild; this does not need the engine."
                % (data.get("client_company"),))
    else:
        rep.add(PASS, "identity", "made out to %s" % name)


# ----------------------------------------------------------- placeholders ----
def dotted(path: str) -> str:
    """`investment.rows[0].amount` as `investment.rows.0.amount`: the form the
    cockpit and sales-api `proposal.fill` address a blank by."""
    return re.sub(r"\[(\d+)\]", r".\1", path)


def fill_fields(data: dict[str, Any]) -> list[str]:
    """Which fields the closer still has to fill, named rather than counted."""
    return [dotted(path) for path, text in content_strings(data) if FILL_RE.search(text) or "X,XXX" in text]


def count_fills(data: dict[str, Any]) -> int:
    return sum(len(FILL_RE.findall(t)) + t.count("X,XXX") for _p, t in content_strings(data))


# ----------------------------------------------------------------- render ----
def live_dom(out: str) -> str:
    """The rendered page without what is not the document. The template builds
    its pages from JS, so its own markup sits in a script block; the editor
    panel carries sample data; the opening comment quotes a placeholder."""
    live = re.sub(r"<script\b.*?</script>", "", out, flags=re.S | re.I)
    live = re.sub(r"<template\b.*?</template>", "", live, flags=re.S | re.I)
    live = re.sub(r"<aside\b.*?</aside>", "", live, flags=re.S | re.I)
    return re.sub(r"<!--.*?-->", "", live, flags=re.S)


def check_render(dom: Optional[str], expected: int, rep: Report, engine: str = "") -> Optional[int]:
    if not dom:
        rep.add(WARN, "render",
                "no browser on this machine could render the page (%s); the page count "
                "and overflow check were skipped, so read the document by hand" % (engine or "none"))
        return None
    live = live_dom(dom)
    sheets = len(re.findall(r'class="sheet(?:\s[^"]*)?"', live))
    over = len(re.findall(r'class="sheet[^"]*\bover\b[^"]*"', live))
    if sheets == expected:
        rep.add(PASS, "render", f"{sheets} sheets, as expected")
    else:
        rep.add(FAIL, "render", f"{sheets} sheets, expected {expected}")
    if over:
        rep.add(FAIL, "render", f"{over} page(s) overflow A4: trim before sending")
    else:
        rep.add(PASS, "render", "no page overflows A4")
    return sheets


def validate(data: dict[str, Any], transcript: Optional[str] = None, *, resolved: Optional[dict[str, Any]] = None,
             offer: Optional[dict[str, Any]] = None, dom: Optional[str] = None, engine: str = "",
             checked_note: str = "", today: Optional[date] = None) -> Result:
    """Both gates in one pass. `transcript` is the evidence; `resolved` is the
    offer the closer chose (read from the deal's own stamp when not given);
    `dom` is the rendered page, or None when no browser could render it.
    `checked_note` stands in for the evidence rows when the figures were
    checked against the call at draft time and the transcript is not at hand."""
    if offer is None:
        offer = offer_mod.load()
    if resolved is None:
        resolved = offer_mod.from_deal(data, offer)
    said = transcript_numbers(transcript) if transcript is not None else None

    variant = (data.get("variant") or "").lower()
    general, blind = variant == "general", variant == "blind"
    rep = Report()
    sheets = check_schema(data, rep, general, blind)
    if not blind:
        check_evidence(data, said, rep, checked_note)
    check_quotes(data, rep)
    pct = None
    if general or blind:
        check_arithmetic(data, rep)
    else:
        pct = check_fee_band(data, rep)
    check_prose(data, said, rep, resolved, offer, checked_note)
    check_brand(data, rep)
    check_language(data, rep)
    check_offer(data, resolved, offer, rep)
    check_guarantee(data, resolved, rep)
    check_identity(data, rep)
    check_dates(data, rep, today)
    check_echoes(data, rep)
    check_currency(data, rep)
    rendered = check_render(dom, sheets, rep, engine)

    fields = fill_fields(data)
    fills = count_fills(data)
    if dom:
        live = live_dom(dom)
        fills = max(fills, len(FILL_RE.findall(live)) + live.count("X,XXX"))
    if fills:
        # A gap is expected in a draft and unacceptable in a send. Same count,
        # different verdict, because the next reader is a different person.
        rep.add(WARN, "placeholders", f"{fills} placeholder(s) still in the document: " + ", ".join(fields[:8])
                + (" ..." if len(fields) > 8 else ""), send=FAIL)
    else:
        rep.add(PASS, "placeholders", "nothing left to fill")
    return Result(rows=rep.rows, expected_sheets=sheets, fills=fills, fill_fields=fields,
                  fee_band_pct=pct, rendered_sheets=rendered)
