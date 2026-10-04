"""The VPS Slack poster: a Slack press's answer that had nowhere else to go,
sent as a DM from the Mahara Sales bot.

A button on Slack's App Home comes with no `response_url`, so the door
(sales-live) cannot answer it in place. It stores the sentence as a room
event instead (contract-v2 section 5, "Kinds only stored"): kind
`slack.reply`, source `door`, `room_id` null, `dedupe_key`
`slack.reply:{request_id}`, `text` the sentence, `detail.slack_user_id` the
person who pressed, `handled_at` null. The sweep never replays a `door`
event, so this poster is its only reader. For each one it:

- takes it with the database's lease (`cockpit_sales_room_event_lease`,
  contract-v2 section 6), never by stamping `handled_at` first, so two runs
  at once (a run by hand inside a cron run) never both send it;
- posts `chat.postMessage` to the person's Slack user id, which Slack
  delivers in the app's DM, with the bot token SLACK_SALES_BOT_TOKEN (read by
  name, never printed or logged);
- sets `handled_at` with what Slack said: the message's `ts`, or Slack's
  refusal (`detail.refused`), so it is never sent twice;
- on a failure that may pass (Slack's breaker open, a 429, a gateway's 5xx
  with no answer from Slack itself) releases the lease and tries again, at
  most three times and ten seconds apart; a Slack call that timed out,
  dropped its connection or got Slack's own 5xx error is not repeated (Slack
  may have posted it), and is said;
- closes a reply older than ten minutes unsent (`detail.dropped`): the
  person who pressed has moved on. `gave_up` is never used, because the
  watchdog counts that key as a room signal nobody acted on.

It runs inside the room worker's minute (rooms.py, every 2 s), only while
live calls and Slack are both switched on (`live.enabled` and `live.slack`,
the watchdog's own switch for this row); a setting it cannot read is off.
With the switches off it sends nothing and writes nothing but its status
row. Its status row is (`sales-desk`, `slack`), written once a run, with a
plain sentence, red when it is switched on and cannot send (no token, a
refused token, Slack failing). Missing is never zero: replies that wait are
counted, never shown as none.
"""
from __future__ import annotations

import re
from typing import Any, Callable, Optional

from . import http
from .config import key
from .rooms import EVENTS, LEASE_FN, Breaker, ProviderError, Sender, TimeUp, db_reason, iso, parse_ts
from .supabase import SupabaseError

TOKEN_KEY = "SLACK_SALES_BOT_TOKEN"
JOB = "slack"
KIND = "slack.reply"
LIVE = "live"
POST_URL = "https://slack.com/api/chat.postMessage"


def slack_escape(text: str) -> str:
    """Text as Slack wants it escaped (&, <, >): it then shows as written
    and is never read as a mention, a channel ping or a labelled link."""
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

EVERY = 2.0               # replies are looked for this often (P2: DMs out within 5 s)
SETTINGS_EVERY = 25.0     # the live setting is read again this often
SETTINGS_STALE_S = 60.0   # with no good read of it for this long, nothing is sent
LEASE_S = 30
MAX_AGE_S = 600.0         # a reply older than this is closed unsent
MAX_TRIES = 3
RETRY_GAP_S = 10.0
PAUSE_S = 30.0            # after Slack says "slow down"
POST_TIMEOUT = 4.0
PER_STEP = 10             # replies tried in one step at most

# Slack's answers that mean the token itself is wrong: nothing can be sent
# until the CEO puts a working one on the VPS.
TOKEN_ERRORS = frozenset({
    "invalid_auth", "not_authed", "token_revoked", "token_expired", "account_inactive", "missing_scope",
    "no_permission", "not_allowed_token_type", "org_login_required", "ekm_access_denied", "team_access_not_granted",
})
SLACK_USER = re.compile(r"^[UW][A-Z0-9]{2,30}$")

SAY = {
    "off": "Slack is switched off (live.enabled and live.slack), so no Slack reply is sent.",
    "unread": "The live setting could not be read, so no Slack reply is sent until it can be.",
    "no_token": ("SLACK_SALES_BOT_TOKEN is not set on the VPS, so Slack replies to App Home presses cannot be sent. "
                 "Ask the CEO to put the Mahara Sales bot token in /opt/data/bibi/api-keys.env as "
                 "SLACK_SALES_BOT_TOKEN."),
    "token_note_set": "SLACK_SALES_BOT_TOKEN is set.",
    "token_note_missing": "SLACK_SALES_BOT_TOKEN is not set on the VPS yet; set it before Slack is switched on.",
    "bad_token": ("Slack refused the Mahara Sales bot token ({why}), so Slack replies cannot be sent. Ask the CEO to "
                  "reinstall the Mahara Sales app and put its new bot token in /opt/data/bibi/api-keys.env as "
                  "SLACK_SALES_BOT_TOKEN."),
}


