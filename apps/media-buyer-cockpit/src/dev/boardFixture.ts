/**
 * Invented data for the Client Performance board (/performance), in the
 * shapes cockpit_board_read and cockpit_board_client return
 * (supabase/migrations/20261016133300_board_api.sql). Every client, person,
 * ad and number here is made up. The cells are built with the same rules as
 * the database (good, watch, off; too few under the minimum sample; NULL
 * with a sentence, never 0), so the harness and the screen tests see what
 * the real read sends. scripts/board-contract-supabase.test.ts checks that
 * these shapes carry the same keys as the real read's. Never imported by
 * the production app.
 */

type Json = Record<string, any>;

/** The official targets, as cockpit_board_default_targets() lists them. */
export const DEFAULT_TARGETS: [
  string,
  string,
  string,
  string,
  "higher" | "lower",
  number,
  number | null,
  boolean,
  boolean,
  number | null,
  string | null,
  string,
][] = [
  [
    "cpl",
    "cpl",
    "Cost per lead",
    "usd",
    "lower",
    15,
    22.5,
    false,
    false,
    null,
    null,
    "media_buyer",
  ],
  [
    "cost_per_booking",
    "costPerBooking",
    "Cost per booking",
    "usd",
    "lower",
    60,
    80,
    false,
    false,
    null,
    null,
    "media_buyer",
  ],
  [
    "lead_to_booking",
    "leadToBooking",
    "Lead to booking",
    "percent",
    "higher",
    25,
    17.5,
    false,
    false,
    10,
    "CRM leads",
    "call_center",
  ],
  [
    "show_rate",
    "showRate",
    "Show rate",
    "percent",
    "higher",
    70,
    60,
    false,
    true,
    5,
    "marked meetings",
    "call_center",
  ],
  [
    "quotation_rate",
    "quotationRate",
    "Quotation rate",
    "percent",
    "higher",
    50,
    30,
    false,
    false,
    5,
    "shows",
    "client_success",
  ],
  [
    "close_rate",
    "closeRate",
    "Close rate",
    "percent",
    "higher",
    30,
    20,
    false,
    false,
    5,
    "shows",
    "client_success",
  ],
  [
    "aov",
    "aov",
    "Average order value",
    "usd",
    "higher",
    10000,
    null,
    false,
    false,
    null,
    null,
    "client_success",
  ],
  [
    "roas",
    "roas",
    "ROAS",
    "times",
    "higher",
    20,
    10,
    false,
    false,
    null,
    null,
    "media_buyer",
  ],
  [
    "lead_quality",
    "leadQuality",
    "Lead quality",
    "score",
    "higher",
    7,
    5,
    false,
    false,
    null,
    null,
    "media_buyer",
  ],
  [
    "no_outcome_share",
    "noOutcomeShare",
    "No outcome",
    "percent",
    "lower",
    0,
    10,
    false,
    false,
    1,
    "meetings due",
    "client_success",
  ],
  [
    "budget_used",
    "budgetUsed",
    "Budget used",
    "percent",
    "higher",
    90,
    70,
    false,
    false,
    3,
    "days with a budget",
    "media_buyer",
  ],
  [
    "cpm",
    "cpm",
    "CPM",
    "usd",
    "lower",
    10,
    15,
    false,
    false,
    1000,
    "impressions",
    "media_buyer",
  ],
  [
    "frequency",
    "frequency",
    "Frequency",
    "ratio",
    "lower",
    2.5,
    3.5,
    true,
    false,
    1000,
    "impressions",
    "creative",
  ],
  [
    "link_ctr",
    "linkCtr",
    "Link CTR",
    "percent",
    "higher",
    0.8,
    0.3,
    false,
    false,
    1000,
    "impressions",
    "creative",
  ],
  [
    "cpc",
    "cpc",
    "Cost per link click",
    "usd",
    "lower",
    1.25,
    2,
    false,
    false,
    1000,
    "impressions",
    "media_buyer",
  ],
  [
    "opt_in",
    "optIn",
    "Opt-in rate",
    "percent",
    "higher",
    10,
    2,
    false,
    false,
    50,
    "link clicks",
    "media_buyer",
  ],
  [
    "hook_rate",
    "hookRate",
    "Hook rate",
    "percent",
    "higher",
    25,
    15,
    false,
    false,
    1000,
    "video impressions",
    "creative",
  ],
  [
    "hold_rate",
    "holdRate",
    "Hold rate",
    "percent",
    "higher",
    30,
    15,
    false,
    false,
    1000,
    "video impressions",
    "creative",
  ],
  [
    "leads_touched",
    "leadsTouched",
    "Leads touched",
    "percent",
    "higher",
    90,
    90,
    false,
    false,
    20,
    "callable leads",
    "call_center",
  ],
  [
    "first_call",
    "firstCall",
    "First call",
    "minutes",
    "lower",
    30,
    30,
    false,
    false,
    null,
    null,
    "call_center",
  ],
];

