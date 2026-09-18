"""Trends: the same format showing up on several accounts in the same weeks.

Aziz, 2026-09-17: "flag trends". A single outlier is one account's luck; the
same format from three accounts in a fortnight is a wave the creative
director can ride. The scan cannot watch every proposal in full, so each
row gets a short FORMAT descriptor from a text model reading what the row
already carries (caption, storyboard still, and for captured ideas the hook,
structure and transcript), the descriptor is embedded, and rows whose
descriptors sit close together with enough distinct authors become a trend.

Columns on ideation_posts: format_label, hook_kind, topic, format_vec
(256 floats), trend_id, trend_label, trend_n, trend_at. The cockpit shows
a Trend chip and a Trends tab; the Slack digest lists them.

Every step is bounded: at most `trend_max_describe` descriptors per run, one
embedding call per batch, and the clustering is plain cosine over a few
hundred rows in memory. Nothing here can fail the scan; errors are logged
and reported in the summary.
"""
from __future__ import annotations

import hashlib
import math
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Optional

from . import http
from .config import Config
from .supabase import Supabase, now_iso

GEMINI = "https://generativelanguage.googleapis.com"
HOOK_KINDS = ["question", "bold claim", "pattern interrupt", "before after", "number", "story open", "callout", "demonstration", "list", "other"]
DESCRIBE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "format_label": {"type": "string"},
        "hook_kind": {"type": "string", "enum": HOOK_KINDS},
        "topic": {"type": "string"},
    },
    "required": ["format_label", "hook_kind", "topic"],
}
ACTIVE_STATUSES = ("proposed", "queued", "fetching", "saved")
SELECT = "key,author_handle,platform,status,at,posted_at,caption,hook,format,on_screen_text,transcript,format_label,hook_kind,topic,format_vec,trend_id,trend_label,trend_n,still_path"


def describe_prompt(row: dict[str, Any]) -> str:
    hook = row.get("hook") if isinstance(row.get("hook"), dict) else {}
    osd = row.get("on_screen_text") if isinstance(row.get("on_screen_text"), list) else []
    osd_txt = " / ".join(str(o.get("text")) for o in osd[:6] if isinstance(o, dict) and o.get("text"))
    known = []
    if row.get("format"):
        known.append(f"format (from a full watch): {row['format']}")
    if hook.get("text"):
        known.append(f"hook (quoted): {str(hook.get('text'))[:300]} [{hook.get('type') or ''}]")
    if osd_txt:
        known.append(f"on-screen text: {osd_txt[:600]}")
    tr = str(row.get("transcript") or "")[:500]
    if tr:
        known.append(f"spoken (first words): {tr}")
    cap = str(row.get("caption") or "")[:700]
    if cap:
        known.append(f"caption: {cap}")
    return f"""You are labelling one short social video for a creative director who collects posts that outperformed, to spot the same FORMAT recurring across accounts.

Return ONLY JSON with three fields:
- format_label: 6 to 12 English words naming the FORMAT, meaning what kind of video it is and how it is built, not its subject. Examples: "before after renovation reveal with text overlay", "talking head listing three mistakes to camera", "silent CGI walkthrough of a villa with captions", "pov handheld tour with voiceover and price on screen". Two videos of the same kind must get near-identical labels even when their subjects differ.
- hook_kind: one of {', '.join(HOOK_KINDS)}.
- topic: 2 to 4 English words on the subject (e.g. "kitchen renovation", "villa exterior").

Use the storyboard image when given (three frames: start, middle, end) and these facts. Invent nothing. No em dashes.

{chr(10).join(known) if known else '(no text available; label from the image only, or say "unknown format")'}"""


