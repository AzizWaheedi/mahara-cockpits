#!/usr/bin/env python3
"""HTTP / Supabase helper for the cockpit Ask AI doors. Reads tokens from api-keys.env.

Dedicated queue: public.cockpit_ask_ai_jobs (never creative requests).

Lifecycle & safety:
  Default mode: DRY_RUN = True. Queue reads are allowed; no database writes or model execution occur without explicit --apply.

Commands:
  askai.py pending [--limit N] [--apply]
    -> List open Ask AI jobs. If --apply, atomically claims them with lease tokens.
  askai.py claim [--limit N] [--lease-seconds S] [--worker-id W] [--apply]
    -> Atomically claim a batch of open jobs with lease tokens.
  askai.py result <id> <file> --lease <token> [--worker-id W] [--apply]
    -> Post JSON answer for job <id>. Rejects stale completion if lease expired or token mismatch.
  askai.py fail <id> "<reason>" --lease <token> [--worker-id W] [--apply]
    -> Mark job as failed. Rejects stale update if lease expired or token mismatch.
  askai.py health
    -> Queue depth on cockpit_ask_ai_jobs (queued, claimed, completed, failed).
  askai.py doctor
    -> Verify environment and configuration health without exposing secrets (boolean configured only).
  askai.py profile "<client>"
    -> Read stored client profile (read-only).
  askai.py asks
    -> List open questions.
  askai.py answer <id> <file> --lease <token> [--worker-id W] [--apply]
    -> Answer question in <file>.
"""
import json
import os
import sys
import urllib.parse
import urllib.request
from typing import Any

KEYS = "/opt/data/bibi/api-keys.env"


