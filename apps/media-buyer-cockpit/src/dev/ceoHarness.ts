/**
 * The layout harness's CEO sections and the other reads the CEO screens make
 * (2026-10-11), laid over the hours harness's client: `cockpit_get_ceo_sections`
 * answers from tmp/harness/sections.json and the proposals card from
 * tmp/harness/extra.json when they exist (git-ignored, written from
 * production with SELECT and deleted after use); the rest is made up here.
 * Nothing reaches the network for the reads this file knows. Never imported
 * by the production app.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { adsFixtureMode, adsSectionFixture } from "./adsFixture";
import { eodRadarFixture } from "./eodRadarFixture";
import {
  watchBoardFixture,
  watchReviewed,
  watchSettings,
  watchShotPicture,
} from "./watchFixture";

type Answer = { data: unknown; error: { message: string } | null };
const ok = (data: unknown): Answer => ({ data, error: null });
const refuse = (message: string): Answer => ({
  data: null,
  error: { message },
});

/**
 * The CEO sections and the other reads the CEO screens make, from
 * tmp/harness/ (git-ignored): sections.json is `cockpit_get_ceo_sections`'s
 * answer, extra.json the proposals card's rows. Both optional: without them
 * every section is "Not computed yet", as before.
 */
let sectionsFile: Promise<unknown> | null = null;
const harnessSections = () =>
  (sectionsFile ??= fetch("/tmp/harness/sections.json")
    .then(r => (r.ok ? r.json() : null))
    .catch(() => null));
let extraFile: Promise<{
  proposals?: Record<string, unknown>[];
  leads?: { contact_id: string; name: string }[];
} | null> | null = null;
const harnessExtra = () =>
  (extraFile ??= fetch("/tmp/harness/extra.json")
    .then(r => (r.ok ? r.json() : null))
    .catch(() => null));

/** The Goals sheet, from tmp/harness/goalsheet.json (real context, git-ignored), changed in memory only. */
let goalSheetFile: Promise<Record<string, any> | null> | null = null;
const harnessGoalSheet = () =>
  (goalSheetFile ??= fetch("/tmp/harness/goalsheet.json")
    .then(r => (r.ok ? r.json() : null))
    .catch(() => null));

/** The morning note's switch (A372), made up and held in memory. */
const nudge = {
  on: false,
  updatedAt: "2026-10-11T08:00:00Z",
  updatedBy: "migration 20261011e (ships off)",
  last: null as null | Record<string, unknown>,
};

/** Changes and bugs (R6), made up. */
const feedback = [
  {
    id: 2,
    kind: "bug",
    text: "Money tab: the LTV card said the totals need reconciling and the whole tab went blank.",
    status: "queued",
    batch: null,
    note: null,
    created_at: "2026-10-11T09:12:00Z",
    dispatched_at: null,
    done_at: null,
  },
  {
    id: 1,
    kind: "change",
    text: "Put intro, demo and total cancel rates on tiles on Sales.",
    status: "dispatched",
    batch: "batch-20261011",
    note: null,
    created_at: "2026-10-10T16:40:00Z",
    dispatched_at: "2026-10-10T17:00:00Z",
    done_at: null,
  },
];

/** The team statuses the stored team section already carries, so the switch agrees with it. */
async function teamStatusRows(): Promise<Record<string, unknown>[]> {
  const file = (await harnessSections()) as {
    sections?: { team?: { payload?: { people?: any[]; inactive?: any[] } } };
  } | null;
  const t = file?.sections?.team?.payload;
  return [...(t?.people ?? []), ...(t?.inactive ?? [])]
    .filter(
      p =>
        (p.status && p.status !== "active") || p.statusSince || p.statusSetAt,
    )
    .map(p => ({
      person_key: p.key,
      status: p.status,
      since: p.statusSince,
      note: p.statusNote ?? null,
      set_at: p.statusSetAt ? new Date(p.statusSetAt).toISOString() : null,
    }));
}

/** `cockpit_ceo_action`: the actions the CEO screens read, made up. */
async function ceoAction(
  action: string,
  args: Record<string, unknown>,
): Promise<Answer> {
  switch (action) {
    case "feedback.list":
      return ok(feedback);
    case "feedback.add":
      return ok({ ...feedback[0], id: 3, text: args.text, kind: args.kind });
    case "feedback.setStatus":
    case "feedback.dispatch":
      return ok({ ok: true, dispatched: 1, batch: "batch-harness" });
    case "ltv.preview":
      // Production's refusal until the finance totals are reconciled (R3).
      return new URLSearchParams(window.location.search).get("ltv") === "ok"
        ? ok({ rows: [], missing: [], outOfScope: 4 })
        : refuse(
            "Finance totals need reconciliation before updating lifetime value",
          );
    case "teamStatus.list":
      return ok(await teamStatusRows());
    case "teamStatus.history":
      return ok([]);
    default:
      return refuse(`The harness has no fixture for ${action}.`);
  }
}

