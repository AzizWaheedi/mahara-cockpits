"""A lead's research brief: who they are and what their business does, from
the web, every claim with the page it came from.

Aziz, 2026-09-24: "a lead researcher where you can have an agent go ahead and
research the person, search them up on LinkedIn, Google, and everything
about the person as well if they trigger".

Two searches through two engines, so nothing rests on one source:
- Google, through Apify's own google-search-scraper: the person's LinkedIn
  page, the company's site and socials, found by search. LinkedIn itself is
  never scraped (its terms forbid it, and a scraper's accounts can vanish
  overnight); the rep gets the link and opens it.
- OpenAI's Responses API with its web_search tool: the model searches and
  reads pages itself, and returns the brief with the URL behind each claim.

The brief never guesses a person. A profile is theirs only when two things
match (the name and the company, the name and the email's own domain, the
company and the city); a common first name and nothing else is "not found".
A claim whose page the search never opened is kept but marked unverified.

Lead data goes to OpenAI and Apify only, never to DeepSeek (PDPL).
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Any, Callable, Optional

from . import http

OPENAI = "https://api.openai.com/v1/responses"
APIFY_GOOGLE = "https://api.apify.com/v2/acts/apify~google-search-scraper/run-sync-get-dataset-items"
FREE_MAIL = {"gmail.com", "hotmail.com", "outlook.com", "yahoo.com", "icloud.com", "live.com", "msn.com",
             "me.com", "aol.com", "proton.me", "protonmail.com", "gmx.com", "yandex.com", "mail.com"}
COUNTRY = {"SA": "Saudi Arabia", "KW": "Kuwait", "AE": "United Arab Emirates", "QA": "Qatar", "BH": "Bahrain",
           "OM": "Oman", "EG": "Egypt", "JO": "Jordan", "LB": "Lebanon"}

SYSTEM = """You research one sales lead for Mahara Media, a Gulf agency that brings construction,
architecture, interior design and fit-out firms qualified project leads through paid ads.
A rep will call this person. Find who they are and what their business does, from the web.

Rules:
- Search the web. Use the Google results you are given as leads to follow, not as facts.
- A profile or company belongs to this lead only when at least two identifiers match: the name
  and the company, the name and the email's own domain, the company and the city or country.
  A first name alone, or a common name with no second match, is NOT them: say so in not_found.
- Every fact carries the exact URL of the page that states it. No URL, no fact.
- Never invent numbers, clients, projects or titles. Quote what a page says.
- LinkedIn: give the profile URL if a search result shows it is them; do not claim what is behind a login.
- Write in English; keep names, company names and quotes in their own language.
- Talking points are for a first sales call, grounded in the facts you found, and short.

Answer with one JSON object only, no prose around it:
{
  "identified": true | false,
  "confidence": "high" | "medium" | "low",
  "person": {"summary": str, "role": str | null, "linkedin": url | null,
             "facts": [{"text": str, "source": url}]},
  "company": {"name": str | null, "website": url | null, "summary": str,
              "size": str | null, "locations": str | null,
              "social": {"instagram": url | null, "linkedin": url | null, "other": [url]},
              "facts": [{"text": str, "source": url}]},
  "signals": [{"text": str, "source": url}],
  "talking_points": [str],
  "cautions": [str],
  "not_found": [str]
}"""


def lead_facts(lead: dict[str, Any]) -> dict[str, Any]:
    """What the lead told us, in the shape the prompt and the searches use."""
    email = str(lead.get("email") or "").strip().lower()
    domain = email.split("@", 1)[1] if "@" in email else ""
    country = str(lead.get("country") or "").strip().upper()
    return {
        "name": str(lead.get("name") or "").strip(),
        "company": str(lead.get("company") or "").strip(),
        "email_domain": domain if domain and domain not in FREE_MAIL else None,
        "country_code": country or None,
        "country": COUNTRY.get(country, country or None),
        "answers": {k: lead.get(k) for k in ("revenue", "revenue_goal", "readiness", "challenge",
                                             "decision_maker", "services")
                    if lead.get(k)},
        "came_from_ad": lead.get("ad_name") or None,
    }


def queries(f: dict[str, Any]) -> list[str]:
    """Up to four Google searches, only those with enough to find someone."""
    name, company, domain = f["name"], f["company"], f["email_domain"]
    where = f["country"] or ""
    out: list[str] = []
    one_word = len(name.split()) < 2
    if company:
        out.append(f'"{company}" {where}'.strip())
        if name and not one_word:
            out.append(f'"{name}" "{company}"')
        out.append(f'site:linkedin.com/in "{name}" "{company}"' if name else f'site:linkedin.com/company "{company}"')
        out.append(f'site:instagram.com "{company}"')
    elif domain:
        out.append(f'"{domain}"')
        if name:
            out.append(f'"{name}" "{domain.split(".")[0]}"')
    elif name and not one_word:
        out.append(f'"{name}" {where} architecture OR construction OR design OR contracting'.strip())
        out.append(f'site:linkedin.com/in "{name}" {where}'.strip())
    return out[:4]


def google(apify_key: str, qs: list[str], country_code: Optional[str], *, timeout: float = 150) -> list[dict[str, Any]]:
    """Google's organic results for each query, trimmed to what the brief needs."""
    if not qs or not apify_key:
        return []
    body = {"queries": "\n".join(qs), "resultsPerPage": 10, "maxPagesPerQuery": 1,
            "countryCode": (country_code or "").lower() or None, "mobileResults": False,
            "saveHtml": False, "includeUnfilteredResults": False}
    body = {k: v for k, v in body.items() if v is not None}
    _, _, raw = http.request("POST", f"{APIFY_GOOGLE}?timeout={int(timeout)}",
                             headers={"Authorization": f"Bearer {apify_key}", "Content-Type": "application/json"},
                             data=json.dumps(body).encode(), timeout=timeout + 30, retries=1)
    items = json.loads(raw.decode("utf-8") or "[]")
    out = []
    for it in items if isinstance(items, list) else []:
        term = ((it.get("searchQuery") or {}).get("term")) or ""
        for r in (it.get("organicResults") or [])[:10]:
            if r.get("url"):
                out.append({"query": term, "title": str(r.get("title") or "")[:200], "url": str(r["url"]),
                            "snippet": str(r.get("description") or "")[:400]})
    return out


