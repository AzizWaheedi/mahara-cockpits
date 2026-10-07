r"""
Harden Snapshot Catch-Up Data Import Tool.

Reads production snapshots from explicit CLI archive paths and reconciles into Supabase.
Default: DRY_RUN = True.
Writes are executed only in --apply mode with reviewed plan SHA and source hash verification.
Project URL is strictly bound to Creative Triage fixed project (bldgtotkfmhoxmlzowdx.supabase.co).
"""

import argparse
import hashlib
import json
import os
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

FIXED_PROJECT_REF = "bldgtotkfmhoxmlzowdx"
DEFAULT_PROJECT_URL = f"https://{FIXED_PROJECT_REF}.supabase.co"

MAPPED_TABLES_BY_ARCHIVE = {
    "media_buyer": {"members", "checks", "feedback", "eodReports", "campaigns", "ads", "decisions"},
    "client_success": {"checks", "feedback", "decisions", "clientProfiles"},
    "creative_director": set(),  # CD tables currently unmapped
}


def ms_to_iso(ms: Optional[int]) -> Optional[str]:
    if ms is None:
        return None
    try:
        return datetime.fromtimestamp(ms / 1000.0, timezone.utc).isoformat()
    except Exception:
        return None


def compute_sha256(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as f:
        while chunk := f.read(65536):
            hasher.update(chunk)
    return hasher.hexdigest()


def compute_content_sha256(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def validate_project_url(project_url: str) -> str:
    if not project_url:
        return DEFAULT_PROJECT_URL
    parsed = urllib.parse.urlparse(project_url)
    hostname = (parsed.netloc or parsed.path).lower().split(":")[0]
    expected_hostname = f"{FIXED_PROJECT_REF}.supabase.co".lower()
    if hostname != expected_hostname or project_url.rstrip("/") != DEFAULT_PROJECT_URL:
        raise ValueError(
            f"Project URL '{project_url}' rejected! Project URL is strictly bound to Creative Triage fixed "
            f"'{DEFAULT_PROJECT_URL}' (expected host '{expected_hostname}', got '{hostname}')."
        )
    return DEFAULT_PROJECT_URL


def is_subpath(child: Path, parent: Path) -> bool:
    try:
        child.resolve().relative_to(parent.resolve())
        return True
    except ValueError:
        return False


def ensure_outside_repo(path: Path) -> Path:
    resolved = path.resolve()
    repo_root = Path(__file__).resolve().parent.parent.resolve()
    if is_subpath(resolved, repo_root):
        raise ValueError(
            f"Protected plan file must be saved OUTSIDE the repository ({repo_root}), but got path inside repo: {resolved}"
        )
    return resolved


def get_archive_tables(zip_path: Path) -> Set[str]:
    tables = set()
    with zipfile.ZipFile(zip_path, "r") as zf:
        for name in zf.namelist():
            parts = name.split("/")
            if len(parts) >= 2 and parts[-1] == "documents.jsonl":
                tables.add(parts[0])
    return tables


def read_jsonl_from_zip(zip_path: Path, table_name: str) -> List[Dict[str, Any]]:
    docs: List[Dict[str, Any]] = []
    filename = f"{table_name}/documents.jsonl"
    with zipfile.ZipFile(zip_path, "r") as zf:
        names = zf.namelist()
        if filename not in names:
            raise KeyError(f"Required table '{table_name}' ({filename}) not found in archive {zip_path}")
        with zf.open(filename) as f:
            for line_no, raw_line in enumerate(f, start=1):
                line = raw_line.strip()
                if not line:
                    continue
                try:
                    doc = json.loads(line.decode("utf-8"))
                except Exception as err:
                    raise ValueError(
                        f"Malformed JSON row in {zip_path} [{table_name}] line {line_no}: {err}"
                    ) from err
                if not isinstance(doc, dict) or "_id" not in doc:
                    raise ValueError(
                        f"Malformed row (missing '_id' or non-object) in {zip_path} [{table_name}] line {line_no}"
                    )
                docs.append(doc)
    return docs


def fetch_rest_paginated(
    project_url: str,
    headers: Dict[str, str],
    table: str,
    select: str = "*",
    page_size: int = 1000,
) -> List[Dict[str, Any]]:
    records: List[Dict[str, Any]] = []
    offset = 0
    while True:
        query = urllib.parse.urlencode({"select": select, "limit": page_size, "offset": offset})
        url = f"{project_url}/rest/v1/{table}?{query}"
        req = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(req) as resp:
                chunk = json.load(resp)
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"REST GET {table} failed (HTTP {e.code}): {err_body}") from e

        if not chunk:
            break
        records.extend(chunk)
        if len(chunk) < page_size:
            break
        offset += page_size
    return records


def post_rest_insert(
    project_url: str,
    headers: Dict[str, str],
    table: str,
    rows: List[Dict[str, Any]],
    return_representation: bool = False,
) -> List[Dict[str, Any]]:
    if not rows:
        return []
    url = f"{project_url}/rest/v1/{table}"
    req_headers = dict(headers)
    req_headers["Prefer"] = "return=representation" if return_representation else "return=minimal"
    data = json.dumps(rows).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=req_headers, method="POST")
    try:
        with urllib.request.urlopen(req) as resp:
            body = resp.read()
            if return_representation and body:
                return json.loads(body.decode("utf-8"))
            return []
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"REST POST {table} failed (HTTP {e.code}): {err_body}") from e


