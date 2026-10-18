#!/usr/bin/env python3
"""Verify cockpit ownership and source before promoting a staged production build."""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent.parent


def verify(link, expected):
    if any(link.get(key) != expected[key] for key in ("projectId", "orgId")):
        raise ValueError(
            f"Wrong Vercel project link. {expected['domain']} belongs to "
            f"{expected['projectName']} ({expected['projectId']}). "
            "Verify the live alias before repairing .vercel/project.json."
        )


def verify_owner(deployment, expected):
    if not deployment.get("id") or deployment.get("projectId") != expected["projectId"] or deployment.get("ownerId") != expected["orgId"]:
        raise ValueError("The deployment or production origin belongs to another project or team.")


def verify_deployment(deployment, expected, sha):
    verify_owner(deployment, expected)
    if not deployment.get("id") or deployment.get("readyState") != "READY" or deployment.get("target") != "production":
        raise ValueError("The candidate must be an identified READY production deployment.")
    meta = deployment.get("meta") or {}
    if not re.fullmatch(r"[0-9a-f]{40}", sha) or (meta.get("gitCommitSha") or meta.get("githubCommitSha")) != sha:
        raise ValueError("The deployment source does not match the exact release commit.")


def verify_unchanged_origin(before, after, expected):
    verify_owner(before, expected)
    verify_owner(after, expected)
    if not before.get("id") or before["id"] != after.get("id"):
        raise ValueError("The production origin changed during the plan. Check the concurrent release first.")


def verify_entries(candidate_html, portal_html):
    pattern = r'src=["\']([^"\']*index-[A-Za-z0-9_-]+\.js)["\']'
    candidate = re.search(pattern, candidate_html)
    portal = re.search(pattern, portal_html)
    if not candidate or not portal or candidate[1] != portal[1]:
        raise ValueError("The public cockpit still serves a different entry bundle from the candidate.")
    return candidate[1]


def vercel(args, expected):
    executable = shutil.which("vercel.cmd") or shutil.which("vercel")
    if not executable:
        raise ValueError("Install and sign in to the Vercel CLI before publishing.")
    command = [executable, *args, "--scope", expected["scope"]]
    if os.environ.get("VERCEL_TOKEN"):
        command += ["--token", os.environ["VERCEL_TOKEN"]]
    try:
        result = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=90)
    except subprocess.SubprocessError:
        raise ValueError("The scoped Vercel request timed out. Check deployment status before retrying.") from None
    if result.returncode:
        raise ValueError("Vercel could not complete the scoped request. Check its CLI access and deployment status.")
    return result.stdout


def api(endpoint, expected):
    return json.loads(vercel(["api", endpoint, "--raw"], expected))


class UnknownProduction(ValueError):
    """Production's commit could not be read. Missing is never "nothing to compare"."""


def commit_of(deployment):
    meta = deployment.get("meta") or {}
    sha = meta.get("gitCommitSha") or meta.get("githubCommitSha")
    return sha if isinstance(sha, str) and re.fullmatch(r"[0-9a-f]{40}", sha) else None


def git(*args):
    return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace")