def _text_and_sources(resp: dict[str, Any]) -> tuple[str, list[str]]:
    """The answer's text, and every URL the web search opened or cited."""
    text, urls = "", []
    for item in resp.get("output") or []:
        if item.get("type") == "web_search_call":
            for s in ((item.get("action") or {}).get("sources") or []):
                if isinstance(s, dict) and s.get("url"):
                    urls.append(str(s["url"]))
        if item.get("type") == "message":
            for c in item.get("content") or []:
                if c.get("type") == "output_text":
                    text += str(c.get("text") or "")
                    for a in c.get("annotations") or []:
                        if a.get("type") == "url_citation" and a.get("url"):
                            urls.append(str(a["url"]))
    return text, urls


def first_json(text: str) -> Optional[dict[str, Any]]:
    """The first whole JSON object in the answer."""
    start = text.find("{")
    while start >= 0:
        depth, quoted, esc = 0, False, False
        for i in range(start, len(text)):
            ch = text[i]
            if quoted:
                esc = (ch == "\\") and not esc
                if ch == '"' and not esc:
                    quoted = False
                continue
            if ch == '"':
                quoted = True
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    try:
                        out = json.loads(text[start:i + 1])
                        return out if isinstance(out, dict) else None
                    except ValueError:
                        break
        start = text.find("{", start + 1)
    return None


def _norm_url(u: str) -> str:
    u = u.strip().lower().split("#", 1)[0]
    u = re.sub(r"^https?://(www\.)?", "", u)
    u = re.sub(r"[?&]utm_[^&]+", "", u)
    return u.rstrip("/")


