import {
  afterAll,
  afterEach,
  describe,
  expect,
  mock,
  setDefaultTimeout,
  test,
} from "bun:test";
import { Window } from "happy-dom";

/**
 * The 1-1 notes window (src/forms/CheckinWindow.tsx with useCheckin;
 * docs/forms/STAGE2-CONTRACT.md 8.1 to 8.5) in happy-dom, against the
 * backend in memory of src/dev/checkinFixtures.ts and a clock the test
 * moves. Every state of 8.5: opening, this call, the answers and drafts,
 * saving, sending, the trail and the recap step. It pins the window's two
 * rules: DEFCON and priority are never chosen by a draft, whenever it
 * arrives, and a guessed call holds Send until "Yes, this call". A shadow
 * run and a rehearsal book nothing. And A7's decisions: a blocked recording
 * is never picked, pasted or not (3); the recap preview is the stored text
 * (4); an ID kept for this seat's discarded notes opens new ones (5).
 * Stage 2b (docs/forms/STAGE2B-CONTRACT.md 4.15 item 1, 5.1, 5.3): a live
 * send's recap step approves the message the cockpit made; an admin moves
 * a recording from another client with Move it here.
 *
 * Run: bun test scripts/checkin-window.test.tsx
 */

setDefaultTimeout(30_000);

const win = new Window({
  url: "https://localhost/client-success/clients/86exfix01/forms/checkin",
  width: 1440,
  height: 900,
});
const DOM = [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "HTMLButtonElement",
  "HTMLInputElement",
  "HTMLTextAreaElement",
  "HTMLDetailsElement",
  "HTMLFormElement",
  "Element",
  "Node",
  "Event",
  "CustomEvent",
  "KeyboardEvent",
  "MouseEvent",
  "PointerEvent",
  "FocusEvent",
  "InputEvent",
  "DocumentFragment",
  "Text",
  "NodeFilter",
  "MutationObserver",
  "getComputedStyle",
  "sessionStorage",
  "localStorage",
  "requestAnimationFrame",
  "cancelAnimationFrame",
];
const before = new Map(
  DOM.map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]),
);
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
    info: (m: string) => toasts.push(m),
    warning: (m: string) => toasts.push(m),
  }),
  Toaster: () => null,
}));
// The module's whole surface: files after this one import it too.
mock.module("@/auth/SupabaseAuthProvider", () => ({
  getCockpitSupabaseClient: () => null,
  SupabaseAuthProvider: ({ children }: { children: unknown }) => children,
  useCockpitAuth: () => ({ client: null, isAdmin: false, isCeo: false }),
}));
/** Every booking call the window could make (cockpit-csm-api checkIns.*). */
const bookings: string[] = [];
mock.module("@/lib/checkInClient", () => ({
  readClientContact: async () => {
    bookings.push("checkIns.contact");
    throw Error("No booking from a test.");
  },
  prepareClientCheckIn: async () => {
    bookings.push("checkIns.prepare");
    throw Error("No booking from a test.");
  },
  bookClientCheckIn: async () => {
    bookings.push("checkIns.book");
    throw Error("No booking from a test.");
  },
}));

const { createRoot } = await import("react-dom/client");
const { act } = await import("react");
const { CheckinWindowView } = await import("../src/forms/CheckinWindow");
const { whySentence } = await import("../src/forms/CheckinCall");
const { hintFor, valueText } = await import("../src/forms/CheckinFields");
const {
  BOOKING_BLOCK,
  CheckinRecap,
  GETTING_READY,
  NOT_READY_YET,
  RECAP_TOO_LATE,
  RECAP_UNUSABLE,
} = await import("../src/forms/CheckinRecap");
const { MESSAGES_FAILED } = await import("../src/lib/clientMessages");
const { stateLine } = await import("../src/forms/RecapApproval");
const { callOf } = await import("../src/forms/checkinForm");
const { callView } = await import("../src/forms/checkinClient");
const { BookCallButton } = await import("../src/components/ClientCheckIn");
const { useCheckin, GATE_LOST } = await import("../src/forms/useCheckin");
const fx = await import("../src/dev/checkinFixtures");
type Scenario = import("../src/dev/checkinFixtures").Scenario;
type Clock = import("../src/forms/useCheckin").Clock;
type DraftView = import("../src/forms/checkinClient").DraftView;

// ------------------------------------------------------------ the clock

function fakeClock(start = Date.parse(fx.NOW)) {
  let t = start;
  let timers: { at: number; fn: () => void; id: number }[] = [];
  let id = 0;
  const clock: Clock = {
    now: () => t,
    set: (fn, ms) => {
      id += 1;
      timers.push({ at: t + ms, fn, id });
      return id;
    },
    clear: h => {
      timers = timers.filter(x => x.id !== h);
    },
    visible: () => true,
  };
  return {
    clock,
    /** Moves the clock, running each timer that comes due on the way. */
    advance: async (ms: number) => {
      const end = t + ms;
      for (;;) {
        const next = timers
          .filter(x => x.at <= end)
          .sort((a, b) => a.at - b.at)[0];
        if (!next) break;
        timers = timers.filter(x => x !== next);
        t = next.at;
        await act(async () => {
          next.fn();
        });
        await settle();
      }
      t = end;
      await settle();
    },
  };
}

// ------------------------------------------------------------ the page

const roots: ReturnType<typeof createRoot>[] = [];
const settle = async (n = 8) => {
  for (let i = 0; i < n; i++)
    await act(async () => {
      await new Promise(r => setTimeout(r, 0));
    });
};
const page = () =>
  (win.document.body.textContent ?? "").replace(/\s+/g, " ").trim();
/** The page's words as drawn: a `hidden` node (read only through an aria reference) left out. */
const seen = () => {
  const copy = win.document.body.cloneNode(true) as any;
  for (const h of Array.from(copy.querySelectorAll("[hidden]")))
    (h as any).remove();
  return String(copy.textContent ?? "")
    .replace(/\s+/g, " ")
    .trim();
};
/**
 * An element's accessible description as a browser computes it (accname
 * 1.2, the parts the window uses): each node its aria-describedby names, in
 * order, read whole even when hidden; inside it a link or button with an
 * aria-label is read by that label, and aria-hidden or hidden parts are
 * left out.
 */
const described = (el: any) => {
  const text = (n: any, root: boolean): string => {
    if (!n) return "";
    if (n.nodeType === 3) return String(n.textContent ?? "");
    if (n.getAttribute?.("aria-hidden") === "true") return "";
    if (!root && n.hasAttribute?.("hidden")) return "";
    const label = n.getAttribute?.("aria-label");
    if (label && !root) return label;
    return Array.from(n.childNodes as any[])
      .map(c => text(c, false))
      .join("");
  };
  return String(el?.getAttribute("aria-describedby") ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .map(id => text(win.document.getElementById(id), true))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
};
const buttons = () =>
  Array.from(win.document.body.querySelectorAll("button")) as any[];
const button = (name: string) =>
  buttons().find(b => (b.textContent ?? "").trim() === name) as any;
const radios = () =>
  Array.from(win.document.body.querySelectorAll('[role="radio"]')) as any[];
const radio = (name: string) =>
  radios().find(r => (r.textContent ?? "").trim() === name) as any;
const click = async (el: any) => {
  expect(el).toBeTruthy();
  await act(async () => {
    el.click();
  });
  await settle();
};
const sendButton = () =>
  buttons().find(b =>
    /^Send (in shadow|the notes)$/.test((b.textContent ?? "").trim()),
  );
/** The window's headings, in order. */
const headings = () =>
  Array.from(win.document.body.querySelectorAll("h1, h2, h3")).map(h =>
    (h.textContent ?? "").replace(/\s+/g, " ").trim(),
  );
/** The "This call" card: the section its heading opens. */
const thisCall = () =>
  (
    Array.from(win.document.body.querySelectorAll("h2")).find(
      h => (h.textContent ?? "").trim() === "This call",
    ) as any
  )?.closest("section");

let model: any = null;
let opened = 0;

function Harness({
  fake,
  seat,
  rehearse,
  clock,
  live,
  messages,
}: {
  fake: ReturnType<typeof fx.fakeCheckin>;
  seat: "csm" | "admin";
  rehearse: boolean;
  clock: Clock;
  live?: boolean;
  messages?: any;
}) {
  const m = useCheckin({
    taskId: fx.TASK,
    rehearse,
    seat,
    io: fake.io,
    clock,
    newId: () => fx.NEW_ID,
  });
  model = m;
  return (
    <CheckinWindowView
      m={m}
      clock={clock}
      messages={messages ?? null}
      onTypeform={() => {
        opened += 1;
      }}
      book={p => (
        <BookCallButton
          taskId={fx.TASK}
          clientName={fx.NAME}
          kind="checkin"
          onBooked={r => p.onBooked(r.startTime)}
        >
          {live ? "Book the next check-in" : "Book the next check-in"}
        </BookCallButton>
      )}
    />
  );
}

async function mount(
  scenario: Scenario = {},
  opts: { rehearse?: boolean; seat?: "csm" | "admin"; messages?: any } = {},
) {
  const fake = fx.fakeCheckin(scenario);
  const t = fakeClock();
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as unknown as Element);
  roots.push(root);
  await act(async () =>
    root.render(
      <Harness
        fake={fake}
        seat={opts.seat ?? scenario.seat ?? "admin"}
        rehearse={Boolean(opts.rehearse)}
        clock={t.clock}
        live={scenario.mode === "live"}
        messages={opts.messages}
      />,
    ),
  );
  await settle();
  return { fake, t };
}

/** The saves of one key, in order, as the server received them. */
const saves = (fake: ReturnType<typeof fx.fakeCheckin>, key: string) =>
  fake.calls
    .filter(c => c.name === "save")
    .map(c => (c.args as any).changes[key])
    .filter(Boolean);

afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  win.document.body.innerHTML = "";
  win.sessionStorage.clear();
  toasts.length = 0;
  bookings.length = 0;
  opened = 0;
  model = null;
});
afterAll(async () => {
  await win.happyDOM.close();
  for (const [k, d] of before) {
    if (d) Object.defineProperty(globalThis, k, d);
    else delete (globalThis as any)[k];
  }
});

const READY = {
  todos: fx.TODOS_READY,
  client_notes: fx.NOTES_READY,
  defcon_priority: fx.DEFCON_READY,
};

// ------------------------------------------------------------ opening

describe("opening", () => {
  test("loading, then an admin's shadow run on the seal and in the banner", async () => {
    await mount({ hold: ["open"] });
    expect(page()).toContain("Loading the notes…");
    for (const r of roots.splice(0)) await act(async () => r.unmount());
    win.document.body.innerHTML = "";
    const { fake } = await mount({ drafts: READY });
    expect(page()).toContain(
      "Shadow run. Your notes are saved in the cockpit and every effect is written down as a plan. Nothing reaches the card, Slack or the client; Make still does all of it from the Typeform.",
    );
    expect(page()).toContain("Shadow · notes for");
    expect(page()).toContain(fx.NAME);
    // The browser's own response ID opened the draft.
    expect((fake.calls[0]?.args as any)?.responseId).toBe(fx.NEW_ID);
    expect(button("Open the 1-1 form")).toBeUndefined();
  });

  test("a CSM seat's banner sends her to the Typeform, which stays the record", async () => {
    await mount({ drafts: READY }, { seat: "csm" });
    expect(page()).toContain(
      "Shadow run. The Typeform is still the record. Fill it as usual so Make updates the card, grades the call and drafts the recap.",
    );
    await click(button("Open the 1-1 form"));
    expect(opened).toBe(1);
  });

  test("the notes stay closed with a plain sentence and the next step", async () => {
    const cases: [string, string, string][] = [
      [
        "That client is not on your access list",
        "This client is not on your list, so the 1-1 notes cannot open here. Ask your lead to add this client, then try again.",
        "Close this window",
      ],
      [
        "The client roster is incomplete. Refresh its native source",
        "The client list is refreshing. Try again in a minute.",
        "Try again",
      ],
      [
        "The cockpit's 1-1 notes are not live yet.",
        "The cockpit's 1-1 notes are not live yet. Use the 1-1 form in Typeform for now.",
        "Open the 1-1 form",
      ],
      [
        "Failed to fetch",
        "The client's record could not be read, so the notes stay closed: notes without the right card reach no one.",
        "Try again",
      ],
    ];
    for (const [error, text, action] of cases) {
      await mount({ open: "fail", openError: error });
      expect(page()).toContain(text);
      expect(button(action)).toBeTruthy();
      for (const r of roots.splice(0)) await act(async () => r.unmount());
      win.document.body.innerHTML = "";
    }
  });

  test("a rehearsal saves nothing and is drawn read only", async () => {
    const { fake } = await mount({ drafts: READY }, { rehearse: true });
    expect(page()).toContain(
      "Rehearsal. Nothing is saved, nothing reaches the card, and nothing is sent.",
    );
    expect((fake.calls[0]?.args as any)?.rehearse).toBe(true);
    expect((fake.calls[0]?.args as any)?.responseId).toBeNull();
    expect(radios().every(r => r.disabled)).toBe(true);
    // A rehearsal is not a shadow run: its button reads Send and is off.
    expect(sendButton()).toBeUndefined();
    expect(button("Send")?.disabled).toBe(true);
    expect(page()).toContain("Rehearsal: nothing is sent.");
    expect(fake.count("save")).toBe(0);
    expect(fake.count("drafts")).toBe(0);
  });

  test("resumed: when the notes were started, and everything typed is there", async () => {
    await mount({ open: "resumed", answers: fx.FILLED });
    expect(page()).toContain(
      "You started these notes at 10:02 on Sun 25 Oct. Everything you typed is here.",
    );
    expect(radio("At risk")?.getAttribute("aria-checked")).toBe("true");
  });

  test("an ID kept for this seat's discarded notes, or another seat's, opens new notes with no error", async () => {
    const kept = `mahara-checkin-response:${fx.TASK}`;
    for (const open of ["void", "other_seat"] as const) {
      win.sessionStorage.setItem(kept, fx.RESPONSE_ID);
      const { fake } = await mount({ open });
      // The kept ID first, then a new one minted by the window.
      expect(
        fake.calls
          .filter(c => c.name === "open")
          .map(c => (c.args as any).responseId),
      ).toEqual([fx.RESPONSE_ID, fx.NEW_ID]);
      expect(model.phase).toEqual({ kind: "ready" });
      expect(model.response).toMatchObject({ id: fx.NEW_ID, state: "draft" });
      expect(win.sessionStorage.getItem(kept)).toBe(fx.NEW_ID);
      // No sentence that the notes stay closed, nothing of the old notes.
      expect(page()).not.toContain("could not be read");
      expect(button("Try again")).toBeUndefined();
      expect(
        radios().some(r => r.getAttribute("aria-checked") === "true"),
      ).toBe(false);
      expect(page()).toContain("Same room as the check-in booked for 10:30.");
      const saved = fake.calls
        .filter(c => c.name === "save")
        .map(c => (c.args as any).responseId);
      expect(saved.length).toBeGreaterThan(0);
      expect(saved.every(id => id === fx.NEW_ID)).toBe(true);
      for (const r of roots.splice(0)) await act(async () => r.unmount());
      win.document.body.innerHTML = "";
    }
  });

  test("unsent notes for an older call: finish them, or start notes for this call", async () => {
    const team = fx.VIEWS.team;
    const { fake } = await mount({
      open: "resumed",
      answers: {
        ...fx.FILLED,
        call: {
          kind: "fathom",
          recordingId: team.recordingId,
          why: "picked",
          confirmed: true,
          startsAt: team.startsAt,
          endsAt: team.endsAt,
        },
      },
      others: [team],
    });
    // The newest call is named, on the banner and on its button: the card
    // above still shows the older call these notes were for.
    expect(page()).toContain(
      "You have unsent notes for the 24 Oct call. The newest call is Sun 25 Oct, 10:34.",
    );
    expect(page()).toContain(
      "Starting notes for the 25 Oct call discards these.",
    );
    expect(button("Start notes for this call")).toBeUndefined();
    expect(button("Finish them")).toBeTruthy();
    // At most two banners above the card: the run's, then this one.
    expect(
      win.document.body.querySelectorAll('main [role="note"]').length,
    ).toBeLessThanOrEqual(2);
    await click(button("Start notes for the 25 Oct call"));
    expect(fake.count("discard")).toBe(1);
    expect(fake.count("open")).toBe(2);
  });

  test("already sent in the Typeform for this call: said, and the shadow send still works", async () => {
    await mount({
      picked: {
        ...fx.VIEWS.same_room,
        notesAlready: { at: "2026-10-25T08:10:00Z", source: "typeform" },
      },
    });
    expect(page()).toContain(
      "This call already has 1-1 notes in the Typeform, sent at 11:10.",
    );
    expect(button("Pick another call")).toBeTruthy();
    await click(radio("Happy"));
    await click(radio("Low"));
    expect(sendButton()?.disabled).toBe(false);
  });

  test("a CSM whose call the Typeform already holds is never sent to fill a second one", async () => {
    await mount(
      {
        picked: {
          ...fx.VIEWS.same_room,
          notesAlready: { at: "2026-10-25T08:10:00Z", source: "typeform" },
        },
        drafts: READY,
      },
      { seat: "csm" },
    );
    expect(page()).toContain(
      "Shadow run. The Typeform is still the record, and there is nothing more to fill there for this call.",
    );
    expect(page()).not.toContain("Fill it as usual");
    expect(button("Open the 1-1 form")).toBeUndefined();
    await fillAndSend();
    expect(page()).toContain(
      "The Typeform already has this call's 1-1 notes, sent at 11:10, so there is nothing more to send.",
    );
    expect(page()).not.toContain("Now send the 1-1 form in Typeform");
    expect(button("Open the 1-1 form")).toBeUndefined();
    expect(opened).toBe(0);
  });

  test("a shadow draft after the cut-over is discarded and started again", async () => {
    const { fake } = await mount({
      open: "resumed",
      answers: fx.FILLED,
      formMode: "live",
    });
    expect(page()).toContain(
      "These notes were started as a shadow run. Discard them and start again.",
    );
    expect(sendButton()?.disabled).toBe(true);
    // Disabled with its reason beside it (8.1).
    expect(page()).toContain("Discard these notes and start again to send.");
    await click(button("Discard and start again"));
    expect(fake.count("discard")).toBe(1);
  });
});

