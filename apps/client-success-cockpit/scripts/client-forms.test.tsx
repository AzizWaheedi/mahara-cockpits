import {
  afterAll,
  beforeEach,
  describe,
  expect,
  mock,
  setDefaultTimeout,
  test,
} from "bun:test";
import { Window } from "happy-dom";

/**
 * Client forms in the cockpit (docs/forms/WAVE34-CONTRACT.md 3.3, 4.10, 5.1
 * to 5.3, section 8 cockpit-screens row): Send a form's presence line and
 * default channels per form from cockpit_form_invite_view, each disabled
 * form's reason (the exit survey without a departure), the SQL refusals
 * word for word, the toast from `delivered`, one request id per open panel
 * kept through a retry, the WhatsApp approval through invite.approve; Forms
 * out's words and delivery rings for every state, Copy a link shown once and
 * never stored, Withdraw; Today's form bands with their buttons, hidden when
 * empty, the low-score ticket only once its type exists; the pause consent
 * on Today and in the pause sheet (the ticks give way, Confirm waits for the
 * signature and sends consentResponseId); every read waits on its door.
 * The RPCs are stand-ins in memory: nothing reaches the database, the
 * portal or WhatsApp.
 *
 * Run: bun test scripts/client-forms.test.tsx
 */

setDefaultTimeout(30_000);

