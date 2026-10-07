"""Finite, reviewed archive cutover into canonical cockpit source ledgers.

No scheduler, customer message, auth import, or default network call. Plans and
inventories stay outside the repository. --apply requires the exact file SHA256,
fresh source archives and the service-only fenced bootstrap RPC.
"""
import argparse
import hashlib
import importlib.util
import json
import math
import os
import re
import urllib.error
import urllib.request
import uuid
import zipfile
from datetime import datetime, timezone, timedelta
from pathlib import Path

CORE_SPEC = importlib.util.spec_from_file_location("cockpit_core_import", Path(__file__).with_name("import-snapshot-data.py"))
core = importlib.util.module_from_spec(CORE_SPEC)
CORE_SPEC.loader.exec_module(core)
PROJECT_REF = core.FIXED_PROJECT_REF
PROJECT_URL = core.DEFAULT_PROJECT_URL
FAMILIES = {"media-buyer": "media", "client-success": "csm", "creative-director": "creative"}
SOURCE_TABLES = {
    "media-buyer": frozenset("inbox clientLinks clientComments boardCards offBoardCampaigns manualChanges adChanges metaTree clickupMembers clientPrefs feedback syncRuns onboardings launchWatch trackingIssues marketPlays campaignChat".split()),
    "client-success": frozenset("clients csTasks kpi appointments rosterDays churnEvents syncRuns clientProfiles decisions reportDocs outbox".split()),
    "creative-director": frozenset("clients creativeTasks videoJobs contentPosts touchLog campaigns ads metaTree funnels winnersArchive marketPlays blueprints".split()),
}
AUTH_TABLES = frozenset("authAccounts authSessions authRefreshTokens authVerificationCodes authVerifiers authRateLimits users spaceSessions".split())
PENDING_TABLES = frozenset("outbox creativeOutbox asks hermesJobs hermesQueue builds buildJobs".split())
DOMAIN_TABLES = {
    "checks": "cockpit_daily_checks", "eodReports": "cockpit_eod_reports", "decisions": "cockpit_decisions",
    "feedback": "cockpit_issue_reports", "clientProfiles": "cockpit_client_profiles", "members": "cockpit_members",
    "ceoTeamStatus": "cockpit_team_status", "planItems": "cockpit_plan_items",
    "ceoDaily": "cockpit_metric_days", "ceoAudit": "cockpit_audit_log", "ceoClientBilling": "cockpit_client_billing_days",
    "clientPrefs": "cockpit_csm_client_preferences",
    "hotList": "cockpit_csm_hot_rows",
    "looseDismissed": "cockpit_csm_loose_dismissals",
    "moneyGoals": "cockpit_csm_money_goals",
    "projections": "cockpit_csm_projections",
    "renewalPlans": "cockpit_csm_renewal_plans",
    "callBriefs": "cockpit_media_call_briefs",
    "waThreads": "cockpit_wa_thread_captures",
    "replyDrafts": "cockpit_wa_draft_history",
}
GLOBAL_SOURCES = frozenset("clickupMembers syncRuns kpi marketPlays winnersArchive checks eodReports members feedback ceoTeamStatus ceoDaily ceoAudit ceoClientBilling moneyGoals projections".split())
BILLING_FIELDS = {
    "stage": "stage", "mrrUsd": "mrr_usd", "ltvUsd": "ltv_usd", "nextPaymentAmountUsd": "next_payment_usd",
    "currency": "source_currency", "nextPaymentDate": "next_payment_date", "signupDate": "signup_date",
    "launchDate": "launch_date", "pausedOn": "paused_on", "churnDate": "churn_date",
    "nextContractRenewal": "next_renewal_date", "paymentPlan": "payment_plan", "paymentMethod": "payment_method",
    "contractStatus": "contract_status", "churnReason": "churn_reason", "churnType": "churn_type",
    "closer": "closer", "leadSource": "lead_source",
}


def file_hash(path):
    return core.compute_sha256(Path(path))


def content_hash(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode()).hexdigest()

def target_guard_hash(value):
    # JSONB and the JS transport may encode an integral double as an integer.
    # Normalize comparisons only; retain original archive/table hashes and source records.
    def normalize(item):
        if isinstance(item, dict):
            return {key: normalize(child) for key, child in item.items()}
        if isinstance(item, list):
            return [normalize(child) for child in item]
        if isinstance(item, float) and math.isfinite(item) and item.is_integer():
            return int(item)
        return item
    return content_hash(normalize(value))


def load_snapshot(item):
    path = Path(item["path"])
    if file_hash(path) != item["sha256"]:
        raise ValueError("Source archive checksum mismatch")
    app = item.get("cockpit", item.get("app"))
    if app not in FAMILIES or not item.get("deployment"):
        raise ValueError("Explicit cockpit and deployment required")
    declared = item.get("tables")
    if not isinstance(declared, dict):
        raise ValueError("Complete source table count manifest required")
    actual = core.get_archive_tables(path)
    if actual != set(declared):
        raise ValueError("Archive table count manifest does not cover exact inventory")
    tables = {}
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)):
            raise ValueError("Duplicate archive members")
        for table, count in declared.items():
            if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", table) or not isinstance(count, int) or isinstance(count, bool) or count < 0:
                raise ValueError("Invalid table count manifest")
            member = f"{table}/documents.jsonl"
            if member not in names:
                raise ValueError("Missing canonical documents.jsonl file")
            rows = [json.loads(line) for line in archive.read(member).decode("utf-8").splitlines() if line.strip()]
            if len(rows) != count:
                raise ValueError(f"Source count mismatch: {app}/{table}")
            if table == "_tables":
                if any(not isinstance(row, dict) or not isinstance(row.get("name"), str)
                       or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", row["name"])
                       or not isinstance(row.get("id"), int) or isinstance(row["id"], bool)
                       for row in rows):
                    raise ValueError("Invalid archive table catalog")
                if ({row["name"] for row in rows} != actual - {"_tables", "_storage"}
                        or len({row["name"] for row in rows}) != len(rows)
                        or len({row["id"] for row in rows}) != len(rows)):
                    raise ValueError("Archive table catalog does not match exact inventory")
            else:
                if any(not isinstance(row, dict) or not isinstance(row.get("_id"), str) or not row["_id"] for row in rows):
                    raise ValueError(f"Missing stable source identity: {app}/{table}")
                if len({row["_id"] for row in rows}) != len(rows):
                    raise ValueError(f"Duplicate source identity: {app}/{table}")
            tables[table] = rows
    return {"app": app, "path": str(path.resolve()), "sha256": item["sha256"], "deployment": item["deployment"],
            "captured_at": item.get("captured_at"), "tables": tables,
            "table_hashes": {table: content_hash(rows) for table, rows in tables.items()}}


def classify(app, table):
    if table == "_tables":
        return "metadata", "Verified archive table catalog; retained as evidence, not business rows"
    if table == "hermesChat":
        return "archive", "User-approved protected backup retention; no invented author or executable job import"
    if table == "planItems" or (app == "media-buyer" and table in ("ceoTeamStatus", "ceoDaily", "ceoAudit", "ceoClientBilling")):
        return "durable", DOMAIN_TABLES[table]
    if table in ("clientPrefs", "hotList", "looseDismissed", "moneyGoals", "projections", "renewalPlans") and app == "client-success":
        return "durable", DOMAIN_TABLES[table]
    if table == "callBriefs" and app == "media-buyer":
        return "durable", DOMAIN_TABLES[table]
    if table == "waThreads" and app in ("client-success", "creative-director"):
        return "durable", DOMAIN_TABLES[table]
    if table == "replyDrafts" and app == "media-buyer":
        return "durable", DOMAIN_TABLES[table]
    if table in AUTH_TABLES:
        return "invalidate", "Legacy sessions and tokens are not imported; Supabase login is required"
    if table in SOURCE_TABLES.get(app, ()):
        return "source", f"cockpit_{FAMILIES[app]}_sources"
    if table in PENDING_TABLES:
        return "quarantine", "Keep archive evidence; never replay external work"
    if app == "media-buyer" and table in ("campaigns", "ads"):
        return "mirror", f"cockpit_{table}"
    if app == "media-buyer" and table in ("dailyStats", "bookingEvents"):
        return "statistics", "cockpit_media_daily_stats" if table == "dailyStats" else "cockpit_media_booking_events"
    archive = app.replace("-", "_")
    if table in DOMAIN_TABLES and table in core.MAPPED_TABLES_BY_ARCHIVE.get(archive, set()):
        return "durable", DOMAIN_TABLES[table]
    if app == "media-buyer" and table in ("clients", "csTasks"):
        return "supporting", "Client-success canonical roster is the runtime owner"
    if table in ("adStills", "winnersArchive"):
        return "supporting", "Native still files / creative archive require verified canonical coverage"
    return "unsupported", "No canonical durable mapping; readiness remains blocked"


