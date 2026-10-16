/**
 * The Client Performance board screen (src/pages/performance/) rendered in
 * happy-dom, with the database's reads and the lever function answered here
 * from invented data (src/dev/boardFixture.ts, the shapes of
 * 20261016133300_board_api.sql). What it checks: the grid's statuses and
 * that a missing value never reads as 0, the column picker and its memory,
 * sorting, the no-outcome line, the caller column, the side panel's tree and
 * no-outcome list, the lever flow (preview, then file once with one request
 * id), the targets editor's gate, the time frame, and the empty and error
 * states. Nothing here reaches the network: every fetch is refused.
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

// Nothing leaves this file: any fetch the mocks below do not answer fails.
const realFetch = globalThis.fetch;
const strayFetches: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL) => {
  strayFetches.push(String(input));
  throw new Error("The board's screen test makes no network calls.");
}) as typeof fetch;

// --- The database and the lever function, answered here. ---
const { supabase } = await import("../src/lib/supabase");
const db = supabase as any;
const realRpc = db.rpc;
const realGetSession = db.auth.getSession;
const realGetUser = db.auth.getUser;
type Answer = {
  data: unknown;
  error: { message: string; code?: string; context?: unknown } | null;
};
const rpcCalls: { name: string; args: any }[] = [];
let rpcAnswer: (name: string, args: any) => Promise<Answer>;
db.rpc = (name: string, args: any) => {
  rpcCalls.push({ name, args });
  return rpcAnswer(name, args);
};
db.auth.getSession = async () => ({
  data: { session: { access_token: "test-token" } },
  error: null,
});
db.auth.getUser = async () => ({
  data: { user: { id: "test-user" } },
  error: null,
});
// supabase-js builds a new functions client on every read: keep one to patch.
const functionsDescriptor = Object.getOwnPropertyDescriptor(db, "functions");
const functions = db.functions;
Object.defineProperty(db, "functions", {
  configurable: true,
  value: functions,
});
const invokes: { name: string; body: any }[] = [];
let invokeAnswer: (body: any) => Promise<Answer>;
functions.invoke = (name: string, opts: { body?: any } = {}) => {
  invokes.push({ name, body: opts.body });
  return invokeAnswer(opts.body);
};

// --- A DOM. ---
const { Window } = await import("happy-dom");
const win = new Window({ url: "https://cockpit.test/performance" });
const DOM: string[] = [
  "window",
  "document",
  "navigator",
  "localStorage",
  "HTMLElement",
  "HTMLAnchorElement",
  "HTMLButtonElement",
  "HTMLInputElement",
  "HTMLTextAreaElement",
  "HTMLSelectElement",
  "Element",
  "Node",
  "Event",
  "InputEvent",
  "MouseEvent",
  "KeyboardEvent",
  "PointerEvent",
  "FocusEvent",
  "MutationObserver",
  "ResizeObserver",
  "DocumentFragment",
  "Text",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "IS_REACT_ACT_ENVIRONMENT",
  // Radix reads these by name (a form, a label, a select) while it renders.
  ...Object.getOwnPropertyNames(win).filter(k =>
    /^(HTML|SVG)\w*Element$|^(CustomEvent|DOMRect|NodeFilter|Range)$/.test(k),
  ),
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
const realError = console.error;
console.error = (...args: unknown[]) => {
  if (
    typeof args[0] === "string" &&
    (args[0].includes("not wrapped in act") ||
      args[0].includes("DialogContent"))
  )
    return;
  realError(...args);
};

const { createRoot } = await import("react-dom/client");
const { act, createElement } = await import("react");
const { MemoryRouter } = await import("react-router");
const { PerformancePage, MEETING_COLUMNS } = await import(
  "../src/pages/performance/PerformancePage"
);
const client = await import("../src/lib/boardClient");
const columns = await import("../src/lib/boardColumns");
const { blankWatch, lineProblem } = await import(
  "../src/pages/performance/TargetsDialog"
);
const { boardFixture, clientFixture } = await import("../src/dev/boardFixture");

const today = client.kuwaitToday();
type Scenario = "default" | "empty" | "stale" | "board_override";

/** The reads answer from the fixture; `edit` changes the board before it is sent. */
function answer(
  opts: {
    scenario?: Scenario;
    edit?: (board: any) => void;
    fail?: Answer["error"];
    save?: (args: any) => Answer;
  } = {},
) {
  rpcAnswer = async (name, args) => {
    if (opts.fail) return { data: null, error: opts.fail };
    if (name === "cockpit_board_read") {
      const b = boardFixture(
        args.p_from,
        args.p_to,
        today,
        opts.scenario ?? "default",
      );
      opts.edit?.(b);
      return { data: b, error: null };
    }
    if (name === "cockpit_board_client") {
      const c = clientFixture(args.p_location, args.p_from, args.p_to, today);
      return c
        ? { data: c, error: null }
        : {
            data: null,
            error: {
              code: "42501",
              message: "This client is not on your board.",
            },
          };
    }
    if (name === "cockpit_board_targets_save")
      return opts.save
        ? opts.save(args)
        : {
            data: {
              ok: true,
              scope: args.p_scope,
              metric: args.p_metric,
              target: null,
            },
            error: null,
          };
    return { data: null, error: { message: `No answer for ${name}` } };
  };
}

