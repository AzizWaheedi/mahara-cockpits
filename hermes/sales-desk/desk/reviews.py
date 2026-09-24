"""Vince's call reviews, in the cockpit.

Vince was the sales coach on the VPS (OpenClaw agent `sales-coach`): he read a
demo call's transcript, scored it on fifteen parts of Mahara's framework out
of 150 (an intro on ten parts), wrote the pros, the feedback with the exact
lines to use instead, and posted it to #sales-call-feedback. He has been off
since 2026-08-24. Aziz, 2026-09-24: "there should be a call reviewer here
that's on the VPS from the VPS's call reviewer".

This module
- reads Vince's reviews (his 121 in the archive, and every new one) into one
  shape: the call, the rep, the lead, each part's score, the grade, the pros,
  the feedback and the whole text;
- imports the archive (`import_archive`), joining each review to its call by
  the Fathom link in it, or for an intro by the Maqsam call id in its name;
- reviews new demo calls (`review_new`) with Vince's own template and
  framework, on the desk's model (the VPS keys; Vince used a proxy on another
  account, which the cockpit does not).
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any, Callable, Optional

from . import http

ITEM = re.compile(r"^\*?\s*(?:\d+\.\s*)?(?P<name>[^*\n]+?)\s+[—–-]\s+(?P<score>\d+(?:\.\d+)?)\s*/\s*(?P<max>\d+)\s*\*?\s*$")
GRADE = re.compile(r"\bGrade\s*:?\s*\*?\s*(?P<score>\d+(?:\.\d+)?)\s*/\s*(?P<max>\d+)", re.I)
TOTAL = re.compile(r"\bTotal\s*:?\s*\*?\s*(?P<score>\d+(?:\.\d+)?)\s*/\s*(?P<max>\d+)", re.I)
# "Closer Name: X", "*Closer Name:*X", "Lead: X", "Date Of Call: 2026-08-23".
FIELD = re.compile(
    r"^\*?(?P<key>(?:Closer|Setter|Rep|Lead|Client)(?:\s+Name)?|Date Of Call|Date|Call Recording Link|Recording(?:\s+Link)?)"
    r"\s*:\s*\*?\s*(?P<value>.+?)\s*\*?\s*$", re.I)
FATHOM_LINK = re.compile(r"https://fathom\.video/(?:share|calls)/[A-Za-z0-9_-]+")
FOOTER = re.compile(r"^>?\s*React to this message.*$", re.I | re.M)
MAQSAM_ID = re.compile(r"intro_(?P<date>\d{4}-\d{2}-\d{2})_(?P<call>[A-Za-z0-9-]+)", re.I)


def _section(text: str, start: str, stops: tuple[str, ...]) -> str:
    """The text after a `*Start:*` label up to the next of `stops` or a rule."""
    m = re.search(rf"^\*?{re.escape(start)}\s*:?\*?\s*$", text, re.I | re.M)
    if not m:
        return ""
    rest = text[m.end():]
    ends = [rest.find("\n---")] + [
        mm.start() for s in stops for mm in [re.search(rf"^\*?{re.escape(s)}", rest, re.I | re.M)] if mm]
    ends = [e for e in ends if e >= 0]
    return rest[: min(ends)].strip() if ends else rest.strip()


def parse(text: str, name: str = "") -> dict[str, Any]:
    """One review in Vince's format, whichever model wrote it."""
    body = text.replace("\r\n", "\n")
    # The model's own preamble ("Reading the full transcript now...") sits
    # above the first rule; the log starts at its heading.
    head = re.search(r"^#\s+.*(?:Coaching Log|Review).*$", body, re.I | re.M)
    if head:
        body = body[head.start():]
    body = FOOTER.sub("", body).strip()

    fields: dict[str, str] = {}
    for line in body.splitlines()[:40]:
        m = FIELD.match(line.strip())
        if m:
            key = re.sub(r"\s+name$", "", m.group("key").strip().lower())
            fields.setdefault(key, m.group("value").strip())
    items = []
    for line in body.splitlines():
        m = ITEM.match(line.strip())
        if m and float(m.group("max")) <= 10:
            items.append({"name": m.group("name").strip(" *_"), "score": float(m.group("score")),
                          "max": float(m.group("max"))})
    g = GRADE.search(body) or TOTAL.search(body)
    score = float(g.group("score")) if g else (sum(i["score"] for i in items) if items else None)
    score_max = float(g.group("max")) if g else (sum(i["max"] for i in items) if items else None)

    heading = head.group(0).lower() if head else ""
    lowered = (name + " " + heading).lower()
    call_type = "intro" if ("intro" in lowered or "تعريفية" in lowered) else ("demo" if items or "demo" in lowered else None)
    link = FATHOM_LINK.search(fields.get("call recording link", "") or body)
    date = fields.get("date of call") or fields.get("date") or ""
    m_date = re.search(r"\d{4}-\d{2}-\d{2}", date)
    mq = MAQSAM_ID.search(name)
    return {
        "call_type": call_type,
        "rep_name": fields.get("closer") or fields.get("setter") or fields.get("rep"),
        "lead_name": fields.get("lead") or fields.get("client"),
        "call_day": m_date.group(0) if m_date else (mq.group("date") if mq else None),
        "link": link.group(0) if link else None,
        "maqsam_call_id": mq.group("call") if mq else None,
        "items": items or None,
        "score": score,
        "score_max": score_max,
        "pros": _section(body, "Pros", ("Feedback", "3 Biggest", "Three", "Biggest")) or None,
        "feedback": _section(body, "Feedback", ("3 Biggest", "Three Biggest", "Biggest Things", "Grade")) or None,
        "body": body,
    }


