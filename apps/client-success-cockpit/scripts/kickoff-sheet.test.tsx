import {
  afterAll,
  describe,
  expect,
  mock,
  setDefaultTimeout,
  test,
} from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Window } from "happy-dom";

/**
 * The kickoff sheet (docs/forms/WAVE56-CONTRACT.md 4.13, 5.13, section 8):
 * the 46 Typeform answers in three groups plus New MRR, each the database's
 * own question (key, ref, options, a list where it takes one) and tG7dnxBn's
 * (its type, choices and required setting, asked where its logic goes, read
 * from a copy of its settings below), with the prefill chips; the embed kept
 * (and no read) while the kickoff is not live; a second kickoff asks why; the
 * answers sent by key, Typeform-shaped, the ticks in the order they were made
 * (Make 12 writes the first ticked service to the card), nothing from a
 * question the sheet does not show; a refused send stores nothing and says
 * what to fix. Every read and send is a stand-in.
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
  url: "https://localhost/client-success/clients/86exmpl01",
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

function stub(
  answered: string | null = null,
  refused: Record<string, string> | null = null,
) {
  const calls: { name: string; args: any }[] = [];
  return {
    calls,
    api: {
      prefill: async (t: string) => {
        calls.push({ name: "prefill", args: t });
        return {
          live: true,
          why: null,
          client: "Cedar Interiors",
          answered: answered ? { at: answered, byRole: "the CSM" } : null,
          prefill: [
            {
              key: "legal_name",
              value: "Cedar Interiors WLL",
              source: "the onboarding form",
            },
            {
              key: "service_focus",
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
        if (refused) return { responseId: null, trail: [], refused };
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

/**
 * tG7dnxBn's settings, copied from its saved definition (D-S4.0's backup) with
 * the titles left out: each question in the form's order with its Typeform
 * type, validations.required and choice labels, a group's questions inside
 * it. With MAKE_PARITY_SAVED_DIR set, a test proves this is the saved file.
 */
type TypeformQuestion = {
  ref: string;
  type: string;
  required?: boolean;
  choices?: string[];
  fields?: TypeformQuestion[];
};
const q = (
  ref: string,
  type: string,
  required: boolean,
  choices?: string[],
): TypeformQuestion => ({
  ref,
  type,
  required,
  ...(choices ? { choices } : {}),
});
const group = (ref: string, fields: TypeformQuestion[]): TypeformQuestion => ({
  ref,
  type: "inline_group",
  fields,
});
const TG7: TypeformQuestion[] = [
  group("c0000001-0000-4000-8000-00000000000e", [
    q("c0000001-0000-4000-8000-000000000001", "yes_no", true),
    q("c0000001-0000-4000-8000-000000000002", "long_text", false),
  ]),
  q("c0000001-0000-4000-8000-000000000012", "long_text", true),
  group("c0000001-0000-4000-8000-00000000000f", [
    q("c0000001-0000-4000-8000-000000000003", "yes_no", true),
    q("c0000001-0000-4000-8000-000000000004", "long_text", false),
  ]),
  q("c0000001-0000-4000-8000-000000000013", "long_text", true),
  group("c0000001-0000-4000-8000-00000000000d", [
    q("c0000001-0000-4000-8000-000000000005", "yes_no", true),
    q("c0000001-0000-4000-8000-000000000006", "long_text", false),
  ]),
  q("c0000001-0000-4000-8000-000000000014", "long_text", true),
  q("c0000001-0000-4000-8000-000000000007", "multiple_choice", true, [
    "Design and build",
    "Interior design",
    "Architectural design",
    "Fit out and renovation",
    "Construction only",
    "Other",
  ]),
  q("c0000001-0000-4000-8000-000000000008", "multiple_choice", true, [
    "In-office",
    "In-home or onsite",
    "Online",
  ]),
  group("c0000001-0000-4000-8000-000000000010", [
    q("c0000001-0000-4000-8000-000000000009", "yes_no", true),
    q("c0000001-0000-4000-8000-000000000011", "long_text", false),
  ]),
  q("c0000001-0000-4000-8000-000000000015", "long_text", true),
  q("c0000001-0000-4000-8000-00000000000a", "dropdown", true, [
    "Signed",
    "Sent and waiting on client",
    "Adjustments requested by client",
    "Not sent yet",
    "NA - already signed",
  ]),
  q("c0000001-0000-4000-8000-00000000000b", "long_text", false),
  group("7115a698-5032-4244-a14a-30db226f73dc", [
    q("3db082bb-1939-444b-8b32-d0067fc9878c", "yes_no", false),
    q("071c480f-17f9-48db-8155-56030f952e85", "long_text", false),
    q("87c68a44-b19b-4a86-a286-0a2c8c32134e", "yes_no", false),
    q("92fab954-d771-431c-9fc4-b9f15c53cbb8", "dropdown", false, [
      "Access confirmed.",
      "Pending.",
      "Invited.",
      "Waiting on client.",
    ]),
  ]),
  group("7a333b83-da34-4c6f-9dd7-8d15f560b457", [
    q("7d16afbb-b99a-4ee9-8718-4418cbeba534", "multiple_choice", false, [
      "Tiktok",
      "Meta (Facebook/Instagram)",
      "Snapchat",
    ]),
    q("cf53482c-3d7d-45ab-b294-0230e917ea5f", "short_text", false),
  ]),
  group("a0034e03-f410-4857-8535-19f9d8f2176a", [
    q("e4b9dbd3-c12c-4d6f-a0e3-c3ba17c97728", "short_text", false),
    q("940f494c-f99b-4920-b203-200576ddd780", "short_text", false),
    q("8bee68fc-0764-41a8-b90a-db2a3f401e9d", "yes_no", false),
    q("6fcbd33c-60e9-4df7-bfaa-e76b588dd887", "dropdown", false, [
      "Requested",
      "Waiting on Client",
      "Access Confirmed",
      "Pending",
      "Using Ours",
      "Need Tech Help",
      "Their Page Our Ad Acc",
    ]),
  ]),
  q("a813378f-06ce-499e-8f0e-14761b89b474", "dropdown", false, [
    "Requested",
    "Waiting on Client",
    "Integrated",
    "Needs Integrating",
    "Pending",
    "Not Integrating",
  ]),
  group("474b6f59-601f-49e6-aa64-ce4f9ec0b177", [
    q("03b0600d-04d2-40a0-a7de-75a488888eb7", "yes_no", false),
    q("3bebf47d-c00b-4f26-8624-933b84e42ebc", "yes_no", false),
    q("b657c5a5-d199-42b5-8437-c8d04f78e376", "dropdown", false, [
      "Requested",
      "Waiting on Client",
      "Integrated",
      "Needs Integrating",
      "Pending",
      "Not Integrating",
      "Google Synched - Not Integrated",
    ]),
    q("ad562fc2-6858-4e37-81c5-c4cc2375a330", "dropdown", false, [
      "Logged In",
      "Tech Issue",
      "Didn't Receive Access",
      "Doesn't Want To",
    ]),
  ]),
  group("8cd23521-5f80-420c-8b23-6a3d139a939b", [
    q("3418ef58-72df-49aa-aac3-1e095e155d45", "long_text", false),
    q("753c4cde-4d28-4719-8459-06e4db640180", "yes_no", false),
    q("f54986bc-e120-4345-afee-31c1000a5a9a", "yes_no", false),
    q("eb7ed18c-8388-4d84-9b5c-2e3d4a030287", "dropdown", false, [
      "Approved",
      "Declined",
      "Waiting On Client",
      "Wants To See Them First",
    ]),
  ]),
  { ref: "aa18b411-1e74-4bc2-b584-7ad343442647", type: "statement" },
  q("dff79b66-89dd-43ef-9664-3fa4e6a61d69", "yes_no", true),
  q("85d7ebb5-ce36-4ac3-aff8-3ce464737abd", "yes_no", false),
  q("86a6cce0-9111-4d98-97e7-7af5b6d518c8", "long_text", false),
  q("0cb88b75-f193-43a1-b802-d382178a0946", "yes_no", false),
  q("079812c4-bb7e-4cc3-8e57-24c3b9e886d9", "short_text", false),
  group("56e16df1-8373-44c5-8fdc-944011cfc8cc", [
    q("4379c2f7-c5cf-4104-92c5-9b2294d65b59", "yes_no", false),
    q("dc6eafd2-516e-4ca9-9d9c-89dee060e224", "yes_no", false),
    q("c56a7e2d-6f18-4bf9-a9f6-11367eab4c11", "dropdown", false, [
      "Confirmed",
      "Requested",
      "Need Tech Help",
      "Waiting On Client",
    ]),
  ]),
  q("b5578678-d0c2-475b-b66f-7ea54d55fe31", "website", true),
  q("75e97e7d-4c19-437a-b4b8-67570c29344f", "number", false),
  q("34310b2e-4df4-4ed5-b67e-9aefa9087d6e", "yes_no", false),
];

