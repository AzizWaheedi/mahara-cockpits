/**
 * The Calls part of a client's page (src/components/CallCentreSection.tsx)
 * and its reads (src/lib/callCentreClient.ts), rendered in happy-dom with the
 * database and the recording route mocked. Every number, name and note is
 * invented (src/dev/callCentreFixture.ts). The verdict and the wording are
 * tested in call-centre.test.ts; this checks what the page does with them.
 * The DOM is happy-dom, this app's own dev dependency.
 */
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const here = import.meta.dir;

// Nothing here may outlive this file: bun runs every test file in one
// process, so no module mocks (they leak into other files), and every global
// and the env are put back in afterAll.
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

// --- The database: the cockpit's own client, its two reads answered here. ---
// Built before any DOM exists, so its sign-in never starts a refresh timer.
const { supabase } = await import("../src/lib/supabase");
const db = supabase as any;
const realRpc = db.rpc;
const realGetSession = db.auth.getSession;
type Answer = {
  data: unknown;
  error: { message: string; code?: string } | null;
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
  "Element",
  "Node",
  "Event",
  "MouseEvent",
  "KeyboardEvent",
  "PointerEvent",
  "FocusEvent",
  "MutationObserver",
  "DocumentFragment",
  "Text",
  "getComputedStyle",
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
// The session cache answers outside React (useSyncExternalStore), so its
// updates land between act() calls; flush() below waits them out.
const realError = console.error;
console.error = (...args: unknown[]) => {
  if (typeof args[0] === "string" && args[0].includes("not wrapped in act"))
    return;
  realError(...args);
};

// The recording route, stubbed at the network: the shared fetchCallRecording
// runs as it is (a module mock would leak into call-recording.test.ts).
const ROUTE = `${ENV.VITE_SUPABASE_URL}/functions/v1/cockpit-call-recording`;
const recordings: { url: string; auth: string; callId: string }[] = [];
let recordingAnswer: (callId: string) => Promise<Response>;
const audio = () =>
  new Response(new Uint8Array([82, 73, 70, 70]), {
    headers: { "content-type": "audio/wav" },
  });
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url !== ROUTE) return realFetch(input, init);
  const callId = String(JSON.parse(String(init?.body ?? "{}")).callId);
  recordings.push({
    url,
    auth: ((init?.headers ?? {}) as Record<string, string>).Authorization,
    callId,
  });
  return recordingAnswer(callId);
}) as typeof fetch;

const { createRoot } = await import("react-dom/client");
const { act, createElement } = await import("react");
const { MemoryRouter } = await import("react-router");
const { CallCentreSection, CallerLine, useCallsHoldLost } = await import(
  "../src/components/CallCentreSection"
);
const client = await import("../src/lib/callCentreClient");
const { callCentreScenario, callersScenario } = await import(
  "../src/dev/callCentreFixture"
);
const { NO_CALLER, parseCallCentre } = await import("../src/lib/callCentre");

type Scenario = Parameters<typeof callCentreScenario>[0];

/** The calls read answers this scenario; the callers read its own list. */
function answer(kind: Scenario | "refused" | "pending", callers = true) {
  rpcAnswer = async (name, args) => {
    if (name === "cockpit_client_callers")
      return callers
        ? { data: callersScenario(), error: null }
        : { data: null, error: { message: "nope" } };
    if (kind === "pending") return new Promise<Answer>(() => {});
    if (kind === "refused")
      return {
        data: null,
        error: {
          code: "42501",
          message:
            "This client is not on your cockpit seat. Ask the CEO to add it.",
        },
      };
    return {
      data: callCentreScenario(kind, args.p_from, args.p_to),
      error: null,
    };
  };
}

// Blob URLs, counted.
const made: string[] = [];
const revoked: string[] = [];
const realCreate = URL.createObjectURL;
const realRevoke = URL.revokeObjectURL;
URL.createObjectURL = () => {
  const url = `blob:test/${made.length + 1}`;
  made.push(url);
  return url;
};
URL.revokeObjectURL = (url: string) => {
  revoked.push(url);
};

const host = win.document.createElement("div");
win.document.body.append(host);
const root = createRoot(host as any);
let mounts = 0;

async function flush(times = 4) {
  for (let i = 0; i < times; i++)
    await act(async () => {
      await new Promise(r => setTimeout(r, 0));
    });
}

async function show(
  props: Partial<Parameters<typeof CallCentreSection>[0]> = {},
  path = "/ads?account=Harbor",
  withCaller = false,
) {
  mounts += 1;
  const section = createElement(CallCentreSection, {
    accountKey: "1234567890",
    clientName: "Liwan Limited",
    ...props,
  });
  const caller = withCaller
    ? createElement(CallerLine, {
        clientName: props.clientName ?? "Liwan Limited",
        accountKey:
          props.accountKey === undefined ? "1234567890" : props.accountKey,
        range: props.range,
        leadsOnly: props.leadsOnly,
        className: "page-caller",
      })
    : null;
  await act(async () => {
    root.render(
      createElement(
        MemoryRouter,
        { key: mounts, initialEntries: [path] },
        caller,
        section,
      ),
    );
  });
  await flush();
}