def queue_pending(app, table, row):
    if table not in PENDING_TABLES and not (app == "client-success" and table == "outbox"):
        return False
    return not (row.get("sentAt") or row.get("finishedAt") or row.get("state") in ("done", "sent", "confirmed", "failed", "cancelled"))


def client_names(app, table, row, tables):
    # Unmatched media decision subjects are role-owned notes, not invented clients.
    # Former-client briefs retain their original names behind canonical client access.
    private_history = table in SOURCE_TABLES.get(app, ()) or table == "waThreads" or (app == "media-buyer" and table in ("callBriefs", "decisions"))
    if table in GLOBAL_SOURCES:
        return []
    canonical = {}
    for roster in (tables.get("clients", []), tables.get("clientProfiles", []), tables.get("clientLinks", []), tables.get("ceoClientBilling", [])):
        for client in roster:
            name = client.get("name") or client.get("clientName")
            if name:
                key = name.strip().lower()
                if key in canonical and canonical[key] != name.strip():
                    if private_history:
                        return []
                    raise ValueError("Ambiguous client scope roster")
                canonical[key] = name.strip()
    historical = {}
    for campaign in tables.get("campaigns", []):
        name = campaign.get("clientName")
        if not name:
            continue
        key = name.strip().lower()
        if key in canonical:
            continue
        if key in historical and historical[key] != name.strip():
            if private_history:
                return []
            raise ValueError("Ambiguous historical client scope")
        historical[key] = name.strip()
    canonical.update(historical)
    requested = []
    if table == "rosterDays":
        requested = [client.get("name") for client in row.get("clients", [])]
    else:
        for field in ("clientNames", "clients"):
            if isinstance(row.get(field), list):
                requested.extend(row[field])
        for field in ("clientName", "client"):
            if row.get(field):
                requested.append(row[field])
        if table in ("clients", "clientLinks", "churnEvents") and row.get("name"):
            requested.append(row["name"])
        if table == "churnEvents" and row.get("key"):
            key = str(row["key"])
            matches = [
                client for client in tables.get("clients", [])
                if str(client.get("taskId") or client.get("id") or client.get("key") or client.get("name") or "") == key
            ]
            if len(matches) > 1:
                if private_history:
                    return []
                raise ValueError("Ambiguous exact roster identity for churn event")
            if len(matches) == 1:
                requested.append(matches[0].get("name"))
            elif key.strip().lower() in canonical:
                requested.append(canonical[key.strip().lower()])
        if table == "decisions" and row.get("subject"):
            requested.append(row["subject"])
        campaign = row.get("campaignName")
        if campaign:
            matched = [r for r in tables.get("campaigns", []) if r.get("campaignName") == campaign]
            names = {r.get("clientName") or r.get("accountName") for r in matched}
            if len(names) != 1 or None in names:
                if private_history:
                    return []
                raise ValueError(f"Unresolved exact campaign scope: {table}")
            requested.extend(names)
        elif row.get("taskId"):
            matched = [r for r in tables.get("campaigns", []) if r.get("taskId") == row["taskId"]]
            names = {r.get("clientName") or r.get("accountName") for r in matched}
            if len(names) > 1 or None in names:
                if private_history:
                    return []
                raise ValueError(f"Ambiguous exact task scope: {table}")
            requested.extend(names)
    if not requested:
        # Retain unassigned work and role-shared legacy plans without inventing a scope.
        if table in ("creativeTasks", "videoJobs", "contentPosts", "csTasks", "inbox", "feedback", "planItems", "hotList", "waThreads", "replyDrafts"):
            return []
        if private_history:
            return []
        raise ValueError(f"Missing client scope: {app}/{table}")
    result = []
    for name in requested:
        if not isinstance(name, str) or name.strip().lower() not in canonical:
            if private_history:
                return []
            raise ValueError(f"Unresolved client scope: {app}/{table}")
        result.append(canonical[name.strip().lower()])
    return sorted(set(result))

def guard_existing(current, desired, previous):
    if previous is not None and previous.get("tombstone"):
        raise ValueError("protected import tombstone")
    if current is None:
        if previous is not None:
            raise ValueError("previously imported target disappeared")
        return
    if current.get("data") == desired.get("data") and current.get("client_names") == desired.get("client_names"):
        return
    if previous is None or current.get("data") != previous.get("target_data") or current.get("client_names") != previous.get("target_clients"):
        raise ValueError("protected native or human source row")


def rewrite_files(source, app, files):
    def native_url(storage_id, source_deployment=None):
        if source_deployment is None:
            mapping = files.get(f"{app}/{storage_id}")
        else:
            matches = [mapping for key, mapping in files.items()
                       if (key.endswith(f"/{storage_id}") or mapping.get("source_internal_id") == storage_id)
                       and mapping.get("source_deployment") == source_deployment]
            if len(matches) != 1:
                raise ValueError("Missing or ambiguous verified native file namespace")
            mapping = matches[0]
        if not mapping or mapping.get("verified") is not True or not re.fullmatch(r"[a-f0-9]{64}", mapping.get("sha256", "")):
            raise ValueError("Missing verified native file mapping")
        expected = f"{PROJECT_URL}/storage/v1/object/public/cockpit-ad-stills/{mapping['sha256']}"
        if mapping.get("url") != expected:
            raise ValueError("Native file URL does not match its verified content hash")
        return expected

    def visit(value, parent=None, field=None):
        if isinstance(value, dict):
            rewritten = {key: visit(item, value, key) for key, item in value.items()}
            for storage_field, url_field in (("storageId", "url"), ("tinyStorageId", "tinyUrl")):
                if value.get(storage_field):
                    mapped = native_url(value[storage_field])
                    if not rewritten.get(url_field):
                        rewritten[url_field] = mapped
            return rewritten
        if isinstance(value, list):
            return [visit(item, parent, field) for item in value]
        if not isinstance(value, str) or not re.search(r"https://[^/]+\.convex\.(cloud|site)/.*(storage|file)", value):
            return value
        match = re.match(r"https://([a-z0-9-]+)\.convex\.(?:cloud|site)/", value)
        if not match:
            raise ValueError("Legacy file deployment namespace is invalid")
        storage_id = value.split("?", 1)[0].rstrip("/").split("/")[-1]
        return native_url(storage_id, match.group(1))
    return visit(source)


def fresh(value, label, blockers):
    try:
        stamp = datetime.fromisoformat(value.replace("Z", "+00:00"))
        now = datetime.now(timezone.utc)
        if stamp.tzinfo is None or stamp < now - timedelta(hours=24) or stamp > now + timedelta(minutes=1):
            raise ValueError()
    except (ValueError, TypeError, AttributeError):
        blockers.append(f"{label} timestamp missing, stale or future")


def _iso_day(value, label):
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        raise ValueError(f"Invalid durable {label}")
    try:
        if datetime.fromisoformat(value).date().isoformat() != value:
            raise ValueError()
    except ValueError:
        raise ValueError(f"Invalid durable {label}") from None
    return value


def _source_time(value, label):
    if value is None:
        return None
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        raise ValueError(f"Invalid durable {label} timestamp")
    result = core.ms_to_iso(value)
    if result is None:
        raise ValueError(f"Invalid durable {label} timestamp")
    return result


