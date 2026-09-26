"""Notes after every call, and the digest of what prospects keep saying.

Aziz's brief (2026-09-24): the old "Sales AI Notes" bot took notes from the
intro call for the closer, from the demo call, and "marked them if they're
good"; and the cockpit should show "the most frequent questions, objections,
problems, and expectations ... for the last week or last 30 days", which
"can also help us with the marketing side".

- `run_notes` reads each recorded sales call's transcript once and writes
  structured notes (cockpit_sales_call_notes): what was said, the
  objections and how they were handled, what the closer should know, and a
  verdict on the lead with its reason. Only what was said: nothing invented.
- `run_digest` reads the notes of the last 7 or 30 days (not the
  transcripts again) and writes the digest (cockpit_sales_digests). A window
  with no calls writes an empty digest, so the page says so instead of
  showing last month's.

The model is the desk's own on the VPS key; lead data never goes to DeepSeek.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Optional

from . import http
from . import model as model_mod

KUWAIT = timedelta(hours=3)

NOTES_SYSTEM = """You take notes on one sales call for Mahara Media, a Gulf growth agency that wins its clients (mostly B2B companies: contracting, construction, design, real estate, services) qualified projects and meetings through ads and a sales system. A setter runs a 15-minute intro call; a closer runs a 45-minute demo.

Write the notes the next person needs, the way Mahara's closer briefs are written. Rules:
- Only what was said on this call. Never invent a number, a name, a date or a promise. Leave a field empty ("" or []) when it did not come up; "unknown" is an answer, not a weakness.
- Short lines. Quote the lead's own words, in the language they used, when they matter (the real problem above all).
- Write in English; keep Arabic quotes as they were said.
- A badly run call is not a cold lead: judge the lead, not the rep.

Aziz's setter gate, five boxes, each "yes", "no" or "unknown" from the call:
1. industry_fit: a business Mahara serves;
2. revenue_500k: $500k or more a year;
3. decision_maker: the decision-maker was on the call (or will be on the next one);
4. pain_in_words: they named the pain in their own words;
5. budget_5k: they acknowledged a budget of about $5,000 over 90 days.
verdict: "qualified" when all five are yes; "not_qualified" when two or more are a clear no, with the lead's words to show it; otherwise "unclear". verdict_why is one sentence.

assessment: readiness and authority from 0 to 10 (null when the call does not show), and one short line each for budget, need and trust.
for_closer: for an intro, what the closer must know before the demo: their situation, the real problem, what they want, who decides, what will convince them, what to avoid. For a demo, what whoever follows up must know.

Answer with one JSON object and nothing else:
{"summary": "", "real_problem": "", "pains": [], "goals": [], "current_state": "", "budget": "", "timeline": "", "decision_maker": "",
 "questions": [], "objections": [{"objection": "", "handled": true, "how": ""}], "expectations": [], "trusts": [],
 "buying_signals": [], "caution": "", "convince_with": "", "next_steps": [], "for_closer": "",
 "gate": {"industry_fit": "unknown", "revenue_500k": "unknown", "decision_maker": "unknown", "pain_in_words": "unknown", "budget_5k": "unknown"},
 "assessment": {"readiness": null, "authority": null, "budget": "", "need": "", "trust": ""},
 "verdict": "unclear", "verdict_why": ""}"""

NOTES_USER = """The call: {title}
Kind: {kind}
Rep: {rep}
Date: {day}

Transcript:
{transcript}"""

DIGEST_SYSTEM = """You read the notes of Mahara Media's recent sales calls (intro calls and demos with Gulf B2B companies) and say what prospects keep bringing up, for the sales team and for marketing.

Group what means the same thing, count how many calls raised it, most frequent first, and keep the prospect's own wording in the example when there is one. Only what the notes say; never invent. Up to 8 items per list.

- questions: what prospects ask.
- objections: what holds them back; "answer" is the best handling seen in the notes (empty when none worked).
- problems: the pains that bring them.
- expectations: what they expect from Mahara (results, speed, price, process).
- marketing: up to 6 content ideas (a video, a post, a page) that would answer the most common questions and objections before the call, each with why.