const host = win.document.createElement("div");
win.document.body.append(host);
const root = createRoot(host as any);
let mounts = 0;

async function flush(times = 6) {
  for (let i = 0; i < times; i++)
    await act(async () => {
      await new Promise(r => setTimeout(r, 0));
    });
}

async function show(path = "/performance") {
  mounts += 1;
  await act(async () => {
    root.render(
      createElement(
        MemoryRouter,
        { key: mounts, initialEntries: [path] },
        createElement(PerformancePage),
      ),
    );
  });
  await flush();
}

const body = () => win.document.body;
const text = (el: { textContent: string | null } = body()) =>
  el.textContent ?? "";
function buttons(label: string, within: any = body()) {
  return Array.from(within.querySelectorAll("button") as ArrayLike<any>).filter(
    b =>
      (
        (b.getAttribute("aria-label") ?? "") +
        " " +
        (b.textContent ?? "")
      ).includes(label),
  );
}
function button(label: string, within: any = body()) {
  const b = buttons(label, within)[0];
  if (!b)
    throw new Error(`No button "${label}" in: ${text(within).slice(0, 500)}`);
  return b;
}
async function click(el: any) {
  await act(async () => {
    el.click();
  });
  await flush();
}
async function type(el: any, value: string) {
  const proto =
    el.tagName === "TEXTAREA"
      ? win.HTMLTextAreaElement.prototype
      : win.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  await act(async () => {
    setter?.call(el, value);
    el.dispatchEvent(new win.Event("input", { bubbles: true }));
  });
  await flush(2);
}
const rowsShown = () =>
  Array.from(
    host.querySelectorAll("tbody tr[data-location]") as ArrayLike<any>,
  ).map(r => r.getAttribute("data-location") as string);
const cellOf = (loc: string, col: string) =>
  host.querySelector(`tr[data-location="${loc}"] td[data-col="${col}"]`) as any;
const headers = () =>
  Array.from(
    host.querySelectorAll("thead tr:nth-child(2) th") as ArrayLike<any>,
  ).map(th => text(th).trim());
const sheet = () => win.document.querySelector('[role="dialog"]') as any;

beforeEach(() => {
  client.resetBoardCache();
  rpcCalls.length = 0;
  invokes.length = 0;
  win.localStorage.clear();
  answer();
  invokeAnswer = async () => ({ data: null, error: { message: "No answer" } });
});

afterEach(async () => {
  await act(async () => root.render(null));
  await flush(2);
});

afterAll(async () => {
  await act(async () => root.unmount());
  globalThis.fetch = realFetch;
  console.error = realError;
  db.rpc = realRpc;
  db.auth.getSession = realGetSession;
  db.auth.getUser = realGetUser;
  if (functionsDescriptor)
    Object.defineProperty(db, "functions", functionsDescriptor);
  else delete db.functions;
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
});

// ---------------------------------------------------------------------------

describe("the time frame", () => {
  const day = "2026-10-16";
  test("the five windows are the Meta reach windows, ending today", () => {
    expect(client.frameOf("last_7", day)).toMatchObject({
      from: "2026-10-10",
      to: day,
    });
    expect(client.frameOf("last_14", day)).toMatchObject({
      from: "2026-10-03",
      to: day,
    });
    expect(client.frameOf("last_30", day)).toMatchObject({
      from: "2026-09-17",
      to: day,
    });
    expect(client.frameOf("this_month", day)).toMatchObject({
      from: "2026-10-01",
      to: day,
    });
    expect(client.frameOf("last_month", day)).toMatchObject({
      from: "2026-09-01",
      to: "2026-09-30",
    });
    expect(client.frameOf("last_month", "2027-01-05")).toMatchObject({
      from: "2026-12-01",
      to: "2026-12-31",
    });
    expect(client.frameOf(null, day)).toMatchObject({
      key: "last_30",
      from: "2026-09-17",
    });
  });
  test("a custom pick that cannot be read falls back to 30 days and says why", () => {
    expect(
      client.frameOf("custom", day, { from: "2026-10-01", to: "2026-10-05" }),
    ).toMatchObject({
      from: "2026-10-01",
      to: "2026-10-05",
      problem: null,
    });
    expect(
      client.frameOf("custom", day, { from: "2026-10-05", to: "2026-10-01" })
        .problem,
    ).toBe("The first day must be on or before the last day.");
    expect(
      client.frameOf("custom", day, { from: "2026-10-01", to: "2026-10-20" })
        .problem,
    ).toBe("Choose days up to today.");
    expect(
      client.frameOf("custom", day, { from: "2025-01-01", to: day }).problem,
    ).toBe("Choose at most 366 days.");
    expect(client.frameOf("custom", day, {}).from).toBe("2026-09-17");
  });
  test("picking Last 7 reads the board for those days", async () => {
    await show();
    expect(rpcCalls.find(c => c.name === "cockpit_board_read")?.args).toEqual({
      p_from: client.shiftDay(today, -29),
      p_to: today,
    });
    await click(host.querySelector('[data-chip="last_7"]'));
    expect(
      rpcCalls.filter(c => c.name === "cockpit_board_read").at(-1)?.args,
    ).toEqual({
      p_from: client.shiftDay(today, -6),
      p_to: today,
    });
    expect(text(host)).toContain("Ad numbers end yesterday");
  });
});

