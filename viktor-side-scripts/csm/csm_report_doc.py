# -*- coding: utf-8 -*-
"""Write one client's monthly report as a branded, editable Google Doc.

Requested from the Client Success app (a row in `reportDocs`), built here because the app
has no Google access of its own. The CSM edits the doc before it goes anywhere — that is
the whole point of a doc rather than a PDF.

Everything factual comes from the client's own performance sheet via the stored profile.
The only generated prose is the "what this means" and "what we're doing next" wording, and
the model is given the numbers and the diagnosis and told to add no new facts.

Branding matches Aziz's Google Docs standard: Inter, H1/H2 navy #091333, H3 cyan #00CFC8.
"""

import asyncio
import datetime
import json
import re
import sys

sys.path.insert(0, "/work")
from sdk.tools.gdrive import gdrive_share  # noqa: E402
from sdk.tools.pd_google_docs import (  # noqa: E402
    pd_google_docs_create_document,
    pd_google_docs_get_document,
    pd_google_docs_proxy_post,
)
from sdk.tools.utils_tools import ai_structured_output  # noqa: E402

NAVY = {"red": 0x09 / 255, "green": 0x13 / 255, "blue": 0x33 / 255}
CYAN = {"red": 0x00 / 255, "green": 0xCF / 255, "blue": 0xC8 / 255}
INK = {"red": 0.12, "green": 0.12, "blue": 0.14}
MUTED = {"red": 0.42, "green": 0.45, "blue": 0.5}
WHITE = {"red": 1, "green": 1, "blue": 1}
BAND = {"red": 0xF4 / 255, "green": 0xFA / 255, "blue": 0xFA / 255}
RULE = {"red": 0xDD / 255, "green": 0xE2 / 255, "blue": 0xE8 / 255}


def humanise(text: str, rtl: bool = False) -> str:
    """Strip the tells of machine writing before anything reaches a client's eyes.

    Aziz's rule is absolute: no em dashes anywhere a client or team member reads. An em dash
    is doing one of two jobs, so it becomes a comma mid sentence or a full stop where the
    thought actually ends. Arabic gets the Arabic comma. This is the single chokepoint: every
    string in the document passes through here, so no label, prompt or model sentence can
    smuggle one in.
    """
    t = str(text)
    t = t.replace("\u2014", "\u060c " if rtl else ", ").replace("\u2013", " to ")
    t = t.replace(" ,", ",").replace(",,", ",").replace(", ,", ",")
    t = t.replace(" \u060c", "\u060c").replace("\u060c\u060c", "\u060c")
    t = re.sub(r"\s*,\s*$", "", t)
    t = re.sub(r"[ \t]{2,}", " ", t)
    return t.strip()
SHARE_WITH = ["aziz@maharamedia.com", "abdulelah@maharamedia.com"]

# The client KPI gates Aziz locked. Kept in step with src/lib/csmDiagnosis.ts — change
# both or neither.
GATES = {"bookingRate": 25, "showRate": 75, "closeRate": 20}

# The optional extras the CSM can tick in the app. Keys must match src/pages
# ClientPerformancePage.tsx REPORT_EXTRAS or a ticked box does nothing.
EXTRAS = ("lost", "byAd", "appointments", "ads")

