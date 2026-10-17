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
  overrides?: Record<string, { good: number; watch: number | null }>;
  notes?: string[];
};

function clientRow(c: ClientSpec, days: number, board: Json): Json {
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
  const v: Json = adCells(c.ad, T);
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
      : clientSpecs(days).map(c => clientRow(c, days, T));
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
    noOutcomeCheck: { board: row.noOutcome, live: appts.length, note: null },
    levers,
    canEditTargets: true,
  };
}
