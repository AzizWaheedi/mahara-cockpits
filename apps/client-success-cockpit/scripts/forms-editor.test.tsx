import {
  afterAll,
  afterEach,
  describe,
  expect,
  mock,
  setDefaultTimeout,
  test,
} from "bun:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";

/**
 * The forms editor (src/pages/FormsEditorPage.tsx; docs/forms/WAVE34-CONTRACT.md
 * 4.9, 5.13 and the forms-editor row of section 8): the list in three groups
 * with the read-only sentences, the routing card's bounds, one client form
 * with its question list, the lock on what the cockpit reads, a draft saved
 * and published with a note, the server's refusal shown where it points,
 * a stale draft, going back to a version, the bilingual preview with Arabic
 * right to left, the real preview's address, and the layout at 375 and 1280
 * px. The RPCs are the in-memory stand-in of src/dev/formsEditorFixtures.ts;
 * nothing reaches a server. The pure core is tested at the end.
 *
 * Run: bun test scripts/forms-editor.test.tsx
 */

setDefaultTimeout(30_000);

const win = new Window({
  url: "https://localhost/client-success/forms-editor",
  width: 1280,
  height: 900,
});
for (const k of [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "HTMLButtonElement",
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
  "InputEvent",
  "DocumentFragment",
  "Text",
  "NodeFilter",
  "MutationObserver",
  "getComputedStyle",
  "sessionStorage",
  "localStorage",
  "matchMedia",
])
  (globalThis as Record<string, unknown>)[k] =
    k === "window"
      ? win
      : k === "matchMedia"
        ? (q: string) => win.matchMedia(q)
        : (win as unknown as Record<string, unknown>)[k];
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const toasts: string[] = [];
mock.module("sonner", () => ({
  toast: Object.assign((m: string) => toasts.push(m), {
    success: (m: string) => toasts.push(m),
    error: (m: string) => toasts.push(m),
  }),
  Toaster: () => null,
}));
mock.module("@/auth/SupabaseAuthProvider", () => ({
  useCockpitAuth: () => ({ client: null }),
}));

const { createRoot } = await import("react-dom/client");
const { act, createElement } = await import("react");
const { FormsEditorView } = await import("../src/pages/FormsEditorPage");
const fx = await import("../src/dev/formsEditorFixtures");
const core = await import("../src/lib/formsEditorCore");
const { editorError, notAllowed } = await import("../src/lib/formsEditor");

const hosts: { root: ReturnType<typeof createRoot> }[] = [];
const flush = () =>
  act(async () => {
    for (let i = 0; i < 6; i++) await new Promise(r => setTimeout(r, 0));
  });
async function draw(props: Record<string, unknown>) {
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as unknown as Element);
  hosts.push({ root });
  const opened: string[] = [];
  let back = 0;
  await act(async () =>
    root.render(
      createElement(FormsEditorView, {
        door: true,
        formKey: null,
        onOpen: (k: string) => opened.push(k),
        onBack: () => {
          back++;
        },
        ...props,
      } as never),
    ),
  );
  await flush();
  return { host: host as any, opened, back: () => back };
}
const text = (el: any) =>
  String(el?.textContent ?? "")
    .replace(/\s+/g, " ")
    .trim();
const buttonIn = (el: any, words: string) =>
  Array.from(el.querySelectorAll("button")).find((b: any) =>
    text(b).includes(words),
  ) as any;
const click = async (el: any) => {
  await act(async () => {
    el.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
  });
  await flush();
};
async function type(input: any, value: string) {
  await act(async () => {
    const proto =
      input.tagName === "TEXTAREA"
        ? win.HTMLTextAreaElement.prototype
        : win.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(input, value);
    input.dispatchEvent(new win.Event("input", { bubbles: true }));
  });
  await flush();
}
async function choose(select: any, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      win.HTMLSelectElement.prototype,
      "value",
    )?.set?.call(select, value);
    select.dispatchEvent(new win.Event("change", { bubbles: true }));
  });
  await flush();
}
const setWidth = async (width: number) => {
  await act(async () => {
    (win as any).happyDOM.setViewport({ width, height: 900 });
  });
  await flush();
};
const english = (host: any, name: string) =>
  host.querySelector(`fieldset[data-bilingual="${name}"] [lang="en"]`);
