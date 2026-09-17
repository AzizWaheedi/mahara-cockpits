"""Apify actor runs: start many, wait for all, read their datasets, count the cost.

Why Apify (Aziz, 2026-05-15): direct scraping of Instagram and TikTok is
blocked from cloud IPs; Apify actors are the door. Every run is billed, so
the runner keeps a hard cap on runs per scan, records `usageTotalUsd` from
each run, and never starts more than `concurrency` runs at once. Long runs
use the asynchronous API (start, poll, read dataset); a single-post capture
can use the blocking run-sync endpoint.

API reference: https://docs.apify.com/api/v2
"""
from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Optional

from . import http

TERMINAL = {"SUCCEEDED", "FAILED", "TIMED-OUT", "ABORTED"}


@dataclass
class RunResult:
    label: str
    input: dict[str, Any]
    run: dict[str, Any] = field(default_factory=dict)
    items: list[dict[str, Any]] = field(default_factory=list)
    error: Optional[str] = None

    @property
    def ok(self) -> bool:
        return self.error is None and self.run.get("status") == "SUCCEEDED"

    @property
    def usage_usd(self) -> float:
        try:
            return float(self.run.get("usageTotalUsd") or 0.0)
        except (TypeError, ValueError):
            return 0.0

    @property
    def run_id(self) -> str:
        return str(self.run.get("id", ""))


class ApifyError(Exception):
    pass