LABELS = {
    "en": {
        "s1": "Performance snapshot",
        "s2": "Pipeline health",
        "s3": "Appointment log",
        "s4": "Ad performance",
        "s5": "Why leads were marked lost",
        "head": lambda c: f"{c}  ·  CSM CHECK-IN REPORT",
        "meta": lambda d, per: f"Report date: {d}  |  Period: {per}  |  Prepared by: Mahara Media",
        "snapcols": ("Metric", "Value", "Notes"),
        "stalerow": "Appointments with no outcome",
        "nosheet": (
            "We could not read your tracking sheet for this period, so the table below is "
            "empty rather than wrong. Nothing here should be read as a result until the "
            "sheet is connected and filled in."
        ),
        "apptcols": ("Added", "Appointment", "Lead", "Outcome", "From ad"),
        "adcols": ("Ad", "Leads", "Booked", "Attended", "Did not attend", "Closed"),
        "lostcols": ("Reason", "Leads", "What they told us"),
        "lostintro": lambda n, t: (
            f"{t} leads are marked lost in the CRM. Here is why, from the notes your team "
            f"wrote at the time, across the {n} most recent."
        ),
        "noout": "outcome not filled in",
        "attended": "attended",
        "didnot": "did not attend",
        "closed": "closed",
        "title": lambda c, m: f"{c} · performance report, {m}",
        "sub": "Prepared by Mahara Media · every number below comes from your own tracking sheet",
        "funnel": "Where the month stands",
        "means": "What this means",
        "next": "What we are doing next",
        "need": "What we need from you",
        "ads": "What is running right now",
        "metric": "Metric",
        "rows": [
            ("Enquiries", "leads"),
            ("Appointments booked", "booked"),
            ("Attended", "shows"),
            ("Did not attend", "noshows"),
            ("Quotations given", "quotes"),
            ("Projects closed", "closes"),
        ],
        "unfilled": lambda n: (
            f"{n} appointments on the sheet have no outcome filled in. Until they are "
            "marked attended or closed they count as nothing happened, both in this "
            "report and in how we optimise your budget."
        ),
        "nothing_unfilled": "Every appointment on the sheet has an outcome. Thank you, this is what lets us optimise properly.",
        "vs": lambda a, b: f"{a} vs {b} last month",
    },
    "ar": {
        "s1": "ملخص الأداء",
        "s2": "صحة الپايبلاين",
        "s3": "سجل المواعيد",
        "s4": "أداء الإعلانات",
        "s5": "أسباب خروج العملاء المحتملين",
        "head": lambda c: f"{c}  ·  تقرير متابعة العملاء",
        "meta": lambda d, per: f"تاريخ التقرير: {d}  |  الفترة: {per}  |  إعداد: مهارة ميديا",
        "snapcols": ("المؤشر", "القيمة", "ملاحظات"),
        "stalerow": "مواعيد بدون نتيجة",
        "nosheet": (
            "ما قدرنا نقرأ شيت المتابعة لهذي الفترة، فالجدول تحت فاضي مب غلط. لا تعتبرون "
            "أي رقم هنا نتيجة لين يتربط الشيت ويتعبى."
        ),
        "apptcols": ("أُضيف", "الموعد", "العميل", "النتيجة", "من إعلان"),
        "adcols": ("الإعلان", "استفسارات", "مواعيد", "حضروا", "ما حضروا", "تقفلت"),
        "lostcols": ("السبب", "العدد", "شنو قالوا"),
        "lostintro": lambda n, t: (
            f"{t} عميل محتمل مسجلين كخارج بالنظام. هذي الأسباب، من ملاحظات فريقك وقتها، "
            f"لآخر {n} حالة."
        ),
        "noout": "النتيجة ما تعبت",
        "attended": "حضر",
        "didnot": "ما حضر",
        "closed": "تقفلت",
        "title": lambda c, m: f"{c} · تقرير الأداء، {m}",
        "sub": "من فريق مهارة ميديا · كل رقم بهذا التقرير مصدره شيت المتابعة الخاص بك",
        "funnel": "وين وصل الشهر",
        "means": "شنو تعني هذي الأرقام",
        "next": "شنو نسوي بعدها",
        "need": "اللي نحتاجه منك",
        "ads": "اللي شغال حالياً",
        "metric": "المؤشر",
        "rows": [
            ("الاستفسارات", "leads"),
            ("المواعيد المحجوزة", "booked"),
            ("الحضور", "shows"),
            ("ما حضروا", "noshows"),
            ("العروض المقدمة", "quotes"),
            ("المشاريع المتقفلة", "closes"),
        ],
        "unfilled": lambda n: (
            f"{n} موعد بالشيت ما فيهم نتيجة. طالما ما تحددون: حضر ولا لا، وتقفل ولا لا، "
            "تُحسب كأن ما صار فيها شي، بهذا التقرير وبطريقة تحسيننا لميزانيتك."
        ),
        "nothing_unfilled": "كل المواعيد بالشيت فيها نتيجة. شكراً لك، هذا اللي يخلينا نحسّن بشكل صحيح.",
        "vs": lambda a, b: f"{a} مقابل {b} الشهر الماضي",
    },
}

