"""The cockpit's proposal requests, carried out by the worker.

The cockpit's server creates the proposal row (status drafting) and a
`cockpit_sales_requests` row of kind `proposal` together. This drains those
rows the way the editor desk drains its own: a row is claimed with a
conditional update before anything is done for it, a failure records its
reason and its try, and after four tries it is parked as failed.

Two kinds of proposal request:

- a draft: `{"lang", "recording_id"?, "proposal_id", "offer"?}`. Fathom for
  the call, the model for the draft, the gate, the files.
- a rebuild: `{"proposal_id", "rebuild": true, "lang"}`, queued by the
  cockpit after the closer filled the FILL blanks (sales-api
  `proposal.fill`). No model and no Fathom: the deal on the proposal row is
  built, rendered and checked again, and stored as the next version.

A row running for more than half an hour with no sign of life belongs to a
run that died; it goes back in the queue, or is parked after four tries. A
live draft touches its row between stages, so a long one is never mistaken
for a dead one.

Rebuilds are read ahead of drafts, whatever their age: a rebuild asks no
model, so a closer who filled the gaps never waits behind drafts that are
waiting on one. A rebuild asked while a run is drafting (ten minutes a
draft, three drafts a run) goes before that run's next draft, rather than
wait out the run behind the flock. An outage holds the requests of its own kind for the rest of
the run, never the other kind. While a request waits, the proposal it is for
carries one sentence for the closer (closer_wait): what is wrong in a few
words, that it carries on by itself, and when to tell the CEO; the fix stays
on the request. A request for a proposal the closer archived is closed as
cancelled and never drafted.

The model is the run's one model.Failover: the primary provider, and the
fallback (SALES_MODEL_FALLBACK) once the primary cannot answer at all, decided
once a run and never mid-draft. When neither answers, the request waits with
its try uncounted and the sentence on it, and the next run (two minutes later)
tries again.
"""
from __future__ import annotations

import re
import socket
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Optional

from . import clientform as clientform_mod
from . import engine as engine_mod
from . import fathom as fathom_mod
from . import http
from . import model as model_mod
from . import offer as offer_mod
from . import recordings as recordings_mod
from . import render as render_mod
from .config import MAX_ATTEMPTS, WORKER, Config
from .errors import Archived, NotNow, Refused
from .supabase import REQUESTS, Supabase, iso, now_iso

KIND = "proposal"
# The rows a run reads before the rest: rebuilds, which ask no model.
REBUILDS_FIRST = "params->>rebuild=eq.true"


def closer_wait(e: BaseException, *, rebuild: bool = False) -> str:
    """What the closer waiting on a proposal is told while an outage holds it:
    what is wrong, in a few words, that it carries on by itself, and when to
    tell the CEO. The fix itself (a key's name, a command on the VPS) stays on
    the request, for whoever fixes it. An outage that brings its own sentence
    for the closer (model.Failover's) is told in that one."""
    said = str(getattr(e, "closer", "") or "")
    if said:
        return said
    cause = str(getattr(e, "cause", "") or "")
    if not cause:
        text = str(e).strip()
        cause = model_mod.cause_of(text)
        # cause_of lowers "The ..." to "the ..."; a name (Fathom) keeps its capital.
        if text.split(" ", 1)[0] not in ("The", "A", "An", "No", "This", "That", "It", "Nothing"):
            cause = text[:1] + cause[1:]
    then = "is rebuilt with your figures" if rebuild else "drafts"
    return (f"The proposal writer cannot work right now: {cause}. This proposal waits and {then} by itself once "
            "that is fixed, so there is no need to ask again; if it is still waiting in an hour, tell the CEO.")


def fathom_down(e: Any) -> bool:
    """Fathom unreachable, overloaded or rate limiting after its own retries:
    an outage. A 404, a 500 for one recording or an answer that is not JSON is
    about the request, and stays a try that can fail."""
    status = int(getattr(e, "status", 0) or 0)
    return status in (429, 502, 503, 504) or (status == 0 and "not JSON" not in str(e))


