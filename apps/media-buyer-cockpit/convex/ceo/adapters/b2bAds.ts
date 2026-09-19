import { CPL_GATE } from "../../constants";
import type { B2bAdNode, B2bAdsPayload, B2bVerdict, Note } from "../payloads";
import { B2B, num, sql } from "../sb";
import { addDays, kuwaitDay } from "../time";
import type { Adapter, DailyPoint, SourceStamp } from "../types";

/**
 * Mahara's own ad account, campaign by ad set by ad, with the whole funnel
 * under every row.
 *
 * The client Ads Management screen stops at leads, because that is where the
 * cockpit's knowledge of a client's funnel ends. This one does not have to.
 * Mahara's leads, intro calls, demos and signed deals all carry the ad, ad set
 * and campaign they came from (GHL writes the ids onto the contact at opt-in,
 * and the closing form inherits them), so every ad here can be followed from
 * the first impression to the contract. 68% of leads, 88% of calls and 64% of
 * deals carried an ad id on 2026-09-19; the rest are organic, WhatsApp or
 * typed in by hand, and are simply not on this screen.
 *
 * Two lead counts, on purpose. `metaLeads` is what Meta says the ad produced.
 * `leads` is what actually arrived in the CRM attributed to it. They disagree
 * per ad, sometimes by a lot, and the gap is a diagnosis in itself: Meta
 * counted a form fill that never became a contact, or the contact arrived
 * without its attribution.
 *
 * Verdicts go deeper than the client version because the data does. An ad can
 * be killed for cost, but it can also be told apart from a landing page that
 * loses the lead, a setter who cannot book the intro, and a closer who cannot
 * close the demo. Those are three different people's problems, and the worst
 * thing this screen could do is blame the creative for all of them.
 *
 * Seven days judges freshness and cost. Thirty days judges the funnel, because
 * a demo takes a week to happen and a close takes longer.
 */

const ACCOUNT = "746108264865897";

/** How the funnel is read: shown means showed, or confirmed or invalid once past. */
const SHOWN = `status in ('showed','confirmed','invalid') and start_at < now()`;

function day(d: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error(`b2bAds: bad day ${d}`);
  return `date '${d}'`;
}

const usd = (x: number) => Math.round(x * 100) / 100;
const rate = (a: number, b: number) => (b > 0 ? a / b : null);

/**
 * One row per ad with both windows side by side. Ads are the grain; ad sets
 * and campaigns are sums of their ads, so a number never disagrees with the
 * rows beneath it.
 */
