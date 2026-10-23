/**
 * A client's page (src/components/AccountView.tsx) and the list of clients
 * with no campaign running (src/components/ClientsNotListed.tsx), rendered in
 * happy-dom with the database answered here. The campaigns' own reads come
 * from the made-up Ads page fixture (src/dev/adsPageFixture.ts); the
 * client's own read (cockpit_media_client_range, 20261022x) is set per test.
 * Every client, account and figure is invented.
 *
 * What it checks, from the review of the cost per booking build 2 (22 Oct):
 * - a range the client read counts only from a later day (24 Sep 2026 live)
 *   keeps the campaigns listed over the whole range, and says why; with no
 *   campaign listed, the read's figures with the days they count named;
 * - "Open" in the list carries the client's ad accounts, and the page reads
 *   by them, so a range the client did not spend in never says the client
 *   is off the board's list;
 * - spend that is not known reads n/a with the read's reason: never "No
 *   spend", never "No leads in this range", never "n/a a booking" in the list.
 * Nothing here reaches the network: every fetch is refused. The client's own
 * lead pages (pageForms.read through cockpit-media-api, read by the page once
 * main's Lead page section is in) are answered with none; any other Edge
 * Function call is refused and fails the file.
 */
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";

const g = globalThis as any;
const ENV = {
  VITE_SUPABASE_URL: "https://bldgtotkfmhoxmlzowdx.supabase.co",
  VITE_SUPABASE_ANON_KEY: "test-placeholder-key",
};
const envs = [process.env, (import.meta as any).env].filter(Boolean);
const envBefore = envs.map(e =>
  Object.fromEntries(Object.keys(ENV).map(k => [k, e[k]])),
);
for (const e of envs) Object.assign(e, ENV);

const realFetch = globalThis.fetch;
const strayFetches: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL) => {
  strayFetches.push(String(input));
  throw new Error("The client page screen test makes no network calls.");
}) as typeof fetch;

// --- The cockpit's own client: the CEO signed in, the reads answered here. ---
const { supabase } = await import("../src/lib/supabase");
const db = supabase as any;
const real = {
  rpc: db.rpc,
  from: db.from,
  getSession: db.auth.getSession,
  getUser: db.auth.getUser,
  onAuthStateChange: db.auth.onAuthStateChange,
};
const USER = {
  id: "auth-ceo-test",
  email: "ceo@example.test",
  email_confirmed_at: "2026-10-18T00:00:00Z",
  app_metadata: {},
  user_metadata: {},
};
db.auth.getSession = async () => ({
  data: { session: { access_token: "test-token", user: USER } },
  error: null,
});
db.auth.getUser = async () => ({ data: { user: USER }, error: null });
db.auth.onAuthStateChange = () => ({
  data: { subscription: { unsubscribe: () => {} } },
});

/** A table read's stand-in: every filter returns it, awaiting it gives []. */
function chain(): unknown {
  const self: unknown = new Proxy(
    {},
    {
      get: (_t, key) =>
        key === "then"
          ? (done: (v: unknown) => unknown) =>
              Promise.resolve({ data: [], error: null }).then(done)
          : () => self,
    },
  );
  return self;
}
db.from = () => chain();

// supabase-js builds a new functions client on every read: keep one to patch.
const functionsDescriptor = Object.getOwnPropertyDescriptor(db, "functions");
const functions = db.functions;
Object.defineProperty(db, "functions", {
  configurable: true,
  value: functions,
});
const strayInvokes: string[] = [];
functions.invoke = async (name: string, opts: { body?: any } = {}) => {
  if (name === "cockpit-media-api" && opts.body?.operation === "pageForms.read")
    return { data: { ok: true, pages: [] }, error: null };
  strayInvokes.push(`${name} ${opts.body?.operation ?? ""}`.trim());
  return {
    data: null,
    error: { message: "The client page screen test answers no other call." },
  };
};

const fixture = await import("../src/dev/adsPageFixture");

