"""Fakes for every provider: Supabase (the worker's functions, in memory), Apify, ScrapeCreators, the web and
the engine. No network: a test that reaches a real host fails. Every client, business and answer is invented.
"""
from __future__ import annotations

import json
import re
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Optional

from mi import config as config_mod
from mi.apify import Job, Result
from mi.ledger import Ledger
from mi.meter import BudgetRefused, Meter
from mi.pipeline import Deps
from mi.scrapecreators import ScrapeCreators
from mi.sources import web
from mi.supabase import SupabaseError

FIX = Path(__file__).parent / "fixtures"
NOW = datetime(2026, 11, 2, 12, 0, tzinfo=timezone.utc)
TASK = "taskMiCedar1"
RUN = "11111111-2222-4333-8444-555555555555"
CONTACTS = ("Invented Owner Person", "+96500000011", "owner@cedar-mi.invalid", "+96500000044", "22000123",
            "+965 2200 0123", "hello@cedar-invented.invalid")


def public_dns(host: str) -> list[str]:
    """Every invented site resolves to one public address (nothing connects: `get` is faked)."""
    return ["93.184.216.34"]


def fixture(name: str) -> Any:
    return json.loads((FIX / name).read_text(encoding="utf-8"))


def cfg(tmp: Optional[Path] = None, **over: Any) -> config_mod.Config:
    keys = config_mod.Keys(environ={"MARKET_INTEL_SUPABASE_URL": "https://db.invalid", "MARKET_INTEL_SUPABASE_KEY": "service-key-test",
                                    "MARKET_INTEL_APIFY_KEY": "apify-key-test", "SCRAPECREATORS_API_KEY": "sc-key-test",
                                    **{k: str(v) for k, v in over.pop("env", {}).items()}}, files=())
    c = config_mod.load(keys, home=tmp or Path(tempfile.mkdtemp(prefix="mi-test-")))
    for k, v in over.items():
        setattr(c, k, v)
    c.apify_poll_sec = 0
    return c


INPUT = {
    "taskId": TASK, "responseId": "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", "source": "typeform_sync", "formDate": "2026-10-20T09:00:00Z",
    "answers": {"businessName": "Cedar Invented Interiors", "mapsLink": "https://maps.app.goo.gl/inventedCedar1",
                "website": "https://cedar-invented.example", "instagram": "https://www.instagram.com/cedar.invented",
                "facebook": "https://www.facebook.com/cedarinvented", "services": "Villa interiors, kitchens",
                "serviceFocus": "Interior design for villas", "serviceAreas": "Hawalli, Salmiya", "maxDistance": "30 km"},
    "tab": [{"ref": "514bfd3f-4ca1-469e-b9e7-87656503f65c", "title": "Business Name", "value": "Cedar Invented Interiors"}],
    "card": {"name": "Cedar Invented", "country": "KW", "phoneCountry": "KW", "drive": None, "website": "https://cedar-invented.example",
             "marketResearch": None, "serviceAdvertised": "Interior design"},
    "blueprintCompetitors": "Rival Four Invented Villas", "notCompetitors": [],
}