Answer with one JSON object and nothing else:
{"questions": [{"text": "", "count": 0, "example": ""}], "objections": [{"text": "", "count": 0, "answer": ""}],
 "problems": [{"text": "", "count": 0}], "expectations": [{"text": "", "count": 0}], "marketing": [{"idea": "", "why": ""}]}"""

VERDICTS = ("qualified", "not_qualified", "unclear")
# Aziz's setter gate (context/memory/2026-05-18.md in mahara-context).
GATE = ("industry_fit", "revenue_500k", "decision_maker", "pain_in_words", "budget_5k")


def _list(v: Any) -> list:
    return [x for x in v if x not in (None, "", {})] if isinstance(v, list) else []


def clean_notes(d: dict[str, Any]) -> dict[str, Any]:
    """The model's notes in the shape the cockpit reads, whatever it sent."""
    text = lambda k: str(d.get(k) or "").strip()[:2000]  # noqa: E731
    objections = []
    for o in _list(d.get("objections")):
        if isinstance(o, dict) and str(o.get("objection") or "").strip():
            objections.append({"objection": str(o["objection"]).strip()[:400],
                               "handled": bool(o.get("handled")),
                               "how": str(o.get("how") or "").strip()[:600]})
        elif isinstance(o, str) and o.strip():
            objections.append({"objection": o.strip()[:400], "handled": False, "how": ""})
    lines = lambda k: [str(x).strip()[:400] for x in _list(d.get(k)) if str(x).strip()][:12]  # noqa: E731
    verdict = text("verdict").lower().replace(" ", "_").replace("-", "_")
    gate_in = d.get("gate") if isinstance(d.get("gate"), dict) else {}
    gate = {k: (str(gate_in.get(k) or "unknown").strip().lower() if str(gate_in.get(k) or "").strip().lower() in ("yes", "no")
                else "unknown") for k in GATE}
    a_in = d.get("assessment") if isinstance(d.get("assessment"), dict) else {}

    def score(v: Any) -> Optional[int]:
        try:
            n = int(round(float(v)))
        except (TypeError, ValueError):
            return None
        return n if 0 <= n <= 10 else None

    return {
        "real_problem": text("real_problem"),
        "trusts": lines("trusts"),
        "buying_signals": lines("buying_signals"),
        "caution": text("caution"),
        "convince_with": text("convince_with"),
        "gate": gate,
        "assessment": {"readiness": score(a_in.get("readiness")), "authority": score(a_in.get("authority")),
                       "budget": str(a_in.get("budget") or "").strip()[:300],
                       "need": str(a_in.get("need") or "").strip()[:300],
                       "trust": str(a_in.get("trust") or "").strip()[:300]},
        "summary": text("summary"),
        "pains": lines("pains"),
        "goals": lines("goals"),
        "current_state": text("current_state"),
        "budget": text("budget"),
        "timeline": text("timeline"),
        "decision_maker": text("decision_maker"),
        "questions": lines("questions"),
        "objections": objections[:12],
        "expectations": lines("expectations"),
        "next_steps": lines("next_steps"),
        "for_closer": text("for_closer"),
        "verdict": verdict if verdict in VERDICTS else "unclear",
        "verdict_why": text("verdict_why"),
    }


def kind_of(rec: dict[str, Any], appointment_type: Optional[str]) -> str:
    if rec.get("source") == "maqsam":
        return "phone"
    if appointment_type in ("intro", "demo"):
        return appointment_type
    title = str(rec.get("title") or "").lower()
    return "intro" if ("intro" in title or "تعريفية" in title) else "demo"


def due(sb: Any, *, since: datetime, min_chars: int, limit: int) -> list[dict[str, Any]]:
    """Recorded sales calls since `since` with a transcript and no notes yet, newest first."""
    rows = sb.select(
        "cockpit_sales_recordings",
        "select=recording_id,title,recorded_by,started_at,contact_id,appointment_id,transcript_path,"
        f"transcript_chars,source&started_at=gte.{http.quote(since.isoformat())}&transcript_path=not.is.null"
        f"&transcript_chars=gte.{min_chars}&order=started_at.desc&limit=300",
    )
    if not rows:
        return []
    ids = ",".join('"' + str(r["recording_id"]) + '"' for r in rows)
    done = {str(r["recording_id"]) for r in sb.select(
        "cockpit_sales_call_notes", f"select=recording_id&recording_id=in.({http.quote(ids)})")}
    return [r for r in rows if str(r["recording_id"]) not in done][:limit]


