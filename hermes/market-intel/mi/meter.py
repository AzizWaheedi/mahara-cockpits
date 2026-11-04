"""The spend meter: the run cap and the month cap, enforced in code before every pull.

A pull reserves its estimate first; a pull that would pass either cap is refused with a sentence the report
prints as "Not checked: ...". A reservation is held until the pull ends (an Apify run holds the whole ceiling it
is given), so pulls running side by side see each other: what is spent plus what is held never passes a cap.
After the pull the hold is given back and the real cost is counted (Apify's usageTotalUsd, ScrapeCreators'
credits at their rate). The month's spend comes from Supabase (every run's spend since the 1st, UTC); when it
cannot be read nothing is pulled: missing is never zero.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Optional


class BudgetRefused(Exception):
    """A pull that was not made. `sentence` is what the report and the run say."""

    def __init__(self, sentence: str):
        super().__init__(sentence)
        self.sentence = sentence


def usd(v: float) -> str:
    return f"USD {v:,.2f}"


def next_month_day(now: Optional[datetime] = None) -> str:
    now = now or datetime.now(timezone.utc)
    y, m = (now.year + 1, 1) if now.month == 12 else (now.year, now.month + 1)
    return datetime(y, m, 1).strftime("1 %b")


@dataclass
class Meter:
    cap_run: float
    cap_month: float
    month_before: Optional[float]          # the month's spend outside this run; None when it could not be read
    sc_usd_per_credit: float = 0.0019
    usd_apify: float = 0.0
    credits_sc: int = 0
    credits_foreplay: int = 0
    refused: list[str] = field(default_factory=list)
    held: float = 0.0                      # reserved by pulls still running, not yet counted as spent

    @property
    def usd_sc(self) -> float:
        return round(self.credits_sc * self.sc_usd_per_credit, 4)

    @property
    def run_usd(self) -> float:
        return round(self.usd_apify + self.usd_sc, 4)

    def remaining(self) -> float:
        """What is left under both caps after what is spent and what running pulls hold."""
        if self.month_before is None:
            return 0.0
        used = self.run_usd + self.held
        return max(0.0, min(self.cap_run - used, self.cap_month - self.month_before - used))

    def reserve(self, label: str, estimate_usd: float, ceiling: Optional[float] = None) -> float:
        """Refuse the pull when its estimate would pass a cap beside what is spent and held; else hold the estimate
        (or, with `ceiling`, the most the pull may be charged, cut to what is left) and return what is held. The
        caller gives the hold back with `settle` or `release`."""
        est = max(0.0, float(estimate_usd))
        if self.month_before is None:
            self._refuse(f"Not checked: {label}. This month's research spend could not be read, so nothing is pulled.")
        if self.month_before + self.run_usd + self.held + est > self.cap_month + 1e-9:
            self._refuse(f"Not checked: {label}. The month's research budget would pass {usd(self.cap_month)} "
                         f"({usd(self.month_before + self.run_usd)} spent"
                         + (f", {usd(self.held)} held by pulls still running" if self.held > 1e-9 else "")
                         + f"). Raise usd_cap_month or wait for {next_month_day()}.")
        if self.run_usd + self.held + est > self.cap_run + 1e-9:
            self._refuse(f"Not checked: {label}. This run's scraping budget would pass {usd(self.cap_run)} "
                         f"({usd(self.run_usd)} spent"
                         + (f", {usd(self.held)} held by pulls still running" if self.held > 1e-9 else "") + ").")
        hold = est if ceiling is None else max(est, min(self.remaining(), max(0.0, float(ceiling))))
        self.held = round(self.held + hold, 6)
        return hold

    def fits(self, estimate_usd: float, *, with_holds: bool = True) -> bool:
        """Would this estimate pass reserve (with or without what running pulls hold)? No side effect."""
        if self.month_before is None:
            return False
        used = self.run_usd + (self.held if with_holds else 0.0) + max(0.0, float(estimate_usd))
        return self.month_before + used <= self.cap_month + 1e-9 and used <= self.cap_run + 1e-9

    def hold(self, amount: float) -> float:
        """Hold an amount with no check: a pull that is already running (read again on a resume) may still spend."""
        amount = max(0.0, float(amount or 0.0))
        self.held = round(self.held + amount, 6)
        return amount

    def release(self, held: float) -> None:
        """Give a hold back: the pull did not start, or its cost is counted by other means."""
        self.held = max(0.0, round(self.held - max(0.0, float(held or 0.0)), 6))

    def settle(self, held: float, usd_apify: float) -> None:
        """A pull ended: its hold goes back and its real cost is counted."""
        self.release(held)
        self.add_apify(usd_apify)

    def set_caps(self, caps: Any, *, cap_run_code: float, cap_month_code: float) -> None:
        """The caps read again mid-run (a lowered cap applies to the next pull); the lower of the setting's and the
        worker's own wins, as at the claim."""
        caps = caps if isinstance(caps, dict) else {}
        self.cap_run = min(x for x in (_num(caps.get("run")), cap_run_code) if x is not None)
        self.cap_month = min(x for x in (_num(caps.get("month")), cap_month_code) if x is not None)

    def _refuse(self, sentence: str) -> None:
        self.refused.append(sentence)
        raise BudgetRefused(sentence)

    def add_apify(self, amount: float) -> None:
        self.usd_apify = round(self.usd_apify + max(0.0, float(amount or 0.0)), 5)

    def add_sc(self, credits: int) -> None:
        self.credits_sc += max(0, int(credits or 0))

    def spend(self) -> dict[str, Any]:
        """For cockpit_market_intel_progress: cumulative, never lower than what the run row holds."""
        return {"usdApify": round(self.usd_apify, 4), "usdScrapeCreators": self.usd_sc,
                "creditsScrapeCreators": self.credits_sc, "creditsForeplay": self.credits_foreplay}


def _num(v: Any) -> Optional[float]:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def from_claim(claim: dict[str, Any], *, cap_run_code: float, cap_month_code: float, sc_rate: float) -> Meter:
    """The meter for a claimed run: the lower of the setting's cap and the worker's own, and the month's spend
    outside this run (the run's own spend so far is carried in, so a resume never counts it twice)."""
    spend = claim.get("spend") or {}
    month = _num(claim.get("monthUsd"))
    usd_apify = _num(spend.get("usdApify")) or 0.0
    usd_sc = _num(spend.get("usdScrapeCreators")) or 0.0
    m = Meter(cap_run=cap_run_code, cap_month=cap_month_code,
              month_before=None if month is None else max(0.0, month - usd_apify - usd_sc), sc_usd_per_credit=sc_rate)
    m.set_caps(claim.get("caps"), cap_run_code=cap_run_code, cap_month_code=cap_month_code)
    m.usd_apify = usd_apify
    m.credits_sc = int(_num(spend.get("creditsScrapeCreators")) or 0)
    return m
