import asyncio,json,re
from sdk.tools.mcp_supabase import supabase_execute_sql
Q="""
WITH d AS (
 SELECT cd.business_name, cd.contact_id, cd.phone_normalized, cd.closer, cd.lead_source, cd.matched_by,
   cd.ad_id deal_ad_id, cd.campaign_id deal_campaign_id,
   (cd.submitted_at AT TIME ZONE 'Asia/Riyadh')::date cdate, cd.cash_collected, cd.contracted_revenue
 FROM closed_deals cd
 WHERE (cd.submitted_at AT TIME ZONE 'Asia/Riyadh')::date BETWEEN '2026-08-01' AND '2026-09-02'
   AND cd.contracted_revenue::numeric > 100
)
SELECT d.business_name, d.cdate, d.contracted_revenue, d.closer, d.lead_source, d.matched_by,
 d.deal_ad_id, d.deal_campaign_id,
 l.ad_id lead_ad_id, l.source lead_src, l.tags,
 (l.lead_created_at AT TIME ZONE 'Asia/Riyadh')::date lead_date,
 (SELECT string_agg(DISTINCT c.ad_id, ',') FROM calls c WHERE c.contact_id=d.contact_id AND c.ad_id IS NOT NULL) call_ad_ids,
 (SELECT min((c.start_at AT TIME ZONE 'Asia/Riyadh')::date)::text FROM calls c WHERE c.contact_id=d.contact_id AND c.call_type='demo') demo_date,
 mA.ad_name deal_ad_name, mB.ad_name lead_ad_name
FROM d
LEFT JOIN leads l ON l.contact_id = d.contact_id
LEFT JOIN LATERAL (SELECT DISTINCT ON (ad_id) ad_name FROM meta_ad_snapshots WHERE ad_id=d.deal_ad_id ORDER BY ad_id,date DESC) mA ON true
LEFT JOIN LATERAL (SELECT DISTINCT ON (ad_id) ad_name FROM meta_ad_snapshots WHERE ad_id=l.ad_id ORDER BY ad_id,date DESC) mB ON true
ORDER BY d.cdate
"""
def ex(r):
    import ast
    s=r
    if isinstance(s,str): s=ast.literal_eval(s)
    s=json.loads(s["content"])["result"]
    ms=re.findall(r"<untrusted-data-[^>]+>\s*(\[.*?\])\s*</untrusted-data",s,re.S)
    return json.loads(ms[-1])
async def m():
    r=await supabase_execute_sql(project_id="flwboeijllbtrufxkhts",query=Q)
    print(json.dumps(ex(r),ensure_ascii=False,indent=1))
asyncio.run(m())