// ------------------------------------------------------------ this call

describe("this call", () => {
  test("an exact pick is saved confirmed; Send then waits for DEFCON and priority", async () => {
    const { fake } = await mount({ drafts: READY });
    expect(page()).toContain("Same room as the check-in booked for 10:30.");
    expect(page()).toContain("12 action items · Summary");
    expect(saves(fake, "call")[0]?.value).toMatchObject({
      kind: "fathom",
      recordingId: "190000101",
      why: "same_room",
      confirmed: true,
    });
    expect(page()).toContain("Pick DEFCON and priority to send.");
  });

  for (const [name, v] of [
    ["likely", fx.VIEWS.likely],
    ["possible", fx.VIEWS.possible_csm],
    ["default", fx.VIEWS.default_csm],
  ] as const)
    test(`a ${name} pick holds Send with the confirm sentence until "Yes, this call"`, async () => {
      const { fake } = await mount(
        { picked: v, drafts: READY },
        { seat: "csm" },
      );
      expect(page()).toContain(v.whyText);
      expect(saves(fake, "call")[0]?.value.confirmed).toBe(false);
      await click(radio("Neutral"));
      await click(radio("Medium"));
      expect(page()).toContain(
        "Confirm the call: press Yes, this call, or pick another.",
      );
      expect(sendButton()?.disabled).toBe(true);
      await click(button("Yes, this call"));
      expect(saves(fake, "call").at(-1)?.value).toMatchObject({
        why: v.why,
        confirmed: true,
      });
      expect(page()).not.toContain("Is this the call?");
      expect(sendButton()?.disabled).toBe(false);
    });

  test("the why texts read Your for the recorder and The CSM's for an admin", () => {
    const near = { ...fx.VIEWS.possible_csm, whyText: "" };
    expect(whySentence(near, "csm", fx.NAME)).toBe(
      "Your recording 4 minutes after the check-in booked for 10:30. Is this the call?",
    );
    expect(whySentence(near, "admin", fx.NAME)).toBe(
      "The CSM's recording 4 minutes after the check-in booked for 10:30. Is this the call?",
    );
    const newest = { ...fx.VIEWS.default_csm, whyText: "" };
    expect(whySentence(newest, "csm", fx.NAME)).toBe(
      "Your newest call that no client has yet (Sun 25 Oct, 10:34). Is this the call?",
    );
    expect(whySentence(newest, "admin", fx.NAME)).toBe(
      "The CSM's newest call that no client has yet (Sun 25 Oct, 10:34). Is this the call?",
    );
    // The server's own sentence wins: it knows who recorded the call.
    expect(whySentence(fx.VIEWS.possible_admin, "csm", fx.NAME)).toBe(
      fx.VIEWS.possible_admin.whyText,
    );
    expect(
      whySentence({ ...fx.VIEWS.likely, whyText: "" }, "admin", fx.NAME),
    ).toBe(`${fx.NAME}'s contact spoke on this call. Is this the call?`);
    expect(
      whySentence({ ...fx.VIEWS.booking, whyText: "" }, "csm", fx.NAME),
    ).toBe("The check-in booked for 10:30. No recording found for it.");
    // A hint before its booking, in A7.3's words, the server's or built here.
    const hint = `25 min before ${fx.NAME}'s booked call.`;
    expect(whySentence(fx.VIEWS.hint, "csm", fx.NAME)).toBe(hint);
    expect(
      whySentence({ ...fx.VIEWS.hint, whyText: "" }, "admin", fx.NAME),
    ).toBe(hint);
    // A recording with no sign for this client has no why line.
    expect(whySentence(fx.VIEWS.no_sign, "csm", fx.NAME)).toBe("");
    expect(whySentence(fx.VIEWS.team, "admin", fx.NAME)).toBe("");
  });

  test("a view's blocked sentence parses as text or null; a booked call has no recorder", () => {
    const { blocked: _, ...older } = fx.VIEWS.same_room;
    expect(callView.parse(older).blocked).toBeNull();
    expect(callView.parse(fx.VIEWS.same_room).blocked).toBeNull();
    expect(callView.parse(fx.VIEWS.gone).blocked).toBe(
      "Fathom no longer has that recording. Pick another call.",
    );
    expect(callView.safeParse({ ...older, blocked: 1 }).success).toBe(false);
    expect(callView.parse(fx.VIEWS.booking)).toMatchObject({
      kind: "booking",
      recorder: null,
      recorderRole: null,
    });
  });

  test("a booked call with no recording, and no recording at all", async () => {
    await mount({ picked: fx.VIEWS.booking });
    expect(page()).toContain(
      "The check-in booked for 10:30. No recording found for it.",
    );
    for (const r of roots.splice(0)) await act(async () => r.unmount());
    win.document.body.innerHTML = "";
    // A shadow run puts nothing on the card, so the line does not say it does.
    await mount({ answers: { call: { kind: "none", why: "none" } } });
    expect(page()).toContain(
      "No recording. The call is not graded and no recap is drafted.",
    );
    expect(page()).not.toContain("The notes go on the card");
    for (const r of roots.splice(0)) await act(async () => r.unmount());
    win.document.body.innerHTML = "";
    // A live response (2b) does.
    await mount({
      mode: "live",
      answers: { call: { kind: "none", why: "none" } },
    });
    expect(page()).toContain(
      "No recording. The notes go on the card without one; the call is not graded and no recap is drafted.",
    );
  });

  test("no call picked yet: the card says where it stands, and the send bar says what to do, once", async () => {
    await mount({ picked: null });
    expect(thisCall()?.textContent ?? "").toContain("No call picked yet.");
    expect(
      page().split("Pick the call these notes are for, or choose No recording.")
        .length - 1,
    ).toBe(1);
  });

  test("the card's teal links lean to the text colour, so 12px words hold 4.5:1 on its tint", async () => {
    await mount({ drafts: READY });
    const ink =
      "text-[color:color-mix(in_oklab,var(--primary-ink)_90%,var(--foreground))]";
    expect(String(button("View transcript")?.className)).toContain(ink);
    const fathom = Array.from(thisCall()?.querySelectorAll("a") ?? []).find(
      a => (a as any).textContent.trim() === "Open in Fathom",
    ) as any;
    expect(String(fathom?.className)).toContain(ink);
  });

  test("a booking refused on save says why, and the call is picked again", async () => {
    for (const text of [
      "That booked call has not happened yet.",
      "That booked call was cancelled. Pick its recording or No recording.",
    ]) {
      await mount({
        picked: fx.VIEWS.booking,
        saveRefusal: { key: "call", text },
      });
      expect(page()).toContain(text);
      expect(page()).toContain(
        "Pick the call these notes are for, or choose No recording.",
      );
      for (const r of roots.splice(0)) await act(async () => r.unmount());
      win.document.body.innerHTML = "";
    }
  });

  test("Fathom waiting, failed, busy and off", async () => {
    const { fake } = await mount({
      picked: null,
      fathom: {
        state: "waiting",
        checkedAt: "2026-10-25T08:03:00Z",
        note: null,
      },
    });
    expect(page()).toContain(
      "Fathom hasn't sent this call yet. It usually takes a few minutes after the call ends.",
    );
    expect(page()).toContain("Checked at 11:03.");
    await click(button("Check again"));
    expect(
      (fake.calls.filter(c => c.name === "calls").at(-1)?.args as any)?.refresh,
    ).toBe(true);
    const states: [Scenario["fathom"], string][] = [
      [
        {
          state: "failed",
          checkedAt: fx.NOW,
          note: "Fathom could not be read just now (503).",
        },
        "Fathom could not be read just now: 503. Check again, paste the Fathom link, or choose No recording.",
      ],
      [
        { state: "busy", checkedAt: fx.NOW, note: null },
        "Fathom is busy. Check again in a minute.",
      ],
      [{ state: "off", checkedAt: null, note: fx.OFF_ASK }, fx.OFF_ASK],
      // An answer with no note still says where calls come from.
      [{ state: "off", checkedAt: null, note: null }, fx.OFF_NOTE],
    ];
    for (const [fathom, text] of states) {
      for (const r of roots.splice(0)) await act(async () => r.unmount());
      win.document.body.innerHTML = "";
      await mount({ picked: null, fathom });
      expect(page()).toContain(text);
      expect(page()).not.toContain("pick the booked call");
    }
  });

  test("no Fathom key: the seat's sentence and Check again, under a picked booking too, and in the Change sheet", async () => {
    // The CEO is told where to paste the key.
    await mount({
      picked: null,
      others: [fx.VIEWS.booking],
      fathom: { state: "off", checkedAt: null, note: fx.OFF_PASTE },
    });
    expect(page()).toContain(fx.OFF_PASTE);
    for (const r of roots.splice(0)) await act(async () => r.unmount());
    win.document.body.innerHTML = "";
    // A CSM whose booking is picked, with a recording already in the store.
    const { fake } = await mount(
      {
        picked: fx.VIEWS.booking,
        others: [fx.VIEWS.hint],
        fathom: { state: "off", checkedAt: null, note: fx.OFF_ASK },
      },
      { seat: "csm" },
    );
    expect(page()).toContain(
      "The check-in booked for 10:30. No recording found for it.",
    );
    expect(page()).toContain(fx.OFF_ASK);
    expect(page()).not.toContain("pick the booked call");
    // The cockpit's own read time, and Check again reads the store again
    // (the worker's next 15-minute read can bring the recording).
    expect(page()).toContain("Checked at 11:30.");
    await click(button("Check again"));
    expect(
      (fake.calls.filter(c => c.name === "calls").at(-1)?.args as any)?.refresh,
    ).toBe(true);
    // The sheet lists the store's recording and says why only those.
    await click(button("Change"));
    expect(page()).toContain("Recordings since yesterday");
    expect(page()).toContain(`25 min before ${fx.NAME}'s booked call.`);
    const sheet = win.document.body.querySelector('[role="dialog"]');
    expect(sheet?.textContent).toContain(fx.OFF_ASK);
    for (const r of roots.splice(0)) await act(async () => r.unmount());
    win.document.body.innerHTML = "";
    // No recording at all: the sheet's line is the same sentence.
    await mount({
      picked: null,
      others: [fx.VIEWS.booking],
      fathom: { state: "off", checkedAt: null, note: fx.OFF_ASK },
    });
    await click(button("Pick the call"));
    expect(
      win.document.body.querySelector('[role="dialog"]')?.textContent,
    ).toContain(fx.OFF_ASK);
    expect(page()).not.toContain("No recording since yesterday yet.");
  });

  test("the Change sheet: recordings since yesterday, another client's disabled, a pick", async () => {
    const { fake } = await mount({
      others: [fx.VIEWS.team, fx.VIEWS.other_client, fx.VIEWS.booking],
      drafts: READY,
    });
    await click(button("Change"));
    expect(page()).toContain("Pick the call");
    expect(page()).toContain("Recordings since yesterday");
    expect(page()).toContain(
      `On ${fx.OTHER}. If that is wrong, ask an admin to move it.`,
    );
    expect(page()).toContain("Has notes");
    const other = buttons().find(b =>
      (b.textContent ?? "").includes("Site visit follow-up"),
    );
    expect(other?.disabled).toBe(true);
    const team = buttons().find(b =>
      (b.textContent ?? "").includes("Content review"),
    );
    await click(team);
    expect(saves(fake, "call").at(-1)).toMatchObject({
      value: {
        recordingId: fx.VIEWS.team.recordingId,
        why: "picked",
        confirmed: true,
      },
      from: "pick",
    });
    expect(page()).toContain("You picked it.");
    // The drafts were for the first recording.
    expect(page()).toContain("The drafts were for the 10:34 recording.");
    expect(button("Draft again from this call")).toBeTruthy();
  });

  test("the Change sheet's rows: no why line without a sign, no recorder on a booked call, a blocked one disabled with its sentence", async () => {
    const { fake } = await mount({
      others: [
        fx.VIEWS.hint,
        fx.VIEWS.no_sign,
        fx.VIEWS.team,
        fx.VIEWS.gone,
        // A booking view never carries a recorder; one that did shows none.
        {
          ...fx.VIEWS.booking,
          recorder: "team",
          recorderRole: "the creative director",
        },
      ],
      drafts: READY,
    });
    await click(button("Change"));
    const row = (text: string) =>
      buttons().find(b => (b.textContent ?? "").includes(text));
    // The title line only.
    expect(row("Impromptu Zoom Meeting")?.children.length).toBe(1);
    // Who recorded it, and no why.
    expect(row("Content review")?.lastElementChild?.textContent).toBe(
      "By the creative director",
    );
    expect(row("25 min before")?.lastElementChild?.textContent).toBe(
      `25 min before ${fx.NAME}'s booked call.`,
    );
    const booked = row("Booked check-in");
    expect(booked?.lastElementChild?.textContent).toBe(
      "The check-in booked for 10:30. No recording found for it.",
    );
    expect(booked?.textContent).not.toContain("By ");
    const gone = row("Fathom no longer has that recording");
    expect(gone?.disabled).toBe(true);
    expect(gone?.lastElementChild?.textContent).toBe(
      "Fathom no longer has that recording. Pick another call.",
    );
    const before = saves(fake, "call").length;
    await act(async () => model.pick(fx.VIEWS.gone));
    await settle();
    expect(saves(fake, "call").length).toBe(before);
    // A plain recording is still picked with a click.
    await click(row("Impromptu Zoom Meeting"));
    expect(saves(fake, "call").at(-1)?.value).toMatchObject({
      recordingId: fx.VIEWS.no_sign.recordingId,
      why: "picked",
      confirmed: true,
    });
  });

  test("the CSM's sheet: a recording on a client she may not see shows only its time, length and recorder; one from outside Customer Success says to ask an admin", async () => {
    const { fake } = await mount(
      {
        others: [fx.VIEWS.no_sign, fx.VIEWS.unnamed, fx.VIEWS.outside_cs],
        drafts: READY,
      },
      { seat: "csm" },
    );
    await click(button("Change"));
    const row = (text: string) =>
      buttons().find(b => (b.textContent ?? "").includes(text));
    const unnamed = row(fx.UNNAMED);
    expect(unnamed?.disabled).toBe(true);
    // No title of its own, no marks: when, how long, who, and the sentence.
    expect(unnamed?.textContent).toBe(
      `Fathom recordingSat 24 Oct 18:00–18:30 · 30 minBy the account manager · ${fx.UNNAMED}`,
    );
    expect(unnamed?.textContent).not.toContain("Has notes");
    const outside = row(fx.OUTSIDE_CS);
    expect(outside?.disabled).toBe(true);
    expect(outside?.lastElementChild?.textContent).toBe(
      `By the sales closer · ${fx.OUTSIDE_CS}`,
    );
    // Neither is ever picked, by a click or by the model.
    const before = saves(fake, "call").length;
    await act(async () => model.pick(fx.VIEWS.unnamed));
    await act(async () => model.pick(fx.VIEWS.outside_cs));
    await settle();
    expect(saves(fake, "call").length).toBe(before);
  });

  test("a disabled row keeps 'By an admin' though every refusal says 'ask an admin'; a pickable why line that names the recorder still drops it", async () => {
    const admin = "an admin";
    const { fake } = await mount(
      {
        others: [
          // On this client by a name only (A7.14 rule 2): the second sentence.
          fx.VIEWS.outside_cs_likely,
          { ...fx.VIEWS.outside_cs, recorderRole: admin },
          { ...fx.VIEWS.unnamed, recorderRole: admin },
          // A pickable row whose built why line already names the recorder.
          {
            ...fx.VIEWS.possible_admin,
            ref: "fathom:190000111",
            recordingId: "190000111",
            title: "Pricing follow-up",
            whyText: "",
            recorder: "other",
            recorderRole: "the sales closer",
          },
        ],
        drafts: READY,
      },
      { seat: "csm" },
    );
    await click(button("Change"));
    const row = (text: string) =>
      buttons().find(b => (b.textContent ?? "").includes(text));
    expect(fx.VIEWS.outside_cs_likely.recorderRole).toBe(admin);
    for (const sentence of [fx.OUTSIDE_CS_LIKELY, fx.OUTSIDE_CS, fx.UNNAMED]) {
      expect(sentence).toContain("ask an admin");
      const r = row(sentence);
      expect(r?.disabled).toBe(true);
      expect(r?.lastElementChild?.textContent).toBe(
        `By ${admin} · ${sentence}`,
      );
    }
    // The two tie sentences are never confused: on this client by a name
    // reads the second, not "is not on this client".
    expect(row(fx.OUTSIDE_CS_LIKELY)?.textContent).not.toContain(
      "is not on this client",
    );
    const pickable = row("Pricing follow-up");
    expect(pickable?.disabled).toBe(false);
    expect(pickable?.lastElementChild?.textContent).toBe(
      "The sales closer's recording 4 minutes after the check-in booked for 10:30.",
    );
    // None of the disabled rows is ever picked.
    const before = saves(fake, "call").length;
    await act(async () => model.pick(fx.VIEWS.outside_cs_likely));
    await settle();
    expect(saves(fake, "call").length).toBe(before);
  });

  test("a blocked recording the store picked is never picked, and Yes is not offered", async () => {
    for (const picked of [
      {
        ...fx.VIEWS.likely,
        blocked: "Fathom no longer has that recording. Pick another call.",
      },
      {
        ...fx.VIEWS.hint,
        blocked: "That recording is a team meeting, not a client call.",
      },
    ]) {
      const { fake } = await mount({ picked, drafts: READY });
      expect(saves(fake, "call")).toEqual([]);
      expect(fake.count("drafts")).toBe(0);
      expect(button("Yes, this call")).toBeUndefined();
      expect(page()).toContain(
        "Pick the call these notes are for, or choose No recording.",
      );
      await act(async () => model.confirmCall());
      await settle();
      expect(saves(fake, "call")).toEqual([]);
      await click(button("Pick the call"));
      const row = buttons().find(b =>
        (b.textContent ?? "").includes(picked.blocked),
      );
      expect(row?.disabled).toBe(true);
      for (const r of roots.splice(0)) await act(async () => r.unmount());
      win.document.body.innerHTML = "";
    }
  });

  test("a saved call that can no longer be used says why and holds Send", async () => {
    const text = "Fathom no longer has that recording. Pick another call.";
    const guessed = {
      kind: "fathom",
      recordingId: fx.VIEWS.likely.recordingId,
      why: "speaker_name",
      confirmed: false,
    };
    for (const [call, view] of [
      [fx.FILLED.call, fx.VIEWS.same_room],
      [guessed, fx.VIEWS.likely],
    ] as const) {
      await mount({
        open: "resumed",
        answers: { ...fx.FILLED, call },
        picked: { ...view, blocked: text },
      });
      expect(page()).toContain(text);
      expect(page()).not.toContain("Is this the call?");
      expect(button("Yes, this call")).toBeUndefined();
      expect(button("Change")).toBeTruthy();
      // Every answer is there, yet nothing goes out on this call.
      expect(sendButton()?.disabled).toBe(true);
      for (const r of roots.splice(0)) await act(async () => r.unmount());
      win.document.body.innerHTML = "";
    }
  });

  test("a pasted link: unknown, not Fathom's, found, blocked, or beside an earlier 1-1 form's link", async () => {
    const paste = async (scenario: Scenario) => {
      for (const r of roots.splice(0)) await act(async () => r.unmount());
      win.document.body.innerHTML = "";
      const out = await mount(scenario);
      await click(button("Change"));
      const input = win.document.body.querySelector('input[type="url"]') as any;
      await act(async () => {
        const set = Object.getOwnPropertyDescriptor(
          win.HTMLInputElement.prototype,
          "value",
        )?.set;
        set?.call(
          input,
          "https://fathom.video/share/EXAMPLEbbbb2222?timestamp=30",
        );
        input.dispatchEvent(new win.Event("input", { bubbles: true }));
      });
      await click(button("Find it"));
      return out;
    };
    await paste({ paste: "unknown" });
    expect(page()).toContain(
      "That link is not in the cockpit yet. Fathom sends recordings a few minutes after a call ends. Check again in a minute.",
    );
    await paste({ paste: "not_fathom" });
    expect(page()).toContain("That is not a Fathom link.");
    const { fake } = await paste({ paste: "found" });
    expect(saves(fake, "call").at(-1)?.value).toMatchObject({ why: "pasted" });
    expect(page()).toContain("From the Fathom link you pasted.");
    // A pasted recording that cannot be used for this client: its sentence,
    // listed disabled, and the call stays as it was.
    const notes = () =>
      Array.from(win.document.body.querySelectorAll('p[role="status"]')).map(
        p => ((p as any).textContent ?? "").trim(),
      );
    for (const [kind, text] of [
      ["team_meeting", "That recording is a team meeting, not a client call."],
      ["gone", "Fathom no longer has that recording. Pick another call."],
      [
        "other_client",
        `On ${fx.OTHER}. If that is wrong, ask an admin to move it.`,
      ],
    ] as const) {
      const { fake } = await paste({ paste: kind });
      expect(notes()).toContain(text);
      expect(
        saves(fake, "call").some(
          c => c.value.recordingId === fx.VIEWS[kind].recordingId,
        ),
      ).toBe(false);
      expect(saves(fake, "call").at(-1)?.value).toMatchObject({
        recordingId: fx.VIEWS.same_room.recordingId,
      });
      // The sheet stays open on the paste box.
      expect(win.document.body.querySelector('input[type="url"]')).toBeTruthy();
      const row = buttons().find(b => (b.textContent ?? "").includes(text));
      expect(row?.disabled).toBe(true);
    }
    // A recording whose link is in an earlier 1-1 form reads as pasted too:
    // the pasted link, then a blocked one, says which view the paste found.
    const found = await paste({ picked: fx.VIEWS.form_link, paste: "found" });
    expect(saves(found.fake, "call").at(-1)?.value).toMatchObject({
      recordingId: fx.VIEWS.team.recordingId,
      why: "pasted",
    });
    const team = await paste({
      picked: fx.VIEWS.form_link,
      paste: "team_meeting",
    });
    expect(notes()).toContain(
      "That recording is a team meeting, not a client call.",
    );
    expect(saves(team.fake, "call").at(-1)?.value).toMatchObject({
      recordingId: fx.VIEWS.form_link.recordingId,
    });
    // Picked from that earlier form's link, the card says so.
    for (const r of roots.splice(0)) await act(async () => r.unmount());
    win.document.body.innerHTML = "";
    await mount({ picked: fx.VIEWS.form_link });
    expect(page()).toContain("From the link in an earlier 1-1 form.");
    expect(page()).not.toContain("From the Fathom link you pasted.");
  });

  test("no transcript yet: open the call in Fathom", async () => {
    const open = win.open;
    (win as any).open = () => null;
    try {
      await mount({ drafts: READY, transcript: "none" });
      await click(button("View transcript"));
      expect(page()).toContain("No transcript yet. Open the call in Fathom.");
    } finally {
      win.open = open;
    }
  });
});

