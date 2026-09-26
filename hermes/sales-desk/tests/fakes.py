"""Test doubles and synthetic data. Every company, person, quote and figure
here is invented; nothing is taken from a real call or proposal.

FakePostgrest stands where the HTTP layer would be: it answers the same URLs
the desk calls, reading the query strings the way PostgREST does (eq, lt,
in, is, ilike, or, a JSON arrow, order, limit, on_conflict, Prefer), so a
test of the queue exercises the real filters rather than a stand-in for them.
"""
from __future__ import annotations

import json
import re
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from desk import build as build_mod
from desk import validate as validate_mod
from desk.http import HttpError
from desk.model import Reply

PK = {
    "cockpit_sales_requests": ("id",),
    "cockpit_sales_proposals": ("id",),
    "cockpit_sales_recordings": ("recording_id",),
    "cockpit_sales_worker_status": ("worker", "job"),
    "cockpit_sales_leads": ("contact_id",),
    "cockpit_sales_appointments": ("appointment_id",),
    "cockpit_sales_people": ("email",),
    "cockpit_sales_settings": ("key",),
    "cockpit_sales_reps": ("id",),
    "cockpit_sales_reviews": ("source_ref",),
    "cockpit_sales_dials": ("call_id",),
    "cockpit_sales_followups": ("id",),
    "cockpit_sales_messages": ("id",),
    "cockpit_sales_inbox": ("conversation_id",),
    "cockpit_sales_calendar": ("appointment_id",),
    "cockpit_sales_notes": ("id",),
    "cockpit_sales_research": ("id",),
    "cockpit_sales_deals": ("response_id",),
    "cockpit_sales_review_asks": ("id",),
    "cockpit_sales_call_notes": ("recording_id",),
    "cockpit_sales_digests": ("id",),
}


def _ts(value: Any) -> Optional[datetime]:
    try:
        t = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return t if t.tzinfo else t.replace(tzinfo=timezone.utc)


def _cmp(a: Any, b: str) -> tuple[Any, Any]:
    ta, tb = _ts(a), _ts(b)
    if ta and tb:
        return ta, tb
    try:
        return float(a), float(b)
    except (TypeError, ValueError):
        return str(a), b


def _unquote(v: str) -> str:
    v = v.strip()
    return v[1:-1] if len(v) >= 2 and v[0] == v[-1] == '"' else v


def _split_top(text: str) -> list[str]:
    """Split on commas that are not inside quotes or parentheses."""
    out, buf, depth, quoted = [], [], 0, False
    for ch in text:
        if ch == '"':
            quoted = not quoted
        elif not quoted and ch == "(":
            depth += 1
        elif not quoted and ch == ")":
            depth -= 1
        if ch == "," and not quoted and depth == 0:
            out.append("".join(buf))
            buf = []
            continue
        buf.append(ch)
    if buf:
        out.append("".join(buf))
    return out