const text = () => host.textContent ?? "";
const buttons = (label: string) =>
  Array.from(host.querySelectorAll("button")).filter(b =>
    (b.getAttribute("aria-label") ?? b.textContent ?? "").includes(label),
  );
const button = (label: string) => {
  const b = buttons(label)[0];
  if (!b) throw new Error(`No button "${label}" in: ${text().slice(0, 400)}`);
  return b;
};
async function click(el: Element) {
  await act(async () => {
    (el as HTMLElement).click();
  });
  await flush();
}
/** The list a "more" button opens, found by its aria-controls. */
const controlled = (b: Element) =>
  win.document.getElementById(b.getAttribute("aria-controls") ?? "");
/** The calls read answers this scenario, changed by `edit` first. */
function answerWith(kind: Scenario, edit: (raw: any) => void) {
  rpcAnswer = async (name, args) => {
    if (name === "cockpit_client_callers")
      return { data: callersScenario(), error: null };
    const raw = callCentreScenario(kind, args.p_from, args.p_to);
    edit(raw);
    return { data: raw, error: null };
  };
}

beforeEach(() => {
  client.resetCallCentreCache();
  rpcCalls.length = 0;
  recordings.length = 0;
  made.length = 0;
  revoked.length = 0;
  answer("call_centre");
  recordingAnswer = async () => audio();
});

afterEach(async () => {
  await act(async () => root.render(null));
});

afterAll(async () => {
  await act(async () => root.unmount());
  URL.createObjectURL = realCreate;
  URL.revokeObjectURL = realRevoke;
  globalThis.fetch = realFetch;
  console.error = realError;
  db.rpc = realRpc;
  db.auth.getSession = realGetSession;
  for (const [k, d] of globalsBefore)
    if (d) Object.defineProperty(globalThis, k, d);
    else delete g[k];
  envs.forEach((e, i) => {
    for (const [k, v] of Object.entries(envBefore[i]))
      if (v === undefined) delete e[k];
      else e[k] = v;
  });
  await win.happyDOM.close();
});

// ---------------------------------------------------------------------------

describe("the dates the read takes", () => {
  const today = "2026-10-13";
  test("no range is the last 30 days, ending today", () => {
    expect(client.callWindow(null, today)).toEqual({
      from: "2026-09-14",
      to: today,
      why: null,
    });
  });
  test("a range inside the last 93 days is kept as it is", () => {
    expect(
      client.callWindow({ start: "2026-09-01", end: "2026-09-30" }, today),
    ).toEqual({ from: "2026-09-01", to: "2026-09-30", why: null });
  });
  test("a longer range is cut to the last 93 days, and says so", () => {
    const w = client.callWindow({ start: "2026-01-01", end: today }, today);
    expect(w.from).toBe("2026-07-13");
    expect(w.to).toBe(today);
    expect(w.why).toBe(
      "Calls cover 13 Jul to 13 Oct: the call read goes back at most 93 days.",
    );
  });
  test("an end after today stops at today; reversed dates are put in order", () => {
    expect(
      client.callWindow({ start: "2026-10-20", end: "2026-10-01" }, today),
    ).toEqual({ from: "2026-10-01", to: today, why: null });
  });
  test("a range wholly older than 93 days falls back to 30 days, with the reason", () => {
    const w = client.callWindow(
      { start: "2025-01-01", end: "2025-12-31" },
      today,
    );
    expect(w.from).toBe("2026-09-14");
    expect(w.why).toContain("goes back 93 days");
  });
  test("dates after today fall back too", () => {
    expect(
      client.callWindow({ start: "2026-11-01", end: "2026-11-05" }, today).why,
    ).toContain("after today");
  });
});

