/**
 * The Calls part of the client page's Results tab
 * (src/components/CallCentreSection.tsx), its reads
 * (src/lib/callCentreClient.ts) and the caller on the client list and the
 * client page header. Every answer is invented (src/dev/callCentreFixture.ts).
 *
 * Run: bun test scripts/call-centre-section.test.tsx
 */
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";

const win = new Window({ url: "https://localhost/" });
const globals = globalThis as unknown as Record<string, unknown>;
for (const k of [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "HTMLDetailsElement",
  "Element",
  "Node",
  "Event",
  "MouseEvent",
  "DocumentFragment",
  "Text",
  "MutationObserver",
])
  globals[k] =
    k === "window" ? win : (win as unknown as Record<string, unknown>)[k];
globals.getComputedStyle = win.getComputedStyle.bind(win);
globals.IS_REACT_ACT_ENVIRONMENT = true;
process.env.VITE_SUPABASE_URL = "https://db.example.test";

// The recording, as the shared helper would hand it back.
const played: { url: string; token: string; callId: string }[] = [];
let recording: (callId: string) => Promise<unknown> = async () => ({
  ok: true,
  blob: new Blob(["sound"], { type: "audio/mpeg" }),
});
mock.module("@/lib/callRecording", () => ({
  fetchCallRecording: (url: string, token: string, callId: string) => {
    played.push({ url, token, callId });
    return recording(callId);
  },
}));

// The database, one answer per function.
type Answer = { data?: unknown; error?: unknown } | Promise<never>;
const rpcCalls: { name: string; args: unknown }[] = [];
let answers: Record<string, () => Answer> = {};
const db = {
  rpc(name: string, args?: unknown) {
    rpcCalls.push({ name, args });
    const answer = answers[name];
    if (!answer) return Promise.reject(new Error(`Unexpected RPC ${name}`));
    return Promise.resolve(answer());
  },
  auth: {
    getSession: async () => ({
      data: { session: { access_token: "seat-token", user: { id: "seat-1" } } },
      error: null,
    }),
  },
};
mock.module("@/auth/SupabaseAuthProvider", () => ({
  useCockpitAuth: () => ({
    client: db,
    session: { user: { id: "seat-1" } },
    ready: true,
  }),
}));

const made: string[] = [];
const revoked: string[] = [];
URL.createObjectURL = () => {
  const url = `blob:test-${made.length + 1}`;
  made.push(url);
  return url;
};
URL.revokeObjectURL = (url: string) => {
  revoked.push(url);
};

const { createRoot } = await import("react-dom/client");
const { act } = await import("react");
const { MemoryRouter } = await import("react-router");
const {
  CallCentreSection,
  ClientCallerChip,
  ClientCallerLine,
  callPath,
  hasLost,
  kuwaitDayLabel,
  kuwaitStamp,
  showsLost,
  somethingWaits,
  stageDays,
  TABLE_SHOWN,
  tableRow,
} = await import("../src/components/CallCentreSection");
const {
  callerNames,
  callersByTask,
  callRange,
  callReadProblem,
  forgetCallReads,
  rangeLabel,
  reportDidNotAnswer,
  rowRates,
} = await import("../src/lib/callCentreClient");
const { parseCallCentre, NO_CALLER } = await import("../src/lib/callCentre");
const { callCentreFixture, callersFixture } = await import(
  "../src/dev/callCentreFixture"
);

const host = win.document.createElement("div");
win.document.body.append(host);
const root = createRoot(host as unknown as HTMLElement);
afterAll(async () => {
  await act(async () => root.unmount());
  await win.happyDOM.close();
});

const flush = () =>
  act(async () => {
    for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0));
  });

async function show(
  kind: Parameters<typeof callCentreFixture>[0] | null,
  props: {
    taskId?: string;
    from?: string;
    to?: string;
    lostElsewhereHref?: string;
    onLostShown?: (shown: boolean) => void;
  } = {},
) {
  if (kind)
    answers.cockpit_client_calls = () => ({ data: callCentreFixture(kind) });
  await act(async () => {
    root.render(
      <MemoryRouter>
        <CallCentreSection
          key={`${kind}-${JSON.stringify(props)}-${Math.random()}`}
          taskId={"taskId" in props ? props.taskId : "task-fictional"}
          from={props.from ?? "2026-09-14"}
          to={props.to ?? "2026-10-13"}
          lostElsewhereHref={props.lostElsewhereHref}
          onLostShown={props.onLostShown}
        />
      </MemoryRouter>,
    );
  });
  await flush();
}

const text = () => host.textContent ?? "";
const buttons = (label: string) =>
  Array.from(host.querySelectorAll("button")).filter(
    b =>
      b.textContent?.includes(label) ||
      b.getAttribute("aria-label")?.includes(label),
  );
const click = async (el: Element | undefined) => {
  if (!el) throw new Error("Nothing to click");
  await act(async () => {
    (el as unknown as HTMLElement).click();
  });
  await flush();
};

