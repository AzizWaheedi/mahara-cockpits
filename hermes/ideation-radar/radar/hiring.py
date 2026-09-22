"""The recruiting agent: it reads an application and says what it is worth.

Aziz, 2026-09-22: "You don't need the API key. Just tell me what you want the
VPS to do. It can make the agent." So it runs here, beside the ideation radar,
on the language model keys this box already holds.

It never decides anything. It proposes a score out of ten with its reasons and
the questions that would settle the person, and Aziz's own score is the one
that counts. The gap between the two is what makes it better: `calibrate`
keeps every disagreement of two points or more and every later screening
carries those examples, so it drifts towards his taste rather than a generic
idea of a good applicant.

Everything it needs is in Supabase and nothing is in GoHighLevel:

    cockpit_hiring_candidates     who is on the board, and Aziz's own scores
    cockpit_hiring_applications   what the candidate actually wrote
    cockpit_hiring_meta 'roles'   the scorecard, published by the cockpit
    cockpit_hiring_meta 'agent-calibration'   what it has learned so far
    cockpit_hiring_events         the trail, one row per screening

It writes its verdict onto the candidate row (agent_score, agent_verdict,
agent_note, agent_asks) where the cockpit already reads, so the Recruiting tab
shows the proposal beside the box Aziz types his own score into.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any, Callable, Optional

from . import http
from .config import Config
from .posting.write import model_json
from .supabase import Supabase

# A disagreement smaller than this is noise, not a lesson.
LESSON_GAP = 2.0
# How many lessons ride in one prompt.
LESSONS_IN_PROMPT = 12
# How many lessons are kept at all.
LESSONS_KEPT = 60
CALIBRATION_KEY = "agent-calibration"

SCHEMA = {
    "type": "object",
    "properties": {
        "score": {"type": "number"},
        "headline": {"type": "string"},
        "strengths": {"type": "array", "items": {"type": "string"}},
        "concerns": {"type": "array", "items": {"type": "string"}},
        "recommendation": {"type": "string", "enum": ["advance", "look closer", "drop"]},
        "askThem": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["score", "headline", "strengths", "concerns", "recommendation", "askThem"],
}


def _use_cheap_model_first() -> str:
    """Screening is grind work, so it goes to the cheap model first.

    `model_json` reads POSTING_TEXT_PROVIDER and defaults to gemini, openai,
    deepseek, which means deepseek is never reached. Aziz's routing rule is the
    other way round for work like this: extraction and scoring on deepseek,
    judgement and Arabic client copy on a frontier model. Set the order for
    this job only, and leave the posting desk's own order alone.
    """
    order = os.environ.get("HIRING_TEXT_PROVIDER", "deepseek,gemini,openai")
    os.environ["POSTING_TEXT_PROVIDER"] = order
    return order


def store(cfg: Config) -> Supabase:
    """The cockpit's own database, not the radar's table."""
    return Supabase(cfg.supabase_url, cfg.supabase_key, table="cockpit_hiring_candidates")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _meta(sb: Supabase, key: str) -> dict[str, Any]:
    rows = sb.select("cockpit_hiring_meta", f"key=eq.{key}&select=value&limit=1")
    value = rows[0].get("value") if rows else None
    return value if isinstance(value, dict) else {}


def _put_meta(sb: Supabase, key: str, value: dict[str, Any]) -> None:
    sb.upsert(
        "cockpit_hiring_meta",
        [{"key": key, "value": value, "updated_at": _now()}],
        on_conflict="key",
    )


def roles(sb: Supabase) -> dict[str, dict[str, Any]]:
    """The roles as the cockpit's spec.ts describes them. One source, no copy here."""
    held = _meta(sb, "roles").get("roles") or []
    return {str(r.get("key")): r for r in held if r.get("key")}


def lessons(sb: Supabase) -> list[dict[str, Any]]:
    return list(_meta(sb, CALIBRATION_KEY).get("lessons") or [])


