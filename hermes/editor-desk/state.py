import sys; sys.path.insert(0,".")
from desk.config import Config
from desk.supabase import Supabase
cfg=Config.from_env(); sb=Supabase(cfg.supabase_url,cfg.supabase_key,bucket=cfg.supabase_bucket)
jobs=sb.select("editor_jobs","select=*&order=opened_at.desc&limit=40")
cl={c["task_id"]:c for c in sb.clients()}
print(f"jobs: {len(jobs)} | clients stored: {len(cl)}")
for j in jobs:
    c=cl.get(j.get("client_task_id") or "")
    dd=len(str((c or {}).get("dos_donts") or "")); dna=len(str((c or {}).get("brand_dna") or "")); off=len(str((c or {}).get("offer") or ""))
    print(f"  {j['task_id']:<12} {str(j.get('client'))[:20]:<20} state={str(j.get('state')):<8} "
          f"-> {str((c or {}).get('name'))[:20]:<20} dd={dd:<5} dna={dna:<6} offer={off:<6} script={len(str(j.get('script') or '')):<5}")
