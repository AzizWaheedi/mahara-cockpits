"""Read-only authentication and production RPC preflight. Never sends email or logs secrets."""
import argparse
import json
import os
import pathlib
import re
import urllib.request

PROJECT = "bldgtotkfmhoxmlzowdx"
PORTAL = "https://cockpit.maharamedia.com/"


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
    req = urllib.request.Request(f"https://api.supabase.com/v1/projects/{PROJECT}/{path}", data=data,
                                 headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json", "User-Agent": "Mahara-auth-preflight/1"})
    with urllib.request.urlopen(req, timeout=30) as response:
        return json.load(response)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", help="Read named management token locally; never printed")
    parser.add_argument("--config-file", help="Offline diagnostic fixture; does not verify production")
    args = parser.parse_args()
    try:
        if args.config_file:
            failures = check_config(json.loads(pathlib.Path(args.config_file).read_text(encoding="utf-8-sig")))
        else:
            token = token_from_env(args.env_file)
            failures = check_config(request(token, "config/auth"))
            rows = request(token, "database/query", {"read_only": True, "query": "select pg_get_functiondef(p.oid) as definition,p.prosecdef as secure,has_function_privilege('anon',p.oid,'EXECUTE') as anon_allowed,has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_allowed,(select relrowsecurity from pg_class where oid='public.cockpit_members'::regclass) as directory_rls from pg_proc p where p.oid='public.cockpit_get_my_access()'::regprocedure"})
            expected = pathlib.Path(__file__).resolve().parents[1] / "supabase/migrations/20261007b_cockpit_auth_contract.sql"
            if len(rows) != 1 or body(rows[0]["definition"]) != body(expected.read_text(encoding="utf-8")):
                failures.append("Live directory access function differs from the tested five-cockpit contract")
            if rows and (not rows[0]["secure"] or rows[0]["anon_allowed"] or not rows[0]["authenticated_allowed"] or not rows[0]["directory_rls"]):
                failures.append("Directory access security or grants changed")
            root = pathlib.Path(__file__).resolve().parents[1]
            catalog = request(token, "database/query", {"read_only": True, "query": "select coalesce(jsonb_agg(distinct p.proname),'[]'::jsonb) as functions from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'cockpit_%'"})
            if len(catalog) != 1:
                raise ValueError("Backend function catalog missing")
            missing = missing_backend_rpcs(production_rpc_names(root), catalog[0]["functions"])
            if missing:
                failures.append("Missing production cockpit RPCs: " + ", ".join(missing))
            if not missing:
                contracts = request(token, "database/query", {"read_only": True, "query": "select p.proname,pg_get_functiondef(p.oid) as definition,has_function_privilege('anon',p.oid,'EXECUTE') as anon_allowed from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('cockpit_has_active_seat','cockpit_team_guard_write','cockpit_log_decision')"})
                expected_files = {"cockpit_has_active_seat": "20261007d_cockpit_team_rpc_restore.sql", "cockpit_team_guard_write": "20261007g_cockpit_team_role_guard.sql", "cockpit_log_decision": "20261007f_cockpit_write_contract.sql"}
                for name, file in expected_files.items():
                    actual = [row for row in contracts if row["proname"] == name]
                    source = (root / "supabase/migrations" / file).read_text(encoding="utf-8")
                    definition = re.search(r"create or replace function public\." + name + r"\([\s\S]*?\$\$;", source, re.I)
                    if not definition or len(actual) != 1 or body(actual[0]["definition"]) != body(definition[0]) or actual[0]["anon_allowed"]:
                        failures.append("Live access or write contract changed: " + name)
        print(json.dumps({"status": "failed" if failures else "ok", "production_verified": not args.config_file and not failures, "failures": failures}))
        return int(bool(failures))
    except Exception as error:
        print(json.dumps({"status": "failed", "production_verified": False, "error": type(error).__name__, "message": "Auth preflight could not complete. Check management access and connectivity."}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
