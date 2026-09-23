r"""
Phase 3: Consolidated One-Time Snapshot Import Tool.
Reads production snapshots from D:\secure\ and reconciles into Supabase (bldgtotkfmhoxmlzowdx).

Default: DRY_RUN = True.
Pass --commit to execute live writes.
"""

import sys
import json
import zipfile
import urllib.request
import urllib.parse
from pathlib import Path
from datetime import datetime, timezone

PROJECT_REF = "bldgtotkfmhoxmlzowdx"
PROJECT_URL = f"https://{PROJECT_REF}.supabase.co"
ENV_PATH = Path(r"D:\MaharaMedia\mahara-cockpits\.env.local")

MB_ZIP = Path(r"D:\secure\snapshot-media-buyer-adorable-seahorse-418-20260923.zip")
CS_ZIP = Path(r"D:\secure\snapshot-client-success-impressive-dinosaur-375-20260923.zip")
CD_ZIP = Path(r"D:\secure\snapshot-creative-director-colorful-wombat-644-20260923.zip")

is_commit = "--commit" in sys.argv
dry_run = not is_commit

print("=" * 60)
print(f"Snapshot Data Import Tool | DRY_RUN = {dry_run}")
print("=" * 60)

# 1. Read Supabase Service Role Key
service_key = None
for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
    if line.startswith("SUPABASE_SERVICE_ROLE_KEY="):
        service_key = line.split("=", 1)[1].strip().strip("\"'")
        break

if not service_key:
    raise SystemExit("Missing SUPABASE_SERVICE_ROLE_KEY in .env.local")

headers = {
    "apikey": service_key,
    "Authorization": f"Bearer {service_key}",
    "Content-Type": "application/json",
    "Prefer": "return=minimal"
}

def post_rest(table, rows, on_conflict=None):
    if dry_run or not rows:
        return
    url = f"{PROJECT_URL}/rest/v1/{table}"
    req_headers = dict(headers)
    if on_conflict:
        url += f"?on_conflict={on_conflict}"
        req_headers["Prefer"] = "return=minimal,resolution=merge-duplicates"
    req = urllib.request.Request(url, data=json.dumps(rows).encode("utf-8"), headers=req_headers, method="POST")
    try:
        with urllib.request.urlopen(req) as resp:
            pass
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"REST POST {table} failed (HTTP {e.code}): {err_body}")

def fetch_rest(table, select="*"):
    url = f"{PROJECT_URL}/rest/v1/{table}?select={select}&limit=5000"
    req = urllib.request.Request(url, headers={"apikey": service_key, "Authorization": f"Bearer {service_key}"})
    with urllib.request.urlopen(req) as resp:
        return json.load(resp)

def read_jsonl_from_zip(zip_path, table_name):
    docs = []
    with zipfile.ZipFile(zip_path, "r") as zf:
        filename = f"{table_name}/documents.jsonl"
        if filename in zf.namelist():
            with zf.open(filename) as f:
                for line in f:
                    if line.strip():
                        docs.append(json.loads(line))
    return docs

def ms_to_iso(ms):
    if ms is None:
        return None
    try:
        return datetime.fromtimestamp(ms / 1000.0, timezone.utc).isoformat()
    except Exception:
        return None

# ==============================================================================
# A. Members Reconciliation
# ==============================================================================
print("\n--- 1. Reconciling Members ---")
existing_members = {m["email"].lower(): m for m in fetch_rest("cockpit_members")}
mb_members = read_jsonl_from_zip(MB_ZIP, "members")
members_to_insert = []

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
            "active": True
        }
        members_to_insert.append(row)
        print(f"  [+] Member to add: {email} ({row['roles']})")

if members_to_insert:
    post_rest("cockpit_members", members_to_insert, on_conflict="email")
    print(f"  -> {len(members_to_insert)} member(s) staged.")
else:
    print("  -> All members already present.")

# ==============================================================================
# B. Daily Checks Reconciliation
# ==============================================================================
print("\n--- 2. Reconciling Daily Checks ---")
existing_checks_source = {
    (c.get("source_deployment"), c.get("source_id")): c
    for c in fetch_rest("cockpit_daily_checks", "source_deployment,source_id")
    if c.get("source_deployment") and c.get("source_id")
}
existing_logical_checks = {
    (c.get("role"), str(c.get("day")), c.get("check_key")): c
    for c in fetch_rest("cockpit_daily_checks", "role,day,check_key")
    if c.get("role") and c.get("day") and c.get("check_key")
}

role_to_owner = {
    "media_buyer": "media-buyer",
    "csm": "client-success",
    "creative": "creative-director"
}