class FakeHome:
    """The worker's functions in memory, with the lease rule (a stale claim cannot write) and the tries rule (a
    claim is a try, an outage or a pause gives it back, three tries end the run failed, and an outage past
    `outage_limit` releases ends it needs_person, as the database does after 24 hours)."""

    def __init__(self, *, month_usd: Optional[float] = 0.0, inp: Optional[dict[str, Any]] = None, on: bool = True,
                 outage_limit: Optional[int] = None):
        self.month = month_usd
        self.inp = inp or json.loads(json.dumps(INPUT))
        self.on = on
        self.claim_token = str(uuid.uuid4())
        self.state = "queued"
        self.progress_calls: list[dict[str, Any]] = []
        self.stored: dict[str, list[dict[str, Any]]] = {"evidence": [], "findings": [], "competitors": []}
        self.done_calls: list[dict[str, Any]] = []
        self.released: list[str] = []
        self.health_rows: list[dict[str, Any]] = []
        self.ledger_rows: list[dict[str, Any]] = []
        self.stage_progress: dict[str, Any] = {}
        self.spend: dict[str, Any] = {}
        self.nap_asked: list[Optional[str]] = []
        self.scans = 0
        self.enqueued: list[tuple] = []
        self.attempts = 0
        self.outages = 0
        self.outage_limit = outage_limit
        self.releases: list[dict[str, Any]] = []
        self.caps: dict[str, Any] = {"run": 2, "month": 25}
        self.on_progress: Optional[Callable[["FakeHome", dict[str, Any]], None]] = None

    def claim_payload(self, **over: Any) -> dict[str, Any]:
        return {"runId": RUN, "taskId": TASK, "responseId": self.inp["responseId"], "reason": "shadow", "mode": "shadow",
                "state": "claimed", "claim": self.claim_token, "attempts": self.attempts or 1, "stageProgress": self.stage_progress,
                "spend": self.spend, "monthUsd": None if self.month is None else self.month + float(self.spend.get("usdApify", 0))
                + float(self.spend.get("usdScrapeCreators", 0)), "caps": dict(self.caps), **over}

    def _lease(self, claim: str) -> None:
        if claim != self.claim_token:
            raise SupabaseError("Supabase rpc/cockpit_market_intel_progress answered 400: This run's lease has lapsed or belongs to another worker.")

    def scan(self, limit: int = 20) -> dict[str, Any]:
        self.scans += 1
        return {"on": self.on, "enqueued": 0}

    def claim(self, worker: str) -> dict[str, Any]:
        if not self.on:
            return {"off": True, "sentence": "Market research is off (cockpit_settings market_intel)."}
        if self.state != "queued":
            return {"idle": True}
        if self.attempts >= 3:
            self.state = "failed"
            return {"idle": True}
        self.attempts += 1
        self.state = "claimed"
        return self.claim_payload()

    def progress(self, run_id: str, claim: str, state: Optional[str], progress: Any, spend: Any) -> dict[str, Any]:
        self._lease(claim)
        self.progress_calls.append({"state": state, "progress": progress, "spend": spend})
        if state:
            self.state = state
        self.stage_progress = {**self.stage_progress, **(progress or {})}
        for k, v in (spend or {}).items():
            if isinstance(v, (int, float)):
                self.spend[k] = max(float(self.spend.get(k, 0)), float(v))
        if self.on_progress:
            self.on_progress(self, {"state": state, "progress": progress or {}})
        return {"ok": True, "on": self.on, "caps": dict(self.caps)}

    def store(self, run_id: str, claim: str, kind: str, rows: list[dict[str, Any]]) -> None:
        self._lease(claim)
        if kind == "evidence":
            have = {r["eid"] for r in self.stored["evidence"]}
            for r in rows:
                if r["kind"] == "review" and set(r["body"]) & {"name", "reviewer", "reviewerName", "reviewerId", "reviewerUrl"}:
                    raise SupabaseError("names its reviewer")
                if r["eid"] not in have:
                    self.stored["evidence"].append(r)
        else:
            self.stored[kind] = [x for x in self.stored[kind] if x.get("lang", x.get("cid")) not in
                                 {r.get("lang", r.get("cid")) for r in rows}] + rows

    def release(self, run_id: str, claim: str, sentence: str, retry_minutes: int = 30, kind: str = "error") -> dict[str, Any]:
        self._lease(claim)
        self.released.append(sentence)
        self.releases.append({"kind": kind, "minutes": retry_minutes, "sentence": sentence})
        self.claim_token = str(uuid.uuid4())
        if kind in ("outage", "paused"):
            self.attempts = max(0, self.attempts - 1)
        if kind == "outage":
            self.outages += 1
            if self.outage_limit is not None and self.outages > self.outage_limit:
                self.state = "needs_person"
                return {"ok": True, "state": "needs_person",
                        "sentence": f"Research waited 24 hours and stopped: {sentence}"}
        self.state = "queued"
        return {"ok": True, "state": "queued", "retryMinutes": retry_minutes}

    def done(self, run_id: str, claim: str, state: str, sentence: str, summary: dict[str, Any]) -> dict[str, Any]:
        self._lease(claim)
        if summary.get("docUrl") or summary.get("commentId") or summary.get("fieldState", "not_due") != "not_due":
            raise SupabaseError("A shadow run publishes nothing: no Doc, no card field, no comment.")
        self.done_calls.append({"state": state, "sentence": sentence, "summary": summary})
        self.state = state
        return {"ok": True}

    def input(self, run_id: str) -> dict[str, Any]:
        return {**self.inp, "runId": run_id, "reason": "shadow", "mode": "shadow"}

    def preview(self, task_id: str) -> dict[str, Any]:
        return {**self.inp, "preview": True}

    def nap(self, run_id: str, phone: Optional[str]) -> str:
        self.nap_asked.append(phone)
        digits = re.sub(r"\D", "", phone or "")
        if len(digits) < 7:
            return "not_checked"
        return "match" if digits.endswith("22000123") else "differs"

    def settings(self) -> dict[str, Any]:
        return {"on": self.on, "mode": "shadow", "usd_cap_run": 2, "usd_cap_month": 25}

    def month_usd(self) -> Optional[float]:
        return self.month

    def prune(self, days: int) -> dict[str, Any]:
        return {"ok": True, "pruned": 0, "days": days}

    def runs(self, params: str) -> list[dict[str, Any]]:
        if f"id=eq.{RUN}" in params or (self.done_calls and "requested_at=gte." in params):
            last = self.done_calls[-1] if self.done_calls else {}
            return [{"id": RUN, "task_id": TASK, "mode": "shadow", "reason": "shadow", "state": self.state,
                     "usd_apify": self.spend.get("usdApify", 0), "usd_scrapecreators": self.spend.get("usdScrapeCreators", 0),
                     "sources_n": (last.get("summary") or {}).get("sourcesN"), "competitors_n": (last.get("summary") or {}).get("competitorsN"),
                     "sentence": last.get("sentence"), "requested_at": "2026-11-02T09:00:00Z"}]
        return []

    def evidence(self, run_id: str) -> list[dict[str, Any]]:
        return [{**{k: v for k, v in e.items() if k != "retrievedAt"}, "retrieved_at": e["retrievedAt"]} for e in self.stored["evidence"]]

    def findings(self, run_id: str) -> list[dict[str, Any]]:
        return [{"lang": f["lang"], "findings": f["findings"], "checks": f["checks"]} for f in self.stored["findings"]]

    def competitors(self, run_id: str) -> list[dict[str, Any]]:
        return [{"cid": c["cid"], "reserve": c["reserve"], "evidence": c["evidence"], "place_url": c.get("placeUrl")}
                for c in self.stored["competitors"]]

    def enqueue(self, *args: Any) -> dict[str, Any]:
        self.enqueued.append(args)
        return {"ok": True, "runId": RUN, "reused": False}

    def latest_response(self, task_id: str) -> Optional[str]:
        return self.inp["responseId"]

    def ledger_row(self, row: dict[str, Any]) -> None:
        self.ledger_rows.append(row)

    def health(self, ok: bool, note: str, detail: dict[str, Any], rows_seen: int = 0) -> None:
        self.health_rows.append({"ok": ok, "note": note, "detail": detail, "rows_seen": rows_seen})


