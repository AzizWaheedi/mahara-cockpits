"""Protected, add-only media history import. DRY_RUN=True unless a reviewed plan is supplied."""
from __future__ import annotations
import argparse
from datetime import date, datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import urllib.parse
import urllib.request
import urllib.error
import zipfile

DRY_RUN = True
URL = "https://bldgtotkfmhoxmlzowdx.supabase.co"
DEPLOYMENT = "adorable-seahorse-418"
TABLES = {"dailyStats": "cockpit_media_daily_stats", "bookingEvents": "cockpit_media_booking_events"}
REPO = Path(__file__).resolve().parents[1]

def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def protected(path):
    path = Path(path).resolve()
    if path.is_relative_to(REPO):
        raise ValueError("Source and financial artifacts must remain outside the repository")
    return path

def source_rows(snapshot):
    result = {}
    with zipfile.ZipFile(snapshot) as archive:
        for feed, table in TABLES.items():
            name = f"{feed}/documents.jsonl"
            if name not in archive.namelist():
                raise ValueError(f"Missing required source table: {feed}")
            rows, seen = [], set()
            for raw in archive.read(name).splitlines():
                if not raw.strip():
                    continue
                row = json.loads(raw)
                source_id, campaign, day = row.get("_id"), row.get("campaignName"), row.get("date")
                if not isinstance(source_id, str) or not source_id or source_id in seen:
                    raise ValueError(f"Missing or duplicate source identity in {feed}")
                if not isinstance(campaign, str) or not isinstance(day, str) or date.fromisoformat(day).isoformat() != day:
                    raise ValueError(f"Invalid campaign or day in {feed}")
                if feed == "dailyStats":
                    for key in ("spend", "leads", "impressions", "linkClicks"):
                        value = row.get(key)
                        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
                            raise ValueError(f"Invalid {key} in dailyStats")
                seen.add(source_id)
                rows.append({"source_deployment": DEPLOYMENT, "source_id": source_id,
                             "campaign_name": campaign, "day": day, "data": row})
            result[table] = rows
    return result

class Api:
    def __init__(self, key):
        self.headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}

    def request(self, path, method="GET", body=None):
        req = urllib.request.Request(URL + "/rest/v1/" + path, method=method,
            data=None if body is None else json.dumps(body, allow_nan=False).encode(),
            headers={**self.headers, "Prefer": "return=minimal"})
        try:
            with urllib.request.urlopen(req, timeout=90) as response:
                content = response.read()
                return json.loads(content) if content else None
        except urllib.error.HTTPError as exc:
            raise RuntimeError(f"Supabase {method} failed (HTTP {exc.code}); reconcile before retrying") from None
        except Exception as exc:
            # Do not print server bodies containing source records or authorization headers.
            raise RuntimeError(f"Supabase {method} failed ({type(exc).__name__}); reconcile before retrying") from None

    def rows(self, table):
        if table not in TABLES.values():
            raise ValueError("Unexpected import table")
        result, offset = [], 0
        while True:
            query = urllib.parse.urlencode({"select": "source_deployment,source_id,campaign_name,day,data",
                "source_deployment": f"eq.{DEPLOYMENT}", "order": "source_id.asc", "limit": 500, "offset": offset})
            page = self.request(table + "?" + query)
            if not isinstance(page, list):
                raise ValueError("Target read did not return rows")
            result.extend(page)
            if len(page) < 500:
                return result
            offset += len(page)

    def insert(self, table, rows):
        self.request(table, "POST", rows)

    def verify(self, table, rows):
        return self.request("rpc/cockpit_verify_media_import", "POST", {"p_table":table,"p_rows":rows})

    def state(self, feed, ready, count, snapshot_at):
        self.request("cockpit_media_feed_state?feed=eq." + feed, "PATCH", {
            "ready": ready, "source_rows": count, "source_snapshot_at": snapshot_at,
            "updated_at": datetime.now(timezone.utc).isoformat()})
        rows = self.request("cockpit_media_feed_state?select=ready,source_rows&feed=eq." + feed)
        if not isinstance(rows,list) or len(rows)!=1 or rows[0].get("ready") is not ready or rows[0].get("source_rows")!=count:
            raise ValueError("Feed state read-back did not confirm the change")

def compare(expected, existing):
    target = {r["source_id"]: r for r in existing}
    if len(target) != len(existing):
        raise ValueError("Duplicate target identities")
    wanted = {r["source_id"]: r for r in expected}
    extras = sorted(set(target) - set(wanted))
    conflicts = [key for key in wanted.keys() & target.keys() if wanted[key] != target[key]]
    if extras or conflicts:
        raise ValueError(f"Target/source conflict: {len(extras)} extra and {len(conflicts)} changed records; preserve and review")
    return [r for r in expected if r["source_id"] not in target]

def plan(snapshot, api, snapshot_at):
    snapshot = protected(snapshot)
    stamp = datetime.fromisoformat(snapshot_at.replace("Z","+00:00"))
    if stamp.tzinfo is None or stamp > datetime.now(timezone.utc):
        raise ValueError("Use the actual source export timestamp including its timezone")
    source = source_rows(snapshot)
    existing = {table: api.rows(table) for table in TABLES.values()}
    creates = {table: compare(source[table], existing[table]) for table in TABLES.values()}
    return {"version": 1, "dry_run": True, "project_url": URL, "snapshot": str(snapshot),
        "source_sha256": digest(snapshot), "snapshot_at": stamp.isoformat(),
        "expected": source, "before": existing, "creates": creates}