def values_match(planned_val: Any, actual_val: Any) -> bool:
    if planned_val == actual_val:
        return True
    if planned_val is None or actual_val is None:
        return planned_val is actual_val

    # Numeric normalization (float vs int or close precision)
    try:
        if isinstance(planned_val, (int, float)) and isinstance(actual_val, (int, float, str)):
            return abs(float(planned_val) - float(actual_val)) < 1e-9
    except Exception:
        pass

    # Timestamp normalization
    if isinstance(planned_val, str) and isinstance(actual_val, str):
        try:
            p_dt = datetime.fromisoformat(planned_val.replace("Z", "+00:00"))
            a_dt = datetime.fromisoformat(actual_val.replace("Z", "+00:00"))
            return p_dt == a_dt
        except Exception:
            pass

    # Dict or list JSON equivalence
    if isinstance(planned_val, (dict, list)) and isinstance(actual_val, (dict, list)):
        try:
            return json.dumps(planned_val, sort_keys=True) == json.dumps(actual_val, sort_keys=True)
        except Exception:
            pass

    return False


def verify_record_match(planned: Dict[str, Any], actual: Dict[str, Any]) -> Tuple[bool, Optional[str]]:
    for k, planned_v in planned.items():
        if k not in actual:
            return False, f"Missing key '{k}' in readback target record"
        if not values_match(planned_v, actual[k]):
            return False, f"Value mismatch for '{k}'; compare protected plan with stored record"
    return True, None


def get_record_filter(table: str, row: Dict[str, Any]) -> str:
    if "source_deployment" in row and "source_id" in row:
        return urllib.parse.urlencode({
            "source_deployment": f"eq.{row['source_deployment']}",
            "source_id": f"eq.{row['source_id']}",
        })
    elif "email" in row:
        return urllib.parse.urlencode({"email": f"eq.{row['email']}"})
    elif "client_name" in row:
        return urllib.parse.urlencode({"client_name": f"eq.{row['client_name']}"})
    elif "source_id" in row:
        return urllib.parse.urlencode({"source_id": f"eq.{row['source_id']}"})
    else:
        raise RuntimeError(f"Cannot identify unique verification key for row in {table}")


def read_back_record(
    project_url: str,
    headers: Dict[str, str],
    table: str,
    row: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    filter_q = get_record_filter(table, row)
    url = f"{project_url}/rest/v1/{table}?{filter_q}&limit=1"
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req) as resp:
            data = json.load(resp)
            if data and len(data) > 0:
                return data[0]
            return None
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Readback GET {table} failed (HTTP {e.code}): {err_body}") from e



CAMPAIGN_FIELDS = {"client_name": None, "meta_account_id":"metaAccountId", "meta_campaign_id":"metaCampaignId", "task_id":"taskId", "task_url":"taskUrl", "service_mode":"serviceMode", "verdict":"verdict", "reason":"reason", "rank":"rank", "spend_7d":"spend7d", "spend_today":"spendToday", "leads_7d":"leads7d", "leads_today":"leadsToday", "cpl":"cpl", "frequency":"frequency", "link_ctr":"linkCtr", "opt_in_rate":"optInRate"}
AD_FIELDS = {"campaign_name":"campaignName", "ad_name":"adName", "meta_ad_id":"metaAdId", "verdict":"verdict", "reason":"reason", "spend":"spend", "leads":"leads", "frequency":"frequency", "still_url":"stillUrl", "thumbnail_url":"thumbnailUrl"}


RAW_SOURCE_KEYS = {'cockpit_campaigns': ['_id', '_creationTime', 'campaignName', 'accountName', 'accountIssue', 'clientName', 'taskId', 'taskUrl', 'adStatus', 'onBoard', 'internal', 'currency', 'spend7d', 'spendToday', 'leadsToday', 'dataThrough', 'lost', 'leads7d', 'cpl', 'impressions7d', 'linkClicks7d', 'linkCtr', 'cpm', 'optInRate', 'frequency', 'dayRate', 'medianDayRate', 'contractedBudget', 'budgetLevel', 'budgetDaily', 'budgetLifetime', 'firstSpend', 'daysLive', 'staleTaskName', 'diagnosis', 'findings', 'daysSinceTouch', 'lastChangeAt', 'clientTag', 'tags', 'serviceType', 'serviceMode', 'priority', 'boardAdStatus', 'advertisingCities', 'cplStatus', 'cpbStatus', 'showed7d', 'costPerBooking', 'bookingRate', 'showRate', 'hasGhl', 'metaAccountId', 'metaCampaignId', 'bookings7d', 'verdict', 'reason', 'rank', 'syncedAt'], 'cockpit_ads': ['_id', '_creationTime', 'campaignName', 'adName', 'spend', 'leads', 'cpl', 'linkCtr', 'cpm', 'optInRate', 'frequency', 'thumbnailUrl', 'previewSrc', 'metaAdId', 'stillKey', 'stillUrl', 'stillTinyUrl', 'verdict', 'reason', 'syncedAt']}

def mapped_mirror(table, source, deployment, clients=None):
    fields = CAMPAIGN_FIELDS if table == "cockpit_campaigns" else AD_FIELDS
    row = {column: source.get(key) for column, key in fields.items() if key}
    if table == "cockpit_campaigns":
        client = source.get("clientName") or source.get("accountName")
        row["client_name"] = client
        row["client_id"] = (clients or {}).get(str(client).lower()) if client else None
    row.update(synced_at=ms_to_iso(source.get("syncedAt", source.get("_creationTime"))), raw_data=source,
               source_system="convex", source_deployment=deployment, source_id=source["_id"], source_deleted=False, source_deleted_at=None)
    return row