beforeEach(() => {
  forgetCallReads();
  rpcCalls.length = 0;
  played.length = 0;
  answers = {};
  recording = async () => ({
    ok: true,
    blob: new Blob(["sound"], { type: "audio/mpeg" }),
  });
});

describe("the verdict, one per kind", () => {
  test("call centre: the chip, its sentence, the caller and the other reasons", async () => {
    await show("call_centre");
    const chip = host.querySelector("#results-calls")?.textContent ?? "";
    expect(chip).toContain("Call centre");
    expect(text()).toContain(
      "Only 70% of leads older than a working hour have a call on Maqsam (the line is 90%); 18 more have a saved outcome but no call, and 12 leads still wait.",
    );
    expect(text()).toContain("Caller: Noor Saleh");
    expect(text()).toContain("and 3 more reasons");
    expect(text()).not.toContain("Worth fixing");
    await click(buttons("and 3 more reasons")[0]);
    expect(text()).toContain(
      "The first call takes 3 h 12 min of working time at the median (the line is 30 min).",
    );
    // The read asked for the client by its ClickUp id and the page's dates.
    expect(rpcCalls).toEqual([
      {
        name: "cockpit_client_calls",
        args: {
          p_key: "task-fictional",
          p_from: "2026-09-14",
          p_to: "2026-10-13",
        },
      },
    ]);
  });

  test("lead quality: calls are fine, booking is not, targeting named", async () => {
    await show("lead_quality");
    expect(text()).toContain("Lead quality");
    expect(text()).toContain("look at who the ads bring.");
    await click(buttons("and 1 more reason")[0]);
    expect(text()).toContain("were too far, short of money or not a fit");
  });

  test("on track: the booking sentence, and one Worth fixing line that opens the rest", async () => {
    await show("on_track");
    expect(text()).toContain("On track");
    expect(text()).toContain(
      "28% of leads booked a confirmed appointment (the line is 25%).",
    );
    // Like City Wood: 95% touched, 57% with a Maqsam call.
    expect(text()).toContain(
      "Worth fixing: Only 57% of leads older than a working hour have a call on Maqsam (the line is 90%); 38 more have a saved outcome but no call, and 5 leads still wait.",
    );
    expect(text()).toContain("and 3 more");
    expect(text()).not.toContain("The first call takes 3 h 12 min");
    await click(buttons("and 3 more")[0]);
    expect(text()).toContain("The first call takes 3 h 12 min");
  });

  test("not enough leads: the verdict waits, the numbers still show", async () => {
    await show("not_enough");
    expect(text()).toContain("Not enough leads yet");
    expect(text()).toContain(
      "Only 12 leads in these dates. The verdict needs 20 or more.",
    );
    expect(text()).toContain("First call");
    expect(text()).toContain("Where the leads went");
  });

  test("no call data: says so, says what to do, shows no tiles", async () => {
    await show("no_data");
    expect(text()).toContain("No call data yet");
    expect(text()).toContain(
      "The dialer's report has no numbers for this client",
    );
    expect(text()).toContain("switched off in the dialer");
    expect(text()).toContain(NO_CALLER);
    expect(text()).not.toContain("First call");
    // Switched off is the CEO's to fix: no pointless retry.
    expect(buttons("Try again")).toHaveLength(0);
    // The dialer's lost outcomes stand apart from its report: still shown.
    expect(text()).toContain("Why leads were lost");
    expect(text()).toContain("Not a fit, no project or budget");
  });

  test("no call data and nobody lost: no lost part at all", async () => {
    const raw = callCentreFixture("no_data");
    raw.lost = {
      total: 0,
      reasons: [],
      otherNotes: { total: 0, sorted: 0 },
      unreachable: { leads: 0, calls: 0, noCall: 0, fourPlus: 0, connected: 0 },
      latest: [],
    };
    answers.cockpit_client_calls = () => ({ data: raw });
    await show(null);
    expect(text()).toContain("No call data yet");
    expect(text()).not.toContain("Why leads were lost");
  });

  test("the report did not answer: says so, offers Try again, keeps the lost reasons, and is not kept", async () => {
    await show("report_failed");
    expect(text()).toContain("No call data yet");
    expect(text()).toContain(
      "The dialer's report did not answer for these dates, so its numbers are missing. Try again in a minute.",
    );
    expect(text()).not.toContain("once leads arrive");
    expect(text()).toContain("Why leads were lost");
    answers.cockpit_client_calls = () => ({
      data: callCentreFixture("call_centre"),
    });
    await click(buttons("Try again")[0]);
    expect(
      rpcCalls.filter(c => c.name === "cockpit_client_calls"),
    ).toHaveLength(2);
    expect(text()).toContain("Caller: Noor Saleh");
    expect(text()).toContain("First call");
  });

  test("an answer without the headline is read again on the next open", async () => {
    await show("report_failed");
    await show("report_failed");
    expect(
      rpcCalls.filter(c => c.name === "cockpit_client_calls"),
    ).toHaveLength(2);
  });

  test("no row in the report while leads came in: says so and offers Try again", async () => {
    const raw = callCentreFixture("no_data");
    raw.client.dialerActive = true;
    answers.cockpit_client_calls = () => ({ data: raw });
    await show(null);
    expect(text()).toContain(
      "The dialer's report has no row for this client in these dates, though 120 leads came in. Try again in a few minutes; if it stays, tell the CEO.",
    );
    expect(buttons("Try again")).toHaveLength(1);
  });

  test("done with you: one quiet line, with the dials our callers still made", async () => {
    await show("client_calls");
    expect(text()).toContain(
      "The client's own team calls these leads, so there is no call centre view.",
    );
    expect(text()).toContain(
      "Our callers still dialled 12 times in these dates: Noor Saleh 12.",
    );
    expect(text()).not.toContain("Leads only");
    expect(text()).not.toContain("First call");
    expect(host.querySelectorAll("button")).toHaveLength(0);
  });
});

