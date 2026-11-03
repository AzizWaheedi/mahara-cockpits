"""A website, read from the VPS directly (standard library, robots.txt respected), else through
apify/website-content-crawler: services and prices, the calls to action, a booking widget (GHL, Calendly,
WhatsApp), the tracking tags (Meta Pixel, Google Tag Manager, GA4, TikTok and Snap pixels), forms, and the
social handles the site links to. A direct fetch costs nothing but still goes through the ledger (host only).

The addresses come from outside (the client's answers, Maps listings, search results), so a direct fetch goes
only to http or https on ports 80 and 443 of a host on the public internet: the host is resolved and refused when
any address is loopback, private, link-local, reserved or multicast, again on every redirect, and the connection
itself is refused when the address it reached is not public (a name that changes its answer in between).
Nothing on the VPS (the Claude proxy, another worker) can be read this way.
"""
from __future__ import annotations

import http.client as http_client
import ipaddress
import re
import socket
import urllib.parse
import urllib.request
import urllib.robotparser
from dataclasses import dataclass, field
from html.parser import HTMLParser
from typing import Any, Callable, Optional

from .. import http
from ..evidence import Draft
from . import domain, first, handle, https

SOURCE_DIRECT = "web:direct"
SOURCE_APIFY = "apify:apify/website-content-crawler"
MAX_BYTES = 1_500_000

TRACKING = {
    "metaPixel": re.compile(r"connect\.facebook\.net/[^\"']*/fbevents\.js|fbq\(\s*['\"]init", re.I),
    "gtm": re.compile(r"googletagmanager\.com/gtm\.js|GTM-[A-Z0-9]{4,}", re.I),
    "ga4": re.compile(r"googletagmanager\.com/gtag/js\?id=G-|gtag\(\s*['\"]config['\"]\s*,\s*['\"]G-", re.I),
    "tiktokPixel": re.compile(r"analytics\.tiktok\.com|ttq\.load\(", re.I),
    "snapPixel": re.compile(r"sc-static\.net/scevent|snaptr\(", re.I),
}
BOOKING = {
    "ghl": re.compile(r"msgsndr\.com|leadconnectorhq\.com|gohighlevel|/widget/booking/", re.I),
    "calendly": re.compile(r"calendly\.com", re.I),
    "whatsapp": re.compile(r"wa\.me/|api\.whatsapp\.com|whatsapp\.com/send", re.I),
    "setmore": re.compile(r"setmore\.com", re.I),
    "acuity": re.compile(r"acuityscheduling\.com", re.I),
}
PRICE = re.compile(r"(?:(?:KWD|KD|SAR|SR|AED|QAR|BHD|OMR|USD|\$|د\.ك|ر\.س|د\.إ|ر\.ق)\s?\d[\d,.]*|\d[\d,.]*\s?(?:KWD|KD|SAR|SR|AED|QAR|BHD|OMR|USD|د\.ك|ر\.س|د\.إ|ر\.ق|دينار|ريال|درهم))", re.I)
PRIORITY = re.compile(r"service|pricing|price|package|contact|about|book|portfolio|project|خدم|اسعار|تواصل|من-نحن|مشاريع", re.I)


class _Page(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.title = ""
        self.description = ""
        self.links: list[str] = []
        self.buttons: list[str] = []
        self.forms = 0
        self.text: list[str] = []
        self._in: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, Optional[str]]]) -> None:
        a = {k: (v or "") for k, v in attrs}
        self._in.append(tag)
        if tag == "a" and a.get("href"):
            self.links.append(a["href"])
        elif tag == "form":
            self.forms += 1
        elif tag == "meta" and a.get("name", "").lower() == "description":
            self.description = a.get("content", "")[:300]

    def handle_endtag(self, tag: str) -> None:
        if self._in and self._in[-1] == tag:
            self._in.pop()

    def handle_data(self, data: str) -> None:
        if not data.strip():
            return
        cur = self._in[-1] if self._in else ""
        if cur in ("script", "style", "noscript"):
            return
        if cur == "title":
            self.title = (self.title + data).strip()[:200]
        if cur in ("button",) or (cur == "a" and len(data.strip()) < 40):
            self.buttons.append(data.strip()[:60])
        self.text.append(data.strip())


@dataclass
class Page:
    url: str
    title: str
    description: str
    text: str
    tracking: dict[str, bool]
    booking: dict[str, bool]
    prices: list[str]
    ctas: list[str]
    forms: int
    links: list[str] = field(default_factory=list)

    def body(self) -> dict[str, Any]:
        return {"title": self.title, "description": self.description, "text": self.text[:2500],
                "tracking": self.tracking, "booking": self.booking, "prices": self.prices[:12], "ctas": self.ctas[:12],
                "forms": self.forms}