def mirror_identity(table, row):
    raw = row.get("raw_data") or {}
    meta = row.get("meta_campaign_id" if table == "cockpit_campaigns" else "meta_ad_id")
    account = row.get("meta_account_id") or raw.get("metaAccountId") or raw.get("accountName")
    account = str(account).strip().removeprefix("act_") if account else None
    keys = []
    if meta: keys.append(("meta", str(meta)))
    if account:
        if table == "cockpit_campaigns":
            task = row.get("task_id") or raw.get("taskId")
            if task: keys.append(("task", account, str(task)))
            name = raw.get("campaignName")
            if name: keys.append(("name", account, str(name)))
        elif raw.get("campaignName") and raw.get("adName"):
            keys.append(("name", account, str(raw["campaignName"]), str(raw["adName"])))
    return keys


def reconcile_mirrors(table, sources, targets, deployment, clients=None, snapshot_evidence=None):
    """Review-only stable matching. Never treats regenerated Convex ids as identity."""
    entries, conflicts, unchanged = [], [], 0
    claimed, source_keys = set(), set()
    for source in sources:
        row = mapped_mirror(table, source, deployment, clients)
        keys = mirror_identity(table, row)
        try:
            if not keys: raise ValueError("No stable Meta id or explicit account/name identity")
            if keys[0] in source_keys: raise ValueError("Duplicate logical identity in source snapshot")
            source_keys.add(keys[0])
            candidates = []
            matched_key = None
            for key in keys:
                candidates = [t for t in targets if key in mirror_identity(table, t)]
                if candidates: matched_key = key; break
            if len(candidates) > 1: raise ValueError("Ambiguous target identity; no duplicates will be merged")
            target = candidates[0] if candidates else None
            if target:
                if target.get("id") in claimed: raise ValueError("Multiple source rows match the same target")
                claimed.add(target.get("id"))
                if target.get("source_system") != "convex" or target.get("source_deployment") != deployment:
                    raise ValueError("Target is not owned by this source deployment")
                old_meta = target.get("meta_campaign_id" if table == "cockpit_campaigns" else "meta_ad_id")
                new_meta = row.get("meta_campaign_id" if table == "cockpit_campaigns" else "meta_ad_id")
                if old_meta and new_meta and old_meta != new_meta: raise ValueError("Fallback identity conflicts with existing Meta id")
                old_raw = target.get("raw_data") or {}
                if not old_raw.get("_id"): raise ValueError("Target lacks original source JSON; human ownership cannot be checked")
                old = mapped_mirror(table, old_raw, deployment)
                # Detect human changes to source-owned normalized fields. Keep every unrelated SQL column/FK.
                for column in (CAMPAIGN_FIELDS if table == "cockpit_campaigns" else AD_FIELDS):
                    actual, original = target.get(column), old.get(column)
                    legacy_name = column == "client_name" and actual == old_raw.get("campaignName")
                    legacy_zero = original is None and actual == 0 and column in ("spend_7d","spend_today","leads_7d","leads_today","spend","leads")
                    if not values_match(actual, original) and not legacy_name and not legacy_zero:
                        raise ValueError(f"Human or untracked change in target field {column}; preserve for review")
                for key in set(source) & set(old_raw):
                    if key not in RAW_SOURCE_KEYS[table] and source[key] != old_raw[key]:
                        raise ValueError(f"Untracked raw JSON field {key} changed; preserve for review")
                row.pop("client_id", None)
                row["raw_data"] = {**{k:v for k,v in old_raw.items() if k not in RAW_SOURCE_KEYS[table]}, **source}
                different = any(not values_match(value, target.get(key)) for key, value in row.items())
                if not different: unchanged += 1; continue
                incoming_at = row.get("synced_at")
                if not incoming_at: raise ValueError("Source timestamp missing; cannot order updates")
                incoming_time = datetime.fromisoformat(incoming_at.replace("Z", "+00:00"))
                for key in ("synced_at", "updated_at"):
                    if target.get(key) and datetime.fromisoformat(target[key].replace("Z", "+00:00")) > incoming_time:
                        raise ValueError(f"Target {key} is newer than the incoming source")
            else:
                if not row.get("synced_at"): raise ValueError("Source timestamp missing")
                if table == "cockpit_campaigns" and not row.get("client_name"): raise ValueError("Source clientName/accountName missing")
                if table == "cockpit_ads" and (not row.get("campaign_name") or not row.get("ad_name")): raise ValueError("Source campaign/ad name missing")
            entries.append({"table":table,"operation":"update" if target else "insert","identity":list(matched_key or keys[0]),"expected":target,"after":row,"source_json":source})
        except (ValueError, TypeError) as error:
            conflicts.append({"table":table,"source_id":source.get("_id"),"reason":str(error)})
    # Retire only a proven full table snapshot, never a filtered/empty/partly invalid feed.
    absent = [t for t in targets if t.get("id") not in claimed and not t.get("source_deleted")
              and t.get("source_system") == "convex" and t.get("source_deployment") == deployment]
    if absent and not conflicts:
        if not sources or not snapshot_evidence or not snapshot_evidence.get("complete"):
            conflicts.append({"table":table,"reason":"Cannot retire absent rows without complete nonempty snapshot evidence"})
        else:
            for target in absent:
                try:
                    raw = target.get("raw_data") or {}
                    if not raw.get("_id") or not mirror_identity(table,target): raise ValueError("Absent row has no original source identity")
                    original = mapped_mirror(table,raw,deployment)
                    for column in (CAMPAIGN_FIELDS if table == "cockpit_campaigns" else AD_FIELDS):
                        actual,value=target.get(column),original.get(column)
                        legacy_name=column=="client_name" and actual==raw.get("campaignName")
                        legacy_zero=value is None and actual==0 and column in ("spend_7d","spend_today","leads_7d","leads_today","spend","leads")
                        if not values_match(actual,value) and not legacy_name and not legacy_zero: raise ValueError(f"Human change in absent row field {column}; cannot retire")
                    exported=datetime.fromisoformat(snapshot_evidence["exported_at"].replace("Z","+00:00"))
                    if any(target.get(k) and datetime.fromisoformat(target[k].replace("Z","+00:00"))>exported for k in ("synced_at","updated_at")):
                        raise ValueError("Absent target is newer than the full snapshot")
                    entries.append({"table":table,"operation":"retire","identity":mirror_identity(table,target)[0],"expected":target,"after":{"source_deleted":True},"source_json":raw,
                        "snapshot":{**snapshot_evidence,"deployment":deployment,"source_count":len(sources),"records":sources}})
                except (ValueError,KeyError,TypeError) as error:
                    conflicts.append({"table":table,"source_id":target.get("source_id"),"reason":str(error)})
    return entries, conflicts, unchanged