// ------------------------------------------------------------ answers and drafts

describe("answers and drafts", () => {
  test("DEFCON and priority are never chosen by a draft, before or after the window opens", async () => {
    // Ready before the window opens, and the card has a value.
    const { fake } = await mount({ drafts: READY, happiness: "Happy" });
    expect(page()).toContain(
      'Suggested: At risk. "If the next batch is the same, we will pause in December." at 12:41',
    );
    expect(page()).toContain("On the card: Happy");
    expect(radios().some(r => r.getAttribute("aria-checked") === "true")).toBe(
      false,
    );
    expect(saves(fake, "defcon")).toEqual([]);
    expect(sendButton()?.disabled).toBe(true);
    // A click chooses, and saves at once with its source.
    await click(radio("At risk"));
    expect(radio("At risk")?.getAttribute("aria-checked")).toBe("true");
    expect(saves(fake, "defcon")[0]).toMatchObject({
      value: "At Risk",
      from: "pick",
    });
    // So does "Use it", with the draft as its source.
    const use = buttons().filter(
      b => (b.textContent ?? "").trim() === "Use it",
    );
    await click(use.at(-1));
    expect(saves(fake, "priority")[0]).toMatchObject({
      value: "High",
      from: "ai.priority",
    });
    expect(sendButton()?.disabled).toBe(false);
  });

  test("a draft that arrives after the window opened chooses nothing either", async () => {
    const { fake, t } = await mount({
      happiness: "Happy",
      drafts: {
        todos: fx.TODOS_READY,
        client_notes: [fx.draft("client_notes", "drafting"), fx.NOTES_READY],
        defcon_priority: [
          fx.draft("defcon_priority", "drafting"),
          fx.DEFCON_READY,
        ],
      },
    });
    expect(page()).toContain("Reading the call…");
    await t.advance(61_000);
    expect(fake.count("drafts")).toBeGreaterThan(1);
    expect(page()).toContain("Suggested: At risk.");
    expect(radios().some(r => r.getAttribute("aria-checked") === "true")).toBe(
      false,
    );
    expect(page()).toContain("Pick DEFCON and priority to send.");
  });

  test("the DEFCON line says what the card holds, or that it holds nothing", async () => {
    await mount({ happiness: null });
    expect(page()).toContain("Not set on the card");
  });

  test("the DEFCON hint never says the card follows in a shadow run or a rehearsal", async () => {
    const SHADOW_HINT = "How the client feels after this call. You pick it.";
    const LIVE_HINT =
      "How the client feels after this call. You pick it; the card's Client Happiness follows.";
    await mount({ drafts: READY });
    expect(page()).toContain(SHADOW_HINT);
    expect(page()).not.toContain("Client Happiness follows");
    for (const r of roots.splice(0)) await act(async () => r.unmount());
    win.document.body.innerHTML = "";
    await mount({ drafts: READY }, { rehearse: true });
    expect(page()).toContain(SHADOW_HINT);
    expect(page()).not.toContain("Client Happiness follows");
    for (const r of roots.splice(0)) await act(async () => r.unmount());
    win.document.body.innerHTML = "";
    // A live response (2b) writes the card: the registry's hint as written.
    await mount({ mode: "live", drafts: READY });
    expect(page()).toContain(LIVE_HINT);
    // Only a sentence or clause about the card goes; the rest is as written.
    expect(hintFor(LIVE_HINT, false)).toBe(SHADOW_HINT);
    expect(hintFor(LIVE_HINT, true)).toBe(LIVE_HINT);
    expect(hintFor("Pick one. The card's field follows it.", false)).toBe(
      "Pick one.",
    );
    expect(hintFor("Internal: their mood.", false)).toBe(
      "Internal: their mood.",
    );
    expect(hintFor(null, false)).toBe("");
  });

  test("the chosen DEFCON and priority are marked by more than colour, and focus by a ring of its own", async () => {
    await mount({ drafts: READY });
    await click(radio("At risk"));
    await click(radio("High"));
    for (const [on, off] of [
      ["At risk", "Happy"],
      ["High", "Low"],
    ]) {
      const chosen = radio(on);
      const other = radio(off);
      expect(chosen.querySelector("svg")).toBeTruthy();
      expect(other.querySelector("svg")).toBeNull();
      const c = String(chosen.className);
      expect(c).toContain("font-semibold");
      expect(c).toContain("inset-ring-2");
      expect(c).toContain("inset-ring-primary-ink");
      expect(String(other.className)).not.toContain("inset-ring-primary-ink");
      expect(String(other.className)).not.toContain("font-semibold");
      // Focus is a second ring, outside the pill.
      expect(c).toContain("focus-visible:ring-offset-2");
    }
  });

  test("the suggestion's other states", async () => {
    const cases: [Scenario["drafts"], string][] = [
      [
        { defcon_priority: fx.draft("defcon_priority", "drafting") },
        "Reading the call…",
      ],
      [
        { defcon_priority: fx.draft("defcon_priority", "off") },
        "AI drafts are off: no Anthropic key. Pick it yourself.",
      ],
      [
        {
          defcon_priority: fx.draft(
            "defcon_priority",
            "failed",
            null,
            "The draft took too long. Draft again.",
          ),
        },
        "The suggestion failed. Pick it yourself.",
      ],
      [
        { defcon_priority: fx.DEFCON_NO_QUOTE },
        "No clear quote. Pick it yourself.",
      ],
      [
        {
          defcon_priority: fx.draft(
            "defcon_priority",
            "skipped",
            null,
            fx.SUMMARY_WAIT,
          ),
        },
        fx.SUMMARY_WAIT,
      ],
    ];
    for (const [drafts, text] of cases) {
      await mount({ drafts });
      expect(page()).toContain(text);
      for (const r of roots.splice(0)) await act(async () => r.unmount());
      win.document.body.innerHTML = "";
    }
  });

  test("a wait for the transcript says the transcript, beside a card that has the summary", async () => {
    const { fake, t } = await mount({
      drafts: {
        todos: fx.TODOS_READY,
        client_notes: [
          fx.draft("client_notes", "skipped", null, fx.TRANSCRIPT_WAIT),
          fx.NOTES_READY,
        ],
        defcon_priority: fx.draft(
          "defcon_priority",
          "skipped",
          null,
          fx.TRANSCRIPT_WAIT,
        ),
      },
    });
    // The card says Fathom has the summary; the fields say what they wait for.
    const card = thisCall()?.textContent;
    expect(card).toContain("Summary");
    expect(page()).toContain(fx.TRANSCRIPT_WAIT);
    expect(page()).not.toContain(fx.SUMMARY_WAIT);
    // DEFCON, Priority and Client notes each wait, in the server's words;
    // no Draft again yet.
    expect(seen().split(fx.TRANSCRIPT_WAIT).length - 1).toBe(3);
    expect(button("Draft again")).toBeUndefined();
    // Still asked for, as for the summary.
    const reads = fake.count("drafts");
    await t.advance(60_000);
    expect(fake.count("drafts")).toBeGreaterThan(reads);
  });

  test("drafts fill the lists and the notes only while empty and untouched, and are saved with their source", async () => {
    const { fake } = await mount({ drafts: READY });
    expect(page()).toContain(
      "Send the revised offer with the new kitchen packages",
    );
    expect(page()).toContain("Share photos of the two finished villa projects");
    expect(page()).toContain("Draft · Fathom's action items");
    expect(page()).toContain("Draft · Fathom summary");
    expect(page()).toContain("Who owes this?");
    expect(
      buttons().some(
        b => b.getAttribute("aria-label") === "Remove this line from We owe",
      ),
    ).toBe(true);
    // Unsaved: nothing of the drafts reached the server yet.
    expect(saves(fake, "we_owe")).toEqual([]);
    expect(saves(fake, "client_notes")).toEqual([]);
    // An edit saves the field with the draft's source.
    await act(async () =>
      model.setNotes("Calm, and the budget moves in December."),
    );
    await act(async () => {
      await new Promise(r => setTimeout(r, 700));
    });
    await settle();
    expect(saves(fake, "client_notes")[0]).toMatchObject({
      value: "Calm, and the budget moves in December.",
      from: "ai.client_notes",
    });
    expect(page()).toContain("Edited");
    // Send saves the untouched drafts with their source first.
    await click(radio("Neutral"));
    await click(radio("High"));
    await click(sendButton());
    expect(saves(fake, "we_owe")[0]?.from).toBe("fathom.action_items");
    expect(saves(fake, "they_owe")[0]?.from).toBe("fathom.action_items");
    const first = fake.calls.findIndex(c => c.name === "submit");
    const last = fake.calls.map(c => c.name).lastIndexOf("save");
    expect(last).toBeLessThan(first);
  });

  test("a list typed in before Fathom's action items came keeps her lines and is offered them", async () => {
    const MINE = {
      text: "Call the architect about the showroom",
      owner: null,
      at: null,
      href: null,
      from: "csm",
      unsure: false,
    };
    const { fake } = await mount({
      open: "resumed",
      answers: { call: fx.FILLED.call, we_owe: [MINE] },
      drafts: READY,
    });
    // Her line stays; They owe, empty and untouched, takes its draft.
    expect(page()).toContain(MINE.text);
    expect(page()).toContain("Share photos of the two finished villa projects");
    // We owe's three action items are offered beside her line, once.
    expect(page()).toContain("Also in Fathom's action items · 3");
    expect(page().split("Also in Fathom's action items").length - 1).toBe(1);
    // Each Add (the next step's too) is a 24px box over its 16px words, and
    // the list sits 8px under the header row, so Add all and the first Add
    // never overlap (WCAG 2.5.8).
    const offer = buttons().filter(b =>
      /^Add (all 3 to We owe|to We owe: )/.test(
        b.getAttribute("aria-label") ?? "",
      ),
    );
    expect(offer.length).toBe(5);
    for (const b of offer)
      for (const c of ["h-6", "-my-1", "px-1", "-mx-1", "inline-flex"])
        expect([
          b.getAttribute("aria-label"),
          c,
          b.className.split(/\s+/).includes(c),
        ]).toEqual([b.getAttribute("aria-label"), c, true]);
    expect(
      String(offer[0].closest(".rounded-xl")?.className).split(/\s+/),
    ).toContain("space-y-2");
    const add = buttons().find(
      b =>
        b.getAttribute("aria-label") ===
        "Add to We owe: Send the revised offer with the new kitchen packages",
    );
    await act(async () => add.focus());
    await click(add);
    expect(page()).toContain("Also in Fathom's action items · 2");
    // The line it added takes focus.
    expect((win.document.activeElement as any)?.value).toBe(
      "Send the revised offer with the new kitchen packages",
    );
    await click(
      buttons().find(
        b => b.getAttribute("aria-label") === "Add all 2 to We owe",
      ),
    );
    expect(page()).not.toContain("Also in Fathom's action items");
    await act(async () => {
      await new Promise(r => setTimeout(r, 700));
    });
    await settle();
    const saved = (saves(fake, "we_owe").at(-1)?.value ?? []) as {
      text: string;
    }[];
    expect(saved.map(t => t.text)).toEqual([
      MINE.text,
      "Send the revised offer with the new kitchen packages",
      "Pause the villa campaign until the new photos are in",
      "Check why two leads came in without a phone number",
    ]);
  });

  test("a list the draft filled offers nothing back, so a line she removed stays gone", async () => {
    await mount({ drafts: READY });
    const remove = buttons().find(
      b => b.getAttribute("aria-label") === "Remove this line from We owe",
    );
    await click(remove);
    expect(page()).not.toContain("Also in Fathom's action items");
    for (const r of roots.splice(0)) await act(async () => r.unmount());
    win.document.body.innerHTML = "";
    // Saved from the draft in an earlier session: still nothing offered back.
    await mount({
      open: "resumed",
      answers: fx.FILLED,
      meta: {
        we_owe: { at: fx.NOW, from: "fathom.action_items", by: "Noor" },
        they_owe: { at: fx.NOW, from: "fathom.action_items", by: "Noor" },
      },
      drafts: READY,
    });
    expect(page()).toContain(
      "Send the revised offer with the new kitchen packages",
    );
    expect(page()).not.toContain("Also in Fathom's action items");
  });

  test("no action items, and Client notes with no DeepSeek key", async () => {
    await mount({
      drafts: {
        todos: fx.TODOS_NONE,
        client_notes: fx.draft("client_notes", "off"),
        defcon_priority: fx.DEFCON_READY,
      },
    });
    expect(page()).toContain(
      "Fathom found no action items. Add them yourself.",
    );
    expect(page()).toContain(
      "AI drafts are off: no DeepSeek key. Fill this by hand.",
    );
  });

  test("the Client notes hint stays in view under its label, said once", async () => {
    await mount({ drafts: READY });
    const area = Array.from(
      win.document.body.querySelectorAll("textarea"),
    ).find(t => (t as any).id?.endsWith("-notes")) as any;
    // The draft fills the field; the hint is still there, as its description.
    expect(area?.value).toBe(String(fx.NOTES_READY.output?.text));
    expect(area?.getAttribute("placeholder")).toBeNull();
    expect(
      win.document.getElementById(area?.getAttribute("aria-describedby"))
        ?.textContent,
    ).toBe(
      "Their mood, promises, risk talk (pause, cancel, budget), a testimonial offer.",
    );
    // "(internal)" is said by the label only.
    expect(page()).not.toContain("Internal: their mood");
  });

  test("a change made in another window: Use mine or Keep theirs", async () => {
    await mount({
      drafts: READY,
      conflict: { key: "client_notes", theirs: "Wants a call on Thursday." },
    });
    await act(async () => model.setNotes("Mine."));
    await act(async () => {
      await new Promise(r => setTimeout(r, 700));
    });
    await settle();
    expect(page()).toContain("Changed in another window at 11:05.");
    // The field shows theirs; hers is shown beside the choice.
    const notes = () =>
      Array.from(win.document.body.querySelectorAll("textarea")).find(t =>
        (t as any).id?.endsWith("-notes"),
      ) as any;
    expect(notes()?.value).toBe("Wants a call on Thursday.");
    expect(page()).toContain("Yours: Mine.");
    expect(button("Use mine")).toBeTruthy();
    await click(button("Keep theirs"));
    expect(page()).not.toContain("Changed in another window");
    expect(page()).not.toContain("Yours:");
    // A value in words: a choice by its label, a list line by line.
    expect(valueText("defcon", "At Risk")).toBe("At risk");
    expect(valueText("we_owe", [{ text: "One " }, { text: "Two" }])).toBe(
      "One · Two",
    );
    expect(valueText("client_notes", null)).toBe("");
  });

  test("Use mine puts her text back in the field", async () => {
    await mount({
      drafts: READY,
      conflict: { key: "client_notes", theirs: "Wants a call on Thursday." },
    });
    await act(async () => model.setNotes("Mine."));
    await act(async () => {
      await new Promise(r => setTimeout(r, 700));
    });
    await settle();
    await click(button("Use mine"));
    const notes = Array.from(
      win.document.body.querySelectorAll("textarea"),
    ).find(t => (t as any).id?.endsWith("-notes")) as any;
    expect(notes?.value).toBe("Mine.");
    expect(page()).not.toContain("Yours:");
  });

  test("the save line: as you type, saved, and not saved offline", async () => {
    await mount({ drafts: READY });
    expect(page()).toContain("Saved 11:30");
    for (const r of roots.splice(0)) await act(async () => r.unmount());
    win.document.body.innerHTML = "";
    await mount({ saveError: "Failed to fetch", picked: null });
    expect(page()).toContain("Changes save as you type.");
    await click(radio("Happy"));
    // The browser's own words ("Failed to fetch") become plain ones.
    expect(page()).toContain(
      "Not saved: the connection dropped. What you typed is kept here and saves when you are back online.",
    );
    expect(page()).not.toContain("Failed to fetch");
  });
});