def durable_data(snapshot, table, row):
    app, deployment, source_id = snapshot["app"], snapshot["deployment"], row["_id"]
    if table == "ceoClientBilling":
        task, name = row.get("taskId"), row.get("name")
        if any(not isinstance(value, str) or not value.strip() for value in (task, name)):
            raise ValueError("Client billing task identity or name is missing")
        at = _source_time(row.get("syncedAt"), "client billing capture")
        if at is None:
            raise ValueError("Client billing capture time is missing")
        day = (datetime.fromisoformat(at.replace("Z", "+00:00")) + timedelta(hours=3)).date().isoformat()
        data = {"day": day, "clickup_task_id": task, "client_name": name, "captured_at": at,
                "source_deployment": deployment, "source_id": source_id, "source_record": row}
        for field, target in BILLING_FIELDS.items():
            value = row.get(field)
            if value is not None:
                if target in ("mrr_usd", "ltv_usd", "next_payment_usd"):
                    if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value):
                        raise ValueError("Client billing money is not a finite measured value")
                    if round(value, 2) != value:
                        raise ValueError("Client billing money exceeds canonical precision")
                    value = float(value)
                elif target in ("next_payment_date", "signup_date", "launch_date", "paused_on", "churn_date", "next_renewal_date"):
                    value = _iso_day(value, "client billing date")
                elif not isinstance(value, str):
                    raise ValueError("Client billing text is malformed")
                elif target == "source_currency" and not re.fullmatch(r"[A-Z]{3}", value):
                    raise ValueError("Client billing currency is malformed")
            data[target] = value
        return data
    if table == "ceoAudit":
        action, entity, actor = row.get("action"), row.get("table"), row.get("by")
        if any(not isinstance(value, str) or not value for value in (action, entity, actor)):
            raise ValueError("Original audit action, entity or recorded author is missing")
        entity_id = row.get("rowId")
        if entity_id is not None and not isinstance(entity_id, str):
            raise ValueError("Original audit entity identity is malformed")
        at = _source_time(row.get("at"), "original audit")
        if at is None:
            raise ValueError("Original audit timestamp is missing")
        return {"action": action, "entity_type": entity, "entity_id": entity_id, "actor_email": actor,
                "source_app": app, "source_system": "convex", "before": row.get("before"),
                "after": row.get("after"), "created_at": at,
                "metadata": {"source_table": table, "source_deployment": deployment,
                             "source_id": source_id, "source_record": row}}
    if table == "ceoDaily":
        metric, scope, value = row.get("metric"), row.get("scope"), row.get("value")
        if not isinstance(metric, str) or not metric or not isinstance(scope, str) or not scope:
            raise ValueError("Daily metric identity is incomplete")
        if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value):
            raise ValueError("Daily metric has no finite measured value")
        at = _source_time(row.get("at"), "daily metric capture")
        if at is None:
            raise ValueError("Daily metric capture time is missing")
        return {"day": _iso_day(row.get("date"), "daily metric day"), "metric": metric, "scope": scope,
                "value": float(value), "captured_at": at, "source_deployment": deployment,
                "source_id": source_id, "source_record": row}
    if table == "ceoTeamStatus":
        key, status, author = row.get("personKey"), row.get("status"), row.get("setBy")
        if not isinstance(key, str) or not re.fullmatch(r"[a-z][a-z_]*:[^\W\d_]+", key) or key != key.lower():
            raise ValueError("Staff status person identity is malformed")
        if status not in ("active", "paused", "left") or not isinstance(author, str) or not author:
            raise ValueError("Staff status or recorded author is missing")
        if row.get("note") is not None and not isinstance(row["note"], str):
            raise ValueError("Staff status note is malformed")
        at = _source_time(row.get("setAt"), "staff status")
        if at is None:
            raise ValueError("Staff status timestamp is missing")
        return {"person_key": key, "status": status, "since": _iso_day(row.get("since"), "staff status day"),
                "note": row.get("note"), "set_by": author, "set_at": at,
                "source_deployment": deployment, "source_id": source_id, "source_record": row}
    if table == "planItems":
        role = row.get("role") or {"media-buyer": "media_buyer", "client-success": "csm", "creative-director": "creative"}[app]
        text, confirmed = row.get("text"), row.get("confirmed", False)
        if not isinstance(role, str) or not role or not isinstance(text, str) or not text.strip() or not isinstance(confirmed, bool):
            raise ValueError("Daily plan role, text or confirmation is malformed")
        for field in ("reason", "clientName", "client", "listName"):
            if row.get(field) is not None and not isinstance(row[field], str):
                raise ValueError(f"Daily plan {field} is malformed")
        at = _source_time(row.get("createdAt"), "daily plan")
        if at is None:
            raise ValueError("Daily plan creation timestamp is missing")
        day = _iso_day(row.get("day"), "daily plan day")
        due = row.get("dueDate")
        if due == "tomorrow":
            due = (datetime.fromisoformat(day).date() + timedelta(days=1)).isoformat()
        return {"role": role, "day": day, "text": text,
                "reason": row.get("reason"), "client_name": row.get("clientName", row.get("client")),
                "list_name": row.get("listName"), "due_date": _iso_day(due, "plan due date") if due else None,
                "created_at": at, "confirmed": confirmed, "source_deployment": deployment, "source_id": source_id, "source_row": row}
    if table == "members":
        email = row.get("email")
        roles, clients = row.get("roles", []), row.get("clients", [])
        if not isinstance(email, str) or not email.strip():
            raise ValueError("Member email is missing")
        if not isinstance(roles, list) or any(not isinstance(value, str) for value in roles):
            raise ValueError("Member roles are incomplete")
        if not isinstance(clients, list) or any(not isinstance(value, str) for value in clients):
            raise ValueError("Member client assignments are incomplete")
        if row.get("addedAt") is None:
            raise ValueError("Member addedAt is missing")
        sales_role = row.get("salesRole")
        if sales_role is not None and sales_role not in ("setter", "closer", "both", "manager"):
            raise ValueError("Member sales role is invalid")
        for field in ("name", "note", "addedBy", "lastCockpit"):
            if row.get(field) is not None and not isinstance(row[field], str):
                raise ValueError(f"Member {field} is malformed")
        return {"email": email.strip().lower(), "name": row.get("name"), "roles": roles, "clients": clients,
                "active": True, "sales_role": sales_role, "note": row.get("note"), "added_by": row.get("addedBy"),
                "added_at": _source_time(row.get("addedAt"), "member addedAt"),
                "source_updated_at": _source_time(row.get("updatedAt"), "member update"),
                "last_seen_at": _source_time(row.get("lastSeenAt"), "member last-seen"),
                "last_cockpit": row.get("lastCockpit"), "source_deployment": deployment, "source_id": source_id}
    if table == "eodReports":
        role = row.get("role", "media_buyer")
        day = _iso_day(row.get("day"), "EOD day")
        answers, computed = row.get("answers", {}), row.get("computed", {})
        if not isinstance(role, str) or not role or answers is None or computed is None:
            raise ValueError("EOD report fields are incomplete")
        # Native ratings are numeric; legacy words retain their exact meaning in source_row.
        energy = row.get("energy")
        if isinstance(energy, str):
            try:
                energy = float(energy)
            except ValueError:
                energy = None
        if isinstance(energy, bool) or (energy is not None and not isinstance(energy, (int, float))):
            raise ValueError("Invalid EOD rating type")
        return {"role": role, "day": day, "submitted_at": _source_time(row.get("submittedAt"), "EOD submission"),
                "energy": energy, "answers": answers, "computed": computed, "slack_ts": row.get("slackTs"),
                "source_system": "convex", "source_deployment": deployment, "source_id": source_id, "source_row": row}
    if table == "checks":
        default_role = {"media-buyer": "media_buyer", "client-success": "csm"}.get(app)
        role = row.get("role") or default_role
        owner = {"media_buyer": "media-buyer", "csm": "client-success", "creative": "creative-director"}
        key = row.get("checkKey") or row.get("key")
        day = _iso_day(row.get("day"), "check day")
        done = row.get("done", False)
        revision = row.get("revision", 1)
        if role not in owner or not isinstance(key, str) or not key or not isinstance(row.get("label", ""), str):
            raise ValueError("Checklist role, identity or label is incomplete")
        if not isinstance(done, bool) or not isinstance(revision, int) or isinstance(revision, bool):
            raise ValueError("Checklist state is malformed")
        return {"role": role, "owner_app": owner[role], "day": day, "check_key": key,
                "label": row.get("label", ""), "detail": row.get("detail"), "phase": row.get("phase"),
                "block": row.get("block"), "display_order": row.get("displayOrder", row.get("order")),
                "href": row.get("href"), "done": done,
                "done_at": _source_time(row.get("doneAt"), "check") if done else None,
                "source_system": "convex", "source_deployment": deployment, "source_id": source_id,
                "source_created_at": _source_time(row.get("_creationTime"), "check creation"),
                "source_snapshot_ts": snapshot["captured_at"], "source_row": row,
                "changed_by": row.get("changedBy") or "migration@maharamedia.com",
                "source_revision": revision, "source_deleted": False}
    if table == "decisions":
        role = row.get("role") or {"media-buyer": "media_buyer", "client-success": "csm"}.get(app)
        day = _iso_day(row.get("day"), "decision day")
        if not isinstance(role, str) or not role or not isinstance(row.get("subject"), str) or not row["subject"].strip():
            raise ValueError("Decision role or subject is missing")
        if not isinstance(row.get("action"), str) or not row["action"].strip():
            raise ValueError("Decision action is missing")
        return {"role": role, "day": day, "subject": row["subject"], "action": row["action"],
                "evidence": row.get("evidence"), "kind": row.get("kind"),
                "clickup_task_id": row.get("clickupTaskId"), "clickup_task_url": row.get("clickupTaskUrl"),
                "metric_at_decision": row.get("metricAtDecision"),
                "logged_at": _source_time(row.get("loggedAt", row.get("at")), "decision"),
                "source_system": "convex", "source_deployment": deployment, "source_id": source_id,
                "source_row": row}
    if table == "feedback":
        text = row.get("text", row.get("message"))
        page, role = row.get("page"), row.get("role")
        if not isinstance(text, str) or not text.strip() or not isinstance(page, str) or not page or not isinstance(role, str) or not role:
            raise ValueError("Issue report text, page or role is missing")
        created_by = row.get("createdBy", row.get("user", ""))
        if not isinstance(created_by, str):
            raise ValueError("Issue report author is malformed")
        return {"kind": row.get("kind", "issue"), "text": text, "status": row.get("status", "open"),
                "batch": row.get("batch"), "note": row.get("note"), "created_by": created_by,
                "source_system": "convex", "source_id": source_id, "app": app, "page": page, "role": role,
                "actor_email": row.get("actorEmail", row.get("email")), "metadata": row}
    if table == "clientPrefs":
        client_name = row.get("clientName")
        if not isinstance(client_name, str) or not client_name.strip():
            raise ValueError("Client preference clientName is missing")
        language = row.get("language")
        if language is not None and (not isinstance(language, str) or not language.strip()):
            raise ValueError("Client preference language is malformed")
        updated_at = _source_time(row.get("updatedAt", row.get("_creationTime")), "client preference update")
        if updated_at is None:
            raise ValueError("Client preference source timestamp is missing")
        return {"client_name": client_name.strip(), "language": language.strip() if language else None,
                "updated_by": None, "updated_at": updated_at, "source_system": "convex",
                "source_deployment": deployment, "source_id": source_id, "source_record": row}
    if table == "hotList":
        key = row.get("key")
        if not isinstance(key, str) or not key.strip():
            raise ValueError("Hot list key is missing")
        client_name = row.get("clientName", "")
        if client_name is None:
            client_name = ""
        if not isinstance(client_name, str):
            raise ValueError("Hot list clientName is malformed")
        owner_email = row.get("byEmail") or row.get("by") or row.get("ownerEmail") or row.get("owner")
        if owner_email is not None and not isinstance(owner_email, str):
            raise ValueError("Hot list owner email is malformed")
        owner_email = owner_email.strip().lower() if owner_email else None
        if not client_name.strip() and not owner_email:
            raise ValueError("Private hot list row lacks recorded author")
        at = _source_time(row.get("at", row.get("_creationTime")), "hot list timestamp")
        if at is None:
            raise ValueError("Hot list source timestamp is missing")
        hot_data = {}
        for k in ("type", "leadType", "status", "lastObjection", "contactUrl", "amount",
                  "manual", "hidden", "lastFu", "nextFu", "notes", "celebratedAt"):
            if k in row and row[k] is not None:
                hot_data[k] = row[k]
        return {"key": key.strip(), "client_name": client_name.strip(), "owner_email": owner_email,
                "data": hot_data, "created_at": at, "updated_at": at, "source_system": "convex",
                "source_deployment": deployment, "source_id": source_id, "source_record": row}
    if table == "looseDismissed":
        client_name = row.get("clientName")
        if not isinstance(client_name, str) or not client_name.strip():
            raise ValueError("Loose dismissal clientName is missing")
        text = row.get("text")
        if not isinstance(text, str) or not text.strip():
            raise ValueError("Loose dismissal text is missing")
        at = _source_time(row.get("at", row.get("_creationTime")), "loose dismissal timestamp")
        if at is None:
            raise ValueError("Loose dismissal timestamp is missing")
        return {"client_name": client_name.strip(), "loose_text": text, "cleared_by": None,
                "cleared_at": at, "source_system": "convex", "source_deployment": deployment,
                "source_id": source_id, "source_record": row}
    if table == "moneyGoals":
        email = row.get("byEmail", row.get("ownerEmail"))
        if not isinstance(email, str) or not email.strip():
            raise ValueError("Money goal owner email is missing")
        month = row.get("month")
        if not isinstance(month, str) or not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", month) or month.startswith("0000"):
            raise ValueError("Money goal month is invalid")
        target = row.get("target")
        if target is not None:
            if not isinstance(target, (int, float)) or isinstance(target, bool) or not math.isfinite(target) or target < 0:
                raise ValueError("Money goal target is invalid")
            target = float(target)
        clients = row.get("clients")
        if clients is not None:
            if not isinstance(clients, (int, float)) or isinstance(clients, bool) or not math.isfinite(clients) or clients < 0 or int(clients) != clients:
                raise ValueError("Money goal clients count is invalid")
            clients = int(clients)
        counts = row.get("counts")
        if counts is not None and not isinstance(counts, dict):
            raise ValueError("Money goal counts is malformed")
        at = _source_time(row.get("at", row.get("_creationTime")), "money goal timestamp")
        if at is None:
            raise ValueError("Money goal source timestamp is missing")
        return {"owner_email": email.strip().lower(), "month": month, "target": target,
                "clients": clients, "counts": counts or {}, "updated_at": at, "source_system": "convex",
                "source_deployment": deployment, "source_id": source_id, "source_record": row}
    if table == "projections":
        week_start = row.get("weekStart")
        if not isinstance(week_start, str):
            raise ValueError("Projection weekStart is missing")
        week_start = _iso_day(week_start, "projection week start")
        if datetime.fromisoformat(week_start).weekday() != 6:
            raise ValueError("Projection weekStart must be a Sunday")
        email = row.get("byEmail", row.get("ownerEmail"))
        if not isinstance(email, str) or not email.strip():
            raise ValueError("Projection owner email is missing")
        metric = row.get("metric")
        if metric not in ("resell", "renewal", "cash", "review", "referral"):
            raise ValueError("Projection metric is invalid")
        blood, stretch = row.get("blood"), row.get("stretch")
        if blood is None or stretch is None:
            raise ValueError("Projection blood and stretch are required")
        if not isinstance(blood, (int, float)) or isinstance(blood, bool) or not math.isfinite(blood):
            raise ValueError("Projection blood must be a number")
        if not isinstance(stretch, (int, float)) or isinstance(stretch, bool) or not math.isfinite(stretch):
            raise ValueError("Projection stretch must be a number")
        proj_data = {"blood": float(blood), "stretch": float(stretch)}
        actual = row.get("actual")
        if actual is not None:
            if not isinstance(actual, (int, float)) or isinstance(actual, bool) or not math.isfinite(actual):
                raise ValueError("Projection actual must be a number")
            proj_data["actual"] = float(actual)
        miss_reason = row.get("missReason")
        if miss_reason is not None:
            if not isinstance(miss_reason, str):
                raise ValueError("Projection missReason must be text")
            proj_data["missReason"] = miss_reason
        at = _source_time(row.get("at"), "projection timestamp")
        if at is None:
            raise ValueError("Projection source timestamp is missing")
        return {"week_start": week_start, "owner_email": email.strip().lower(), "metric": metric,
                "data": proj_data, "source_id": source_id, "source_deployment": deployment, "source_record": row, "updated_at": at}
    if table == "renewalPlans":
        task_id = row.get("taskId")
        if not isinstance(task_id, str) or not task_id.strip():
            raise ValueError("Renewal plan taskId is missing")
        client_name = row.get("clientName")
        if not isinstance(client_name, str) or not client_name.strip():
            raise ValueError("Renewal plan clientName is missing")
        renewal_date = row.get("renewalDate")
        if not isinstance(renewal_date, str):
            raise ValueError("Renewal plan renewalDate is missing")
        renewal_date = _iso_day(renewal_date, "renewal date")
        status = row.get("status")
        if status not in ("planned", "call_booked", "renewed", "resold", "not_this_cycle", "lost"):
            raise ValueError("Renewal plan status is invalid")
        plan_data = {"status": status}
        for field in ("onboardedOn", "likelihood", "angle", "objection", "objectionAnswer",
                      "callBookedFor", "ghlAppointmentId", "notThisCycleReason", "outcomeNote",
                      "callRecordingUrl", "goldBy", "paidSource", "updatedBy"):
            val = row.get(field)
            if val is not None:
                plan_data[field] = val
        if row.get("paidAmount") is not None:
            val = row["paidAmount"]
            if not isinstance(val, (int, float)) or isinstance(val, bool) or not math.isfinite(val):
                raise ValueError("Renewal plan paidAmount must be a number")
            plan_data["paidAmount"] = float(val)
        if row.get("goldStandard") is not None:
            if not isinstance(row["goldStandard"], bool):
                raise ValueError("Renewal plan goldStandard must be a boolean")
            plan_data["goldStandard"] = row["goldStandard"]
        if row.get("celebratedAt") is not None:
            if not isinstance(row["celebratedAt"], (int, float)) or isinstance(row["celebratedAt"], bool):
                raise ValueError("Renewal plan celebratedAt must be a timestamp number")
            plan_data["celebratedAt"] = row["celebratedAt"]
        if row.get("whereTheyAre") is not None:
            if not isinstance(row["whereTheyAre"], list):
                raise ValueError("Renewal plan whereTheyAre must be an array")
            plan_data["whereTheyAre"] = row["whereTheyAre"]
        if row.get("offer") is not None:
            if not isinstance(row["offer"], dict):
                raise ValueError("Renewal plan offer must be an object")
            offer = dict(row["offer"])
            if offer.get("price") is not None:
                offer["price"] = float(offer["price"])
            if offer.get("durationMonths") is not None:
                offer["durationMonths"] = int(offer["durationMonths"])
            plan_data["offer"] = offer
        at = _source_time(row.get("updatedAt"), "renewal plan timestamp")
        if at is None:
            raise ValueError("Renewal plan source timestamp is missing")
        return {"task_id": task_id.strip(), "client_name": client_name.strip(),
                "renewal_date": renewal_date, "data": plan_data, "source_id": source_id,
                "source_deployment": deployment, "source_record": row, "updated_at": at}
    if table == "callBriefs":
        client_name = row.get("clientName")
        if not isinstance(client_name, str) or not client_name.strip():
            raise ValueError("Call brief clientName is missing")
        key = row.get("key")
        if not isinstance(key, str) or not key.strip():
            raise ValueError("Call brief key is missing")
        status = row.get("status")
        if status not in ("queued", "done", "failed"):
            raise ValueError("Call brief status is invalid")
        overall = row.get("overall")
        if overall is not None and not isinstance(overall, str):
            raise ValueError("Call brief overall must be text")
        per_call = row.get("perCall")
        if per_call is not None and not isinstance(per_call, list):
            raise ValueError("Call brief perCall must be a list")
        at = _source_time(row.get("at", row.get("_creationTime")), "call brief timestamp")
        if at is None:
            raise ValueError("Call brief timestamp is missing")
        return {"client_name": client_name.strip(), "key": key.strip(), "job_id": row.get("jobId"),
                "status": status, "overall": overall, "per_call": per_call or [], "at": at,
                "source_deployment": deployment, "source_id": source_id, "source_record": row}
    if table == "waThreads":
        chat_id = row.get("chatId")
        if not isinstance(chat_id, str) or not chat_id.strip():
            raise ValueError("WhatsApp thread chatId is missing")
        channel = row.get("channel")
        if not isinstance(channel, str) or not channel.strip():
            raise ValueError("WhatsApp thread channel is missing")
        name = row.get("name")
        if not isinstance(name, str) or not name.strip():
            raise ValueError("WhatsApp thread name is missing")
        contact_id = row.get("contactId")
        if not isinstance(contact_id, str) or not contact_id.strip():
            raise ValueError("WhatsApp thread contactId is missing")
        source = row.get("source")
        if source != "ghl":
            raise ValueError("WhatsApp thread source must be ghl")
        is_group = row.get("isGroup")
        if not isinstance(is_group, bool):
            raise ValueError("WhatsApp thread isGroup must be a boolean")
        unread = row.get("unread")
        if unread is not None:
            if not isinstance(unread, (int, float)) or isinstance(unread, bool) or not math.isfinite(unread) or unread < 0 or int(unread) != unread:
                raise ValueError("WhatsApp thread unread must be a non-negative whole number or missing")
            unread = int(unread)
        last_from_us = row.get("lastFromUs")
        if not isinstance(last_from_us, bool):
            raise ValueError("WhatsApp thread lastFromUs must be a boolean")
        recent = row.get("recent")
        if not isinstance(recent, list):
            raise ValueError("WhatsApp thread recent must be a list")
        for frag in recent:
            if not isinstance(frag, dict):
                raise ValueError("WhatsApp thread fragment must be an object")
            if not isinstance(frag.get("at"), (int, float)) or isinstance(frag.get("at"), bool):
                raise ValueError("WhatsApp thread fragment at must be a timestamp")
            if not isinstance(frag.get("fromMe"), bool):
                raise ValueError("WhatsApp thread fragment fromMe must be a boolean")
            if not isinstance(frag.get("text"), str):
                raise ValueError("WhatsApp thread fragment text must be a string")
            if not isinstance(frag.get("who"), str):
                raise ValueError("WhatsApp thread fragment who must be a string")
        last_at = _source_time(row.get("lastAt"), "waThreads lastAt")
        if last_at is None:
            raise ValueError("WhatsApp thread lastAt is missing")
        waiting_since = _source_time(row.get("waitingSince"), "waThreads waitingSince")
        draft_at = _source_time(row.get("draftAt"), "waThreads draftAt")
        synced_at = _source_time(row.get("syncedAt"), "waThreads syncedAt")
        creation_time = _source_time(row.get("_creationTime"), "waThreads _creationTime")
        if creation_time is None:
            raise ValueError("WhatsApp thread _creationTime is missing")
        return {
            "source_app": app,
            "chat_id": chat_id.strip(),
            "channel": channel.strip(),
            "name": name,
            "client_name": row.get("clientName"),
            "contact_id": contact_id.strip(),
            "source": source,
            "is_group": is_group,
            "unread": unread,
            "last_from_us": last_from_us,
            "silent_days": row.get("silentDays"),
            "draft": row.get("draft"),
            "draft_at": draft_at,
            "recent": recent,
            "last_at": last_at,
            "waiting_since": waiting_since,
            "synced_at": synced_at,
            "creation_time": creation_time,
            "source_deployment": deployment,
            "source_id": source_id,
            "source_record": row,
        }
    if table == "replyDrafts":
        chat_id = row.get("chatId")
        if not isinstance(chat_id, str) or not chat_id.strip():
            raise ValueError("replyDraft chatId is missing")
        status = row.get("status")
        if status not in ("done", "queued", "declined"):
            raise ValueError("replyDraft status must be done, queued, or declined")
        at = _source_time(row.get("at"), "replyDraft at")
        if at is None:
            raise ValueError("replyDraft at timestamp is missing")
        creation_time = _source_time(row.get("_creationTime"), "replyDraft _creationTime")
        if creation_time is None:
            raise ValueError("replyDraft _creationTime is missing")
        last_at = _source_time(row.get("lastAt"), "replyDraft lastAt")
        return {
            "source_app": app,
            "chat_id": chat_id.strip(),
            "status": status,
            "job_id": row.get("jobId"),
            "draft": row.get("draft"),
            "at": at,
            "last_at": last_at,
            "creation_time": creation_time,
            "source_deployment": deployment,
            "source_id": source_id,
            "source_record": row,
        }
    raise ValueError(f"No durable mapping for {app}/{table}")