function treeSql(from7: string, from30: string, to: string): string {
  const funnel = (from: string, alias: string) => `
  ${alias}_ads as (
    select campaign_id, adset_id, ad_id,
           sum(spend) as spend, sum(impressions) as impressions,
           sum(inline_link_clicks) as link_clicks, sum(leads) as meta_leads,
           max(frequency) as freq
    from public.meta_ad_snapshots
    where date between ${day(from)} and ${day(to)}
    group by 1,2,3),
  ${alias}_leads as (
    select ad_id, count(*) as leads from public.leads
    where is_lead and ad_id is not null
      and (lead_created_at at time zone 'Asia/Riyadh')::date between ${day(from)} and ${day(to)}
    group by 1),
  ${alias}_calls as (
    select ad_id,
      count(*) filter (where call_type='intro') as intros_booked,
      count(*) filter (where call_type='intro' and ${SHOWN}) as intros_shown,
      count(*) filter (where call_type='demo') as demos_booked,
      count(*) filter (where call_type='demo' and ${SHOWN}) as demos_shown
    from public.calls
    where ad_id is not null
      and (booked_at at time zone 'Asia/Riyadh')::date between ${day(from)} and ${day(to)}
    group by 1),
  ${alias}_deals as (
    select ad_id, count(*) as closes,
           coalesce(sum(contracted_revenue),0) as contracted,
           coalesce(sum(cash_collected),0) as cash
    from public.closed_deals
    where ad_id is not null
      and (submitted_at at time zone 'Asia/Riyadh')::date between ${day(from)} and ${day(to)}
    group by 1)`;

  const cols = (a: string) => `
    coalesce(${a}_ads.spend,0) as ${a}_spend,
    coalesce(${a}_ads.impressions,0) as ${a}_impressions,
    coalesce(${a}_ads.link_clicks,0) as ${a}_link_clicks,
    coalesce(${a}_ads.meta_leads,0) as ${a}_meta_leads,
    ${a}_ads.freq as ${a}_freq,
    coalesce(${a}_leads.leads,0) as ${a}_leads,
    coalesce(${a}_calls.intros_booked,0) as ${a}_intros_booked,
    coalesce(${a}_calls.intros_shown,0) as ${a}_intros_shown,
    coalesce(${a}_calls.demos_booked,0) as ${a}_demos_booked,
    coalesce(${a}_calls.demos_shown,0) as ${a}_demos_shown,
    coalesce(${a}_deals.closes,0) as ${a}_closes,
    coalesce(${a}_deals.contracted,0) as ${a}_contracted,
    coalesce(${a}_deals.cash,0) as ${a}_cash`;

  return `with
  ident as (
    select distinct on (ad_id) ad_id, adset_id, campaign_id,
           ad_name, adset_name, campaign_name, campaign_status, effective_status, thumbnail_url
    from public.meta_ad_snapshots
    where date between ${day(from30)} and ${day(to)}
    order by ad_id, date desc),
  ${funnel(from7, "w7")},
  ${funnel(from30, "w30")}
select ident.*, public.b2b_campaign_type(ident.campaign_name) as campaign_type,
  ${cols("w7")},
  ${cols("w30")}
from ident
left join w7_ads on w7_ads.ad_id = ident.ad_id
left join w7_leads on w7_leads.ad_id = ident.ad_id
left join w7_calls on w7_calls.ad_id = ident.ad_id
left join w7_deals on w7_deals.ad_id = ident.ad_id
left join w30_ads on w30_ads.ad_id = ident.ad_id
left join w30_leads on w30_leads.ad_id = ident.ad_id
left join w30_calls on w30_calls.ad_id = ident.ad_id
left join w30_deals on w30_deals.ad_id = ident.ad_id
order by ident.campaign_name, ident.adset_name, w30_ads.spend desc nulls last`;
}

type Win = B2bAdNode["w7"];

const emptyWin = (): Win => ({
  spend: 0,
  impressions: 0,
  linkClicks: 0,
  metaLeads: 0,
  leads: 0,
  introsBooked: 0,
  introsShown: 0,
  demosBooked: 0,
  demosShown: 0,
  closes: 0,
  contracted: 0,
  cash: 0,
  frequency: null,
  cpl: null,
  costPerDemo: null,
  roas: null,
});

function winOf(r: Record<string, unknown>, a: string): Win {
  const g = (k: string) => num(r[`${a}_${k}`]);
  const w: Win = {
    spend: usd(g("spend")),
    impressions: g("impressions"),
    linkClicks: g("link_clicks"),
    metaLeads: g("meta_leads"),
    leads: g("leads"),
    introsBooked: g("intros_booked"),
    introsShown: g("intros_shown"),
    demosBooked: g("demos_booked"),
    demosShown: g("demos_shown"),
    closes: g("closes"),
    contracted: usd(g("contracted")),
    cash: usd(g("cash")),
    frequency:
      r[`${a}_freq`] === null || r[`${a}_freq`] === undefined
        ? null
        : Math.round(num(r[`${a}_freq`]) * 100) / 100,
    cpl: null,
    costPerDemo: null,
    roas: null,
  };
  w.cpl = w.leads > 0 ? usd(w.spend / w.leads) : null;
  w.costPerDemo = w.demosShown > 0 ? usd(w.spend / w.demosShown) : null;
  w.roas =
    w.spend > 0 ? Math.round((w.contracted / w.spend) * 100) / 100 : null;
  return w;
}