// ------------------------------------------------------------ next check-in

describe("next check-in", () => {
  test("a shadow run and a rehearsal show the booking and book nothing", async () => {
    const empty = { ...fx.fixtureTimeline(), calls: [] };
    for (const rehearse of [false, true]) {
      await mount({ drafts: READY, timeline: empty }, { rehearse });
      expect(page()).toContain(
        "Booking is off in a shadow run. Book the next check-in from the client page as usual.",
      );
      expect(button("Book the next check-in")).toBeUndefined();
      for (const r of roots.splice(0)) await act(async () => r.unmount());
      win.document.body.innerHTML = "";
    }
    await mount({ drafts: READY });
    expect(page()).toContain("Booked: Mon 2 Nov, 10:30.");
    expect(bookings).toEqual([]);
  });

  test("a live response offers the booking", async () => {
    await mount({
      mode: "live",
      drafts: READY,
      timeline: { ...fx.fixtureTimeline(), calls: [] },
    });
    expect(page()).toContain("Not booked.");
    expect(button("Book the next check-in")).toBeTruthy();
    expect(page()).toContain(
      "7 to 14 days out for onboarding and early live clients, up to 30 for stable ones.",
    );
    expect(bookings).toEqual([]);
  });
});

// ------------------------------------------------------------ sending

async function fillAndSend() {
  await click(radio("At risk"));
  await click(radio("High"));
  await click(sendButton());
}