def apply(plan_path, expected_hash, api):
    path = protected(plan_path)
    if digest(path) != expected_hash:
        raise ValueError("Reviewed plan hash mismatch")
    p = json.loads(path.read_text(encoding="utf-8"))
    if p.get("version") != 1 or p.get("project_url") != URL:
        raise ValueError("Wrong plan version or destination project")
    if digest(protected(p["snapshot"])) != p["source_sha256"] or source_rows(p["snapshot"]) != p["expected"]:
        raise ValueError("Source archive changed")
    for table in TABLES.values():
        current = api.rows(table)
        if current != p["before"][table]:
            raise ValueError("Target changed since review; regenerate the plan")
        if compare(p["expected"][table], current) != p["creates"][table]:
            raise ValueError("Plan does not match the source/target difference")
    for feed, table in TABLES.items():
        rows = p["creates"][table]
        api.state(feed, False, len(p["expected"][table]), p["snapshot_at"])
        if rows:
            api.insert(table, rows[:1])
            remaining = compare(p["expected"][table], api.rows(table))
            if len(remaining) != len(rows) - 1:
                raise ValueError("Single-record read-back failed; remaining writes stopped")
            for start in range(1, len(rows), 250):
                api.insert(table, rows[start:start + 250])
        if compare(p["expected"][table], api.rows(table)):
            raise ValueError("Full read-back failed; feed remains unavailable")
        api.state(feed, True, len(p["expected"][table]), p["snapshot_at"])
    return {"live_writes": sum(len(v) for v in p["creates"].values()), "verified": {t: len(v) for t,v in p["expected"].items()}}

def finalize(plan_path, expected_hash, api):
    """Verify an interrupted import without repeating any record writes."""
    path=protected(plan_path)
    if digest(path)!=expected_hash:
        raise ValueError("Reviewed plan hash mismatch")
    p=json.loads(path.read_text(encoding="utf-8"))
    if p.get("version")!=1 or p.get("project_url")!=URL:
        raise ValueError("Wrong destination")
    if digest(protected(p["snapshot"]))!=p["source_sha256"] or source_rows(p["snapshot"])!=p["expected"]:
        raise ValueError("Source archive changed")
    for table,rows in p["expected"].items():
        for start in range(0,max(1,len(rows)),1000):
            batch=rows[start:start+1000]
            receipt=api.verify(table,batch)
            if receipt!={"matched":len(batch),"total":len(rows)}:
                raise ValueError("Import verification mismatch; no records replayed")
    for feed,table in TABLES.items():
        api.state(feed,True,len(p["expected"][table]),p["snapshot_at"])
    return {"record_writes":0,"verified":{t:len(v) for t,v in p["expected"].items()}}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--snapshot", type=Path)
    parser.add_argument("--snapshot-at", help="Actual export timestamp from the source export receipt")
    parser.add_argument("--plan-out", type=Path)
    parser.add_argument("--apply-plan", type=Path)
    parser.add_argument("--finalize-plan", type=Path, help="Verify stored rows and mark ready; never replay record writes")
    parser.add_argument("--plan-sha")
    parser.add_argument("--env-file", type=Path, default=Path("D:/MaharaMedia/mahara-cockpits/.env.local"))
    args = parser.parse_args()
    env = dict(os.environ)
    if args.env_file.exists():
        for line in args.env_file.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                key,value=line.split("=",1)
                env.setdefault(key.strip(),value.strip().strip("\"'"))
    key = env.get("COCKPIT_SUPABASE_SERVICE_ROLE_KEY") or env.get("SUPABASE_SERVICE_ROLE_KEY")
    if not key:
        raise ValueError("Named Supabase service credential is missing")
    api = Api(key)
    if args.apply_plan and args.finalize_plan:
        raise ValueError("Choose apply or finalize, not both")
    if args.finalize_plan:
        if not args.plan_sha:
            raise ValueError("Finalize requires the reviewed --plan-sha")
        print(json.dumps(finalize(args.finalize_plan,args.plan_sha,api)))
    elif args.apply_plan:
        if not args.plan_sha:
            raise ValueError("Apply requires the exact reviewed --plan-sha")
        print(json.dumps(apply(args.apply_plan,args.plan_sha,api)))
    else:
        if not args.snapshot or not args.plan_out or not args.snapshot_at:
            raise ValueError("Dry run requires --snapshot, --snapshot-at and --plan-out")
        output = protected(args.plan_out)
        if output.exists():
            raise ValueError("Plan exists; refusing overwrite")
        p = plan(args.snapshot,api,args.snapshot_at)
        output.write_text(json.dumps(p,ensure_ascii=False,allow_nan=False),encoding="utf-8")
        print(json.dumps({"dry_run":True,"live_writes":0,"creates":{t:len(v) for t,v in p["creates"].items()},"plan":str(output),"sha256":digest(output)}))

if __name__ == "__main__":
    main()