def post_reconcile(project_url, headers, entry, plan_sha, apply=False):
    body = {"p_table":entry["table"],"p_expected":entry["expected"],"p_after":entry["after"],"p_source":entry["source_json"],"p_plan_sha":plan_sha,"p_apply":apply}
    rpc = "cockpit_reconcile_snapshot"
    if entry["operation"] == "retire":
        rpc = "cockpit_retire_snapshot"
        body = {"p_table":entry["table"],"p_expected":entry["expected"],"p_snapshot":entry["snapshot"],"p_plan_sha":plan_sha,"p_apply":apply}
    request = urllib.request.Request(f"{project_url}/rest/v1/rpc/{rpc}", data=json.dumps(body).encode(), headers=headers, method="POST")
    with urllib.request.urlopen(request) as response:
        return json.loads(response.read().decode())


def plan_snapshot_catchup(
    mb_zip: Path,
    cs_zip: Path,
    cd_zip: Path,
    snapshot_ts: str,
    mb_dep: str,
    cs_dep: str,
    cd_dep: str,
    project_url: str,
    service_key: str,
    plan_path: Optional[Path] = None,
) -> Tuple[Dict[str, Any], str, Path]:
    project_url = validate_project_url(project_url)

    for p, label in [(mb_zip, "Media Buyer"), (cs_zip, "Client Success"), (cd_zip, "Creative Director")]:
        if not p.is_file():
            raise FileNotFoundError(f"{label} archive path does not exist: {p}")

    source_hashes = {
        "media_buyer": {"path": str(mb_zip.resolve()), "sha256": compute_sha256(mb_zip)},
        "client_success": {"path": str(cs_zip.resolve()), "sha256": compute_sha256(cs_zip)},
        "creative_director": {"path": str(cd_zip.resolve()), "sha256": compute_sha256(cd_zip)},
    }

    archive_tables = {
        "media_buyer": get_archive_tables(mb_zip),
        "client_success": get_archive_tables(cs_zip),
        "creative_director": get_archive_tables(cd_zip),
    }

    coverage_report = {}
    has_unmapped = False
    for arch_key, found_tables in archive_tables.items():
        mapped = sorted(list(found_tables & MAPPED_TABLES_BY_ARCHIVE[arch_key]))
        unmapped = sorted(list(found_tables - MAPPED_TABLES_BY_ARCHIVE[arch_key]))
        if unmapped:
            has_unmapped = True
        coverage_report[arch_key] = {
            "all_tables": sorted(list(found_tables)),
            "mapped_tables": mapped,
            "unmapped_tables": unmapped,
        }

    coverage_meta = {
        "status": "PARTIAL_COVERAGE_CATCHUP",
        "full_migration_supported": False,
        "refusal_reason": (
            "Refuse unsupported partial coverage as full migration: this script only supports bounded "
            "catch-up for mapped tables. Unmapped source tables exist and cannot be fully migrated."
            if has_unmapped
            else "Bounded catch-up run."
        ),
        "archives": coverage_report,
    }

    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
    }

    planned_inserts: Dict[str, List[Dict[str, Any]]] = {
        "cockpit_members": [],
        "cockpit_daily_checks": [],
        "cockpit_issue_reports": [],
        "cockpit_eod_reports": [],
        "cockpit_campaigns": [],
        "cockpit_ads": [],
        "cockpit_decisions": [],
        "cockpit_client_profiles": [],
    }

    # 1. Members
    existing_members = {
        m["email"].lower(): m
        for m in fetch_rest_paginated(project_url, headers, "cockpit_members", "email")
        if m.get("email")
    }
    mb_members = read_jsonl_from_zip(mb_zip, "members")
    for m in mb_members:
        email = m.get("email", "").strip().lower()
        if not email:
            continue
        if email not in existing_members:
            row = {
                "email": email,
                "name": m.get("name"),
                "roles": m.get("roles", []),
                "clients": m.get("clients", []),
                "active": True,
            }
            planned_inserts["cockpit_members"].append(row)
            existing_members[email] = row

    # 2. Daily Checks
    existing_checks_source = {
        (c.get("source_deployment"), c.get("source_id")): c
        for c in fetch_rest_paginated(project_url, headers, "cockpit_daily_checks", "source_deployment,source_id")
        if c.get("source_deployment") and c.get("source_id")
    }
    existing_logical_checks = {
        (c.get("role"), str(c.get("day")), c.get("check_key")): c
        for c in fetch_rest_paginated(project_url, headers, "cockpit_daily_checks", "role,day,check_key")
        if c.get("role") and c.get("day") and c.get("check_key")
    }
    role_to_owner = {
        "media_buyer": "media-buyer",
        "csm": "client-success",
        "creative": "creative-director",
    }
    for dep_name, z_path in [(mb_dep, mb_zip), (cs_dep, cs_zip)]:
        docs = read_jsonl_from_zip(z_path, "checks")
        for d in docs:
            source_key = (dep_name, d["_id"])
            role = d.get("role")
            if role not in role_to_owner:
                role = "media_buyer" if "adorable" in dep_name else "csm"
            owner_app = role_to_owner[role]
            day = str(d.get("day"))
            check_key = d.get("checkKey") or d.get("key") or ""
            logical_key = (role, day, check_key)

            if source_key not in existing_checks_source and logical_key not in existing_logical_checks:
                done_at = ms_to_iso(d.get("doneAt")) if d.get("done") else None
                source_created = ms_to_iso(d.get("_creationTime"))
                row = {
                    "role": role,
                    "owner_app": owner_app,
                    "day": day,
                    "check_key": check_key,
                    "label": d.get("label", ""),
                    "detail": d.get("detail", ""),
                    "phase": d.get("phase", ""),
                    "block": d.get("block", ""),
                    "display_order": d.get("displayOrder", 0),
                    "href": d.get("href"),
                    "done": bool(d.get("done", False)),
                    "done_at": done_at,
                    "source_system": "convex",
                    "source_deployment": dep_name,
                    "source_id": d["_id"],
                    "source_created_at": source_created,
                    "source_snapshot_ts": snapshot_ts,
                    "source_row": d,
                    "changed_by": d.get("changedBy") or "migration@maharamedia.com",
                    "source_revision": int(d.get("revision", 1)),
                    "source_deleted": False,
                }
                planned_inserts["cockpit_daily_checks"].append(row)
                existing_checks_source[source_key] = row
                existing_logical_checks[logical_key] = row

    # 3. Issue reports / feedback
    existing_issues = {
        i.get("source_id"): i
        for i in fetch_rest_paginated(project_url, headers, "cockpit_issue_reports", "source_id")
        if i.get("source_id")
    }
    for dep_name, z_path in [(mb_dep, mb_zip), (cs_dep, cs_zip)]:
        docs = read_jsonl_from_zip(z_path, "feedback")
        for d in docs:
            if d["_id"] not in existing_issues:
                row = {
                    "kind": d.get("kind", "issue"),
                    "text": d.get("text", d.get("message", "")),
                    "status": d.get("status", "open"),
                    "batch": d.get("batch"),
                    "note": d.get("note"),
                    "created_by": d.get("createdBy", d.get("user", "")),
                    "source_system": "convex",
                    "source_id": d["_id"],
                    "app": "media-buyer" if "adorable" in dep_name else "client-success",
                    "page": d.get("page"),
                    "role": d.get("role"),
                    "actor_email": d.get("actorEmail", d.get("email")),
                    "metadata": d,
                }
                planned_inserts["cockpit_issue_reports"].append(row)
                existing_issues[d["_id"]] = row

    # 4. EOD reports
    existing_eod = {
        (e.get("source_deployment"), e.get("source_id")): e
        for e in fetch_rest_paginated(project_url, headers, "cockpit_eod_reports", "source_deployment,source_id")
        if e.get("source_deployment") and e.get("source_id")
    }
    mb_eod = read_jsonl_from_zip(mb_zip, "eodReports")
    for d in mb_eod:
        key = (mb_dep, d["_id"])
        if key not in existing_eod:
            row = {
                "role": d.get("role", "media_buyer"),
                "day": d.get("day"),
                "submitted_at": ms_to_iso(d.get("submittedAt")),
                "energy": d.get("energy"),
                "answers": d.get("answers", {}),
                "computed": d.get("computed", {}),
                "slack_ts": d.get("slackTs"),
                "source_system": "convex",
                "source_deployment": mb_dep,
                "source_id": d["_id"],
            }
            planned_inserts["cockpit_eod_reports"].append(row)
            existing_eod[key] = row

    # Computed mirrors have logical identities independent of Convex sync document ids.
    clients_map = {c["name"].lower(): c["id"] for c in fetch_rest_paginated(project_url, headers, "clients", "id,name") if c.get("name") and c.get("id")}
    planned_reconciliations, reconciliation_conflicts = [], []
    unchanged_mirrors = {}
    for table, source_table in [("cockpit_campaigns", "campaigns"), ("cockpit_ads", "ads")]:
        entries, conflicts, unchanged = reconcile_mirrors(table, read_jsonl_from_zip(mb_zip, source_table),
            fetch_rest_paginated(project_url, headers, table), mb_dep, clients_map, {"complete":True,"exported_at":snapshot_ts,"archive_sha256":source_hashes["media_buyer"]["sha256"]})
        planned_reconciliations.extend(entries)
        reconciliation_conflicts.extend(conflicts)
        unchanged_mirrors[table] = unchanged

    # 7. Decisions
    existing_decisions = {
        (dec.get("source_deployment"), dec.get("source_id")): dec
        for dec in fetch_rest_paginated(project_url, headers, "cockpit_decisions", "source_deployment,source_id")
        if dec.get("source_deployment") and dec.get("source_id")
    }
    for dep_name, z_path in [(mb_dep, mb_zip), (cs_dep, cs_zip)]:
        docs = read_jsonl_from_zip(z_path, "decisions")
        for d in docs:
            key = (dep_name, d["_id"])
            if key not in existing_decisions:
                row = {
                    "role": d.get("role", "media_buyer" if "adorable" in dep_name else "csm"),
                    "day": d.get("day"),
                    "subject": d.get("subject", ""),
                    "action": d.get("action", ""),
                    "evidence": d.get("evidence"),
                    "kind": d.get("kind"),
                    "clickup_task_id": d.get("clickupTaskId"),
                    "clickup_task_url": d.get("clickupTaskUrl"),
                    "metric_at_decision": d.get("metricAtDecision"),
                    "logged_at": ms_to_iso(d.get("loggedAt", d.get("at"))),
                    "source_system": "convex",
                    "source_deployment": dep_name,
                    "source_id": d["_id"],
                }
                planned_inserts["cockpit_decisions"].append(row)
                existing_decisions[key] = row

    # 8. Client Profiles
    existing_profiles = {
        p["client_name"].lower(): p
        for p in fetch_rest_paginated(project_url, headers, "cockpit_client_profiles", "client_name")
        if p.get("client_name")
    }
    profiles_by_name = {}
    cs_profiles = read_jsonl_from_zip(cs_zip, "clientProfiles")
    for d in cs_profiles:
        name = (d.get("clientName") or d.get("client") or "").strip()
        if not name:
            continue
        name_key = name.lower()
        if name_key in existing_profiles:
            continue
        row = {
            "client_name": name,
            "service": d.get("service"),
            "stage": d.get("stage"),
            "health": d.get("happiness") or d.get("health"),
            "kpi": d.get("performance", {}),
            "notes": d.get("gaps", []),
            "overview": {
                "ads": d.get("ads"),
                "calls": d.get("calls"),
                "links": d.get("links"),
                "live": d.get("live"),
                "lost": d.get("lost"),
            },
            "provisional": d.get("provisional", {}),
            "synced_at": ms_to_iso(d.get("syncedAt")),
            "source_system": "convex",
            "source_deployment": cs_dep,
            "source_id": d["_id"],
        }
        if name_key not in profiles_by_name or (row["health"] and not profiles_by_name[name_key]["health"]):
            profiles_by_name[name_key] = row

    planned_inserts["cockpit_client_profiles"] = list(profiles_by_name.values())

    insert_counts = {t: len(rows) for t, rows in planned_inserts.items()}

    for entry in planned_reconciliations:
        if entry["operation"] == "insert": insert_counts[entry["table"]] += 1
    update_counts = {table: sum(e["table"] == table and e["operation"] == "update" for e in planned_reconciliations) for table in ("cockpit_campaigns", "cockpit_ads")}
    plan_data = {
        "format_version": "2.0",
        "planned_reconciliations": planned_reconciliations,
        "reconciliation_conflicts": reconciliation_conflicts,
        "apply_ready": not reconciliation_conflicts,
        "update_counts": update_counts,
        "retirement_counts": {table:sum(e["table"]==table and e["operation"]=="retire" for e in planned_reconciliations) for table in ("cockpit_campaigns","cockpit_ads")},
        "unchanged_mirrors": unchanged_mirrors,
        "project_ref": FIXED_PROJECT_REF,
        "project_url": project_url,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "snapshot_ts": snapshot_ts,
        "deployments": {
            "media_buyer": mb_dep,
            "client_success": cs_dep,
            "creative_director": cd_dep,
        },
        "source_hashes": source_hashes,
        "coverage": coverage_meta,
        "insert_counts": insert_counts,
        "planned_inserts": planned_inserts,
    }

    if plan_path is None:
        plan_dir = Path(tempfile.gettempdir()) / "mahara_snapshot_plans"
        plan_dir.mkdir(parents=True, exist_ok=True)
        plan_path = plan_dir / f"snapshot_plan_{int(datetime.now(timezone.utc).timestamp())}.json"
    else:
        plan_path = ensure_outside_repo(plan_path)
        plan_path.parent.mkdir(parents=True, exist_ok=True)

    plan_json_bytes = json.dumps(plan_data, indent=2, sort_keys=True).encode("utf-8")
    plan_sha = compute_content_sha256(plan_json_bytes)
    with plan_path.open("xb") as output:
        output.write(plan_json_bytes)

    return plan_data, plan_sha, plan_path