/**
 * tG7dnxBn's logic, by the question or group it follows: the first jump whose
 * condition holds ("always" holds; a choice is named by its label, a yes/no
 * by true or false), else the next question in order.
 */
type Jump = { when: [string, boolean | string] | "always"; to: string };
const TG7_LOGIC: Record<string, Jump[]> = {
  "c0000001-0000-4000-8000-00000000000e": [
    {
      when: ["c0000001-0000-4000-8000-000000000001", true],
      to: "c0000001-0000-4000-8000-00000000000f",
    },
  ],
  "c0000001-0000-4000-8000-00000000000f": [
    {
      when: ["c0000001-0000-4000-8000-000000000003", true],
      to: "c0000001-0000-4000-8000-00000000000d",
    },
  ],
  "c0000001-0000-4000-8000-00000000000d": [
    {
      when: ["c0000001-0000-4000-8000-000000000005", true],
      to: "c0000001-0000-4000-8000-000000000007",
    },
  ],
  "c0000001-0000-4000-8000-000000000010": [
    {
      when: ["c0000001-0000-4000-8000-000000000009", true],
      to: "c0000001-0000-4000-8000-00000000000a",
    },
  ],
  "c0000001-0000-4000-8000-00000000000a": [
    {
      when: [
        "c0000001-0000-4000-8000-00000000000a",
        "Adjustments requested by client",
      ],
      to: "c0000001-0000-4000-8000-00000000000b",
    },
    { when: "always", to: "7115a698-5032-4244-a14a-30db226f73dc" },
  ],
  "dff79b66-89dd-43ef-9664-3fa4e6a61d69": [
    {
      when: ["dff79b66-89dd-43ef-9664-3fa4e6a61d69", false],
      to: "0cb88b75-f193-43a1-b802-d382178a0946",
    },
    { when: "always", to: "85d7ebb5-ce36-4ac3-aff8-3ce464737abd" },
  ],
  "85d7ebb5-ce36-4ac3-aff8-3ce464737abd": [
    {
      when: ["85d7ebb5-ce36-4ac3-aff8-3ce464737abd", false],
      to: "0cb88b75-f193-43a1-b802-d382178a0946",
    },
    { when: "always", to: "86a6cce0-9111-4d98-97e7-7af5b6d518c8" },
  ],
};

/** Every question of tG7dnxBn (groups opened, the statement left out), in order. */
const TG7_QUESTIONS = TG7.flatMap(x => x.fields ?? [x]).filter(
  x => x.type !== "statement",
);

/** The refs Typeform asks for these answers (by ref, as Typeform holds them), walking its logic. */
function typeformAsks(answers: Record<string, unknown>): Set<string> {
  const asked = new Set<string>();
  let i = 0;
  while (i < TG7.length) {
    const at = TG7[i];
    for (const x of at.fields ?? [at]) asked.add(x.ref);
    const jump = (TG7_LOGIC[at.ref] ?? []).find(
      j => j.when === "always" || answers[j.when[0]] === j.when[1],
    );
    const next = jump ? TG7.findIndex(x => x.ref === jump.to) : i + 1;
    // Typeform's jumps only go forward.
    expect(next).toBeGreaterThan(i);
    i = next;
  }
  return asked;
}

/** The sheet's answers as Typeform would hold them, by ref: Yes and No as true and false. */
function typeformAnswers(a: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of kick.KICKOFF_ANSWER_FIELDS) {
    const v = a[f.key];
    if (v === undefined) continue;
    out[f.ref as string] = v === "Yes" ? true : v === "No" ? false : v;
  }
  return out;
}