def sync_offer(sb: Supabase, offer: dict[str, Any], log: Callable[[str], None]) -> bool:
    """offer.json into the cockpit's `offer` setting, when they differ. True when written."""
    want = offer_mod.cockpit_setting(offer)
    if sb.setting(offer_mod.SETTING_KEY) == want:
        return False
    sb.store_setting(offer_mod.SETTING_KEY, want, WORKER)
    log("offer: the cockpit's choices now match offer.json (" + ", ".join(p["key"] for p in want["payments"]) + ")")
    return True


def fathom_client(cfg: Config, log: Callable[[str], None]) -> fathom_mod.Fathom:
    if not cfg.fathom_key:
        raise NotNow("FATHOM_API_KEY is not set, so no call can be read: nothing is indexed or drafted until it "
                     "is set in /opt/data/bibi/api-keys.env.")
    return fathom_mod.Fathom(cfg.fathom_key, pace=cfg.fathom_pace, log=log)


class Worker:
    """One run of the drain. The collaborators are arguments so tests can put
    fakes where the model, Fathom and the browser would be."""

    def __init__(self, cfg: Config, log: Callable[[str], None], sb: Supabase, *, host: str = "",
                 provider: Callable[..., Any] = model_mod.provider,
                 fallback: Optional[Callable[..., Any]] = None,
                 fathom: Callable[..., Any] = fathom_client,
                 renderer: Any = render_mod, offer: Optional[dict[str, Any]] = None,
                 warn: Optional[Callable[[str], None]] = None):
        self.cfg, self.log, self.sb = cfg, log, sb
        self.warn = warn or log
        self.host = host or socket.gethostname()
        self.provider_factory, self.fathom_factory = provider, fathom
        # The fallback's maker, (cfg, log) -> provider; model.fallback_provider
        # unless a test puts a fake there. Used only when the config names a
        # fallback for proposals (model.fallback_for).
        self.fallback_factory = fallback
        self.renderer = renderer
        self.offer = offer if offer is not None else offer_mod.load()
        self._people: Optional[dict[str, str]] = None
        self._failover: Optional[model_mod.Failover] = None
        # The drafts this run wrote through the fallback, and its sentence.
        self._fallback_drafts = 0
        self._fallback_note: Optional[str] = None

    def route(self) -> model_mod.Failover:
        """This run's model: one Failover for every draft in it, so the choice is made once."""
        if self._failover is None:
            cfg, log = self.cfg, self.log
            fallback = None
            if model_mod.fallback_for(cfg, KIND):
                make = self.fallback_factory or (lambda c, l, m=cfg.model: model_mod.fallback_provider(
                    c, l, primary_model=m))
                fallback = lambda: make(cfg, log)  # noqa: E731
            self._failover = model_mod.Failover(lambda: self.provider_factory(cfg, log), fallback, log=log,
                                                job=KIND, primary_label=f"{cfg.provider} ({cfg.model})",
                                                warn=self.warn)
        return self._failover

    # ---- the drain -----------------------------------------------------
    def run(self, limit: Optional[int] = None) -> dict[str, Any]:
        # The cockpit's form reads its choices from a setting; keep it the
        # file's. A failure here is worth a line, never the run.
        try:
            sync_offer(self.sb, self.offer, self.log)
        except Exception as e:  # noqa: BLE001
            self.log(f"offer setting not synced: {http.scrub(str(e))[:160]}")
        # The New Client Form's questions, for the list beside the embedded
        # form on a lead's page; every ten minutes at most.
        if self.cfg.typeform_key:
            try:
                clientform_mod.sync_client_form(self.sb, self.cfg.typeform_key, self.log)
            except Exception as e:  # noqa: BLE001
                self.log(f"client form not synced: {http.scrub(str(e))[:160]}")
        out: dict[str, Any] = {"seen": 0, "done": 0, "failed": 0, "retry": 0, "waiting": 0, "skipped": 0,
                               "cancelled": 0, "reaped": self.reap(), "statuses": {}}
        self._fallback_drafts, self._fallback_note = 0, None
        rows = self.sb.queued(KIND, max_attempts=MAX_ATTEMPTS, limit=limit or self.cfg.requests_per_run,
                              first=REBUILDS_FIRST)
        out["seen"] = len(rows)
        # Per kind (a rebuild, or a draft): why none of that kind can be done
        # this run, as the reason for the request and the sentence for the
        # closer (None when the reason is about another proposal).
        held: dict[bool, Optional[tuple[str, Optional[str]]]] = {}
        blocked: Optional[str] = None
        # None in the list: look for rebuilds asked since the run began.
        pending: list[Optional[dict[str, Any]]] = list(rows)
        read = {str(r.get("id") or "") for r in rows}
        while pending:
            req = pending.pop(0)
            if req is None:
                # A draft just ran, for minutes: a rebuild asked meanwhile goes
                # before the run's next draft, rather than wait out the run.
                if held.get(True) is None:
                    fresh = [r for r in self.sb.queued(KIND, max_attempts=MAX_ATTEMPTS,
                                                       limit=self.cfg.requests_per_run, first=REBUILDS_FIRST,
                                                       only_first=True)
                             if str(r.get("id") or "") not in read]
                    read.update(str(r.get("id") or "") for r in fresh)
                    out["seen"] += len(fresh)
                    pending[:0] = fresh
                continue
            rid = str(req.get("id") or "")
            params = req.get("params") if isinstance(req.get("params"), dict) else {}
            rebuild = bool(params.get("rebuild"))
            proposal_id = str(params.get("proposal_id") or "")
            if rebuild not in held:
                e = self.preflight(draft=not rebuild)
                held[rebuild] = (str(e), closer_wait(e, rebuild=rebuild)) if e is not None else None
            hold = held[rebuild]
            if hold:
                # Nothing of this kind can be done until it is fixed. The row
                # stays queued, untouched, with the reason on it, and the
                # closer waiting on the proposal is told, though nothing was claimed.
                reason, closer = hold
                blocked = blocked or reason
                self.sb.patch(REQUESTS, f"id=eq.{http.quote(rid)}&status=eq.queued", {"error": reason[:600]})
                if closer:
                    self._proposal_note(proposal_id, rid, closer)
                out["waiting"] += 1
                continue
            claimed = self.sb.claim(req, self.host)
            if not claimed:
                out["skipped"] += 1
                continue
            attempts = int(claimed.get("attempts") or 1)
            if not rebuild and any(r is not None for r in pending):
                pending.insert(0, None)  # look for new rebuilds before the next request
            try:
                result = self.rebuild(claimed) if rebuild else self.draft(claimed)
                self.sb.request_done(rid, result)
                out["done"] += 1
                out["statuses"][result["status"]] = out["statuses"].get(result["status"], 0) + 1
                self.log(f"proposal {result['proposal_id']}: {result['status']}")
            except Archived as e:
                # The closer archived it first: nothing to draft, and nothing to mark failed.
                self.sb.request_cancelled(rid, str(e))
                out["cancelled"] += 1
                self.log(f"request {rid}: {e}")
            except Refused as e:
                self.sb.request_failed(rid, str(e), final=True)
                self._proposal_failed(proposal_id, rid, str(e))
                out["failed"] += 1
                self.warn(f"request {rid}: refused: {e}")
            except NotNow as e:
                self.sb.request_released(rid, str(e), attempts - 1)
                # The closer's sentence on the proposal they are waiting on; the
                # whole of it, with the fix, on the request.
                self._proposal_note(proposal_id, rid, closer_wait(e, rebuild=rebuild))
                out["waiting"] += 1
                blocked = blocked or str(e)
                self.warn(f"request {rid}: waiting: {e}")
                # The run's other requests of this kind would meet the same
                # outage: they wait unclaimed with the reason on them, as when
                # preflight finds it, and their closers are told too. When the
                # sentence is about this proposal alone (a draft cut off
                # partway), the others carry their own and no closer's note.
                # The other kind goes on: no break.
                others = str(getattr(e, "others", "") or "")
                held[rebuild] = (others, None) if others else (str(e), closer_wait(e, rebuild=rebuild))
                continue
            except Exception as e:  # noqa: BLE001 - one request is never worth the run
                msg = http.scrub(f"{type(e).__name__}: {e}" if not str(e) else str(e))[:500]
                final = attempts >= MAX_ATTEMPTS
                self.sb.request_failed(rid, msg, final=final)
                if final:
                    self._proposal_failed(proposal_id, rid, f"The draft failed four times. The last error: {msg}")
                    out["failed"] += 1
                else:
                    self._proposal_note(proposal_id, rid, f"Try {attempts} of {MAX_ATTEMPTS} failed ({msg}); "
                                                          "it will be tried again.")
                    out["retry"] += 1
                self.warn(f"request {rid}: try {attempts} failed: {msg}")
        if blocked:
            out["blocked"] = blocked
        if self._fallback_drafts:
            # Said where the cockpit's health line and the log carry it: a paid
            # fallback drafting in place of the primary is never silent.
            out["fallback"] = {"drafts": self._fallback_drafts, "note": self._fallback_note}
        return out

    def preflight(self, *, draft: bool) -> Optional[NotNow]:
        """What a request needs before any row is claimed, as the outage when
        it is missing: the bucket the files go into, and for a draft a model
        that answers and Fathom's key. Checked once a run per kind, so a
        missing bucket cannot cost four paid drafts per request, and a lapsed
        VPS sign-in is found by a one-token ping (model.Failover.check) before
        a request is claimed and its call read from Fathom."""
        try:
            self.sb.bucket_info()
        except http.HttpError as e:
            if e.status in (400, 404):
                return NotNow(f"The {self.sb.bucket} bucket is missing, so no proposal can be stored. Apply "
                              "supabase/migrations/20260924b_sales_proposal_files.sql; the requests wait until then.")
        if draft:
            try:
                # The primary, or the fallback when the primary cannot be made
                # or does not answer the ping; waiting only when neither can.
                self.route().check()
                self.fathom_factory(self.cfg, self.log)
            except NotNow as e:
                return e
        return None

    def reap(self) -> int:
        cutoff = iso(datetime.now(timezone.utc) - timedelta(minutes=self.cfg.stuck_minutes))
        n = 0
        for req in self.sb.stuck(KIND, cutoff):
            attempts = int(req.get("attempts") or 0)
            final = attempts >= MAX_ATTEMPTS
            if final:
                message = "The worker stopped before finishing this proposal four times. Draft it again."
                if req.get("error"):
                    message += f" The last error: {req['error']}"
            else:
                message = (f"The worker stopped before finishing (try {attempts} of {MAX_ATTEMPTS}); "
                           "it will be tried again.")
            if self.sb.reaped(req, message, final=final):
                n += 1
                params = req.get("params") if isinstance(req.get("params"), dict) else {}
                if final:
                    self._proposal_failed(str(params.get("proposal_id") or ""), str(req.get("id") or ""), message)
                self.log(f"request {req.get('id')}: {'parked' if final else 'back in the queue'} after "
                         f"{self.cfg.stuck_minutes} minutes without a sign of life")
        return n

    # ---- one request ---------------------------------------------------
    def _proposal(self, params: dict[str, Any], request_id: str) -> dict[str, Any]:
        pid = str(params.get("proposal_id") or "")
        row = self.sb.proposal(pid) if pid else None
        row = row or self.sb.proposal_for_request(request_id)
        if not row:
            raise Refused("The proposal this request is for does not exist. Start the draft again from the cockpit.")
        if str(row.get("status") or "") == "archived":
            raise Archived("The proposal was archived before this request ran, so it was not drafted.")
        return row

    def _lang(self, params: dict[str, Any], proposal: dict[str, Any]) -> str:
        lang = str(params.get("lang") or proposal.get("lang") or "ar").strip().lower()
        if lang not in ("ar", "en"):
            raise Refused(f"The language asked for was {lang!r}; a proposal is written in Arabic (ar) or English (en).")
        return lang

    def _name(self, email: str) -> str:
        if self._people is None:
            self._people = {}
            try:
                for p in self.sb.people():
                    for key in (p.get("email"), p.get("fathom_email")):
                        if key and p.get("name"):
                            self._people[str(key).strip().lower()] = str(p["name"])
            except Exception as e:  # noqa: BLE001 - a name is not worth the draft
                self.log(f"people not read: {http.scrub(str(e))[:160]}")
        return self._people.get(str(email or "").strip().lower(), "")

    def draft(self, req: dict[str, Any]) -> dict[str, Any]:
        rid = str(req["id"])
        params = req.get("params") if isinstance(req.get("params"), dict) else {}
        proposal = self._proposal(params, rid)
        pid = str(proposal["id"])
        lang = self._lang(params, proposal)
        resolved = offer_mod.resolve(self.offer, params.get("offer"))
        self.sb.update_proposal(pid, status_is="neq.archived", status="drafting", error=None, lang=lang)

        contact = str(req.get("contact_id") or proposal.get("contact_id") or "")
        lead = self.sb.lead(contact) if contact else None
        fathom = self.fathom_factory(self.cfg, self.log)
        try:
            picked = recordings_mod.pick(
                self.sb, fathom, self.log, contact_id=contact,
                recording_id=str(params.get("recording_id") or ""),
                min_chars=self.cfg.min_transcript_chars,
                reindex=lambda: recordings_mod.index(self.sb, fathom, self.log, days=self.cfg.recordings_days))
        except fathom_mod.FathomError as e:
            if e.status in (401, 403):
                raise NotNow(f"Fathom refused the key ({e.status}). Set FATHOM_API_KEY again; drafting waits until then.")
            if fathom_down(e):
                # After the client's own retries: Fathom is down or turning us
                # away, which is an outage to wait out like a model's, not four
                # tries of this proposal to fail in eight minutes.
                raise NotNow(f"Fathom is not answering ({e.status or 'no answer'}), so the call cannot be read. "
                             f"Drafting waits until it answers. {e}"[:600])
            raise
        self.sb.touch(rid, self.host)
        rec = picked.recording
        recorded_by = str(rec.get("recorded_by") or "")
        call = engine_mod.Call(
            transcript_text=picked.text,
            recording_id=str(rec.get("recording_id") or ""),
            recorded_at=str(rec.get("started_at") or ""),
            closer=self._name(recorded_by) or self._name(str(req.get("requested_by") or "")) or recorded_by,
            client_name=(lead or {}).get("name"),
            client_company=(lead or {}).get("company"),
            client_email=(lead or {}).get("email"),
            client_country=(lead or {}).get("country"),
        )
        self.log(f"proposal {pid}: drafting from recording {call.recording_id} "
                 f"({len(picked.text):,} characters, {lang}, {resolved['payment']}, "
                 f"guarantee {'on' if resolved['guarantee'] else 'off'})")
        p = self.route().begin()
        outcome = engine_mod.run(
            call, lang=lang, resolved=resolved, offer=self.offer, p=p, cfg=self.cfg, log=self.log,
            workdir=self.cfg.out_dir / pid, renderer=self.renderer, beat=lambda: self.sb.touch(rid, self.host))
        extra = {
            "triage": {"variant": outcome.variant, "why": outcome.why, "found": outcome.found},
            "reference": outcome.reference,
            "tightening": {"rounds": outcome.rounds, "overflow_before": outcome.overflow_first,
                           "overflow_after": outcome.overflow_last},
            "recording": {"recording_id": call.recording_id, "characters": len(picked.text),
                          "matched_by": rec.get("matched_by")},
            "seconds": outcome.seconds,
            "rebuild": False,
            "model_route": outcome.route,
        }
        if outcome.route.get("fallback"):
            self._fallback_drafts += 1
            self._fallback_note = outcome.route.get("note")
        return self._finish(proposal, outcome.deal, outcome.result, outcome.html_path, resolved=resolved,
                            variant=outcome.variant, model=outcome.model, notes=outcome.notes, extra=extra,
                            lang=lang, recording_id=call.recording_id)

    def rebuild(self, req: dict[str, Any]) -> dict[str, Any]:
        rid = str(req["id"])
        params = req.get("params") if isinstance(req.get("params"), dict) else {}
        proposal = self._proposal(params, rid)
        pid = str(proposal["id"])
        deal = proposal.get("deal")
        if not isinstance(deal, dict) or not deal:
            raise Refused("This proposal has no draft to rebuild yet. Draft it first.")
        resolved = self._offer_for(proposal, deal)
        lang = self._lang(params, proposal)
        n = next_version(proposal.get("html_path"))
        workdir = self.cfg.out_dir / pid
        workdir.mkdir(parents=True, exist_ok=True)
        result, _dom = engine_mod.rebuild(deal, resolved=resolved, offer=self.offer,
                                          html_path=workdir / f"v{n}.html", renderer=self.renderer)
        variant = str(deal.get("variant") or proposal.get("variant") or "specific")
        before = proposal.get("validation") if isinstance(proposal.get("validation"), dict) else {}
        extra = {"rebuild": True, "triage": before.get("triage"), "reference": before.get("reference")}
        notes = [engine_mod.RECHECKED]
        route = before.get("model_route")
        if isinstance(route, dict):
            # Still the draft's words: still the draft's provider, and its sentence when that was the fallback.
            extra["model_route"] = route
            if route.get("note"):
                notes.insert(0, str(route["note"]))
        return self._finish(proposal, deal, result, workdir / f"v{n}.html", resolved=resolved, variant=variant,
                            model=proposal.get("model") or "", notes=notes, extra=extra,
                            lang=lang, recording_id=proposal.get("recording_id"), version=n)

    def _offer_for(self, proposal: dict[str, Any], deal: dict[str, Any]) -> dict[str, Any]:
        """The offer a proposal was written for: the stamp in its deal, else the
        one kept in its validation, else the first request's choice."""
        if isinstance(deal.get("offer"), dict):
            return offer_mod.from_deal(deal, self.offer)
        kept = (proposal.get("validation") or {}).get("offer") if isinstance(proposal.get("validation"), dict) else None
        if isinstance(kept, dict):
            return offer_mod.from_deal({"offer": kept}, self.offer)
        first = self.sb.select(REQUESTS, "select=params&kind=eq.proposal"
                                         f"&params->>proposal_id=eq.{http.quote(str(proposal['id']))}"
                                         "&order=requested_at.asc&limit=1")
        choice = ((first[0].get("params") or {}).get("offer") if first else None)
        return offer_mod.resolve(self.offer, choice if isinstance(choice, dict) else None)

    def _finish(self, proposal: dict[str, Any], deal: dict[str, Any], result: Any, html_path: Path, *,
                resolved: dict[str, Any], variant: str, model: str, notes: list[str], extra: dict[str, Any],
                lang: str, recording_id: Any, version: Optional[int] = None) -> dict[str, Any]:
        """Files into the bucket, the verdict onto the proposal row."""
        pid = str(proposal["id"])
        status = result.status()
        n = version or next_version(proposal.get("html_path"))
        html_key = f"proposals/{pid}/v{n}.html"
        self.sb.upload(html_key, Path(html_path).read_bytes(), "text/html")
        pdf_key = None
        notes = list(notes)
        if status == "ready":
            pdf_file = Path(html_path).with_name(f"v{n}.pdf")
            ok = False
            try:
                ok = self.renderer.pdf(Path(html_path), pdf_file)
            except Exception as e:  # noqa: BLE001
                self.log(f"proposal {pid}: the PDF could not be printed: {e}")
            if ok:
                pdf_key = self.sb.upload(f"proposals/{pid}/v{n}.pdf", pdf_file.read_bytes(), "application/pdf")
            else:
                notes.append("The PDF was skipped: no browser on this machine could print it "
                             f"({engine_mod.engine_name(self.renderer)}). The HTML is complete: open it and print to PDF, "
                             "or point CHROME_PATH on the VPS at Playwright's headless shell (doctor's render line "
                             "says whether it prints).")
        else:
            notes.append("No PDF yet: it is made when the proposal passes the send gate, with nothing left to fill.")
        validation = validation_json(result, variant=variant, resolved=resolved, notes=notes, extra=extra,
                                     model=model, version=n, render=engine_mod.engine_name(self.renderer))
        self.sb.update_proposal(
            pid, status_is="neq.archived",
            status=status, deal=deal, validation=validation, fill_count=result.fills, variant=variant,
            model=model or None, html_path=html_key, pdf_path=pdf_key, lang=lang,
            recording_id=str(recording_id) if recording_id else proposal.get("recording_id"),
            error=failure_sentence(result, n) if status == "failed" else None)
        return {"proposal_id": pid, "status": status, "variant": variant, "fill_count": result.fills,
                "html_path": html_key, "pdf_path": pdf_key, "model": model or None, "version": n}

    def _proposal_failed(self, proposal_id: str, request_id: str, message: str) -> None:
        try:
            pid = proposal_id or str((self.sb.proposal_for_request(request_id) or {}).get("id") or "")
            if pid:
                self.sb.update_proposal(pid, status_is="neq.archived", status="failed", error=message[:600])
        except Exception as e:  # noqa: BLE001
            self.log(f"proposal {proposal_id or request_id}: not marked failed: {http.scrub(str(e))[:160]}")

    def _proposal_note(self, proposal_id: str, request_id: str, message: str) -> None:
        """Why a proposal is still drafting, while its request waits or retries:
        on the row only while it is drafting, so it never lands on one archived."""
        try:
            pid = proposal_id or str((self.sb.proposal_for_request(request_id) or {}).get("id") or "")
            if pid:
                self.sb.update_proposal(pid, status_is="eq.drafting", error=message[:600])
        except Exception:  # noqa: BLE001
            pass


