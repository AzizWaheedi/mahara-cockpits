"""The hermes cron jobs the guardian knows, and what each is allowed.

`marker` is the part of the cron command that names the job; it is how a
crontab line, a running process and a manifest line are matched to a job.
`kind` decides what the guardian may do on its own:

- copy:  reads a source and upserts rows; a catch-up run or stopping a hung
         run is safe (catalogue fixes 1 and 2).
- sends: reaches a person (WhatsApp, Slack, email, HighLevel). Never touched.
- ai:    calls a model. Never re-run by the guardian.
- paid:  spends money per run (Apify, Higgsfield). Never re-run.
- other: anything else; alert only.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from .config import ROOT

MANIFEST = ROOT / "crontab.manifest"


@dataclass(frozen=True)
class Job:
    name: str
    marker: str
    every_min: int
    kind: str
    log: str
    lock: str


JOBS: tuple[Job, ...] = (
    Job("editor-sync", "desk.py --quiet sync", 30, "copy", "~/.editor-desk/out/cron.log", "~/.editor-desk/sync.lock"),
    Job("editor-prepare", "desk.py --quiet prepare", 30, "ai", "~/.editor-desk/out/cron.log", "~/.editor-desk/prepare.lock"),
    Job("editor-notes", "desk.py --quiet notes", 60, "ai", "~/.editor-desk/out/cron.log", "~/.editor-desk/notes.lock"),
    Job("editor-requests", "desk.py --quiet requests", 3, "other", "~/.editor-desk/out/cron.log", "~/.editor-desk/requests.lock"),
    Job("editor-meetings", "desk.py --quiet meetings", 60, "copy", "~/.editor-desk/out/cron.log", "~/.editor-desk/meetings.lock"),
    Job("editor-foreplay", "desk.py --quiet foreplay", 20, "paid", "~/.editor-desk/out/cron.log", "~/.editor-desk/foreplay.lock"),
    Job("editor-archive", "desk.py --quiet archive", 1440, "other", "~/.editor-desk/out/cron.log", "~/.editor-desk/archive.lock"),
    Job("salma", "salma/salma.py", 1, "sends", "~/.salma.log", "~/.salma.lock"),
    Job("radar-posts", "radar.py --quiet posts", 2, "paid", "~/.ideation-radar/out/cron.log", "~/.ideation-radar/posts.lock"),
    Job("hala", "hala/inbox.py", 15, "ai", "~/.hala.log", "~/.hala.lock"),
    Job("review-watch", "review-watch/watch.py", 10, "sends", "~/.reviewwatch.log", "~/.reviewwatch.lock"),
    Job("review-import", "python3 import.py", 2, "copy", "~/.reviewimport.log", "~/.reviewimport.lock"),
    Job("radar-hiring", "radar.py --quiet hiring", 30, "sends", "~/.ideation-radar/out/hiring.log", "~/.ideation-radar/hiring.lock"),
    Job("eod-out", "python3 out.py", 5, "sends", "~/.eodout.log", "~/.eodout.lock"),
    Job("team-sync", "python3 sync.py", 5, "copy", "~/.teamsync.log", "~/.teamsync.lock"),
    Job("webinar-pull", "pull.py --quiet", 60, "copy", "~/.webinar-pull.log", "~/.webinar-pull.lock"),
    Job("desk-requests", "desk.py --quiet requests", 2, "ai", "~/.sales-desk.log", "~/.sales-desk/requests.lock"),
    Job("desk-recordings", "desk.py --quiet recordings", 30, "copy", "~/.sales-desk.log", "~/.sales-desk/recordings.lock"),
    Job("desk-calls-vault", "desk.py --quiet calls-vault", 30, "copy", "~/.sales-desk.log", "~/.sales-desk/calls-vault.lock"),
    Job("desk-reviews", "desk.py --quiet reviews --limit", 30, "ai", "~/.sales-desk.log", "~/.sales-desk/reviews.lock"),
    Job("desk-research", "desk.py --quiet research", 2, "ai", "~/.sales-desk.log", "~/.sales-desk/research.lock"),
    Job("desk-followups", "desk.py --quiet followups", 30, "ai", "~/.sales-desk.log", "~/.sales-desk/followups.lock"),
    Job("desk-reviews-asked", "desk.py --quiet reviews --asked", 2, "ai", "~/.sales-desk.log", "~/.sales-desk/reviews-asked.lock"),
    Job("desk-digest", "desk.py --quiet digest", 1440, "ai", "~/.sales-desk.log", "~/.sales-desk/digest.lock"),
    Job("desk-notes", "desk.py --quiet notes", 30, "ai", "~/.sales-desk.log", "~/.sales-desk/notes.lock"),
    Job("desk-maqsam-calls", "desk.py --quiet maqsam-calls", 30, "copy", "~/.sales-desk.log", "~/.sales-desk/maqsam-calls.lock"),
    # Live calls Milestone 1 (2026-10-07). The room worker holds `flock -w 10`, not
    # `-n`, so the guardian never starts a catch-up run of it (command_for); it can
    # send a lead a link once rooms are switched on, so it is never re-run either.
    Job("desk-rooms", "desk.py --quiet rooms --for", 1, "sends", "~/.sales-desk.log", "~/.sales-desk/rooms.lock"),
    Job("desk-room-hosts", "desk.py --quiet rooms --check-hosts", 10, "other", "~/.sales-desk.log",
        "~/.sales-desk/room-hosts.lock"),
    Job("desk-doctor", "desk.py --quiet doctor", 60, "other", "~/.sales-desk.log", "~/.sales-desk/doctor.lock"),
    Job("radar-scan", "radar.py --quiet scan", 10080, "paid", "~/.ideation-radar/out/cron.log", "~/.ideation-radar/scan.lock"),
    Job("radar-pending", "radar.py --quiet pending", 5, "paid", "~/.ideation-radar/out/cron.log", "~/.ideation-radar/pending.lock"),
)
BY_NAME = {j.name: j for j in JOBS}

# The process markers the snapshot looks for, with the folder the process
# runs in (both desks run desk.py; their working folder tells them apart) and
# the lock its cron line holds: a process counts as that job's cron run only
# when an ancestor is `flock -n <that lock>` (a manual backfill or another
# user's process with the same words in its command line is never touched).
def _folder(job: Job) -> str:
    if job.name.startswith("editor-"):
        return "editor-desk"
    if job.name.startswith("desk-"):
        return "sales-desk"
    return ""


PROCESS_MARKERS = {j.name: [j.marker, _folder(j), j.lock] for j in JOBS}
PROCESS_MARKERS["rooms-worker"] = ["rooms", "sales-desk", ""]

COPY_JOBS = tuple(j.name for j in JOBS if j.kind == "copy")

# Logs the guardian may rotate: hermes's own cron logs, nothing else.
HERMES_LOGS = tuple(sorted({j.log for j in JOBS}))

_SCHEDULE = re.compile(r"^\s*((?:\S+\s+){5})(.*)$")


def split_line(line: str) -> Optional[tuple[str, str]]:
    m = _SCHEDULE.match(line)
    if not m:
        return None
    return " ".join(m.group(1).split()), m.group(2).strip()


def job_for_line(line: str) -> Optional[Job]:
    """The job a crontab line runs. The editor desk and the sales desk both
    run desk.py; the folder in the line tells them apart."""
    parts = split_line(line)
    if not parts:
        return None
    cmd = parts[1]
    for j in JOBS:
        marker = j.marker
        if marker not in cmd:
            continue
        if j.name.startswith("editor-") and "hermes/editor-desk" not in cmd:
            continue
        if j.name.startswith("desk-") and "hermes/sales-desk" not in cmd:
            continue
        return j
    return None


def manifest_lines(path: Path = MANIFEST) -> list[str]:
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return []
    return [l.strip() for l in text.splitlines() if l.strip() and not l.strip().startswith("#")]


def command_for(job: Job, crontab_lines: list[str]) -> Optional[str]:
    """The exact command the live crontab runs for `job`, only when it still runs
    under `flock -n` (a catch-up run must queue behind the same lock)."""
    for line in crontab_lines:
        if job_for_line(line) == job:
            parts = split_line(line)
            if parts and parts[1].startswith("flock -n "):
                return parts[1]
    return None


def expand(path: str, home: str) -> str:
    return str(Path(path.replace("$HOME", home).replace("~", home, 1) if path.startswith("~") else path.replace("$HOME", home)))