describe("the read's states", () => {
  test("loading says what is happening and never blocks", async () => {
    answers.cockpit_client_calls = () => new Promise<never>(() => {});
    await show(null);
    expect(text()).toContain("Reading the dialer for 14 Sep to 13 Oct.");
    expect(host.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(host.querySelector('[role="status"]')).not.toBeNull();
  });

  test("a refusal shows the database's own sentence, and Try again reads anew", async () => {
    answers.cockpit_client_calls = () => ({
      error: {
        code: "42501",
        message:
          "This client is not on your cockpit seat. Ask the CEO to add it.",
      },
    });
    await show(null);
    const alert = host.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain(
      "This client is not on your cockpit seat. Ask the CEO to add it.",
    );
    answers.cockpit_client_calls = () => ({
      data: callCentreFixture("call_centre"),
    });
    await click(buttons("Try again")[0]);
    expect(
      rpcCalls.filter(c => c.name === "cockpit_client_calls"),
    ).toHaveLength(2);
    expect(text()).toContain("Call centre");
  });

  test("a client with no ClickUp card is told, without a pointless retry", async () => {
    await show(null, { taskId: undefined });
    expect(text()).toContain("This client has no ClickUp card yet");
    expect(buttons("Try again")).toHaveLength(0);
    expect(rpcCalls).toHaveLength(0);
  });

  test("a read in a shape the page cannot read fails in words, never as zeros", async () => {
    const broken = callCentreFixture("call_centre");
    delete broken.cohort.dials;
    answers.cockpit_client_calls = () => ({ data: broken });
    await show(null);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "came back in a shape this page cannot read",
    );
  });

  test("the same client and dates read once a session", async () => {
    await show("call_centre");
    await show("call_centre");
    expect(
      rpcCalls.filter(c => c.name === "cockpit_client_calls"),
    ).toHaveLength(1);
  });

  test("empty parts say so: no ad ids, nothing lost", async () => {
    await show("not_enough");
    await click(buttons("By ad")[0]);
    expect(text()).toContain("No lead in these dates carries an ad id");
    expect(text()).toContain(
      "No lead was marked lost in the dialer in these dates.",
    );
  });

  test("a period over 93 days reads its last 93 and says so", async () => {
    await show("call_centre", { from: "2026-05-01", to: "2026-10-13" });
    expect(rpcCalls[0].args).toEqual({
      p_key: "task-fictional",
      p_from: "2026-07-13",
      p_to: "2026-10-13",
    });
    expect(text()).toContain(
      "The call read covers 93 days at most, so it starts on 13 Jul.",
    );
  });
});

describe("lost reasons show once on the page", () => {
  const told = async (
    kind: Parameters<typeof callCentreFixture>[0] | null,
    props: { taskId?: string } = {},
  ) => {
    const said: boolean[] = [];
    forgetCallReads();
    await show(kind, { ...props, onLostShown: v => said.push(v) });
    return said;
  };

  test("the page hears true only once the dialer's lost reasons are on screen", async () => {
    expect((await told("call_centre")).at(-1)).toBe(true);
    expect(text()).toContain("Why leads were lost");
    // Nobody lost in the dialer: the page keeps its own list.
    expect((await told("not_enough")).at(-1)).toBe(false);
    // The report failed, the outcomes are there: shown, so true.
    expect((await told("report_failed")).at(-1)).toBe(true);
    // Done with you: one quiet line, no lost reasons.
    expect((await told("client_calls")).at(-1)).toBe(false);
  });

  test("loading, an error and no card keep the page's list", async () => {
    answers.cockpit_client_calls = () => new Promise<never>(() => {});
    expect(await told(null)).toEqual([false]);
    forgetCallReads();
    answers.cockpit_client_calls = () => ({
      error: { code: "57014", message: "statement timeout" },
    });
    expect((await told(null)).at(-1)).toBe(false);
    expect(await told(null, { taskId: undefined })).toEqual([false]);
  });

  test("the link to the GoHighLevel list shows only beside the dialer's reasons", async () => {
    const raw = callCentreFixture("call_centre");
    raw.lost = {
      total: 0,
      reasons: [],
      otherNotes: { total: 0, sorted: 0 },
      unreachable: { leads: 0, calls: 0, noCall: 0, fourPlus: 0, connected: 0 },
      latest: [],
    };
    answers.cockpit_client_calls = () => ({ data: raw });
    await show(null, { lostElsewhereHref: "/clients/task-fictional?tab=ads" });
    expect(text()).toContain(
      "No lead was marked lost in the dialer in these dates.",
    );
    expect(text()).not.toContain("Leads marked lost in GoHighLevel");
  });
});