def env() -> dict[str, str]:
    """Load environment variables, checking local env and KEYS file if present."""
    out = dict(os.environ)
    if os.path.exists(KEYS):
        try:
            with open(KEYS, encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if "=" in line and not line.startswith("#"):
                        k, v = line.split("=", 1)
                        k = k.strip()
                        v = v.strip().strip("'\"")
                        if k not in out or not out[k]:
                            out[k] = v
        except Exception:
            pass
    return out


def call(url: str, token: str, body: dict[str, Any] | None = None, method: str | None = None) -> dict[str, Any]:
    """Execute authenticated HTTP call against Supabase REST / RPC."""
    data = json.dumps(body).encode("utf-8") if body is not None else None
    http_method = method or ("POST" if data is not None else "GET")
    req = urllib.request.Request(
        url,
        data=data,
        method=http_method,
        headers={
            "Authorization": f"Bearer {token}",
            "apikey": token,
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            content = resp.read()
            return json.loads(content.decode("utf-8")) if content else {"ok": True}
    except urllib.error.HTTPError as exc:
        raw_error = exc.read().decode("utf-8", errors="replace")[:400]
        try:
            err_json = json.loads(raw_error)
            return {"ok": False, "http": exc.code, "error": err_json}
        except Exception:
            return {"ok": False, "http": exc.code, "error": raw_error}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


def parse_flag_value(args: list[str], flag: str, default: str | None = None) -> str | None:
    """Extract flag value e.g. --lease <val> or --lease=<val>."""
    for i, a in enumerate(args):
        if a == flag and i + 1 < len(args):
            return args[i + 1]
        if a.startswith(f"{flag}="):
            return a.split("=", 1)[1]
    return default


def filter_flags(args: list[str]) -> list[str]:
    """Filter out known optional flags to leave positional arguments."""
    pos = []
    skip_next = False
    for i, a in enumerate(args):
        if skip_next:
            skip_next = False
            continue
        if a in ("--apply", "--dry-run"):
            continue
        if a in ("--lease", "--worker-id", "--limit", "--lease-seconds"):
            skip_next = True
            continue
        if any(a.startswith(f"{f}=") for f in ("--lease", "--worker-id", "--limit", "--lease-seconds")):
            continue
        pos.append(a)
    return pos


def run_doctor(e: dict[str, str]) -> int:
    """Check named configuration without exposing secrets. Reports configured booleans only."""
    sb_url = (
        e.get("COCKPIT_SUPABASE_URL")
        or e.get("DESK_SUPABASE_URL")
        or e.get("SUPABASE_URL")
        or e.get("VITE_SUPABASE_URL")
        or ""
    ).rstrip("/")
    sb_key = (
        e.get("COCKPIT_SUPABASE_KEY")
        or e.get("DESK_SUPABASE_KEY")
        or e.get("SUPABASE_SERVICE_ROLE_KEY")
        or ""
    )

    url_ok = bool(sb_url and sb_url.startswith("https://"))
    key_ok = bool(sb_key and len(sb_key) >= 20)

    # Strictly report booleans only without any masked prefix/suffix
    report = {
        "status": "healthy" if (url_ok and key_ok) else "misconfigured",
        "supabase_url": {
            "configured": bool(sb_url),
            "scheme_ok": sb_url.startswith("https://") if sb_url else False,
            "host": urllib.parse.urlparse(sb_url).hostname if sb_url else None,
        },
        "supabase_service_key": {
            "configured": bool(sb_key),
        },
        "keys_file": {
            "path": KEYS,
            "exists": os.path.exists(KEYS),
        },
        "queue_table": "public.cockpit_ask_ai_jobs",
        "convex_fallback": "disabled (fail-closed)",
        "default_mode": "dry-run (apply requires --apply)",
    }
    print(json.dumps(report, indent=2))
    return 0 if (url_ok and key_ok) else 1


def main(argv: list[str] | None = None) -> int:
    args = argv if argv is not None else sys.argv[1:]
    e = env()

    # An inherited environment variable must never activate a mutating command.
    dry_run = "--apply" not in args or "--dry-run" in args

    pos_args = filter_flags(args)
    cmd = pos_args[0] if pos_args else "health"

    if cmd == "doctor":
        return run_doctor(e)

    sb_url = (
        e.get("COCKPIT_SUPABASE_URL")
        or e.get("DESK_SUPABASE_URL")
        or e.get("SUPABASE_URL")
        or e.get("VITE_SUPABASE_URL")
        or ""
    ).rstrip("/")
    sb_key = (
        e.get("COCKPIT_SUPABASE_KEY")
        or e.get("DESK_SUPABASE_KEY")
        or e.get("SUPABASE_SERVICE_ROLE_KEY")
        or ""
    )

    # Fail closed: No Convex fallback allowed
    if not (sb_url and sb_key):
        err = {
            "ok": False,
            "error": "Supabase service credentials not configured. Convex fallback is disabled.",
            "hint": "Set COCKPIT_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in environment or api-keys.env.",
        }
        print(json.dumps(err, indent=2), file=sys.stderr)
        return 1

    rest = f"{sb_url}/rest/v1"
    worker_id = parse_flag_value(args, "--worker-id", "askai-worker-1")
    lease_token = parse_flag_value(args, "--lease")

    # --- PENDING / CLAIM --------------------------------------------------------
    if cmd in ("pending", "claim"):
        limit_str = parse_flag_value(args, "--limit", "5")
        try:
            limit = int(limit_str or "5")
        except ValueError:
            print("Invalid limit", file=sys.stderr)
            return 2

        lease_sec_str = parse_flag_value(args, "--lease-seconds", "300")
        try:
            lease_sec = int(lease_sec_str or "300")
        except ValueError:
            print("Invalid lease duration", file=sys.stderr)
            return 2
        if not 1 <= limit <= 50 or not 10 <= lease_sec <= 3600:
            print("Limit must be 1..50 and lease 10..3600 seconds", file=sys.stderr)
            return 2

        if dry_run:
            # In dry-run: read open jobs without claiming or mutating state
            endpoint = f"{rest}/cockpit_ask_ai_jobs?status=in.(queued,claimed)&order=created_at.asc&limit={limit}&select=id,app,role,client_name,kind,prompt,status,attempts,max_attempts,created_at"
            out = call(endpoint, sb_key)
            if not isinstance(out, list):
                print(json.dumps({"ok": False, "error": "Queue read failed", "detail": out}), file=sys.stderr)
                return 1
            result_payload = {
                "mode": "dry-run",
                "notice": "No database modifications performed. Pass --apply to atomically claim jobs.",
                "candidate_jobs": out if isinstance(out, list) else [],
            }
            print(json.dumps(result_payload, ensure_ascii=False, indent=2))
            return 0

        # Apply mode: call atomic claim RPC
        claim_body = {
            "p_worker_id": worker_id,
            "p_limit": limit,
            "p_lease_seconds": lease_sec,
        }
        out = call(f"{rest}/rpc/cockpit_claim_ask_ai_jobs", sb_key, claim_body, method="POST")
        if not isinstance(out, list) or any(not isinstance(j, dict) or not j.get("id") or not j.get("lease_token") for j in out):
            print(json.dumps({"ok": False, "error": "Claim not confirmed", "detail": out}), file=sys.stderr)
            return 1
        print(json.dumps(out, ensure_ascii=False, indent=2))
        return 0

    # --- RESULT -----------------------------------------------------------------
    elif cmd == "result":
        if len(pos_args) < 3:
            print("Usage: askai.py result <job_id> <result_file.json> --lease <token> [--apply]", file=sys.stderr)
            return 2

        job_id = pos_args[1]
        path = pos_args[2]

        if not os.path.exists(path):
            print(json.dumps({"ok": False, "error": f"Result file not found: {path}"}), file=sys.stderr)
            return 2

        try:
            with open(path, encoding="utf-8") as f:
                result_data = json.load(f)
        except Exception as exc:
            print(json.dumps({"ok": False, "error": f"Failed to parse result JSON: {exc}"}), file=sys.stderr)
            return 2

        # Validate nonempty expected result
        if result_data is None or (isinstance(result_data, (dict, list)) and len(result_data) == 0):
            print(json.dumps({"ok": False, "error": "Result data cannot be empty"}), file=sys.stderr)
            return 2

        if dry_run:
            payload = {
                "mode": "dry-run",
                "notice": f"Would complete job {job_id}. No database state changed. Pass --apply to execute.",
                "job_id": job_id,
                "lease_token_provided": bool(lease_token),
                "result_preview": result_data,
            }
            print(json.dumps(payload, ensure_ascii=False, indent=2))
            return 0

        # STRICT LEASE CONTRACT: Must require original --lease from claim; NEVER fetch from DB
        if not lease_token:
            print(json.dumps({
                "ok": False,
                "error": f"Missing required --lease flag for job {job_id}. Stale token recovery from database is rejected."
            }), file=sys.stderr)
            return 2

        complete_body = {
            "p_job_id": job_id,
            "p_lease_token": lease_token,
            "p_result": result_data,
            "p_worker_id": worker_id,
        }
        res = call(f"{rest}/rpc/cockpit_complete_ask_ai_job", sb_key, complete_body, method="POST")
        if res is True:
            print(json.dumps({"ok": True, "job_id": job_id, "status": "completed"}))
            return 0

        print(json.dumps({
            "ok": False,
            "job_id": job_id,
            "error": "Completion rejected (expired lease, token mismatch, or job state conflict)",
            "detail": res,
        }), file=sys.stderr)
        return 1

    # --- FAIL -------------------------------------------------------------------
    elif cmd == "fail":
        if len(pos_args) < 3:
            print("Usage: askai.py fail <job_id> \"<reason>\" --lease <token> [--apply]", file=sys.stderr)
            return 2

        job_id = pos_args[1]
        reason = pos_args[2].strip()
        if not reason:
            print(json.dumps({"ok": False, "error": "Failure reason cannot be empty"}), file=sys.stderr)
            return 2

        if dry_run:
            payload = {
                "mode": "dry-run",
                "notice": f"Would fail job {job_id} with reason: {reason}. Pass --apply to execute.",
                "job_id": job_id,
                "reason": reason,
            }
            print(json.dumps(payload, ensure_ascii=False, indent=2))
            return 0

        # STRICT LEASE CONTRACT: Must require original --lease from claim; NEVER fetch from DB
        if not lease_token:
            print(json.dumps({
                "ok": False,
                "error": f"Missing required --lease flag for job {job_id}. Stale token recovery from database is rejected."
            }), file=sys.stderr)
            return 2

        fail_body = {
            "p_job_id": job_id,
            "p_lease_token": lease_token,
            "p_error": reason[:1000],
            "p_worker_id": worker_id,
        }
        res = call(f"{rest}/rpc/cockpit_fail_ask_ai_job", sb_key, fail_body, method="POST")
        if res is True:
            print(json.dumps({"ok": True, "job_id": job_id, "status": "failed"}))
            return 0

        print(json.dumps({
            "ok": False,
            "job_id": job_id,
            "error": "Failure recording rejected (expired lease, token mismatch, or job state conflict)",
            "detail": res,
        }), file=sys.stderr)
        return 1

    # Read-only SQL aggregate avoids truncated REST list counts.
    elif cmd == "health":
        state = call(f"{rest}/rpc/cockpit_ask_ai_health", sb_key, {}, method="POST")
        if not isinstance(state, dict) or any(type(state.get(k)) is not int or state[k] < 0 for k in ("queued","claimed","completed","failed")):
            print(json.dumps({"ok": False, "error": "Queue health unavailable", "detail": state}), file=sys.stderr)
            return 1
        print(json.dumps({"storage": "supabase", "queue_depth": state}, indent=2))
        return 0

    elif cmd in ("profile", "asks"):
        print(json.dumps({"ok": False, "error": "Legacy producer command is not migrated. Claim a chat job with pending/claim; use only its server-scoped context."}), file=sys.stderr)
        return 2

    # --- ANSWER -----------------------------------------------------------------
    elif cmd == "answer":
        if len(pos_args) < 3:
            print("Usage: askai.py answer <id> <file> --lease <token> [--apply]", file=sys.stderr)
            return 2
        ask_id = pos_args[1]
        path = pos_args[2]
        if not os.path.exists(path):
            print(json.dumps({"ok": False, "error": f"Answer file not found: {path}"}), file=sys.stderr)
            return 2
        with open(path, encoding="utf-8") as f:
            answer_text = f.read().strip()

        if not answer_text:
            print(json.dumps({"ok": False, "error": "Answer cannot be empty"}), file=sys.stderr)
            return 2

        if dry_run:
            print(json.dumps({
                "mode": "dry-run",
                "notice": f"Would answer question {ask_id}. Pass --apply to execute.",
                "id": ask_id,
                "answer_preview": answer_text[:200],
            }, indent=2))
            return 0

        # Require original lease token
        if not lease_token:
            print(json.dumps({
                "ok": False,
                "error": f"Missing required --lease flag for question {ask_id}. Stale token recovery from database is rejected."
            }), file=sys.stderr)
            return 2

        complete_res = call(f"{rest}/rpc/cockpit_complete_ask_ai_job", sb_key, {
            "p_job_id": ask_id,
            "p_lease_token": lease_token,
            "p_result": {"reply": answer_text},
            "p_worker_id": worker_id,
        }, method="POST")

        if complete_res is True:
            print(json.dumps({"ok": True, "job_id": ask_id, "status": "completed"}))
            return 0

        print(json.dumps({
            "ok": False,
            "error": f"Question job {ask_id} completion rejected (expired lease or worker mismatch)",
            "detail": complete_res,
        }), file=sys.stderr)
        return 1

    else:
        print(__doc__)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