describe("formats", () => {
  test("a rate never rounds across its line", () => {
    expect(columns.percent(0.75)).toBe("0.75%");
    expect(columns.percent(69.96)).toBe("70%");
    expect(columns.percent(69.6)).toBe("69.6%");
    expect(columns.formatValue(12.5, "times")).toBe("12.5x");
    expect(columns.formatValue(2.456, "ratio")).toBe("2.46");
    expect(columns.formatValue(null, "usd")).toBe("n/a");
  });
  test("the first break follows the funnel: off first, then watch", () => {
    const v = (s: Record<string, string>) => ({
      values: Object.fromEntries(
        Object.entries(s).map(([k, status]) => [k, { v: 1, status }]),
      ),
    });
    expect(
      columns.firstBreak(v({ cpl: "good", showRate: "off", closeRate: "off" })),
    ).toMatchObject({ kind: "off", key: "showRate" });
    expect(columns.firstBreak(v({ cpl: "watch", roas: "off" }))).toMatchObject({
      kind: "off",
      key: "roas",
    });
    expect(
      columns.firstBreak(v({ cpl: "good", leadToBooking: "watch" })),
    ).toMatchObject({ kind: "watch", key: "leadToBooking" });
    expect(columns.firstBreak(v({ cpl: "good" }))).toEqual({
      kind: "on_target",
    });
    expect(columns.firstBreak(v({ cpl: "not_measured" }))).toEqual({
      kind: "unknown",
    });
  });
  test("a read in a shape the screen cannot use is one sentence, never a guess", () => {
    expect(() => client.parseBoard({ clients: "nope" })).toThrow(
      /shape this page cannot read/,
    );
  });
});

