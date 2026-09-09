import asyncio, json, re
from sdk.tools.mcp_supabase import supabase_execute_sql
P="flwboeijllbtrufxkhts"; import sys; S=sys.argv[1]; E=sys.argv[2]  # window fallback: use on month-rollover days when MTD sections are empty
Q={
"ads":f"""SELECT ad_id, ad_name, campaign_name, round(sum(spend)::numeric,2) spend, sum(inline_link_clicks) lc, sum(impressions) imp, sum(leads) meta_leads,
CASE WHEN sum(impressions)>0 THEN round((sum(inline_link_clicks)::numeric/sum(impressions)*100),2) END link_ctr,
CASE WHEN sum(inline_link_clicks)>0 AND sum(leads)>0 THEN round((sum(leads)::numeric/sum(inline_link_clicks)*100),1) ELSE 0 END lp_conv,
CASE WHEN sum(leads)>0 THEN round((sum(spend)/sum(leads))::numeric,2) END cpl,
max(date) last_active, count(distinct date) active_days
FROM meta_ad_snapshots WHERE date BETWEEN '{S}' AND '{E}' AND campaign_name NOT ILIKE '%%Hammer Them%%' AND campaign_name NOT ILIKE '%%CSM Hiring%%'
GROUP BY 1,2,3 HAVING sum(spend)>5 ORDER BY cpl ASC NULLS LAST""",
"quality":f"""SELECT l.ad_id, m.ad_name, COUNT(*) total_leads,
COUNT(*) FILTER (WHERE l.stage_name ~* 'Demo Booked|CONFIRMED|Closed|Hot Lead') qualified,
ROUND(100.0*COUNT(*) FILTER (WHERE l.stage_name ~* 'Demo Booked|CONFIRMED|Closed|Hot Lead')/NULLIF(COUNT(*),0),1) qualified_pct
FROM leads l LEFT JOIN LATERAL (SELECT DISTINCT ON (ad_id) ad_id, ad_name FROM meta_ad_snapshots WHERE ad_id=l.ad_id ORDER BY ad_id,date DESC) m ON true
WHERE l.is_lead AND l.ad_id IS NOT NULL AND (l.lead_created_at AT TIME ZONE 'Asia/Riyadh')::date BETWEEN '{S}' AND '{E}'
GROUP BY 1,2 ORDER BY total_leads DESC LIMIT 20""",
"intro":f"""SELECT COUNT(*) FILTER (WHERE status IN ('showed','confirmed') AND start_at<=now()) showed, COUNT(*) FILTER (WHERE status='noshow') noshow, COUNT(*) FILTER (WHERE status='cancelled') cancelled, COUNT(*) FILTER (WHERE status='invalid') invalid, COUNT(*) total FROM calls WHERE call_type='intro' AND (start_at AT TIME ZONE 'Asia/Riyadh')::date BETWEEN '{S}' AND '{E}'""",
"demo":f"""SELECT COUNT(*) FILTER (WHERE status IN ('showed','confirmed') AND start_at<=now()) showed, COUNT(*) FILTER (WHERE status='noshow') noshow, COUNT(*) FILTER (WHERE status='cancelled') cancelled, COUNT(*) FILTER (WHERE status='invalid') invalid, COUNT(*) total FROM calls WHERE call_type='demo' AND (start_at AT TIME ZONE 'Asia/Riyadh')::date BETWEEN '{S}' AND '{E}'""",
"leadbook":f"""SELECT COUNT(*) leads_7d, COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM calls c WHERE c.contact_id=l.contact_id AND c.call_type='intro')) booked FROM leads l WHERE l.is_lead AND (l.lead_created_at AT TIME ZONE 'Asia/Riyadh')::date BETWEEN '{S}' AND '{E}'""",
"closer":f"""SELECT assigned_user_name closer, CASE WHEN ad_id IS NOT NULL THEN 'ad_lead' ELSE 'pipeline' END src, COUNT(*) total, COUNT(*) FILTER (WHERE status IN ('showed','cancelled','invalid') OR (status='confirmed' AND start_at<=now())) showed, COUNT(*) FILTER (WHERE status='noshow') noshow FROM calls WHERE call_type='demo' AND (start_at AT TIME ZONE 'Asia/Riyadh')::date BETWEEN '{S}' AND '{E}' GROUP BY 1,2 ORDER BY 3 DESC""",
"deals":f"""SELECT client_first_name, client_last_name, business_name, cash_collected, contracted_revenue, (submitted_at AT TIME ZONE 'Asia/Riyadh')::date d FROM closed_deals WHERE (submitted_at AT TIME ZONE 'Asia/Riyadh')::date BETWEEN '2026-08-01' AND '{E}' ORDER BY d""",
"lag":f"""SELECT CASE WHEN (start_at::date - booked_at::date)<=0 THEN 'same-day' WHEN (start_at::date-booked_at::date)=1 THEN 'next-day' ELSE '2d+' END lag, COUNT(*) total, COUNT(*) FILTER (WHERE status IN ('showed','cancelled','invalid') OR (status='confirmed' AND start_at<=now())) showed FROM calls WHERE call_type='demo' AND (start_at AT TIME ZONE 'Asia/Riyadh')::date BETWEEN '{S}' AND '{E}' GROUP BY 1""",
}
def ex(r):
    import ast
    s=r
    while isinstance(s,str) and s.lstrip().startswith('"'):
        s=json.loads(s)
    if isinstance(s,str):
        try: s=ast.literal_eval(s)
        except Exception: pass
    if isinstance(s,dict):
        if 'error' in s: return {"ERROR": str(s['error'])[:400]}
        try: s=json.loads(s['content'])['result']
        except Exception: s=str(s)
    m=re.search(r'<untrusted-data-[^>]+>\s*(\[.*?\])\s*</untrusted-data',str(s),re.S)
    if not m: return {"ERROR_UNPARSED": str(s)[:400]}
    return json.loads(m.group(1))
async def main():
    res=await asyncio.gather(*[supabase_execute_sql(query=q,project_id=P) for q in Q.values()])
    out={k:ex(r) for k,r in zip(Q,res)}
    json.dump(out,open("temp/wk.json","w"),ensure_ascii=False,indent=1)
    for k,v in out.items(): print("=====",k);print(json.dumps(v,ensure_ascii=False)[:3500])
asyncio.run(main())