def production_in_head(expected, head):
    """Refuse an upload that would take production backwards or sideways.

    Asked before anything is uploaded. The live bundle used to name its
    commit, but no cockpit bundle does any more, so require-github-main.sh
    skipped this comparison on every ship, and release_candidate runs after
    `vercel deploy --prod` has already made the upload live (2026-10-13: both
    ships compared the new deployment with itself). Vercel's own record of the
    production deployment names the commit it was built from.
    """
    if not expected or not expected.get("origin") or not expected.get("scope"):
        raise UnknownProduction("No production origin and team scope are configured for this directory, so its live commit cannot be read.")
    try:
        current = api("/v13/deployments/" + expected["origin"], expected)
        verify_owner(current, expected)
    except ValueError as error:
        raise UnknownProduction(f"Could not read which commit production serves at {expected['origin']}: {error}") from None
    sha = commit_of(current)
    if not sha:
        raise UnknownProduction(f"Production {current['id']} at {expected['origin']} does not name the commit it was built from.")
    short = sha[:8]
    if git("cat-file", "-e", sha + "^{commit}").returncode:
        raise ValueError(
            f"Production is {short} ({current['id']}), and this clone does not have that commit. "
            "It was uploaded from a commit GitHub main does not have. Push it from the checkout that shipped it before deploying again: "
            "deploying from here would replace that production with a tree that lacks it."
        )
    if not git("merge-base", "--is-ancestor", sha, head).returncode:
        return f"production {current['id']} at {short} is contained in {head[:8]}"
    # A rebase gives the same commits new names. Production built from the old
    # name is still in HEAD when every commit it has beyond the fork point is
    # in HEAD as the same patch: git cherry marks those "-", a missing one "+".
    # 2026-09-23: production was 7efca15, rebased onto main as 7a7668e.
    base = git("merge-base", sha, head).stdout.strip()
    lacking = [line[2:] for line in git("cherry", "-v", head, sha, base).stdout.splitlines() if line.startswith("+ ")]
    if lacking:
        listed = "\n".join("  " + line for line in lacking)
        raise ValueError(
            f"Production is {short} ({current['id']}), which has {len(lacking)} commit(s) {head[:8]} does not have:\n{listed}\n"
            "This deploy would take production backwards. Ship from current main (git fetch, then rebase onto origin/main). "
            "To roll back on purpose, promote an earlier deployment in Vercel instead."
        )
    return f"production {current['id']} at {short} is in {head[:8]} under rebased names (every patch the same)"


def html(url):
    request = Request(url + "?cockpit_release_check=" + str(time.time_ns()), headers={"Cache-Control": "no-cache"})
    with urlopen(request, timeout=30) as response:
        return response.read().decode("utf-8")


def release_candidate(url, expected, sha, promote=False):
    if not expected or not expected.get("origin") or not expected.get("scope"):
        raise ValueError("Production publication requires a configured origin, project and team scope.")
    if not re.fullmatch(r"https://[a-z0-9-]+\.vercel\.app/?", url):
        raise ValueError("Use the exact deployment URL returned by this build.")
    candidate = api("/v13/deployments/" + urlparse(url).hostname, expected)
    verify_deployment(candidate, expected, sha)
    origin_endpoint = "/v13/deployments/" + expected["origin"]
    before = api(origin_endpoint, expected)
    verify_owner(before, expected)
    previous_sha = (before.get("meta") or {}).get("gitCommitSha") or (before.get("meta") or {}).get("githubCommitSha")
    if not isinstance(previous_sha, str) or not re.fullmatch(r"[0-9a-f]{40}", previous_sha) or subprocess.run(["git", "merge-base", "--is-ancestor", previous_sha, sha], capture_output=True).returncode:
        raise ValueError("The current production source is not contained in this release. Preserve it before publishing.")
    print(f"Production plan: {expected['origin']} -> {candidate['id']} at {sha}; current {before['id']}")
    if not promote:
        return
    after = api(origin_endpoint, expected)
    verify_unchanged_origin(before, after, expected)
    if after["id"] != candidate["id"]:
        vercel(["promote", candidate["url"], "--yes"], expected)
    failure = None
    path = urlparse("https://" + expected["domain"]).path.rstrip("/") + "/"
    for attempt in range(6):
        try:
            live = api(origin_endpoint, expected)
            verify_deployment(live, expected, sha)
            if live["id"] != candidate["id"]:
                raise ValueError("The production origin does not resolve to this deployment.")
            # Deployment-specific URLs can return Vercel's protected login page.
            # The verified public origin now belongs to this exact deployment.
            entry = verify_entries(html("https://" + expected["origin"] + path), html("https://" + expected["domain"].rstrip("/") + "/"))
            current = api(origin_endpoint, expected)
            verify_deployment(current, expected, sha)
            if current["id"] != candidate["id"]:
                raise ValueError("Another release became current during the page checks.")
            print(f"Production verified: {expected['domain']} serves {candidate['id']} ({entry})")
            return
        except (ValueError, OSError) as error:
            failure = error
            if attempt < 5:
                time.sleep(5)
    raise ValueError(f"Production verification failed: {failure}")