def describe(cfg: Config, row: dict[str, Any], image: Optional[bytes], log: Callable[[str], None]) -> dict[str, Any]:
    """One short descriptor per row: a text plus image call, cents at most.

    Gemini first; when it is out of quota or down (429, 503 seen 2026-09-18)
    OpenAI reads the same prompt and storyboard; DeepSeek reads the text alone.
    """
    import base64

    from .understand import gemini_generate, parse_json, text_model_json  # lazy: keeps trends importable without models

    prompt = describe_prompt(row)
    result: Optional[dict[str, Any]] = None
    errors: list[str] = []
    if cfg.gemini_key:
        parts: list[dict[str, Any]] = [{"text": prompt}]
        if image:
            parts.append({"inline_data": {"mime_type": "image/jpeg", "data": base64.b64encode(image).decode("ascii")}})
        try:
            result, _usage = gemini_generate(cfg, cfg.gemini_text_model, parts, DESCRIBE_SCHEMA, temperature=0.1)
        except (http.HttpError, ValueError, KeyError) as e:
            errors.append(f"gemini: {http.scrub(str(e))[:120]}")
    if result is None and cfg.openai_key:
        content: list[dict[str, Any]] = [{"type": "text", "text": prompt + '\nReturn exactly {"format_label": string, "hook_kind": string, "topic": string}.'}]
        if image:
            content.append({"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{base64.b64encode(image).decode('ascii')}", "detail": "low"}})
        try:
            out = http.post_json(
                "https://api.openai.com/v1/chat/completions",
                {"model": cfg.openai_vision_model, "messages": [{"role": "user", "content": content}], "response_format": {"type": "json_object"}, "temperature": 0.1},
                headers={"Authorization": f"Bearer {cfg.openai_key}"},
                timeout=120,
                retries=1,
            )
            result = parse_json(out["choices"][0]["message"]["content"])
        except (http.HttpError, ValueError, KeyError) as e:
            errors.append(f"openai: {http.scrub(str(e))[:120]}")
    if result is None:
        try:
            raw, _method = text_model_json(cfg, prompt + '\nReturn exactly {"format_label": string, "hook_kind": string, "topic": string}.', log)
            result = raw if isinstance(raw, dict) else parse_json(str(raw))
        except (http.HttpError, ValueError, KeyError) as e:
            errors.append(f"text: {http.scrub(str(e))[:120]}")
    if not isinstance(result, dict):
        raise http.HttpError(0, "no model could describe the row: " + "; ".join(errors)[:300])
    label = str(result.get("format_label") or "").strip()[:120]
    kind = result.get("hook_kind") if result.get("hook_kind") in HOOK_KINDS else "other"
    topic = str(result.get("topic") or "").strip()[:60]
    if not label:
        raise ValueError("no format label")
    return {"format_label": label, "hook_kind": kind, "topic": topic}


def descriptor_text(row: dict[str, Any]) -> str:
    return f"{row.get('format_label') or ''}. Hook: {row.get('hook_kind') or 'other'}. Topic: {row.get('topic') or ''}".strip()


def embed(cfg: Config, texts: list[str]) -> list[list[float]]:
    """Gemini embeddings (256 dims, semantic similarity); OpenAI when Gemini has no key, no quota or is down.

    The two models' spaces differ, so a row's provider is part of the vector
    (first element flags it) and rows from different providers never compare.
    """
    if not texts:
        return []
    gemini_error = ""
    if cfg.gemini_key:
        body = {
            "requests": [
                {"model": f"models/{cfg.embed_model}", "content": {"parts": [{"text": t}]}, "taskType": "SEMANTIC_SIMILARITY", "outputDimensionality": cfg.embed_dims}
                for t in texts
            ]
        }
        try:
            out = http.post_json(f"{GEMINI}/v1beta/models/{cfg.embed_model}:batchEmbedContents?key={cfg.gemini_key}", body, timeout=120, retries=2)
            vecs = [list(map(float, e.get("values") or [])) for e in (out.get("embeddings") or [])]
            if len(vecs) == len(texts):
                return [[1.0] + v for v in vecs]
            gemini_error = f"got {len(vecs)} for {len(texts)} texts"
        except (http.HttpError, ValueError, KeyError) as e:
            gemini_error = http.scrub(str(e))[:120]
    if cfg.openai_key:
        out = http.post_json(
            "https://api.openai.com/v1/embeddings",
            {"model": cfg.openai_embed_model, "input": texts, "dimensions": cfg.embed_dims},
            headers={"Authorization": f"Bearer {cfg.openai_key}"},
            timeout=120,
            retries=2,
        )
        data = sorted(out.get("data") or [], key=lambda d: d.get("index", 0))
        return [[2.0] + list(map(float, d.get("embedding") or [])) for d in data]
    raise http.HttpError(0, f"no embedding model available (GOOGLE_AI_API_KEY or OPENAI_API_KEY): {gemini_error}")