function addWin(into: Win, w: Win): void {
  into.spend = usd(into.spend + w.spend);
  into.impressions += w.impressions;
  into.linkClicks += w.linkClicks;
  into.metaLeads += w.metaLeads;
  into.leads += w.leads;
  into.introsBooked += w.introsBooked;
  into.introsShown += w.introsShown;
  into.demosBooked += w.demosBooked;
  into.demosShown += w.demosShown;
  into.closes += w.closes;
  into.contracted = usd(into.contracted + w.contracted);
  into.cash = usd(into.cash + w.cash);
  // Frequency does not sum: a person reached by two ads is one person. The
  // parent shows the highest of its children, which is the ad most at risk.
  if (w.frequency !== null)
    into.frequency =
      into.frequency === null
        ? w.frequency
        : Math.max(into.frequency, w.frequency);
}

function finish(w: Win): Win {
  w.cpl = w.leads > 0 ? usd(w.spend / w.leads) : null;
  w.costPerDemo = w.demosShown > 0 ? usd(w.spend / w.demosShown) : null;
  w.roas =
    w.spend > 0 ? Math.round((w.contracted / w.spend) * 100) / 100 : null;
  return w;
}

/**
 * What to do about this ad, and whose problem it is.
 *
 * Money is judged on seven days against Aziz's cost per lead gate. The funnel
 * is judged on thirty, because a demo takes a week to happen. And the funnel
 * verdicts name a stage rather than the ad, because an ad that fills the
 * calendar with intros nobody converts is a setter problem, and switching the
 * ad off would be the one thing that makes it worse.
 */
function judge(
  running: boolean,
  w7: Win,
  w30: Win,
  staleSince: string | null,
): B2bVerdict {
  if (!running)
    return {
      verdict: "off",
      reason: "Not delivering: switched off in Meta.",
      owner: null,
    };
  // A stale snapshot is not the same as an ad that stopped. Say which.
  if (staleSince && w7.spend < 1)
    return {
      verdict: "no delivery",
      reason: `Meta has reported no delivery since ${staleSince}. Either it has been off since then or Meta is late; this week cannot be judged yet.`,
      owner: "ads",
    };
  if (w7.spend < 1)
    return {
      verdict: "no delivery",
      reason: "On, but nothing spent in seven days.",
      owner: "ads",
    };
  if (w7.leads === 0 && w7.spend >= 30)
    return {
      verdict: "kill",
      reason: `$${w7.spend.toFixed(0)} in seven days and not one lead reached the CRM${w7.metaLeads > 0 ? `, though Meta counts ${w7.metaLeads}` : ""}.`,
      owner: "ads",
    };
  if (w7.cpl !== null && w7.cpl > CPL_GATE * 1.5)
    return {
      verdict: "kill",
      reason: `$${w7.cpl.toFixed(2)} a lead, more than half again over the $${CPL_GATE} gate.`,
      owner: "ads",
    };
  if (w7.frequency !== null && w7.frequency >= 2.5)
    return {
      verdict: "fatiguing",
      reason: `Frequency ${w7.frequency.toFixed(2)}: the same people keep seeing it. Refresh the creative before the cost moves.`,
      owner: "ads",
    };
  if (w30.leads >= 8 && w30.introsBooked === 0)
    return {
      verdict: "leads do not book",
      reason: `${w30.leads} leads in thirty days and no intro booked. The ad is doing its job; the follow-up is not.`,
      owner: "setter",
    };
  if (w30.introsShown >= 5 && w30.demosBooked === 0)
    return {
      verdict: "intros do not convert",
      reason: `${w30.introsShown} intros shown and no demo booked. That is the intro call, not the ad.`,
      owner: "setter",
    };
  if (w30.demosShown >= 3 && w30.closes === 0)
    return {
      verdict: "demos do not close",
      reason: `${w30.demosShown} demos shown and nothing signed. That is the closing call, not the ad.`,
      owner: "closer",
    };
  if (w7.cpl !== null && w7.cpl > CPL_GATE)
    return {
      verdict: "hold",
      reason: `$${w7.cpl.toFixed(2)} a lead is over the $${CPL_GATE} gate but within half again. Watch it; do not scale it.`,
      owner: "ads",
    };
  return {
    verdict: "scale",
    reason: `$${(w7.cpl ?? 0).toFixed(2)} a lead under the $${CPL_GATE} gate on $${w7.spend.toFixed(0)}${w30.closes ? `, and ${w30.closes} ${w30.closes === 1 ? "close" : "closes"} in thirty days` : ""}.`,
    owner: "ads",
  };
}

