import {
  afterAll,
  describe,
  expect,
  mock,
  setDefaultTimeout,
  test,
} from "bun:test";
import { Window } from "happy-dom";

/**
 * The kickoff sheet (docs/forms/WAVE56-CONTRACT.md 4.13, 5.13, section 8):
 * the 38 Typeform answers in three groups plus New MRR, with the prefill
 * chips; the embed kept (and no read) while the kickoff is not live; a
 * second kickoff asks why; the answers sent by key, Typeform-shaped. Every
 * read and send is a stand-in.
 *
 * Run: bun test scripts/kickoff-sheet.test.tsx
 *
 * (Shares its browser set-up with wins.test.tsx.)
 * The wins ledger's screens (docs/forms/WAVE56-CONTRACT.md 5.0 to 5.4, 5.6,
 * 5.11, 5.12, 5.14, section 8 cockpit-screens row): Log a win's proof field
 * per kind and the SQL sentences word for word; one request id per open
 * sheet through a retry and the duplicate warning; the ribbon's words for
 * every stage and pay state; Mark as offered disabled on a draft; the tie
 * dialog's chips; the door lines and no call behind a closed door; Client is
 * back only with a confirmed departure; the Today bands; Checks waiting's
 * receipt lines; the retire list's words. Every send and read is a stand-in.
 *
 * Run: bun test scripts/wins.test.tsx
 */

setDefaultTimeout(30_000);

const win = new Window({
  url: "https://localhost/client-success/clients/86ewvnqj5",
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
  "HTMLTextAreaElement",
  "HTMLSelectElement",
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
  }),
  Toaster: () => null,
}));

const { createRoot } = await import("react-dom/client");
const { act, createElement } = await import("react");
const kick = await import("../src/forms/kickoff");
const staff = await import("../src/forms/staff/formSheetCore");
const { KickoffDoor } = await import("../src/components/ClientForms");

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
  return root;
}
const clear = async (root: any) => {
  await act(async () => root.unmount());
  roots.splice(roots.indexOf(root), 1);
  await flush();
  win.document.body.innerHTML = "";
  win.localStorage.clear();
};
const body = () => win.document.body as any;
const text = (el: any) =>
  String(el?.textContent ?? "")
    .replace(/\s+/g, " ")
    .trim();
const button = (label: string) =>
  [...body().querySelectorAll("button")].find(
    (b: any) => text(b) === label,
  ) as any;
async function click(el: any) {
  expect(el).toBeTruthy();
  await act(async () => el.click());
  await flush();
}

const OPEN = { open: true, why: null } as const;

function stub(answered: string | null = null) {
  const calls: { name: string; args: any }[] = [];
  return {
    calls,
    api: {
      prefill: async (t: string) => {
        calls.push({ name: "prefill", args: t });
        return {
          live: true,
          why: null,
          client: "Ardon Interiors",
          answered: answered ? { at: answered, byRole: "the CSM" } : null,
          prefill: [
            {
              key: "legal_name",
              value: "Ardon Interiors WLL",
              source: "the onboarding form",
            },
            {
              key: "serviceAdvertised",
              value: "Villa interiors",
              source: "the onboarding form",
            },
            { key: "newMrrUsd", value: 1500, source: "the card" },
          ],
          onboardingAt: "2026-10-30T10:00:00Z",
          card: { mrrUsd: 1500, status: "Onboarding Booked" },
        };
      },
      submit: async (t: string, a: Record<string, unknown>, r: string) => {
        calls.push({ name: "submit", args: { t, a, r } });
        return {
          responseId: "resp-k1",
          trail: [
            { step: "tasks", state: "done" },
            { step: "message", state: "waiting" },
          ],
        };
      },
      trail: async () => ({
        stored: { state: "done" },
        card: { state: "held" },
        notice: { state: "posted", channelName: "csm-general" },
      }),
    },
  };
}