ACTOR_FIXTURES = {
    "compass~crawler-google-places": lambda inp: fixture("maps_place.json") if inp.get("startUrls") else fixture("maps_search.json"),
    "compass~Google-Maps-Reviews-Scraper": lambda inp: fixture("reviews.json"),
    "apify~google-search-scraper": lambda inp: fixture("serp.json"),
    "apify~instagram-profile-scraper": lambda inp: [dict(fixture("instagram.json")[0], username=u) for u in inp["usernames"]],
    "apify~facebook-pages-scraper": lambda inp: [dict(fixture("facebook.json")[0], facebookUrl=s["url"],
                                                      pageId=str(100000000000000 + i)) for i, s in enumerate(inp["startUrls"], 1)],
    "clockworks~tiktok-profile-scraper": lambda inp: fixture("tiktok.json"),
    "tri_angle~snapchat-scraper": lambda inp: fixture("snapchat.json"),
    "apify~website-content-crawler": lambda inp: [],
    "apify~facebook-ads-scraper": lambda inp: [],
}


class FakeApify:
    """Apify's run_batch with the real rules: the meter is reserved before each start, a known run is read again
    instead of started, a run cap, and usageTotalUsd counted."""

    def __init__(self, meter: Meter, known: dict[str, str], on_started: Any, started: int, *, usd_each: float = 0.02,
                 crash_after_start: Optional[str] = None, max_runs: int = 40):
        self.meter, self.known, self.on_started = meter, dict(known), on_started
        self.settled: dict[str, float] = {}
        self.runs_started = started
        self.usd_each = usd_each
        self.crash_after_start = crash_after_start
        self.max_runs = max_runs
        self.started: list[str] = []
        self.reread: list[str] = []

    def me(self) -> dict[str, Any]:
        return {"plan": {"id": "STARTER"}}

    def limits(self) -> dict[str, Any]:
        return {"current": {"monthlyUsageUsd": 6.0}, "limits": {"maxMonthlyUsageUsd": 29.0}}

    def run_batch(self, jobs: list[Job]) -> dict[str, Result]:
        out = {}
        for j in jobs:
            r = Result(key=j.key)
            if j.key in self.known:
                self.reread.append(j.key)
                held = 0.0 if j.key in self.settled else self.meter.hold(max(j.estimate * 3, 0.05))
            else:
                if self.runs_started >= self.max_runs:
                    r.refused = f"Not checked: {j.label}. This report reached its {self.max_runs} actor runs."
                    out[j.key] = r
                    continue
                try:
                    held = self.meter.reserve(j.label, j.estimate, ceiling=max(j.estimate * 3, 0.05))
                except BudgetRefused as e:
                    r.refused = e.sentence
                    out[j.key] = r
                    continue
                run_id = f"run-{len(self.started) + 1}-{j.key}"
                self.started.append(j.key)
                self.runs_started += 1
                self.known[j.key] = run_id
                self.on_started(j.key, run_id)
                if self.crash_after_start == j.key:
                    raise KeyboardInterrupt("the worker died mid-pull")
            r.items = ACTOR_FIXTURES[j.actor](j.input)[: j.max_items]
            if j.key in self.settled:
                self.meter.release(held)
                r.usd = self.settled[j.key]
            else:
                r.usd = self.usd_each
                self.meter.settle(held, r.usd)
                self.settled[j.key] = r.usd
            out[j.key] = r
        return out