NARRATIVE_SCHEMA = {
    "type": "object",
    "properties": {
        "means": {
            "type": "string",
            "description": (
                "2–4 sentences for the client explaining what the numbers say, including "
                "the single biggest leak. Use only the numbers given. No new facts, no "
                "promises, no percentages that are not in the data."
            ),
        },
        "next": {
            "type": "array",
            "items": {"type": "string"},
            "description": (
                "3–5 short lines: what Mahara is doing next, and what the client's own "
                "team should change. Derived only from the constraints given."
            ),
        },
    },
    "required": ["means", "next"],
}

NARRATIVE_PROMPT = """You write monthly client reports for Mahara Media, a marketing
agency for construction and design businesses in the Gulf. The reader is the client, a
business owner, not a marketer.

Rules:
- Use only the numbers and constraints given. Invent nothing: no results, no dates, no
  promises, no benchmark claims.
- Plain, confident, specific. No agency jargon, no "synergy", no hype.
- Never call the client a contractor. All money in USD.
- If a number is bad, say it plainly and say what is being done about it. Owning it is
  what keeps the client.
- Never use an em dash or an en dash. A comma or a full stop, always.
- Write in the requested language, and in Gulf Arabic if that is Arabic, not formal
  translation Arabic.
"""


def kuwait_month() -> str:
    """This month in Kuwait, for a client whose sheet carries no month label."""
    now = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=3)))
    return now.strftime("%B %Y")


def kuwait_today() -> str:
    """Today in Kuwait, spelled out for the report header."""
    now = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=3)))
    return now.strftime("%B %d, %Y")


def _pct(n, d):
    return round(100 * n / d) if d else None


def _month_num(perf: dict, key: str) -> dict:
    return {k: int(v or 0) for k, v in (perf.get(key) or {}).items() if isinstance(v, (int, float))}


def reporting_period(perf: dict) -> tuple[dict, dict, str]:
    """Which month this report is about, plus what to compare it to.

    On the 1st to the 5th the current month is nearly empty, and a report of six zeros is
    worse than no report. When the current month has no leads and the previous one does,
    the report is written about the completed month and labelled as that month.
    """
    m = _month_num(perf, "month")
    l = _month_num(perf, "lastMonth")
    a = _month_num(perf, "allTime")
    if m.get("leads", 0) == 0 and m.get("booked", 0) == 0 and l.get("leads", 0) > 0:
        return l, {}, str(perf.get("lastMonthLabel") or "")
    # Both months empty but there is history: a report of six zeros tells the client nothing,
    # so it becomes a since start report, labelled as one.
    if m.get("leads", 0) == 0 and l.get("leads", 0) == 0 and a.get("leads", 0) > 0:
        return a, {}, "since start"
    return m, l, str(perf.get("monthLabel") or kuwait_month())


def constraints_for(profile: dict) -> list[str]:
    """The same gate logic the app shows the CSM, in one line each.

    Deliberately duplicated from src/lib/csmDiagnosis.ts rather than imported — the app is
    TypeScript. Gates live in GATES above; keep the two in step.
    """
    perf = profile.get("performance") or {}
    m = _month_num(perf, "month")
    l = _month_num(perf, "lastMonth")
    leads = m.get("leads", 0) + l.get("leads", 0)
    booked = m.get("booked", 0) + l.get("booked", 0)
    shows = m.get("shows", 0) + l.get("shows", 0)
    noshows = m.get("noshows", 0) + l.get("noshows", 0)
    closes = m.get("closes", 0) + l.get("closes", 0)
    out = []
    if leads == 0:
        # Never let the narrative claim health from an empty sheet. Silence is not success.
        return [
            "there is no readable appointment data for this client yet, so no stage of the "
            "funnel can be judged, and the report must say exactly that rather than imply "
            "the funnel is healthy"
        ]
    br = _pct(booked, leads)
    sr = _pct(shows, shows + noshows)
    cr = _pct(closes, shows)
    if perf.get("staleCount"):
        out.append(
            f"{perf['staleCount']} appointments have no outcome filled in on their sheet, "
            "we are optimising half blind until they are marked"
        )
    if br is not None and leads >= 10 and br < GATES["bookingRate"]:
        out.append(
            f"only {br}% of enquiries became appointments (target {GATES['bookingRate']}%), "
            "speed to lead and follow-up on the client's side, not the ads"
        )
    if sr is not None and (shows + noshows) >= 8 and sr < GATES["showRate"]:
        out.append(
            f"show rate {sr}% (target {GATES['showRate']}%), book same or next day and "
            "confirm twice, once at booking and once the morning of"
        )
    if cr is not None and shows >= 5 and cr < GATES["closeRate"]:
        out.append(
            f"close rate {cr}% of attended (target {GATES['closeRate']} to 30%), review two "
            "call recordings before blaming lead quality"
        )
    if not out:
        out.append(
            "every measurable stage is at or above target, the constraint is budget and "
            "capacity, not the funnel"
        )
    return out


