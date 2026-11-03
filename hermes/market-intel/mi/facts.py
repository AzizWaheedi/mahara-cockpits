"""The numbers a report may show, computed in code from the evidence. The model never types a number: a
finding names a metric ({"metric": "maps.rating", "of": "C3"}) and the renderer fills its value, its source
and its date from here. A metric with no evidence is absent and renders "[ ]": missing is never zero.

Second source (CLAUDE.md): the rating and review count of the client and the top three competitors are read
from the place pull and again from the reviews actor's place header; the client's Instagram followers again
through ScrapeCreators. Two values that differ by more than 2 percent ship as a range, "two sources differ".
"""
from __future__ import annotations

from typing import Any, Optional

CATALOGUE = {
    "maps.rating": "Google rating", "maps.reviews": "Google reviews", "reviews.low_share": "share of 1 and 2 star reviews",
    "reviews.reply_share": "share of reviews the owner answered", "ig.followers": "Instagram followers",
    "ig.posts_30d": "Instagram posts in the last 30 days", "fb.likes": "Facebook page likes",
    "fb.followers": "Facebook followers", "ads.active": "Meta ads running now", "ads.longest_days": "longest-running Meta ad, days",
    "tiktok.followers": "TikTok followers", "snap.subscribers": "Snapchat subscribers",
    "web.meta_pixel": "Meta Pixel on the site", "web.gtm": "Google Tag Manager on the site", "web.ga4": "GA4 on the site",
    "web.booking": "a booking widget on the site", "web.prices": "prices shown on the site", "nap.match": "Maps phone equals the front desk phone",
    "market.ads_in_search": "paid ads on the local search", "market.advertisers": "businesses advertising the service on Meta now",
}
BOOLEAN = {"web.meta_pixel", "web.gtm", "web.ga4", "web.booking"}


def _close(a: float, b: float) -> bool:
    if a == b:
        return True
    return abs(a - b) / max(abs(a), abs(b), 1e-9) <= 0.02


class Facts:
    def __init__(self) -> None:
        self.table: dict[tuple[str, str], dict[str, Any]] = {}

    def put(self, subject: str, metric: str, value: Any, ev: Optional[dict[str, Any]], note: Optional[str] = None) -> None:
        if metric not in CATALOGUE or value is None or ev is None:
            return
        self.table[(subject, metric)] = {"value": value, "eids": [ev["eid"]], "url": ev.get("url"),
                                         "retrievedAt": ev.get("retrievedAt"), "note": note}

    def second(self, subject: str, metric: str, value: Any, ev: Optional[dict[str, Any]]) -> None:
        """A second reading of a number: kept as one value when close, as a range when not."""
        cur = self.table.get((subject, metric))
        if value is None or ev is None:
            return
        if cur is None:
            self.put(subject, metric, value, ev, note="one source")
            return
        cur["eids"].append(ev["eid"])
        a, b = float(cur["value"]) if not isinstance(cur["value"], list) else cur["value"][0], float(value)
        if _close(a, b):
            cur["note"] = "two sources agree"
        else:
            cur["value"] = [min(a, b), max(a, b)]
            cur["note"] = "two sources differ"

    def get(self, subject: str, metric: str) -> Optional[dict[str, Any]]:
        return self.table.get((subject, metric))

    def subjects(self) -> list[str]:
        return sorted({s for s, _ in self.table})

    def catalogue_for_model(self) -> list[dict[str, Any]]:
        """What the model may reference: the metric names that have a value, per subject (never the values)."""
        return [{"of": s, "metric": m, "means": CATALOGUE[m]} for (s, m) in sorted(self.table)]

    def as_rows(self) -> list[dict[str, Any]]:
        return [{"of": s, "metric": m, **v} for (s, m), v in sorted(self.table.items())]

    @classmethod
    def from_rows(cls, rows: list[dict[str, Any]]) -> "Facts":
        f = cls()
        for r in rows:
            f.table[(r["of"], r["metric"])] = {k: r[k] for k in ("value", "eids", "url", "retrievedAt", "note")}
        return f


def display(metric: str, fact: Optional[dict[str, Any]], lang: str = "en") -> str:
    """The value as text: a range when two sources differ, found/not found for a yes or no, "[ ]" when missing."""
    if not fact:
        return "[ ]"
    v = fact["value"]
    if metric in BOOLEAN or isinstance(v, bool):
        return ("found" if v else "not found") if lang == "en" else ("✓" if v else "✗")
    if metric == "nap.match":
        return {"match": "matches", "differs": "differs", "not_checked": "[ ]"}.get(str(v), "[ ]") if lang == "en" else \
            {"match": "✓", "differs": "✗"}.get(str(v), "[ ]")
    if metric.endswith("_share"):
        return f"{round(float(v) * 100)}%"

    def num(x: Any) -> str:
        x = float(x)
        return f"{x:.1f}" if metric == "maps.rating" else f"{int(round(x)):,}"

    if isinstance(v, list):
        return f"{num(v[0])} to {num(v[1])}" if lang == "en" else f"{num(v[0])}–{num(v[1])}"
    return num(v)