describe("the first screen", () => {
  test("four tiles, each naming its line; the gap of leads not called", async () => {
    await show("call_centre");
    for (const t of [
      "First call",
      "3 h 12 min",
      "3% within 5 min",
      "Median working time, line 30 min",
      "Dials",
      "412",
      "3.4 per lead",
      "No answer: 1.4 in 3 days, line 3",
      "Answered",
      "53%",
      "Of dials, line 35%",
      "73% of leads called",
      "Talked 2 min+: 17%, line 25%",
      "Booked",
      "18%",
      "22 confirmed of 120 leads, line 25%",
      "4 provisional, not counted",
    ])
      expect(text()).toContain(t);
    expect(text()).toContain("24 not called yet");
    const bar = host.querySelector('[role="img"][aria-label^="Leads 120"]');
    expect(bar?.getAttribute("aria-label")).toBe(
      "Leads 120, Called 96, Answered 70, Talked 2 min+ 40, Booked 22, Showed 12. 24 not called yet.",
    );
    expect(bar?.querySelector("[data-gap]")).not.toBeNull();
  });

  test("waiting opens when someone waits, and the sources stay folded", async () => {
    await show("call_centre");
    expect(text()).toContain("12 leads with no call or message yet");
    expect(text()).toContain(
      "The oldest has waited 1 d 2 h of working time, since 9 Oct.",
    );
    expect(text()).toContain(
      "70 of 100 callable leads have a call on Maqsam (70%, the line is 90%).",
    );
    expect(text()).toContain(
      "18 more have a saved outcome but no Maqsam call, so they do not count.",
    );
    expect(text()).not.toContain("reached out to");
    expect(text()).toContain(
      "Day 1 AM - Follow Up: 14 leads, median 3 d, oldest 13 d, 4 over a week",
    );
    expect(text()).toContain("Where these numbers come from");
    expect(text()).not.toContain("Dialled in these dates");
  });

  test("waiting days are Kuwait days, not the timestamp's UTC day", async () => {
    const raw = callCentreFixture("call_centre");
    raw.waiting.untouched.oldestAt = "2026-10-08T22:30:00Z";
    raw.waiting.missedInbound.oldestNeverAt = "2026-10-06T21:15:00Z";
    answers.cockpit_client_calls = () => ({ data: raw });
    await show(null);
    expect(text()).toContain("of working time, since 9 Oct.");
    expect(text()).toContain("3 never called back, the oldest since 7 Oct.");
  });

  /** The first row under Waiting now and its dot, the fold opened first. */
  const firstWaitRow = async () => {
    const fold = () =>
      Array.from(host.querySelectorAll("details")).find(d =>
        d.textContent?.includes("Waiting now"),
      );
    if (!fold()?.hasAttribute("open")) {
      await act(async () => {
        const d = fold() as unknown as HTMLDetailsElement;
        d.open = true;
        d.dispatchEvent(new win.Event("toggle") as unknown as Event);
      });
      await flush();
    }
    const li = fold()?.querySelector("li");
    return {
      text: li?.textContent ?? "",
      dot: li?.querySelector("span > span")?.className ?? "",
    };
  };

  test("the 90% line is a Maqsam call: the row warns under it, though nobody waits", async () => {
    // Every lead was touched, but only 60 of 100 have a Maqsam call.
    const raw = callCentreFixture("lead_quality");
    raw.waiting.called = 60;
    raw.waiting.outcomeOnly = 39;
    answers.cockpit_client_calls = () => ({ data: raw });
    await show(null);
    const row = await firstWaitRow();
    expect(row.text).toContain(
      "Every lead older than a working hour was called or messaged",
    );
    expect(row.text).toContain(
      "60 of 100 callable leads have a call on Maqsam (60%, the line is 90%).",
    );
    expect(row.text).toContain(
      "39 more have a saved outcome but no Maqsam call, so they do not count.",
    );
    expect(row.dot).toContain("bg-warning");
  });

  test("over the line with nobody waiting the row is good, and one outcome-only lead is said once", async () => {
    await show("lead_quality");
    const row = await firstWaitRow();
    expect(row.text).toContain(
      "96 of 100 callable leads have a call on Maqsam (96%, the line is 90%).",
    );
    expect(row.text).toContain(
      "3 more have a saved outcome but no Maqsam call, so they do not count.",
    );
    expect(row.dot).toContain("bg-success");
    const raw = callCentreFixture("lead_quality");
    raw.waiting.called = 98;
    raw.waiting.outcomeOnly = 1;
    answers.cockpit_client_calls = () => ({ data: raw });
    forgetCallReads();
    await show(null);
    expect((await firstWaitRow()).text).toContain(
      "1 more has a saved outcome but no Maqsam call, so it does not count.",
    );
    raw.waiting.called = 99;
    raw.waiting.outcomeOnly = 0;
    forgetCallReads();
    await show(null);
    const last = await firstWaitRow();
    expect(last.text).toContain("99 of 100 callable leads");
    expect(last.text).not.toContain("saved outcome");
  });

  test("a read without the called count keeps the touched line", async () => {
    const raw = callCentreFixture("lead_quality");
    delete raw.waiting.called;
    delete raw.waiting.outcomeOnly;
    answers.cockpit_client_calls = () => ({ data: raw });
    await show(null);
    const row = await firstWaitRow();
    expect(row.text).toContain(
      "99 of 100 callable leads reached out to (99%, the line is 90%).",
    );
    expect(row.text).not.toContain("Maqsam");
    expect(row.dot).toContain("bg-success");
  });

  test("nothing waits: the fold stays shut and says so", async () => {
    await show("lead_quality");
    expect(text()).toContain("Waiting now");
    expect(text()).not.toContain("with no call or message yet");
    const waiting = Array.from(host.querySelectorAll("details")).find(d =>
      d.textContent?.includes("Waiting now"),
    );
    expect(waiting?.hasAttribute("open")).toBe(false);
  });
});