describe("the grid", () => {
  test("every client, the key columns, the caller and the no-outcome count", async () => {
    await show();
    expect(rowsShown().length).toBe(8);
    expect(headers()).toEqual([
      "Client",
      "Caller",
      "Spend",
      "CRM leads",
      "CPL",
      "Bookings",
      "Booking rate",
      "Cost per booking",
      "Show rate",
      "Close rate",
      "ROAS",
      "No outcome",
    ]);
    expect(text(cellOf("locFixLiwan003", "caller"))).toBe(
      "Rana Saleh, Dana Yousef",
    );
    expect(text(cellOf("locFixReem0004", "caller"))).toBe("No caller assigned");
    expect(text(cellOf("locFixOrbit006", "caller"))).toBe("Client calls");
    expect(text(cellOf("locFixDune0002", "noOutcome"))).toBe("4");
  });

  test("statuses are dots beside the number, named for screen readers", async () => {
    await show();
    const dot = (loc: string, col: string) =>
      cellOf(loc, col)
        .querySelector('[role="img"]')
        ?.getAttribute("aria-label");
    expect(dot("locFixDune0002", "cpl")).toBe("Off target");
    expect(dot("locFixAtlas005", "cpl")).toBe("Watch");
    expect(dot("locFixHarbor01", "cpl")).toBe("On target");
    // Pearl Marble's booking rate has 2 CRM leads: under the 10 a rate needs.
    expect(dot("locFixPearl008", "leadToBooking")).toBe("Too few to judge");
    // A plain count has no dot.
    expect(dot("locFixHarbor01", "spend")).toBeUndefined();
    // Liwan's own CPL target ($12) judges its $11.50 as good; the help says it is the client's own.
    expect(dot("locFixLiwan003", "cpl")).toBe("On target");
  });

  test("a missing value is never 0, in any column", async () => {
    await show();
    await click(button("Columns"));
    await click(button("Every column"));
    const board = boardFixture(client.shiftDay(today, -29), today, today);
    let checked = 0;
    for (const row of board.clients) {
      for (const c of columns.COLUMNS) {
        if (c.special) continue;
        const cell =
          c.key === "noOutcome" ? { v: row.noOutcome } : row.values[c.key];
        if (cell && (cell.v !== null || typeof cell.atLeast === "number"))
          continue;
        const shown = text(cellOf(row.locationId, c.key)).trim();
        expect([`${row.clientName} ${c.key}`, shown]).toEqual([
          `${row.clientName} ${c.key}`,
          expect.stringMatching(
            /^(n\/a|Not filled in|Not a video|Client calls|Too few)$/,
          ),
        ]);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(40);
    // The client with no ad account: every ad column says n/a, never $0.
    expect(text(cellOf("locFixNova0007", "spend"))).toBe("n/a");
    expect(text(cellOf("locFixNova0007", "cpm"))).toBe("n/a");
    // The client that does not fill its sheet.
    expect(text(cellOf("locFixReem0004", "closeRate"))).toBe("Not filled in");
    // An image-only client's hook rate is not a video, never 0%.
    expect(text(cellOf("locFixLiwan003", "hookRate"))).toBe("Not a video");
    // A cost with no lead yet is a floor: "$60+", not $0 and not n/a.
    expect(text(cellOf("locFixPearl008", "cpl"))).toBe("$60+");
  });

  test("sort by any column; a missing value sorts last either way", async () => {
    await show();
    await click(button("Sort by Spend"));
    const order = rowsShown();
    expect(order.at(-1)).toBe("locFixNova0007");
    expect(order[0]).toBe("locFixLiwan003");
    await click(button("Sort by Spend"));
    const back = rowsShown();
    expect(back.at(-1)).toBe("locFixNova0007");
    expect(back[0]).toBe("locFixPearl008");
    expect(
      cellOf(back[0], "spend")
        .closest("table")
        .querySelector('th[aria-sort="ascending"]'),
    ).toBeTruthy();
  });

  test("the column picker shows a column, and the choice is remembered", async () => {
    await show();
    expect(headers()).not.toContain("Impressions");
    await click(button("Columns"));
    const box = Array.from(
      body().querySelectorAll("#board-columns label") as ArrayLike<any>,
    ).find(l => text(l).trim() === "Impressions");
    await click(box.querySelector("input"));
    expect(headers()).toContain("Impressions");
    expect(
      JSON.parse(win.localStorage.getItem("cockpit.board.columns.v1") ?? "[]"),
    ).toContain("impressions");
    await act(async () => root.render(null));
    await show();
    expect(headers()).toContain("Impressions");
    await click(button("Columns"));
    await click(button("Key columns"));
    expect(headers()).not.toContain("Impressions");
    expect(
      JSON.parse(win.localStorage.getItem("cockpit.board.columns.v1") ?? "[]"),
    ).toEqual(columns.KEY_COLUMNS);
  });

  test("the meeting view: bigger type and the room's columns", async () => {
    await show();
    await click(button("Meeting view"));
    const labels = MEETING_COLUMNS.map(
      k => columns.COLUMNS.find(c => c.key === k)?.label,
    );
    expect(headers()).toEqual(["Client", ...labels]);
    expect(host.querySelector("table").className).toContain("text-[15px]");
    expect(buttons("Columns").length).toBe(0);
  });

  test("the first break under each client's name", async () => {
    await show();
    const name = (loc: string) =>
      text(host.querySelector(`tr[data-location="${loc}"] th`));
    expect(name("locFixDune0002")).toContain("Off at cost per lead");
    expect(name("locFixLiwan003")).toContain("On target");
    expect(name("locFixHarbor01")).toContain("Watch close rate");
  });

  test("the portfolio adds up only what is there, and says how many clients", async () => {
    await show();
    const board = boardFixture(client.shiftDay(today, -29), today, today);
    const spend = board.clients.reduce(
      (s: number, c: any) => s + (c.values.spend.v ?? 0),
      0,
    );
    const strip = host.querySelector('[aria-label="Every client together"]');
    expect(text(strip)).toContain(columns.formatValue(spend, "usd"));
    expect(text(strip)).toContain("7 of 8 clients");
    // Every CRM lead count is known.
    expect(text(strip)).toContain("All 8 clients");
  });

  test("a figure no client has is n/a in the portfolio, never $0", async () => {
    answer({
      edit: b => {
        for (const c of b.clients)
          c.values.revenue = { v: null, status: "not_filled_in" };
      },
    });
    await show();
    const strip = host.querySelector('[aria-label="Every client together"]');
    const revenue = Array.from(
      strip.querySelectorAll("dl > div") as ArrayLike<any>,
    ).find(d => text(d).startsWith("Revenue"));
    expect(text(revenue)).toBe("Revenuen/a0 of 8 clients");
  });

  test("the no-outcome line counts every client's appointments and sorts the grid by them", async () => {
    await show();
    const board = boardFixture(client.shiftDay(today, -29), today, today);
    const total = board.clients.reduce(
      (s: number, c: any) => s + (c.noOutcome ?? 0),
      0,
    );
    const oldest = Math.max(
      ...board.clients.map((c: any) => c.noOutcomeOldestDays ?? 0),
    );
    const line = button("in this time frame have no outcome yet", host);
    expect(text(line)).toContain(
      `${total} appointments in this time frame have no outcome yet`,
    );
    expect(text(line)).toContain(`the oldest ${oldest} days old`);
    await click(line);
    const order = rowsShown();
    const counts = order.map(
      loc => board.clients.find((c: any) => c.locationId === loc).noOutcome,
    );
    expect(counts).toEqual([...counts].sort((a: number, b: number) => b - a));
    expect(line.getAttribute("aria-pressed")).toBe("true");
  });

  test("no client has a missing appointment count: the line says every appointment has an outcome", async () => {
    answer({
      edit: b => {
        for (const c of b.clients) c.noOutcome = 0;
      },
    });
    await show();
    expect(text(host)).toContain(
      "Every appointment due in this time frame has an outcome.",
    );
  });
});

describe("empty, loading and error states", () => {
  test("a refused seat reads the database's sentence, with Try again", async () => {
    answer({
      fail: {
        code: "42501",
        message:
          "Sign in with an active cockpit seat to see the Client Performance board.",
      },
    });
    await show();
    expect(text(host)).toContain("The board did not load");
    expect(text(host)).toContain(
      "Sign in with an active cockpit seat to see the Client Performance board.",
    );
    answer();
    await click(button("Try again", host));
    expect(rowsShown().length).toBe(8);
  });
  test("a read not on the database yet says so", async () => {
    answer({
      fail: {
        code: "PGRST202",
        message: "Could not find the function public.cockpit_board_read",
      },
    });
    await show();
    expect(text(host)).toContain(
      "The board's read is not on the database yet. Tell the CEO.",
    );
  });
  test("a slow read says what to do", async () => {
    answer({
      fail: {
        code: "57014",
        message: "canceling statement due to statement timeout",
      },
    });
    await show();
    expect(text(host)).toContain("a shorter time frame reads faster");
  });
  test("no clients on the seat", async () => {
    answer({ scenario: "empty" });
    await show();
    expect(text(host)).toContain("No clients on your board");
    expect(text(host)).toContain("Ask the CEO to add clients to your seat");
  });
  test("while the board is read, a quiet skeleton", async () => {
    rpcAnswer = () => new Promise<Answer>(() => {});
    await show();
    expect(host.querySelector('[aria-label="Reading the board"]')).toBeTruthy();
  });
  test("stale data is said above the numbers, with the as-of line", async () => {
    answer({ scenario: "stale" });
    await show();
    expect(text(host)).toContain("The client facts last refreshed");
    expect(text(host)).toContain(
      "The last Meta read did not finish every ad account.",
    );
    expect(text(host)).toMatch(
      /As of: CRM, calendars and client sheets .* Meta /,
    );
  });
});

describe("the client panel", () => {
  test("opens from the grid, reads the client, and lists the appointments with no outcome", async () => {
    await show();
    await click(button("Open Dune Interiors"));
    const call = rpcCalls.find(c => c.name === "cockpit_board_client");
    expect(call?.args).toEqual({
      p_location: "locFixDune0002",
      p_from: client.shiftDay(today, -29),
      p_to: today,
    });
    const panel = sheet();
    expect(text(panel)).toContain("Dune Interiors");
    expect(text(panel)).toContain("Caller: Dana Yousef");
    expect(text(panel)).toContain("Off at cost per lead");
    const page = clientFixture(
      "locFixDune0002",
      client.shiftDay(today, -29),
      today,
      today,
    ) as any;
    const links = Array.from(
      panel.querySelectorAll("a") as ArrayLike<any>,
    ).filter(a => text(a).includes("Open in GoHighLevel"));
    expect(links.map(a => a.getAttribute("href"))).toEqual(
      page.noOutcomeAppointments.map((a: any) => a.contactUrl),
    );
    for (const a of page.noOutcomeAppointments)
      expect(text(panel)).toContain(a.firstName);
    expect(text(panel)).toContain("Booked by Dana Yousef");
  });

  test("the campaign, ad set and ad tree; retention bars only for a video", async () => {
    await show();
    await click(button("Open Harbor Kitchens"));
    const panel = sheet();
    const level = (l: string) =>
      panel.querySelectorAll(`tr[data-level="${l}"]`).length;
    expect(level("campaign")).toBe(2);
    expect(level("adset")).toBe(3);
    expect(level("ad")).toBe(0);
    await click(button("Show every ad", panel));
    expect(level("ad")).toBe(4);
    const adRow = (name: string) =>
      Array.from(
        panel.querySelectorAll('tr[data-level="ad"]') as ArrayLike<any>,
      ).find(r => text(r).includes(name));
    expect(
      adRow("Hook test").querySelector(
        '[role="img"][aria-label^="Watched to 25%"]',
      ),
    ).toBeTruthy();
    expect(text(adRow("Still image"))).toContain("Not a video");
    // The WhatsApp ad set has no lead form: its CPL is n/a, not $0.
    const chat = Array.from(
      panel.querySelectorAll('tr[data-level="adset"]') as ArrayLike<any>,
    ).find(r => text(r).includes("WhatsApp"));
    expect(text(chat)).toContain("n/a");
    expect(text(panel)).toContain("Ad 120999, not in the Meta store");
    // The levers part lists the filed one with its task.
    expect(text(panel)).toContain(
      "Send the WhatsApp reminder an hour before every meeting",
    );
    const task = Array.from(panel.querySelectorAll("a") as ArrayLike<any>).find(
      a => text(a).includes("Open the task"),
    );
    expect(task.getAttribute("href")).toBe(
      "https://app.clickup.com/t/86fixtask1",
    );
  });

  test("a client with no ad account says so instead of an empty tree", async () => {
    await show();
    await click(button("Open Nova Landscapes"));
    expect(text(sheet())).toContain(
      "No Meta ad account is linked to this client",
    );
    expect(text(sheet())).toContain(
      "This client has no ClickUp card, so a lever cannot be filed.",
    );
  });
});

describe("a lever", () => {
  const preview = {
    dryRun: true,
    plan: {
      list: "901816723211",
      department: "client_success",
      name: "Harbor Kitchens - Ask for the quote at the end of every meeting",
      description: "Lever from the Client Performance board.\nWhy: invented.",
      dueDate: Date.UTC(2026, 9, 18),
      clientTask: "https://app.clickup.com/t/86fixhar1",
    },
    context: {},
  };

  test("starts on the client's first break, previews, then files once with one request id", async () => {
    let fileTries = 0;
    invokeAnswer = async b => {
      if (!b.apply) return { data: preview, error: null };
      fileTries += 1;
      if (fileTries === 1)
        return {
          data: null,
          error: {
            message: "Edge Function returned a non-2xx status code",
            context: new Response(
              JSON.stringify({ error: "ClickUp did not answer. Try again." }),
              { status: 502 },
            ),
          },
        };
      return {
        data: {
          ok: true,
          ticketId: "86fixnew9",
          ticketUrl: "https://app.clickup.com/t/86fixnew9",
          commentId: "c1",
          lever: null,
        },
        error: null,
      };
    };
    await show();
    await click(button("Open Harbor Kitchens"));
    const panel = sheet();
    await click(button("Add a lever for close rate", panel));
    const input = panel.querySelector('input[name="lever"]');
    expect(button("Preview the task", panel).disabled).toBe(true);
    await type(input, "Ask for the quote at the end of every meeting");
    await click(button("Preview the task", panel));
    expect(invokes[0]).toEqual({
      name: "cockpit-board-api",
      body: {
        operation: "lever",
        args: {
          locationId: "locFixHarbor01",
          metric: "close_rate",
          lever: "Ask for the quote at the end of every meeting",
          department: "client_success",
          from: client.shiftDay(today, -29),
          to: today,
        },
      },
    });
    expect(text(panel)).toContain(preview.plan.name);
    expect(text(panel)).toContain("Client success's list");

    const readsBefore = rpcCalls.length;
    await click(button("File the task", panel));
    expect(text(panel)).toContain("ClickUp did not answer. Try again.");
    // Another lever previewed in between, then this one again: the retry
    // still carries this lever's first request id, so it cannot file twice.
    await type(input, "Something else entirely");
    await click(button("Preview the task", panel));
    await type(input, "Ask for the quote at the end of every meeting");
    await click(button("Preview the task", panel));
    await click(button("File the task", panel));
    const filed = invokes.filter(i => i.body.apply === true);
    expect(filed.length).toBe(2);
    expect(filed[0].body.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(filed[1].body.requestId).toBe(filed[0].body.requestId);
    expect(filed[1].body.args.lever).toBe(
      "Ask for the quote at the end of every meeting",
    );
    expect(text(panel)).toContain("Filed in ClickUp");
    const link = Array.from(panel.querySelectorAll("a") as ArrayLike<any>).find(
      a => a.getAttribute("href") === "https://app.clickup.com/t/86fixnew9",
    );
    expect(text(link)).toContain("Open the task");
    // The client's page and the board's lever counts are read again.
    const after = rpcCalls.slice(readsBefore).map(c => c.name);
    expect(after).toContain("cockpit_board_client");
    expect(after).toContain("cockpit_board_read");
  });

  test("a changed lever needs a new preview before it can be filed", async () => {
    invokeAnswer = async () => ({ data: preview, error: null });
    await show();
    await click(button("Open Harbor Kitchens"));
    const panel = sheet();
    await click(button("Add a lever", panel));
    const input = panel.querySelector('input[name="lever"]');
    await type(input, "Ask for the quote at the end of every meeting");
    await click(button("Preview the task", panel));
    expect(buttons("File the task", panel).length).toBe(1);
    await type(input, "Ask for the quote before the meeting ends");
    expect(buttons("File the task", panel).length).toBe(0);
    expect(buttons("Preview the task", panel).length).toBe(1);
    // The team chips pick the department.
    await click(button("Creative", panel));
    await click(button("Preview the task", panel));
    expect(invokes.at(-1)?.body.args.department).toBe("creative");
    expect(invokes.every(i => i.body.apply !== true)).toBe(true);
  });

  test("a refusal from the function is said as it is", async () => {
    invokeAnswer = async () => ({
      data: null,
      error: {
        message: "Edge Function returned a non-2xx status code",
        context: new Response(
          JSON.stringify({ error: "This client is not on your board." }),
          { status: 403 },
        ),
      },
    });
    await show();
    await click(button("Open Harbor Kitchens"));
    const panel = sheet();
    await click(button("Add a lever", panel));
    await type(panel.querySelector('input[name="lever"]'), "Anything at all");
    await click(button("Preview the task", panel));
    expect(text(panel.querySelector('[role="alert"]'))).toBe(
      "This client is not on your board.",
    );
  });
});

describe("targets", () => {
  test("only a seat the database lets edit targets sees Edit targets", async () => {
    answer({ edit: b => (b.canEditTargets = false) });
    await show();
    expect(buttons("Edit targets", host).length).toBe(0);
    client.resetBoardCache();
    answer();
    await act(async () => root.render(null));
    await show();
    expect(buttons("Edit targets", host).length).toBe(1);
  });

  test("a saved line goes to the database for the whole board, then the board is read again", async () => {
    const saves: any[] = [];
    answer({
      save: args => {
        saves.push(args);
        return {
          data: {
            ok: true,
            scope: args.p_scope,
            metric: args.p_metric,
            target: null,
          },
          error: null,
        };
      },
    });
    await show();
    await click(button("Edit targets", host));
    const dialog = sheet();
    expect(text(dialog)).toContain(
      "Official: Good at or under $15, watch to $22.50.",
    );
    const good = dialog.querySelector(
      'input[aria-label="Cost per lead good line"]',
    );
    await type(good, "12");
    // A blank watch keeps the official $22.50: a $40 CPL stays off, not a watch.
    expect(text(dialog)).toContain(
      "Watch stays at $22.50, the official watch line.",
    );
    const reads = rpcCalls.filter(c => c.name === "cockpit_board_read").length;
    await click(button("Save", dialog));
    expect(saves).toEqual([
      {
        p_scope: "defaults",
        p_metric: "cpl",
        p_good: 12,
        p_watch: 22.5,
        p_note: null,
      },
    ]);
    expect(rpcCalls.filter(c => c.name === "cockpit_board_read").length).toBe(
      reads + 1,
    );
  });

  test("after a save, every time frame and client read earlier is read again", async () => {
    await show("/performance?tf=last_7");
    // A client opened in Last 7, then closed.
    await click(button("Open Dune Interiors"));
    await act(async () => {
      win.document.dispatchEvent(
        new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    await flush();
    await click(host.querySelector('[data-chip="last_30"]'));
    const last7 = { p_from: client.shiftDay(today, -6), p_to: today };
    const reads = (name: string) =>
      rpcCalls.filter(
        c =>
          c.name === name &&
          c.args.p_from === last7.p_from &&
          c.args.p_to === last7.p_to,
      ).length;
    expect(reads("cockpit_board_read")).toBe(1);
    expect(reads("cockpit_board_client")).toBe(1);
    await click(button("Edit targets", host));
    const dialog = sheet();
    await type(
      dialog.querySelector('input[aria-label="Cost per lead good line"]'),
      "12",
    );
    await click(button("Save", dialog));
    // The board in view is read again at once.
    expect(
      rpcCalls.filter(
        c =>
          c.name === "cockpit_board_read" &&
          c.args.p_from === client.shiftDay(today, -29),
      ).length,
    ).toBe(2);
    await act(async () => {
      win.document.dispatchEvent(
        new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    await flush();
    // Back to Last 7: its board and the client opened in it are read again.
    await click(host.querySelector('[data-chip="last_7"]'));
    expect(reads("cockpit_board_read")).toBe(2);
    await click(button("Open Dune Interiors"));
    expect(reads("cockpit_board_client")).toBe(2);
  });

  test("a board override shows beside the official line and can go back", async () => {
    const saves: any[] = [];
    answer({
      scenario: "board_override",
      save: args => {
        saves.push(args);
        return { data: { ok: true }, error: null };
      },
    });
    await show();
    await click(button("Edit targets", host));
    const dialog = sheet();
    expect(text(dialog)).toContain(
      "Override: Good at or above 65%, watch to 55%, never off.",
    );
    await click(button("Use official", dialog));
    expect(saves).toEqual([
      {
        p_scope: "defaults",
        p_metric: "show_rate",
        p_good: null,
        p_watch: null,
        p_note: null,
      },
    ]);
  });

  test("the database's refusal is said in the row", async () => {
    answer({
      save: () => ({
        data: null,
        error: {
          code: "42501",
          message: "Only the CEO and admins change the board's targets.",
        },
      }),
    });
    await show();
    await click(button("Edit targets", host));
    const dialog = sheet();
    await type(
      dialog.querySelector('input[aria-label="Show rate good line"]'),
      "75",
    );
    await click(button("Save", dialog));
    expect(text(dialog.querySelector('[role="alert"]'))).toBe(
      "Only the CEO and admins change the board's targets.",
    );
  });

  test("a line on the wrong side is caught before it is sent", () => {
    const cpl = { direction: "lower" as const, label: "Cost per lead" };
    const show = { direction: "higher" as const, label: "Show rate" };
    expect(lineProblem(cpl, "usd", "15", "10")).toBe(
      "Cost per lead: lower is better, so the watch line must be at or above the good line.",
    );
    expect(lineProblem(show, "percent", "70", "80")).toBe(
      "Show rate: higher is better, so the watch line must be at or below the good line.",
    );
    expect(lineProblem(show, "percent", "120", "")).toBe(
      "Use a number from 0 to 100.",
    );
    expect(lineProblem(show, "percent", "", "50")).toBe(
      "Set the good line, or clear both to go back.",
    );
    expect(lineProblem(cpl, "usd", "$12.50", "18")).toBeNull();
  });

  test("a blank watch line is never sent by accident", () => {
    const official = (good: number | null, watch: number | null) => ({
      good,
      watch,
      from: "the official target",
    });
    const cpl = { direction: "lower" as const, label: "Cost per lead" };
    const touched = { direction: "higher" as const, label: "Leads touched" };
    const aov = { direction: "higher" as const, label: "Average order value" };
    // The official watch line still sits on the worse side: it is carried.
    expect(blankWatch(cpl, "usd", 12, official(15, 22.5))).toMatchObject({
      watch: 22.5,
    });
    // A good line past the official watch line: a watch line must be set.
    expect(lineProblem(cpl, "usd", "25", "", official(15, 22.5))).toBe(
      "Set the watch line too: the official one, $22.50, is under this good line.",
    );
    // "Any miss is off" stays so: the watch line moves with the good line.
    expect(blankWatch(touched, "percent", 85, official(90, 90))).toMatchObject({
      watch: 85,
    });
    // No watch line officially: none, as the official target says.
    expect(blankWatch(aov, "usd", 15000, official(10000, null))).toMatchObject({
      watch: null,
      words: "No watch line: short of good is a watch.",
    });
  });

  test("a good line past the inherited watch line cannot be saved without one", async () => {
    const saves: any[] = [];
    answer({
      save: args => {
        saves.push(args);
        return { data: { ok: true }, error: null };
      },
    });
    await show();
    await click(button("Edit targets", host));
    const dialog = sheet();
    await type(
      dialog.querySelector('input[aria-label="Cost per lead good line"]'),
      "25",
    );
    const row = dialog
      .querySelector('input[aria-label="Cost per lead good line"]')
      .closest("li");
    expect(text(row)).toContain("Set the watch line too");
    expect(button("Save", row).disabled).toBe(true);
    await type(
      dialog.querySelector('input[aria-label="Cost per lead watch line"]'),
      "30",
    );
    await click(button("Save", row));
    expect(saves.map(s => [s.p_good, s.p_watch])).toEqual([[25, 30]]);
  });
});