def prompt_for(role: dict[str, Any], row: dict[str, Any], application: str, learned: list[dict[str, Any]]) -> str:
    mine = [l for l in learned if l.get("role") == role.get("key")][:LESSONS_IN_PROMPT]
    calibration = ""
    if mine:
        lines = "\n".join(
            f"- You said {l.get('agentScore')}, he said {l.get('azizScore')}."
            f" Your reason: {str(l.get('agentReason', ''))[:220]}."
            f" His note: {str(l.get('azizNote') or '(none)')[:220]}"
            for l in mine
        )
        calibration = f"\n\nHow Aziz has graded against you before. Move towards him.\n{lines}"

    years = row.get("years_experience")
    years_text = f"{years}" if years is not None else "an unstated number of"
    arabic = str(row.get("arabic") or "").strip()
    arabic_text = f", and says their Arabic is {arabic}" if arabic else ""
    scorecard = "; ".join(role.get("scorecard") or []) or "not stated"

    return f"""You are screening a job application for Mahara Media, a Kuwait based B2B marketing agency. Mahara runs paid ads on Meta, Snapchat and TikTok for construction and design firms across the GCC, books their leads through an Arabic speaking call centre, and manages the accounts with client success managers.

The role is {role.get('label')}.
What the person will do: {role.get('dailyResponsibilities')}
What the role pays: {role.get('compensation')}
What they will be judged on once hired: {scorecard}
Where this role is usually hired from: {role.get('postOn')}
How long until they are useful: {role.get('rampTime')}

The applicant reports {years_text} years of experience{arabic_text}. Where they live is in the application below; do not assume it from anything else.

Here is their application, as they wrote it:

{application or '(The application text could not be read. Score on what little is above and say so in your concerns.)'}

Score them out of ten on how likely they are to hold the scorecard above, not on how polished the writing is. A specific number about their own past work is worth more than any adjective. Somebody who has done this exact job in this exact market scores high; somebody with the right ambition and no evidence scores in the middle; somebody who answered in generalities scores low.

Be hard. A seven should be uncommon. Say the concerns plainly, including the ones that are only a hunch, and mark a hunch as a hunch.

askThem is the most useful thing you produce: the two or three questions that would settle whether this person is real, written so they can be read out on a call.

No em-dashes anywhere in your answer.{calibration}"""


def _list(x: Any) -> list[str]:
    """A field asked for as a list, however the model answered it.

    A model that sends one string back instead of an array was being iterated
    character by character, which put "T; h; e" into a candidate's record
    (2026-09-22).
    """
    if x is None:
        return []
    if isinstance(x, str):
        t = x.strip()
        return [t] if t else []
    if isinstance(x, (list, tuple)):
        return [str(i).strip() for i in x if str(i).strip()]
    return [str(x)]


def _clamp(x: Any) -> float:
    try:
        return max(0.0, min(10.0, round(float(x), 1)))
    except (TypeError, ValueError):
        return 0.0


def screen_one(
    cfg: Config,
    sb: Supabase,
    row: dict[str, Any],
    role: dict[str, Any],
    application: str,
    learned: list[dict[str, Any]],
    log: Callable[[str], None] = lambda m: None,
) -> dict[str, Any]:
    out, model = model_json(cfg, prompt_for(role, row, application, learned), SCHEMA, log)
    score = _clamp(out.get("score"))
    verdict = str(out.get("recommendation") or "look closer")
    strengths = _list(out.get("strengths"))
    concerns = _list(out.get("concerns"))
    asks = _list(out.get("askThem"))
    note = " ".join(
        p
        for p in [
            str(out.get("headline") or "").strip(),
            f"For: {'; '.join(strengths)}" if strengths else "",
            f"Against: {'; '.join(concerns)}" if concerns else "",
        ]
        if p
    )

    sb.patch(
        "cockpit_hiring_candidates",
        f"id=eq.{row['id']}",
        {
            "agent_score": score,
            "agent_verdict": verdict,
            "agent_note": note[:4000],
            "agent_asks": "\n".join(asks)[:2000],
            "agent_at": _now(),
        },
    )
    sb.insert(
        "cockpit_hiring_events",
        {
            "candidate_id": row["id"],
            "role": row.get("role") or role.get("key"),
            "kind": "action",
            "action": "agent_screen",
            "to_stage": row.get("stage"),
            "detail": f"Agent score {score}/10, {verdict}. {note}"[:4000],
            "ok": True,
            "by_whom": f"the recruiting agent ({model})",
        },
    )
    return {"name": row.get("name"), "score": score, "verdict": verdict, "model": model}