/** A read-only query builder over fixture rows, for `client.from(...)`. */
function fixtureQuery(rows: Record<string, unknown>[]) {
  let out = [...rows];
  const q = {
    select: () => q,
    order: (col: string, o?: { ascending?: boolean }) => {
      out.sort((a, b) =>
        String(a[col] ?? "").localeCompare(String(b[col] ?? "")),
      );
      if (o?.ascending === false) out.reverse();
      return q;
    },
    limit: (n: number) => {
      out = out.slice(0, n);
      return q;
    },
    in: (col: string, values: unknown[]) => {
      out = out.filter(r => values.includes(r[col]));
      return q;
    },
    eq: (col: string, v: unknown) => {
      out = out.filter(r => r[col] === v);
      return q;
    },
    neq: (col: string, v: unknown) => {
      out = out.filter(r => r[col] !== v);
      return q;
    },
    // biome-ignore lint/suspicious/noThenProperty: a thenable like supabase-js's builder
    then: (resolve: (a: Answer) => unknown) => resolve(ok(out)),
  };
  return q;
}

/** Lay the CEO reads over the client the hours harness already patched. */
export function installCeoHarness(client: SupabaseClient): void {
  const c = client as unknown as {
    rpc: (name: string, args?: Record<string, unknown>) => Promise<Answer>;
    from: (table: string) => unknown;
    auth: { getUser: () => unknown };
    functions: {
      invoke: (name: string, opts?: { body?: unknown }) => Promise<Answer>;
    };
    storage: { from: (bucket: string) => unknown };
  };
  // With ?reads=1 the shell's own reads run too: "who am I" answers "nobody
  // signed in" rather than throwing, as the real hook would with no session.
  // With ?ads=demo the Ads tab's switch needs a made-up user, as the media
  // actions client asks for one before it sends anything (adsFixture.ts).
  const adsMode = adsFixtureMode();
  c.auth.getUser = async () => ({
    data: {
      user: adsMode ? { id: "harness-ceo", email: "ceo@example.test" } : null,
    },
    error: null,
  });
  // The proposals card reads two tables straight (A234); nothing else is answered here.
  const realFrom = c.from.bind(c);
  c.from = (table: string) => {
    if (table !== "cockpit_sales_proposals" && table !== "cockpit_sales_leads")
      return realFrom(table);
    const rows = harnessExtra().then(x =>
      table === "cockpit_sales_proposals"
        ? (x?.proposals ?? [])
        : (x?.leads ?? []),
    );
    const steps: [string, unknown[]][] = [];
    const lazy: Record<string, unknown> = {};
    for (const m of ["select", "order", "limit", "in", "eq", "neq"])
      lazy[m] = (...a: unknown[]) => {
        steps.push([m, a]);
        return lazy;
      };
    // biome-ignore lint/suspicious/noThenProperty: a thenable like supabase-js's builder
    lazy.then = (
      resolve: (a: Answer) => unknown,
      reject: (e: unknown) => void,
    ) =>
      rows
        .then(r => {
          let q: any = fixtureQuery(r as Record<string, unknown>[]);
          for (const [m, a] of steps) q = q[m](...a);
          return q.then(resolve);
        })
        .catch(reject);
    return lazy;
  };
  const hoursRpc = c.rpc;
  c.rpc = async (name, args = {}) => {
    switch (name) {
      case "cockpit_get_ceo_sections": {
        const file = ((await harnessSections()) ?? {
          sections: {},
          day: "2026-10-09",
        }) as { sections?: Record<string, unknown> };
        // ?ads=demo: the made-up Ads section over whatever the file holds.
        return ok(
          adsMode
            ? {
                ...file,
                sections: { ...file.sections, b2bAds: adsSectionFixture() },
              }
            : file,
        );
      }
      case "cockpit_ceo_goal_sheet_context": {
        const f = await harnessGoalSheet();
        return f?.[String(args.p_month)]
          ? ok(f[String(args.p_month)])
          : refuse("No goal sheet fixture for this month");
      }
      case "cockpit_ceo_call_center_report": {
        const r = await fetch("/tmp/harness/callreport.json").then(x =>
          x.ok ? x.json() : null,
        );
        return r
          ? ok({ ...r, from: args.p_from, to: args.p_to })
          : refuse("No call report fixture");
      }
      case "cockpit_ceo_goals_context": {
        const f = await harnessGoalSheet();
        return f?.board ? ok(f.board) : refuse("No goals fixture");
      }
      case "cockpit_ceo_goal_sheet_save_cells": {
        const f = await harnessGoalSheet();
        const cells = args.p_cells as Record<string, any>[];
        for (const m of ["2026-10", "2026-11"]) {
          const tab = f?.[m];
          if (!tab) continue;
          for (const c of cells) {
            tab.cells = tab.cells.filter(
              (x: any) =>
                !(x.day === c.day && x.key === c.key && x.kind === c.kind),
            );
            if (c.value !== null) tab.cells.push({ ...c, by: "harness" });
          }
        }
        return ok({ saved: cells.length });
      }
      case "cockpit_ceo_goal_save_targets": {
        const f = await harnessGoalSheet();
        const rows = args.p_targets as Record<string, any>[];
        const tab = f?.["2026-11"];
        for (const r of rows) {
          const old = tab?.targets.find(
            (t: any) => t.metric_key === r.metricKey,
          );
          if (old) {
            old.target = r.target;
            old.note = r.note;
          }
        }
        return ok({ saved: rows.length });
      }
      case "cockpit_ceo_action":
        return ceoAction(
          String(args.p_action ?? ""),
          (args.p_args ?? {}) as Record<string, unknown>,
        );
      case "cockpit_ceo_manual_payment_info":
        return ok({
          today: "2026-10-11",
          tapLive: false,
          historyReady: true,
          totalsNeedRefresh: true,
          usdPerKwd: 3.26,
        });
      case "cockpit_ceo_manual_payment_clients":
        return ok([]);
      case "cockpit_ceo_hours_nudge_get":
        return ok(nudge);
      case "cockpit_ceo_hours_nudge_set":
        nudge.on = args.p_on === true;
        nudge.updatedAt = new Date().toISOString();
        nudge.updatedBy = "ceo@example.test";
        return ok(nudge);
      // EOD Radar (eodRadarFixture.ts, ?radar=full|unread|never|empty).
      case "cockpit_eod_radar_read":
        return ok(eodRadarFixture());
      // Hubstaff watch (watchFixture.ts, ?watch=full|none|source|noai|aifail|offshift|slack).
      case "cockpit_ceo_hours_watch_board":
        return ok(watchBoardFixture());
      case "cockpit_ceo_hours_watch_set":
        Object.assign(watchSettings, (args.p ?? {}) as Record<string, unknown>);
        return ok({ ok: true, settings: { ...watchSettings } });
      case "cockpit_ceo_hours_watch_review": {
        const p = (args.p ?? {}) as { incidentId?: number };
        const at = new Date().toISOString();
        watchReviewed.set(Number(p.incidentId), at);
        return ok({ ok: true, reviewedAt: at });
      }
      default:
        return hoursRpc(name, args);
    }
  };
  // The watch's two Edge actions; the rest go where they went before.
  // supabase-js builds a new `functions` client on every read of the
  // property, so one is kept on the client, or the patch would be lost.
  const functions = c.functions;
  const hoursInvoke = functions.invoke.bind(functions);
  Object.defineProperty(client, "functions", {
    configurable: true,
    value: functions,
  });
  functions.invoke = async (name, opts = {}) => {
    const body = (opts.body ?? {}) as Record<string, unknown>;
    // ?ads=demo: the Ads tab's switch and Launch list, made up. Nothing reaches Meta.
    if (name === "cockpit-media-api" && adsMode) {
      if (body.operation === "ceo.b2bLaunch.list") return ok([]);
      if (body.operation === "ceo.b2bControl.setStatus") {
        await new Promise(r => setTimeout(r, 900));
        return adsMode === "refuse"
          ? ok({
              ok: false,
              error:
                "Meta refused it: the ad account is not in good standing (made up).",
            })
          : ok({ ok: true, receiptId: "harness-receipt" });
      }
      return refuse(
        `The harness has no fixture for ${String(body.operation)}.`,
      );
    }
    if (name === "cockpit-hours-api" && body.op === "watchNow")
      return ok({ ok: true });
    // The answer names the provider the next run will use, as the server's does.
    if (name === "cockpit-hours-api" && body.op === "watchKey")
      return ok({
        ok: true,
        state: "connected",
        text: `Connected: ${body.provider === "google_ai" ? "Google AI" : "OpenAI"}. The next screenshots are read with it.`,
      });
    return hoursInvoke(name, opts);
  };
  // Stored screenshots: an invented picture, never the network.
  const realStorage = c.storage.from.bind(c.storage);
  c.storage.from = (bucket: string) =>
    bucket === "cockpit-hours-watch"
      ? {
          createSignedUrl: async (path: string) =>
            ok({ signedUrl: watchShotPicture(path) }),
        }
      : realStorage(bucket);
}
