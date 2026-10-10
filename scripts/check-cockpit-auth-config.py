"""Read-only authentication and production RPC preflight. Never sends email or logs secrets.

It reads through a Supabase management token when one works. When no token is
found, or the token's first read answers 401 or 403, it reads through the
Composio CLI instead: GET requests through `composio proxy`, and single SELECT
queries through Composio's read-only SQL tool. Any other failure stops the
check; it is never a reason to switch.
"""
import argparse
import json
import os
import pathlib
import re
import shutil
import subprocess
import urllib.error
import urllib.request

PROJECT = "bldgtotkfmhoxmlzowdx"
PORTAL = "https://cockpit.maharamedia.com/"
MANAGEMENT = f"https://api.supabase.com/v1/projects/{PROJECT}/"
ROOT = pathlib.Path(__file__).resolve().parents[1]
COMPOSIO_TIMEOUT = 90
NO_COMPOSIO = "No working management token and no Composio CLI. Install composio and link Supabase, or set COCKPIT_MANAGEMENT_TOKEN."
NO_COMPOSIO_CHOSEN = "No Composio CLI. Install composio and link Supabase, or run with --via token."
NO_TOKEN = "No management token found. Set COCKPIT_MANAGEMENT_TOKEN or pass --env-file."
# Words that only appear in a statement that writes. A query naming one is
# refused before anything runs, even inside a string, because Composio's SQL
# tool quietly drops read_only for INSERT, UPDATE and DELETE.
WRITE_WORDS = re.compile(r"\b(insert|update|delete|merge|alter|drop|create|grant|revoke|truncate|copy|into|call|vacuum|lock|refresh|notify)\b", re.I)


class PreflightError(Exception):
    """A failure whose message is safe to print: it never carries a provider body or a secret."""

    def __init__(self, message, via=None):
        super().__init__(message)
        self.via = via


def check_config(config):
    failures = []
    checks = {
        "Auth must return to the production cockpit": config.get("site_url", "").rstrip("/") == PORTAL.rstrip("/"),
        "Production cockpit redirect must be allowed": PORTAL in config.get("uri_allow_list", "").split(","),
        "New unprivileged identities must support first-time code sign-in": config.get("disable_signup") is False,
        "Email authentication must be enabled": config.get("external_email_enabled") is True,
        "Email ownership must remain verified": config.get("mailer_autoconfirm") is False,
        "Configured email codes must use six digits": config.get("mailer_otp_length") == 6,
        "SMTP provider must be configured": bool(config.get("smtp_host")),
        "SMTP user must be configured": bool(config.get("smtp_user")),
        "SMTP sender must be configured": bool(config.get("smtp_admin_email")),
        "Shared email capacity must support the team": isinstance(config.get("rate_limit_email_sent"), (int, float)) and config["rate_limit_email_sent"] >= 30,
    }
    for template in ("magic_link", "confirmation", "recovery"):
        body = config.get(f"mailer_templates_{template}_content") or ""
        checks[f"{template} email must contain the full code"] = bool(re.search(r"{{\s*\.Token\s*}}", body))
    checks["Recovery email must use the working code form"] = ".ConfirmationURL" not in (config.get("mailer_templates_recovery_content") or "")
    for message, passed in checks.items():
        if not passed:
            failures.append(message)
    return failures


def body(sql):
    match = re.search(r"AS\s+(\$[a-zA-Z0-9_]*\$)(.*?)\1", sql, re.S | re.I)
    if not match:
        raise ValueError("Access function body missing")
    return " ".join(re.sub(r"--[^\n]*", "", match[2]).split())


def token_from_env(env_file):
    for name in ("COCKPIT_MANAGEMENT_TOKEN", "SUPABASE_ACCESS_TOKEN", "supabase_token"):
        if os.environ.get(name):
            return os.environ[name]
    if env_file:
        for line in pathlib.Path(env_file).read_text(encoding="utf-8-sig").splitlines():
            key, separator, value = line.partition("=")
            if separator and key in ("COCKPIT_MANAGEMENT_TOKEN", "SUPABASE_ACCESS_TOKEN", "supabase_token"):
                return value.strip().strip("\"'")
    raise ValueError("Management token unavailable for read-only auth verification")


def browser_rpc_names(root):
    names = set()
    pattern = re.compile(r'\.rpc\(\s*["\'](cockpit_[a-z0-9_]+)["\']')
    for path in (root / "apps").glob("*/src/**/*"):
        if not path.is_file() or path.suffix not in (".ts", ".tsx", ".js", ".jsx"):
            continue
        if "dev" in path.relative_to(root / "apps").parts or re.search(r"\.(test|spec)\.", path.name):
            continue
        names.update(pattern.findall(path.read_text(encoding="utf-8")))
    return names


def missing_backend_rpcs(expected, actual):
    if not isinstance(actual, list) or not all(isinstance(name, str) for name in actual):
        raise ValueError("The backend function catalog must be a real array")
    return sorted(expected - set(actual))


