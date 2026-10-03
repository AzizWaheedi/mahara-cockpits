"""Tier 2: hand an incident to Claude Code, which may write a fix with tests
and open a pull request. It never deploys.

ai-brief  writes a self-contained brief: the incident, its readings, the
          check's meaning and threshold, the matching RUNBOOK.md section, the
          files to read first, and the hard limits.
ai-fix    runs Claude Code headless on a fresh clone, branch
          guardian/fix-<check>-<id>, when Claude is signed in for this user
          on this machine (it asks for one word first). Afterwards the
          guardian pushes the branch and opens the pull request itself with
          GITHUB_TOKEN; Claude is not given push, deploy, ssh or curl.
"""
from __future__ import annotations

import os
import re
import shutil
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Any, Callable, Optional

from . import http
from .config import REPO, ROOT
from .model import kuwait, now_utc, parse_time
from .redact import clean, clean_obj

RUNBOOK = REPO / "RUNBOOK.md"
REPO_SLUG = "AzizWaheedi/mahara-cockpits"
SIGNED_OUT = re.compile(r"(?i)/login|invalid api key|not logged in|oauth token has expired|please run|authentication")

FILES_BY_CHECK = (
    (r"^claude-", ["hermes/sales-desk/desk/model.py", "hermes/salma/salma.py"]),
    (r"^desk-", ["hermes/sales-desk/desk.py", "hermes/sales-desk/desk/", "hermes/sales-desk/README.md", "apps/media-buyer-cockpit/convex/salesWatch.ts"]),
    (r"^salma-|^queue-social", ["hermes/salma/salma.py", "hermes/salma/README.md"]),
    (r"^webinar-", ["hermes/webinar-pull/pull.py", "hermes/webinar-pull/README.md"]),
    (r"^editor-|^team-recordings|^queue-editor", ["hermes/editor-desk/desk.py", "hermes/editor-desk/desk/"]),
    (r"^radar-|^queue-ideation", ["hermes/ideation-radar/radar.py", "hermes/ideation-radar/radar/"]),
    (r"^sales-mirror|^sales-locks|^b2b-", ["supabase/functions/sales-mirror/index.ts"]),
    (r"^tap-", ["supabase/functions/tap-charges-sync/"]),
    (r"^site-sales|^sales-api|^whatsapp-", ["apps/sales-cockpit/", "supabase/functions/sales-api/index.ts"]),
    (r"^site-editor", ["apps/video-editor-cockpit/"]),
    (r"^site-client", ["apps/client-success-cockpit/"]),
    (r"^site-creative$", ["apps/creative-director-cockpit/"]),
    (r"^site-(cockpit|ceo|media)|^convex-|^hermes-ask", ["apps/media-buyer-cockpit/convex/", "apps/media-buyer-cockpit/src/"]),
    (r"^site-webinar", ["sites/webinar/"]),
    (r"^live-", ["supabase/migrations/20261003a_sales_rooms.sql (live-calls branch)", "hermes/sales-desk/desk/rooms.py (live-calls branch)"]),
    (r"^vps-|^log-|^keys-|^key-", ["hermes/cockpit-guardian/", "RUNBOOK.md"]),
    (r"^pg-cron|^edge-|^auth-|^supabase-", ["supabase/migrations/", "supabase/functions/"]),
)
RUNBOOK_WORDS = {
    "claude-": "Sales desk", "desk-": "Sales desk", "salma": "Salma", "webinar": "Webinar pull", "editor": "Editor desk", "radar": "Ideation radar",
    "team-": "Team meetings", "sales-": "Sales cockpit", "convex": "Watchdog", "site-": "Shipping a fix",
    "queue-": "Scheduled jobs", "vps-": "How you find out",
}

RULES = """\
Hard limits (no exceptions):
- Never deploy: no scripts/ship.sh, vercel, supabase functions deploy, convex deploy, or merge. Code goes live only on the CEO's yes.
- Never run git pull, reset or push in a shared checkout; work only in this fresh clone. The guardian pushes your branch.
- Never touch secrets: do not print, copy, set or rotate any key; refer to keys by name only.
- Never send anything to a lead or a client, never re-queue a message, a post or a paid generation.
- Never change Supabase schema, grants, RLS, pg_cron or the vault outside a new migration file in the pull request.
- Never edit B2B (read-only for us), HighLevel, Meta, ClickUp, Typeform or Make.
- Unknown is not healthy: if you cannot prove the cause from the code and the readings, say what you know and stop.
- Plain English, no em dashes, in code comments, the commit message and the pull request.
"""


def files_for(check_id: str) -> list[str]:
    out: list[str] = []
    for pattern, files in FILES_BY_CHECK:
        if re.search(pattern, check_id):
            out += [f for f in files if f not in out]
    return out or ["RUNBOOK.md"]