def sc_get(calls: list[str]) -> Any:
    def get(url: str, **kw: Any) -> Any:
        assert url.startswith("https://api.scrapecreators.com/"), url
        calls.append(url.split("?")[0])
        if "/adLibrary/company/ads" in url:
            return fixture("sc_company_ads.json")
        if "/adLibrary/search/companies" in url:
            return fixture("sc_company_search.json")
        if "/adLibrary/search/ads" in url:
            return fixture("sc_search_ads.json")
        if "/instagram/profile" in url:
            return fixture("sc_instagram_profile.json")
        if "/credit-balance" in url:
            return {"creditCount": 12000}
        raise AssertionError(f"unexpected ScrapeCreators path {url}")
    return get


SITE = {
    "https://cedar-invented.example": """<html><head><title>Cedar Invented Interiors</title>
<meta name="description" content="Villa interiors in Kuwait">
<script src="https://connect.facebook.net/en_US/fbevents.js"></script><script>fbq('init','1');</script>
<script src="https://www.googletagmanager.com/gtm.js?id=GTM-ABCD12"></script></head>
<body><h1>Villa interiors</h1><p>Design packages from KWD 1,500.</p>
<a href="/services">Our services</a><a href="https://wa.me/96500000000">WhatsApp us</a>
<a href="https://www.instagram.com/cedar.invented/">Instagram</a><a href="https://www.tiktok.com/@cedar.invented">TikTok</a>
<a href="https://www.snapchat.com/add/cedarinvented">Snap</a><button>Book a consultation</button><form></form></body></html>""",
    "https://cedar-invented.example/services": "<html><head><title>Services</title></head><body><p>Kitchens from KWD 900</p></body></html>",
}