export function targetsMap(
  overrides: Record<string, { good: number; watch: number | null }> = {},
): Json {
  const out: Json = {};
  for (const [
    metric,
    key,
    label,
    unit,
    direction,
    good,
    watch,
    strict,
    neverOff,
    minSample,
    sample,
    owner,
  ] of DEFAULT_TARGETS) {
    const b = overrides[metric];
    out[metric] = {
      key,
      label,
      unit,
      direction,
      good: b ? b.good : good,
      watch: b ? b.watch : watch,
      source: b ? "board" : "official",
      official: { good, watch },
      board: b
        ? {
            good: b.good,
            watch: b.watch,
            by: "ceo@example.test",
            at: "2026-10-15T09:00:00Z",
            note: null,
          }
        : null,
      client: null,
      strict,
      neverOff,
      minSample,
      sample,
      owner,
      basis: "fixture",
    };
  }
  return out;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

function judge(v: number, t: Json): string {
  const s = t.strict;
  if (
    t.direction === "higher"
      ? v > t.good || (v === t.good && !s)
      : v < t.good || (v === t.good && !s)
  )
    return "good";
  if (t.watch === null || t.neverOff) return "watch";
  return (t.direction === "higher" ? v >= t.watch : v <= t.watch)
    ? "watch"
    : "off";
}

/** One cell as cockpit_board_cell builds it. */
function cell(
  metric: string | null,
  v: number | null,
  T: Json,
  o: Json = {},
): Json {
  const t = metric ? T[metric] : null;
  let status: string | null = o.status ?? null;
  if (!status && v === null) status = "not_measured";
  if (!status && t)
    status =
      t.minSample !== null && (o.sample ?? 0) < t.minSample
        ? "too_few"
        : judge(v as number, t);
  const out: Json = { v, status };
  for (const k of ["num", "den", "sample", "note"])
    if (o[k] !== undefined && o[k] !== null) out[k] = o[k];
  if (t) out.target = metric;
  return { ...out, ...(o.extra ?? {}) };
}

const count = (v: number | null, note?: string): Json =>
  v === null
    ? {
        v: null,
        status: "not_measured",
        note: note ?? "No figure is stored for these days.",
      }
    : { v, status: null };

type Ad = {
  spend: number;
  imp: number;
  reach?: number;
  clicks: number;
  leads?: number | null;
  video?: {
    imp: number;
    v3: number;
    thru: number;
    plays: number;
    p: [number, number, number, number];
  };
};

/** The ad cells from summed ad numbers, as cockpit_board_ad_cells builds them. */
export function adCells(a: Ad | null, T: Json, note?: string): Json {
  if (!a) {
    const out: Json = {};
    for (const k of [
      "spend",
      "impressions",
      "linkClicks",
      "metaLeads",
      "cpl",
      "cpm",
      "frequency",
      "linkCtr",
      "cpc",
      "optIn",
      "hookRate",
      "holdRate",
      "retention25",
      "retention50",
      "retention75",
      "retention100",
    ])
      out[k] = {
        v: null,
        status: "not_measured",
        note: note ?? "No Meta ad account is linked to this client.",
      };
    return out;
  }
  const leadRows = a.leads !== null && a.leads !== undefined;
  const leads = a.leads ?? 0;
  const out: Json = {
    spend: cell(null, r2(a.spend), T),
    impressions: cell(null, a.imp, T),
    linkClicks: cell(null, a.clicks, T),
    metaLeads: leadRows
      ? cell(null, leads, T)
      : cell(null, null, T, {
          status: "not_measured",
          note: "No lead-form campaign ran in this time frame.",
        }),
    cpl: !leadRows
      ? cell("cpl", null, T, {
          status: "not_measured",
          note: "No lead-form campaign ran in this time frame.",
        })
      : leads > 0
        ? cell("cpl", r2(a.spend / leads), T, {
            sample: leads,
            num: r2(a.spend),
            den: leads,
          })
        : cell("cpl", null, T, {
            sample: 0,
            num: r2(a.spend),
            den: 0,
            status: a.spend > 22.5 ? "off" : "too_few",
            note: `No form lead yet for $${a.spend.toFixed(2)} of lead-campaign spend.`,
            extra: { atLeast: r2(a.spend) },
          }),
    cpm:
      a.imp > 0
        ? cell("cpm", r2((a.spend / a.imp) * 1000), T, {
            sample: a.imp,
            num: r2(a.spend),
            den: a.imp,
          })
        : cell("cpm", null, T, {
            sample: 0,
            status: "too_few",
            note: "No impressions in this time frame.",
          }),
    frequency:
      a.reach && a.reach > 0
        ? cell("frequency", r2(a.imp / a.reach), T, {
            sample: a.imp,
            num: a.imp,
            den: a.reach,
            note: "Over the whole time frame: Meta's reach for it, read to today.",
            extra: { basis: "window" },
          })
        : cell("frequency", null, T, {
            status: "too_few",
            note: "No impressions in this time frame.",
          }),
    linkCtr:
      a.imp > 0
        ? cell("link_ctr", r2((a.clicks / a.imp) * 100), T, {
            sample: a.imp,
            num: a.clicks,
            den: a.imp,
          })
        : cell("link_ctr", null, T, {
            sample: 0,
            status: "too_few",
            note: "No impressions in this time frame.",
          }),
    cpc:
      a.clicks > 0
        ? cell("cpc", r2(a.spend / a.clicks), T, {
            sample: a.imp,
            num: r2(a.spend),
            den: a.clicks,
          })
        : cell("cpc", null, T, {
            sample: a.imp,
            status: "too_few",
            note: "No link clicks in this time frame.",
          }),
    optIn: !leadRows
      ? cell("opt_in", null, T, {
          status: "not_measured",
          note: "No lead-form campaign ran in this time frame.",
        })
      : a.clicks > 0
        ? cell("opt_in", r2((leads / a.clicks) * 100), T, {
            sample: a.clicks,
            num: leads,
            den: a.clicks,
            note: "Form leads / link clicks on lead campaigns.",
          })
        : cell("opt_in", null, T, {
            sample: 0,
            status: "too_few",
            note: "No link clicks on lead campaigns in this time frame.",
          }),
  };
  const notVideo = {
    status: "not_measured",
    note: "Not a video: no video ad ran in this time frame.",
    extra: { notVideo: true },
  };
  if (!a.video) {
    out.hookRate = cell("hook_rate", null, T, notVideo);
    out.holdRate = cell("hold_rate", null, T, notVideo);
    for (const k of ["25", "50", "75", "100"])
      out[`retention${k}`] = cell(null, null, T, notVideo);
  } else {
    const v = a.video;
    out.hookRate = cell("hook_rate", r2((v.v3 / v.imp) * 100), T, {
      sample: v.imp,
      num: v.v3,
      den: v.imp,
      note: "3-second plays / impressions of video ads.",
    });
    out.holdRate = cell("hold_rate", r2((v.thru / v.v3) * 100), T, {
      sample: v.imp,
      num: v.thru,
      den: v.v3,
      note: "ThruPlays / 3-second plays.",
    });
    ["25", "50", "75", "100"].forEach((k, i) => {
      out[`retention${k}`] = cell(null, r2((v.p[i] / v.plays) * 100), T, {
        sample: v.plays,
        num: v.p[i],
        den: v.plays,
      });
    });
  }
  return out;
}

type Biz = {
  crm: number | null;
  booked: number | null;
  prov: number | null;
  due: number | null;
  shows: number | null;
  noShows: number | null;
  noOutcome: number | null;
  oldestDays?: number | null;
  quotes: number | null;
  closes: number | null;
  valued?: number;
  revenue?: number;
  lq?: [number, number] | null;
  dials: number | null;
  called: number | null;
  touched?: [number, number] | null;
  untouched?: number | null;
  firstCallMin?: number | null;
};

type ClientSpec = {
  loc: string;
  clickup: string | null;
  name: string;
  status?: string;
  mode: "DFY" | "DWY" | null;
  callers: { email: string; name: string }[];
  ad: Ad | null;
  biz: Biz;
  levers?: { open: number; reconcile: number };
  /** Its Meta budgets; left out on a client with no ad account. */
  budget?: BudgetSpec;
  overrides?: Record<string, { good: number; watch: number | null }>;
  notes?: string[];
};

/**
 * A client's Meta budgets, invented (cockpit_meta_budgets and its days):
 * read false when the account's budgets were never read.
 */
type BudgetSpec = {
  read?: false;
  /** Daily budgets switched on now (blocked ones too), USD, and how many campaigns hold them. */
  now: number;
  cbo: number;
  abo: number;
  /** Switched on with a lifetime budget: left out. */
  lifetime?: number;
  /** Of `now`, switched on but not delivering: how many, their budgets a day, why. */
  held?: [number, number, string];
  /** Waiting for its start: how many, and the words ("Starts 20 Oct"). */
  starting?: [number, string];
  /** Spend / daily budgets over the time frame (1 is 100%); null: no daily budget switched on. */
  used: number | null;
  /** Days with a budget, when fewer than the time frame's. */
  days?: number;
  /** Yesterday: spend and daily budgets. */
  yesterday: [number, number];
  /** Campaigns switched on with a daily budget that spent nothing yesterday. */
  notSpending?: number;
  /** Accounts that need action (a payment, the account, the spending limit or prepaid balance). */
  issues?: { issue: string; words: string }[];
};

const BUDGETS_AS_OF = "2026-10-16T10:12:00Z";
const NO_ACCOUNT = "No Meta ad account is linked to this client.";
/** The words for an account whose budgets were never read (cockpit_board_budget_cells). */
const budgetsUnread = (accountId: string, name: string) =>
  `Budgets for act_${accountId} (${name} ads) have not been read.`;
const OVER =
  "Above its daily budgets: Meta may spend up to 75% over a daily budget on one day, and at most 7 times it in a week.";

function dayBefore(day: string, n = 1): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) - n * 86400e3)
    .toISOString()
    .slice(0, 10);
}

/** Budget used as cockpit_board_budget_cells builds it, from the spend on budgeted days and its share. */
function usedCell(
  T: Json,
  spend: number,
  ratio: number | null,
  budgetDays: number,
  days: number,
  extra: Json,
): Json {
  const x: Json = { ...extra };
  const notes: string[] = [];
  if (budgetDays < days) {
    Object.assign(x, { partial: true, pairedDays: budgetDays });
    notes.push(
      `Over the ${budgetDays} of ${days} days whose budgets are known. Budgets are stored from 15 Oct 2026.`,
    );
  }
  if (ratio === null)
    return cell("budget_used", null, T, {
      sample: 0,
      num: 0,
      den: 0,
      status: "too_few",
      note: [
        "No campaign was switched on with a daily budget in these days.",
        ...notes,
      ].join(" "),
      extra: x,
    });
  const num = r2(spend);
  const den = r2(spend / ratio);
  const v = r2((num / den) * 100);
  if (v > 110) {
    x.over = true;
    notes.push(OVER);
  }
  return cell("budget_used", v, T, {
    sample: budgetDays,
    num,
    den,
    note: notes.length ? notes.join(" ") : undefined,
    extra: x,
  });
}

