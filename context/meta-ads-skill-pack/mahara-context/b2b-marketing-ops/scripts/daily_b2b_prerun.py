"""
Pre-run script for the Daily B2B Marketing Report cron.
Pulls all funnel, ad, call, and close data from Supabase Mahara B2B project.
Outputs structured context for the agent to analyze and make decisions.
"""
import asyncio
import json
import re
from datetime import date, timedelta
from sdk.tools.mcp_supabase import supabase_execute_sql

PROJECT_ID = "flwboeijllbtrufxkhts"


async def run_sql(query: str) -> str:
    return await supabase_execute_sql(query=query, project_id=PROJECT_ID)


def extract_json(raw: str) -> any:
    """Extract JSON data from supabase result string."""
    content = str(raw)
    match = re.search(r'<untrusted-data-[^>]+>\n(.*?)\n</untrusted-data', content, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(1))
        except json.JSONDecodeError:
            return match.group(1)
    try:
        outer = json.loads(raw) if isinstance(raw, str) else raw
        if hasattr(outer, 'content'):
            inner = json.loads(outer.content)
            if 'result' in inner:
                match2 = re.search(r'<untrusted-data-[^>]+>\n(.*?)\n</untrusted-data', inner['result'], re.DOTALL)
                if match2:
                    return json.loads(match2.group(1))
        return outer
    except:
        return raw