def rival_site(n: int) -> str:
    return (f"<html><head><title>Rival {n}</title></head><body><p>Interiors from KWD {n}00</p>"
            f"<a href='https://www.instagram.com/rival{n}.invented/'>ig</a>"
            f"<a href='https://www.facebook.com/rival{n}invented'>fb</a>"
            + (f"<a href='https://www.tiktok.com/@rival{n}.invented'>tt</a>" if n == 1 else "") + "</body></html>")


def web_get(seen: list[str]) -> Any:
    def get(url: str) -> tuple[int, str]:
        seen.append(url)
        if url.endswith("/robots.txt"):
            return (200, "User-agent: *\nDisallow: /private\n")
        base = url.rstrip("/")
        if base in SITE:
            return (200, SITE[base])
        m = re.match(r"https://rival(\d)\.example", base)
        if m:
            return (200, rival_site(int(m.group(1))))
        return (404, "")
    return get


def _data(user: str) -> Any:
    m = re.search(r"<data>\n(.*)\n</data>", user, re.S)
    return json.loads(m.group(1)) if m else None


class FakeEngine:
    """Answers the four prompts from the data they carry, as a well-behaved model would. Knobs make it misbehave."""

    name = "fake"

    def __init__(self, *, unreachable_on: Optional[str] = None, digit_in_en: bool = False, digit_stays: bool = False,
                 pick_outside: bool = False, unreachable_times: int = 1):
        self.calls: list[str] = []
        self.prompts: list[str] = []
        self.unreachable_on = unreachable_on
        self.unreachable_times = unreachable_times
        self.digit_in_en = digit_in_en
        self.digit_stays = digit_stays
        self.pick_outside = pick_outside

    def complete(self, system: str, user: str, *, model: str, timeout: float) -> Any:
        from mi.model import ModelUnreachable, Reply
        kind = ("pick" if user.startswith("Choose the client's") else "write_en" if user.startswith("Write the English")
                else "write_ar" if user.startswith("Write the Arabic") else "repair" if user.startswith("Your JSON broke")
                else "ping")
        self.calls.append(kind)
        self.prompts.append(system + user)
        if self.unreachable_on == kind:
            self.unreachable_times -= 1
            if self.unreachable_times <= 0:
                self.unreachable_on = None
            raise ModelUnreachable("The Claude sign-in on the VPS has lapsed, so research waits.")
        assert "<data>" in user or kind == "ping"
        d = _data(user)
        out: Any
        if kind == "ping":
            return Reply(text="OK", model=model)
        if kind == "pick":
            c = d["candidates"]
            comps = [{"kid": x["kid"], "why": "Sells the same villa interiors in the same districts.", "evidence": x["evidence"]} for x in c[:6]]
            if self.pick_outside:
                comps[0] = {"kid": "K99", "why": "Made up.", "evidence": []}
            out = {"competitors": comps, "reserves": [{"kid": x["kid"], "why": "Close but smaller.", "evidence": x["evidence"]} for x in c[6:8]]}
        elif kind == "write_en":
            out = self._findings(d)
        elif kind == "write_ar":
            out = json.loads(json.dumps(d))
            out["lang"] = "ar"
            for s in out["sections"]:
                s["title"] = "[ar] " + s["title"]
                for cl in s["claims"]:
                    cl["text"] = "[ar] " + cl["text"]
            for comp in out["competitors"]:
                comp["why"] = "[ar] " + comp["why"]
            out["labels"] = {"clientClaim": "[ar] form of {date}", "recommendation": "[ar] recommendation",
                             "notChecked": "[ar] not checked", "sources": "[ar] sources", "evidence": "[ar] evidence"}
        else:
            out = json.loads(json.dumps(d))
            if not self.digit_stays:
                for s in out["sections"]:
                    for cl in s["claims"]:
                        cl["text"] = re.sub(r"(?<!\{m)\d", "", cl["text"]).replace("  ", " ")
        return Reply(text="```json\n" + json.dumps(out, ensure_ascii=False) + "\n```", model=model, usage={"inputTokensEst": 10})

    def ping(self, model: str, timeout: float = 120) -> str:
        return "OK"

    def _findings(self, d: dict[str, Any]) -> dict[str, Any]:
        ev = d["evidence"]
        first_of = lambda **k: next((e["eid"] for e in ev if all(e.get(a) == b for a, b in k.items())), ev[0]["eid"])  # noqa: E731
        metric_of = {(m["of"], m["metric"]) for m in d["metrics"]}
        form = first_of(kind="form")
        client = first_of(subject="client", kind="maps_place")
        web_e = first_of(subject="client", kind="web_page")
        market = first_of(subject="market")

        def claim(cid: str, kind: str, text: str, evid: list[str], metrics: Optional[list[tuple[str, str, str]]] = None) -> dict[str, Any]:
            ms = [{"ref": r, "metric": m, "of": o} for r, m, o in (metrics or []) if (o, m) in metric_of]
            for r, m, o in (metrics or []):
                if (o, m) not in metric_of:
                    text = text.replace("{" + r + "}", "unknown")
            return {"id": cid, "kind": kind, "text": text, "evidence": evid, "metrics": ms}

        summary_text = "The client is rated {m1} on Google." + (" It has 4 rivals." if self.digit_in_en else "")
        sections = []
        from mi.prompts import SECTIONS
        for key, title, _ in SECTIONS:
            claims = []
            if key == "summary":
                claims.append(claim("summary-1", "research", summary_text, [client], [("m1", "maps.rating", "client")]))
            elif key == "profile":
                claims.append(claim("profile-1", "client_claim", "The client says it focuses on villa interiors.", [form]))
            elif key == "presence":
                claims.append(claim("presence-1", "research", "The site carries the Meta Pixel: {m1}.", [web_e], [("m1", "web.meta_pixel", "client")]))
            elif key == "competitors":
                for comp in d["competitors"]:
                    claims.append(claim(f"competitors-{comp['cid'].lower()}", "research", f"{comp['name']} is a direct rival.", comp["evidence"][:2]))
            elif key == "positioning":
                claims.append(claim("positioning-1", "recommendation", "Lead with fixed-price villa packages.", [client]))
            elif key == "plan":
                claims.append(claim("plan-1", "recommendation", "In the first 30 days, fix the Maps listing.", [client]))
            elif key == "limits":
                claims.append({"id": "limits-1", "kind": "limit", "text": "Some channels were not checked; they are listed below.",
                               "evidence": [], "metrics": []})
            else:
                claims.append(claim(f"{key}-1", "research", "Rivals advertise free consultations.", [market]))
            sections.append({"key": key, "title": title, "claims": claims})
        return {"schema": "mi.findings.v1", "lang": "en", "sections": sections,
                "competitors": [{"cid": c["cid"], "name": c["name"], "why": c["why"] or "A direct rival.",
                                 "evidence": c["evidence"][:3]} for c in d["competitors"]],
                "mysteryShop": {"speed": None, "note": "not part of this research"}}