def durable_guard_data(table, data):
    fields = {
        "members": ("email", "name", "roles", "clients", "active", "sales_role", "note", "added_by",
                    "added_at", "source_updated_at", "last_seen_at", "last_cockpit", "source_deployment", "source_id"),
        "eodReports": ("role", "day", "submitted_at", "energy", "answers", "computed", "slack_ts",
                       "source_system", "source_deployment", "source_id", "source_row"),
        "checks": ("role", "owner_app", "day", "check_key", "label", "detail", "phase", "block",
                   "display_order", "href", "source_system", "source_deployment", "source_id",
                   "source_created_at", "source_row"),
        "decisions": ("role", "day", "subject", "action", "evidence", "kind", "clickup_task_id",
                      "clickup_task_url", "metric_at_decision", "logged_at", "source_system",
                      "source_deployment", "source_id", "source_row"),
        "ceoTeamStatus": ("person_key", "status", "since", "note", "set_by", "set_at",
                          "source_deployment", "source_id", "source_record"),
        "planItems": ("role", "day", "text", "reason", "client_name", "list_name", "due_date", "created_at",
                      "confirmed", "source_deployment", "source_id", "source_row"),
        "ceoDaily": ("day", "metric", "scope", "value", "captured_at", "source_deployment", "source_id", "source_record"),
        "ceoAudit": ("action", "entity_type", "entity_id", "actor_email", "source_app", "source_system",
                     "before", "after", "created_at", "metadata"),
        "ceoClientBilling": ("day", "clickup_task_id", "client_name", "captured_at", "source_deployment",
                             "source_id", "source_record", *BILLING_FIELDS.values()),
        "feedback": ("kind", "text", "created_by", "source_system", "source_id", "app", "page",
                     "role", "actor_email", "metadata"),
        "clientPrefs": ("client_name", "language", "updated_by", "updated_at", "source_system", "source_deployment", "source_id", "source_record"),
        "hotList": ("key", "client_name", "owner_email", "data", "created_at", "updated_at", "source_system", "source_deployment", "source_id", "source_record"),
        "looseDismissed": ("client_name", "loose_text", "cleared_by", "cleared_at", "source_system", "source_deployment", "source_id", "source_record"),
        "moneyGoals": ("owner_email", "month", "target", "clients", "counts", "updated_at", "source_system", "source_deployment", "source_id", "source_record"),
        "projections": ("week_start", "owner_email", "metric", "data", "updated_at", "source_deployment", "source_id", "source_record"),
        "renewalPlans": ("task_id", "client_name", "renewal_date", "data", "updated_at", "source_deployment", "source_id", "source_record"),
        "callBriefs": ("client_name", "key", "job_id", "status", "overall", "per_call", "at", "source_deployment", "source_id", "source_record"),
        "waThreads": ("source_app", "chat_id", "channel", "name", "client_name", "contact_id", "source", "is_group", "unread", "last_from_us", "silent_days", "draft", "draft_at", "recent", "last_at", "waiting_since", "synced_at", "creation_time", "source_deployment", "source_id", "source_record"),
        "replyDrafts": ("source_app", "chat_id", "status", "job_id", "draft", "at", "last_at", "creation_time", "source_deployment", "source_id", "source_record"),
    }
    result = {key: data.get(key) for key in fields[table]}
    for key in ("submitted_at",) if table == "eodReports" else ("source_created_at",) if table == "checks" else ("logged_at",) if table == "decisions" else ("set_at",) if table == "ceoTeamStatus" else ("created_at",) if table in ("planItems", "ceoAudit") else ("captured_at",) if table in ("ceoDaily", "ceoClientBilling") else ("cleared_at",) if table == "looseDismissed" else ("at",) if table == "callBriefs" else ("created_at", "updated_at") if table == "hotList" else ("updated_at",) if table in ("clientPrefs", "moneyGoals", "projections", "renewalPlans") else ("draft_at", "last_at", "waiting_since", "synced_at", "creation_time") if table == "waThreads" else ("at", "last_at", "creation_time") if table == "replyDrafts" else ():
        if result[key] is not None:
            value = datetime.fromisoformat(result[key].replace("Z", "+00:00"))
            if value.tzinfo is None:
                raise ValueError("Business history timestamps require a timezone")
            result[key] = value.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")
    if table == "ceoDaily":
        result["value"] = float(result["value"])
    if table == "ceoClientBilling":
        for field in ("mrr_usd", "ltv_usd", "next_payment_usd"):
            if result[field] is not None:
                result[field] = float(result[field])
    if table == "moneyGoals":
        if result["target"] is not None:
            result["target"] = float(result["target"])
        if result["clients"] is not None:
            result["clients"] = int(result["clients"])
    if table == "projections":
        result["week_start"] = _iso_day(result["week_start"], "projection week start")
        data_obj = dict(result["data"])
        data_obj["blood"] = float(data_obj["blood"])
        data_obj["stretch"] = float(data_obj["stretch"])
        if data_obj.get("actual") is not None:
            data_obj["actual"] = float(data_obj["actual"])
        result["data"] = data_obj
    if table == "renewalPlans":
        result["renewal_date"] = _iso_day(result["renewal_date"], "renewal date")
    return result

