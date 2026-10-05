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
from .config import ROOT

# Our record of the case studies a proposal quotes as proof: PATTERNS.md's
# "Numbers quoted as proof". The CEO, 5 October 2026: the written record is
# official, not the figures as a rep says them on a call.
PATTERNS_FILE = ROOT / "PATTERNS.md"

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

# ---- number words, read as figures ----------------------------------------
# A draft that writes "six projects signed" on one page and "two signed" on
# another got through, because only digits were ever read (5 October 2026).
# So a number written in words, English or Arabic (Gulf and Levantine forms
# too), is turned into digits before the evidence, prose and proof checks.
# Whole words only: "someone" is not "one".
_EN_UNITS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven",
             "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"]
_EN_TENS = {"twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60, "seventy": 70, "eighty": 80,
            "ninety": 90}
# kind: n adds, h multiplies what came before by a hundred, s closes a group
# of thousands or millions, S does too but only after a number (the plural).
WORD_VALUES: dict[str, tuple[str, int]] = {w: ("n", i) for i, w in enumerate(_EN_UNITS)}
WORD_VALUES.update({w: ("n", v) for w, v in _EN_TENS.items()})
WORD_VALUES.update({"hundred": ("h", 100), "thousand": ("s", 1_000), "million": ("s", 1_000_000),
                    "billion": ("s", 1_000_000_000)})
for _v, _words in {
    # Not وحدة: in a proposal it is "a unit" (وحدة سكنية) far more often
    # than the Gulf "one" (5 October 2026 review).
    1: "واحد واحدة", 2: "اثنين اثنان إثنين اتنين ثنين اثنتين", 3: "ثلاثة ثلاث تلاتة تلات ثلاثه",
    4: "أربعة اربعة أربع اربع اربعه", 5: "خمسة خمس خمسه", 6: "ستة ست سته", 7: "سبعة سبع سبعه",
    8: "ثمانية ثمان تمانية تمان ثمانيه ثماني", 9: "تسعة تسع تسعه", 10: "عشرة عشر عشره",
    11: "احدعش إحدعش", 12: "اثنعش", 13: "ثلطعش", 14: "اربعطعش", 15: "خمستعش خمسطعش", 16: "سطعش",
    17: "سبعطعش", 18: "ثمنطعش", 19: "تسعطعش",
    20: "عشرين عشرون", 30: "ثلاثين ثلاثون تلاتين", 40: "أربعين اربعين أربعون اربعون", 50: "خمسين خمسون",
    60: "ستين ستون", 70: "سبعين سبعون", 80: "ثمانين ثمانون تمانين", 90: "تسعين تسعون",
    200: "مئتين مئتان مائتين مائتان ميتين", 300: "ثلاثمائة ثلاثمئة ثلثمية ثلاثمية",
    400: "أربعمائة اربعمائة أربعمئة اربعمئة اربعمية", 500: "خمسمائة خمسمئة خمسمية",
    600: "ستمائة ستمئة ستمية", 700: "سبعمائة سبعمئة سبعمية", 800: "ثمانمائة ثمانمئة ثمنمية",
    900: "تسعمائة تسعمئة تسعمية", 2000: "ألفين الفين", 2_000_000: "مليونين",
}.items():
    WORD_VALUES.update({w: ("n", _v) for w in _words.split()})
WORD_VALUES.update({w: ("h", 100) for w in "مئة مائة مية ميه".split()})
WORD_VALUES.update({w: ("s", 1_000) for w in "ألف الف ألفا الفا".split()})
WORD_VALUES.update({w: ("S", 1_000) for w in "آلاف الاف ألاف".split()})
WORD_VALUES.update({"مليون": ("s", 1_000_000), "ملايين": ("S", 1_000_000)})

_TOKEN = re.compile(r"[A-Za-z]+|[ء-ي٠-٩ٱ-ۓ]+")
# A figure with its scale: 149K, USD 2M, 2 million, 450 ألف. A lower-case m is
# left alone: it is as likely to be metres.
_SCALED = re.compile(r"(\d[\d,]*(?:\.\d+)?)\s*(k|K|M|mn|bn|thousand|million|billion|ألف|الف|آلاف|الاف|ألفا|مليون|ملايين)"
                     r"(?![A-Za-z0-9ء-ي])")
_SCALE_OF = {"k": 1_000, "thousand": 1_000, "ألف": 1_000, "الف": 1_000, "آلاف": 1_000, "الاف": 1_000,
             "ألفا": 1_000, "m": 1_000_000, "mn": 1_000_000, "million": 1_000_000, "مليون": 1_000_000,
             "ملايين": 1_000_000, "bn": 1_000_000_000, "billion": 1_000_000_000}


# Modern Standard Arabic's eleven and twelve are two words, the first of
# which is no number on its own: أحد عشر read as 10, اثنا عشر as 10.
_AR_TEENS = [(re.compile(r"(?<![ء-ي])(?:أحد|احد|إحدى|احدى)\s+عشر[ةه]?(?![ء-ي])"), "11"),
             (re.compile(r"(?<![ء-ي])(?:اثنا|اثني|إثنا|إثني|اثنتا|اثنتي)\s+عشر[ةه]?(?![ء-ي])"), "12")]
# "Each one", "no one", "the one channel", "one by one", "كل واحد": the word
# one with no count in it. On 5 October 2026 a note saying what "each one"
# of a stage's quotes cost read as the figure 1, and the funnel check called
# the stage's correct loss a contradiction.
_ONE_WORDS = ("one", "واحد", "واحدة")
_NOT_A_COUNT_BEFORE = {"each", "every", "no", "any", "the", "this", "that", "which", "a", "an", "another",
                       "كل", "أي", "اي", "لا", "ولا"}
_NOT_A_COUNT_AFTER = {"another", "by"}
# A range with one scale for both ends: "225 to 252 thousand", "2 to 3
# million", "٢٢٥ إلى ٢٥٢ ألف". The first end is in the same thousands; read
# alone it was 225 and failed the proof check against the record's 225,000.
_SCALED_RANGE = re.compile(
    r"(\d[\d,]*(?:\.\d+)?)(\s*(?:to|-|–|—|and|or|إلى|الى|حتى|او|أو|و)\s*)(?=(\d[\d,]*(?:\.\d+)?)\s*"
    r"(k|K|M|mn|bn|thousand|million|billion|ألف|الف|آلاف|الاف|ألفا|مليون|ملايين)(?![A-Za-z0-9ء-ي]))")


# Halves and quarters of a scale, as money is said: "half a million", "a
# million and a half", "مليون ونص", "ربع مليون". Read as the scale alone they
# were a million, and a draft saying "half a million" against the client's
# 500,000 failed the prose check.
_FRACTION_SCALES = {"thousand": 1_000, "million": 1_000_000, "billion": 1_000_000_000, "ألف": 1_000, "الف": 1_000,
                    "مليون": 1_000_000}
_FRACTIONS = [
    (re.compile(r"\bhalf\s+(?:a\s+)?(thousand|million|billion)\b", re.I), 0.5, None),
    (re.compile(r"\b(?:a\s+)?quarter\s+(?:of\s+)?(?:a\s+)?(thousand|million|billion)\b", re.I), 0.25, None),
    (re.compile(r"\b(?:a|one|(\d+))\s+(thousand|million|billion)\s+and\s+a\s+half\b", re.I), 1.5, "n"),
    (re.compile(r"(?<![ء-ي])(?:نص|نصف)\s+(مليون|ألف|الف)(?![ء-ي])"), 0.5, None),
    (re.compile(r"(?<![ء-ي])ربع\s+(مليون|ألف|الف)(?![ء-ي])"), 0.25, None),
    (re.compile(r"(?<![ء-ي\d])(?:(\d+)\s+)?(مليون|ألف|الف)\s+و\s?(?:نص|نصف)(?![ء-ي])"), 1.5, "n"),
]


def _fractions(text: str) -> str:
    for rx, share, counted in _FRACTIONS:
        def put(m: "re.Match[str]") -> str:
            if counted:
                n = int(m.group(1)) if m.group(1) else 1
                scale = _FRACTION_SCALES[m.group(2).lower()]
                return str(int(n * scale + scale * (share - 1)))
            return str(int(_FRACTION_SCALES[m.group(1).lower()] * share))
        text = rx.sub(put, text)
    return text


def _range_scale(m: "re.Match[str]") -> str:
    low, high = float(m.group(1).replace(",", "")), float(m.group(3).replace(",", ""))
    if low > high:
        return m.group(0)
    scale = _SCALE_OF[m.group(4).lower() if m.group(4) != "M" else "m"]
    return str(int(round(low * scale))) + m.group(2)


def _word(token: str) -> Optional[tuple[str, int]]:
    """A token's value as a number word, with Arabic's joined "and" (وثلاثين) taken off."""
    low = token.lower()
    if low in WORD_VALUES:
        return WORD_VALUES[low]
    if low.startswith("و") and low[1:] in WORD_VALUES:
        return WORD_VALUES[low[1:]]
    return None


def _scaled(m: "re.Match[str]") -> str:
    n = float(m.group(1).replace(",", ""))
    return str(int(round(n * _SCALE_OF[m.group(2).lower() if m.group(2) != "M" else "m"])))


def spoken_figures(text: str) -> str:
    """The text with every figure as plain digits: Arabic digits, figures with
    a scale (149K, 2 million, ٤٥٠ ألف) and numbers written in words
    (thirty-five, خمسة وثلاثين, two hundred and fifty)."""
    text = _plain(str(text)).translate(ARABIC_DIGITS)
    for rx, digits in _AR_TEENS:
        text = rx.sub(digits, text)
    text = _fractions(text)
    text = _SCALED_RANGE.sub(_range_scale, text)
    text = _SCALED.sub(_scaled, text)
    tokens = list(_TOKEN.finditer(text))
    spans: list[tuple[int, int, int]] = []
    i = 0
    while i < len(tokens):
        first = _word(tokens[i].group(0))
        if first is None or first[0] == "S":
            i += 1
            continue
        group = [first]
        start, end, last = tokens[i].start(), tokens[i].end(), first[0]
        j = i + 1
        while j < len(tokens):
            gap = text[end:tokens[j].start()]
            word = tokens[j].group(0).lower()
            if word in ("and", "و") and j + 1 < len(tokens) and re.fullmatch(r"\s*", gap) \
                    and (word == "و" or last in ("h", "s")) and _word(tokens[j + 1].group(0)):
                end, j = tokens[j].end(), j + 1
                continue
            nxt = _word(tokens[j].group(0))
            if nxt is None or not re.fullmatch(r"[\s-]*", gap):
                break
            group.append(nxt)
            end, last, j = tokens[j].end(), nxt[0], j + 1
        if len(group) == 1 and tokens[i].group(0).lower() in _ONE_WORDS:
            before = tokens[i - 1].group(0).lower() if i > 0 else ""
            after = tokens[j].group(0).lower() if j < len(tokens) else ""
            if (before in _NOT_A_COUNT_BEFORE and re.fullmatch(r"\s*", text[tokens[i - 1].end():start])) or (
                    after in _NOT_A_COUNT_AFTER and re.fullmatch(r"\s*", text[end:tokens[j].start()])):
                i = j
                continue
        total = current = 0
        for kind, v in group:
            if kind == "n":
                current += v
            elif kind == "h":
                current = (current or 1) * v
            else:
                total += (current or 1) * v
                current = 0
        spans.append((start, end, total + current))
        i = j
    for start, end, value in reversed(spans):
        text = text[:start] + str(value) + text[end:]
    return text