describe("the small helpers", () => {
  test("the key is the ad account most campaigns run in", () => {
    expect(
      client.callCentreKey([
        { metaAccountId: "111111" },
        { metaAccountId: "act_222222" },
        { metaAccountId: "act_222222" },
        { metaAccountId: "Mahara Clients 3" },
        {},
      ]),
    ).toBe("act_222222");
    expect(client.callCentreKey([{ metaAccountId: "" }, {}])).toBeNull();
  });
  test("callers match the client by name; an unknown name waits for the full read", () => {
    const list = callersScenario().clients;
    expect(client.callersFor(list, "  liwan   LIMITED ")).toEqual([
      "Rana Saleh",
    ]);
    expect(client.callersFor(list, "City Wood")).toEqual([]);
    expect(client.callersFor(list, "Nobody")).toBeNull();
    expect(client.callerNames([])).toBe(NO_CALLER);
    expect(client.callerNames(["A", "B", "C"])).toBe("A, B and C");
  });
  test("a row's rates, and nothing under them is null", () => {
    const row = callCentreScenario("call_centre").byAd[0];
    const r = client.rowRates(row);
    expect(Math.round(r.calledRate ?? 0)).toBe(86);
    expect(r.dialsPerLead).toBeCloseTo(86 / 28);
    expect(
      client.rowRates({ ...row, leads: 0, called: 0, dials: 0 }).dialsPerLead,
    ).toBeNull();
    const data = callCentreScenario("call_centre");
    expect(client.leadsOutsideRows(data.byCampaign, data.clientAverage)).toBe(
      4,
    );
    expect(client.leadsOutsideRows(data.byCampaign, null)).toBe(0);
  });
  test("the waiting headline names every line that waits, and nothing else", () => {
    const none = {
      untouched: 0,
      callbacks: 0,
      overdue: 0,
      notReturned: 0,
      stuck: 0,
    };
    expect(client.waitingHeadline(none)).toEqual([]);
    expect(
      client.waitingHeadline({
        untouched: 1,
        callbacks: 1,
        overdue: 1,
        notReturned: 1,
        stuck: 1,
      }),
    ).toEqual([
      "1 untouched after a working hour",
      "1 callback waiting, 1 overdue",
      "1 missed call not returned",
      "1 stuck over a week",
    ]);
    expect(client.waitingHeadline({ ...none, callbacks: 4 })).toEqual([
      "4 callbacks waiting, none overdue",
    ]);
    expect(client.waitingHeadline({ ...none, stuck: 10 })).toEqual([
      "10 stuck over a week",
    ]);
  });

  test("the Calls part holds the lost leads only when it shows them", () => {
    const ready = (edit?: (raw: any) => void) => {
      const raw = callCentreScenario("call_centre");
      edit?.(raw);
      return { status: "ready" as const, data: parseCallCentre(raw) };
    };
    const we = { leadsOnly: false, hasKey: true };
    // A client we call, with lost leads in the dialer: the Calls part.
    expect(client.callsHoldLost(ready(), we)).toBe(true);
    // While the read is out the pipeline waits, so it never shows then goes.
    expect(client.callsHoldLost({ status: "loading" }, we)).toBe(true);
    expect(client.callsHoldLost({ status: "idle" }, we)).toBe(true);
    // Everything else keeps the page's own lost pipeline.
    expect(
      client.callsHoldLost(ready(), { leadsOnly: true, hasKey: true }),
    ).toBe(false);
    expect(
      client.callsHoldLost({ status: "loading" }, { ...we, hasKey: false }),
    ).toBe(false);
    expect(client.callsHoldLost({ status: "error", message: "No." }, we)).toBe(
      false,
    );
    expect(
      client.callsHoldLost(
        ready(raw => {
          raw.client.serviceMode = "DWY";
        }),
        we,
      ),
    ).toBe(false);
    expect(
      client.callsHoldLost(
        ready(raw => {
          raw.lost.total = 0;
        }),
        we,
      ),
    ).toBe(false);
    expect(
      client.callsHoldLost(
        { status: "ready", data: parseCallCentre(callCentreScenario("empty")) },
        we,
      ),
    ).toBe(false);
  });

  test("refusals keep their own sentence; failures become one", () => {
    expect(
      client.callsProblem({
        code: "42501",
        message: "Ask the CEO for access.",
      }),
    ).toBe("Ask the CEO for access.");
    expect(
      client.callsProblem({ code: "57014", message: "canceling" }),
    ).toContain("took too long");
    expect(client.callsProblem({ message: "JWT expired" })).toBe(
      "Your sign-in has expired. Reload the page.",
    );
    expect(
      client.callsProblem({ message: "TypeError: Failed to fetch" }),
    ).toContain("could not be reached");
    expect(client.callsProblem({ message: "500" })).toContain("did not load");
    expect(client.callsProblem(null)).toContain("did not load");
  });
});

describe("the read is cached for the session", () => {
  test("two readers of one client and range share one read", async () => {
    await show({}, "/ads", true);
    const reads = rpcCalls.filter(c => c.name === "cockpit_client_calls");
    expect(reads).toHaveLength(1);
    expect(reads[0].args.p_key).toBe("1234567890");
    await show();
    expect(
      rpcCalls.filter(c => c.name === "cockpit_client_calls"),
    ).toHaveLength(1);
  });
  test("the page asks whether Calls holds the lost leads from the same read", async () => {
    const probe = () => host.querySelector(".probe")?.textContent;
    const render = async (leadsOnly = false) => {
      mounts += 1;
      await act(async () => {
        root.render(
          createElement(
            MemoryRouter,
            { key: mounts, initialEntries: ["/ads"] },
            createElement(() =>
              createElement(
                "p",
                { className: "probe" },
                useCallsHoldLost("1234567890", null, leadsOnly)
                  ? "held"
                  : "kept",
              ),
            ),
            createElement(CallCentreSection, {
              accountKey: "1234567890",
              clientName: "Liwan Limited",
              leadsOnly,
            }),
          ),
        );
      });
      await flush();
    };
    answer("pending");
    await render();
    expect(probe()).toBe("held");
    client.resetCallCentreCache();
    answer("call_centre");
    await render();
    expect(probe()).toBe("held");
    expect(text()).toContain("Why leads were lost");
    client.resetCallCentreCache();
    answer("refused");
    await render();
    expect(probe()).toBe("kept");
    client.resetCallCentreCache();
    answer("call_centre");
    await render(true);
    expect(probe()).toBe("kept");
    // One read per client and range, however many ask.
    expect(
      rpcCalls.filter(c => c.name === "cockpit_client_calls"),
    ).toHaveLength(4);
  });

  test("a range the read cannot take is clamped before it is asked", async () => {
    await show({ range: { start: "2020-01-01", end: "2030-01-01" } });
    const args = rpcCalls.find(c => c.name === "cockpit_client_calls")?.args;
    expect(args.p_to).toBe(client.kuwaitToday());
    expect(args.p_from).toBe(client.addDays(client.kuwaitToday(), -92));
    expect(text()).toContain("the call read goes back at most 93 days");
  });
});