checks_to_insert = []
for dep_name, zip_path in [("adorable-seahorse-418", MB_ZIP), ("impressive-dinosaur-375", CS_ZIP)]:
    docs = read_jsonl_from_zip(zip_path, "checks")
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
                "source_snapshot_ts": "2026-09-23T00:00:00Z",
                "source_row": d,
                "changed_by": d.get("changedBy") or "migration@maharamedia.com",
                "source_revision": int(d.get("revision", 1)),
                "source_deleted": False
            }
            checks_to_insert.append(row)
            existing_logical_checks[logical_key] = row

print(f"  Existing checks in Supabase: {len(existing_checks_source)}")
print(f"  Checks to insert from snapshots: {len(checks_to_insert)}")
if checks_to_insert:
    # Post in chunks of 50
    for i in range(0, len(checks_to_insert), 50):
        chunk = checks_to_insert[i:i+50]
        post_rest("cockpit_daily_checks", chunk)
    print(f"  -> {len(checks_to_insert)} daily check(s) staged.")

# ==============================================================================
# C. Feedback / Issue Reports Reconciliation
# ==============================================================================
print("\n--- 3. Reconciling Issue Reports / Feedback ---")
existing_issues = {
    i.get("source_id"): i
    for i in fetch_rest("cockpit_issue_reports", "source_id")
    if i.get("source_id")
}

issues_to_insert = []
for dep_name, zip_path in [("adorable-seahorse-418", MB_ZIP), ("impressive-dinosaur-375", CS_ZIP)]:
    docs = read_jsonl_from_zip(zip_path, "feedback")
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
                "metadata": d
            }
            issues_to_insert.append(row)

print(f"  Existing issue reports in Supabase: {len(existing_issues)}")
print(f"  Issue reports to insert: {len(issues_to_insert)}")
if issues_to_insert:
    post_rest("cockpit_issue_reports", issues_to_insert)
    print(f"  -> {len(issues_to_insert)} issue report(s) staged.")

# ==============================================================================
# D. EOD Reports Reconciliation
# ==============================================================================
print("\n--- 4. Reconciling EOD Reports ---")
existing_eod = {
    (e.get("source_deployment"), e.get("source_id")): e
    for e in fetch_rest("cockpit_eod_reports", "source_deployment,source_id")
    if e.get("source_deployment") and e.get("source_id")
}

eod_to_insert = []
mb_eod = read_jsonl_from_zip(MB_ZIP, "eodReports")
for d in mb_eod:
    key = ("adorable-seahorse-418", d["_id"])
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
            "source_deployment": "adorable-seahorse-418",
            "source_id": d["_id"]
        }
        eod_to_insert.append(row)

print(f"  Existing EOD reports in Supabase: {len(existing_eod)}")
print(f"  EOD reports to insert: {len(eod_to_insert)}")
if eod_to_insert:
    post_rest("cockpit_eod_reports", eod_to_insert, on_conflict="source_deployment,source_id")
    print(f"  -> {len(eod_to_insert)} EOD report(s) staged.")

# ==============================================================================
# E. Campaigns Reconciliation
# ==============================================================================
print("\n--- 5. Reconciling Campaigns ---")
existing_campaigns = {
    (c.get("source_deployment"), c.get("source_id")): c
    for c in fetch_rest("cockpit_campaigns", "source_deployment,source_id")
    if c.get("source_deployment") and c.get("source_id")
}

clients_map = {c["name"].lower(): c["id"] for c in fetch_rest("clients", "id,name")}

campaigns_to_insert = []
mb_campaigns = read_jsonl_from_zip(MB_ZIP, "campaigns")
for d in mb_campaigns:
    key = ("adorable-seahorse-418", d["_id"])
    if key not in existing_campaigns:
        c_name = d.get("campaignName", d.get("name", ""))
        row = {
            "client_id": clients_map.get(c_name.lower()),
            "client_name": c_name,
            "meta_account_id": d.get("metaAccountId"),
            "meta_campaign_id": d.get("metaCampaignId"),
            "task_id": d.get("taskId"),
            "task_url": d.get("taskUrl"),
            "service_mode": d.get("serviceMode"),
            "verdict": d.get("verdict"),
            "reason": d.get("reason"),
            "rank": d.get("rank"),
            "spend_7d": d.get("spend7d", 0),
            "spend_today": d.get("spendToday", 0),
            "leads_7d": d.get("leads7d", 0),
            "leads_today": d.get("leadsToday", 0),
            "cpl": d.get("cpl"),
            "frequency": d.get("frequency"),
            "link_ctr": d.get("linkCtr"),
            "opt_in_rate": d.get("optInRate"),
            "synced_at": ms_to_iso(d.get("syncedAt")),
            "raw_data": d,
            "source_system": "convex",
            "source_deployment": "adorable-seahorse-418",
            "source_id": d["_id"]
        }
        campaigns_to_insert.append(row)