async def narrative(profile: dict, language: str, note: str | None) -> dict:
    perf = profile.get("performance") or {}
    period, previous, label = reporting_period(perf)
    payload = {
        "client": profile.get("clientName"),
        "month": label,
        "thisMonth": period,
        "lastMonth": previous,
        "allTime": _month_num(perf, "allTime"),
        "appointmentsWithNoOutcome": perf.get("staleCount"),
        "constraints": constraints_for(profile),
        "csmNote": note or "",
        "language": "Arabic" if language == "ar" else "English",
    }
    res = await ai_structured_output(
        prompt=NARRATIVE_PROMPT,
        input_text=json.dumps(payload, ensure_ascii=False),
        output_schema=NARRATIVE_SCHEMA,
        intelligence_level="smart",
    )
    # `.result` is the schema payload. An empty result used to ship a report with blank
    # sections, so it is an error here, not a shrug.
    data = res.result if isinstance(res.result, dict) else {}
    if isinstance(data, str):
        data = json.loads(data)
    if not data:
        raise RuntimeError(f"the model returned nothing: {res.error or 'empty result'}")
    return data


def month_range(perf: dict, label: str) -> tuple[str, str]:
    """The reported month as (since, until) dates, for the ad spend read."""
    import datetime as _dt

    today = _dt.date.today()
    key = None
    for candidate in (perf.get("monthLabel"), perf.get("lastMonthLabel")):
        if candidate == label:
            key = candidate
            break
    first = today.replace(day=1)
    if key and key == perf.get("lastMonthLabel"):
        last_prev = first - _dt.timedelta(days=1)
        return last_prev.replace(day=1).isoformat(), last_prev.isoformat()
    return first.isoformat(), today.isoformat()


def outcome_of(row: dict, L: dict) -> str:
    """One word for what happened to an appointment. Blank stays blank, never a guess."""
    if str(row.get("closed", "")).strip().upper().startswith("Y"):
        return L["closed"]
    show = str(row.get("show", "")).strip().upper()
    if show.startswith("Y"):
        return L["attended"]
    if show.startswith("N"):
        return L["didnot"]
    return L["noout"]


