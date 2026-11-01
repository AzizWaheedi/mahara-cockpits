import {
  afterAll,
  describe,
  expect,
  mock,
  setDefaultTimeout,
  test,
} from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Window } from "happy-dom";

/**
 * The client page's honest buttons and its new doors
 * (docs/forms/WAVE12-CONTRACT.md 4.6, 4.7.4, 4.13, 5.2, 5.4; section 8
 * formsheet row): booked, touchpoint, report and service reach the card
 * through cockpit-csm-api with the 4.6.1 words; the reactivate link and the
 * "$50" line are gone from both apps and the assistant; every browser call
 * of the staff forms sends what 3.1 names; and a door or band whose
 * cockpit_form_doors flag is false says "Opens after the next cockpit
 * update." and calls nothing it guards. Stand-in clients only.
 *
 * Run: bun test scripts/client-page-acts.test.ts
 */

setDefaultTimeout(30_000);

const win = new Window({
  url: "https://localhost/client-success/today",
  width: 1280,
  height: 900,
});
const DOM = [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "HTMLButtonElement",
  "HTMLAnchorElement",
  "HTMLInputElement",
  "HTMLSelectElement",
  "HTMLFormElement",
  "Element",
  "Node",
  "Event",
  "CustomEvent",
  "KeyboardEvent",
  "MouseEvent",
  "PointerEvent",
  "FocusEvent",
  "DocumentFragment",
  "Text",
  "NodeFilter",
  "MutationObserver",
  "getComputedStyle",
  "sessionStorage",
  "localStorage",
  "InputEvent",
  "ResizeObserver",
  "DOMRect",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "matchMedia",
];
for (const k of DOM)
  Object.defineProperty(globalThis, k, {
    configurable: true,
    writable: true,
    value:
      k === "window"
        ? win
        : typeof (win as any)[k] === "function" && /^[a-z]/.test(k)
          ? (win as any)[k].bind(win)
          : (win as any)[k],
  });
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const toasts: string[] = [];
mock.module("sonner", () => ({
  toast: Object.assign((m: string) => toasts.push(m), {
    success: (m: string) => toasts.push(m),
    error: (m: string) => toasts.push(m),
    warning: (m: string) => toasts.push(m),
  }),
  Toaster: () => null,
}));

// The page module reads the signed-in client on import; none here.
mock.module("@/auth/SupabaseAuthProvider", () => ({
  getCockpitSupabaseClient: () => null,
  SupabaseAuthProvider: ({ children }: { children: unknown }) => children,
  useCockpitAuth: () => ({ client: null, isCeo: false, roles: ["csm"] }),
}));

const { createRoot } = await import("react-dom/client");
const { act, createElement } = await import("react");
const snapshot = await import("../src/lib/useCsmSnapshot");
const lc = await import("../src/forms/staff/lifecycleClient");
const page = await import("../src/pages/CsmPage");
const fx = await import("../src/dev/formSheetFixtures");

const ROOT = join(import.meta.dir, "..", "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const roots: ReturnType<typeof createRoot>[] = [];
afterAll(async () => {
  for (const r of roots) await act(async () => r.unmount());
  await win.happyDOM.close();
});
const flush = () =>
  act(async () => {
    for (let i = 0; i < 8; i++) await new Promise(r => setTimeout(r, 0));
  });
async function draw(el: any) {
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as unknown as Element);
  roots.push(root);
  await act(async () => root.render(el));
  await flush();
  return host as any;
}
const text = (el: any) =>
  String(el?.textContent ?? "")
    .replace(/\s+/g, " ")
    .trim();
const buttons = (el: any) =>
  [...el.querySelectorAll("button")].map((b: any) => text(b));

