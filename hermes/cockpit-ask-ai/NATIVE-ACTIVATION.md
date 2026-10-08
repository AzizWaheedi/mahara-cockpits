# Cockpit Ask AI Native Activation Manifest & Acceptance Checklist

## Staging File List
- `hermes/cockpit-ask-ai/SKILL.md`
- `hermes/cockpit-ask-ai/scripts/askai.py`

## Required Named Keys
- `COCKPIT_SUPABASE_URL` (aliases: `DESK_SUPABASE_URL`, `SUPABASE_URL`, `VITE_SUPABASE_URL`)
- `SUPABASE_SERVICE_ROLE_KEY` (aliases: `COCKPIT_SUPABASE_KEY`, `DESK_SUPABASE_KEY`)
- Source: `/opt/data/bibi/api-keys.env` or shell environment (`askai.py:36-55`, `119-134`). No fallback keys or secret disclosure (`askai.py:118-156`).

## Actual Tested Command Shapes
All mutating actions require explicit `--apply`; dry run is default (`askai.py:164`).
```bash
# Doctor check (reports boolean configuration health without exposing tokens)
python3 hermes/cockpit-ask-ai/scripts/askai.py doctor

# Dry-run pending queue inspection (no state mutations)
python3 hermes/cockpit-ask-ai/scripts/askai.py pending --limit 5

# Dry-run health aggregation (returns counts for queued, claimed, completed, failed)
python3 hermes/cockpit-ask-ai/scripts/askai.py health

# Bounded pilot: atomic claim with lease token
python3 hermes/cockpit-ask-ai/scripts/askai.py claim --limit 1 --lease-seconds 300 --worker-id pilot-worker-1 --apply

# Post JSON result (strict lease enforcement, rejects stale token recovery)
python3 hermes/cockpit-ask-ai/scripts/askai.py result <job_id> <result_file.json> --lease <token> --worker-id pilot-worker-1 --apply

# Mark failure on error (strict lease enforcement)
python3 hermes/cockpit-ask-ai/scripts/askai.py fail <job_id> "<reason>" --lease <token> --worker-id pilot-worker-1 --apply
```

## Native Queue & Result Behavior
- Dedicated queue table: `public.cockpit_ask_ai_jobs` (`SKILL.md:9`, `askai.py:2`).
- Claims run via RPC `cockpit_claim_ask_ai_jobs` returning atomic `lease_token` (`askai.py:240-244`).
- Results submit via RPC `cockpit_complete_ask_ai_job` requiring original `--lease <token>` (`askai.py:291-300`).
- Fails submit via RPC `cockpit_fail_ask_ai_job` requiring original `--lease <token>` (`askai.py:340-349`).
- Expired leases or token mismatches fail closed with exit code 1 (`askai.py:307`, `356`).

## Fail-Closed & Fallback Constraints
- Convex fallback is strictly disabled and fails closed (`askai.py:152`, `186-194`).
- No generic proxy or credential forwarding (`askai.py:58-86`).
- Legacy commands `profile` and `asks` fail explicitly with exit code 2 (`askai.py:368-370`).

## Unsupported Producers & Callbacks
- `comment_digest`: ClickUp comment webhook processor unmigrated (`SKILL.md:79`).
- `call_brief`: CSM call recording processor unmigrated (`SKILL.md:80`).
- `assist_copy`, `draft_copy`, and campaign chat relays unmigrated (`SKILL.md:81`).
- Autonomous third-party provider mutations remain disabled (`SKILL.md:82`, `100`).