def figures_in(text: Any) -> list[int]:
    """Every whole figure in a piece of copy, however it is written."""
    out = []
    for raw in re.findall(r"\d[\d,]*", spoken_figures(str(text or ""))):
        cleaned = raw.replace(",", "")
        if cleaned.isdigit():
            out.append(int(cleaned))
    return out


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
# Local currency to one dollar. All but the dinar are fixed pegs; Kuwait's is a
# basket that has stayed near 0.307 since 2015, close enough for a page that
# rounds to whole dinars.
USD_PEGS = {"USD": 1, "SAR": 3.75, "AED": 3.6725, "QAR": 3.64, "BHD": 0.376, "OMR": 0.3845, "KWD": 0.307}


# What a closer types for a currency, to its code: "dirhams", "SR", "ريال".
# A dinar alone is Kuwait's or Bahrain's, so it is not guessed.
CURRENCY_NAMES = {
    "USD": r"usd|us\s*\$|\$|dollars?|us\s+dollars?|دولار|دولارات|دولار\s+أمريكي",
    "SAR": r"sar|sr|saudi\s+ri[y]?als?|ri[y]?als?|ريال|ريالات|ريال\s+سعودي|ر\.?\s?س\.?",
    "AED": r"aed|dhs?|dirhams?|uae\s+dirhams?|درهم|دراهم|درهم\s+إماراتي|د\.?\s?إ\.?",
    "QAR": r"qar|qr|qatari\s+ri[y]?als?|ريال\s+قطري|ر\.?\s?ق\.?",
    "KWD": r"kwd|kd|kuwaiti\s+dinars?|دينار\s+كويتي|د\.?\s?ك\.?",
    "BHD": r"bhd|bd|bahraini\s+dinars?|دينار\s+بحريني|د\.?\s?ب\.?",
    "OMR": r"omr|ro|omani\s+ri[y]?als?|ريال\s+عماني|ر\.?\s?ع\.?",
}
_CURRENCY_NAMES = [(code, re.compile(rf"^(?:{rx})$", re.I)) for code, rx in CURRENCY_NAMES.items()]


def currency_code(text: Any) -> Optional[str]:
    """The three-letter code for a currency as a closer might type it, or
    None when it is not one the page can price in. Longer names first, so a
    Qatari riyal is not taken for a Saudi one."""
    raw = re.sub(r"\s+", " ", _plain(str(text or ""))).strip()
    if not raw:
        return None
    if raw.upper() in USD_PEGS:
        return raw.upper()
    codes = {c.upper() for c in re.findall(r"\b(usd|sar|aed|qar|kwd|bhd|omr)\b", raw, re.I)}
    if len(codes) == 1:
        return codes.pop()
    for code, rx in sorted(_CURRENCY_NAMES, key=lambda c: c[0] == "SAR" or c[0] == "USD"):
        if rx.match(raw):
            return code
    return None


def rate_off(currency: str, rate: Any) -> bool:
    """A dollar rate more than 5% away from the currency's peg."""
    peg = USD_PEGS.get(str(currency).upper())
    if not peg or not isinstance(rate, (int, float)) or isinstance(rate, bool) or rate <= 0:
        return bool(peg)
    return abs(rate - peg) / peg > 0.05

# Keys that are machine data rather than anything a reader reads: images, and
# the offer stamp the desk writes so a deal can be checked again later.
# And the figures the closer typed into the blanks, kept so a fresh draft
# can take them back (sales-api proposal.fill).
NOT_CONTENT = ("logo", "cover_image", "offer", "closer_figures")

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

    # A funnel stage's value is the count its bar is drawn from, as a number
    # (0 when there is none); words go in display. "a handful" in value drew
    # an empty box beside four bold lines of text (5 October 2026).
    stages = ((data.get("funnel") or {}).get("stages") or []) if isinstance(data.get("funnel"), dict) else []
    for i, st in enumerate(stages):
        if not isinstance(st, dict):
            continue
        v = st.get("value")
        if isinstance(v, str) and FILL_RE.search(v):
            continue
        if isinstance(v, bool) or figure(v) is None:
            rep.add(FAIL, "schema funnel", f"funnel.stages[{i}].value is {v!r}; it has to be the stage's count as "
                                           "a number, 0 when there is none, with any words in display")
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
    # renderDoc's own test: a single value draws the page only in its mode,
    # and only as a number (JavaScript's Number(), so a FILL draws nothing).
    mode = arith.get("mode")
    has_arith = (bool(arith.get("project_values"))
                 or (mode == "threshold" and bool(arith.get("margins")))
                 or (mode == "margin" and bool(figure(arith.get("project_value"))))
                 or (mode == "volume" and bool(figure(arith.get("project_value_low")))))
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


def figure(value: Any) -> Optional[float]:
    """A figure the arithmetic page computes with, read the way the template
    reads it (Number()): a number, or a string of plain digits. A FILL, or
    "1,000,000" typed as text, is None: a gap, never a crash. (The cockpit's
    fill already turns a typed figure into a number.)"""
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip()
    return float(text) if re.fullmatch(r"-?\d+(?:\.\d+)?", text) else None


def dec(value: float) -> str:
    """A share or a count of projects the way the template prints one: two
    decimals under 10 (0.35, 1.05), one from there, and a trailing zero
    dropped (0.3, 2.5). One decimal printed 0.35 as 0.3 and 1.05% as 1.1%."""
    text = f"{value:.2f}" if abs(value) < 10 else f"{value:.1f}"
    return text[:-1] if re.search(r"\.\d0$", text) else text


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
    for m in map(figure, arith.get("margins") or []):
        if m:
            ours.add(int(round(total / (m / 100.0))))
    for v in map(figure, [*(arith.get("project_values") or []), arith.get("project_value")]):
        if v:
            ours.add(int(v))
    gross = figure(arith.get("gross_margin"))
    if gross:
        for v in map(figure, [arith.get("project_value"), arith.get("project_value_low"),
                              arith.get("project_value_high")]):
            if v:
                ours.add(int(round(v * gross / 100)))
    return {n for n in ours if n}


# --------------------------------------------------------------- the proof ---
PROOF_SECTION = re.compile(r"^##\s+Numbers quoted as proof.*?$(.*?)(?=^##\s|\Z)", re.M | re.S | re.I)
# Below this a figure is a count of years, months or times ("4x"), which the
# record words in many ways; at or above it, it is the case study's own figure.
PROOF_FLOOR = 10


def proof_record(path: Optional[Any] = None) -> Optional[set[int]]:
    """Every figure in PATTERNS.md's "Numbers quoted as proof", or None when
    the file or the section cannot be read."""
    try:
        text = (path or PATTERNS_FILE).read_text(encoding="utf-8")
    except OSError:
        return None
    m = PROOF_SECTION.search(text)
    if not m:
        return None
    return set(figures_in(m.group(1)))


def check_proof(data: dict[str, Any], rep: Report) -> None:
    """Our case studies are quoted from the record, exactly: never the way a
    rep said them on the call. Every figure of 10 or more in `proof` has to be
    in PATTERNS.md's proof list."""
    items = [x for x in (data.get("proof") or []) if isinstance(x, dict)]
    if not items:
        return
    record = proof_record()
    if record is None:
        rep.add(WARN, "proof", "PATTERNS.md's \"Numbers quoted as proof\" could not be read, so the proof "
                               "figures are unchecked; read them against it by hand")
        return
    bad = []
    for i, item in enumerate(items):
        for key in ("v", "k"):
            for n in figures_in(item.get(key)):
                if n >= PROOF_FLOOR and n not in record:
                    bad.append(f"proof[{i}].{key}: {n:,}")
    if bad:
        rep.add(FAIL, "proof", "%d figure(s) in the proof are not in our record: %s. Copy proof figures exactly "
                               "from PATTERNS.md's \"Numbers quoted as proof\", never from the call"
                % (len(bad), "; ".join(bad[:6]) + (" ..." if len(bad) > 6 else "")))
    else:
        rep.add(PASS, "proof", "every proof figure is from our record")


# ----------------------------------------------------------- prose figures ---
def check_prose(data: dict[str, Any], said: Optional[set[int]], rep: Report, resolved: dict[str, Any],
                offer: Optional[dict[str, Any]], checked_note: str = "") -> None:
    """Every figure in client-facing text, not only the five in the schema. A
    number in the headline, the subhead or the verdict block reached the client
    unexamined, and those are the lines a reader believes first. The proof is
    ours, and is checked against our record whether or not there is a call."""
    check_proof(data, rep)
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
        for n in figures_in(text):
            raw = f"{n:,}"
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
    # "The second USD 3,000 falls due when ...": the reference's own terms[3].
    r"|\bsecond\s+(?:[A-Z]{3}\s*)?\d[\d,]{2,}"
    r"|\bhalf\s+(?:at|up)\s*(?:the\s+)?(?:start|front|signing)\b"
    r"|\b(?:monthly|quarterly)\s+(?:payments|instal+ments)\b"
    r"|دفعتين|على دفعات|(?:ثلاث|أربع|اربع)\s+دفعات|الدفعة الثانية|القسط الثاني|أقساط شهرية|اقساط شهرية|نصف المبلغ",
    re.I)
# A payment tied to a result: the retired split paid its second half "after
# the first contract signs". Since 3 October 2026 the offer is USD 6,000 in
# full, or USD 3,000 and USD 3,000 thirty days later, both on dates. Read
# sentence by sentence: "Paid in full at the start. We begin with your first
# project's campaign" is two sentences, and only one of them is about paying.
# Not a meeting on its own: "thirty days after your first meeting with us" is
# a date from the kickoff. The first meetings booked, or the first ten, are a
# result (_FIRST_MEETINGS).
_RESULT_EVENT = (r"(?:contracts?|projects?|deals?|clients?|sales?|wins?|jobs?|orders?|results?|signatures?|"
                 r"signings?)")
_FIRST_MEETINGS = (r"first\s+(?:\d+\s+)?(?:qualified\s+)?(?:meetings|appointments|leads|bookings)\b"
                   r"|first\s+\d+\s+(?:qualified\s+)?(?:meetings?|appointments?|leads?)\b"
                   r"|first\s+(?:qualified\s+)?(?:meeting|appointment|lead)\s+(?:is\s+)?(?:booked|delivered|held)\b")
# Strong words: a payment that waits "until", "once", "after" a result.
TIED_STRONG = re.compile(
    rf"\b(?:when|once|after|upon|until|till|tied\s+to|linked\s+to|conditional\s+on|subject\s+to|depends\s+on|"
    rf"dependent\s+on)\s+(?:[^\s,،;]+\s+){{0,4}}?(?:first\s+(?:[^\s,،;]+\s+){{0,2}}?{_RESULT_EVENT}\b|{_FIRST_MEETINGS})"
    rf"|\b(?:when|once|after|upon|until|till)\s+(?:[^\s,،;]+\s+){{0,3}}?(?:a|the|your|any)\s+(?:new\s+)?"
    r"(?:contract|project|deal|sale|job|order)\s+(?:is\s+|has\s+been\s+|gets\s+)?(?:signed|closed|won|awarded|booked)\b"
    rf"|\bfirst\s+(?:contract|project|deal|client|sale|job|order)\s+(?:signs|is\s+signed|closes|is\s+closed|is\s+won|lands)\b"
    r"|(?:بعد|عند|حين|لما|لين|حتى|مرتبط\s+ب|مرتبطة\s+ب|مشروط\s+ب|مشروطة\s+ب)\s*(?:[^\s,،;]+\s+){0,3}?"
    r"(?:(?:أول|اول)\s+(?:عقد|مشروع|صفقة|عميل|بيعة|بيع|اجتماع|موعد)"
    r"|(?:العقد|المشروع|الصفقة|العميل|البيع)\s+(?:الأول|الاول|الأولى|الاولى))",
    re.I)