def next_version(html_path: Any) -> int:
    m = re.search(r"/v(\d+)\.html$", str(html_path or ""))
    return int(m.group(1)) + 1 if m else 1


def failure_sentence(result: Any, version: int) -> str:
    errors = result.errors()
    head = "; ".join(errors[:3]) + (f"; and {len(errors) - 3} more" if len(errors) > 3 else "")
    return (f"The draft did not pass the checks: {head}. It is saved as version {version}: open it to see, "
            "then draft again.")[:600]


def validation_json(result: Any, *, variant: str, resolved: dict[str, Any], notes: list[str],
                    extra: dict[str, Any], model: str, version: int, render: str = "") -> dict[str, Any]:
    """What the cockpit shows. ok, errors, warnings and fills are the four it
    reads first; the rest is the full record."""
    offer_kept = offer_mod.stamp(resolved)
    offer_kept.update({"currency": resolved["currency"], "payment_label": resolved["payment_label"],
                       "guarantee_text": resolved["guarantee_text"]})
    out = {
        "ok": result.ok,
        "status": result.status(),
        "send_ready": result.send_ready,
        "errors": result.errors(),
        "warnings": result.warnings(),
        "fills": result.fill_fields,
        "fill_count": result.fills,
        "variant": variant,
        "offer": offer_kept,
        "fee_band_pct": round(result.fee_band_pct, 1) if result.fee_band_pct is not None else None,
        "sheets": {"expected": result.expected_sheets, "rendered": result.rendered_sheets},
        "render": render or render_mod.engine(),
        "rows": result.rows,
        "report": result.text(),
        "notes": notes,
        "model": model or None,
        "version": version,
        "checked_at": now_iso(),
    }
    out.update(extra)
    return out


def run_requests(cfg: Config, log: Callable[[str], None], sb: Supabase, **kw: Any) -> dict[str, Any]:
    limit = kw.pop("limit", None)
    return Worker(cfg, log, sb, **kw).run(limit=limit)