class FakePostgrest:
    def __init__(self) -> None:
        self.tables: dict[str, dict[tuple, dict[str, Any]]] = {t: {} for t in PK}
        self.objects: dict[str, tuple[str, bytes]] = {}
        self.buckets = {
            "sales-proposals": {"id": "sales-proposals", "public": False},
            "sales-calls": {"id": "sales-calls", "public": False},
        }
        self.calls: list[tuple[str, str]] = []

    # ---- seeding and reading ----
    def put(self, table: str, row: dict[str, Any]) -> dict[str, Any]:
        self.tables[table][tuple(str(row[k]) for k in PK[table])] = dict(row)
        return self.tables[table][tuple(str(row[k]) for k in PK[table])]

    def rows(self, table: str) -> list[dict[str, Any]]:
        return list(self.tables[table].values())

    def one(self, table: str, **match: Any) -> Optional[dict[str, Any]]:
        for r in self.rows(table):
            if all(str(r.get(k)) == str(v) for k, v in match.items()):
                return r
        return None

    def writes(self) -> list[tuple[str, str]]:
        return [c for c in self.calls if c[0] != "GET"]

    # ---- filters ----
    def _value(self, row: dict[str, Any], column: str) -> Any:
        if "->>" in column:
            col, key = column.split("->>", 1)
            inner = row.get(col) or {}
            v = inner.get(key) if isinstance(inner, dict) else None
            return None if v is None else str(v)
        return row.get(column)

    def _test(self, row: dict[str, Any], column: str, expr: str) -> bool:
        negate = expr.startswith("not.")
        if negate:
            expr = expr[4:]
        op, _, operand = expr.partition(".")
        if op != "in":
            operand = _unquote(operand)
        v = self._value(row, column)
        if op == "eq":
            ok = v is not None and (str(v).lower() if isinstance(v, bool) else str(v)) == operand
        elif op == "neq":
            ok = v is None or str(v) != operand
        elif op in ("lt", "lte", "gt", "gte"):
            if v is None:
                ok = False
            else:
                a, b = _cmp(v, operand)
                ok = {"lt": a < b, "lte": a <= b, "gt": a > b, "gte": a >= b}[op]
        elif op == "in":
            items = {_unquote(x) for x in _split_top(operand.strip()[1:-1])}
            ok = v is not None and str(v) in items
        elif op == "is":
            ok = (v is None) if operand == "null" else (v is (operand == "true"))
        elif op == "ilike":
            pattern = _unquote(operand)
            rx = "^" + "".join(".*" if c in "*%" else "." if c == "_" else re.escape(c) for c in pattern) + "$"
            ok = v is not None and re.match(rx, str(v), re.I) is not None
        else:
            raise AssertionError(f"filter {op!r} not modelled")
        return not ok if negate else ok

    def _match(self, row: dict[str, Any], params: list[tuple[str, str]]) -> bool:
        for k, v in params:
            if k in ("select", "order", "limit", "offset", "on_conflict"):
                continue
            if k == "or":
                parts = _split_top(v.strip()[1:-1])
                if not any(self._test(row, *p.split(".", 1)) for p in parts):
                    return False
                continue
            if not self._test(row, k, v):
                return False
        return True

    def _select(self, table: str, params: list[tuple[str, str]]) -> list[dict[str, Any]]:
        rows = [r for r in self.rows(table) if self._match(r, params)]
        for k, v in params:
            if k == "order":
                col, _, direction = v.partition(".")
                present = [r for r in rows if r.get(col) is not None]
                missing = [r for r in rows if r.get(col) is None]
                present.sort(key=lambda r: _cmp(r.get(col), str(r.get(col)))[0], reverse=direction.startswith("desc"))
                rows = present + missing
        offset = next((int(v) for k, v in params if k == "offset"), 0)
        rows = rows[offset:]
        for k, v in params:
            if k == "limit":
                rows = rows[: int(v)]
        return rows

    # ---- the HTTP layer ----
    def __call__(self, method: str, url: str, *, headers: Optional[dict[str, str]] = None, data: Optional[bytes] = None,
                 json_body: Any = None, timeout: float = 60, retries: int = 2,
                 ok_statuses: tuple[int, ...] = (200, 201, 202, 204)) -> tuple[int, dict[str, str], bytes]:
        parts = urllib.parse.urlsplit(url)
        path = parts.path
        self.calls.append((method, path + ("?" + urllib.parse.unquote(parts.query) if parts.query else "")))
        headers = headers or {}
        if path.startswith("/storage/v1/object/"):
            key = path[len("/storage/v1/object/"):]
            bucket = key.split("/", 1)[0]
            if bucket not in self.buckets:
                raise HttpError(404, '{"error":"Bucket not found"}', b"", url)
            if method == "GET":
                if key not in self.objects:
                    raise HttpError(404, '{"error":"Object not found"}', b"", url)
                return 200, {}, self.objects[key][1]
            self.objects[key] = (headers.get("Content-Type", ""), data or b"")
            return 200, {}, json.dumps({"Key": key}).encode()
        if path.startswith("/storage/v1/bucket/"):
            b = self.buckets.get(path.rsplit("/", 1)[-1])
            if not b:
                raise HttpError(404, '{"error":"Bucket not found"}', b"", url)
            return 200, {}, json.dumps(b).encode()
        assert path.startswith("/rest/v1/"), path
        table = path[len("/rest/v1/"):]
        if table not in self.tables:
            raise HttpError(404, f'{{"message":"relation {table} does not exist"}}', b"", url)
        params = urllib.parse.parse_qsl(parts.query, keep_blank_values=True)
        body = json.loads(data.decode("utf-8")) if data else json_body
        prefer = headers.get("Prefer", "")
        if method == "GET":
            return 200, {}, json.dumps(self._select(table, params), default=str).encode()
        if method == "POST":
            made = []
            for row in body if isinstance(body, list) else [body]:
                if "id" in PK[table] and "id" not in row:
                    row = {"id": f"gen-{len(self.tables[table]) + 1}", **row}
                key = tuple(str(row[k]) for k in PK[table])
                self.tables[table].setdefault(key, {}).update(row)
                made.append(self.tables[table][key])
            if "representation" in prefer:
                return 201, {}, json.dumps(made, default=str).encode()
            return 201, {}, b""
        if method == "PATCH":
            hit = [r for r in self.rows(table) if self._match(r, params)]
            for r in hit:
                r.update(body)
            if "representation" in prefer:
                return 200, {}, json.dumps(hit, default=str).encode()
            return 204, {}, b""
        raise AssertionError(f"{method} not modelled")