describe("sending", () => {
  test("a shadow send plans eight effects and says nothing reached anyone", async () => {
    const { fake } = await mount({ drafts: READY, hold: ["submit"] });
    await click(radio("At risk"));
    await click(radio("High"));
    await act(async () => {
      sendButton().click();
    });
    await settle();
    expect(page()).toContain("Sending in shadow…");
    for (const r of roots.splice(0)) await act(async () => r.unmount());
    win.document.body.innerHTML = "";
    const done = await mount({ drafts: READY });
    await fillAndSend();
    expect(page()).toContain(
      "Sent in shadow at 11:10. Nothing reached the card, Slack or the client.",
    );
    // The live region wraps the list, so the stops keep their list
    // semantics and a stop that changes is said alone.
    const trail = win.document.body.querySelector('[role="status"] > ol');
    expect(trail?.getAttribute("role")).toBeNull();
    expect(trail?.parentElement?.getAttribute("aria-live")).toBe("polite");
    expect(trail?.parentElement?.getAttribute("aria-atomic")).toBe("false");
    expect(trail?.querySelectorAll("li").length).toBe(8);
    expect(page()).toContain("Would set Client Happiness to At risk.");
    expect(page()).toContain(
      "Make still does all of this from the Typeform until the switch-over.",
    );
    expect(button("Open the 1-1 form")).toBeUndefined();
    const news = done.fake.calls.find(c => c.name === "announce")?.args as any;
    expect(news).toMatchObject({
      type: "sent",
      form: "checkin",
      taskId: fx.TASK,
      say: `Shadow run sent for ${fx.NAME}.`,
    });
    void fake;
  });

  test("a CSM seat's done line sends her to the Typeform", async () => {
    await mount({ drafts: READY }, { seat: "csm" });
    await fillAndSend();
    expect(page()).toContain(
      "Now send the 1-1 form in Typeform: it is still the record.",
    );
    await click(button("Open the 1-1 form"));
    expect(opened).toBe(1);
  });

  test("a refusal is the server's sentence; a lost gate says so", async () => {
    await mount({
      drafts: READY,
      submitRefusal: {
        text: "These notes changed in another window. Read them again, then send.",
        code: "40001",
      },
    });
    await fillAndSend();
    expect(page()).toContain(
      "These notes changed in another window. Read them again, then send.",
    );
    for (const r of roots.splice(0)) await act(async () => r.unmount());
    win.document.body.innerHTML = "";
    await mount({
      drafts: READY,
      submitRefusal: {
        text: "That client is not on your access list",
        code: "42501",
      },
    });
    await fillAndSend();
    expect(page()).toContain(GATE_LOST);
  });

  test("refused because another window saved: Read them again, then Send works, focus following", async () => {
    const { fake } = await mount({
      drafts: READY,
      submitRefusal: {
        text: "These notes changed in another window. Read them again, then send.",
        code: "40001",
      },
    });
    await fillAndSend();
    const again = button("Read them again");
    expect(again).toBeTruthy();
    expect(win.document.activeElement).toBe(again);
    // Send waits for the read: sending again would send the same old notes.
    expect(sendButton()?.disabled).toBe(true);
    const reads = fake.count("read");
    await click(again);
    expect(fake.count("read")).toBe(reads + 1);
    expect(button("Read them again")).toBeUndefined();
    expect(sendButton()?.disabled).toBe(false);
    expect(win.document.activeElement).toBe(sendButton());
    // Nothing she chose is lost.
    expect(radio("At risk")?.getAttribute("aria-checked")).toBe("true");
    expect(radio("High")?.getAttribute("aria-checked")).toBe("true");
  });

  test("a dropped connection is said as one, never as 'Sign in' or the browser's words", async () => {
    const { saveCheckin, OFFLINE } = await import("../src/forms/checkinClient");
    const args = {
      responseId: fx.NEW_ID,
      changes: {},
      session: "s",
      baseRevision: null,
    };
    const auth = (getUser: () => Promise<unknown>) => ({
      getUser,
      getSession: async () => ({
        data: { session: { user: { id: "u" } } },
        error: null,
      }),
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe() {} } },
      }),
    });
    const signedIn = async () => ({ data: { user: { id: "u" } }, error: null });
    // The sign-in check could not reach the server: the seat is signed in.
    const retry = Object.assign(new Error("Failed to fetch"), {
      name: "AuthRetryableFetchError",
      status: 0,
    });
    await expect(
      saveCheckin(
        {
          auth: auth(async () => ({ data: { user: null }, error: retry })),
          rpc: async () => ({ data: null, error: null }),
        } as any,
        args,
      ),
    ).rejects.toThrow(OFFLINE);
    // The RPC never got there (postgrest-js answers code "").
    for (const words of [
      "TypeError: Failed to fetch",
      "TypeError: Load failed",
    ])
      await expect(
        saveCheckin(
          {
            auth: auth(signedIn),
            rpc: async () => ({
              data: null,
              error: { message: words, code: "" },
            }),
          } as any,
          args,
        ),
      ).rejects.toThrow(OFFLINE);
    // Signed out is still said as such.
    await expect(
      saveCheckin(
        {
          auth: auth(async () => ({ data: { user: null }, error: null })),
          rpc: async () => ({ data: null, error: null }),
        } as any,
        args,
      ),
    ).rejects.toThrow("Sign in to the cockpit, then try again.");
  });

  test("the trail is read every 15 s, then every minute, and stops after 25 minutes", async () => {
    const { fake, t } = await mount({
      mode: "live",
      drafts: READY,
      effects: fx.cockpitEffects,
      recap: [fx.RECAP_READY],
    });
    await fillAndSend();
    const reads = () => fake.count("read");
    await t.advance(3 * 60_000);
    const fast = reads();
    expect(fast).toBeGreaterThanOrEqual(10);
    await t.advance(22 * 60_000);
    const slow = reads();
    expect(slow - fast).toBeGreaterThanOrEqual(15);
    expect(slow - fast).toBeLessThanOrEqual(23);
    await t.advance(30 * 60_000);
    expect(reads()).toBe(slow);
  });

  test("the recap step polls and shows the preview; a call with no recording has none", async () => {
    const { fake, t } = await mount({
      drafts: READY,
      recap: [fx.draft("recap", "drafting"), fx.RECAP_READY],
    });
    await fillAndSend();
    expect(page()).toContain(
      "Make still sends 1-1 recaps until the switch-over, so this one is not sent from here.",
    );
    expect(page()).toContain("Drafting the recap from the notes you sent…");
    await t.advance(16_000);
    expect(page()).toContain(
      "This is what the cockpit would send to the client's WhatsApp group.",
    );
    expect(page()).toContain("Written by the cockpit in Kuwaiti Arabic.");
    expect(page()).toContain("فريق مهارة");
    const polls = fake.count("drafts");
    await t.advance(20 * 60_000);
    expect(fake.count("drafts")).toBe(polls);
    for (const r of roots.splice(0)) await act(async () => r.unmount());
    win.document.body.innerHTML = "";
    const none = await mount({
      answers: { call: { kind: "none", why: "none" } },
    });
    await fillAndSend();
    expect(page()).toContain("No recap: no recording for this call.");
    expect(none.fake.count("drafts")).toBe(0);
  });

  test("the recap step keeps one live region from drafting to its outcome, so the outcome is said, and said once", async () => {
    const step = () =>
      win.document.body.querySelector(
        '[aria-label="The recap for the client"]',
      ) as any;
    const live = () =>
      Array.from(
        step()?.querySelectorAll('[role="status"], [aria-live]') ?? [],
      ) as any[];
    const failed = fx.draft(
      "recap",
      "failed",
      null,
      "The recap named a cost per lead, so it was not kept. Draft again.",
    );
    const cases: [DraftView[], string, boolean][] = [
      [
        [fx.draft("recap", "drafting"), fx.RECAP_READY],
        "The recap is ready.",
        false,
      ],
      [[fx.draft("recap", "drafting"), failed], String(failed.reason), false],
      [
        [fx.draft("recap", "drafting"), fx.draft("recap", "off")],
        "AI drafts are off: no Anthropic key.",
        true,
      ],
      [
        [
          fx.draft("recap", "skipped", null, fx.TRANSCRIPT_WAIT),
          fx.draft("recap", "skipped", { skip: true }, fx.NOTHING_TO_SEND),
        ],
        fx.NOTHING_TO_SEND,
        true,
      ],
    ];
    for (const [recap, said, shown] of cases) {
      const { t } = await mount({ drafts: READY, recap });
      await fillAndSend();
      await t.advance(1_000);
      // One region in the step, mounted with it: the waiting line.
      expect(live().length).toBe(1);
      const region = live()[0];
      expect(region.getAttribute("role")).toBe("status");
      expect(region.getAttribute("aria-live")).toBe("polite");
      const waiting =
        recap[0].state === "drafting"
          ? "Drafting the recap from the notes you sent…"
          : fx.TRANSCRIPT_WAIT;
      expect(region.textContent).toBe(waiting);
      expect(String(region.className)).not.toContain("sr-only");
      await t.advance(15_000);
      // The same node, now saying the outcome; still the only region.
      expect(live()).toEqual([region]);
      expect(region.isConnected).toBe(true);
      expect(region.textContent).toBe(said);
      expect(String(region.className).includes("sr-only")).toBe(!shown);
      // Beside the preview or the failed row it is a short sr-only line, and
      // the row's own sentence is hidden from screen readers.
      if (!shown) {
        const seen = Array.from(
          step().querySelectorAll("p") as ArrayLike<any>,
        ).filter(p => p !== region && (p.textContent ?? "").includes(said));
        for (const p of seen)
          expect(p.getAttribute("aria-hidden")).toBe("true");
      }
      for (const r of roots.splice(0)) await act(async () => r.unmount());
      win.document.body.innerHTML = "";
    }
  });

  test("a recap that waits for Fathom keeps the step asking, then shows the preview; a wait is never 'Nothing worth sending'", async () => {
    for (const wait of [fx.TRANSCRIPT_WAIT, fx.SUMMARY_WAIT]) {
      const { fake, t } = await mount({
        drafts: READY,
        recap: [fx.draft("recap", "skipped", null, wait), fx.RECAP_READY],
      });
      await click(radio("At risk"));
      await click(radio("High"));
      const before = fake.count("drafts");
      await click(sendButton());
      // One read right after the send: the recap waits, in the server's words.
      await t.advance(1_000);
      expect(fake.count("drafts")).toBe(before + 1);
      const step = () =>
        win.document.body.querySelector(
          '[aria-label="The recap for the client"]',
        )?.textContent ?? "";
      expect(step()).toContain(wait);
      expect(step()).not.toContain(fx.NOTHING_TO_SEND);
      expect(button("Draft again")).toBeUndefined();
      // The step asks again on its plan (15 s), and that ask brings the recap
      // (and, on the server, begins the call's grade).
      await t.advance(15_000);
      expect(fake.count("drafts")).toBe(before + 2);
      expect(step()).toContain(
        "This is what the cockpit would send to the client's WhatsApp group.",
      );
      const done = fake.count("drafts");
      await t.advance(20 * 60_000);
      expect(fake.count("drafts")).toBe(done);
      for (const r of roots.splice(0)) await act(async () => r.unmount());
      win.document.body.innerHTML = "";
    }
  });

  test("a recap the model skipped says nothing is worth sending and stops; another reason is the server's sentence", async () => {
    const cases: [string | null, string][] = [
      [fx.NOTHING_TO_SEND, fx.NOTHING_TO_SEND],
      [null, fx.NOTHING_TO_SEND],
      [
        "That recording is not a client call.",
        "That recording is not a client call.",
      ],
    ];
    for (const [reason, text] of cases) {
      const { fake, t } = await mount({
        drafts: READY,
        recap: [fx.draft("recap", "skipped", { skip: true }, reason)],
      });
      await fillAndSend();
      await t.advance(1_000);
      expect(page()).toContain(text);
      const reads = fake.count("drafts");
      await t.advance(20 * 60_000);
      expect(fake.count("drafts")).toBe(reads);
      for (const r of roots.splice(0)) await act(async () => r.unmount());
      win.document.body.innerHTML = "";
    }
  });

  test("the recap preview is the stored text byte for byte, else the message and the booking block", async () => {
    const shown = async (recap: DraftView) => {
      for (const r of roots.splice(0)) await act(async () => r.unmount());
      win.document.body.innerHTML = "";
      const { t } = await mount({ drafts: READY, recap: [recap] });
      await fillAndSend();
      await t.advance(1_000);
      return win.document.body.querySelector(
        '[aria-label="The recap for the client"] bdi',
      )?.textContent;
    };
    const stored = fx.RECAP_READY.output?.text as string;
    // The fixture's stored block differs from the window's own, so only the
    // stored text can show it.
    expect(stored).not.toContain(BOOKING_BLOCK);
    expect(await shown(fx.RECAP_READY)).toBe(stored);
    // A view without the stored text (an older answer): rebuilt here.
    const { text: _, ...older } = (fx.RECAP_READY.output ?? {}) as Record<
      string,
      unknown
    >;
    expect(await shown({ ...fx.RECAP_READY, output: older })).toBe(
      `${older.message}\n\n${BOOKING_BLOCK}`,
    );
  });

  test("a failed recap offers Draft again; a refusal says the server's sentence", async () => {
    const failed = fx.draft(
      "recap",
      "failed",
      null,
      "The recap named a cost per lead, so it was not kept. Draft again.",
    );
    const { fake, t } = await mount({
      drafts: READY,
      recap: [failed],
      again: { recap: fx.RECAP_READY },
    });
    await fillAndSend();
    await t.advance(1_000);
    expect(page()).toContain(
      "The recap named a cost per lead, so it was not kept. Draft again.",
    );
    const again = button("Draft again");
    expect(again).toBeTruthy();
    again.focus();
    await click(again);
    expect(
      fake.calls.filter(c => c.name === "draftAgain").map(c => c.args),
    ).toEqual([{ id: fx.NEW_ID, kind: "recap" }]);
    expect(page()).toContain(
      "This is what the cockpit would send to the client's WhatsApp group.",
    );
    expect(button("Draft again")).toBeUndefined();
    // Its button went with the failed recap: focus is on the step, not lost.
    expect(win.document.activeElement?.getAttribute("aria-label")).toBe(
      "The recap for the client",
    );
    for (const r of roots.splice(0)) await act(async () => r.unmount());
    win.document.body.innerHTML = "";
    const refused = await mount({
      drafts: READY,
      recap: [failed],
      again: { recap: { refused: "Five drafts is the limit for this call." } },
    });
    await fillAndSend();
    await refused.t.advance(1_000);
    const recapAgain = button("Draft again");
    await act(async () => recapAgain.focus());
    await click(recapAgain);
    expect(page()).toContain("Five drafts is the limit for this call.");
    expect(
      win.document.body.querySelector('[role="alert"]')?.textContent,
    ).toContain("Five drafts is the limit for this call.");
    // Still failed, so Draft again stays where focus is, but rests: said
    // unavailable, with the refusal as its description, and asks nothing.
    const rested = button("Draft again");
    expect(rested).toBeTruthy();
    expect(win.document.activeElement).toBe(rested);
    expect(rested.getAttribute("aria-disabled")).toBe("true");
    expect(
      win.document.getElementById(rested.getAttribute("aria-describedby"))
        ?.textContent,
    ).toBe("Five drafts is the limit for this call.");
    await click(rested);
    expect(refused.fake.count("draftAgain")).toBe(1);
    expect(page()).toContain(
      "The recap named a cost per lead, so it was not kept. Draft again.",
    );
  });
});

// ------------------------------------------------------------ Draft again

describe("draft again", () => {
  const DRAFTED = String(fx.NOTES_READY.output?.text);
  const AGAIN = String(fx.NOTES_AGAIN.output?.text);
  const MINE = `${DRAFTED} She asked us to call the architect on Thursday before 4.`;
  const notes = () =>
    win.document.body.querySelector('textarea[id$="-notes"]') as any;
  const typeNotes = async (text: string) => {
    await act(async () => model.setNotes(text));
    await act(async () => {
      await new Promise(r => setTimeout(r, 700));
    });
    await settle();
  };
  const READY_LINE =
    "A new draft is ready. Your notes stay as they are unless you replace them.";

  const said = () =>
    Array.from(
      win.document.body.querySelectorAll('p.sr-only[aria-live="polite"]'),
    ).map(p => (p as any).textContent);

  test("over notes she edited: hers stay, the new draft waits beside them and takes focus from Draft again, and Keep my notes keeps them", async () => {
    const { fake } = await mount(
      { drafts: READY, again: { client_notes: fx.NOTES_AGAIN } },
      { seat: "csm" },
    );
    await typeNotes(MINE);
    expect(page()).toContain("Edited");
    const again = button("Draft again");
    await act(async () => again.focus());
    await click(again);
    expect(fake.count("draftAgain")).toBe(1);
    // Never emptied, never replaced: her words are in the field and saved.
    expect(notes().value).toBe(MINE);
    expect(saves(fake, "client_notes").at(-1)?.value).toBe(MINE);
    expect(page()).toContain(READY_LINE);
    expect(page()).toContain(AGAIN);
    // Draft again went with the new draft's arrival: focus moved to the new
    // draft, read by its first line, so it never fell to the page, and the
    // region does not say it a second time.
    expect(button("Draft again")).toBeUndefined();
    const box = win.document.activeElement as any;
    expect(box?.getAttribute("role")).toBe("group");
    expect(box?.getAttribute("tabindex")).toBe("-1");
    expect(
      win.document.getElementById(box?.getAttribute("aria-labelledby"))
        ?.textContent,
    ).toBe(READY_LINE);
    expect(box?.textContent).toContain(AGAIN);
    expect(said()).not.toContain(READY_LINE);
    // Its first button is the next stop.
    expect(button("Replace my notes")).toBeTruthy();
    expect(button("Keep mine")).toBeUndefined();
    await click(button("Keep my notes"));
    expect(notes().value).toBe(MINE);
    expect(page()).not.toContain(READY_LINE);
    expect(win.document.activeElement).toBe(notes());
    expect(button("Draft again")).toBeTruthy();
  });

  test("Replace my notes saves the new draft with its source, and Undo puts hers back", async () => {
    const { fake } = await mount(
      { drafts: READY, again: { client_notes: fx.NOTES_AGAIN } },
      { seat: "csm" },
    );
    await typeNotes(MINE);
    await click(button("Draft again"));
    await click(button("Replace my notes"));
    expect(notes().value).toBe(AGAIN);
    expect(saves(fake, "client_notes").at(-1)).toMatchObject({
      value: AGAIN,
      from: "ai.client_notes",
    });
    expect(page()).toContain("Draft · Fathom summary");
    expect(page()).toContain("The new draft replaced your notes.");
    expect(win.document.activeElement).toBe(notes());
    await click(button("Undo"));
    expect(notes().value).toBe(MINE);
    expect(saves(fake, "client_notes").at(-1)).toMatchObject({
      value: MINE,
      from: "ai.client_notes",
    });
    expect(page()).toContain("Edited");
    expect(page()).not.toContain("The new draft replaced your notes.");
  });

  test("over the untouched draft: the field keeps it while the new one is written, then takes it unsaved", async () => {
    const { fake, t } = await mount({
      drafts: READY,
      again: {
        client_notes: [fx.draft("client_notes", "drafting"), fx.NOTES_AGAIN],
      },
    });
    expect(notes().value).toBe(DRAFTED);
    await click(button("Draft again"));
    expect(notes().value).toBe(DRAFTED);
    expect(page()).toContain("Reading the call…");
    // Still focusable while it waits, and does nothing.
    const again = button("Draft again");
    expect(again.getAttribute("aria-disabled")).toBe("true");
    expect(again.disabled).toBe(false);
    await click(again);
    expect(fake.count("draftAgain")).toBe(1);
    // The drafts poll brings the new one: it takes the field, as a draft.
    await t.advance(60_000);
    expect(notes().value).toBe(AGAIN);
    expect(page()).not.toContain(READY_LINE);
    expect(page()).not.toContain("The new draft replaced your notes.");
    expect(saves(fake, "client_notes")).toEqual([]);
  });

  test("typing while the new draft is written keeps what she typed, and focus with it", async () => {
    const { t } = await mount({
      drafts: READY,
      again: {
        client_notes: [fx.draft("client_notes", "drafting"), fx.NOTES_AGAIN],
      },
    });
    await click(button("Draft again"));
    await act(async () => notes().focus());
    await typeNotes(MINE);
    await t.advance(60_000);
    expect(notes().value).toBe(MINE);
    expect(page()).toContain(READY_LINE);
    // She is typing: focus stays in the field, and the region says it once.
    expect(win.document.activeElement).toBe(notes());
    expect(said()).toContain(READY_LINE);
  });

  test("Undo stays across a second Draft again, which takes the field from the draft, never from her", async () => {
    const scenario: Scenario = {
      drafts: READY,
      again: { client_notes: fx.NOTES_AGAIN },
    };
    const { fake } = await mount(scenario, { seat: "csm" });
    await typeNotes(MINE);
    await click(button("Draft again"));
    await click(button("Replace my notes"));
    expect(notes().value).toBe(AGAIN);
    expect(button("Undo")).toBeTruthy();
    // A second Draft again brings another draft. The field holds a draft,
    // so the new one takes it, and Undo still puts back her own words.
    scenario.again = { client_notes: fx.NOTES_ARABIC };
    await click(button("Draft again"));
    expect(fake.count("draftAgain")).toBe(2);
    expect(notes().value).toBe(String(fx.NOTES_ARABIC.output?.text));
    expect(page()).toContain("The new draft replaced your notes.");
    await click(button("Undo"));
    expect(notes().value).toBe(MINE);
    expect(saves(fake, "client_notes").at(-1)?.value).toBe(MINE);
    expect(button("Undo")).toBeUndefined();
  });

  test("after a refusal Draft again rests for this call, still focused and said why; a dropped connection can ask again", async () => {
    const { fake } = await mount(
      {
        drafts: READY,
        again: {
          client_notes: { refused: "Five drafts is the limit for this call." },
        },
      },
      { seat: "csm" },
    );
    await typeNotes(MINE);
    const again = button("Draft again");
    await act(async () => again.focus());
    await click(again);
    expect(page()).toContain("Five drafts is the limit for this call.");
    const rested = button("Draft again");
    expect(rested).toBe(again);
    expect(win.document.activeElement).toBe(rested);
    expect(rested.getAttribute("aria-disabled")).toBe("true");
    expect(
      win.document.getElementById(rested.getAttribute("aria-describedby"))
        ?.textContent,
    ).toBe("Five drafts is the limit for this call.");
    await click(rested);
    await act(async () => model.draftAgain("client_notes"));
    expect(fake.count("draftAgain")).toBe(1);
    expect(notes().value).toBe(MINE);
    for (const r of roots.splice(0)) await act(async () => r.unmount());
    win.document.body.innerHTML = "";
    const dropped = await mount(
      { drafts: READY, again: { client_notes: { unreached: true } } },
      { seat: "csm" },
    );
    await typeNotes(MINE);
    await click(button("Draft again"));
    expect(page()).toContain("The connection dropped.");
    expect(button("Draft again")?.getAttribute("aria-disabled")).toBeNull();
    await click(button("Draft again"));
    expect(dropped.fake.count("draftAgain")).toBe(2);
  });

  test("a refusal, a failed draft or no key leaves her notes as they were", async () => {
    const cases: [NonNullable<Scenario["again"]>["client_notes"], string][] = [
      [
        { refused: "Five drafts is the limit for this call." },
        "Five drafts is the limit for this call.",
      ],
      [
        fx.draft(
          "client_notes",
          "failed",
          null,
          "The draft took too long. Draft again.",
        ),
        "The draft took too long. Draft again.",
      ],
      [
        fx.draft("client_notes", "off"),
        "AI drafts are off: no DeepSeek key. Fill this by hand.",
      ],
    ];
    for (const [answer, text] of cases) {
      await mount(
        { drafts: READY, again: { client_notes: answer } },
        { seat: "csm" },
      );
      await typeNotes(MINE);
      await click(button("Draft again"));
      expect(notes().value).toBe(MINE);
      expect(page()).toContain(text);
      expect(page()).not.toContain(READY_LINE);
      for (const r of roots.splice(0)) await act(async () => r.unmount());
      win.document.body.innerHTML = "";
    }
  });

  test("a refusal stays said when her typing saves after it", async () => {
    const { fake } = await mount(
      {
        drafts: READY,
        again: {
          client_notes: { refused: "Five drafts is the limit for this call." },
        },
      },
      { seat: "csm" },
    );
    await act(async () => model.setNotes(MINE));
    await click(button("Draft again"));
    expect(page()).toContain("Five drafts is the limit for this call.");
    // The pause ends and her words save: the refusal is still there.
    await act(async () => {
      await new Promise(r => setTimeout(r, 700));
    });
    await settle();
    expect(saves(fake, "client_notes").at(-1)?.value).toBe(MINE);
    expect(notes().value).toBe(MINE);
    expect(page()).toContain("Five drafts is the limit for this call.");
  });

  test("notes she typed with no draft are hers too", async () => {
    await mount(
      {
        drafts: {
          ...READY,
          client_notes: fx.draft(
            "client_notes",
            "failed",
            null,
            "The draft could not be made just now. Draft again.",
          ),
        },
        again: { client_notes: fx.NOTES_AGAIN },
      },
      { seat: "csm" },
    );
    expect(notes().value).toBe("");
    await typeNotes("Wants the showroom budget call on Thursday.");
    await click(button("Draft again"));
    expect(notes().value).toBe("Wants the showroom budget call on Thursday.");
    expect(page()).toContain(READY_LINE);
  });

  test("no Draft again while Fathom writes the summary", async () => {
    await mount({
      drafts: {
        ...READY,
        client_notes: fx.draft(
          "client_notes",
          "skipped",
          null,
          fx.SUMMARY_WAIT,
        ),
      },
    });
    expect(page()).toContain(fx.SUMMARY_WAIT);
    expect(button("Draft again")).toBeUndefined();
  });
});

