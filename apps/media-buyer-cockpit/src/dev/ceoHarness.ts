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
  };
  // With ?reads=1 the shell's own reads run too: "who am I" answers "nobody
  // signed in" rather than throwing, as the real hook would with no session.
  c.auth.getUser = async () => ({ data: { user: null }, error: null });
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
      case "cockpit_get_ceo_sections":
        return ok(
          (await harnessSections()) ?? { sections: {}, day: "2026-10-09" },
        );
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
      default:
        return hoursRpc(name, args);
    }
  };
}