def cosine(a: list[float], b: list[float]) -> float:
    """Cosine over the vector body; the first element names the provider and must match."""
    if not a or not b or len(a) != len(b) or a[0] != b[0]:
        return 0.0
    a, b = a[1:], b[1:]
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    return dot / (na * nb) if na and nb else 0.0


def cluster(rows: list[dict[str, Any]], *, threshold: float, min_authors: int) -> list[dict[str, Any]]:
    """Connected components over cosine >= threshold; keep those with enough distinct authors.

    Returns [{"keys": [...], "authors": n, "medoid": key, "existing": most common trend_id or None}].
    """
    idx = [i for i, r in enumerate(rows) if isinstance(r.get("format_vec"), list) and r["format_vec"]]
    parent = {i: i for i in idx}

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    sims: dict[tuple[int, int], float] = {}
    for a in range(len(idx)):
        for b in range(a + 1, len(idx)):
            i, j = idx[a], idx[b]
            s = cosine(rows[i]["format_vec"], rows[j]["format_vec"])
            sims[(i, j)] = s
            if s >= threshold:
                parent[find(i)] = find(j)
    groups: dict[int, list[int]] = {}
    for i in idx:
        groups.setdefault(find(i), []).append(i)
    out: list[dict[str, Any]] = []
    for members in groups.values():
        authors = {str(rows[i].get("author_handle") or "").lower() for i in members}
        authors.discard("")
        if len(authors) < min_authors:
            continue
        # The medoid names the trend: the member closest to all the others.
        def mean_sim(i: int) -> float:
            others = [sims.get((min(i, j), max(i, j)), 0.0) for j in members if j != i]
            return sum(others) / len(others) if others else 0.0

        medoid = max(members, key=mean_sim)
        ids = [rows[i].get("trend_id") for i in members if rows[i].get("trend_id")]
        existing = max(set(ids), key=ids.count) if ids else None
        out.append({"keys": [rows[i]["key"] for i in members], "authors": len(authors), "medoid": rows[medoid]["key"], "existing": existing, "label": rows[medoid].get("format_label") or ""})
    out.sort(key=lambda g: (-g["authors"], g["label"]))
    return out


def trend_id_for(label: str, when: datetime) -> str:
    h = hashlib.sha1(label.lower().encode("utf-8")).hexdigest()[:6]
    return f"t{when.strftime('%Y%m%d')}-{h}"