class World:
    """Everything a run touches, faked, with counters."""

    def __init__(self, home: Optional[FakeHome] = None, engine: Optional[FakeEngine] = None, **apify_kw: Any):
        self.home = home or FakeHome()
        self.engine = engine or FakeEngine()
        self.ledger = Ledger(self.home.ledger_row, f"market-intel:{RUN}")
        self.web_seen: list[str] = []
        self.sc_calls: list[str] = []
        self.apifies: list[FakeApify] = []
        self.apify_kw = apify_kw

    def deps(self) -> Deps:
        def make_apify(meter: Meter, known: dict[str, str], on_started: Any, started: int) -> FakeApify:
            a = FakeApify(meter, known, on_started, started, **self.apify_kw)
            self.apifies.append(a)
            return a

        def make_sc(meter: Meter) -> ScrapeCreators:
            return ScrapeCreators("sc-key-test", self.ledger, meter, get=sc_get(self.sc_calls))

        return Deps(home=self.home, ledger=self.ledger, engine=self.engine,
                    fetcher=web.Fetcher(self.ledger, get=web_get(self.web_seen), resolve=public_dns), make_apify=make_apify,
                    make_sc=make_sc,
                    now=lambda: NOW)

    @property
    def started(self) -> list[str]:
        return [k for a in self.apifies for k in a.started]