print(f"  Existing campaigns in Supabase: {len(existing_campaigns)}")
print(f"  Campaigns to insert: {len(campaigns_to_insert)}")
if campaigns_to_insert:
    post_rest("cockpit_campaigns", campaigns_to_insert, on_conflict="source_deployment,source_id")
    print(f"  -> {len(campaigns_to_insert)} campaign(s) staged.")

# ==============================================================================
# F. Ads Reconciliation
# ==============================================================================
print("\n--- 6. Reconciling Ads ---")
existing_ads = {
    (a.get("source_deployment"), a.get("source_id")): a
    for a in fetch_rest("cockpit_ads", "source_deployment,source_id")
    if a.get("source_deployment") and a.get("source_id")
}

ads_to_insert = []
mb_ads = read_jsonl_from_zip(MB_ZIP, "ads")
for d in mb_ads:
    key = ("adorable-seahorse-418", d["_id"])
    if key not in existing_ads:
        row = {
            "campaign_name": d.get("campaignName", ""),
            "ad_name": d.get("adName", ""),
            "meta_ad_id": d.get("metaAdId"),
            "verdict": d.get("verdict"),
            "reason": d.get("reason"),
            "spend": d.get("spend", 0),
            "leads": d.get("leads", 0),
            "frequency": d.get("frequency"),
            "still_url": d.get("stillUrl"),
            "thumbnail_url": d.get("thumbnailUrl"),
            "synced_at": ms_to_iso(d.get("syncedAt")),
            "raw_data": d,
            "source_system": "convex",
            "source_deployment": "adorable-seahorse-418",
            "source_id": d["_id"]
        }
        ads_to_insert.append(row)

print(f"  Existing ads in Supabase: {len(existing_ads)}")
print(f"  Ads to insert: {len(ads_to_insert)}")
if ads_to_insert:
    post_rest("cockpit_ads", ads_to_insert, on_conflict="source_deployment,source_id")
    print(f"  -> {len(ads_to_insert)} ad(s) staged.")

# ==============================================================================
# G. Decisions Reconciliation
# ==============================================================================
print("\n--- 7. Reconciling Decisions ---")
existing_decisions = {
    (dec.get("source_deployment"), dec.get("source_id")): dec
    for dec in fetch_rest("cockpit_decisions", "source_deployment,source_id")
    if dec.get("source_deployment") and dec.get("source_id")
}

decisions_to_insert = []
for dep_name, zip_path in [("adorable-seahorse-418", MB_ZIP), ("impressive-dinosaur-375", CS_ZIP)]:
    docs = read_jsonl_from_zip(zip_path, "decisions")
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
                "source_id": d["_id"]
            }
            decisions_to_insert.append(row)

print(f"  Existing decisions in Supabase: {len(existing_decisions)}")
print(f"  Decisions to insert: {len(decisions_to_insert)}")
if decisions_to_insert:
    post_rest("cockpit_decisions", decisions_to_insert, on_conflict="source_deployment,source_id")
    print(f"  -> {len(decisions_to_insert)} decision(s) staged.")

# ==============================================================================
# H. Client Profiles Reconciliation
# ==============================================================================
print("\n--- 8. Reconciling Client Profiles ---")
existing_profiles = {p["client_name"].lower(): p for p in fetch_rest("cockpit_client_profiles", "client_name")}

profiles_by_name = {}
cs_profiles = read_jsonl_from_zip(CS_ZIP, "clientProfiles")
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
            "lost": d.get("lost")
        },
        "provisional": d.get("provisional", {}),
        "synced_at": ms_to_iso(d.get("syncedAt")),
        "source_system": "convex",
        "source_deployment": "impressive-dinosaur-375",
        "source_id": d["_id"]
    }
    # Keep the richer record if duplicate name in snapshot
    if name_key not in profiles_by_name or (row["health"] and not profiles_by_name[name_key]["health"]):
        profiles_by_name[name_key] = row

profiles_to_insert = list(profiles_by_name.values())

print(f"  Existing client profiles in Supabase: {len(existing_profiles)}")
print(f"  Client profiles to insert: {len(profiles_to_insert)}")
if profiles_to_insert:
    post_rest("cockpit_client_profiles", profiles_to_insert, on_conflict="client_name")
    print(f"  -> {len(profiles_to_insert)} profile(s) staged.")

print("\n" + "=" * 60)
if dry_run:
    print("DRY RUN COMPLETE: No live writes executed.")
    print("Run with --commit to apply changes to Supabase.")
else:
    print("COMMIT COMPLETE: Live records written and reconciled in Supabase.")
print("=" * 60)
