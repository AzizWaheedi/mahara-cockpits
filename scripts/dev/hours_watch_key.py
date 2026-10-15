"""Store the screenshot-check key for Hubstaff watch. Runs ON THE VPS, where the keys live:

  ssh -i ~/.ssh/faris-key hermes@187.77.156.166 'python3 - openai' < scripts/dev/hours_watch_key.py
  ssh ... 'python3 - google_ai' < scripts/dev/hours_watch_key.py

It reads OPENAI_API_KEY or GOOGLE_AI_API_KEY from /opt/data/bibi/api-keys.env and the Supabase
service key from the native runtime file, tests the key with one model-list call, then saves it
through the service-only RPC cockpit_hours_watch_key_put, so the key goes server to server and
never through a chat, Composio or the browser. It prints no secret.

OpenAI is the default: OpenAI does not train on API data, and the screenshots show leads' details
in the dialer and the CRM. A Google key from a project without billing may have its content used
by Google, so use google_ai only with a billed project.
"""
import json
import pathlib
import sys
import urllib.error
import urllib.request

PROVIDERS = {
    "openai": ("OPENAI_API_KEY", "https://api.openai.com/v1/models", lambda k: {"Authorization": "Bearer " + k}),
    "google_ai": ("GOOGLE_AI_API_KEY", "https://generativelanguage.googleapis.com/v1beta/models?pageSize=5", lambda k: {"x-goog-api-key": k}),
}


def main() -> None:
    provider = sys.argv[1] if len(sys.argv) > 1 else "openai"
    if provider not in PROVIDERS:
        raise SystemExit("Name openai or google_ai.")
    env_name, test_url, auth = PROVIDERS[provider]

    env = {}
    for line in open("/opt/data/bibi/api-keys.env", errors="ignore"):
        line = line.strip()
        if "=" in line and not line.startswith("#"):
            k, v = line.split("=", 1)
            env[k.replace("export ", "").strip()] = v.strip().strip('"').strip("'")
    key = env.get(env_name, "")
    if not key:
        raise SystemExit(f"{env_name} is empty on this server.")

    cur = pathlib.Path("/home/hermes/cockpit-native-current")
    runtime = pathlib.Path("/home/hermes/.cockpit-native-state") / f"runtime-{cur.resolve().name}.json"
    rt = json.loads(runtime.read_text())
    url = (rt.get("SUPABASE_URL") or "https://bldgtotkfmhoxmlzowdx.supabase.co").rstrip("/")
    service = rt.get("SUPABASE_SERVICE_ROLE_KEY")
    if not service:
        raise SystemExit("The native runtime file has no SUPABASE_SERVICE_ROLE_KEY.")

    try:
        urllib.request.urlopen(urllib.request.Request(test_url, headers=auth(key)), timeout=30).read()
        print(f"{provider}: the key works.")
    except urllib.error.HTTPError as e:
        raise SystemExit(f"{provider} refused the key: HTTP {e.code}. Nothing was saved.")

    body = json.dumps({"p": {"provider": provider, "secret": key, "savedBy": "aziz@maharamedia.com",
                             "state": "connected", "stateNote": "Saved from the server's api-keys.env"}}).encode()
    req = urllib.request.Request(url + "/rest/v1/rpc/cockpit_hours_watch_key_put", data=body, method="POST",
                                 headers={"apikey": service, "Authorization": "Bearer " + service,
                                          "Content-Type": "application/json"})
    try:
        out = urllib.request.urlopen(req, timeout=30).read().decode()
        print("Saved:", out[:200].replace(key, "[key]"))
    except urllib.error.HTTPError as e:
        raise SystemExit("Save refused: %s %s" % (e.code, e.read()[:300].decode().replace(key, "[key]")))


if __name__ == "__main__":
    main()