def blocks_for(
    profile: dict,
    language: str,
    story: dict,
    note: str | None,
    extras: list[str],
    spend: dict | None = None,
) -> list[tuple[str, object]]:
    """The report as an ordered list of ("text", segments) and ("table", rows) blocks.

    The standard template is Aziz's own CSM check-in report: snapshot, pipeline health,
    appointment log, ad performance. Everything else is an extra the CSM ticks, so the
    default document is always the same shape and the CSM decides what to add on top.
    """
    L = LABELS["ar" if language == "ar" else "en"]
    perf = profile.get("performance") or {}
    m, l, month_label = reporting_period(perf)
    today = kuwait_today()
    counter = {"n": 0}

    def head(key: str) -> str:
        """Number the sections as they are actually written, so a skipped one leaves no gap."""
        counter["n"] += 1
        return f"{counter['n']}.  {L[key]}"
    blocks: list[tuple[str, object]] = [
        (
            "text",
            [
                (L["head"](profile.get("clientName", "")), "h1"),
                (L["meta"](today, month_label), "meta"),
            ],
        ),
        ("text", [(head("s1"), "h2")]),
    ]

    # 1. Performance snapshot.
    no_data = not int(m.get("leads", 0) or 0) and not int(
        (_month_num(perf, "allTime")).get("leads", 0) or 0
    )
    if no_data:
        blocks.append(("text", [(L["nosheet"], "body")]))
    snap = [list(L["snapcols"])]
    for label, key in L["rows"]:
        note_cell = L["vs"](m.get(key, 0), l.get(key, 0)) if l else ""
        snap.append([label, str(m.get(key, 0)), note_cell])
    if spend and spend.get("spend"):
        snap.append(["Amount spent on ads", f"${spend['spend']:,.2f} USD", spend.get("account", "")])
        if spend.get("cpl"):
            snap.append(["Cost per lead", f"${spend['cpl']:,.2f} USD", "Ad spend / leads"])
    stale = int(perf.get("staleCount") or 0)
    snap.append([L["stalerow"], str(stale), L["noout"]])
    blocks.append(("table", snap))

    # 2. Pipeline health: the narrative, then what we need from them.
    segs: list[tuple[str, str]] = [(head("s2"), "h2"), (str(story.get("means", "")).strip(), "body")]
    for line in story.get("next", []) or []:
        segs.append((str(line).strip(), "bullet"))
    segs.append((L["need"], "h3"))
    segs.append((L["unfilled"](stale) if stale else L["nothing_unfilled"], "body"))
    blocks.append(("text", segs))

    # 3. Appointment log, oldest first the way his template reads.
    rows = list(reversed((perf.get("recent") or [])))
    if "appointments" in extras and rows:
        blocks.append(("text", [(head("s3"), "h2")]))
        log = [list(L["apptcols"])]
        for r in rows[-25:]:
            log.append(
                [
                    str(r.get("added") or ""),
                    str(r.get("appDate") or ""),
                    str(r.get("name") or ""),
                    outcome_of(r, L),
                    str(r.get("ad") or r.get("source") or ""),
                ]
            )
        blocks.append(("table", log))

    # 4. Ad performance, lead by lead quality rather than volume.
    by_ad = (perf.get("byAdAllTime") if month_label == "since start" else None) or perf.get(
        "byAd"
    ) or []
    if "byAd" in extras and by_ad:
        blocks.append(("text", [(head("s4"), "h2")]))
        table = [list(L["adcols"])]
        for a in by_ad:
            table.append(
                [
                    str(a.get("ad") or ""),
                    str(a.get("leads") or 0),
                    str(a.get("booked") or 0),
                    str(a.get("shows") or 0),
                    str(a.get("noshows") or 0),
                    str(a.get("closes") or 0),
                ]
            )
        blocks.append(("table", table))

    # 5. Why leads were marked lost, straight from their own CRM notes.
    lost = profile.get("lost") or {}
    if "lost" in extras and (lost.get("reasons") or []):
        leads = lost.get("leads") or []
        blocks.append(
            (
                "text",
                [
                    (head("s5"), "h2"),
                    (L["lostintro"](len(leads), lost.get("total") or len(leads)), "body"),
                ],
            )
        )
        table = [list(L["lostcols"])]
        for r in lost["reasons"]:
            reason = re.sub(r"\s*\(Write why.*\)", "", str(r.get("reason") or ""))
            notes = [
                str(x.get("note") or "").strip()
                for x in leads
                if x.get("reason") == r.get("reason") and str(x.get("note") or "").strip()
            ]
            table.append([reason, str(r.get("count") or 0), " · ".join(notes[:3])[:400]])
        blocks.append(("table", table))

    # Optional: what is running right now.
    if "ads" in extras and (profile.get("ads") or []):
        segs = [(L["ads"], "h2")]
        for c in profile["ads"]:
            live = sum(
                1
                for st in (c.get("adsets") or [])
                for a in (st.get("ads") or [])
                if "active" in str(a.get("status", "")).lower()
            )
            segs.append((f"{c.get('campaign', '')} · {live} ads live", "bullet"))
        blocks.append(("text", segs))

    if note:
        blocks.append(
            ("text", [(f"CSM note (delete before sending): {note}", "body")])
        )
    return blocks


async def _batch(doc_id: str, requests: list[dict]) -> None:
    """Run a batchUpdate in safe chunks and fail loudly, never half-silently."""
    for i in range(0, len(requests), 400):
        res = await pd_google_docs_proxy_post(
            url=f"https://docs.googleapis.com/v1/documents/{doc_id}:batchUpdate",
            json_body={"requests": requests[i : i + 400]},
        )
        if '"status_code": 200' not in str(res):
            raise RuntimeError(f"batchUpdate failed: {str(res)[:300]}")