def check_sources(brief: dict[str, Any], consulted: list[str]) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Drop facts with no URL; mark each kept fact verified when the search
    opened that page. Returns the brief and the list of consulted pages."""
    seen = {_norm_url(u) for u in consulted}

    def facts(xs: Any) -> list[dict[str, Any]]:
        out = []
        for x in xs if isinstance(xs, list) else []:
            if not isinstance(x, dict):
                continue
            src = str(x.get("source") or "").strip()
            text = str(x.get("text") or "").strip()
            if not text or not re.match(r"^https?://", src):
                continue
            out.append({"text": text[:500], "source": src, "verified": _norm_url(src) in seen})
        return out[:12]

    b = dict(brief)
    person = dict(b.get("person") or {})
    person["facts"] = facts(person.get("facts"))
    company = dict(b.get("company") or {})
    company["facts"] = facts(company.get("facts"))
    b["person"], b["company"] = person, company
    b["signals"] = facts(b.get("signals"))
    for k in ("talking_points", "cautions", "not_found"):
        b[k] = [str(x)[:400] for x in (b.get(k) or []) if str(x).strip()][:8]
    pages = []
    for u in dict.fromkeys(consulted):
        pages.append({"url": u})
    return b, pages[:60]


def research(lead: dict[str, Any], *, openai_key: str, apify_key: str, model: str = "gpt-5",
             log: Callable[[str], None] = lambda _m: None, timeout: float = 600) -> dict[str, Any]:
    """The brief for one lead: Google through Apify, then the model with web search."""
    f = lead_facts(lead)
    if not f["name"] and not f["company"] and not f["email_domain"]:
        raise ValueError("The lead has no name, company or company email to search for.")
    hits: list[dict[str, Any]] = []
    try:
        hits = google(apify_key, queries(f), f["country_code"])
    except Exception as e:  # noqa: BLE001 - the model's own search still runs
        log(f"research: Google through Apify failed: {http.scrub(str(e))[:200]}")
    user = ("The lead, as they gave it to us:\n" + json.dumps(f, ensure_ascii=False, indent=1)
            + "\n\nGoogle results to follow up (search engine snippets, not facts):\n"
            + json.dumps(hits[:30], ensure_ascii=False, indent=1))
    tool: dict[str, Any] = {"type": "web_search"}
    if f["country_code"] and len(f["country_code"]) == 2:
        tool["user_location"] = {"type": "approximate", "country": f["country_code"]}
    body = {"model": model, "tools": [tool], "include": ["web_search_call.action.sources"],
            "instructions": SYSTEM, "input": user, "reasoning": {"effort": "medium"}}
    _, _, raw = http.request("POST", OPENAI, headers={"Authorization": f"Bearer {openai_key}",
                                                      "Content-Type": "application/json"},
                             data=json.dumps(body).encode(), timeout=timeout, retries=1)
    resp = json.loads(raw.decode("utf-8"))
    text, urls = _text_and_sources(resp)
    brief = first_json(text)
    if brief is None:
        raise ValueError("The model's answer had no brief in it.")
    consulted = urls + [h["url"] for h in hits]
    checked, pages = check_sources(brief, consulted)
    usage = resp.get("usage") or {}
    return {"brief": checked, "sources": {"pages": pages, "google": hits[:30], "queries": queries(f)},
            "model": str(resp.get("model") or model),
            "usage": {"input": usage.get("input_tokens"), "output": usage.get("output_tokens")},
            "at": datetime.now(timezone.utc).isoformat()}


def run(sb: Any, cfg: Any, log: Callable[[str], None], *, host: str, limit: int = 3,
        model: str = "gpt-5", apify_key: str = "", max_attempts: int = 2) -> dict[str, Any]:
    """Drain the research requests the cockpit queued."""
    rows = sb.queued("research", max_attempts=max_attempts, limit=limit)
    done = failed = 0
    for req in rows:
        mine = sb.claim(req, host)
        if not mine:
            continue
        params = mine.get("params") or {}
        rid = str(mine["id"])
        contact = str(mine.get("contact_id") or params.get("contact_id") or "")
        sb.patch("cockpit_sales_research", f"request_id=eq.{http.quote(rid)}", {"status": "running"})
        try:
            leads = sb.select("cockpit_sales_leads", f"select=*&contact_id=eq.{http.quote(contact)}&limit=1")
            if not leads:
                raise ValueError("The lead is not in the cockpit any more.")
            out = research(leads[0], openai_key=cfg.openai_key, apify_key=apify_key, model=model, log=log,
                           timeout=cfg.model_timeout)
            sb.patch("cockpit_sales_research", f"request_id=eq.{http.quote(rid)}",
                     {"status": "ready", "brief": out["brief"], "sources": out["sources"], "model": out["model"],
                      "error": None, "finished_at": out["at"]})
            sb.request_done(rid, {"usage": out["usage"], "pages": len(out["sources"]["pages"])})
            done += 1
            log(f"research: {contact} ready ({len(out['sources']['pages'])} pages)")
        except Exception as e:  # noqa: BLE001 - one lead is not worth the rest
            msg = http.scrub(str(e))[:400]
            final = int(mine.get("attempts") or 1) >= max_attempts
            sb.request_failed(rid, msg, final=final)
            if final:
                sb.patch("cockpit_sales_research", f"request_id=eq.{http.quote(rid)}",
                         {"status": "failed", "error": msg,
                          "finished_at": datetime.now(timezone.utc).isoformat()})
            failed += 1
            log(f"research: {contact} failed: {msg}")
    return {"seen": len(rows), "done": done, "failed": failed}