# Weak words ("on", "with", "against", "مع") tie a payment only when the
# payment is right before them: "the rest on your first deal", not "the work
# on your first project brief".
TIED_WEAK = re.compile(
    rf"\b(?:due|payable|paid|pay|payment|balance|rest|remainder|remaining|half|instal+ment|second)\s+"
    rf"(?:[^\s,،;]+\s+){{0,2}}?(?:on|with|against|at)\s+(?:[^\s,،;]+\s+){{0,3}}?first\s+(?:[^\s,،;]+\s+){{0,2}}?{_RESULT_EVENT}\b"
    r"|(?:الدفعة|القسط|المتبقي|الباقي|النصف|المبلغ|تستحق|يستحق|تدفع|يدفع)\s+(?:[^\s,،;]+\s+){0,2}?(?:مع|على)\s+"
    r"(?:[^\s,،;]+\s+){0,2}?(?:أول|اول)\s+(?:عقد|مشروع|صفقة|عميل|بيعة|بيع)",
    re.I)
# A line that is about paying, so a first project mentioned for any other
# reason is left alone. "Pays for itself" is the arithmetic, not a payment.
PAYMENT_WORDS = re.compile(r"\bpa(?:y|id|ys|ying|yment|yments|yable)\b(?!\s+for\s+(?:itself|themselves))"
                           r"|\binstal+ments?\b|\bdue\b|\bbalance\b|\bhalf\b"
                           r"|\bsecond\b|\bremaining\b|\bremainder\b|\brest\b|\bfee\b|\d[\d,]{2,}"
                           r"|دفع|دفعة|الدفعة|القسط|قسط|يستحق|تستحق|المتبقي|الباقي|النصف|نصف|المبلغ|رسوم",
                           re.I)
_PAY_NEGATED = re.compile(r"\b(?:no|not|never|nothing|none)\b|n't|(?:^|\s)(?:لا|ليس|ليست|لن|غير)\s", re.I)


def tied_to_a_result(text: str) -> bool:
    """A sentence about paying that ties the payment to a result: a first
    contract, project, deal, client, sale or meeting, or a contract signed.
    A sentence that says it is not tied ("never waits on a first contract")
    is the honest form."""
    for sentence in re.split(r"(?<=[.!?؟;؛])\s+|\n+", spoken_figures(text)):
        if not PAYMENT_WORDS.search(sentence):
            continue
        for rx in (TIED_STRONG, TIED_WEAK):
            for m in rx.finditer(sentence):
                if not _PAY_NEGATED.search(sentence[:m.start()]):
                    return True
    return False


N_TIMES = re.compile(r"(?<![\d,.])\b([1-9]|1[0-2])\s*[x×]\s*(?:([A-Z]{3})\s*)?(\d[\d,]{2,})")
# A first payment implies a second. Paid in full, the deposit comes off the one
# payment at the start (the references' deposit_label said "the first payment"
# on every draft, 5 October 2026).
FIRST_OF_SEVERAL = re.compile(r"\bfirst\s+(?:payment|instal+ment)\b|الدفعة\s+(?:الأولى|الاولى)|(?:أول|اول)\s+دفعة"
                              r"|القسط\s+(?:الأول|الاول)", re.I)


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
    # By the item first: "Ads" in the program row's description is not the
    # advertising line (5 October 2026). The detail only when no item says it.
    ad_rows = ([r for r in rows if AD_WORDS.search(str(r.get("item") or ""))]
               or [r for r in rows if AD_WORDS.search(str(r.get("detail") or ""))])
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
    tied = [p for p, t in fee_page if tied_to_a_result(t)]
    if tied:
        rep.add(FAIL, "offer", "a payment is tied to the client's first contract, project, deal or sale in "
                + ", ".join(tied[:4]) + ". Payments fall due on dates only: "
                + " and ".join(f"{offer_mod.money(p['amount'], cur)} {p['due']}" for p in resolved["instalments"])
                + ". Take the link to a result out")
    # The total is what is paid to us at the start: the first instalment, in
    # dollars or the local currency. Not the program plus advertising, which
    # reads as one bill (two drafts on 5 October 2026 printed USD 10,500).
    total_text = str((data.get("investment") or {}).get("total_amount") or "").translate(ARABIC_DIGITS)
    total_figs = [n for n in _figures(total_text) if n >= 100]
    if total_figs and not FILL_RE.search(total_text) and not any(same(n, instalments[0]) for n in total_figs):
        rep.add(FAIL, "offer", f"investment.total_amount says {(data.get('investment') or {}).get('total_amount')}; "
                               f"the total is what is paid to us at the start, {offer_mod.money(instalments[0], cur)}. "
                               "Advertising stays on its own line, outside the total")
    if len(instalments) == 1:
        hits = [p for p, t in fee_page if SPLIT.search(t)]
        if hits:
            rep.add(FAIL, "offer", "the closer chose payment in full, and the price page prints a split in "
                                   + ", ".join(hits[:4]) + ". Print no schedule nobody chose.")
        # A warning of its own, not the offer's: the corrected references
        # still say "the first payment", and an offer warning fails a
        # reference (references.STRICT). The drafter is told the right words
        # (offer.prompt_block, prompt.system_for).
        firsts = [p for p, t in fee_page if p not in hits and FIRST_OF_SEVERAL.search(t)]
        if firsts:
            rep.add(WARN, "deposit", "the closer chose payment in full, and " + ", ".join(firsts[:4])
                                     + " speaks of a first payment. There is one payment, at the start: the "
                                       "deposit comes off that")
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


# The guarantee. Since 2026-10-02 it is a 7-day satisfaction guarantee (a
# refund), so printing one nobody chose fails; the word alone, which Arabic
# also uses for "to ensure", only warns. Results are never promised (Aziz:
# "we legally can't give them a result guarantee because everybody's
# different"): free work, or a number of meetings, leads or projects
# guaranteed, fails whatever the closer chose.
PROMISE = re.compile(
    r"\bno\s+(?:further|extra|additional)\s+fees?\b|money[- ]back|\brefund(?:s|ed)?\b"
    r"|\bkeep\s+working\b[^.]{0,60}\b(?:free|no\s+(?:further|extra|additional))"
    r"|\bwork(?:ing)?\s+for\s+free\b|\bfor\s+free\s+until\b"
    r"|(?:نعمل|نشتغل|نستمر)[^.]{0,40}(?:مجانا|ببلاش|بلاش)"
    r"|بدون رسوم إضافية|دون رسوم إضافية|بلا رسوم إضافية|بدون أي رسوم إضافية|استرداد|نسترد"
    r"|نعيد (?:لك )?المبلغ|إعادة المبلغ|نستمر[^.]{0,60}(?:مجانا|بدون مقابل|دون مقابل|بدون رسوم|دون رسوم)"
    r"|(?:نرجع|نرجّع|نرد|نعيد) (?:لك |لكم )?(?:فلوسك|فلوسكم|أموالك|المبلغ)",
    re.I)
MENTION = re.compile(r"\bguarantee[ds]?\b|free of charge|\bat no (?:extra|further|additional) cost\b"
                     r"|ضمان|نضمن|مضمون|مجانا|بدون مقابل|دون مقابل", re.I)
FREE_WORK = re.compile(
    r"\bwork(?:ing)?\s+for\s+free\b|\bfor\s+free\s+until\b"
    r"|\bkeep\s+working\b[^.]{0,60}\b(?:free|no\s+(?:further|extra|additional))"
    # "or we continue at no further fee until you have them" (the reference's
    # terms[2]). Only PROMISE caught it, so a closer who chose the 7-day
    # guarantee would have had it passed as that guarantee.
    r"|\bwe(?:'ll|\s+will)?\s+(?:continue|carry\s+on|keep\s+going)\b[^.]{0,60}?"
    r"\bno\s+(?:further|extra|additional)\s+(?:fees?|costs?|charges?)\b"
    r"|(?:نعمل|نشتغل|نستمر|نكمل)[^.]{0,40}(?:مجانا|ببلاش|بلاش|بدون مقابل|دون مقابل)"
    # The same line in an Arabic draft: "أو نستمر دون رسوم إضافية حتى تكتمل".
    r"|(?:نستمر|نكمل|نواصل)[^.]{0,40}(?:دون|بدون|بلا)\s+(?:أي\s+)?رسوم",
    re.I)
_RESULT = r"(?:results?|appointments?|meetings?|visits?|leads?|projects?|revenue|sales|roi|clients?|bookings?)"
RESULT_GUARANTEED = re.compile(
    rf"\bguarantee[ds]?\b(?:\s+\w+){{0,4}}?\s+(?:\d[\d,]*\s+)?(?:qualified\s+)?{_RESULT}\b"
    rf"|\bguaranteed\s+{_RESULT}\b"
    r"|(?:نضمن|يضمن|تضمن|سنضمن)(?:\s+\S+){0,3}?\s+(?:[٠-٩0-9]+\s+)?"
    r"(?:موعد|مواعيد|موعدا|اجتماع|اجتماعات|اجتماعا|زيارة|زيارات|نتائج|نتيجة|مشاريع|مشروع|مشروعا|عملاء|عميل|ليدز|صفقات|عقود)"
    r"|ضمان\s+(?:على\s+)?(?:ال)?(?:نتائج|مواعيد)",
    re.I)
# The guarantee after the result, closing the clause: "Qualified meetings
# across the three months, guaranteed" (the reference's solution_targets[0]),
# which read as a mere mention and only warned.
RESULT_THEN_GUARANTEED = re.compile(
    rf"\b{_RESULT}\b[^.;:]{{0,80}}?,\s*guaranteed\s*(?:[.;:)]|$)"
    r"|(?:اجتماع|اجتماعات|موعد|مواعيد|زيارة|زيارات|نتائج|مشاريع|مشروع|عملاء)[^.؛:]{0,80}?،\s*مضمون[ةه]?\s*(?:[.؛:)]|$)",
    re.I)
# What the program is "built to deliver": a number of meetings, projects or
# signed work stated as the program's output is a promise of results in all
# but the word (Aziz, 2026-10-05: the meetings figure is "the target we work
# to, not a promise"). The same sentence calling it a target is the honest form.
# Read on the copy with its number words as digits (spoken_figures).
_OUTPUT_NOUN = (rf"(?:{_RESULT}|signed|deals?|contracts?"
                r"|موعد|مواعيد|موعدا|اجتماع|اجتماعات|اجتماعا|زيارة|زيارات|مشروع|مشاريع|مشروعا|عملاء|عميل|"
                r"نتائج|صفقات|صفقة|عقود|عقدا|ليدز)")