async def _document(doc_id: str) -> dict:
    """The document JSON. The connector wraps it in a `content` string."""
    res = await pd_google_docs_get_document(documentId=doc_id)
    body = res.get("content", res) if isinstance(res, dict) else res
    if isinstance(body, str):
        body = json.loads(body)
    return body


async def append_table(doc_id: str, rows: list[list[str]], rtl: bool) -> None:
    """Append a real Google Docs table and fill it.

    Cells are written **last cell first**: an insert shifts every index after it, so filling
    in reverse means the indices read from the document stay valid for the whole batch. This
    is why the table is fetched back rather than having its indices calculated.
    """
    if not rows:
        return
    width = max(len(r) for r in rows)
    await _batch(
        doc_id,
        [
            {
                "insertTable": {
                    "endOfSegmentLocation": {},
                    "rows": len(rows),
                    "columns": width,
                }
            }
        ],
    )
    doc = await _document(doc_id)
    tables = [el for el in doc.get("body", {}).get("content", []) if el.get("table")]
    if not tables:
        raise RuntimeError("the table was inserted but cannot be found in the document")
    table = tables[-1]["table"]
    table_start = tables[-1]["startIndex"]
    reqs: list[dict] = list(_table_shell(table_start, len(rows), width))
    for r in range(len(rows) - 1, -1, -1):
        cells = table["tableRows"][r]["tableCells"]
        for c in range(min(width, len(cells)) - 1, -1, -1):
            text = humanise(rows[r][c] if c < len(rows[r]) else "", rtl)
            if not text:
                continue
            at = cells[c]["content"][0]["startIndex"]
            reqs.append({"insertText": {"location": {"index": at}, "text": text}})
            rng = {"startIndex": at, "endIndex": at + len(text)}
            reqs.append(
                {
                    "updateTextStyle": {
                        "range": rng,
                        "textStyle": {
                            "weightedFontFamily": {"fontFamily": "Inter"},
                            "fontSize": {"magnitude": 10, "unit": "PT"},
                            "bold": r == 0 or c == 0,
                            "foregroundColor": {
                                "color": {"rgbColor": WHITE if r == 0 else INK}
                            },
                        },
                        "fields": "weightedFontFamily,fontSize,bold,foregroundColor",
                    }
                }
            )
            reqs.append(
                {
                    "updateParagraphStyle": {
                        "range": rng,
                        "paragraphStyle": {
                            "direction": "RIGHT_TO_LEFT" if rtl else "LEFT_TO_RIGHT",
                            "alignment": "END" if rtl else "START",
                        },
                        "fields": "direction,alignment",
                    }
                }
            )
    await _batch(doc_id, reqs)


def _table_shell(table_start: int, rows: int, cols: int) -> list[dict]:
    """Brand dressing for a table: navy header band, zebra rows, hairline borders.

    Written as its own batch of requests ahead of the cell text so the header band exists
    before anything is typed into it, which is what keeps white header text readable.
    """
    loc = {"index": table_start}
    band = lambda i, n, colour: {  # noqa: E731
        "updateTableCellStyle": {
            # tableRange and tableStartLocation are a oneof: sending both is a 400.
            "tableRange": {
                "tableCellLocation": {
                    "tableStartLocation": loc,
                    "rowIndex": i,
                    "columnIndex": 0,
                },
                "rowSpan": n,
                "columnSpan": cols,
            },
            "tableCellStyle": {
                "backgroundColor": {"color": {"rgbColor": colour}},
                "paddingTop": {"magnitude": 5, "unit": "PT"},
                "paddingBottom": {"magnitude": 5, "unit": "PT"},
                "paddingLeft": {"magnitude": 7, "unit": "PT"},
                "paddingRight": {"magnitude": 7, "unit": "PT"},
            },
            "fields": (
                "backgroundColor,paddingTop,paddingBottom,paddingLeft,paddingRight"
            ),
        }
    }
    reqs = [band(0, 1, NAVY)]
    # Zebra striping on every other body row, so a wide appointment log stays readable.
    for r in range(2, rows, 2):
        reqs.append(band(r, 1, BAND))
    hairline = {"color": {"color": {"rgbColor": RULE}}, "width": {"magnitude": 0.5, "unit": "PT"}, "dashStyle": "SOLID"}
    reqs.append(
        {
            "updateTableCellStyle": {
                "tableStartLocation": loc,
                "tableCellStyle": {
                    "borderTop": hairline,
                    "borderBottom": hairline,
                    "borderLeft": hairline,
                    "borderRight": hairline,
                },
                "fields": "borderTop,borderBottom,borderLeft,borderRight",
            }
        }
    )
    return reqs


