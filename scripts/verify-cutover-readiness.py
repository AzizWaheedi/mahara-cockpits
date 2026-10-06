#!/usr/bin/env python3
r"""
Production Cutover Readiness & Verification Tool.

Default mode is RELEASE (read-only, zero database writes/deployments).
Missing or invalid acceptance evidence exits nonzero.

Strictly separates LOCAL CHECKS PASSED from RELEASE READY.
Rejects stale dist artifacts, schema-only claims, dummy-key tests,
and unverified evidence.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
from typing import Any, Dict, List, Optional, Tuple

APP_NAMES = [
    "media-buyer-cockpit",
    "client-success-cockpit",
    "creative-director-cockpit",
    "video-editor-cockpit",
    "sales-cockpit",
]

# Explicitly removed: apps/media-buyer-cockpit/scripts/supabase-actions.test.ts
# RATIONALE: supabase-actions.test.ts performs live HTTP calls to Supabase using
# dummy API keys ("anon-dummy-key") and expects HTTP 401/400. That tests API
# gateway key rejection, NOT application authorization, RLS enforcement, or RPC
# security logic. It creates an external network dependency and gives false confidence.
RELEVANT_TEST_FILES = [
    "apps/media-buyer-cockpit/scripts/supabase-access.test.ts",
    "apps/media-buyer-cockpit/scripts/cockpit-self-adoption.test.ts",
    "apps/media-buyer-cockpit/scripts/cockpit-editor-identity.test.ts",
    "apps/media-buyer-cockpit/scripts/cockpit-sales-directory-gate.test.ts",
    "apps/video-editor-cockpit/scripts/format.test.ts",
    "apps/media-buyer-cockpit/scripts/csm-growth-supabase.test.ts",
    "apps/media-buyer-cockpit/scripts/ceo-costs-supabase.test.ts",
    "apps/media-buyer-cockpit/scripts/costs-model.test.ts",
    "scripts/native-feed.test.ts",
    "scripts/native-admin.test.ts",
    "scripts/native-preview.test.ts",
    "scripts/native-calendars.test.ts",
    "scripts/native-calendar-providers.test.ts",
    "scripts/native-whatsapp.test.ts",
    "scripts/native-stills.test.ts",
    "scripts/native-whatsapp-history.test.ts",
    "scripts/native-onboarding.test.ts",
    "apps/client-success-cockpit/scripts/check-in.test.ts",
    "apps/client-success-cockpit/scripts/csm-page.test.tsx",
    "apps/client-success-cockpit/scripts/onboarding.test.ts",
    "scripts/test_import_cockpit_runtime_sources.py",
    "hermes/cockpit-sync/csmProducer.test.ts",
    "hermes/media-native/test/mediaNative.test.ts",
    "hermes/media-native/test/queue.test.ts",
    "hermes/media-native/test/calendarBinding.test.ts",
    "hermes/media-native/test/client.test.ts",
    "hermes/media-native/test/runtime.test.ts",
    "apps/media-buyer-cockpit/scripts/snapshot-rpc-contracts.test.ts",
    "apps/media-buyer-cockpit/scripts/ceo-goals-supabase.test.ts",
    "apps/media-buyer-cockpit/scripts/ceo-people-supabase.test.ts",
    "apps/media-buyer-cockpit/scripts/ceo-manual-payments-supabase.test.ts",
    "apps/media-buyer-cockpit/scripts/csm-state-supabase.test.ts",
    "apps/media-buyer-cockpit/scripts/supabase-ask-ai.test.ts",
    "apps/media-buyer-cockpit/scripts/eod-delivery-supabase.test.ts",
    "apps/media-buyer-cockpit/scripts/personal-eod-supabase.test.ts",
    "hermes/cockpit-ask-ai/scripts/test_askai.py",
    "hermes/eod-out/test_out.py",
    "scripts/test_plan_manual_payments_import.py",
    "apps/media-buyer-cockpit/scripts/cockpit-test-db.test.ts",
    "apps/media-buyer-cockpit/scripts/webinar-supabase-targets.test.ts",
    "apps/media-buyer-cockpit/scripts/webinar-target-access.test.ts",
    "apps/media-buyer-cockpit/scripts/webinar-targets.test.ts",
    "apps/media-buyer-cockpit/scripts/webinar-ingestion.test.ts",
    "apps/media-buyer-cockpit/scripts/reporting-view-access.test.ts",
    "apps/media-buyer-cockpit/scripts/frameio-webhook.test.ts",
    "apps/media-buyer-cockpit/scripts/billing.test.ts",
    "apps/media-buyer-cockpit/scripts/webinar.test.ts",
    "apps/creative-director-cockpit/scripts/social.test.ts",
    "apps/sales-cockpit/src/lib/pay.test.ts",
    "apps/sales-cockpit/src/lib/goals.test.ts",
    "apps/sales-cockpit/src/lib/env.test.ts",
    "apps/sales-cockpit/src/components/Prose.test.tsx",
    "apps/media-buyer-cockpit/scripts/team.test.ts",
    "apps/media-buyer-cockpit/scripts/team-supabase-access.test.ts",
]

MANDATORY_EVIDENCE_SUBCHECKS: Dict[str, List[str]] = {
    "auth_and_access_journeys": [
        "allowed_roles",
        "forbidden_roles",
        "cross_client_isolation",
        "revoked_user_rejection",
    ],
    "persisted_saves_across_refresh": [
        "media_buyer_cockpit",
        "client_success_cockpit",
        "creative_director_cockpit",
        "video_editor_cockpit",
        "sales_cockpit",
        "portal",
        "ceo_admin",
    ],
    "reconciled_history_and_catchup": [
        "data_reconciliation",
        "catchup_sync",
    ],
    "worker_lifecycle": [
        "worker_success",
        "worker_failure",
        "worker_retry",
    ],
    "network_traffic_convex_blocked": [
        "browser_convex_independence",
        "server_convex_independence",
        "worker_convex_independence",
    ],
    "production_config_and_rollback": [
        "production_exact_sha",
        "production_config",
        "rollback_procedure",
    ],
}


def find_executable(name: str) -> Optional[str]:
    """Discover executable portably on PATH."""
    w = shutil.which(name)
    if w:
        return w
    if sys.platform == "win32":
        for ext in [".exe", ".cmd", ".bat"]:
            w = shutil.which(f"{name}{ext}")
            if w:
                return w
    return None


def find_git_bash() -> Optional[str]:
    """Locate Git Bash on Windows or bash on Unix."""
    if sys.platform == "win32":
        candidates = [
            r"C:\Program Files\Git\bin\bash.exe",
            r"C:\Program Files\Git\usr\bin\bash.exe",
            r"C:\Program Files (x86)\Git\bin\bash.exe",
            r"C:\Program Files (x86)\Git\usr\bin\bash.exe",
            os.path.expandvars(r"%LOCALAPPDATA%\Programs\Git\bin\bash.exe"),
        ]
        for c in candidates:
            if Path(c).is_file():
                return c
    w = shutil.which("bash")
    if w and "System32" not in w:
        return w
    return None


def run_command(
    cmd: List[str],
    cwd: Path,
    timeout: int = 180,
    env: Optional[Dict[str, str]] = None,
) -> Tuple[int, str, str, Dict[str, Any]]:
    """
    Execute command strictly with shell=False.
    Captures UTF-8 output with errors=replace and logs both success and failure.
    """
    exec_env = os.environ.copy()
    if env:
        exec_env.update(env)

    start_time = datetime.now(timezone.utc)
    try:
        proc = subprocess.run(
            cmd,
            cwd=str(cwd),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
            shell=False,
            env=exec_env,
        )
        duration_s = (datetime.now(timezone.utc) - start_time).total_seconds()
        log_entry = {
            "cmd": cmd,
            "cwd": str(cwd),
            "returncode": proc.returncode,
            "stdout": proc.stdout,
            "stderr": proc.stderr,
            "duration_s": round(duration_s, 2),
        }
        return proc.returncode, proc.stdout, proc.stderr, log_entry
    except subprocess.TimeoutExpired as exc:
        duration_s = (datetime.now(timezone.utc) - start_time).total_seconds()
        out = exc.stdout if isinstance(exc.stdout, str) else (exc.stdout.decode("utf-8", errors="replace") if exc.stdout else "")
        err = exc.stderr if isinstance(exc.stderr, str) else (exc.stderr.decode("utf-8", errors="replace") if exc.stderr else "")
        log_entry = {
            "cmd": cmd,
            "cwd": str(cwd),
            "returncode": -1,
            "stdout": out,
            "stderr": f"Command timed out after {timeout}s: {err}",
            "duration_s": round(duration_s, 2),
        }
        return -1, out, f"Command timed out after {timeout} seconds: {err}", log_entry
    except FileNotFoundError as exc:
        duration_s = (datetime.now(timezone.utc) - start_time).total_seconds()
        log_entry = {
            "cmd": cmd,
            "cwd": str(cwd),
            "returncode": -2,
            "stdout": "",
            "stderr": f"Executable not found: {cmd[0]} ({exc})",
            "duration_s": round(duration_s, 2),
        }
        return -2, "", f"Executable not found: {cmd[0]} ({exc})", log_entry
    except Exception as exc:
        duration_s = (datetime.now(timezone.utc) - start_time).total_seconds()
        log_entry = {
            "cmd": cmd,
            "cwd": str(cwd),
            "returncode": -3,
            "stdout": "",
            "stderr": f"Execution error: {exc}",
            "duration_s": round(duration_s, 2),
        }
        return -3, "", f"Execution error: {exc}", log_entry


def get_git_info(repo_root: Path) -> Dict[str, Any]:
    """Retrieve git HEAD exact 40-hex SHA and explicitly clean status."""
    git_bin = find_executable("git")
    if not git_bin:
        return {"available": False, "sha": None, "is_dirty": None, "error": "git executable not found on PATH"}

    rc, sha_out, err, _ = run_command([git_bin, "rev-parse", "HEAD"], cwd=repo_root, timeout=15)
    if rc != 0:
        return {"available": True, "sha": None, "is_dirty": None, "error": f"git rev-parse HEAD failed: {err.strip()}"}

    sha = sha_out.strip()
    if not re.match(r"^[0-9a-fA-F]{40}$", sha):
        return {"available": True, "sha": sha, "is_dirty": None, "error": f"git HEAD SHA is not a 40-character hex string: '{sha}'"}

    rc_status, status_out, status_err, _ = run_command([git_bin, "status", "--porcelain"], cwd=repo_root, timeout=15)
    if rc_status != 0:
        return {"available": True, "sha": sha, "is_dirty": None, "error": f"git status failed: {status_err.strip()}"}

    is_dirty = bool(status_out.strip())
    return {"available": True, "sha": sha, "is_dirty": is_dirty, "dirty_files": status_out.strip().splitlines() if is_dirty else [], "error": None}


def check_app_structure(repo_root: Path) -> Tuple[bool, List[str]]:
    """Verify all 5 cockpit applications and required configurations exist."""
    failures = []
    apps_dir = repo_root / "apps"
    if not apps_dir.is_dir():
        return False, [f"Missing apps directory: {apps_dir}"]

    for app in APP_NAMES:
        app_path = apps_dir / app
        if not app_path.is_dir():
            failures.append(f"Missing cockpit directory: apps/{app}")
            continue

        required_files = [
            "package.json",
            "tsconfig.json",
            "tsconfig.app.json",
            "tsconfig.node.json",
            "vite.config.ts",
        ]
        for rf in required_files:
            if not (app_path / rf).is_file():
                failures.append(f"Missing configuration apps/{app}/{rf}")

        if not (app_path / "src").is_dir():
            failures.append(f"Missing source directory apps/{app}/src")

    return (len(failures) == 0), failures


def check_no_convex_source_imports(repo_root: Path) -> Tuple[bool, List[str]]:
    """
    Scan production source imports. Isolated src/dev fixtures are excluded;
    importing those fixtures from other source files is rejected.
    NOTE: Proves absence of static source imports only; does not certify full
    runtime Convex independence.
    """
    import_re = re.compile(r'(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*)["\']([^"\']+)["\']')
    found: List[str] = []

    for app in APP_NAMES:
        src_dir = repo_root / "apps" / app / "src"
        if not src_dir.is_dir():
            continue
        for p in src_dir.rglob("*"):
            if not p.is_file() or p.name.endswith(".d.ts"):
                continue
            if p.suffix not in (".ts", ".tsx", ".js", ".jsx"):
                continue
            try:
                content = p.read_text(encoding="utf-8", errors="ignore")
                relative = p.relative_to(src_dir)
                if relative.parts[0] == "dev":
                    continue
                for spec in import_re.findall(content):
                    if "/dev/" in spec or spec.startswith("dev/"):
                        found.append(f"{p.relative_to(repo_root).as_posix()} (production import of dev fixture: {spec})")
                    elif (spec == "convex" or spec.startswith(("convex/", "@convex-dev/", "_generated/"))
                          or "/_generated/" in spec):
                        found.append(p.relative_to(repo_root).as_posix())
            except Exception as exc:
                found.append(f"{p.as_posix()} (read error: {exc})")

    if found:
        return False, [f"Convex import detected in {f}" for f in found]
    return True, []


def strip_imports_awk_equivalent(text: str) -> str:
    """
    Drop import lines identically to scripts/check-shared.sh body() awk script:
    !started && (/^import / || /^} from / || /^  [A-Za-z{}]/ && importing) { importing = 1; next }
    /^$/ && importing { next }
    { started = 1; print }
    """
    lines = text.splitlines()
    body_lines = []
    started = False
    importing = False
    for line in lines:
        if not started:
            is_import_lead = bool(re.match(r"^import ", line) or re.match(r"^} from ", line))
            is_import_cont = bool(importing and re.match(r"^  [A-Za-z{}]", line))
            if is_import_lead or is_import_cont:
                importing = True
                continue
            if importing and line == "":
                continue
            started = True
            body_lines.append(line)
        else:
            body_lines.append(line)
    return "\n".join(body_lines)


def check_shared_files(repo_root: Path) -> Tuple[bool, List[str]]:
    """
    Preserve shared check semantics exactly matching scripts/check-shared.sh.
    Invokes check-shared.sh with Git Bash if available, and also verifies
    in pure Python without inventing extra files.
    """
    failures: List[str] = []

    bash_bin = find_git_bash()
    shared_script = repo_root / "scripts" / "check-shared.sh"
    if bash_bin and shared_script.is_file():
        rc, stdout, stderr, _ = run_command([bash_bin, str(shared_script)], cwd=repo_root, timeout=60)
        if rc != 0:
            failures.append(f"scripts/check-shared.sh failed:\n{stdout}\n{stderr}")
            return False, failures

    # Python exact parity check
    cd = repo_root / "apps" / "creative-director-cockpit"
    mb = repo_root / "apps" / "media-buyer-cockpit"
    ed = repo_root / "apps" / "video-editor-cockpit"
    cs = repo_root / "apps" / "client-success-cockpit"

    def compare_files(label: str, path_a: Path, path_b: Path) -> None:
        if not path_a.is_file():
            failures.append(f"Missing shared file: {path_a.relative_to(repo_root).as_posix()}")
            return
        if not path_b.is_file():
            failures.append(f"Missing shared file: {path_b.relative_to(repo_root).as_posix()}")
            return

        text_a = path_a.read_text(encoding="utf-8", errors="replace")
        text_b = path_b.read_text(encoding="utf-8", errors="replace")
        body_a = strip_imports_awk_equivalent(text_a)
        body_b = strip_imports_awk_equivalent(text_b)

        if body_a != body_b:
            failures.append(
                f"Shared file drift: {label} ({path_a.relative_to(repo_root).as_posix()} != {path_b.relative_to(repo_root).as_posix()})"
            )

    shared_quads = [
        "src/pages/IdeationPage.tsx",
        "src/pages/SwipePage.tsx",
        "src/components/Foreplay.tsx",
        "src/lib/foreplay.ts",
    ]
    for rel in shared_quads:
        compare_files(rel, cd / rel, mb / rel)
        compare_files(rel, cd / rel, ed / rel)

    compare_files("adAsIdea (CD vs MB)", cd / "convex" / "adAsIdea.ts", mb / "convex" / "adAsIdea.ts")
    compare_files("adAsIdea (CD vs ED)", cd / "convex" / "adAsIdea.ts", ed / "src" / "lib" / "adAsIdea.ts")
    compare_files("convex/foreplay.ts", cd / "convex" / "foreplay.ts", mb / "convex" / "foreplay.ts")
    compare_files("convex/billingCore.ts", mb / "convex" / "billingCore.ts", cs / "convex" / "billingCore.ts")
    compare_files("askAiClient (MB vs CSM)", mb / "src/lib/askAiClient.ts", cs / "src/lib/askAiClient.ts")
    compare_files("askAiClient (MB vs Creative)", mb / "src/lib/askAiClient.ts", cd / "src/lib/askAiClient.ts")
    compare_files("personalEod (MB vs CSM)", mb / "src/lib/personalEod.ts", cs / "src/lib/personalEod.ts")
    compare_files("personalEod (MB vs Creative)", mb / "src/lib/personalEod.ts", cd / "src/lib/personalEod.ts")
    compare_files(
        "BillingSheet.tsx",
        mb / "src" / "components" / "billing" / "BillingSheet.tsx",
        cs / "src" / "components" / "billing" / "BillingSheet.tsx",
    )

    # IdeaRowShapeTests check (hermes vs adAsIdea.ts)
    hermes_test = repo_root / "hermes" / "editor-desk" / "tests" / "test_desk.py"
    cd_ad_idea = cd / "convex" / "adAsIdea.ts"
    if hermes_test.is_file() and cd_ad_idea.is_file():
        h_text = hermes_test.read_text(encoding="utf-8", errors="replace")
        ts_text = cd_ad_idea.read_text(encoding="utf-8", errors="replace")
        # Extract fields from python
        m_py = re.search(r'#: Kept identical to IDEA_FIELDS\s+IDEA_FIELDS\s*=\s*\[(.*?)\]', h_text, re.DOTALL)
        # Extract fields from typescript
        m_ts = re.search(r'export const IDEA_FIELDS\s*=\s*\[(.*?)\]\s*as const', ts_text, re.DOTALL)
        if m_py and m_ts:
            py_fields = sorted(re.findall(r'"([a-z_]+)"', m_py.group(1)))
            ts_fields = sorted(re.findall(r'"([a-z_]+)"', m_ts.group(1)))
            if py_fields != ts_fields:
                failures.append(f"Ideation row fields drifted between Python and TypeScript:\nPython: {py_fields}\nTS: {ts_fields}")

    # Biome version pin check
    biome_versions: Dict[str, str] = {}
    for app in APP_NAMES:
        pkg_path = repo_root / "apps" / app / "package.json"
        if not pkg_path.is_file():
            continue
        try:
            pkg_data = json.loads(pkg_path.read_text(encoding="utf-8"))
            v = pkg_data.get("devDependencies", {}).get("@biomejs/biome") or pkg_data.get("dependencies", {}).get("@biomejs/biome")
            if not v:
                failures.append(f"apps/{app}/package.json missing @biomejs/biome dependency")
            else:
                biome_versions[app] = v
                if v.startswith("^") or v.startswith("~"):
                    failures.append(f"apps/{app} @biomejs/biome is not strictly pinned: {v}")
        except Exception as exc:
            failures.append(f"Failed to parse apps/{app}/package.json: {exc}")

    if len(set(biome_versions.values())) > 1:
        failures.append(f"@biomejs/biome version drift across apps: {biome_versions}")

    return (len(failures) == 0), failures


def find_app_tool(app_dir: Path, tool_rel_js: str, tool_rel_bin: str) -> Optional[Tuple[str, List[str]]]:
    """
    Locate installed tool inside app's node_modules to avoid globally mismatched
    compilers or bunx/npx auto-downloads.
    Returns (tool_type, cmd_prefix) or None.
    """
    runner = find_executable("node") or find_executable("bun")
    if not runner:
        return None

    # Check installed per-app tool file
    js_candidate = app_dir / tool_rel_js
    if js_candidate.is_file():
        return ("node_script", [runner, str(js_candidate.resolve())])

    # Check .bin candidate
    bin_candidate = app_dir / tool_rel_bin
    if bin_candidate.is_file():
        return ("bin", [str(bin_candidate.resolve())])
    if sys.platform == "win32":
        for ext in [".cmd", ".exe", ".bat"]:
            cand = app_dir / f"{tool_rel_bin}{ext}"
            if cand.is_file():
                return ("bin", [str(cand.resolve())])

    # Check repo_root level node_modules
    repo_root = app_dir.parent.parent
    root_js = repo_root / tool_rel_js
    if root_js.is_file():
        return ("node_script", [runner, str(root_js.resolve())])
    root_bin = repo_root / tool_rel_bin
    if root_bin.is_file():
        return ("bin", [str(root_bin.resolve())])
    if sys.platform == "win32":
        for ext in [".cmd", ".exe", ".bat"]:
            cand = repo_root / f"{tool_rel_bin}{ext}"
            if cand.is_file():
                return ("bin", [str(cand.resolve())])

    return None


def run_fresh_typechecks(
    repo_root: Path,
    tsc_custom: Optional[str] = None,
    timeout: int = 180,
    command_logs: Optional[List[Dict[str, Any]]] = None,
) -> Tuple[bool, List[str], Dict[str, Any]]:
    """
    Run fresh typechecks with explicit app and node project configs.
    Uses installed per-app typescript compiler (node_modules/typescript/bin/tsc).
    Fails if dependencies are absent.
    """
    failures: List[str] = []
    details: Dict[str, Any] = {}

    for app in APP_NAMES:
        app_dir = repo_root / "apps" / app
        app_details: Dict[str, Any] = {}

        if tsc_custom:
            cmd_prefix = [tsc_custom]
        else:
            tool = find_app_tool(
                app_dir,
                tool_rel_js="node_modules/typescript/bin/tsc",
                tool_rel_bin="node_modules/.bin/tsc",
            )
            if not tool:
                msg = f"Missing installed TypeScript dependency for apps/{app} (apps/{app}/node_modules/typescript/bin/tsc not found). Install dependencies first."
                failures.append(msg)
                details[app] = {"status": "fail", "error": msg}
                continue
            cmd_prefix = tool[1]

        for cfg in ["tsconfig.app.json", "tsconfig.node.json"]:
            cfg_path = app_dir / cfg
            if not cfg_path.is_file():
                failures.append(f"Missing {cfg} in apps/{app}")
                app_details[cfg] = {"status": "fail", "error": f"{cfg} missing"}
                continue

            cmd = cmd_prefix + ["-p", cfg, "--noEmit"]
            rc, stdout, stderr, log_entry = run_command(cmd, cwd=app_dir, timeout=timeout)
            if command_logs is not None:
                command_logs.append(log_entry)

            if rc != 0:
                err_msg = stderr.strip() or stdout.strip() or f"exit code {rc}"
                failures.append(f"Typecheck failed for apps/{app} ({cfg}): {err_msg[:200]}")
                app_details[cfg] = {"status": "fail", "exit_code": rc, "error": err_msg[:500]}
            else:
                app_details[cfg] = {"status": "pass"}

        details[app] = app_details

    return (len(failures) == 0), failures, details


def run_fresh_vite_builds(
    repo_root: Path,
    vite_custom: Optional[str] = None,
    timeout: int = 180,
    command_logs: Optional[List[Dict[str, Any]]] = None,
) -> Tuple[bool, List[str], Dict[str, Any]]:
    """
    Run fresh Vite builds for all 5 apps into temporary new output folders.
    Uses installed per-app vite (node_modules/vite/bin/vite.js).
    Fails if dependencies are absent.
    """
    failures: List[str] = []
    details: Dict[str, Any] = {}

    for app in APP_NAMES:
        app_dir = repo_root / "apps" / app

        if vite_custom:
            cmd_prefix = [vite_custom]
        else:
            tool = find_app_tool(
                app_dir,
                tool_rel_js="node_modules/vite/bin/vite.js",
                tool_rel_bin="node_modules/.bin/vite",
            )
            if not tool:
                msg = f"Missing installed Vite dependency for apps/{app} (apps/{app}/node_modules/vite/bin/vite.js not found). Install dependencies first."
                failures.append(msg)
                details[app] = {"status": "fail", "error": msg}
                continue
            cmd_prefix = tool[1]

        temp_out = Path(tempfile.mkdtemp(prefix=f"cutover_build_{app}_"))
        try:
            cmd = cmd_prefix + ["build", "--outDir", str(temp_out), "--emptyOutDir"]
            rc, stdout, stderr, log_entry = run_command(cmd, cwd=app_dir, timeout=timeout)
            if command_logs is not None:
                command_logs.append(log_entry)

            if rc != 0:
                err_msg = stderr.strip() or stdout.strip() or f"exit code {rc}"
                failures.append(f"Vite build failed for apps/{app}: {err_msg[:250]}")
                details[app] = {"status": "fail", "exit_code": rc, "error": err_msg[:500]}
                continue

            index_html = temp_out / "index.html"
            if not index_html.is_file() or index_html.stat().st_size == 0:
                failures.append(f"Fresh build output apps/{app} missing or empty index.html")
                details[app] = {"status": "fail", "error": "index.html missing or 0 bytes"}
            else:
                details[app] = {
                    "status": "pass",
                    "output_size_bytes": index_html.stat().st_size,
                    "fresh_temp_verified": True,
                }
        finally:
            shutil.rmtree(temp_out, ignore_errors=True)

    return (len(failures) == 0), failures, details


def run_relevant_tests(
    repo_root: Path,
    bun_exe: Optional[str] = None,
    timeout: int = 180,
    command_logs: Optional[List[Dict[str, Any]]] = None,
) -> Tuple[bool, List[str], Dict[str, Any]]:
    """Run explicitly chosen relevant automated test suites."""
    failures: List[str] = []
    details: Dict[str, Any] = {}

    bun_bin = bun_exe or find_executable("bun")
    if not bun_bin:
        return False, ["bun executable not found on PATH for test execution"], details

    for test_rel in RELEVANT_TEST_FILES:
        test_path = repo_root / test_rel
        if not test_path.is_file():
            failures.append(f"Test suite file missing: {test_rel}")
            details[test_rel] = {"status": "fail", "error": "file missing"}
            continue

        is_python = test_path.suffix == ".py"
        cmd = ([sys.executable, "-m", "unittest", "discover", "-s", str(test_path.parent), "-p", test_path.name]
               if is_python else [bun_bin, "test", test_rel])
        rc, stdout, stderr, log_entry = run_command(cmd, cwd=repo_root, timeout=timeout)
        if command_logs is not None:
            command_logs.append(log_entry)

        if rc == 0 and is_python and not re.search(r"Ran [1-9][0-9]* tests?\b", stdout + stderr):
            rc = 1
            stderr = "Python discovery did not confirm that any tests ran. " + stderr
        if rc != 0:
            err_msg = stderr.strip() or stdout.strip() or f"exit code {rc}"
            failures.append(f"Test suite failed ({test_rel}): {err_msg[:250]}")
            details[test_rel] = {"status": "fail", "exit_code": rc, "error": err_msg[:500]}
        else:
            details[test_rel] = {"status": "pass"}

    return (len(failures) == 0), failures, details


def compute_file_sha256(path: Path) -> str:
    """Compute sha256 hex digest of file."""
    h = hashlib.sha256()
    with path.open("rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()


def verify_release_evidence(
    evidence_path: Optional[Path],
    repo_root: Path,
    current_sha: Optional[str],
    is_dirty: Optional[bool],
    max_age_hours: float = 24.0,
) -> Tuple[bool, List[str], Dict[str, Any]]:
    """
    Validate independently produced acceptance evidence for Release mode.

    NOTE: Hashing validates artifact file integrity, NOT proof semantics.
    Independent human review is required before production authorization.

    Requirements:
    - Evidence file exists and parses as valid JSON
    - Bound to exact 40-hex source SHA matching current git HEAD
    - Git worktree is explicitly clean
    - Known source_identity and evaluator (cannot be missing or unknown)
    - Fresh timestamp with finite bounded age (>0 and <= max_age_hours <= 24.0)
    - Full cutover requires all six categories and exact mandatory subchecks passed
    - Explicitly approved ship-first requires native five-app browser navigation proof
    - Ship-first defers history offline and never authorizes Convex retirement
    - Every selected check has nonempty hashed artifact refs that exist and match sha256
    """
    failures: List[str] = []
    details: Dict[str, Any] = {
        "disclaimer": "File hashing validates artifact integrity against tampering, NOT proof semantics. Human review is required."
    }

    # Bounded max_age_hours validation
    if not (isinstance(max_age_hours, (int, float)) and math.isfinite(max_age_hours) and 0.0 < max_age_hours <= 24.0):
        failures.append(f"Invalid max_evidence_age_hours ({max_age_hours}): must be a finite number > 0 and <= 24.0")
        return False, failures, {"error": "Invalid max_evidence_age_hours"}

    if not evidence_path or not evidence_path.is_file():
        path_str = str(evidence_path) if evidence_path else "<none>"
        failures.append(f"Release mode requires acceptance evidence, but file was not found: {path_str}")
        return False, failures, {"error": "Evidence file not found"}

    try:
        data = json.loads(evidence_path.read_text(encoding="utf-8"))
    except Exception as exc:
        failures.append(f"Malformed evidence JSON in {evidence_path}: {exc}")
        return False, failures, {"error": f"JSON parse error: {exc}"}

    if not isinstance(data, dict):
        failures.append("Evidence root must be a JSON object")
        return False, failures, {"error": "Root not object"}

    details["evidence_file"] = str(evidence_path.resolve())

    # 1. Source Identity and Evaluator validation
    source_identity = data.get("source_identity")
    if not isinstance(source_identity, str) or not source_identity.strip() or source_identity.strip().lower() == "unknown":
        failures.append("Evidence missing or unknown 'source_identity'")
    details["source_identity"] = source_identity

    evaluator = data.get("evaluator")
    if not isinstance(evaluator, str) or not evaluator.strip() or evaluator.strip().lower() == "unknown":
        failures.append("Evidence missing or unknown 'evaluator'")
    details["evaluator"] = evaluator

    # 2. SHA and Clean Worktree verification
    evidence_sha = data.get("source_sha") or data.get("git_sha")
    if not isinstance(evidence_sha, str) or not re.fullmatch(r"[0-9a-fA-F]{40}", evidence_sha):
        failures.append(f"Evidence missing valid 40-hex 'source_sha': got '{evidence_sha}'")
    elif not current_sha or evidence_sha.lower() != current_sha.lower():
        failures.append(
            f"Evidence SHA mismatch: evidence binds '{evidence_sha}', current git HEAD is '{current_sha}'"
        )
    details["evidence_sha"] = evidence_sha
    details["current_sha"] = current_sha

    if is_dirty is not False:
        failures.append("Release evidence requires an explicitly clean git worktree (dirty files detected)")
    details["clean_worktree_verified"] = (is_dirty is False)

    # 3. Freshness check with finite bounds
    recorded_at_str = data.get("recorded_at") or data.get("timestamp")
    if not recorded_at_str:
        failures.append("Evidence missing required 'recorded_at' timestamp")
    else:
        try:
            iso_norm = recorded_at_str.replace("Z", "+00:00")
            dt = datetime.fromisoformat(iso_norm)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            now = datetime.now(timezone.utc)
            age_seconds = (now - dt).total_seconds()
            if age_seconds < -300:
                failures.append(f"Evidence timestamp is in the future: {recorded_at_str}")
            age_hours = age_seconds / 3600.0
            details["evidence_age_hours"] = round(age_hours, 2)
            if age_hours > max_age_hours:
                failures.append(
                    f"Evidence is expired ({age_hours:.1f} hours old > max allowed {max_age_hours} hours)"
                )
        except Exception as exc:
            failures.append(f"Invalid evidence timestamp format '{recorded_at_str}': {exc}")

    # 4. Select the approved acceptance contract without relabeling full-cutover evidence.
    release_contract = data.get("release_contract", "full-cutover")
    details["release_contract"] = release_contract
    details["full_cutover_ready"] = False
    required_subchecks = MANDATORY_EVIDENCE_SUBCHECKS
    categories = data.get("categories")
    if release_contract == "ship-first":
        ship_first = data.get("ship_first")
        if not isinstance(ship_first, dict):
            failures.append("Ship-first requires an explicit approval and baseline evidence")
            return False, failures, details
        approved_by = ship_first.get("approved_by")
        if ship_first.get("approved") is not True or not isinstance(approved_by, str) or not approved_by.strip() or approved_by.strip().lower() == "unknown":
            failures.append("Ship-first requires a named approver and approved: true")
        backfill = ship_first.get("historical_backfill")
        if not isinstance(backfill, dict) or backfill.get("status") != "deferred_offline":
            failures.append("Ship-first must explicitly defer historical backfill offline")
        if data.get("convex_retirement_authorized") is not False:
            failures.append("Ship-first must keep Convex retirement unauthorized")
        categories = ship_first.get("categories")
        required_subchecks = {
            "native_browser_baseline": ["authenticated_five_cockpit_navigation"],
        }
        if isinstance(categories, dict):
            baseline = categories.get("native_browser_baseline")
            checks = baseline.get("checks") if isinstance(baseline, dict) else None
            navigation = checks.get("authenticated_five_cockpit_navigation") if isinstance(checks, dict) else None
            if isinstance(navigation, dict):
                apps = navigation.get("apps")
                if not isinstance(apps, list) or not all(isinstance(app, str) for app in apps) or sorted(apps) != sorted(APP_NAMES):
                    failures.append("Ship-first navigation must cover all five distinct cockpit apps")
                for metric in ("convex_http_requests", "unapproved_application_writes"):
                    if type(navigation.get(metric)) is not int or navigation[metric] != 0:
                        failures.append(f"Ship-first navigation requires {metric}: 0")
        details["historical_backfill"] = backfill
        details["convex_retirement_authorized"] = False
    elif release_contract != "full-cutover":
        failures.append(f"Unknown release_contract: {release_contract!r}")
        return False, failures, details
    if not isinstance(categories, dict):
        failures.append("Evidence missing 'categories' dictionary")
        return False, failures, details

    details["categories"] = {}

    for cat_name, req_subchecks in required_subchecks.items():
        if cat_name not in categories:
            failures.append(f"Missing mandatory evidence category: '{cat_name}'")
            continue

        cat_data = categories[cat_name]
        if not isinstance(cat_data, dict):
            failures.append(f"Evidence category '{cat_name}' must be an object")
            continue

        cat_status = cat_data.get("status")
        if cat_status != "passed":
            failures.append(f"Evidence category '{cat_name}' status must be 'passed', got '{cat_status}'")

        cat_checks = cat_data.get("checks")
        if not isinstance(cat_checks, dict):
            failures.append(f"Evidence category '{cat_name}' missing required 'checks' dictionary")
            continue

        cat_artifacts = cat_data.get("artifacts", [])
        if not isinstance(cat_artifacts, list):
            failures.append(f"Category '{cat_name}' artifacts must be a list")
            cat_artifacts = []

        cat_details: Dict[str, Any] = {
            "status": cat_status,
            "subchecks_verified": [],
            "artifacts_verified": [],
        }

        # Check all mandatory subchecks
        for sub_name in req_subchecks:
            if sub_name not in cat_checks:
                failures.append(f"Missing mandatory subcheck: '{cat_name}.{sub_name}'")
                continue

            sub_val = cat_checks[sub_name]
            if not isinstance(sub_val, dict):
                failures.append(f"Subcheck '{cat_name}.{sub_name}' must be an object")
                continue

            sub_st = sub_val.get("status")
            if sub_st != "passed":
                failures.append(f"Subcheck '{cat_name}.{sub_name}' status must be 'passed', got '{sub_st}'")

            # Validate that this subcheck has associated nonempty hashed artifacts
            sub_artifacts = sub_val.get("artifacts") or cat_artifacts
            if not sub_artifacts:
                failures.append(f"Subcheck '{cat_name}.{sub_name}' has no associated artifact references")
            else:
                cat_details["subchecks_verified"].append(sub_name)

        # Validate artifact files and hashes
        all_artifacts = list(cat_artifacts)
        for check_name, check_data in cat_checks.items():
            if not isinstance(check_data, dict):
                failures.append(f"Malformed check: {cat_name}.{check_name}")
                continue
            if check_data.get("status") != "passed":
                failures.append(f"Unpassed check: {cat_name}.{check_name}")
            refs = check_data.get("artifacts", [])
            if not isinstance(refs, list):
                failures.append(f"Artifact references must be a list: {cat_name}.{check_name}")
                continue
            all_artifacts.extend(refs)
        if not all_artifacts:
            failures.append(f"Category '{cat_name}' contains no artifact files")

        for art in all_artifacts:
            if not isinstance(art, dict):
                failures.append(f"Malformed artifact entry in category '{cat_name}'")
                continue
            art_rel = art.get("path")
            expected_hash = art.get("sha256")
            if not isinstance(art_rel, str) or not art_rel.strip() or not isinstance(expected_hash, str):
                failures.append(f"Artifact in '{cat_name}' missing required 'path' or 'sha256'")
                continue

            if not re.match(r"^[0-9a-fA-F]{64}$", str(expected_hash)):
                failures.append(f"Artifact in '{cat_name}' has invalid sha256 hex digest: '{expected_hash}'")
                continue

            art_path = repo_root / art_rel
            if not art_path.is_file():
                art_path = evidence_path.parent / art_rel
            if not art_path.is_file():
                failures.append(f"Artifact file not found: {art_rel}")
                continue

            actual_hash = compute_file_sha256(art_path)
            if actual_hash.lower() != expected_hash.lower():
                failures.append(
                    f"Artifact hash mismatch for {art_rel}: expected {expected_hash}, computed {actual_hash}"
                )
            else:
                cat_details["artifacts_verified"].append(art_rel)

        details["categories"][cat_name] = cat_details

    details["full_cutover_ready"] = not failures and release_contract == "full-cutover"

    return (len(failures) == 0), failures, details


def verify_cutover(
    repo_root: Path,
    mode: str = "release",
    evidence_path: Optional[Path] = None,
    report_path: Optional[Path] = None,
    max_age_hours: float = 24.0,
    expected_sha: Optional[str] = None,
    bun_path: Optional[str] = None,
    tsc_path: Optional[str] = None,
    vite_path: Optional[str] = None,
    skip_builds: bool = False,
    skip_typechecks: bool = False,
    skip_tests: bool = False,
    timeout: int = 180,
) -> Tuple[int, Dict[str, Any]]:
    """Execute cutover verification pipeline and return (exit_code, report_dict)."""
    command_logs: List[Dict[str, Any]] = []
    initial_git = get_git_info(repo_root)
    now_iso = datetime.now(timezone.utc).isoformat()

    report: Dict[str, Any] = {
        "tool": "verify-cutover-readiness",
        "timestamp": now_iso,
        "mode": mode,
        "repo_root": str(repo_root.resolve()),
        "initial_git": initial_git,
        "checks": {},
        "failures": [],
        "command_logs": command_logs,
        "local_checks_passed": False,
        "release_ready": False,
        "status": "INITIALIZING",
    }

    print("=" * 72)
    print("MAHARA COCKPITS -> SUPABASE CUTOVER READINESS VERIFIER")
    print(f"Mode: {mode.upper()} | Repo: {repo_root.resolve()}")
    if initial_git.get("available"):
        print(f"Git HEAD: {initial_git.get('sha')} (clean={not initial_git.get('is_dirty')})")
    print("=" * 72)

    # Validate finite bounds of max_age_hours
    if not (isinstance(max_age_hours, (int, float)) and math.isfinite(max_age_hours) and 0.0 < max_age_hours <= 24.0):
        err = f"Invalid --max-evidence-age-hours: {max_age_hours}. Must be finite number > 0 and <= 24.0."
        print(f"[FAIL] {err}")
        report["failures"].append(err)
        report["status"] = "FAILED"
        return 1, report

    # Expected SHA check (must assert equality with current HEAD, never override it)
    if expected_sha:
        current_sha = initial_git.get("sha")
        if not current_sha or expected_sha.lower() != current_sha.lower():
            err = f"Expected SHA assertion failed: --expected-sha '{expected_sha}' does not match git HEAD '{current_sha}'."
            print(f"[FAIL] {err}")
            report["failures"].append(err)
            report["status"] = "FAILED"
            return 1, report

    has_diagnostic_skips = skip_builds or skip_typechecks or skip_tests

    # Rule 3: Skip flags in release mode are strictly rejected
    if mode in ("release", "all") and has_diagnostic_skips:
        err = "Skip flags (--skip-builds, --skip-typechecks, --skip-tests) are forbidden in release mode."
        print(f"[FAIL] {err}")
        report["failures"].append(err)
        report["status"] = "FAILED"
        return 1, report

    all_local_passed = True

    # 1. Structure Check
    print("\n[1/5] Validating Cockpit Structure and Project Configurations...")
    struct_ok, struct_fails = check_app_structure(repo_root)
    report["checks"]["structure"] = {"passed": struct_ok, "failures": struct_fails}
    if struct_ok:
        print("  [PASS] All 5 cockpit apps and required configs present")
    else:
        all_local_passed = False
        report["failures"].extend(struct_fails)
        for f in struct_fails:
            print(f"  [FAIL] {f}")

    # 2. Source Scan for Convex Imports
    print("\n[2/5] Scanning Source Files for Static Convex Imports...")
    imports_ok, import_fails = check_no_convex_source_imports(repo_root)
    report["checks"]["no_convex_source_imports"] = {
        "passed": imports_ok,
        "failures": import_fails,
        "note": "Proves no detected static source imports in apps/*/src; not full runtime Convex independence proof.",
    }
    if imports_ok:
        print("  [PASS] No detected Convex imports in production source; isolated dev fixtures excluded")
    else:
        all_local_passed = False
        report["failures"].extend(import_fails)
        for f in import_fails:
            print(f"  [FAIL] {f}")

    # 3. Shared Files Validation
    print("\n[3/5] Validating Shared Components, Helpers, and Biome Pinning...")
    shared_ok, shared_fails = check_shared_files(repo_root)
    report["checks"]["shared_files"] = {"passed": shared_ok, "failures": shared_fails}
    if shared_ok:
        print("  [PASS] Shared files and Biome dependencies are strictly in sync")
    else:
        all_local_passed = False
        report["failures"].extend(shared_fails)
        for f in shared_fails:
            print(f"  [FAIL] {f}")

    # 4. Fresh Typechecks (explicit app and node project configs)
    print("\n[4/5] Running Fresh Typechecks with Installed Per-App Compilers...")
    if skip_typechecks:
        print("  [SKIP] Typechecks skipped by diagnostic flag")
        report["checks"]["typechecks"] = {"passed": False, "skipped": True}
    else:
        tc_ok, tc_fails, tc_details = run_fresh_typechecks(
            repo_root, tsc_custom=tsc_path, timeout=timeout, command_logs=command_logs
        )
        report["checks"]["typechecks"] = {"passed": tc_ok, "details": tc_details, "failures": tc_fails}
        if tc_ok:
            print("  [PASS] Fresh typechecks passed for all 5 cockpits (app + node)")
        else:
            all_local_passed = False
            report["failures"].extend(tc_fails)
            for f in tc_fails:
                print(f"  [FAIL] {f}")

    # 5. Fresh Vite Builds (isolated temp directories, no stale dist accepted)
    print("\n[5/5] Running Fresh Vite Builds into Isolated Temporary Directories...")
    if skip_builds:
        print("  [SKIP] Fresh builds skipped by diagnostic flag")
        report["checks"]["fresh_builds"] = {"passed": False, "skipped": True}
    else:
        bld_ok, bld_fails, bld_details = run_fresh_vite_builds(
            repo_root, vite_custom=vite_path, timeout=timeout, command_logs=command_logs
        )
        report["checks"]["fresh_builds"] = {"passed": bld_ok, "details": bld_details, "failures": bld_fails}
        if bld_ok:
            print("  [PASS] Fresh Vite builds succeeded into temporary folders")
        else:
            all_local_passed = False
            report["failures"].extend(bld_fails)
            for f in bld_fails:
                print(f"  [FAIL] {f}")

    # Automated Unit and Access Tests
    print("\n[Tests] Running Relevant Offline Automated Test Suites...")
    if skip_tests:
        print("  [SKIP] Tests skipped by diagnostic flag")
        report["checks"]["test_suites"] = {"passed": False, "skipped": True}
    else:
        tests_ok, tests_fails, tests_details = run_relevant_tests(
            repo_root, bun_exe=bun_path, timeout=timeout, command_logs=command_logs
        )
        report["checks"]["test_suites"] = {"passed": tests_ok, "details": tests_details, "failures": tests_fails}
        if tests_ok:
            print(f"  [PASS] All {len(RELEVANT_TEST_FILES)} offline test suites green")
        else:
            all_local_passed = False
            report["failures"].extend(tests_fails)
            for f in tests_fails:
                print(f"  [FAIL] {f}")

    # Check source state again after all commands have run
    post_git = get_git_info(repo_root)
    report["post_git"] = post_git
    if post_git.get("error") or not post_git.get("available") or not post_git.get("sha"):
        all_local_passed = False
        report["failures"].append("Cannot verify source identity after checks")
    elif post_git.get("sha") != initial_git.get("sha"):
        all_local_passed = False
        report["failures"].append("Source commit changed during checks; rerun against one unchanged commit")
    if post_git.get("available") and post_git.get("is_dirty"):
        dirty_msg = f"Worktree was dirtied during execution: {post_git.get('dirty_files')}"
        all_local_passed = False
        report["failures"].append(dirty_msg)
        print(f"  [FAIL] {dirty_msg}")

    report["local_checks_passed"] = all_local_passed and not has_diagnostic_skips

    all_release_passed = True
    if mode in ("release", "all"):
        print("\n" + "-" * 72)
        print("RELEASE ACCEPTANCE EVIDENCE VERIFICATION")
        print("-" * 72)

        ev_ok, ev_fails, ev_details = verify_release_evidence(
            evidence_path=evidence_path,
            repo_root=repo_root,
            current_sha=initial_git.get("sha"),
            is_dirty=post_git.get("is_dirty"),
            max_age_hours=max_age_hours,
        )
        report["checks"]["release_evidence"] = {
            "passed": ev_ok,
            "details": ev_details,
            "failures": ev_fails,
        }
        report["release_contract"] = ev_details.get("release_contract")
        if ev_ok:
            print("  [PASS] Acceptance evidence verified (clean SHA, fresh timestamp, valid artifact hashes)")
        else:
            all_release_passed = False
            report["failures"].extend(ev_fails)
            for f in ev_fails:
                print(f"  [FAIL] {f}")
    else:
        report["checks"]["release_evidence"] = {
            "passed": False,
            "skipped": True,
            "reason": "Not run in local mode. Use --mode release to evaluate cutover readiness.",
        }

    # Final Status and Decision
    print("\n" + "=" * 72)
    exit_code = 0
    if mode == "local":
        if has_diagnostic_skips:
            report["status"] = "INCOMPLETE"
            report["summary"] = "LOCAL CHECKS INCOMPLETE: One or more checks skipped by diagnostic flags."
            print("RESULT: LOCAL CHECKS INCOMPLETE (diagnostic skips active).")
            exit_code = 1
        elif all_local_passed:
            report["status"] = "LOCAL_PASSED"
            report["summary"] = "LOCAL CHECKS PASSED: Build, typecheck, tests, and shared code are clean."
            print("RESULT: LOCAL CHECKS PASSED.")
            print("NOTE: Local pass does NOT certify release readiness. Release mode requires --mode release with valid acceptance evidence.")
            exit_code = 0
        else:
            report["status"] = "FAILED"
            report["summary"] = "LOCAL CHECKS FAILED: See failure list in report."
            print("RESULT: LOCAL CHECKS FAILED. Review failures above.")
            exit_code = 1
    else:  # release mode (default)
        if all_local_passed and all_release_passed and not has_diagnostic_skips:
            report["status"] = "RELEASE_READY"
            report["release_ready"] = True
            report["full_cutover_ready"] = ev_details.get("full_cutover_ready", False)
            if report["release_contract"] == "ship-first":
                report["summary"] = "SHIP-FIRST RELEASE READY: Local gates and approved native browser baseline verified. History remains offline; full cutover and Convex retirement are not certified."
                print("RESULT: SHIP-FIRST RELEASE READY. Historical backfill remains offline; Convex retirement is not authorized.")
            else:
                report["summary"] = "RELEASE READY: All local verifications and independent acceptance evidence verified."
                print("RESULT: RELEASE READY FOR CUTOVER.")
            exit_code = 0
        else:
            report["status"] = "FAILED"
            report["release_ready"] = False
            reasons = []
            if not all_local_passed:
                reasons.append("local checks failed")
            if not all_release_passed:
                reasons.append("release acceptance evidence missing or invalid")
            report["summary"] = f"NOT READY FOR CUTOVER: {', '.join(reasons)}."
            print(f"RESULT: NOT READY FOR CUTOVER ({', '.join(reasons)}).")
            exit_code = 1

    print("=" * 72)

    # Report write failure must cause nonzero exit and release_ready false
    if report_path:
        try:
            report_path = Path(report_path)
            report_path.parent.mkdir(parents=True, exist_ok=True)
            report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
            print(f"Machine-readable report written to: {report_path.resolve()}")
        except Exception as exc:
            err = f"Failed to write machine-readable report to {report_path}: {exc}"
            print(f"[FAIL] {err}")
            report["failures"].append(err)
            report["status"] = "FAILED"
            report["release_ready"] = False
            exit_code = 1

    return exit_code, report


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Verify cutover readiness from Convex to Supabase with strict proof separation."
    )
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=Path(__file__).resolve().parent.parent,
        help="Path to repository root (default: script parent dir).",
    )
    parser.add_argument(
        "--mode",
        choices=["local", "release", "all"],
        default="release",
        help="Verification mode: 'release' (default, requires acceptance evidence) or 'local' (build/type/test/shared).",
    )
    parser.add_argument(
        "--evidence",
        type=Path,
        default=None,
        help="Path to independent acceptance evidence JSON file (required for release mode; default: evidence/cutover-acceptance.json).",
    )
    parser.add_argument(
        "--report",
        type=Path,
        default=None,
        help="Optional path to output machine-readable JSON verification report.",
    )
    parser.add_argument(
        "--max-evidence-age-hours",
        type=float,
        default=24.0,
        help="Maximum allowed age of acceptance evidence in hours (finite number > 0 and <= 24.0, default: 24.0).",
    )
    parser.add_argument(
        "--expected-sha",
        type=str,
        default=None,
        help="Assert equality with current clean git HEAD (never overrides HEAD).",
    )
    parser.add_argument(
        "--bun-path",
        type=str,
        default=None,
        help="Custom path to bun binary.",
    )
    parser.add_argument(
        "--tsc-path",
        type=str,
        default=None,
        help="Custom path to tsc binary.",
    )
    parser.add_argument(
        "--vite-path",
        type=str,
        default=None,
        help="Custom path to vite binary.",
    )
    parser.add_argument(
        "--skip-builds",
        action="store_true",
        help="Diagnostic skip for Vite builds (forbidden in release; marks local incomplete).",
    )
    parser.add_argument(
        "--skip-typechecks",
        action="store_true",
        help="Diagnostic skip for typechecks (forbidden in release; marks local incomplete).",
    )
    parser.add_argument(
        "--skip-tests",
        action="store_true",
        help="Diagnostic skip for tests (forbidden in release; marks local incomplete).",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=180,
        help="Timeout in seconds for external commands (default: 180).",
    )
    return parser


def main(argv: Optional[List[str]] = None) -> int:
    parser = build_arg_parser()
    args = parser.parse_args(argv)

    evidence_file = args.evidence
    if not evidence_file and args.mode in ("release", "all"):
        default_ev = args.repo_root / "evidence" / "cutover-acceptance.json"
        evidence_file = default_ev

    exit_code, _ = verify_cutover(
        repo_root=args.repo_root,
        mode=args.mode,
        evidence_path=evidence_file,
        report_path=args.report,
        max_age_hours=args.max_evidence_age_hours,
        expected_sha=args.expected_sha,
        bun_path=args.bun_path,
        tsc_path=args.tsc_path,
        vite_path=args.vite_path,
        skip_builds=args.skip_builds,
        skip_typechecks=args.skip_typechecks,
        skip_tests=args.skip_tests,
        timeout=args.timeout,
    )
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