# ---- the other services -------------------------------------------------------

class FakeFathom:
    def __init__(self, meetings: Optional[dict[Optional[str], list[dict[str, Any]]]] = None,
                 transcripts: Optional[dict[str, list[dict[str, Any]]]] = None):
        self.by_rep = meetings or {}
        self.transcripts = transcripts or {}
        self.asked: list[Optional[str]] = []
        self.read: list[str] = []

    def meetings(self, *, since: Any, recorded_by: Optional[str] = None, max_pages: int = 60) -> list[dict[str, Any]]:
        self.asked.append(recorded_by)
        return [dict(m) for m in self.by_rep.get(recorded_by, [])]

    def transcript(self, recording_id: Any) -> list[dict[str, Any]]:
        self.read.append(str(recording_id))
        return list(self.transcripts.get(str(recording_id), []))


class FakeProvider:
    """Answers from a script, in order. Each entry is text, a Reply, or an exception to raise."""
    name = "fake"
    model = "fake-model"

    def __init__(self, replies: list[Any]):
        self.replies = list(replies)
        self.calls: list[dict[str, Any]] = []

    def complete(self, system: str, user: str, *, temperature: Optional[float] = None, timeout: float = 900) -> Reply:
        self.calls.append({"system": system, "user": user, "temperature": temperature})
        if not self.replies:
            raise AssertionError("the model was asked more often than the test expected")
        r = self.replies.pop(0)
        if isinstance(r, BaseException):
            raise r
        if isinstance(r, Reply):
            return r
        return Reply(text=r if isinstance(r, str) else json.dumps(r), model="fake-model-1")


class FakeRenderer:
    """A browser that renders the sheets a deal should have, overflowing the
    ones the test names, one list per render."""

    def __init__(self, over: Optional[list[list[int]]] = None, pdf_ok: bool = True, works: bool = True):
        self.over = list(over or [])
        self.pdf_ok = pdf_ok
        self.works = works
        self.rendered: list[str] = []
        self.printed: list[str] = []

    def dom(self, html_path: Path) -> Optional[str]:
        if not self.works:
            return None
        self.rendered.append(str(html_path))
        deal = build_mod.data_of(Path(html_path).read_text(encoding="utf-8"))
        n = validate_mod.expected_sheets(deal)
        over = set(self.over.pop(0)) if self.over else set()
        sheets = "".join(f'<section class="sheet{" over" if i in over else ""}"><p>page {i}</p></section>'
                         for i in range(1, n + 1))
        return f'<html><body><div id="doc">{sheets}</div><script>const PROPOSAL = {{}};</script></body></html>'

    def pdf(self, html_path: Path, out_path: Path) -> bool:
        if not self.pdf_ok:
            return False
        self.printed.append(str(html_path))
        Path(out_path).write_bytes(b"%PDF-1.4 synthetic")
        return True

    def engine(self) -> str:
        return "fake browser" if self.works else "none"


def never(*_a: Any, **_k: Any) -> Any:
    raise AssertionError("this path must not be called")


# ---- synthetic data -------------------------------------------------------------

GUARANTEE = "30 qualified appointments in 90 days, or we work for free until we deliver."

_FILLER_LINES = [
    "Karim Example: Walk me through how a project usually starts for you.",
    "Fahad Sample: Someone we worked with before recommends us, and they call me directly.",
    "Karim Example: And who follows up when a quotation goes quiet?",
    "Fahad Sample: Honestly, me, between site visits and everything else.",
    "Karim Example: What happens in a quiet quarter?",
    "Fahad Sample: We wait. There is nothing to turn up.",
]