def production_rpc_names(root):
    names = browser_rpc_names(root)
    patterns = [
        re.compile(r'\.rpc\(\s*["\'](cockpit_[a-z0-9_]+)["\']'),
        re.compile(r'\b(?:rpc|callRpc)\([^,\n]+,\s*["\'](cockpit_[a-z0-9_]+)["\']'),
        re.compile(r'/rpc/(cockpit_[a-z0-9_]+)'),
    ]
    for area in (root / "supabase/functions", root / "hermes"):
        for directory, children, files in os.walk(area):
            children[:] = [name for name in children if name not in ("node_modules", "dist", "test", "tests", ".venv", "__pycache__")]
            for name in files:
                path = pathlib.Path(directory) / name
                if path.suffix not in (".ts", ".tsx", ".js", ".py") or re.search(r"\.(test|spec)\.|^test_|^smoke\.", name):
                    continue
                source = path.read_text(encoding="utf-8")
                for pattern in patterns:
                    names.update(pattern.findall(source))
    return names


def request(token, path, payload=None):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(MANAGEMENT + path, data=data,
                                 headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json", "User-Agent": "Mahara-auth-preflight/1"})
    with urllib.request.urlopen(req, timeout=30) as response:
        return json.load(response)


def select_only(query):
    """One SELECT, nothing else: refused before anything runs."""
    text = query.strip()
    if text.endswith(";"):
        text = text[:-1].rstrip()
    if not re.match(r"select\b", text, re.I) or ";" in text or WRITE_WORDS.search(text):
        raise ValueError("The preflight runs one SELECT query and nothing else")
    return query


def require_keys(answer, required, path):
    # The Composio proxy exits 0 on a 404 and prints {"message": "Cannot GET ..."},
    # so the answer's shape is the only proof the read worked.
    if not isinstance(answer, dict) or any(key not in answer for key in required):
        raise PreflightError(f"The {path} read answered without {', '.join(required)} (a 404 or an error body)")
    return answer


def parse_json(text):
    text = (text or "").strip()
    try:
        return json.loads(text)
    except ValueError:
        # Tolerate a notice the CLI may print before its JSON answer.
        starts = [index for index in (text.find("{"), text.find("[")) if index > 0]
        if not starts:
            raise
        return json.loads(text[min(starts):])


def find_composio(name="composio"):
    found = shutil.which(name)
    if found:
        return found
    local = pathlib.Path.home() / ".local/bin" / name
    return str(local) if local.is_file() and os.access(local, os.X_OK) else None


class TokenReader:
    via = "token"

    def __init__(self, token, fetch):
        self._token = token
        self._fetch = fetch

    def get(self, path, required=()):
        return require_keys(self._fetch(self._token, path), required, path)

    def sql(self, query):
        select_only(query)
        rows = self._fetch(self._token, "database/query", {"read_only": True, "query": query})
        if not isinstance(rows, list):
            raise PreflightError("The management API's SQL read gave no rows", self.via)
        return rows


class ComposioReader:
    """GET through `composio proxy` and SELECT through the read-only SQL tool. Never a method, body or header flag."""

    via = "composio"

    def __init__(self, binary, run):
        self._binary = binary
        self._run = run

    def _call(self, args, what):
        try:
            done = self._run([self._binary, *args], stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=COMPOSIO_TIMEOUT)
        except subprocess.TimeoutExpired:
            raise PreflightError(f"Composio gave no answer to {what} within {COMPOSIO_TIMEOUT} seconds", self.via) from None
        except OSError:
            raise PreflightError("The Composio CLI could not start", self.via) from None
        if done.returncode != 0:
            raise PreflightError(f"Composio stopped with code {done.returncode} on {what}. If the Supabase connection lapsed, run composio link supabase.", self.via)
        try:
            return parse_json(done.stdout)
        except ValueError:
            raise PreflightError(f"Composio's answer to {what} was not JSON", self.via) from None

    def get(self, path, required=()):
        if not re.fullmatch(r"[a-z0-9_]+(/[a-z0-9_-]+)*", path):
            raise ValueError("The preflight reads fixed management paths only")
        answer = self._call(["proxy", MANAGEMENT + path, "--toolkit", "supabase"], f"GET {path}")
        try:
            return require_keys(answer, required, path)
        except PreflightError as error:
            raise PreflightError(str(error), self.via) from None

    def sql(self, query):
        select_only(query)
        answer = self._call(["execute", "SUPABASE_BETA_RUN_SQL_QUERY", "-d", json.dumps({"ref": PROJECT, "query": query, "read_only": True})], "a SQL read")
        data = answer.get("data") if isinstance(answer, dict) and answer.get("successful") is True else None
        rows = data.get("result") if isinstance(data, dict) else None
        if not isinstance(rows, list):
            raise PreflightError("Composio's read-only SQL read failed", self.via)
        return rows


def open_reader(via, env_file, fetch, run, which):
    """Return (reader, auth config). Composio is used only when no token works, or when chosen."""
    token = None
    if via != "composio":
        try:
            token = token_from_env(env_file)
        except ValueError:
            if via == "token":
                raise PreflightError(NO_TOKEN, "token") from None
    if token:
        reader = TokenReader(token, fetch)
        try:
            return reader, reader.get("config/auth", ("site_url",))
        except urllib.error.HTTPError as error:
            if via == "token" or error.code not in (401, 403):
                raise
    binary = which("composio")
    if not binary:
        raise PreflightError(NO_COMPOSIO if via == "auto" else NO_COMPOSIO_CHOSEN)
    reader = ComposioReader(binary, run)
    return reader, reader.get("config/auth", ("site_url",))


def live_contract_failures(reader, root):
    failures = []
    rows = reader.sql("select pg_get_functiondef(p.oid) as definition,p.prosecdef as secure,has_function_privilege('anon',p.oid,'EXECUTE') as anon_allowed,has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_allowed,(select relrowsecurity from pg_class where oid='public.cockpit_members'::regclass) as directory_rls from pg_proc p where p.oid='public.cockpit_get_my_access()'::regprocedure")
    expected = root / "supabase/migrations/20261007b_cockpit_auth_contract.sql"
    if len(rows) != 1 or body(rows[0]["definition"]) != body(expected.read_text(encoding="utf-8")):
        failures.append("Live directory access function differs from the tested five-cockpit contract")
    if rows and (not rows[0]["secure"] or rows[0]["anon_allowed"] or not rows[0]["authenticated_allowed"] or not rows[0]["directory_rls"]):
        failures.append("Directory access security or grants changed")
    catalog = reader.sql("select coalesce(jsonb_agg(distinct p.proname),'[]'::jsonb) as functions from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'cockpit_%'")
    if len(catalog) != 1:
        raise ValueError("Backend function catalog missing")
    missing = missing_backend_rpcs(production_rpc_names(root), catalog[0]["functions"])
    if missing:
        failures.append("Missing production cockpit RPCs: " + ", ".join(missing))
    if not missing:
        contracts = reader.sql("select p.proname,pg_get_functiondef(p.oid) as definition,has_function_privilege('anon',p.oid,'EXECUTE') as anon_allowed from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('cockpit_has_active_seat','cockpit_team_guard_write','cockpit_log_decision')")
        expected_files = {"cockpit_has_active_seat": "20261007d_cockpit_team_rpc_restore.sql", "cockpit_team_guard_write": "20261007g_cockpit_team_role_guard.sql", "cockpit_log_decision": "20261007f_cockpit_write_contract.sql"}
        for name, file in expected_files.items():
            actual = [row for row in contracts if row["proname"] == name]
            source = (root / "supabase/migrations" / file).read_text(encoding="utf-8")
            definition = re.search(r"create or replace function public\." + name + r"\([\s\S]*?\$\$;", source, re.I)
            if not definition or len(actual) != 1 or body(actual[0]["definition"]) != body(definition[0]) or actual[0]["anon_allowed"]:
                failures.append("Live access or write contract changed: " + name)
    return failures


def main(argv=None, fetch=None, run=None, which=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--env-file", help="Read named management token locally; never printed")
    parser.add_argument("--config-file", help="Offline diagnostic fixture; does not verify production")
    parser.add_argument("--via", choices=("auto", "token", "composio"), default="auto",
                        help="auto (default): the token, or Composio when no token works; token or composio: that one only")
    args = parser.parse_args(argv)
    reader = None
    try:
        if args.config_file:
            failures = check_config(json.loads(pathlib.Path(args.config_file).read_text(encoding="utf-8-sig")))
            print(json.dumps({"status": "failed" if failures else "ok", "production_verified": False, "failures": failures}))
            return int(bool(failures))
        reader, config = open_reader(args.via, args.env_file, fetch or request, run or subprocess.run, which or find_composio)
        failures = check_config(config) + live_contract_failures(reader, ROOT)
        print(json.dumps({"status": "failed" if failures else "ok", "production_verified": not failures, "via": reader.via, "failures": failures}))
        return int(bool(failures))
    except PreflightError as error:
        print(json.dumps({"status": "failed", "production_verified": False, "via": error.via or (reader and reader.via), "message": str(error)}))
        return 1
    except urllib.error.HTTPError as error:
        print(json.dumps({"status": "failed", "production_verified": False, "via": "token", "error": "HTTPError", "message": f"The management API answered {error.code}. Check management access."}))
        return 1
    except Exception as error:
        print(json.dumps({"status": "failed", "production_verified": False, "via": reader and reader.via, "error": type(error).__name__, "message": "Auth preflight could not complete. Check management access and connectivity."}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
