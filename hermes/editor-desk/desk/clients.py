"""The client behind a video job, and the brand work an editor has to respect.

Aziz, 2026-09-18: *"the tag on the task is the client and aligns with the
clients board in clickup with all the docs."* That one sentence moves the
brief. A video card's description is empty on every job we have; what an
editor actually needs — the brand rules, the offer, the tone — is on the
client's card on Clients - Mahara, which the other three cockpits already
treat as the spine.

So this module resolves the tag to that card, reads its documents once per
client rather than once per job, and hands the desk something to put in front
of the person doing the cutting.

The matching is deliberately plain. Tags are typed by hand and lowercase
("alkhalil"), client cards are typed by hand and capitalised ("Alkhalil"), and
one of them sometimes drops a space. So a name becomes a small set of forms —
itself, itself without a trailing company word, its first word, and itself
with the spaces squeezed out — and two names match when their sets overlap.
It is explainable, and when it is wrong the wrong client is visible on the job
rather than hidden in a score.
"""
from __future__ import annotations

import re
from typing import Any, Callable, Iterable, Optional

from . import http
from .clickup import BASE
from .config import Config

CLIENTS_LIST = "901816559981"

# Field labels on Clients - Mahara, matched loosely so an emoji or a renamed
# apostrophe does not lose the document. Keys are our stable names.
CLIENT_FIELDS = {
    "brand_dna_url": "brand dna",
    "offer_url": "offer cheat sheet",
    "dos_donts": "do s don ts",
    "drive_url": "drive folder",
    "website": "website",
    "instagram": "instagram",
    "status": "client status",
}
DOC_RE = re.compile(r"https://docs\.google\.com/document/d/[A-Za-z0-9_-]{10,}")

# Words that identify nobody on their own, so they never carry a match.
GENERIC = {
    "the", "al", "group", "co", "company", "llc", "est", "trading", "general",
    "international", "designs", "design", "studio", "services", "solutions",
}
TRAILING = (
    " company", " co", " est", " trading", " llc", " limited", " group",
    " contracting", " construction", " industries",
)
# Cards on the list that are checklists, not companies.
NOT_A_CLIENT = ("videos", "footage", "launch", "access", "scripts", "dropbox", "ad account", "ads manager")


def norm(value: Any) -> str:
    """Lowercase, punctuation to spaces, single-spaced. Arabic survives this."""
    s = str(value or "").lower().strip()
    return " ".join("".join(c if (c.isalnum() or c.isspace()) else " " for c in s).split())


def aliases(name: Any) -> set[str]:
    """The small set of forms a person might have typed for this name."""
    n = norm(name)
    if not n:
        return set()
    out = {n, n.replace(" ", "")}
    for junk in TRAILING:
        if n.endswith(junk) and len(n) > len(junk) + 2:
            short = n[: -len(junk)].strip()
            out.update({short, short.replace(" ", "")})
    parts = n.split(" ")
    if len(parts) > 1:
        # "شركة X" and "Al X": the distinguishing word is the second one.
        out.add(" ".join(parts[1:]) if parts[0] in GENERIC else parts[0])
    return {a for a in out if len(a) > 2 and a not in GENERIC}


def fields_by_name(task: dict[str, Any]) -> dict[str, Any]:
    """Custom fields keyed by our names, dropdown indices resolved to labels.

    A dropdown's value is an index, and index 0 is a real choice: reading it as
    falsy is how a first probe decided two live clients had no status.
    """
    found: dict[str, Any] = {}
    for c in task.get("custom_fields") or []:
        if not isinstance(c, dict):
            continue
        label = norm(c.get("name"))
        key = next((k for k, want in CLIENT_FIELDS.items() if label == want or want in label), None)
        if not key:
            continue
        value = c.get("value")
        if value is None or value == "" or value == []:
            continue
        if c.get("type") == "drop_down":
            opts = (c.get("type_config") or {}).get("options") or []
            try:
                value = str(opts[int(value)].get("name"))
            except (TypeError, ValueError, IndexError, AttributeError):
                value = str(value)
        found[key] = value
    return found


def roster(cfg: Config, log: Callable[[str], None]) -> list[dict[str, Any]]:
    """Every company on Clients - Mahara, with its documents."""
    out: list[dict[str, Any]] = []
    headers = {"Authorization": cfg.clickup_key}
    for page in range(6):
        q = http.encode_query({"include_closed": "true", "subtasks": "false", "page": page})
        data = http.get_json(f"{BASE}/list/{CLIENTS_LIST}/task?{q}", headers=headers, timeout=90)
        batch = [t for t in (data or {}).get("tasks") or [] if isinstance(t, dict)]
        for t in batch:
            name = str(t.get("name") or "").strip()
            low = name.lower()
            if not name or "playing account" in low:
                continue
            if any(k in low for k in NOT_A_CLIENT) and len(name) > 25:
                continue
            f = fields_by_name(t)
            # No Client Status at all is a checklist row, not a company.
            if not f.get("status"):
                continue
            out.append({
                "task_id": str(t.get("id") or ""),
                "name": name,
                "url": t.get("url"),
                "status": str(f.get("status") or ""),
                "aliases": sorted(aliases(name)),
                "dos_donts": str(f.get("dos_donts") or "").strip() or None,
                "brand_dna_url": str(f.get("brand_dna_url") or "").strip() or None,
                "offer_url": str(f.get("offer_url") or "").strip() or None,
                "drive_url": str(f.get("drive_url") or "").strip() or None,
                "website": str(f.get("website") or "").strip() or None,
                "instagram": str(f.get("instagram") or "").strip() or None,
            })
        if len(batch) < 100:
            break
    log(f"clients: {len(out)} companies on the board")
    return out