const arabic = (host: any, name: string) =>
  host.querySelector(`fieldset[data-bilingual="${name}"] [lang="ar"]`);

afterEach(async () => {
  for (const h of hosts.splice(0)) await act(async () => h.root.unmount());
  win.document.body.innerHTML = "";
  toasts.length = 0;
  await setWidth(1280);
});
afterAll(async () => {
  await win.happyDOM.close();
});

describe("the door and the seat", () => {
  test("a closed door says so and makes no call", async () => {
    const io = fx.fakeFormsEditorIO();
    const { host } = await draw({ io, door: false });
    expect(text(host.querySelector('[data-door="closed"]'))).toBe(
      "Opens after the next cockpit update.",
    );
    expect(io.calls).toEqual([]);
  });

  test("a seat that is not an admin or the CEO reads the server's sentence", async () => {
    const io = fx.fakeFormsEditorIO();
    io.refuse("read", "Only an admin or the CEO edits forms.");
    const { host } = await draw({ io });
    expect(text(host.querySelector('[data-refusal="seat"]'))).toBe(
      "Only an admin or the CEO edits forms.",
    );
    expect(text(host)).toContain(
      "Ask the CEO if you need to change a client form.",
    );
    expect(notAllowed(editorError({ message: "x", code: "42501" }))).toBe(true);
  });
});

describe("the list", () => {
  test("three groups in order, read-only sentences, live and draft chips", async () => {
    const io = fx.fakeFormsEditorIO();
    const { host, opened } = await draw({ io });
    const groups = Array.from(host.querySelectorAll("[data-group]")).map(
      (g: any) => g.getAttribute("data-group"),
    );
    expect(groups).toEqual(["client", "staff", "typeform"]);
    expect(text(host)).toContain("Client forms");
    expect(text(host)).toContain("Staff forms");
    expect(text(host)).toContain("Typeform and Make forms");
    const row = (k: string) => host.querySelector(`[data-form="${k}"]`);
    expect(text(row("extension").querySelector("[data-why]"))).toBe(
      "Set in the cockpit's code; the SQL checks these fields word for word.",
    );
    expect(text(row("kickoff").querySelector("[data-why]"))).toBe(
      "Lives in Typeform; Make owns its effects until Stage 4.",
    );
    expect(text(row("portal_feedback").querySelector("[data-why]"))).toBe(
      "The portal's Share feedback writes these; edit it in the portal.",
    );
    expect(text(row("nps"))).toContain("Live to clients");
    expect(text(row("csat"))).toContain("Not live yet");
    expect(text(row("pause_consent"))).toContain("Draft saved 2 Nov");
    expect(text(row("exit_survey"))).toContain("v2");
    // The Arabic title is its own right-to-left island.
    expect(row("nps").querySelector('bdi[dir="rtl"]')?.textContent).toBe(
      fx.NPS_SCHEMA.title.ar,
    );
    await click(row("nps").querySelector("button"));
    expect(opened).toEqual(["nps"]);
  });

  test("routing: a rule outside its bounds says so and cannot save; a good one saves every key", async () => {
    const io = fx.fakeFormsEditorIO();
    const { host } = await draw({ io });
    const card = host.querySelector("[data-routing]");
    expect(text(card.querySelector("[data-routing-note]"))).toBe(
      "The automatic schedule is off for every client; these rules apply once it is turned on.",
    );
    const save = card.querySelector('[data-action="save-routing"]');
    expect(save.disabled).toBe(true);
    const first = card.querySelector(
      '[data-schedule="nps"] input[type="number"]',
    );
    await type(first, "20");
    expect(text(card.querySelector('[data-refusal="routing-local"]'))).toBe(
      "The first NPS day after launch is a whole number from 30 to 180.",
    );
    expect(save.disabled).toBe(true);
    await type(first, "45");
    expect(card.querySelector('[data-refusal="routing-local"]')).toBeNull();
    const retry = card.querySelectorAll(
      '[data-schedule="csat"] input[type="number"]',
    )[4];
    await type(retry, "31");
    expect(text(card.querySelector('[data-refusal="routing-local"]'))).toBe(
      "The days between re-tries is a whole number from 1 to 30.",
    );
    await type(retry, "7");
    expect(save.disabled).toBe(false);
    await click(save);
    const patch = io.calls.find(c => c.op === "setRouting")?.args[0] as any;
    expect(patch.nps).toEqual({
      on: true,
      rule: { firstDay: 45, everyDays: 90, remindAfterDays: 7 },
    });
    expect(Object.keys(patch.csat.rule).sort()).toEqual([
      "afterLaunchDays",
      "maxAgeDays",
      "reissues",
      "retryAfterDays",
      "snoozeDays",
      "whatsappAfterDays",
    ]);
    expect(patch.lowScore).toEqual({ max: 6 });
    expect(toasts).toContain("Routing saved");
  });

  test("routing: the server's refusal shows under the card", async () => {
    const io = fx.fakeFormsEditorIO();
    io.refuse(
      "setRouting",
      "The schedules open after the next cockpit update.",
    );
    const { host } = await draw({ io });
    const card = host.querySelector("[data-routing]");
    await type(card.querySelector("[data-low-score] input"), "5");
    await click(card.querySelector('[data-action="save-routing"]'));
    expect(text(card.querySelector('[data-refusal="routing"]'))).toBe(
      "The schedules open after the next cockpit update.",
    );
  });
});