const win = new Window({
  url: "https://localhost/client-success/clients/86exfix01?tab=overview",
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
const copied: string[] = [];
Object.defineProperty(win.navigator, "clipboard", {
  configurable: true,
  value: { writeText: async (t: string) => void copied.push(t) },
});

const toasts: string[] = [];
mock.module("sonner", () => ({
  toast: Object.assign((m: string) => toasts.push(m), {
    success: (m: string) => toasts.push(m),
    error: (m: string) => toasts.push(m),
    warning: (m: string) => toasts.push(m),
    info: (m: string) => toasts.push(m),
  }),
  Toaster: () => null,
}));
mock.module("@/auth/SupabaseAuthProvider", () => ({
  getCockpitSupabaseClient: () => null,
  SupabaseAuthProvider: ({ children }: { children: unknown }) => children,
  useCockpitAuth: () => ({ client: null, isCeo: false, roles: ["csm"] }),
}));

const { createRoot } = await import("react-dom/client");
const { act, createElement } = await import("react");
const core = await import("../src/lib/clientFormsCore");
const forms = await import("../src/lib/clientForms");
const ui = await import("../src/components/ClientForms");
const messages = await import("../src/lib/clientMessages");
const fx = await import("../src/dev/clientFormsFixtures");
const page = await import("../src/pages/CsmPage");
const sheetCore = await import("../src/forms/staff/formSheetCore");
const defs = await import("../src/forms/staff/formDefs");

const roots: ReturnType<typeof createRoot>[] = [];
afterAll(async () => {
  for (const r of roots) await act(async () => r.unmount());
  await win.happyDOM.close();
});
beforeEach(() => {
  toasts.length = 0;
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
  return { host: host as any, root };
}
const body = () => win.document.body as any;
const text = (el: any) =>
  String(el?.textContent ?? "")
    .replace(/\s+/g, " ")
    .trim();
const buttons = (root: any = body()) =>
  [...root.querySelectorAll("button")] as any[];
const button = (label: string, root: any = body()) =>
  buttons(root).find(b => text(b) === label);
async function click(el: any) {
  expect(el).toBeTruthy();
  await act(async () => {
    el.click();
  });
  await flush();
}
async function type(el: any, value: string) {
  const proto = Object.getPrototypeOf(el);
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  await act(async () => {
    setter?.call(el, value);
    el.dispatchEvent(new (win as any).Event("input", { bubbles: true }));
  });
  await flush();
}
async function unmount(root: any) {
  await act(async () => root.unmount());
  await flush();
}

/** The Kuwait day n days from now, "YYYY-MM-DD". */
const kuwaitPlus = (n: number) =>
  new Date(Date.now() + 3 * 3600_000 + n * 86_400_000)
    .toISOString()
    .slice(0, 10);

// --- The words ---------------------------------------------------------------------------

describe("the presence line and the default channels, per form (3.3, 5.1)", () => {
  const nps = fx.VIEW.forms[0];
  const exit = fx.VIEW.forms[2];
  test("each presence case reads its 5.1 sentence", () => {
    expect(core.presenceLine(fx.VIEWS.recent, nps, fx.NOW)).toBe(
      "Opened the portal 2 days ago · 3 people",
    );
    expect(core.presenceLine(fx.VIEWS.none, nps, fx.NOW)).toBe(
      "No Mahara OS workspace: the WhatsApp link goes.",
    );
    expect(core.presenceLine(fx.VIEWS.closed, nps, fx.NOW)).toBe(
      "Workspace closed: send the link by WhatsApp.",
    );
    expect(core.presenceLine(fx.VIEWS.notReported, nps, fx.NOW)).toBe(
      "We can't see portal visits yet, so it goes to the portal and by WhatsApp.",
    );
    expect(core.presenceLine(fx.VIEWS.quiet, nps, fx.NOW)).toBe(
      "Has not opened the portal in 14 days, so the WhatsApp link goes too.",
    );
    // An admin-only form with members only.
    expect(core.presenceLine(fx.VIEWS.membersOnly, exit, fx.NOW)).toBe(
      "No admin has opened the portal in 14 days, so the WhatsApp link goes too.",
    );
    // The same client for an any-audience form: members count.
    expect(core.presenceLine(fx.VIEWS.membersOnly, nps, fx.NOW)).toBe(
      "Opened the portal 1 day ago · 2 people",
    );
  });

  test("the server's per-form channels win; the rule fills in when it gave none", () => {
    expect(core.defaultChannels(fx.VIEW, nps, fx.NOW)).toEqual(["portal"]);
    expect(core.defaultChannels(fx.VIEW, exit, fx.NOW)).toEqual([
      "portal",
      "whatsapp",
    ]);
    const bare = (v: any, f: any) =>
      core.defaultChannels(v, { ...f, defaultChannels: [] }, fx.NOW);
    expect(bare(fx.VIEWS.none, nps)).toEqual(["whatsapp"]);
    expect(bare(fx.VIEWS.closed, nps)).toEqual(["whatsapp"]);
    expect(bare(fx.VIEWS.notReported, nps)).toEqual(["portal", "whatsapp"]);
    expect(bare(fx.VIEWS.quiet, nps)).toEqual(["portal", "whatsapp"]);
    expect(bare(fx.VIEWS.membersOnly, nps)).toEqual(["portal"]);
    expect(bare(fx.VIEWS.membersOnly, exit)).toEqual(["portal", "whatsapp"]);
  });

  test("the toast follows delivered; the network line names the button", () => {
    expect(core.sendToast("portal")).toBe("Sent");
    expect(core.sendToast("waiting_approval")).toBe(
      "Saved. Approve the WhatsApp message to send it.",
    );
    expect(core.networkSentence("csat")).toBe(
      "Not sent. Check your connection and press Send the onboarding survey again.",
    );
    expect(core.sendLabel("nps")).toBe("Send the NPS survey");
    expect(core.sendLabel("exit_survey")).toBe("Send the exit survey");
  });

  test("a view read defensively: missing counts stay null, never 0", () => {
    const v = core.inviteView({
      taskId: "86exfix01",
      presence: {},
      forms: [{ key: "nps" }, { nope: 1 }],
      open: [{ id: "x", formKey: "nps", channels: ["portal", "fax"] }],
    });
    expect(v?.presence.admins).toBeNull();
    expect(v?.presence.members).toBeNull();
    expect(v?.forms.map(f => f.key)).toEqual(["nps"]);
    expect(v?.open[0].channels).toEqual(["portal"]);
    expect(v?.clientName).toBe("This client");
    expect(core.inviteView({})).toBeNull();
  });
});

describe("the delivery line and the state words (5.0, 5.2)", () => {
  const ring = (key: string) =>
    core.deliveryLine(fx.INVITES[key], fx.NOW).rings;
  const states = (key: string) =>
    Object.fromEntries(ring(key).map(r => [r.key, r.state]));
  test("portal: Sent → Seen → Opened → Answered, the next one waiting", () => {
    expect(states("sent")).toEqual({
      sent: "done",
      seen: "waiting",
      opened: "todo",
      answered: "todo",
    });
    expect(states("opened")).toEqual({
      sent: "done",
      seen: "done",
      opened: "done",
      answered: "waiting",
    });
    expect(states("answered")).toEqual({
      sent: "done",
      seen: "done",
      opened: "done",
      answered: "done",
    });
    expect(ring("answered").find(r => r.key === "answered")?.at).toBe(
      fx.INVITES.answered.answeredAt,
    );
  });
  test("a WhatsApp invite starts with Approve; a draft waits on it", () => {
    expect(ring("approval").map(r => r.label)).toEqual([
      "Approve",
      "Sent",
      "Seen",
      "Opened",
      "Answered",
    ]);
    expect(states("approval").approve).toBe("waiting");
    expect(states("schedule").approve).toBe("done");
  });
  test("withdrawn and expired cut the line with their word, nothing waits", () => {
    const w = core.deliveryLine(fx.INVITES.withdrawn, fx.NOW);
    expect(w.cut?.word).toBe("Withdrawn");
    expect(w.rings.some(r => r.state === "waiting")).toBe(false);
    const e = core.deliveryLine(fx.INVITES.expired, fx.NOW);
    expect(e.cut).toEqual({
      word: "Expired",
      at: fx.INVITES.expired.expiresAt,
    });
  });
  test("every state in 5.2's words", () => {
    const w = (k: string) => core.inviteStateWords(fx.INVITES[k], fx.NOW);
    expect(w("approval")).toBe("Waiting for approval");
    expect(w("sent")).toBe("Sent 30 Oct");
    expect(w("seen")).toBe("Seen 31 Oct");
    expect(w("opened")).toBe("Opened 31 Oct");
    expect(w("answered")).toBe("Answered 31 Oct");
    expect(w("expired")).toBe("Expired 20 Oct");
    expect(w("withdrawn")).toBe(
      "Withdrawn: The client asked us to wait a week",
    );
  });
});

describe("the client text rule before a press (V18)", () => {
  test("leads, CPL and guarantees are refused in both languages; the people who reached you are not", () => {
    for (const t of [
      "You got 40 leads",
      "وصلكم ليدز وايد",
      "Your CPL is low",
      "cost per lead",
    ])
      expect(core.clientTextProblem(t)).toBe(core.TEXT_LEADS);
    for (const t of ["We guarantee results", "نضمن لك النتيجة"])
      expect(core.clientTextProblem(t)).toBe(core.TEXT_GUARANTEE);
    expect(
      core.clientTextProblem("The people who reached you through the ads"),
    ).toBeNull();
  });
  test("the WhatsApp text keeps {form_link} exactly once", () => {
    expect(core.whatsappProblem("Hi, answer here")).toBe(core.LINK_ONCE);
    expect(core.whatsappProblem("{form_link} and {form_link}")).toBe(
      core.LINK_ONCE,
    );
    expect(core.whatsappProblem("Hi, answer here: {form_link}")).toBeNull();
  });
});

describe("the doors (3.3)", () => {
  test("an error or a missing flag reads as closed", async () => {
    const closed = await forms.readAllDoors({
      rpc: async () => ({ data: null, error: { message: "boom" } }),
    } as any);
    expect(closed.more).toEqual(forms.NO_MORE_DOORS);
    const some = await forms.readAllDoors({
      rpc: async () => ({ data: { pause: true, invites: true }, error: null }),
    } as any);
    expect(some.doors.pause).toBe(true);
    expect(some.more).toEqual({
      invites: true,
      lifecycle: false,
      voice: false,
      editor: false,
    });
  });

  test("a closed door makes no call: the view, Today's forms and the low scores wait", async () => {
    const io = fx.fakeFormsIO();
    let low = 0;
    function Probe() {
      ui.useInviteView(io, fx.TASK, false);
      ui.useFormBands(null, null, false, 0);
      ui.useFormBands(
        io,
        async () => {
          low++;
          return [];
        },
        false,
        0,
      );
      return null;
    }
    const { root } = await draw(createElement(Probe));
    expect(io.calls).toEqual([]);
    expect(low).toBe(0);
    await unmount(root);
  });

  test("a link the server answers in any other shape is refused, never shown", async () => {
    const c: any = {
      rpc: async () => ({
        data: { url: "https://evil.example/f#x", expiresAt: null },
        error: null,
      }),
    };
    await expect(forms.inviteLink(c, fx.TASK, "x")).rejects.toThrow(
      forms.FORMS_SHAPE,
    );
  });

  test("form links stay out of the recap card", () => {
    expect(messages.isRecap({ kind: "recap_checkin" })).toBe(true);
    expect(messages.isRecap({ kind: "form_invite" })).toBe(false);
  });
});

// --- Send a form -----------------------------------------------------------------------------

describe("Send a form (5.1)", () => {
  const open = (io: any, extra: Record<string, unknown> = {}) =>
    draw(
      createElement(ui.SendFormSheet, {
        io,
        open: true,
        taskId: fx.TASK,
        clientName: fx.NAME,
        now: fx.NOW,
        onClose: () => {},
        ...extra,
      }),
    );
  // The newest sheet: a closed one may linger in the portal while it animates out.
  const sheet = () =>
    [...body().querySelectorAll("[data-send-form]")].at(-1) as any;
  const button = (label: string) =>
    buttons(sheet()).find(b => text(b) === label);

  test("the presence line, the form chips and each disabled form's reason", async () => {
    const io = fx.fakeFormsIO();
    const { root } = await open(io);
    expect(text(sheet()?.querySelector("[data-presence]"))).toBe(
      "Opened the portal 2 days ago · 3 people",
    );
    const chips = [...sheet().querySelectorAll("[data-form-chip]")] as any[];
    expect(chips.map(text)).toEqual([
      "NPS survey",
      "Onboarding survey",
      "Exit survey",
    ]);
    // The exit survey waits on a departure: disabled, with the database's sentence.
    const exit = chips.find(
      c => c.getAttribute("data-form-chip") === "exit_survey",
    );
    expect(exit.getAttribute("aria-disabled")).toBe("true");
    const why = text(sheet().querySelector("[data-why]"));
    expect(why).toContain(
      "Exit survey: Mark Client is leaving first, then send the exit survey.",
    );
    expect(why).toContain(
      "Onboarding survey: They already filled it on 20 Oct.",
    );
    // Pause consent is never a chip here: it goes from Pause this client.
    expect(
      chips.some(c => c.getAttribute("data-form-chip") === "pause_consent"),
    ).toBe(false);
    // The portal by default for a client seen this week; no WhatsApp text box.
    expect(
      sheet()
        .querySelector("[data-channel=portal]")
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      sheet()
        .querySelector("[data-channel=whatsapp]")
        .getAttribute("aria-pressed"),
    ).toBe("false");
    expect(sheet().querySelector("#send-form-text")).toBeNull();
    // A disabled chip pressed sends nothing.
    await click(exit);
    expect(io.calls.filter(c => c.op === "issue")).toEqual([]);
    await unmount(root);
  });

  test("Send: one issue with the picked form and channels, origin csm, and Sent when the portal is a channel", async () => {
    const io = fx.fakeFormsIO();
    const { root } = await open(io);
    await click(button("Send the NPS survey"));
    const issue = io.calls.find(c => c.op === "issue")?.args as any;
    expect(issue).toMatchObject({
      taskId: fx.TASK,
      formKey: "nps",
      channels: ["portal"],
      origin: "csm",
      lang: "ar",
      push: false,
      note: null,
    });
    expect(issue.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(toasts).toEqual(["Sent"]);
    expect(text(sheet())).toContain(
      `Sent: the NPS survey to ${fx.NAME} in their portal.`,
    );
    await unmount(root);
  });

  test("a refusal reads the SQL sentence word for word; a lost connection keeps the request id", async () => {
    const said =
      "A NPS survey is already out to Castello Industries, sent 30 Oct. Withdraw it to send a new one.";
    const refused = fx.fakeFormsIO({ refuse: { issue: said } });
    const a = await open(refused);
    await click(button("Send the NPS survey"));
    expect(text(sheet().querySelector("[data-send-error]"))).toBe(said);
    await unmount(a.root);

    const io = fx.fakeFormsIO({ dropIssue: 1 });
    const b = await open(io);
    await click(button("Send the NPS survey"));
    expect(text(sheet().querySelector("[data-send-error]"))).toBe(
      "Not sent. Check your connection and press Send the NPS survey again.",
    );
    await click(button("Send the NPS survey"));
    const ids = io.calls
      .filter(c => c.op === "issue")
      .map(c => (c.args as any).requestId);
    expect(ids.length).toBe(2);
    expect(ids[0]).toBe(ids[1]);
    expect(toasts).toEqual(["Sent"]);
    await unmount(b.root);

    // A new open is a new request id.
    const c2 = await open(io);
    await click(button("Send the NPS survey"));
    const third = io.calls.filter(c => c.op === "issue").at(-1)?.args as any;
    expect(third.requestId).not.toBe(ids[0]);
    await unmount(c2.root);
  });

  test("no workspace: the WhatsApp link alone, Saved until approved, then Approve and send through invite.approve", async () => {
    const io = fx.fakeFormsIO({ view: fx.VIEWS.none });
    const { root } = await open(io);
    expect(text(sheet().querySelector("[data-presence]"))).toBe(
      "No Mahara OS workspace: the WhatsApp link goes.",
    );
    expect(
      sheet()
        .querySelector("[data-channel=portal]")
        .getAttribute("aria-disabled"),
    ).toBe("true");
    const box = sheet().querySelector("#send-form-text");
    expect(box.getAttribute("dir")).toBe("rtl");
    expect(box.value).toContain(fx.NAME);
    expect(box.value).toContain("{form_link}");
    // The placeholder removed: refused before any call.
    await type(box, "هلا، جاوبوا هني");
    await click(button("Send the NPS survey"));
    expect(text(sheet().querySelector("[data-send-error]"))).toBe(
      core.LINK_ONCE,
    );
    expect(io.calls.filter(c => c.op === "issue")).toEqual([]);
    await type(box, "هلا فريق Castello، جاوبوا من هني: {form_link}");
    await click(button("Send the NPS survey"));
    expect(io.calls.find(c => c.op === "issue")?.args).toMatchObject({
      channels: ["whatsapp"],
    });
    expect(toasts).toEqual(["Saved. Approve the WhatsApp message to send it."]);
    expect(text(sheet().querySelector("[data-approve-line]"))).toBe(
      "The WhatsApp message waits for your approval.",
    );
    await click(button("Approve and send"));
    const approve = io.calls.find(c => c.op === "approve")?.args as any;
    expect(approve).toEqual({
      messageId: "77777777-0000-4000-8000-000000000001",
      body: "هلا فريق Castello، جاوبوا من هني: {form_link}",
      acceptWarnings: false,
    });
    expect(text(sheet().querySelector("[data-approve-line]"))).toBe(
      "Approved. It sends within about 3 minutes.",
    );
    await unmount(root);
  });

  test("invite.approve goes to cockpit-forms-api as a seat op; its refusal reads as said", async () => {
    const sent: any[] = [];
    const c: any = {
      functions: {
        invoke: async (name: string, o: any) => {
          sent.push({ name, body: o.body });
          return {
            data: { error: "Approve recaps from the Messages card." },
            error: null,
          };
        },
      },
    };
    await expect(
      forms.approveInvite(c, { messageId: "m1", body: "x {form_link}" }),
    ).rejects.toThrow("Approve recaps from the Messages card.");
    expect(sent).toEqual([
      {
        name: "cockpit-forms-api",
        body: { op: "invite.approve", messageId: "m1", body: "x {form_link}" },
      },
    ]);
  });

  test("a note with lead numbers is refused under the box", async () => {
    const io = fx.fakeFormsIO();
    const { root } = await open(io);
    await type(sheet().querySelector("#send-form-note"), "Your leads are up");
    expect(text(sheet().querySelector("#send-form-note-hint"))).toBe(
      core.TEXT_LEADS,
    );
    await click(button("Send the NPS survey"));
    expect(io.calls.filter(c => c.op === "issue")).toEqual([]);
    await unmount(root);
  });

  test("from the churn tracker: the exit survey preset, origin churn", async () => {
    const io = fx.fakeFormsIO({ view: fx.VIEWS.leaving });
    const { root } = await open(io, {
      preset: { formKey: "exit_survey", origin: "churn" },
    });
    expect(text(sheet().querySelector("[data-why]"))).toContain(
      `NPS survey: ${fx.NAME} is leaving. Send the exit survey instead.`,
    );
    await click(button("Send the exit survey"));
    expect(io.calls.find(c => c.op === "issue")?.args).toMatchObject({
      formKey: "exit_survey",
      origin: "churn",
      channels: ["portal", "whatsapp"],
    });
    await unmount(root);
  });
});

// --- Forms out -----------------------------------------------------------------------------------

describe("Forms out (5.2)", () => {
  const read = (view: any) => ({
    view,
    error: null,
    loading: false,
    reload: () => {},
    put: () => {},
  });

  test("each invite with its words and rings; the empty card says what to do", async () => {
    const io = fx.fakeFormsIO();
    const { host, root } = await draw(
      createElement(ui.FormsOut, { io, read: read(fx.VIEW), onSend: () => {} }),
    );
    const rows = [...host.querySelectorAll("[data-invite]")] as any[];
    expect(rows.map(r => text(r.querySelector("p")))).toEqual([
      "Onboarding survey · Waiting for approval",
      "NPS survey · Opened 31 Oct",
      "NPS survey · Answered 31 Oct",
      "NPS survey · Withdrawn: The client asked us to wait a week",
    ]);
    const ringsOf = (r: any) =>
      [...r.querySelectorAll("[data-ring]")].map(
        (x: any) =>
          `${x.getAttribute("data-ring")}:${x.getAttribute("data-state") ?? ""}`,
      );
    expect(ringsOf(rows[0])).toEqual([
      "approve:waiting",
      "sent:todo",
      "seen:todo",
      "opened:todo",
      "answered:todo",
    ]);
    expect(ringsOf(rows[3]).at(-1)).toBe("cut:");
    // Actions by state: approve a draft; read an answer; nothing to do on a closed one.
    expect(button("Approve and send", rows[0])).toBeTruthy();
    expect(button("Read the answer", rows[2])).toBeTruthy();
    expect(button("Withdraw", rows[3])).toBeUndefined();
    expect(button("Copy a link", rows[1])).toBeTruthy();
    expect(text(rows[1])).toContain("See what they see");
    await unmount(root);

    const empty = await draw(
      createElement(ui.FormsOut, {
        io,
        read: read(fx.VIEWS.empty),
        onSend: () => {},
      }),
    );
    expect(text(empty.host.querySelector("[data-empty]"))).toBe(
      "No forms out. Send one with Send a form.",
    );
    await unmount(empty.root);
  });

  test("Copy a link: the link once, never stored, gone when the dialog closes", async () => {
    const io = fx.fakeFormsIO();
    win.localStorage.clear();
    win.sessionStorage.clear();
    const { host, root } = await draw(
      createElement(ui.FormsOut, { io, read: read(fx.VIEW), onSend: () => {} }),
    );
    const row = host.querySelector(`[data-invite="${fx.INVITES.opened.id}"]`);
    await click(button("Copy a link", row));
    const url = `https://portal.maharamedia.com/f#f1${"A".repeat(43)}`;
    expect(text(body().querySelector("[data-link-url]"))).toBe(url);
    expect(text(body())).toContain(
      "This link works once and ends on 13 Nov. It is shown only now.",
    );
    await click(button("Copy link"));
    expect(copied.at(-1)).toBe(url);
    expect(button("Copied")).toBeTruthy();
    const stored =
      JSON.stringify({ ...win.localStorage }) +
      JSON.stringify({ ...win.sessionStorage });
    expect(stored).not.toContain("f1AAAA");
    await act(async () => {
      body().dispatchEvent(
        new (win as any).KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
        }),
      );
    });
    await flush();
    expect(body().querySelector("[data-link-url]")).toBeNull();
    expect(text(body())).not.toContain(url);
    await unmount(root);
  });

  test("Withdraw asks why, then withdraws once", async () => {
    const io = fx.fakeFormsIO();
    const { host, root } = await draw(
      createElement(ui.FormsOut, { io, read: read(fx.VIEW), onSend: () => {} }),
    );
    const row = host.querySelector(`[data-invite="${fx.INVITES.opened.id}"]`);
    await click(button("Withdraw", row));
    expect(
      row.querySelector("#withdraw-reason").getAttribute("placeholder"),
    ).toBe("Why are you withdrawing it?");
    await click(button("Withdraw", row));
    expect(io.calls.filter(c => c.op === "withdraw")).toEqual([]);
    await type(
      row.querySelector("#withdraw-reason"),
      "They asked to answer next month",
    );
    await click(button("Withdraw", row));
    expect(io.calls.find(c => c.op === "withdraw")?.args).toEqual({
      t: fx.TASK,
      i: fx.INVITES.opened.id,
      r: "They asked to answer next month",
    });
    expect(toasts).toContain("Withdrawn");
    await unmount(root);
  });

  test("Read the answer: the fields as given, Arabic kept whole, never an email", async () => {
    const io = fx.fakeFormsIO();
    const { root } = await draw(
      createElement(ui.AnswerSheet, {
        io,
        responseId: fx.INVITES.answered.responseId,
        onClose: () => {},
      }),
    );
    const sheet = body().querySelector("[data-answer]");
    expect(text(sheet)).toContain(
      "Answered 31 Oct by the client admin in the portal",
    );
    expect(text(sheet)).toContain("ابدوا ترسلون تقرير أسبوعي أقصر");
    expect(text(sheet)).not.toMatch(/@/);
    await unmount(root);
  });
});

// --- Today ------------------------------------------------------------------------------------

describe("Today's form bands (5.3)", () => {
  const bands = (rows: any[] | null, low: any[] | null = []) => ({
    invites: { rows, error: null },
    low: { rows: low, error: null },
    reload: () => {},
  });
  const draw3 = (
    b: any,
    types: Set<string> | null,
    extra: Record<string, unknown> = {},
  ) =>
    draw(
      createElement(ui.FormBands, {
        io: fx.fakeFormsIO(),
        bands: b,
        ticketTypes: types,
        onSend: () => {},
        onOpenClient: () => {},
        onTicket: () => {},
        onChanged: () => {},
        ...extra,
      }),
    );

  test("each row kind with its sentence and its button", async () => {
    const sent: any[] = [];
    const { host, root } = await draw3(
      bands(fx.TODAY_ROWS, fx.LOW_SCORES),
      new Set(),
      {
        onSend: (...a: any[]) => sent.push(a),
      },
    );
    const rows = [...host.querySelectorAll("[data-band-row]")].map((r: any) =>
      text(r),
    );
    expect(rows).toEqual([
      "NPS sent: Castello Industries",
      `WhatsApp link to approve: onboarding survey for ${fx.NAME_AR}Approve and send`,
      "Not answered: NPS survey to Castello Industries, sent 8 days agoSend again",
      "Answered: NPS survey from Castello IndustriesRead the answer",
      "Send the exit survey to Shades StudioSend exit survey",
      "Low score: Castello Industries gave 4/10 on the NPS surveyOpen the client",
    ]);
    // The client's name in a bdi: an Arabic name stays whole.
    expect(host.querySelector("bdi")).toBeTruthy();
    await click(button("Send exit survey", host));
    expect(sent).toEqual([
      [
        "86exfix02",
        "Shades Studio",
        { formKey: "exit_survey", origin: "churn" },
      ],
    ]);
    await unmount(root);
  });

  test("Approve and send from Today reads the draft's text, then approves it", async () => {
    const io = fx.fakeFormsIO();
    const { host, root } = await draw3(bands([fx.TODAY_ROWS[2]]), null, { io });
    await click(button("Approve and send", host));
    expect(io.calls.map(c => c.op)).toEqual(["messageBody", "approve"]);
    expect((io.calls[1].args as any).messageId).toBe(
      fx.INVITES.approval.messageId,
    );
    expect(toasts).toContain("Approved. It sends within about 3 minutes.");
    await unmount(root);
  });

  test("nothing to show: no band at all", async () => {
    const { host, root } = await draw3(bands([], []), null);
    expect(host.querySelectorAll("[data-band-row]").length).toBe(0);
    expect(host.querySelectorAll("section").length).toBe(0);
    await unmount(root);
  });

  test("the low-score ticket shows once its type exists, and not once a ticket is open", async () => {
    const tickets: any[] = [];
    const a = await draw3(bands([], fx.LOW_SCORES), new Set(["client_pause"]));
    expect(button("Open the low-score ticket", a.host)).toBeUndefined();
    await unmount(a.root);
    const b = await draw3(
      bands([], fx.LOW_SCORES),
      new Set(["client_low_score"]),
      {
        onTicket: (t: any) => tickets.push(t),
      },
    );
    await click(button("Open the low-score ticket", b.host));
    expect(tickets).toEqual([
      {
        type: "client_low_score",
        taskId: fx.TASK,
        name: fx.NAME,
        details:
          "Castello Industries gave 4/10 on the NPS survey on 31 Oct. Call them today.",
      },
    ]);
    await unmount(b.root);
    const c = await draw3(
      bands([], [{ ...fx.LOW_SCORES[0], ticketOpen: true }]),
      new Set(["client_low_score"]),
    );
    expect(button("Open the low-score ticket", c.host)).toBeUndefined();
    expect(text(c.host)).toContain("The low-score ticket is open.");
    await unmount(c.root);
  });

  test("a failed read is said, never an empty Today", async () => {
    const { host, root } = await draw3(
      {
        invites: { rows: null, error: "permission denied" },
        low: { rows: [], error: null },
        reload: () => {},
      },
      null,
    );
    expect(text(host)).toContain(
      "The client forms could not be read, so a row may be missing: permission denied",
    );
    await unmount(root);
  });
});

// --- The pause consent: Today's band and the pause sheet (4.3.6, 5.2, 5.3) -----------------------------

function fakeClient(answers: Record<string, unknown>) {
  const rpcs: { name: string; args: any }[] = [];
  return {
    rpcs,
    client: {
      rpc: async (name: string, args?: any) => {
        rpcs.push({ name, args });
        const v = answers[name];
        if (v instanceof Error)
          return { data: null, error: { message: v.message } };
        return name in answers
          ? {
              data: typeof v === "function" ? (v as any)(args) : v,
              error: null,
            }
          : { data: null, error: { message: `not in the test: ${name}` } };
      },
      functions: { invoke: async () => ({ data: null, error: null }) },
    } as any,
  };
}

const ALL = {
  churnConfirm: true,
  extension: true,
  pause: true,
  mrr: true,
  reviews: true,
  checks: true,
  prefill: true,
};

describe("the pause consent on Today (5.3)", () => {
  test("signed rows name the signer and offer Confirm pause; dates wrong offer Open the pause", async () => {
    const opened: any[] = [];
    const { client } = fakeClient({
      cockpit_form_doors: { ...ALL, invites: true, lifecycle: true },
      cockpit_form_notices_in: [
        {
          kind: "pause_consent",
          responseId: "r1",
          taskId: fx.TASK,
          clientName: fx.NAME,
          matched: true,
          submittedAt: "2026-11-01T07:00:00Z",
          state: "signed",
          via: "portal",
          signer: "the client admin",
          signedAt: "2026-11-01T07:00:00Z",
        },
        {
          kind: "pause_consent",
          responseId: "r2",
          taskId: "86exfix03",
          clientName: "ocean home",
          matched: true,
          submittedAt: "2026-11-01T07:00:00Z",
          state: "signed",
          via: "link",
          signer: "Fahad Al-Ali",
          signedAt: "2026-11-01T07:00:00Z",
        },
        {
          kind: "pause_consent",
          responseId: "r3",
          taskId: "86exfix04",
          clientName: "Smmim",
          matched: true,
          submittedAt: "2026-11-01T07:00:00Z",
          datesWrong: true,
          datesNote: "1 Dec",
        },
      ],
      cockpit_billing_ladder_due: [],
    });
    function Harness() {
      const doors = page.useDoors(client);
      const b = page.useTodayBands(client, doors, true, false, 0);
      return createElement(page.TodayBands, {
        client,
        doors,
        bands: b,
        types: null,
        clients: [],
        checker: false,
        onDoor: (...a: any[]) => opened.push(a),
        onTicket: () => {},
        onChanged: () => {},
      });
    }
    const { host, root } = await draw(createElement(Harness));
    const t = text(host);
    expect(t).toContain(
      "Pause consent signed: Castello Industries (in the portal by the client admin)",
    );
    expect(t).toContain(
      "Pause consent signed: ocean home (by link by Fahad Al-Ali)",
    );
    expect(t).toContain("Pause dates wrong: Smmim");
    await click(button("Confirm pause", host));
    expect(opened[0]).toEqual(["pause", fx.TASK, fx.NAME]);
    expect(button("Open the pause", host)).toBeTruthy();
    await unmount(root);
  });

  test("waves 3-4's doors come from the same read, closed when the flags are absent", async () => {
    const { client, rpcs } = fakeClient({ cockpit_form_doors: { ...ALL } });
    let seen: any = "unread";
    function Probe() {
      seen = page.useMoreDoors(client);
      return null;
    }
    const { root } = await draw(createElement(Probe));
    expect(seen).toEqual({
      invites: false,
      lifecycle: false,
      voice: false,
      editor: false,
    });
    expect(rpcs.map(r => r.name)).toEqual(["cockpit_form_doors"]);
    await unmount(root);
  });
});

describe("the pause sheet with the consent live (4.3.6, 5.2)", () => {
  const restart = kuwaitPlus(10);
  const prefill = (consent: unknown) => ({
    values: [
      { key: "pauseKind", value: "client_request", source: "the test" },
      { key: "restart", value: restart, source: "the test" },
      { key: "reasonCat", value: "client_asked", source: "the test" },
      { key: "reason", value: "Travel for two weeks", source: "the test" },
      { key: "callId", value: "c1", source: "the test" },
    ],
    calls: [
      {
        id: "c1",
        at: "2026-10-30T10:00:00Z",
        kind: "check-in",
        source: "Fathom",
      },
    ],
    consent,
  });
  const open = async (
    consent: unknown,
    live: string[] | null,
    io: any = fx.fakeFormsIO(),
  ) => {
    win.localStorage.clear();
    const fake = fakeClient({
      cockpit_form_prefill: prefill(consent),
      cockpit_billing_write: { eventId: 9 },
      cockpit_form_trail: { stored: { state: "done" } },
    });
    const drawn = await draw(
      createElement(page.DoorSheet, {
        door: { form: "pause", taskId: fx.TASK, name: fx.NAME },
        client: fake.client,
        doors: ALL,
        more: { invites: true, lifecycle: true, voice: false, editor: false },
        io,
        live,
        asCeo: false,
        onClose: () => {},
        onTicket: () => {},
        onSent: () => {},
      }),
    );
    return { ...drawn, ...fake, io };
  };
  const sheet = () => [...body().querySelectorAll(".fs-root")].at(-1) as any;
  const primary = () => sheet()?.querySelector(".fs-foot .fs-btn[data-tone]");

  test("not live: the two ticks stay and no consent row shows", async () => {
    const { root } = await open(fx.CONSENTS.none, []);
    expect(text(sheet())).toContain(defs.CONSENT_TERM);
    expect(sheet().querySelector("[data-consent]")).toBeNull();
    expect(text(primary())).toBe("Pause this client");
    await unmount(root);
  });

  test("live and sent: the consent row replaces the ticks, Confirm pause waits for the signature", async () => {
    const { root, rpcs } = await open(fx.CONSENTS.sent, ["pause_consent"]);
    expect(text(sheet())).not.toContain(defs.CONSENT_TERM);
    expect(text(sheet().querySelector("[data-consent-line]"))).toBe(
      "Waiting for the client's signed consent. Sent 31 Oct.",
    );
    expect(text(primary())).toBe("Confirm pause");
    expect(primary().disabled).toBe(true);
    expect(text(sheet().querySelector("[data-blocked]"))).toBe(
      sheetCore.CONSENT_WAIT,
    );
    await click(primary());
    expect(rpcs.some(r => r.name === "cockpit_billing_write")).toBe(false);
    await unmount(root);
  });

  test("live and signed: Confirm pause sends consentResponseId and no ticks", async () => {
    const signed = { ...fx.CONSENTS.signed, restart };
    const { root, rpcs } = await open(signed, ["pause_consent"]);
    expect(text(sheet().querySelector("[data-consent-line]"))).toBe(
      `Signed by the client admin in the portal on ${sheetCore.kuwaitDay(signed.signedAt)}. Confirm the pause.`,
    );
    expect(primary().disabled).toBe(false);
    await click(primary());
    const write = rpcs.find(r => r.name === "cockpit_billing_write");
    expect(write?.args.p_args.edit).toMatchObject({
      kind: "pause",
      pauseKind: "client_request",
      restart,
      consent: null,
      consentResponseId: signed.responseId,
    });
    await unmount(root);
  });

  test("by link: the typed name, and a restart other than the signed one is refused in the database's words", async () => {
    const signed = {
      ...fx.CONSENTS.signed,
      via: "link",
      signer: "Fahad Al-Ali",
      restart: kuwaitPlus(12),
    };
    const { root, rpcs } = await open(signed, ["pause_consent"]);
    expect(text(sheet().querySelector("[data-consent-line]"))).toContain(
      "Signed by link by Fahad Al-Ali on",
    );
    await click(primary());
    expect(text(sheet())).toContain(
      `The client signed a restart of ${sheetCore.kuwaitDay(signed.restart)}. Use that date or send a new consent.`,
    );
    expect(rpcs.some(r => r.name === "cockpit_billing_write")).toBe(false);
    await unmount(root);
  });

  test("Send the pause consent issues it from the sheet with the restart, origin pause", async () => {
    const io = fx.fakeFormsIO();
    const { root } = await open(fx.CONSENTS.none, ["pause_consent"], io);
    expect(text(sheet().querySelector("[data-consent-line]"))).toBe(
      "Not sent yet.",
    );
    await click(sheet().querySelector("[data-send-consent]"));
    const issue = io.calls.find(c => c.op === "issue")?.args as any;
    expect(issue).toMatchObject({
      taskId: fx.TASK,
      formKey: "pause_consent",
      origin: "pause",
      context: { restart, reasonCat: "client_asked", callId: "c1" },
    });
    expect(issue.context.start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(toasts).toContain("Sent");
    await unmount(root);
  });

  test("dates wrong reads the client's note", () => {
    expect(sheetCore.consentLine(fx.CONSENTS.dates_wrong)).toBe(
      'The client says the dates are wrong: "We restart on 1 December". Change the restart and send a new consent.',
    );
  });
});