def runbook_section(check_id: str, limit: int = 60) -> str:
    title = next((t for k, t in RUNBOOK_WORDS.items() if check_id.startswith(k) or k in check_id), None)
    try:
        text = RUNBOOK.read_text(encoding="utf-8")
    except OSError:
        return "(RUNBOOK.md is not in this checkout)"
    if not title:
        return "(no RUNBOOK.md section matches this check)"
    lines = text.splitlines()
    start = next((i for i, l in enumerate(lines) if l.startswith("## ") and title.lower() in l.lower()), None)
    if start is None:
        return f"(RUNBOOK.md has no '{title}' section)"
    end = next((i for i in range(start + 1, len(lines)) if lines[i].startswith("## ")), len(lines))
    return "\n".join(clean(l, 600) for l in lines[start:min(end, start + limit)])


def brief(inc: dict[str, Any], check: Any) -> str:
    ev = clean_obj(inc.get("evidence") or {})
    attempts = inc.get("fix_attempts") or []
    att = "\n".join(f"- {a.get('at')}: {a.get('fix')} ({'ok' if a.get('ok') else 'not done'}): {clean(a.get('detail'), 300)}"
                    for a in attempts) or "- none"
    files = "\n".join(f"- {f}" for f in files_for(inc["check_id"]))
    import json
    return f"""# Guardian incident {inc['id'][:8]}: {inc.get('title')}

You are fixing one incident the cockpit guardian (hermes/cockpit-guardian) opened.
First classify it, with evidence, before writing any code:
1. A code fault in this repo, reproducible from the code and the readings below. The only class you may fix.
2. An operations problem (a sign-in, a key, credit, a provider outage, a stuck row, the VPS itself). Do not write code;
   write the diagnosis and the exact human action, then stop.
3. A false alarm by the guardian. Fix the guardian's check with a regression test.

## The incident
- Check: `{inc['check_id']}` ({check.name if check else inc.get('title')}), catalogue {getattr(check, 'catalogue', '') or 'n/a'}
- What it means: {getattr(check, 'means', '')}
- How it reads: {getattr(check, 'reads', '')}
- Threshold: {getattr(check, 'threshold', '')}
- Level: {inc.get('level')}, severity {inc.get('severity')}
- Reading: {inc.get('detail')}
- Since: {kuwait(parse_time(inc.get('first_seen_at')))}; opened {kuwait(parse_time(inc.get('opened_at')))}; seen {inc.get('seen')} times
- Owner and the human action on record: {inc.get('owner')}: {inc.get('action')}

## Evidence (cleaned of secrets, emails and numbers)
```json
{json.dumps(ev, indent=1, ensure_ascii=False, default=str)[:6000]}
```

## What the guardian already tried
{att}

## Files to read first
{files}
- hermes/cockpit-guardian/checks/ (the check that opened this) and its tests
- CLAUDE.md (the repo's standing rules)

## RUNBOOK.md
{runbook_section(inc['check_id'])}

## How to finish
- Write a failing test first from a made-up fixture (no real names, phones or keys), then the smallest fix.
- Run the tests of every folder you touched (python3 -m unittest in hermes workers; the app's own tests otherwise).
- Commit on the current branch with a plain message ending with the line:
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
- Then stop. The guardian pushes the branch and opens the pull request; it is never deployed by you.
- End with a few plain lines: the class, the cause, what you changed, the tests you ran, what a person must still do.

{RULES}"""


def write_brief(home: Path, inc: dict[str, Any], text: str) -> Path:
    d = home / "briefs"
    d.mkdir(parents=True, exist_ok=True)
    os.chmod(d, 0o700)
    p = d / f"{inc['check_id']}-{inc['id'][:8]}.md"
    p.write_text(text, encoding="utf-8")
    os.chmod(p, 0o600)
    return p


Runner = Callable[..., subprocess.CompletedProcess]


def _run(argv: list[str], **kw: Any) -> subprocess.CompletedProcess:
    return subprocess.run(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE, **kw)


def claude_ready(runner: Runner = _run, binary: Optional[str] = None) -> tuple[bool, str]:
    """Claude Code signed in for this user here? One short headless call answers it."""
    claude = binary or shutil.which("claude")
    if not claude:
        return False, "Claude Code is not installed for this user on this machine."
    try:
        p = runner([claude, "-p", "Reply with the single word ok.", "--output-format", "text", "--max-turns", "1"],
                   timeout=120)
    except (subprocess.TimeoutExpired, OSError) as e:
        return False, f"Claude Code did not answer a one-word request ({type(e).__name__})."
    text = (p.stdout or b"").decode("utf-8", "replace") + (p.stderr or b"").decode("utf-8", "replace")
    if p.returncode == 0 and "ok" in text.lower() and not SIGNED_OUT.search(text):
        return True, "Claude Code is signed in."
    return False, ("Claude Code is not signed in for this user on this machine, so the AI fixer cannot run. Sign in "
                   "(run claude, then /login) as this user, or run PROMPT.md from a Claude session on the Mac.")


ALLOWED_TOOLS = ("Read,Edit,Write,Glob,Grep,Bash(python3:*),Bash(git status:*),Bash(git diff:*),Bash(git add:*),"
                 "Bash(git commit:*),Bash(git log:*),Bash(bun test:*),Bash(bun run test:*),Bash(npx tsc:*),Bash(ls:*)")