def _norm(s: Any) -> str:
    return re.sub(r"\s+", " ", str(s or "")).strip().lower()


def _clear_best(scored: list[tuple[float, str]], floor: float = 0.8) -> Optional[str]:
    scored = sorted(scored, reverse=True)
    if scored and scored[0][0] >= floor and (len(scored) == 1 or scored[0][0] - scored[1][0] >= 0.1):
        return scored[0][1]
    return None


def rep_key_for(name: Optional[str], reps: list[dict[str, Any]]) -> Optional[str]:
    """B2B's rep id for a reviewed name. In order: the display name or a
    closer alias exactly; the clearly closest spelling ("Ahmed Abusahiba");
    the first name exactly ("Maria Jaadeh" is Maria); the clearly closest
    first name ("Miriam Al Laham" is Mariam). "(MaharaMedia)" is dropped."""
    n = _norm(re.sub(r"\([^)]*\)", "", str(name or "")))
    if not n:
        return None
    every = [(str(r["id"]), [_norm(x) for x in [r.get("display_name")] + list(r.get("closer_aliases") or [])
                             if _norm(x)]) for r in reps]
    for rid, names in every:
        if n in names:
            return rid
    full = _clear_best([(max((SequenceMatcher(None, n, x).ratio() for x in names), default=0.0), rid)
                        for rid, names in every])
    if full:
        return full
    first = n.split(" ")[0]
    exact = {rid for rid, names in every if any(x.split(" ")[0] == first for x in names)}
    if len(exact) == 1:
        return exact.pop()
    return _clear_best([(max((SequenceMatcher(None, first, x.split(" ")[0]).ratio() for x in names), default=0.0), rid)
                        for rid, names in every])


def _tokens(s: Any) -> set[str]:
    return {t for t in re.split(r"[^\w\u0600-\u06FF]+", _norm(s)) if len(t) >= 3}


def by_day_and_name(p: dict[str, Any], recordings: list[dict[str, Any]]) -> Optional[dict[str, Any]]:
    """The recording of a review that carries no share link: the one call on
    the review's day (Riyadh) whose title or invitees share a name with the
    reviewed lead, when exactly one does."""
    day, lead = p.get("call_day"), _tokens(p.get("lead_name"))
    if not day or not lead:
        return None
    hits = []
    for r in recordings:
        at = r.get("started_at")
        if not at:
            continue
        t = datetime.fromisoformat(str(at).replace("Z", "+00:00")) + timedelta(hours=3)
        if t.date().isoformat() != day:
            continue
        names = _tokens(r.get("title")) | {tok for x in (r.get("people") or []) for tok in _tokens(
            x.get("name") if isinstance(x, dict) else x)}
        if lead & names:
            hits.append(r)
    return hits[0] if len(hits) == 1 else None