BUILT_TO = re.compile(
    # The program, made to produce them: built, designed, set up, engineered.
    r"\b(?:built|designed|made|set\s+up|engineered|structured)\s+to\s+(?:deliver|produce|add|bring|generate|book|get)\b"
    r"|(?:بني|مبني|مبنية|مصمم|مصممة|صمم|صممت)\s+(?:\S+\s+){0,2}?(?:ل|لكي\s+)?"
    r"(?:يحقق|تحقق|يضيف|تضيف|يجلب|تجلب|يولد|تولد|يقدم|تقدم|يوفر|توفر|تحقيق|إضافة|اضافة|جلب|توليد)",
    re.I)
# We, or the program, as the one that delivers them: "the program delivers
# thirty qualified meetings", "we will book 30 meetings", "you will get 30
# meetings", "expect thirty meetings". Past tense is our record, not a promise.
DELIVERS = re.compile(
    r"\b(?:we|the\s+program(?:me)?|this\s+program(?:me)?|our\s+program(?:me)?|the\s+engagement|the\s+system|"
    r"(?:the|our)\s+(?:campaigns?|ads|funnel|call\s+cent(?:re|er)|team))\s+(?:will\s+|'ll\s+|can\s+)?"
    r"(?:deliver|delivers|produce|produces|add|adds|bring|brings|"
    r"generate|generates|book|books|get\s+you|gets\s+you|secure|secures)\b"
    r"|\bwe(?:'ll|\s+will)\s+(?:deliver|produce|add|bring|generate|book|get\s+you|secure)\b"
    r"|\byou(?:'ll|\s+will)\s+(?:get|receive|have|see)\b|\b(?:you\s+can\s+|you\s+should\s+)?expect\b"
    r"|(?:سن|ن)(?:وفر|قدم|حقق|جلب|ضيف|ولد|حجز)(?:\s+لك|\s+لكم)?\s"
    r"|(?:البرنامج|برنامجنا)\s+(?:سي|ي)(?:وفر|قدم|حقق|جلب|ضيف|ولد)|(?:سي|ي)(?:وفر|قدم|حقق|جلب|ضيف|ولد)\s+"
    r"(?:لك\s+|لكم\s+)?(?:البرنامج|برنامجنا)|ستحصل(?:ون)?\s+على",
    re.I)
# The old offer's own sentence, the other way round: "Thirty qualified
# meetings across the term is what the program is built to deliver."
WHAT_IT_DELIVERS = re.compile(
    rf"\d[\d,]*\s+(?:\S+\s+){{0,2}}?{_OUTPUT_NOUN}\b[^.!?]{{0,80}}?\b(?:is|are)\s+what\s+"
    r"(?:the\s+program(?:me)?|this\s+program(?:me)?|we|the\s+engagement)\s+(?:is\s+|was\s+|are\s+)?"
    r"(?:(?:built|designed|made|set\s+up)\s+to\s+)?(?:deliver|produce|add|bring|generate|book)s?\b"
    r"|(?:هو|هي)\s+ما\s+(?:بني|صمم|يقدمه|يحققه|يوفره|يجلبه|سيقدمه|سيحققه|سيوفره|نقدمه|نحققه|نوفره)",
    re.I)
# The client's own firm is built to deliver its projects: "Your team is built
# to deliver projects on time" says nothing of ours. The words just before
# the verb, so "You get a program built to add ..." is still ours.
_CLIENT_SUBJECT = re.compile(
    r"\b(?:your|their)\s+\w+(?:\s+\w+)?\s+(?:is\s+|are\s+|was\s+|were\s+)?$"
    r"|\b(?:you|they)(?:'re|\s+are|\s+were)?\s+$|(?:ك|كم)\s+(?:\S+\s+)?$", re.I)
# "What the program is built to add", with the result left unsaid.
WHAT_IT_IS_BUILT_TO = re.compile(
    r"\bwhat\s+(?:the|this|our)\s+program(?:me)?\s+(?:is|was)\s+(?:built|designed|made|set\s+up)\s+to\s+"
    r"(?:deliver|produce|add|bring|generate)\b", re.I)
TARGET_WORD = re.compile(r"\btargets?\b|\btargeted\b|هدف|الهدف|مستهدف|المستهدف", re.I)
SENTENCE_END = re.compile(r"[.!?؟]")
_NOT = re.compile(r"\b(?:not|never|no|cannot)\b|n't", re.I)
# "We do not guarantee results" says the opposite, so a guarantee of results
# right after a negation is let through.
_NEGATED = re.compile(r"(?:\b(?:not|never|no|cannot)\b|n't|(?:^|\s)(?:ما|مو|لا|ماحد|محد)\s)\s*(?:\S+\s+){0,2}$",
                      re.I)
_TASHKEEL = re.compile("[ً-ْٰـ]")


def _plain(text: str) -> str:
    return _TASHKEEL.sub("", unicodedata.normalize("NFC", text))


def sentence_at(text: str, start: int, end: int) -> str:
    """The sentence a match sits in."""
    before = [m.end() for m in SENTENCE_END.finditer(text, 0, start)]
    after = SENTENCE_END.search(text, end)
    return text[(before[-1] if before else 0):(after.end() if after else len(text))]


def built_to_deliver(text: str) -> bool:
    """Meetings, projects or signed work stated as what we or the program
    will produce, in a sentence that does not call it a target. Built (or
    designed) to deliver them, unless it is the client's firm that is built
    so, or their own clients who are delivered to; we, the program or "you
    will get" with a figure for them; and the old offer's sentence turned
    round ("thirty meetings is what the program is built to deliver")."""
    text = spoken_figures(text)

    def honest(m: "re.Match[str]") -> bool:
        return bool(TARGET_WORD.search(sentence_at(text, m.start(), m.end())) or _NEGATED.search(text[:m.start()]))

    for rx in (BUILT_TO, DELIVERS):
        for m in rx.finditer(text):
            if honest(m):
                continue
            if rx is BUILT_TO and _CLIENT_SUBJECT.search(text[:m.start()][-60:]):
                continue
            after = re.split(r"[.!?؟;؛]", text[m.end():], maxsplit=1)[0][:70]
            for noun in re.finditer(rf"(?:\b|(?<=\s)){_OUTPUT_NOUN}(?![A-Za-z])", after, re.I):
                figure_first = bool(re.search(r"\d", after[:noun.start()]))
                if rx is DELIVERS and not figure_first:
                    continue
                # Delivering to "your clients" is the client's business, not a result of ours.
                if not figure_first and re.search(r"\b(?:your|their|to)\s+$", after[:noun.start()], re.I):
                    continue
                return True
    return any(not honest(m) for rx in (WHAT_IT_DELIVERS, WHAT_IT_IS_BUILT_TO) for m in rx.finditer(text))


# An outcome stated as certain where we describe what we sell: "so small jobs
# never arrive" (180273419's solution row, live check of 5 October 2026),
# "every lead is qualified", "no more wasted meetings", "a calendar that is
# always full". The program filters and lowers; it cannot promise none or all.
# Only the outcome pages are read: the diagnosis may say the large villas
# never arrive, because that is the client's own state. And only an outcome:
# "we never share your data", "never a promise" and "every enquiry called in
# minutes" (what we do, not what the client is sure to get) pass.
_ARRIVE = (r"(?:arrives?|reach(?:es)?\s+(?:you|your|the\s+(?:team|calendar|diary|desk|showroom|office|sales))"
           r"|gets?\s+through|comes?\s+through|lands?\s+(?:on|in)\s+your|makes?\s+it\s+(?:to|through|into)"
           r"|slips?\s+(?:through|away)|goes?\s+(?:cold|unanswered|to\s+waste|missing)|falls?\s+through"
           r"|wastes?\s+your|turns?\s+up|shows?\s+up|misse[sd]|miss|booked|let\s+through)")
_LEAD_NOUN = (r"(?:leads?|enquir(?:y|ies)|inquir(?:y|ies)|meetings?|appointments?|bookings?|visits?|calls?|"
              r"prospects?|buyers?|clients?|contacts?|opportunit(?:y|ies))")
_SURE_QUALITY = (r"(?:real|serious|qualified|pre-?qualified|genuine|ready|warm|hot|high[- ]intent|on\s+budget|"
                 r"within\s+budget|worth|buyers?|a\s+buyer|a\s+fit|interested)")
_AR_ARRIVE = (r"(?:يصل|تصل|يصلك|تصلك|يصلكم|تصلكم|يوصل|توصل|يوصلك|توصلك|يجي|تجي|يجيك|تجيك|يأتي|تأتي|يأتيك|"
              r"تأتيك|يضيع|تضيع|يفوت|تفوت|يفوتك|تفوتك)")
_AR_FULL = r"(?:ممتلئ|ممتلئة|مليء|مليئة|محجوز|محجوزة|مشغول|مشغولة|مؤهل|مؤهلة|جاهز|جاهزة|جاد|جادة)"
_AR_ALWAYS = r"(?:دائما|دائماً|على\s+الدوام)"
ABSOLUTE_OUTCOME = re.compile(
    rf"\b(?:never|will\s+not|won't|no\s+longer)\s+(?:again\s+|ever\s+)?{_ARRIVE}\b"
    rf"|\b(?:nothing|none|no\s+one|nobody|no\s+(?:lead|enquiry|inquiry|job|project|meeting|call))\b[^.,;]{{0,40}}?"
    rf"\bever\s+{_ARRIVE}\b"
    r"|\b(?:every|each|all(?:\s+the)?|100\s*(?:%|percent)\s+of(?:\s+the)?)\s+"
    rf"(?:single\s+)?(?:[a-z-]+\s+)?{_LEAD_NOUN}\s+"
    rf"(?:you\s+(?:get|meet|see|receive)\s+|we\s+(?:book|send|bring)\s+)?"
    rf"(?:is|are|will\s+be|becomes?|turns?\s+into|arrives?(?:\s+as)?)\s+(?:a\s+|an\s+)?{_SURE_QUALITY}\b"
    r"|\bno\s+more\s+(?!than\b|to\b|of\s+(?:your|the)\b|for\b|and\b|or\b|is\b|are\b|will\b|can\b)[a-z]"
    r"|\balways\s+(?:[a-z]+\s+){0,2}?(?:full|booked|busy|qualified|serious|ready\s+to\s+buy|on\s+budget|"
    r"buying|converting|flowing|arriving|coming\s+in)\b"
    rf"|(?<![ء-ي])[فو]?لن\s+(?:\S+\s+)?{_AR_ARRIVE}(?![ء-ي])"
    rf"|(?<![ء-ي])[فو]?(?:لا|ما)\s+(?:\S+\s+)?{_AR_ARRIVE}(?![ء-ي])(?:\s+\S+){{0,4}}?\s+(?:أبدا|أبداً|ابدا|ابداً|أبد|ابد)"
    r"(?![ء-ي])"
    rf"|(?<![ء-ي])كل\s+(?:عميل\s+محتمل|عميل|ليد|استفسار|طلب|اجتماع|موعد|زيارة|مشتر[يٍ]?)\s+(?:\S+\s+){{0,3}}?"
    r"(?:هو\s+|هي\s+|يكون\s+|تكون\s+|سيكون\s+|ستكون\s+)?ل?(?:جاد|جادة|جدي|جدية|مؤهل|مؤهلة|جاهز|جاهزة|حقيقي|حقيقية|"
    r"مشتر|مشتري)(?![ء-ي])"
    r"|(?<![ء-ي])لا\s+مزيد(?![ء-ي])|(?<![ء-ي])وداعا\s+ل"
    rf"|{_AR_ALWAYS}\s+(?:\S+\s+){{0,2}}?{_AR_FULL}(?![ء-ي])|(?<![ء-ي]){_AR_FULL}\s+(?:\S+\s+){{0,2}}?{_AR_ALWAYS}",
    re.I)
