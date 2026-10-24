/**
 * The media buyer's Ads page in the layout harness: the snapshot reads
 * (useMediaBuyerSnapshot.ts, mediaSourceClient.ts) and the board's range
 * reads (mediaStatsClient.ts) answer from made-up campaigns
 * (adsPageFixture.ts), so the table and its filters can be checked on every
 * time frame without signing in. Open, for example:
 *
 *   /harness.html?path=%2Fads%3Frange%3D7d
 *   /harness.html?path=%2Fads%3Frange%3D30d
 *
 * `range=` takes the RangePicker's keys (today, yesterday, 3d, 7d, 14d, 30d,
 * mtd, last-month, ytd, last-year) or `start..end`. The harness sign-in gives
 * /ads a made-up session (authHarness.ts), or the range reads would never
 * run. Names this file does not own pass to the layers below it. Never
 * imported by the production app.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  adsPageAdRows,
  adsPageBilling,
  adsPageCampaignRows,
  adsPageClientRange,
  adsPageCoverage,
  adsPageRange,
  adsPageSource,
  adsPageTrend,
  fixtureDay,
} from "./adsPageFixture";

type Answer = {
  data: unknown;
  error: { message: string; code?: string } | null;
};

const ok = (data: unknown): Answer => ({ data, error: null });
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

/** The made-up seat: the same id the harness sign-in uses. */
const USER = { id: "harness-ceo", email: "ceo@example.test" };
/** The EOD owner cockpit_personal_eod names: a made-up uuid. */
const EOD_OWNER = "0f1e2d3c-4b5a-4968-8776-000000000001";

/**
 * A query builder's stand-in: every filter returns it again, and awaiting it
 * gives `answer`. For the table reads the page makes with .select().eq().
 */
function chain(answer: Answer): unknown {
  const self: unknown = new Proxy(
    {},
    {
      get: (_t, key) =>
        key === "then"
          ? (done: (v: Answer) => unknown, fail?: (e: unknown) => unknown) =>
              Promise.resolve(answer).then(done, fail)
          : () => self,
    },
  );
  return self;
}

/** An rpc answer that also takes .abortSignal(), as the billing strip calls it. */
function reply(answer: Promise<Answer>) {
  return Object.assign(answer, { abortSignal: () => answer });
}

/**
 * Today's review queue (/dashboard): two campaigns aged past the 7-day check,
 * so the queue holds three due rows with Driftwood, and one Leave it on
 * Falcon Ridge two hours ago, so it shows as reviewed.
 */
const AGED: Record<string, number> = {
  "Marble Bay | Interior design | Leads": 12,
  "Cedar Stone | Kitchens | Retarget": 8,
};
function harnessDecisions(now: number): unknown[] {
  const at = new Date(now - 2 * 3_600_000).toISOString();
  return [
    {
      id: 9001,
      role: "media_buyer",
      day: fixtureDay(0),
      subject: "Falcon Ridge | Construction only | DWY",
      action: "Left",
      kind: "left",
      reason: "Numbers are on track",
      logged_at: at,
      created_at: at,
      metadata: { snooze: "In 3 days", verdictAtDecision: "scale" },
    },
  ];
}
/** End of day (/eod): what Mahara changed in Ads Manager today, made up. */
function harnessEodChanges(now: number): unknown[] {
  const at = (h: number) => now - h * 3_600_000;
  return [
    {
      at: at(6),
      client: "Cedar Stone Interiors",
      actor: "Nada Al Saed",
      eventType: "Ad set budget updated",
    },
    {
      at: at(5),
      client: "Juniper Kitchens",
      actor: "Nada Al Saed",
      eventType: "Ad created",
    },
    {
      at: at(5),
      client: "Juniper Kitchens",
      actor: "Nada Al Saed",
      eventType: "Ad created",
    },
    {
      at: at(4),
      client: "Opal House Renovation",
      actor: "Nada Al Saed",
      eventType: "Ad status updated",
    },
  ];
}

/** The table reads on the Ads page, by table name. */
function tableAnswer(name: string): Answer | undefined {
  switch (name) {
    // Today's decisions: the queue's one Leave it on Today and End of day.
    case "cockpit_decisions":
      return /^\/(dashboard|eod)\b/.test(
        new URLSearchParams(window.location.search).get("path") ?? "",
      )
        ? ok(harnessDecisions(Date.now()))
        : ok([]);
    // Today's plan: none yet.
    case "cockpit_plan_items":
    // Lead sync: no client checked yet, so the strip stays quiet.
    case "cockpit_lead_sync_status":
      return ok([]);
    case "cockpit_ads":
      return ok(adsPageAdRows());
    default:
      return undefined;
  }
}

/** The native media reads the page makes on load (mediaNativeClient.ts). */
function nativeRead(operation: unknown, now: number): Answer {
  switch (operation) {
    case "tracking.issues":
      return ok({
        rows: [
          {
            client: "Juniper Kitchens",
            adName: "Hook 2 | walkthrough",
            issue: "No UTM string",
          },
        ],
      });
    case "chat.activity":
      return ok({
        recent: [],
        queued: 0,
        waitingOnViktor: 0,
        lastSyncAt: now - 25 * 60_000,
        lastSyncOk: true,
        problems: [],
      });
    case "assist.queueDepth":
      return ok({ queued: 0, working: 0 });
    case "chat.thread":
      return ok([]);
    case "cockpit.onboardings":
    case "cockpit.launchWatch":
      return ok([]);
    default:
      return {
        data: null,
        error: { message: `The harness has no fixture for ${operation}.` },
      };
  }
}

