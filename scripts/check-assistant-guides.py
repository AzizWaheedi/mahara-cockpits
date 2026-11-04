"""Check each cockpit's assistant guide against its code.

usage: python scripts/check-assistant-guides.py [--root DIR] [app_dir_name ...]

Fails (exit 1) when, for an app:
  1. a menu label in its menu file is not mentioned in the guide;
  2. a top-level page address in its routes file (for example /eod) is not
     mentioned in the guide;
  3. the guide is under 1500 or over 6000 words;
  4. the guide has an em dash;
  5. a double-quoted string in the guide is not found in the app's src
     (quoted strings must be the exact interface text).

Each app names its own menu and routes files in APP_FILES. An app not in the
table falls back to the shared AppSidebar and AuthenticatedAppRoutes files.

It also prints one non-blocking NOTE per app when screen files changed after the
guide was last updated, so a person can check that the guide still matches.
"""
import argparse
import pathlib
import re
import subprocess
import sys

# Menu labels that are group headings or cockpit names, not places a guide
# should send a person to.
SWITCHER = {"Media buyer cockpit", "Media buyer", "Client success", "Creative director", "Editor desk", "Sales"}
# Routes for signed-out or public pages, which no guide section describes.
SKIP_ROUTES = {"/", "/*", "/login", "/signup", "/first-sign-in", "/review"}

# The menu files and the routes file for each cockpit. The three older
# cockpits share the same pair of files. Sales reads its sidebar and the
# phone dock. The editor desk reads its sidebar. An app not listed here
# falls back to the older pair.
DEFAULT_FILES = (
    ("src/components/AppSidebar.tsx",),
    ("src/auth/authenticated/AuthenticatedAppRoutes.tsx",),
)
APP_FILES = {
    "media-buyer-cockpit": DEFAULT_FILES,
    "client-success-cockpit": DEFAULT_FILES,
    "creative-director-cockpit": DEFAULT_FILES,
    "sales-cockpit": (
        ("src/components/Sidebar.tsx", "src/components/MacOSDock.tsx"),
        ("src/App.tsx",),
    ),
    "video-editor-cockpit": (
        ("src/components/Sidebar.tsx",),
        ("src/App.tsx",),
    ),
}
DEFAULT_APPS = list(APP_FILES)


def read(path):
    try:
        return path.read_text(encoding="utf-8")
    except OSError:
        return None


def check_app(app_dir):
    """The five guide rules. Returns (summary counts, problems)."""
    guide_text = read(app_dir / "assistant-guide.md")
    if guide_text is None:
        return (0, 0, 0, 0), ["assistant-guide.md is missing"]
    guide = guide_text
    low = guide.lower()
    problems = []

    menu_files, route_files = APP_FILES.get(app_dir.name, DEFAULT_FILES)
    labels = set()
    for name in menu_files:
        side = read(app_dir / name) or ""
        labels |= set(re.findall(r'label:\s*"([^"]+)"', side))
    labels -= SWITCHER
    for label in sorted(labels):
        if label.lower() not in low:
            problems.append(f"menu label not in guide: {label}")

    routes = "\n".join(read(app_dir / name) or "" for name in route_files)
    paths = re.findall(r'path="([^"]+)"', routes)
    tops = {"/" + p.strip("/").split("/")[0] if p.strip("/") else "/" for p in paths} - SKIP_ROUTES
    for top in sorted(tops):
        if not re.search(re.escape(top) + r"(?![a-z0-9-])", guide):
            problems.append(f"page address not in guide: {top}")

    words = len(guide.split())
    if not 1500 <= words <= 6000:
        problems.append(f"guide has {words} words; keep it between 1500 and 6000")
    if "\u2014" in guide:
        problems.append("guide has an em dash")

    src = "\n".join(p.read_text(encoding="utf-8", errors="ignore") for p in sorted((app_dir / "src").rglob("*.ts*")))
    src_flat = re.sub(r"\s+", " ", src)
    missing = [q for q in re.findall(r'"([^"\n]{3,80})"', guide) if q not in src and q not in src_flat]
    if missing:
        problems.append(f"{len(missing)} quoted strings are not in the app's code: " + " | ".join(missing[:15]))
    return (len(labels), len(tops), words, len(missing)), problems


def guide_time(root, app):
    """The last commit time of the guide, or None when git cannot say."""
    try:
        done = subprocess.run(
            ["git", "log", "-1", "--format=%ct", "--", f"apps/{app}/assistant-guide.md"],
            cwd=root, capture_output=True, text=True, timeout=30,
        )
    except Exception:
        return None
    stamp = done.stdout.strip()
    return stamp if done.returncode == 0 and stamp.isdigit() else None


def changed_screens(root, app, stamp):
    """Screen files changed after the guide's commit, de-duplicated, oldest run first."""
    dirs = [f"apps/{app}/src/pages", f"apps/{app}/src/components"]
    try:
        done = subprocess.run(
            ["git", "log", f"--since=@{stamp}", "--name-only", "--format=", "--", *dirs],
            cwd=root, capture_output=True, text=True, timeout=30,
        )
    except Exception:
        return []
    if done.returncode != 0:
        return []
    seen = []
    for line in done.stdout.splitlines():
        name = line.strip()
        if name and name not in seen:
            seen.append(name)
    return seen


def main(argv):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", default=str(pathlib.Path(__file__).resolve().parents[1]))
    parser.add_argument("apps", nargs="*", default=DEFAULT_APPS)
    args = parser.parse_args(argv)
    root = pathlib.Path(args.root)
    failed = False
    for app in args.apps:
        app_dir = root / "apps" / app
        (labels, tops, words, quotes), problems = check_app(app_dir)
        for problem in problems:
            print(f"FAIL {app}: {problem}")
        print(f"{app}: {labels} menu labels, {tops} page addresses, {words} words, {quotes} unmatched quotes, {len(problems)} problems")
        failed = failed or bool(problems)
        stamp = guide_time(root, app)
        if stamp:
            changed = changed_screens(root, app, stamp)
            if changed:
                example = ", ".join(changed[:5])
                print(f"NOTE {app}: {len(changed)} screen files changed since the guide was last updated, for example {example}. Check that the guide still matches.")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
