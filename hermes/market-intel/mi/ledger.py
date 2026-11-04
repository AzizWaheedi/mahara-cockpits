"""The provider ledger: every outside call writes an intent row before it and a response row after it into
cockpit_csm_provider_health (provider, method, resource, phase, http_status, run_key). A call whose intent
cannot be saved is not made. Rows hold no value: no query string, no body, no key.
"""
from __future__ import annotations

from typing import Any, Callable, Optional, TypeVar

from . import http

T = TypeVar("T")


class LedgerDown(Exception):
    """The intent row could not be saved, so the call was not made."""


class Ledger:
    def __init__(self, sink: Callable[[dict[str, Any]], None], run_key: str = "market-intel"):
        self.sink = sink
        self.run_key = run_key
        self.calls = 0

    def _row(self, provider: str, method: str, resource: str, phase: str, status: Optional[int]) -> dict[str, Any]:
        return {"provider": provider, "method": method.upper(), "resource": http.scrub(resource)[:200], "phase": phase,
                "http_status": status, "run_key": self.run_key}

    def call(self, provider: str, method: str, resource: str, fn: Callable[[], T]) -> T:
        try:
            self.sink(self._row(provider, method, resource, "intent", None))
        except Exception as e:  # noqa: BLE001
            raise LedgerDown(f"The provider ledger could not be written, so the {provider} call was not made: "
                             f"{http.scrub(str(e))[:160]}") from None
        self.calls += 1
        try:
            out = fn()
        except http.HttpError as e:
            self._after(provider, method, resource, e.status or None)
            raise
        except Exception:
            self._after(provider, method, resource, None, phase="unknown")
            raise
        self._after(provider, method, resource, 200)
        return out

    def _after(self, provider: str, method: str, resource: str, status: Optional[int], phase: str = "response") -> None:
        try:
            self.sink(self._row(provider, method, resource, phase, status))
        except Exception:  # noqa: BLE001
            # The call already happened; a lost response row is not a reason to lose its result.
            pass


def memory_ledger(run_key: str = "market-intel") -> tuple[Ledger, list[dict[str, Any]]]:
    rows: list[dict[str, Any]] = []
    return Ledger(rows.append, run_key), rows