describe("each verdict", () => {
  test("call centre: the chip, the sentence, the other reasons a tap away", async () => {
    await show();
    expect(text()).toContain("Call centre");
    expect(text()).toContain(
      "Only 67% of leads older than a working hour have a call on Maqsam (the line is 90%); 18 more have a saved outcome but no call, and 6 leads still wait.",
    );
    expect(text()).toContain("Also: The first call takes 2 h 10 min");
    const more = button("and 2 more");
    expect(more.getAttribute("aria-expanded")).toBe("false");
    expect(controlled(more)?.hasAttribute("hidden")).toBe(true);
    await click(more);
    expect(more.getAttribute("aria-expanded")).toBe("true");
    expect(controlled(more)?.hasAttribute("hidden")).toBe(false);
    expect(controlled(more)?.textContent).toContain(
      "calls in their first 3 days",
    );
    expect(text()).toContain("become a conversation over 2 minutes");
    // The four tiles name their lines.
    for (const t of [
      "First call",
      "Over 30 min line",
      "Dials",
      "Thin retries",
      "Answered",
      "35% line met",
      "Booked",
      "Under 25% line",
      "19 confirmed of 128 leads",
      // Calls to these dates' leads per lead (303 / 128), not 412 / 128.
      "2.4 per lead from these dates",
    ])
      expect(text()).toContain(t);
  });

  test("the rest folds again from the same button, which keeps focus", async () => {
    await show();
    const more = button("and 2 more");
    more.focus();
    await click(more);
    expect(more.isConnected).toBe(true);
    expect(more.textContent).toBe("Show fewer");
    expect(win.document.activeElement).toBe(more as any);
    await click(more);
    expect(more.textContent).toBe("and 2 more");
    expect(more.getAttribute("aria-expanded")).toBe("false");
    expect(controlled(more)?.hasAttribute("hidden")).toBe(true);
    expect(win.document.activeElement).toBe(more as any);
  });

  test("lead quality: the calls are fine, the leads do not book", async () => {
    answer("lead_quality");
    await show();
    expect(text()).toContain("Lead quality");
    expect(text()).toContain("look at who the ads bring");
    expect(text()).toContain("points at targeting");
    expect(text()).not.toContain("Worth fixing");
  });

  test("on track: what still misses is worth fixing, never the verdict", async () => {
    answer("on_track");
    await show();
    expect(text()).toContain("On track");
    expect(text()).toContain("28% of leads booked a confirmed appointment");
    // Like City Wood: 95% touched, 57% with a Maqsam call.
    expect(text()).toContain(
      "Worth fixing: Only 57% of leads older than a working hour have a call on Maqsam (the line is 90%); 41 more have a saved outcome but no call, and 6 leads still wait.",
    );
    const more = button("and 1 more");
    const list = controlled(more);
    expect(list?.textContent).toContain("The first call takes 45 min");
    expect(list?.hasAttribute("hidden")).toBe(true);
    await click(more);
    expect(list?.hasAttribute("hidden")).toBe(false);
  });

  test("not enough leads yet", async () => {
    answer("not_enough");
    await show();
    expect(text()).toContain("Not enough leads yet");
    expect(text()).toContain("Only 12 leads in these dates.");
  });

  test("no call data yet: no tiles and no lead bar, the rows still show", async () => {
    answer("no_data");
    await show();
    expect(text()).toContain("No call data yet");
    expect(text()).not.toContain("Median, in working time");
    expect(text()).not.toContain("Where the leads got to");
    expect(text()).toContain("Villa fit-out | Leads");
  });

  test("the client calls: one quiet line and what our callers still dialled", async () => {
    answer("client_calls");
    await show();
    expect(text()).toContain(
      "The client's own team calls these leads, so there is no call centre view.",
    );
    expect(text()).toContain("Our callers still made 6 verified calls");
    expect(text()).not.toContain("Campaigns and ads");
    expect(text()).not.toContain(NO_CALLER);
  });

  test("done with you by its campaigns: the line shows before the read is in", async () => {
    answer("pending");
    await show({ leadsOnly: true }, "/ads", true);
    expect(text()).toContain("The client's own team calls these leads");
    expect(text()).not.toContain("Reading the dialer");
    expect(text()).not.toContain("checking the dialer");
  });
});