/**
 * The weakest stage of a campaign's funnel against the account as a whole.
 * Named so the fix is a person, not a guess: creative, landing page, setter
 * or closer.
 */
function constraintOf(
  c: Win,
  account: Win,
): B2bAdsPayload["campaigns"][number]["constraint"] {
  const stages: {
    key: string;
    label: string;
    owner: "ads" | "landing" | "setter" | "closer";
    mine: number | null;
    all: number | null;
    floor: number;
  }[] = [
    {
      key: "click",
      label: "impressions to link clicks",
      owner: "ads",
      mine: rate(c.linkClicks, c.impressions),
      all: rate(account.linkClicks, account.impressions),
      floor: 500,
    },
    {
      key: "optin",
      label: "clicks to leads",
      owner: "landing",
      mine: rate(c.leads, c.linkClicks),
      all: rate(account.leads, account.linkClicks),
      floor: 30,
    },
    {
      key: "book",
      label: "leads to intros booked",
      owner: "setter",
      mine: rate(c.introsBooked, c.leads),
      all: rate(account.introsBooked, account.leads),
      floor: 8,
    },
    {
      key: "show",
      label: "intros booked to shown",
      owner: "setter",
      mine: rate(c.introsShown, c.introsBooked),
      all: rate(account.introsShown, account.introsBooked),
      floor: 5,
    },
    {
      key: "demo",
      label: "intros shown to demos booked",
      owner: "setter",
      mine: rate(c.demosBooked, c.introsShown),
      all: rate(account.demosBooked, account.introsShown),
      floor: 5,
    },
    {
      key: "close",
      label: "demos shown to closes",
      owner: "closer",
      mine: rate(c.closes, c.demosShown),
      all: rate(account.closes, account.demosShown),
      floor: 3,
    },
  ];
  const denom: Record<string, number> = {
    click: c.impressions,
    optin: c.linkClicks,
    book: c.leads,
    show: c.introsBooked,
    demo: c.introsShown,
    close: c.demosShown,
  };
  // Calls carry their ad id more reliably than leads do (88% against 68% on
  // 2026-09-19), so a campaign can show more intros booked than leads. When
  // that happens the lead count is provably incomplete and "clicks to leads"
  // would blame a landing page for an attribution gap. Skip it.
  const leadsUnderCounted = c.introsBooked > c.leads;
  let worst: (typeof stages)[number] | null = null;
  let worstGap = 0;
  for (const s of stages) {
    if (s.mine === null || s.all === null || s.all === 0) continue;
    if (denom[s.key] < s.floor) continue; // too few to judge
    if (leadsUnderCounted && (s.key === "optin" || s.key === "book")) continue;
    const gap = (s.all - s.mine) / s.all;
    if (gap > worstGap) {
      worstGap = gap;
      worst = s;
    }
  }
  if (!worst || worstGap < 0.2) return null;
  return {
    stage: worst.label,
    owner: worst.owner,
    mine: Math.round((worst.mine ?? 0) * 1000) / 1000,
    account: Math.round((worst.all ?? 0) * 1000) / 1000,
  };
}