/** A client row's three budget cells, as cockpit_board_budget_cells builds them. */
function budgetCells(
  c: ClientSpec,
  days: number,
  today: string,
  T: Json,
): Json {
  if (!c.ad)
    return {
      dailyBudget: cell(null, null, T, {
        status: "not_measured",
        note: NO_ACCOUNT,
      }),
      spendPerDay: cell(null, null, T, {
        status: "not_measured",
        note: NO_ACCOUNT,
      }),
      budgetUsed: cell("budget_used", null, T, {
        status: "not_measured",
        note: NO_ACCOUNT,
      }),
    };
  const spend = r2(c.ad.spend);
  const spendPerDay = cell(null, r2(spend / days), T, {
    num: spend,
    den: days,
  });
  const b = c.budget;
  const accountId = `99${c.loc.slice(-6)}`;
  if (!b || b.read === false)
    return {
      dailyBudget: cell(null, null, T, {
        status: "not_measured",
        note: budgetsUnread(accountId, c.name),
      }),
      spendPerDay,
      budgetUsed: cell("budget_used", null, T, {
        status: "not_measured",
        note: budgetsUnread(accountId, c.name),
        extra: { budgetDays: null, yesterday: null, notSpending: null },
      }),
    };
  const n = b.cbo + b.abo;
  const said = [
    n === 0
      ? "No campaign is switched on with a daily budget now."
      : `${n === 1 ? "1 campaign" : `${n} campaigns`} switched on now: ${[
          b.cbo ? `${b.cbo} on a campaign budget` : null,
          b.abo ? `${b.abo} on ad set budgets` : null,
        ]
          .filter(Boolean)
          .join(", ")}.`,
    b.held
      ? `${b.held[0]} of them ${b.held[0] === 1 ? "is" : "are"} not delivering ($${b.held[1]}.00 a day): ${b.held[2]}.`
      : null,
    b.lifetime
      ? `${b.lifetime === 1 ? "1 campaign" : `${b.lifetime} campaigns`} on a lifetime budget ${b.lifetime === 1 ? "is" : "are"} left out.`
      : null,
    b.starting
      ? `${b.starting[0] === 1 ? "1 campaign is" : `${b.starting[0]} campaigns are`} waiting for ${b.starting[0] === 1 ? "its" : "their"} start, not counted yet: ${b.starting[1]}.`
      : null,
    ...(b.issues ?? []).map(i => `${i.words} (${c.name} ads).`),
    "Read 16 Oct 13:12 Kuwait time: the budget now, whatever the time frame.",
  ].filter(Boolean);
  const dailyBudget = cell(null, r2(b.now), T, {
    note: said.join(" "),
    extra: {
      campaigns: n,
      lifetime: b.lifetime ?? 0,
      asOf: BUDGETS_AS_OF,
      notDelivering: b.held?.[0] ?? 0,
      ...(b.held ? { heldBudget: b.held[1] } : {}),
      ...(b.starting ? { starting: b.starting[0] } : {}),
      ...(b.issues
        ? {
            accountIssues: b.issues.map(i => ({
              accountId,
              name: `${c.name} ads`,
              ...i,
            })),
          }
        : {}),
    },
  });
  const budgetDays = Math.min(b.days ?? days, days);
  const budgetUsed = usedCell(
    T,
    r2((spend * budgetDays) / days),
    b.used,
    budgetDays,
    days,
    {
      budgetDays: b.used === null ? 0 : budgetDays,
      yesterday: {
        day: dayBefore(today),
        spend: b.yesterday[0],
        budget: b.yesterday[1],
      },
      notSpending: b.notSpending ?? 0,
    },
  );
  return { dailyBudget, spendPerDay, budgetUsed };
}