describe("the kickoff's fields (4.13)", () => {
  test("38 Typeform answers, each with a unique ref, then New MRR", () => {
    expect(kick.KICKOFF_ANSWER_FIELDS).toHaveLength(38);
    const refs = kick.KICKOFF_ANSWER_FIELDS.map(f => f.ref);
    expect(new Set(refs).size).toBe(38);
    expect(refs).toContain("75e97e7d-4c19-437a-b4b8-67570c29344f");
    expect(refs).toContain("b5578678-d0c2-475b-b66f-7ea54d55fe31");
    const last = kick.KICKOFF_FIELDS[kick.KICKOFF_FIELDS.length - 1];
    expect(last).toMatchObject({
      key: "newMrrUsd",
      label: "New MRR (USD a month)",
      type: "number",
      required: true,
    });
    expect(last.hint).toBe(
      "What this client pays us each month from now. 0 if they paid in full with no monthly fee.",
    );
    expect(
      kick.KICKOFF_FIELDS.filter(f => f.type === "heading").map(f => f.label),
    ).toEqual([
      "The client's business",
      "Set-up and access",
      "Content, leads and training",
    ]);
  });
  test("the sheet's words; a second kickoff asks why first", () => {
    const def = kick.kickoffDef("Ardon Interiors");
    expect(def.title).toBe("Kickoff for Ardon Interiors");
    expect(def.submitLabel({})).toBe("Send the kickoff");
    expect(def.fields.some(f => f.key === "replaceReason")).toBe(false);
    const again = kick.kickoffDef("Ardon Interiors", "2026-10-28T10:00:00Z");
    expect(again.fields[0]).toMatchObject({
      key: "replaceReason",
      required: true,
    });
    expect(again.lede).toBe(
      "A kickoff was sent on 28 Oct. Say why you are sending it again.",
    );
    const trail = staff.trailFrom(
      {
        stored: { state: "done" },
        card: { state: "delivered" },
        extra: { tasks: "done", message: "done" },
        notice: { state: "posted", channelName: "csm-general" },
      },
      def,
    );
    expect(trail.map(s => s.label)).toEqual([
      "Kickoff stored",
      "Card confirmed",
      "Tech and creative tasks made",
      "Phase 4 message waits for your approval",
      "Posted in #csm-general",
    ]);
    expect(
      staff.trailFrom(
        { stored: { state: "done" }, card: { state: "queued" } },
        def,
      )[1].label,
    ).toBe("Card queued");
  });
  test("answers by key, a multi pick joined as the Typeform stores it, empty answers left out", () => {
    expect(
      kick.kickoffAnswers({
        businessOk: "Yes",
        consultationTypes: ["In-office", "Online"],
        paymentAmount: "1500",
        newMrrUsd: "0",
        linksAdd: "",
        replaceReason: "  The first one had the wrong budget.  ",
      }),
    ).toEqual({
      businessOk: "Yes",
      consultationTypes: "In-office, Online",
      paymentAmount: 1500,
      newMrrUsd: 0,
      replaceReason: "The first one had the wrong budget.",
    });
    expect(kick.KICKOFF_REFS.paymentAmount).toBe(
      "75e97e7d-4c19-437a-b4b8-67570c29344f",
    );
  });
});

describe("the kickoff door (5.13)", () => {
  test("while not live: the embed stays, the line says so, nothing is read", async () => {
    for (const [door, line] of [
      [
        { open: false, why: "off" },
        "The kickoff moves into the cockpit after its switch-on.",
      ],
      [{ open: false, why: "missing" }, "Opens after the next cockpit update."],
    ] as const) {
      const { api, calls } = stub();
      const root = await draw(
        createElement(KickoffDoor, {
          door,
          api,
          taskId: "86ewvnqj5",
          clientName: "Ardon Interiors",
          autoOpen: true,
        }),
      );
      expect(text(body())).toBe(line);
      expect(calls).toHaveLength(0);
      await clear(root);
    }
  });

  test("live: 38 answers in three groups plus New MRR, with the prefill chips; Send the kickoff", async () => {
    const { api, calls } = stub();
    const root = await draw(
      createElement(KickoffDoor, {
        door: OPEN,
        api,
        taskId: "86ewvnqj5",
        clientName: "Ardon Interiors",
      }),
    );
    await click(button("Send the kickoff"));
    expect(calls[0]).toEqual({ name: "prefill", args: "86ewvnqj5" });
    expect(text(body().querySelector(".fs-title"))).toBe(
      "Kickoff for Ardon Interiors",
    );
    const labels = [...body().querySelectorAll(".fs-field .fs-label")].map(
      text,
    );
    // 38 answers + New MRR (the optional marks ride on the labels).
    expect(labels).toHaveLength(39);
    expect(labels[labels.length - 1]).toBe("New MRR (USD a month)");
    expect([...body().querySelectorAll(".fs-heading")].map(text)).toEqual([
      "The client's business",
      "Set-up and access",
      "Content, leads and training",
    ]);
    const froms = [...body().querySelectorAll(".fs-from")].map(text);
    expect(froms).toContain("from the onboarding form");
    expect(froms).toContain("from the card");
    expect(text(body().querySelector(".fs-facts"))).toContain(
      "Ardon Interiors WLL · from the onboarding form",
    );
    // Required answers are checked before anything is sent.
    await click(body().querySelector(".fs-foot .fs-btn"));
    expect(calls.filter(c => c.name === "submit")).toHaveLength(0);
    expect(text(body())).toContain("answers need a fix above.");
    await clear(root);
  });

  test("a card with a kickoff asks why it is sent again", async () => {
    const { api } = stub("2026-10-28T10:00:00Z");
    const root = await draw(
      createElement(KickoffDoor, {
        door: OPEN,
        api,
        taskId: "86ewvnqj5",
        clientName: "Ardon Interiors",
        autoOpen: true,
      }),
    );
    expect(text(body())).toContain(
      "A kickoff was sent on 28 Oct. Say why you are sending it again.",
    );
    expect(text(body())).toContain("Why are you sending it again?");
    await clear(root);
  });
});