# A sentence that says the outcome is not promised is the honest form.
_NOT_PROMISED = re.compile(r"\b(?:not|never|no|cannot|can't)\s+(?:a\s+)?(?:promise|guarantee)"
                           r"|ليس\s+وعدا|لا\s+نضمن", re.I)


def outcome_strings(data: dict[str, Any]) -> list[tuple[str, str]]:
    """The strings where the document says what the client gets: the solution
    page's fixes, close and targets, the program, the investment's close and
    the start steps (and a blind document's call to action)."""
    out: list[tuple[str, str]] = []
    for key in ("solution_title", "solution_close", "investment_close", "start_note"):
        if isinstance(data.get(key), str):
            out.append((key, data[key]))
    for block, fields in (("solution", ("fix",)), ("program", ("title", "note")), ("solution_targets", ("v", "k")),
                          ("start_steps", ("title", "body"))):
        for i, row in enumerate(data.get(block) or []):
            if isinstance(row, dict):
                out += [(f"{block}[{i}].{f}", row[f]) for f in fields if isinstance(row.get(f), str)]
    cta = data.get("cta")
    if isinstance(cta, dict):
        out += [(f"cta.{k}", v) for k, v in cta.items() if isinstance(v, str)]
    return out


def absolute_outcomes(data: dict[str, Any]) -> list[tuple[str, str]]:
    """(field, the words) for each outcome stated as certain on the outcome pages."""
    found = []
    for path, raw in outcome_strings(data):
        text = _TAGS.sub("", _plain(raw))
        for m in ABSOLUTE_OUTCOME.finditer(text):
            if _NOT_PROMISED.search(sentence_at(text, m.start(), m.end())):
                continue
            found.append((path, m.group(0).strip()))
            break
    return found


def promises_results(text: str) -> bool:
    """Free work, or results guaranteed, in a line of the document."""
    if FREE_WORK.search(text):
        return True
    if built_to_deliver(text):
        return True
    if any(not _NEGATED.search(text[:m.start()]) and not _NOT.search(m.group(0))
           for m in RESULT_THEN_GUARANTEED.finditer(text)):
        return True
    return any(not _NEGATED.search(text[:m.start()]) for m in RESULT_GUARANTEED.finditer(text))


def check_guarantee(data: dict[str, Any], resolved: dict[str, Any], rep: Report) -> None:
    # A fail, not a warning: it is a result promised in other words, which the
    # rule forbids whatever the closer chose, and only a fail reaches the
    # repair round, which rewords it before anyone has to read the page.
    certain = absolute_outcomes(data)
    if certain:
        rep.add(FAIL, "guarantee", "the document states an outcome as certain in "
                + ", ".join(f"{p} (\"{w}\")" for p, w in certain[:4])
                + ". The program filters and lowers; it cannot promise none or all. Write \"fewer\" or "
                "\"filtered out\", never \"never\", \"every lead is\", \"no more\" or \"always\"")
    results = [p for p, t in content_strings(data) if promises_results(_plain(t))]
    if results:
        rep.add(FAIL, "guarantee", "the document promises results in " + ", ".join(results[:4])
                + ". We never guarantee results, free work or a number of meetings; take it out. "
                "The only guarantee is the 7-day satisfaction guarantee, and only when the closer chose it.")
        return
    promised = [p for p, t in content_strings(data) if PROMISE.search(_plain(t))]
    mentioned = [p for p, t in content_strings(data) if MENTION.search(_plain(t))]
    if resolved["guarantee"]:
        if (promised or mentioned) and not certain:
            rep.add(PASS, "guarantee", "the guarantee the closer chose is stated (" + ", ".join((promised or mentioned)[:2]) + ")")
        elif not (promised or mentioned):
            rep.add(WARN, "guarantee", "the closer chose the guarantee and the document does not state it; "
                                       "add it as one line in the terms")
        return
    if promised:
        rep.add(FAIL, "guarantee", "the closer chose no guarantee, and the document promises one in "
                                   + ", ".join(promised[:4]) + ". Take it out.")
    elif mentioned:
        rep.add(WARN, "guarantee", "no guarantee was chosen, and " + ", ".join(mentioned[:4])
                                   + " reads like one. Check it promises nothing.")
    elif not certain:
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
# Words saying no currency was named. A currency left for the closer is
# settled before the page goes out, and then the page states it in its figures
# while its words still say there is none (180273419 on 5 October 2026: AED
# filled, "You named no net margin and no currency, so this page assumes
# neither" left as it was, and the gate said ready).
_TAGS = re.compile(r"<[^>]+>")
NO_CURRENCY = re.compile(
    r"\bno\s+currency\b|\bnamed\s+no\s+(?:[a-z]+\s+){0,4}?currency\b"
    r"|\bwithout\s+(?:a\s+|any\s+|naming\s+(?:a\s+|the\s+)?)?currency\b"
    r"|\bcurrency\s+(?:was|is|has)\s+(?:not|never)\s+(?:been\s+)?(?:named|given|stated|said|set|settled|confirmed)"
    r"|\b(?:did\s+not|didn't|never)\s+(?:name|give|state|say|set|mention)\s+(?:a\s+|the\s+|any\s+|which\s+)?currency\b"
    r"|\bcurrency\s+(?:is\s+)?(?:still\s+)?(?:unstated|unknown|unnamed|open|to\s+be\s+(?:confirmed|settled))\b"
    r"|\bonce\s+the\s+currency\s+is\s+(?:settled|confirmed|known|named|agreed)\b"
    r"|(?:بدون|دون|بلا)\s+(?:ذكر\s+|تحديد\s+)?(?:أي\s+|اي\s+)?(?:عملة|العملة)"
    r"|لم\s+(?:\S+\s+){0,2}?(?:أي\s+|اي\s+)?(?:عملة|العملة)"
    r"|ما\s+(?:ذكرت|حددت|سميت|ذكرتو|حددتو|ذكرتوا|حددتوا)\s+(?:أي\s+|اي\s+)?(?:عملة|العملة)",
    re.I)


def check_currency(data: dict[str, Any], rep: Report) -> None:
    # A currency the closer typed that the page cannot price in is put back to
    # a blank on the rebuild (engine.follow_currency); say why, or the closer
    # types it again into the same blank.
    typed = (data.get("closer_figures") or {}).get("arithmetic.currency") if isinstance(
        data.get("closer_figures"), dict) else None
    arith = data.get("arithmetic") if isinstance(data.get("arithmetic"), dict) else {}
    if typed and FILL_RE.search(str(arith.get("currency") or "")) and currency_code(typed) is None:
        rep.add(WARN, "currency", f"the currency typed for the arithmetic page, {str(typed)[:40]!r}, is not one the "
                                  "page can price in. Type one of " + ", ".join(USD_PEGS) + " in that blank")
    unnamed = [p for p, text in client_strings(data) if NO_CURRENCY.search(_TAGS.sub("", _plain(text)))]
    if unnamed:
        rep.add(FAIL, "currency", f"{', '.join(unnamed[:3])} says no currency was named. The closer names one "
                                  "before the page is sent and the page then prints it, so the words must not say "
                                  "it: rewrite them without it (on a filled proposal, Draft again)")
    used = set()
    for block in ("cost", "arithmetic", "roi"):
        b = data.get(block) or {}
        for key in ("local_currency", "currency"):
            # A currency left for the closer is a blank, not a second currency.
            if b.get(key) and not FILL_RE.search(str(b[key])):
                used.add(str(b[key]).upper())
    for _path, text in client_strings(data):
        for c in CURRENCIES:
            if re.search(r"\b%s\b" % c, text):
                used.add(c)
    if len(used) > 1:
        rep.add(WARN, "currency", "the money is quoted in more than one currency: %s" % ", ".join(sorted(used)))
    elif used and not unnamed:
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
    # And whole numbers said in words or with a scale: "four hundred and fifty
    # thousand", "خمسة وثلاثين", "149K", each as the one figure it is.
    found.update(figures_in(text))
    return found


def numbers_in(value: Any) -> list[int]:
    """Pull the numbers out of a field, whether it is a number or prose."""
    if isinstance(value, bool) or value is None:
        return []
    if isinstance(value, (int, float)):
        return [int(value)] if float(value).is_integer() else []
    return figures_in(value)


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
    # The arithmetic page's own client figures: the project value in margin or
    # volume mode (the grid's values are illustrative), and a gross margin.
    arith = data.get("arithmetic") if isinstance(data.get("arithmetic"), dict) else {}
    if str(arith.get("mode") or "") in ("margin", "volume"):
        for key in ("project_value", "project_value_low", "project_value_high"):
            claims.append((f"arithmetic.{key}", arith.get(key)))
    claims.append(("arithmetic.gross_margin", arith.get("gross_margin")))

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


# ------------------------------------------------- the same count, twice ----
# The things a client counts, by the words a proposal names them in. A count
# of one of them told with two different figures on the gap page, in the
# driver tree and in the funnel is one of the two wrong (5 October 2026: six
# projects signed on the gap tile, "two signed" in the tree).
COUNTED = {
    # Signed work, by any of the words a page says it in. A bare "projects" is
    # not counted: on one page it is the quotes sent this year, on another
    # every job since the firm began, and on a third the goal (5 October 2026
    # review: four drafts warned on counts that were never the same thing).
    "signed": r"signed|موقع|موقعة|الموقعة|موقعين|وقعت|وقعنا|وقعناها",
    "meetings": r"meetings?|appointments?|اجتماع|اجتماعات|الاجتماعات|موعد|مواعيد|المواعيد",
    "leads": r"leads?|enquiry|enquiries|inquiry|inquiries|ليد|ليدز|استفسار|استفسارات",
}
_COUNTED = {k: re.compile(rf"^(?:{v})$", re.I) for k, v in COUNTED.items()}
# A noun after these is not the thing counted: "related to a project",
# "signed from those leads", "channels bringing you projects".
_NOT_COUNTED_AFTER = re.compile(r"^(?:a|an|per|each|every|from|of|to|those|these|the|with|for|you|من|إلى|الى|لكل|كل|في|لك|لكم)$",
                                re.I)
# Nor is an increment: "one more project a month" is a target, not a count.
_INCREMENT = re.compile(r"^(?:more|extra|additional|another|new|further|أكثر|اكثر|إضافي|إضافية|اضافي|اضافية|جديد|جديدة)$",
                        re.I)