describe("waiting, failing and empty", () => {
  test("loading says what is happening and blocks nothing", async () => {
    answer("pending");
    await show();
    const status = host.querySelector('[role="status"]');
    expect(status?.textContent).toContain("Reading the dialer for these dates");
  });

  test("a refusal reads as its own sentence, and Try again reads again", async () => {
    answer("refused");
    await show();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "This client is not on your cockpit seat. Ask the CEO to add it.",
    );
    expect(text()).toContain("does not mean none were made");
    answer("call_centre");
    await click(button("Try again"));
    expect(
      rpcCalls.filter(c => c.name === "cockpit_client_calls"),
    ).toHaveLength(2);
    expect(text()).toContain("Call centre");
  });

  test("a read the page cannot parse says so", async () => {
    rpcAnswer = async () => ({ data: { version: 2 }, error: null });
    await show();
    expect(text()).toContain("came back in a shape this page cannot read");
  });

  test("no leads in the dates: an empty state with what to do", async () => {
    answer("empty");
    await show();
    expect(text()).toMatch(/No leads came in between \d+ \w+ and \d+ \w+/);
    expect(text()).toContain("Pick a longer range");
  });

  test("no ad account: says so and reads nothing", async () => {
    await show({ accountKey: null });
    expect(text()).toContain("No ad account to look the calls up by");
    expect(
      rpcCalls.filter(c => c.name === "cockpit_client_calls"),
    ).toHaveLength(0);
  });
});

describe("the caller", () => {
  test("the cheap read names the caller at once; the full read wins when it is in", async () => {
    answer("pending");
    await show({}, "/ads", true);
    const line = () => host.querySelector(".page-caller")?.textContent;
    expect(line()).toBe("Caller: Rana Saleh");
    client.resetCallCentreCache();
    rpcAnswer = async (name, args) =>
      name === "cockpit_client_callers"
        ? { data: callersScenario(), error: null }
        : {
            data: {
              ...callCentreScenario("call_centre", args.p_from, args.p_to),
              callers: {
                assigned: [
                  { email: "a@x.test", name: "Dana Yousef" },
                  { email: "b@x.test", name: "Rana Saleh" },
                ],
                otherAccess: [],
                dialled: [],
              },
            },
            error: null,
          };
    await show({}, "/ads", true);
    expect(line()).toBe("Callers: Dana Yousef and Rana Saleh");
  });

  test("no caller in the dialer says so", async () => {
    rpcAnswer = async (name, args) =>
      name === "cockpit_client_callers"
        ? { data: { clients: [] }, error: null }
        : {
            data: {
              ...callCentreScenario("call_centre", args.p_from, args.p_to),
              callers: { assigned: [], otherAccess: [], dialled: [] },
            },
            error: null,
          };
    await show({}, "/ads", true);
    expect(host.querySelector(".page-caller")?.textContent).toBe(NO_CALLER);
  });

  test("while both reads are out, the line says it is checking", async () => {
    rpcAnswer = () => new Promise<Answer>(() => {});
    await show({}, "/ads", true);
    expect(host.querySelector(".page-caller")?.textContent).toBe(
      "Caller: checking the dialer",
    );
  });
});