describe("the kickoff's fields (4.13)", () => {
  test("46 Typeform answers, each with a unique ref, then New MRR", () => {
    expect(kick.KICKOFF_ANSWER_FIELDS).toHaveLength(46);
    const refs = kick.KICKOFF_ANSWER_FIELDS.map(f => f.ref);
    expect(new Set(refs).size).toBe(46);
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
    const def = kick.kickoffDef("Cedar Interiors");
    expect(def.title).toBe("Kickoff for Cedar Interiors");
    expect(def.submitLabel({})).toBe("Send the kickoff");
    expect(def.fields.some(f => f.key === "replaceReason")).toBe(false);
    const again = kick.kickoffDef("Cedar Interiors", "2026-10-28T10:00:00Z");
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
  test("each answer is the database's question: its key, ref and options, a list where it takes one", () => {
    // The latest migration that defines a function: the kickoff's list as the check reads it, and the check.
    const dir = resolve(import.meta.dir, "../../../supabase/migrations");
    const latest = (fn: string) => {
      const file = readdirSync(dir)
        .filter(f => f.endsWith(".sql"))
        .sort()
        .filter(f =>
          readFileSync(resolve(dir, f), "utf8").includes(
            `FUNCTION public.${fn}(`,
          ),
        )
        .at(-1) as string;
      const text = readFileSync(resolve(dir, file), "utf8");
      const at = text.lastIndexOf(`FUNCTION public.${fn}(`);
      return { text, body: text.slice(at, text.indexOf("END $$;", at)) };
    };
    const sql = latest("cockpit_form_stage4_fields").text;
    // The longest text cockpit_kickoff_answers_check takes, a long text's and any other's.
    const caps =
      /char_length\(v_text\)\s*>\s*\(CASE s->>'type' WHEN 'longtext' THEN (\d+) ELSE (\d+) END\)/.exec(
        latest("cockpit_kickoff_answers_check").body,
      );
    expect(caps).not.toBeNull();
    const [LONG, SHORT] = [Number(caps?.[1]), Number(caps?.[2])];
    const at = sql.indexOf("IF p_form_key = 'kickoff' THEN");
    const begin = sql.indexOf("RETURN '", at) + "RETURN '".length;
    const specs = JSON.parse(
      sql.slice(begin, sql.indexOf("'::jsonb", begin)).replaceAll("''", "'"),
    ) as {
      key: string;
      typeformRef: string;
      type: string;
      options?: string[];
    }[];
    expect(kick.KICKOFF_ANSWER_FIELDS.map(f => f.key).sort()).toEqual(
      specs.map(x => x.key).sort(),
    );
    // CEO item 5 (4.21): the budget is an amount and a currency, the close rate a
    // percent. Before the kickoff amounts migration (B5) the database still lists
    // both as text, and the sheet then sends them as Make's text (kickoffNeedsText).
    const AMOUNTS: Record<string, string[]> = {
      dailyBudget: ["text", "amount"],
      coldCloseRate: ["text", "percent"],
    };
    for (const x of specs) {
      const f = kick.KICKOFF_ANSWER_FIELDS.find(k => k.key === x.key);
      expect([x.key, f?.ref]).toEqual([x.key, x.typeformRef]);
      // A list goes as a list only where the database takes one.
      expect([x.key, f?.list === true]).toEqual([x.key, x.type === "multi"]);
      if (AMOUNTS[x.key]) {
        expect([x.key, AMOUNTS[x.key].includes(x.type)]).toEqual([x.key, true]);
        expect(f?.type).toBe(x.key === "dailyBudget" ? "amount" : "percent");
        // The currencies, where the database lists them, are the sheet's in its order.
        const cur = (x as { currencies?: string[] }).currencies ?? x.options;
        if (x.type === "amount" && cur) expect(f?.currencies).toEqual(cur);
        continue;
      }
      if (x.options)
        expect([x.key, f?.options?.map(o => o.value)]).toEqual([
          x.key,
          x.options,
        ]);
      // A long text is one exactly where the database takes a long text (it keeps its line
      // breaks there), and a text is never longer than the database takes.
      const cap = x.type === "longtext" ? LONG : SHORT;
      // (The platforms go as one text joined from at most three choices, never near the cap.)
      if (["text", "longtext", "url"].includes(x.type) && f?.type !== "multi")
        expect([x.key, f?.max]).toEqual([x.key, cap]);
      expect([x.key, f?.type === "longtext"]).toEqual([
        x.key,
        x.type === "longtext",
      ]);
    }
    // Who else to add to the WhatsApp group is a long text in tG7dnxBn, so in both.
    expect(
      kick.KICKOFF_ANSWER_FIELDS.find(f => f.key === "whatsappAdd"),
    ).toMatchObject({ type: "longtext", max: LONG });
    expect(kick.KICKOFF_REFS.serviceAdvertised).toBe(
      "c0000001-0000-4000-8000-000000000007",
    );
  });

  test("each answer is tG7dnxBn's question: in its order, its type, its choices, required where it is", () => {
    const SHEET_TYPE: Record<string, string> = {
      yes_no: "choice",
      dropdown: "choice",
      multiple_choice: "multi",
      long_text: "longtext",
      short_text: "text",
      website: "text",
      number: "number",
    };
    // Two short texts became typed answers (CEO item 5): the budget and the close rate.
    const TYPED: Record<string, string> = {
      "cf53482c-3d7d-45ab-b294-0230e917ea5f": "amount",
      "079812c4-bb7e-4cc3-8e57-24c3b9e886d9": "percent",
    };
    expect(kick.KICKOFF_ANSWER_FIELDS.map(f => f.ref)).toEqual(
      TG7_QUESTIONS.map(x => x.ref),
    );
    for (const x of TG7_QUESTIONS) {
      const f = kick.KICKOFF_ANSWER_FIELDS.find(k => k.ref === x.ref);
      expect([x.ref, f?.type, f?.required === true]).toEqual([
        x.ref,
        TYPED[x.ref] ?? SHEET_TYPE[x.type],
        x.required,
      ]);
      const choices =
        x.type === "yes_no" ? ["Yes", "No"] : (x.choices ?? undefined);
      expect([x.ref, f?.options?.map(o => o.label)]).toEqual([x.ref, choices]);
      expect([x.ref, f?.options?.map(o => o.value)]).toEqual([x.ref, choices]);
    }
    // The order and types are the committed fixture's too (test_make_parity.py proves it is the saved file).
    const fixture = JSON.parse(
      readFileSync(
        resolve(
          import.meta.dir,
          "../../../scripts/dev/fixtures/make-parity/tG7dnxBn-before-s40-20261102s40.json",
        ),
        "utf8",
      ),
    ) as { fields: TypeformQuestion[] & { properties?: any }[] };
    const shape = (list: any[]): any[] =>
      list.map(x =>
        x.properties?.fields || x.fields
          ? {
              ref: x.ref,
              type: x.type,
              fields: shape(x.properties?.fields ?? x.fields),
            }
          : { ref: x.ref, type: x.type },
      );
    expect(shape(fixture.fields)).toEqual(shape(TG7));
  });

  test("the sheet asks what tG7dnxBn's logic asks, and sends nothing from a question it does not show", () => {
    const yesNo = ["Yes", "No"];
    const contract = TG7.find(
      x => x.ref === "c0000001-0000-4000-8000-00000000000a",
    )?.choices as string[];
    const parents = [
      "detailsCorrect",
      "linksCorrect",
      "operationsCorrect",
      "profileComplete",
      "contractStatus",
      "hasLeads",
      "reachLeads",
    ];
    // Every other answer filled, so only the logic decides what is sent.
    const filled: Record<string, unknown> = {};
    for (const f of kick.KICKOFF_ANSWER_FIELDS) {
      if (parents.includes(f.key)) continue;
      filled[f.key] =
        f.type === "multi"
          ? [f.options?.[0].value]
          : f.type === "choice"
            ? f.options?.[0].value
            : f.type === "number"
              ? 1500
              : f.type === "amount"
                ? { amount: "40", currency: "USD" }
                : f.type === "percent"
                  ? "20"
                  : f.key === "callRecording"
                    ? "https://example.test/call"
                    : "A note.";
    }
    const wrong: string[] = [];
    let combos = 0;
    for (const d of yesNo)
      for (const l of yesNo)
        for (const o of yesNo)
          for (const p of yesNo)
            for (const c of contract)
              for (const h of yesNo)
                for (const r of ["Yes", "No", undefined]) {
                  combos++;
                  const a: Record<string, unknown> = {
                    ...filled,
                    detailsCorrect: d,
                    linksCorrect: l,
                    operationsCorrect: o,
                    profileComplete: p,
                    contractStatus: c,
                    hasLeads: h,
                    ...(r ? { reachLeads: r } : {}),
                  };
                  const asked = typeformAsks(typeformAnswers(a));
                  const sent = new Set(Object.keys(kick.kickoffAnswers(a)));
                  for (const f of kick.KICKOFF_ANSWER_FIELDS) {
                    const ref = f.ref as string;
                    if (staff.shown(f, a) !== asked.has(ref))
                      wrong.push(`${JSON.stringify(a)} shows ${f.key}`);
                    // An answer goes only where Typeform asks, and every asked answer goes.
                    if (sent.has(f.key) !== (asked.has(ref) && f.key in a))
                      wrong.push(`${JSON.stringify(a)} sends ${f.key}`);
                  }
                }
    expect(combos).toBe(480);
    expect(wrong).toEqual([]);
    // The five follow-ups and the leads questions are the only ones tG7dnxBn can skip.
    expect(
      kick.KICKOFF_ANSWER_FIELDS.filter(f => f.showIf).map(f => f.key),
    ).toEqual([
      "detailsCorrection",
      "linksCorrection",
      "operationsCorrection",
      "profileMissing",
      "contractChanges",
      "reachLeads",
      "leadsLinks",
    ]);
  });

  test.skipIf(!process.env.MAKE_PARITY_SAVED_DIR)(
    "the copy of tG7dnxBn's settings is the saved definition's",
    () => {
      const saved = JSON.parse(
        readFileSync(
          resolve(
            process.env.MAKE_PARITY_SAVED_DIR as string,
            "tG7dnxBn-before-s40-20261102s40.json",
          ),
          "utf8",
        ),
      );
      const label = new Map<string, string>();
      const settings = (list: any[]): TypeformQuestion[] =>
        list.map(x => {
          for (const c of x.properties?.choices ?? [])
            label.set(c.ref, c.label);
          if (x.properties?.fields)
            return group(x.ref, settings(x.properties.fields));
          if (x.type === "statement") return { ref: x.ref, type: x.type };
          return q(
            x.ref,
            x.type,
            x.validations?.required === true,
            x.properties?.choices?.map((c: any) => c.label),
          );
        });
      expect(settings(saved.fields)).toEqual(TG7);
      const logic: Record<string, Jump[]> = {};
      for (const rule of saved.logic)
        logic[rule.ref] = rule.actions.map((x: any) => {
          expect(x.action).toBe("jump");
          const [field, value] = x.condition.vars;
          return {
            when:
              x.condition.op === "always"
                ? "always"
                : [
                    field.value,
                    value.type === "choice"
                      ? label.get(value.value)
                      : value.value,
                  ],
            to: x.details.to.value,
          };
        });
      expect(logic).toEqual(TG7_LOGIC);
    },
  );

  test("answers by key, ticks in the order they were made, a text pick joined as the Typeform stores it, empty answers left out", () => {
    expect(
      kick.kickoffAnswers({
        detailsCorrect: "Yes",
        serviceAdvertised: ["Interior design", "Design and build"],
        consultationTypes: ["Online", "In-office"],
        adPlatforms: ["Tiktok", "Snapchat", "Meta (Facebook/Instagram)"],
        paymentAmount: "1500",
        newMrrUsd: "0",
        linksFix: "",
        replaceReason: "  The first one had the wrong budget.  ",
      }),
    ).toEqual({
      detailsCorrect: "Yes",
      serviceAdvertised: ["Interior design", "Design and build"],
      consultationTypes: ["Online", "In-office"],
      adPlatforms: "Tiktok, Snapchat, Meta (Facebook/Instagram)",
      paymentAmount: 1500,
      newMrrUsd: 0,
      replaceReason: "The first one had the wrong budget.",
    });
    // An old draft's text where a list goes shows nothing ticked, so nothing is sent; an empty list neither.
    expect(
      kick.kickoffAnswers({
        serviceAdvertised: "Villa interiors",
        consultationTypes: [],
        businessOk: "Yes",
      }),
    ).toEqual({});
    expect(kick.KICKOFF_REFS.paymentAmount).toBe(
      "75e97e7d-4c19-437a-b4b8-67570c29344f",
    );
    // A follow-up typed before its parent changed is not sent; a line break in a long text stays.
    expect(
      kick.kickoffAnswers({
        detailsCorrect: "Yes",
        detailsCorrection: "The phone changed.",
        contractStatus: "Signed",
        contractChanges: "A shorter term.",
        hasLeads: "No",
        reachLeads: "Yes",
        leadsLinks: "A sheet of leads.",
        whatsappAdd: "The office manager\nThe sales lead",
      }),
    ).toEqual({
      detailsCorrect: "Yes",
      contractStatus: "Signed",
      hasLeads: "No",
      whatsappAdd: "The office manager\nThe sales lead",
    });
    // A long text goes as Typeform hands it to Make (cockpit_form_typeform_text): blank lines, a
    // line's own indent and repeated spaces stay, the white space at either end goes (a no-break
    // space too), and a \r\n or a lone \r is a line feed; nothing turns a line break into a space.
    const typed = "First:  the logo\n\n  - Second line\nThird\t line";
    expect(
      kick.kickoffAnswers({
        contentLinks: `\n\u00a0 ${typed}  \n`,
        whatsappAdd: "The office manager\r\n\r\nThe sales lead\rThe owner",
        adAccountName: "  Cedar Ads  ",
      }),
    ).toEqual({
      contentLinks: typed,
      whatsappAdd: "The office manager\n\nThe sales lead\nThe owner",
      adAccountName: "Cedar Ads",
    });
    // The sheet counts a long text as the database does: trimmed, never folded.
    const field = kick
      .kickoffDef("Cedar Interiors")
      .fields.find(f => f.key === "whatsappAdd");
    expect(field?.type).toBe("longtext");
    expect(field?.check?.(`${"a\n\n".repeat(1333)}a`, {}, "")).toBeNull();
    expect(field?.check?.("a\n".repeat(2001), {}, "")).toBe(
      "Shorten it to 4,000 characters or fewer.",
    );
  });

  test("the sheet stops a text longer than the database takes, counted as it counts", () => {
    const def = kick.kickoffDef("Cedar Interiors");
    const field = (key: string) => def.fields.find(f => f.key === key);
    const say = (key: string, v: string) => field(key)?.check?.(v, {}, "");
    expect(say("linksFix", "a".repeat(4000))).toBeNull();
    expect(say("linksFix", "a".repeat(4001))).toBe(
      "Shorten it to 4,000 characters or fewer.",
    );
    expect(say("adAccountName", "a".repeat(500))).toBeNull();
    // The database folds a text's spaces before it counts.
    expect(
      say("adAccountName", `${"a ".repeat(250)}${" ".repeat(50)}`),
    ).toBeNull();
    expect(say("adAccountName", "a".repeat(501))).toBe(
      "Shorten it to 500 characters or fewer.",
    );
    expect(say("callRecording", `https://x.test/${"a".repeat(490)}`)).toBe(
      "Shorten it to 500 characters or fewer.",
    );
    expect(say("callRecording", "x.test/call")).toBe(
      "A link starts with https://.",
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
          taskId: "86exmpl01",
          clientName: "Cedar Interiors",
          autoOpen: true,
        }),
      );
      expect(text(body())).toBe(line);
      expect(calls).toHaveLength(0);
      await clear(root);
    }
  });

  test("live: the answers in three groups plus New MRR, with the prefill chips; a follow-up shows after its No; Send the kickoff", async () => {
    const { api, calls } = stub();
    const root = await draw(
      createElement(KickoffDoor, {
        door: OPEN,
        api,
        taskId: "86exmpl01",
        clientName: "Cedar Interiors",
      }),
    );
    await click(button("Send the kickoff"));
    expect(calls[0]).toEqual({ name: "prefill", args: "86exmpl01" });
    expect(text(body().querySelector(".fs-title"))).toBe(
      "Kickoff for Cedar Interiors",
    );
    const labels = [...body().querySelectorAll(".fs-field .fs-label")].map(
      text,
    );
    // 46 answers but the five follow-ups and the two leads questions, + New MRR (the optional marks ride on the labels).
    expect(labels).toHaveLength(40);
    expect(labels[labels.length - 1]).toBe("New MRR (USD a month)");
    expect(labels).toContain(
      "Who else should we add to the WhatsApp group? (optional)",
    );
    expect(labels).toContain("Which service are we advertising?");
    expect([...body().querySelectorAll(".fs-heading")].map(text)).toEqual([
      "The client's business",
      "Set-up and access",
      "Content, leads and training",
    ]);
    const froms = [...body().querySelectorAll(".fs-from")].map(text);
    expect(froms).toEqual(["from the card"]);
    expect(text(body().querySelector(".fs-facts"))).toContain(
      "Cedar Interiors WLL · from the onboarding form",
    );
    expect(text(body().querySelector(".fs-facts"))).toContain(
      "Villa interiors · from the onboarding form",
    );
    // Required answers are checked before anything is sent.
    await click(body().querySelector(".fs-foot .fs-btn"));
    expect(calls.filter(c => c.name === "submit")).toHaveLength(0);
    expect(text(body())).toContain("answers need a fix above.");
    // A No opens its follow-up, required; a Yes to leads opens the leads question.
    const radio = (legend: string, value: string) =>
      [...body().querySelectorAll(".fs-field")]
        .find((x: any) => text(x.querySelector(".fs-label")) === legend)
        ?.querySelector(`input[value="${value}"]`) as any;
    await click(radio("Are the online links still correct?", "No"));
    await click(radio("Do you have pre-existing leads?", "Yes"));
    const now = [...body().querySelectorAll(".fs-field .fs-label")].map(text);
    expect(now).toHaveLength(43);
    expect(now).toContain("Which link is wrong, and what is the correct one?");
    expect(now).toContain(
      "Do you want us to reach out to those leads? (optional)",
    );
    expect(now).toContain("Provide link or notes for those leads. (optional)");
    expect(now).not.toContain("What is wrong? Give the correct details.");
    await clear(root);
  });

  test("a card with a kickoff asks why it is sent again", async () => {
    const { api } = stub("2026-10-28T10:00:00Z");
    const root = await draw(
      createElement(KickoffDoor, {
        door: OPEN,
        api,
        taskId: "86exmpl01",
        clientName: "Cedar Interiors",
        autoOpen: true,
      }),
    );
    expect(text(body())).toContain(
      "A kickoff was sent on 28 Oct. Say why you are sending it again.",
    );
    expect(text(body())).toContain("Why are you sending it again?");
    await clear(root);
  });

  /** Opens the live sheet and answers every required question with its first option. */
  async function answered(api: any) {
    const root = await draw(
      createElement(KickoffDoor, {
        door: OPEN,
        api,
        taskId: "86exmpl01",
        clientName: "Cedar Interiors",
        autoOpen: true,
      }),
    );
    const groups = new Map<string, any>();
    for (const r of body().querySelectorAll('input[type="radio"]'))
      if (!groups.has(r.name)) groups.set(r.name, r);
    for (const r of groups.values()) await click(r);
    await click(pill("Meta (Facebook/Instagram)"));
    const link = [...body().querySelectorAll(".fs-field")]
      .find(
        (x: any) =>
          text(x.querySelector(".fs-label")) === "Call Recording Link",
      )
      ?.querySelector("input") as any;
    await type(link, "https://example.test/call");
    return root;
  }
  async function type(el: any, value: string) {
    expect(el).toBeTruthy();
    const setter = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(el),
      "value",
    )?.set;
    await act(async () => {
      setter?.call(el, value);
      el.dispatchEvent(new (win as any).Event("input", { bubbles: true }));
    });
    await flush();
  }
  const pill = (label: string) =>
    [...body().querySelectorAll(".fs-pill")]
      .find((l: any) => text(l) === label)
      ?.querySelector("input") as any;

  test("the services go in the order they were ticked: tick appends, untick removes, nothing is sorted", async () => {
    const { api, calls } = stub();
    const root = await answered(api);
    expect(text(body())).toContain(
      "Tick the main service first: the card's Service Advertised takes the first one you tick.",
    );
    for (const label of [
      "Fit out and renovation",
      "Interior design",
      "Design and build",
    ])
      await click(pill(label));
    await click(pill("Fit out and renovation"));
    await click(pill("Other"));
    await click(pill("Online"));
    await click(pill("In-office"));
    await click(body().querySelector(".fs-foot .fs-btn"));
    const sent = calls.filter(c => c.name === "submit");
    expect(sent).toHaveLength(1);
    expect(sent[0].args.a.serviceAdvertised).toEqual([
      "Interior design",
      "Design and build",
      "Other",
    ]);
    expect(sent[0].args.a.consultationTypes).toEqual(["Online", "In-office"]);
    expect(sent[0].args.a.adPlatforms).toBe("Meta (Facebook/Instagram)");
    expect(sent[0].args.a.newMrrUsd).toBe(1500);
    // Every key sent is one the sheet asks.
    const keys = new Set(kick.KICKOFF_FIELDS.map(f => f.key));
    expect(Object.keys(sent[0].args.a).filter(k => !keys.has(k))).toEqual([]);
    expect(toasts).toContain("Sent.");
    toasts.length = 0;
    await clear(root);
  });

  test("a send the database refuses stores nothing: the sheet stays open and says what to fix", async () => {
    const { api, calls } = stub(null, {
      contractStatus: "option",
      linksFix: "length",
    });
    const root = await answered(api);
    await click(pill("Design and build"));
    await click(pill("Online"));
    await click(body().querySelector(".fs-foot .fs-btn"));
    expect(calls.filter(c => c.name === "submit")).toHaveLength(1);
    expect(text(body())).toContain(
      "The kickoff was not stored. Contract status: pick one of its choices. Anything to add? (online links): shorten it to 4,000 characters or fewer. Then send it again.",
    );
    expect(toasts).not.toContain("Sent.");
    expect(body().querySelector(".fs-foot .fs-btn")).toBeTruthy();
    expect(kick.kickoffRefused({ surprise: "unknown" })).toBe(
      "The kickoff was not stored: the database did not take the sheet's answers. Your answers are still here. Tell the tech lead.",
    );
    expect(kick.kickoffRefused({ detailsCorrect: "surprise" })).toBe(
      "The kickoff was not stored: the database did not take the sheet's answers. Your answers are still here. Tell the tech lead.",
    );
    expect(kick.kickoffRefused({ callRecording: "format" })).toBe(
      "The kickoff was not stored. Call Recording Link: paste the whole link, starting with https://. Then send it again.",
    );
    // Only too_large, and only alone (as cockpit_kickoff_answers_check gives it), has its own sentence.
    expect(kick.kickoffRefused({ _answers: "surprise" })).toBe(
      "The kickoff was not stored: the database did not take the sheet's answers. Your answers are still here. Tell the tech lead.",
    );
    expect(
      kick.kickoffRefused({ _answers: "too_large", contractStatus: "option" }),
    ).toBe(
      "The kickoff was not stored: the database did not take the sheet's answers. Your answers are still here. Tell the tech lead.",
    );
    expect(kick.kickoffRefused({})).toBe(
      "The kickoff was not stored: the database did not take the sheet's answers. Your answers are still here. Tell the tech lead.",
    );
    expect(
      kick.kickoffRefused({
        serviceAdvertised: "required",
        whatsappAdd: "length",
        contentLinks: "length",
        dailyBudget: "range",
        paymentAmount: "range",
        newMrrUsd: "range",
      }),
    ).toBe(
      "The kickoff was not stored. Which service are we advertising: answer it. Who else should we add to the WhatsApp group: shorten it to 4,000 characters or fewer. Provide any marketing content links or notes: shorten it to 4,000 characters or fewer. What is your daily budget for the ads: write an amount above 0 and up to 100,000, with 2 decimals at most. Payment Amount: write a number from 0 to 10,000,000, with 2 decimals at most. New MRR (USD a month): write a number from 0 to 100,000. Then send it again.",
    );
    // The amounts check's own codes (B5), each a fix the CSM can make.
    expect(kick.kickoffRefused({ dailyBudget: "option" })).toBe(
      "The kickoff was not stored. What is your daily budget for the ads: choose the currency: USD, SAR, KWD, AED, QAR or BHD. Then send it again.",
    );
    expect(kick.kickoffRefused({ dailyBudget: "format" })).toBe(
      "The kickoff was not stored. What is your daily budget for the ads: write the amount as a number and choose its currency. Then send it again.",
    );
    expect(kick.kickoffRefused({ coldCloseRate: "range" })).toBe(
      "The kickoff was not stored. What is your current close rate on cold leads: write a whole number from 0 to 100. Then send it again.",
    );
    await clear(root);
  });

  test("answers that together are too large are refused by name: the sheet stays open and says to shorten them", async () => {
    // cockpit_kickoff_answers_check: every answer passed, but together they do not fit a kickoff's 256 KB.
    const { api, calls } = stub(null, { _answers: "too_large" });
    const root = await answered(api);
    await click(pill("Design and build"));
    await click(pill("Online"));
    await click(body().querySelector(".fs-foot .fs-btn"));
    expect(calls.filter(c => c.name === "submit")).toHaveLength(1);
    expect(text(body())).toContain(
      "The kickoff was not stored: its answers together are too long. Shorten the longest answers, then send it again. Your answers are still here.",
    );
    expect(text(body())).not.toContain("Tell the tech lead");
    expect(toasts).not.toContain("Sent.");
    expect(body().querySelector(".fs-foot .fs-btn")).toBeTruthy();
    await clear(root);
  });
});