class Apify:
    def __init__(
        self,
        token: str,
        *,
        base: str = "https://api.apify.com/v2",
        timeout_sec: int = 600,
        max_runs: int = 150,
        log: Optional[Callable[[str], None]] = None,
        sleep: Callable[[float], None] = time.sleep,
        clock: Callable[[], float] = time.monotonic,
    ):
        if not token:
            raise ApifyError("APIFY_API_KEY is not set")
        self.token = token
        self.base = base.rstrip("/")
        self.timeout_sec = timeout_sec
        self.max_runs = max_runs
        self.log = log or (lambda m: None)
        self.sleep = sleep
        self.clock = clock
        self.runs_started = 0
        self.usage_usd = 0.0

    # ---- primitives ----------------------------------------------------
    def _url(self, path: str, **params: Any) -> str:
        qs = http.encode_query({"token": self.token, **params})
        return f"{self.base}/{path.lstrip('/')}?{qs}"

    def me(self) -> dict[str, Any]:
        return http.get_json(self._url("users/me"), timeout=30)["data"]

    def start_run(
        self,
        actor_id: str,
        run_input: dict[str, Any],
        *,
        memory_mb: Optional[int] = None,
        timeout_secs: Optional[int] = None,
    ) -> dict[str, Any]:
        if self.runs_started >= self.max_runs:
            raise ApifyError(f"run cap reached ({self.max_runs} runs this scan)")
        params: dict[str, Any] = {}
        if memory_mb:
            params["memory"] = memory_mb
        if timeout_secs:
            params["timeout"] = timeout_secs
        url = self._url(f"acts/{actor_id}/runs", **params)
        out = http.post_json(url, run_input, timeout=60, retries=2)
        self.runs_started += 1
        return out["data"]

    def get_run(self, run_id: str) -> dict[str, Any]:
        return http.get_json(self._url(f"actor-runs/{run_id}"), timeout=30)["data"]

    def dataset_items(self, dataset_id: str, *, limit: Optional[int] = None) -> list[dict[str, Any]]:
        params: dict[str, Any] = {"clean": "true", "format": "json"}
        if limit:
            params["limit"] = limit
        out = http.get_json(self._url(f"datasets/{dataset_id}/items", **params), timeout=120)
        return out if isinstance(out, list) else []

    def run_sync_items(
        self, actor_id: str, run_input: dict[str, Any], *, timeout_secs: int = 240, memory_mb: Optional[int] = None
    ) -> list[dict[str, Any]]:
        """Blocking call for one small job (a single post). Times out server side."""
        if self.runs_started >= self.max_runs:
            raise ApifyError(f"run cap reached ({self.max_runs} runs this scan)")
        params: dict[str, Any] = {"timeout": timeout_secs, "clean": "true", "format": "json"}
        if memory_mb:
            params["memory"] = memory_mb
        url = self._url(f"acts/{actor_id}/run-sync-get-dataset-items", **params)
        self.runs_started += 1
        out = http.post_json(url, run_input, timeout=timeout_secs + 30, retries=1)
        return out if isinstance(out, list) else []

    # ---- many runs, bounded concurrency -----------------------------------
    def run_many(
        self,
        actor_id: str,
        jobs: list[tuple[str, dict[str, Any]]],
        *,
        concurrency: int = 4,
        poll_sec: float = 6.0,
        memory_mb: Optional[int] = None,
        timeout_secs: Optional[int] = None,
    ) -> list[RunResult]:
        """Run `jobs` = [(label, input)] through one actor with bounded concurrency."""
        results = [RunResult(label=lbl, input=inp) for lbl, inp in jobs]
        pending = list(range(len(results)))
        in_flight: dict[str, int] = {}
        deadline = self.clock() + self.timeout_sec
        while pending or in_flight:
            while pending and len(in_flight) < max(1, concurrency):
                idx = pending.pop(0)
                r = results[idx]
                try:
                    r.run = self.start_run(actor_id, r.input, memory_mb=memory_mb, timeout_secs=timeout_secs)
                    in_flight[r.run_id] = idx
                    self.log(f"apify start {actor_id} {r.label} run={r.run_id}")
                except (http.HttpError, ApifyError, KeyError) as e:
                    r.error = f"start failed: {e}"
                    self.log(f"apify start failed {r.label}: {e}")
            if not in_flight:
                break
            if self.clock() > deadline:
                for run_id, idx in list(in_flight.items()):
                    results[idx].error = "timed out waiting for the run"
                    self._abort(run_id)
                in_flight.clear()
                break
            self.sleep(poll_sec)
            for run_id, idx in list(in_flight.items()):
                r = results[idx]
                try:
                    r.run = self.get_run(run_id)
                except http.HttpError as e:
                    self.log(f"apify poll error {r.label}: {e}")
                    continue
                status = r.run.get("status")
                if status not in TERMINAL:
                    continue
                del in_flight[run_id]
                self.usage_usd += r.usage_usd
                if status == "SUCCEEDED":
                    try:
                        r.items = self.dataset_items(r.run["defaultDatasetId"])
                    except (http.HttpError, KeyError) as e:
                        r.error = f"dataset read failed: {e}"
                else:
                    r.error = f"run {status}"
                self.log(
                    f"apify done {r.label} status={status} items={len(r.items)} usd={r.usage_usd:.4f}"
                )
        return results

    def _abort(self, run_id: str) -> None:
        try:
            http.request("POST", self._url(f"actor-runs/{run_id}/abort"), timeout=30, retries=0)
        except http.HttpError:
            pass


def first(item: dict[str, Any], *keys: str, default: Any = None) -> Any:
    """The first present, non-null value among several candidate keys.

    Actor output schemas drift between versions (videoPlayCount versus
    videoViewCount, playCount versus stats.playCount); adapters read through
    this so a renamed field degrades to a warning, not a crash.
    """
    for k in keys:
        cur: Any = item
        ok = True
        for part in k.split("."):
            if isinstance(cur, dict) and part in cur and cur[part] is not None:
                cur = cur[part]
            else:
                ok = False
                break
        if ok and cur is not None and cur != "":
            return cur
    return default


def to_int(value: Any) -> Optional[int]:
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return int(value)
    s = str(value).strip().replace(",", "")
    mult = 1
    if s[-1:].upper() in ("K", "M", "B"):
        mult = {"K": 1_000, "M": 1_000_000, "B": 1_000_000_000}[s[-1].upper()]
        s = s[:-1]
    try:
        return int(float(s) * mult)
    except ValueError:
        return None


def pretty(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=False, indent=1)[:2000]
