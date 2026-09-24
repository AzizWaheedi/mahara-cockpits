#!/usr/bin/env python3
"""HTTP / Supabase helper for the cockpit Ask AI doors. Reads tokens from api-keys.env.

  askai.py pending              -> JSON list of open ad-copy jobs
  askai.py result <id> <file>   -> post the JSON answer in <file>
  askai.py fail <id> "<reason>" -> mark a job as not answerable this run
  askai.py asks                 -> JSON list of open client-success questions
  askai.py profile "<client>"   -> the stored client profile (JSON)
  askai.py answer <id> <file>   -> post the text answer in <file>
  askai.py health               -> queue depth on both doors
"""
import json
import os
import sys
import urllib.parse
import urllib.request

KEYS = "/opt/data/bibi/api-keys.env"
MEDIA_BUYER = "https://adorable-seahorse-418.convex.site"
CLIENT_SUCCESS = "https://impressive-dinosaur-375.convex.site"


def env() -> dict:
    out = dict(os.environ)
    if os.path.exists(KEYS):
        for line in open(KEYS):
            if "=" in line and not line.startswith("#"):
                k, v = line.split("=", 1)
                out[k.strip()] = v.strip()
    return out


def call(url: str, token: str, body: dict | None = None, method: str | None = None) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    http_method = method or ("POST" if data is not None else "GET")
    req = urllib.request.Request(
        url,
        data=data,
        method=http_method,
        headers={"Authorization": f"Bearer {token}", "apikey": token, "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            content = resp.read()
            return json.loads(content) if content else {"ok": True}
    except urllib.error.HTTPError as exc:
        return {"ok": False, "http": exc.code, "error": exc.read().decode()[:300]}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


def main() -> int:
    e = env()
    sb_url = (
        e.get("COCKPIT_SUPABASE_URL")
        or e.get("DESK_SUPABASE_URL")
        or e.get("VITE_SUPABASE_URL")
        or ""
    ).rstrip("/")
    sb_key = (
        e.get("COCKPIT_SUPABASE_KEY")
        or e.get("DESK_SUPABASE_KEY")
        or e.get("SUPABASE_SERVICE_ROLE_KEY")
        or ""
    )

    use_supabase = bool(sb_url and sb_key)
    ask_tok = e.get("COCKPIT_ASKAI_TOKEN", "")
    csm_tok = e.get("COCKPIT_CSM_BRIDGE_TOKEN", "")
    cmd = sys.argv[1] if len(sys.argv) > 1 else "health"

    if use_supabase:
        rest = f"{sb_url}/rest/v1"
        if cmd == "pending":
            out = call(f"{rest}/cockpit_creative_requests?status=eq.queued&select=*&limit=5", sb_key)
            print(json.dumps(out, ensure_ascii=False, indent=1))
        elif cmd == "result":
            job_id, path = sys.argv[2], sys.argv[3]
            result = json.load(open(path, encoding="utf-8"))
            out = call(
                f"{rest}/cockpit_creative_requests?id=eq.{job_id}",
                sb_key,
                {"status": "completed", "result": result},
                method="PATCH",
            )
            print(json.dumps(out))
        elif cmd == "fail":
            job_id, reason = sys.argv[2], sys.argv[3]
            out = call(
                f"{rest}/cockpit_creative_requests?id=eq.{job_id}",
                sb_key,
                {"status": "failed", "error": reason[:300]},
                method="PATCH",
            )
            print(json.dumps(out))
        elif cmd == "asks":
            out = call(f"{rest}/cockpit_issue_reports?category=eq.question&select=*&limit=10", sb_key)
            print(json.dumps(out, ensure_ascii=False, indent=1))
        elif cmd == "profile":
            client_name = sys.argv[2]
            safe_name = urllib.parse.quote(client_name)
            out = call(f"{rest}/cockpit_client_profiles?client_name=ilike.*{safe_name}*&select=*&limit=1", sb_key)
            print(json.dumps(out[0] if isinstance(out, list) and out else {}, ensure_ascii=False, indent=1))
        elif cmd == "answer":
            ask_id, path = sys.argv[2], sys.argv[3]
            answer = open(path, encoding="utf-8").read().strip()
            out = call(
                f"{rest}/cockpit_issue_reports?id=eq.{ask_id}",
                sb_key,
                {"metadata": {"answer": answer}, "status": "answered"},
                method="PATCH",
            )
            print(json.dumps(out))
        elif cmd == "health":
            pending = call(f"{rest}/cockpit_creative_requests?status=eq.queued&select=id", sb_key)
            asks = call(f"{rest}/cockpit_issue_reports?category=eq.question&select=id", sb_key)
            print(json.dumps({
                "storage": "supabase",
                "media_buyer_pending": len(pending) if isinstance(pending, list) else 0,
                "client_success_asks": len(asks) if isinstance(asks, list) else 0,
            }))
        else:
            print(__doc__)
            return 2
        return 0

    # Fallback to Convex HTTP routes if Supabase is not configured
    if cmd == "pending":
        out = call(f"{MEDIA_BUYER}/askai/pending?limit=5", ask_tok)
        print(json.dumps(out.get("jobs", out), ensure_ascii=False, indent=1))
    elif cmd == "result":
        job_id, path = sys.argv[2], sys.argv[3]
        result = json.load(open(path, encoding="utf-8"))
        print(json.dumps(call(f"{MEDIA_BUYER}/askai/result", ask_tok, {"id": job_id, "result": result})))
    elif cmd == "fail":
        job_id, reason = sys.argv[2], sys.argv[3]
        print(json.dumps(call(f"{MEDIA_BUYER}/askai/result", ask_tok, {"id": job_id, "error": reason[:300]})))
    elif cmd == "asks":
        out = call(f"{CLIENT_SUCCESS}/bridge", csm_tok, {"fn": "pendingAsks"})
        print(json.dumps(out.get("data", out), ensure_ascii=False, indent=1))
    elif cmd == "profile":
        out = call(f"{CLIENT_SUCCESS}/bridge", csm_tok, {"fn": "profileFor", "args": {"clientName": sys.argv[2]}})
        print(json.dumps(out.get("data", out), ensure_ascii=False, indent=1))
    elif cmd == "answer":
        ask_id, path = sys.argv[2], sys.argv[3]
        answer = open(path, encoding="utf-8").read().strip()
        print(json.dumps(call(f"{CLIENT_SUCCESS}/bridge", csm_tok, {"fn": "answerAsk", "args": {"id": ask_id, "answer": answer}})))
    elif cmd == "health":
        print(json.dumps({
            "storage": "convex",
            "media_buyer": call(f"{MEDIA_BUYER}/askai/health", ask_tok),
            "client_success_asks": len(call(f"{CLIENT_SUCCESS}/bridge", csm_tok, {"fn": "pendingAsks"}).get("data") or []),
        }))
    else:
        print(__doc__)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