def current_production(expected):
    """Read-only: the deployment production serves now, so scripts/release.ps1
    can return to it if the release fails after the upload."""
    if not expected or not expected.get("origin") or not expected.get("scope"):
        raise ValueError("No production origin and team scope are configured for this directory.")
    current = api("/v13/deployments/" + expected["origin"], expected)
    verify_owner(current, expected)
    return {"id": current["id"], "url": "https://" + current["url"], "sha": commit_of(current)}


def rollback(url, expected):
    """Promote an earlier READY production deployment of this same project and
    wait until the production origin serves it. Used by scripts/release.ps1 when
    a release fails after production changed."""
    if not expected or not expected.get("origin") or not expected.get("scope"):
        raise ValueError("Rollback requires a configured origin, project and team scope.")
    if not re.fullmatch(r"https://[a-z0-9-]+\.vercel\.app/?", url):
        raise ValueError("Use the exact deployment URL recorded before the release.")
    target = api("/v13/deployments/" + urlparse(url).hostname, expected)
    verify_owner(target, expected)
    if target.get("readyState") != "READY" or target.get("target") != "production":
        raise ValueError("Roll back only to a READY production deployment of this project.")
    origin_endpoint = "/v13/deployments/" + expected["origin"]
    if api(origin_endpoint, expected).get("id") == target["id"]:
        print(f"Rollback not needed: {expected['origin']} already serves {target['id']}")
        return
    vercel(["promote", target["url"], "--yes"], expected)
    for attempt in range(6):
        if api(origin_endpoint, expected).get("id") == target["id"]:
            print(f"Rolled back: {expected['origin']} serves {target['id']} again")
            return
        if attempt < 5:
            time.sleep(5)
    raise ValueError(f"Rollback did not take effect: {expected['origin']} does not serve {target['id']}. Promote it in Vercel by hand.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory")
    parser.add_argument("--deployment")
    parser.add_argument("--promote", action="store_true", help="Apply the verified production plan; otherwise read-only")
    parser.add_argument("--production-in-head", action="store_true", help="Read-only: refuse when production has commits HEAD lacks")
    parser.add_argument("--current", action="store_true", help="Read-only: print the production deployment as JSON")
    parser.add_argument("--rollback-to", metavar="URL", help="Promote this earlier production deployment of the same project")
    args = parser.parse_args()
    root = ROOT
    directory = args.directory
    expected = json.loads((root / "config/vercel-projects.json").read_text()).get(directory)
    if args.current:
        print(json.dumps(current_production(expected)))
        return
    if args.production_in_head:
        head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip()
        try:
            print("Production check: " + production_in_head(expected, head))
        except UnknownProduction as error:
            # B: an unread production commit stops the ship; only a person
            # who has checked production another way waves it through.
            if os.environ.get("ALLOW_UNKNOWN_PRODUCTION") != "yes":
                raise ValueError(f"{error}\nRefusing to ship without knowing what production serves. Check the Vercel CLI sign-in, or set ALLOW_UNKNOWN_PRODUCTION=yes once you have confirmed production is contained in {head[:8]}.") from None
            print(f"ALLOW_UNKNOWN_PRODUCTION=yes: shipping {head[:8]} without comparing it with production. {error}")
        return
    if expected is None:
        if args.deployment or args.promote or args.rollback_to:
            raise ValueError("No verified production project is configured for this directory.")
        return  # Do not invent ownership for unverified projects.
    link_path = root / directory / ".vercel/project.json"
    if not link_path.exists():
        raise ValueError("Missing Vercel link; use config/vercel-projects.json after verifying the live alias.")
    verify(json.loads(link_path.read_text()), expected)
    print(f"Vercel project verified for {expected['domain']}: {expected['projectName']}")
    if args.rollback_to:
        rollback(args.rollback_to, expected)
        return
    if args.promote and not args.deployment:
        raise ValueError("Promotion requires the exact candidate deployment URL.")
    if args.deployment:
        sha = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip()
        release_candidate(args.deployment, expected, sha, args.promote)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, IndexError, subprocess.SubprocessError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