export function installAdsPageHarness(client: SupabaseClient): void {
  const params = new URLSearchParams(window.location.search);
  const path = params.get("path") ?? "";
  if (!/^\/(ads|dashboard|eod)\b/.test(path)) return;
  const c = client as unknown as {
    rpc: (name: string, args?: Record<string, unknown>) => Promise<Answer>;
    from: (name: string) => unknown;
    auth: {
      getUser: () => Promise<unknown>;
      getSession: () => Promise<unknown>;
      onAuthStateChange: (
        callback: (event: string, session: unknown) => void,
      ) => unknown;
    };
  };

  const previousFrom = c.from.bind(c);
  c.from = (name: string) => {
    const answer = tableAnswer(name);
    return answer ? chain(answer) : previousFrom(name);
  };

  const previousRpc = c.rpc.bind(c);
  const answers = async (
    name: string,
    args: Record<string, unknown>,
  ): Promise<Answer | null> => {
    const now = Date.now();
    switch (name) {
      // The morning checklist: nothing ticked yet.
      case "cockpit_get_daily_checks":
        return ok([]);
      // No report yet today (personalEod.ts checked()).
      case "cockpit_personal_eod":
        return ok({
          owner: EOD_OWNER,
          day:
            typeof args.p_day === "string" && args.p_day
              ? args.p_day
              : fixtureDay(),
          report: null,
          outbox: null,
        });
      case "cockpit_media_source_read":
        await wait(150);
        return ok(adsPageSource(now));
      case "cockpit_media_live_campaigns":
        await wait(150);
        return ok(
          adsPageCampaignRows(now).map(row => {
            const age = AGED[String(row.campaign_name)];
            return age && /^\/dashboard\b/.test(path)
              ? {
                  ...row,
                  raw_data: {
                    ...(row.raw_data as Record<string, unknown>),
                    lastChangeAt: now - age * 86_400_000,
                  },
                }
              : row;
          }),
        );
      case "cockpit_media_eod_changes":
        return ok(harnessEodChanges(now));
      // A decision (Leave it, a call) is accepted and kept nowhere.
      case "cockpit_log_decision":
        return ok({ id: 9100 });
      case "cockpit_media_preferences":
        return args.p_language ? ok({ ok: true }) : ok([]);
      case "cockpit_media_statistics": {
        // A short wait, so the "…" on the ranged filters can be seen;
        // `&delay=3000` holds it long enough to look at.
        await wait(
          Number(new URLSearchParams(window.location.search).get("delay")) ||
            250,
        );
        const start = String(args.p_start ?? "");
        const end = String(args.p_end ?? "");
        switch (args.p_kind) {
          case "range":
            return ok(adsPageRange(args.p_campaign, start, end));
          case "campaignTrend":
            return ok(adsPageTrend(args.p_campaign, start, end));
          case "portfolioTrend":
            return ok(adsPageTrend(null, fixtureDay(30), fixtureDay(0)));
          case "coverage":
            return ok(adsPageCoverage());
          default:
            return {
              data: null,
              error: { message: "Unknown statistics operation" },
            };
        }
      }
      // A client's totals over the range, stopped campaigns included (R8).
      case "cockpit_media_client_range":
        await wait(200);
        return ok(
          adsPageClientRange(
            String(args.p_start ?? ""),
            String(args.p_end ?? ""),
            args.p_accounts,
          ),
        );
      case "cockpit_media_campaign_history":
        return ok([]);
      // A client's page lists the campaign builds saved for it: none here.
      case "cockpit_build_action":
        return args.p_operation === "list"
          ? ok([])
          : {
              data: null,
              error: { message: "The harness does not save builds." },
            };
      // An opened campaign's ads: none saved as a winner yet.
      case "cockpit_winner_saved_in":
        return ok({});
      // No logos uploaded: every client shows its initials.
      case "cockpit_get_client_logos":
        return ok([]);
      // Meta's payment checks: fresh, one account in its grace period.
      case "cockpit_ad_billing_panel":
        return ok(adsPageBilling(now));
      case "cockpit_media_native_read":
      case "cockpit_media_native_catalog_read":
        return nativeRead(args.p_operation, now);
      default:
        return null;
    }
  };
  c.rpc = (name: string, args: Record<string, unknown> = {}) =>
    reply(
      answers(name, args).then(answer => answer ?? previousRpc(name, args)),
    );

  // The native media reads check the signed-in account before and after
  // each read (accountGuard), and listen for it changing: the made-up seat
  // everywhere, or the first auth event (no session) would discard the read.
  const session = { access_token: "harness-token", user: USER };
  const previousListen = c.auth.onAuthStateChange.bind(c.auth);
  c.auth.onAuthStateChange = callback =>
    previousListen((event, real) => callback(event, real ?? session));
  const previousUser = c.auth.getUser.bind(c.auth);
  c.auth.getUser = async () => {
    const real = (await previousUser()) as { data?: { user?: unknown } };
    return real?.data?.user ? real : { data: { user: USER }, error: null };
  };
  const previousSession = c.auth.getSession.bind(c.auth);
  c.auth.getSession = async () => {
    const real = (await previousSession()) as {
      data?: { session?: { user?: { id?: string } } | null };
    };
    return real?.data?.session?.user?.id
      ? real
      : { data: { session }, error: null };
  };
}
