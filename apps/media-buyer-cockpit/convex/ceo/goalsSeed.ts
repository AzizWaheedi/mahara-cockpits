import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { rest } from "./sbWrite";

/**
 * September 2026, typed once from Aziz's own plan.
 *
 * The plan existed as a Google Doc before the cockpit had a Goals tab. This
 * puts it in, exactly as written, so the tab opens on a real month instead of
 * a blank page and so every number on it can be traced to a sentence Aziz
 * wrote. Baselines are August's actuals from the same document.
 *
 * Idempotent: it upserts on (plan period) and (plan, group, metric), so
 * running it twice changes nothing and running it after an edit puts the
 * document's numbers back.
 */

type Seed = {
  group: string;
  key: string;
  label: string;
  unit: string;
  direction: "up" | "down";
  target?: number;
  stretch?: number;
  baseline?: number;
  note?: string;
};

const TARGETS: Seed[] = [
  // The front-end ladder, in funnel order.
  {
    group: "front_end",
    key: "spend",
    label: "Ad spend",
    unit: "usd",
    direction: "up",
    target: 6600,
    baseline: 6054,
    note: "$200 a day of lead gen.",
  },
  {
    group: "front_end",
    key: "spendRetargeting",
    label: "Retargeting spend",
    unit: "usd",
    direction: "up",
    target: 600,
    note: "Beside lead gen, never inside a cost per lead.",
  },
  {
    group: "front_end",
    key: "leads",
    label: "Leads",
    unit: "count",
    direction: "up",
    target: 583,
    baseline: 558,
  },
  {
    group: "front_end",
    key: "cpl",
    label: "Cost per lead",
    unit: "usd",
    direction: "down",
    target: 10,
    stretch: 9,
    baseline: 10.29,
  },
  {
    group: "front_end",
    key: "bookableLeads",
    label: "Bookable leads",
    unit: "count",
    direction: "up",
    target: 397,
    baseline: 261,
    note: "+52%. Six of the ten extra clients come from fixing the lead tracking, which is 158 dead leads a month.",
  },
  {
    group: "front_end",
    key: "costPerBookableLead",
    label: "Cost per bookable lead",
    unit: "usd",
    direction: "down",
    target: 15,
    baseline: 22,
  },
  {
    group: "front_end",
    key: "introsBooked",
    label: "Intros booked",
    unit: "count",
    direction: "up",
    target: 295,
    baseline: 194,
  },
  {
    group: "front_end",
    key: "costPerIntroBooked",
    label: "Cost per intro booked",
    unit: "usd",
    direction: "down",
    target: 20,
    baseline: 22.96,
  },
  {
    group: "front_end",
    key: "introShowRate",
    label: "Intro show rate",
    unit: "rate",
    direction: "up",
    target: 0.6,
    baseline: 0.569,
  },
  {
    group: "front_end",
    key: "introsShown",
    label: "Intros shown",
    unit: "count",
    direction: "up",
    target: 177,
    baseline: 144,
  },
  {
    group: "front_end",
    key: "costPerIntroShown",
    label: "Cost per intro shown",
    unit: "usd",
    direction: "down",
    target: 34,
    baseline: 39.86,
  },
  {
    group: "front_end",
    key: "demosBooked",
    label: "Demos booked",
    unit: "count",
    direction: "up",
    target: 107,
    baseline: 87,
  },
  {
    group: "front_end",
    key: "costPerDemoBooked",
    label: "Cost per demo booked",
    unit: "usd",
    direction: "down",
    target: 56,
    baseline: 65.97,
  },
  {
    group: "front_end",
    key: "demoShowRate",
    label: "Demo show rate",
    unit: "rate",
    direction: "up",
    target: 0.75,
    baseline: 0.573,
    note: "+18 points, and three of the ten extra clients.",
  },
  {
    group: "front_end",
    key: "demosShown",
    label: "Live demos",
    unit: "count",
    direction: "up",
    target: 80,
    baseline: 47,
    note: "25 a week is one closer's ceiling. Saleh takes about eight a week from week one or the calendar becomes the constraint.",
  },
  {
    group: "front_end",
    key: "costPerDemoShown",
    label: "Cost per live demo",
    unit: "usd",
    direction: "down",
    target: 75,
    baseline: 122.12,
  },
  {
    group: "front_end",
    key: "demosQualified",
    label: "Qualified demos",
    unit: "count",
    direction: "up",
    target: 78,
    baseline: 46,
  },
  {
    group: "front_end",
    key: "closeRate",
    label: "Close rate",
    unit: "rate",
    direction: "up",
    target: 0.25,
    baseline: 0.217,
  },
  {
    group: "front_end",
    key: "closes",
    label: "Clients signed",
    unit: "count",
    direction: "up",
    target: 20,
    baseline: 10,
    note: "One every 1.3 days, 4.6 a week.",
  },
  {
    group: "front_end",
    key: "cac",
    label: "Cost per acquisition",
    unit: "usd",
    direction: "down",
    target: 315,
    baseline: 605,
  },
  {
    group: "front_end",
    key: "contracted",
    label: "Contracted revenue",
    unit: "usd",
    direction: "up",
    target: 120000,
    baseline: 61000,
  },
  {
    group: "front_end",
    key: "aov",
    label: "Average order value",
    unit: "usd",
    direction: "up",
    target: 6000,
    baseline: 6100,
  },
  {
    group: "front_end",
    key: "newCash",
    label: "New-client cash",
    unit: "usd",
    direction: "up",
    target: 59400,
    baseline: 29700,
  },

  // The book we already have.
  {
    group: "back_end",
    key: "backEndCash",
    label: "Back-end cash",
    unit: "usd",
    direction: "up",
    target: 16000,
    note: "Active clients only. The onboarding cohort is upside, not plan.",
  },
  {
    group: "back_end",
    key: "mrrCollectionRate",
    label: "MRR collection rate",
    unit: "rate",
    direction: "up",
    target: 1,
    note: "Every retainer due in the month, collected in the month.",
  },
  {
    group: "back_end",
    key: "upsellCash",
    label: "Upsell cash",
    unit: "usd",
    direction: "up",
    target: 5000,
  },
  {
    group: "back_end",
    key: "upsellRate",
    label: "Upsell rate",
    unit: "rate",
    direction: "up",
    target: 0.1,
    note: "At least two of the twenty-two clients. One upsell conversation per client per month, never before the first win.",
  },
  {
    group: "back_end",
    key: "referrals",
    label: "Referral deals",
    unit: "count",
    direction: "up",
    target: 1,
  },
  {
    group: "back_end",
    key: "testimonials",
    label: "Video testimonials",
    unit: "count",
    direction: "up",
    target: 2,
  },
  {
    group: "back_end",
    key: "googleReviews",
    label: "Google reviews",
    unit: "count",
    direction: "up",
    target: 2,
  },
  {
    group: "back_end",
    key: "caseStudies",
    label: "Client podcast case studies",
    unit: "count",
    direction: "up",
    target: 1,
    note: "Recorded by Aziz.",
  },
  {
    group: "back_end",
    key: "churnRate",
    label: "Churn",
    unit: "rate",
    direction: "down",
    target: 0.1,
  },

  // The month in numbers.
  {
    group: "money",
    key: "totalCash",
    label: "Total cash collected",
    unit: "usd",
    direction: "up",
    target: 80400,
  },
  {
    group: "money",
    key: "labour",
    label: "Payroll",
    unit: "usd",
    direction: "down",
    target: 26260,
    note: "42% fixed, 58% only paid if delivered. In August it was 100% fixed.",
  },
  {
    group: "money",
    key: "overhead",
    label: "Software and overhead",
    unit: "usd",
    direction: "down",
    target: 6000,
    baseline: 6332,
    note: "OpenAI rises to $200 a month inside this.",
  },
  {
    group: "money",
    key: "processingFees",
    label: "Payment processing fees",
    unit: "usd",
    direction: "down",
    target: 3100,
    baseline: 1071,
    note: "Charged on volume, not on subscriptions. At 4.46% on $70,000 this is the biggest single overhead line in the business. Fixing the processor rate is worth more than every subscription we could cancel.",
  },
  {
    group: "money",
    key: "profit",
    label: "Profit",
    unit: "usd",
    direction: "up",
    target: 38440,
  },
  {
    group: "money",
    key: "margin",
    label: "Margin",
    unit: "rate",
    direction: "up",
    target: 0.48,
  },

  // The standard we hold ourselves to on a client's account.
  {
    group: "delivery",
    key: "clientCpl",
    label: "Client cost per lead",
    unit: "usd",
    direction: "down",
    target: 15,
    stretch: 10,
    note: "$15 was the ceiling; $10 is the goal this month.",
  },
  {
    group: "delivery",
    key: "clientLeadToBooking",
    label: "Client lead to booking",
    unit: "rate",
    direction: "up",
    target: 0.3,
    stretch: 0.35,
  },
  {
    group: "delivery",
    key: "clientShowRate",
    label: "Client booking to show",
    unit: "rate",
    direction: "up",
    target: 0.75,
    stretch: 0.8,
  },
  {
    group: "delivery",
    key: "clientCloseRate",
    label: "Client show to close",
    unit: "rate",
    direction: "up",
    target: 0.2,
    stretch: 0.25,
  },
  {
    group: "delivery",
    key: "trackingIntact",
    label: "Accounts with tracking intact",
    unit: "rate",
    direction: "up",
    target: 1,
  },
  {
    group: "delivery",
    key: "timeToLaunch",
    label: "Days to launch a new client",
    unit: "days",
    direction: "down",
    target: 7,
    note: "All twelve onboarding clients launched by September 6.",
  },

  // The floor.
  {
    group: "calls",
    key: "dialsPerDay",
    label: "Dials per agent per day",
    unit: "count",
    direction: "up",
    target: 100,
  },
  {
    group: "calls",
    key: "agents",
    label: "Agents on the floor",
    unit: "count",
    direction: "up",
    target: 3,
    note: "One new hire this month. About 7,800 dials in the month.",
  },

  // What gets published.
  {
    group: "content",
    key: "youtubeVideos",
    label: "YouTube videos",
    unit: "count",
    direction: "up",
    target: 4,
    note: "One a week.",
  },
  {
    group: "content",
    key: "reels",
    label: "Reels",
    unit: "count",
    direction: "up",
    target: 20,
    note: "Five a week, Sunday to Thursday.",
  },
  {
    group: "content",
    key: "studioDays",
    label: "Studio recording days",
    unit: "count",
    direction: "up",
    target: 2,
    note: "Each producing two YouTube videos and ten reels.",
  },

  // The creative engine.
  {
    group: "creative",
    key: "newAdsLaunched",
    label: "New Mahara ads launched",
    unit: "count",
    direction: "up",
    target: 20,
    note: "Ten already recorded; ten more to record.",
  },
  {
    group: "creative",
    key: "templatedClientAds",
    label: "Templated client ads produced",
    unit: "count",
    direction: "up",
    target: 50,
  },
  {
    group: "creative",
    key: "scriptsPerDay",
    label: "Client ad scripts a day",
    unit: "count",
    direction: "up",
    target: 4,
  },
  {
    group: "creative",
    key: "editsPerDay",
    label: "Finished videos a day",
    unit: "count",
    direction: "up",
    target: 4,
  },

  // Systems and team.
  {
    group: "systems",
    key: "rndTests",
    label: "R&D tests run",
    unit: "count",
    direction: "up",
    target: 2,
  },
  {
    group: "systems",
    key: "sopsWritten",
    label: "SOPs written",
    unit: "count",
    direction: "up",
    target: 6,
    note: "Ad scripting, VSL, landing page, qualification questions, thank-you page, offer building.",
  },
  {
    group: "team",
    key: "payrollFixedShare",
    label: "Share of payroll that is fixed",
    unit: "rate",
    direction: "down",
    target: 0.42,
    baseline: 1,
  },
  {
    group: "team",
    key: "hires",
    label: "People hired",
    unit: "count",
    direction: "up",
    target: 2,
    note: "A call centre agent and a video editor.",
  },
];

