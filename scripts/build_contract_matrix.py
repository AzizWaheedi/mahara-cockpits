#!/usr/bin/env python3
"""
Build Complete Contract Matrix for Mahara Cockpits Convex -> Supabase migration.
Scans:
- Frontend usage of Convex in all 5 apps
- Backend declarations in convex/ across all apps
- HTTP routes in convex/http.ts
- Crons in convex/crons.ts
- Tables in convex/schema.ts
- Existing Supabase migrations and RPCs
"""

import os
import re
import json
from collections import defaultdict
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

apps = [
    "media-buyer-cockpit",
    "client-success-cockpit",
    "creative-director-cockpit",
    "video-editor-cockpit",
    "sales-cockpit"
]

print("Scanning frontend Convex calls...")
frontend_calls = defaultdict(lambda: defaultdict(list))
pattern = re.compile(r'api\.([a-zA-Z0-9_]+)\.([a-zA-Z0-9_]+)')

for app in apps:
    src_dir = REPO_ROOT / "apps" / app / "src"
    if src_dir.exists():
        for p in src_dir.rglob("*.ts*"):
            try:
                txt = p.read_text(encoding="utf-8")
                for mod, func in pattern.findall(txt):
                    frontend_calls[app][f"{mod}.{func}"].append(str(p.relative_to(REPO_ROOT / "apps" / app)))
            except Exception:
                pass

print("Scanning backend Convex definitions...")
backend_defs = defaultdict(lambda: defaultdict(list))
func_pat = re.compile(r'export\s+const\s+([a-zA-Z0-9_]+)\s*=\s*(query|mutation|action|internalQuery|internalMutation|internalAction)\(')

for app in ["media-buyer-cockpit", "client-success-cockpit", "creative-director-cockpit"]:
    convex_dir = REPO_ROOT / "apps" / app / "convex"
    if convex_dir.exists():
        for p in convex_dir.rglob("*.ts"):
            if "_generated" in str(p) or p.name.endswith(".d.ts"):
                continue
            mod_name = str(p.relative_to(convex_dir)).replace("\\", "/").replace(".ts", "")
            try:
                txt = p.read_text(encoding="utf-8")
                for fn, kind in func_pat.findall(txt):
                    backend_defs[app][f"{mod_name}.{fn}"].append(kind)
            except Exception:
                pass

print("Scanning HTTP routes...")
http_routes = defaultdict(list)
route_pat = re.compile(r'path:\s*["\']([^"\']+)["\'],\s*method:\s*["\']([^"\']+)["\']')

for app in ["media-buyer-cockpit", "client-success-cockpit", "creative-director-cockpit"]:
    http_file = REPO_ROOT / "apps" / app / "convex" / "http.ts"
    if http_file.exists():
        txt = http_file.read_text(encoding="utf-8")
        for p, m in route_pat.findall(txt):
            http_routes[app].append((m, p))

print("Scanning crons...")
cron_defs = defaultdict(list)
for app in ["media-buyer-cockpit", "client-success-cockpit", "creative-director-cockpit"]:
    cron_file = REPO_ROOT / "apps" / app / "convex" / "crons.ts"
    if cron_file.exists():
        txt = cron_file.read_text(encoding="utf-8")
        # Match crons.interval or crons.cron
        for line in txt.splitlines():
            s = line.strip()
            if s.startswith("crons.interval(") or s.startswith("crons.cron(") or s.startswith("crons.daily(") or s.startswith("crons.weekly("):
                cron_defs[app].append(s)

print("Scanning schema tables...")
schema_tables = defaultdict(list)
table_pat = re.compile(r'([a-zA-Z0-9_]+):\s*defineTable\(')
for app in ["media-buyer-cockpit", "client-success-cockpit", "creative-director-cockpit"]:
    schema_file = REPO_ROOT / "apps" / app / "convex" / "schema.ts"
    if schema_file.exists():
        txt = schema_file.read_text(encoding="utf-8")
        for tbl in table_pat.findall(txt):
            schema_tables[app].append(tbl)

output = {
    "frontend_calls": {app: {k: sorted(list(set(v))) for k, v in calls.items()} for app, calls in frontend_calls.items()},
    "backend_defs": {app: dict(defs) for app, defs in backend_defs.items()},
    "http_routes": {app: sorted(list(set(r))) for app, r in http_routes.items()},
    "cron_defs": {app: crons for app, crons in cron_defs.items()},
    "schema_tables": {app: sorted(list(set(t))) for app, t in schema_tables.items()}
}

out_file = REPO_ROOT / "scripts" / "contract_inventory.json"
out_file.write_text(json.dumps(output, indent=2), encoding="utf-8")
print(f"Wrote full contract inventory to {out_file}")
