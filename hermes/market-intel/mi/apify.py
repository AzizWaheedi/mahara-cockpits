"""Apify actor runs for one report: bounded concurrency, a run cap, the spend meter before every start, and
resume without paying twice.

Before a run starts, its estimate is checked on the meter (refused past the run or month cap) and the run
carries Apify's own ceilings: maxItems (pay per result) and maxTotalChargeUsd (pay per event). The meter holds
that ceiling while the run is in flight, so runs started side by side share what is left of the budget instead
of each being given all of it. The run id is handed to `on_started` before any polling, so a worker that dies
mid-pull finds the same run on resume and reads its dataset instead of starting another. Cost is the run's
usageTotalUsd, read also for a run aborted at the deadline; a run whose cost is already counted (`settled`,
kept in the run's progress) is never counted again on a resume.

API reference: https://docs.apify.com/api/v2
"""
from __future__ import annotations

import math
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Optional

from . import http
from .ledger import Ledger
from .meter import BudgetRefused, Meter

BASE = "https://api.apify.com/v2"
TERMINAL = {"SUCCEEDED", "FAILED", "TIMED-OUT", "ABORTED"}


@dataclass
class Job:
    key: str                 # the pull key: stable across a resume
    actor: str
    input: dict[str, Any]
    label: str               # for sentences: "the client's Google reviews"
    estimate: float          # USD, reserved before the start
    max_items: int


@dataclass
class Result:
    key: str
    items: list[dict[str, Any]] = field(default_factory=list)
    usd: float = 0.0
    run_id: str = ""
    error: Optional[str] = None
    refused: Optional[str] = None

    @property
    def ok(self) -> bool:
        return self.error is None and self.refused is None


class ApifyError(Exception):
    pass