describe("by campaign and by ad", () => {
  test("campaigns by default, flagged against the client; ads on a tap, top 8 then the rest", async () => {
    await show("call_centre");
    expect(text()).toContain("By campaign");
    expect(text()).toContain("Villas | Leads | Kuwait");
    expect(text()).toContain(
      "Its leads book less: 8% booked per lead called, against 25% for the client.",
    );
    expect(text()).toContain("Client average, every lead");
    await click(buttons("By ad")[0]);
    const rows = host.querySelectorAll("li[data-row^='ad:']");
    expect(rows).toHaveLength(TABLE_SHOWN);
    expect(text()).toContain("Show the other 2");
    await click(buttons("Show the other 2")[0]);
    expect(host.querySelectorAll("li[data-row^='ad:']")).toHaveLength(10);
    expect(text()).toContain("Ad ad-10");
  });

  test("on a narrow screen a row is a line of words; the columns come at a wide card", async () => {
    await show("call_centre");
    const row = host.querySelector("li[data-row='campaign:c-villas']");
    const stacked = row?.querySelector("[data-stacked]");
    // Wide, the line of words stays for a screen reader: it names each number.
    expect(stacked?.className).toContain("@3xl:sr-only");
    expect(stacked?.className).not.toContain("@3xl:hidden");
    expect(stacked?.textContent).toBe(
      "52 leads · 88% called · 190 dials (3.7 a lead) · 78% answered · 26% booked · first call 2 h 33 min",
    );
    const cells = Array.from(row?.querySelectorAll("span.text-right") ?? []);
    expect(cells).toHaveLength(7);
    for (const c of cells) expect(c.className).toContain("hidden");
    for (const c of cells) expect(c.className).toContain("@3xl:block");
    for (const c of cells) expect(c.getAttribute("aria-hidden")).toBe("true");
    const header = Array.from(host.querySelectorAll("[aria-hidden]")).find(h =>
      h.textContent?.startsWith("CampaignLeads"),
    );
    expect(header?.className).toContain("hidden");
    expect(header?.className).toContain("@3xl:grid");
  });

  test("a number not measured is a dash that says so, and the line of words says it in full", async () => {
    const raw = callCentreFixture("call_centre");
    Object.assign(raw.byCampaign[4], {
      called: 0,
      dials: 0,
      reached: 0,
      talked30: 0,
      talked120: 0,
      booked: 0,
      confirmed: 0,
      medianFirstCallSeconds: null,
    });
    answers.cockpit_client_calls = () => ({ data: raw });
    await show(null);
    const row = host.querySelector("li[data-row='campaign:c-old']");
    const dashes = Array.from(row?.querySelectorAll("span.text-right") ?? [])
      .filter(c => c.textContent === "-")
      .map(c => c.getAttribute("title"));
    expect(dashes).toEqual(["Not measured", "Not measured", "Not measured"]);
    expect(row?.querySelector("[data-stacked]")?.textContent).toBe(
      "6 leads · 0% called · 0 dials (0.0 a lead) · answered not measured · booked not measured · first call not measured",
    );
    expect(text()).toContain("A dash is not measured.");
  });
});