function clientRow(
  c: ClientSpec,
  days: number,
  board: Json,
  today: string,
): Json {
  const T = targetsMap();
  // The client's own overrides judge its cells, as cockpit_board_targets_map(clickup) does.
  for (const [m, o] of Object.entries(c.overrides ?? {})) {
    T[m] = { ...T[m], good: o.good, watch: o.watch, source: "client" };
  }
  for (const [m, t] of Object.entries(board))
    if ((t as Json).source === "board" && !c.overrides?.[m]) T[m] = t;
  const b = c.biz;
  const dwy = c.mode === "DWY";
  const calls = {
    v: null,
    status: "not_measured",
    note: "The client calls: Done With You.",
    clientCalls: true,
  };
  const v: Json = { ...adCells(c.ad, T), ...budgetCells(c, days, today, T) };
  const spend = c.ad?.spend ?? null;
  const marked = (b.shows ?? 0) + (b.noShows ?? 0);
  const notFilled = (what: string) => ({
    v: null,
    status: "not_filled_in",
    note: `The client does not record ${what}.`,
  });
  Object.assign(v, {
    crmLeads:
      b.crm === null
        ? count(null)
        : {
            ...count(b.crm),
            dms: 2,
            note: "2 of these are an Instagram or Messenger chat with no ad behind it; WhatsApp chats are left out.",
          },
    crmAdLeads: count(b.crm === null ? null : Math.round(b.crm * 0.85)),
    confirmedBookings: count(b.booked),
    provisionalBookings: count(b.prov),
    meetingsDue: count(b.due),
    noOutcome: { ...count(b.noOutcome), oldestDays: b.oldestDays ?? null },
    dials: dwy ? calls : count(b.dials),
    leadsCalled: dwy
      ? calls
      : {
          ...count(b.called),
          ...(b.called !== null && b.crm
            ? { share: r2((b.called / b.crm) * 100) }
            : {}),
        },
    leadToBooking:
      b.crm === null || b.booked === null
        ? cell("lead_to_booking", null, T, { status: "not_measured" })
        : b.crm === 0
          ? cell("lead_to_booking", null, T, {
              sample: 0,
              num: b.booked,
              den: 0,
              status: "too_few",
              note: "No CRM lead in this time frame.",
            })
          : cell("lead_to_booking", r2((b.booked / b.crm) * 100), T, {
              sample: b.crm,
              num: b.booked,
              den: b.crm,
            }),
    costPerBooking:
      spend === null
        ? cell("cost_per_booking", null, T, {
            status: "not_measured",
            note: "No Meta ad account is linked to this client.",
          })
        : b.booked
          ? cell("cost_per_booking", r2(spend / b.booked), T, {
              sample: b.booked,
              num: r2(spend),
              den: b.booked,
              note: "Spend and confirmed bookings over the same days, to yesterday.",
            })
          : cell("cost_per_booking", null, T, {
              sample: 0,
              num: r2(spend),
              den: 0,
              status: spend > 80 ? "off" : "too_few",
              note: `No confirmed booking yet for $${spend.toFixed(2)} of spend.`,
              extra: { atLeast: r2(spend) },
            }),
    shows:
      b.due === null
        ? {
            v: null,
            status: "not_measured",
            note: "No figure is stored for these days.",
          }
        : b.due > 0 && marked === 0
          ? {
              v: null,
              status: "not_filled_in",
              due: b.due,
              note: `None of the ${b.due} meetings due is marked showed or no-show.`,
            }
          : {
              v: b.shows ?? 0,
              status: null,
              noShows: b.noShows ?? 0,
              marked,
              due: b.due,
              note: `${marked} of ${b.due} meetings due are marked.`,
            },
    noShows:
      b.due === null || (b.due > 0 && marked === 0)
        ? { v: null, status: b.due === null ? "not_measured" : "not_filled_in" }
        : { v: b.noShows ?? 0, status: null },
    showRate:
      b.due === null
        ? cell("show_rate", null, T, { status: "not_measured" })
        : b.due === 0
          ? cell("show_rate", null, T, {
              sample: 0,
              status: "too_few",
              note: "No meeting was due in this time frame.",
            })
          : marked === 0
            ? cell("show_rate", null, T, {
                sample: 0,
                status: "not_filled_in",
                note: `None of the ${b.due} meetings due is marked showed or no-show.`,
              })
            : cell("show_rate", r2(((b.shows ?? 0) / marked) * 100), T, {
                sample: marked,
                num: b.shows ?? 0,
                den: marked,
                note: `${marked} of ${b.due} meetings due are marked.`,
              }),
    quotations: b.quotes === null ? notFilled("quotations") : count(b.quotes),
    quotationAnswers: {
      v: null,
      status: "not_measured",
      note: "The client sheet copy keeps only Y, so answers cannot be counted.",
    },
    quotationRate:
      b.quotes === null || b.quotes === 0
        ? cell("quotation_rate", null, T, {
            status: "not_filled_in",
            note: "No quotation is recorded in this time frame, so the rate is not known.",
          })
        : cell("quotation_rate", r2((b.quotes / (b.shows || 1)) * 100), T, {
            sample: b.shows ?? 0,
            num: b.quotes,
            den: b.shows ?? 0,
          }),
    closes:
      b.closes === null
        ? notFilled("closed deals")
        : {
            ...count(b.closes),
            withValue: b.valued ?? b.closes,
            pending: 2,
            lost: 1,
            note: `Won ${b.closes}, still pending 2, lost 1.`,
          },
    closeRate:
      b.closes === null
        ? cell("close_rate", null, T, {
            status: "not_filled_in",
            note: "The client does not record closed deals.",
          })
        : !b.shows
          ? cell("close_rate", null, T, {
              sample: 0,
              num: b.closes,
              den: 0,
              status: "too_few",
              note: "No show in this time frame.",
            })
          : cell("close_rate", r2((b.closes / b.shows) * 100), T, {
              sample: b.shows,
              num: b.closes,
              den: b.shows,
            }),
    revenue:
      b.closes === null
        ? notFilled("closed deals")
        : { v: b.revenue ?? 0, status: null },
    aov:
      b.closes === null
        ? cell("aov", null, T, {
            status: "not_filled_in",
            note: "The client does not record closed deals.",
          })
        : (b.valued ?? b.closes) > 0
          ? cell("aov", r2((b.revenue ?? 0) / (b.valued ?? b.closes)), T, {
              sample: b.valued ?? b.closes,
              num: b.revenue ?? 0,
              den: b.valued ?? b.closes,
            })
          : cell("aov", null, T, {
              sample: 0,
              status: "too_few",
              note: "No closed deal in this time frame.",
            }),
    roas:
      b.closes === null
        ? cell("roas", null, T, {
            status: "not_filled_in",
            note: "The client does not record closed deals.",
          })
        : spend === null || spend === 0
          ? cell("roas", null, T, {
              status: "not_measured",
              note: "No ad spend in these days.",
            })
          : cell("roas", r2((b.revenue ?? 0) / spend), T, {
              num: b.revenue ?? 0,
              den: r2(spend),
              note: "Revenue by meeting day to yesterday, over the same days' spend.",
            }),
    leadQuality:
      b.lq === null || b.lq === undefined
        ? cell("lead_quality", null, T, {
            status: "not_filled_in",
            note: "The client does not rate leads in the portal.",
          })
        : cell("lead_quality", r2(b.lq[0] / b.lq[1]), T, {
            sample: b.lq[1],
            num: b.lq[0],
            den: b.lq[1],
          }),
    noOutcomeShare:
      b.due === null || b.noOutcome === null
        ? cell("no_outcome_share", null, T, { status: "not_measured" })
        : b.due === 0
          ? cell("no_outcome_share", null, T, {
              sample: 0,
              num: 0,
              den: 0,
              status: "too_few",
              note: "No meeting was due in this time frame.",
            })
          : cell("no_outcome_share", r2((b.noOutcome / b.due) * 100), T, {
              sample: b.due,
              num: b.noOutcome,
              den: b.due,
            }),
    leadsTouched: dwy
      ? calls
      : b.touched
        ? cell("leads_touched", r2((b.touched[0] / b.touched[1]) * 100), T, {
            sample: b.touched[1],
            num: b.touched[0],
            den: b.touched[1],
            note: `${b.touched[0]} of the ${b.touched[1]} callable leads from the last 30 days have a Maqsam call, as of 16 Oct 13:30 Kuwait time.`,
            extra: {
              outcomeOnly: 0,
              touchedShare: r2((b.touched[0] / b.touched[1]) * 100),
            },
          })
        : cell("leads_touched", null, T, {
            status: "not_measured",
            note: "The call centre figures have not been worked out yet.",
          }),
    untouchedLeads: dwy
      ? calls
      : {
          v: b.untouched ?? null,
          status:
            b.untouched === null || b.untouched === undefined
              ? "not_measured"
              : null,
          oldestAt: null,
          note: "Leads still waiting for a first call now.",
        },
    firstCall: dwy
      ? calls
      : Number.isFinite(b.firstCallMin ?? Number.NaN)
        ? cell("first_call", b.firstCallMin as number, T, {
            note: "Median first call in working minutes, last 30 days.",
          })
        : cell("first_call", null, T, {
            status: "not_measured",
            note: "No first call in the last 30 days.",
          }),
  });
  const notes = [...(c.notes ?? [])];
  if (dwy) notes.push("Done With You: the client calls its own leads.");
  if (!c.clickup)
    notes.push("No ClickUp card, so no lever can be filed for this client.");
  return {
    locationId: c.loc,
    clickupId: c.clickup,
    clientName: c.name,
    status: c.status ?? "Active",
    serviceMode: c.mode,
    clientCalls: dwy,
    tiktok: false,
    adAccounts: c.ad ? [`99${c.loc.slice(-6)}`] : [],
    adCover: c.ad
      ? {
          state: "full",
          partial: false,
          winTo: "",
          adDays: days,
          pairFrom: "",
          pairTo: "",
          note: null,
        }
      : { state: "no_account" },
    callers: c.callers,
    noOutcome: b.noOutcome,
    noOutcomeOldestDays: b.oldestDays ?? null,
    values: v,
    overrides: Object.fromEntries(
      Object.entries(c.overrides ?? {}).map(([m, o]) => [
        m,
        {
          ...o,
          by: "ceo@example.test",
          at: "2026-10-15T09:00:00Z",
          note: null,
        },
      ]),
    ),
    levers: {
      open: c.levers?.open ?? 0,
      reconcile: c.levers?.reconcile ?? 0,
      lastAt: c.levers ? "2026-10-14T08:00:00Z" : null,
    },
    computedAt: "2026-10-16T10:30:00Z",
    adsFetchedAt: c.ad ? "2026-10-16T10:07:00Z" : null,
    sources: {
      leads: { ok: true, state: "ok", as_of: "2026-10-16T10:29:00Z" },
    },
    notes,
  };
}

const RANA = { email: "rana@example.test", name: "Rana Saleh" };
const DANA = { email: "dana@example.test", name: "Dana Yousef" };

const video = (imp: number): Ad["video"] => ({
  imp,
  v3: Math.round(imp * 0.27),
  thru: Math.round(imp * 0.27 * 0.34),
  plays: Math.round(imp * 0.6),
  p: [
    Math.round(imp * 0.6 * 0.52),
    Math.round(imp * 0.6 * 0.31),
    Math.round(imp * 0.6 * 0.18),
    Math.round(imp * 0.6 * 0.09),
  ],
});