def detect(
    cfg: Config,
    sb: Supabase,
    log: Callable[[str], None],
    *,
    now: Optional[datetime] = None,
    describe_fn: Callable[..., dict[str, Any]] = describe,
    embed_fn: Callable[..., list[list[float]]] = embed,
    image_fn: Optional[Callable[[str], Optional[bytes]]] = None,
) -> dict[str, Any]:
    """Describe, embed and cluster the active rows of the last window. Idempotent."""
    now = now or datetime.now(timezone.utc)
    cutoff = (now - timedelta(days=cfg.trend_window_days)).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    statuses = ",".join(f'"{s}"' for s in ACTIVE_STATUSES)
    rows = sb.select(sb.table, f"select={SELECT}&status=in.({statuses})&at=gte.{cutoff}&order=at.desc&limit=400")
    summary: dict[str, Any] = {"rows": len(rows), "described": 0, "embedded": 0, "trends": [], "errors": []}
    if not rows:
        return summary
    image_fn = image_fn or (lambda path: _still_bytes(sb, path))

    # 1. descriptors for rows that have none (bounded)
    todo = [r for r in rows if not r.get("format_label")][: cfg.trend_max_describe]
    for r in todo:
        try:
            img = image_fn(r["still_path"]) if r.get("still_path") else None
            d = describe_fn(cfg, r, img, log)
            r.update(d)
            sb.patch(sb.table, f"key=eq.{http.quote_key(r['key'])}", {**d, "updated_at": now_iso()})
            summary["described"] += 1
        except Exception as e:  # noqa: BLE001 - one bad row must not stop the rest
            summary["errors"].append(f"describe {r.get('key')}: {http.scrub(str(e))[:160]}")
    # 2. vectors for rows that have a descriptor but no vector
    need = [r for r in rows if r.get("format_label") and not r.get("format_vec")]
    for i in range(0, len(need), 50):
        chunk = need[i : i + 50]
        try:
            vecs = embed_fn(cfg, [descriptor_text(r) for r in chunk])
            for r, v in zip(chunk, vecs):
                r["format_vec"] = v
                sb.patch(sb.table, f"key=eq.{http.quote_key(r['key'])}", {"format_vec": v, "updated_at": now_iso()})
                summary["embedded"] += 1
        except Exception as e:  # noqa: BLE001
            summary["errors"].append(f"embed: {http.scrub(str(e))[:160]}")
            break
    # 3. clusters
    groups = cluster(rows, threshold=cfg.trend_similarity, min_authors=cfg.trend_min_authors)
    in_trend: set[str] = set()
    stamp = now_iso()
    for g in groups:
        tid = g["existing"] or trend_id_for(g["label"], now)
        label = g["label"][:120]
        by_key = {r["key"]: r for r in rows}
        for k in g["keys"]:
            in_trend.add(k)
            r = by_key[k]
            if r.get("trend_id") != tid or r.get("trend_label") != label or r.get("trend_n") != g["authors"]:
                try:
                    sb.patch(sb.table, f"key=eq.{http.quote_key(k)}", {"trend_id": tid, "trend_label": label, "trend_n": g["authors"], "trend_at": stamp, "updated_at": stamp})
                except Exception as e:  # noqa: BLE001
                    summary["errors"].append(f"trend patch {k}: {http.scrub(str(e))[:120]}")
        authors = sorted({str(by_key[k].get("author_handle") or "") for k in g["keys"]} - {""})
        summary["trends"].append({"id": tid, "label": label, "authors": g["authors"], "handles": authors[:6], "keys": g["keys"]})
    # 4. rows that fell out of a trend inside the window lose the chip
    for r in rows:
        if r.get("trend_id") and r["key"] not in in_trend:
            try:
                sb.patch(sb.table, f"key=eq.{http.quote_key(r['key'])}", {"trend_id": None, "trend_label": None, "trend_n": None, "updated_at": stamp})
            except Exception as e:  # noqa: BLE001
                summary["errors"].append(f"trend clear {r['key']}: {http.scrub(str(e))[:120]}")
    log(f"trends: {len(rows)} rows, {summary['described']} described, {summary['embedded']} embedded, {len(summary['trends'])} trends" + (f", {len(summary['errors'])} errors" if summary["errors"] else ""))
    return summary


def _still_bytes(sb: Supabase, path: str) -> Optional[bytes]:
    try:
        return sb.download_still(path)
    except Exception:  # noqa: BLE001 - the picture is a bonus for the descriptor
        return None


def digest_lines(summary: Optional[dict[str, Any]]) -> list[str]:
    if not summary or not summary.get("trends"):
        return []
    lines = ["Trends (the same format from several accounts in the last two weeks):"]
    for t in summary["trends"][:5]:
        handles = ", ".join(f"@{h}" for h in t.get("handles", [])[:4])
        lines.append(f"- {t['label']}: {t['authors']} accounts ({handles})")
    return lines