export const b2bAds: Adapter = {
  key: "b2bAds",
  label: "Our ads",
  compute: async ctx => {
    void ctx;
    const now = Date.now();
    const today = kuwaitDay(now);
    const from7 = addDays(today, -6);
    const from30 = addDays(today, -29);
    const notes: Note[] = [];

    // Freshness first, because every verdict below needs to know it.
    const freshRows = await sql(
      B2B,
      `select max(extract(epoch from last_synced_at) * 1000) as ms,
              to_char(max(date), 'YYYY-MM-DD') as last_day
       from public.meta_ad_snapshots`,
    );
    const freshestAt = num(freshRows[0]?.ms) || undefined;
    const lastDay = freshRows[0]?.last_day
      ? String(freshRows[0].last_day)
      : null;
    // Yesterday is the newest day Meta can reasonably have closed out.
    const staleSince = lastDay && lastDay < addDays(today, -1) ? lastDay : null;

    const rows = await sql(B2B, treeSql(from7, from30, today));

    const account7 = emptyWin();
    const account30 = emptyWin();
    const campaigns = new Map<string, B2bAdsPayload["campaigns"][number]>();

    for (const r of rows) {
      const w7 = winOf(r, "w7");
      const w30 = winOf(r, "w30");
      const status = String(r.effective_status ?? "");
      const running = status === "ACTIVE";
      const ad: B2bAdNode = {
        id: String(r.ad_id),
        name: String(r.ad_name ?? `Ad ${r.ad_id}`),
        status,
        running,
        thumbnail: r.thumbnail_url ? String(r.thumbnail_url) : null,
        w7,
        w30,
        verdict: judge(running, w7, w30, staleSince),
      };
      addWin(account7, w7);
      addWin(account30, w30);

      const cid = String(r.campaign_id);
      const campaign = campaigns.get(cid) ?? {
        id: cid,
        name: String(r.campaign_name ?? cid),
        type: String(r.campaign_type ?? "unknown"),
        status: String(r.campaign_status ?? ""),
        running: false,
        w7: emptyWin(),
        w30: emptyWin(),
        constraint: null,
        adsets: [],
      };
      campaigns.set(cid, campaign);
      const sid = String(r.adset_id);
      let adset = campaign.adsets.find(a => a.id === sid);
      if (!adset) {
        adset = {
          id: sid,
          name: String(r.adset_name ?? sid),
          running: false,
          w7: emptyWin(),
          w30: emptyWin(),
          ads: [],
        };
        campaign.adsets.push(adset);
      }
      adset.ads.push(ad);
      addWin(adset.w7, w7);
      addWin(adset.w30, w30);
      addWin(campaign.w7, w7);
      addWin(campaign.w30, w30);
      if (running) {
        adset.running = true;
        campaign.running = true;
      }
    }

    finish(account7);
    finish(account30);
    const list = [...campaigns.values()];
    for (const c of list) {
      finish(c.w7);
      finish(c.w30);
      for (const a of c.adsets) {
        finish(a.w7);
        finish(a.w30);
        a.ads.sort((x, y) => y.w30.spend - x.w30.spend);
      }
      c.adsets.sort((x, y) => y.w30.spend - x.w30.spend);
      // A constraint is a funnel diagnosis, and only lead-gen campaigns run the
      // funnel. Retargeting warms an audience and the hiring campaign is not
      // sales at all, so judging either on clicks-to-leads blames them for a
      // job they were never given.
      c.constraint =
        c.type === "lead_gen" ? constraintOf(c.w30, account30) : null;
    }
    // Lead gen first, running first, then by spend.
    list.sort(
      (a, b) =>
        Number(b.type === "lead_gen") - Number(a.type === "lead_gen") ||
        Number(b.running) - Number(a.running) ||
        b.w30.spend - a.w30.spend,
    );

    const ads = list.flatMap(c => c.adsets.flatMap(a => a.ads));
    const running = ads.filter(a => a.running).length;
    const verdicts: Record<string, number> = {};
    for (const a of ads)
      if (a.running)
        verdicts[a.verdict.verdict] = (verdicts[a.verdict.verdict] ?? 0) + 1;

    if (staleSince)
      notes.push({
        level: "warn",
        text: `"Running" here means switched on as of ${staleSince}, the newest day Meta has reported. Whether those ads are still on today is not known until the sync catches up.`,
      });
    if (running === 0)
      notes.push({
        level: "warn",
        text: `Nothing on the account is delivering. Every ad is switched off, so the seven-day column reads spend from before the pause and the verdicts are about what was running, not what is.`,
      });
    const gapAds = ads.filter(
      a => a.w30.metaLeads >= 5 && a.w30.leads < a.w30.metaLeads * 0.5,
    );
    if (gapAds.length)
      notes.push({
        level: "warn",
        text: `On ${gapAds.length} ${gapAds.length === 1 ? "ad" : "ads"} the CRM received fewer than half the leads Meta counts. Meta counts a form fill; the CRM counts a contact that arrived with its attribution. The gap is either forms that never became contacts or contacts that lost the ad on the way in, and it is the first thing to check before believing any cost per lead here.`,
      });
    notes.push({
      level: "info",
      text: `Every row follows an ad from the first impression to the signed contract, through leads, intro calls, demos and closes that carry the ad's id. Seven days judges cost and freshness; thirty days judges the funnel, because a demo takes a week to happen. Meta leads are what Meta claims; leads are what reached the CRM. Cost per lead is against Aziz's $${CPL_GATE} gate. Cost per demo has no gate set, so it is shown and never judged. Frequency on a parent is the highest of its ads, never a sum.`,
    });
    notes.push({
      level: "info",
      text: `A verdict names whose problem it is. "Kill", "hold", "scale" and "fatiguing" are the ad. "Leads do not book" and "intros do not convert" are the setter. "Demos do not close" is the closer. Switching an ad off never fixes the last three; it just stops the calendar filling.`,
    });
    if (staleSince) {
      const ranAt = freshestAt
        ? new Date(freshestAt + 3 * 3600_000)
            .toISOString()
            .slice(0, 16)
            .replace("T", " ")
        : null;
      notes.push({
        level: "warn",
        text: `Meta has reported no delivery since ${staleSince}.${
          ranAt
            ? ` The sync itself last ran at ${ranAt} Kuwait time and succeeded, so this is not a dead feed:`
            : ""
        } either nothing on the account has delivered since then, which fits every campaign being paused, or Meta is late. Until a newer day lands, every seven-day figure is that one day and the verdicts read from it.`,
      });
    }

    const payload: B2bAdsPayload = {
      accountId: ACCOUNT,
      windows: { from7, from30, to: today },
      account: { w7: account7, w30: account30 },
      running,
      total: ads.length,
      verdicts,
      campaigns: list,
      lastSnapshotDay: lastDay,
      notes,
    };

    const sources: SourceStamp[] = [
      { name: "B2B Meta ad snapshots", freshestAt, ok: true },
      { name: "B2B leads, calls and closed deals (ad attribution)", ok: true },
    ];

    const daily: DailyPoint[] = [
      {
        date: today,
        metric: "b2bAds.running",
        scope: "company",
        value: running,
      },
      {
        date: today,
        metric: "b2bAds.spend7",
        scope: "company",
        value: account7.spend,
      },
      {
        date: today,
        metric: "b2bAds.leads7",
        scope: "company",
        value: account7.leads,
      },
      {
        date: today,
        metric: "b2bAds.metaLeads7",
        scope: "company",
        value: account7.metaLeads,
      },
    ];
    for (const c of list)
      daily.push({
        date: today,
        metric: "b2bAds.campaign.spend7",
        scope: `campaign:${c.id}`,
        value: c.w7.spend,
      });

    return { payload, daily, sources };
  },
};