/** The clients of the board, scaled to the time frame's length. */
export function clientSpecs(days: number): ClientSpec[] {
  const k = Math.max(days, 1) / 30;
  const n = (x: number) => Math.round(x * k);
  const m = (x: number) => r2(x * k);
  return [
    {
      loc: "locFixHarbor01",
      // Good and over: the campaign budget spent past it while one ad set
      // campaign spent nothing yesterday and another is blocked by its ads
      // (its $30 counts), and the account is under a day of budget from its
      // spending limit.
      budget: {
        now: 115,
        cbo: 1,
        abo: 2,
        lifetime: 1,
        held: [1, 30, "Ads with issues"],
        used: 1.12,
        yesterday: [44, 115],
        notSpending: 2,
        issues: [
          {
            issue: "limit_near",
            words:
              "Spending limit nearly used: 140.00 SAR left, under a day of budget",
          },
        ],
      },
      clickup: "86fixhar1",
      name: "Harbor Kitchens",
      mode: "DFY",
      callers: [RANA],
      ad: {
        spend: m(1240),
        imp: n(98000),
        reach: n(52000),
        clicks: n(1180),
        leads: n(96),
        video: video(n(54000)),
      },
      biz: {
        crm: n(102),
        booked: n(31),
        prov: n(6),
        due: n(27),
        shows: n(21),
        noShows: n(4),
        noOutcome: n(2),
        oldestDays: 6,
        quotes: n(12),
        closes: n(5),
        revenue: m(64000),
        lq: [n(55) || 1, n(8) || 1],
        dials: n(640),
        called: n(98),
        touched: [96, 101],
        untouched: 1,
        firstCallMin: 12.4,
      },
      levers: { open: 1, reconcile: 0 },
    },
    {
      loc: "locFixDune0002",
      // Watch; a prepaid balance under a day of budget, and a campaign waiting for its start.
      budget: {
        now: 60,
        cbo: 2,
        abo: 0,
        used: 0.8,
        yesterday: [48, 60],
        starting: [1, "Starts 20 Oct"],
        issues: [
          {
            issue: "balance_low",
            words: "Prepaid balance: $35.00 left, under a day of budget",
          },
        ],
      },
      clickup: "86fixdun2",
      name: "Dune Interiors",
      mode: "DFY",
      callers: [DANA],
      ad: {
        spend: m(980),
        imp: n(61000),
        reach: n(17000),
        clicks: n(420),
        leads: n(41),
        video: video(n(30000)),
      },
      biz: {
        crm: n(48),
        booked: n(9),
        prov: n(3),
        due: n(10),
        shows: n(5),
        noShows: n(4),
        noOutcome: n(4),
        oldestDays: 11,
        quotes: n(2),
        closes: n(1),
        revenue: m(9000),
        lq: null,
        dials: n(380),
        called: n(40),
        touched: [38, 52],
        untouched: 9,
        firstCallMin: 46,
      },
    },
    {
      loc: "locFixLiwan003",
      // Good, with one campaign switched on but blocked by its ads: its $30 counts.
      budget: {
        now: 100,
        cbo: 2,
        abo: 1,
        held: [1, 30, "Ads with issues"],
        used: 0.91,
        yesterday: [66, 100],
        notSpending: 1,
      },
      clickup: "86fixliw3",
      name: "Liwan Limited",
      mode: "DFY",
      callers: [RANA, DANA],
      ad: {
        spend: m(1610),
        imp: n(143000),
        reach: n(70000),
        clicks: n(1650),
        leads: n(140),
      },
      biz: {
        crm: n(151),
        booked: n(44),
        prov: n(9),
        due: n(39),
        shows: n(29),
        noShows: n(7),
        noOutcome: n(3),
        oldestDays: 4,
        quotes: n(17),
        closes: n(9),
        revenue: m(118000),
        lq: [n(70) || 1, n(10) || 1],
        dials: n(1010),
        called: n(146),
        touched: [148, 152],
        untouched: 0,
        firstCallMin: 8.1,
      },
      overrides: { cpl: { good: 12, watch: 18 } },
    },
    {
      loc: "locFixReem0004",
      // Off: the account is unsettled now, so its budget spent nothing yesterday.
      budget: {
        now: 40,
        cbo: 1,
        abo: 0,
        held: [1, 40, "Account unsettled: payment needed"],
        used: 0.55,
        yesterday: [0, 40],
        notSpending: 1,
        issues: [
          { issue: "billing", words: "Account unsettled: payment needed" },
        ],
      },
      clickup: "86fixree4",
      name: "مطابخ الريم",
      mode: "DFY",
      callers: [],
      ad: {
        spend: m(720),
        imp: n(80000),
        reach: n(21000),
        clicks: n(210),
        leads: n(19),
        video: video(n(70000)),
      },
      biz: {
        crm: n(23),
        booked: n(3),
        prov: n(1),
        due: n(4),
        shows: 0,
        noShows: 0,
        noOutcome: n(4),
        oldestDays: 9,
        quotes: null,
        closes: null,
        lq: null,
        dials: n(150),
        called: n(20),
        touched: [19, 24],
        untouched: 3,
        firstCallMin: 31,
      },
    },
    {
      loc: "locFixAtlas005",
      // Two days of budget history: too few to judge.
      budget: {
        now: 20,
        cbo: 1,
        abo: 0,
        used: 0.92,
        days: 2,
        yesterday: [18, 20],
      },
      clickup: "86fixatl5",
      name: "Atlas Renovation",
      mode: "DFY",
      callers: [DANA],
      ad: {
        spend: m(520),
        imp: n(33000),
        reach: n(19000),
        clicks: n(390),
        leads: n(28),
      },
      biz: {
        crm: n(31),
        booked: n(11),
        prov: n(2),
        due: n(9),
        shows: n(7),
        noShows: n(2),
        noOutcome: 0,
        quotes: n(4),
        closes: n(2),
        revenue: m(21000),
        lq: [n(16) || 1, n(3) || 1],
        dials: n(260),
        called: n(30),
        touched: [30, 31],
        untouched: 0,
        firstCallMin: 15,
      },
      levers: { open: 0, reconcile: 1 },
    },
    {
      loc: "locFixOrbit006",
      budget: {
        read: false,
        now: 0,
        cbo: 0,
        abo: 0,
        used: null,
        yesterday: [0, 0],
      },
      clickup: "86fixorb6",
      name: "Orbit Glass",
      mode: "DWY",
      callers: [],
      ad: {
        spend: m(410),
        imp: n(29000),
        reach: n(14000),
        clicks: n(300),
        leads: n(33),
      },
      biz: {
        crm: n(35),
        booked: n(7),
        prov: 0,
        due: n(6),
        shows: n(4),
        noShows: n(1),
        noOutcome: n(1),
        oldestDays: 3,
        quotes: null,
        closes: null,
        lq: null,
        dials: null,
        called: null,
      },
    },
    {
      loc: "locFixNova0007",
      clickup: null,
      name: "Nova Landscapes",
      status: "Launching",
      mode: "DFY",
      callers: [RANA],
      ad: null,
      biz: {
        crm: n(12),
        booked: n(2),
        prov: 0,
        due: 1,
        shows: null,
        noShows: null,
        noOutcome: 1,
        oldestDays: 2,
        quotes: null,
        closes: null,
        lq: null,
        dials: n(80),
        called: n(11),
        touched: [11, 12],
        untouched: 1,
        firstCallMin: 22,
      },
    },
    {
      loc: "locFixPearl008",
      // Only a lifetime budget delivers: no daily budget to judge.
      budget: {
        now: 0,
        cbo: 0,
        abo: 0,
        lifetime: 1,
        used: null,
        yesterday: [0, 0],
      },
      clickup: "86fixpea8",
      name: "Pearl Marble",
      mode: "DFY",
      callers: [DANA],
      ad: { spend: m(60), imp: n(640), reach: n(500), clicks: n(9), leads: 0 },
      biz: {
        crm: 2,
        booked: 0,
        prov: 0,
        due: 0,
        shows: 0,
        noShows: 0,
        noOutcome: 0,
        quotes: null,
        closes: null,
        lq: null,
        dials: 14,
        called: 2,
        touched: [2, 2],
        untouched: 0,
        firstCallMin: 18,
      },
    },
  ];
}