def durable_comparable_data(table, data):
    result = durable_guard_data(table, data)
    if table in ("eodReports", "decisions"):
        result.pop("source_row")
    return result


def durable_target_matches(table, data, deployment, source_id, targets):
    if table == "ceoClientBilling":
        return [row for row in targets if str(row.get("day")) == data["day"] and row.get("clickup_task_id") == data["clickup_task_id"]]
    if table == "ceoAudit":
        return [row for row in targets if row.get("source_system") == "convex"
                and (row.get("metadata") or {}).get("source_table") == table
                and (row.get("metadata") or {}).get("source_deployment") == deployment
                and (row.get("metadata") or {}).get("source_id") == source_id]
    if table == "members":
        return [row for row in targets if str(row.get("email", "")).lower() == data["email"]]
    if table == "ceoTeamStatus":
        return [row for row in targets if row.get("person_key") == data["person_key"]]
    if table == "ceoDaily":
        return [row for row in targets if str(row.get("day")) == data["day"] and row.get("metric") == data["metric"] and row.get("scope") == data["scope"]]
    if table == "feedback":
        return [row for row in targets if row.get("source_system") == "convex" and row.get("source_id") == source_id]
    if table in ("projections", "renewalPlans"):
        return [row for row in targets if row.get("source_id") == source_id]
    return [row for row in targets if row.get("source_deployment") == deployment and row.get("source_id") == source_id]