def apply_snapshot_catchup(
    plan_path: Path,
    expected_plan_sha: str,
    project_url: str,
    service_key: str,
) -> Dict[str, Any]:
    project_url = validate_project_url(project_url)

    if not plan_path.is_file():
        raise FileNotFoundError(f"Plan file not found: {plan_path}")

    raw_bytes = plan_path.read_bytes()
    actual_plan_sha = compute_content_sha256(raw_bytes)
    if actual_plan_sha != expected_plan_sha:
        raise ValueError(
            f"Plan SHA mismatch! Expected {expected_plan_sha} but computed {actual_plan_sha} on {plan_path}"
        )

    plan_data = json.loads(raw_bytes.decode("utf-8"))

    # Verify bound project URL matches plan
    plan_project_url = plan_data.get("project_url")
    if plan_project_url and plan_project_url != project_url:
        raise ValueError(
            f"Project URL mismatch! Plan was generated for '{plan_project_url}', but apply was called with '{project_url}'."
        )

    source_hashes = plan_data.get("source_hashes", {})
    for arch_key, meta in source_hashes.items():
        p = Path(meta["path"])
        if not p.is_file():
            raise FileNotFoundError(f"Source archive for {arch_key} not found at {p}")
        current_sha = compute_sha256(p)
        if current_sha != meta["sha256"]:
            raise ValueError(
                f"Source archive hash mismatch for {arch_key}! Expected {meta['sha256']}, found {current_sha}"
            )

    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
    }

    planned_inserts = plan_data.get("planned_inserts", {})
    reconciliations = plan_data.get("planned_reconciliations", [])
    if plan_data.get("reconciliation_conflicts") or plan_data.get("apply_ready") is False:
        raise RuntimeError("Plan has unresolved reconciliation conflicts; no writes performed")
    if any(planned_inserts.get(t) for t in ("cockpit_campaigns", "cockpit_ads")):
        raise RuntimeError("Legacy campaign/ad insert plan is unsafe; regenerate with stable identity reconciliation")
    # Server validates every CAS/identity before any table is touched; defaults to dry-run.
    for entry in reconciliations:
        post_reconcile(project_url, headers, entry, actual_plan_sha)


    # Recheck target state for conflicts before any insert
    if planned_inserts.get("cockpit_members"):
        existing_emails = {
            m["email"].lower()
            for m in fetch_rest_paginated(project_url, headers, "cockpit_members", "email")
            if m.get("email")
        }
        for row in planned_inserts["cockpit_members"]:
            if row["email"].lower() in existing_emails:
                raise RuntimeError(
                    f"Conflict detected during pre-apply target recheck: member {row['email']} already exists. Refusing overwrite."
                )

    if planned_inserts.get("cockpit_daily_checks"):
        existing_checks = {
            (c.get("source_deployment"), c.get("source_id"))
            for c in fetch_rest_paginated(project_url, headers, "cockpit_daily_checks", "source_deployment,source_id")
            if c.get("source_deployment") and c.get("source_id")
        }
        existing_logical = {
            (c.get("role"), str(c.get("day")), c.get("check_key"))
            for c in fetch_rest_paginated(project_url, headers, "cockpit_daily_checks", "role,day,check_key")
            if c.get("role") and c.get("day") and c.get("check_key")
        }
        for row in planned_inserts["cockpit_daily_checks"]:
            if (row["source_deployment"], row["source_id"]) in existing_checks:
                raise RuntimeError(
                    f"Conflict detected during pre-apply recheck: daily check source_id {row['source_id']} exists. Refusing overwrite."
                )
            if (row["role"], str(row["day"]), row["check_key"]) in existing_logical:
                raise RuntimeError(
                    f"Conflict detected during pre-apply recheck: daily check logical key ({row['role']}, {row['day']}, {row['check_key']}) exists. Refusing overwrite."
                )

    for tbl in ["cockpit_issue_reports", "cockpit_eod_reports", "cockpit_campaigns", "cockpit_ads", "cockpit_decisions"]:
        rows = planned_inserts.get(tbl, [])
        if not rows:
            continue
        existing_sources = {
            (c.get("source_deployment"), c.get("source_id")) if tbl != "cockpit_issue_reports" else c.get("source_id")
            for c in fetch_rest_paginated(
                project_url,
                headers,
                tbl,
                "source_deployment,source_id" if tbl != "cockpit_issue_reports" else "source_id",
            )
        }
        for row in rows:
            key = (row.get("source_deployment"), row.get("source_id")) if tbl != "cockpit_issue_reports" else row.get("source_id")
            if key in existing_sources:
                raise RuntimeError(
                    f"Conflict detected during pre-apply target recheck: table {tbl} key {key} already exists. Refusing overwrite."
                )

    if planned_inserts.get("cockpit_client_profiles"):
        existing_profiles = {
            p["client_name"].lower()
            for p in fetch_rest_paginated(project_url, headers, "cockpit_client_profiles", "client_name")
            if p.get("client_name")
        }
        for row in planned_inserts["cockpit_client_profiles"]:
            if row["client_name"].lower() in existing_profiles:
                raise RuntimeError(
                    f"Conflict detected during pre-apply target recheck: profile {row['client_name']} already exists. Refusing overwrite."
                )

    # Canary exercise: find first table with rows, insert 1 record, verify readback
    first_tbl = None
    canary_row = None
    for tbl, rows in planned_inserts.items():
        if rows:
            first_tbl = tbl
            canary_row = rows[0]
            break

    inserted_summary = {t: 0 for t in planned_inserts}
    reconciled_summary = {"inserted": 0, "updated": 0, "retired": 0}

    try:
        # First mirror is a single-row canary. Every following mirror is still CAS guarded and read back.
        for entry in reconciliations:
            receipt = post_reconcile(project_url, headers, entry, actual_plan_sha, apply=True)
            actual = receipt.get("row")
            if not isinstance(actual, dict): raise RuntimeError("Reconcile returned no row receipt")
            if entry["expected"] and actual.get("id") != entry["expected"].get("id"):
                raise RuntimeError("Reconcile changed the stable SQL row id")
            expected = {**(entry["expected"] or {}), **entry["after"]}
            expected.pop("updated_at", None)
            if entry["operation"]=="retire": expected.pop("source_deleted_at",None)
            actual = read_back_record(project_url, headers, entry["table"], entry["expected"] if entry["operation"]=="retire" else entry["after"])
            if actual is None: raise RuntimeError("Reconcile row missing on independent readback")
            matched, reason = verify_record_match(expected, actual)
            if not matched: raise RuntimeError(f"Reconcile readback failed: {reason}")
            reconciled_summary["retired" if entry["operation"]=="retire" else "updated" if entry["expected"] else "inserted"] += 1

        if first_tbl and canary_row:
            post_rest_insert(project_url, headers, first_tbl, [canary_row], return_representation=True)
            canary_actual = read_back_record(project_url, headers, first_tbl, canary_row)
            if canary_actual is None:
                raise RuntimeError(f"Canary verification failed: missing record in {first_tbl} after insert")
            matched, reason = verify_record_match(canary_row, canary_actual)
            if not matched:
                raise RuntimeError(f"Canary verification failed for {first_tbl}: {reason}")
            inserted_summary[first_tbl] += 1

        # Insert remaining records in chunks of 50 and verify EVERY record readback
        for tbl, rows in planned_inserts.items():
            start_idx = 1 if tbl == first_tbl else 0
            rem_rows = rows[start_idx:]
            for i in range(0, len(rem_rows), 50):
                chunk = rem_rows[i : i + 50]
                post_rest_insert(project_url, headers, tbl, chunk, return_representation=False)
                for row in chunk:
                    actual = read_back_record(project_url, headers, tbl, row)
                    if actual is None:
                        raise RuntimeError(f"Readback verification failed: missing record in {tbl}: {row}")
                    matched, reason = verify_record_match(row, actual)
                    if not matched:
                        raise RuntimeError(f"Readback verification failed for {tbl}: {reason}")
                    inserted_summary[tbl] += 1

        return {
            "status": "APPLY_COMPLETED",
            "plan_sha": actual_plan_sha,
            "inserted_summary": inserted_summary,
            "reconciled_summary": reconciled_summary,
        }
    except Exception as e:
        partial_report = (
            f"PARTIAL APPLY FAILURE: {e}. "
            f"Truthful partial apply progress before failure: inserts={inserted_summary}, mirrors={reconciled_summary}"
        )
        raise RuntimeError(partial_report) from e


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Consolidated Snapshot Catch-Up Import Tool (Safe, Add-Only, Plan-Verified)"
    )
    parser.add_argument("--mb-archive", "--mb-zip", dest="mb_archive", type=Path, required=True, help="Path to Media Buyer snapshot zip")
    parser.add_argument("--cs-archive", "--cs-zip", dest="cs_archive", type=Path, required=True, help="Path to Client Success snapshot zip")
    parser.add_argument("--cd-archive", "--cd-zip", dest="cd_archive", type=Path, required=True, help="Path to Creative Director snapshot zip")
    parser.add_argument("--snapshot-ts", type=str, required=True, help="Snapshot timestamp in ISO format (e.g. 2026-09-23T00:00:00Z)")
    parser.add_argument("--mb-deployment", type=str, default="adorable-seahorse-418", help="Media Buyer Convex deployment name")
    parser.add_argument("--cs-deployment", type=str, default="impressive-dinosaur-375", help="Client Success Convex deployment name")
    parser.add_argument("--cd-deployment", type=str, default="colorful-wombat-644", help="Creative Director Convex deployment name")
    parser.add_argument("--project-url", type=str, default=DEFAULT_PROJECT_URL, help=f"Supabase REST API project URL (fixed to {DEFAULT_PROJECT_URL})")
    parser.add_argument("--service-key", type=str, default=os.environ.get("SUPABASE_SERVICE_ROLE_KEY", ""), help="Supabase service role key (or via env)")
    parser.add_argument("--plan-path", type=Path, default=None, help="Path to save or read the reviewed plan JSON (must be outside repo)")
    parser.add_argument("--apply", action="store_true", default=False, help="Execute live writes referencing reviewed plan SHA")
    parser.add_argument("--plan-sha", type=str, default="", help="Expected plan SHA256 (mandatory with --apply)")
    return parser