async def main():
    today = date.today()
    yesterday = today - timedelta(days=1)
    month_start = today.replace(day=1)
    prev_month_start = (month_start - timedelta(days=1)).replace(day=1)
    prev_month_end = month_start - timedelta(days=1)
    week_ago = today - timedelta(days=7)
    two_weeks_ago = today - timedelta(days=14)

    queries = {}

    # ── SECTION 1: FULL FUNNEL ──

    queries["mtd_cockpit"] = f"SELECT b2b_cockpit('{month_start}', '{yesterday}')"

    queries["yesterday_daily"] = f"SELECT b2b_marketing_daily('{yesterday}'::date, '{yesterday}'::date, NULL::text[])"

    queries["last_7d_daily"] = f"SELECT b2b_marketing_daily('{week_ago}'::date, '{yesterday}'::date, NULL::text[])"

    queries["prev_month_cockpit"] = f"SELECT b2b_cockpit('{prev_month_start}', '{prev_month_end}')"

    queries["pacing"] = f"SELECT b2b_pacing_pipeline('{month_start}', '{today + timedelta(days=15)}')"

    queries["monthly_targets"] = f"""
        SELECT metric, kpi_low, kpi_high, projection
        FROM monthly_targets WHERE period_month = '{month_start}' ORDER BY metric
    """

    queries["wow_current"] = f"SELECT b2b_window_metrics('{week_ago}', '{yesterday}')"
    queries["wow_previous"] = f"SELECT b2b_window_metrics('{two_weeks_ago}', '{week_ago - timedelta(days=1)}')"

    # ── SECTION 2: AD-LEVEL PERFORMANCE (ranked by CPL) ──

    queries["ads_ranked_by_cpl"] = f"""
        SELECT
            ad_id, ad_name, adset_name, campaign_name,
            round(sum(spend)::numeric, 2) as spend,
            sum(inline_link_clicks) as link_clicks,
            sum(impressions) as impressions,
            sum(leads) as meta_leads,
            CASE WHEN sum(inline_link_clicks) > 0
                THEN round((sum(spend) / sum(inline_link_clicks))::numeric, 2)
                ELSE NULL END as cost_per_link_click,
            CASE WHEN sum(impressions) > 0
                THEN round((sum(inline_link_clicks)::numeric / sum(impressions) * 100)::numeric, 2)
                ELSE NULL END as link_ctr_pct,
            CASE WHEN sum(inline_link_clicks) > 0 AND sum(leads) > 0
                THEN round((sum(leads)::numeric / sum(inline_link_clicks) * 100)::numeric, 1)
                ELSE 0 END as lp_conv_pct,
            CASE WHEN sum(leads) > 0
                THEN round((sum(spend) / sum(leads))::numeric, 2)
                ELSE NULL END as cpl,
            CASE WHEN sum(impressions) > 0
                THEN round((1000.0 * sum(spend) / sum(impressions))::numeric, 2)
                ELSE NULL END as cpm,
            round(max(frequency)::numeric, 2) as max_frequency,
            min(date) as first_active,
            max(date) as last_active,
            count(distinct date) as active_days
        FROM meta_ad_snapshots
        WHERE date BETWEEN '{month_start}' AND '{yesterday}'
        GROUP BY ad_id, ad_name, adset_name, campaign_name
        HAVING sum(spend) > 5
        ORDER BY cpl ASC NULLS LAST
    """

    # Per-ad daily trend (last 7 days, lead gen ads only — exclude Hammer Them content/retargeting)
    queries["ad_daily_trend_7d"] = f"""
        SELECT ad_id, ad_name, date,
            round(spend::numeric, 2) as spend,
            inline_link_clicks as link_clicks,
            leads,
            CASE WHEN inline_link_clicks > 0
                THEN round((spend / inline_link_clicks)::numeric, 2)
                ELSE NULL END as cplc,
            CASE WHEN leads > 0
                THEN round((spend / leads)::numeric, 2)
                ELSE NULL END as cpl
        FROM meta_ad_snapshots
        WHERE date BETWEEN '{week_ago}' AND '{yesterday}'
          AND spend > 0
          AND campaign_name NOT ILIKE '%%Hammer Them%%'
          AND campaign_name NOT ILIKE '%%CSM Hiring%%'
        ORDER BY ad_name, date
    """

    # ── SECTION 3: LEAD QUALITY BY AD ──

    queries["lead_quality_by_ad"] = f"""
        SELECT
            l.ad_id,
            m.ad_name,
            COUNT(*) as total_leads,
            COUNT(*) FILTER (WHERE l.stage_name ~* 'Demo Booked|CONFIRMED|Closed|Hot Lead') as qualified,
            COUNT(*) FILTER (WHERE l.stage_name ILIKE '%%disqualif%%') as disqualified,
            COUNT(*) FILTER (WHERE l.stage_name ~* 'Short Term Nurture|Long Term Nurture') as nurture,
            COUNT(*) FILTER (WHERE l.stage_name ~* 'No Show') as noshow_stage,
            ROUND(100.0 * COUNT(*) FILTER (WHERE l.stage_name ~* 'Demo Booked|CONFIRMED|Closed|Hot Lead')
                  / NULLIF(COUNT(*), 0), 1) as qualified_pct
        FROM leads l
        LEFT JOIN LATERAL (
            SELECT DISTINCT ON (ad_id) ad_id, ad_name
            FROM meta_ad_snapshots WHERE ad_id = l.ad_id ORDER BY ad_id, date DESC
        ) m ON true
        WHERE l.is_lead AND l.ad_id IS NOT NULL
          AND (l.lead_created_at AT TIME ZONE 'Asia/Riyadh')::date BETWEEN '{month_start}' AND '{yesterday}'
        GROUP BY l.ad_id, m.ad_name
        ORDER BY total_leads DESC LIMIT 15
    """

    # ── SECTION 4: SHOW RATES & BOOKING LAG ──

    # Intro show rates MTD
    # NOTE: cancelled/invalid = showed up but unqualified (per Aziz Jul 20). They count as attended.
    queries["intro_show_rates"] = f"""
        SELECT
            COUNT(*) FILTER (WHERE status IN ('showed','confirmed') AND start_at <= now()) as showed,
            COUNT(*) FILTER (WHERE status = 'noshow') as noshow,
            COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled,
            COUNT(*) FILTER (WHERE status = 'invalid') as invalid,
            COUNT(*) as total,
            ROUND(100.0 * COUNT(*) FILTER (WHERE status IN ('showed','cancelled','invalid') OR (status = 'confirmed' AND start_at <= now()))
                  / NULLIF(COUNT(*) FILTER (WHERE status IN ('showed','noshow','cancelled','invalid') OR (status = 'confirmed' AND start_at <= now())), 0), 1) as show_rate_pct
        FROM calls
        WHERE call_type = 'intro'
          AND (start_at AT TIME ZONE 'Asia/Riyadh')::date BETWEEN '{month_start}' AND '{yesterday}'
    """

    # Demo show rates MTD
    queries["demo_show_rates"] = f"""
        SELECT
            COUNT(*) FILTER (WHERE status IN ('showed','confirmed') AND start_at <= now()) as showed,
            COUNT(*) FILTER (WHERE status = 'noshow') as noshow,
            COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled,
            COUNT(*) FILTER (WHERE status = 'invalid') as invalid,
            COUNT(*) as total,
            ROUND(100.0 * COUNT(*) FILTER (WHERE status IN ('showed','cancelled','invalid') OR (status = 'confirmed' AND start_at <= now()))
                  / NULLIF(COUNT(*) FILTER (WHERE status IN ('showed','noshow','cancelled','invalid') OR (status = 'confirmed' AND start_at <= now())), 0), 1) as show_rate_pct
        FROM calls
        WHERE call_type = 'demo'
          AND (start_at AT TIME ZONE 'Asia/Riyadh')::date BETWEEN '{month_start}' AND '{yesterday}'
    """

    # Demo show rates by closer and source (ad vs pipeline)
    queries["demo_show_by_closer_source"] = f"""
        SELECT
            assigned_user_name as closer,
            CASE WHEN ad_id IS NOT NULL THEN 'ad_lead' ELSE 'pipeline' END as source,
            COUNT(*) as total,
            COUNT(*) FILTER (WHERE status IN ('showed','cancelled','invalid') OR (status = 'confirmed' AND start_at <= now())) as showed,
            COUNT(*) FILTER (WHERE status = 'noshow') as noshow,
            ROUND(100.0 * COUNT(*) FILTER (WHERE status IN ('showed','cancelled','invalid') OR (status = 'confirmed' AND start_at <= now()))
                  / NULLIF(COUNT(*) FILTER (WHERE status IN ('showed','noshow','cancelled','invalid') OR (status = 'confirmed' AND start_at <= now())), 0), 1) as show_rate_pct
        FROM calls
        WHERE call_type = 'demo'
          AND (start_at AT TIME ZONE 'Asia/Riyadh')::date BETWEEN '{month_start}' AND '{yesterday}'
        GROUP BY 1, 2 ORDER BY 1, 2
    """

    # Booking lag vs show rate (demo)
    queries["demo_booking_lag"] = f"""
        WITH demo_lag AS (
            SELECT
                EXTRACT(epoch FROM (start_at - booked_at)) / 86400 as lag_days,
                status,
                start_at
            FROM calls
            WHERE call_type = 'demo'
              AND booked_at IS NOT NULL
              AND (start_at AT TIME ZONE 'Asia/Riyadh')::date BETWEEN '{month_start}' AND '{yesterday}'
        )
        SELECT
            CASE
                WHEN lag_days < 1.5 THEN '0_same_next_day'
                WHEN lag_days < 3.5 THEN '1_two_three_days'
                ELSE '2_four_plus_days'
            END as lag_bucket,
            COUNT(*) as total,
            COUNT(*) FILTER (WHERE status IN ('showed','cancelled','invalid') OR (status = 'confirmed' AND start_at <= now())) as showed,
            COUNT(*) FILTER (WHERE status = 'noshow') as noshow,
            ROUND(100.0 * COUNT(*) FILTER (WHERE status IN ('showed','cancelled','invalid') OR (status = 'confirmed' AND start_at <= now()))
                  / NULLIF(COUNT(*) FILTER (WHERE status IN ('showed','noshow','cancelled','invalid') OR (status = 'confirmed' AND start_at <= now())), 0), 1) as show_rate_pct
        FROM demo_lag
        GROUP BY 1 ORDER BY 1
    """

    # Intro booking lag
    queries["intro_booking_lag"] = f"""
        WITH intro_lag AS (
            SELECT
                EXTRACT(epoch FROM (start_at - booked_at)) / 86400 as lag_days,
                status,
                start_at
            FROM calls
            WHERE call_type = 'intro'
              AND booked_at IS NOT NULL
              AND (start_at AT TIME ZONE 'Asia/Riyadh')::date BETWEEN '{month_start}' AND '{yesterday}'
        )
        SELECT
            CASE
                WHEN lag_days < 1.5 THEN '0_same_next_day'
                WHEN lag_days < 3.5 THEN '1_two_three_days'
                ELSE '2_four_plus_days'
            END as lag_bucket,
            COUNT(*) as total,
            COUNT(*) FILTER (WHERE status IN ('showed','cancelled','invalid') OR (status = 'confirmed' AND start_at <= now())) as showed,
            COUNT(*) FILTER (WHERE status = 'noshow') as noshow,
            ROUND(100.0 * COUNT(*) FILTER (WHERE status IN ('showed','cancelled','invalid') OR (status = 'confirmed' AND start_at <= now()))
                  / NULLIF(COUNT(*) FILTER (WHERE status IN ('showed','noshow','cancelled','invalid') OR (status = 'confirmed' AND start_at <= now())), 0), 1) as show_rate_pct
        FROM intro_lag
        GROUP BY 1 ORDER BY 1
    """

    # ── SECTION 5: CLOSES & ATTRIBUTION ──

    queries["closed_deals_mtd"] = f"""
        SELECT closer, business_name, cash_collected, contracted_revenue, new_mrr,
               submitted_at::date as close_date, ad_id, campaign_id, matched_by
        FROM closed_deals
        WHERE (submitted_at AT TIME ZONE 'Asia/Riyadh')::date BETWEEN '{month_start}' AND '{yesterday}'
        ORDER BY submitted_at DESC
    """

    # Match closes to demo dates (close attribution lag)
    queries["close_attribution"] = f"""
        SELECT
            cd.business_name, cd.closer,
            cd.submitted_at::date as close_date,
            cd.cash_collected, cd.contracted_revenue,
            c.start_at::date as demo_date,
            c.contact_name as demo_contact,
            EXTRACT(day FROM cd.submitted_at - c.start_at) as demo_to_close_days,
            c.ad_id as demo_ad_id
        FROM closed_deals cd
        LEFT JOIN calls c ON cd.contact_id = c.contact_id AND c.call_type = 'demo'
            AND c.status IN ('showed','confirmed')
        WHERE (cd.submitted_at AT TIME ZONE 'Asia/Riyadh')::date BETWEEN '{month_start}' AND '{yesterday}'
        ORDER BY cd.submitted_at DESC
    """

    # ── SECTION 6: PIPELINE & UPCOMING ──

    # Today's and tomorrow's scheduled calls
    queries["upcoming_calls"] = f"""
        SELECT
            call_type, contact_name, assigned_user_name as closer, status,
            start_at AT TIME ZONE 'Asia/Riyadh' as local_time,
            CASE WHEN ad_id IS NOT NULL THEN 'ad_lead' ELSE 'pipeline' END as source
        FROM calls
        WHERE (start_at AT TIME ZONE 'Asia/Riyadh')::date BETWEEN '{today}' AND '{today + timedelta(days=1)}'
          AND status NOT IN ('cancelled','invalid')
        ORDER BY start_at
    """

    # Lead sources MTD
    queries["lead_sources"] = f"""
        SELECT COALESCE(NULLIF(TRIM(source), ''), '(unknown)') as source, COUNT(*) as leads
        FROM leads
        WHERE is_lead AND (lead_created_at AT TIME ZONE 'Asia/Riyadh')::date BETWEEN '{month_start}' AND '{yesterday}'
        GROUP BY 1 ORDER BY leads DESC LIMIT 10
    """

    # ── SECTION 7: CAMPAIGN & FREQUENCY ──

    queries["campaigns_mtd"] = f"""
        SELECT campaign_name, campaign_id,
            ROUND(SUM(spend)::numeric, 2) as spend,
            SUM(impressions) as impressions,
            SUM(inline_link_clicks) as link_clicks,
            SUM(leads) as meta_leads,
            ROUND((100.0 * SUM(inline_link_clicks) / NULLIF(SUM(impressions), 0))::numeric, 2) as link_ctr,
            ROUND((1000.0 * SUM(spend) / NULLIF(SUM(impressions), 0))::numeric, 2) as cpm,
            ROUND((SUM(spend) / NULLIF(SUM(leads), 0))::numeric, 2) as cpl
        FROM meta_ad_snapshots
        WHERE date BETWEEN '{month_start}' AND '{yesterday}'
        GROUP BY campaign_name, campaign_id
        HAVING SUM(spend) > 0
        ORDER BY SUM(spend) DESC
    """

    queries["frequency_by_ad"] = f"""
        SELECT ad_name, ad_id,
            round(avg(frequency)::numeric, 2) as avg_freq_7d,
            max(frequency) as max_freq
        FROM meta_ad_snapshots
        WHERE date BETWEEN '{week_ago}' AND '{yesterday}' AND spend > 0
        GROUP BY ad_name, ad_id
        HAVING max(frequency) > 1.5
        ORDER BY max(frequency) DESC LIMIT 10
    """

    # ── SECTION 8: HISTORICAL MONTHLY CONTEXT ──

    queries["monthly_history"] = f"""
        SELECT
            date_trunc('month', date)::date as month,
            round(sum(spend)::numeric, 2) as spend,
            sum(inline_link_clicks) as link_clicks,
            sum(leads) as meta_leads,
            sum(impressions) as impressions,
            round((sum(spend) / NULLIF(sum(leads), 0))::numeric, 2) as cpl,
            round((100.0 * sum(inline_link_clicks) / NULLIF(sum(impressions), 0))::numeric, 2) as link_ctr,
            round((100.0 * sum(leads) / NULLIF(sum(inline_link_clicks), 0))::numeric, 1) as lp_conv
        FROM meta_ad_snapshots
        WHERE date >= '{(month_start - timedelta(days=120)).replace(day=1)}'
          AND date <= '{yesterday}'
        GROUP BY 1 ORDER BY 1
    """

    # ── RUN ALL ──

    results = {}
    for key, query in queries.items():
        try:
            raw = await run_sql(query)
            parsed = extract_json(str(raw))
            results[key] = parsed
        except Exception as e:
            results[key] = f"ERROR: {str(e)}"

    print("=" * 80)
    print(f"MAHARA B2B DAILY MARKETING DATA — {today.strftime('%A, %B %d, %Y')}")
    print(f"Report covers: MTD {month_start} to {yesterday} | Yesterday: {yesterday}")
    print(f"Week window: {week_ago} to {yesterday}")
    print("=" * 80)

    for key, data in results.items():
        print(f"\n### {key.upper()} ###")
        if isinstance(data, (dict, list)):
            print(json.dumps(data, indent=2, default=str))
        else:
            print(data)

    print("\n" + "=" * 80)
    print("END OF DATA PULL")
    print("=" * 80)


if __name__ == "__main__":
    asyncio.run(main())