_WORDS = re.compile(r"\d[\d,]*|[A-Za-z]+|[ء-ي]+|[.,;:!?؟،؛]")
_CLAUSE_END = re.compile(r"[.,;:!?؟،؛]")
# A rate is not a count: "two a month" against "six in eight months" is the
# same client, told per period.
RATE = re.compile(
    r"\b(?:a|per|each|every|an)\s+(?:day|week|month|quarter|year)\b|\b(?:daily|weekly|monthly|quarterly|yearly|annually)\b"
    r"|يوميا|أسبوعيا|اسبوعيا|شهريا|سنويا|في\s+(?:اليوم|الأسبوع|الاسبوع|الشهر|السنة|العام)"
    r"|كل\s+(?:يوم|أسبوع|اسبوع|شهر|سنة|عام)|(?:باليوم|بالأسبوع|بالاسبوع|بالشهر|بالسنة)", re.I)
# A goal, a plan or what is needed is not a count of what happened.
AIMED = re.compile(
    r"\b(?:targets?|goals?|aim|aims|want|wants|plan|plans|would|could|next|need|needs|needed|enough|should)\b"
    r"|هدف|الهدف|نريد|تريد|يريد|نحتاج|تحتاج|يحتاج|القادمة|القادم|نطمح|تطمح", re.I)
# What a figure counts when it is followed by one of these: a period, a share
# or money, not people or work.
_UNIT_AFTER = re.compile(
    r"^\s*(?:%|٪|percent|per\s+cent|days?|weeks?|months?|quarters?|years?|hours?|minutes?|sqm|m2|"
    r"usd|sar|aed|kwd|qar|bhd|omr|dollars?|riyals?|dirhams?|dinars?|"
    r"يوم|يوما|أيام|ايام|أسبوع|اسبوع|أسابيع|اسابيع|شهر|شهرا|أشهر|اشهر|شهور|سنة|سنوات|عام|أعوام|ساعة|ساعات|"
    r"دولار|ريال|درهم|دينار)\b", re.I)
_UNIT_BEFORE = re.compile(r"(?:usd|sar|aed|kwd|qar|bhd|omr|\$|دولار|ريال|درهم|دينار)\s*$", re.I)


# No client of ours counts ten thousand of anything they sign, meet or are
# asked about in a term; a figure that size beside "signed" is the money.
COUNT_CEILING = 10_000


def count_figures(text: Any) -> list[int]:
    """The figures in a piece of copy that count people or work: not a
    period ("two days", "in eight months"), a share, money or a year."""
    plain = spoken_figures(str(text or ""))
    out = []
    for m in re.finditer(r"\d[\d,]*(?:\.\d+)?", plain):
        raw = m.group(0).replace(",", "")
        if "." in raw or not raw.isdigit():
            continue
        n = int(raw)
        if n >= COUNT_CEILING or 1900 <= n <= 2100 or _UNIT_AFTER.match(plain[m.end():]) \
                or _UNIT_BEFORE.search(plain[:m.start()]):
            continue
        out.append(n)
    return out


def _nouns_named(text: str) -> set[str]:
    """The counted things a gap tile's label names: in its first clause, never
    after a preposition, an article or "you", never a thing the label counts
    with a figure of its own ("Kitchens quoted since March. Three signed"),
    and never in a label that is a rate or a goal."""
    first = _CLAUSE_END.split(spoken_figures(text), 1)[0]
    if RATE.search(first) or AIMED.search(first):
        return set()
    words = _WORDS.findall(first)
    out = set()
    for i, w in enumerate(words):
        if re.fullmatch(r"\d[\d,]*", w):
            continue
        before = words[max(0, i - 2):i]
        if any(_NOT_COUNTED_AFTER.match(b) or re.fullmatch(r"\d[\d,]*", b) for b in before):
            continue
        out.update(k for k, rx in _COUNTED.items() if rx.match(w))
    return out


def _counts_in_prose(text: str) -> list[tuple[str, int]]:
    """(noun, figure) for each figure followed within three words by a
    counted thing, leaving out a rate, a period and a sentence about a goal."""
    out = []
    for sentence in re.split(r"(?<=[.!?؟;؛])\s+", spoken_figures(text)):
        if AIMED.search(sentence):
            continue
        words = _WORDS.findall(sentence)
        for i, w in enumerate(words):
            if not re.fullmatch(r"\d[\d,]*", w):
                continue
            n = int(w.replace(",", ""))
            # "Six hundred thousand signed this year" is money, not signatures.
            if n >= COUNT_CEILING or 1900 <= n <= 2100 or (i and _UNIT_BEFORE.search(words[i - 1])):
                continue
            if i + 1 < len(words) and _UNIT_AFTER.match(words[i + 1]):
                continue
            clause = []
            for nxt in words[i + 1:]:
                if re.fullmatch(r"[.,;:!?؟،؛]", nxt):
                    break
                clause.append(nxt)
            if RATE.search(" ".join(clause[:6])):
                continue
            for nxt in clause[:3]:
                if re.fullmatch(r"\d[\d,]*", nxt) or _INCREMENT.match(nxt):
                    break
                out.extend((k, n) for k, rx in _COUNTED.items() if rx.match(nxt))
    return out


def stated_counts(data: dict[str, Any]) -> dict[str, list[tuple[str, str, int]]]:
    """Every count of a counted thing on the gap page, in the tree and in the
    funnel: block -> [(field, noun, figure)]. The tree's goal is a goal, so
    it is left out."""
    out: dict[str, list[tuple[str, str, int]]] = {"gap_points": [], "tree": [], "funnel": []}
    for i, g in enumerate(data.get("gap_points") or []):
        if isinstance(g, dict):
            for n in count_figures(g.get("v")):
                out["gap_points"].extend((f"gap_points[{i}]", k, n) for k in _nouns_named(str(g.get("k") or "")))
    funnel = data.get("funnel") if isinstance(data.get("funnel"), dict) else {}
    for i, st in enumerate(funnel.get("stages") or []):
        if not isinstance(st, dict):
            continue
        shown = st.get("display")
        nums = count_figures(shown)[:1] if isinstance(shown, str) else ([int(st["value"])] if isinstance(
            st.get("value"), (int, float)) and not isinstance(st.get("value"), bool) else [])
        if isinstance(shown, str) and RATE.search(shown):
            nums = []
        for n in nums:
            out["funnel"].extend((f"funnel.stages[{i}]", k, n) for k in _nouns_named(str(st.get("label") or "")))
    for f in ("title", "note"):
        if isinstance(funnel.get(f), str):
            out["funnel"].extend((f"funnel.{f}", k, n) for k, n in _counts_in_prose(funnel[f]))
    tree = data.get("tree") if isinstance(data.get("tree"), dict) else {}
    prose = [(f"tree.{f}", tree.get(f)) for f in ("goal_note", "note")]
    for i, br in enumerate(tree.get("branches") or []):
        if isinstance(br, dict):
            prose += [(f"tree.branches[{i}].{f}", br.get(f)) for f in ("title", "note")]
            for j, sb in enumerate(br.get("subs") or []):
                if isinstance(sb, dict):
                    prose += [(f"tree.branches[{i}].subs[{j}].{f}", sb.get(f)) for f in ("title", "note")]
    for path, text in prose:
        if isinstance(text, str):
            out["tree"].extend((path, k, n) for k, n in _counts_in_prose(text))
    return out


# A count told about an earlier period ("last year", "in 2024") is not the
# same count as one told about this one, however both are worded: a funnel of
# last year's quotes against this year's figure on the gap tile. Anything else
# is taken as now, since "this year" and "in eight months" are one stretch.
_EARLIER = re.compile(
    r"\b(?:last|previous|prior)\s+(?:year|month|quarter|season)\b|\b(?:a\s+year|years)\s+ago\b|\bin\s+(?:19|20)\d\d\b"
    r"|(?:العام|السنة|الشهر|الربع)\s+(?:الماضي|الماضية|السابق|السابقة)|(?:عام|سنة)\s+(?:19|20)\d\d", re.I)


def period_of(text: Any) -> str:
    """"earlier" when a field's count is about an earlier period, else "now"."""
    plain = _plain(str(text or ""))
    years = [int(y) for y in re.findall(r"\b((?:19|20)\d\d)\b", plain)]
    if _EARLIER.search(plain) and not (years and max(years) >= date.today().year):
        return "earlier"
    return "now"


def _field_text(data: dict[str, Any], path: str) -> str:
    """A counted field's own words, with the label or note that says over what."""
    m = re.fullmatch(r"(gap_points|funnel\.stages)\[(\d+)\]", path)
    if m:
        items = data.get("gap_points") if m.group(1) == "gap_points" else (data.get("funnel") or {}).get("stages")
        item = (items or [])[int(m.group(2))]
        return " ".join(str(item.get(k) or "") for k in ("k", "v", "label", "display", "note"))
    node: Any = data
    for part in re.findall(r"[a-z_]+|\d+", path):
        node = node[int(part)] if part.isdigit() else (node or {}).get(part)
    return str(node or "")


def check_counts(data: dict[str, Any], rep: Report) -> None:
    """The same thing counted with different figures on two of the three pages
    that describe the client, over the same period or none said. A warning
    naming both fields: one of them is wrong, and only the call says which."""
    counts = stated_counts(data)
    period = {p: period_of(_field_text(data, p)) for block in counts.values() for p, _k, _n in block}
    blocks = list(counts)
    clashes = []
    for noun in COUNTED:
        for a in range(len(blocks)):
            for b in range(a + 1, len(blocks)):
                left = [(p, n) for p, k, n in counts[blocks[a]] if k == noun]
                right = [(p, n) for p, k, n in counts[blocks[b]] if k == noun]
                # A count of an earlier period is another count.
                pairs = [(lp, ln, rp, rn) for lp, ln in left for rp, rn in right if period[lp] == period[rp]]
                if not pairs:
                    continue
                left = [(lp, ln) for lp, ln, _rp, _rn in pairs]
                right = [(rp, rn) for _lp, _ln, rp, rn in pairs]
                if left and right and not any(ln == rn for _lp, ln, _rp, rn in pairs):
                    clashes.append(f"{left[0][0]} says {left[0][1]:,} {noun} and {right[0][0]} says "
                                   f"{right[0][1]:,} {noun}")
    if clashes:
        rep.add(WARN, "figures", "the same count is told two ways: " + "; ".join(clashes[:4])
                + ". Check both against the call and make them agree")
    elif any(counts.values()):
        rep.add(PASS, "figures", "each count is told the same way wherever it appears")


# ------------------------------------------------------------ the funnel ----
def stage_figure(st: dict[str, Any]) -> Optional[float]:
    """A stage's count when the page prints it as a figure: a number in value,
    and a display that is that same figure or absent. A range ("8 to 10") or
    words are not subtracted from anything. The template's own test."""
    v = st.get("value")
    if isinstance(v, bool) or figure(v) is None:
        return None
    shown = st.get("display")
    if shown is None or str(shown).strip() == "":
        return figure(v)
    text = str(shown).translate(ARABIC_DIGITS).replace(",", "").strip()
    if re.fullmatch(r"\d+(?:\.\d+)?", text) and float(text) == figure(v):
        return figure(v)
    return None


def funnel_losses(funnel: dict[str, Any]) -> list[tuple[int, float]]:
    """(stage, lost) for each "lost here" the template draws: between two
    stages printed as figures, from the same pool, where the count falls.
    Stages are numbered as they stand in the deal."""
    stages = funnel.get("stages") or []
    out = []
    for i in range(1, len(stages)):
        above, here = stages[i - 1], stages[i]
        if not (isinstance(above, dict) and isinstance(here, dict)):
            continue
        prev, cur = stage_figure(above), stage_figure(here)
        same_pool = (here.get("pool", funnel.get("pool")) or "") == (above.get("pool", funnel.get("pool")) or "")
        if prev is not None and cur is not None and same_pool and prev - cur > 0:
            out.append((i, prev - cur))
    return out


