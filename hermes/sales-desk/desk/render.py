"""Drive a browser, whichever way this machine can. (Ported from Mahara-B2B
proposals/render.py unchanged in substance.)

Chrome's one-shot flags are the simplest thing that works. `--dump-dom` prints
a page and exits, `--print-to-pdf` writes a file and exits, and neither needs
anything installed beyond the browser. That is what this used, and on a laptop
it is still the right answer.

On the VPS they hang. Both of them, indefinitely, on a blank `data:` URL as
readily as on a seven-page proposal, with the sandbox off, background
networking off, 7.8G free in /dev/shm and the machine idle. Zero bytes out
every time. The binary is fine: `--version` answers instantly, so it is the
one-shot path itself that never completes there.

So talk to the same binary the way every browser automation library does, over
the DevTools protocol, and let Playwright own the part that is fiddly: waiting
for the renderer to actually be ready before asking it anything. It launches
the Chrome already on the box rather than downloading a second one.

Both paths return the same two things, so callers do not care which ran:

    dom(path)        the page's HTML after its webfonts have loaded
    pdf(path, out)   a PDF at out, or False

The webfont wait is not incidental. The template measures its own pages against
A4 and flags the ones that overflow, and it does that twice: once immediately
and once when `document.fonts.ready` resolves. Read the DOM before the real
faces land and every page reports as fitting, because it was measured in
fallback metrics. That is not a hypothetical: it shipped a clipped page once.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path
from typing import Any, Callable, Optional

# How long to give a browser before deciding this machine cannot render.
TIMEOUT_MS = int(os.environ.get("SALES_RENDER_TIMEOUT") or os.environ.get("PROPOSAL_RENDER_TIMEOUT") or "120") * 1000


def set_timeout(seconds: int) -> None:
    global TIMEOUT_MS
    TIMEOUT_MS = int(seconds) * 1000


def _real_home() -> Path:
    """The account's home, even when HOME says otherwise (a Hermes profile
    repoints HOME at its own isolation directory; the password database is
    not repointed)."""
    try:
        import pwd
        return Path(pwd.getpwuid(os.getuid()).pw_dir)
    except Exception:  # noqa: BLE001
        return Path.home()


REAL_HOME = _real_home()

CHROME_CANDIDATES = [
    # An explicit path wins. The server has no root, so Chrome may live in a
    # home directory rather than on PATH.
    os.environ.get("CHROME_PATH"),
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    str(REAL_HOME / "opt" / "chrome-linux64" / "chrome"),
    str(REAL_HOME / ".local" / "bin" / "google-chrome"),
    str(Path.home() / "opt" / "chrome-linux64" / "chrome"),
    "google-chrome",
    "chromium",
    "chromium-browser",
]


def find_chrome() -> Optional[str]:
    for candidate in CHROME_CANDIDATES:
        if not candidate:
            continue
        if Path(candidate).exists() or shutil.which(candidate):
            return candidate
    return None


def chrome_flags() -> list[str]:
    """Flags every headless run needs, wherever it runs. --no-sandbox on Linux
    only: the sandbox helper has to be setuid root and the server has no root."""
    flags = ["--disable-gpu", "--no-first-run", "--no-default-browser-check",
             "--disable-background-networking", "--disable-sync",
             "--disable-component-update", "--disable-default-apps",
             "--disable-dev-shm-usage"]
    if sys.platform.startswith("linux"):
        flags.append("--no-sandbox")
    return flags


def has_playwright() -> bool:
    try:
        import playwright.sync_api  # noqa: F401
        return True
    except ImportError:
        return False


# --------------------------------------------------------------- playwright --
def _playwright(fn: Callable[[Any], Any]) -> Any:
    """Run fn(page) against the Chrome on this machine, or return None when
    Playwright is simply absent."""
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        return None

    chrome = find_chrome()
    with sync_playwright() as p:
        launch: dict[str, Any] = {"args": chrome_flags()}
        if chrome and Path(chrome).exists():
            launch["executable_path"] = chrome
        browser = p.chromium.launch(**launch)
        try:
            page = browser.new_page()
            page.set_default_timeout(TIMEOUT_MS)
            return fn(page)
        finally:
            browser.close()


def _ready(page: Any, url: str) -> None:
    page.goto(url, wait_until="load", timeout=TIMEOUT_MS)
    # The overflow guard runs again on fonts.ready, and its second answer is
    # the true one. Wait for it rather than for a fixed number of seconds.
    page.evaluate("() => document.fonts && document.fonts.ready")
    page.wait_for_timeout(400)


# ------------------------------------------------------------- one-shot flags --
def _oneshot(args: list[str], timeout_s: float, ready: Optional[Callable[[bytes], bool]] = None) -> Optional[str]:
    """Run Chrome once and return what it printed.

    Chrome can finish the work and then never exit. On a Mac on 2026-09-24
    `--dump-dom` printed the whole rendered document within seconds and then
    sat until it was killed, and `--print-to-pdf` wrote a good file the same
    way; waiting for the exit threw both away. So the answer is taken as soon
    as `ready` says it is complete, and the process is killed after that.
    """
    chrome = find_chrome()
    if not chrome:
        return None
    with tempfile.TemporaryDirectory(prefix="proposal-chrome-") as tmp:
        try:
            proc = subprocess.Popen(
                [chrome, "--headless=new", *chrome_flags(), f"--user-data-dir={tmp}/profile", *args],
                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        except OSError:
            return None
        out = bytearray()

        def pump() -> None:
            # read1, not read: read(n) holds the last partial chunk until the
            # process exits, which is exactly what it never does here.
            for chunk in iter(lambda: proc.stdout.read1(65536), b""):
                out.extend(chunk)

        reader = threading.Thread(target=pump, daemon=True)
        reader.start()
        deadline = time.monotonic() + timeout_s
        while time.monotonic() < deadline and proc.poll() is None:
            if ready is not None and ready(bytes(out)):
                break
            time.sleep(0.25)
        if proc.poll() is None:
            proc.kill()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            pass
        reader.join(timeout=5)
    return bytes(out).decode("utf-8", "replace")


def _complete_page(printed: bytes) -> bool:
    return printed.rstrip().endswith(b"</html>")


# ------------------------------------------------------------------ public --
def dom(html_path: Path) -> Optional[str]:
    """The page's HTML after its webfonts have loaded, or None."""
    url = Path(html_path).resolve().as_uri()
    try:
        out = _playwright(lambda page: (_ready(page, url), page.content())[1])
        if out:
            return out
    except Exception:  # noqa: BLE001
        pass
    out = _oneshot(["--virtual-time-budget=8000", "--dump-dom", url], TIMEOUT_MS / 1000, ready=_complete_page)
    # Half a page is no page: the overflow guard's verdict is only in a whole one.
    return out if out and _complete_page(out.encode("utf-8")) else None


