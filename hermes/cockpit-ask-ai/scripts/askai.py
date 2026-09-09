#!/usr/bin/env python3
"""HTTP helper for the cockpit Ask AI doors. Reads tokens from api-keys.env.

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


def call(url: str, token: str, body: dict | None = None) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        url,
        data=data,
        method="POST" if data is not None else "GET",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.load(resp)
    except urllib.error.HTTPError as exc:
        return {"ok": False, "http": exc.code, "error": exc.read().decode()[:300]}


def main() -> int:
    e = env()
    ask_tok = e.get("COCKPIT_ASKAI_TOKEN", "")
    csm_tok = e.get("COCKPIT_CSM_BRIDGE_TOKEN", "")
    cmd = sys.argv[1] if len(sys.argv) > 1 else "health"

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
            "media_buyer": call(f"{MEDIA_BUYER}/askai/health", ask_tok),
            "client_success_asks": len(call(f"{CLIENT_SUCCESS}/bridge", csm_tok, {"fn": "pendingAsks"}).get("data") or []),
        }))
    else:
        print(__doc__)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