# A note that says what became of the stage's people: "five signed, nine did
# not". Only such a note can contradict the loss drawn under it. One that
# says where they came from ("12 from Google, 28 from Instagram") or how long
# it took ("across three days") does not, and code used to give the next
# stage a pool of its own on either, which dropped a correct "lost here"
# (5 October 2026 review).
OUTCOME = re.compile(
    r"\b(?:signed|signs?|signature|reached|closed|won|booked|became|converted|went\s+on|walked|lost|dropped|"
    r"declined|did\s+not|didn't|never\s+(?:signed|came|showed)|no[- ]shows?|showed|turned\s+down)\b"
    r"|وقع|وقعوا|توقيع|تم\s+التوقيع|انسحب|انسحبوا|خسر|خسرنا|رفض|رفضوا|لم\s+(?:يوقع|يوقعوا|يكمل|يكملوا|يحضر|يحضروا)",
    re.I)


def pool_clashes(funnel: dict[str, Any]) -> list[tuple[int, float, list[int]]]:
    """(stage, lost, the counts in the note above) for each drawn loss that
    the note on the stage above contradicts: a note that says what became of
    that stage's people, in counts of its own (no period, share or money),
    none of which is the loss drawn."""
    stages = funnel.get("stages") or []
    out = []
    for i, lost in funnel_losses(funnel):
        above = stages[i - 1]
        note = str(above.get("note") or "")
        prev = stage_figure(above) or 0
        own = [n for n in count_figures(note) if 0 < n <= prev]
        if own and OUTCOME.search(_plain(note)) and int(lost) not in own:
            out.append((i, lost, own))
    return out


def separate_pools(deal: dict[str, Any]) -> list[int]:
    """Give each stage whose drawn loss its note above contradicts a pool of
    its own, so no loss is drawn into it: the notes say what happened, and a
    computed figure that disagrees with them is the one to drop. The stages
    changed."""
    funnel = deal.get("funnel") if isinstance(deal.get("funnel"), dict) else {}
    changed = []
    for i, _lost, _own in pool_clashes(funnel):
        funnel["stages"][i]["pool"] = f"stage {i + 1}"
        changed.append(i)
    return changed


def check_funnel(data: dict[str, Any], rep: Report) -> None:
    """A "lost here" the stage above contradicts: 14 meetings then 6 signed
    printed 8 lost, under a note saying four signed and ten did not. The
    second stage counted another pool (a year, not those meetings). A draft
    gets the pool from code (engine.stamp); a deal edited since is warned."""
    funnel = data.get("funnel") if isinstance(data.get("funnel"), dict) else {}
    clashes = [f"funnel.stages[{i}] prints {lost:g} lost after funnel.stages[{i - 1}], whose note gives its own "
               f"figures ({', '.join(str(n) for n in own[:4])})" for i, lost, own in pool_clashes(funnel)]
    if clashes:
        rep.add(WARN, "funnel", "; ".join(clashes[:3]) + ". If the two stages do not count the same people, give "
                                "the later one its own pool (\"pool\": \"...\") and no loss is drawn")


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

    # The drafter writes FILL where the call gave no figure. Divided by, it
    # crashed the whole check, and the queue then drafted the call again from
    # the start, four times. A FILL is a gap for the closer like any other;
    # anything else that is not a number is the draft's fault.
    scalars = ("project_value", "project_value_low", "project_value_high", "target_additional_low",
               "target_additional_high", "engagement_total", "gross_margin")
    given = [(k, a.get(k)) for k in scalars]
    given += [(f"project_values[{i}]", v) for i, v in enumerate(a.get("project_values") or [])]
    given += [(f"margins[{i}]", v) for i, v in enumerate(a.get("margins") or [])]
    gaps = [(k, v) for k, v in given if v not in (None, "") and figure(v) is None]
    if gaps:
        names = ", ".join("arithmetic." + k for k, _v in gaps)
        if all(FILL_RE.search(str(v)) for _k, v in gaps):
            rep.add(WARN, "arithmetic", f"the break-even page waits on {names}, still FILL. Fill it with the "
                                        "figure from the call and the page is built", send=FAIL)
        else:
            rep.add(FAIL, "arithmetic", f"{names} is not a number the page can compute with. Write the "
                                        "figure as digits only, or FILL where the call never gave it")
        return
    a = {**a, **{k: figure(v) for k, v in given[:len(scalars)] if v not in (None, "")},
         "project_values": [figure(v) for v in (a.get("project_values") or [])],
         "margins": [figure(v) for v in a["margins"]] if a.get("margins") else None}
    threshold = a.get("mode") == "threshold"
    margin_mode = a.get("mode") == "margin"
    volume_mode = a.get("mode") == "volume"
    values = [v for v in (a.get("project_values") or []) if v]
    # The margins the page divides by, as the template picks them: the
    # deal's, else the client's gross margin alone, else 10 and 20.
    margins = [m for m in (a.get("margins") or ([a["gross_margin"]] if a.get("gross_margin") else [10, 20])) if m]
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

    # The engagement is our fee, converted at roi.usd_rate: a page in one
    # currency and a rate for another prints the engagement in the wrong money.
    cur_named = str(a.get("currency") or "").strip().upper()
    if cur_named in USD_PEGS and not a.get("engagement_total") and rate_off(cur_named, roi.get("usd_rate") or 1):
        rep.add(FAIL, "arithmetic",
                f"the arithmetic page is in {cur_named}, and roi is in {roi.get('local_currency') or 'USD'} at a "
                f"usd_rate of {roi.get('usd_rate') or 1}, so the engagement would print in the wrong money. Set "
                f"roi.local_currency to {cur_named} and roi.usd_rate to {USD_PEGS[cur_named]}")
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
        gross = a.get("gross_margin")
        if gross:
            # Counted at the client's own gross margin, and said to be gross.
            need = total / (values[0] * gross / 100)
            detail = ("%s %s over %s months needs %s projects of %s %s at a %s%% gross margin, against %s to %s "
                      "additional projects targeted"
                      % (cur, f"{total:,.0f}", months, dec(need), cur, f"{values[0]:,.0f}", f"{gross:g}",
                         f"{add_low:g}", f"{add_high:g}"))
        else:
            need = total / values[0]
            detail = ("%s %s over %s months needs %s of a %s %s project, against %s to %s "
                      "additional projects targeted"
                      % (cur, f"{total:,.0f}", months, dec(need), cur, f"{values[0]:,.0f}", f"{add_low:g}",
                         f"{add_high:g}"))
        if need <= add_low:
            rep.add(PASS, "arithmetic", detail)
        elif need <= add_high:
            rep.add(WARN, "arithmetic", detail + ": only the upper end of the target covers it")
        else:
            rep.add(FAIL, "arithmetic", detail + ": even the whole target does not cover the engagement")
        return

    if margin_mode:
        need = total / values[0] * 100
        detail = ("one project of %s %s covers %s %s at %s%% kept"
                  % (cur, f"{values[0]:,.0f}", cur, f"{total:,.0f}", dec(need)))
        if a.get("gross_margin"):
            detail += ("; at the client's %s%% gross margin that is %s projects"
                       % (f"{a['gross_margin']:g}", dec(total / (values[0] * a["gross_margin"] / 100))))
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
              f"{cur} {total:,.0f}, {dec(best)} to {dec(worst)} projects")
    if not under:
        rep.add(FAIL, "arithmetic", detail + ": not one row breaks even inside a single "
                                             "project, so the table argues against the fee")
    else:
        rep.add(PASS, "arithmetic", detail + f", {under} row(s) under one project")
    if not over:
        rep.add(WARN, "arithmetic",
                "every row breaks even inside one project. Add a lower project value so "
                "the reader can see the table was not built to flatter us.")


# Saying the return comes "before you count a cent of margin" talks around the
# one figure the reader needs (176954619 on 5 October 2026, where the client
# had given a gross margin of 20 to 30 percent).
AROUND_MARGIN = re.compile(
    r"\bbefore\s+(?:you\s+)?(?:count|counting|any|a\s+cent\s+of|a\s+single|the)\b[^.]{0,30}?\bmargins?\b"
    r"|\bwithout\s+(?:counting\s+|touching\s+)?(?:any\s+|your\s+|the\s+|a\s+)?margins?\b"
    r"|\bwhatever\s+(?:your|the)\s+margin|\bregardless\s+of\s+(?:your\s+|the\s+)?margin"
    r"|\bnot\s+counting\s+(?:the\s+|your\s+|any\s+)?margin|\bmargin\s+(?:aside|untouched)\b"
    r"|قبل\s+(?:احتساب|حساب)\s+(?:أي\s+)?(?:هامش|الهامش|ربح|الربح)|بغض\s+النظر\s+عن\s+(?:الهامش|هامش)",
    re.I)
GROSS_WORDS = re.compile(r"\bgross\b|هامش\s+إجمالي|الهامش\s+الإجمالي|ربح\s+إجمالي|الربح\s+الإجمالي", re.I)


def check_margin_words(data: dict[str, Any], rep: Report) -> None:
    """The arithmetic page and the client's margin: a gross margin the call
    gave is counted, labelled gross (arithmetic.gross_margin), and the page
    never talks around it."""
    a = data.get("arithmetic") if isinstance(data.get("arithmetic"), dict) else {}
    if not a:
        return
    around = [f"arithmetic.{k}" for k in ("verdict", "close", "note", "intro")
              if isinstance(a.get(k), str) and AROUND_MARGIN.search(_plain(a[k]))]
    if around:
        rep.add(WARN, "arithmetic", f"{', '.join(around)} talks around the margin. Count the projects at the "
                                    "client's own margin when the call gave one (arithmetic.gross_margin, labelled "
                                    "gross), or say plainly that none was given")
    roi = data.get("roi") or {}
    said_gross = [p for p, text in (("roi.margin_note", roi.get("margin_note")), ("arithmetic.note", a.get("note")),
                                    ("arithmetic.intro", a.get("intro")))
                  if isinstance(text, str) and GROSS_WORDS.search(text)
                  and any(0 < n < 100 for n in figures_in(text))]
    if said_gross and figure(a.get("gross_margin")) is None and not FILL_RE.search(str(a.get("gross_margin") or "")):
        rep.add(WARN, "arithmetic", f"{said_gross[0]} says the call gave a gross margin, and the arithmetic page "
                                    "does not use it. Set arithmetic.gross_margin to the bottom of it, so the "
                                    "projects are counted at it and labelled gross")


# ------------------------------------------------------ the signing rate ----
# The volume page sets the rate the client signs at today ("You sign") above
# the projects the term targets. On 5 October 2026 176954619's "You sign" read
# "2 to 4 over the term", the target, directly above the target row saying the
# same, where the call gave three projects since the start of the year. A
# target said as more than today ("2 more a month") is the honest way to state
# a target that equals today's rate, so it is not a repeat.
INCREMENT = re.compile(r"\b(?:more|additional|extra|another|on\s+top)\b|إضافي|إضافية|اضافي|اضافية|زيادة|أخرى|اخرى",
                       re.I)