type Answer = { data: unknown; error: { message: string } | null };
const rpcCalls: { name: string; args: any }[] = [];
/** The client's own read for the test at hand. */
let clientRange: (args: any) => unknown = () => ({});
db.rpc = (name: string, args: any = {}) => {
  rpcCalls.push({ name, args });
  const answer = async (): Promise<Answer> => {
    switch (name) {
      case "cockpit_adopt_member":
        return { data: true, error: null };
      case "cockpit_get_my_access":
        return {
          data: {
            email: USER.email,
            name: "The CEO",
            is_admin: true,
            is_ceo: true,
            home: "/ceo",
            cockpits: [],
            roles: [],
            clients: [],
          },
          error: null,
        };
      case "cockpit_media_statistics": {
        const start = String(args.p_start ?? "");
        const end = String(args.p_end ?? "");
        if (args.p_kind === "range")
          return {
            data: fixture.adsPageRange(args.p_campaign, start, end),
            error: null,
          };
        if (args.p_kind === "campaignTrend")
          return {
            data: fixture.adsPageTrend(args.p_campaign, start, end),
            error: null,
          };
        if (args.p_kind === "coverage")
          return { data: fixture.adsPageCoverage(), error: null };
        return { data: null, error: { message: "Unknown statistics kind" } };
      }
      case "cockpit_media_client_range":
        return { data: clientRange(args), error: null };
      case "cockpit_winner_saved_in":
        return { data: {}, error: null };
      case "cockpit_client_callers":
        return { data: [], error: null };
      default:
        return { data: null, error: { message: `No answer for ${name}` } };
    }
  };
  const p = answer();
  return Object.assign(p, { abortSignal: () => p });
};

// --- A DOM. ------------------------------------------------------------------
const { Window } = await import("happy-dom");
const win = new Window({ url: "https://cockpit.test/ads" });
const DOM = [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "HTMLAnchorElement",
  "HTMLButtonElement",
  "HTMLImageElement",
  "HTMLInputElement",
  "SVGElement",
  "Element",
  "Node",
  "Event",
  "CustomEvent",
  "MouseEvent",
  "KeyboardEvent",
  "PointerEvent",
  "FocusEvent",
  "MutationObserver",
  "ResizeObserver",
  "IntersectionObserver",
  "DocumentFragment",
  "Text",
  "getComputedStyle",
  "matchMedia",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "IS_REACT_ACT_ENVIRONMENT",
];
const globalsBefore = new Map(
  DOM.map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]),
);
for (const k of DOM)
  Object.defineProperty(globalThis, k, {
    configurable: true,
    writable: true,
    value:
      k === "window"
        ? win
        : k === "IS_REACT_ACT_ENVIRONMENT"
          ? true
          : typeof (win as any)[k] === "function" && /^[a-z]/.test(k)
            ? (win as any)[k].bind(win)
            : (win as any)[k],
  });
(win as any).scrollTo = () => {};
const realError = console.error;
console.error = (...args: unknown[]) => {
  if (typeof args[0] === "string" && args[0].includes("not wrapped in act"))
    return;
  realError(...args);
};

const { createRoot } = await import("react-dom/client");
const { act, createElement: h } = await import("react");
const { MemoryRouter } = await import("react-router");
const { SupabaseAuthProvider } = await import(
  "../src/auth/SupabaseAuthProvider"
);
const { AccountView } = await import("../src/components/AccountView");
const { ClientsNotListed } = await import("../src/components/ClientsNotListed");

const container = win.document.createElement("div");
win.document.body.appendChild(container);
const root = createRoot(container as any);

async function flush(times = 10) {
  for (let i = 0; i < times; i++)
    await act(async () => {
      await new Promise(r => setTimeout(r, 0));
    });
}
const page = () => String(container.textContent ?? "");
/** The reason an n/a carries (Na.tsx puts it in its aria-label). */
const naReasons = () =>
  [...container.querySelectorAll('[aria-label^="n/a: "]')].map(b =>
    String(b.getAttribute("aria-label")).slice(5),
  );
const clientReads = () =>
  rpcCalls.filter(c => c.name === "cockpit_media_client_range");

// The fixture's days: 0 is its last day. Cedar Stone Interiors runs two
// campaigns on accounts 990000000000001 and 990000000000002.
const day = fixture.fixtureDay;
const CEDAR = "Cedar Stone Interiors";
const CEDAR_ACCOUNTS = ["990000000000001", "990000000000002"];
const cedarCampaigns = () =>
  fixture
    .adsPageCampaignRows()
    .map(r => r.raw_data as Record<string, any>)
    .filter(c => c.clientName === CEDAR);

/** A row of the client read (contract 2.5). */
const clientRow = (over: Record<string, unknown>) => ({
  clickupId: "fx-client-1",
  locationId: "fx-location-1",
  name: CEDAR,
  serviceMode: "DFY",
  status: "Active",
  accounts: CEDAR_ACCOUNTS,
  spend: 0,
  leads: 0,
  offBoardSpend: 0,
  excludedSpend: 0,
  campaigns: [],
  bookings: 0,
  days: 7,
  storedDays: 7,
  mediaBookings: 0,
  costPerBooking: null,
  why: null,
  ...over,
});