# Only our own people get a seat from the board. A ClickUp card can be edited
# by anyone with access to the workspace, and a seat opens client material, so
# the address has to be ours before it counts.
SEAT_DOMAINS = ("maharamedia.com",)


def seat_people(tasks: list[dict[str, Any]]) -> list[dict[str, str]]:
    """Everyone named as Assigned Editor on these cards, at our own domain."""
    from .clickup import editors_of

    out: dict[str, str] = {}
    for t in tasks:
        for person in editors_of(t):
            email = str(person.get("email") or "").strip().lower()
            if not email or not any(email.endswith("@" + d) for d in SEAT_DOMAINS):
                continue
            name = str(person.get("name") or "").strip()
            if name or email not in out:
                out[email] = name or out.get(email, "")
    return [{"email": e, "name": n} for e, n in sorted(out.items())]


def match(tags: Iterable[Any], people: list[dict[str, Any]]) -> Optional[dict[str, Any]]:
    """The client a video card's tags point at, or nothing.

    Exact name first, so a short alias can never beat a full one; the alias
    sets are the fallback for the spacing and the trailing company word.
    """
    forms = [(str(t or ""), norm(t), aliases(t)) for t in tags if str(t or "").strip()]
    if not forms:
        return None
    by_name = {norm(c["name"]): c for c in people}
    for _, exact, _ in forms:
        if exact in by_name:
            return by_name[exact]
    for _, _, tag_aliases in forms:
        best: Optional[dict[str, Any]] = None
        best_len = 0
        for c in people:
            shared = tag_aliases & set(c.get("aliases") or [])
            if not shared:
                continue
            longest = max(len(s) for s in shared)
            if longest > best_len:
                best, best_len = c, longest
        if best:
            return best
    return None


DOCS = (
    ("brand_dna_url", "brand_dna", "brand_dna_rev"),
    ("offer_url", "offer", "offer_rev"),
)


def doc_id_in(link: Any) -> Optional[str]:
    """The Google Doc a client-card field points at, however it was pasted."""
    from . import drive as drive_mod

    text = str(link or "")
    m = DOC_RE.search(text)
    if m:
        return drive_mod.parse_id(m.group(0))
    return drive_mod.parse_id(text) if "docs.google.com" in text else None


def revisions(drive: Any, row: dict[str, Any]) -> dict[str, Optional[str]]:
    """What Drive currently says each of this client's documents was last
    changed at. A brand document is edited in place, so the link is the same
    afterwards and only this tells the desk to read it again."""
    out: dict[str, Optional[str]] = {}
    for url_key, _text_key, rev_key in DOCS:
        doc_id = doc_id_in(row.get(url_key))
        if not doc_id:
            out[rev_key] = None
            continue
        try:
            out[rev_key] = str((drive.get(doc_id) or {}).get("modifiedTime") or "") or None
        except Exception:  # noqa: BLE001 - unreadable means "read it again"
            out[rev_key] = None
    return out


def read_docs(drive: Any, row: dict[str, Any], log: Callable[[str], None], *, limit: int = 40000) -> dict[str, Any]:
    """Pull the Brand DNA and the Offer Cheat Sheet in as text.

    These are Google Docs, so the desk reads them with the same token it reads
    footage with. A document that will not open is recorded on the row and the
    job still works; brand rules are context, never a gate.

    Each document's revision is recorded beside its text, so the next sync can
    tell an edited document from an unchanged one without reading it.
    """
    errors: list[str] = []
    for url_key, text_key, rev_key in DOCS:
        doc_id = doc_id_in(row.get(url_key))
        if not doc_id:
            continue
        try:
            meta = drive.get(doc_id) or {}
            text = drive.doc_text(doc_id)
        except Exception as e:  # noqa: BLE001 - a document is context, never a gate
            errors.append(f"{text_key}: {http.scrub(str(e))[:120]}")
            continue
        if text:
            row[text_key] = text[:limit]
            row[rev_key] = str(meta.get("modifiedTime") or "") or None
    row["docs_error"] = "; ".join(errors)[:300] or None
    if errors:
        log(f"  {row.get('name')}: {row['docs_error']}")
    return row


def brand_lines(client: Optional[dict[str, Any]]) -> list[str]:
    """The short version an editor reads on the card, in plain sentences."""
    if not client:
        return []
    out = [f"Client: {client.get('name')}."]
    dd = str(client.get("dos_donts") or "").strip()
    if dd:
        out.append("Do's and Don'ts: " + " ".join(dd.split())[:600])
    if client.get("brand_dna"):
        out.append(f"Brand DNA is on the client card: {client.get('brand_dna_url')}")
    elif client.get("brand_dna_url"):
        out.append(f"Brand DNA: {client.get('brand_dna_url')}")
    if client.get("offer_url"):
        out.append(f"Offer cheat sheet: {client.get('offer_url')}")
    return out