describe("campaigns and ads", () => {
  test("on a narrow card the rows stack, with their numbers labelled", async () => {
    await show();
    expect(host.querySelector('[data-layout="stacked"]')).not.toBeNull();
    expect(host.querySelector("table")).toBeNull();
    const first = host.querySelector('[data-layout="stacked"] li');
    expect(first?.textContent).toContain("Villa fit-out | Leads");
    for (const label of [
      "Leads",
      "Called",
      "Dials",
      "Per lead",
      "Answered",
      "Booked",
      "First call",
    ])
      expect(first?.textContent).toContain(label);
    expect(text()).toContain(
      "Its leads book more: 35% booked per lead called, against 23% for the client.",
    );
    expect(text()).toContain("Client average");
    expect(text()).toContain("4 leads have no campaign on file");
    // The labels wrap rather than cut ("FIRST CAL..." at 375 px), and the
    // client average is pulled out by its own padding to the rows' width.
    for (const dt of Array.from(host.querySelectorAll("[data-layout] dt")))
      expect(dt.className).not.toContain("truncate");
    const items = host.querySelectorAll('[data-layout="stacked"] > li');
    const average = items[items.length - 1];
    expect(average.textContent).toContain("Client average");
    expect(average.className).toContain("-mx-2");
    expect(average.className).toContain("px-2");
  });

  test("the qualifier is said in words: rates per lead called, dials to these leads", async () => {
    await show();
    expect(text()).toContain(
      "Dials are the calls to these dates' leads; answered and booked are per lead called, provisional included.",
    );
  });

  test("an ad with too few leads says so in words, and its numbers read quieter", async () => {
    await show();
    await click(button("By ad"));
    const row = Array.from(
      host.querySelectorAll('[data-layout="stacked"] > li'),
    ).find(li => li.textContent?.includes("Static | Free site visit"));
    expect(row?.textContent).toContain(
      "6 leads: too few to judge (10 or more).",
    );
    expect(
      row?.querySelector('[title="6 leads: too few to judge (10 or more)."]'),
    ).not.toBeNull();
    for (const dd of Array.from(row?.querySelectorAll("dd") ?? []))
      expect(dd.className).toContain("text-muted-foreground");
    // An ad in line with the client says nothing under its name.
    const even = Array.from(
      host.querySelectorAll('[data-layout="stacked"] > li'),
    ).find(li => li.textContent?.includes("Villa reel | Majlis before"));
    expect(even?.textContent).not.toContain("too few");
    expect(even?.querySelector("dd")?.className).not.toContain(
      "text-muted-foreground",
    );
  });

  test("a split with no rows has no pill; the other split stands in", async () => {
    answerWith("call_centre", raw => {
      raw.byCampaign = [];
    });
    await show();
    expect(buttons("By campaign")).toHaveLength(0);
    expect(button("By ad").getAttribute("aria-pressed")).toBe("true");
    expect(text()).toContain("Villa reel | Majlis before and after");
    expect(text()).toContain("4 leads have no ad on file");
  });

  test("with neither split, no pills and one sentence", async () => {
    answerWith("call_centre", raw => {
      raw.byCampaign = [];
      raw.byAd = [];
    });
    await show();
    expect(host.querySelector('[aria-label="Split the calls by"]')).toBeNull();
    expect(text()).toContain(
      "No lead in these dates carries a campaign or an ad id",
    );
  });

  test("by ad: the first 8, then the other 3, flagged against the client", async () => {
    await show();
    await click(button("By ad"));
    const rows = () =>
      host.querySelectorAll('[data-layout="stacked"] > li').length;
    expect(rows()).toBe(8 + 1); // and the client average
    expect(text()).toContain("Its leads answer less");
    expect(text()).toContain("None of its leads has a verified call yet.");
    await click(button("Show the other 3"));
    expect(rows()).toBe(11 + 1);
    expect(text()).toContain("Carousel | Ceilings");
  });

  test("on a wide card it is a table", async () => {
    const proto = (win as any).HTMLElement.prototype;
    Object.defineProperty(proto, "clientWidth", {
      configurable: true,
      get: () => 1200,
    });
    try {
      await show();
      const table = host.querySelector('table[data-layout="table"]');
      expect(table).not.toBeNull();
      const heads = Array.from(table?.querySelectorAll("th") ?? []).map(
        th => th.textContent,
      );
      expect(heads).toEqual([
        "Campaign",
        "Leads",
        "Called",
        "Dials",
        "Per lead",
        "Answered",
        "Booked",
        "First call",
      ]);
      expect(table?.querySelector("tfoot")?.textContent).toContain(
        "Client average",
      );
    } finally {
      delete proto.clientWidth;
    }
  });
});