def transcript(extra: str = "") -> str:
    """A synthetic call, long enough to be a demo."""
    lines = [
        "Karim Example: Thanks for joining. Tell me about Mirage Test Contracting.",
        "Fahad Sample: We do villa fit-out in Riyadh. Most work comes from referrals.",
        "Fahad Sample: We get about 40 enquiries a month from Instagram and we spend 3,000 riyals a month on ads.",
        "Fahad Sample: Maybe 12 of them become meetings, and we sign 2 projects a month.",
        "Fahad Sample: Our average project is around 450,000 riyals.",
        "Fahad Sample: After everything, our net margin is about 18 percent.",
        "Fahad Sample: I want a pipeline that does not depend on who I know.",
    ]
    while sum(len(x) + 1 for x in lines) < 6000:
        lines.extend(_FILLER_LINES)
    if extra:
        lines.append(extra)
    return "\n".join(lines)


def fathom_turns(text: str) -> list[dict[str, Any]]:
    out = []
    for i, line in enumerate(text.splitlines()):
        who, _, said = line.partition(": ")
        out.append({"speaker": {"display_name": who}, "text": said, "timestamp": f"00:{i // 60:02d}:{i % 60:02d}"})
    return out


def _common() -> dict[str, Any]:
    return {
        "lang": "en",
        "reference": "MM-2099-0101-TST",
        "doc_type": "Proposal",
        "logo": "assets/mahara-logo.png",
        "client_company": "Mirage Test Contracting",
        "client_contact": "Fahad Sample",
        "client_role": "Owner",
        "city": "Riyadh, Saudi Arabia",
        "prepared_by": "Karim Example",
        "prepared_by_role": "Closer",
        "date": "1 January 2099",
        "valid_until": "15 January 2099",
        "confidentiality": "Commercial in confidence. Prepared for the named recipient only.",
        "kicker": "Client acquisition system",
        "subhead": "Referrals keep you busy. Nothing turns them up when a quarter goes quiet.",
        "cover_image": None,
        "gap_title": "Where the enquiries leak",
        "gap_close": "The enquiries arrive. The meetings do not follow.",
        "tree_title": "There are only two ways this number moves",
        "tree_intro": "Every route to the goal runs through one of two branches.",
        "tree_close": "Both are process, not talent.",
        "tree": {
            "goal_label": "The goal",
            "goal": "A pipeline that does not depend on who you know",
            "goal_note": "Referrals today.",
            "branches": [
                {"title": "Get more enquiries into a meeting", "note": "Twelve in forty today.",
                 "subs": [{"title": "Call every enquiry fast", "note": "Nobody calls within the hour."},
                          {"title": "Qualify before the meeting", "note": "Budget is asked too late."}]},
                {"title": "Sign more of the meetings you hold", "note": "Two a month today.",
                 "subs": [{"title": "Proof before the meeting", "note": "Nothing is sent ahead."},
                          {"title": "A closer who follows up", "note": "Quotations go quiet."}]},
            ],
        },
        "solution_title": "What we install against each one",
        "program": [
            {"title": "Paid advertising", "note": "Aimed at villa owners"},
            {"title": "Funnel filtration", "note": "Budget checked first"},
            {"title": "Call centre", "note": "Every enquiry called fast"},
            {"title": "Sales training", "note": "Weekly reviews"},
            {"title": "Reporting and CRM", "note": "Every number in one place"},
        ],
        "solution": [
            {"problem": "Slow first contact", "detail": "Hours to the first call", "fix": "Every enquiry called within minutes."},
            {"problem": "Late qualification", "detail": "Budget asked in the meeting", "fix": "The form asks budget and drawings first."},
            {"problem": "One channel", "detail": "Referrals only", "fix": "Tested creatives on more than one platform."},
            {"problem": "No proof ahead", "detail": "A stranger at the door", "fix": "A landing page and a short video before the meeting."},
            {"problem": "Owner does it all", "detail": "No time to follow up", "fix": "Weekly reviews for the people you have."},
        ],
        "solution_close": "Each fix answers one cause, in the same order.",
        "solution_targets": [{"v": "15 to 20", "k": "Meetings booked a month"},
                             {"v": "10 to 15", "k": "Meetings attended a month"},
                             {"v": "2 to 4", "k": "Projects signed a month"}],
        "proof": [
            {"v": "4x", "k": "A design firm grew its revenue inside three months.", "src": "Design firm, Gulf"},
            {"v": "USD 147,000", "k": "Signed from one small campaign.", "src": "Contractor, Gulf"},
            {"v": "104", "k": "Enquiries from a USD 500 test.", "src": "Contractor, Gulf"},
        ],
        "investment": {
            "rows": [
                {"item": "Program", "detail": "Premium Project Program, three months.", "amount": "USD 6,000"},
                {"item": "Payment structure", "detail": "Paid in full at the start. The deposit comes off it.",
                 "amount": "USD 6,000"},
                {"item": "Advertising budget", "detail": "Paid by you directly to the platforms.",
                 "amount": "USD 1,000 to 1,500 / month"},
                {"item": "Term", "detail": "Initial commitment, then renewable.", "amount": "3 months"},
            ],
            "total_label": "To start",
            "total_amount": "USD 6,000",
            "note": "The price is fixed.",
        },
        "terms": [
            "The advertising budget is paid by you directly to the platforms and never held by us.",
            "The ad account and the CRM are yours.",
        ],
        "start_title": "How to start",
        "deposit_label": "Deposit to reserve your start date",
        "deposit_amount": "USD 500",
        "start_steps": [
            {"when": "Today", "title": "Pay the deposit", "body": "It reserves the start date."},
            {"when": "Same day", "title": "Send the trade licence", "body": "We issue the contract the same day."},
            {"when": "7 to 15 days", "title": "Onboarding, then live", "body": "The first meetings land."},
        ],
        "start_note": "Signing below confirms acceptance of this proposal.",
        "company_line": "Mahara Media",
        "company_contact": "hello@maharamedia.com",
    }