class Apify:
    def __init__(self, token: str, ledger: Ledger, meter: Meter, *, max_runs: int = 40, concurrency: int = 4,
                 timeout_sec: int = 900, poll_sec: float = 6.0, known_runs: Optional[dict[str, str]] = None,
                 on_started: Optional[Callable[[str, str], None]] = None, sleep: Callable[[float], None] = time.sleep,
                 clock: Callable[[], float] = time.monotonic, base: str = BASE, runs_started: int = 0):
        if not token:
            raise ApifyError("MARKET_INTEL_APIFY_KEY (or APIFY_API_KEY) is not set.")
        self.token = token
        self.ledger = ledger
        self.meter = meter
        self.max_runs = max_runs
        self.concurrency = max(1, concurrency)
        self.timeout_sec = timeout_sec
        self.poll_sec = poll_sec
        self.known_runs = dict(known_runs or {})
        self.on_started = on_started or (lambda k, r: None)
        self.sleep = sleep
        self.clock = clock
        self.base = base.rstrip("/")
        self.runs_started = runs_started
        # key -> USD already counted on the meter. The runner points this at its progress, so it is saved with
        # the spend it explains and a resume reads a finished run again without counting its cost twice.
        self.settled: dict[str, float] = {}
        self._held: dict[str, float] = {}      # key -> what the meter holds for a run in flight

    def _url(self, path: str, **params: Any) -> str:
        return f"{self.base}/{path.lstrip('/')}?{http.encode_query({'token': self.token, **params})}"

    def _call(self, method: str, path: str, fn: Callable[[str], Any], **params: Any) -> Any:
        url = self._url(path, **params)
        return self.ledger.call("apify", method, f"{self.base}/{path.lstrip('/')}", lambda: fn(url))

    # ---- account (doctor) -----------------------------------------------------------------------------------
    def me(self) -> dict[str, Any]:
        return self._call("GET", "users/me", lambda u: http.get_json(u, timeout=30, retries=1))["data"]

    def limits(self) -> dict[str, Any]:
        return self._call("GET", "users/me/limits", lambda u: http.get_json(u, timeout=30, retries=1))["data"]

    # ---- one run ------------------------------------------------------------------------------------------
    def _start(self, job: Job) -> str:
        if self.runs_started >= self.max_runs:
            raise BudgetRefused(f"Not checked: {job.label}. This report reached its {self.max_runs} actor runs.")
        held = self.meter.reserve(job.label, job.estimate, ceiling=max(job.estimate * 3, 0.05))
        # Whole cents, rounded down so the runs in flight never add up past the cap (Apify takes 0.01 at least).
        ceiling = max(0.01, math.floor(held * 100 + 1e-9) / 100)
        if ceiling > held:
            self.meter.hold(ceiling - held)
            held = ceiling
        try:
            # One try: a timeout after Apify accepted the run must not start a second, unknown one.
            out = self._call("POST", f"acts/{job.actor}/runs",
                             lambda u: http.post_json(u, job.input, timeout=60, retries=0),
                             maxItems=job.max_items, maxTotalChargeUsd=f"{ceiling:.2f}", timeout=self.timeout_sec)
            run_id = str(out["data"]["id"])
        except http.HttpError as e:
            if e.status != 0:          # Apify answered: nothing started. A network error keeps the hold (it may have).
                self.meter.release(held)
            raise
        except Exception:  # noqa: BLE001  (the ledger refused: the call was not made)
            self.meter.release(held)
            raise
        self.runs_started += 1
        self.known_runs[job.key] = run_id
        self._held[job.key] = held
        try:
            self.on_started(job.key, run_id)
        except Exception:  # noqa: BLE001  (the run is paid for and running: keep polling it; the id is saved next time)
            pass
        return run_id

    def _settle(self, key: str, usd: float) -> float:
        """The run ended: its hold goes back and its cost is counted once (never again on a resume)."""
        held = self._held.pop(key, 0.0)
        if key in self.settled:
            self.meter.release(held)
            return float(self.settled[key])
        self.meter.settle(held, usd)
        self.settled[key] = round(usd, 5)
        return usd

    def _get_run(self, run_id: str) -> dict[str, Any]:
        return self._call("GET", f"actor-runs/{run_id}", lambda u: http.get_json(u, timeout=30, retries=2))["data"]

    def _items(self, dataset_id: str, limit: int) -> list[dict[str, Any]]:
        out = self._call("GET", f"datasets/{dataset_id}/items",
                         lambda u: http.get_json(u, timeout=120, retries=2), clean="true", format="json", limit=limit)
        return [x for x in out if isinstance(x, dict)] if isinstance(out, list) else []

    def _abort(self, run_id: str) -> None:
        try:
            self._call("POST", f"actor-runs/{run_id}/abort", lambda u: http.request("POST", u, timeout=30, retries=0))
        except Exception:  # noqa: BLE001
            pass

    # ---- many runs ------------------------------------------------------------------------------------------
    def run_batch(self, jobs: list[Job]) -> dict[str, Result]:
        results = {j.key: Result(key=j.key) for j in jobs}
        by_key = {j.key: j for j in jobs}
        pending = [j.key for j in jobs]
        in_flight: dict[str, str] = {}   # key -> run id
        deadline = self.clock() + self.timeout_sec
        while pending or in_flight:
            while pending and len(in_flight) < self.concurrency:
                key = pending[0]
                job = by_key[key]
                if (in_flight and not self.known_runs.get(key) and not self.meter.fits(job.estimate)
                        and self.meter.fits(job.estimate, with_holds=False)):
                    break          # it fits once a run in flight ends and gives its hold back: wait for that
                pending.pop(0)
                try:
                    if self.known_runs.get(key):
                        # Started before a resume: it may still spend, so it holds its ceiling until it ends.
                        if key not in self.settled:
                            self._held[key] = self.meter.hold(max(job.estimate * 3, 0.05))
                        in_flight[key] = self.known_runs[key]
                    else:
                        in_flight[key] = self._start(job)
                except BudgetRefused as e:
                    results[key].refused = e.sentence
                except (http.HttpError, KeyError, TypeError, ValueError) as e:
                    results[key].error = f"{job.label} could not start: {http.scrub(str(e))[:160]}"
                except Exception as e:  # noqa: BLE001  (a ledger outage: the call was not made)
                    results[key].error = f"{job.label} was not started: {http.scrub(str(e))[:160]}"
            if not in_flight:
                break
            if self.clock() > deadline:
                for key in pending:
                    results[key].error = f"{by_key[key].label} did not start in {self.timeout_sec // 60} minutes."
                for key, run_id in in_flight.items():
                    results[key].error = f"{by_key[key].label} did not finish in {self.timeout_sec // 60} minutes."
                    results[key].run_id = run_id
                    self._abort(run_id)
                    # What it spent before the abort is spent: read it once; unread, its whole hold counts.
                    try:
                        usd = float(self._get_run(run_id).get("usageTotalUsd") or 0.0)
                    except Exception:  # noqa: BLE001
                        usd = self._held.get(key, 0.0)
                    results[key].usd = self._settle(key, usd)
                break
            for key, run_id in list(in_flight.items()):
                try:
                    run = self._get_run(run_id)
                except Exception:  # noqa: BLE001
                    continue
                status = run.get("status")
                if status not in TERMINAL:
                    continue
                del in_flight[key]
                r = results[key]
                r.run_id = run_id
                try:
                    usd = float(run.get("usageTotalUsd") or 0.0)
                except (TypeError, ValueError):
                    usd = 0.0
                r.usd = self._settle(key, usd)
                if status == "SUCCEEDED":
                    try:
                        r.items = self._items(str(run["defaultDatasetId"]), by_key[key].max_items)
                    except Exception as e:  # noqa: BLE001
                        r.error = f"{by_key[key].label}: the results could not be read ({http.scrub(str(e))[:120]})."
                else:
                    r.error = f"{by_key[key].label}: the actor run ended {status.lower()}."
            if in_flight:
                self.sleep(self.poll_sec)
        return results