async def append_text(doc_id: str, segs: list[tuple[str, str]], rtl: bool) -> None:
    """Append styled paragraphs to the end of the document."""
    segs = [(humanise(t, rtl), k) for t, k in segs if str(t).strip()]
    if not segs:
        return
    doc = await _document(doc_id)
    content = doc.get("body", {}).get("content", [])
    start = max(int(el.get("endIndex", 1)) for el in content) - 1 if content else 1
    text = "".join(t + "\n" for t, _ in segs)
    reqs: list[dict] = [{"insertText": {"location": {"index": start}, "text": text}}]
    reqs += _style_requests(segs, start, rtl)
    await _batch(doc_id, reqs)


def _style_requests(segs: list[tuple[str, str]], start: int, rtl: bool) -> list[dict]:
    """Font, colour, spacing and bullets for text already inserted at `start`.

    Brand rules: Inter throughout, H1 and H2 navy, H3 cyan, body near black, meta line grey
    with a cyan rule under it so the first page reads like a report and not a memo.
    """
    reqs: list[dict] = []
    bullets: list[dict] = []
    idx = start
    for t, kind in segs:
        rng = {"startIndex": idx, "endIndex": idx + len(t)}
        idx = idx + len(t) + 1
        para: dict = {
            "direction": "RIGHT_TO_LEFT" if rtl else "LEFT_TO_RIGHT",
            "alignment": "END" if rtl else "START",
        }
        fields_p = "namedStyleType,direction,alignment,spaceAbove,spaceBelow,lineSpacing"
        para["lineSpacing"] = 115
        if kind in ("body", "bullet", "meta"):
            para["namedStyleType"] = "NORMAL_TEXT"
            para["spaceAbove"] = {"magnitude": 0 if kind == "bullet" else 6, "unit": "PT"}
            para["spaceBelow"] = {"magnitude": 4 if kind == "bullet" else 8, "unit": "PT"}
            style = {
                "weightedFontFamily": {"fontFamily": "Inter"},
                "fontSize": {"magnitude": 9 if kind == "meta" else 11, "unit": "PT"},
                "foregroundColor": {
                    "color": {"rgbColor": MUTED if kind == "meta" else INK}
                },
                "italic": False,
                "bold": False,
            }
            fields = "weightedFontFamily,fontSize,foregroundColor,italic,bold"
            if kind == "meta":
                # A cyan hairline under the header block, the one flash of brand colour.
                para["borderBottom"] = {
                    "color": {"color": {"rgbColor": CYAN}},
                    "width": {"magnitude": 1.5, "unit": "PT"},
                    "padding": {"magnitude": 6, "unit": "PT"},
                    "dashStyle": "SOLID",
                }
                para["spaceBelow"] = {"magnitude": 18, "unit": "PT"}
                fields_p += ",borderBottom"
            if kind == "bullet":
                bullets.append(
                    {
                        "createParagraphBullets": {
                            "range": rng,
                            "bulletPreset": "BULLET_DISC_CIRCLE_SQUARE",
                        }
                    }
                )
        else:
            para["namedStyleType"] = {
                "h1": "TITLE",
                "h2": "HEADING_2",
                "h3": "HEADING_3",
            }[kind]
            para["spaceAbove"] = {
                "magnitude": {"h1": 0, "h2": 22, "h3": 14}[kind],
                "unit": "PT",
            }
            para["spaceBelow"] = {
                "magnitude": {"h1": 4, "h2": 8, "h3": 4}[kind],
                "unit": "PT",
            }
            style = {
                "weightedFontFamily": {"fontFamily": "Inter"},
                "fontSize": {"magnitude": {"h1": 26, "h2": 15, "h3": 12}[kind], "unit": "PT"},
                "bold": True,
                "italic": False,
                "foregroundColor": {"color": {"rgbColor": CYAN if kind == "h3" else NAVY}},
            }
            if kind == "h1":
                style["letterSpacing"] = None
                del style["letterSpacing"]
            fields = "weightedFontFamily,fontSize,bold,italic,foregroundColor"
        reqs.append(
            {"updateParagraphStyle": {"range": rng, "paragraphStyle": para, "fields": fields_p}}
        )
        reqs.append({"updateTextStyle": {"range": rng, "textStyle": style, "fields": fields}})
    # Bullets last: creating them shifts nothing else in this batch's ranges.
    return reqs + bullets