describe("why leads were lost, and playing a call", () => {
  test("reason chips largest first, the first 5 lost leads, then the rest", async () => {
    await show("call_centre", {
      lostElsewhereHref: "/clients/task-fictional?tab=ads",
    });
    const chips = Array.from(
      host.querySelectorAll('[aria-label="Lost reasons"] li'),
    ).map(li => li.textContent);
    expect(chips[0]).toBe("Not a fit, no project or budget9");
    expect(chips[1]).toBe("Could not be reached7");
    expect(text()).toContain("عنده أرض بس ما عنده ميزانية للمشروع الحين");
    expect(text()).toContain(
      "3 verified calls, longest 4 min 5 s · Noor Saleh",
    );
    expect(text()).toContain(
      "7 leads marked could not be reached got 1.3 verified calls each",
    );
    expect(text()).not.toContain("Agreed with another company");
    await click(buttons("Show the other 3")[0]);
    expect(text()).toContain("Agreed with another company last week.");
    const link = host.querySelector(
      'a[href="/clients/task-fictional?tab=ads"]',
    );
    expect(link?.textContent).toContain("Leads marked lost in GoHighLevel");
  });

  test("Play fetches only that call, plays it inline, one player at a time, and frees the audio", async () => {
    await show("call_centre");
    expect(played).toHaveLength(0);
    expect(host.querySelector("audio")).toBeNull();
    const before = { made: made.length, revoked: revoked.length };
    await click(buttons("Play the longest call with Faisal")[0]);
    expect(played).toEqual([
      { url: "https://db.example.test", token: "seat-token", callId: "90000" },
    ]);
    const audio = host.querySelectorAll("audio");
    expect(audio).toHaveLength(1);
    const first = made[made.length - 1];
    expect(audio[0].getAttribute("src")).toBe(first);
    expect(made.length).toBe(before.made + 1);
    // A second call closes the first: one player, the first audio freed.
    await click(buttons("Play the longest call with Abdullah")[0]);
    expect(host.querySelectorAll("audio")).toHaveLength(1);
    expect(revoked).toContain(first);
    expect(played.map(p => p.callId)).toEqual(["90000", "90002"]);
    const second = made[made.length - 1];
    await click(buttons("Close the player")[0]);
    expect(host.querySelector("audio")).toBeNull();
    expect(revoked).toContain(second);
    // Leaving the page frees a player left open.
    await click(buttons("Play the longest call with Faisal")[0]);
    const third = made[made.length - 1];
    await act(async () => root.render(<div />));
    expect(revoked).toContain(third);
  });

  test("a recording that cannot be played says why in the row", async () => {
    recording = async () => ({
      ok: false,
      message:
        "Maqsam has no recording of this call, often because nobody answered.",
    });
    await show("call_centre");
    await click(buttons("Play the longest call with Noura")[0]);
    expect(host.querySelector("audio")).toBeNull();
    expect(host.querySelector("li [role='alert']")?.textContent).toBe(
      "Maqsam has no recording of this call, often because nobody answered.",
    );
  });

  test("a lead with no recording or no call has no Play button", async () => {
    await show("call_centre");
    expect(text()).toContain("No recording to play");
    expect(buttons("Play the longest call with Mariam")).toHaveLength(0);
    // Dialled, never answered: said as such, not as a missing number.
    expect(text()).toContain("2 verified calls, none answered · Noor Saleh");
    expect(text()).not.toContain("longest Not measured");
  });

  test("Show fewer closes a player in a row it folds away, and frees its audio", async () => {
    await show("call_centre");
    await click(buttons("Show the other 3")[0]);
    await click(buttons("Play the longest call with Hessa")[0]);
    const url = made[made.length - 1];
    expect(host.querySelector("audio")?.getAttribute("src")).toBe(url);
    await click(buttons("Show fewer")[0]);
    expect(host.querySelector("audio")).toBeNull();
    expect(revoked).toContain(url);
    // Opening the list again shows Play, not a stale player.
    await click(buttons("Show the other 3")[0]);
    expect(buttons("Play the longest call with Hessa")).toHaveLength(1);
    expect(buttons("Close the player")).toHaveLength(0);
  });

  test("Show fewer leaves a player in the first five open", async () => {
    await show("call_centre");
    await click(buttons("Show the other 3")[0]);
    await click(buttons("Play the longest call with Faisal")[0]);
    const url = made[made.length - 1];
    await click(buttons("Show fewer")[0]);
    expect(host.querySelector("audio")?.getAttribute("src")).toBe(url);
    expect(revoked).not.toContain(url);
  });
});