describe("the lead bar, the waiting and the sources", () => {
  test("the leads nobody called are the gap, with the reasons", async () => {
    await show();
    expect(text()).toContain("Where the leads got to");
    expect(text()).toContain("Not called yet: 32");
    expect(text()).toContain("23 were never dialled");
    expect(text()).toContain("2 outside the dialer's countries");
    const bar = host.querySelector('[role="img"][aria-label^="128 leads"]');
    expect(bar?.getAttribute("aria-label")).toContain("32 not called yet");
  });

  const waiting = () =>
    Array.from(host.querySelectorAll("details")).find(d =>
      d.querySelector("summary")?.textContent?.startsWith("Waiting now"),
    );
  const headline = () => waiting()?.querySelector("summary")?.textContent;

  /** The first line under Waiting now, and what its dot says. */
  const firstLine = () => {
    const li = waiting()?.querySelector("li");
    return {
      text: li?.textContent ?? "",
      dot: li?.querySelector('[role="img"]')?.getAttribute("aria-label"),
    };
  };

  test("waiting is open when something waits, and the headline names it all", async () => {
    await show();
    expect(waiting()?.hasAttribute("open")).toBe(true);
    expect(waiting()?.textContent).toContain(
      "6 leads have no call or saved outcome after a working hour",
    );
    expect(firstLine().text).toContain(
      "74 of 110 callable leads have a call on Maqsam (67%, the line is 90%).",
    );
    expect(firstLine().text).toContain(
      "18 more have a saved outcome but no Maqsam call, so they do not count.",
    );
    expect(firstLine().dot).toBe("Waiting too long");
    expect(headline()).toBe(
      "Waiting now 6 untouched after a working hour · 4 callbacks waiting, 2 overdue · 2 missed calls not returned · 10 stuck over a week",
    );
  });

  test("callbacks not yet due and leads stuck over a week still open it", async () => {
    answer("lead_quality");
    await show();
    expect(waiting()?.hasAttribute("open")).toBe(true);
    expect(headline()).toBe(
      "Waiting now 4 callbacks waiting, none overdue · 10 stuck over a week",
    );
    expect(waiting()?.textContent).toContain(
      "4 callbacks waiting: 0 overdue, 2 untouched for over 3 days.",
    );
    expect(headline()).not.toContain("nothing");
  });

  test("the 90% line is a Maqsam call: the first line warns under it, though nobody waits", async () => {
    answerWith("lead_quality", raw => {
      raw.waiting.called = 60;
      raw.waiting.outcomeOnly = 50;
    });
    await show();
    // Nobody waits, but a saved outcome is not contact: the line says what
    // the waiting list counts, never that every lead was called.
    expect(firstLine().text).toContain(
      "Every lead older than a working hour has a Maqsam call or a saved outcome (110 of 110).",
    );
    expect(firstLine().text).not.toContain("called or messaged");
    expect(firstLine().text).toContain(
      "60 of 110 callable leads have a call on Maqsam (55%, the line is 90%).",
    );
    expect(firstLine().text).toContain(
      "50 more have a saved outcome but no Maqsam call, so they do not count.",
    );
    expect(firstLine().dot).toBe("Under the 90% line");
    // The fold stays as quiet as before: a headline, no new line in it.
    expect(headline()).toBe(
      "Waiting now 4 callbacks waiting, none overdue · 10 stuck over a week",
    );
  });

  test("over the line the first line is on time; one outcome-only lead is said once", async () => {
    answer("lead_quality");
    await show();
    expect(firstLine().text).toContain(
      "Every lead older than a working hour has a Maqsam call or a saved outcome (110 of 110).",
    );
    expect(firstLine().text).toContain(
      "106 of 110 callable leads have a call on Maqsam (96%, the line is 90%).",
    );
    expect(firstLine().text).toContain(
      "4 more have a saved outcome but no Maqsam call, so they do not count.",
    );
    expect(firstLine().dot).toBe("On time");
    client.resetCallCentreCache();
    answerWith("lead_quality", raw => {
      raw.waiting.called = 109;
      raw.waiting.outcomeOnly = 1;
    });
    await show();
    expect(firstLine().text).toContain(
      "1 more has a saved outcome but no Maqsam call, so it does not count.",
    );
    client.resetCallCentreCache();
    answerWith("lead_quality", raw => {
      raw.waiting.called = 110;
      raw.waiting.outcomeOnly = 0;
    });
    await show();
    expect(firstLine().text).toContain(
      "Every lead older than a working hour has a call on Maqsam (110 of 110).",
    );
    expect(firstLine().text).toContain("110 of 110 callable leads");
    expect(firstLine().text).not.toContain("saved outcome");
  });

  test("a read without the called count says nothing new, and nothing callable says no line", async () => {
    answerWith("lead_quality", raw => {
      delete raw.waiting.called;
      delete raw.waiting.outcomeOnly;
    });
    await show();
    expect(firstLine().text).toBe(
      "Every lead older than a working hour was called or messaged (110 of 110).",
    );
    expect(firstLine().dot).toBe("On time");
    client.resetCallCentreCache();
    answerWith("lead_quality", raw => {
      Object.assign(raw.waiting, {
        callable: 0,
        touched: 0,
        called: 0,
        outcomeOnly: 0,
      });
    });
    await show();
    expect(firstLine().text).toBe(
      "No lead in these dates is old enough to be waiting.",
    );
  });

  test("folded when nothing waits: nothing overdue, or nothing at all", async () => {
    answerWith("lead_quality", raw => {
      raw.waiting.callbacks = {
        ...raw.waiting.callbacks,
        count: 0,
        overThreeDays: 0,
        overdue: 0,
      };
      for (const st of raw.waiting.stages) st.overSevenDays = 0;
    });
    await show();
    expect(waiting()?.hasAttribute("open")).toBe(false);
    expect(headline()).toBe("Waiting now nothing overdue");
    client.resetCallCentreCache();
    answerWith("lead_quality", raw => {
      raw.waiting.callbacks = {
        ...raw.waiting.callbacks,
        count: 0,
        overThreeDays: 0,
        overdue: 0,
      };
      raw.waiting.stages = [];
    });
    await show();
    expect(waiting()?.hasAttribute("open")).toBe(false);
    expect(headline()).toBe("Waiting now nothing is waiting");
  });

  test("the footnote names the sources, the gaps and the freshness", async () => {
    await show();
    const notes = Array.from(host.querySelectorAll("details")).find(d =>
      d.textContent?.startsWith("Where these numbers come from"),
    );
    expect(notes?.hasAttribute("open")).toBe(false);
    expect(notes?.textContent).toContain("Newest call for this client");
    expect(notes?.textContent).toContain("4 leads have no ad id (1 from Meta)");
    expect(notes?.textContent).toContain("Dials are verified Maqsam calls.");
    expect(notes?.textContent).toContain("Rana Saleh 301, Dana Yousef 111");
  });
});