def audit(html: str, url: str) -> Page:
    p = _Page()
    try:
        p.feed(html)
    except Exception:  # noqa: BLE001  (a broken page still has its regex facts)
        pass
    text = " ".join(p.text)
    links = [urllib.parse.urljoin(url, h) for h in p.links]
    ctas = []
    for b in p.buttons:
        if b and b not in ctas and re.search(r"book|call|contact|whatsapp|quote|consult|احجز|تواصل|اتصل|استشار|واتس", b, re.I):
            ctas.append(b)
    return Page(url=url, title=p.title, description=p.description, text=re.sub(r"\s+", " ", text)[:6000],
                tracking={k: bool(rx.search(html)) for k, rx in TRACKING.items()},
                booking={k: bool(rx.search(html)) for k, rx in BOOKING.items()},
                prices=list(dict.fromkeys(m.group(0).strip().rstrip(".,") for m in PRICE.finditer(text)))[:20],
                ctas=ctas[:12], forms=p.forms, links=links)


def socials(pages: list[Page]) -> dict[str, Optional[str]]:
    blob = " ".join(" ".join(p.links) for p in pages)
    return {k: handle(k, blob) for k in ("instagram", "tiktok", "snapchat", "facebook")}


class Blocked(ValueError):
    """A direct fetch refused before it is made (not an error to retry)."""


def addresses(host: str) -> list[str]:
    return [str(ai[4][0]) for ai in socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)]


def public_ip(ip: str) -> bool:
    try:
        a = ipaddress.ip_address(str(ip).split("%")[0])
    except ValueError:
        return False
    if a.version == 6 and a.ipv4_mapped:
        a = a.ipv4_mapped
    return a.is_global and not (a.is_private or a.is_loopback or a.is_link_local or a.is_reserved or a.is_multicast
                                or a.is_unspecified)


def check_url(url: str, resolve: Callable[[str], list[str]] = addresses) -> None:
    """Refuse anything but http or https on ports 80 and 443 of a host whose every address is public."""
    p = urllib.parse.urlsplit(url)
    if p.scheme not in ("http", "https"):
        raise Blocked(f"{p.scheme or 'an address with no scheme'} is not read directly (http and https only)")
    try:
        port = p.port
    except ValueError:
        raise Blocked("the address has a port that is not a number") from None
    if port not in (None, 80, 443):
        raise Blocked(f"port {port} is not read directly (80 and 443 only)")
    host = p.hostname
    if not host:
        raise Blocked("the address has no host")
    try:
        found = resolve(host)
    except (OSError, UnicodeError):
        raise Blocked(f"{host} does not resolve") from None
    if not found or not all(public_ip(a) for a in found):
        raise Blocked(f"{host} points at a private or local address, so it is not read")


def _peer_is_public(sock: Any) -> None:
    try:
        ip = sock.getpeername()[0]
    except (OSError, IndexError, TypeError):
        ip = ""
    if not public_ip(ip):
        raise Blocked("the site answered from a private or local address, so it is not read")


class _PublicHTTPConnection(http_client.HTTPConnection):
    def connect(self) -> None:
        super().connect()
        _peer_is_public(self.sock)


class _PublicHTTPSConnection(http_client.HTTPSConnection):
    def connect(self) -> None:
        super().connect()
        _peer_is_public(self.sock)


class _PublicHTTPHandler(urllib.request.HTTPHandler):
    def http_open(self, req: Any) -> Any:
        return self.do_open(_PublicHTTPConnection, req)


class _PublicHTTPSHandler(urllib.request.HTTPSHandler):
    def https_open(self, req: Any) -> Any:
        return self.do_open(_PublicHTTPSConnection, req, context=self._context)


class _PublicRedirect(urllib.request.HTTPRedirectHandler):
    def __init__(self, resolve: Callable[[str], list[str]]):
        self.resolve = resolve

    def redirect_request(self, req: Any, fp: Any, code: int, msg: str, headers: Any, newurl: str) -> Any:
        check_url(newurl, self.resolve)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def public_opener(resolve: Callable[[str], list[str]] = addresses) -> urllib.request.OpenerDirector:
    """No proxy (the fetch is the VPS's own), public addresses only, checked again on every redirect."""
    return urllib.request.build_opener(urllib.request.ProxyHandler({}), _PublicHTTPHandler, _PublicHTTPSHandler,
                                       _PublicRedirect(resolve))


