"""Keys by name, env file permissions, and cheap read-only key probes
(catalogue H10, M1, M2).

The VPS snapshot gives each env file's key NAMES and whether each is set or
empty; no value leaves the box. The probes run only on the VPS itself, with
the key read by name, against free read-only endpoints (Slack auth.test,
DeepSeek's balance, OpenAI's model list). Off the box they are coverage gaps.
"""
from __future__ import annotations

from guard import fixes
from guard.context import Context
from guard.model import Check, Result, fail, ok, unknown, warn

API = "/opt/data/bibi/api-keys.env"
REQUIRED = {
    # name: (file, what stops without it)
    "DESK_SUPABASE_URL": ("~/.editor-desk/env", "every desk worker cannot reach Creative Triage"),
    "DESK_SUPABASE_KEY": ("~/.editor-desk/env", "every desk worker cannot reach Creative Triage"),
    "RADAR_SUPABASE_URL": ("~/.ideation-radar/env", "the ideation radar cannot store anything"),
    "RADAR_SUPABASE_KEY": ("~/.ideation-radar/env", "the ideation radar cannot store anything"),
    "SALES_MODEL_PROVIDER": ("~/.sales-desk/env", "the sales desk falls back to its default model provider"),
    "SLACK_BOT_TOKEN": (API, "no Slack message goes out, the guardian's included"),
    "SLACK_HEALTH_CHANNEL": (API, "the guardian has nowhere to post"),
    "COMPOSIO_API_KEY": (API, "the webinar survey and Zoom reads through Composio stop"),
    "ZOOM_ACCOUNT_ID": (API, "the webinar pull cannot use the Zoom app"),
    "ZOOM_CLIENT_ID": (API, "the webinar pull cannot use the Zoom app"),
    "ZOOM_CLIENT_SECRET": (API, "the webinar pull cannot use the Zoom app"),
    "GHL_B2B_API_KEY": (API, "follow-ups and webinar reminders cannot read HighLevel"),
    "FATHOM_API_KEY": (API, "sales recordings cannot be indexed"),
    "MAQSAM_ACCESS_KEY": (API, "phone calls cannot be copied"),
    "MAQSAM_SECRET": (API, "phone calls cannot be copied"),
    "OPENAI_API_KEY": (API, "lead research and Salma's OpenAI calls stop"),
    "DEEPSEEK_API_KEY": (API, "Hala's reply drafts and objection tagging stop"),
    "HIGGSFIELD_ID": (API, "Salma cannot draw client pictures"),
    "HIGGSFIELD_SECRET": (API, "Salma cannot draw client pictures"),
    "META_ACCESS_TOKEN": (API, "Salma's Meta checks stop"),
    "ELEVENLABS_API_KEY": (API, "the editor desk cannot transcribe footage"),
    "APIFY_API_KEY": (API, "the ideation radar cannot scan"),
    "SCRAPECREATORS_API_KEY": (API, "the ideation radar cannot read posts"),
    "GOOGLE_CLIENT_ID": (API, "Google Drive, Docs and Calendar reads stop"),
    "GOOGLE_CLIENT_SECRET": (API, "Google Drive, Docs and Calendar reads stop"),
    "GOOGLE_REFRESH_TOKEN": (API, "Google Drive, Docs and Calendar reads stop"),
    "CLICKUP_API_KEY": (API, "the editor board cannot be read"),
}
OPTIONAL = {
    "ANTHROPIC_API_KEY": (API, "only used when SALES_MODEL_PROVIDER is anthropic"),
}


def run_names(ctx: Context) -> Result:
    env = ctx.snap_part("env_keys")
    missing, empty, unread = [], [], []
    for name, (path, why) in REQUIRED.items():
        names = env.get(path)
        if names is None:
            missing.append(f"{name} ({path} does not exist; {why})")
        elif isinstance(names, dict) and "error" in names and len(names) == 1:
            unread.append(path)
        elif name not in names:
            missing.append(f"{name} is missing from {path}, so {why}")
        elif names[name] == "empty":
            empty.append(f"{name} is empty in {path}, so {why}")
    notes = []
    provider = (ctx.snap_part("settings") or {}).get("SALES_MODEL_PROVIDER", "")
    for name, (path, why) in OPTIONAL.items():
        state = (env.get(path) or {}).get(name)
        if state != "set":
            if name == "ANTHROPIC_API_KEY" and provider == "anthropic":
                empty.append(f"{name} is {state or 'missing'} in {path}, and the sales desk is set to draft with anthropic")
            else:
                notes.append(f"{name} is {state or 'missing'} ({why})")
    ev = {"missing": missing, "empty": empty, "unreadable": unread, "notes": notes}
    if missing or empty:
        lines = missing + empty
        return fail(f"{len(lines)} key(s) the workers need are not set: {'; '.join(lines[:4])}.", evidence=ev,
                    action="Put each value in the file named, on the VPS, never in chat.",
                    items=sorted(l.split(" ", 1)[0] for l in lines))
    if unread:
        return unknown(f"Could not read {', '.join(unread)}.", evidence=ev)
    tail = f" Note: {'; '.join(notes)}." if notes else ""
    return ok(f"All {len(REQUIRED)} required keys are set.{tail}", evidence=ev)


def run_modes(ctx: Context) -> Result:
    files = ctx.snap_part("files")
    me = ctx.snapshot().get("user")
    loose, others = [], []
    for path, info in files.items():
        if not info or not (path.endswith("/env") or path.endswith(".env")):
            continue
        if int(info.get("mode") or "600", 8) & 0o077:
            (loose if info.get("owner") == me else others).append(f"{path} ({info.get('mode')})")
    if loose or others:
        text = f"Env files readable by other users: {', '.join(loose + others)}."
        return warn(text, evidence={"hermes_owned": loose, "others": others})
    return ok("Every env file is mode 600.")