def durable_reconcile(snapshot, table, rows, inventory):
    target = DOMAIN_TABLES[table]
    complete = set(inventory.get("complete_tables", []))
    target_tables = inventory.get("tables", {})
    if target not in complete or "cockpit_runtime_imports" not in complete:
        raise ValueError(f"Complete canonical inventory missing for {target}/cockpit_runtime_imports")
    targets = target_tables[target]
    profile_map = {p.get("id"): p.get("client_name") for p in target_tables.get("cockpit_client_profiles", []) if p.get("id") is not None}
    imports = [item for item in target_tables["cockpit_runtime_imports"]
               if item.get("app") == snapshot["app"] and item.get("table_name") == table]
    previous = {item["source_id"]: item for item in imports}
    seen, operations = set(), []
    for source in rows:
        source_id = source["_id"]
        if source_id in seen:
            raise ValueError("Duplicate durable source identity")
        seen.add(source_id)
        data = durable_data(snapshot, table, source)
        if table == "looseDismissed" and isinstance(source.get("by"), str) and "@" in source["by"]:
            if "cockpit_members" not in complete:
                raise ValueError("Complete directory inventory is required for the recorded dismissal author")
            authors = [member for member in target_tables["cockpit_members"]
                       if str(member.get("email", "")).strip().lower() == source["by"].strip().lower()
                       and member.get("auth_user_id")]
            if len(authors) > 1:
                raise ValueError("Recorded dismissal author is ambiguous")
            if authors:
                data["cleared_by"] = authors[0]["auth_user_id"]
        names = client_names(snapshot["app"], table, source, snapshot["tables"])
        prior = previous.get(source_id)
        if prior and prior.get("tombstone"):
            raise ValueError("protected import tombstone")
        matches = durable_target_matches(table, data, snapshot["deployment"], source_id, targets)
        if not matches:
            if table == "checks":
                logical = [item for item in targets if item.get("role") == data["role"] and
                           str(item.get("day")) == data["day"] and item.get("check_key") == data["check_key"]]
                if logical:
                    raise ValueError("protected logical checklist row has a different source identity")
            elif table == "clientPrefs":
                if any((profile_map.get(item.get("client_profile_id")) or item.get("client_name", "")).strip().lower() == data["client_name"].strip().lower() for item in targets):
                    raise ValueError("Protected client preference has a different source identity")
            elif table == "hotList":
                if any(item.get("key") == data["key"] for item in targets):
                    raise ValueError("Protected hot list row has a different source identity")
            elif table == "looseDismissed":
                if any((profile_map.get(item.get("client_profile_id")) or item.get("client_name", "")).strip().lower() == data["client_name"].strip().lower() and item.get("loose_text") == data["loose_text"] for item in targets):
                    raise ValueError("Protected loose dismissal has a different source identity")
            elif table == "moneyGoals":
                if any(str(item.get("owner_email", "")).strip().lower() == data["owner_email"].strip().lower() and str(item.get("month")) == data["month"] for item in targets):
                    raise ValueError("Protected money goal has a different source identity")
            elif table == "projections":
                if any(str(item.get("week_start")) == data["week_start"] and str(item.get("owner_email", "")).strip().lower() == data["owner_email"].strip().lower() and item.get("metric") == data["metric"] for item in targets):
                    raise ValueError("Protected projection has a different source identity")
            elif table == "renewalPlans":
                if any(item.get("task_id") == data["task_id"] and str(item.get("renewal_date")) == data["renewal_date"] for item in targets):
                    raise ValueError("Protected renewal plan has a different source identity")
            elif table == "callBriefs":
                if any(item.get("client_name") == data["client_name"] and item.get("key") == data["key"] for item in targets):
                    raise ValueError("Protected call brief has a different source identity")
            elif table == "waThreads":
                if any(item.get("chat_id") == data["chat_id"] and item.get("source_app") == data["source_app"] for item in targets):
                    raise ValueError("Protected WhatsApp thread capture has a different source identity")
            elif table == "replyDrafts":
                if any(item.get("chat_id") == data["chat_id"] and item.get("source_app") == data["source_app"] and str(item.get("at")) == data["at"] for item in targets):
                    raise ValueError("Protected WhatsApp draft version has a different source identity")
        if len(matches) > 1:
            raise ValueError("Ambiguous durable target identity")
        current = matches[0] if matches else None
        if current is None and prior:
            raise ValueError("previously imported durable target disappeared")
        guard = durable_guard_data(table, data)
        if current is not None and table != "members":
            actual_row = current
            if table in ("clientPrefs", "looseDismissed"):
                actual_row = dict(actual_row)
                if "client_name" not in actual_row and actual_row.get("client_profile_id") in profile_map:
                    actual_row["client_name"] = profile_map[actual_row["client_profile_id"]]
            actual = durable_guard_data(table, actual_row)
            if target_guard_hash(durable_comparable_data(table, actual)) != target_guard_hash(durable_comparable_data(table, guard)):
                raise ValueError(f"Protected durable source differs from canonical {target}/{source_id}")
            if table in ("eodReports", "decisions") and (current.get("source_row") or {}) not in ({}, data.get("source_row")):
                raise ValueError(f"Protected durable source evidence differs from canonical {target}/{source_id}")
            if prior and target_guard_hash(actual) != target_guard_hash(prior.get("target_data")):
                raise ValueError(f"Previously imported durable target drifted: {target}/{source_id}")
        action = "insert" if current is None else "preserve" if table == "members" else "enrich" if table in ("eodReports", "decisions") and not (current.get("source_row") or {}) else "adopt" if prior is None else "existing"
        operations.append({"source_id": source_id, "data": data, "ledger_data": guard,
                           "client_names": names, "action": action})
    retirements = []
    if table not in ("members", "ceoAudit"):
        for source_id, prior in previous.items():
            if source_id in seen or prior.get("tombstone"):
                continue
            matches = durable_target_matches(table, prior["target_data"], prior.get("target_data", {}).get("source_deployment"), source_id, targets)
            if len(matches) != 1:
                raise ValueError(f"Previously imported durable target disappeared: {target}/{source_id}")
            matched_row = matches[0]
            if table in ("clientPrefs", "looseDismissed"):
                matched_row = dict(matched_row)
                if "client_name" not in matched_row and matched_row.get("client_profile_id") in profile_map:
                    matched_row["client_name"] = profile_map[matched_row["client_profile_id"]]
            if target_guard_hash(durable_guard_data(table, matched_row)) != target_guard_hash(prior["target_data"]):
                raise ValueError(f"Previously imported durable target drifted: {target}/{source_id}")
            retirements.append({"source_id": source_id})
    return {"app": snapshot["app"], "table": table, "target": target, "kind": "durable",
            "deployment": snapshot["deployment"], "source_sha256": snapshot["sha256"],
            "table_sha256": snapshot["table_hashes"][table], "source_snapshot_at": snapshot["captured_at"],
            "source_count": len(rows), "rows": operations, "retirements": retirements}

