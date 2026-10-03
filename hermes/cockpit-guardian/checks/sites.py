"""Public pages (catalogue V1, V2, V4): HTTP 200, the title marker, and the
main script the page names also answering 200. The sales and editor bundles
must carry the database address (a build without it opens blank).

Only GETs of pages and static files. webinar /live is a static page; the
click is recorded by the browser's script, not by fetching the HTML.
"""
from __future__ import annotations

import re
from typing import Callable, Optional
from urllib.parse import urljoin

from guard import http
from guard.config import SUPABASE_URL
from guard.context import Context
from guard.model import Check, Result, fail, ok

TITLE = re.compile(r"<title>([^<]*)</title>", re.I)
SCRIPT = re.compile(r"""<script[^>]+src=["']([^"']+\.js)["']""", re.I)

SITES = (
    # id, url, title marker, script pattern (None: any same-origin script), needs the database address
    ("site-cockpit", "https://cockpit.maharamedia.com/", "Mahara Cockpit", r"/assets/index-[^/]+\.js$", False),
    ("site-ceo", "https://cockpit.maharamedia.com/ceo", "Mahara Cockpit", r"/assets/index-[^/]+\.js$", False),
    ("site-media-buyer-vercel", "https://mahara-media-buyer.vercel.app/", "Mahara Cockpit", r"/assets/index-[^/]+\.js$", False),
    ("site-client-success", "https://cockpit.maharamedia.com/client-success/", "Client Success Cockpit", r"/assets/index-[^/]+\.js$", False),
    ("site-creative", "https://cockpit.maharamedia.com/creative/", "Mahara Creative Cockpit", r"/assets/index-[^/]+\.js$", False),
    ("site-editor", "https://cockpit.maharamedia.com/editor/", "Mahara Media", r"/assets/index-[^/]+\.js$", True),
    ("site-sales", "https://cockpit.maharamedia.com/sales/", "Sales · Mahara", r"/assets/index-[^/]+\.js$", True),
    ("site-dialer", "https://dialer.maharamedia.com/", "Mahara · Call workspace", r"/app\.js$", False),
    ("site-creative-dashboard", "https://mahara-creative-dashboard.vercel.app/", "Mahara · Creative Triage", r"/_next/static/", False),
)


def page_check(url: str, marker: str, script_re: Optional[str], needs_db: bool) -> Callable[[Context], Result]:
    def run(ctx: Context) -> Result:
        try:
            r = ctx.get(url, timeout=20, headers={"User-Agent": http.BROWSER_UA})
        except http.HttpError as e:
            return fail(f"{url} does not answer ({e}).")
        if r.status != 200:
            return fail(f"{url} answers {r.status}.", evidence={"status": r.status})
        html = r.text(400_000)
        m = TITLE.search(html)
        title = (m.group(1).strip() if m else "")
        ev = {"status": r.status, "title": title}
        if marker not in title:
            return fail(f"{url} answers 200 but its title is {title!r}, not {marker!r}: the wrong build or an error page.",
                        evidence=ev)
        scripts = [urljoin(url, s) for s in SCRIPT.findall(html)]
        if script_re:
            scripts = [s for s in scripts if re.search(script_re, s)]
        if not scripts:
            return fail(f"{url} names no main script, so the page cannot start.", evidence=ev)
        main = scripts[0]
        try:
            js = ctx.get(main, timeout=30)
        except http.HttpError as e:
            return fail(f"{url} names {main.rsplit('/', 1)[-1]}, which does not answer ({e}).", evidence=ev)
        ev["script"] = main.rsplit("/", 1)[-1]
        ev["script_status"] = js.status
        if js.status != 200:
            return fail(f"{url} names {ev['script']}, which answers {js.status}: a deploy said success but the page is "
                        "broken.", evidence=ev)
        if needs_db and SUPABASE_URL.encode() not in js.body:
            return fail(f"The live page {url} was built without its database address and opens blank.", evidence=ev,
                        action="Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY on the Vercel project and ship it again.")
        return ok(f"{url} answers 200 with its title and its script.", evidence=ev)

    return run


def run_webinar(ctx: Context) -> Result:
    base = "https://webinar.maharamedia.com"
    bad, ev = [], {}
    for path in ("/", "/mm-track.js", "/live"):
        try:
            r = ctx.get(base + path, timeout=20, headers={"User-Agent": http.BROWSER_UA})
            ev[path] = r.status
            if r.status != 200:
                bad.append(f"{path} answers {r.status}")
            elif path == "/" and "<title>" not in r.text(200_000):
                bad.append("/ has no title")
        except http.HttpError as e:
            ev[path] = 0
            bad.append(f"{path} does not answer ({e})")
    if bad:
        return fail("The webinar site: " + "; ".join(bad) + ". The WhatsApp reminders carry /live.", evidence=ev)
    return ok("The webinar site answers 200 on /, /mm-track.js and /live.", evidence=ev)


CHECKS = [
    Check(id=_id, area="sites", name=f"Page {_url.split('//', 1)[1]}", catalogue="V1, V2" if _db else "V2",
          means=f"{_url} serves the right build and its main script loads.", severity="high",
          reads=f"GET {_url}, its <title>, then the main script it names", confirm=2,
          threshold="Not 200, the wrong title, or the script not 200" + (", or no database address in the bundle" if _db else "") + ": fail.",
          run=page_check(_url, _marker, _script, _db),
          action="Open the Vercel project's latest deployment; ship again with scripts/ship.sh <app> and check the live bundle.")
    for _id, _url, _marker, _script, _db in SITES
] + [
    Check(id="site-webinar", area="sites", name="Webinar site", catalogue="V4",
          means="The webinar landing page, its tracking script and the /live join link answer.", severity="high",
          reads="GET /, /mm-track.js and /live on webinar.maharamedia.com", threshold="Any not 200: fail.",
          run=run_webinar, confirm=2, action="Check the webinar project on Vercel (sites/webinar)."),
]