const FLOOR_WHY =
  "The cockpit's campaign list starts on 24 Sep 2026, so spend before it cannot be split into Mahara's campaigns and the client's own; these numbers count from 24 Sep 2026.";

async function showPage(props: {
  client?: string;
  campaigns?: Record<string, any>[];
  accountIds?: string[];
  start: string;
  end: string;
}) {
  await act(async () => {
    root.render(
      h(
        SupabaseAuthProvider,
        null,
        h(
          MemoryRouter,
          { initialEntries: ["/ads"] },
          h(AccountView, {
            client: props.client ?? CEDAR,
            campaigns: props.campaigns ?? cedarCampaigns(),
            accountIds: props.accountIds,
            tree: [],
            verdicts: [],
            range: {
              key: "custom",
              label: "Picked range",
              start: props.start,
              end: props.end,
            },
            onRangeChange: () => {},
            selected: null,
            onSelect: () => {},
            renderPanel: () => null,
            onClose: () => {},
          }),
        ),
      ),
    );
  });
  await flush();
}

beforeEach(() => {
  rpcCalls.length = 0;
});

afterEach(async () => {
  await act(async () => root.render(null));
  await flush(2);
});

afterAll(async () => {
  await act(async () => root.unmount());
  globalThis.fetch = realFetch;
  console.error = realError;
  db.rpc = real.rpc;
  db.from = real.from;
  if (functionsDescriptor)
    Object.defineProperty(db, "functions", functionsDescriptor);
  else delete db.functions;
  db.auth.getSession = real.getSession;
  db.auth.getUser = real.getUser;
  db.auth.onAuthStateChange = real.onAuthStateChange;
  for (const [k, d] of globalsBefore)
    if (d) Object.defineProperty(globalThis, k, d);
    else delete g[k];
  envs.forEach((e, i) => {
    for (const [k, v] of Object.entries(envBefore[i]))
      if (v === undefined) delete e[k];
      else e[k] = v;
  });
  await win.happyDOM.close();
  expect(strayFetches).toEqual([]);
  expect(strayInvokes).toEqual([]);
});

describe("a range the client read counts only part of", () => {
  // Live, "Last month" read in October was 1 to 30 Sep, counted from 24 Sep.
  // Here: 30 days back to yesterday, the read counting the last 7.
  const start = day(30);
  const end = day(1);
  const partial = (args: any) => ({
    from: args.p_start,
    to: args.p_end,
    countedFrom: day(7),
    through: day(1),
    throughSource: "media data",
    clients: [
      clientRow({
        spend: 289.34,
        leads: 30,
        bookings: 5,
        mediaBookings: 5,
        costPerBooking: 57.87,
        why: FLOOR_WHY,
      }),
    ],
    unmatched: [],
  });

  test("with campaigns listed, the totals are theirs over the whole range, and the page says why", async () => {
    clientRange = partial;
    await showPage({ start, end });
    const text = page();
    expect(text).toContain("The client's own numbers start on ");
    expect(text).toContain(
      "so over a range that starts earlier these totals are the campaigns listed here.",
    );
    // Not the read's 7 days beside a month of charts and campaign rows.
    expect(text).not.toContain("$289");
    expect(text).not.toContain("the first day the client's own numbers cover");
    // The read went out by the campaigns' accounts.
    expect(clientReads().at(-1)?.args.p_accounts).toEqual(CEDAR_ACCOUNTS);
  });

  test("with no campaign listed, the read's figures with the days they count", async () => {
    clientRange = partial;
    await showPage({ campaigns: [], accountIds: CEDAR_ACCOUNTS, start, end });
    const text = page();
    expect(text).toContain("$289");
    expect(text).toContain("the first day the client's own numbers cover");
    expect(text).toContain("these numbers count from 24 Sep 2026.");
    expect(text).not.toContain("these totals are the campaigns listed here");
  });
});