export type BoardScenario = "default" | "empty" | "stale" | "board_override";

export function boardFixture(
  from: string,
  to: string,
  today: string,
  scenario: BoardScenario = "default",
): Json {
  const days =
    Math.round(
      (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
        86400e3,
    ) + 1;
  const boardOverrides =
    scenario === "board_override" ? { show_rate: { good: 65, watch: 55 } } : {};
  const T = targetsMap(boardOverrides);
  const clients =
    scenario === "empty"
      ? []
      : clientSpecs(days).map(c => clientRow(c, days, T, today));
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86400e3)
    .toISOString()
    .slice(0, 10);
  return {
    version: 1,
    from,
    to,
    today,
    days,
    adWindow: {
      from,
      to: to < today ? to : yesterday,
      note: "Ad numbers end yesterday on each ad account's own clock (most are Kuwait or Riyadh time); today is not in yet. The business numbers run to the end of the time frame on Kuwait time.",
    },
    generatedAt: `${today}T10:31:00Z`,
    targets: T,
    canEditTargets: true,
    clients,
    notLinked: [
      {
        accountId: "99000111",
        name: "Old test account",
        currency: "USD",
        spend: 12.5,
      },
    ],
    offBoard: {
      spend: 1052.5,
      unpriced: false,
      accounts: [
        {
          accountId: "99000222",
          name: "Gone Client ads",
          spend: 1000,
          client: "Gone Client",
          reason: "cancelled",
        },
        {
          accountId: "99000333",
          name: "Paused Client ads",
          spend: 40,
          client: "Paused Client",
          clientStatus: "Paused",
          reason: "not_active",
        },
        {
          accountId: "99000111",
          name: "Old test account",
          spend: 12.5,
          reason: "not_tied",
        },
      ],
    },
    freshness: {
      facts: {
        lastRunAt: `${today}T10:30:00Z`,
        lastOkAt: `${today}T10:30:00Z`,
        ok: true,
        note: null,
      },
      meta: {
        lastFetchedAt: `${today}T10:07:00Z`,
        firstDay: "2026-07-18",
        lastDay: yesterday,
        hourly: { state: "ok", startedAt: `${today}T10:07:00Z` },
        nightly: { state: "ok", startedAt: `${today}T00:20:00Z` },
        note: null,
      },
    },
    notes:
      scenario === "stale"
        ? [
            "The client facts last refreshed 16 Oct 08:00 Kuwait time; they refresh every 30 minutes.",
            "The last Meta read did not finish every ad account.",
          ]
        : [],
  };
}

type BudgetCampaign = {
  id: string;
  name: string;
  level: "campaign" | "adset" | null;
  type: "daily" | "lifetime" | null;
  adsets: number | null;
  delivering: boolean | null;
  whyNot?: string;
  /** Daily budget now, USD. */
  usd: number | null;
  /** Spend in the time frame, and its share of the daily budgets (1 is 100%). */
  spend: number;
  ratio: number | null;
  /** Yesterday: spend and daily budget. */
  yesterday: [number, number];
  zeroSince?: string;
  lifetime?: { budget: number; remaining: number; endsOn: string };
  /** Waiting for its start: when, and the words ("Starts 20 Oct"). */
  startsAt?: string;
};

/** One campaign of a client page's budgets, as cockpit_board_budget_list builds it. */
function budgetCampaign(
  o: BudgetCampaign,
  accountId: string,
  T: Json,
  days: number,
  today: string,
): Json {
  const yday = dayBefore(today);
  const dm = (d: string) =>
    new Date(`${d}T00:00:00Z`).toLocaleString("en-GB", {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    });
  const unread = o.delivering === null;
  const lifetime = o.type === "lifetime";
  const waiting = Boolean(o.startsAt);
  const unreadWords = budgetsUnread(accountId, o.name.split(" | ")[0]);
  const dailyBudget = unread
    ? cell(null, null, T, { status: "not_measured", note: unreadWords })
    : lifetime
      ? cell(null, null, T, {
          status: "not_measured",
          note: "A lifetime budget: no daily figure.",
        })
      : cell(null, o.usd, T, {
          note: [
            o.level === "campaign"
              ? "The campaign's own budget."
              : "Its ad sets' budgets, added up.",
            waiting
              ? `${o.whyNot}: not counted until then.`
              : o.delivering
                ? null
                : `Not delivering now: ${o.whyNot}.`,
            "Read 16 Oct 13:12 Kuwait time.",
          ]
            .filter(Boolean)
            .join(" "),
        });
  const extra = {
    budgetDays: unread || o.ratio === null ? (unread ? null : 0) : days,
    yesterday: unread
      ? null
      : { day: yday, spend: o.yesterday[0], budget: o.yesterday[1] },
    notSpending: unread
      ? null
      : o.yesterday[1] > 0 && o.yesterday[0] === 0
        ? 1
        : 0,
  };
  const budgetUsed = unread
    ? cell("budget_used", null, T, {
        status: "not_measured",
        note: unreadWords,
        extra,
      })
    : lifetime
      ? cell("budget_used", null, T, {
          status: "not_measured",
          note: "A lifetime budget: no daily figure.",
          extra,
        })
      : usedCell(T, o.spend, o.ratio, days, days, extra);
  const usedYesterday =
    !unread && !lifetime && o.yesterday[1] > 0
      ? cell(null, r2((o.yesterday[0] / o.yesterday[1]) * 100), T, {
          num: o.yesterday[0],
          den: o.yesterday[1],
          note: "Yesterday's spend / yesterday's daily budget. One day is not judged: Meta may spend up to 75% over a daily budget on a day.",
        })
      : cell(null, null, T, {
          status: "not_measured",
          note: unread
            ? "Yesterday's budget was not read."
            : lifetime
              ? "A lifetime budget: no daily figure."
              : "Not switched on with a daily budget yesterday.",
        });
  const flag = waiting
    ? { status: null, words: o.whyNot }
    : o.delivering === false
      ? { status: "off", words: o.whyNot }
      : o.delivering === null
        ? null
        : o.zeroSince
          ? {
              status: "off",
              words:
                o.zeroSince >= yday
                  ? "Spent nothing yesterday"
                  : `Spent nothing since ${dm(o.zeroSince)}`,
            }
          : budgetUsed.status === "off" || budgetUsed.status === "watch"
            ? {
                status: budgetUsed.status,
                words: "Under its budget in these days",
              }
            : null;
  return {
    id: o.id,
    name: o.name,
    accountId,
    budgetLevel: o.level,
    budgetType: o.type,
    adsets: o.adsets,
    delivering: o.delivering,
    whyNot: o.delivering ? null : (o.whyNot ?? null),
    startsAt: o.startsAt ?? null,
    lifetime: o.lifetime ? { ...o.lifetime, currency: "USD" } : null,
    flag,
    metrics: {
      dailyBudget,
      spentYesterday: cell(null, o.yesterday[0], T, {
        note: `Spend on ${dm(yday)}, the ad account's own yesterday.`,
        extra: o.zeroSince ? { zeroSince: o.zeroSince } : undefined,
      }),
      usedYesterday,
      spendPerDay: cell(null, r2(o.spend / days), T, {
        num: r2(o.spend),
        den: days,
      }),
      budgetUsed,
    },
  };
}

