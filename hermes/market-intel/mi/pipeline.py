"""One research run, in stages, resumable. Code does every pull; the model only picks and writes, with no tools.

  A  the client's own presence: Maps listing (two identifiers or "not found"), website, brand search, Instagram,
     Facebook, reviews, its Meta ads, TikTok and Snapchat when a handle is found, followers a second time, and
     the NAP check (inside the database). The form answers and the Blueprint's named rivals are evidence too.
  B  discovery: Maps searches by what they sell where they sell it, the local search with its ads, who
     advertises the service on Meta now; code scores the candidates and keeps 25; the model picks 6 and 2
     reserves from them (a pick outside the shortlist is refused).
  C  the 6 in depth: websites, reviews, Instagram, Facebook, their Meta ads, TikTok when found.
  D  write the English findings, check them (eight rules), one repair; the Arabic edition, checked again.
  E  render the three tabs, the card field and the comment into the run folder, store findings and
     competitors in Supabase, end the run. Shadow: nothing is published.

Resume: the run folder holds the raw result of every finished pull (a pull is never paid for twice) and every
model answer; Apify run ids are recorded before polling, and the cost of each finished run is kept beside the
spend it explains, so a resume never counts it twice. Each pull reserves its estimate on the spend meter first;
a refused pull is named in the report as "Not checked: ...".

Waiting is not a try: an engine outage or an unreadable month sends the run back to the queue as an outage
(the database gives the try back and ends the run needs_person after 24 hours of waiting); research turned off
mid-run stops the run before its next pull or model call and it waits, paused. Only an unexpected error or a
lost lease counts toward the three tries.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Optional

from . import check as checker
from . import discover, model, prompts, render
from .apify import Apify, ApifyError, Job
from .config import PRICE, Config
from .evidence import Draft, Pack
from .facts import Facts
from .ledger import LedgerDown
from .meter import BudgetRefused, Meter, from_claim
from .model import ModelError, ModelUnreachable
from .sources import (adlibrary, domain, facebook, handle, instagram, is_social, maps, name_match, reviews, serp,
                      snapchat, tiktok, web)
from .store import RunFolder
from .supabase import SupabaseError

CHANNELS = ("maps", "website", "instagram", "facebook", "ads", "tiktok_snapchat")
# Keys never kept, even in the raw pull cache: a reviewer, a page's or a listing's contact details. The listing
# phone lives only in memory, for the NAP check in the database (pipeline.Runner._fresh).
PERSONAL = {"name", "reviewer", "reviewerName", "reviewerId", "reviewerUrl", "reviewerPhotoUrl", "reviewerNumberOfReviews",
            "isLocalGuide", "author", "authorName", "userName", "profileUrl", "reviewImageUrls"}
CONTACT = {"phone", "phoneUnformatted", "phones", "email", "emails", "contactInfo", "whatsapp", "messenger"}


def sanitize(actor: str, items: list[Any]) -> list[Any]:
    drop = CONTACT | (PERSONAL if "Reviews" in actor else set())
    return [{k: v for k, v in it.items() if k not in drop} if isinstance(it, dict) else it for it in items]


class LeaseLost(Exception):
    pass


class Paused(Exception):
    """market_intel.on turned false mid-run: stop before the next pull or model call; the run waits, paused."""

    def __init__(self, sentence: str):
        super().__init__(sentence)
        self.sentence = sentence


STOPPED = ("Market research was turned off, so this run stopped before its next pull. It resumes from its folder "
           "once research is on again.")
# Back to the queue: minutes to wait, by why (the database doubles an outage's wait up to 4 hours).
RETRY_MINUTES = {"model": 60, "spend": 30, "paused": 5, "error": 30}


@dataclass
class Deps:
    home: Any                                            # supabase.Home
    ledger: Any
    engine: Any
    fetcher: Any                                         # sources.web.Fetcher
    make_apify: Callable[[Meter, dict[str, str], Callable[[str, str], None], int], Apify]
    make_sc: Callable[[Meter], Any]                      # ScrapeCreators or None (no key)
    now: Callable[[], datetime] = field(default=lambda: datetime.now(timezone.utc))


@dataclass
class Outcome:
    state: str                    # done, needs_person, failed, released, lost
    sentence: str
    summary: dict[str, Any] = field(default_factory=dict)


class Runner:
    def __init__(self, cfg: Config, deps: Deps, claim: dict[str, Any]):
        self.cfg, self.deps, self.claim = cfg, deps, claim
        self.run_id = str(claim["runId"])
        self.token = str(claim["claim"])
        self.task = str(claim["taskId"])
        self.mode = str(claim.get("mode") or "shadow")
        self.folder = RunFolder(cfg.runs_dir, self.run_id)
        self.meter = from_claim(claim, cap_run_code=cfg.usd_cap_run, cap_month_code=cfg.usd_cap_month,
                                sc_rate=cfg.sc_usd_per_credit)
        local = self.folder.read_json("progress.json") or {}
        remote = claim.get("stageProgress") or {}
        self.p: dict[str, Any] = {"pulls": {}, "apifyRuns": {}, "apifyUsd": {}, "steps": {}, "stored": 0, **remote, **local}
        for k in ("pulls", "apifyRuns", "apifyUsd", "steps"):
            self.p[k] = {**(remote.get(k) or {}), **(local.get(k) or {})}
        self.pack = Pack(self.folder.read_json("evidence.json") or [])
        self.warnings: list[str] = list(self.folder.read_json("warnings.json") or [])
        self.not_checked: list[str] = list(self.folder.read_json("not_checked.json") or [])
        self.presence: dict[str, dict[str, Any]] = self.folder.read_json("presence.json") or {}
        self.usage: dict[str, Any] = {}
        self._apify: Optional[Apify] = None
        self._sc: Any = None
        self._fresh: dict[str, Any] = {}       # this process's unsanitised results (never written to disk)
        self.stopped: Optional[str] = None     # set when a save reads market_intel.on = false

    # ---- bookkeeping ----------------------------------------------------------------------------------------
    def save(self, state: Optional[str] = None) -> None:
        self.folder.write_json("progress.json", self.p)
        self.folder.write_json("evidence.json", self.pack.items)
        self.folder.write_json("warnings.json", self.warnings[-200:])
        self.folder.write_json("not_checked.json", self.not_checked)
        self.folder.write_json("presence.json", self.presence)
        new = self.pack.items[self.p.get("stored", 0):]
        if new:
            self.deps.home.store(self.run_id, self.token, "evidence", new)
            self.p["stored"] = len(self.pack.items)
            self.folder.write_json("progress.json", self.p)
        mirror = {"pulls": self.p["pulls"], "apifyRuns": self.p["apifyRuns"], "apifyUsd": self.p["apifyUsd"],
                  "steps": self.p["steps"], "stored": self.p["stored"], "stage": self.p.get("stage")}
        out = self.deps.home.progress(self.run_id, self.token, state, mirror,
                                      {**self.meter.spend(), **({"modelUsage": self.usage} if self.usage else {})})
        self._read_switch(out)

    def _read_switch(self, out: Any) -> None:
        """Each save reads the setting again: off stops the run before its next pull or model call, and a changed
        cap applies to the next pull (the lower of the setting's and the worker's own still wins)."""
        if not isinstance(out, dict):
            return
        if out.get("on") is False:
            self.stopped = STOPPED
        if isinstance(out.get("caps"), dict):
            self.meter.set_caps(out["caps"], cap_run_code=self.cfg.usd_cap_run, cap_month_code=self.cfg.usd_cap_month)

    def _go_on(self) -> None:
        if self.stopped:
            raise Paused(self.stopped)

    def _started(self, key: str, run_id: str) -> None:
        self.p["apifyRuns"][key] = run_id
        self.save()

    def apify(self) -> Apify:
        if self._apify is None:
            self._apify = self.deps.make_apify(self.meter, self.p["apifyRuns"], self._started, len(self.p["apifyRuns"]))
            self._apify.settled = self.p["apifyUsd"]      # saved with the spend it explains
        return self._apify

    def sc(self) -> Any:
        if self._sc is None:
            self._sc = self.deps.make_sc(self.meter)
        return self._sc

    def mark(self, key: str, state: str) -> None:
        self.p["pulls"][key] = state

    def refused(self, key: str, sentence: str) -> None:
        self.mark(key, "refused")
        if sentence not in self.not_checked:
            self.not_checked.append(sentence)

    def step(self, key: str, produce: Callable[[], Any], to_drafts: Callable[[Any], list[Draft]]) -> Any:
        """Run one pull once. Its raw result is cached before its evidence is numbered, so a resume neither pays
        for it again nor numbers it twice. A refused or failed pull returns None."""
        state = self.p["pulls"].get(key)
        if state in ("refused", "failed"):
            return None
        raw = self.folder.cached(key)
        if raw is None:
            self._go_on()
            try:
                raw = produce()
            except BudgetRefused as e:
                self.refused(key, e.sentence)
                return None
            except LedgerDown as e:
                self.mark(key, "failed")
                self.warnings.append(str(e))
                return None
            except Exception as e:  # noqa: BLE001  (an adapter or provider failure is a warning, not a crash)
                self.mark(key, "failed")
                self.warnings.append(f"{key}: {type(e).__name__}: {str(e)[:160]}")
                return None
            if raw is None:
                self.mark(key, "failed")
                return None
            self.folder.cache(key, raw)
        if state != "done":
            try:
                self.pack.extend(to_drafts(raw))
            except Exception as e:  # noqa: BLE001
                self.warnings.append(f"{key}: the result could not be read: {str(e)[:160]}")
            self.mark(key, "done")
        return raw

    def prefetch(self, jobs: list[Job]) -> None:
        """Start the Apify jobs that are neither cached nor settled, together (bounded concurrency)."""
        todo = [j for j in jobs if self.p["pulls"].get(j.key) not in ("done", "refused", "failed")
                and self.folder.cached(j.key) is None]
        if not todo:
            return
        self._go_on()
        try:
            results = self.apify().run_batch(todo)
        except ApifyError as e:
            for j in todo:
                self.mark(j.key, "failed")
            self.warnings.append(str(e))
            return
        for key, r in results.items():
            if r.refused:
                self.refused(key, r.refused)
            elif r.error:
                self.mark(key, "failed")
                self.warnings.append(r.error)
            else:
                actor = next(j.actor for j in todo if j.key == key)
                self._fresh[key] = {"items": r.items, "usd": r.usd}
                self.folder.cache(key, {"items": sanitize(actor, r.items), "usd": r.usd})
        self.save()

    # ---- the run --------------------------------------------------------------------------------------------
    def execute(self) -> Outcome:
        if self.meter.month_before is None:
            return self.release("This month's research spend could not be read, so nothing was pulled. The run waits.",
                                kind="outage", minutes=RETRY_MINUTES["spend"])
        if self.p.get("stored", 0) and not self.pack.items:
            return self.finish("needs_person", "This run's local folder is gone, so it cannot resume without paying "
                                               "again. Run research again from the cockpit.", {})
        try:
            self.inp = self.deps.home.input(self.run_id)
            self.answers = self.inp.get("answers") or {}
            self.card = self.inp.get("card") or {}
            self.name = str(self.answers.get("businessName") or self.card.get("name") or "").strip()
            self.iso, _ = discover.country_of(self.card)
            self.country = (self.iso or "").lower()
            self.p["stage"] = "A"
            self.save("pulling")
            self.stage_a()
            self.p["stage"] = "B"
            self.save("pulling")
            short = self.stage_b()
            self.save("picking")
            self.comps = self.pick(short)
            self.p["stage"] = "C"
            self.save("pulling")
            self.stage_c()
            self.facts = self.compute_facts()
            self.save("writing")
            return self.write_and_finish()
        except ModelUnreachable as e:
            return self.release(e.sentence, kind="outage", minutes=RETRY_MINUTES["model"])
        except Paused as e:
            return self.release(e.sentence, kind="paused", minutes=RETRY_MINUTES["paused"])
        except SupabaseError as e:
            if "lease" in str(e).lower():
                return Outcome("lost", "Another worker holds this run now.")
            raise

    def release(self, sentence: str, *, kind: str = "error", minutes: int = RETRY_MINUTES["error"]) -> Outcome:
        """Back to the queue. `kind`: error (counts as a try), outage (the engine or the month's spend: not a try,
        and after 24 hours of waiting the database ends the run needs_person), paused (research turned off)."""
        try:
            self.save()
        except SupabaseError:
            pass
        out = self.deps.home.release(self.run_id, self.token, sentence, minutes, kind)
        if isinstance(out, dict) and out.get("state") == "needs_person":
            return Outcome("needs_person", str(out.get("sentence") or sentence), self._summary())
        return Outcome("released", sentence)

    def finish(self, state: str, sentence: str, summary: dict[str, Any]) -> Outcome:
        self.save("publishing" if state == "done" else None)
        self.deps.home.done(self.run_id, self.token, state, sentence, summary)
        return Outcome(state, sentence, summary)

    # ---- stage A ----------------------------------------------------------------------------------------------
    def stage_a(self) -> None:
        caps, a = self.cfg.caps, self.answers
        form_body = {k: v for k, v in a.items()}
        self.step("A:form", lambda: {"answers": form_body}, lambda raw: [Draft(
            kind="form", subject="client", source="cockpit:onboarding form", retrieved_at=self.inp.get("formDate"),
            body={"claimsOfTheClient": raw["answers"], "formDate": self.inp.get("formDate")})])
        if self.inp.get("blueprintCompetitors"):
            self.step("A:blueprint", lambda: {"text": self.inp["blueprintCompetitors"]}, lambda raw: [Draft(
                kind="blueprint", subject="client", source="cockpit:blueprint",
                body={"rivalsNamedByTheClient": raw["text"]})])

        # The Maps listing: by the client's own link, else a search matched by two identifiers.
        link = str(a.get("mapsLink") or "")
        from_link = bool(link and any(h in link for h in ("google.", "goo.gl", "maps.app")))
        area = (discover.areas(a, None) or [""])[0]
        location = ", ".join(x for x in (area, discover.COUNTRIES.get(self.iso or "", ("",))[0]) if x)
        jobs = []
        if from_link:
            jobs.append(Job("A:maps", self.cfg.actor("maps"), maps.place_input(link), "the client's Maps listing",
                            PRICE["maps_place"], 1))
        elif self.name and location:
            jobs.append(Job("A:maps", self.cfg.actor("maps"), maps.search_input(self.name, location, language="en", max_places=3),
                            "the client's Maps listing", PRICE["maps_place"] * 3, 3))
        self.prefetch(jobs)
        raw = self.step("A:maps", lambda: None, lambda raw: [])
        raw = self._fresh.get("A:maps") if raw is not None and "A:maps" in self._fresh else raw
        self.client_place: Optional[maps.Place] = None
        if raw is not None:
            places = maps.parse(raw.get("items") or [])
            self.warnings.extend(w for p in places for w in p.warnings)
            # Which place is the client is decided once, with the listing phones in memory, and kept: a resume reads
            # the cache, which holds no phone, so asking again could lose a place matched by name and phone.
            ident = self.folder.cached("A:maps:identity")
            if isinstance(ident, dict) and "index" in ident:
                i = ident.get("index")
                place = places[i] if isinstance(i, int) and 0 <= i < len(places) else None
                why = str(ident.get("why") or "")
            else:
                place, why = maps.identify(places, business_name=self.name, website=a.get("website"), from_link=from_link,
                                           phone_matches=lambda ph: self.deps.home.nap(self.run_id, ph))
                self.folder.cache("A:maps:identity", {"index": places.index(place) if place else None, "why": why})
            if place:
                self.client_place = place
                self.step("A:maps:place", lambda: {"ok": True}, lambda _r: [maps.draft(place, "client", raw.get("usd", 0))])
                self.step("A:nap", lambda: {"result": self.deps.home.nap(self.run_id, place.phone)}, lambda r: [Draft(
                    kind="nap", subject="client", source="cockpit:nap", url=place.url,
                    body={"result": r["result"], "rule": why})])
                self.presence["maps"] = {"state": "found", "why": why}
            else:
                self.presence["maps"] = {"state": "none_found", "why": why}
        else:
            self.presence["maps"] = self._not_checked("A:maps", "no business name or area to search with"
                                                      if not jobs else "the Maps pull did not finish")

        # The website, read directly (free); the crawler only when the site refuses a direct read.
        site = a.get("website") if a.get("website") and not is_social(a.get("website")) else None
        site = site or self.card.get("website") or (self.client_place.website if self.client_place else None)
        site = site if site and not is_social(site) else None
        self.client_pages: list[web.Page] = []
        if site:
            site = site if site.startswith("http") else "https://" + site
            direct = self.step("A:web", lambda: self._crawl(site, caps.client_web_pages),
                               lambda raw: web.drafts([web.Page(**p) for p in raw["pages"]], "client", web.SOURCE_DIRECT))
            if direct is None or not direct.get("pages"):
                self.prefetch([Job("A:webcrawl", self.cfg.actor("web"), web.crawler_input(site, caps.client_web_pages),
                                   "the client's website", PRICE["web_page_apify"] * caps.client_web_pages, caps.client_web_pages)])
                raw = self.step("A:webcrawl", lambda: None, lambda raw: web.drafts(
                    web.parse_crawler(raw.get("items") or []), "client", web.SOURCE_APIFY, raw.get("usd", 0)))
                self.client_pages = web.parse_crawler((raw or {}).get("items") or [])
            else:
                self.client_pages = [web.Page(**p) for p in direct["pages"]]
            self.presence["website"] = {"state": "found", "why": domain(site)} if self.client_pages else \
                self._not_checked("A:webcrawl", "the website could not be read")
        else:
            self.presence["website"] = {"state": "none_found", "why": "no website in the answers, on the card or on Maps"}

        found = web.socials(self.client_pages)
        ig = handle("instagram", a.get("instagram")) or found.get("instagram")
        fb_url = str(a.get("facebook")).strip() if "facebook.com" in str(a.get("facebook") or "") else (
            f"https://www.facebook.com/{found['facebook']}" if found.get("facebook") else None)
        if fb_url and not fb_url.startswith("http"):
            fb_url = "https://" + fb_url
        jobs = []
        if self.client_place and self.client_place.url:
            jobs.append(Job("A:reviews", self.cfg.actor("reviews"), reviews.job_input(self.client_place.url, caps.client_reviews),
                            "the client's Google reviews", PRICE["review"] * caps.client_reviews, caps.client_reviews))
        if ig:
            jobs.append(Job("A:ig", self.cfg.actor("instagram"), instagram.job_input([ig]), "the client's Instagram",
                            PRICE["ig_profile"], 1))
        if fb_url:
            jobs.append(Job("A:fb", self.cfg.actor("facebook"), facebook.job_input([fb_url]), "the client's Facebook page",
                            PRICE["fb_page"], 1))
        if self.name:
            qs = [f'"{self.name}"', f"{self.name} {area}".strip(), f"{self.name} reviews"][:caps.brand_queries]
            jobs.append(Job("A:serp", self.cfg.actor("serp"), serp.job_input(qs, country=self.country or "us", language="en"),
                            "the brand search", PRICE["serp_page"] * len(qs) + PRICE["serp_ads"], len(qs)))
        self.prefetch(jobs)
        if self.client_place and self.client_place.url:
            self.step("A:reviews", lambda: None, lambda raw: self._review_drafts(raw, "client", self.client_place.url))
        self.step("A:serp", lambda: None, lambda raw: serp.drafts(serp.parse(raw.get("items") or []), raw.get("usd", 0), "client"))
        ig_raw = self.step("A:ig", lambda: None, lambda raw: [instagram.draft(p, "client", raw.get("usd", 0))
                                                              for p in instagram.parse(raw.get("items") or []).values()]) if ig else None
        ig_profile = next(iter(instagram.parse((ig_raw or {}).get("items") or []).values()), None) if ig_raw else None
        self.presence["instagram"] = {"state": "found", "why": ig} if ig_profile else (
            self._not_checked("A:ig", "the Instagram pull did not finish") if ig else
            {"state": "none_found", "why": "no Instagram link in the answers or on the website"})
        if ig:
            self.step("A:ig:sc", lambda: self._sc_ig(ig, "the client's Instagram followers (second source)"),
                      lambda raw: [Draft(kind="ig_profile", subject="client", source=instagram.SOURCE_SC,
                                         url=f"https://www.instagram.com/{ig}/", usd=raw["usd"],
                                         body={"handle": ig, "followers": raw["followers"], "secondSource": True})]
                      if raw.get("followers") is not None else [])
        fb_raw = self.step("A:fb", lambda: None, lambda raw: [facebook.draft(p, "client", raw.get("usd", 0))
                                                              for p in facebook.parse(raw.get("items") or [])]) if fb_url else None
        fb_page = (facebook.parse((fb_raw or {}).get("items") or []) or [None])[0] if fb_raw else None
        self.presence["facebook"] = {"state": "found", "why": "page read"} if fb_page else (
            self._not_checked("A:fb", "the Facebook pull did not finish") if fb_url else
            {"state": "none_found", "why": "no Facebook page in the answers or on the website"})

        # The client's own Meta ads.
        self.presence["ads"] = self._ads("client", self.name, (fb_page or {}).get("pageId"), caps.client_ads, pages=2)

        # TikTok and Snapchat, only for a handle the site or the Instagram bio names.
        bio = " ".join(str(x or "") for x in ((ig_profile or {}).get("bio"), (ig_profile or {}).get("externalUrl")))
        tt = found.get("tiktok") or handle("tiktok", bio)
        sn = found.get("snapchat") or handle("snapchat", bio)
        jobs = []
        if tt:
            jobs.append(Job("A:tiktok", self.cfg.actor("tiktok"), tiktok.job_input(tt, caps.client_tiktok), "the client's TikTok",
                            PRICE["tiktok_result"] * caps.client_tiktok, caps.client_tiktok))
        if sn:
            jobs.append(Job("A:snap", self.cfg.actor("snapchat"), snapchat.job_input(sn), "the client's Snapchat",
                            PRICE["snap_profile"], 1))
        self.prefetch(jobs)
        got = []
        if tt:
            r = self.step("A:tiktok", lambda: None, lambda raw: [tiktok.draft(p, "client", raw.get("usd", 0)) for p in
                                                                [tiktok.parse(raw.get("items") or [], tt)] if p])
            got.append(r is not None)
        if sn:
            r = self.step("A:snap", lambda: None, lambda raw: [snapchat.draft(p, "client", raw.get("usd", 0)) for p in
                                                              [snapchat.parse(raw.get("items") or [], sn)] if p])
            got.append(r is not None)
        if not tt and not sn:
            self.presence["tiktok_snapchat"] = {"state": "none_found", "why": "no account found (looked on the website and the Instagram bio)"}
        elif any(got):
            self.presence["tiktok_snapchat"] = {"state": "found", "why": ", ".join(x for x in (tt and f"TikTok {tt}", sn and f"Snapchat {sn}") if x)}
        else:
            self.presence["tiktok_snapchat"] = {"state": "not_checked", "why": "the TikTok or Snapchat pull did not finish"}
        self.save()

    def _not_checked(self, key: str, why: str) -> dict[str, Any]:
        if self.p["pulls"].get(key) == "refused":
            why = "the research budget refused the pull"
        return {"state": "not_checked", "why": why}

    def _crawl(self, site: str, n: int) -> Optional[dict[str, Any]]:
        pages, warns = self.deps.fetcher.crawl(site, n)
        self.warnings.extend(warns)
        if not pages:
            return None
        return {"pages": [{k: getattr(p, k) for k in ("url", "title", "description", "text", "tracking", "booking",
                                                       "prices", "ctas", "forms", "links")} for p in pages]}

    def _review_drafts(self, raw: dict[str, Any], subject: str, place_url: Optional[str]) -> list[Draft]:
        items, header = reviews.parse(raw.get("items") or [])
        out = reviews.drafts(items, subject, place_url, raw.get("usd", 0))
        if header.get("rating") is not None or header.get("reviewsN") is not None:
            out.append(Draft(kind="maps_place", subject=subject, source=reviews.SOURCE, url=place_url,
                             body={"rating": header.get("rating"), "reviewsN": header.get("reviewsN"), "secondSource": True}))
        return out

    def _sc_ig(self, h: str, label: str) -> Optional[dict[str, Any]]:
        sc = self.sc()
        if sc is None:
            return None
        before = self.meter.usd_sc
        out = sc.instagram_profile(h, label=label)
        return {"followers": instagram.sc_followers(out), "usd": round(self.meter.usd_sc - before, 5)}

    def _ads(self, subject: str, name: str, page_id: Optional[str], limit: int, pages: int) -> dict[str, Any]:
        """A business's active Meta ads: ScrapeCreators by page id (found by a company search when the page did not
        give one), else the Apify ads actor. Always one summary item when checked, so a checked zero is a zero."""
        key = f"{'A' if subject == 'client' else 'C'}:ads:{subject}"
        country = (self.iso or "KW").upper()

        def produce() -> Optional[dict[str, Any]]:
            sc = self.sc()
            pid = page_id
            before = self.meter.usd_sc
            if sc is not None:
                if not pid and name:
                    pid = adlibrary.pick_page(sc.fb_search_companies(name, label=f"the Ad Library page of {subject}"), name, name_match)
                if pid:
                    items = sc.fb_company_ads(pid, country=country, pages=pages, label=f"the Meta ads of {subject}")
                    return {"pageId": pid, "items": items[:limit], "usd": round(self.meter.usd_sc - before, 5),
                            "source": adlibrary.SOURCE_SC}
                return {"pageId": None, "items": [], "usd": round(self.meter.usd_sc - before, 5), "source": adlibrary.SOURCE_SC}
            if not pid:
                return None
            job = Job(key + ":apify", self.cfg.actor("ads"), adlibrary.apify_input(pid, None, country, limit),
                      f"the Meta ads of {subject}", PRICE["apify_ad"] * limit, limit)
            r = self.apify().run_batch([job])[job.key]
            if r.refused:
                raise BudgetRefused(r.refused)
            if r.error:
                raise ApifyError(r.error)
            return {"pageId": pid, "items": sanitize(job.actor, r.items), "usd": r.usd, "source": adlibrary.SOURCE_APIFY}

        def drafts(raw: dict[str, Any]) -> list[Draft]:
            if not raw.get("pageId"):
                return []
            ads = adlibrary.parse(raw.get("items") or [], self.deps.now())[:limit]
            lib = f"https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country={country}&view_all_page_id={raw['pageId']}"
            return adlibrary.drafts(ads, subject, raw.get("source", ""), raw.get("usd", 0)) + [Draft(
                kind="ad", subject=subject, source=raw.get("source", ""), url=lib,
                body={"summary": True, "pageId": raw["pageId"], **adlibrary.summary(ads)})]

        raw = self.step(key, produce, drafts)
        if raw is None:
            return self._not_checked(key, "the Ad Library pull did not finish")
        if not raw.get("pageId"):
            return {"state": "none_found", "why": "no Facebook page found in the Ad Library"}
        return {"state": "found", "why": f"{len(raw.get('items') or [])} active ads read"}

    # ---- stage B ----------------------------------------------------------------------------------------------
    def stage_b(self) -> list[discover.Candidate]:
        caps, a = self.cfg.caps, self.answers
        city = self.client_place.city if self.client_place else None
        plan = discover.search_plan(a, self.card, city, caps.maps_queries)
        jobs = [Job(f"B:maps:{i}", self.cfg.actor("maps"),
                    maps.search_input(q["query"], q["location"], language=q["language"], max_places=caps.maps_places_per_query),
                    f"the Maps search for {q['query']}", PRICE["maps_search_place"] * caps.maps_places_per_query,
                    caps.maps_places_per_query) for i, q in enumerate(plan)]
        words = discover.service_words(a, self.card)
        areas = discover.areas(a, city)
        local = [f"{w} {ar}".strip() for w in words for ar in (areas or [""])][:caps.local_queries]
        if local:
            jobs.append(Job("B:serp", self.cfg.actor("serp"), serp.job_input(local, country=self.country or "us", language="en"),
                            "the local search for the service", PRICE["serp_page"] * len(local) + PRICE["serp_ads"], len(local)))
        self.prefetch(jobs)
        places: list[dict[str, Any]] = []
        for j in jobs:
            if j.key.startswith("B:maps"):
                raw = self.step(j.key, lambda: None, lambda raw: [])
                places += [p.facts() | {"url": p.url} for p in maps.parse((raw or {}).get("items") or [])]
        pages = serp.parse((self.step("B:serp", lambda: None,
                                      lambda raw: serp.drafts(serp.parse(raw.get("items") or []), raw.get("usd", 0)))
                            or {}).get("items") or []) if local else []
        ads: list[dict[str, Any]] = []
        kw = list(dict.fromkeys(w for w in (words[:1] + [discover.arabic_for(words[0]) if words else None]) if w))
        kw = kw[:caps.ad_keyword_queries]
        for i, w in enumerate(kw):
            def produce(w: str = w) -> Optional[dict[str, Any]]:
                sc = self.sc()
                if sc is None:
                    return None
                before = self.meter.usd_sc
                items = sc.fb_search_ads(w, country=(self.iso or "KW").upper(), pages=1, label=f"who advertises {w} on Meta")
                return {"items": items[:caps.ads_per_keyword], "usd": round(self.meter.usd_sc - before, 5)}
            raw = self.step(f"B:ads:{i}", produce, lambda raw: adlibrary.drafts(
                adlibrary.parse(raw.get("items") or [], self.deps.now()), "market", adlibrary.SOURCE_SC, raw.get("usd", 0)))
            ads += adlibrary.parse((raw or {}).get("items") or [], self.deps.now())
        cands = discover.build(
            places, pages, ads, client_name=self.name, client_site=self.answers.get("website"),
            client_place=self.client_place.facts() if self.client_place else None,
            client_categories=self.client_place.categories if self.client_place else [], service=words,
            blueprint_text=self.inp.get("blueprintCompetitors"), not_competitors=self.inp.get("notCompetitors") or [],
            max_distance=a.get("maxDistance"), limit=caps.shortlist)
        self.step("B:shortlist", lambda: {"candidates": [c.facts() | {"placeUrl": c.place_url, "place": c.place}
                                                         for c in cands]},
                  lambda raw: [Draft(kind="maps_place", subject=c["kid"], source=maps.SOURCE, url=c.get("placeUrl"),
                                     body={k: v for k, v in (c.get("place") or {"name": c["name"]}).items()} |
                                     {"seenAdvertising": c["seenAdvertising"], "namedByClient": c["namedByClient"]})
                               for c in raw["candidates"]])
        self.save()
        return cands

    def pick(self, cands: list[discover.Candidate]) -> list[dict[str, Any]]:
        """6 competitors and 2 reserves, chosen by the model from the shortlist only; fewer valid picks are filled
        from the score order, and the reason says so."""
        caps = self.cfg.caps
        short = (self.folder.cached("B:shortlist") or {}).get("candidates") or []
        eid_of = {e["subject"]: e["eid"] for e in self.pack.items if e["subject"].startswith("K") and e["kind"] == "maps_place"}
        cand = [c | {"evidence": [eid_of[c["kid"]]] if c["kid"] in eid_of else []} for c in short]
        picked = self.folder.read_json("model/pick.json")
        if picked is None and cand:
            self._go_on()
            client = {"name": self.name, "serviceWords": discover.service_words(self.answers, self.card),
                      "areas": discover.areas(self.answers, None), "country": self.iso,
                      "categories": self.client_place.categories if self.client_place else []}
            try:
                picked = model.call_json(self.deps.engine, prompts.SYSTEM,
                                         prompts.pick(client, [{k: c[k] for k in ("kid", "name", "rating", "reviewsN",
                                                                                   "categories", "city", "website",
                                                                                   "seenAdvertising", "namedByClient",
                                                                                   "evidence")} for c in cand],
                                                      caps.competitors, caps.reserves),
                                         model=self.cfg.model_pick, timeout=self.cfg.model_timeout, usage=self.usage,
                                         label="pick")
            except ModelError as e:
                self.warnings.append(f"pick: {e}")
                picked = {"competitors": [], "reserves": [], "failed": True}
            self.folder.write_json("model/pick.json", picked)
        picked = picked or {"competitors": [], "reserves": []}
        by_kid = {c["kid"]: c for c in cand}
        chosen: list[tuple[dict[str, Any], str, list[str], bool]] = []
        used: set[str] = set()
        for group, reserve, n in (("competitors", False, caps.competitors), ("reserves", True, caps.reserves)):
            got = 0
            for p in picked.get(group) or []:
                kid = str((p or {}).get("kid") or "")
                if kid in by_kid and kid not in used and got < n:
                    ev = [e for e in (p.get("evidence") or []) if e in self.pack.ids()] or by_kid[kid]["evidence"]
                    chosen.append((by_kid[kid], str(p.get("why") or "")[:600], ev, reserve))
                    used.add(kid)
                    got += 1
                elif kid and kid not in by_kid:
                    self.warnings.append(f"pick: {kid} is not on the shortlist, so it was refused")
            for c in cand:
                if got >= n:
                    break
                if c["kid"] not in used:
                    chosen.append((c, "Picked by score: the model named fewer than were needed.", c["evidence"], reserve))
                    used.add(c["kid"])
                    got += 1
        comps = []
        for i, (c, why, ev, reserve) in enumerate(chosen, 1):
            place = c.get("place") or {}
            comps.append({"cid": f"C{i}", "kid": c["kid"], "reserve": reserve, "name": c["name"],
                          "placeUrl": c.get("placeUrl") if str(c.get("placeUrl") or "").startswith("https://") else None,
                          "website": c.get("website"), "why": why, "evidence": list(ev), "rating": place.get("rating"),
                          "reviewsN": place.get("reviewsN")})
        self.p["steps"]["pick"] = "done"
        return comps

    # ---- stage C ----------------------------------------------------------------------------------------------
    def stage_c(self) -> None:
        caps = self.cfg.caps
        main = [c for c in self.comps if not c["reserve"]]
        socials: dict[str, dict[str, Optional[str]]] = {}
        for c in main:
            pages = []
            if c.get("website") and not is_social(c["website"]):
                raw = self.step(f"C:web:{c['cid']}", lambda c=c: self._crawl(c["website"], caps.competitor_web_pages),
                                lambda raw, c=c: web.drafts([web.Page(**p) for p in raw["pages"]], c["cid"], web.SOURCE_DIRECT))
                pages = [web.Page(**p) for p in (raw or {}).get("pages") or []]
            socials[c["cid"]] = web.socials(pages)
        jobs = []
        for c in main:
            if c.get("placeUrl"):
                jobs.append(Job(f"C:reviews:{c['cid']}", self.cfg.actor("reviews"),
                                reviews.job_input(c["placeUrl"], caps.competitor_reviews), f"the reviews of {c['name'][:40]}",
                                PRICE["review"] * caps.competitor_reviews, caps.competitor_reviews))
        igs = {c["cid"]: socials[c["cid"]].get("instagram") for c in main if socials[c["cid"]].get("instagram")}
        fbs = {c["cid"]: f"https://www.facebook.com/{socials[c['cid']]['facebook']}" for c in main
               if socials[c["cid"]].get("facebook")}
        if igs:
            jobs.append(Job("C:ig", self.cfg.actor("instagram"), instagram.job_input(list(igs.values())),
                            "the rivals' Instagram", PRICE["ig_profile"] * len(igs), len(igs)))
        if fbs:
            jobs.append(Job("C:fb", self.cfg.actor("facebook"), facebook.job_input(list(fbs.values())),
                            "the rivals' Facebook pages", PRICE["fb_page"] * len(fbs), len(fbs)))
        tts = {c["cid"]: socials[c["cid"]].get("tiktok") for c in main if socials[c["cid"]].get("tiktok")}
        for cid, h in tts.items():
            jobs.append(Job(f"C:tiktok:{cid}", self.cfg.actor("tiktok"), tiktok.job_input(h, caps.competitor_tiktok),
                            f"the TikTok of {cid}", PRICE["tiktok_result"] * caps.competitor_tiktok, caps.competitor_tiktok))
        self.prefetch(jobs)
        for c in main:
            if c.get("placeUrl"):
                self.step(f"C:reviews:{c['cid']}", lambda: None,
                          lambda raw, c=c: self._review_drafts(raw, c["cid"], c["placeUrl"]))
        handle_cid = {v.lower(): k for k, v in igs.items()}
        if igs:
            self.step("C:ig", lambda: None, lambda raw: [instagram.draft(p, handle_cid[h], raw.get("usd", 0) / max(1, len(igs)))
                                                         for h, p in instagram.parse(raw.get("items") or []).items()
                                                         if h in handle_cid])
        fb_raw = self.step("C:fb", lambda: None, lambda raw: [
            facebook.draft(p, cid, raw.get("usd", 0) / max(1, len(fbs))) for p in facebook.parse(raw.get("items") or [])
            for cid in [self._fb_owner(p, fbs)] if cid]) if fbs else None
        page_ids = {self._fb_owner(p, fbs): p.get("pageId") for p in facebook.parse((fb_raw or {}).get("items") or [])}
        for c in main:
            self._ads(c["cid"], c["name"], page_ids.get(c["cid"]), caps.competitor_ads, pages=1)
        for cid, h in tts.items():
            self.step(f"C:tiktok:{cid}", lambda: None, lambda raw, cid=cid, h=h: [
                tiktok.draft(p, cid, raw.get("usd", 0)) for p in [tiktok.parse(raw.get("items") or [], h)] if p])
        # A competitor's evidence list: its candidate place plus everything pulled about it.
        for c in self.comps:
            c["evidence"] = list(dict.fromkeys(c["evidence"] + [e["eid"] for e in self.pack.of(c["cid"])]))
        self.save()

    @staticmethod
    def _fb_owner(page: dict[str, Any], fbs: dict[str, str]) -> Optional[str]:
        for cid, url in fbs.items():
            if url.rstrip("/").lower().split("facebook.com/")[-1] in str(page.get("url") or "").lower():
                return cid
        return None

    # ---- facts --------------------------------------------------------------------------------------------------
    def compute_facts(self) -> Facts:
        f = compute_facts(self.pack, self.comps)
        self.folder.write_json("facts.json", f.as_rows())
        return f

    # ---- stage D and E ------------------------------------------------------------------------------------------
    def _model(self, label: str, user: str, mdl: str) -> dict[str, Any]:
        cached = self.folder.read_json(f"model/{label}.json")
        if cached is not None:
            return cached
        self._go_on()
        out = model.call_json(self.deps.engine, prompts.SYSTEM, user, model=mdl, timeout=self.cfg.model_timeout,
                              usage=self.usage, label=label)
        self.folder.write_json(f"model/{label}.json", out)
        return out

    def write_and_finish(self) -> Outcome:
        main = [c for c in self.comps if not c["reserve"]]
        thin = []
        if len(main) < 5:
            thin.append(f"{len(main)} competitors were found; at least 5 are needed")
        if len(self.pack.items) < 20:
            thin.append(f"{len(self.pack.items)} sources were pulled; at least 20 are needed")
        if thin:
            # Not worth the model's time: the check would refuse it (rule 5).
            why = thin[0] + (f". {self.not_checked[0]}" if self.not_checked else ".")
            return self.finish("needs_person", f"Research is too thin to write: {why}", self._summary())
        comp_list = [{"cid": c["cid"], "name": c["name"], "why": c["why"], "evidence": c["evidence"][:12]} for c in main]
        client = {"name": self.name, "country": self.iso, "serviceWords": discover.service_words(self.answers, self.card),
                  "areas": discover.areas(self.answers, None)}
        form_date = str(self.inp.get("formDate") or "")
        user = prompts.write_en(client, comp_list, self.pack.for_model(self.cfg.evidence_chars),
                                self.facts.catalogue_for_model(), self.presence, self.not_checked, form_date)
        try:
            en = self._model("write_en", user, self.cfg.model_write)
        except ModelError as e:
            return self.finish("needs_person", f"Research pulled {len(self.pack.items)} sources, but the English findings "
                                               f"could not be written ({str(e)[:120]}). Run it again.", self._summary())
        kw = dict(competitors=self.comps, presence=self.presence, task_id=self.task, run_id=self.run_id)
        v = checker.check(en, None, self.pack, **kw)
        if not v.ok:
            try:
                en = self._model("repair_en", prompts.repair(en, v.errors), self.cfg.model_write)
            except ModelError:
                pass
            v = checker.check(en, None, self.pack, **kw)
            if not v.ok:
                return self._failed_check(v, en, None)
        self.save("writing")
        try:
            ar = self._model("write_ar", prompts.write_ar(en), self.cfg.model_write)
        except ModelError as e:
            return self.finish("needs_person", f"The English findings passed, but the Arabic edition could not be written "
                                               f"({str(e)[:120]}). Run it again.", self._summary())
        self.save("checking")
        v = checker.check(en, ar, self.pack, **kw)
        if not v.ok:
            try:
                ar = self._model("repair_ar", prompts.repair(ar, v.errors), self.cfg.model_write)
            except ModelError:
                pass
            v = checker.check(en, ar, self.pack, **kw)
            if not v.ok:
                return self._failed_check(v, en, ar)
        return self.render_and_store(en, ar, v)

    def _summary(self) -> dict[str, Any]:
        return {"sourcesN": len(self.pack.items), "competitorsN": len([c for c in getattr(self, "comps", []) if not c["reserve"]])}

    def _failed_check(self, v: checker.Verdict, en: Any, ar: Any) -> Outcome:
        self.folder.write_json("check.json", v.as_json())
        rows = [{"lang": "en", "findings": en if isinstance(en, dict) else {"raw": str(en)[:1000]}, "checks": v.as_json(),
                 "schemaVersion": prompts.SCHEMA}]
        self.deps.home.store(self.run_id, self.token, "findings", rows)
        return self.finish("needs_person", v.sentence or "Research finished, but its findings did not pass the checks.",
                           self._summary())

    def render_and_store(self, en: dict[str, Any], ar: dict[str, Any], v: checker.Verdict) -> Outcome:
        form_date = str(self.inp.get("formDate") or "")
        common = dict(facts=self.facts, pack=self.pack, form_date=form_date, presence=self.presence,
                      not_checked=self.not_checked, client_name=self.name or self.task)
        tabs = {"t.0": render.blocks(ar, lang="ar", **common), "t.en": render.blocks(en, lang="en", **common),
                "t.answers": render.answers_blocks(self.inp.get("tab") or [], form_date, self.name or self.task)}
        self.folder.write_text("report.ar.md", render.text_of(tabs["t.0"]))
        self.folder.write_text("report.en.md", render.text_of(tabs["t.en"]))
        self.folder.write_text("report.answers.md", render.text_of(tabs["t.answers"]))
        self.folder.write_json("docs-requests.json", {tab: render.docs_requests(tab, bl, rtl=tab == "t.0")
                                                       for tab, bl in tabs.items()})
        main = [c for c in self.comps if not c["reserve"]]
        out = render.outputs(task_id=self.task, run_id=self.run_id, mode=self.mode, competitors_n=len(main),
                             sources_n=len(self.pack.items))
        if self.mode != "shadow":
            out["publish"] = "Publishing is not built into this release (MI-3 adds the Doc, MI-1b the card field)."
        self.folder.write_json("outputs.json", out)
        self.folder.write_json("check.json", v.as_json())
        self.deps.home.store(self.run_id, self.token, "findings", [
            {"lang": "en", "findings": en, "checks": v.as_json(), "schemaVersion": prompts.SCHEMA},
            {"lang": "ar", "findings": ar, "checks": v.as_json(), "schemaVersion": prompts.SCHEMA}])
        rows = []
        for c in self.comps:
            ig = next((e["body"].get("handle") for e in self.pack.of(c["cid"], "ig_profile")), None)
            fbp = next((e["body"].get("pageId") for e in self.pack.of(c["cid"], "fb_page")), None)
            rows.append({"cid": c["cid"], "reserve": c["reserve"], "name": c["name"][:200], "placeUrl": c.get("placeUrl"),
                         "website": c.get("website") if str(c.get("website") or "").startswith("http") else None,
                         "instagram": ig, "facebookPageId": fbp if str(fbp or "").isdigit() else None,
                         "rating": self._val(c["cid"], "maps.rating"), "reviewsN": self._val(c["cid"], "maps.reviews"),
                         "adsActiveN": self._val(c["cid"], "ads.active"), "longestAdDays": self._val(c["cid"], "ads.longest_days"),
                         "why": c["why"], "evidence": c["evidence"][:60]})
        self.deps.home.store(self.run_id, self.token, "competitors", rows)
        n_sources = len(self.pack.items)
        refused = f" {len(self.not_checked)} pulls were not checked (budget)." if self.not_checked else ""
        sentence = (f"Research finished in shadow: {len(main)} competitors, {n_sources} sources, "
                    f"USD {self.meter.run_usd:.2f} of scraping. Nothing was published.{refused}") if self.mode == "shadow" else \
                   (f"Research finished: {len(main)} competitors, {n_sources} sources, USD {self.meter.run_usd:.2f} of "
                    f"scraping. Publishing waits for MI-3, so nothing was sent.{refused}")
        return self.finish("done", sentence, {"sourcesN": n_sources, "competitorsN": len(main), "fieldState": "not_due"})

    def _val(self, subject: str, metric: str) -> Any:
        f = self.facts.get(subject, metric)
        if not f:
            return None
        v = f["value"]
        v = v[0] if isinstance(v, list) else v
        if metric == "maps.rating":
            return round(float(v), 2)
        return int(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def compute_facts(pack: Pack, comps: list[dict[str, Any]]) -> Facts:
    """The facts table from the evidence alone (a resend recomputes it from the stored rows)."""
    f = Facts()
    main = [c for c in comps if not c.get("reserve")]
    subjects = ["client"] + [c["cid"] for c in main]
    cited = {c["cid"]: set(c.get("evidence") or []) for c in main}
    place_url = {c["cid"]: c.get("placeUrl") for c in main}
    for s in subjects:
        own = [e for e in pack.items if e["kind"] == "maps_place" and not (e.get("body") or {}).get("secondSource")]
        # A rival's own place: its candidate item by URL (never another candidate the model happened to cite).
        place_items = [e for e in own if e["subject"] == s or (place_url.get(s) and e.get("url") == place_url[s]
                                                               and e["subject"].startswith("K"))]
        place_items = place_items or [e for e in own if e["eid"] in cited.get(s, set())]
        if place_items:
            b = place_items[0]["body"]
            f.put(s, "maps.rating", b.get("rating"), place_items[0])
            f.put(s, "maps.reviews", b.get("reviewsN"), place_items[0])
        top = s == "client" or s in [c["cid"] for c in main][:3]
        for e in pack.of(s, "maps_place"):
            if (e.get("body") or {}).get("secondSource") and top:
                f.second(s, "maps.rating", e["body"].get("rating"), e)
                f.second(s, "maps.reviews", e["body"].get("reviewsN"), e)
        revs = pack.of(s, "review")
        stars = [r["body"].get("stars") for r in revs if isinstance(r["body"].get("stars"), int)]
        if stars:
            f.put(s, "reviews.low_share", round(sum(1 for x in stars if x <= 2) / len(stars), 3), revs[0])
            f.put(s, "reviews.reply_share", round(sum(1 for r in revs if r["body"].get("ownerReplied")) / len(revs), 3), revs[0])
        for e in pack.of(s, "ig_profile"):
            if e["body"].get("secondSource"):
                f.second(s, "ig.followers", e["body"].get("followers"), e)
            else:
                f.put(s, "ig.followers", e["body"].get("followers"), e)
                f.put(s, "ig.posts_30d", e["body"].get("posts30d"), e)
        for e in pack.of(s, "fb_page"):
            f.put(s, "fb.likes", e["body"].get("likes"), e)
            f.put(s, "fb.followers", e["body"].get("followers"), e)
        for e in pack.of(s, "ad"):
            if e["body"].get("summary"):
                f.put(s, "ads.active", e["body"].get("activeN"), e)
                f.put(s, "ads.longest_days", e["body"].get("longestDays"), e)
        for e in pack.of(s, "tiktok"):
            f.put(s, "tiktok.followers", e["body"].get("followers"), e)
        for e in pack.of(s, "snap"):
            f.put(s, "snap.subscribers", e["body"].get("subscribers"), e)
        pages = pack.of(s, "web_page")
        if pages:
            for metric, tag in (("web.meta_pixel", "metaPixel"), ("web.gtm", "gtm"), ("web.ga4", "ga4")):
                hit = next((p for p in pages if (p["body"].get("tracking") or {}).get(tag)), None)
                f.put(s, metric, bool(hit), hit or pages[0])
            hit = next((p for p in pages if any((p["body"].get("booking") or {}).values())), None)
            f.put(s, "web.booking", bool(hit), hit or pages[0])
            f.put(s, "web.prices", sum(len(p["body"].get("prices") or []) for p in pages), pages[0])
    for e in pack.of("client", "nap"):
        f.put("client", "nap.match", e["body"].get("result") if e["body"].get("result") != "not_checked" else None, e)
    serps = [e for e in pack.of("market", "serp")]
    if serps:
        f.put("market", "market.ads_in_search", sum(len(e["body"].get("ads") or []) for e in serps), serps[0])
    mads = pack.of("market", "ad")
    if mads:
        f.put("market", "market.advertisers", len({a["body"].get("pageId") or a["body"].get("page") for a in mads}), mads[0])
    return f


def run_once(cfg: Config, deps: Deps, claim: dict[str, Any]) -> Outcome:
    """A claimed run, start to end. An unexpected error sends it back to the queue with its sentence as a try (the
    claim's three-try rule ends it)."""
    r = Runner(cfg, deps, claim)
    try:
        return r.execute()
    except Exception as e:  # noqa: BLE001
        sentence = f"Research stopped on an unexpected error ({type(e).__name__}: {str(e)[:160]}). It retries by itself."
        try:
            r.release(sentence)
        except Exception:  # noqa: BLE001
            pass
        return Outcome("released", sentence)


def json_dump(x: Any) -> str:
    return json.dumps(x, ensure_ascii=False, indent=1)