describe("the caller outside the part", () => {
  const byTask = callersByTask(callersFixture());

  test("callers merge per ClickUp card, once per person; a client with no card is left out", () => {
    expect(byTask.get("task-two")?.map(c => c.name)).toEqual([
      "Noor Saleh",
      "Dana Ali",
    ]);
    expect(byTask.size).toBe(2);
    expect(callerNames(byTask.get("task-two"))).toBe("Noor Saleh and Dana Ali");
    expect(callerNames([])).toBe(NO_CALLER);
    expect(() => callersByTask({ clients: "x" })).toThrow(
      "The callers came back in a shape this page cannot read.",
    );
  });

  test("the list chip: the name, a gap only where a caller is expected, nothing while loading", async () => {
    await act(async () =>
      root.render(
        <div>
          <p id="one">
            <ClientCallerChip callers={byTask.get("task-fictional")} expected />
          </p>
          <p id="none">
            <ClientCallerChip callers={[]} expected />
          </p>
          <p id="dwy">
            <ClientCallerChip callers={[]} expected={false} />
          </p>
          <p id="wait">
            <ClientCallerChip expected />
          </p>
        </div>,
      ),
    );
    const at = (id: string) => host.querySelector(`#${id}`)?.textContent;
    expect(at("one")).toBe("Caller: Noor Saleh");
    expect(at("none")).toBe("No caller");
    expect(at("dwy")).toBe("");
    expect(at("wait")).toBe("");
  });

  test("the header line: loading, the caller, nobody, a done-with-you client, a failed read", async () => {
    const line = async (
      read: Parameters<typeof ClientCallerLine>[0]["read"],
      taskId: string,
      dwy = false,
    ) => {
      await act(async () =>
        root.render(<ClientCallerLine read={read} taskId={taskId} dwy={dwy} />),
      );
      return text();
    };
    expect(await line({ error: null }, "task-fictional")).toBe(
      "Finding their caller in the dialer…",
    );
    expect(await line({ byTask, error: null }, "task-fictional")).toBe(
      "Caller: Noor Saleh",
    );
    expect(await line({ byTask, error: null }, "task-two")).toBe(
      "Callers: Noor Saleh and Dana Ali",
    );
    expect(await line({ byTask, error: null }, "task-unknown")).toBe(NO_CALLER);
    expect(await line({ byTask, error: null }, "task-unknown", true)).toBe(
      "No caller: the client's own team calls their leads",
    );
    expect(
      await line({ error: "The callers could not be read. Try again." }, "x"),
    ).toBe(
      "The caller is not shown. The callers could not be read. Try again.",
    );
  });
});