/** A client page's budgets, as cockpit_board_budget_list builds them. */
function budgetsFixture(
  spec: ClientSpec,
  accountId: string | undefined,
  T: Json,
  days: number,
  today: string,
): Json {
  const note =
    "Budgets as Meta had them at 16 Oct 13:12 Kuwait time; spend runs to yesterday on each ad account's own clock. One day is not judged: Meta may spend up to 75% over a daily budget on a day, and at most 7 times it in a week.";
  const b = spec.budget;
  if (!spec.ad || !accountId)
    return {
      asOf: null,
      note: NO_ACCOUNT,
      account: [],
      campaigns: [],
      paused: { campaigns: 0, spend: null },
    };
  const spend = spec.ad.spend;
  // Each account as the page says it: Meta's status in words (none when
  // active), a spending limit (Harbor, in SAR) or a prepaid balance (Dune).
  const harbor = spec.loc === "locFixHarbor01";
  const dune = spec.loc === "locFixDune0002";
  const account = (status: string | null, read: boolean) => ({
    accountId,
    name: `${spec.name} ads`,
    currency: harbor ? "SAR" : "USD",
    status,
    prepaid: read ? dune : null,
    asOf: read ? BUDGETS_AS_OF : null,
    spendingLimit: harbor
      ? { cap: 3000, spent: 2860, left: 140, daysLeft: 0.4, prepaid: false }
      : dune
        ? { cap: 500, spent: 465, left: 35, daysLeft: 0.6, prepaid: true }
        : null,
    words: !read
      ? `Budgets for act_${accountId} have not been read.`
      : [
          status ? `${status}.` : null,
          harbor
            ? "Spending limit: 140.00 SAR left (under a day of budget)."
            : dune
              ? "Prepaid balance: $35.00 left (under a day of budget)."
              : null,
        ]
          .filter(Boolean)
          .join(" ") || null,
  });
  const make = (c: BudgetCampaign) =>
    budgetCampaign(c, accountId, T, days, today);
  if (!b || b.read === false)
    return {
      asOf: null,
      note: "Meta budgets have not been read for the linked ad account yet; they are read every hour. One day is not judged: Meta may spend up to 75% over a daily budget on a day, and at most 7 times it in a week.",
      account: [account("Budgets not read yet", false)],
      campaigns: [
        make({
          id: "120301",
          name: `${spec.name} | Leads`,
          level: null,
          type: null,
          adsets: null,
          delivering: null,
          whyNot: "Budget not read yet",
          usd: null,
          spend,
          ratio: null,
          yesterday: [r2(spend / days), 0],
        }),
      ],
      paused: { campaigns: 0, spend: 0 },
    };
  const campaigns: Json[] = [];
  if (spec.loc === "locFixHarbor01") {
    campaigns.push(
      make({
        id: "120001",
        name: `${spec.name} | Leads | Kitchens`,
        level: "campaign",
        type: "daily",
        adsets: 2,
        delivering: true,
        usd: 55,
        spend: r2(spend * 0.7),
        ratio: 1.25,
        yesterday: [44, 55],
      }),
      make({
        id: "120003",
        name: `${spec.name} | WhatsApp chats`,
        level: "adset",
        type: "daily",
        adsets: 2,
        delivering: true,
        usd: 30,
        spend: r2(spend * 0.05),
        ratio: 0.2,
        yesterday: [0, 30],
        zeroSince: dayBefore(today, 3),
      }),
      make({
        id: "120004",
        name: `${spec.name} | Retargeting`,
        level: "adset",
        type: "daily",
        adsets: 1,
        delivering: false,
        whyNot: "Ads with issues",
        usd: 30,
        spend: r2(spend * 0.1),
        ratio: 0.6,
        yesterday: [0, 30],
        zeroSince: dayBefore(today, 2),
      }),
      make({
        id: "120005",
        name: `${spec.name} | Spring launch`,
        level: "campaign",
        type: "lifetime",
        adsets: 1,
        delivering: true,
        usd: null,
        spend: 0,
        ratio: null,
        yesterday: [0, 0],
        lifetime: {
          budget: 900,
          remaining: 400,
          endsOn: dayBefore(today, -9),
        },
      }),
    );
  } else {
    // The campaigns switched on and delivering share what the blocked ones do not hold.
    const held = b.held?.[0] ?? 0;
    const n = b.cbo + b.abo - held;
    const heldUsd = b.held?.[1] ?? 0;
    for (let i = 0; i < n; i++)
      campaigns.push(
        make({
          id: `1203${i}1`,
          name: `${spec.name} | ${i < b.cbo ? "Leads" : "Chats"} ${i + 1}`,
          level: i < b.cbo ? "campaign" : "adset",
          type: "daily",
          adsets: i < b.cbo ? 1 : 2,
          delivering: true,
          usd: r2((b.now - heldUsd) / n),
          spend: r2((spend * 0.9) / n),
          ratio: b.used,
          yesterday: [
            r2(b.yesterday[0] / n),
            r2((b.yesterday[1] - heldUsd) / n),
          ],
        }),
      );
    if (b.held)
      campaigns.push(
        make({
          id: "120391",
          name: `${spec.name} | Leads (blocked)`,
          level: "campaign",
          type: "daily",
          adsets: 1,
          delivering: false,
          whyNot: b.held[2],
          usd: b.held[1],
          spend: n ? 0 : r2(spend * 0.9),
          ratio: n ? 0 : b.used,
          yesterday: [0, b.held[1]],
          zeroSince: dayBefore(today, 2),
        }),
      );
    if (b.starting)
      campaigns.push(
        make({
          id: "120393",
          name: `${spec.name} | Eid offer`,
          level: "campaign",
          type: "daily",
          adsets: 0,
          delivering: false,
          whyNot: b.starting[1],
          usd: 15,
          spend: 0,
          ratio: null,
          yesterday: [0, 0],
          startsAt: `${dayBefore(today, -3)}T06:00:00.000Z`,
        }),
      );
    if (b.lifetime)
      campaigns.push(
        make({
          id: "120392",
          name: `${spec.name} | Lifetime`,
          level: "campaign",
          type: "lifetime",
          adsets: 1,
          delivering: true,
          usd: null,
          spend: 0,
          ratio: null,
          yesterday: [0, 0],
          lifetime: {
            budget: 600,
            remaining: 250,
            endsOn: dayBefore(today, -12),
          },
        }),
      );
  }
  // Flagged first, then the biggest daily budget, those waiting for their start last.
  const flagged = (x: Json) => Boolean(x.flag?.status);
  campaigns.sort(
    (x, y) =>
      Number(flagged(y)) - Number(flagged(x)) ||
      Number(Boolean(x.startsAt)) - Number(Boolean(y.startsAt)) ||
      (y.metrics.dailyBudget.v ?? -1) - (x.metrics.dailyBudget.v ?? -1),
  );
  return {
    asOf: BUDGETS_AS_OF,
    note,
    account: [
      account(
        spec.loc === "locFixReem0004"
          ? "Account unsettled: payment needed"
          : null,
        true,
      ),
    ],
    campaigns,
    paused:
      spec.loc === "locFixHarbor01"
        ? { campaigns: 1, spend: r2(spend * 0.15) }
        : { campaigns: 0, spend: 0 },
  };
}

const FIRST = [
  "Sara",
  "Omar",
  "Huda",
  "Yousef",
  "Mona",
  "Faisal",
  "Noor",
  "Khaled",
];