export const september = internalAction({
  args: { by: v.optional(v.string()) },
  returns: v.any(),
  handler: async (_ctx, a): Promise<{ planId: number; targets: number }> => {
    const by = a.by ?? "aziz@maharamedia.com";
    const plan = await rest(
      "cockpit_goal_plans?on_conflict=period_from,period_to",
      {
        method: "POST",
        body: {
          period_kind: "month",
          period_from: "2026-09-01",
          period_to: "2026-09-30",
          title: "September 2026 — The Plan",
          mission:
            "Mahara Media to $100,000 a month. September is the month that proves the machine can carry it.",
          headline:
            "Collect $80,400, spend $41,960, keep $38,440 at a 48% margin — while fixing the tracking, ramping the CSM, launching every onboarding client and raising the client standard to a $10 cost per lead.",
          status: "live",
          working_days: 26,
          created_by: by,
          updated_at: new Date().toISOString(),
        },
        prefer: "resolution=merge-duplicates,return=representation",
      },
    );
    const planId = Number(plan?.[0]?.id);
    if (!planId) throw new Error("Supabase did not return the plan.");

    const body = TARGETS.map((t, i) => ({
      plan_id: planId,
      group_key: t.group,
      metric_key: t.key,
      label: t.label,
      unit: t.unit,
      direction: t.direction,
      target: t.target ?? null,
      stretch: t.stretch ?? null,
      baseline: t.baseline ?? null,
      note: t.note ?? null,
      sort: i,
    }));
    await rest(
      "cockpit_goal_targets?on_conflict=plan_id,group_key,metric_key",
      {
        method: "POST",
        body,
        prefer: "resolution=merge-duplicates,return=minimal",
      },
    );
    return { planId, targets: body.length };
  },
});