def screen(cfg: Config, limit: int = 10, *, role_key: str = "", dry_run: bool = False, log: Callable[[str], None] = print) -> dict[str, Any]:
    """Score the applications nobody has looked at yet, newest first."""
    _use_cheap_model_first()
    sb = store(cfg)
    spec = roles(sb)
    if not spec:
        return {"ok": False, "error": "The cockpit has not published the roles yet. Run ceo hiring/sync:refreshIds."}
    learned = lessons(sb)

    where = "agent_score=is.null&stage=eq.application"
    if role_key:
        where += f"&role=eq.{role_key}"
    rows = sb.select(
        "cockpit_hiring_candidates",
        f"{where}&select=id,contact_id,role,name,country,years_experience,arabic,stage"
        f"&order=applied_at.desc&limit={max(1, min(200, limit * 4))}",
    )
    if not rows:
        return {"ok": True, "screened": 0, "waiting": 0, "out": []}

    ids = ",".join(f'"{r["contact_id"]}"' for r in rows)
    apps = {
        str(a["contact_id"]): str(a.get("text") or "")
        for a in sb.select("cockpit_hiring_applications", f"contact_id=in.({ids})&select=contact_id,text")
    }

    done: list[dict[str, Any]] = []
    problems: list[str] = []
    for row in rows:
        if len(done) >= limit:
            break
        role = spec.get(str(row.get("role")))
        if not role:
            continue
        application = apps.get(str(row.get("contact_id")), "")
        if dry_run:
            done.append({"name": row.get("name"), "role": row.get("role"), "chars": len(application)})
            continue
        try:
            done.append(screen_one(cfg, sb, row, role, application, learned, log))
            log(f"  {done[-1]['name']}: {done[-1]['score']}/10 {done[-1]['verdict']}")
        except (http.HttpError, ValueError, KeyError) as e:
            problems.append(f"{row.get('name')}: {http.scrub(str(e))[:140]}")
    return {
        "ok": True,
        "screened": len(done),
        "waiting": max(0, len(rows) - len(done)),
        "out": done,
        "problems": problems[:5],
        "dryRun": dry_run,
    }


def calibrate(cfg: Config, log: Callable[[str], None] = print) -> dict[str, Any]:
    """Pair every proposal with the score Aziz gave after it, and keep the disagreements."""
    sb = store(cfg)
    proposals = sb.select(
        "cockpit_hiring_events",
        "action=eq.agent_screen&select=candidate_id,role,detail,at&order=at.desc&limit=500",
    )
    human = sb.select(
        "cockpit_hiring_events",
        "kind=eq.score&select=candidate_id,detail,at,by_whom&order=at.desc&limit=500",
    )
    newest: dict[str, dict[str, Any]] = {}
    for h in human:
        newest.setdefault(str(h["candidate_id"]), h)

    import re

    def number(text: str, pattern: str) -> Optional[float]:
        m = re.search(pattern, text or "")
        return float(m.group(1)) if m else None

    learned: list[dict[str, Any]] = []
    for p in proposals:
        h = newest.get(str(p["candidate_id"]))
        if not h:
            continue
        mine = number(str(p.get("detail")), r"Agent score (\d+(?:\.\d+)?)/10")
        his = number(str(h.get("detail")), r"(\d+(?:\.\d+)?)/10")
        if mine is None or his is None or abs(mine - his) < LESSON_GAP:
            continue
        learned.append(
            {
                "role": p.get("role"),
                "agentScore": mine,
                "azizScore": his,
                "azizNote": str(h.get("detail") or "").split(": ", 1)[-1][:400],
                "agentReason": str(p.get("detail") or "").split(".", 1)[-1].strip()[:400],
                "at": str(p.get("at")),
            }
        )
    learned.sort(key=lambda l: str(l.get("at")), reverse=True)
    kept = learned[:LESSONS_KEPT]
    _put_meta(sb, CALIBRATION_KEY, {"lessons": kept, "at": _now()})
    bias = round(sum(l["azizScore"] - l["agentScore"] for l in kept) / len(kept), 1) if kept else 0.0
    log(f"calibration: {len(kept)} lessons kept, Aziz minus agent {bias:+}")
    return {"ok": True, "pairs": len(learned), "kept": len(kept), "azizMinusAgent": bias}


