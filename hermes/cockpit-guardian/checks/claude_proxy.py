"""The Claude sign-in and the proxy on the VPS (catalogue H1, H2, H3).

The trap: the proxy's /health says ok while Claude is signed out. Only the
workers' own status rows and Salma's ~/.salma-vps.json show the sign-in, so
those are what the sign-in check reads.
"""
from __future__ import annotations

import re
from typing import Any

from guard import http
from guard.context import Context, SourceError
from guard.model import Check, Result, fail, ok, parse_time, unknown, warn

SIGNED_OUT = re.compile(r"(?i)sign[- ]?in[^.]{0,60}(lapsed|expired)|signed out|run claude, then /login|/login\b")
AI_ROWS = ("followups", "notes", "reviews", "digest", "doctor")


def signed_out_text(text: Any) -> bool:
    return bool(SIGNED_OUT.search(str(text or "")))


def run_signin(ctx: Context) -> Result:
    seen: list[str] = []
    signed_out: list[str] = []
    desk_jobs: list[str] = []
    earliest = None
    errors: list[str] = []
    try:
        rows = ctx.rows("cockpit_sales_worker_status", "worker,job,ok,detail,at", where=[("worker", "eq", "sales-desk")])
        for r in rows:
            if r.get("job") not in AI_ROWS:
                continue
            seen.append(f"desk {r['job']}")
            if r.get("ok") is False and signed_out_text(r.get("detail")):
                desk_jobs.append(r["job"])
                t = parse_time(r.get("at"))
                if r.get("job") == "doctor" and t and (earliest is None or t < earliest):
                    earliest = t
    except SourceError as e:
        errors.append(str(e))
    try:
        rows = ctx.rows("social_worker_status", "check_name,ok,detail,checked_at", where=[("check_name", "eq", "captions")])
        for r in rows:
            seen.append("salma captions")
            if r.get("ok") is False and signed_out_text(r.get("detail")):
                signed_out.append("Salma's captions")
    except SourceError as e:
        errors.append(str(e))
    salma_state = None
    try:
        sv = ctx.snap_part("salma_vps")
        if isinstance(sv, dict) and sv.get("state"):
            salma_state = str(sv["state"])
            seen.append("salma-vps.json")
            if "signed out" in salma_state.lower():
                signed_out.append("~/.salma-vps.json")
    except SourceError as e:
        errors.append(str(e))
    if not seen:
        return unknown("Neither the workers' status rows nor ~/.salma-vps.json could be read: " + "; ".join(errors)[:200])
    if desk_jobs:
        order = [j for j in AI_ROWS if j in desk_jobs]
        signed_out.insert(0, "the sales desk's " + (", ".join(order[:-1]) + " and " + order[-1] if len(order) > 1 else order[0]))
    if signed_out:
        what = ", ".join(dict.fromkeys(signed_out))
        return fail(f"The Claude sign-in on the VPS has lapsed: {what} say so, while the proxy's own health check still "
                    "answers ok.", since=earliest, evidence={"signed_out": signed_out, "salma_vps": salma_state})
    return ok("The workers that draft with Claude report no sign-in problem.", evidence={"read": seen})


def run_proxy(ctx: Context) -> Result:
    p = ctx.snap_part("proxy")
    if not isinstance(p, dict):
        raise SourceError("the proxy reading is missing")
    if p.get("http") == 200 and str(p.get("status")).lower() == "ok":
        return ok("The Claude proxy on 127.0.0.1:3456 answers its health check (this does not prove the sign-in).",
                  evidence=p)
    if p.get("http"):
        return fail(f"The Claude proxy answers {p.get('http')} with status {p.get('status')!r} instead of ok.", evidence=p)
    return fail("The Claude proxy on 127.0.0.1:3456 does not answer at all.", evidence=p)


def run_exposed(ctx: Context) -> Result:
    listen = ctx.snap_part("listen")
    if not isinstance(listen, list):
        raise SourceError("the listening ports could not be read")
    open_any = [a for a in listen if a in ("0.0.0.0:3456", ":::3456", "[::]:3456")]
    outside = None
    if ctx.cfg.remote and ctx.host is not None:
        # Off the box, an outside GET is a real outside test (from the VPS itself it would loop back).
        try:
            r = ctx.get(f"http://{ctx.host.public_ip}:3456/health", timeout=6)
            outside = r.status
        except (http.HttpError, SourceError):
            outside = 0
    ev = {"listening": open_any or [a for a in listen if a.endswith(":3456")], "outside_get": outside}
    if open_any or outside == 200:
        how = " and answered an outside request with 200" if outside == 200 else ""
        return fail(f"The Claude proxy listens on every address (port 3456){how}, so anyone on the internet can use "
                    "it without a key.", evidence=ev)
    if not ev["listening"]:
        return warn("Nothing listens on port 3456, so the proxy is down or moved.", evidence=ev)
    return ok("The Claude proxy listens on the loopback address only.", evidence=ev)


CHECKS = [
    Check(
        id="claude-signin", area="vps", name="Claude sign-in on the VPS", catalogue="H1",
        means="Claude Code on the VPS is signed in, so follow-up drafts, call notes, reviews, the digest and Salma's captions can be written.",
        severity="high",
        reads="cockpit_sales_worker_status (followups, notes, reviews, digest, doctor), social_worker_status.captions, ~/.salma-vps.json",
        threshold="Any of them says the sign-in lapsed or signed out: fail.",
        run=run_signin,
        action="SSH in as aziz, run claude, then /login.",
    ),
    Check(
        id="claude-proxy-up", area="vps", name="Claude proxy on the VPS", catalogue="H2",
        means="The OpenAI-shaped proxy in front of Claude Code answers on 127.0.0.1:3456.",
        severity="high", reads="GET 127.0.0.1:3456/health from the VPS",
        threshold="No answer, or a status other than ok: fail.", run=run_proxy, confirm=2,
        action="Start openclaw-claude-proxy again as aziz (hermes cannot restart it).",
    ),
    Check(
        id="claude-proxy-exposed", area="vps", name="Claude proxy open to the internet", catalogue="H3",
        means="The Claude proxy accepts connections only from the VPS itself.",
        severity="high", reads="The VPS's listening sockets (/proc/net/tcp); from off the box also an outside GET",
        threshold="Listening on 0.0.0.0 or [::], or an outside GET answers 200: fail.", run=run_exposed,
        action="Bind the proxy to 127.0.0.1, or run sudo ufw deny 3456.",
    ),
]