describe("one client form", () => {
  test("the question list, the lock on what the cockpit reads, and a free question", async () => {
    const io = fx.fakeFormsEditorIO();
    const { host } = await draw({ io, formKey: "nps" });
    const items = Array.from(host.querySelectorAll("[data-question]")).map(
      (li: any) => li.getAttribute("data-question"),
    );
    expect(items).toEqual([
      "recommend",
      "results",
      "communication",
      "startStop",
    ]);
    expect(
      host.querySelector('[data-question="recommend"] [data-locked]'),
    ).not.toBeNull();
    expect(
      host.querySelector('[data-question="startStop"] [data-locked]'),
    ).toBeNull();
    expect(text(host.querySelector("[data-empty-draft]"))).toBe(
      "No changes yet.",
    );
    expect(host.querySelector('[data-action="publish"]').disabled).toBe(true);
    expect(host.querySelector('[data-action="save"]').disabled).toBe(true);

    await click(host.querySelector('[data-question="recommend"] button'));
    const ed = host.querySelector('[data-question-editor="recommend"]');
    expect(text(ed.querySelector("[data-lock-note]"))).toBe(
      "Read by the low-score call on Today and the NPS answer notice. Its words can change; it stays, and its type, range, requirement and choices stay as they are.",
    );
    expect(ed.querySelector('[data-action="remove-question"]').disabled).toBe(
      true,
    );
    expect(ed.querySelector("#type-recommend").disabled).toBe(true);
    expect(ed.querySelector("#min-recommend").disabled).toBe(true);
    expect(ed.querySelector('button[role="switch"]').disabled).toBe(true);
    // Its words stay editable, in both languages, Arabic right to left.
    expect(english(ed, "label").disabled).toBe(false);
    expect(arabic(ed, "label").getAttribute("dir")).toBe("rtl");

    await click(host.querySelector('[data-question="startStop"] button'));
    const free = host.querySelector('[data-question-editor="startStop"]');
    expect(free.querySelector('[data-action="remove-question"]').disabled).toBe(
      false,
    );
    // A published question keeps its type.
    expect(free.querySelector("#type-startStop").disabled).toBe(true);
  });

  test("save a draft, then publish it with a note: the toasts, the change list and the history", async () => {
    const io = fx.fakeFormsEditorIO();
    const { host } = await draw({ io, formKey: "nps" });
    await click(host.querySelector('[data-question="startStop"] button'));
    await type(
      english(
        host.querySelector('[data-question-editor="startStop"]'),
        "label",
      ),
      "What should we start, keep or stop doing?",
    );
    const save = host.querySelector('[data-action="save"]');
    expect(save.disabled).toBe(false);
    expect(text(host)).toContain("Unsaved changes");
    await click(save);
    const saved = io.calls.find(c => c.op === "saveDraft");
    expect(saved?.args[0]).toBe("nps");
    expect(saved?.args[2]).toBe(1);
    expect((saved?.args[1] as any)?.fields[3].label.en).toBe(
      "What should we start, keep or stop doing?",
    );
    expect(toasts).toContain("Draft saved");

    const publish = host.querySelector('[data-action="publish"]');
    expect(text(publish)).toBe("Publish version 2");
    await click(publish);
    const review = host.querySelector("[data-review]");
    expect(text(review.querySelector("[data-changes]"))).toBe(
      "Changed: What should we start, keep or stop doing? (wording)",
    );
    expect(text(review)).toContain("What changed? (shown in the history)");
    const confirm = review.querySelector('[data-action="confirm-publish"]');
    expect(confirm.disabled).toBe(true);
    await type(review.querySelector("textarea"), "Asked what to keep too");
    expect(confirm.disabled).toBe(false);
    await click(confirm);
    expect(io.calls.find(c => c.op === "publish")?.args).toEqual([
      "nps",
      "Asked what to keep too",
      1,
    ]);
    expect(toasts).toContain("Published");
    const history = host.querySelector("[data-history]");
    expect(text(history.querySelector('[data-version="2"]'))).toContain(
      "v2 published 2 Nov · an admin",
    );
    expect(text(history.querySelector('[data-version="2"]'))).toContain(
      "Asked what to keep too",
    );
    expect(
      history.querySelector('[data-version="2"] [data-ring="current"]'),
    ).not.toBeNull();
    expect(
      history.querySelector('[data-version="1"] [data-ring="past"]'),
    ).not.toBeNull();
    expect(text(host.querySelector('[data-action="publish"]'))).toBe(
      "Publish version 3",
    );
  });

  test("the server's refusal shows in its words with the place it points at", async () => {
    const io = fx.fakeFormsEditorIO();
    const { host } = await draw({ io, formKey: "nps" });
    await type(english(host, "title"), "How are we doing this month?");
    await click(host.querySelector('[data-action="publish"]'));
    io.refuse(
      "publish",
      "How likely are you to recommend Mahara to a friend or another business owner? is read by the low-score call on Today. Remove that effect first.",
      ".fields.recommend",
    );
    const review = host.querySelector("[data-review]");
    await type(review.querySelector("textarea"), "New title");
    await click(review.querySelector('[data-action="confirm-publish"]'));
    const alert = host.querySelector('[data-refusal="server"]');
    expect(text(alert)).toContain("Remove that effect first.");
    expect(text(alert)).toContain(
      "In “How likely are you to recommend Mahara to a friend or another business owner?”",
    );
    expect(toasts).not.toContain("Published");
  });

  test("a blank text holds Publish back and says where", async () => {
    const io = fx.fakeFormsEditorIO();
    const { host } = await draw({ io, formKey: "csat" });
    await choose(host.querySelector("#forms-editor-add"), "tick");
    await click(host.querySelector('[data-action="add-question"]'));
    expect(host.querySelectorAll("[data-question]").length).toBe(4);
    expect(host.querySelector('[data-action="publish"]').disabled).toBe(true);
    expect(text(host.querySelector('[data-refusal="blanks"]'))).toContain(
      "Fill both languages first: 2 texts are still blank.",
    );
  });

  test("a stale draft says so and offers to move it onto the published version", async () => {
    const one = fx.editorOneFixture("nps");
    const draftSchema = fx.copy(fx.NPS_SCHEMA);
    draftSchema.minutes = 2;
    one.form = {
      ...one.form,
      version: 2,
      draft: {
        baseVersion: 1,
        savedAt: "2026-11-02T07:00:00Z",
        savedBy: "an admin",
        stale: true,
      },
    };
    one.published = { ...(one.published as any), version: 2 };
    one.history = [
      {
        version: 2,
        publishedAt: "2026-11-02T07:30:00Z",
        publishedBy: "the CEO",
        note: "x",
        client: true,
        current: true,
      },
      ...one.history.map(h => ({ ...h, current: false })),
    ];
    one.draft = {
      schema: draftSchema,
      baseVersion: 1,
      savedAt: "2026-11-02T07:00:00Z",
      savedBy: "an admin",
      stale: true,
      problem: "Someone published version 2 since you opened this. Reload it.",
      where: null,
    };
    const io = fx.fakeFormsEditorIO();
    io.state.ones.set("nps", one);
    const { host } = await draw({ io, formKey: "nps" });
    expect(text(host.querySelector("[data-stale]"))).toContain(
      "This draft was started on version 1; version 2 is published now.",
    );
    expect(host.querySelector('[data-action="publish"]').disabled).toBe(true);
    await click(
      buttonIn(
        host.querySelector("[data-stale]"),
        "Move my draft onto version 2",
      ),
    );
    const call = io.calls.find(c => c.op === "saveDraft");
    expect(call?.args[2]).toBe(2);
    expect((call?.args[1] as any)?.minutes).toBe(2);
  });

  test("going back to a version publishes it as the next one", async () => {
    const one = fx.editorOneFixture("csat");
    one.form = { ...one.form, version: 2 };
    one.published = { ...(one.published as any), version: 2 };
    one.history = [
      {
        version: 2,
        publishedAt: "2026-11-02T07:30:00Z",
        publishedBy: "an admin",
        note: "Two minutes",
        client: true,
        current: true,
      },
      { ...one.history[0], current: false } as any,
    ];
    const io = fx.fakeFormsEditorIO();
    io.state.ones.set("csat", one);
    const { host } = await draw({ io, formKey: "csat" });
    await click(host.querySelector('[data-action="restore-1"]'));
    const box = host.querySelector('[data-restore="1"]');
    await type(box.querySelector("input"), "One minute was right");
    await click(box.querySelector('[data-action="confirm-restore"]'));
    expect(io.calls.find(c => c.op === "restore")?.args).toEqual([
      "csat",
      1,
      "One minute was right",
    ]);
    expect(toasts).toContain("Restored as version 3");
  });

  test("the exit survey's Typeform record cannot come back", async () => {
    const io = fx.fakeFormsEditorIO();
    const { host } = await draw({ io, formKey: "exit_survey" });
    const v1 = host.querySelector('[data-version="1"]');
    expect(text(v1)).toContain(
      "The Typeform record; it cannot come back here.",
    );
    expect(v1.querySelector('[data-action="restore-1"]')).toBeNull();
    expect(text(host)).toContain(
      "Clients still answer the Typeform until its switch-on",
    );
  });

  test("the preview draws both languages, Arabic right to left, and the real preview opens the portal's staff page", async () => {
    const io = fx.fakeFormsEditorIO();
    const { host } = await draw({ io, formKey: "nps" });
    const ar = host.querySelector('[data-preview-lang="ar"]');
    expect(ar.getAttribute("dir")).toBe("rtl");
    expect(text(ar)).toContain(fx.NPS_SCHEMA.title.ar);
    expect(text(ar)).toContain("١٠");
    expect(
      host.querySelector('[data-preview-lang="en"]').getAttribute("dir"),
    ).toBe("ltr");
    const link = host.querySelector("[data-real-preview] a");
    expect(text(link)).toBe("Open the real preview");
    expect(link.getAttribute("href")).toBe(
      "https://portal.maharamedia.com/?clientId=locAlpha01&formPreview=nps",
    );
    await choose(host.querySelector("#forms-editor-workspace"), "locZeta01");
    expect(
      host.querySelector("[data-real-preview] a").getAttribute("href"),
    ).toBe(
      "https://portal.maharamedia.com/?clientId=locZeta01&formPreview=nps",
    );
    // A saved draft previews the draft.
    await type(english(host, "title"), "How are we doing now?");
    await click(host.querySelector('[data-action="save"]'));
    expect(
      host.querySelector("[data-real-preview] a").getAttribute("href"),
    ).toContain("&draft=1");
  });

  test("a staff form opens read only with its sentence and its record", async () => {
    const io = fx.fakeFormsEditorIO();
    const { host } = await draw({ io, formKey: "extension" });
    const card = host.querySelector('[data-readonly="extension"]');
    expect(card).not.toBeNull();
    expect(text(host)).toContain(
      "Set in the cockpit's code; the SQL checks these fields word for word.",
    );
    expect(text(card)).toContain("weeks");
    expect(host.querySelector('[data-action="publish"]')).toBeNull();
  });

  test("the layout: one column at 375 px, two at 1280 px", async () => {
    for (const [width, layout] of [
      [375, "stacked"],
      [1280, "columns"],
    ] as const) {
      await setWidth(width);
      const io = fx.fakeFormsEditorIO();
      const { host } = await draw({ io, formKey: "nps" });
      expect(
        host.querySelector("[data-layout]").getAttribute("data-layout"),
      ).toBe(layout);
      for (const h of hosts.splice(0)) await act(async () => h.root.unmount());
      win.document.body.innerHTML = "";
    }
  });
});