def main(argv: Optional[List[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    service_key = args.service_key.strip()
    if not service_key:
        print("ERROR: Missing Supabase service role key. Provide --service-key or set SUPABASE_SERVICE_ROLE_KEY env var.", file=sys.stderr)
        return 1

    try:
        validate_project_url(args.project_url)
    except ValueError as ve:
        print(f"ERROR: {ve}", file=sys.stderr)
        return 1

    dry_run = not args.apply

    print("=" * 60)
    print(f"Snapshot Catch-Up Data Import Tool | DRY_RUN = {dry_run}")
    print(f"Target Supabase Project: {args.project_url}")
    print("=" * 60)

    try:
        if dry_run:
            plan_data, plan_sha, saved_path = plan_snapshot_catchup(
                mb_zip=args.mb_archive,
                cs_zip=args.cs_archive,
                cd_zip=args.cd_archive,
                snapshot_ts=args.snapshot_ts,
                mb_dep=args.mb_deployment,
                cs_dep=args.cs_deployment,
                cd_dep=args.cd_deployment,
                project_url=args.project_url,
                service_key=service_key,
                plan_path=args.plan_path,
            )
            print(f"Plan generated and saved outside repository at: {saved_path}")
            print(f"Plan SHA256: {plan_sha}")
            print("Planned inserts:")
            for tbl, count in plan_data["insert_counts"].items():
                print(f"  - {tbl}: {count}")
            cov = plan_data["coverage"]
            print(f"Coverage status: {cov['status']} (Full migration supported: {cov['full_migration_supported']})")
            if not cov["full_migration_supported"]:
                print(f"Notice: {cov['refusal_reason']}")
            print("=" * 60)
            print("DRY RUN COMPLETE: No live writes executed.")
            print(f"To apply, run with: --apply --plan-path {saved_path} --plan-sha {plan_sha}")
            return 0
        else:
            if not args.plan_path:
                print("ERROR: --plan-path is required when --apply is set.", file=sys.stderr)
                return 1
            if not args.plan_sha:
                print("ERROR: --plan-sha is required when --apply is set.", file=sys.stderr)
                return 1

            result = apply_snapshot_catchup(
                plan_path=args.plan_path,
                expected_plan_sha=args.plan_sha,
                project_url=args.project_url,
                service_key=service_key,
            )
            print(f"APPLY COMPLETED SUCCESSFULLY | Plan SHA: {result['plan_sha']}")
            for tbl, count in result["inserted_summary"].items():
                print(f"  - {tbl}: {count} record(s) inserted")
            return 0
    except Exception as e:
        print(f"EXECUTION FAILED: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