describe("why leads were lost, and their calls", () => {
  test("reasons largest first, then the latest five", async () => {
    await show();
    const chips = Array.from(
      host.querySelectorAll('[aria-label="Lost reasons"] li'),
    ).map(li => li.textContent);
    expect(chips[0]).toBe("Not a fit, no project or budget9");
    expect(chips).toContain("Could not be reached7");
    const latest = () =>
      host.querySelectorAll('[aria-label="Latest lost leads"] > li').length;
    expect(latest()).toBe(5);
    expect(text()).toContain("Has no project yet, only bought the land.");
    expect(text()).toContain("No answered call to play");
    await click(button("Show the other 3"));
    expect(latest()).toBe(8);
  });

  test("Play fetches that one call, plays it inline, and Close lets it go", async () => {
    await show();
    expect(recordings).toHaveLength(0); // nothing is fetched before Play
    await click(button("Play the longest call with Noura"));
    expect(recordings).toEqual([
      { url: ROUTE, auth: "Bearer test-token", callId: "88120031" },
    ]);
    const audio = host.querySelectorAll("audio");
    expect(audio).toHaveLength(1);
    expect(audio[0].getAttribute("src")).toBe("blob:test/1");
    await click(button("Close the call with Noura"));
    expect(host.querySelectorAll("audio")).toHaveLength(0);
    expect(revoked).toEqual(["blob:test/1"]);
  });

  test("one player at a time: a second Play releases the first", async () => {
    await show();
    await click(button("Play the longest call with Noura"));
    await click(button("Play the longest call with Mariam"));
    const audio = host.querySelectorAll("audio");
    expect(audio).toHaveLength(1);
    expect(audio[0].getAttribute("src")).toBe("blob:test/2");
    expect(revoked).toEqual(["blob:test/1"]);
    expect(buttons("Close the call with Noura")).toHaveLength(0);
  });

  test("a recording that cannot play says why, and Play stays", async () => {
    recordingAnswer = async () =>
      new Response(JSON.stringify({}), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    await show();
    await click(button("Play the longest call with Mariam"));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "Maqsam has no recording of this call",
    );
    expect(host.querySelectorAll("audio")).toHaveLength(0);
    expect(buttons("Play the longest call with Mariam")).toHaveLength(1);
  });

  test("leaving the page lets the playing call go", async () => {
    await show();
    await click(button("Play the longest call with Yousef"));
    expect(made).toEqual(["blob:test/1"]);
    await act(async () => root.render(null));
    expect(revoked).toEqual(["blob:test/1"]);
  });

  test("a call that comes back after Close is never played", async () => {
    let finish: (v: Response) => void = () => {};
    recordingAnswer = () => new Promise(r => (finish = r));
    await show();
    await click(button("Play the longest call with Noura"));
    expect(text()).toContain("Fetching the recording from Maqsam");
    await click(button("Close the call with Noura"));
    await act(async () => finish(audio()));
    await flush();
    expect(made).toHaveLength(0);
    expect(host.querySelectorAll("audio")).toHaveLength(0);
  });
});

describe("the #calls link", () => {
  test("opened at #calls, the section is brought into view", async () => {
    const proto = (win as any).Element.prototype;
    const seen: string[] = [];
    const real = proto.scrollIntoView;
    proto.scrollIntoView = function (this: Element) {
      seen.push(this.id);
    };
    try {
      await show({}, "/ads?account=Harbor#calls");
      await act(async () => {
        await new Promise(r => setTimeout(r, 50));
      });
      expect(seen).toContain("calls");
      seen.length = 0;
      await show({}, "/ads?account=Harbor");
      await act(async () => {
        await new Promise(r => setTimeout(r, 50));
      });
      expect(seen).toHaveLength(0);
    } finally {
      proto.scrollIntoView = real;
    }
  });

  test("the board links there and reads nothing for it", () => {
    const page = readFileSync(
      join(here, "../src/pages/CockpitPage.tsx"),
      "utf8",
    );
    expect(page).toContain("Calls for this client");
    expect(page).toContain('hash: "#calls"');
    expect(page).not.toContain("cockpit_client_calls");
    expect(page).not.toMatch(/import[^;]*CallCentreSection/);
    expect(page).not.toMatch(/import[^;]*callCentreClient/);
    const view = readFileSync(
      join(here, "../src/components/AccountView.tsx"),
      "utf8",
    );
    expect(view).toContain('{ id: "calls", label: "Calls" }');
    // One lost breakdown: the pipeline and its pill step aside for Calls.
    expect(view).toContain("useCallsHoldLost(callsKey, range, leadsOnly)");
    expect(view).toContain("lost?.total && !callsHoldLost");
    expect(view).toMatch(/callsHoldLost \? null : \(\s*<div id="account-lost"/);
  });
});