def statistics_key(table, row):
    if table == "dailyStats":
        return (row.get("campaignName"), row.get("date"), row.get("metaAdId", row.get("adName", "")), row.get("adSetName", ""))
    if table != "bookingEvents":
        raise ValueError("Unsupported statistics table")
    identity = next((row.get(field) for field in ("eventId", "id", "contactId") if row.get(field) not in (None, "")), None)
    if identity is None:
        source_id = row.get("_id")
        if not isinstance(source_id, str) or not source_id:
            raise ValueError("Booking event identity is unavailable")
        return ("legacy-source-row", source_id)
    return (row.get("campaignName"), row.get("locationId", ""), identity, row.get("startTime", row.get("date")))

def validate_source_inventory(state, rows, label, count_field, stamped_rows=False):
    ready, count, stamp = state.get("ready"), state.get(count_field), state.get("source_snapshot_at")
    if ready is True:
        if not isinstance(count, int) or isinstance(count, bool) or not isinstance(stamp, str):
            raise ValueError(f"Ready source {label} lacks exact count or snapshot")
        try:
            snapshot_at = datetime.fromisoformat(stamp.replace("Z", "+00:00"))
        except ValueError:
            raise ValueError(f"Ready source {label} has an invalid snapshot") from None
        if snapshot_at.tzinfo is None or snapshot_at > datetime.now(timezone.utc) + timedelta(minutes=1):
            raise ValueError(f"Ready source {label} has an invalid snapshot")
        if count != len(rows):
            raise ValueError(f"Ready source {label} count does not match the complete target rows")
        if stamped_rows and any(row.get("source_snapshot_at") != stamp for row in rows):
            raise ValueError(f"Ready source {label} contains mixed snapshots")
        return
    if ready is not False or count is not None or stamp is not None or rows:
        raise ValueError(f"Uninitialized source {label} contains rows or partial readiness")