/** A Supabase stand-in: records every RPC and function call, answers from the table. */
function fakeClient(answers: Record<string, unknown> = {}) {
  const rpcs: { name: string; args: any }[] = [];
  const invoked: any[] = [];
  const client: any = {
    auth: {
      getSession: async () => ({
        data: { session: { user: { id: "csm-1" } } },
      }),
    },
    functions: {
      invoke: async (name: string, opts: any) => {
        invoked.push({ name, ...opts.body });
        return { data: { ok: true, receiptId: "receipt-1" }, error: null };
      },
    },
    rpc: async (name: string, args?: any) => {
      rpcs.push({ name, args });
      const a = answers[name];
      if (a instanceof Error)
        return { data: null, error: { message: a.message } };
      if (a === undefined) throw Error(`Unexpected RPC call: ${name}`);
      return {
        data: typeof a === "function" ? (a as any)(args) : a,
        error: null,
      };
    },
  };
  return { client, rpcs, invoked };
}

describe("booked, touchpoint, report and service reach the card (4.6.1)", () => {
  test("each goes through cockpit-csm-api, not the cockpit-only log", async () => {
    for (const [kind, value, note] of [
      ["booked", "2026-11-05", "Booked via the check-in link."],
      ["touchpoint", "", "Hi, here is your weekly update."],
      ["report", "", ""],
      ["service", "DFY", ""],
    ]) {
      const { client, rpcs, invoked } = fakeClient();
      await snapshot.performAct(client, {
        clientName: "Liwan Limited",
        taskId: "86ewvnqj5",
        action: `Did ${kind}`,
        kind,
        value,
        note,
      });
      expect(rpcs).toEqual([]);
      expect(invoked).toHaveLength(1);
      expect(invoked[0].name).toBe("cockpit-csm-api");
      expect(invoked[0].operation).toBe("act");
      expect(invoked[0].apply).toBe(true);
      expect(invoked[0].args).toEqual({
        taskId: "86ewvnqj5",
        kind,
        action: `Did ${kind}`,
        value,
        ...(note ? { note } : {}),
      });
    }
  });

  test("stage and happiness are unchanged; left and ticket stay in the cockpit", async () => {
    expect([...snapshot.CLICKUP_ACT_KINDS].sort()).toEqual(
      [
        "booked",
        "happiness",
        "report",
        "service",
        "stage",
        "touchpoint",
      ].sort(),
    );
    for (const kind of ["left", "ticket", "commitment"]) {
      const { client, rpcs, invoked } = fakeClient({ cockpit_log_decision: 7 });
      await snapshot.performAct(client, {
        clientName: "Liwan Limited",
        taskId: "86ewvnqj5",
        action: "Did it",
        kind,
        commitmentIndex: 2,
      });
      expect(invoked).toEqual([]);
      expect(rpcs[0].name).toBe("cockpit_log_decision");
      // Commitment handled keeps which one it was (4.6.3).
      if (kind === "commitment")
        expect(rpcs[0].args.p_metadata.commitmentIndex).toBe(2);
    }
  });

  test("the words: the toast per kind, and a failure says the card is as it was", () => {
    expect(snapshot.ACT_SAVED.booked).toBe("Booking saved to the card");
    expect(snapshot.ACT_SAVED.touchpoint).toBe("Touchpoint saved to the card");
    expect(snapshot.ACT_SAVED.report).toBe("Report date saved to the card");
    expect(snapshot.ACT_SAVED.service).toBe("Service saved to the card");
    expect(
      snapshot.actFailed(new Error('ClickUp does not offer the value "DFY"')),
    ).toBe(
      'ClickUp does not offer the value "DFY". Nothing changed on the card.',
    );
    expect(snapshot.actFailed(new Error("Choose a valid call date."))).toBe(
      "Choose a valid call date. Nothing changed on the card.",
    );
    const csm = read("apps/client-success-cockpit/src/pages/CsmPage.tsx");
    expect(csm).toContain("Save the booking");
    expect(csm).not.toContain("They booked, save it to ClickUp");
    expect(csm).toContain(
      "Say what the client said, so the answer reads back.",
    );
  });
});