describe("the helpers", () => {
  test("callRange: never past today, at most 93 days, 30 without a period", () => {
    const today = "2026-10-13";
    expect(callRange({ from: "2026-10-01", to: "2026-10-31" }, today)).toEqual({
      from: "2026-10-01",
      to: today,
      clamped: false,
    });
    expect(callRange({ from: "2026-01-01", to: today }, today)).toEqual({
      from: "2026-07-13",
      to: today,
      clamped: true,
    });
    expect(callRange({ from: "2026-05-01", to: "2026-05-31" }, today)).toEqual({
      from: "2026-05-01",
      to: "2026-05-31",
      clamped: false,
    });
    expect(callRange(null, today)).toEqual({
      from: "2026-09-14",
      to: today,
      clamped: false,
    });
    expect(rangeLabel({ from: "2026-09-14", to: today })).toBe(
      "14 Sep to 13 Oct",
    );
    expect(rangeLabel({ from: today, to: today })).toBe("13 Oct");
  });

  test("callReadProblem keeps the database's sentences and words the rest", () => {
    expect(
      callReadProblem({
        code: "22023",
        message: "Choose dates up to today, covering at most 93 days.",
      }),
    ).toBe("Choose dates up to today, covering at most 93 days.");
    expect(
      callReadProblem({
        code: "57014",
        message: "canceling statement due to statement timeout",
      }),
    ).toBe("The dialer took too long to answer. Try again in a minute.");
    expect(callReadProblem({ message: "TypeError: Failed to fetch" })).toBe(
      "The call numbers could not be reached. Check your connection and try again.",
    );
    expect(callReadProblem({ message: "boom." }, "The callers")).toBe(
      "The callers could not be read (boom). Try again in a minute; if it stays, tell the CEO.",
    );
    expect(
      callReadProblem({
        code: "PGRST202",
        message: "Could not find the function",
      }),
    ).toContain("is not on the database yet");
  });

  test("callPath follows the official report; the bar never widens", () => {
    const path = callPath(parseCallCentre(callCentreFixture("call_centre")));
    expect(path?.notCalled).toBe(24);
    expect(path?.steps.map(s => [s.key, s.count])).toEqual([
      ["leads", 120],
      ["called", 96],
      ["answered", 70],
      ["talked", 40],
      ["booked", 22],
      ["showed", 12],
    ]);
    const widths = path?.steps.map(s => s.width) ?? [];
    for (let i = 1; i < widths.length; i++)
      expect(widths[i]).toBeLessThanOrEqual(widths[i - 1]);
    const odd = callCentreFixture("call_centre");
    odd.cohort.talked120 = 90; // more than answered: drawn no wider
    const bent = callPath(parseCallCentre(odd));
    expect(bent?.steps[3].count).toBe(90);
    expect(bent?.steps[3].width).toBe(bent?.steps[2].width);
    expect(callPath(parseCallCentre(callCentreFixture("no_data")))).toBeNull();
  });

  test("tableRow and somethingWaits", () => {
    const data = parseCallCentre(callCentreFixture("call_centre"));
    const pools = tableRow(data.byCampaign[1], "campaign", data.clientAverage);
    expect(pools.flag.kind).toBe("below");
    expect(pools.tone).toBe("warn");
    expect(pools.speaks).toBe(true);
    const unnamed = tableRow(data.byAd[9], "ad", data.clientAverage);
    expect(unnamed.name).toBe("Ad ad-10");
    expect(unnamed.flag.kind).toBe("too_few");
    expect(unnamed.speaks).toBe(false);
    expect(somethingWaits(data)).toBe(true);
    expect(
      somethingWaits(parseCallCentre(callCentreFixture("lead_quality"))),
    ).toBe(false);
  });

  test("rowRates: called of leads, dials per lead, answered and booked per lead called", () => {
    const data = parseCallCentre(callCentreFixture("call_centre"));
    const villas = rowRates(data.byCampaign[0]);
    expect(villas.calledRate).toBeCloseTo((46 / 52) * 100);
    expect(villas.dialsPerLead).toBeCloseTo(190 / 52);
    expect(villas.answeredRate).toBeCloseTo((36 / 46) * 100);
    expect(villas.bookedRate).toBeCloseTo((12 / 46) * 100);
    const none = rowRates({ ...data.byCampaign[0], leads: 0, called: 0 });
    expect(none).toEqual({
      calledRate: null,
      dialsPerLead: null,
      answeredRate: null,
      bookedRate: null,
    });
  });

  test("reportDidNotAnswer, hasLost and showsLost", () => {
    const failed = parseCallCentre(callCentreFixture("report_failed"));
    expect(reportDidNotAnswer(failed)).toBe(true);
    expect(
      reportDidNotAnswer(parseCallCentre(callCentreFixture("no_data"))),
    ).toBe(false);
    expect(
      reportDidNotAnswer(parseCallCentre(callCentreFixture("call_centre"))),
    ).toBe(false);
    expect(hasLost(failed)).toBe(true);
    expect(hasLost(parseCallCentre(callCentreFixture("not_enough")))).toBe(
      false,
    );
    expect(showsLost({ status: "loading" })).toBe(false);
    expect(showsLost({ status: "error", message: "x" })).toBe(false);
    expect(showsLost({ status: "ready", data: failed })).toBe(true);
    expect(
      showsLost({
        status: "ready",
        data: parseCallCentre(callCentreFixture("client_calls")),
      }),
    ).toBe(false);
  });

  test("the not enough answer never runs a rate past 100%", () => {
    const data = parseCallCentre(callCentreFixture("not_enough"));
    for (const r of [...data.byCampaign, data.clientAverage]) {
      if (!r) continue;
      const rates = rowRates(r);
      for (const v of [rates.calledRate, rates.answeredRate, rates.bookedRate])
        expect(v ?? 0).toBeLessThanOrEqual(100);
    }
    const sum = (k: "leads" | "called" | "dials" | "reached" | "booked") =>
      data.byCampaign.reduce((n, r) => n + r[k], 0);
    expect(sum("leads")).toBe(data.cohort.leads);
    expect(sum("called")).toBe(data.cohort.called);
    expect(sum("dials")).toBe(data.cohort.dials);
    expect(data.window.dials).toBe(data.official?.providerDials);
    expect(data.window.talked120).toBeLessThanOrEqual(data.window.reached);
  });

  test("small wording helpers", () => {
    // A lead at 01:30 in Kuwait arrived on the 9th, not the UTC 8th.
    expect(kuwaitDayLabel("2026-10-08T22:30:00Z")).toBe("9 Oct");
    expect(kuwaitDayLabel("2026-10-09T08:12:00Z")).toBe("9 Oct");
    expect(kuwaitDayLabel(null)).toBe("an unknown day");
    expect(kuwaitDayLabel("not a time")).toBe("an unknown day");
    expect(kuwaitStamp("2026-10-13T13:25:00Z")).toBe("13 Oct, 16:25");
    expect(kuwaitStamp(null)).toBe("Not measured");
    expect(stageDays(0.4)).toBe("under a day");
    expect(stageDays(3.2)).toBe("3 d");
    expect(stageDays(null)).toBe("Not measured");
  });
});