def _s(n: int, word: str, plural: Optional[str] = None) -> str:
    return f"{n} {word if n == 1 else (plural or word + 's')}"


class SlackPoster:
    """Built by the room worker (rooms.Worker.from_env) on its own HTTP door:
    the same time budget, so nothing runs past the run's hard stop."""

    def __init__(self, sb: Any, token: str, send: Sender, clock: Callable[[], float], log: Any,
                 write_status: Callable[..., None]):
        self.sb = sb
        self.token = token
        self.send = send
        self.clock = clock
        self.log = log
        self._write_status = write_status
        self.breaker = Breaker("Slack", clock)
        self.live: Optional[dict[str, Any]] = None
        self._live_at: Optional[float] = None
        self._live_due = 0.0
        self._due = 0.0
        self._paused_until = 0.0
        self.bad_token = ""
        self.read_error = ""
        self.waiting = 0
        self._from = clock()
        self.counts = {"sent": 0, "refused": 0, "dropped": 0, "unclear": 0, "failed": 0}
        self.refusals: list[str] = []
        self._warned: set[str] = set()
        # Replies Slack took (or refused) whose handled mark did not land:
        # the mark is tried again, never the send (dedupe key -> the mark).
        self._unmarked: dict[str, tuple[dict[str, Any], dict[str, Any], str]] = {}

    @classmethod
    def from_env(cls, worker: Any, send: Sender) -> "SlackPoster":
        return cls(worker.sb, key(TOKEN_KEY).strip(), send, worker.clock, worker.log,
                   lambda ok, detail: worker._write_status(ok, detail, job=JOB))

    # ---- switches -------------------------------------------------------------
    def _read_live(self, now: float) -> None:
        if now < self._live_due:
            return
        self._live_due = now + EVERY
        try:
            value = self.sb.setting(LIVE)
        except TimeUp:
            return
        except (SupabaseError, http.HttpError) as e:
            self._warn_once("live", f"slack: the live setting could not be read: {db_reason(e)}")
            return
        self._live_due = now + SETTINGS_EVERY
        self.live = value if isinstance(value, dict) else {}
        self._live_at = self.clock()

    def _fresh(self) -> bool:
        return self._live_at is not None and self.clock() - self._live_at <= SETTINGS_STALE_S

    def switched_on(self) -> bool:
        """Both switches true in a setting read within the last minute."""
        live = self.live or {}
        return self._fresh() and live.get("enabled") is True and live.get("slack") is True

    def _warn_once(self, what: str, line: str) -> None:
        if what not in self._warned:
            self._warned.add(what)
            self.log.warn(line)

    # ---- the step -------------------------------------------------------------
    def step(self) -> None:
        """Every 2 s while switched on: the waiting replies, oldest first."""
        now = self.clock()
        if now < self._due:
            return
        self._due = now + EVERY
        self._read_live(now)
        if not self.switched_on():
            return
        rows = self._waiting()
        if rows is None:
            return
        tried = 0
        for e in rows:
            if tried >= PER_STEP or self.bad_token or self.clock() < self._paused_until:
                break
            if self._one(e):
                tried += 1
        self.waiting = sum(1 for e in rows if not e.get("_done"))

    def _waiting(self) -> Optional[list[dict[str, Any]]]:
        try:
            rows = self.sb.select(EVENTS, f"select=id,dedupe_key,at,tries,last_try_at,lease_until,text,detail"
                                          f"&kind=eq.{KIND}&source=eq.door&handled_at=is.null&order=at.asc&limit=50")
        except TimeUp:
            return None
        except (SupabaseError, http.HttpError) as e:
            self.read_error = db_reason(e)
            self._warn_once("read", f"slack: the replies could not be read: {self.read_error}")
            return None
        self.read_error = ""
        return rows

    def _one(self, e: dict[str, Any]) -> bool:
        """One reply: True when something was tried (sent, refused, closed)."""
        if e.get("dedupe_key") in self._unmarked:
            _e, extra, count = self._unmarked[e["dedupe_key"]]
            return self._finish(e, extra, count)
        now = self.clock()
        at = parse_ts(e.get("at")) or now
        tries = int(e.get("tries") or 0)
        held = parse_ts(e.get("lease_until"))
        if held is not None and held > now:
            return False  # another run is on it
        if now - at > MAX_AGE_S:
            return self._close(e, {"dropped": "too_old"}, "dropped")
        if tries >= MAX_TRIES:
            return self._close(e, {"dropped": "slack_failed"}, "dropped")
        last = parse_ts(e.get("last_try_at"))
        if last is not None and now - last < RETRY_GAP_S:
            return False
        if not self.token or self.bad_token or now < self._paused_until or self.breaker.blocked():
            return False
        detail = e.get("detail") if isinstance(e.get("detail"), dict) else {}
        user = str(detail.get("slack_user_id") or "").strip()
        # The door's own sentence, as it wrote it (it may carry a cockpit
        # link); only anything that looks like a key is hidden. Escaped for
        # Slack at this last step (& < >), so words that came from a lead (a
        # name, a company) never reach it as markup (<!channel>, <@U...>, a
        # link with a label of their choosing). A bare link still links.
        text = slack_escape(re.sub(r"\s+", " ", http.scrub(str(e.get("text") or ""))).strip()[:3000])
        if not SLACK_USER.match(user):
            return self._close(e, {"refused": "no_slack_user"}, "refused")
        if not text:
            return self._close(e, {"refused": "no_text"}, "refused")
        if not self._lease(e):
            return False
        try:
            _s_, data = self.send("POST", POST_URL, headers={"Authorization": f"Bearer {self.token}"},
                                  body={"channel": user, "text": text, "unfurl_links": False, "unfurl_media": False},
                                  timeout=POST_TIMEOUT, retries=0, safe=False, breaker=self.breaker)
        except ProviderError as err:
            if err.timeup or err.down:
                self._release(e, bump=False)
                return False
            if err.status == 429:
                self._paused_until = self.clock() + PAUSE_S
                self._release(e, bump=False)
                return True
            if err.timed_out:
                # Slack may have posted it: never sent a second time.
                return self._finish(e, {"unclear": "Slack did not answer in time"}, "unclear")
            # Slack's own error answer to the post (internal_error,
            # fatal_error: "it's possible some aspect of the operation
            # succeeded"), or a connection dropped mid-answer: Slack may have
            # posted the DM (stress2, round 2: the rep got it two or three
            # times). Never sent again, and said. A gateway's 5xx with no
            # answer from Slack itself is an outage, tried again.
            slack_said = bool(re.fullmatch(r"[a-z0-9_]{2,60}", str(err.message or "").strip()))
            if err.status == 0 or (err.status >= 500 and slack_said):
                why = "Slack answered with an error after the post" if err.status else "the connection dropped"
                return self._finish(e, {"unclear": why}, "unclear")
            self.counts["failed"] += 1
            self._warn_once(f"post:{err.status}", f"slack: a reply could not be sent ({err.why}); it is tried again")
            self._release(e, bump=True)
            return True
        answer = data if isinstance(data, dict) else {}
        if answer.get("ok") is True:
            return self._finish(e, {"posted_ts": str(answer.get("ts") or ""),
                                    "posted_channel": str(answer.get("channel") or "")}, "sent")
        error = re.sub(r"[^a-z0-9_]", "", str(answer.get("error") or "no_reason").lower())[:60] or "no_reason"
        if error in TOKEN_ERRORS:
            self.bad_token = error
            self._release(e, bump=False)
            self.log.error(f"slack: {SAY['bad_token'].format(why=error)}")
            return True
        if error == "ratelimited":
            self._paused_until = self.clock() + PAUSE_S
            self._release(e, bump=False)
            return True
        self.refusals.append(error)
        return self._finish(e, {"refused": error}, "refused")

    # ---- the event: lease, release, finish -----------------------------------
    def _lease(self, e: dict[str, Any]) -> bool:
        try:
            got = self.sb.rest("POST", f"rpc/{LEASE_FN}", json_body={"p_dedupe_key": e["dedupe_key"],
                                                                    "p_seconds": LEASE_S})
        except TimeUp:
            return False
        except (SupabaseError, http.HttpError) as err:
            self.read_error = db_reason(err)
            self._warn_once("lease", f"slack: a reply could not be taken with the lease: {self.read_error}")
            return False
        return bool(got)

    def _where(self, e: dict[str, Any]) -> str:
        return f"{EVENTS}?dedupe_key=eq.{http.quote(e['dedupe_key'])}&handled_at=is.null"

    def _release(self, e: dict[str, Any], *, bump: bool) -> None:
        body: dict[str, Any] = {"lease_until": None}
        if bump:
            body.update({"tries": int(e.get("tries") or 0) + 1, "last_try_at": iso(self.clock())})
        try:
            self.sb.rest("PATCH", self._where(e), json_body=body, prefer="return=minimal")
        except (SupabaseError, http.HttpError) as err:
            # The lease runs out by itself in 30 s.
            self._warn_once("release", f"slack: a reply's lease could not be released: {db_reason(err)}")

    def _finish(self, e: dict[str, Any], extra: dict[str, Any], count: str) -> bool:
        """Marks the reply handled with what happened. When the mark does not
        land, it is kept and tried again at the next step, while this run
        still holds the lease: Slack is never asked a second time."""
        detail = e.get("detail") if isinstance(e.get("detail"), dict) else {}
        try:
            self.sb.rest("PATCH", self._where(e), prefer="return=minimal", json_body={
                "handled_at": iso(self.clock()), "lease_until": None, "detail": {**detail, **extra}})
        except (SupabaseError, http.HttpError) as err:
            self.read_error = db_reason(err)
            self._warn_once("finish", f"slack: a reply could not be marked handled, so the mark is tried again: "
                                      f"{self.read_error}")
            self._unmarked[e["dedupe_key"]] = (e, extra, count)
            return True
        self._unmarked.pop(e["dedupe_key"], None)
        e["_done"] = True
        self.counts[count] += 1  # counted once, when its mark lands
        return True

    def _close(self, e: dict[str, Any], extra: dict[str, Any], count: str) -> bool:
        """Closed without a send: taken with the lease first, like a send."""
        if not self._lease(e):
            return False
        return self._finish(e, extra, count)

    # ---- the status row -------------------------------------------------------
    def _count_waiting(self) -> Optional[int]:
        try:
            rows = self.sb.select(EVENTS, f"select=id&kind=eq.{KIND}&source=eq.door&handled_at=is.null&limit=200")
        except (SupabaseError, http.HttpError) as e:
            self.read_error = db_reason(e)
            return None
        return len(rows)

    def sentence(self) -> tuple[bool, str]:
        c = self.counts
        span = max(1, int(round(self.clock() - self._from)))
        token_note = SAY["token_note_set"] if self.token else SAY["token_note_missing"]
        if not self._fresh():
            return False, SAY["unread"]
        waiting = self._count_waiting() if not self.switched_on() else self.waiting
        wait_note = ("The number of replies waiting could not be read." if waiting is None else
                     f"{_s(waiting, 'Slack reply', 'Slack replies')} wait; one left over ten minutes is closed "
                     "unsent." if waiting else "")
        if not self.switched_on():
            return True, " ".join(x for x in (SAY["off"], token_note, wait_note) if x)
        if not self.token:
            return False, " ".join(x for x in (SAY["no_token"], wait_note) if x)
        if self.bad_token:
            return False, " ".join(x for x in (SAY["bad_token"].format(why=self.bad_token), wait_note) if x)
        bits = []
        if c["sent"] or c["refused"] or c["dropped"] or c["unclear"] or c["failed"]:
            bits.append(f"Working. In the last {span} seconds: {_s(c['sent'], 'Slack reply', 'Slack replies')} sent"
                        + (f", {c['refused']} refused by Slack ({', '.join(dict.fromkeys(self.refusals))})"
                           if c["refused"] else "")
                        + (f", {c['dropped']} closed unsent because they were over ten minutes old or failed three "
                           "times" if c["dropped"] else "")
                        + (f", {c['unclear']} that Slack did not confirm in time, so not sent again"
                           if c["unclear"] else "")
                        + (f", {c['failed']} tries Slack did not take, tried again" if c["failed"] else "") + ".")
        else:
            bits.append(f"Working. No Slack reply to send in the last {span} seconds.")
        if wait_note:
            bits.append(wait_note)
        ok = True
        if self.read_error:
            bits.append(f"The database did not answer as expected ({self.read_error}).")
            ok = False
        if c["failed"] and not c["sent"]:
            ok = False
        if self.breaker.blocked():
            bits.append("Slack is not answering, so replies wait until it does.")
            ok = False
        return ok, " ".join(bits)

    def flush(self) -> None:
        """At the end of the run: the marks that did not land are tried once
        more, so the next run, which has no memory of them, does not send
        them again once their lease runs out."""
        for _key, (e, extra, count) in list(self._unmarked.items()):
            self._finish(e, extra, count)

    def status(self) -> None:
        self.flush()
        ok, detail = self.sentence()
        self._write_status(ok, detail)
        self.counts = {k: 0 for k in self.counts}
        self.refusals = []
        self._from = self.clock()