def run_notes(sb: Any, p: Any, log: Callable[[str], None], *, since: datetime, limit: int, min_chars: int,
              attempts: int = 2, timeout: float = 600) -> dict[str, Any]:
    todo = due(sb, since=since, min_chars=min_chars, limit=limit)
    if not todo:
        return {"due": 0, "written": 0, "failed": 0, "errors": []}
    reps = sb.select("cockpit_sales_reps", "select=id,display_name,fathom_email,maqsam_email&limit=500")
    rep_of = {str(r.get(k) or "").lower(): r for r in reps for k in ("fathom_email", "maqsam_email") if r.get(k)}
    written = failed = 0
    errors: list[str] = []
    for rec in todo:
        rid = str(rec["recording_id"])
        try:
            appt_type = None
            if rec.get("appointment_id"):
                a = sb.select("cockpit_sales_appointments",
                              f"select=call_type&appointment_id=eq.{http.quote(str(rec['appointment_id']))}&limit=1")
                appt_type = a[0].get("call_type") if a else None
            kind = kind_of(rec, appt_type)
            rep = rep_of.get(str(rec.get("recorded_by") or "").lower())
            transcript = sb.download_from("sales-calls", str(rec["transcript_path"])).decode("utf-8", "replace")
            if len(transcript) > 90_000:
                transcript = transcript[:90_000] + "\n\n[TRANSCRIPT TRUNCATED]"
            started = str(rec.get("started_at") or "")
            day = (datetime.fromisoformat(started.replace("Z", "+00:00")) + KUWAIT).date().isoformat() if started else ""
            value, reply = model_mod.call_json(
                p, NOTES_SYSTEM,
                NOTES_USER.format(title=rec.get("title") or rid, kind=kind,
                                  rep=(rep or {}).get("display_name") or rec.get("recorded_by") or "unknown",
                                  day=day or "unknown", transcript=transcript),
                temperature=None, attempts=attempts, timeout=timeout,
                expect=lambda d: isinstance(d, dict) and ("summary" in d or "verdict" in d),
                log=log, what=f"notes {rid}")
            notes = clean_notes(value)
            sb.upsert("cockpit_sales_call_notes", [{
                "recording_id": rid,
                "contact_id": rec.get("contact_id"),
                "call_type": kind,
                "call_at": rec.get("started_at"),
                "rep": (rep or {}).get("display_name") or rec.get("recorded_by"),
                "notes": notes,
                "verdict": notes["verdict"],
                "verdict_why": notes["verdict_why"] or None,
                "model": getattr(p, "model", None),
                "written_at": datetime.now(timezone.utc).isoformat(),
            }], "recording_id")
            written += 1
            log(f"notes: {kind} {rid}: {notes['verdict']}")
        except Exception as e:  # noqa: BLE001 - one call is not worth the rest
            failed += 1
            errors.append(f"{rid}: {http.scrub(str(e))[:160]}")
            log(f"notes: {rid} failed: {http.scrub(str(e))[:200]}")
    return {"due": len(todo), "written": written, "failed": failed, "errors": errors[:5]}


def notes_lines(rows: list[dict[str, Any]]) -> str:
    """The notes of many calls, compacted to what a digest needs."""
    out = []
    for i, r in enumerate(rows, 1):
        n = r.get("notes") or {}
        parts = [f"Call {i} ({r.get('call_type') or 'call'}, {str(r.get('call_at') or '')[:10]}, verdict {r.get('verdict') or 'unclear'})"]
        for label, key in (("Asked", "questions"), ("Pains", "pains"), ("Expects", "expectations")):
            if n.get(key):
                parts.append(f"{label}: " + " | ".join(str(x) for x in n[key][:8]))
        if n.get("objections"):
            parts.append("Objections: " + " | ".join(
                f"{o.get('objection')} ({'handled: ' + o['how'] if o.get('handled') and o.get('how') else 'not handled'})"
                for o in n["objections"][:8] if isinstance(o, dict)))
        out.append("\n".join(parts))
    return "\n\n".join(out)


def clean_digest(d: dict[str, Any]) -> dict[str, Any]:
    def items(key: str, fields: tuple[str, ...]) -> list[dict[str, Any]]:
        out = []
        for x in _list(d.get(key))[:8]:
            if not isinstance(x, dict):
                continue
            row = {f: (int(x.get(f) or 0) if f == "count" else str(x.get(f) or "").strip()[:500]) for f in fields}
            if row.get(fields[0]):
                out.append(row)
        return out
    return {
        "questions": items("questions", ("text", "count", "example")),
        "objections": items("objections", ("text", "count", "answer")),
        "problems": items("problems", ("text", "count")),
        "expectations": items("expectations", ("text", "count")),
        "marketing": items("marketing", ("idea", "why"))[:6],
    }


def run_digest(sb: Any, p: Any, log: Callable[[str], None], *, days: int, now: Optional[datetime] = None,
               attempts: int = 2, timeout: float = 600) -> dict[str, Any]:
    now = now or datetime.now(timezone.utc)
    start = now - timedelta(days=days)
    rows = sb.select("cockpit_sales_call_notes",
                     f"select=recording_id,call_type,call_at,verdict,notes&call_at=gte.{http.quote(start.isoformat())}"
                     "&order=call_at.desc&limit=400")
    empty = {"questions": [], "objections": [], "problems": [], "expectations": [], "marketing": []}
    digest, model = empty, None
    if rows:
        value, _reply = model_mod.call_json(
            p, DIGEST_SYSTEM, f"The notes of {len(rows)} calls from the last {days} days:\n\n{notes_lines(rows)}",
            temperature=None, attempts=attempts, timeout=timeout,
            expect=lambda d: isinstance(d, dict) and any(k in d for k in empty), log=log, what=f"digest {days}d")
        digest, model = clean_digest(value), getattr(p, "model", None)
    sb.upsert("cockpit_sales_digests", [{
        "days": days,
        "from_at": start.isoformat(),
        "to_at": now.isoformat(),
        "calls_used": len(rows),
        "digest": digest,
        "model": model,
        "written_at": now.isoformat(),
    }], "id")
    log(f"digest: {days} days from {len(rows)} calls")
    return {"days": days, "calls": len(rows)}