DENIED_TOOLS = ("Bash(scripts/ship.sh:*),Bash(./scripts/ship.sh:*),Bash(vercel:*),Bash(npx vercel:*),Bash(supabase:*),"
                "Bash(npx supabase:*),Bash(bunx convex:*),Bash(npx convex:*),Bash(git push:*),Bash(git pull:*),"
                "Bash(git reset:*),Bash(curl:*),Bash(wget:*),Bash(ssh:*),Bash(scp:*),Bash(crontab:*),WebFetch")


def _askpass(work: Path) -> Path:
    """GIT_ASKPASS that answers with GITHUB_TOKEN from the environment, so the
    token is never in a URL, an argument or a file."""
    p = work / ".askpass.sh"
    p.write_text('#!/bin/sh\ncase "$1" in *Username*) echo x-access-token ;; *) printf %s "$GITHUB_TOKEN" ;; esac\n',
                 encoding="utf-8")
    os.chmod(p, 0o700)
    return p


def ai_fix(cfg: Any, inc: dict[str, Any], check: Any, *, dry_run: bool = False, runner: Runner = _run,
           github_token: str = "", post: Optional[Callable[..., Any]] = None) -> tuple[bool, str]:
    text = brief(inc, check)
    path = write_brief(cfg.home, inc, text)
    branch = f"guardian/fix-{inc['check_id']}-{inc['id'][:8]}"
    stamp = time.strftime("%Y%m%d%H%M%S", time.gmtime())
    work = cfg.home / "work" / f"fix-{inc['check_id']}-{stamp}"
    plan = (f"brief {path}; clone https://github.com/{REPO_SLUG} into {work}; branch {branch}; "
            f"claude -p <brief> --permission-mode acceptEdits (no deploy, push, ssh or curl); push and open a pull request")
    if dry_run:
        return True, "dry run, nothing started: " + plan
    ready, why = claude_ready(runner)
    if not ready:
        return False, why
    if not github_token:
        return False, "GITHUB_TOKEN is not set, so the branch could not be cloned or pushed; the brief is at " + str(path)
    work.parent.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ, GIT_TERMINAL_PROMPT="0", GITHUB_TOKEN=github_token)
    tmpdir = Path(tempfile.mkdtemp(prefix="askpass-", dir=str(work.parent)))
    env["GIT_ASKPASS"] = str(_askpass(tmpdir))
    try:
        p = runner(["git", "clone", "--depth", "50", f"https://github.com/{REPO_SLUG}.git", str(work)], env=env, timeout=600)
        if p.returncode != 0:
            return False, f"git clone failed: {clean((p.stderr or b'').decode('utf-8', 'replace'), 200)}"
        runner(["git", "-C", str(work), "checkout", "-b", branch], env=env, timeout=60)
        base = (runner(["git", "-C", str(work), "rev-parse", "HEAD"], env=env, timeout=60).stdout or b"").decode().strip()
        claude = shutil.which("claude") or "claude"
        c = runner([claude, "-p", text, "--permission-mode", "acceptEdits", "--allowedTools", ALLOWED_TOOLS,
                    "--disallowedTools", DENIED_TOOLS, "--max-turns", "80", "--output-format", "text"],
                   cwd=str(work), env={k: v for k, v in env.items() if k != "GITHUB_TOKEN"}, timeout=45 * 60)
        summary = clean((c.stdout or b"").decode("utf-8", "replace")[-3000:], 3000)
        head = (runner(["git", "-C", str(work), "rev-parse", "HEAD"], env=env, timeout=60).stdout or b"").decode().strip()
        if not head or head == base:
            return True, f"Claude made no commit (it may have found an operations problem). Its last words: {summary[-600:]}"
        push = runner(["git", "-C", str(work), "push", "-u", "origin", branch], env=env, timeout=300)
        if push.returncode != 0:
            return False, f"git push failed: {clean((push.stderr or b'').decode('utf-8', 'replace'), 200)}"
        body = (f"The cockpit guardian opened incident `{inc['id'][:8]}` on `{inc['check_id']}`: {inc.get('detail')}\n\n"
                f"Claude Code's summary:\n\n{summary}\n\nNot deployed. It ships only on the CEO's yes, through scripts/ship.sh.\n\n"
                "\U0001F916 Generated with [Claude Code](https://claude.com/claude-code)")
        poster = post or (lambda url, payload: http.request(
            "POST", url, headers={"Authorization": f"Bearer {github_token}", "Accept": "application/vnd.github+json"},
            json_body=payload, timeout=30))
        r = poster(f"https://api.github.com/repos/{REPO_SLUG}/pulls",
                   {"title": f"Guardian fix: {check.name if check else inc['check_id']}", "head": branch, "base": "main",
                    "body": body, "draft": True})
        url = (r.json() or {}).get("html_url") if hasattr(r, "json") else None
        if not url:
            return False, f"the branch {branch} is pushed but the pull request was refused ({getattr(r, 'status', '?')})"
        return True, f"pull request opened: {url}"
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


__all__ = ["brief", "write_brief", "claude_ready", "ai_fix", "files_for", "runbook_section", "now_utc", "ROOT"]