def specific_deal(**over: Any) -> dict[str, Any]:
    deal = _common()
    deal.update({
        "headline": "One more villa every six months is worth SAR 162,000 a year to you",
        "gap_points": [{"v": "40", "k": "Enquiries a month"}, {"v": "12", "k": "Meetings a month"},
                       {"v": "2", "k": "Projects signed a month"}],
        "funnel": {"title": "The funnel today, one month", "stages": [
            {"label": "Enquiries", "note": "Instagram", "value": 40, "display": "40"},
            {"label": "Meetings", "note": "from enquiries", "value": 12, "display": "12"},
            {"label": "Signed", "note": "projects", "value": 2, "display": "2"}],
            "note": "Every figure is yours, from the call."},
        "cost": {
            "title": "What the gap costs you, in your own numbers",
            "intro": "Every figure below is one of yours.",
            "local_currency": "SAR",
            "layers": [
                {"name": "Advertising that buys enquiries nobody signs", "note": "Your monthly spend.", "monthly": 3000},
                {"name": "The villa the same funnel could have signed", "note": "One more every six months.", "monthly": 13500},
                {"name": "The load on the people", "note": "Meetings that end nowhere.", "monthly": 0, "instead": "Not counted"},
            ],
            "total_label": "What the gap costs you a year",
            "note": "The third layer is left unpriced.",
            "verdict_label": "Read it once",
            "verdict": "The gap is larger than the engagement several times over.",
            "close": "You already pay this every month.",
        },
        "roi": {"local_currency": "SAR", "usd_rate": 3.75, "months": 3, "fee_usd": 6000, "ad_monthly_usd": 1500,
                "avg_project_value": 450000, "margin_pct": 18},
    })
    deal.update(over)
    return deal


def general_deal(**over: Any) -> dict[str, Any]:
    deal = _common()
    deal.update({
        "variant": "general",
        "headline": "A pipeline that does not wait for a referral",
        "funnel": {"title": "The funnel today, one month", "stages": [
            {"label": "Enquiries", "note": "Instagram", "value": 40, "display": "40"},
            {"label": "Meetings", "note": "from enquiries", "value": 12, "display": "12"},
            {"label": "Signed", "note": "projects", "value": 2, "display": "2"}],
            "note": "Every figure is yours, from the call."},
        "arithmetic": {"currency": "SAR", "months": 3, "project_values": [200000, 500000, 1000000, 2000000],
                       "margins": [10, 20], "title": "What it takes to pay for itself",
                       "intro": "Find your row.", "note": "Every cell is our own fee divided.",
                       "verdict_label": "Read it once", "verdict": "Most rows need less than one project.",
                       "close": "The table asserts nothing about you."},
        "roi": {"local_currency": "SAR", "usd_rate": 3.75, "months": 3, "fee_usd": 6000, "ad_monthly_usd": 1500,
                "avg_project_value": 0, "margin_pct": 0},
    })
    deal.update(over)
    return deal