def run_team_sync_env(ctx: Context) -> Result:
    files = ctx.snap_part("files")
    if files.get("~/.team-sync/env") is None:
        return warn("~/.team-sync/env does not exist, so GOOGLE_CAL_* are unset; team-sync uses the editor desk's Google "
                    "sign-in and meeting changes made in the cockpit may not reach Google Calendar.")
    return ok("~/.team-sync/env exists.")


def _probe(ctx: Context, name: str) -> str:
    return ctx.key(name)


def run_slack(ctx: Context) -> Result:
    token = _probe(ctx, "SLACK_BOT_TOKEN")
    if not token:
        return unknown("SLACK_BOT_TOKEN can only be tried on the VPS itself.", coverage_gap=True)
    r = ctx.http_get("https://slack.com/api/auth.test", headers={"Authorization": f"Bearer {token}"}, timeout=15)
    body = r.json() or {}
    if body.get("ok"):
        return ok("Slack accepts SLACK_BOT_TOKEN.")
    return fail(f"Slack refuses SLACK_BOT_TOKEN ({body.get('error')}), so no alert can be posted.",
                action="Put a working bot token in /opt/data/bibi/api-keys.env.")


def run_deepseek(ctx: Context) -> Result:
    key = _probe(ctx, "DEEPSEEK_API_KEY")
    if not key:
        return unknown("DEEPSEEK_API_KEY can only be tried on the VPS itself.", coverage_gap=True)
    r = ctx.http_get("https://api.deepseek.com/user/balance", headers={"Authorization": f"Bearer {key}"}, timeout=15)
    if r.status == 401:
        return fail("DeepSeek refuses DEEPSEEK_API_KEY.")
    body = r.json() or {}
    total = 0.0
    for b in body.get("balance_infos") or []:
        try:
            total += float(b.get("total_balance") or 0)
        except ValueError:
            pass
    if r.status != 200:
        return unknown(f"DeepSeek's balance answered {r.status}.")
    if not body.get("is_available") or total < 2:
        return fail(f"DeepSeek's balance is used up ({total:.2f} left), so webinar objection tagging and Hala's reply "
                    "drafts stop.", evidence={"balance": round(total, 2)}, action="Top up DeepSeek.")
    return ok(f"DeepSeek has {total:.2f} of balance.", evidence={"balance": round(total, 2)})


def run_openai(ctx: Context) -> Result:
    key = _probe(ctx, "OPENAI_API_KEY")
    research = None
    try:
        rows = ctx.rows("cockpit_sales_worker_status", "job,ok,detail,at", where=[("worker", "eq", "sales-desk"),
                                                                                  ("job", "eq", "research")])
        research = rows[0] if rows else None
    except Exception:  # noqa: BLE001 - the row is a second opinion
        research = None
    if research and research.get("ok") is False and "credit_balance" in str(research.get("detail")):
        return fail("OpenAI has no credit, so lead research stops.",
                    action="Top up at platform.openai.com, Settings, Billing.")
    if not key:
        return unknown("OPENAI_API_KEY can only be tried on the VPS itself.", coverage_gap=True)
    r = ctx.http_get("https://api.openai.com/v1/models", headers={"Authorization": f"Bearer {key}"}, timeout=15)
    if r.status == 401:
        return fail("OpenAI refuses OPENAI_API_KEY.")
    if r.status != 200:
        return unknown(f"OpenAI's model list answered {r.status}.")
    return ok("OpenAI accepts the key (credit shows only when a call fails).")


CHECKS = [
    Check(id="keys-present", area="keys", name="Worker keys", catalogue="H10",
          means="Every key the hermes workers need is set in its env file.", severity="high",
          reads="Key names and set/empty in each env file (never a value)",
          threshold="A required key missing or empty: fail.", run=run_names,
          action="Put the value in the file named on the VPS, never in chat."),
    Check(id="keys-file-modes", area="keys", name="Env file permissions", catalogue="H10",
          means="Only their owner can read the env files.", severity="medium", reads="Mode and owner of each env file",
          threshold="Any group or other permission: warn.", run=run_modes, fix=fixes.TIGHTEN_ENV,
          action="chmod 600 the files the guardian could not (they belong to another user)."),
    Check(id="keys-team-sync", area="keys", name="Calendar sign-in for team-sync", catalogue="W12",
          means="team-sync has its own Google Calendar sign-in.", severity="low", reads="Whether ~/.team-sync/env exists",
          threshold="Missing: warn (summary only).", run=run_team_sync_env, alert=False,
          action="Put GOOGLE_CAL_* in ~/.team-sync/env on the VPS."),
    Check(id="key-slack", area="keys", name="Slack bot token",
          means="Slack accepts the bot token the guardian and the workers post with.", severity="high",
          reads="POST slack.com/api/auth.test (free)", threshold="Refused: fail.", run=run_slack),
    Check(id="key-deepseek", area="providers", name="DeepSeek balance", catalogue="M2",
          means="DeepSeek has balance for Hala and objection tagging.", severity="medium",
          reads="GET api.deepseek.com/user/balance (free)", threshold="Unavailable or under 2: fail.", run=run_deepseek),
    Check(id="key-openai", area="providers", name="OpenAI key", catalogue="M1",
          means="OpenAI accepts the key and has credit.", severity="medium",
          reads="GET api.openai.com/v1/models (free) and the research row's error",
          threshold="401, or credit_balance_exhausted in research: fail.", run=run_openai),
]