def longest_that_day(p: dict[str, Any], recordings: list[dict[str, Any]], rep_emails: set[str]) -> Optional[dict[str, Any]]:
    """Vince picked each day's longest eligible demo, so a demo review with
    no link and no name to go on belongs to the rep's longest call that day
    (any rep's, when the rep is unknown and only one call was that long)."""
    day = p.get("call_day")
    if not day or p.get("call_type") != "demo":
        return None
    that_day = []
    for r in recordings:
        at = r.get("started_at")
        if not at:
            continue
        t = datetime.fromisoformat(str(at).replace("Z", "+00:00")) + timedelta(hours=3)
        if t.date().isoformat() == day:
            that_day.append(r)
    theirs = [r for r in that_day if str(r.get("recorded_by") or "").lower() in rep_emails] if rep_emails else []
    pool = theirs or that_day
    pool = sorted(pool, key=lambda r: int(r.get("duration_s") or 0), reverse=True)
    if not pool or not pool[0].get("duration_s"):
        return None
    if len(pool) > 1 and not theirs and int(pool[0]["duration_s"]) == int(pool[1].get("duration_s") or 0):
        return None
    return pool[0]


def import_archive(sb: Any, folder: Path, log: Callable[[str], None], *, dry: bool = False) -> dict[str, Any]:
    """Vince's archived reviews into cockpit_sales_reviews, joined to calls."""
    files = sorted(folder.glob("*_review.md"))
    if not files:
        raise FileNotFoundError(f"No Vince reviews in {folder}")
    reps = sb.select("cockpit_sales_reps", "select=id,display_name,closer_aliases,fathom_email,maqsam_email&limit=500")
    emails_of = {str(r["id"]): {str(r.get(k) or "").lower() for k in ("fathom_email", "maqsam_email") if r.get(k)}
                 for r in reps}
    parsed = [(f, parse(f.read_text(encoding="utf-8", errors="replace"), f.name)) for f in files]

    links = sorted({p["link"] for _f, p in parsed if p["link"]})
    by_link: dict[str, dict[str, Any]] = {}
    for i in range(0, len(links), 40):
        chunk = ",".join('"' + x + '"' for x in links[i : i + 40])
        for r in sb.select("cockpit_sales_recordings",
                           f"select=recording_id,contact_id,started_at,share_url&share_url=in.({http.quote(chunk)})"):
            by_link[str(r["share_url"])] = r
    calls = sorted({p["maqsam_call_id"] for _f, p in parsed if p["maqsam_call_id"]})
    by_call: dict[str, dict[str, Any]] = {}
    for i in range(0, len(calls), 40):
        chunk = ",".join('"' + x + '"' for x in calls[i : i + 40])
        for r in sb.select("cockpit_sales_dials",
                           f"select=call_id,contact_id,occurred_at&call_id=in.({http.quote(chunk)})"):
            by_call[str(r["call_id"])] = r

    days = sorted({p["call_day"] for _f, p in parsed if p["call_day"]})
    nearby: list[dict[str, Any]] = []
    if days:
        lo = (datetime.fromisoformat(days[0]) - timedelta(days=1)).date().isoformat()
        hi = (datetime.fromisoformat(days[-1]) + timedelta(days=2)).date().isoformat()
        offset = 0
        while True:
            page = sb.select("cockpit_sales_recordings",
                             "select=recording_id,contact_id,started_at,title,people,share_url,recorded_by,duration_s"
                             f"&started_at=gte.{lo}&started_at=lt.{hi}&order=started_at.asc,recording_id.asc"
                             f"&limit=1000&offset={offset}")
            nearby.extend(page)
            if len(page) < 1000:
                break
            offset += 1000

    rows = []
    how_counts: dict[str, int] = {}
    for f, p in parsed:
        rep_key = rep_key_for(p["rep_name"], reps)
        rec = by_link.get(p["link"] or "")
        how = "link" if rec else None
        if rec is None and not p["maqsam_call_id"]:
            rec = by_day_and_name(p, nearby)
            how = "day_name" if rec else None
        if rec is None and not p["maqsam_call_id"]:
            rec = longest_that_day(p, nearby, emails_of.get(rep_key or "", set()))
            how = "day_longest" if rec else None
        if p["maqsam_call_id"]:
            how = "maqsam"
        how_counts[how or "none"] = how_counts.get(how or "none", 0) + 1
        dial = by_call.get(p["maqsam_call_id"] or "")
        call_at = (rec or {}).get("started_at") or (dial or {}).get("occurred_at") or (
            f"{p['call_day']}T12:00:00Z" if p["call_day"] else None)
        rows.append({
            "source_ref": f"vince:{f.name}"[:300],
            "source": "vince-archive",
            "recording_id": (rec or {}).get("recording_id"),
            "maqsam_call_id": p["maqsam_call_id"],
            "contact_id": (rec or {}).get("contact_id") or (dial or {}).get("contact_id"),
            "call_type": p["call_type"],
            "rep_name": p["rep_name"],
            "rep_key": rep_key,
            "joined_by": how,
            "lead_name": p["lead_name"],
            "call_at": call_at,
            "reviewed_at": datetime.fromtimestamp(f.stat().st_mtime, timezone.utc).isoformat(),
            "model": "claude-sonnet-4-6 (Vince)",
            "score": p["score"],
            "score_max": p["score_max"],
            "items": p["items"],
            "pros": p["pros"],
            "feedback": p["feedback"],
            "body": p["body"],
        })
    stored = 0 if dry else sb.upsert("cockpit_sales_reviews", rows, "source_ref")
    summary = {
        "files": len(files), "stored": stored, "dry": dry,
        "with_grade": sum(1 for r in rows if r["score"] is not None),
        "joined_to_call": sum(1 for r in rows if r["recording_id"] or r["maqsam_call_id"]),
        "joined_by": how_counts,
        "joined_to_lead": sum(1 for r in rows if r["contact_id"]),
        "rep_known": sum(1 for r in rows if r["rep_key"]),
        "demos": sum(1 for r in rows if r["call_type"] == "demo"),
        "intros": sum(1 for r in rows if r["call_type"] == "intro"),
    }
    log(f"reviews import: {summary}")
    return summary


