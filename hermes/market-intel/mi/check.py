"""The validator: eight rules, run before anything is stored as findings (and, from MI-3, before anything is
published). A failure is a plain sentence a person can act on. Fail once: one repair call. Fail again: the run
ends needs_person with the first failing rule's sentence.

1. Shape: both editions follow mi.findings.v1, the thirteen sections present, each claim well formed.
2. Evidence: every claim cites evidence this run pulled; every URL in the text is an evidence URL.
3. No numbers in prose: the renderer fills numbers from the evidence (metric references only).
4. Arabic and English carry the same sections, claim ids, competitor ids, evidence and metrics.
5. Minimums: 5 competitors with 2 independent sources each, 20 evidence items, the client's presence checked on
   4 of 6 channels (each unchecked one named by the renderer).
6. Form answers only as the client's claims, with the form date; the mystery shop's speed is null.
7. No contact data, no internal ids (and reviews carry no reviewer: dropped at pull time, refused at store).
8. The positioning and plan sections are labelled as recommendations, never an approved offer.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Optional

from .facts import CATALOGUE
from .prompts import KINDS, SCHEMA, SECTION_KEYS

ID = re.compile(r"^[A-Za-z0-9_-]{1,24}$")
DIGIT = re.compile(r"[0-9٠-٩۰-۹]")
PLACEHOLDER = re.compile(r"\{m\d{1,2}\}")
TOKEN = re.compile(r"\b[EC]\d{1,4}\b")
DURATION = re.compile(r"[0-9٠-٩]{1,3}\s*(?:-|to|–)?\s*[0-9٠-٩]{0,3}\s*(?:days?|weeks?|months?|يوم|أيام|ايام|أسبوع|أسابيع|اسابيع|شهر|أشهر|اشهر)", re.I)
URL = re.compile(r"https?://[^\s)\]\"'<>،]+", re.I)
EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.I)
INDEPENDENT = {"maps_place": "maps", "review": "maps", "web_page": "site", "ig_profile": "page", "fb_page": "page",
               "ad": "ads", "tiktok": "page", "snap": "page", "serp": "search"}
CHANNELS = ("maps", "website", "instagram", "facebook", "ads", "tiktok_snapchat")
RECOMMEND = ("positioning", "plan")


@dataclass
class Verdict:
    rules: dict[str, dict[str, Any]] = field(default_factory=dict)

    def fail(self, rule: str, sentence: str, errors: list[str]) -> None:
        self.rules[rule] = {"ok": False, "sentence": sentence, "errors": errors[:40]}

    def pass_(self, rule: str) -> None:
        self.rules.setdefault(rule, {"ok": True})

    @property
    def ok(self) -> bool:
        return all(r.get("ok") for r in self.rules.values())

    @property
    def errors(self) -> list[str]:
        return [e for r in self.rules.values() if not r.get("ok") for e in r.get("errors", [])]

    @property
    def sentence(self) -> Optional[str]:
        for name in sorted(self.rules, key=lambda k: int(k.split("_")[0][1:])):
            if not self.rules[name].get("ok"):
                return self.rules[name]["sentence"]
        return None

    def as_json(self) -> dict[str, Any]:
        return {k: {"ok": v["ok"], **({"sentence": v["sentence"]} if not v["ok"] else {})} for k, v in self.rules.items()}


def _claims(f: dict[str, Any]) -> list[tuple[str, dict[str, Any]]]:
    out = []
    for s in f.get("sections") or []:
        if isinstance(s, dict):
            for c in s.get("claims") or []:
                if isinstance(c, dict):
                    out.append((str(s.get("key")), c))
    return out


def _plural(n: int, one: str, many: str) -> str:
    return f"{n} {one if n == 1 else many}"


def check_shape(f: Any, lang: str, v: Verdict, subjects: set[str]) -> bool:
    errs: list[str] = []
    if not isinstance(f, dict):
        v.fail("r1_shape", "Research finished, but the findings are not a JSON object. Run it again.", ["not an object"])
        return False
    if f.get("schema") != SCHEMA:
        errs.append(f"schema must be {SCHEMA}")
    if f.get("lang") != lang:
        errs.append(f"lang must be {lang}")
    keys = [s.get("key") for s in f.get("sections") or [] if isinstance(s, dict)]
    if keys != list(SECTION_KEYS):
        missing = [k for k in SECTION_KEYS if k not in keys]
        errs.append("sections must be the thirteen keys in order" + (f"; missing {', '.join(missing)}" if missing else ""))
    seen: set[str] = set()
    for s in f.get("sections") or []:
        if not isinstance(s, dict) or not str(s.get("title") or "").strip():
            errs.append(f"section {s.get('key') if isinstance(s, dict) else '?'} has no title")
        if isinstance(s, dict) and not isinstance(s.get("claims"), list):
            errs.append(f"section {s.get('key')} has no claims list")
    for key, c in _claims(f):
        cid = str(c.get("id") or "")
        if not ID.match(cid) or cid in seen:
            errs.append(f"claim id {cid or '(none)'} in {key} is missing, malformed or repeated")
        seen.add(cid)
        if c.get("kind") not in KINDS:
            errs.append(f"claim {cid}: kind must be one of {', '.join(KINDS)}")
        if not str(c.get("text") or "").strip() or len(str(c.get("text"))) > 1500:
            errs.append(f"claim {cid}: text is empty or over 1,500 characters")
        if not isinstance(c.get("evidence", []), list) or not isinstance(c.get("metrics", []), list):
            errs.append(f"claim {cid}: evidence and metrics must be lists")
            continue
        for m in c.get("metrics", []):
            if not isinstance(m, dict) or not re.fullmatch(r"m\d{1,2}", str(m.get("ref") or "")) \
                    or m.get("metric") not in CATALOGUE or m.get("of") not in subjects:
                errs.append(f"claim {cid}: metric reference {m} is not one of the listed metrics")
            elif "{" + m["ref"] + "}" not in str(c.get("text") or ""):
                errs.append(f"claim {cid}: metric {m['ref']} is not placed in the text")
    for comp in f.get("competitors") or []:
        if not isinstance(comp, dict) or not re.fullmatch(r"C\d{1,2}", str(comp.get("cid") or "")):
            errs.append(f"competitor {comp} has no C id")
    if not isinstance(f.get("mysteryShop"), dict):
        errs.append("mysteryShop is missing")
    if lang == "ar":
        labels = f.get("labels") if isinstance(f.get("labels"), dict) else {}
        for k in ("clientClaim", "recommendation", "notChecked", "sources", "evidence"):
            if not str(labels.get(k) or "").strip():
                errs.append(f"labels.{k} is missing")
        if labels and "{date}" not in str(labels.get("clientClaim") or ""):
            errs.append("labels.clientClaim must keep {date}")
    if errs:
        v.fail("r1_shape", f"Research finished, but the {lang} findings do not follow their shape "
                           f"({_plural(len(errs), 'problem', 'problems')}). Run it again.", errs)
        return False
    v.pass_("r1_shape")
    return True


def check(en: Any, ar: Optional[Any], pack: Any, *, competitors: list[dict[str, Any]], presence: dict[str, Any],
          task_id: str, run_id: str) -> Verdict:
    v = Verdict()
    subjects = {"client", "market"} | {c["cid"] for c in competitors}
    if not check_shape(en, "en", v, subjects):
        return v
    if ar is not None and not check_shape(ar, "ar", v, subjects):
        return v
    editions = [("en", en)] + ([("ar", ar)] if ar is not None else [])
    ids, urls = pack.ids(), pack.urls()
    kinds = {e["eid"]: e["kind"] for e in pack.items}

    # 2. evidence
    errs = []
    for lang, f in editions:
        for key, c in _claims(f):
            ev = [x for x in c.get("evidence", []) if isinstance(x, str)]
            if not ev and not (key == "limits" and c.get("kind") == "limit"):
                errs.append(f"{lang} claim {c.get('id')} cites no evidence")
            bad = [x for x in ev if x not in ids]
            if bad:
                errs.append(f"{lang} claim {c.get('id')} cites {', '.join(bad[:5])}, which this run never pulled")
            for u in URL.findall(str(c.get("text") or "")):
                if u.rstrip(".,;") not in urls:
                    errs.append(f"{lang} claim {c.get('id')} names a page this run never opened")
        for comp in f.get("competitors") or []:
            bad = [x for x in comp.get("evidence") or [] if x not in ids]
            if bad:
                errs.append(f"{lang} competitor {comp.get('cid')} cites {', '.join(bad[:5])}, which this run never pulled")
    if errs:
        v.fail("r2_evidence", f"Research finished, but {_plural(len(errs), 'claim cites', 'claims cite')} evidence or "
                              "pages this run never opened. Open the evidence or run it again.", errs)
    else:
        v.pass_("r2_evidence")

    # 3. no numbers in prose
    errs = []
    for lang, f in editions:
        for key, c in _claims(f):
            text = TOKEN.sub("", PLACEHOLDER.sub("", URL.sub("", str(c.get("text") or ""))))
            if key == "plan":
                text = DURATION.sub("", text)
            if DIGIT.search(text):
                errs.append(f"{lang} claim {c.get('id')} types a number; use a metric reference instead")
        for comp in f.get("competitors") or []:
            if DIGIT.search(TOKEN.sub("", str(comp.get("why") or ""))):
                errs.append(f"{lang} competitor {comp.get('cid')}'s reason types a number")
    if errs:
        v.fail("r3_numbers", f"Research finished, but {_plural(len(errs), 'claim types', 'claims type')} a number the "
                             "evidence does not fill. Run it again.", errs)
    else:
        v.pass_("r3_numbers")

    # 4. parity
    if ar is not None:
        def sig(f: dict[str, Any]) -> Any:
            return ([s.get("key") for s in f["sections"]],
                    [(k, c.get("id"), c.get("kind"), tuple(c.get("evidence", [])),
                      tuple(sorted((m.get("ref"), m.get("metric"), m.get("of")) for m in c.get("metrics", []))))
                     for k, c in _claims(f)],
                    sorted(str(c.get("cid")) for c in f.get("competitors") or []))
        a, b = sig(en), sig(ar)
        errs = []
        if a[0] != b[0]:
            errs.append("the sections differ between Arabic and English")
        if a[1] != b[1]:
            only_en = {x[1] for x in a[1]} - {x[1] for x in b[1]}
            only_ar = {x[1] for x in b[1]} - {x[1] for x in a[1]}
            errs.append("the claims differ between Arabic and English"
                        + (f"; only in English: {', '.join(sorted(only_en)[:8])}" if only_en else "")
                        + (f"; only in Arabic: {', '.join(sorted(only_ar)[:8])}" if only_ar else ""))
        if a[2] != b[2]:
            errs.append("the competitors differ between Arabic and English")
        if errs:
            v.fail("r4_parity", "Research finished, but the Arabic and English editions do not carry the same claims. "
                                "Run it again.", errs)
        else:
            v.pass_("r4_parity")

    # 5. minimums
    errs = []
    main = [c for c in competitors if not c.get("reserve")]
    if len(main) < 5:
        errs.append(f"only {len(main)} competitors were picked; at least 5 are needed")
    thin = []
    for c in main:
        kinds_seen = {INDEPENDENT.get(kinds.get(e, ""), "") for e in (c.get("evidence") or [])} | \
                     {INDEPENDENT.get(e["kind"], "") for e in pack.of(c["cid"])}
        kinds_seen.discard("")
        kinds_seen.discard("search")
        if len(kinds_seen) < 2:
            thin.append(c["cid"])
    if thin:
        errs.append(f"{', '.join(thin)} rest on one kind of source; each competitor needs two (Maps and a site, a page or ads)")
    if len(pack.items) < 20:
        errs.append(f"only {len(pack.items)} evidence items; at least 20 are needed")
    checked = [ch for ch in CHANNELS if (presence.get(ch) or {}).get("state") in ("found", "none_found")]
    if len(checked) < 4:
        errs.append(f"the client's presence was checked on {len(checked)} of 6 channels; at least 4 are needed")
    if errs:
        v.fail("r5_minimums", "Research finished, but it is too thin to use: " + errs[0] + ". Run it again, or check "
                              "the budget and the pulls that failed.", errs)
    else:
        v.pass_("r5_minimums")

    # 6. form answers as the client's claims; no mystery shop
    errs = []
    for lang, f in editions:
        for key, c in _claims(f):
            ev = c.get("evidence", [])
            form_only = bool(ev) and all(kinds.get(e) == "form" for e in ev)
            if form_only and c.get("kind") != "client_claim":
                errs.append(f"{lang} claim {c.get('id')} rests on the form alone but is not marked as the client's claim")
            if c.get("kind") == "client_claim" and not any(kinds.get(e) == "form" for e in ev):
                errs.append(f"{lang} claim {c.get('id')} is marked as the client's claim but does not cite the form")
        if (f.get("mysteryShop") or {}).get("speed") is not None:
            errs.append(f"{lang} mysteryShop.speed is set; nobody was called or messaged")
    if errs:
        v.fail("r6_client_claims", "Research finished, but it presents the client's own answers as checked facts, or "
                                   "invents a mystery shop. Run it again.", errs)
    else:
        v.pass_("r6_client_claims")

    # 7. no contact data, no internal ids
    errs = []
    for lang, f in editions:
        texts = [(c.get("id"), str(c.get("text") or "")) for _, c in _claims(f)]
        texts += [(comp.get("cid"), str(comp.get("why") or "")) for comp in f.get("competitors") or []]
        texts += [(s.get("key"), str(s.get("title") or "")) for s in f.get("sections") or []]
        for who, t in texts:
            if EMAIL.search(t):
                errs.append(f"{lang} {who} carries an email address")
            if UUID.search(t) or (task_id and task_id in t) or (run_id and run_id in t) or "cockpit ref" in t.lower():
                errs.append(f"{lang} {who} carries an internal id")
            if re.search(r"(?:\+|00)\d[\d\s-]{6,}", t):
                errs.append(f"{lang} {who} carries a phone number")
    if errs:
        v.fail("r7_privacy", "Research finished, but the findings carry a phone, an email or an internal id. "
                             "Run it again.", errs)
    else:
        v.pass_("r7_privacy")

    # 8. recommendations labelled
    errs = []
    for lang, f in editions:
        for key, c in _claims(f):
            if key in RECOMMEND and c.get("kind") != "recommendation":
                errs.append(f"{lang} claim {c.get('id')} in {key} is not marked as a recommendation")
            if key not in RECOMMEND + ("summary",) and c.get("kind") == "recommendation":
                errs.append(f"{lang} claim {c.get('id')} in {key} is a recommendation outside the recommendation sections")
    if errs:
        v.fail("r8_recommendations", "Research finished, but a recommendation is not labelled as one. Run it again.", errs)
    else:
        v.pass_("r8_recommendations")
    return v