async def set_document_style(doc_id: str) -> None:
    """Page setup for the whole document: generous margins and Inter as the default font.

    Google's API cannot switch a document to pageless, that toggle exists only in the UI, so
    the next best thing is wide margins and a clean type scale. Say so rather than pretend.
    """
    await _batch(
        doc_id,
        [
            {
                "updateDocumentStyle": {
                    "documentStyle": {
                        "marginTop": {"magnitude": 54, "unit": "PT"},
                        "marginBottom": {"magnitude": 54, "unit": "PT"},
                        "marginLeft": {"magnitude": 64, "unit": "PT"},
                        "marginRight": {"magnitude": 64, "unit": "PT"},
                    },
                    "fields": "marginTop,marginBottom,marginLeft,marginRight",
                }
            }
        ],
    )


async def build_report_doc(
    profile: dict,
    language: str = "en",
    note: str | None = None,
    extras: list[str] | None = None,
) -> str:
    """Create the report doc from the standard template, style it, share it, return its URL.

    `extras` are the boxes the CSM ticked in the app. Nothing is dropped silently: an unknown
    extra is ignored, and an empty list still produces the full standard template.
    """
    wanted = list(extras) if extras else list(EXTRAS)
    story = await narrative(profile, language, note)
    perf = profile.get("performance") or {}
    month_label = reporting_period(perf)[2]
    spend = {}
    if "byAd" in wanted:
        try:
            sys.path.insert(0, "/work/skills/csm_daily_workflow/scripts")
            from csm_ad_tree import month_spend  # noqa: PLC0415

            since, until = month_range(perf, month_label)
            spend = month_spend(profile.get("clientName", ""), since, until) or {}
        except Exception as exc:  # a missing spend figure must not lose the report
            print(f"could not read ad spend: {exc}")
    blocks = blocks_for(profile, language, story, note, wanted, spend)
    title = LABELS["ar" if language == "ar" else "en"]["title"](
        profile.get("clientName", ""), month_label
    )
    doc = await pd_google_docs_create_document(title=title)
    content = doc.get("content", doc) if isinstance(doc, dict) else doc
    if isinstance(content, str):
        content = json.loads(content)
    doc_id = content.get("documentId")
    if not doc_id:
        raise RuntimeError(f"no documentId in create response: {str(doc)[:300]}")
    rtl = language == "ar"
    await set_document_style(doc_id)
    for kind, payload in blocks:
        if kind == "text":
            await append_text(doc_id, payload, rtl)  # type: ignore[arg-type]
        else:
            await append_table(doc_id, payload, rtl)  # type: ignore[arg-type]
    for email in SHARE_WITH:
        try:
            await gdrive_share(
                unified_uri=f"gdrive:///{doc_id}",
                email=email,
                permission="writer",
                send_notification=False,
            )
        except Exception as exc:  # sharing must never lose the document
            print(f"could not share with {email}: {exc}")
    return f"https://docs.google.com/document/d/{doc_id}/edit"


async def _demo(name: str) -> None:
    """Build a doc for one client straight from production, for eyeballing."""
    sys.path.insert(0, "/work/skills/csm_daily_workflow/scripts")
    from csm_app_bridge import prod  # noqa: E402

    profile = await prod("profileFor", {"clientName": name})
    if not profile:
        raise SystemExit(f"no stored profile for {name}")
    print(await build_report_doc(profile, "en", None, list(EXTRAS)))


if __name__ == "__main__":
    asyncio.run(_demo(sys.argv[1] if len(sys.argv) > 1 else "Olivar Design"))