// ------------------------------------------------------------ keyboard focus

describe("keyboard focus", () => {
  const focused = () => win.document.activeElement as any;
  const pressEscape = async () => {
    await act(async () => {
      win.document.activeElement?.dispatchEvent(
        new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    await settle();
  };
  const focusAndClick = async (el: any) => {
    expect(el).toBeTruthy();
    await act(async () => el.focus());
    await click(el);
  };

  test('"Yes, this call" hands focus to Change', async () => {
    await mount({ picked: fx.VIEWS.likely, drafts: READY }, { seat: "csm" });
    await focusAndClick(button("Yes, this call"));
    expect(button("Yes, this call")).toBeUndefined();
    expect((focused()?.textContent ?? "").trim()).toBe("Change");
  });

  test("the Change sheet gives focus back on Escape, a pick and No recording", async () => {
    await mount({ others: [fx.VIEWS.team], drafts: READY });
    await focusAndClick(button("Change"));
    expect(page()).toContain("Pick the call");
    await pressEscape();
    expect(page()).not.toContain("Recordings since yesterday");
    expect(focused()).toBe(button("Change"));
    await focusAndClick(button("Change"));
    await click(
      buttons().find(b => (b.textContent ?? "").includes("Content review")),
    );
    expect(page()).toContain("You picked it.");
    expect(focused()).toBe(button("Change"));
    await focusAndClick(button("Change"));
    await click(button("No recording"));
    expect(page()).toContain("No recording. The call is not graded");
    expect(focused()).toBe(button("Change"));
  });

  test("a Check again that finds the call hands focus to Change", async () => {
    const { fake } = await mount({
      picked: null,
      fathom: { state: "waiting", checkedAt: fx.NOW, note: null },
    });
    // Fathom sends the recording before the next check.
    const found = fx.fakeCheckin({ drafts: READY });
    fake.io.calls = a => found.io.calls(a);
    await focusAndClick(button("Check again"));
    expect(button("Check again")).toBeUndefined();
    expect(page()).toContain("Same room as the check-in booked for 10:30.");
    expect(focused()).toBe(button("Change"));
  });

  test("the transcript sheet gives focus back to View transcript", async () => {
    const open = win.open;
    (win as any).open = () => null;
    try {
      await mount({ drafts: READY, transcript: "text" });
      await focusAndClick(button("View transcript"));
      expect(page()).toContain("The call's transcript");
      await pressEscape();
      expect(page()).not.toContain("The call's transcript");
      expect(focused()).toBe(button("View transcript"));
    } finally {
      win.open = open;
    }
  });

  test('"Use it" focuses the choice it checked', async () => {
    await mount({ drafts: READY });
    const use = buttons().filter(
      b => (b.textContent ?? "").trim() === "Use it",
    );
    expect(use.length).toBe(2);
    await focusAndClick(use[0]);
    expect(focused()).toBe(radio("At risk"));
    expect(focused()?.getAttribute("aria-checked")).toBe("true");
  });

  test("a next step's Add focuses the new line in We owe", async () => {
    await mount({ drafts: READY });
    const add = buttons().find(b =>
      (b.getAttribute("aria-label") ?? "").startsWith("Add to We owe:"),
    );
    await focusAndClick(add);
    expect(page()).not.toContain("Also in Fathom's next steps");
    expect(focused()?.tagName).toBe("TEXTAREA");
    expect(focused()?.value).toBe("Book a site visit for the new showroom");
  });

  test("a removed line hands focus to the next line's remove button, the last to the Add box", async () => {
    await mount({ drafts: READY });
    const removes = () =>
      buttons().filter(
        b => b.getAttribute("aria-label") === "Remove this line from We owe",
      );
    const lineOf = (b: any) =>
      win.document.getElementById(b.getAttribute("aria-describedby"))
        ?.textContent;
    expect(removes().length).toBe(3);
    const first = removes()[0];
    expect(lineOf(first)).toBe(
      "Send the revised offer with the new kitchen packages",
    );
    await focusAndClick(first);
    // Another button, for another line, and it says which line.
    expect(removes().length).toBe(2);
    expect(focused()).not.toBe(first);
    expect(focused()).toBe(removes()[0]);
    expect(lineOf(focused())).toBe(
      "Pause the villa campaign until the new photos are in",
    );
    await focusAndClick(removes()[1]);
    expect(focused()).toBe(removes()[0]);
    await focusAndClick(removes()[0]);
    expect(removes().length).toBe(0);
    expect(focused()?.getAttribute("aria-label")).toBe("Add a line to We owe");
  });

  test("the Add button keeps focus in the box for the next line; an empty box's Add rests", async () => {
    await mount({ drafts: READY });
    const box = () =>
      win.document.body.querySelector(
        'input[aria-label="Add a line to We owe"]',
      ) as any;
    const addOf = () => box()?.form?.querySelector('button[type="submit"]');
    // Empty: said unavailable, still focusable, adds nothing.
    expect(addOf()?.getAttribute("aria-disabled")).toBe("true");
    expect(addOf()?.disabled).toBe(false);
    await act(async () => {
      const input = box();
      const set = Object.getOwnPropertyDescriptor(
        win.HTMLInputElement.prototype,
        "value",
      )?.set;
      set?.call(input, "Send the floor plan");
      input.dispatchEvent(new win.Event("input", { bubbles: true }));
    });
    await settle();
    expect(addOf()?.getAttribute("aria-disabled")).toBeNull();
    await focusAndClick(addOf());
    expect(page()).toContain("We owe · 4");
    expect(box()?.value).toBe("");
    expect(focused()).toBe(box());
  });

  test("Use mine and Keep theirs hand focus to the field the line was about", async () => {
    const cases: [string, unknown, string, (el: any) => boolean][] = [
      [
        "client_notes",
        "Wants a call on Thursday.",
        "Use mine",
        el => el?.tagName === "TEXTAREA" && /-notes$/.test(el.id),
      ],
      [
        "client_notes",
        "Wants a call on Thursday.",
        "Keep theirs",
        el => el?.tagName === "TEXTAREA" && /-notes$/.test(el.id),
      ],
      [
        "defcon",
        "Happy",
        "Keep theirs",
        el =>
          el?.getAttribute("role") === "radio" &&
          (el.textContent ?? "").trim() === "Happy",
      ],
    ];
    for (const [key, theirs, choice, ok] of cases) {
      await mount({ drafts: READY, conflict: { key, theirs } });
      if (key === "client_notes")
        await act(async () => model.setNotes("Mine."));
      else await act(async () => model.choose("defcon", "At Risk"));
      await act(async () => {
        await new Promise(r => setTimeout(r, 700));
      });
      await settle();
      expect(page()).toContain("Changed in another window");
      await focusAndClick(button(choice));
      expect(page()).not.toContain("Changed in another window");
      expect(ok(focused())).toBe(true);
      for (const r of roots.splice(0)) await act(async () => r.unmount());
      win.document.body.innerHTML = "";
    }
  });

  test("View transcript keeps focus while it reads, so the sheet gives focus back to it", async () => {
    const open = win.open;
    (win as any).open = () => null;
    try {
      await mount({ drafts: READY, transcript: "text", latency: 30 });
      // Every read takes 30 ms here: wait for the window to open.
      for (let i = 0; i < 40 && !button("View transcript"); i++)
        await act(async () => {
          await new Promise(r => setTimeout(r, 25));
        });
      const view = button("View transcript");
      await act(async () => view.focus());
      await act(async () => {
        view.click();
      });
      // Reading: said unavailable, still the focused element.
      expect(view.getAttribute("aria-disabled")).toBe("true");
      expect(view.disabled).toBe(false);
      expect(focused()).toBe(view);
      await act(async () => {
        await new Promise(r => setTimeout(r, 80));
      });
      await settle();
      expect(page()).toContain("The call's transcript");
      await pressEscape();
      expect(focused()).toBe(button("View transcript"));
    } finally {
      win.open = open;
    }
  });

  test("every button and field in the window shows a 3:1 ring, never button.tsx's 1px teal", async () => {
    const ringed = (el: any) => {
      const c = String(el?.className?.baseVal ?? el?.className ?? "");
      return (
        c.includes("focus-visible:ring-2") &&
        c.includes("focus-visible:ring-primary-ink") &&
        !c.includes("focus-visible:ring-1") &&
        !c.includes("focus-visible:ring-ring")
      );
    };
    await mount(
      {
        picked: fx.VIEWS.likely,
        drafts: READY,
        again: { client_notes: fx.NOTES_AGAIN },
        conflict: { key: "client_notes", theirs: "Wants a call on Thursday." },
      },
      { seat: "csm" },
    );
    for (const name of ["Yes, this call", "Change", "Open the 1-1 form"])
      expect([name, ringed(button(name))]).toEqual([name, true]);
    // The seal's "why" button in the header: the window's FOCUS, set off the
    // pill so it never reads as the pill's own tinted ring.
    const seal = win.document.body.querySelector(
      "header button[aria-haspopup]",
    ) as any;
    expect(seal?.textContent).toContain("notes for");
    expect(ringed(seal)).toBe(true);
    for (const c of [
      "focus-visible:ring-offset-2",
      "focus-visible:ring-offset-background",
    ])
      expect(String(seal.className)).toContain(c);
    for (const el of radios()) expect(ringed(el)).toBe(true);
    for (const el of Array.from(
      win.document.body.querySelectorAll("main textarea, main input"),
    ))
      expect(ringed(el)).toBe(true);
    const lineButtons = buttons().filter(b =>
      /^(Remove this line|Add to We owe:)/.test(
        b.getAttribute("aria-label") ?? "",
      ),
    );
    expect(lineButtons.length).toBeGreaterThan(0);
    for (const b of lineButtons) expect(ringed(b)).toBe(true);
    // Every button in the main column, whatever it is.
    for (const b of Array.from(
      win.document.body.querySelectorAll("main button"),
    ))
      expect([(b as any).textContent, ringed(b)]).toEqual([
        (b as any).textContent,
        true,
      ]);
    // The new draft's and the conflict's buttons too.
    await act(async () => model.setNotes("Mine."));
    await act(async () => {
      await new Promise(r => setTimeout(r, 700));
    });
    await settle();
    for (const name of ["Use mine", "Keep theirs"])
      expect([name, ringed(button(name))]).toEqual([name, true]);
    await click(button("Keep theirs"));
    await typeAndDraftAgain();
    for (const name of ["Replace my notes", "Keep my notes"])
      expect([name, ringed(button(name))]).toEqual([name, true]);
    await click(button("Replace my notes"));
    expect(ringed(button("Undo"))).toBe(true);
    async function typeAndDraftAgain() {
      await act(async () =>
        model.setNotes(
          `${String(fx.NOTES_READY.output?.text)} She asked for Thursday.`,
        ),
      );
      await act(async () => {
        await new Promise(r => setTimeout(r, 700));
      });
      await settle();
      await click(button("Draft again"));
    }
  });

  test("the send keeps focus on its button, then hands it to the sent line; one live region says it", async () => {
    await mount({ drafts: READY, hold: ["submit"] });
    // The send bar's region; the recap step has its own (tested above).
    const region = () =>
      Array.from(
        win.document.body.querySelectorAll('p.sr-only[role="status"]'),
      ).find(
        p => !(p as any).closest('[aria-label="The recap for the client"]'),
      ) as any;
    expect(region()).toBeTruthy();
    expect(region().textContent).toBe("");
    await click(radio("At risk"));
    await click(radio("High"));
    await focusAndClick(sendButton() ?? button("Send in shadow"));
    const busy = buttons().find(
      b => (b.textContent ?? "").trim() === "Sending in shadow…",
    );
    expect(busy?.getAttribute("aria-disabled")).toBe("true");
    expect(busy?.disabled).toBe(false);
    expect(focused()).toBe(busy);
    expect(region().textContent).toBe("Sending in shadow…");
    for (const r of roots.splice(0)) await act(async () => r.unmount());
    win.document.body.innerHTML = "";
    await mount({ drafts: READY }, { seat: "csm" });
    await click(radio("At risk"));
    await click(radio("High"));
    await focusAndClick(sendButton());
    expect(focused()?.getAttribute("tabindex")).toBe("-1");
    expect(focused()?.textContent).toContain(
      "Sent in shadow at 11:10. Nothing reached the card, Slack or the client.",
    );
    // Read as it takes focus, so the region does not say it again.
    expect(region().textContent).toBe("");
  });

  test("from lg the page never scrolls: every scroller is positioned, so a screen-reader line stays in its column", async () => {
    await mount({ drafts: READY }, { seat: "admin" });
    const cls = (el: any) => String(el?.className ?? "").split(/\s+/);
    // The form column's scroller and the rail: sr-only is position:absolute,
    // so each needs a positioned box to hold and clip its own.
    const column = win.document.body.querySelector(
      "[data-checkin-column]",
    ) as any;
    expect(cls(column)).toContain("lg:overflow-y-auto");
    expect(cls(column)).toContain("relative");
    const rail = win.document.body.querySelector("aside") as any;
    expect(cls(rail)).toContain("lg:overflow-y-auto");
    expect(cls(rail)).toContain("relative");
    // Client notes' live region is inside the column, not at the page's end.
    const region = Array.from(
      win.document.body.querySelectorAll('p.sr-only[aria-live="polite"]'),
    ).find(p => !(p as any).getAttribute("role")) as any;
    expect(region).toBeTruthy();
    expect(column.contains(region)).toBe(true);
    // The window's root is positioned and clips at lg, one screen tall.
    const root = column.closest("main")?.parentElement as any;
    for (const c of ["relative", "lg:h-dvh", "lg:overflow-hidden"])
      expect(cls(root)).toContain(c);
    // Below lg the page scrolls under the sticky send bar: while the window
    // is open the page keeps 8rem clear at its bottom edge, so a control that
    // takes focus (a text field's caret too) stops above the bar.
    expect(cls(root)).toContain("max-lg:[html:has(&)]:scroll-pb-32");
  });

  test("below lg the fold scrolls in its own positioned box, and its chevron keeps still with reduced motion", async () => {
    const real = win.matchMedia;
    (win as any).matchMedia = (q: string) => ({
      matches: false,
      media: q,
      addEventListener() {},
      removeEventListener() {},
    });
    try {
      await mount({ drafts: READY });
      const summary = win.document.body.querySelector(
        "aside details summary",
      ) as any;
      expect(summary?.textContent).toContain("What the cockpit knows");
      const chevron = summary.querySelector("svg");
      const c = String(chevron?.getAttribute("class") ?? "");
      expect(c).toContain("group-open/fold:rotate-90");
      expect(c).toContain("motion-reduce:transition-none");
      const box = summary.nextElementSibling as any;
      expect(String(box?.className)).toContain("overflow-y-auto");
      expect(String(box?.className).split(/\s+/)).toContain("relative");
    } finally {
      (win as any).matchMedia = real;
    }
  });

  test("the teal buttons show focus off the fill, and the fold takes only its own height", async () => {
    await mount({ drafts: READY }, { seat: "csm" });
    const teal = (b: any) => {
      const c = String(b?.className ?? "");
      return (
        c.includes("focus-visible:ring-2") &&
        c.includes("focus-visible:ring-offset-2") &&
        c.includes("focus-visible:ring-primary-ink") &&
        !c.includes("focus-visible:ring-1")
      );
    };
    expect(teal(sendButton())).toBe(true);
    expect(win.document.body.querySelector("main")?.className ?? "").toContain(
      "max-lg:grid-rows-[auto_minmax(0,1fr)]",
    );
    await fillAndSend();
    expect(teal(button("Open the 1-1 form"))).toBe(true);
    for (const r of roots.splice(0)) await act(async () => r.unmount());
    win.document.body.innerHTML = "";
    await mount({
      open: "fail",
      openError: "The cockpit's 1-1 notes are not live yet.",
    });
    expect(teal(button("Open the 1-1 form"))).toBe(true);
  });
});

// ------------------------------------------------------------ screen readers

describe("screen readers", () => {
  test("a heading for each part, no landmark per field, and controls named in context", async () => {
    await mount({ drafts: READY });
    const h = headings();
    for (const name of [
      "1-1 notes",
      "This call",
      "DEFCON",
      "Priority",
      "We owe · 3",
      "They owe · 2",
      "Client notes (internal)",
      "Next check-in",
      "Next call",
    ])
      expect([name, h.includes(name)]).toEqual([name, true]);
    // The fields are not landmarks: <main> and the aside are.
    expect(
      win.document.body.querySelectorAll(
        "main section[aria-label], main section[aria-labelledby], main [role='region']",
      ).length,
    ).toBe(0);
    expect(
      win.document.body.querySelector(
        'aside[aria-label="What the cockpit knows"]',
      ),
    ).toBeTruthy();
    // Two "Use it" buttons, each named for its value and its field.
    expect(
      buttons()
        .filter(b => (b.textContent ?? "").trim() === "Use it")
        .map(b => b.getAttribute("aria-label")),
    ).toEqual(["Use it: At risk for DEFCON", "Use it: High for Priority"]);
    // A moment in the call is named beyond its clock, its clock kept.
    const moments = Array.from(
      win.document.body.querySelectorAll("main a[href*='timestamp=']"),
    ) as any[];
    expect(moments.length).toBeGreaterThan(0);
    for (const a of moments)
      expect(a.getAttribute("aria-label")).toBe(
        `Open the call at ${a.textContent.trim()} in Fathom`,
      );
    // The DEFCON group is read with the card's value, the suggestion and
    // the hint, each a sentence: the time as "12:41", never the link's name.
    const [defcon, priority] = Array.from(
      win.document.body.querySelectorAll('[role="radiogroup"]'),
    ) as any[];
    expect(described(defcon)).toBe(
      'On the card: Happy. Suggested: At risk. "If the next batch is the same, we will pause in December." at 12:41. How the client feels after this call. You pick it.',
    );
    expect(described(priority)).toBe(
      'Suggested: High (2 urgent asks). "We need the new offer before the weekend." at 22:10.',
    );
    for (const g of [defcon, priority])
      expect(described(g)).not.toContain("Open the call");
    // The plain copy is only for the description: the strip is drawn once,
    // its link keeps its name, and the card's line its words.
    expect(seen().split("Suggested: At risk").length - 1).toBe(1);
    expect(seen()).toContain("On the card: Happy");
    expect(seen()).not.toContain("On the card: Happy.");
  });

  test("a suggestion that is a sentence describes its group as it reads", async () => {
    await mount({
      happiness: null,
      drafts: {
        ...READY,
        defcon_priority: fx.draft("defcon_priority", "drafting"),
      },
    });
    const [defcon] = Array.from(
      win.document.body.querySelectorAll('[role="radiogroup"]'),
    ) as any[];
    expect(described(defcon)).toBe(
      "Not set on the card. Reading the call… How the client feels after this call. You pick it.",
    );
  });

  test("the seal's why opens as a named dialog", async () => {
    await mount({ drafts: READY });
    const seal = win.document.body.querySelector(
      "header button[aria-haspopup]",
    ) as any;
    await click(seal);
    const dialog = win.document.body.querySelector('[role="dialog"]') as any;
    expect(dialog?.getAttribute("aria-label")).toBe(
      "Why these notes go to this card",
    );
    expect(dialog?.textContent).toContain(
      "In a shadow run nothing reaches this card",
    );
  });
});

// ------------------------------------------------------------ Stage 2b

/** A live send whose recap is the cockpit's: the effect queued once its row exists. */
const liveSent = (over: Partial<Scenario> = {}): Scenario => ({
  mode: "live",
  open: "submitted",
  answers: fx.FILLED,
  recap: [fx.RECAP_READY],
  effects: (a, at) =>
    fx
      .cockpitEffects(a, at)
      .map(e => (e.key === "recap" ? { ...e, state: "queued" as const } : e)),
  ...over,
});
const recapStep = () =>
  win.document.body.querySelector(
    '[aria-label="The recap for the client"]',
  ) as any;

describe("the recap step after the switch-over (4.15 item 1, 5.1)", () => {
  test("a live send: the live header, never Make's line, and the shared approval for its row", async () => {
    const messages = fx.fakeMessages([fx.messageFixture()]);
    await mount(liveSent(), { messages });
    expect(page()).toContain(
      "Approve the recap here or on the client's Messages card. The client gets it only after someone approves it.",
    );
    expect(page()).not.toContain("Make still sends");
    expect(messages.calls[0]).toEqual({ name: "read", args: fx.TASK });
    const step = recapStep();
    // The exact-bytes surface and the three actions, primary last.
    expect(step.querySelector('[dir="rtl"][lang="ar"]')?.textContent).toBe(
      fx.RECAP_BODY.replace(/\*/g, ""),
    );
    const names = Array.from(step.querySelectorAll("button")).map((b: any) =>
      (b.textContent ?? "").trim(),
    );
    expect(names).toEqual(["Edit", "Skip", "Approve and send"]);
    // The one live region of the step.
    expect(step.querySelectorAll('[role="status"]').length).toBe(1);
    const link = Array.from(step.querySelectorAll("a")).find((a: any) =>
      (a.textContent ?? "").includes("Open the Messages card"),
    ) as any;
    expect(link?.getAttribute("href")).toBe(
      "/client-success/clients/86exfix01?tab=overview#messages",
    );
    // Every button in the window keeps the 3:1 ring.
    for (const b of Array.from(step.querySelectorAll("button")) as any[])
      expect(String(b.className)).toContain("focus-visible:ring-primary-ink");
    await click(button("Approve and send"));
    expect(messages.calls.find(c => c.name === "approve")?.args).toEqual({
      messageId: fx.MESSAGE_ID,
      body: fx.RECAP_BODY,
      acceptWarnings: false,
    });
    expect(toasts).toContain("Approved. It sends within about 3 minutes.");
    expect(page()).toContain("Sends within about 3 minutes.");
    const region = step.querySelector('[role="status"]');
    expect(region.textContent).toBe(
      "1-1 recap · call Sun 25 Oct: Sends within about 3 minutes.",
    );
    expect(step.querySelectorAll('[role="status"]').length).toBe(1);
  });

  test("a recap sent: the rail's Messages card link has the in-app mark and says it opens a new tab, as the step's does", async () => {
    const messages = fx.fakeMessages([fx.messageStates().sent]);
    await mount(
      liveSent({
        effects: (a, at) =>
          fx
            .cockpitEffects(a, at)
            .map(e =>
              e.key === "recap" ? { ...e, state: "delivered" as const } : e,
            ),
      }),
      { messages },
    );
    const trail = win.document.body.querySelector(
      '[role="status"] > ol',
    ) as any;
    const link = (root: any, label: string) =>
      (Array.from(root?.querySelectorAll("a") ?? []) as any[]).find(a =>
        (a.textContent ?? "").includes(label),
      );
    const rail = link(trail, "Open the Messages card");
    expect(rail?.getAttribute("href")).toBe(
      "/client-success/clients/86exfix01?tab=overview#messages",
    );
    expect(rail.querySelector("svg.lucide-chevron-right")).toBeTruthy();
    expect(rail.querySelector("svg.lucide-arrow-up-right")).toBeNull();
    expect(rail.querySelector(".sr-only")?.textContent).toBe(
      " (opens in a new tab)",
    );
    // One destination, one mark and one name wherever it is on screen.
    const step = link(recapStep(), "Open the Messages card");
    expect(step).toBeTruthy();
    expect(rail.getAttribute("href")).toBe(step.getAttribute("href"));
    expect((rail.textContent ?? "").trim()).toBe(
      (step.textContent ?? "").trim(),
    );
    expect(step.querySelector("svg.lucide-chevron-right")).toBeTruthy();
    // The card leaves the cockpit: the outbound arrow, nothing else.
    const card = link(trail, "Open the card");
    expect(card?.getAttribute("href")).toBe(
      "https://app.clickup.com/t/86exfix01",
    );
    expect(card.querySelector("svg.lucide-arrow-up-right")).toBeTruthy();
    expect(card.querySelector("svg.lucide-chevron-right")).toBeNull();
    expect(card.querySelector(".sr-only")).toBeNull();
    // The trail's links take the measured link ink, as the step's does.
    const ink =
      "text-[color:color-mix(in_oklab,var(--primary-ink)_90%,var(--foreground))]";
    expect(String(rail.className)).toContain(ink);
    expect(String(card.className)).toContain(ink);
  });

  test("between the draft turning ready and the row appearing it says so", async () => {
    const messages = fx.fakeMessages([]);
    const { t } = await mount(liveSent(), { messages });
    // The recap draft is read on the step's own poll.
    await t.advance(16_000);
    const region = recapStep().querySelector('[role="status"]');
    expect(region.textContent).toBe("Getting the recap ready to approve…");
    expect(String(region.className)).not.toContain("sr-only");
    expect(button("Approve and send")).toBeUndefined();
  });

  test("the row comes minutes after the send: the step keeps asking through empty reads and shows the approval", async () => {
    const inner = fx.fakeMessages([fx.messageFixture()]);
    const reads = () => inner.calls.filter(c => c.name === "read").length;
    let made = false;
    const messages = {
      ...inner,
      read: async (taskId: string) => {
        const rows = await inner.read(taskId);
        return made ? rows : [];
      },
    };
    const { t } = await mount(liveSent(), { messages });
    // Each read finds nothing, which changes nothing on the screen: every
    // one must still schedule the next.
    await t.advance(16_000);
    await t.advance(16_000);
    await t.advance(16_000);
    await t.advance(16_000);
    expect(reads()).toBeGreaterThanOrEqual(4);
    expect(button("Approve and send")).toBeUndefined();
    expect(page()).toContain("Getting the recap ready to approve…");
    made = true;
    await t.advance(16_000);
    expect(button("Approve and send")).toBeTruthy();
    expect(page()).not.toContain("Getting the recap ready to approve…");
  });

  test("the same read failure twice keeps asking too, and the step stops 15 minutes after approving turned on", async () => {
    const inner = fx.fakeMessages([fx.messageFixture()]);
    const reads = () => inner.calls.filter(c => c.name === "read").length;
    let mode: "fail" | "empty" | "row" = "fail";
    const messages = {
      ...inner,
      read: async (taskId: string) => {
        const rows = await inner.read(taskId);
        if (mode === "fail") throw Error("The messages could not be read.");
        return mode === "row" ? rows : [];
      },
    };
    const { t } = await mount(liveSent(), { messages });
    await t.advance(16_000);
    await t.advance(16_000);
    await t.advance(16_000);
    const failing = reads();
    expect(failing).toBeGreaterThanOrEqual(3);
    // The card's sentence, what to do next, never the read's own words.
    expect(recapStep().querySelector('[role="status"]').textContent).toBe(
      MESSAGES_FAILED,
    );
    // Answered again, it says it is getting the recap ready; once the 15
    // minutes are over it stops asking and says where to look instead of
    // promising the recap for ever.
    mode = "empty";
    await t.advance(16_000);
    expect(page()).toContain("Getting the recap ready to approve…");
    await t.advance(20 * 60_000);
    const stopped = reads();
    await t.advance(5 * 60_000);
    expect(reads()).toBe(stopped);
    expect(page()).not.toContain("Getting the recap ready to approve…");
    expect(recapStep().querySelector('[role="status"]').textContent).toBe(
      NOT_READY_YET,
    );
    expect(
      Array.from(recapStep().querySelectorAll("a")).some((a: any) =>
        (a.textContent ?? "").includes("Open the Messages card"),
      ),
    ).toBe(true);
  });

  test("the live header goes once the row is decided or no recap is coming, so it never tells her to approve what she cannot", async () => {
    const messages = fx.fakeMessages([fx.messageFixture()]);
    await mount(liveSent(), { messages });
    expect(page()).toContain("Approve the recap here");
    await click(button("Approve and send"));
    expect(page()).toContain("Sends within about 3 minutes.");
    expect(page()).not.toContain("Approve the recap here");
    expect(page()).not.toContain("Make still sends");
    // Back to a draft: the header is true again.
    await click(button("Edit again"));
    expect(page()).toContain("Approve the recap here");
  });

  test("the dispatch could not make the message: its own sentence", async () => {
    const reason =
      "The recap draft is empty or over 4,096 characters. Draft it again.";
    await mount(
      liveSent({
        effects: (a, at) =>
          fx
            .cockpitEffects(a, at)
            .map(e =>
              e.key === "recap"
                ? { ...e, state: "failed" as const, reason }
                : e,
            ),
      }),
      { messages: fx.fakeMessages([]) },
    );
    expect(recapStep().querySelector('[role="status"]').textContent).toBe(
      reason,
    );
  });

  test("a draft the dispatch cannot use: its sentence with Draft again, and the new draft reaches the approval (Z28)", async () => {
    expect(RECAP_UNUSABLE).toBe(
      "The recap draft is empty or over 4,096 characters. Draft it again.",
    );
    // 3.5: the stored text is over 4,096 characters, so the dispatch failed
    // the effect after reading it, and made no message row.
    const long = {
      ...fx.RECAP_READY,
      output: { ...(fx.RECAP_READY.output as object), text: "x".repeat(4097) },
    };
    const fresh = { ...fx.RECAP_READY, attempt: 2, at: "2026-10-25T08:32:00Z" };
    const inner = fx.fakeMessages([fx.messageFixture()]);
    // No row until the dispatch makes one from the new draft.
    let made = false;
    const messages = {
      ...inner,
      read: async (taskId: string) => {
        if (made) return inner.read(taskId);
        inner.calls.push({ name: "read", args: taskId });
        return [];
      },
    };
    const { fake, t } = await mount(
      liveSent({
        recap: [long],
        again: { recap: fresh },
        // Everything else has ended, so the trail alone would not be read again.
        effects: (a, at) =>
          fx.cockpitEffects(a, at).map(e =>
            e.key === "recap"
              ? {
                  ...e,
                  state: "failed" as const,
                  reason: RECAP_UNUSABLE,
                  at: "2026-10-25T08:31:00Z",
                }
              : e.key === "grade_notice"
                ? { ...e, state: "delivered" as const }
                : e,
          ),
      }),
      { messages },
    );
    // The step's first read of the recap draft; the trail has ended.
    await t.advance(1_000);
    const settled = fake.count("read");
    await t.advance(60_000);
    expect(fake.count("read")).toBe(settled);
    const step = recapStep();
    const region = () => step.querySelector('[role="status"]');
    expect(region().textContent).toBe(RECAP_UNUSABLE);
    // Drawn once beside the button, hidden from screen readers; the region says it.
    expect(String(region().className)).toContain("sr-only");
    expect(step.querySelector("p[aria-hidden]")?.textContent).toBe(
      RECAP_UNUSABLE,
    );
    const again = button("Draft again");
    expect(again).toBeTruthy();
    expect(String(again.className)).toContain("focus-visible:ring-primary-ink");
    await act(async () => again.focus());
    await click(again);
    expect(
      fake.calls.filter(c => c.name === "draftAgain").map(c => c.args),
    ).toEqual([{ id: fx.SENT_RESPONSE_ID, kind: "recap" }]);
    // The new draft is followed: the old failure is not said again, and
    // focus goes to the step, not the page.
    expect(button("Draft again")).toBeUndefined();
    expect(region().textContent).toBe(GETTING_READY);
    expect(step.textContent).not.toContain("over 4,096 characters");
    expect(win.document.activeElement?.getAttribute("aria-label")).toBe(
      "The recap for the client",
    );
    // The dispatch makes the row from the new draft; the step reads it on
    // its own poll, and the trail is read again so the rail follows.
    const reads = fake.count("read");
    made = true;
    await t.advance(16_000);
    expect(fake.count("read")).toBeGreaterThan(reads);
    expect(button("Approve and send")).toBeTruthy();
    expect(region().textContent).toBe(stateLine(fx.messageFixture()));
  });

  test("Draft again after the step stopped reading messages: the new draft reads the row again at once", async () => {
    const long = {
      ...fx.RECAP_READY,
      output: { ...(fx.RECAP_READY.output as object), text: "x".repeat(4097) },
    };
    const fresh = { ...fx.RECAP_READY, attempt: 2, at: "2026-10-25T08:52:00Z" };
    const inner = fx.fakeMessages([fx.messageFixture()]);
    let made = false;
    const messages = {
      ...inner,
      read: async (taskId: string) => {
        if (made) return inner.read(taskId);
        inner.calls.push({ name: "read", args: taskId });
        return [];
      },
    };
    const { t } = await mount(
      liveSent({
        recap: [long],
        again: { recap: fresh },
        effects: (a, at) =>
          fx.cockpitEffects(a, at).map(e =>
            e.key === "recap"
              ? {
                  ...e,
                  state: "failed" as const,
                  reason: RECAP_UNUSABLE,
                  at: "2026-10-25T08:31:00Z",
                }
              : e,
          ),
      }),
      { messages },
    );
    // Twenty minutes on: the step's 15 minutes of message reads are over.
    await t.advance(20 * 60_000);
    const before = inner.calls.filter(c => c.name === "read").length;
    await t.advance(60_000);
    expect(inner.calls.filter(c => c.name === "read").length).toBe(before);
    made = true;
    await click(button("Draft again"));
    // The new draft is read at once, with no wait for a timer.
    expect(inner.calls.filter(c => c.name === "read").length).toBeGreaterThan(
      before,
    );
    expect(button("Approve and send")).toBeTruthy();
  });

  test("past 24 hours from the send no Draft again is offered: it says to send the recap by hand (Z28)", async () => {
    const long = {
      ...fx.RECAP_READY,
      output: { ...(fx.RECAP_READY.output as object), text: "x".repeat(4097) },
    };
    const asked: string[] = [];
    const host = win.document.createElement("div");
    win.document.body.append(host);
    const root = createRoot(host as unknown as Element);
    roots.push(root);
    const late = fakeClock(Date.parse("2026-10-26T08:11:00Z"));
    await act(async () =>
      root.render(
        <CheckinRecap
          recap={long}
          call={callOf(fx.FILLED.call)}
          effect={{
            key: "recap",
            label: "Recap to the client",
            owner: "cockpit",
            delivery: "client_message",
            state: "failed",
            at: "2026-10-25T08:31:00Z",
            reason: RECAP_UNUSABLE,
            lines: [],
          }}
          onDraftAgain={() => asked.push("recap")}
          live
          messages={fx.fakeMessages([])}
          taskId={fx.TASK}
          responseId={fx.SENT_RESPONSE_ID}
          sentAt="2026-10-25T08:10:00Z"
          clock={late.clock}
        />,
      ),
    );
    await settle();
    expect(RECAP_TOO_LATE).toBe(
      "The send was over 24 hours ago, so the cockpit no longer makes this recap. Send it by hand in the group if it is still needed.",
    );
    expect(recapStep().querySelector('[role="status"]').textContent).toBe(
      `The recap draft is empty or over 4,096 characters. ${RECAP_TOO_LATE}`,
    );
    expect(button("Draft again")).toBeUndefined();
    expect(asked).toEqual([]);
  });

  test("the step's live region follows the row once its poll moves it on, never keeping the action's old line", async () => {
    let sentNow = false;
    const inner = fx.fakeMessages([fx.messageFixture()]);
    const asSent = (m: any) => ({
      ...m,
      state: "sent",
      sentAt: "2026-10-25T08:33:00Z",
      readBack: { by: "message_id", at: "2026-10-25T08:34:00Z" },
      effectState: "delivered",
    });
    const messages = {
      ...inner,
      read: async (taskId: string) => {
        const rows = await inner.read(taskId);
        return sentNow ? rows.map(asSent) : rows;
      },
    };
    const { t } = await mount(liveSent(), { messages });
    await click(button("Approve and send"));
    const region = () => recapStep().querySelector('[role="status"]');
    expect(region().textContent).toBe(
      "1-1 recap · call Sun 25 Oct: Sends within about 3 minutes.",
    );
    sentNow = true;
    // The step reads an approved row again on its 20-second poll.
    await t.advance(21_000);
    expect(page()).toContain("Read back from WhatsApp at");
    expect(region().textContent).toBe(stateLine(asSent(fx.messageFixture())));
    expect(region().textContent).not.toContain("Sends within");
    expect(recapStep().querySelectorAll('[role="status"]').length).toBe(1);
  });

  test("a shadow send keeps today's lines and reads no message", async () => {
    const messages = fx.fakeMessages([fx.messageFixture()]);
    const { t } = await mount(
      { open: "submitted", answers: fx.FILLED, recap: [fx.RECAP_READY] },
      { messages },
    );
    await t.advance(16_000);
    expect(page()).toContain(
      "Make still sends 1-1 recaps until the switch-over, so this one is not sent from here.",
    );
    expect(page()).not.toContain("Approve the recap here");
    expect(page()).toContain(
      "This is what the cockpit would send to the client's WhatsApp group.",
    );
    expect(messages.calls.length).toBe(0);
    expect(recapStep().querySelectorAll('[role="status"]').length).toBe(1);
  });

  test("the card writer's 15-minute line reads the window's clock", async () => {
    const { t } = await mount(
      liveSent({
        effects: (a, at) =>
          fx
            .cockpitEffects(a, at)
            .map(e =>
              e.key === "todo_comment"
                ? { ...e, state: "queued" as const, at: fx.NOW }
                : e,
            ),
      }),
      { messages: fx.fakeMessages([fx.messageFixture()]) },
    );
    expect(page()).toContain("Posting the to-do comment on the card…");
    await t.advance(16 * 60_000);
    expect(page()).toContain(
      "Still waiting for the card writer. The tech lead is told after 15 minutes.",
    );
  });
});

describe("Move it here (5.3)", () => {
  const movable = { others: [fx.VIEWS.other_movable], drafts: READY };
  /** The movable recording, as its Move it here is described. */
  const MOVABLE_SAID = `Impromptu Google Meet Sun 25 Oct 10:34–11:08 · 34 min By the account manager · On ${fx.OTHER}. If this is ${fx.NAME}'s call, move it here.`;
  const moveButton = () => button("Move it here");
  const dialog = () =>
    win.document.body.querySelector('[role="alertdialog"]') as any;

  test("an admin sees it beside the disabled row; it confirms, moves, toasts, re-reads and picks the moved call", async () => {
    const { fake } = await mount(movable, { seat: "admin" });
    await click(button("Change"));
    expect(page()).toContain(
      `On ${fx.OTHER}. If this is ${fx.NAME}'s call, move it here.`,
    );
    const row = buttons().find(b =>
      (b.textContent ?? "").includes(`If this is ${fx.NAME}'s call`),
    );
    expect(row?.disabled).toBe(true);
    // A sibling of the disabled row, in the same list item.
    expect(moveButton()?.closest("li")).toBe(row?.closest("li"));
    expect(String(moveButton().className)).toContain(
      "focus-visible:ring-primary-ink",
    );
    // The disabled row cannot take focus, so the button says which
    // recording it moves: its title, its time and the row's sentence.
    expect(described(moveButton())).toBe(MOVABLE_SAID);
    await click(moveButton());
    expect(dialog()).toBeTruthy();
    expect(dialog().textContent).toContain(
      `Move this recording to ${fx.NAME}?`,
    );
    expect(dialog().textContent).toContain(
      `It leaves ${fx.OTHER}'s Calls card and goes on ${fx.NAME}'s. The move is recorded with your name.`,
    );
    const actions = Array.from(dialog().querySelectorAll("button")).map(
      (b: any) => (b.textContent ?? "").trim(),
    );
    expect(actions).toEqual([`Keep it on ${fx.OTHER}`, "Move it here"]);
    const calls = fake.count("calls");
    const go = Array.from(dialog().querySelectorAll("button")).find(
      (b: any) => (b.textContent ?? "").trim() === "Move it here",
    );
    await click(go);
    expect(fake.calls.find(c => c.name === "move")?.args).toEqual({
      recordingId: fx.VIEWS.other_movable.recordingId,
      taskId: fx.TASK,
    });
    expect(toasts).toContain(`Moved to ${fx.NAME}.`);
    expect(fake.count("calls")).toBe(calls + 1);
    // The sheet closed on the call card, now teal with the store's sentence.
    expect(page()).not.toContain("Pick the call");
    expect(thisCall()?.textContent).toContain(
      `On ${fx.NAME} in the call store.`,
    );
    expect(String(thisCall()?.className)).toContain("glow-teal");
  });

  test("two movable recordings: each Move it here is described by its own recording", async () => {
    const second = {
      ...fx.VIEWS.other_movable,
      ref: "fathom:190000199",
      recordingId: "190000199",
      callId: 60099,
      title: "Showroom walkthrough",
      startsAt: "2026-10-24T11:00:00Z",
      endsAt: "2026-10-24T11:20:00Z",
      minutes: 20,
    };
    await mount(
      { others: [fx.VIEWS.other_movable, second], drafts: READY },
      { seat: "admin" },
    );
    await click(button("Change"));
    const moves = buttons().filter(
      b => (b.textContent ?? "").trim() === "Move it here",
    );
    expect(moves.length).toBe(2);
    // The visible words stay the same; the description tells them apart.
    expect(moves.map(b => described(b))).toEqual([
      MOVABLE_SAID,
      `Showroom walkthrough Sat 24 Oct 14:00–14:20 · 20 min By the account manager · On ${fx.OTHER}. If this is ${fx.NAME}'s call, move it here.`,
    ]);
    for (const b of moves) expect(b.getAttribute("aria-label")).toBeNull();
  });

  test("the confirm takes focus on opening, on its safe answer, Keep it", async () => {
    await mount(movable, { seat: "admin" });
    await click(button("Change"));
    const trigger = moveButton();
    await act(async () => trigger.focus());
    await click(trigger);
    const keep = Array.from(dialog().querySelectorAll("button")).find(
      (b: any) => (b.textContent ?? "").trim() === `Keep it on ${fx.OTHER}`,
    );
    expect(keep).toBeTruthy();
    // Not left on the trigger behind the modal, where a screen reader
    // never hears the dialog and Tab walks the Change sheet first.
    expect(win.document.activeElement).not.toBe(trigger);
    expect(dialog().contains(win.document.activeElement)).toBe(true);
    expect(win.document.activeElement).toBe(keep);
  });

  test("Keep it closes the confirm and moves nothing", async () => {
    const { fake } = await mount(movable, { seat: "admin" });
    await click(button("Change"));
    await click(moveButton());
    const keep = Array.from(dialog().querySelectorAll("button")).find(
      (b: any) => (b.textContent ?? "").trim() === `Keep it on ${fx.OTHER}`,
    );
    await click(keep);
    expect(dialog()).toBeNull();
    expect(fake.count("move")).toBe(0);
  });

  test("a refusal shows the server's sentence under the row, and focus stays on Move it here", async () => {
    const said = `That recording has 1-1 notes on ${fx.OTHER}. If those notes are on the wrong client too, tell the tech lead.`;
    await mount({ ...movable, move: { refused: said } }, { seat: "admin" });
    await click(button("Change"));
    await click(moveButton());
    const go = Array.from(dialog().querySelectorAll("button")).find(
      (b: any) => (b.textContent ?? "").trim() === "Move it here",
    );
    await click(go);
    await settle();
    expect(dialog()).toBeNull();
    const alert = moveButton()?.closest("li")?.querySelector('[role="alert"]');
    expect(alert?.textContent).toBe(said);
    // The recording first, then the server's sentence.
    expect(described(moveButton())).toBe(`${MOVABLE_SAID} ${said}`);
    expect(win.document.activeElement).toBe(moveButton());
    expect(toasts).toEqual([]);
  });

  test("not in the database yet: said plainly", async () => {
    await mount({ ...movable, move: "not_live" }, { seat: "admin" });
    await click(button("Change"));
    await click(moveButton());
    const go = Array.from(dialog().querySelectorAll("button")).find(
      (b: any) => (b.textContent ?? "").trim() === "Move it here",
    );
    await click(go);
    expect(page()).toContain("Moving a recording is not live yet.");
  });

  test("never for the CSM, a rehearsal, a recording the door does not mark movable, or while sending", async () => {
    await mount(movable, { seat: "csm" });
    await click(button("Change"));
    expect(moveButton()).toBeUndefined();
    for (const r of roots.splice(0)) await act(async () => r.unmount());
    win.document.body.innerHTML = "";
    await mount(movable, { seat: "admin", rehearse: true });
    await click(button("Change"));
    expect(moveButton()).toBeUndefined();
    for (const r of roots.splice(0)) await act(async () => r.unmount());
    win.document.body.innerHTML = "";
    await mount(
      { others: [fx.VIEWS.other_client], drafts: READY },
      { seat: "admin" },
    );
    await click(button("Change"));
    expect(moveButton()).toBeUndefined();
    // An older door answer has no flag: it parses as not movable.
    const { movable: _drop, ...older } = fx.VIEWS.other_movable;
    expect(callView.parse(older).movable).toBe(false);
  });
});