def check_rate(data: dict[str, Any], rep: Report) -> None:
    """The volume page's "You sign" row is the client's own signing rate, never
    the target: it fails when it carries the same figures as target_display."""
    a = data.get("arithmetic") if isinstance(data.get("arithmetic"), dict) else {}
    if str(a.get("mode") or "").strip().lower() != "volume":
        return
    rate, target = str(a.get("rate_display") or "").strip(), str(a.get("target_display") or "").strip()
    if not rate or not target or FILL_RE.search(rate) or FILL_RE.search(target):
        return
    said, aimed = sorted(set(count_figures(rate))), sorted(set(count_figures(target)))
    if said and said == aimed and not (INCREMENT.search(_plain(target)) and not INCREMENT.search(_plain(rate))):
        rep.add(FAIL, "rate", "arithmetic.rate_display carries the same figures as arithmetic.target_display ("
                + " and ".join(str(n) for n in said) + "), so \"You sign\" repeats the target. It is the rate the "
                "client signs at today, as the call gave it (a gap tile, the funnel or the tree may say it), "
                "or FILL for the closer; never the target")
    else:
        rep.add(PASS, "rate", "the signing rate is not the target")


# ------------------------------------------------- the arithmetic's words ----
# The verdict and the close divide into what the table divides into (SKILL.md,
# "One denominator per page"). On 5 October 2026 two drafts on the reviewed
# code passed every check with words that left the table: 180273419 set "the
# USD 6,000 engagement" (the fee alone; the table's whole engagement was
# 10,500) beside one project and said it paid for the three months "many times
# over" on a page that assumes no margin, and 176954619 said one project covers
# the term "if you keep a fifth of its value" (the fee alone again) where the
# table needs 35.0 percent. The words are the drafter's to change, so this is
# its own check, which the repair round reads.
_SHARE_UNIT = {"half": 2, "halves": 2, "third": 3, "thirds": 3, "quarter": 4, "quarters": 4, "fifth": 5,
               "fifths": 5, "sixth": 6, "sixths": 6, "eighth": 8, "eighths": 8, "tenth": 10, "tenths": 10,
               "twentieth": 20, "twentieths": 20}
# "if you keep a fifth of its value", "keep a little over 1 percent of it",
# "as long as it leaves you 35 percent". Read on spoken_figures' text, where
# "one percent" is already "1 percent" and "two thirds" is "2 thirds".
KEPT_SHARE = re.compile(
    r"\b(?:keep|keeps|kept|keeping|clear|clears|retain|retains|leaves?\s+you|leaving\s+you)\s+"
    r"(?:only\s+|just\s+|about\s+|around\s+|roughly\s+|some\s+)?"
    r"(?P<over>(?:a\s+little\s+|just\s+|slightly\s+)?(?:over|above|more\s+than)\s+)?"
    r"(?:(?P<count>a|an|\d+)\s+(?P<unit>" + "|".join(_SHARE_UNIT) + r")\b|(?P<half>half)\b"
    r"|(?P<n>\d+(?:\.\d+)?)\s*(?:%|percent\b|per\s+cent\b))",
    re.I)
# One project paying for the term several times: a ratio the page can only
# state with a margin to count at.
MULTIPLE = re.compile(
    r"\b(?P<word>many|several|multiple|numerous|countless|a\s+few|\d+(?:\.\d+)?)\s+times\s+over\b"
    r"|\b(?P<twice>twice)\s+over\b"
    r"|\b(?P<loose>many|several|numerous|countless)\s+times\b"
    r"|\bover\s+and\s+over\b"
    r"|أضعاف|عدة\s+مرات|مرات\s+عديدة|مرات\s+كثيرة",
    re.I)
ONE_PROJECT = re.compile(r"\b(?:1|a\s+single|a)\s+(?:signed\s+|new\s+|won\s+|single\s+)?"
                         r"(?:projects?|jobs?|contracts?|deals?|villas?|fit-?outs?)\b", re.I)
COVERS = re.compile(r"\b(?:covers?|covered|pays?\s+for|paid\s+for|pays?\s+back|recovers?|recoups?)\b", re.I)
# The words that make "one project covers it" a condition, not a claim.
CONDITION = re.compile(r"\b(?:if|keep|keeps|kept|unless|provided|as\s+long\s+as|share|percent|per\s+cent|"
                       r"margin|leaves?|below|under|whether)\b|%", re.I)


def _sentences(text: str) -> list[str]:
    return [s for s in re.split(r"(?<=[.!?؟;؛])\s+|\n+", text) if s.strip()]


def check_verdict(data: dict[str, Any], rep: Report) -> None:
    """The arithmetic page's words against its table: the verdict, the close,
    the intro and the note divide into the whole engagement, state the share
    of one project the table states, and claim a multiple only when a margin
    the page counts at supports it."""
    a = data.get("arithmetic") if isinstance(data.get("arithmetic"), dict) else {}
    roi = data.get("roi") if isinstance(data.get("roi"), dict) else {}
    if not a:
        return
    fields = [(f"arithmetic.{k}", a[k]) for k in ("verdict", "close", "intro", "note")
              if isinstance(a.get(k), str) and a[k].strip()]
    if not fields:
        return
    rate = figure(roi.get("usd_rate")) or 1
    months = figure(a.get("months")) or figure(roi.get("months")) or 3
    fee = figure(roi.get("fee_usd")) or 0
    ads = figure(roi.get("ad_monthly_usd")) or 0
    total = figure(a.get("engagement_total")) or (fee + ads * months) * rate
    mode = str(a.get("mode") or "").strip().lower()
    grid = bool(a.get("project_values")) and mode in ("", "grid")
    value = figure(a.get("project_value")) if mode == "margin" else (
        figure(a.get("project_value_low")) if mode == "volume" else None)
    gross = figure(a.get("gross_margin"))
    gross = gross if gross and 0 < gross < 100 else None
    # The page's own quantities: the share of one project the engagement is
    # (margin mode), and how many of the client's projects it takes at the
    # gross margin he gave (margin and volume mode).
    share = total / value * 100 if (mode == "margin" and value and total) else None
    count = total / (value * gross / 100) if (value and gross and total) else None
    # A grid's best cell: the most any row of it lets one project cover.
    if grid and total:
        values = [v for v in (figure(x) for x in a.get("project_values") or []) if v]
        margins = [m for m in (figure(x) for x in (a.get("margins") or ([gross] if gross else [10, 20]))) if m]
        cells = [total / (v * m / 100) for v in values for m in margins if v * m > 0]
        best = min(cells) if cells else None
    else:
        best = count
    problems: list[str] = []

    for path, raw in fields:
        text = spoken_figures(_TAGS.sub("", raw))
        conclusion = path in ("arithmetic.verdict", "arithmetic.close")
        for sentence in _sentences(text):
            # The fee alone, set where the whole engagement belongs.
            if fee and ads and total and abs(total - fee * rate) > 1 and not AD_WORDS.search(sentence):
                quoted = [n for n in figures_in(sentence) if n >= 100 and (n == round(fee) or abs(n - fee * rate) <= 1)]
                if quoted and (conclusion or not re.search(r"\bfees?\b|رسوم|الرسوم", sentence, re.I)):
                    problems.append(f"{path} sets {quoted[0]:,}, our fee alone, where the table divides the whole "
                                    f"engagement, {total:,.0f} with the advertising. Use the table's figure, or "
                                    "say both parts")
            # A share kept that covers the term: no less than the table's.
            if share is not None:
                for m in KEPT_SHARE.finditer(sentence):
                    if m.group("n"):
                        said = float(m.group("n"))
                    elif m.group("half"):
                        said = 50.0
                    else:
                        n = 1 if m.group("count").lower() in ("a", "an") else int(m.group("count"))
                        said = n * 100 / _SHARE_UNIT[m.group("unit").lower()]
                    if m.group("over"):
                        wrong = said > share + 0.05 or share > said * 2
                    else:
                        wrong = said < share * 0.95
                    if wrong:
                        problems.append(f"{path} says one project covers the term if the client keeps "
                                        f"{m.group(0).split(None, 1)[1]}; the table needs {dec(share)}% of one "
                                        "project. Say the table's share")
        # A multiple claimed: it needs a margin the page counts at, and that
        # count has to bear it out.
        for m in MULTIPLE.finditer(text):
            times = 1 / best if best else None
            if m.group("word") and re.fullmatch(r"\d+(?:\.\d+)?", m.group("word")):
                need = float(m.group("word"))
            elif m.group("twice"):
                need = 2.0
            else:
                need = 3.0
            if times is None:
                problems.append(f"{path} claims a multiple ({m.group(0)}), and the page counts at no margin the "
                                "client gave, so it cannot say how many times the engagement is covered. State the "
                                "share or the count the table states")
            elif times < need:
                problems.append(f"{path} says {m.group(0)}; the most the table counts is one project covering "
                                f"the term {dec(times)} times. Say the table's count")
        # One project said to cover the term outright, when the page has no
        # margin to say it with, or counts more than one at the gross margin.
        if conclusion and not grid and mode in ("margin", "volume"):
            for sentence in _sentences(text):
                if not (ONE_PROJECT.search(sentence) and COVERS.search(sentence)) or _NOT.search(sentence):
                    continue
                if count is not None and count > 1 and dec(count) not in text:
                    problems.append(f"{path} says one project covers the term; at the {gross:g}% gross margin the "
                                    f"table counts {dec(count)} projects. Say that count")
                elif count is None and mode == "margin" and not CONDITION.search(sentence):
                    problems.append(f"{path} says one project pays for the term outright, and the page assumes no "
                                    "margin. Say it with the share the table states (if you keep "
                                    f"{dec(share) if share else 'that share'}% of it)")
    if problems:
        seen: list[str] = []
        for p in problems:
            if p not in seen:
                seen.append(p)
        rep.add(FAIL, "verdict", "; ".join(seen[:3]))
    else:
        rep.add(PASS, "verdict", "the page's words divide into the table's engagement")


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
    zero = zero_break_even(live)
    if zero:
        rep.add(FAIL, "render", "a break-even tile reads %s on the price page, which says the program pays for "
                                "itself with no projects at all. It is drawn from roi.avg_project_value and "
                                "roi.margin_pct; without a margin there are no tiles to draw: check roi" % zero)
    return sheets


# The break-even row as the template draws it: its side label, in either
# language, then the tiles' figures.
BREAK_EVEN_ROW = re.compile(
    r'<div class="side">\s*(?:Break-even|نقطة التعادل)\s*</div>\s*<div class="main">\s*'
    r'<div class="big accent">(.*?)</div>\s*</div>\s*</div>', re.S)
TILE_VALUE = re.compile(r'<span class="v">\s*([^<]*?)\s*</span>')


def zero_break_even(live: str) -> Optional[str]:
    """The first break-even tile that reads zero, as printed, or None."""
    for row in BREAK_EVEN_ROW.finditer(live):
        for raw in TILE_VALUE.findall(row.group(1)):
            text = raw.translate(ARABIC_DIGITS).replace(",", "")
            if re.fullmatch(r"0+(?:\.0+)?", text):
                return raw
    return None


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
        check_counts(data, rep)
        check_funnel(data, rep)
    check_quotes(data, rep)
    pct = None
    if general or blind:
        check_arithmetic(data, rep)
        check_margin_words(data, rep)
        check_rate(data, rep)
        check_verdict(data, rep)
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