describe("the page's own rules", () => {
  test("no literal colour and no browser storage in the screen's code", () => {
    for (const file of [
      "../src/pages/FormsEditorPage.tsx",
      "../src/lib/formsEditor.ts",
      "../src/lib/formsEditorCore.ts",
    ]) {
      const src = readFileSync(new URL(file, import.meta.url), "utf8");
      // Comments may quote the brand's hex; the code may not.
      const code = src
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/[^\n]*/g, "");
      expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(code).not.toMatch(/\b(rgb|rgba|hsl|hsla|oklch)\(/);
      expect(code).not.toMatch(/localStorage|sessionStorage/);
    }
  });
});

describe("the core", () => {
  test("the change list names what a draft changes", () => {
    const pub = fx.copy(fx.NPS_SCHEMA);
    const next = fx.copy(fx.NPS_SCHEMA);
    next.fields = next.fields.filter(f => f.key !== "communication");
    next.fields[0] = { ...next.fields[0], required: false } as any;
    next.fields.push(
      core.newField(
        "tick",
        next.fields.map(f => f.key),
      ),
    );
    next.minutes = 2;
    expect(core.changeList(pub, next)).toEqual([
      "Added: newTick",
      "Removed: How is communication with your Mahara team?",
      `Changed: ${pub.fields[0]?.label.en} (now optional)`,
      "Minutes shown: 2",
    ]);
    expect(core.changeList(pub, pub)).toEqual([]);
  });

  test("a path reads as words", () => {
    expect(core.describePath(fx.NPS_SCHEMA, ".fields[1].label.en")).toBe(
      "In “How happy are you with the results so far?” (English)",
    );
    expect(core.describePath(fx.NPS_SCHEMA, ".fields.recommend")).toBe(
      `In “${fx.NPS_SCHEMA.fields[0]?.label.en}”`,
    );
    expect(core.describePath(fx.NPS_SCHEMA, ".invite.whatsapp.ar")).toBe(
      "In the WhatsApp text (Arabic)",
    );
    expect(
      core.describePath(
        fx.PAUSE_CONSENT_SCHEMA,
        ".fields[2].options[1].label.ar",
      ),
    ).toBe("In “Why are you pausing?”, choice 2 (Arabic)");
    expect(core.describePath(fx.NPS_SCHEMA, null)).toBeNull();
  });

  test("the routing bounds match the server's sentences", () => {
    expect(
      core.ruleProblem(core.NPS_BOUNDS, {
        firstDay: 60,
        everyDays: 90,
        remindAfterDays: 7,
      }),
    ).toBeNull();
    expect(
      core.ruleProblem(core.NPS_BOUNDS, { firstDay: 60, everyDays: 90 }),
    ).toBe(
      "The days before an unanswered NPS shows on Today is missing. Set it, then save.",
    );
    expect(
      core.ruleProblem(core.CSAT_BOUNDS, {
        afterLaunchDays: 0,
        whatsappAfterDays: 3,
        snoozeDays: 3,
        reissues: 3,
        retryAfterDays: 7,
        maxAgeDays: 121,
      }),
    ).toBe(
      "The last day after launch it can go is a whole number from 14 to 120.",
    );
    expect(
      core.ruleProblem(core.CSAT_BOUNDS, {
        afterLaunchDays: 20,
        whatsappAfterDays: 3,
        snoozeDays: 3,
        reissues: 3,
        retryAfterDays: 7,
        maxAgeDays: 20,
      }),
    ).toBe("The last day it can go must come after the day it first goes.");
    expect(core.ruleProblem([core.LOW_SCORE_BOUND], { max: 9 })).toBe(
      "The low-score line is a whole number from 0 to 8.",
    );
  });

  test("keys, moves and locks", () => {
    expect(
      core.keyFromLabel("How was the kickoff call?", ["howWasTheKickoff"]),
    ).toBe("howWasTheKickoff2");
    expect(core.FIELD_KEY.test(core.keyFromLabel("123 go", []))).toBe(true);
    expect(
      core.valueFromLabel("Moving it in-house", ["moving_it_in_house"]),
    ).toBe("moving_it_in_house_2");
    // A question never moves above the one its show-if reads.
    const pc = fx.copy(fx.PAUSE_CONSENT_SCHEMA);
    expect(core.canMove(pc, "datesNote", 0)).toBe(false);
    expect(core.canMove(pc, "anythingElse", 0)).toBe(true);
    expect(core.fieldLocks(fx.NPS_SCHEMA, "recommend")).toEqual({
      published: true,
      read: true,
      effects: ["low_score", "nps_notice"],
    });
    expect(core.fieldLocks(fx.NPS_SCHEMA, "brandNew")).toEqual({
      published: false,
      read: false,
      effects: [],
    });
    // Removing a question frees the questions that showed only after it.
    const freed = core.removeField(pc, "datesWrong");
    expect(freed.fields.find(f => f.key === "consentTerm")?.showIf).toBeNull();
  });

  test("the real preview's address and its default workspace", () => {
    expect(
      core.previewUrl("https://portal.maharamedia.com/", "loc1", "csat", true),
    ).toBe(
      "https://portal.maharamedia.com/?clientId=loc1&formPreview=csat&draft=1",
    );
    expect(core.defaultWorkspace(fx.editorReadFixture().workspaces)?.name).toBe(
      "Alpha Interiors",
    );
    expect(
      core.historyLine({
        version: 3,
        publishedAt: "2026-11-02T21:30:00Z",
        publishedBy: "the CEO",
        note: null,
        client: true,
        current: true,
      }),
    ).toBe("v3 published 3 Nov · the CEO");
  });

  test("every text of the fixtures is filled in both languages and passes the leads and guarantee words", () => {
    const leads =
      /(^|[^\p{L}\p{N}_])(leads?|cpls?|cost\s+per\s+lead)($|[^\p{L}\p{N}_])|ليدز|عملاء\s+محتملين/iu;
    const guarantee = /\bguarantee[sd]?\b|\bguaranteeing\b|ضمان|نضمن|مضمون/iu;
    for (const schema of Object.values(fx.CLIENT_SCHEMAS)) {
      expect(core.blankTexts(schema)).toEqual([]);
      for (const t of core.textsOf(schema)) {
        expect(t.value).not.toMatch(leads);
        expect(t.value).not.toMatch(guarantee);
      }
      // {form_link} exactly once in each WhatsApp text.
      for (const lang of ["en", "ar"] as const)
        expect(schema.invite.whatsapp[lang].split("{form_link}").length).toBe(
          2,
        );
    }
  });
});