def pdf(html_path: Path, out_path: Path) -> bool:
    """Write a PDF at out_path. True if one landed there."""
    url = Path(html_path).resolve().as_uri()
    out_path = Path(out_path)

    def _print(page: Any) -> bool:
        _ready(page, url)
        # The template sets its own @page size, so let the stylesheet decide.
        page.pdf(path=str(out_path), prefer_css_page_size=True, print_background=True)
        return True

    try:
        if _playwright(_print) and out_path.exists() and out_path.stat().st_size:
            return True
    except Exception:  # noqa: BLE001
        pass

    with tempfile.TemporaryDirectory(prefix="proposal-pdf-") as tmp:
        scratch = Path(tmp) / "out.pdf"
        seen = {"size": -1, "since": 0.0}

        def written(_printed: bytes) -> bool:
            """The file is there and has stopped growing for a second."""
            size = scratch.stat().st_size if scratch.exists() else 0
            if size and size == seen["size"]:
                return time.monotonic() - seen["since"] >= 1.0
            seen["size"], seen["since"] = size, time.monotonic()
            return False

        _oneshot(["--no-pdf-header-footer", "--virtual-time-budget=10000",
                  f"--print-to-pdf={scratch}", url], TIMEOUT_MS / 1000, ready=written)
        if scratch.exists() and scratch.stat().st_size and scratch.read_bytes().rstrip().endswith(b"%%EOF"):
            shutil.move(str(scratch), str(out_path))
            return True
    return False


def engine() -> str:
    """Which path this machine will take. For a report line, not a decision."""
    if has_playwright():
        return "playwright"
    return "chrome one-shot" if find_chrome() else "none"
