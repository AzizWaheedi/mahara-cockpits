"""The evidence pack: every pulled item, numbered E1, E2, ... in pull order, with its URL, source, time and
cost. The model sees only this pack (fenced as data), and every claim it makes must point at it.

Bodies are trimmed before they are kept (8 KB each, the table takes 64 KB) and again before the model sees
them. A review keeps its text, stars, date and language, and never its reviewer: the adapters copy only
allowed keys, and `add` refuses a review body that names one.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Iterable, Optional

KINDS = {"maps_place", "review", "serp", "web_page", "ig_profile", "fb_page", "ad", "tiktok", "snap", "blueprint",
         "form", "nap"}
REVIEWER_KEYS = {"name", "reviewer", "reviewerName", "reviewerId", "reviewerUrl", "reviewerPhotoUrl", "author",
                 "authorName", "userName", "profileUrl"}
BODY_MAX = 8000


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _trim(v: Any, budget: int) -> Any:
    """A JSON value cut to about `budget` characters: long strings shortened, long lists cut."""
    if isinstance(v, str):
        return v if len(v) <= budget else v[: max(0, budget - 1)] + "…"
    if isinstance(v, list):
        out, used = [], 2
        for x in v:
            t = _trim(x, max(60, budget - used))
            used += len(json.dumps(t, ensure_ascii=False)) + 1
            if used > budget:
                break
            out.append(t)
        return out
    if isinstance(v, dict):
        out_d, used = {}, 2
        for k, x in v.items():
            t = _trim(x, max(60, budget - used))
            used += len(json.dumps(t, ensure_ascii=False)) + len(k) + 4
            if used > budget:
                break
            out_d[k] = t
        return out_d
    return v


@dataclass
class Draft:
    kind: str
    subject: str
    source: str
    body: dict[str, Any]
    url: Optional[str] = None
    usd: float = 0.0
    retrieved_at: Optional[str] = None


@dataclass
class Pack:
    items: list[dict[str, Any]] = field(default_factory=list)

    def add(self, d: Draft) -> str:
        if d.kind not in KINDS:
            raise ValueError(f"unknown evidence kind {d.kind}")
        if d.kind == "review" and REVIEWER_KEYS & set(d.body):
            raise ValueError("a review body may not name its reviewer")
        body = _trim(d.body, BODY_MAX)
        eid = f"E{len(self.items) + 1}"
        url = d.url if d.url and str(d.url).startswith(("http://", "https://")) else None
        raw = json.dumps({"kind": d.kind, "subject": d.subject, "url": url, "body": body}, ensure_ascii=False,
                         sort_keys=True)
        self.items.append({"eid": eid, "kind": d.kind, "subject": d.subject, "url": url,
                           "retrievedAt": d.retrieved_at or now_iso(), "source": d.source[:120],
                           "usd": round(float(d.usd or 0.0), 5), "body": body,
                           "sha256": hashlib.sha256(raw.encode("utf-8")).hexdigest()})
        return eid

    def extend(self, drafts: Iterable[Draft]) -> list[str]:
        return [self.add(d) for d in drafts]

    def get(self, eid: str) -> Optional[dict[str, Any]]:
        try:
            i = int(eid[1:]) - 1
        except (ValueError, IndexError):
            return None
        return self.items[i] if 0 <= i < len(self.items) and self.items[i]["eid"] == eid else None

    def ids(self) -> set[str]:
        return {e["eid"] for e in self.items}

    def urls(self) -> set[str]:
        return {e["url"] for e in self.items if e.get("url")}

    def of(self, subject: str, kind: Optional[str] = None) -> list[dict[str, Any]]:
        return [e for e in self.items if e["subject"] == subject and (kind is None or e["kind"] == kind)]

    def relabel(self, mapping: dict[str, str]) -> None:
        """Candidates K<n> become competitors C<n> once picked (the stored subject follows)."""
        for e in self.items:
            if e["subject"] in mapping:
                e["subject"] = mapping[e["subject"]]

    def for_model(self, budget_chars: int, per_item: int = 1600) -> list[dict[str, Any]]:
        """The pack as the model reads it, trimmed to the budget: the client's items first, then the competitors',
        then the market's; each body cut to `per_item` characters."""
        order = {"client": 0}
        ranked = sorted(self.items, key=lambda e: (order.get(e["subject"], 1 if e["subject"].startswith("C") else 2),
                                                   int(e["eid"][1:])))
        out, used = [], 0
        for e in ranked:
            row = {"eid": e["eid"], "kind": e["kind"], "subject": e["subject"], "url": e.get("url"),
                   "retrievedAt": e["retrievedAt"], "body": _trim(e.get("body") or {}, per_item)}
            size = len(json.dumps(row, ensure_ascii=False))
            if used + size > budget_chars:
                continue
            out.append(row)
            used += size
        return sorted(out, key=lambda r: int(r["eid"][1:]))
