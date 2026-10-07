#!/usr/bin/env python3
"""Is the work preserved before the native Supabase cutover still in place? Read-only.

Run from the repository root before the cutover starts (the baseline) and again after its last step:

    python3 scripts/verify-preserved.py              one line per check, then the verdict
    python3 scripts/verify-preserved.py --problems   only the lines that are not ok, then the verdict
    python3 scripts/verify-preserved.py --json       the same, for machines

It compares docs/preserve/supabase-manifest.json and docs/preserve/vps-manifest.json with what is live:

- Creative Triage, through the Supabase management API (SQL sent with read_only true; the functions and
  secrets lists, secret names only): every recorded table and view (columns, row security, grants,
  triggers, policies, indexes, constraints), every recorded function (md5 of its definition), every
  recorded pg_cron job, the settings switches, the WhatsApp template rows, the vault secret names, the
  extensions, every Edge Function (slug present, version not lower, verify_jwt as recorded), the function
  secret names and the private bucket sales-proposals.
- The VPS, over ssh: our crontab lines, the sales desk and guardian files against origin/main, the env
  setting lines (compared on the VPS; only names and true/false come back), the reference deals, the call
  reviews against the 2026-10-07 backup, the Playwright shell, `desk.py doctor --offline`,
  `desk.py deploy-check` (ready, every switch off), the guardian's last scan, the Hermes fixer entry and the
  backup folder's SHA256SUMS.
- The live sales cockpit bundle: the room screens' and the proposal screens' words are still in it.
- The private bucket: its SHA256SUMS lists every backed-up object and each object matches its sum.

It also checks what a cutover can break without removing anything: the deployed source files of sales-api,
sales-live and sales-mirror against the files at the restore tag, CRON_SECRET still pairing with the vault's
cockpit_sync_secret, function secrets set again after the inventory, row counts against the inventory,
settings rows put back from an older copy, the status rows of the jobs that run every few minutes, which
Supabase project the VPS workers and the live cockpit talk to, and that origin/main and the restore tag
still hold the restore point.

Each line says ok, CHANGED, MISSING or UNKNOWN. A CHANGED line is explained when something accounts for
it, and the line says what: a migration added to the repo after the inventory redefines that object, the
VPS still holds the very copy recorded at the inventory while main moved on, the object is not part of the
preserved work, or a function was redeployed with a higher version. Anything else is not explained.
"Explained by a later migration" means: read that migration; it is the one that changed the object.

Exit codes: 0 when nothing is MISSING, every CHANGED is explained and nothing is UNKNOWN; 1 when something
is MISSING or a CHANGED is not explained; 2 when nothing failed but some checks could not be made.

Other modes:
    --print-cron        the exact text of our crontab lines as recorded, to put back a lost line
    --project REF       check another Supabase project (after a planned move) against the same records
    --record FILE       save what every source answered (names, digests, booleans; never a secret or a row)
    --replay FILE       judge a saved recording instead of the live sources (dry simulations: change the
                        recording, replay it; scripts/preserve_scenarios.py does this for 24 cutover actions)

It changes nothing anywhere. On the VPS the only write is a scratch folder under /tmp for the doctor's
write probe, removed at once. SQL goes with read_only true; the one read that needs the owner role (the
digest of the vault's cockpit_sync_secret, compared in memory with the digest the API gives for CRON_SECRET)
runs inside a read-only transaction and neither value is printed or saved. Secrets are read from files and
never printed: the management token from the file named by SUPABASE_MGMT_TOKEN_FILE (default
~/.config/mahara/sb_mgmt_token), the service key used to read the bucket from SUPABASE_SERVICE_KEY_FILE
(default ~/.config/mahara/sb_service_key). Standard library only, Python 3.9 or later.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Optional, Set, Tuple

ROOT = Path(__file__).resolve().parents[1]
SB_MANIFEST = ROOT / "docs" / "preserve" / "supabase-manifest.json"
VPS_MANIFEST = ROOT / "docs" / "preserve" / "vps-manifest.json"
API = "https://api.supabase.com/v1"
UA = "mahara-verify-preserved/1"
BUCKET = "sales-proposals"
BACKUP_DIR = "backups/2026-10-07-pre-migration"
BACKUP_PREFIX = BACKUP_DIR + "/"
# Added by the adversarial review of 2026-10-07, in both backups, with its own SHA256SUMS: the rows of
# cockpit_sales_followups and cockpit_sales_references, and a git bundle of the branch that carries the note.
SUPPLEMENT = "supplement/"
SITE = "https://cockpit.maharamedia.com/sales/"
VPS = "hermes@187.77.156.166"
VPS_KEY = "~/.ssh/faris-key"
OUR_FOLDERS = ("hermes/sales-desk", "hermes/cockpit-guardian")
FIXER_FILE = "/opt/data/bibi/workspace/reliability/fixer-projects.json"

# Ours, or what ours stands on: a change here is never "not part of the preserved work". The rooms and the
# proposal screens read the sales mirror's tables, so the mirror's function and job count as ours.
STRICT_EDGE = ("sales-api", "sales-live", "sales-mirror")
STRICT_CRON = ("mahara-sales-rooms-sweep", "mahara-sales-watchdog", "mahara-sales-mirror")
STRICT_VAULT = ("cockpit_sync_secret",)
STRICT_EXTENSIONS = ("pg_cron", "pg_net", "supabase_vault", "pgcrypto")
# Settings rows whose switches are compared one by one. The other rows are written by workers all day
# (counts, cursors, copies of a form), so only their presence is checked.
SWITCH_KEYS = ("rooms", "live", "followups", "whatsapp_guard", "messaging", "crm_writes", "contracts", "pipeline")
GUARDIAN_MAX_AGE_MIN = 10
TAG = "pre-supabase-migration-2026-10-07"

# The deployed source files of our Edge Functions on 2026-10-07 (sales-api v65, sales-live v2, sales-mirror v17),
# read back through the management API: each one byte for byte the file of that name at the restore tag. A deploy
# from a branch without live calls lacks rooms.ts, roomlogic.ts, liveio.ts, followupAgent.ts and sendrules.ts.
RECORDED_SOURCES = {
    "sales-api": ("clientforms.ts", "clients.ts", "contracts.ts", "dialer.ts", "followupAgent.ts", "hot.ts",
                  "index.ts", "lib.ts", "liveio.ts", "proposals.ts", "roomlogic.ts", "rooms.ts", "sendrules.ts"),
    "sales-live": ("cron.ts", "door.ts", "handler.ts", "index.ts", "sign.ts", "slack.ts", "util.ts", "zoom.ts"),
    "sales-mirror": ("index.ts", "lib.ts"),
}
# Status rows written on every run of a job that runs every few minutes, with how old each may get before
# the job has stopped (minutes): the rooms worker and its host check, the hourly doctor, the proposal queue,
# the follow-ups, and the two pg_cron jobs of live calls. Their ok flag is shown, not judged: the sweep's row
# has said "not taken (404)" since 2026-10-05, from before sales-live was deployed.
STATUS_ROWS = {
    ("sales-desk", "rooms"): 10, ("sales-desk", "room-hosts"): 25, ("sales-desk", "doctor"): 75,
    ("sales-desk", "requests"): 10, ("sales-desk", "followups"): 45,
    ("sales-api", "sweep"): 5, ("sales-api", "watchdog"): 15,
}
# Env keys that name a Supabase project on the VPS. The desk and the guardian use DESK_SUPABASE_URL.
PROJECT_KEYS = ("DESK_SUPABASE_URL", "GUARDIAN_SUPABASE_URL", "RADAR_SUPABASE_URL", "COCKPIT_SUPABASE_URL",
                "SUPABASE_URL")
BIG_TABLE = 200_000          # counted from pg_class.reltuples, and only a fall of more than a tenth counts
DEPENDENCY_DROP = 0.10       # a dependency table may lose this share of rows (the mirror and dial dedupe delete)
# Function secrets the platform sets itself; their update time moves without anyone setting them.
PLATFORM_SECRET = re.compile(r"^SUPABASE_")

ROOM_STRINGS = (
    "Still on the call?", "This room could not be read", "Under a minute left", "What keeps rooms working",
    "The video rooms setting", "Send a video link", "Demo now with a closer", "Intro now with me",
    "Live calls could not be read",
)
PROPOSAL_STRINGS = (
    "This lead's proposals", "The proposal writer", "Include the guarantee", "Taking longer than usual",
    "Drafting stopped. The last version is back.", "No proposals yet",
    "Built on the client's own figures from the call.", "The growth tree, introduction",
)

OK, CHANGED, MISSING, UNKNOWN = "ok", "CHANGED", "MISSING", "UNKNOWN"
NOT_OURS = "not part of the preserved work"

_SECRETISH = re.compile(
    r"(eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}|sb_secret_[A-Za-z0-9_-]+|sb_publishable_[A-Za-z0-9_-]+"
    r"|sk-[A-Za-z0-9_-]{12,}|xox[a-z]-[A-Za-z0-9-]+|ghp_[A-Za-z0-9]{20,}|Bearer\s+\S+|[A-Za-z0-9+_-]{40,})")


def scrub(text: Any, limit: int = 200) -> str:
    """Text that came from elsewhere (an HTTP error, a worker's own words): anything token-shaped hidden."""
    return _SECRETISH.sub("[hidden]", str(text)).replace("\n", " ")[:limit]


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def parse_utc(text: Any) -> Optional[float]:
    """Seconds since the epoch for an ISO or Postgres timestamp ('2026-10-07T01:12:34.068Z',
    '2026-10-07 14:42:00.515+03'); None when it cannot be read."""
    if not text:
        return None
    t = str(text).strip().replace(" ", "T", 1)
    if t.endswith("Z"):
        t = t[:-1] + "+00:00"
    m = re.match(r"^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(\.\d+)?([+-]\d\d(?::?\d\d)?)?$", t)
    if not m:
        return None
    frac = (m.group(2) or ".0")[1:7].ljust(6, "0")
    tz = m.group(3) or "+00:00"
    tz = tz + ":00" if len(tz) == 3 else tz if ":" in tz else tz[:3] + ":" + tz[3:]
    try:
        return datetime.fromisoformat(f"{m.group(1)}.{frac}{tz}").timestamp()
    except ValueError:
        return None


def plural(n: int, word: str, many: str = "") -> str:
    return f"{n} {word if n == 1 else many or word + 's'}"


class SourceError(Exception):
    pass


# ---- the tape: what every source answered, recorded or replayed -------------------------------------------

class Tape:
    """live: ask the sources. record: ask them and keep the answers (only what the checks judge: names,
    digests, counts, booleans; never a secret value or a row). replay: answer from a recording, so a cutover
    action can be simulated by changing the recording (scripts/preserve_scenarios.py)."""

    def __init__(self, mode: str = "live", path: Optional[Path] = None) -> None:
        self.mode, self.path = mode, path
        self.data: Dict[str, Any] = {}
        if mode == "replay":
            self.data = json.loads(Path(path).read_text(encoding="utf-8"))

    def take(self, key: str, fn: Callable[[], Any]) -> Any:
        if self.mode == "replay":
            if key not in self.data:
                raise SourceError(f"{key} is not in the recording")
            v = self.data[key]
            if isinstance(v, dict) and set(v) == {"__error__"}:
                raise SourceError(v["__error__"])
            return v
        try:
            v = fn()
        except SourceError as e:
            if self.mode == "record":
                self.data[key] = {"__error__": str(e)}
            raise
        if self.mode == "record":
            self.data[key] = v
        return v

    def save(self) -> None:
        if self.mode == "record" and self.path:
            Path(self.path).write_text(json.dumps(self.data, indent=0, sort_keys=True), encoding="utf-8")


TAPE = Tape()


# ---- the report ----------------------------------------------------------------------------------------

class Report:
    def __init__(self) -> None:
        self.rows: List[Dict[str, Any]] = []

    def add(self, area: str, name: str, status: str, detail: str, why: Optional[str] = None) -> None:
        """`why` is the explanation of a CHANGED line; None leaves it unexplained."""
        self.rows.append({"area": area, "check": name, "status": status, "detail": detail,
                          "explained": (why is not None) if status == CHANGED else None,
                          "why": why if status == CHANGED else None})

    def unknown_all(self, area: str, names: Iterable[str], reason: str) -> None:
        for n in names:
            self.add(area, n, UNKNOWN, reason)

    def counts(self) -> Dict[str, int]:
        c = {OK: 0, CHANGED: 0, MISSING: 0, UNKNOWN: 0, "changed_unexplained": 0}
        for r in self.rows:
            c[r["status"]] += 1
            if r["status"] == CHANGED and not r["explained"]:
                c["changed_unexplained"] += 1
        return c

    def verdict(self) -> Tuple[str, int, str]:
        c = self.counts()
        tail = (f"{len(self.rows)} checks: {c[OK]} ok, {c[CHANGED]} changed ({c['changed_unexplained']} not explained), "
                f"{c[MISSING]} missing, {c[UNKNOWN]} unknown")
        if c[MISSING] or c["changed_unexplained"]:
            return "FAIL", 1, tail
        if c[UNKNOWN]:
            return "INCOMPLETE", 2, tail
        return "PASS", 0, tail

    @staticmethod
    def line(r: Dict[str, Any]) -> str:
        out = f"{r['status']:<8} {r['area']}: {r['check']}: {r['detail']}"
        if r["status"] == CHANGED:
            out += f" (explained: {r['why']})" if r["explained"] else " (not explained)"
        return out


# ---- git and the migrations added after the inventory -------------------------------------------------

def git(*args: str, data: Optional[bytes] = None, timeout: int = 60) -> bytes:
    p = subprocess.run(["git", "-C", str(ROOT), *args], input=data, capture_output=True, timeout=timeout)
    if p.returncode != 0:
        raise SourceError(f"git {args[0]}: {scrub(p.stderr.decode('utf-8', 'replace'), 160)}")
    return p.stdout


class Later:
    """Migrations that were not in main at the inventory (or changed since), in this checkout or on the ref
    (origin/main, or the cutover branch with --ref): what can explain a database object that no longer
    matches the manifest. The ref counts only when it contains the restore point."""

    def __init__(self, baseline: str, recorded: Iterable[str], ref: Optional[str] = None) -> None:
        mig = ROOT / "supabase" / "migrations"
        on_disk = sorted(p for p in mig.glob("*.sql")) if mig.is_dir() else []
        self.files: Dict[str, str] = {}
        self.baseline = baseline
        self._base: Optional[Dict[str, str]] = None
        try:
            base = set(git("ls-tree", "-r", "--name-only", baseline, "--", "supabase/migrations/").decode().split("\n"))
            changed = set(git("diff", "--name-only", baseline, "--", "supabase/migrations/").decode().split("\n"))
            picked = [p for p in on_disk if str(p.relative_to(ROOT)) not in base or str(p.relative_to(ROOT)) in changed]
            self.how = f"added or changed after {baseline[:7]}"
        except (SourceError, OSError, subprocess.SubprocessError):
            newest = max(recorded) if recorded else ""
            picked = [p for p in on_disk if p.stem > newest]
            self.how = f"named after {newest} (git could not say)"
        for p in picked:
            try:
                self.files[str(p.relative_to(ROOT))] = p.read_text(encoding="utf-8", errors="replace").lower()
            except OSError:
                pass
        if ref:
            try:
                names = git("diff", "--name-only", "--diff-filter=AM", baseline, ref, "--", "supabase/migrations/")
                for path in names.decode().split("\n"):
                    if path.endswith(".sql") and "/tests/" not in path and path not in self.files:
                        self.files[path] = git("show", f"{ref}:{path}").decode("utf-8", "replace").lower()
                self.how += f", and on {ref}"
            except (SourceError, OSError, subprocess.SubprocessError):
                pass

    def find(self, pattern: str) -> List[str]:
        rx = re.compile(pattern, re.I)
        return [f for f, text in self.files.items() if rx.search(text)]

    def function(self, name: str) -> List[str]:
        return self.find(rf"\bfunction\s+(?:public\.)?\"?{re.escape(name)}\"?\s*\(")

    @staticmethod
    def bodies(text: str, name: str) -> List[str]:
        """The bodies of every `create or replace function name(...)` in a migration, whitespace folded."""
        rx = re.compile(rf"create\s+or\s+replace\s+function\s+(?:public\.)?\"?{re.escape(name)}\"?\s*\(.*?"
                        r"\bas\s+(\$[a-z0-9_]*\$)(.*?)\1", re.I | re.S)
        return [" ".join(m.group(2).lower().split()) for m in rx.finditer(text)]

    def older_copy(self, name: str, files: List[str]) -> Optional[str]:
        """A later migration that puts back a definition the baseline's migrations had already replaced (an
        old file copied into a new one): it explains the change and is the regression itself."""
        if self._base is None:
            self._base = {}
            try:
                listed = git("ls-tree", "-r", "--name-only", self.baseline, "--", "supabase/migrations/").decode()
                for path in sorted(l for l in listed.split("\n") if l.endswith(".sql") and "/tests/" not in l):
                    self._base[path] = git("show", f"{self.baseline}:{path}").decode("utf-8", "replace")
            except (SourceError, OSError, subprocess.SubprocessError):
                return None
        seq = [(path, b) for path, text in sorted(self._base.items()) for b in self.bodies(text, name)]
        if len(seq) < 2:
            return None
        current, older = seq[-1][1], {b: path for path, b in seq[:-1]}
        for f in files:
            mine = self.bodies(self.files.get(f, ""), name)
            if mine and mine[-1] != current and mine[-1] in older:
                return (f"{Path(f).name} puts back the older definition from {Path(older[mine[-1]]).name}, "
                        f"which {Path(seq[-1][0]).name} had replaced")
        return None

    def relation(self, name: str) -> List[str]:
        return self.find(r"\b(?:alter\s+table|create\s+(?:unlogged\s+)?table|create\s+(?:or\s+replace\s+)?view|"
                         r"drop\s+(?:table|view)|add\s+table|on(?:\s+table)?)\s+(?:if\s+(?:not\s+)?exists\s+)?"
                         rf"(?:only\s+)?(?:public\.)?\"?{re.escape(name)}\"?(?![a-z0-9_])")

    def trigger(self, name: str) -> List[str]:
        return self.find(rf"\btrigger\s+\"?{re.escape(name)}\"?(?![a-z0-9_])")

    def cron(self, job: str) -> List[str]:
        return self.find(rf"'{re.escape(job)}'")

    def setting(self, key: str, updated_by: str) -> List[str]:
        m = re.match(r"migration\s+(\S+)", updated_by or "", re.I)
        hits = [f for f in self.files if m and Path(f).name.lower().startswith(m.group(1).lower())]
        hits += [f for f in self.find(rf"'{re.escape(key)}'") if "cockpit_sales_settings" in self.files[f] and f not in hits]
        return hits


def explained_by(files: List[str]) -> Optional[str]:
    if not files:
        return None
    names = ", ".join(Path(f).name for f in files[:3]) + (f" and {len(files) - 3} more" if len(files) > 3 else "")
    return f"redefined by a later migration in the repo: {names}"


# ---- the Supabase management API ------------------------------------------------------------------------

def lit(s: str) -> str:
    return "'" + str(s).replace("'", "''") + "'"


def arr(names: Iterable[str]) -> str:
    return "array[" + ",".join(lit(n) for n in names) + "]::text[]"


# The owner role reads the vault; the transaction is read-only, so nothing can be written. Only a digest
# comes back, and it is compared in memory with the one the API gives for CRON_SECRET, then dropped.
Q_VAULT_DIGEST = ("set transaction read only; select encode(sha256(convert_to(decrypted_secret, 'utf8')), 'hex') "
                  "as d from vault.decrypted_secrets where name = 'cockpit_sync_secret'")


def parse_multipart(ctype: str, raw: bytes) -> Dict[str, bytes]:
    m = re.search(r'boundary="?([^";]+)"?', ctype or "")
    if not m:
        raise SourceError("the function body did not come back as multipart")
    out: Dict[str, bytes] = {}
    for part in raw.split(b"--" + m.group(1).encode())[1:]:
        if part.startswith(b"--"):
            break
        head, _, body = part.lstrip(b"\r\n").partition(b"\r\n\r\n")
        if body.endswith(b"\r\n"):
            body = body[:-2]
        fn = re.search(rb'filename="([^"]+)"', head)
        if fn:
            name = fn.group(1).decode("utf-8", "replace")
            out[name[len("source/"):] if name.startswith("source/") else name] = body
    return out


class Mgmt:
    def __init__(self, ref: str, token_file: Optional[Path]) -> None:
        self.ref = ref
        self._token = ""
        if TAPE.mode == "replay":
            return
        self._token = token_file.read_text(encoding="utf-8").strip()  # never printed
        if not self._token:
            raise SourceError(f"{token_file} is empty")

    def _request(self, method: str, path: str, body: Any = None, accept: Optional[str] = None,
                 timeout: int = 120) -> Tuple[Dict[str, str], bytes]:
        data = json.dumps(body).encode() if body is not None else None
        last = ""
        for attempt in range(2):
            headers = {"Authorization": "Bearer " + self._token, "Content-Type": "application/json", "User-Agent": UA}
            if accept:
                headers["Accept"] = accept
            req = urllib.request.Request(f"{API}/projects/{self.ref}{path}", data=data, method=method, headers=headers)
            try:
                with urllib.request.urlopen(req, timeout=timeout) as r:
                    return dict(r.headers), r.read()
            except urllib.error.HTTPError as e:
                last = f"HTTP {e.code}: {scrub(e.read().decode('utf-8', 'replace'), 160)}"
                if e.code < 500 and e.code != 429:
                    break
            except (urllib.error.URLError, OSError) as e:
                last = scrub(e, 160)
            time.sleep(2)
        raise SourceError(f"{method} {path.split('?')[0]}: {last}")

    def call(self, method: str, path: str, body: Any = None, timeout: int = 120) -> Any:
        _, raw = self._request(method, path, body, timeout=timeout)
        try:
            return json.loads(raw or b"null")
        except ValueError:
            raise SourceError(f"{method} {path.split('?')[0]}: the answer was not JSON")

    def sql(self, query: str, label: str) -> List[Dict[str, Any]]:
        def run() -> List[Dict[str, Any]]:
            out = self.call("POST", "/database/query", {"query": query, "read_only": True})
            if not isinstance(out, list):
                raise SourceError(f"the SQL endpoint answered {type(out).__name__}, not rows")
            return out
        return TAPE.take("sql " + label, run)

    def functions(self) -> List[Dict[str, Any]]:
        def run() -> List[Dict[str, Any]]:
            listed = self.call("GET", "/functions")
            if not isinstance(listed, list):
                raise SourceError("the functions list did not come back as a list")
            keep = ("slug", "status", "version", "verify_jwt", "ezbr_sha256", "updated_at")
            return [{k: f.get(k) for k in keep} for f in listed if isinstance(f, dict)]
        return TAPE.take("api functions", run)

    def secrets(self) -> List[Dict[str, Any]]:
        """Names and update times; the API's digests are dropped here."""
        def run() -> List[Dict[str, Any]]:
            listed = self.call("GET", "/secrets")
            if not isinstance(listed, list):
                raise SourceError("the secrets list did not come back as a list")
            return [{"name": s.get("name"), "updated_at": s.get("updated_at")} for s in listed if isinstance(s, dict)]
        return TAPE.take("api secrets", run)

    def cron_secret_pair(self) -> Dict[str, Any]:
        """Whether CRON_SECRET holds the vault's cockpit_sync_secret: two digests compared here, neither kept."""
        def run() -> Dict[str, Any]:
            listed = self.call("GET", "/secrets")
            digest = next((s.get("value") for s in listed or [] if isinstance(s, dict) and s.get("name") == "CRON_SECRET"),
                          None)
            listed = None
            rows = self.call("POST", "/database/query", {"query": Q_VAULT_DIGEST})
            vault = rows[0].get("d") if isinstance(rows, list) and rows else None
            rows = None
            out = {"function_secret": bool(digest), "vault_secret": bool(vault),
                   "same": hmac.compare_digest(str(digest), str(vault)) if digest and vault else None}
            digest = vault = None
            return out
        return TAPE.take("pair cron_secret", run)

    def function_files(self, slug: str) -> Dict[str, Any]:
        """sha256 of each deployed source file of an Edge Function (its body read back as multipart)."""
        def run() -> Dict[str, Any]:
            headers, raw = self._request("GET", f"/functions/{urllib.parse.quote(slug)}/body",
                                         accept="multipart/form-data", timeout=180)
            ctype = next((v for k, v in headers.items() if k.lower() == "content-type"), "")
            files = parse_multipart(ctype, raw)
            return {"files": {n: sha256(b) for n, b in sorted(files.items())}, "bytes": len(raw)}
        return TAPE.take("fnsrc " + slug, run)


Q_RELATIONS = """
with r(name) as (select unnest({names})),
c as (
  select r.name, cl.oid, cl.relkind::text as relkind, cl.relrowsecurity as rls, cl.relacl
  from r left join pg_class cl on cl.relname = r.name and cl.relnamespace = 'public'::regnamespace
)
select c.name, c.relkind, c.rls,
  (select coalesce(json_agg(json_build_object('name', a.attname, 'type', format_type(a.atttypid, a.atttypmod))
                            order by a.attnum), '[]'::json)
     from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped) as columns,
  (select coalesce(json_object_agg(g.grantee, g.privs), '{{}}'::json) from (
     select case when x.grantee = 0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end as grantee,
            json_agg(distinct x.privilege_type) as privs
     from aclexplode(c.relacl) x group by 1) g) as grants,
  (select coalesce(json_agg(json_build_object('name', t.tgname, 'function', p.proname, 'enabled', t.tgenabled::text,
                                              'md5', md5(pg_get_triggerdef(t.oid)))), '[]'::json)
     from pg_trigger t join pg_proc p on p.oid = t.tgfoid where t.tgrelid = c.oid and not t.tgisinternal) as triggers,
  (select coalesce(json_agg(json_build_object('name', po.policyname, 'cmd', po.cmd, 'roles', po.roles,
                                              'qual_md5', md5(coalesce(po.qual, '')),
                                              'with_check_md5', md5(coalesce(po.with_check, '')))), '[]'::json)
     from pg_policies po where po.schemaname = 'public' and po.tablename = c.name) as policies,
  (select coalesce(json_agg(json_build_object('name', i.indexname, 'md5', md5(i.indexdef))), '[]'::json)
     from pg_indexes i where i.schemaname = 'public' and i.tablename = c.name) as indexes,
  (select coalesce(json_agg(json_build_object('name', k.conname, 'md5', md5(pg_get_constraintdef(k.oid)))), '[]'::json)
     from pg_constraint k where k.conrelid = c.oid) as constraints,
  case when c.relkind = 'v' then md5(pg_get_viewdef(c.oid)) end as view_md5,
  (select coalesce(json_agg(pt.pubname), '[]'::json)
     from pg_publication_tables pt where pt.schemaname = 'public' and pt.tablename = c.name) as publications
from c
"""

Q_FUNCTIONS = """
select p.proname as name, pg_get_function_identity_arguments(p.oid) as args, md5(pg_get_functiondef(p.oid)) as md5,
  md5(lower(btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g')))) as body_md5,
  (select coalesce(json_object_agg(g.grantee, g.privs), '{{}}'::json) from (
     select case when x.grantee = 0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end as grantee,
            json_agg(distinct x.privilege_type) as privs
     from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x group by 1) g) as grants
from pg_proc p
where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p') and p.proname = any({names})
"""

Q_CRON = "select jobname, schedule, active, md5(command) as command_md5 from cron.job"

# Only booleans leave the database: the switches, flattened the way the manifest wrote them
# (a.b for objects, a[0] for arrays). No string value is read.
Q_SWITCHES = """
with recursive t(key, path, v) as (
  select s.key, ''::text, s.value from public.cockpit_sales_settings s where s.key = any({keys})
  union all
  select t.key,
         case when e.isarr then t.path || '[' || e.k || ']' when t.path = '' then e.k else t.path || '.' || e.k end,
         e.v
  from t cross join lateral (
    select j.k, j.v, false as isarr
      from jsonb_each(case when jsonb_typeof(t.v) = 'object' then t.v else '{{}}'::jsonb end) as j(k, v)
    union all
    select (a.i - 1)::text, a.v, true
      from jsonb_array_elements(case when jsonb_typeof(t.v) = 'array' then t.v else '[]'::jsonb end)
           with ordinality as a(v, i)
  ) e
)
select key, path, (v = 'true'::jsonb) as is_on from t where jsonb_typeof(v) = 'boolean'
"""

Q_SETTINGS_ROWS = "select key, updated_by, updated_at::text as updated_at from public.cockpit_sales_settings"
Q_TEMPLATES = "select key, active from public.cockpit_sales_wa_templates"
Q_VAULT = "select name from vault.secrets"
Q_EXTENSIONS = "select extname from pg_extension"
Q_BUCKET = f"select id, public from storage.buckets where id = {lit(BUCKET)}"
Q_OBJECTS = (f"select name, (metadata->>'size')::bigint as size from storage.objects "
             f"where bucket_id = {lit(BUCKET)} and name like {lit(BACKUP_PREFIX + '%')}")


def q_counts(recs: Iterable[Dict[str, Any]]) -> str:
    """Row counts of the recorded tables (views left out), in one statement: a table that is gone gives
    null instead of an error. Tables recorded with more than BIG_TABLE rows are read from reltuples."""
    vals = ",".join(f"({lit(r['name'])}, {'true' if int(r.get('row_count') or 0) > BIG_TABLE else 'false'})"
                    for r in recs if r.get("kind", "table") == "table")
    return f"""
with r(name, big) as (values {vals})
select r.name,
  case when c.oid is null then null
       when r.big then greatest(c.reltuples, 0)::bigint
       else (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from %s', c.oid::regclass),
                                                 false, true, '')))[1]::text::bigint end as n
from r left join pg_class c on c.relname = r.name and c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
"""


def q_settings_age(recs: Iterable[Dict[str, Any]]) -> str:
    """Per recorded settings row: is it older than the copy recorded at the inventory (put back from an
    older copy, or the database restored to an earlier point)?"""
    vals = ",".join(f"({lit(s['key'])}, {lit(s['updated_at'])})" for s in recs if s.get("updated_at"))
    return (f"select s.key, (s.updated_at < r.rec::timestamptz) as older, s.updated_at::text as at "
            f"from public.cockpit_sales_settings s join (values {vals}) as r(key, rec) on r.key = s.key")


Q_STATUS = ("select worker, job, ok, round(extract(epoch from now() - at) / 60)::int as age_min "
            "from public.cockpit_sales_worker_status where (worker, job) in ("
            + ",".join(f"({lit(w)}, {lit(j)})" for w, j in STATUS_ROWS) + ")")


KIND = {"r": "table", "p": "table", "v": "view", "m": "materialized view", "f": "foreign table"}


def by(rows: Iterable[Dict[str, Any]], key: str = "name") -> Dict[str, Dict[str, Any]]:
    return {r[key]: r for r in rows}


def grants_norm(g: Optional[Dict[str, Any]]) -> Dict[str, Tuple[str, ...]]:
    return {k: tuple(sorted(v)) for k, v in (g or {}).items()}


def grant_diff(rec: Dict[str, Any], live: Dict[str, Any]) -> List[str]:
    a, b = grants_norm(rec), grants_norm(live)
    out = []
    for role in sorted(set(a) | set(b)):
        if a.get(role) != b.get(role):
            gone = sorted(set(a.get(role, ())) - set(b.get(role, ())))
            new = sorted(set(b.get(role, ())) - set(a.get(role, ())))
            out.append(f"{role}" + (f" lost {','.join(gone)}" if gone else "") + (f" gained {','.join(new)}" if new else ""))
    return out


def count_problem(rec: Dict[str, Any], n_live: Optional[int]) -> Optional[str]:
    """A table with fewer rows than at the inventory: ours (made or changed by the preserved migrations) may
    lose none; a table they read may lose a tenth (the mirror and the dial dedupe delete rows)."""
    n_rec = rec.get("row_count")
    if n_live is None or n_rec is None or rec.get("kind", "table") != "table":
        return None
    n_rec = int(n_rec)
    if rec.get("role") in ("created", "altered"):
        if n_live < n_rec:
            return (f"{n_live:,} rows, fewer than the {n_rec:,} at the inventory (a reload or a restore to an "
                    "earlier point; the private backups hold the rows of 2026-10-07)")
    elif n_rec and n_live < n_rec * (1 - DEPENDENCY_DROP):
        return (f"{n_live:,} rows, more than a tenth fewer than the {n_rec:,} at the inventory (a reload or a "
                "restore to an earlier point)")
    return None


def check_relations(rep: Report, mg: Mgmt, man: Dict[str, Any], later: Later) -> None:
    recs = man["relations"]
    live = by(mg.sql(Q_RELATIONS.format(names=arr(r["name"] for r in recs)), "relations"))
    counts: Optional[Dict[str, Optional[int]]] = None
    try:
        counts = {r["name"]: (None if r.get("n") is None else int(r["n"]))
                  for r in mg.sql(q_counts(recs), "row_counts")}
    except SourceError as e:
        rep.add("supabase", "row counts", UNKNOWN, f"could not be read: {e}")
    for rec in recs:
        name, cur = rec["name"], live.get(rec["name"])
        label = f"{rec.get('kind', 'table')} {name} ({rec.get('role')})"
        if not cur or not cur.get("relkind"):
            rep.add("supabase", label, MISSING, "not in the public schema")
            continue
        strict, diffs = [], []
        kind = KIND.get(cur["relkind"], cur["relkind"])
        if kind != rec.get("kind"):
            diffs.append(f"is a {kind} now")
        if rec.get("rls") and not cur.get("rls"):
            strict.append("row security is off")
        grants = grants_norm(cur.get("grants"))
        if rec.get("role") == "created":
            opened = [g for g in ("anon", "PUBLIC") if g in grants and g not in grants_norm(rec.get("grants"))]
            if opened:
                strict.append(f"granted to {', '.join(opened)}")
        cols = {c["name"]: c["type"] for c in cur.get("columns") or []}
        gone = [c["name"] for c in rec.get("columns") or [] if c["name"] not in cols]
        retyped = [f"{c['name']} is {cols[c['name']]}" for c in rec.get("columns") or []
                   if c["name"] in cols and cols[c["name"]] != c["type"]]
        if gone:
            diffs.append("columns gone: " + ", ".join(gone))
        if retyped:
            diffs.append("columns retyped: " + ", ".join(retyped))
        trig_live = by(cur.get("triggers") or [])
        trig_explain: List[str] = []
        for t in rec.get("triggers") or []:
            lt = trig_live.get(t["name"])
            if not lt:
                diffs.append(f"trigger {t['name']} gone")
            elif lt["md5"] != t["def_md5"] or lt["enabled"] != t["enabled"]:
                diffs.append(f"trigger {t['name']} " + ("disabled" if lt["enabled"] == "D" else "redefined"))
            else:
                continue
            trig_explain += later.trigger(t["name"])
        new_trig = sorted(set(trig_live) - {t["name"] for t in rec.get("triggers") or []})
        if new_trig:
            diffs.append("new triggers: " + ", ".join(new_trig))
        pol_live = by(cur.get("policies") or [])
        for p in rec.get("policies") or []:
            lp = pol_live.get(p["policyname"])
            if not lp:
                diffs.append(f"policy {p['policyname']} gone")
            elif (lp["qual_md5"], lp["with_check_md5"], lp["cmd"], sorted(lp["roles"] or [])) != \
                    (p["qual_md5"], p["with_check_md5"], p["cmd"], sorted(p["roles"] or [])):
                diffs.append(f"policy {p['policyname']} redefined")
        new_pol = sorted(set(pol_live) - {p["policyname"] for p in rec.get("policies") or []})
        if new_pol:
            diffs.append("new policies: " + ", ".join(new_pol))
        idx_live = {i["name"]: i["md5"] for i in cur.get("indexes") or []}
        for i in rec.get("indexes") or []:
            if i["name"] not in idx_live:
                diffs.append(f"index {i['name']} gone")
            elif idx_live[i["name"]] != i["def_md5"]:
                diffs.append(f"index {i['name']} redefined")
        con_live = {k["name"]: k["md5"] for k in cur.get("constraints") or []}
        for k in rec.get("constraints") or []:
            if k["name"] not in con_live:
                diffs.append(f"constraint {k['name']} gone")
            elif con_live[k["name"]] != k["def_md5"]:
                diffs.append(f"constraint {k['name']} redefined")
        # Constraints were recorded for the tables our migrations made or changed, not for the ones they read.
        new_con = sorted(set(con_live) - {k["name"] for k in rec["constraints"]}) if "constraints" in rec else []
        if new_con:
            diffs.append("new constraints: " + ", ".join(new_con))
        if rec.get("view_def_md5") and cur.get("view_md5") != rec["view_def_md5"]:
            diffs.append("view redefined")
        gd = grant_diff(rec.get("grants") or {}, cur.get("grants") or {})
        if gd:
            diffs.append("grants: " + "; ".join(gd))
        pubs = sorted(cur.get("publications") or [])
        if pubs != sorted(rec.get("realtime_publications") or []):
            diffs.append(f"publications now {pubs or 'none'}")
        n_live = (counts or {}).get(name)
        lost = count_problem(rec, n_live)
        if lost:
            strict.append(lost)
        ncols = len(cols)
        rows = ""
        if n_live is not None:
            rows = (f", about {n_live:,} rows" if int(rec.get("row_count") or 0) > BIG_TABLE else f", {n_live:,} rows")
            rows += f" (recorded {int(rec['row_count']):,})" if rec.get("row_count") is not None else ""
        summary = (f"present, {plural(ncols, 'column')}" + (", row security on" if cur.get("rls") else "")
                   + (f", {plural(len(trig_live), 'trigger')}" if trig_live else "") + rows)
        if strict:
            rep.add("supabase", label, CHANGED, "; ".join(strict + diffs))
        elif diffs:
            why = explained_by(sorted(set(later.relation(name) + trig_explain)))
            rep.add("supabase", label, CHANGED, "; ".join(diffs), why)
        else:
            rep.add("supabase", label, OK, summary)


def check_functions(rep: Report, mg: Mgmt, man: Dict[str, Any], later: Later) -> None:
    recs: Dict[Tuple[str, str], Dict[str, Any]] = {}
    for group in ("created", "dependencies", "other_sales_and_guardian"):
        for f in man["functions"].get(group) or []:
            recs.setdefault((f["name"], f.get("args", "")), dict(f, group=group))
    rows = mg.sql(Q_FUNCTIONS.format(names=arr(sorted({n for n, _ in recs}))), "functions")
    live = {(r["name"], r["args"]): r for r in rows}
    names_live: Dict[str, List[str]] = {}
    for r in rows:
        names_live.setdefault(r["name"], []).append(r["args"])
    for (name, args), rec in sorted(recs.items()):
        label = f"function {name}({args})"
        cur = live.get((name, args))
        if not cur:
            others = names_live.get(name)
            if others:
                rep.add("supabase", label, CHANGED, f"only {name}({'), ('.join(others)}) is there now",
                        explained_by(later.function(name)))
            else:
                rep.add("supabase", label, MISSING, "not in the public schema")
            continue
        diffs = []
        if cur["md5"] != rec["def_md5"]:
            diffs.append("definition differs from the manifest")
        if "grants" in rec:
            gd = grant_diff(rec["grants"], cur.get("grants") or {})
            if gd:
                diffs.append("grants: " + "; ".join(gd))
        if not diffs:
            rep.add("supabase", label, OK, f"definition md5 {cur['md5'][:12]} as recorded")
            continue
        opened = [g for g in ("anon", "PUBLIC") if g in (cur.get("grants") or {}) and g not in (rec.get("grants") or {})]
        files = later.function(name)
        regress = later.older_copy(name, files) if files else None
        # A later migration explains the change only if the live body is the one it writes (whitespace and
        # case folded); a migration that merely mentions the function explains nothing.
        live_body = cur.get("body_md5")
        mine = [f for f in files if any(hashlib.md5(b.encode("utf-8")).hexdigest() == live_body
                                        for b in later.bodies(later.files.get(f, ""), name))] if live_body else files
        if opened and rec.get("group") == "created":
            rep.add("supabase", label, CHANGED, "; ".join(diffs) + f"; now executable by {', '.join(opened)}")
        elif regress:
            rep.add("supabase", label, CHANGED, "; ".join(diffs) + f"; {regress}")
        elif files and not mine:
            who = ", ".join(Path(f).name for f in files[:3])
            rep.add("supabase", label, CHANGED, "; ".join(diffs) + f"; {who} " + ("defines" if len(files) == 1 else "define")
                    + " it, but the live body is not " + ("its" if len(files) == 1 else "any of theirs")
                    + " (changed by hand, or by SQL that is not in the repo)")
        else:
            why = explained_by(mine)
            if why and live_body:
                why += "; the live body is that file's"
            rep.add("supabase", label, CHANGED, "; ".join(diffs), why)


def check_cron(rep: Report, mg: Mgmt, man: Dict[str, Any], later: Later) -> None:
    live = by(mg.sql(Q_CRON, "cron"), "jobname")
    ours = {j["jobname"]: j for j in man["pg_cron"]["ours"]}
    recs = {j["jobname"]: j for j in man["pg_cron"]["all_jobs"]}
    recs.update({k: dict(recs.get(k, {}), **v) for k, v in ours.items()})
    for name in sorted(recs, key=lambda n: (n not in STRICT_CRON, n)):
        rec, cur = recs[name], live.get(name)
        strict = name in STRICT_CRON
        label = f"pg_cron {name}" + (" (ours)" if name in ours else " (dependency)" if strict else "")
        if not cur:
            if strict:
                rep.add("supabase", label, MISSING, "the job is gone from cron.job")
            else:
                rep.add("supabase", label, CHANGED, "the job is gone from cron.job", NOT_OURS)
            continue
        diffs = []
        if cur["schedule"] != rec["schedule"]:
            diffs.append(f"schedule {cur['schedule']} (was {rec['schedule']})")
        if bool(cur["active"]) != bool(rec["active"]):
            diffs.append("inactive" if not cur["active"] else "active again")
        if cur["command_md5"] != rec["command_md5"]:
            diffs.append("command differs")
        if not diffs:
            rep.add("supabase", label, OK, f"{rec['schedule']}, active, command as recorded")
        elif strict:
            rep.add("supabase", label, CHANGED, "; ".join(diffs), explained_by(later.cron(name)))
        else:
            rep.add("supabase", label, CHANGED, "; ".join(diffs), NOT_OURS)


def check_settings(rep: Report, mg: Mgmt, man: Dict[str, Any], later: Later) -> None:
    recs = {s["key"]: s for s in man["cockpit_sales_settings"]}
    rows = by(mg.sql(Q_SETTINGS_ROWS, "settings_rows"), "key")
    keys = [k for k in SWITCH_KEYS if k in recs]
    live_sw: Dict[str, Dict[str, bool]] = {}
    for r in mg.sql(Q_SWITCHES.format(keys=arr(keys)), "switches"):
        live_sw.setdefault(r["key"], {})[r["path"]] = bool(r["is_on"])
    older: Dict[str, str] = {}
    try:
        older = {r["key"]: r["at"] for r in mg.sql(q_settings_age(recs.values()), "settings_age") if r.get("older")}
    except SourceError as e:
        rep.add("supabase", "settings rows' age", UNKNOWN, f"could not be read: {e}")
    for key in sorted(recs, key=lambda k: (k not in SWITCH_KEYS, k)):
        rec, cur = recs[key], rows.get(key)
        label = f"settings {key}"
        if not cur:
            rep.add("supabase", label, MISSING, "the row is gone from cockpit_sales_settings")
            continue
        back = (f"last written {older[key]}, before the copy recorded at the inventory ({rec.get('updated_at')}): "
                "it was put back from an older copy" if key in older else None)
        if key not in SWITCH_KEYS:
            if back:
                rep.add("supabase", label, CHANGED, back + " (values are not compared; the private backups hold the row)")
            else:
                rep.add("supabase", label, OK, f"present (written by {cur.get('updated_by') or 'unknown'}; values not compared)")
            continue
        want, have = rec.get("switches") or {}, live_sw.get(key, {})
        flipped = [f"{p} {'on' if have[p] else 'off'}" for p in sorted(want) if p in have and have[p] != want[p]]
        gone = [p for p in sorted(want) if p not in have]
        new_on = [p for p in sorted(set(have) - set(want)) if have[p]]
        if back:
            parts = [back] + (["switched: " + ", ".join(flipped)] if flipped else []) + \
                    (["switches gone: " + ", ".join(gone)] if gone else [])
            rep.add("supabase", label, CHANGED, "; ".join(parts))
            continue
        if not (flipped or gone or new_on):
            on = [p for p in sorted(have) if have[p]]
            rep.add("supabase", label, OK, f"{plural(len(want), 'switch', 'switches')} as recorded"
                    + (f" (on: {', '.join(on)})" if on and len(on) <= 8 else f" ({len(on)} on)" if on else ", all off"))
            continue
        parts = []
        if flipped:
            parts.append("switched: " + ", ".join(flipped))
        if gone:
            parts.append("switches gone: " + ", ".join(gone))
        if new_on:
            parts.append("new switches on: " + ", ".join(new_on))
        rep.add("supabase", label, CHANGED, "; ".join(parts) + f" (last written by {cur.get('updated_by') or 'unknown'})",
                explained_by(later.setting(key, cur.get("updated_by") or "")))


def check_templates(rep: Report, mg: Mgmt, man: Dict[str, Any]) -> None:
    recs = man["cockpit_sales_wa_templates"]["rows"]
    live = by(mg.sql(Q_TEMPLATES, "templates"), "key")
    gone = [r["key"] for r in recs if r["key"] not in live]
    flipped = [f"{r['key']} {'active' if live[r['key']]['active'] else 'inactive'}" for r in recs
               if r["key"] in live and bool(live[r["key"]]["active"]) != bool(r["active"])]
    label = "WhatsApp template rows (rooms, openers)"
    if gone:
        rep.add("supabase", label, MISSING, "gone: " + ", ".join(gone))
    elif flipped:
        rep.add("supabase", label, CHANGED, "; ".join(flipped))
    else:
        rep.add("supabase", label, OK, f"all {len(recs)} present, active flags as recorded")


def check_vault(rep: Report, mg: Mgmt, man: Dict[str, Any]) -> None:
    names = {r["name"] for r in mg.sql(Q_VAULT, "vault")}
    for rec in man["vault_secret_names"]:
        n = rec["name"]
        if n in names:
            rep.add("supabase", f"vault secret {n}", OK, "present (name only)")
        elif n in STRICT_VAULT:
            rep.add("supabase", f"vault secret {n}", MISSING, "gone from vault.secrets")
        else:
            rep.add("supabase", f"vault secret {n}", CHANGED, "gone from vault.secrets", NOT_OURS)


def check_extensions(rep: Report, mg: Mgmt, man: Dict[str, Any]) -> None:
    names = {r["extname"] for r in mg.sql(Q_EXTENSIONS, "extensions")}
    want = [e["extname"] for e in man.get("extensions") or []]
    gone_strict = [n for n in want if n not in names and n in STRICT_EXTENSIONS]
    gone_other = [n for n in want if n not in names and n not in STRICT_EXTENSIONS]
    if gone_strict:
        rep.add("supabase", "extensions", MISSING, "gone: " + ", ".join(gone_strict))
    elif gone_other:
        rep.add("supabase", "extensions", CHANGED, "gone: " + ", ".join(gone_other), NOT_OURS)
    else:
        rep.add("supabase", "extensions", OK, f"all {len(want)} recorded extensions present")


def check_edge(rep: Report, mg: Mgmt, man: Dict[str, Any]) -> None:
    live = by(mg.functions(), "slug")
    for rec in sorted(man["edge_functions"], key=lambda f: (f["slug"] not in STRICT_EDGE, f["slug"])):
        slug, cur = rec["slug"], live.get(rec["slug"])
        strict = slug in STRICT_EDGE
        label = f"Edge Function {slug}" + (" (ours)" if rec.get("ours") else " (dependency)" if strict else "")
        if not cur:
            if strict:
                rep.add("supabase", label, MISSING, "not in the functions list")
            else:
                rep.add("supabase", label, CHANGED, "not in the functions list", NOT_OURS)
            continue
        problems, notes = [], []
        if cur.get("status") != "ACTIVE":
            problems.append(f"status {cur.get('status')}")
        if bool(cur.get("verify_jwt")) != bool(rec["verify_jwt"]):
            problems.append(f"verify_jwt {cur.get('verify_jwt')} (recorded {rec['verify_jwt']})")
        if int(cur.get("version") or 0) < int(rec["version"]):
            problems.append(f"version {cur.get('version')} is lower than the recorded {rec['version']}")
        elif int(cur.get("version") or 0) > int(rec["version"]):
            notes.append(f"redeployed: v{cur.get('version')} (recorded v{rec['version']})")
        elif cur.get("ezbr_sha256") and rec.get("ezbr_sha256") and cur["ezbr_sha256"] != rec["ezbr_sha256"]:
            problems.append("same version but the code hash differs")
        head = f"ACTIVE v{cur.get('version')}, verify_jwt {cur.get('verify_jwt')}"
        if problems:
            rep.add("supabase", label, CHANGED, "; ".join(problems), None if strict else NOT_OURS)
        elif notes:
            rep.add("supabase", label, CHANGED, head + "; " + "; ".join(notes),
                    "a higher version is a redeploy; verify_jwt is as recorded"
                    + ("; its source files are judged on their own line" if slug in RECORDED_SOURCES else ""))
        else:
            rep.add("supabase", label, OK, head + " as recorded")


def function_env_names() -> Set[str]:
    """Secret names read by sales-api and sales-live (their source, tests left out)."""
    names: Set[str] = set()
    rx = re.compile(r"""(?:Deno\.env\.get|\benv)\(\s*["']([A-Z][A-Z0-9_]+)["']""")
    for fn in ("sales-api", "sales-live"):
        d = ROOT / "supabase" / "functions" / fn
        for p in d.glob("*.ts") if d.is_dir() else []:
            if not p.name.endswith(".test.ts"):
                names |= set(rx.findall(p.read_text(encoding="utf-8", errors="replace")))
    return names


def check_function_sources(rep: Report, mg: Mgmt, man: Dict[str, Any], ref: str, ref_ok: bool) -> None:
    """The deployed source of each of our functions against the files at the restore point: a deploy from a
    branch without live calls lacks their modules or carries older files, whatever its version number says."""
    base = man["source"]["main_sha"]
    for slug, want in RECORDED_SOURCES.items():
        label = f"Edge Function {slug} source"
        try:
            live = mg.function_files(slug)["files"]
            at_base = git_files(base, [f"supabase/functions/{slug}"], flat=True)
            at_ref = git_files(ref, [f"supabase/functions/{slug}"], flat=True) if ref_ok else {}
        except (SourceError, OSError, subprocess.SubprocessError, KeyError, TypeError) as e:
            rep.add("supabase", label, UNKNOWN, f"could not be read: {scrub(e, 160)}")
            continue
        gone = [n for n in want if n not in live]
        same_base = [n for n in live if at_base.get(n) == live[n]]
        same_ref = [n for n in live if n not in same_base and at_ref.get(n) == live[n]]
        differ = sorted(set(live) - set(same_base) - set(same_ref))
        if gone:
            rep.add("supabase", label, MISSING, f"deployed without {', '.join(gone)}: this is not the code of "
                    f"{base[:7]} (deployed from an older branch?); {len(differ)} of its {len(live)} files differ too")
        elif differ:
            rep.add("supabase", label, CHANGED, f"{len(differ)} of {len(live)} deployed files differ from {base[:7]}"
                    + (f" and from {ref}" if ref_ok else f" ({ref} does not contain {base[:7]}, so it explains nothing)")
                    + ": " + ", ".join(differ[:8]))
        elif same_ref:
            rep.add("supabase", label, CHANGED, f"{len(same_ref)} of {len(live)} deployed files are as at {ref}, the rest "
                    f"as at {base[:7]}", f"redeployed from {ref}, which contains the restore point")
        else:
            rep.add("supabase", label, OK, f"all {len(live)} deployed source files are byte for byte the ones at "
                                           f"{base[:7]} ({TAG})")


def check_secret_pair(rep: Report, mg: Mgmt) -> None:
    label = "CRON_SECRET pairs with the vault's cockpit_sync_secret"
    p = mg.cron_secret_pair()
    if not p.get("function_secret") or not p.get("vault_secret"):
        gone = [n for n, k in (("CRON_SECRET", "function_secret"), ("vault cockpit_sync_secret", "vault_secret"))
                if not p.get(k)]
        rep.add("supabase", label, MISSING, f"{' and '.join(gone)} not there, so the minute job cannot reach sales-live")
    elif p.get("same"):
        rep.add("supabase", label, OK, "same value (two digests compared in memory; neither value read out)")
    else:
        rep.add("supabase", label, CHANGED, "they differ: once rooms have work, sales-live refuses the minute job's "
                                            "calls (401). Set CRON_SECRET to the vault's value (section 4)")


def check_status_rows(rep: Report, mg: Mgmt) -> None:
    rows = {(r["worker"], r["job"]): r for r in mg.sql(Q_STATUS, "status_rows")}
    for (worker, job), limit in STATUS_ROWS.items():
        label = f"status row {worker}/{job}"
        r = rows.get((worker, job))
        if not r:
            rep.add("supabase", label, MISSING, "the row is gone from cockpit_sales_worker_status")
            continue
        age = r.get("age_min")
        said = "says ok" if r.get("ok") else "reports a problem" if r.get("ok") is False else "says nothing"
        if age is None or int(age) > limit:
            rep.add("supabase", label, CHANGED, f"last written {age} min ago (its job runs every few minutes; "
                                                f"limit {limit} min): the job has stopped; it {said}")
        else:
            rep.add("supabase", label, OK, f"written {age} min ago (limit {limit}); it {said}")


def check_secrets(rep: Report, mg: Mgmt, man: Dict[str, Any]) -> None:
    listed = mg.secrets()
    names = {s.get("name") for s in listed}
    times = {s.get("name"): s.get("updated_at") for s in listed}
    recorded = list(man["edge_function_secret_names"])
    ours = (function_env_names() | {"CRON_SECRET", "IP_SALT"}) & set(recorded)
    gone_ours = sorted(n for n in ours if n not in names)
    gone_other = sorted(n for n in recorded if n not in names and n not in ours)
    label = "function secret names"
    if gone_ours:
        rep.add("supabase", label, MISSING, "gone (read by sales-api or sales-live): " + ", ".join(gone_ours))
    elif gone_other:
        rep.add("supabase", label, CHANGED, "gone: " + ", ".join(gone_other),
                NOT_OURS + " (neither sales function reads them)")
    else:
        rep.add("supabase", label, OK, f"all {len(recorded)} recorded names present, CRON_SECRET and IP_SALT among them"
                                       f" ({len(ours)} read by sales-api or sales-live; values never read)")
    # A secret set again after the inventory keeps its name; its update time says it changed. The platform's
    # own SUPABASE_* secrets move by themselves. CRON_SECRET is judged by its pairing with the vault.
    inv = parse_utc(man.get("generated_at"))
    label = "function secrets set again after the inventory"
    if inv is None:
        rep.add("supabase", label, UNKNOWN, "the manifest has no inventory time")
        return
    reset = sorted(n for n in ours if n in names and not PLATFORM_SECRET.match(n) and n != "CRON_SECRET"
                   and (parse_utc(times.get(n)) or inv) > inv)
    other = sorted(n for n in recorded if n in names and n not in ours and not PLATFORM_SECRET.match(n)
                   and (parse_utc(times.get(n)) or inv) > inv)
    when = lambda ns: ", ".join(f"{n} ({times.get(n)})" for n in ns)
    if reset:
        rep.add("supabase", label, CHANGED, f"read by the sales functions and set again: {when(reset)}"
                + ("; IP_SALT reset means stored join-page IP hashes no longer match" if "IP_SALT" in reset else "")
                + ". Check each new value is the right one")
    elif other:
        rep.add("supabase", label, CHANGED, f"set again: {when(other)}", NOT_OURS + " (neither sales function reads them)")
    else:
        rep.add("supabase", label, OK, f"none of the {len(ours)} read by the sales functions was set again after "
                                       f"{man.get('generated_at')}")


def check_bucket_private(rep: Report, mg: Mgmt) -> None:
    rows = mg.sql(Q_BUCKET, "bucket")
    if not rows:
        rep.add("supabase", f"bucket {BUCKET}", MISSING, "not in storage.buckets")
    elif rows[0].get("public"):
        rep.add("supabase", f"bucket {BUCKET}", CHANGED, "the bucket is PUBLIC; it holds lead data and the backups")
    else:
        rep.add("supabase", f"bucket {BUCKET}", OK, "private (storage.buckets.public is false)")


# ---- the private bucket: the backups --------------------------------------------------------------------

def unwrap(raw: bytes) -> Tuple[bytes, Optional[Dict[str, Any]]]:
    """A wrapped object (mahara-backup-wrapper/1) gives back the original bytes and its record."""
    try:
        doc = json.loads(raw)
    except ValueError:
        return raw, None
    if isinstance(doc, dict) and doc.get("format") == "mahara-backup-wrapper/1":
        inner = base64.b64decode(doc["content"]) if doc.get("encoding") == "base64" else doc["content"].encode("utf-8")
        return inner, doc
    return raw, None


class Storage:
    def __init__(self, ref: str, key_file: Path, url_file: Optional[Path]) -> None:
        url = f"https://{ref}.supabase.co"
        if url_file and url_file.is_file():
            u = url_file.read_text(encoding="utf-8").strip().rstrip("/")
            if urllib.parse.urlparse(u).hostname == f"{ref}.supabase.co":
                url = u
        self.url = url
        self._key = ""
        if TAPE.mode == "replay":
            return
        self._key = key_file.read_text(encoding="utf-8").strip()  # never printed
        if not self._key:
            raise SourceError(f"{key_file} is empty")

    def text(self, obj: str) -> str:
        return TAPE.take("bucket text " + obj, lambda: unwrap(self.get(obj))[0].decode("utf-8"))

    def inner_sha(self, obj: str) -> str:
        return TAPE.take("bucket sha " + obj, lambda: sha256(unwrap(self.get(obj))[0]))

    def get(self, obj: str) -> bytes:
        q = urllib.parse.quote(obj, safe="/")
        req = urllib.request.Request(f"{self.url}/storage/v1/object/authenticated/{BUCKET}/{q}", headers={
            "apikey": self._key, "Authorization": "Bearer " + self._key, "User-Agent": UA})
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            raise SourceError(f"{obj}: HTTP {e.code} {scrub(e.read().decode('utf-8', 'replace'), 120)}")
        except (urllib.error.URLError, OSError) as e:
            raise SourceError(f"{obj}: {scrub(e, 120)}")


def parse_sums(text: str) -> Dict[str, str]:
    out = {}
    for line in text.splitlines():
        if not line.strip():
            continue
        h, rel = line.split(None, 1)
        out[rel.strip().lstrip("*")] = h.lower()
    return out


def check_bucket_backups(rep: Report, mg: Optional[Mgmt], st: Optional[Storage], deep: bool) -> None:
    """The first set (2026-10-07) and the supplement the review added under supplement/, each against its own
    SHA256SUMS."""
    for sub, title in (("", "bucket"), (SUPPLEMENT, "bucket supplement")):
        check_bucket_set(rep, mg, st, deep, sub, title)


def check_bucket_set(rep: Report, mg: Optional[Mgmt], st: Optional[Storage], deep: bool, sub: str, title: str) -> None:
    area, l_list, l_match = "backups", f"{title} SHA256SUMS lists every file", f"{title} objects match SHA256SUMS"
    if mg is None or st is None:
        why = "no management token" if mg is None else "no service key to read the private bucket"
        rep.unknown_all(area, [l_list] + ([l_match] if deep else []), why)
        return
    prefix = BACKUP_PREFIX + sub
    every = {r["name"]: int(r["size"] or 0) for r in mg.sql(Q_OBJECTS, "objects")}
    objects = {n: v for n, v in every.items() if n.startswith(prefix)
               and (sub or not n.startswith(BACKUP_PREFIX + SUPPLEMENT))}
    sums_obj = prefix + "SHA256SUMS.json"
    if sums_obj not in objects:
        rep.add(area, l_list, MISSING,
                f"{sums_obj} is not in the bucket ({plural(len(objects), 'object')} under {prefix})")
        if deep:
            rep.add(area, l_match, UNKNOWN, "no SHA256SUMS to compare with")
        return
    sums = parse_sums(st.text(sums_obj))
    names = {rel: (prefix + rel if prefix + rel in objects else prefix + rel + ".json") for rel in sums}
    gone = sorted(rel for rel, obj in names.items() if obj not in objects)
    extra = sorted(set(objects) - set(names.values()) - {sums_obj, prefix + "BUCKET-READBACK.json"})
    if gone:
        rep.add(area, l_list, MISSING,
                f"{len(gone)} of {len(sums)} listed files are not in the bucket: " + ", ".join(gone[:8]))
    elif extra:
        rep.add(area, l_list, CHANGED, f"objects not in SHA256SUMS: {', '.join(Path(e).name for e in extra[:8])}")
    else:
        rep.add(area, l_list, OK, f"{len(sums)} files listed, every one in the bucket ({len(objects)} objects, "
                                  f"{sum(objects.values()):,} bytes, with SHA256SUMS.json"
                                  + (" and BUCKET-READBACK.json)" if prefix + "BUCKET-READBACK.json" in objects else ")"))
    if not deep:
        return
    bad: List[str] = []
    read = 0
    for rel, obj in sorted(names.items()):
        if obj not in objects:
            continue
        try:
            inner_sha = st.inner_sha(obj)
        except SourceError as e:
            bad.append(f"{rel} (could not be read: {e})")
            continue
        read += 1
        if inner_sha != sums[rel]:
            bad.append(rel)
    if bad:
        rep.add(area, l_match, CHANGED, f"{len(bad)} of {len(names)} differ from their sum: " + ", ".join(bad[:6]))
    else:
        rep.add(area, l_match, OK, f"all {read} objects downloaded, unwrapped where wrapped, and equal to their sha256")


# ---- the cockpit ----------------------------------------------------------------------------------------

def http_get(url: str, timeout: int = 60) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Cache-Control": "no-cache"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


SB_HOST = re.compile(r"https://([a-z0-9]{20})\.supabase\.co")


def scan_bundle(site: str) -> Dict[str, Any]:
    """Crawl the live bundle from its page; keep which of our phrases it holds and which Supabase projects it
    names (never the code itself)."""
    html = http_get(f"{site}?cb={int(time.time())}").decode("utf-8", "replace")
    entries = re.findall(r'<script[^>]+src="([^"]+\.js)"', html)
    if not entries:
        raise SourceError("the page names no script")
    base = urllib.parse.urljoin(site, entries[0]).rsplit("/", 1)[0] + "/"
    todo = [urllib.parse.urljoin(site, e).rsplit("/", 1)[1] for e in entries]
    seen: Dict[str, str] = {}
    total = 0
    chunk = re.compile(r"""["'`(/]\.?/?([A-Za-z0-9_-]+-[A-Za-z0-9_-]{8}\.js)""")
    first = todo[0]
    unread: Set[str] = set()
    while todo and len(seen) < 400 and total < 40_000_000:
        n = todo.pop()
        if n in seen or n in unread:
            continue
        try:
            text = http_get(base + n).decode("utf-8", "replace")
        except urllib.error.HTTPError:
            if n == first:
                raise
            unread.add(n)  # a name that only looked like a chunk
            continue
        seen[n] = text
        total += len(text)
        todo += [m for m in chunk.findall(text) if m not in seen and m not in unread]
    blob = "\n".join(seen.values()) + "\n" + html
    return {"entry": entries[0].rsplit("/", 1)[-1], "chunks": len(seen) - 1,
            "found": {w: w in blob for w in ROOM_STRINGS + PROPOSAL_STRINGS},
            "projects": sorted(set(SB_HOST.findall(blob)))}


def check_bundle(rep: Report, site: str, project: str) -> None:
    labels = ("live sales bundle: the room screens' words", "live sales bundle: the proposal screens' words",
              "live sales bundle: its Supabase project")
    try:
        b = TAPE.take("bundle", lambda: scan_bundle(site))
    except (urllib.error.URLError, OSError, SourceError, ValueError) as e:
        rep.unknown_all("cockpit", labels, f"{site} could not be read: {scrub(e, 120)}")
        return
    for label, words in zip(labels, (ROOM_STRINGS, PROPOSAL_STRINGS)):
        gone = [w for w in words if not b["found"].get(w)]
        if gone:
            rep.add("cockpit", label, MISSING, f"not in {b['entry']} or its {b['chunks']} chunks: " + "; ".join(gone))
        else:
            rep.add("cockpit", label, OK, f"all {len(words)} found in {b['entry']} and its {b['chunks']} chunks")
    refs = b.get("projects") or []
    if project in refs:
        rep.add("cockpit", labels[2], OK, f"it talks to {project}" + (f" (it also names {', '.join(r for r in refs if r != project)})"
                                                                     if len(refs) > 1 else ""))
    elif refs:
        rep.add("cockpit", labels[2], CHANGED, f"it talks to {', '.join(refs)}, not {project}: the cockpit moved to "
                                              f"another project; check that one with --project {refs[0]}")
    else:
        rep.add("cockpit", labels[2], UNKNOWN, "it names no supabase.co project")


# ---- the VPS --------------------------------------------------------------------------------------------

REMOTE = r'''
import base64, hashlib, json, os, re, shlex, shutil, socket, subprocess, tarfile, tempfile, time
E = json.loads(base64.b64decode("__EXPECT__").decode())
HOME = os.path.expanduser("~")
OUT = {"host": socket.gethostname(), "now": time.time()}
SECRETISH = re.compile(__SECRETISH__)


def scrub(t, n=200):
    return SECRETISH.sub("[hidden]", str(t)).replace("\n", " ")[:n]


def sha(b):
    return hashlib.sha256(b if isinstance(b, bytes) else b.encode("utf-8")).hexdigest()


def sha_file(p):
    try:
        h = hashlib.sha256()
        with open(p, "rb") as f:
            for blk in iter(lambda: f.read(1 << 20), b""):
                h.update(blk)
        return h.hexdigest()
    except OSError:
        return None


def section(name, fn):
    try:
        OUT[name] = fn()
    except Exception as e:  # one broken section never hides the others
        OUT[name] = {"error": scrub(type(e).__name__ + ": " + str(e))}


CRON = re.compile(r"^((?:\S+\s+){5})(.*)$")


def crontab():
    p = subprocess.run(["crontab", "-l"], capture_output=True, text=True, timeout=30)
    if p.returncode != 0:
        return {"error": scrub(p.stderr or "exit %d" % p.returncode)}
    rows = []
    for line in p.stdout.splitlines():
        s = line.strip()
        if not s:
            continue
        commented = s.startswith("#")
        body = s.lstrip("#").strip()
        m = CRON.match(body)
        rows.append({"sha": sha(line), "body_sha": sha(body), "commented": commented,
                     "schedule": " ".join(m.group(1).split()) if m else None,
                     "cmd_sha": sha(" ".join(m.group(2).split())) if m else None})
    return {"sha256": sha(p.stdout), "lines": rows}


def files():
    base = os.path.join(HOME, "mahara-cockpits")
    head = subprocess.run(["git", "-C", base, "rev-parse", "HEAD"], capture_output=True, text=True, timeout=30)
    return {"head": head.stdout.strip() if head.returncode == 0 else None,
            "sha": {p: sha_file(os.path.join(base, p)) for p in E["files"]}}


def parse_env(path):
    vals = {}
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            s = line.strip()
            if not s or s.startswith("#"):
                continue
            if s.startswith("export "):
                s = s[7:].strip()
            if "=" not in s:
                continue
            k, v = s.split("=", 1)
            v = v.strip()
            if len(v) >= 2 and v[0] == v[-1] and v[0] in "'\"":
                v = v[1:-1]
            vals[k.strip()] = v
    return vals


def env():
    out = {}
    for spec in E["env"]:
        p = os.path.expanduser(spec["path"])
        if not os.path.isfile(p):
            out[spec["path"]] = {"exists": False}
            continue
        vals = parse_env(p)
        projects = {}
        for k in E["project_keys"]:
            if vals.get(k):
                m = re.match(r"^https://([a-z0-9]{20})\.supabase\.co/?$", vals[k].strip())
                projects[k] = m.group(1) if m else "not a supabase.co project URL"
        out[spec["path"]] = {
            "exists": True, "mode": oct(os.stat(p).st_mode & 0o777), "count": len(vals),
            "names": {n: ("set" if vals.get(n) else "empty" if n in vals else "absent") for n in spec["names"]},
            "equal": {n: vals.get(n) == want for n, want in spec["values"].items()},
            "projects": projects,
        }
        vals = None
    return out


def reference():
    d = os.path.join(HOME, ".sales-desk", "reference")
    return {n: sha_file(os.path.join(d, n)) for n in E["reference"]}


def vince():
    root = os.path.join(HOME, ".sales-desk", "vince")
    if not os.path.isdir(root):
        return {"exists": False}
    live = {}
    for dp, _dn, fn in os.walk(root):
        for f in fn:
            p = os.path.join(dp, f)
            live[os.path.relpath(p, root)] = sha_file(p)
    out = {"exists": True, "files": len(live), "bytes": sum(os.path.getsize(os.path.join(root, r)) for r in live)}
    tarp = os.path.join(HOME, E["backup_dir"], "files", "state", "sales-desk-vince.tar.gz")
    if os.path.isfile(tarp):
        names, same, changed, gone = set(), 0, 0, 0
        with tarfile.open(tarp, "r:gz") as t:
            for m in t:
                if not m.isfile():
                    continue
                rel = m.name.split("vince/", 1)[1] if m.name.startswith("vince/") else m.name
                names.add(rel)
                h = hashlib.sha256(t.extractfile(m).read()).hexdigest()
                cur = live.get(rel)
                if cur is None:
                    gone += 1
                elif cur == h:
                    same += 1
                else:
                    changed += 1
        out["backup"] = {"files": len(names), "same": same, "changed": changed, "gone": gone,
                         "new": len(set(live) - names)}
    return out


def playwright():
    p = os.path.expanduser("~/.sales-desk/env")
    path = (parse_env(p).get("CHROME_PATH") if os.path.isfile(p) else None) or E["chrome_path"]
    return {"path_is_recorded": path == E["chrome_path"], "exists": os.path.isfile(path),
            "bytes": os.path.getsize(path) if os.path.isfile(path) else None}


def guardian():
    p = os.path.join(HOME, ".cockpit-guardian", "state.json")
    if not os.path.isfile(p):
        return {"exists": False, "dir": os.path.isdir(os.path.dirname(p))}
    with open(p, encoding="utf-8") as f:
        d = json.load(f)
    ls = d.get("last_scan") or {}
    return {"exists": True, "dir": True, "at": ls.get("at"), "mode": ls.get("mode"), "full": ls.get("full"),
            "mtime": os.stat(p).st_mtime, "seen_deployed": sorted(d.get("seen_deployed") or {})}


def fixer():
    with open(E["fixer_file"], encoding="utf-8") as f:
        d = json.load(f)
    e = d.get("cockpit-guardian") if isinstance(d, dict) else None
    return {"entry": isinstance(e, dict), "repo": (e or {}).get("repo"), "fix_policy": (e or {}).get("fix_policy")}


DESK_ENV = ('set -a; . "$HOME/.editor-desk/env"; . /opt/data/bibi/api-keys.env; . "$HOME/.sales-desk/env"; set +a')


def desk(args, before="", timeout=300):
    d = os.path.join(HOME, "mahara-cockpits", "hermes", "sales-desk")
    cmd = DESK_ENV + "; " + before + "cd " + shlex.quote(d) + " && exec python3 desk.py " + args
    return subprocess.run(["bash", "-c", cmd], capture_output=True, text=True, timeout=timeout)


def doctor():
    # The offline doctor writes no status row; its write probe goes to a scratch folder under /tmp.
    tmp = tempfile.mkdtemp(prefix="verify-preserved-", dir="/tmp")
    try:
        p = desk("--json doctor --offline", before="export SALES_DESK_OUT=" + shlex.quote(tmp) + "; ")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    try:
        d = json.loads(p.stdout)
    except ValueError:
        return {"rc": p.returncode, "error": scrub((p.stderr or p.stdout)[-300:])}
    rows = d.get("checks") or []
    return {"rc": p.returncode, "blockers": [scrub(b, 160) for b in d.get("blockers") or []], "rows": len(rows),
            "required": sum(1 for r in rows if r.get("required")),
            "required_ok": sum(1 for r in rows if r.get("required") and r.get("ok") is True)}


SWITCH = re.compile(r"^(rooms|live|followups|threads)\.")


def deploy_check():
    p = desk("--json deploy-check")
    try:
        d = json.loads(p.stdout)
    except ValueError:
        return {"rc": p.returncode, "error": scrub((p.stderr or p.stdout)[-300:])}
    rows = d.get("checks") or []
    pick = lambda name: next(({"ok": r.get("ok"), "detail": scrub(r.get("detail"), 160)}
                              for r in rows if r.get("check") == name), None)
    return {"rc": p.returncode, "rows": len(rows), "blockers": [scrub(b, 160) for b in d.get("blockers") or []],
            "switches": [{"check": r.get("check"), "ok": r.get("ok"), "detail": scrub(r.get("detail"), 80)}
                         for r in rows if SWITCH.match(str(r.get("check") or ""))],
            "doctor_row": pick("sales-desk/doctor"), "sales_live": pick("sales-live reachable"),
            "installed": {n: (pick(n) or {}).get("ok") for n in ("rooms", "room-hosts", "doctor", "followups")}}


def backup_dir(sub=""):
    b = os.path.join(HOME, E["backup_dir"], sub)
    sums = os.path.join(b, "SHA256SUMS")
    if not os.path.isfile(sums):
        return {"exists": os.path.isdir(b), "sums": False}
    listed, bad, gone = 0, [], []
    with open(sums, encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            h, rel = line.split(None, 1)
            rel = rel.strip().lstrip("*")
            listed += 1
            cur = sha_file(os.path.join(b, rel))
            if cur is None:
                gone.append(rel)
            elif cur != h:
                bad.append(rel)
    return {"exists": True, "sums": True, "listed": listed, "bad": bad, "gone": gone}


for _name, _fn in (("crontab", crontab), ("files", files), ("env", env), ("reference", reference),
                   ("vince", vince), ("playwright", playwright), ("guardian", guardian), ("fixer", fixer),
                   ("backup_dir", backup_dir), ("supplement_dir", lambda: backup_dir("supplement")),
                   ("doctor", doctor), ("deploy_check", deploy_check)):
    section(_name, _fn)
print(json.dumps(OUT))
'''


def git_files(ref: str, folders: Iterable[str] = OUR_FOLDERS, flat: bool = False) -> Dict[str, str]:
    """sha256 of every file under `folders` at `ref` (symlinks left out). flat: only the files directly in
    each folder, keyed by their name."""
    folders = list(folders)
    raw = git("ls-tree", "-r", "-z", ref, "--", *[f.rstrip("/") + "/" for f in folders])
    entries = []
    for item in raw.split(b"\0"):
        if not item:
            continue
        meta, path = item.split(b"\t", 1)
        mode, typ, oid = meta.split()
        name = path.decode("utf-8", "replace")
        if flat:
            rel = next((name[len(f.rstrip("/")) + 1:] for f in folders if name.startswith(f.rstrip("/") + "/")), name)
            if "/" in rel:
                continue
            name = rel
        if typ == b"blob" and mode != b"120000":
            entries.append((oid.decode(), name))
    if not entries:
        return {}
    out = git("cat-file", "--batch", data=("\n".join(o for o, _ in entries) + "\n").encode(), timeout=120)
    shas: Dict[str, str] = {}
    pos = 0
    for oid, path in entries:
        nl = out.index(b"\n", pos)
        header = out[pos:nl].split()
        size = int(header[2])
        shas[path] = sha256(out[nl + 1:nl + 1 + size])
        pos = nl + 1 + size + 1
    return shas


def our_env_names() -> Set[str]:
    """Every capitalised name our two workers mention in their code: the env keys they may read."""
    names: Set[str] = set()
    rx = re.compile(r"""["']([A-Z][A-Z0-9_]{2,})["']""")
    for folder in OUR_FOLDERS:
        for p in (ROOT / folder).rglob("*.py"):
            if "tests" in p.parts or p.name.startswith("test_"):
                continue
            names |= set(rx.findall(p.read_text(encoding="utf-8", errors="replace")))
    return names


def our_cron_lines(vman: Dict[str, Any]) -> List[Dict[str, Any]]:
    return [l for l in vman["crontab"]["lines"]
            if l["kind"] == "job" and any(f in l["text"] for f in OUR_FOLDERS)]


def cron_parts(text: str) -> Tuple[Optional[str], Optional[str]]:
    m = re.match(r"^((?:\S+\s+){5})(.*)$", text.strip())
    if not m:
        return None, None
    return " ".join(m.group(1).split()), sha256(" ".join(m.group(2).split()).encode())


def run_remote(target: str, key: str, expect: Dict[str, Any], timeout: int) -> Dict[str, Any]:
    script = (REMOTE.replace("__EXPECT__", base64.b64encode(json.dumps(expect).encode()).decode())
              .replace("__SECRETISH__", repr(_SECRETISH.pattern)))
    cmd = ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=20"]
    if key:
        cmd += ["-i", os.path.expanduser(key)]
    cmd += [target, "python3", "-"]
    try:
        p = subprocess.run(cmd, input=script.encode(), capture_output=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        raise SourceError(f"ssh {target} did not finish within {timeout} s")
    if p.returncode != 0:
        raise SourceError(f"ssh {target} exited {p.returncode}: {scrub(p.stderr.decode('utf-8', 'replace')[-300:], 200)}")
    try:
        return json.loads(p.stdout.decode("utf-8"))
    except ValueError:
        raise SourceError(f"ssh {target} gave no JSON: {scrub(p.stdout.decode('utf-8', 'replace')[-200:], 160)}")


VPS_LABELS = ("crontab", "files", "env", "Supabase project", "reference deals", "call reviews", "Playwright shell",
              "doctor --offline", "hourly doctor", "deploy-check", "switches", "guardian last scan", "Hermes fixer entry",
              "backup folder")


def check_vps(rep: Report, vman: Dict[str, Any], args: argparse.Namespace) -> None:
    area = "vps"
    try:
        ref_sha = git("rev-parse", "--verify", f"{args.ref}^{{commit}}").decode().strip()
        main_files = git_files(args.ref)
    except (SourceError, OSError, subprocess.SubprocessError) as e:
        rep.unknown_all(area, VPS_LABELS, f"{args.ref} could not be read from git: {e}")
        return
    rec_files = {f["path"]: f for f in vman["repo_files"]["files"]}
    paths = sorted(set(main_files) | set(rec_files))
    env_specs = []
    names_used = our_env_names()
    for path, e in vman["env_files"].items():
        if not e.get("exists"):
            continue
        values = dict(e.get("non_secret_values") or {})
        env_specs.append({"path": path, "names": e["key_names"], "values": values})
    expect = {
        "files": paths, "env": env_specs, "reference": sorted(vman["reference_deals"]["files"]),
        "backup_dir": BACKUP_DIR, "chrome_path": vman["playwright"]["CHROME_PATH"], "fixer_file": FIXER_FILE,
        "project_keys": list(PROJECT_KEYS),
    }
    try:
        R = TAPE.take("vps", lambda: run_remote(args.ssh, args.ssh_key, expect, args.ssh_timeout))
    except SourceError as e:
        rep.unknown_all(area, VPS_LABELS, str(e))
        return
    now = float(R.get("now") or time.time())

    def broken(part: str, labels: Iterable[str]) -> bool:
        if isinstance(R.get(part), dict) and "error" in R[part] and len(R[part]) == 1:
            rep.unknown_all(area, labels, f"{part} could not be read on {R.get('host')}: {R[part]['error']}")
            return True
        return False

    # Our crontab lines, exactly; the rest only counted.
    if not broken("crontab", ["crontab"]):
        live = R["crontab"]["lines"]
        exact = {l["sha"] for l in live if not l["commented"]}
        commented = {l["body_sha"] for l in live if l["commented"]}
        by_cmd = {l["cmd_sha"]: l["schedule"] for l in live if not l["commented"] and l["cmd_sha"]}
        ours = our_cron_lines(vman)
        for l in ours:
            sched, cmd_sha = cron_parts(l["text"])
            what = re.search(r"desk\.py --quiet ([a-z-]+(?: --[a-z-]+(?: \d+)?)?)|guardian\.py[^\"]*run", l["text"])
            label = f"crontab line {l['n']} ({what.group(0) if what else 'ours'})"
            if l["sha256"] in exact:
                rep.add(area, label, OK, "present, byte for byte")
            elif sha256(l["text"].strip().encode()) in commented:
                rep.add(area, label, CHANGED, "commented out")
            elif cmd_sha in by_cmd:
                rep.add(area, label, CHANGED, f"runs on {by_cmd[cmd_sha]} (recorded {sched})")
            else:
                rep.add(area, label, MISSING, "no line runs this command any more")
        others = [l for l in vman["crontab"]["lines"] if l["kind"] == "job" and l not in ours]
        gone = [l["n"] for l in others if l["sha256"] not in exact]
        same_tab = R["crontab"]["sha256"] == vman["crontab"]["sha256"]
        detail = (f"{len(others) - len(gone)} of {len(others)} other recorded job lines present; "
                  + ("the whole crontab is byte for byte the recorded one" if same_tab else
                     f"the crontab differs from the recorded one (sha256 {R['crontab']['sha256'][:12]})"))
        if gone:
            rep.add(area, "crontab, the other workers' lines", CHANGED, detail + f"; recorded lines gone: {gone}", NOT_OURS)
        else:
            rep.add(area, "crontab, the other workers' lines", OK, detail)

    # Our files against the ref.
    if not broken("files", ["files"]):
        vps_sha = R["files"]["sha"]
        for folder in OUR_FOLDERS:
            same, missing, unexplained = 0, [], []
            explained: Dict[Tuple[str, str], List[str]] = {}
            for p in [p for p in paths if p.startswith(folder + "/")]:
                cur, want, rec = vps_sha.get(p), main_files.get(p), rec_files.get(p) or {}
                if want is not None and cur == want:
                    same += 1
                elif cur is None and want is not None and rec.get("status") == "git_only":
                    explained.setdefault(("in the ref, not on the VPS", "not on the VPS at the inventory either"),
                                         []).append(p)
                elif cur is None and want is not None and not rec:
                    explained.setdefault(("in the ref, not on the VPS", f"added to {args.ref} after the inventory, "
                                          "not copied to the VPS yet"), []).append(p)
                elif cur is None and want is None:
                    if rec.get("vps_sha256") and not Path(p).name.startswith("._"):
                        missing.append(p)  # on the VPS at the inventory, gone from both the VPS and the ref
                    continue  # Mac metadata (._*) gone, or never anywhere: nothing to keep
                elif cur is None:
                    missing.append(p)
                elif want is None and cur == rec.get("vps_sha256"):
                    explained.setdefault(("on the VPS, not in the ref", "on the VPS only, as at the inventory "
                                          "(Mac metadata or not in git)"), []).append(p)
                elif cur == rec.get("vps_sha256"):
                    explained.setdefault(("differ from the ref", f"the VPS keeps the copy recorded at the inventory; "
                                          f"{args.ref} moved on"), []).append(p)
                else:
                    unexplained.append(p)
            n_explained = sum(len(v) for v in explained.values())
            total = same + len(missing) + len(unexplained) + n_explained
            head = f"{same} of {total} files equal to {args.ref} ({ref_sha[:7]})"
            if missing:
                rep.add(area, f"{folder} files", MISSING, head + "; gone from the VPS: "
                        + ", ".join(q[len(folder) + 1:] for q in missing[:10]))
            if unexplained:
                rep.add(area, f"{folder} files", CHANGED, head + "; differ from both the ref and the recorded copy: "
                        + ", ".join(q[len(folder) + 1:] for q in unexplained[:10]))
            for (what, why), ps in sorted(explained.items()):
                short = [q[len(folder) + 1:] for q in ps]
                rep.add(area, f"{folder} files", CHANGED, f"{len(ps)} {what}: " + ", ".join(short[:6])
                        + (f" and {len(ps) - 6} more" if len(ps) > 6 else ""), why)
            if not (missing or unexplained):
                rep.add(area, f"{folder} files", OK, head + (f"; {n_explained} explained above" if n_explained else ""))

    # Env files: names, and the recorded setting values, compared on the VPS.
    if not broken("env", ["env"]):
        for spec in env_specs:
            path, cur = spec["path"], R["env"].get(spec["path"]) or {}
            rec = vman["env_files"][path]
            strict = sorted(n for n in spec["names"] if n in names_used or n in spec["values"])
            label = f"env {path}"
            if not cur.get("exists"):
                if strict:
                    rep.add(area, label, MISSING, f"the file is gone ({len(strict)} keys our workers read)")
                else:
                    rep.add(area, label, CHANGED, "the file is gone", NOT_OURS)
                continue
            was_empty = set(rec.get("empty_keys") or [])
            lost = [n for n in spec["names"] if cur["names"].get(n) != "set" and n not in was_empty]
            lost_strict = [n for n in lost if n in strict]
            differ = [n for n, same in cur["equal"].items() if not same]
            if lost_strict:
                rep.add(area, label, MISSING, "keys our workers read are absent or empty: " + ", ".join(lost_strict))
            elif differ:
                rep.add(area, label, CHANGED, "setting values differ from the recorded ones: " + ", ".join(differ))
            elif lost:
                rep.add(area, label, CHANGED, "absent or empty: " + ", ".join(lost),
                        NOT_OURS + " (our workers do not read them)")
            else:
                vals = f"; values as recorded: {', '.join(sorted(spec['values']))}" if spec["values"] else ""
                n_set = sum(1 for n in spec["names"] if cur["names"].get(n) == "set")
                empty = f" ({len(spec['names']) - n_set} empty, as recorded)" if n_set < len(spec["names"]) else ""
                rep.add(area, label, OK, f"{n_set} of {plural(len(spec['names']), 'recorded name')} set{empty}, "
                        f"{len(strict)} read by our workers{vals}; mode {cur.get('mode')}")

    # Which project the desk and the guardian talk to: DESK_SUPABASE_URL as the cron lines source the files
    # (a later file wins). A cutover to a new project changes it there first.
    if not broken("env", ["Supabase project"]):
        order = ("~/.editor-desk/env", "/opt/data/bibi/api-keys.env", "~/.sales-desk/env")
        found = {k: (path, ref) for path in order for k, ref in ((R["env"].get(path) or {}).get("projects") or {}).items()}
        desk = found.get("DESK_SUPABASE_URL")
        label = "VPS workers' Supabase project (DESK_SUPABASE_URL)"
        others = sorted(f"{k} in {p} names {r}" for k, (p, r) in found.items()
                        if k != "DESK_SUPABASE_URL" and r != args.project)
        if desk is None:
            rep.add(area, label, MISSING, "not set in " + ", ".join(order) + ": the desk and the guardian cannot reach Supabase")
        elif desk[1] != args.project:
            rep.add(area, label, CHANGED, f"{desk[0]} names {desk[1]}, not {args.project}: the workers moved to another "
                                          f"project; check that one with --project {desk[1]}")
        else:
            rep.add(area, label, OK, f"{desk[0]} names {args.project}" + (f" (also: {'; '.join(others)})" if others else ""))

    if not broken("reference", ["reference deals"]):
        want = vman["reference_deals"]["files"]
        gone = [n for n in sorted(want) if R["reference"].get(n) is None]
        differ = [n for n in sorted(want) if R["reference"].get(n) and R["reference"][n] != want[n]["sha256"]]
        if gone:
            rep.add(area, "reference deals", MISSING, "gone from ~/.sales-desk/reference: " + ", ".join(gone))
        elif differ:
            rep.add(area, "reference deals", CHANGED, "differ from the recorded sha256: " + ", ".join(differ))
        else:
            rep.add(area, "reference deals", OK, f"{', '.join(sorted(want))}: sha256 as recorded")

    if not broken("vince", ["call reviews"]):
        v = R["vince"]
        rec_n = vman["sales_desk_state"]["vince"]["files"]
        if not v.get("exists"):
            rep.add(area, "call reviews (~/.sales-desk/vince)", MISSING, "the folder is gone")
        elif "backup" in v:
            b = v["backup"]
            detail = (f"{b['same']} of the {b['files']} files in the 2026-10-07 backup are there, byte for byte; "
                      f"{v['files']} files now")
            if b["gone"]:
                rep.add(area, "call reviews (~/.sales-desk/vince)", MISSING, detail + f"; {b['gone']} gone")
            elif b["changed"]:
                rep.add(area, "call reviews (~/.sales-desk/vince)", CHANGED, detail + f"; {b['changed']} rewritten")
            elif b["new"]:
                rep.add(area, "call reviews (~/.sales-desk/vince)", CHANGED, detail + f"; {b['new']} new",
                        "new call reviews written by the desk since the backup")
            else:
                rep.add(area, "call reviews (~/.sales-desk/vince)", OK, detail)
        elif v["files"] >= rec_n:
            rep.add(area, "call reviews (~/.sales-desk/vince)", UNKNOWN,
                    f"{v['files']} files (recorded {rec_n}); the backup tar to compare with is gone")
        else:
            rep.add(area, "call reviews (~/.sales-desk/vince)", MISSING, f"{v['files']} files, recorded {rec_n}")

    if not broken("playwright", ["Playwright shell"]):
        pw = R["playwright"]
        want = vman["playwright"]["bytes"]
        if not pw.get("exists"):
            rep.add(area, "Playwright headless shell", MISSING, "CHROME_PATH points at nothing; proposals cannot render")
        elif not pw.get("path_is_recorded"):
            rep.add(area, "Playwright headless shell", CHANGED, "CHROME_PATH names another browser now")
        elif pw.get("bytes") != want:
            rep.add(area, "Playwright headless shell", CHANGED, f"{pw.get('bytes')} bytes (recorded {want})")
        else:
            rep.add(area, "Playwright headless shell", OK, f"present at the recorded CHROME_PATH, {want:,} bytes")

    if not broken("doctor", ["doctor --offline"]):
        d = R["doctor"]
        if "error" in d:
            rep.add(area, "desk.py doctor --offline", UNKNOWN, f"exit {d.get('rc')}: {d['error']}")
        elif d["blockers"]:
            rep.add(area, "desk.py doctor --offline", CHANGED, "blocked: " + " | ".join(d["blockers"]))
        else:
            rep.add(area, "desk.py doctor --offline", OK,
                    f"ready ({d['required_ok']} of {d['required']} required checks ok, {d['rows']} lines)")

    if not broken("deploy_check", ["hourly doctor", "deploy-check", "switches"]):
        dc = R["deploy_check"]
        if "error" in dc:
            rep.unknown_all(area, ["hourly doctor (status row)", "desk.py deploy-check", "deploy-check switches"],
                            f"deploy-check exit {dc.get('rc')}: {dc['error']}")
        else:
            row = dc.get("doctor_row")
            if row is None:
                rep.add(area, "hourly doctor (status row)", UNKNOWN, "deploy-check did not report it")
            elif row["ok"] is True:
                rep.add(area, "hourly doctor (status row)", OK, row["detail"])
            else:
                rep.add(area, "hourly doctor (status row)", CHANGED, row["detail"])
            if dc["blockers"]:
                rep.add(area, "desk.py deploy-check", CHANGED, "not ready: " + " | ".join(dc["blockers"][:4]))
            else:
                inst = dc.get("installed") or {}
                rep.add(area, "desk.py deploy-check", OK, f"ready, no blockers ({dc['rows']} lines); cron lines installed: "
                        + ", ".join(n for n, okv in inst.items() if okv) + (f"; sales-live: {dc['sales_live']['detail']}"
                                                                             if dc.get("sales_live") else ""))
            sw = dc.get("switches") or []
            on = [s["check"] for s in sw if s.get("ok") is False]
            off = {s["check"] for s in sw if s.get("ok") is True}
            unseen = [n for n in ("rooms.enabled", "rooms.test_only", "live.enabled", "followups.agent") if n not in off]
            if on:
                rep.add(area, "deploy-check switches", CHANGED, "switched on or wrong: " + ", ".join(on))
            elif unseen:
                rep.add(area, "deploy-check switches", UNKNOWN, "deploy-check did not say these are as shipped: "
                        + ", ".join(unseen))
            else:
                rep.add(area, "deploy-check switches", OK, f"all {len(off)} live-calls and follow-up switches as shipped: "
                        "rooms.enabled off, rooms.test_only on, live.enabled off, followups.agent off")

    if not broken("guardian", ["guardian last scan"]):
        g = R["guardian"]
        if not g.get("exists") and g.get("dir") is False:
            rep.add(area, "guardian last scan", MISSING, "~/.cockpit-guardian is gone: the guardian's cron line takes "
                    "its lock and writes its log there, so it cannot start again until the folder is back "
                    "(mkdir -m 700 ~/.cockpit-guardian, then section 4)")
        elif not g.get("exists"):
            rep.add(area, "guardian last scan", MISSING, "~/.cockpit-guardian/state.json is gone (the guardian forgets "
                    "its open incidents and which live-calls parts it has seen deployed)")
        else:
            try:
                at = datetime.strptime(g["at"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc).timestamp()
                age = (now - at) / 60.0
            except (TypeError, ValueError):
                age = None
            if age is None:
                rep.add(area, "guardian last scan", UNKNOWN, "state.json carries no last scan time")
            elif age > GUARDIAN_MAX_AGE_MIN:
                rep.add(area, "guardian last scan", CHANGED, f"last scan {age:.0f} min ago ({g['at']}); it runs every 5 min")
            elif g.get("mode") != "report-only":
                rep.add(area, "guardian last scan", CHANGED, f"scanned {age:.1f} min ago in mode {g.get('mode')}, "
                                                              "not report-only")
            else:
                rep.add(area, "guardian last scan", OK, f"{age:.1f} min ago ({g['at']}), report-only"
                        + (", full scan" if g.get("full") else ""))

    if not broken("fixer", ["Hermes fixer entry"]):
        fx = R["fixer"]
        if not fx.get("entry"):
            rep.add(area, "Hermes fixer entry cockpit-guardian", MISSING, f"no cockpit-guardian entry in {FIXER_FILE}")
        else:
            rep.add(area, "Hermes fixer entry cockpit-guardian", OK,
                    f"present (repo {fx.get('repo')}, fix_policy {fx.get('fix_policy')})")

    for part, label in (("backup_dir", f"backup folder ~/{BACKUP_DIR}"),
                        ("supplement_dir", f"backup folder ~/{BACKUP_DIR}/{SUPPLEMENT.rstrip('/')}")):
        if part not in R:
            rep.add(area, label, UNKNOWN, "this recording has no reading of it")
            continue
        if broken(part, [label]):
            continue
        b = R[part]
        if not b.get("sums"):
            rep.add(area, label, MISSING, "the folder is gone" if not b.get("exists") else "SHA256SUMS is gone")
        elif b["gone"]:
            rep.add(area, label, MISSING,
                    f"{len(b['gone'])} of {b['listed']} listed files gone: " + ", ".join(b["gone"][:6]))
        elif b["bad"]:
            rep.add(area, label, CHANGED,
                    f"{len(b['bad'])} of {b['listed']} files differ from SHA256SUMS: " + ", ".join(b["bad"][:6]))
        else:
            rep.add(area, label, OK, f"all {b['listed']} files in SHA256SUMS present and equal")


# ---- git: the restore point -----------------------------------------------------------------------------

def check_git(rep: Report, sman: Dict[str, Any], args: argparse.Namespace) -> bool:
    """Whether --ref still holds the restore point (a main moved back or rewritten explains nothing), and the
    restore tag on origin. Returns whether the ref may explain a newer deployed file."""
    base = sman["source"]["main_sha"]
    ref_ok = False
    label = f"{args.ref} contains the restore point {base[:7]}"
    try:
        ref_sha = git("rev-parse", "--verify", f"{args.ref}^{{commit}}").decode().strip()
        rc = subprocess.run(["git", "-C", str(ROOT), "merge-base", "--is-ancestor", base, ref_sha],
                            capture_output=True, timeout=60).returncode
        if rc == 0:
            ref_ok = True
            rep.add("git", label, OK, f"{args.ref} is {ref_sha[:7]} (run git fetch origin first so it is current)")
        elif rc == 1:
            rep.add("git", label, CHANGED, f"{args.ref} is {ref_sha[:7]}, which does not contain {base[:7]}: main was "
                                           "moved back or rewritten, and deploying from it removes live calls")
        else:
            rep.add("git", label, UNKNOWN, f"git merge-base answered {rc}")
    except (SourceError, OSError, subprocess.SubprocessError) as e:
        rep.add("git", label, UNKNOWN, f"could not be read: {scrub(e, 120)}")
    label = f"tag {TAG} on origin"
    try:
        out = TAPE.take("git tag on origin", lambda: git("ls-remote", "origin", f"refs/tags/{TAG}",
                                                         f"refs/tags/{TAG}^{{}}", timeout=60).decode())
        refs = dict(reversed(line.split("\t", 1)) for line in out.splitlines() if "\t" in line)
        peeled = refs.get(f"refs/tags/{TAG}^{{}}") or refs.get(f"refs/tags/{TAG}")
        if not peeled:
            rep.add("git", label, MISSING, "the tag is gone from origin; the restore steps in section 4 start from it")
        elif peeled != base:
            rep.add("git", label, CHANGED, f"it points at {peeled[:7]} now, not {base[:7]}")
        else:
            rep.add("git", label, OK, f"points at {base[:7]}")
    except (SourceError, OSError, subprocess.SubprocessError) as e:
        rep.add("git", label, UNKNOWN, f"could not be read: {scrub(e, 120)}")
    return ref_ok


# ---- main -----------------------------------------------------------------------------------------------

def print_cron(vman: Dict[str, Any], every: bool) -> int:
    """The recorded crontab lines, exactly (they hold no secret: every job sources its env files). 'all' gives
    the whole recorded crontab byte for byte (its sha256 is crontab.sha256 in the VPS manifest)."""
    if every:
        sys.stdout.write("\n".join(l["text"] for l in vman["crontab"]["lines"]))
    else:
        for l in our_cron_lines(vman):
            print(l["text"])
    return 0


def main(argv: Optional[List[str]] = None) -> int:
    global TAPE
    ap = argparse.ArgumentParser(prog="verify-preserved.py", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--json", action="store_true", help="print the checks and the verdict as JSON")
    ap.add_argument("--problems", action="store_true", help="print only the lines that are not ok")
    ap.add_argument("--skip", default="", help="comma list of parts to leave out: supabase, vps, cockpit, backups, git "
                                               "(each left out part is one UNKNOWN line)")
    ap.add_argument("--shallow", action="store_true", help="do not download every bucket object to compare its sum")
    ap.add_argument("--ref", default="origin/main", help="the git ref the VPS files are compared with (origin/main)")
    ap.add_argument("--project", default=None, help="the Supabase project to check (default: the recorded one)")
    ap.add_argument("--ssh", default=os.environ.get("VERIFY_VPS_SSH", VPS), help=f"the VPS (default {VPS})")
    ap.add_argument("--ssh-key", default=os.environ.get("VERIFY_VPS_SSH_KEY", VPS_KEY), help=f"ssh key (default {VPS_KEY})")
    ap.add_argument("--ssh-timeout", type=int, default=600)
    ap.add_argument("--site", default=SITE)
    ap.add_argument("--print-cron", nargs="?", const="ours", choices=("ours", "all"),
                    help="print the recorded text of our crontab lines (or all 65 with 'all') and stop")
    ap.add_argument("--record", metavar="FILE", help="also save what every source answered to FILE")
    ap.add_argument("--replay", metavar="FILE", help="judge a saved recording instead of the live sources")
    args = ap.parse_args(argv)
    skip = {s.strip() for s in args.skip.split(",") if s.strip()}

    for p in (SB_MANIFEST, VPS_MANIFEST):
        if not p.is_file():
            print(f"{p} is missing; run from a checkout that has docs/preserve/", file=sys.stderr)
            return 3
    sman = json.loads(SB_MANIFEST.read_text(encoding="utf-8"))
    vman = json.loads(VPS_MANIFEST.read_text(encoding="utf-8"))
    if args.print_cron:
        return print_cron(vman, args.print_cron == "all")
    if args.record and args.replay:
        print("--record and --replay do not go together", file=sys.stderr)
        return 3
    TAPE = Tape("replay", Path(args.replay)) if args.replay else Tape("record", Path(args.record)) if args.record \
        else Tape()
    args.project = args.project or sman["project"]
    rep = Report()
    started = time.time()
    if args.project != sman["project"]:
        rep.add("supabase", "project", OK, f"checking {args.project}, not the recorded {sman['project']} (--project)")

    ref_ok = False
    if "git" in skip:
        rep.add("git", "the restore point", UNKNOWN, "left out with --skip git")
    else:
        ref_ok = check_git(rep, sman, args)

    mg: Optional[Mgmt] = None
    token_file = Path(os.path.expanduser(os.environ.get("SUPABASE_MGMT_TOKEN_FILE", "~/.config/mahara/sb_mgmt_token")))
    mg_error = ""
    try:
        mg = Mgmt(args.project, token_file)
    except (OSError, SourceError) as e:
        mg_error = f"no management token ({token_file}: {scrub(e, 80)}); set SUPABASE_MGMT_TOKEN_FILE"

    if "supabase" in skip:
        rep.add("supabase", "Creative Triage", UNKNOWN, "left out with --skip supabase")
    elif mg is None:
        rep.add("supabase", "Creative Triage", UNKNOWN, mg_error)
    else:
        later = Later(sman["source"]["main_sha"], sman["source"]["migrations"], args.ref if ref_ok else None)
        steps: List[Tuple[str, Callable[[], None]]] = [
            ("tables and views", lambda: check_relations(rep, mg, sman, later)),
            ("functions", lambda: check_functions(rep, mg, sman, later)),
            ("pg_cron jobs", lambda: check_cron(rep, mg, sman, later)),
            ("settings", lambda: check_settings(rep, mg, sman, later)),
            ("status rows", lambda: check_status_rows(rep, mg)),
            ("WhatsApp templates", lambda: check_templates(rep, mg, sman)),
            ("vault secret names", lambda: check_vault(rep, mg, sman)),
            ("extensions", lambda: check_extensions(rep, mg, sman)),
            ("Edge Functions", lambda: check_edge(rep, mg, sman)),
            ("Edge Function sources", lambda: check_function_sources(rep, mg, sman, args.ref, ref_ok)),
            ("function secret names", lambda: check_secrets(rep, mg, sman)),
            ("CRON_SECRET pairing", lambda: check_secret_pair(rep, mg)),
            ("bucket", lambda: check_bucket_private(rep, mg)),
        ]
        for label, step in steps:
            try:
                step()
            except SourceError as e:
                rep.add("supabase", label, UNKNOWN, f"could not be read: {e}")

    if "vps" in skip:
        rep.add("vps", "the VPS", UNKNOWN, "left out with --skip vps")
    else:
        check_vps(rep, vman, args)

    if "cockpit" in skip:
        rep.add("cockpit", "live sales bundle", UNKNOWN, "left out with --skip cockpit")
    else:
        check_bundle(rep, args.site, args.project)

    if "backups" in skip:
        rep.add("backups", "private bucket", UNKNOWN, "left out with --skip backups")
    else:
        st: Optional[Storage] = None
        key_file = Path(os.path.expanduser(os.environ.get("SUPABASE_SERVICE_KEY_FILE", "~/.config/mahara/sb_service_key")))
        try:
            st = Storage(sman["project"], key_file, Path(os.path.expanduser("~/.config/mahara/sb_url")))
        except (OSError, SourceError):
            st = None
        try:
            # The backups stay in the recorded project's bucket whatever --project says.
            bucket_mg = mg if mg is None or args.project == sman["project"] else Mgmt(sman["project"], token_file)
            check_bucket_backups(rep, bucket_mg, st, deep=not args.shallow)
        except (SourceError, OSError) as e:
            rep.add("backups", "private bucket", UNKNOWN, f"could not be read: {scrub(e, 160)}")

    TAPE.save()
    verdict, code, tail = rep.verdict()
    try:
        ref_sha = git("rev-parse", "--verify", f"{args.ref}^{{commit}}").decode().strip()
    except (SourceError, OSError, subprocess.SubprocessError):
        ref_sha = None
    source = f"; replayed from {args.replay}" if args.replay else ""
    if args.json:
        print(json.dumps({
            "verdict": verdict, "exit_code": code, "summary": tail, "counts": rep.counts(),
            "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "seconds": round(time.time() - started, 1), "replay": args.replay, "project": args.project,
            "manifests": {"supabase": sha256(SB_MANIFEST.read_bytes()), "vps": sha256(VPS_MANIFEST.read_bytes())},
            "ref": {"name": args.ref, "sha": ref_sha}, "checks": rep.rows,
        }, indent=1))
    else:
        for r in rep.rows:
            if not args.problems or r["status"] != OK:
                print(Report.line(r))
        print(f"verdict: {verdict}: {tail} ({time.time() - started:.0f} s; VPS files against {args.ref}"
              f"{' ' + ref_sha[:7] if ref_sha else ''}{source})")
    return code


if __name__ == "__main__":
    sys.exit(main())