class Fetcher:
    """Direct fetches: same host only, public addresses only, robots.txt read once per host, 1.5 MB at most a page."""

    def __init__(self, ledger: Any, *, get: Optional[Callable[[str], tuple[int, str]]] = None, timeout: float = 20,
                 resolve: Optional[Callable[[str], list[str]]] = None):
        self.ledger = ledger
        self.timeout = timeout
        self._resolve = resolve or addresses
        self._opener = public_opener(self._resolve)
        self._get = get or self._http_get
        self._robots: dict[str, Optional[urllib.robotparser.RobotFileParser]] = {}

    def _http_get(self, url: str) -> tuple[int, str]:
        status, headers, body = http.request("GET", url, timeout=self.timeout, retries=1,
                                             headers={"Accept": "text/html,application/xhtml+xml"}, opener=self._opener)
        ctype = (headers.get("Content-Type") or headers.get("content-type") or "").lower()
        if "html" not in ctype and "xml" not in ctype and ctype:
            return status, ""
        return status, body[:MAX_BYTES].decode("utf-8", "replace")

    def allowed(self, url: str) -> bool:
        host = urllib.parse.urlsplit(url)
        key = f"{host.scheme}://{host.netloc}"
        if key not in self._robots:
            rp = urllib.robotparser.RobotFileParser()
            try:
                status, text = self.ledger.call("web", "GET", f"{key}/robots.txt", lambda: self._get(f"{key}/robots.txt"))
                rp.parse(text.splitlines() if status == 200 else [])
                self._robots[key] = rp
            except Exception:  # noqa: BLE001  (no robots.txt: the default is allowed)
                self._robots[key] = None
        rp = self._robots[key]
        return True if rp is None else rp.can_fetch(http.USER_AGENT, url)

    def fetch(self, url: str) -> Optional[str]:
        check_url(url, self._resolve)
        if not self.allowed(url):
            return None
        status, text = self.ledger.call("web", "GET", http.resource_of(url, host_only=True), lambda: self._get(url))
        return text if status == 200 and text else None

    def crawl(self, start: str, max_pages: int) -> tuple[list[Page], list[str]]:
        """The start page, then same-host pages that look like services, prices, contact or projects first."""
        warnings: list[str] = []
        site = domain(start)
        seen: set[str] = set()
        queue = [start]
        pages: list[Page] = []
        while queue and len(pages) < max_pages:
            url = queue.pop(0).split("#")[0]
            if url in seen:
                continue
            seen.add(url)
            try:
                html = self.fetch(url)
            except Exception as e:  # noqa: BLE001
                warnings.append(f"{site}: {http.scrub(str(e))[:100]}")
                html = None
            if not html:
                if not pages:
                    warnings.append(f"{site}: the start page could not be read directly (blocked, refused or not HTML)")
                    break
                continue
            page = audit(html, url)
            pages.append(page)
            nxt = [l for l in page.links if domain(l) == site and l.split("#")[0] not in seen
                   and not re.search(r"\.(pdf|jpg|jpeg|png|gif|webp|svg|mp4|zip)(\?|$)", l, re.I)]
            nxt.sort(key=lambda l: 0 if PRIORITY.search(l) else 1)
            queue.extend(nxt[:40])
        return pages, warnings


def crawler_input(start: str, max_pages: int) -> dict[str, Any]:
    return {"startUrls": [{"url": start}], "maxCrawlPages": max_pages, "crawlerType": "cheerio", "saveHtml": True,
            "saveMarkdown": False, "maxCrawlDepth": 2, "removeCookieWarnings": True}


def parse_crawler(items: list[dict[str, Any]]) -> list[Page]:
    pages = []
    for it in items:
        url = https(first(it, "url", "loadedUrl"))
        html = str(first(it, "html", default="") or "")
        if not url:
            continue
        page = audit(html, url) if html else Page(url=url, title=str(first(it, "metadata.title", default="") or ""),
                                                   description="", text=str(first(it, "text", default="") or "")[:6000],
                                                   tracking={k: False for k in TRACKING}, booking={k: False for k in BOOKING},
                                                   prices=[], ctas=[], forms=0)
        if not page.text:
            page.text = str(first(it, "text", default="") or "")[:6000]
        pages.append(page)
    return pages


def drafts(pages: list[Page], subject: str, source: str, usd: float = 0.0) -> list[Draft]:
    each = round(usd / len(pages), 6) if pages else 0.0
    return [Draft(kind="web_page", subject=subject, source=source, url=p.url, usd=each, body=p.body()) for p in pages]


def summary(pages: list[Page]) -> dict[str, Any]:
    """What the site says across its pages, for the metrics and the presence checklist."""
    if not pages:
        return {}
    any_of = lambda d: {k: any(p.__dict__[d][k] for p in pages) for k in pages[0].__dict__[d]}  # noqa: E731
    return {"pages": len(pages), "tracking": any_of("tracking"), "booking": any_of("booking"),
            "prices": sum(len(p.prices) for p in pages), "forms": sum(p.forms for p in pages)}