/** One client's page, as cockpit_board_client returns it. */
export function clientFixture(
  loc: string,
  from: string,
  to: string,
  today: string,
): Json | null {
  const board = boardFixture(from, to, today);
  const row = (board.clients as Json[]).find(c => c.locationId === loc);
  if (!row) return null;
  const T = board.targets;
  const spec = clientSpecs(board.days).find(c => c.loc === loc) as ClientSpec;
  const ad = spec.ad;
  const share = (a: Ad, f: number): Ad => ({
    spend: r2(a.spend * f),
    imp: Math.round(a.imp * f),
    reach: a.reach ? Math.round(a.reach * f * 0.9) : undefined,
    clicks: Math.round(a.clicks * f),
    leads:
      a.leads === null || a.leads === undefined
        ? a.leads
        : Math.round(a.leads * f),
    video: a.video
      ? {
          imp: Math.round(a.video.imp * f),
          v3: Math.round(a.video.v3 * f),
          thru: Math.round(a.video.thru * f),
          plays: Math.round(a.video.plays * f),
          p: a.video.p.map(x => Math.round(x * f)) as [
            number,
            number,
            number,
            number,
          ],
        }
      : undefined,
  });
  const crm = (
    leads: number,
    bookings: number,
    shows: number,
    due: number,
  ): Json => ({
    crmLeads: { v: leads, status: null },
    confirmedBookings: { v: bookings, status: null },
    shows:
      due > 0 && shows === 0
        ? {
            v: null,
            status: "not_filled_in",
            due,
            note: `None of the ${due} meetings due is marked showed or no-show.`,
          }
        : { v: shows, status: null, noShows: 0, marked: shows, due },
    costPerBooking: {
      v: null,
      status: "too_few",
      note: "No spend in these days.",
    },
  });
  const node = (
    a: Ad,
    f: number,
    leads: number,
    bookings: number,
    shows: number,
    due: number,
  ) => {
    const s = share(a, f);
    const m = { ...adCells(s, T), ...crm(leads, bookings, shows, due) };
    if (bookings > 0)
      m.costPerBooking = cell("cost_per_booking", r2(s.spend / bookings), T, {
        sample: bookings,
        num: s.spend,
        den: bookings,
        note: "Confirmed bookings with this ad id and spend over the same days.",
      });
    return m;
  };
  const campaigns = ad
    ? [
        {
          id: "120001",
          name: `${spec.name} | Leads | Kitchens`,
          objective: "OUTCOME_LEADS",
          accountId: row.adAccounts[0],
          metrics: node(ad, 0.7, 30, 9, 6, 7),
          adsets: [
            {
              id: "120101",
              name: "Kuwait 28-55 | Lead form",
              destination: "ON_AD",
              metrics: node(ad, 0.45, 20, 6, 4, 5),
              ads: [
                {
                  id: "120201",
                  name: "Hook test: the before shot",
                  metrics: node(
                    { ...ad, video: ad.video ?? video(ad.imp) },
                    0.3,
                    14,
                    4,
                    3,
                    3,
                  ),
                },
                {
                  id: "120202",
                  name: "Still image: finished kitchen",
                  metrics: node({ ...ad, video: undefined }, 0.15, 6, 2, 0, 2),
                },
              ],
            },
            {
              id: "120102",
              name: "Kuwait broad | WhatsApp",
              destination: "WHATSAPP",
              metrics: { ...node({ ...ad, leads: null }, 0.25, 10, 3, 2, 2) },
              ads: [
                {
                  id: "120203",
                  name: "Chat ad: free design visit",
                  metrics: node(
                    { ...ad, leads: null, video: undefined },
                    0.25,
                    10,
                    3,
                    2,
                    2,
                  ),
                },
              ],
            },
          ],
        },
        {
          id: "120002",
          name: `${spec.name} | Retargeting`,
          objective: "OUTCOME_ENGAGEMENT",
          accountId: row.adAccounts[0],
          metrics: node({ ...ad, leads: null }, 0.3, 4, 1, 1, 1),
          adsets: [
            {
              id: "120103",
              name: "Video viewers 30 days",
              destination: null,
              metrics: node({ ...ad, leads: null }, 0.3, 4, 1, 1, 1),
              ads: [
                {
                  id: "120204",
                  name: "Testimonial: Um Khaled",
                  metrics: node(
                    { ...ad, leads: null, video: ad.video ?? video(ad.imp) },
                    0.3,
                    4,
                    1,
                    1,
                    1,
                  ),
                },
              ],
            },
          ],
        },
      ]
    : [];
  const count = (row.noOutcome as number | null) ?? 0;
  const appts = Array.from({ length: count }).map((_, i) => {
    const daysAgo = Math.min(
      row.noOutcomeOldestDays ?? 1,
      1 + ((i * 3) % Math.max(row.noOutcomeOldestDays ?? 1, 1)),
    );
    const day = new Date(
      Date.parse(`${today}T00:00:00Z`) -
        (count === 1
          ? (row.noOutcomeOldestDays ?? 1)
          : i === 0
            ? (row.noOutcomeOldestDays ?? 1)
            : daysAgo) *
          86400e3,
    )
      .toISOString()
      .slice(0, 10);
    return {
      appointmentId: `apFix${loc}${i}`,
      meetingAt: `${day}T0${(i % 5) + 7}:00:00Z`,
      meetingDay: day,
      meetingTime: `${String((i % 5) + 10).padStart(2, "0")}:00`,
      calendar: i % 3 === 2 ? "online" : "main",
      calendarName:
        i % 3 === 2
          ? "Online Appointment Calendar"
          : "Main Appointment Calendar",
      crmStatus: "confirmed",
      firstName: FIRST[i % FIRST.length],
      adId: i % 4 === 3 ? null : "120201",
      adName: i % 4 === 3 ? null : "Hook test: the before shot",
      bookedBy:
        i % 3 === 1
          ? { name: "The lead", how: "The booking page" }
          : spec.callers[0]
            ? { name: spec.callers[0].name, how: "The call centre" }
            : null,
      daysSince: Math.round(
        (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) /
          86400e3,
      ),
      contactUrl: `https://app.gohighlevel.com/v2/location/${loc}/contacts/detail/cFix${i}`,
    };
  });
  appts.sort((a, b) => a.meetingDay.localeCompare(b.meetingDay));
  const levers =
    loc === "locFixHarbor01"
      ? [
          {
            id: "00000000-0000-4000-8000-00000000f001",
            locationId: loc,
            clickupId: spec.clickup,
            clientName: spec.name,
            metric: "show_rate",
            lever: "Send the WhatsApp reminder an hour before every meeting",
            department: "call_center",
            note: null,
            evidence:
              "Harbor Kitchens Show rate, 16 Sep to 15 Oct: 66% against a good line of 70% (watch).",
            status: "open",
            clickupTaskId: "86fixtask1",
            clickupUrl: "https://app.clickup.com/t/86fixtask1",
            error: null,
            createdBy: "csm@example.test",
            createdByName: "The client success manager",
            createdAt: "2026-10-14T08:00:00Z",
            finishedAt: "2026-10-14T08:00:03Z",
            meetingId: null,
          },
        ]
      : loc === "locFixAtlas005"
        ? [
            {
              id: "00000000-0000-4000-8000-00000000f002",
              locationId: loc,
              clickupId: spec.clickup,
              clientName: spec.name,
              metric: "cpl",
              lever: "Swap the image ad for the walkthrough video",
              department: "creative",
              note: null,
              evidence: "Atlas Renovation Cost per lead: $18.57.",
              status: "reconcile",
              clickupTaskId: null,
              clickupUrl: null,
              error:
                "ClickUp did not confirm the task. Reconcile before retrying.",
              createdBy: "buyer@example.test",
              createdByName: null,
              createdAt: "2026-10-13T11:00:00Z",
              finishedAt: "2026-10-13T11:00:09Z",
              meetingId: null,
            },
          ]
        : [];
  return {
    version: 1,
    from,
    to,
    today,
    adWindow: {
      from,
      to: board.adWindow.to,
      note: "Ad numbers end yesterday on each ad account's own clock; CRM leads, bookings and shows per ad run to the end of the time frame.",
    },
    adCover: row.adCover,
    generatedAt: board.generatedAt,
    client: row,
    clientName: spec.name,
    locationId: loc,
    clickupId: spec.clickup,
    status: row.status,
    targets: T,
    campaigns,
    notInStore: ad
      ? [
          {
            adId: "120999",
            crmLeads: 3,
            confirmedBookings: 1,
            shows: { v: 1, status: null, noShows: 0, marked: 1, due: 1 },
          },
        ]
      : [],
    noAd: {
      crmLeads: 2,
      confirmedBookings: 0,
      shows: { v: 0, status: null, noShows: 0, marked: 0, due: 0 },
    },
    noOutcomeAppointments: appts,
    budgets: budgetsFixture(spec, row.adAccounts[0], T, board.days, today),
    noOutcomeCheck: { board: row.noOutcome, live: appts.length, note: null },
    levers,
    canEditTargets: true,
  };
}