describe("a client opened from the list", () => {
  test("reads by the accounts it was opened with, and a quiet range shows its zeros", async () => {
    const start = day(7);
    const end = day(1);
    clientRange = (args: any) => ({
      from: args.p_start,
      to: args.p_end,
      countedFrom: args.p_start,
      through: args.p_end,
      throughSource: "media sync",
      // Read by its account the client comes back, with no spend this week.
      clients: Array.isArray(args.p_accounts)
        ? [
            clientRow({
              name: "Driftwood Homes",
              accounts: ["990000000000009"],
            }),
          ]
        : [],
      unmatched: [],
    });
    await showPage({
      client: "Driftwood Homes",
      campaigns: [],
      accountIds: ["990000000000009"],
      start,
      end,
    });
    expect(clientReads().at(-1)?.args.p_accounts).toEqual(["990000000000009"]);
    const text = page();
    expect(text).toContain(`No spend between ${start} and ${end}`);
    expect(text).not.toContain("not on the Client Performance board");
  });

  test("with no account and no row, the page says what the read lists, never 'No spend'", async () => {
    clientRange = (args: any) => ({
      from: args.p_start,
      to: args.p_end,
      countedFrom: args.p_start,
      through: args.p_end,
      throughSource: "media sync",
      clients: [],
      unmatched: [],
    });
    await showPage({
      client: "Professional Touch",
      campaigns: [],
      start: day(7),
      end: day(1),
    });
    expect(clientReads().at(-1)?.args.p_accounts).toBeNull();
    const text = page();
    expect(text).toContain("No numbers for this client in this range");
    expect(text).toContain(
      "The client's own read lists a client only when Mahara's campaigns spent on its ad accounts or a booking is stored for these days",
    );
    expect(text).not.toContain("No spend between");
    expect(text).not.toContain("not on the Client Performance board");
  });
});

describe("spend that is not known", () => {
  const WHY =
    "No Meta ad account is linked to this client, so its spend is not known.";

  test("the page's tiles read n/a with the read's reason, never 'No leads in this range'", async () => {
    clientRange = (args: any) => ({
      from: args.p_start,
      to: args.p_end,
      countedFrom: args.p_start,
      through: args.p_end,
      throughSource: "media sync",
      clients: [
        clientRow({
          name: "Professional Touch",
          accounts: [],
          spend: null,
          leads: null,
          offBoardSpend: null,
          excludedSpend: null,
          bookings: 2,
          mediaBookings: null,
          why: WHY,
        }),
      ],
      unmatched: [],
    });
    await showPage({
      client: "Professional Touch",
      campaigns: [],
      start: day(20),
      end: day(1),
    });
    const reasons = naReasons();
    // Spend, leads, cost per lead and cost per booking: all the read's reason.
    expect(reasons.filter(r => r === WHY).length).toBeGreaterThanOrEqual(4);
    expect(reasons).not.toContain("No leads in this range.");
    expect(reasons).not.toContain("The spend could not be read.");
  });

  test("the list sets those clients apart, and Open carries the accounts", async () => {
    clientRange = (args: any) => ({
      from: args.p_start,
      to: args.p_end,
      countedFrom: args.p_start,
      through: args.p_end,
      throughSource: "media sync",
      clients: [
        clientRow({
          name: "ARCWANI",
          accounts: ["1034584029438250"],
          spend: 151.4,
          leads: 6,
          bookings: 1,
          mediaBookings: 1,
          costPerBooking: 151.4,
        }),
        clientRow({
          name: "Professional Touch",
          accounts: [],
          spend: null,
          leads: null,
          offBoardSpend: null,
          excludedSpend: null,
          bookings: 2,
          mediaBookings: null,
          why: WHY,
        }),
      ],
      unmatched: [],
    });
    const opened: [string, string[]][] = [];
    await act(async () => {
      root.render(
        h(
          SupabaseAuthProvider,
          null,
          h(ClientsNotListed, {
            range: {
              key: "mtd",
              label: "Month to date",
              start: day(20),
              end: day(1),
            },
            campaigns: [],
            onOpen: (name: string, accounts: string[]) =>
              opened.push([name, accounts]),
          }),
        ),
      );
    });
    await flush();
    const text = page();
    expect(text).toContain("Spent in this range, no campaign running here");
    expect(text).toContain(`Booked in month to date, spend not known: ${WHY}`);
    expect(text).toContain("spend not known · 2 booked");
    expect(text).not.toContain("n/a a booking");
    expect(text).not.toContain("n/a leads");
    expect(text).toContain("$151 · 6 leads · 1 booked · $151 a booking");
    const buttons = [...container.querySelectorAll("button")].filter(
      b => b.textContent === "Open",
    );
    expect(buttons).toHaveLength(2);
    await act(async () => {
      (buttons[0] as any).click();
    });
    await act(async () => {
      (buttons[1] as any).click();
    });
    expect(opened).toEqual([
      ["ARCWANI", ["1034584029438250"]],
      ["Professional Touch", []],
    ]);
  });
});