def headhunt(cfg: Config, role_key: str, note: str = "", log: Callable[[str], None] = print) -> dict[str, Any]:
    """Where to look for this role, and the message to send when you find someone."""
    sb = store(cfg)
    _use_cheap_model_first()
    role = roles(sb).get(role_key)
    if not role:
        return {"ok": False, "error": f"No role called {role_key}. Roles: {', '.join(roles(sb))}"}
    schema = {
        "type": "object",
        "properties": {
            "searches": {"type": "array", "items": {"type": "string"}},
            "signals": {"type": "array", "items": {"type": "string"}},
            "disqualifiers": {"type": "array", "items": {"type": "string"}},
            "opener": {"type": "string"},
            "followUp": {"type": "string"},
        },
        "required": ["searches", "signals", "disqualifiers", "opener", "followUp"],
    }
    prompt = f"""You are helping Aziz, who runs Mahara Media, a Kuwait based B2B marketing agency selling to GCC construction and design firms, headhunt a {role.get('label')}.

What the person will do: {role.get('dailyResponsibilities')}
What it pays: {role.get('compensation')}
What they will be judged on: {'; '.join(role.get('scorecard') or [])}
Where this role is usually hired from: {role.get('postOn')}
{f'What Aziz added: {note}' if note else ''}

Give him:
- searches: five concrete searches he can run today, each naming the platform and the exact query or filter, not general advice. Prefer places where people show their work rather than their CV.
- signals: what to look for on a profile that means this person is actually good at this job, specific to this role and this market.
- disqualifiers: what to skip on sight.
- opener: one outreach message, under 90 words, in Aziz's voice. Plain, direct, no flattery, no em-dashes, says who he is and what the job is and asks one easy question. Written to be sent cold on LinkedIn or WhatsApp.
- followUp: one message to send four days later if they do not reply, under 40 words.

No em-dashes anywhere."""
    out, model = model_json(cfg, prompt, schema, log)
    _put_meta(sb, f"headhunt:{role_key}", {"at": _now(), "model": model, "note": note, **out})
    return {"ok": True, "role": role.get("label"), "model": model, **out}


def doctor(cfg: Config) -> dict[str, Any]:
    """Can this box do the job at all, and how much is waiting."""
    out: dict[str, Any] = {"supabase": bool(cfg.supabase_url and cfg.supabase_key)}
    providers = [p.strip() for p in _use_cheap_model_first().split(",") if p.strip()]
    out["providers"] = {
        "order": providers,
        "gemini": bool(cfg.gemini_key),
        "openai": bool(cfg.openai_key),
        "deepseek": bool(cfg.deepseek_key),
    }
    if not out["supabase"]:
        out["error"] = "RADAR_SUPABASE_URL and RADAR_SUPABASE_KEY are needed."
        return out
    sb = store(cfg)
    try:
        spec = roles(sb)
        out["roles"] = sorted(spec)
        waiting = sb.select(
            "cockpit_hiring_candidates",
            "agent_score=is.null&stage=eq.application&select=id&limit=1000",
        )
        screened = sb.select(
            "cockpit_hiring_candidates", "agent_score=not.is.null&select=id&limit=1000"
        )
        apps = sb.select("cockpit_hiring_applications", "select=contact_id&limit=1000")
        out["waiting"] = len(waiting)
        out["screened"] = len(screened)
        out["applications"] = len(apps)
        out["lessons"] = len(lessons(sb))
    except Exception as e:  # noqa: BLE001 - the doctor reports, it never raises
        out["error"] = http.scrub(str(e))[:200]
    return out


def main(args: Any, cfg: Config, log: Callable[[str], None] = print) -> int:
    """`radar.py hiring`, from the cron and by hand."""
    if getattr(args, "doctor", False):
        log(json.dumps(doctor(cfg), indent=1, ensure_ascii=False))
        return 0
    if getattr(args, "headhunt", ""):
        out = headhunt(cfg, args.headhunt, getattr(args, "note", "") or "", log)
        log(json.dumps(out, indent=1, ensure_ascii=False))
        return 0 if out.get("ok") else 1
    if getattr(args, "calibrate_only", False):
        log(json.dumps(calibrate(cfg, log), indent=1, ensure_ascii=False))
        return 0
    out = screen(cfg, limit=getattr(args, "limit", 10), role_key=getattr(args, "role", "") or "", dry_run=getattr(args, "dry_run", False), log=log)
    if out.get("ok") and out.get("screened") and not out.get("dryRun"):
        out["calibration"] = calibrate(cfg, log)
    log(json.dumps(out, indent=1, ensure_ascii=False))
    return 0 if out.get("ok") else 1