describe("the links (4.7.4, 4.13)", () => {
  test("no reactivate row and no $50 in either app; Give more time points into the cockpit", () => {
    for (const app of ["client-success-cockpit", "media-buyer-cockpit"]) {
      const links = read(`apps/${app}/src/lib/csmLinks.ts`);
      expect(links).not.toContain("Card declined, reactivate their ads");
      expect(links).not.toContain("ecJQ5Z5C");
      expect(links).not.toContain("$50");
      expect(links).not.toContain("reactivate");
      expect(links).toContain('label: "Give more time (in the cockpit)"');
      expect(links).toContain(
        'note: "Open the client, then Give more time. The ClickUp card updates itself."',
      );
      expect(links).toContain(
        "https://cockpit.maharamedia.com/client-success/clients",
      );
    }
    const assistant = read("viktor-side-scripts/csm/csm_assistant.py");
    expect(assistant).not.toContain("reactivate ads after a failed payment");
    expect(assistant).not.toContain("ecJQ5Z5C");
    expect(
      read("apps/client-success-cockpit/src/pages/CsmPage.tsx"),
    ).not.toContain("Pause, extend, reactivate or end");
  });
});

describe("the staff forms' browser calls send what 3.1 names", () => {
  test("Give more time: one cockpit_billing_write edit with the new fields and the grant it replaces", async () => {
    const { client, rpcs } = fakeClient({
      cockpit_billing_write: {
        eventId: 812,
        responseId: "r-1",
        newDate: "2026-11-16",
        cardState: "held",
      },
    });
    const out = await lc.giveMoreTime(
      client,
      "86ewvnqj5",
      {
        weeks: "2",
        reason: "Launch slipped",
        ours: "no",
        limitations: ["Budget"],
        atRisk: "yes",
        callId: "4211",
      },
      "11111111-1111-4111-8111-111111111111",
      { replacesGrantId: 4021 },
    );
    expect(rpcs[0]).toEqual({
      name: "cockpit_billing_write",
      args: {
        p_action: "edit",
        p_args: {
          taskId: "86ewvnqj5",
          source: "csm",
          edit: {
            kind: "extension",
            weeks: 2,
            reason: "Launch slipped",
            ours: false,
            limitations: ["Budget"],
            atRisk: true,
            callId: "4211",
            noCall: false,
            noCallReason: null,
            prevent: null,
            replacesGrantId: 4021,
            requestId: "11111111-1111-4111-8111-111111111111",
          },
        },
      },
    });
    expect(out).toEqual({
      message: "2 weeks to 16 Nov",
      cardState: "held",
      ref: { eventId: 812, responseId: "r-1" },
    });
  });

  test("pause, resume and Set MRR: the 4.8 and 4.9 edits", async () => {
    const { client, rpcs } = fakeClient({
      cockpit_billing_write: { eventId: 1 },
    });
    await lc.pauseClient(
      client,
      "t",
      {
        pauseKind: "client_request",
        restart: "2026-11-20",
        reasonCat: "client_asked",
        reason: "Ramadan",
        callId: "4211",
        consentTerm: true,
        consentOver14: true,
      },
      "r1",
      { source: "ceo" },
    );
    await lc.resumeClient(
      client,
      "t",
      { on: "2026-11-01", nextDate: "" },
      "r2",
    );
    await lc.setMrr(
      client,
      "t",
      {
        mrrUsd: "1500",
        reasonCat: "downgrade",
        reason: "Smaller plan",
        effective: "2026-11-01",
      },
      "r3",
    );
    expect(rpcs.map(r => r.args.p_args.edit)).toEqual([
      {
        kind: "pause",
        pauseKind: "client_request",
        restart: "2026-11-20",
        reasonCat: "client_asked",
        reason: "Ramadan",
        callId: "4211",
        consent: { kind: "call", term_runs: true, over_14_ends: true },
        requestId: "r1",
      },
      { kind: "resume", on: "2026-11-01", nextDate: null, requestId: "r2" },
      {
        kind: "mrr",
        value: 1500,
        reasonCat: "downgrade",
        reason: "Smaller plan",
        effective: "2026-11-01",
        requestId: "r3",
      },
    ]);
    expect(rpcs[0].args.p_args.source).toBe("ceo");
  });

  test("Client is leaving: cockpit_client_lifecycle_confirm('churn') with every 3.1 key", async () => {
    const { client, rpcs } = fakeClient({
      cockpit_client_lifecycle_confirm: {
        departureId: 23,
        eventId: 900,
        responseId: "r-9",
        cardState: "held",
      },
    });
    const out = await lc.confirmChurn(
      client,
      "86eyjkdc8",
      {
        leftOn: "2026-10-31",
        reason: "Cancelled",
        churnType: "mid_programme",
        whyDetail: "Budget moved to a showroom.",
        howToStop: "Agree six months of budget at kickoff.",
        mrrLostUsd: "1500",
        surveyState: "filled",
      },
      "req-1",
      { surveyResponseId: "s-1" },
    );
    expect(rpcs[0]).toEqual({
      name: "cockpit_client_lifecycle_confirm",
      args: {
        p_kind: "churn",
        p_args: {
          taskId: "86eyjkdc8",
          requestId: "req-1",
          leftOn: "2026-10-31",
          noticeOn: null,
          reason: "Cancelled",
          churnType: "mid_programme",
          whyDetail: "Budget moved to a showroom.",
          howToStop: "Agree six months of budget at kickoff.",
          mrrLostUsd: 1500,
          exitCallId: null,
          surveyState: "filled",
          surveyResponseId: "s-1",
        },
      },
    });
    expect(out.ref).toEqual({
      departureId: 23,
      eventId: 900,
      responseId: "r-9",
    });
    expect(out.message).toBe("left 31 Oct");
  });

  test("the trail, the prefill, the notice answer; a refusal is the server's sentence", async () => {
    const { client, rpcs } = fakeClient({
      cockpit_form_trail: fx.TRAIL_ROWS.held,
      cockpit_form_prefill: {
        values: fx.EXTENSION_PREFILL,
        calls: [
          {
            id: 4211,
            at: "2026-10-28T11:30:00+03:00",
            kind: "Check-in call",
            source: "Fathom, 28 Oct",
          },
        ],
        hints: [
          {
            text: "The 1-1 notes mention an extension",
            source: "the 1-1 notes, 21 Oct",
          },
        ],
        grant: { grant_id: 4021, until: "2026-11-16", weeks: 2 },
        card: { status: "Active" },
        survey: null,
        churnTypeDefault: null,
      },
      cockpit_form_notice_answer: { ok: true },
      cockpit_billing_write: new Error(
        "An extension already runs to 16 Nov. Open Give more time again to add weeks to it.",
      ),
    });
    expect(await lc.formTrail(client, { eventId: 812 })).toEqual(
      fx.TRAIL_ROWS.held,
    );
    expect(rpcs[0]).toEqual({
      name: "cockpit_form_trail",
      args: { p_ref: { eventId: 812 } },
    });
    const pre = await lc.formPrefill(client, "extension", "86ewvnqj5");
    expect(rpcs[1]).toEqual({
      name: "cockpit_form_prefill",
      args: { p_form_key: "extension", p_task_id: "86ewvnqj5" },
    });
    expect(pre.prefill).toEqual(fx.EXTENSION_PREFILL);
    expect(pre.calls).toEqual([
      {
        id: "4211",
        at: "2026-10-28T11:30:00+03:00",
        kind: "Check-in call",
        source: "Fathom, 28 Oct",
      },
    ]);
    expect(pre.grant).toEqual({ grantId: 4021, until: "2026-11-16", weeks: 2 });
    expect(pre.hints[0]).toEqual({
      key: "hint0",
      value: "The 1-1 notes mention an extension",
      source: "the 1-1 notes, 21 Oct",
    });
    await lc.answerNotice(
      client,
      "resp-1",
      "staying",
      "  They found the budget.  ",
    );
    expect(rpcs[2]).toEqual({
      name: "cockpit_form_notice_answer",
      args: {
        p_response_id: "resp-1",
        p_answer: "staying",
        p_note: "They found the budget.",
      },
    });
    await expect(
      lc.giveMoreTime(client, "t", { weeks: "1" }, "r"),
    ).rejects.toThrow(
      "An extension already runs to 16 Nov. Open Give more time again to add weeks to it.",
    );
  });

  test("formDoors reads every flag, and any error is all closed", async () => {
    const open = fakeClient({ cockpit_form_doors: fx.ALL_DOORS });
    expect(await lc.formDoors(open.client)).toEqual(fx.ALL_DOORS);
    const refused = fakeClient({
      cockpit_form_doors: new Error("permission denied"),
    });
    expect(await lc.formDoors(refused.client)).toEqual(lc.NO_DOORS);
    const missing = fakeClient({});
    expect(await lc.formDoors(missing.client)).toEqual(lc.NO_DOORS);
    const half = fakeClient({
      cockpit_form_doors: { churnConfirm: true, extension: "yes" },
    });
    expect(await lc.formDoors(half.client)).toEqual({
      ...lc.NO_DOORS,
      churnConfirm: true,
    });
  });

  test("RPC_NAMES lists every name the file calls (the D-S1 to_regprocedure list)", () => {
    const src = read(
      "apps/client-success-cockpit/src/forms/staff/lifecycleClient.ts",
    );
    const called = new Set(
      [...src.matchAll(/rpc\(\s*c,\s*"([a-z_]+)"/g)].map(m => m[1]),
    );
    expect(new Set(lc.RPC_NAMES)).toEqual(called);
  });
});

describe("doors and bands wait on cockpit_form_doors (4.6.4)", () => {
  const CLIENT_ROW = {
    taskId: "86ewvnqj5",
    name: "Liwan Limited",
    stage: "Active",
    paymentDue: -3,
    paymentDate: "2026-11-04",
  };

  /** The page's own wiring: the doors read once, the bands' reads, the two parts. */
  function Harness({
    client,
    checker,
    types,
  }: {
    client: any;
    checker: boolean;
    types: Set<string> | null;
  }) {
    const doors = page.useDoors(client);
    const bands = page.useTodayBands(client, doors, true, checker, 0);
    return createElement(
      "div",
      null,
      createElement(
        "div",
        { className: "doors" },
        createElement(page.ClientDoors, {
          c: CLIENT_ROW,
          doors,
          life: null,
          onOpen: () => {},
        }),
      ),
      createElement(page.TodayBands, {
        client,
        doors,
        bands,
        types,
        clients: [CLIENT_ROW],
        checker,
        onDoor: () => {},
        onTicket: () => {},
        onChanged: () => {},
      }),
    );
  }

  test("all flags false: the plain line, and no call but cockpit_form_doors", async () => {
    const { client, rpcs } = fakeClient({
      cockpit_form_doors: {
        ...fx.ALL_DOORS,
        churnConfirm: false,
        extension: false,
        pause: false,
        reviews: false,
        checks: false,
      },
    });
    const host = await draw(
      createElement(Harness, {
        client,
        checker: true,
        types: new Set(["client_pause"]),
      }),
    );
    expect(rpcs.map(r => r.name)).toEqual(["cockpit_form_doors"]);
    expect(text(host.querySelector(".doors"))).toContain(page.NOT_YET);
    expect(text(host.querySelector(".doors"))).toBe(
      "Give more time, Pause this client, Client is leaving: Opens after the next cockpit update.",
    );
    expect(text(host)).toContain(
      `Notices in, Reviews due, Checks waiting: ${page.NOT_YET}`,
    );
    expect(buttons(host)).toEqual([]);
  });

  test("a doors read that fails reads as all closed, and calls nothing else", async () => {
    const { client, rpcs } = fakeClient({
      cockpit_form_doors: new Error(
        "function cockpit_form_doors() does not exist",
      ),
    });
    const host = await draw(
      createElement(Harness, { client, checker: false, types: null }),
    );
    expect(rpcs.map(r => r.name)).toEqual(["cockpit_form_doors"]);
    expect(text(host)).toContain(page.NOT_YET);
  });

  test("all flags true: three doors, the four bands with their rows and ticket buttons", async () => {
    const { client, rpcs } = fakeClient({
      cockpit_form_doors: fx.ALL_DOORS,
      cockpit_form_notices_in: [
        {
          kind: "termination",
          responseId: "s-1",
          taskId: "86ewvnqj5",
          clientName: "Liwan Limited",
          noticeOn: "2026-10-30",
          submittedAt: "2026-10-30T09:00:00Z",
          matched: true,
          departureId: null,
        },
        {
          kind: "termination",
          responseId: "s-2",
          taskId: null,
          clientName: "Atlantis Homes",
          noticeOn: "2026-10-29",
          submittedAt: null,
          matched: false,
          departureId: null,
        },
        {
          kind: "pause_request",
          responseId: "p-1",
          taskId: "86ewvnqj5",
          clientName: "Liwan Limited",
          noticeOn: "2026-10-31",
          submittedAt: null,
          matched: true,
          departureId: null,
        },
      ],
      cockpit_billing_ladder_due: [
        {
          taskId: "86ewvnqj5",
          clientName: "Liwan Limited",
          step: "pause_review",
          dueOn: "2026-10-27",
          daysLate: 5,
          amountUsd: null,
          extendedUntil: null,
          pausedOn: null,
        },
        {
          taskId: "86eymcqdq",
          clientName: "Marble Works",
          step: "cancel_review",
          dueOn: "2026-10-15",
          daysLate: 17,
          amountUsd: 1200,
          extendedUntil: null,
          pausedOn: null,
        },
      ],
      cockpit_manual_payments_to_check: [
        {
          id: "mp-1",
          day: "2026-10-28",
          clientName: "Liwan Limited",
          taskId: "86ewvnqj5",
          amount: 1500,
          currency: "KWD",
          amountUsd: 4890,
          rail: "transfer",
          reference: null,
          evidenceUrl: null,
          addedBy: "the CSM",
          daysWaiting: 4,
        },
      ],
    });
    const host = await draw(
      createElement(Harness, {
        client,
        checker: true,
        types: new Set(["client_pause", "client_offboarding"]),
      }),
    );
    expect(rpcs.map(r => r.name).sort()).toEqual(
      [
        "cockpit_billing_ladder_due",
        "cockpit_form_doors",
        "cockpit_form_notices_in",
        "cockpit_manual_payments_to_check",
      ].sort(),
    );
    const doorsText = buttons(host.querySelector(".doors"));
    expect(doorsText).toEqual([
      "Give more timeDue in 3 days",
      "Pause this client",
      "Client is leaving",
    ]);
    expect(text(host)).not.toContain(page.NOT_YET);
    const all = text(host);
    expect(all).toContain(
      "Notice in: Liwan Limited sent the termination survey on 30 Oct",
    );
    expect(all).toContain(
      "Not matched to a card: Atlantis Homes sent the termination survey on 29 Oct",
    );
    expect(all).toContain(
      "Pause request in: Liwan Limited asked to pause on 31 Oct",
    );
    expect(all).toContain("Pause review: Liwan Limited is 5 days late");
    expect(all).toContain("Cancel review: Marble Works is 17 days late");
    expect(all).toContain(
      "Receipt to check: Liwan Limited, 1,500 KWD ($4,890) on 28 Oct, waiting 4 days",
    );
    const labels = buttons(host);
    for (const b of [
      "Confirm churn",
      "Not leaving",
      "Pick the card",
      "Handled",
      "Open the pause tickets",
      "Open the review ticket",
      "Check",
      "Reject",
    ])
      expect(labels).toContain(b);
    // client_notice and payment_receipt_check are not request types yet (D-R1): no button.
    expect(labels).not.toContain("Open the notice ticket");
    expect(labels).not.toContain("Open the receipt check");
  });

  test("a live grant: the door reads Extension to {date} running · Add weeks", async () => {
    const host = await draw(
      createElement(page.ClientDoors, {
        c: { ...CLIENT_ROW, stage: "Paused" },
        doors: fx.ALL_DOORS,
        life: {
          taskId: "86ewvnqj5",
          clientStatus: "Paused",
          pausedOn: "2026-10-25",
          pauseRestart: null,
          extensionUntil: "2026-11-16",
          departureId: null,
          leftOn: null,
          churnConfirmedAt: null,
          daysLate: null,
          ladderStep: null,
        },
        onOpen: () => {},
      }),
    );
    expect(buttons(host)).toEqual([
      "Extension to 16 Nov running · Add weeks",
      "Resume this client",
      "Client is leaving",
    ]);
  });
});