# ---------------------------------------------------------------------------
# New reviews
# ---------------------------------------------------------------------------

SYSTEM = """You are Vince, an elite sales coach for Mahara Media's sales calls in the GCC market
(construction, design and architecture firms buying lead generation).

You review a sales call transcript and give detailed coaching feedback in this exact format:

{template}

Additional context on the sales framework the rep is meant to follow:
{framework}

RULES:
- Grade each of the {n} parts from 1 to 10 on its own line, as "*<number>. <Part> — <score>/10*".
- Then the total on its own line as "*Grade: <total>/{total}*".
- Be specific: reference timestamps and quote the exact words from the call.
- Give actionable feedback with the exact lines to use instead, in the language of the call.
- The call is usually in Gulf Arabic; you understand it natively.
- Use *bold* with single asterisks and "-" bullets. No other markdown headings apart from the log's own.
- Do not add any sign-off or request for a reaction."""

USER = """Review this sales call and produce the coaching log.

Call: {name}
Rep: {rep}
Date of call: {day}
Call recording link: {link}

TRANSCRIPT:
{transcript}"""


def build_prompt(kind: str, knowledge: Path, *, name: str, rep: str, day: str, link: str,
                 transcript: str) -> tuple[str, str]:
    if kind == "intro":
        template = (knowledge / "intro-coaching-log-template.md").read_text(encoding="utf-8")
        framework = (knowledge / "intro-call-framework.md").read_text(encoding="utf-8")
        n, total = 10, 100
    else:
        template = (knowledge / "coaching-log-template.md").read_text(encoding="utf-8")
        framework = (knowledge / "sales-framework.md").read_text(encoding="utf-8")[:10000]
        n, total = 15, 150
    if len(transcript) > 80_000:
        transcript = transcript[:80_000] + "\n\n[TRANSCRIPT TRUNCATED]"
    system = SYSTEM.format(template=template, framework=framework, n=n, total=total)
    user = USER.format(name=name, rep=rep or "unknown", day=day or "unknown", link=link or "none",
                       transcript=transcript)
    return system, user


def due(sb: Any, *, since: datetime, min_chars: int, limit: int) -> list[dict[str, Any]]:
    """Demo calls since `since` with a transcript long enough and no review yet."""
    rows = sb.select(
        "cockpit_sales_recordings",
        "select=recording_id,title,recorded_by,started_at,share_url,contact_id,appointment_id,transcript_path,"
        f"transcript_chars&started_at=gte.{http.quote(since.isoformat())}&transcript_path=not.is.null"
        f"&transcript_chars=gte.{min_chars}&order=started_at.desc&limit=200",
    )
    if not rows:
        return []
    ids = ",".join('"' + str(r["recording_id"]) + '"' for r in rows)
    done = {str(r["recording_id"]) for r in sb.select(
        "cockpit_sales_reviews", f"select=recording_id&recording_id=in.({http.quote(ids)})")}
    return [r for r in rows if str(r["recording_id"]) not in done][:limit]