def blind_deal(**over: Any) -> dict[str, Any]:
    deal = _common()
    for k in ("start_steps", "terms", "start_note", "client_contact", "client_role"):
        deal.pop(k, None)
    deal.update({
        "variant": "blind",
        "sign": False,
        "headline": "What we find in fit-out firms like yours",
        "pattern": [{"title": f"Pattern {i}", "body": "Stated as a pattern about the category."} for i in range(1, 6)],
        "pattern_note": "From the firms we work with. Tell us which of these are yours.",
        "arithmetic": {"currency": "SAR", "months": 3, "inline": True, "project_values": [200000, 500000, 1000000],
                       "margins": [10, 20]},
        "cta": {"title": "A conversation first", "body": "Twenty minutes, your numbers.", "action": "Reply to book"},
        "roi": {"local_currency": "SAR", "usd_rate": 3.75, "months": 3, "fee_usd": 6000, "ad_monthly_usd": 1500,
                "avg_project_value": 0, "margin_pct": 0},
    })
    deal.update(over)
    return deal


def triage_answer(value: Any = 450000, margin: Any = 18, is_net: bool = True) -> dict[str, Any]:
    return {
        "avg_project_value": {"stated": value is not None, "value": value or 0, "currency": "SAR",
                              "quote": "Our average project is around 450,000 riyals."},
        "net_margin": {"stated": margin is not None, "value": margin or 0, "is_net": is_net,
                       "quote": "After everything, our net margin is about 18 percent.", "note": ""},
        "suggested_variant": "specific",
        "why": "both given",
    }


def meeting(rid: str, *, start: str, title: str = "Demo call", invitees: Optional[list[dict[str, Any]]] = None,
            recorder: str = "rep.one@maharamedia.com", minutes: int = 45) -> dict[str, Any]:
    t = datetime.fromisoformat(start.replace("Z", "+00:00"))
    end = t.timestamp() + minutes * 60
    return {
        "recording_id": int(rid) if rid.isdigit() else rid,
        "title": title,
        "recording_start_time": start,
        "recording_end_time": datetime.fromtimestamp(end, timezone.utc).isoformat().replace("+00:00", "Z"),
        "share_url": f"https://fathom.video/share/test-{rid}",
        "recorded_by": {"name": "Rep One", "email": recorder},
        "calendar_invitees": invitees if invitees is not None else [
            {"name": "Rep One", "email": recorder, "is_external": False}],
    }


# The offer the tests are written against, fixed here so a change Aziz makes to
# offer.json never breaks a test that is about something else.
TEST_OFFER: dict[str, Any] = {
    "currency": "USD",
    "program": {"name": "Premium Project Program", "price": 6000, "months": 3, "meetings": 30,
                "ads_monthly_min": 1000, "ads_monthly_max": 1500, "ads_daily_min": 30, "ads_daily_max": 50,
                "deposit": 500},
    "guarantee": {"default": False,
                  "text": "{meetings} qualified appointments in {days} days, or we work for free until we deliver."},
    "payment": {"default": "pif", "options": {
        "pif": {"label": "Paid in full at the start", "instalments": [{"share": 1, "due_days": 0, "due": "at the start"}]},
        "two_payments": {"label": "Two payments", "instalments": [
            {"share": 1, "due_days": 0, "due": "at the start"},
            {"share": 1, "due_days": 45, "due": "45 days after the start"}]},
        "monthly": {"label": "Monthly across the term", "per_month": True},
        "fixed": {"label": "Fixed amounts", "instalments": [
            {"amount": 2000, "due_days": 0, "due": "at the start"},
            {"amount": 3500, "due_days": 30, "due": "30 days after the start"}]},
    }},
    "pitch": {"enquiries_month": 75, "best_share_pct": 30, "meetings_month": "15 to 20",
              "quotations_month": "10 to 15", "close_rate_pct": 25, "signed_month": "2 to 4"},
}