// --- CEO item 5: the daily budget as an amount and a currency; CEO item 7: the items after the send ---

const budget = await import("../src/lib/kickoffBudget");
const items = await import("../src/dev/kickoffItemsFixtures");

describe("the daily budget as an amount and a currency (4.21, 5.16)", () => {
  test("the sheet's rates are the cockpit's: currency.ts and cockpit_board_usd_rate, BHD in neither", () => {
    const root = resolve(import.meta.dir, "../../..");
    const ts = readFileSync(
      resolve(root, "apps/media-buyer-cockpit/convex/currency.ts"),
      "utf8",
    );
    const table = /USD_PER[^{]*\{([^}]*)\}/.exec(ts)?.[1] ?? "";
    const fromTs = Object.fromEntries(
      [...table.matchAll(/([A-Z]{3}):\s*([\d.]+)/g)].map(m => [
        m[1],
        Number(m[2]),
      ]),
    );
    expect(fromTs).toEqual({ ...budget.USD_PER });
    // The newest migration that defines the SQL rate, read as it is written.
    const dir = resolve(root, "supabase/migrations");
    const file = readdirSync(dir)
      .filter(f => f.endsWith(".sql"))
      .sort()
      .filter(f =>
        readFileSync(resolve(dir, f), "utf8").includes(
          "FUNCTION public.cockpit_board_usd_rate(",
        ),
      )
      .at(-1) as string;
    const sql = readFileSync(resolve(dir, file), "utf8");
    const at = sql.lastIndexOf("FUNCTION public.cockpit_board_usd_rate(");
    const fn = sql.slice(at, sql.indexOf("$$;", at));
    const fromSql = Object.fromEntries(
      [...fn.matchAll(/WHEN '([A-Z]{3})' THEN ([\d.]+)/g)].map(m => [
        m[1],
        Number(m[2]),
      ]),
    );
    expect(fromSql).toEqual({ ...budget.USD_PER });
    expect(budget.KICKOFF_CURRENCIES).toEqual([
      "USD",
      "SAR",
      "KWD",
      "AED",
      "QAR",
      "BHD",
    ]);
  });

  test("the dollars and words distinguish informational estimates from action rates", () => {
    expect(budget.budgetUsd(150, "SAR")).toBe(39.99);
    expect(budget.budgetUsd(37.5, "QAR")).toBe(10.3);
    expect(budget.budgetUsd(20, "KWD")).toBe(65.2);
    expect(budget.budgetUsd(100, "BHD")).toBeNull();
    expect(budget.budgetUsd(100, "OMR")).toBeNull();
    expect(budget.budgetLine(150, "SAR")).toBe(
      "≈ $39.99 a day at the cockpit's rate.",
    );
    expect(budget.budgetLine(20, "kwd")).toBe(
      "≈ $65.20 a day at the cockpit's rate.",
    );
    expect(budget.budgetLine(1000, "AED")).toBe(
      "≈ $272.30 a day at the cockpit's rate.",
    );
    expect(budget.budgetLine(100, "BHD")).toBe(
      "≈ $265.96 a day. Estimate only; this is not yet used for launch or card budgets.",
    );
    expect(budget.budgetLine(100, "OMR")).toBe(
      "≈ $260.08 a day. Estimate only; this is not yet used for launch or card budgets.",
    );
    expect(budget.budgetLine(100, "EUR")).toBe(
      "No fixed rate for EUR yet, so the media buyers see the amount as typed.",
    );
    expect(budget.budgetLine(40, "USD")).toBeNull();
    expect(budget.budgetLine(null, "SAR")).toBeNull();
    expect(budget.budgetText(37.5, "sar")).toBe("37.5 SAR");
    expect(budget.budgetText(1500, "KWD")).toBe("1500 KWD");
    expect(budget.budgetText(40.1, "USD")).toBe("40.1 USD");
    expect(budget.saleQuick(40)).toEqual({
      label: "Same as the sale: $40",
      value: { amount: "40", currency: "USD" },
    });
    expect(budget.saleQuick(32.5)?.label).toBe("Same as the sale: $32.50");
    // Missing is never a zero to fill, and 1,000 or more looks like a month (B6's guard).
    expect(budget.saleQuick(null)).toBeNull();
    expect(budget.saleQuick(0)).toBeNull();
    expect(budget.saleQuick(1000)).toBeNull();
  });

  test("checked before the send as the amounts check takes them", () => {
    const def = kick.kickoffDef("Cedar Interiors");
    const said = (dailyBudget: unknown, coldCloseRate?: unknown) => {
      const out = staff.validate(def, { dailyBudget, coldCloseRate });
      return [out.dailyBudget ?? null, out.coldCloseRate ?? null];
    };
    const RULE = staff.AMOUNT_RULE;
    for (const bad of ["0", "100001", "1.234", "abc", "-5", "40 dollars"])
      expect([bad, said({ amount: bad, currency: "SAR" })[0]]).toEqual([
        bad,
        RULE,
      ]);
    for (const ok of ["40", "37.5", "100000", "1,500", "0.5"])
      expect([ok, said({ amount: ok, currency: "USD" })[0]]).toEqual([
        ok,
        null,
      ]);
    // A blank amount is no answer (the question is optional), whatever the currency.
    expect(said({ amount: "", currency: "KWD" })[0]).toBeNull();
    for (const bad of ["101", "12.5", "abc", "-1"])
      expect([bad, said(undefined, bad)[1]]).toEqual([bad, staff.PERCENT_RULE]);
    for (const ok of ["0", "20", "100", "35%"])
      expect([ok, said(undefined, ok)[1]]).toEqual([ok, null]);
    expect(staff.PERCENT_RULE).toBe("Write a whole number from 0 to 100.");
    expect(RULE).toBe(
      "Write an amount above 0 and up to 100,000, with 2 decimals at most.",
    );
  });

  test("a comma groups thousands only; a decimal comma is refused, never read as 10x", () => {
    const def = kick.kickoffDef("Cedar Interiors");
    const said = (amount: string, currency = "USD") =>
      staff.validate(def, { dailyBudget: { amount, currency } }).dailyBudget ??
      null;
    // "37,5" and "1,50" were read as 375 and 150 and passed: now refused with the decimal sentence.
    for (const bad of ["37,5", "1,50", " 37,50 "]) {
      expect(staff.amountNumber(bad)).toBeNull();
      expect([bad, said(bad)]).toEqual([bad, staff.DECIMAL_COMMA_RULE]);
      expect([bad, said(bad, "SAR")]).toEqual([bad, staff.DECIMAL_COMMA_RULE]);
    }
    // Any other misplaced comma keeps the amount rule.
    for (const bad of [
      "1,5000",
      "15,00,000",
      ",500",
      "1,",
      "1,500,",
      "100,001",
    ]) {
      expect(staff.amountNumber(bad)).toBeNull();
      expect([bad, said(bad)]).toEqual([bad, staff.AMOUNT_RULE]);
    }
    // Thousands groups still read as before.
    expect(staff.amountNumber("1,500.25")).toBe(1500.25);
    expect(staff.amountNumber("1,500")).toBe(1500);
    expect(staff.amountNumber("100,000")).toBe(100000);
    expect(said("1,500.25")).toBeNull();
    // Nothing is sent for a refused amount, and the ≈ line stays quiet.
    const live = def.fields.find(f => f.key === "dailyBudget")?.live;
    expect(live?.({ amount: "37,5", currency: "SAR" })).toBeNull();
    expect(live?.({ amount: "1,500.25", currency: "SAR" })).not.toBeNull();
    expect(
      kick.kickoffAnswers({ dailyBudget: { amount: "37,5", currency: "USD" } })
        .dailyBudget,
    ).toBeUndefined();
    expect(
      kick.kickoffAnswers({
        dailyBudget: { amount: "1,500.25", currency: "SAR" },
      }).dailyBudget,
    ).toEqual({ amount: 1500.25, currency: "SAR" });
    expect(staff.DECIMAL_COMMA_RULE).toBe(
      "Use a point for decimals, as in 37.5. A comma only groups thousands, as in 1,500.",
    );
  });

  test("sent as {amount, currency} and a whole number; as Make's text only for the older check", () => {
    const a = {
      dailyBudget: { amount: " 37.50 ", currency: "SAR" },
      coldCloseRate: "20",
    };
    expect(kick.kickoffAnswers(a)).toEqual({
      dailyBudget: { amount: 37.5, currency: "SAR" },
      coldCloseRate: 20,
    });
    expect(kick.kickoffAnswers(a, { text: true })).toEqual({
      dailyBudget: "37.5 SAR",
      coldCloseRate: "20%",
    });
    // A blank amount and a blank rate send nothing ("Not provided" on Make's line).
    expect(
      kick.kickoffAnswers({
        dailyBudget: { amount: "", currency: "KWD" },
        coldCloseRate: "",
      }),
    ).toEqual({});
    // The older check gives `length` to a value that is not a string; the amounts check never does here.
    expect(kick.kickoffNeedsText({ dailyBudget: "length" })).toBe(true);
    expect(kick.kickoffNeedsText({ coldCloseRate: "length" })).toBe(true);
    expect(kick.kickoffNeedsText({ dailyBudget: "range" })).toBe(false);
    expect(kick.kickoffNeedsText({ linksFix: "length" })).toBe(false);
  });

  const pill = (label: string) =>
    [...body().querySelectorAll(".fs-pill")]
      .find((l: any) => text(l) === label)
      ?.querySelector("input") as any;
  /** Every required question answered with its first choice, as the door tests do. */
  async function answerAll() {
    const groups = new Map<string, any>();
    for (const r of body().querySelectorAll('input[type="radio"]'))
      if (!groups.has(r.name)) groups.set(r.name, r);
    for (const r of groups.values()) await click(r);
    await click(pill("Meta (Facebook/Instagram)"));
    await click(pill("Design and build"));
    await click(pill("Online"));
    const link = [...body().querySelectorAll(".fs-field")]
      .find(
        (x: any) =>
          text(x.querySelector(".fs-label")) === "Call Recording Link",
      )
      ?.querySelector("input") as any;
    await typeInto(link, "https://example.test/call");
  }
  /** Opens the live sheet with these props. */
  async function sheet(props: Record<string, unknown>) {
    return draw(
      createElement(KickoffDoor, {
        door: OPEN,
        taskId: "86exmpl01",
        clientName: "Cedar Interiors",
        autoOpen: true,
        ...props,
      } as any),
    );
  }
  const budgetField = () =>
    [...body().querySelectorAll(".fs-field")].find(
      (x: any) =>
        text(x.querySelector(".fs-label")) ===
        "What is your daily budget for the ads? (optional)",
    ) as any;
  async function typeInto(el: any, value: string) {
    const setter = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(el),
      "value",
    )?.set;
    await act(async () => {
      setter?.call(el, value);
      el.dispatchEvent(new (win as any).Event("input", { bubbles: true }));
    });
    await flush();
  }

  test("one row: the number, the six currencies, the ≈ line under a non-USD amount, the hint", async () => {
    const { api } = stub();
    const root = await sheet({ api });
    const f = budgetField();
    expect(f).toBeTruthy();
    const segs = [...f.querySelectorAll('.fs-seg input[type="radio"]')];
    expect(segs.map((x: any) => x.value)).toEqual([
      "USD",
      "SAR",
      "KWD",
      "AED",
      "QAR",
      "BHD",
    ]);
    expect(segs[0].checked).toBe(true);
    expect(f.querySelector(".fs-seg").getAttribute("role")).toBe("radiogroup");
    expect(text(f)).toContain(
      "All their ads together, per day. Never shown on a slide.",
    );
    const input = f.querySelector(".fs-amount-input");
    expect(input.getAttribute("inputmode")).toBe("decimal");
    await typeInto(input, "150");
    // Dollars say nothing more.
    expect(f.querySelector(".fs-live")).toBeNull();
    await click(segs[1]);
    expect(text(budgetField().querySelector(".fs-live"))).toBe(
      "≈ $39.99 a day at the cockpit's rate.",
    );
    await click(budgetField().querySelector('.fs-seg input[value="BHD"]'));
    expect(text(budgetField().querySelector(".fs-live"))).toBe(
      "≈ $398.94 a day. Estimate only; this is not yet used for launch or card budgets.",
    );
    // No sale figure on the card: no "Same as the sale".
    expect(budgetField().querySelector(".fs-quick")).toBeNull();
    // The close rate is a number with a % beside it.
    const rate = [...body().querySelectorAll(".fs-field")].find(
      (x: any) =>
        text(x.querySelector(".fs-label")) ===
        "What is your current close rate on cold leads? (optional)",
    ) as any;
    expect(rate.querySelector(".fs-suffix-mark")?.textContent).toBe("%");
    expect(text(rate)).toContain("Leave it empty if they do not know.");
    await clear(root);
  });

  test("Same as the sale fills the card's dollars in one tap, never by itself, never from 1,000 or more", async () => {
    const { api } = stub();
    let root = await sheet({ api, saleBudgetUsd: 40 });
    const quick = budgetField().querySelector(".fs-quick");
    expect(text(quick)).toBe("Same as the sale: $40");
    // Not a prefill: the amount starts empty.
    expect(budgetField().querySelector(".fs-amount-input").value).toBe("");
    await click(quick);
    expect(budgetField().querySelector(".fs-amount-input").value).toBe("40");
    expect(
      budgetField().querySelector('.fs-seg input[value="USD"]').checked,
    ).toBe(true);
    await clear(root);
    root = await sheet({ api, saleBudgetUsd: 1500 });
    expect(budgetField().querySelector(".fs-quick")).toBeNull();
    await clear(root);
  });

  test("no Same as the sale once a kickoff is on record: the card's figure may be that kickoff's own", async () => {
    // Item 5's card_facts fills an empty Daily Budget from the kickoff, so on a send-again it is not the sale's.
    const def = kick.kickoffDef("Cedar Interiors", "2026-10-20T08:00:00Z", {
      saleBudgetUsd: 39.99,
    });
    expect(def.fields.find(f => f.key === "dailyBudget")?.quick).toBeNull();
    expect(
      kick
        .kickoffDef("Cedar Interiors", null, { saleBudgetUsd: 40 })
        .fields.find(f => f.key === "dailyBudget")?.quick?.label,
    ).toBe("Same as the sale: $40");
    const { api } = stub("2026-10-20T08:00:00Z");
    const root = await sheet({ api, saleBudgetUsd: 39.99 });
    expect(budgetField()).toBeTruthy();
    expect(budgetField().querySelector(".fs-quick")).toBeNull();
    expect(text(body())).not.toContain("Same as the sale");
    await clear(root);
  });

  test("against the older check the same answers go once more as Make's text, on the same request id", async () => {
    const calls: { a: Record<string, unknown>; r: string }[] = [];
    const api = {
      ...stub().api,
      submit: async (_t: string, a: Record<string, unknown>, r: string) => {
        calls.push({ a, r });
        if (calls.length === 1)
          return {
            responseId: null,
            trail: [],
            refused: { dailyBudget: "length", coldCloseRate: "length" },
          };
        return { responseId: "resp-k1", trail: [] };
      },
    };
    const root = await sheet({ api });
    await answerAll();
    await typeInto(budgetField().querySelector(".fs-amount-input"), "150");
    await click(budgetField().querySelector('.fs-seg input[value="SAR"]'));
    const rate = [...body().querySelectorAll(".fs-percent-input")][0] as any;
    await typeInto(rate, "20");
    await click(body().querySelector(".fs-foot .fs-btn"));
    expect(calls).toHaveLength(2);
    expect(calls[0].a.dailyBudget).toEqual({ amount: 150, currency: "SAR" });
    expect(calls[0].a.coldCloseRate).toBe(20);
    expect(calls[1].a.dailyBudget).toBe("150 SAR");
    expect(calls[1].a.coldCloseRate).toBe("20%");
    expect(calls[1].r).toBe(calls[0].r);
    expect(toasts).toContain("Sent.");
    toasts.length = 0;
    await clear(root);
  });

  test("after the send the trail carries on with what the kickoff left open, a Yes or No each", async () => {
    const { api: itemsApi, calls } = items.fakeItemsApi({
      "86exmpl01": items.rawRead([items.rawItem()], { taskId: "86exmpl01" }),
    });
    const root = await draw(
      createElement(KickoffDoor, {
        door: OPEN,
        api: stub().api,
        itemsApi,
        taskId: "86exmpl01",
        clientName: "Cedar Interiors",
        autoOpen: true,
      } as any),
    );
    // Nothing is read before the kickoff is stored.
    expect(calls).toHaveLength(0);
    await answerAll();
    await click(body().querySelector(".fs-foot .fs-btn"));
    expect(calls.map(c => c.name)).toEqual(["read"]);
    const after = body().querySelector(".fs-after");
    expect(text(after)).toContain("Still open from the kickoff · 1");
    expect(text(after)).toContain("Raise Card missing for ads?");
    expect(button("Change it first")).toBe(undefined);
    await click(
      [...after.querySelectorAll("button")].find(
        (b: any) =>
          b.getAttribute("aria-label") ===
          "Yes, raise Card missing for ads for Cedar Interiors",
      ),
    );
    expect(text(after.querySelector("[data-receipt]"))).toBe(
      "Raised: Card missing for ads · In ClickUp",
    );
    toasts.length = 0;
    await clear(root);
  });
});