def kind_of(rec: dict[str, Any], appointment_type: Optional[str]) -> str:
    """intro or demo: the matched appointment says; else the title does
    ("مكالمة تعريفية" is the intro call); else it is a demo."""
    if appointment_type in ("intro", "demo"):
        return appointment_type
    title = str(rec.get("title") or "").lower()
    return "intro" if ("intro" in title or "تعريفية" in title) else "demo"


def review_new(sb: Any, p: Any, log: Callable[[str], None], *, knowledge: Path, since: datetime,
               limit: int, min_chars: int, timeout: float = 900) -> dict[str, Any]:
    """Review the newest unreviewed calls with Vince's template and framework."""
    todo = due(sb, since=since, min_chars=min_chars, limit=limit)
    if not todo:
        return {"due": 0, "reviewed": 0, "failed": 0}
    reps = sb.select("cockpit_sales_reps", "select=id,display_name,fathom_email,maqsam_email&limit=500")
    rep_of = {str(r.get(k) or "").lower(): r for r in reps for k in ("fathom_email", "maqsam_email") if r.get(k)}
    reviewed = failed = 0
    errors: list[str] = []
    for rec in todo:
        rid = str(rec["recording_id"])
        try:
            appt_type = None
            if rec.get("appointment_id"):
                a = sb.select("cockpit_sales_appointments",
                              f"select=call_type&appointment_id=eq.{http.quote(str(rec['appointment_id']))}&limit=1")
                appt_type = (a[0].get("call_type") if a else None)
            kind = kind_of(rec, appt_type)
            lead = sb.lead(str(rec.get("contact_id") or "")) if rec.get("contact_id") else None
            rep = rep_of.get(str(rec.get("recorded_by") or "").lower())
            transcript = sb.download_from("sales-calls", str(rec["transcript_path"])).decode("utf-8", "replace")
            started = str(rec.get("started_at") or "")
            day = (datetime.fromisoformat(started.replace("Z", "+00:00")) + timedelta(hours=3)).date().isoformat() \
                if started else ""
            system, user = build_prompt(kind, knowledge, name=str(rec.get("title") or rid),
                                        rep=str((rep or {}).get("display_name") or rec.get("recorded_by") or ""),
                                        day=day, link=str(rec.get("share_url") or ""), transcript=transcript)
            want = 10 if kind == "intro" else 15
            out = None
            for attempt in range(2):
                reply = p.complete(system, user if attempt == 0 else user + (
                    f"\n\nYour last answer did not score all {want} parts, one per line as "
                    f"'*<number>. <Part> — <score>/10*', with a '*Grade: <total>/{want * 10}*' line. Write the whole log again."),
                    temperature=None, timeout=timeout)
                parsed = parse(reply.text, f"{kind}_{rid}")
                if parsed["items"] and len(parsed["items"]) >= want - 1 and parsed["score"] is not None:
                    out = parsed
                    break
            if out is None:
                raise ValueError(f"the model did not return a scored log for {rid}")
            sb.upsert("cockpit_sales_reviews", [{
                "source_ref": f"desk:{rid}",
                "source": "desk",
                "recording_id": rid,
                "contact_id": rec.get("contact_id"),
                "call_type": kind,
                "rep_name": (rep or {}).get("display_name") or rec.get("recorded_by"),
                "rep_key": str((rep or {}).get("id") or "") or None,
                "lead_name": (lead or {}).get("name"),
                "call_at": rec.get("started_at"),
                "reviewed_at": datetime.now(timezone.utc).isoformat(),
                "model": getattr(p, "model", None),
                "score": out["score"],
                "score_max": out["score_max"],
                "items": out["items"],
                "pros": out["pros"],
                "feedback": out["feedback"],
                "body": out["body"],
                "joined_by": "link",
            }], "source_ref")
            reviewed += 1
            log(f"reviews: {kind} {rid} scored {out['score']:.0f}/{out['score_max']:.0f}")
        except Exception as e:  # noqa: BLE001 - one call is not worth the rest
            failed += 1
            errors.append(f"{rid}: {http.scrub(str(e))[:160]}")
            log(f"reviews: {rid} failed: {http.scrub(str(e))[:200]}")
    return {"due": len(todo), "reviewed": reviewed, "failed": failed, "errors": errors[:5]}