def build_plan(snapshots, inventory, scope):
    blockers = []
    if inventory.get("project_ref") != PROJECT_REF:
        blockers.append("Target inventory is not Creative Triage")
    fresh(inventory.get("captured_at"), "Target inventory", blockers)
    complete = set(inventory.get("complete_tables", []))
    target_tables = inventory.get("tables", {})
    if set(target_tables) != complete:
        blockers.append("Complete target inventory table manifest mismatch")
    sources = {snapshot["app"]: snapshot for snapshot in snapshots}
    if len(sources) != len(snapshots):
        blockers.append("Duplicate application snapshots")
    classifications = []
    for snapshot in snapshots:
        fresh(snapshot.get("captured_at"), snapshot["app"], blockers)
        for table, rows in snapshot["tables"].items():
            kind, target = classify(snapshot["app"], table)
            classifications.append({"app": snapshot["app"], "table": table, "kind": kind, "target": target, "count": len(rows), "sha256": content_hash(rows), "pending_quarantined": sum(queue_pending(snapshot["app"], table, row) for row in rows)})
    if len(scope) != len(set(scope)):
        blockers.append("Duplicate scope")
    operations = []
    imports = target_tables.get("cockpit_runtime_imports", [])
    if "cockpit_runtime_imports" not in complete:
        blockers.append("Prior import inventory missing")
    for scoped in scope:
        try:
            app, table = scoped.split("/", 1)
            snapshot = sources[app]
            rows = snapshot["tables"][table]
            if snapshot.get("table_hashes", {}).get(table) != content_hash(rows):
                raise ValueError("Source table checksum mismatch")
            kind, target = classify(app, table)
            if kind == "unsupported":
                raise ValueError(f"Unsupported durable table: {app}/{table}")
            if kind in ("invalidate", "quarantine", "metadata", "archive"):
                continue
            if kind == "durable":
                operations.append(durable_reconcile(snapshot, table, rows, inventory))
                continue
            if kind == "mirror":
                if target not in complete:
                    raise ValueError(f"Complete target inventory missing: {target}")
                shaped = [rewrite_files(row, app, inventory.get("files", {})) for row in rows]
                entries, conflicts, unchanged = core.reconcile_mirrors(target, shaped, target_tables[target], snapshot["deployment"], snapshot_evidence={"complete": True, "exported_at": snapshot["captured_at"], "archive_sha256": snapshot["sha256"]})
                if conflicts:
                    raise ValueError(f"Protected mirror conflicts: {len(conflicts)}")
                operations.append({"app": app, "table": table, "kind": "mirror", "entries": entries, "unchanged": unchanged})
                continue
            if kind == "statistics":
                if target not in complete or "cockpit_media_feed_state" not in complete:
                    raise ValueError("Complete statistics inventory missing")
                states = [state for state in target_tables["cockpit_media_feed_state"] if state["feed"] == table]
                if len(states) != 1:
                    raise ValueError("Statistics source_state missing or ambiguous")
                current_stats = target_tables[target]
                validate_source_inventory(states[0], current_stats, table, "source_rows")
                target_stamp = states[0].get("source_snapshot_at")
                if target_stamp and datetime.fromisoformat(target_stamp.replace("Z", "+00:00")) > datetime.fromisoformat(snapshot["captured_at"].replace("Z", "+00:00")):
                    raise ValueError("protected target statistics source is newer than archive")
                previous = {r["source_id"]: r for r in imports if r["app"] == app and r["table_name"] == table}
                seen = set()
                for row in rows:
                    if not row.get("campaignName") or not row.get("date"):
                        raise ValueError("Statistics identity missing")
                    grain = statistics_key(table, row)
                    if grain in seen:
                        raise ValueError("Duplicate statistics grain")
                    seen.add(grain)
                    matched = [r for r in current_stats if statistics_key(table, r["data"]) == grain]
                    if len(matched) > 1:
                        raise ValueError("Ambiguous target statistics grain")
                    prior = previous.get(row["_id"])
                    if prior and prior.get("tombstone"):
                        raise ValueError("Protected statistics tombstone")
                    current = {"data": matched[0]["data"], "client_names": []} if matched else None
                    guard_existing(current, {"data": row, "client_names": []}, prior)
                operations.append({"app": app, "table": table, "kind": "statistics", "deployment": snapshot["deployment"], "source_count": len(rows), "source_sha256": snapshot["sha256"], "table_sha256": snapshot["table_hashes"][table], "source_snapshot_at": snapshot["captured_at"], "rows": rows})
                continue
            if kind != "source":
                raise ValueError(f"Canonical coverage prerequisite for {kind} table: {table}")
            family = FAMILIES[app]
            state_table = f"cockpit_{family}_source_state"
            if target not in complete or state_table not in complete:
                raise ValueError(f"Complete target inventory missing: {target}/{state_table}")
            states = [row for row in target_tables[state_table] if row["table_name"] == table]
            if len(states) != 1:
                raise ValueError("Canonical source_state row missing or ambiguous")
            source_rows = [row for row in target_tables[target] if row["table_name"] == table]
            validate_source_inventory(states[0], source_rows, f"{family}/{table}", "row_count", stamped_rows=True)
            target_stamp = states[0].get("source_snapshot_at")
            if target_stamp and datetime.fromisoformat(target_stamp.replace("Z", "+00:00")) > datetime.fromisoformat(snapshot["captured_at"].replace("Z", "+00:00")):
                raise ValueError("protected target source is newer than archive")
            current = {row["source_id"]: row for row in source_rows}
            previous = {row["source_id"]: row for row in imports if row["app"] == app and row["table_name"] == table}
            desired = []
            for row in rows:
                source = rewrite_files(row, app, inventory.get("files", {}))
                next_row = {"source_id": row["_id"], "data": source, "client_names": client_names(app, table, source, snapshot["tables"]), "source_snapshot_at": snapshot["captured_at"]}
                guard_existing(current.get(row["_id"]), next_row, previous.get(row["_id"]))
                desired.append(next_row)
            wanted = {row["source_id"] for row in desired}
            for source_id, row in current.items():
                if source_id not in wanted:
                    prior = previous.get(source_id)
                    if not prior or prior.get("tombstone") or row["data"] != prior["target_data"] or row["client_names"] != prior["target_clients"]:
                        raise ValueError("protected absent source row")
            operations.append({"app": app, "table": table, "kind": "source", "source_count": len(desired), "source_sha256": snapshot["sha256"], "table_sha256": snapshot["table_hashes"][table], "source_snapshot_at": snapshot["captured_at"], "rows": desired})
        except (ValueError, KeyError, TypeError) as error:
            blockers.append(f"{scoped}: {error}")
    return {"version": 1, "project_ref": PROJECT_REF, "created_at": datetime.now(timezone.utc).isoformat(), "scope": scope,
            "scope_complete": bool(scope) and not blockers, "full_migration_complete": False, "blockers": blockers,
            "sources": [{key: value for key, value in snapshot.items() if key not in ("tables", "table_hashes")} for snapshot in snapshots],
            "classifications": classifications, "expected_tables": target_tables, "inventory_sha256": content_hash(inventory),
            "files": inventory.get("files", {}), "operations": operations}


def rpc(name, args, key):
    allowed = {"cockpit_native_bootstrap_inventory", "cockpit_native_media_claim", "cockpit_native_bootstrap_publish", "cockpit_native_media_release"}
    if name not in allowed:
        raise ValueError("Unapproved bootstrap RPC")
    request = urllib.request.Request(PROJECT_URL + "/rest/v1/rpc/" + name, data=json.dumps(args).encode(), method="POST",
                                     headers={"apikey": key, "Authorization": "Bearer " + key, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"Bootstrap repository operation failed ({error.code}); reconcile its run receipt before retry") from None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path)
    parser.add_argument("--inventory", type=Path)
    parser.add_argument("--scope", action="append", default=[])
    parser.add_argument("--plan", type=Path, required=True)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--plan-sha256")
    args = parser.parse_args()
    path = core.ensure_outside_repo(args.plan)
    if not args.apply:
        if not args.manifest or not args.inventory:
            parser.error("Dry run requires --manifest, --inventory and explicit --scope entries")
        manifest = json.loads(core.ensure_outside_repo(args.manifest).read_text(encoding="utf-8"))
        inventory = json.loads(core.ensure_outside_repo(args.inventory).read_text(encoding="utf-8"))
        snapshots = [load_snapshot(item) for item in manifest["snapshots"]]
        plan = build_plan(snapshots, inventory, args.scope)
        path.parent.mkdir(parents=True, exist_ok=True)
        data = json.dumps(plan, sort_keys=True, indent=2, ensure_ascii=False, allow_nan=False).encode()
        descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        with os.fdopen(descriptor, "wb") as output:
            output.write(data)
        print(json.dumps({"dry_run": True, "scope_complete": plan["scope_complete"], "blockers": len(plan["blockers"]), "plan_sha256": hashlib.sha256(data).hexdigest(), "plan": str(path)}))
        return
    if not args.plan_sha256 or file_hash(path) != args.plan_sha256:
        raise ValueError("Reviewed plan file checksum mismatch")
    plan = json.loads(path.read_text(encoding="utf-8"))
    if plan.get("project_ref") != PROJECT_REF or plan.get("scope_complete") is not True or plan.get("blockers"):
        raise ValueError("Blocked or wrong-target plan cannot apply")
    blockers = []
    fresh(plan.get("created_at"), "Plan", blockers)
    for source in plan["sources"]:
        fresh(source.get("captured_at"), source["app"], blockers)
        if file_hash(source["path"]) != source["sha256"]:
            blockers.append("Archive checksum changed")
    if blockers:
        raise ValueError("; ".join(blockers))
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    core.validate_project_url(os.environ.get("SUPABASE_URL", PROJECT_URL))
    if not key:
        raise ValueError("SUPABASE_SERVICE_ROLE_KEY required only for explicit apply")
    receipt_path = path.with_suffix(path.suffix + ".receipt.json")
    if receipt_path.exists():
        saved = json.loads(receipt_path.read_text(encoding="utf-8"))
        if saved.get("plan_sha256") != args.plan_sha256:
            raise ValueError("Existing run receipt belongs to a different reviewed plan")
        claim = saved["claim"]
    else:
        claim = rpc("cockpit_native_media_claim", {"p_run_id": str(uuid.uuid4())}, key)
        # Persist the fence before the write so an uncertain response can be reconciled.
        descriptor = os.open(receipt_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as output:
            json.dump({"claim": claim, "plan_sha256": args.plan_sha256, "status": "claimed"}, output)
    try:
        receipt = rpc("cockpit_native_bootstrap_publish", {"p_run_id": claim["run_id"], "p_lease_token": claim["lease_token"], "p_plan": plan, "p_plan_sha": args.plan_sha256}, key)
    except Exception:
        try:
            rpc("cockpit_native_media_release", {"p_run_id": claim["run_id"], "p_lease_token": claim["lease_token"], "p_error": "Finite bootstrap failed", "p_receipts": []}, key)
        except Exception:
            pass  # Original uncertainty and saved fence remain authoritative.
        raise
    receipt_path.write_text(json.dumps({"claim": claim, "plan_sha256": args.plan_sha256, "publication": receipt}), encoding="utf-8")
    print(json.dumps(receipt))


if __name__ == "__main__":
    main()
